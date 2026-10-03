# Third-party code in the edit pipeline

proof is GPL-3.0-or-later (see `/LICENSE`). The files listed here contain code from other projects
under GPL-compatible licences. Each file also names its source in a header comment. The rules for
adding code from elsewhere are in `AGENTS.md` ("Frontend pipeline conventions") and the provenance
audit in `docs/decisions.md`.

## mini-gl (MIT), derived from glfx.js (MIT)

Source: https://github.com/xdadda/mini-gl at commit `28238857b0499dd39958ae3e45990e78fffdd454`
(v0.1.19). Only these files are carried over, a "narrow fork". mini-gl's other filters are
deliberately excluded because of where they came from.

- `minigl/minigl.js`
- `minigl/filters/cubicspline.js`
- `minigl/filters/filterPerspective.js`
- `minigl/filters/filterMatrix.js`

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

Source: https://github.com/darktable-org/darktable. Filters in `ops/` are ported from darktable
modules (`src/iop/`) and OpenCL kernels (`data/kernels/`). Each ported file names the darktable
source file and the commit it was taken from, and keeps darktable's notice ("Copyright (C)
<years> darktable developers", GPL-3.0-or-later). darktable's licence is the same GNU GPL v3 as
proof's own `/LICENSE`.

No darktable code has been ported yet. The first ports land in `V1_PLAN.md` Phase 8.
