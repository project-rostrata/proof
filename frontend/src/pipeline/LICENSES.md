# Third-party code in the edit pipeline

proof is GPL-3.0-or-later (see `/LICENSE`). The files listed here contain code from other projects
under GPL-compatible licences. Each file also names its source in a header comment. The rules for
adding code from elsewhere are in `AGENTS.md` ("Frontend pipeline conventions") and the provenance
audit in `docs/decisions.md`.

## mini-gl (MIT), derived from glfx.js (MIT)

Source: https://github.com/xdadda/mini-gl at commit `28238857b0499dd39958ae3e45990e78fffdd454`
(v0.1.19). Only these files are carried over, a "narrow fork". mini-gl's other filters are
deliberately excluded because of where they came from (provenance audit, `docs/decisions.md`).

- `gl.js`: the GL plumbing (context, Texture, Program), restructured from `src/minigl.js`.
- `runner.js`: the ping-pong stack runner, following `src/minigl.js`'s `runFilter`.
- `minigl/filters/filterPerspective.js` and `minigl/filters/filterMatrix.js`: still verbatim,
  rewritten as ops in Phase 9.

(mini-gl's `cubicspline.js` was dropped in Phase 8, because curves use darktable's monotone Hermite
interpolation instead.)

mini-gl's own licence (also kept next to the files as `minigl/LICENSE`):

```
MIT License

Copyright (c) 2025 xdadda

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

glfx.js (https://github.com/evanw/glfx.js), which mini-gl is derived from:

```
Copyright (C) 2011 by Evan Wallace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## darktable (GPL-3.0-or-later)

Source: https://github.com/darktable-org/darktable at commit
`3fc4cfb252231edc687fefc469b3f7b7e2cade0a`. Each ported file names its darktable source in its header
and keeps darktable's notice: "Copyright (C) <years> darktable developers", GPL-3.0-or-later.
darktable's licence is the same GNU GPL v3 as proof's own `/LICENSE`.

| proof file | Ported from darktable |
|---|---|
| `color.js` | `data/kernels/colorspace.h`: CIE 2006 LMS, Filmlight Yrg/Ych, the Yrg gamut check, and the CAT16 matrices |
| `curve.js` | `src/common/curve_tools.c`: monotone Hermite tangents and evaluation, and the flat-beyond-end-points sampling |
| `ops/tune.js` | `src/iop/shadhi.c` and `data/kernels/gaussian.cl` (shadows/highlights overlay); `src/iop/colorbalancergb.c` (luminance power, grey-fulcrum contrast, chroma, vibrance) |
| `ops/details.js` | `src/iop/sharpen.c` (unsharp mask on Lab L with a threshold) |

Each file's header lists where proof's version deliberately differs (display-referred input, and
so on). `docs/decisions.md` has the reasoning.

## Published algorithms (no code copied)

- **Fast guided filter**, used for Structure in `ops/details.js`: He, Sun and Tang, "Guided Image
  Filtering" (ECCV 2010), and He and Sun, "Fast Guided Filter" (2015).
- **CIE daylight locus and CIE 1960 UCS**, in `color.js` (white balance): CIE 15 formulas.
- **sRGB transfer function and the sRGB to XYZ matrices**: IEC 61966-2-1.
