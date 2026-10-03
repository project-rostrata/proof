# proof

A small, self-hosted photo editor that runs in your browser. Upload a batch of photos, cull them
the way you'd mark up a contact sheet, then edit the keepers with Snapseed-style tools on a
non-destructive stack.

> **Status: v1 feature-complete except export.** Export (Phase 12) is deferred. See
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

## Features

- **Projects and batch upload.**
  - Drag in or pick a batch of JPEG/PNG photos. Three upload at once, with progress for each, and a
    100 MB cap per photo.
  - Re-uploading the same file is harmless.
  - EXIF is read on upload: capture time, camera, lens, and exposure. Orientation is applied
    everywhere.
- **Cull on a contact sheet.**
  - Keyboard-first: `0`–`5` stars, `P`/`X`/`U` pick, reject, unflag, arrows
    to move, `Enter` for a full-screen loupe. In the loupe, stars and Pick/Reject can also be
    clicked or tapped, and on a phone you swipe between photos.
  - Views for All, Picks, Unrated, Rejects, and a minimum rating.
  - Ratings are saved to standard XMP sidecars that darktable and Lightroom can read. proof merges
    into an existing sidecar, so darktable's edit history is never overwritten.
- **Edit with Snapseed-style tools on a non-destructive stack.**
  - Tune Image: brightness, contrast, saturation, ambiance, highlights, shadows, warmth.
  - White Balance, Curves, and Details (structure, sharpening).
  - Crop, Rotate/Straighten, and Perspective.
  - Vignette, and Black & White with film emulations, colour filters, and grain.
  - As in Snapseed, once a tool is open the photo is the control: scroll over it or drag across
    it to adjust a slider, and drag up or down to pick another.
  - Hold to compare with the original.
  - Edits render live in the browser on a 16-bit WebGL2 pipeline, with the filters ported from
    darktable. Saving renders the original at full resolution, copies its EXIF across, and keeps
    the recipe, so any edit can be reopened and changed later, or reverted.
- **Accounts:** shelf-style username/password accounts with private, per-user project folders.

## Quick start

```
docker compose -f docker/docker-compose.yml up -d --build
```

Then open http://localhost:8080 and register. See [`docs/deployment.md`](docs/deployment.md) for
the settings that matter before using it for real (the database password, `PROOF_SECURE_COOKIES`,
`PUID`/`PGID`, and where your photos live), and for the single-container standalone image.

Photos live on disk in their normal form, so they're easy to back up and to reach over SMB. proof
picks up changes made there:
- photos or whole project folders copied in, renamed, or deleted;
- ratings changed by darktable or Lightroom.

It checks when you open a page, and in the background every 15 minutes.


```
<data>/<user>/<project>/originals/IMG_0001.jpg      never modified
<data>/<user>/<project>/originals/IMG_0001.jpg.xmp  rating, pick/reject
<data>/<user>/<project>/edits/IMG_0001.jpg           your saved edit, full resolution
<data>/<user>/<project>/edits/IMG_0001.jpg.recipe.json
```

## Documentation

- [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md): the target design and non-negotiable constraints
- [`V1_PLAN.md`](V1_PLAN.md): the phased build plan
- [`docs/architecture.md`](docs/architecture.md): what's built and how the pieces fit
- [`docs/deployment.md`](docs/deployment.md): how to run it
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
