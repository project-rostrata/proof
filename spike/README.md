# Phase 1 spike — mini-gl in the browser

This is throwaway code, the equivalent of `press`'s printer-driver spike. It answers one question before any real code exists: **can mini-gl carry Snapseed-style editing of a 24 MP photo in the browser on our target devices, and should we use it as-is or fork it?** Delete this directory once its findings are recorded in `docs/decisions.md` and Phase 2 starts.

## What's here

- `index.html` and `spike.js`: the test page. It loads a photo or generates a synthetic 24 MP one, gives you sliders to judge how editing feels, and has a **Run all tests** button that produces a results JSON.
- `jpeg-exif.js`: a minimal Exif APP1 read/splice. It's a JS stand-in for what the Kotlin backend will do on save.
- `lib/mini-gl-2823885/`: [xdadda/mini-gl](https://github.com/xdadda/mini-gl) (MIT), vendored unmodified at commit `28238857b0499dd39958ae3e45990e78fffdd454` (v0.1.19). Only the `src/` files are included, plus LICENSE, README, and package.json.
- `lib/mini-gl-2823885-f16/`: the same files with one change in `minigl.js`. The intermediate textures are RGBA16F (linear half-float) instead of SRGB8. The header comment there lists exactly what changed.

## Running it

It needs any static HTTP server, because ES modules don't load from `file://`. With Docker, run this from the repo root:

```
docker compose -f spike/docker-compose.yml up   # stock nginx:1.30.5-alpine, spike/ mounted read-only
```

Then open `http://localhost:8008` on this machine, or `http://<this-machine's-ip>:8008` from other LAN devices such as an iPad. Press Ctrl-C to stop it, or use `down` if you started it with `-d`.

Without Docker, `cd spike && python3 -m http.server 8008 --bind 0.0.0.0` does the same job.

Then, on each target device:

1. **Choose a real photo**, ideally a full-resolution JPEG straight from your camera or phone. Synthetic images don't exercise real ICC profiles or EXIF. **Use synthetic 24 MP** is the fallback.
2. **Drag the sliders** in both variants and at both resolutions. Note how the preview feels compared with Snapseed: smooth, laggy, or unusable.
3. **Run all tests.** This takes a minute or two at 24 MP. The page may stutter while it runs.
4. **Save results JSON** (or copy it) and send it back. Plain-http LAN pages can't use the clipboard API. On those, the copy button selects the text for you to copy manually, or use Save instead.
5. Optionally, **Download last export** and check it in a viewer, or with `exiftool`, for orientation, metadata, and colour against the original.

URL options: `?mp=12` sets the synthetic size, `?frames=40` sets the number of benchmark frames, and `?auto=1` generates a synthetic photo and runs everything (used for the headless check below).

## What each test measures

| Section | Question |
|---|---|
| `device` | GPU, `MAX_TEXTURE_SIZE`, and float render-target support (`EXT_color_buffer_float`). |
| `orientation` | Does a JPEG with EXIF Orientation=6 arrive in the WebGL texture upright? This decides whether saved renders need Orientation reset to 1. |
| `identity` | Does each mini-gl filter at its default parameters leave every pixel unchanged? `AGENTS.md` requires this. |
| `banding` | A 256-level gray ramp through a tonal stack, in both variants: how many levels survive, and how big the biggest visible step is. `perToolAlone_u8` shows which tool, on its own, clips shadows or highlights. |
| `benchmark` | The realistic 6-tool stack (7 GPU passes), timed per frame at preview size (1600 px) and at full resolution, for both variants. |
| `export` | A full-resolution render, then `readPixels`, then `toBlob('image/jpeg', 0.92)`, then the Exif splice, with each step timed. It also checks that `toBlob` strips Exif and that the splice restores it. |
| `color` | An identity render against the browser's own 2D decode (is the GPU path exact?), then a JPEG round trip. |

## Findings so far

These come from headless Chrome 154 on SwiftShader (a software GPU) in the dev VM. Correctness results carry over to real hardware, but **the timings mean nothing**. Real-device numbers are still needed.

- **Orientation:** Chrome uploads EXIF-rotated JPEGs upright, and `naturalWidth`/`naturalHeight` are already rotated. Safari is untested.
- **Exif:** `toBlob` output has no Exif, as expected. Splicing the original's APP1 back in with Orientation set to 1 round-trips Make, Model, and DateTimeOriginal, and the JPEG still decodes.
- **Colour:** the GPU identity path matches the browser's 2D decode to within 1 level (0.02 mean). A JPEG 0.92 round trip adds a mean error of 0.14.
- **mini-gl's tonal math is the real problem, not 8-bit storage.** Each tool alone, on a gray ramp:
  - Contrast +0.15 clips **53** of the 256 input levels to pure black. The contrast matrix pivots around 0.5 in *linear* light.
  - Brightness +0.1 lifts black to gray 44. It adds a linear offset, so blacks fog.
  - Curves clips 18 levels with a mild S-curve. **Even an identity curve isn't an identity**: input levels 0–6 come out as 0, because the LUT is 256 entries of 8 bits applied to *linear* values.
- **Half-float intermediates help, modestly.** On the tonal stack, the largest visible step falls from 9 levels to 5, and the surviving distinct levels rise from 180 to 193. But they expose a **NaN bug** in Highlights/Shadows: it divides by luminance, which is zero for black pixels. 8-bit storage silently clamped that to 0. In float, the NaN survives and the next spatial filter (clarity) spreads it into neighbouring pixels (`identity.f16.highlightsShadowsThenDetails`, max diff 255).

### Real device: Firefox 156 on Linux desktop, 16-core machine, 2026-10-02

Firefox masks the GPU name, so the renderer reported is generic. Tested with a real Olympus E-PL7 JPEG (4608×3456, 15.9 MP). Every correctness result above repeated exactly, including orientation in Firefox.

| | 8-bit (upstream) | half-float fork |
|---|---|---|
| Preview 1600×1200, per frame (7 passes) | **8 ms** (~125 fps) | **13 ms** (~77 fps) |
| Full 4608×3456, per frame | 46 ms (~22 fps) | 95 ms (~11 fps) |
| Full-res export (render → JPEG → Exif) | 632 ms | 627 ms |
| Banding, tonal stack: biggest step / distinct levels | 11 / 161 | **5 / 188** |
| GPU identity vs 2D decode | exact (0 diff) | exact (0 diff) |

### Real device: Firefox 157 on Android (Pixel 7a), 2026-10-02

Tested with a real Pixel 7a JPEG (3024×4032, 12.2 MP). Firefox again masks the GPU name. Every correctness result repeated: orientation upright, identity exact, Exif splice OK, and the same tonal defects.

| | 8-bit (upstream) | half-float fork |
|---|---|---|
| Preview 1200×1600, per frame: median (p95) | **13 ms** (18) | **20 ms** (34) |
| Full 3024×4032, per frame | 33 ms | 38 ms |
| Full-res export | 489 ms | 527 ms |
| Banding, tonal stack: biggest step / distinct levels | 7 / 173 | **6 / 193** |

The human's verdict on feel (desktop): "pretty good". The sliders felt a little too sensitive across their full range.

Conclusion, pending the human's confirmation: **fork rather than vendor as-is.** Keep only the parts that hold up *and* have clean MIT provenance: the GL core and ping-pong runner, sRGB-correct texture handling, the perspective warp, the matrix transform, and the cubic spline. Run it on half-float intermediates. Write every pixel filter ourselves. The provenance audit in `docs/decisions.md` explains why the blurs, denoise, bloom, and adjustment shaders can't be carried over.
