# proof

A small, self-hosted photo editor that runs in your browser. Upload a batch of photos, cull them
the way you'd mark up a contact sheet, then edit the keepers with Snapseed-style tools on a
non-destructive stack.

> **Status: planning.** No code yet. See [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) and
> [`V1_PLAN.md`](V1_PLAN.md).

## Why

proof is built the same way as its sibling projects `shelf`, `larder`, and `press`. The backend
is Kotlin written directly against the JDK standard library: no Spring, no Ktor, and no image
library either, just `javax.imageio`. It compiles with bare `kotlinc`, with no Gradle and no
Maven. The frontend is VanJS with no bundler and no npm dependency tree. Edits render in the
browser through a small, readable pipeline of hand-written WebGL2 shaders, so sliders respond
instantly. Saved edits go back to the server as a rendered JPEG plus a recipe, so you can
always reopen and change them.

Your photos live on a real filesystem in their normal form. The originals are never modified.
Ratings go in standard XMP sidecars that other tools such as darktable can read, and edits sit
in a plain `edits/` folder. PostgreSQL is only an index over those files.

## Documentation

- [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md): the target design and non-negotiable constraints
- [`V1_PLAN.md`](V1_PLAN.md): the phased build plan
- [`docs/decisions.md`](docs/decisions.md): an append-only log of design decisions and why they were made
- [`AGENTS.md`](AGENTS.md): coding conventions for anyone (human or AI) working on the code

## Third-party code

- [VanJS](https://github.com/vanjs-org/van) 1.6.1 (MIT), vendored in `frontend/lib/`.
- The edit pipeline's GL core and geometry come from [mini-gl](https://github.com/xdadda/mini-gl)
  (MIT), which is derived from [glfx.js](https://github.com/evanw/glfx.js) (MIT). Its filters are
  ported from [darktable](https://github.com/darktable-org/darktable) (GPL-3.0-or-later). See
  [`frontend/src/pipeline/LICENSES.md`](frontend/src/pipeline/LICENSES.md) for the full notices.

## License

Copyright (C) 2026 Casey Watson.

proof is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. See [`LICENSE`](LICENSE) for the full text.

proof is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
