# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: projects, upload, ingest (V1_PLAN.md Phase 5)

```
Browser (VanJS)                                     HttpServer -> Router (requireAuth on all /api/projects, /api/photos)
  Auth view (sign in / register)                      ├─ POST/GET/PATCH/DELETE /api/projects[/:id]
  Projects view (create, rename, delete)              ├─ GET  /api/projects/:id/photos       project + photos, display strings
  Project view (upload queue + contact sheet)         ├─ POST /api/projects/:id/photos?filename=  raw body, one file
    upload.js: 3 concurrent XHR uploads               ├─ GET  /api/photos/:id/thumb|preview   generated on demand, cached
                                                      └─ GET  /api/photos/:id/original
```

**On disk**, under `$PROOF_DATA` (files are the truth, and Postgres indexes them):
```
<username>/<project>/originals/<filename>     uploaded files, never modified
.cache/<photoId>/thumb.jpg, preview.jpg       400 px / 2048 px long edge, upright; deletable
.tmp/                                         in-flight uploads; cleared at startup
```

**Ingest** (`api/PhotosHandler.upload`). One file per request, streamed:
1. Check the filename (`fs/ProjectPaths.isValidPhotoFilename`, then `resolveUnderRoot`).
2. Stream the body to `.tmp/` (`fs/UploadReceiver`). This enforces the size cap while reading,
   computes SHA-256, and sniffs JPEG/PNG from the magic bytes. The extension has to match the
   sniffed type.
3. Deduplicate. The same name with the same hash returns the existing photo, which makes retried
   batches idempotent. The same name with a different hash returns 409.
4. Read the header-only pixel size (`image/probeSize`) and the EXIF (`image/ExifReader`), a
   hand-written, bounds-checked TIFF parser for IFD0 and the Exif IFD.
5. Atomically move the file into `originals/` and insert the `photos` row, storing upright
   width/height.
6. Generate renditions on a background pool.

**Renditions** (`image/Renditions`):
- **Decode:** ImageIO decodes with source subsampling down to about 2x the target, and honours an
  embedded JPEG ICC profile, so P3 phone photos come out correctly in sRGB.
- **Scale and orient:** a multi-step downscale (bilinear halving, then a final bicubic step), with
  the EXIF orientation applied after scaling.
- **Write:** the JPEG is written atomically.
- **Concurrency:** a 2-slot semaphore bounds concurrent decodes, and concurrent requests for the same
  photo share one generation.
- **URLs:** they carry `?v=<mtime>` and are served `immutable`.

**Display strings** (`api/Display.kt`) are built server-side: capture date, camera ("Olympus
E-PL7"), exposure line ("17 mm · f/2.8 · 1/250 s · ISO 200"), sizes, and counts. The frontend only
renders them.

**Projects** (`api/ProjectsHandler`). A project is a directory, and the filesystem changes first:
- **Create** makes the directory, then inserts the row.
- **Rename** uses `fs/renameDirectory`, which refuses existing targets, including empty ones, and
  then updates the row.
- **Delete** removes the directory tree, then the rows, then the cache.

Another user's project or photo returns 404, never 403.

**Earlier phases, unchanged:**
- auth (Phase 4): shelf-style accounts and `proof_session` cookies;
- router, static files, and path safety (Phase 3);
- build scripts and jar fetching (Phase 2);
- the mini-gl seed (not loaded until Phase 8).

**Tests: 78**, none needing Postgres. The new ones cover:
- EXIF in both byte orders, with truncation, random garbage, and a self-referencing IFD;
- all 8 orientations, checked against an independent reference;
- type sniffing;
- renditions (upright, sized, never upscaled);
- name validation, and the rename regression;
- the upload receiver (cap, cleanup, hash);
- display strings.

Not yet present: reconciliation (Phase 6), cull/XMP (Phase 7), the edit pipeline (Phases 8-11),
export (Phase 12), `docker/` and `docs/deployment.md` (Phase 13).
