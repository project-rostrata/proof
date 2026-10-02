# proof — v1 implementation plan

Built from `PROJECT_BRIEF.md`. Open questions resolved so far:
- the app name is **proof**;
- rendering happens in the browser (WebGL2);
- the server stores the render plus an opaque recipe;
- files are the truth, with a Postgres index;
- v1 accepts JPEG and PNG only.

Still open (brief §5): auth, target devices, XMP naming, upload cap, export options, purging rejects, and the v1 tool list.

This plan breaks v1 into ordered phases. Each phase should leave the app in a buildable, runnable state, and no phase depends on a later phase to compile.

Dependency policy (brief §2): the Postgres JDBC driver, any `kotlinx.*` library, and `kotlin-test` are pre-approved. Anything else, on either side of the wire, needs to be raised with the human before it's added.

## Phase 1 — WebGL2 pipeline spike with mini-gl (throwaway, before the repo has code) — DONE

The spike passed on Firefox for Linux desktop, Firefox for Android, and headless Chrome. The outcome, with every number, is in `docs/decisions.md`:
- **A narrow fork of mini-gl:** GL core, runner, spline, perspective, and matrix transform only.
- **Half-float intermediates.**
- **Filters ported from darktable.**
- **Editing on a preview-sized source**, with the original rendered at full resolution only on save.

Safari and iPad are out of scope for v1. The original measurement brief is kept below for the record. `spike/` is removed once it's committed to history.

- **Load:** decode a real 24 MP JPEG (about 6000×4000) into a texture. Check `gl.MAX_TEXTURE_SIZE`, and check that GPU memory copes.
- **Interactive frame rate:** with 5+ stacked passes (tune, curves via a 1D LUT texture, white balance, structure as an unsharp mask on a downsampled blur, vignette), dragging a slider should re-render the screen-sized preview at display frame rate. Write down the actual numbers.
- **Precision:** check that half-float FBOs (`EXT_color_buffer_float`) are available. Confirm that stacking 5+ passes in 8-bit visibly bands and that half-float doesn't. This decides whether the fallback is needed.
- **Full-resolution export:** time the run from full-res render to `readPixels` to canvas to `toBlob('image/jpeg', 0.92)` at 24 MP. Confirm there are no tab crashes or context losses.
- **Color:** round-trip an sRGB JPEG with no edits applied and diff it against the original. Confirm there is no gamma or color shift beyond JPEG requantization.
- **EXIF:** confirm that `toBlob` output carries no EXIF. Then hand-splice the original's APP1 segment into the output and confirm it reads back correctly (with `exiftool` locally; the real implementation will be Kotlin).

Record the findings in `docs/decisions.md`, with numbers, before Phase 2. If a target device fails here, stop and bring it to the human. Either the device list or tiled rendering (brief §6, v2) gets reconsidered.

## Phase 2 — Repo scaffolding

```
proof/
  backend/
    src/               Kotlin sources
    test/              parallel to src/, not nested
    lib/               DEPENDENCIES.sha1 + fetch-deps.sh (jars gitignored)
    build.sh  run.sh  test.sh
  db/
    migrations/        plain numbered .sql files, hand-rolled runner (as in shelf)
  frontend/
    index.html  app.js  lib/van-1.6.1.js
    src/views/  src/components/
    src/pipeline/      WebGL2 core + runner (narrow mini-gl fork, MIT notices), recipe.js, ops/ (one file
                       per tool, ported from darktable), LICENSES.md (third-party notices)
    test/pipeline.html zero-dependency golden-pixel tests
  docker/
    Dockerfile  entrypoint.sh  docker-compose.yml
  docs/
    README.md  architecture.md  decisions.md  deployment.md  handoff.md
  PROJECT_BRIEF.md  V1_PLAN.md  AGENTS.md  README.md  CONTRIBUTING.md  SECURITY.md  LICENSE
```

## Phase 3 — Backend skeleton

Reuse `shelf`'s pattern directly rather than redesigning it.
- `Router.kt` and `ApiResult.kt` (the `Ok`/`Err` sealed result and the `{"error":{"code":...,"message":...}}` envelope), copied from `shelf` with the package renamed.
- `GET /api/health` returning `{"status":"ok"}`.
- A static file handler for `frontend/`.
- `TestMain.kt`, the hand-rolled reflective test runner.

## Phase 4 — Database, migrations, auth

- Postgres 18.6, the hand-rolled migration runner, and `users`/`sessions` exactly as in `shelf`, if auth is confirmed (brief §5).
- `projects` and `photos` tables (brief §7).

## Phase 5 — Projects + batch upload + ingest

- Project CRUD. The project name becomes a directory name, so it goes through `shelf`'s path-safety module.
- `POST /api/projects/{id}/photos`: one file per request, streamed to disk, with JPEG/PNG checked by magic bytes (not by extension or `Content-Type`), within the size cap.
- An EXIF reader (hand-written TIFF IFD parser) for orientation, capture time, and camera/lens/exposure, unit-tested against a small set of real-camera fixture JPEGs that cover all 8 orientations.
- Thumbnail (about 400 px) and preview (about 2048 px) generation with ImageIO/`Graphics2D`, using a multi-step downscale and with orientation applied, cached under `.cache/`.
- Frontend: a drag-and-drop or file-picker batch upload with a queue of about 3 concurrent uploads and progress per file.

## Phase 6 — Reconciliation

Reuse `shelf`'s scanner: mtime-based change detection between disk and the index, a `ScheduledExecutorService` backstop scan, and a manual "refresh". It picks up originals or sidecars added or changed outside the app, rebuilds missing cache entries, and re-reads XMP.

## Phase 7 — Cull

- An XMP sidecar reader/writer (`javax.xml`) for rating, flag, and label. Every write goes to the sidecar first, then the index.
- `PATCH /api/photos/{id}` for rating, flag, and label.
- `GET /api/projects/{id}/photos?view=picks|rejects|unrated&minRating=N&sort=...`. All filtering, sorting, counts, and display strings come from the API.
- Frontend: a grid and a loupe with keyboard controls (`0`–`5`, `P`/`X`/`U`, arrows) and an optimistic update that falls back to the server's response.

## Phase 8 — Edit pipeline core

- `src/pipeline/`:
  - the WebGL2 context, with half-float detection and the fallback decided in Phase 1;
  - texture upload from the original;
  - two framebuffers that passes alternate between;
  - the stack runner;
  - a preview renderer at display size and a full-resolution renderer.
- Recipe schema v1 (`{"version":1,"stack":[{"tool":"tune","params":{...}}, ...]}`), with a forward-migration hook.
- Tools: **Tune Image**, **White Balance**, **Curves** (LUT texture), and **Details** (structure and sharpening).
- A stack view (edit or remove an entry) and a before/after toggle.
- `frontend/test/pipeline.html`, with golden-pixel tests for each tool at known parameter values, including identity at the default parameters.

## Phase 9 — Geometry tools

**Crop** (free and fixed aspect ratios), **Rotate/Straighten** (90° steps plus a fine angle), and **Perspective** (4-corner), all done as UV/vertex transforms. The interactive overlays on the preview are built in this phase.

## Phase 10 — Looks

**Vignette** and **Black & White** (color-filter presets, plus brightness, contrast, and grain).

## Phase 11 — Save, reopen, re-edit

- `PUT /api/photos/{id}/edit`, a multipart or two-part upload with the rendered JPEG and the recipe JSON:
  - check the render by magic bytes;
  - validate that the recipe is well-formed JSON within a size cap, and otherwise leave it opaque;
  - splice the original's APP1/EXIF segment into the render, with orientation reset to 1;
  - write `edits/<name>.jpg` and `.recipe.json` atomically (write to temp, then move);
  - regenerate the thumbnail and preview from the render, and update the index.
- `GET /api/photos/{id}/edit/recipe` returns the recipe unchanged.
- `DELETE /api/photos/{id}/edit` reverts to the original.
- Frontend: a Save action that runs the full-resolution render and then the upload. Reopening an edited photo loads the original plus its recipe, so the stack can be edited again.

## Phase 12 — Export

`GET /api/projects/{id}/export?view=picks` streams a ZIP (`java.util.zip`) containing the render if the photo has been edited, otherwise the original.

## Phase 13 — Docker

`docker/Dockerfile` with pinned images (the same approach as `larder`), `entrypoint.sh` handling `PUID`/`PGID`, and a compose file plus a standalone image that bundles Postgres, as `shelf` does.

## Phase 14 — FOSS files, CI, smoke pass

The README, CONTRIBUTING, and SECURITY files finalized. A GitHub Actions workflow on `main` that runs `backend/test.sh` and builds the image, plus optionally `frontend/test/pipeline.html` under apt-installed headless Chromium. Finally, a manual smoke pass through the whole flow (upload 50+ real photos, cull, edit, save, reopen, export) on each target device.
