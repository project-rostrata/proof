# Session handoff

This file is *state*, not documentation. For durable decisions, read `decisions.md`. It gets rewritten each session to reflect where things stand, rather than appended to indefinitely.

## Where things stand

As of 2026-10-02 there are planning docs only, and no code exists yet. The initial planning conversation settled:
- the name (**proof**);
- rendering in the browser with WebGL2;
- storing the render plus an opaque recipe;
- files as truth with a Postgres index;
- JPEG and PNG only for v1.

All of these are recorded in `PROJECT_BRIEF.md` §4 and `decisions.md`.

## What's still open

`PROJECT_BRIEF.md` §5 lists the open questions:
- **auth** (the recommendation is `shelf`-style accounts);
- XMP sidecar naming;
- the max upload size;
- export options;
- purging rejects;
- sign-off on the v1 edit tool list.

## Phase 1 spike status (2026-10-02)

- mini-gl was approved as the base for the edit pipeline. The spike is built in `spike/` and tests two variants: upstream as-is (vendored at `28238857`) and a minimal half-float fork.
- Correctness was verified headless (Chrome 154 on SwiftShader, run from the dev VM over CDP, with no npm involved). See `decisions.md` and `spike/README.md`. The short version: orientation, the Exif splice, and colour all pass. mini-gl's *tonal* filters (contrast, brightness, curves, highlights/shadows) have real quality defects. Half-float helps banding modestly but exposes a NaN bug in Highlights/Shadows.
- The human ran it on Firefox 156 on a Linux desktop with a real 16 MP JPEG. Correctness repeated exactly. Preview frames took 8 ms (8-bit) and 13 ms (half-float), and a full-resolution save about 630 ms. The human said it felt "pretty good", with the sliders a bit too sensitive. All recorded in `decisions.md`.
- Phone run (Firefox 157 on Android, Pixel 7a): also good, with a 13/20 ms preview and a 0.5 s save. GPU output isn't bit-identical across devices, so the pipeline tests need a tolerance.
- **Provenance audit done** (`decisions.md`). Several mini-gl filters cite Shadertoy (CC BY-NC-SA by default), a 2014 Stack Overflow answer (CC BY-SA 3.0), or Pintura (proprietary). Only the GL core, runner, spline, perspective, and matrix transform can be carried over. All pixel filters get written fresh.
- **Phase 1 closed (2026-10-02).** The human confirmed the narrow fork and said to take filters from darktable. Safari and iPad are out of scope for v1, and the targets are Firefox and Chromium on desktop and Android. The raw results JSON was not kept, because the numbers are in `decisions.md`.

## Next step

Commit the spike and the doc updates so `spike/` survives in git history, then remove `spike/` in a follow-up commit and start Phase 2 (scaffolding). The human has to OK both commits.
