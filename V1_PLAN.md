# proof — v1 implementation plan

Built from `PROJECT_BRIEF.md`. Open questions resolved so far:
- the app name is **proof**;
- rendering happens in the browser (WebGL2);
- the server stores the render plus an opaque recipe;
- files are the truth, with a Postgres index;
- v1 accepts JPEG and PNG only.

Still open (brief §5): auth, target devices, XMP naming, upload cap, export options, purging rejects, and the v1 tool list. (All of these were later settled except purging rejects; see the brief.)

**Released as v1.0.0 on 2026-10-18.** Every phase below is done.

This plan breaks v1 into ordered phases. Each phase should leave the app in a buildable, runnable state, and no phase depends on a later phase to compile.

Dependency policy (brief §2): the Postgres JDBC driver, any `kotlinx.*` library, and `kotlin-test` are pre-approved. Anything else, on either side of the wire, needs to be raised with the human before it's added.

## Phase 1 — WebGL2 pipeline spike with mini-gl (throwaway, before the repo has code) — DONE

The spike passed on Firefox for Linux desktop, Firefox for Android, and headless Chrome. The outcome, with every number, is in `docs/decisions.md`:
- **A narrow fork of mini-gl:** GL core, runner, spline, perspective, and matrix transform only.
- **Half-float intermediates.**
- **Filters ported from darktable.**
- **Editing on a preview-sized source**, with the original rendered at full resolution only on save.

Safari and iPad are out of scope for v1. The original measurement brief is kept below for the record. `spike/` was removed after being committed to history; see commit `844e341`.

- **Load:** decode a real 24 MP JPEG (about 6000×4000) into a texture. Check `gl.MAX_TEXTURE_SIZE`, and check that GPU memory copes.
- **Interactive frame rate:** with 5+ stacked passes (tune, curves via a 1D LUT texture, white balance, structure as an unsharp mask on a downsampled blur, vignette), dragging a slider should re-render the screen-sized preview at display frame rate. Write down the actual numbers.
- **Precision:** check that half-float FBOs (`EXT_color_buffer_float`) are available. Confirm that stacking 5+ passes in 8-bit visibly bands and that half-float doesn't. This decides whether the fallback is needed.
- **Full-resolution export:** time the run from full-res render to `readPixels` to canvas to `toBlob('image/jpeg', 0.92)` at 24 MP. Confirm there are no tab crashes or context losses.
- **Color:** round-trip an sRGB JPEG with no edits applied and diff it against the original. Confirm there is no gamma or color shift beyond JPEG requantization.
- **EXIF:** confirm that `toBlob` output carries no EXIF. Then hand-splice the original's APP1 segment into the output and confirm it reads back correctly (with `exiftool` locally; the real implementation will be Kotlin).

Record the findings in `docs/decisions.md`, with numbers, before Phase 2. If a target device fails here, stop and bring it to the human. Either the device list or tiled rendering (brief §6, v2) gets reconsidered.

## Phase 2 — Repo scaffolding — DONE

Built as laid out below, with three differences:
- `TestMain.kt` was pulled forward from Phase 3 so that `test.sh` runs from the start.
- `docker/` stays in Phase 13 and `frontend/test/pipeline.html` stays in Phase 8. Neither has
  anything to hold yet.
- The pipeline is seeded with the four kept mini-gl files, copied **verbatim** into
  `frontend/src/pipeline/minigl/` with provenance headers. They get restructured in Phase 8, so
  proof's changes appear as diffs.

See `docs/architecture.md`.

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

## Phase 3 — Backend skeleton — DONE

Built as listed, with shelf's path-safety module (`fs/PathSafety.kt`) pulled forward from Phase 5 because the static handler already needs it. 20 tests pass, and the server was smoke-tested over real HTTP. See `docs/architecture.md`.

Reuse `shelf`'s pattern directly rather than redesigning it.
- `Router.kt` and `ApiResult.kt` (the `Ok`/`Err` sealed result and the `{"error":{"code":...,"message":...}}` envelope), copied from `shelf` with the package renamed.
- `GET /api/health` returning `{"status":"ok"}`.
- A static file handler for `frontend/`.
- (`TestMain.kt`, the hand-rolled reflective test runner, already landed in Phase 2.)

## Phase 4 — Database, migrations, auth — DONE

- Postgres 18.6, the hand-rolled migration runner, and `users`/`sessions` as in `shelf` (accounts were confirmed in brief §5). Dropped compared with shelf: device tokens, and the email, admin, and quota columns.
- Endpoints: `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, plus `requireAuth` for everything that follows.
- **Moved to Phase 5:** the `projects` and `photos` tables. Each table lands with the code that first writes it, so the EXIF columns are settled together with the EXIF reader rather than guessed now.
- Verified: 46 DB-free tests, plus a smoke test of the full register → me → logout → login flow against a real `postgres:18.6-alpine`.

## Phase 5 — Projects + batch upload + ingest — DONE

All built as listed, with two differences:
- **No real-camera fixtures.** The EXIF tests use a test-side TIFF writer covering both byte orders and all 8 orientations instead of committed camera files. Orientation is checked against an independent pixel-loop reference built from the EXIF spec table. Real Olympus and Pixel files were exercised by hand in the Phase 1 spike.
- **The frontend's first real views landed here:** sign-in/register, the project list (create, rename, delete), and the project page (upload queue plus contact-sheet grid).

Verified with 78 tests, an API smoke test against Postgres 18.6, and a headless-Chrome run of the real UI, including an upload through the file picker. See `docs/decisions.md` for the bug the smoke test caught.

- Migrations for the `projects` and `photos` tables (brief §7), moved here from Phase 4.
- Project CRUD. The project name becomes a directory name, so it goes through the path-safety module (`fs/PathSafety.kt`, already in place since Phase 3).
- `POST /api/projects/{id}/photos`: one file per request, streamed to disk, with JPEG/PNG checked by magic bytes (not by extension or `Content-Type`), within the size cap.
- An EXIF reader (hand-written TIFF IFD parser) for orientation, capture time, and camera/lens/exposure, unit-tested on synthetic TIFFs in both byte orders covering all 8 orientations.
- Thumbnail (about 400 px) and preview (about 2048 px) generation with ImageIO/`Graphics2D`, using a multi-step downscale and with orientation applied, cached under `.cache/`.
- Frontend: a drag-and-drop or file-picker batch upload with a queue of about 3 concurrent uploads and progress per file.

## Phase 6 — Reconciliation — DONE (2026-10-03)

Deferred on 2026-10-02 and built after Phase 14. `backend/src/index/`:
- **Pure planner** (`ReconcilePlan.kt`), unit-tested, as in `shelf`.
- **I/O glue** (`Reconciler.kt`).
- **One locking scheme** (`Locks.kt`) shared with upload, cull, edit save and revert, and project create, rename, and delete.

**What it picks up:**
- project folders added, renamed, or deleted outside the app;
- originals added, replaced in place, or deleted;
- XMP sidecars written, added, or deleted by other tools;
- `edits/` renders and recipes added or removed by hand.

**When it runs:** opening the projects list, opening a project, and a backstop pass every `PROOF_RECONCILE_INTERVAL_MINUTES` (default 15). Reloading the page is the "refresh", so there's no button.

See `docs/decisions.md`.

## Phase 7 — Cull — DONE

Built as listed, plus:
- **Colour labels:** keys 6–9. Removed again on 2026-10-03 (`docs/decisions.md`).
- **Merged sidecars:** an existing sidecar, darktable's included, is merged into rather than overwritten.
- **Filters in the URL:** the cull filter is mirrored in the URL.

90 tests pass, plus an end-to-end keyboard cull in headless Chrome and a concurrent-write stress test on a darktable sidecar. See `docs/decisions.md`.

- An XMP sidecar reader/writer (`javax.xml`) for rating, flag, and label. Every write goes to the sidecar first, then the index.
- `PATCH /api/photos/{id}` for rating, flag, and label.
- `GET /api/projects/{id}/photos?view=picks|rejects|unrated&minRating=N&sort=...`. All filtering, sorting, counts, and display strings come from the API.
- Frontend: a grid and a loupe with keyboard controls (`0`–`5`, `P`/`X`/`U`, arrows) and an optimistic update that falls back to the server's response.

## Phase 8 — Edit pipeline core — DONE

Built as listed, with the tools ported from darktable at a pinned commit, and a few differences:
- **Structure** uses a guided filter, not darktable's local Laplacian (too many passes for interactive WebGL).
- **Ambiance** is proof's own definition.
- **Display-referred adaptations** are documented per file.
- **The editor UI** is reached with **E** or the loupe's Edit button. It has a tool picker, the stack (select or remove entries), per-tool sliders, a curve editor, and Compare (hold the button or `\`). **Edits aren't saved yet** (Phase 11).

Verified with 27 pipeline tests in headless Chrome and an end-to-end editor run against the real stack. See `docs/decisions.md`.

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

## Phase 9 — Geometry tools — DONE

Built as listed, with one deliberate change: **Perspective is vertical and horizontal keystone sliders, not four draggable corners.** Keystone covers the common fix (converging verticals), and corner-dragging on a phone-sized preview is fiddly. The maths underneath is a general four-corner homography, so a free-corner mode can be added later without changing the engine.

Also built:
- Crop aspect presets (Free, Original, 1:1, 3:2, 4:3, 5:4, 16:9, each with a portrait form).
- Straighten auto-crops to the largest same-aspect rectangle, so there are no blank corners.
- The editor shows a crop step's input with a crop box, and Rotate and Perspective with an alignment grid.
- Each op's context is sized from its own input, so tools after a crop or turn work on the new size.

Verified with 42 pipeline tests and the editor driven end to end. See `docs/decisions.md`.

**Crop** (free and fixed aspect ratios), **Rotate/Straighten** (90° steps plus a fine angle), and **Perspective** (keystone; originally planned as 4-corner, see above), all done as an output-to-input pixel mapping. The interactive overlays on the preview are built in this phase.

## Phase 10 — Looks — DONE

Both tools are ported from darktable:
- **Vignette** (`vignette.c`): outer brightness, inner brightness, and size.
- **Black & White**, with three sources:
  - film responses from channelmixerrgb's monochrome presets: Neutral, Ilford HP5+, Delta 100, Delta 400, FP4+, and Fuji Acros;
  - colour filters from monochrome.c: none, red, orange, yellow, green, and blue;
  - brightness and contrast, shared with Tune;
  - grain from grain.c.

48 pipeline tests pass. See `docs/decisions.md`.

**Vignette** and **Black & White** (color-filter presets, plus brightness, contrast, and grain).

## Phase 11 — Save, reopen, re-edit — DONE

Built as listed, with these details:
- **The request:** the save is one framed request (`[4-byte recipe length][recipe JSON][JPEG]`) rather than multipart, so there's no parser to hand-write.
- **Stale saves:** `?base=<editVersion>` rejects a save that started from an older edit (409).
- **Non-destructive editing:** the editor always edits the *original*, through a separate original-based 2048 px preview (`/api/photos/:id/source`).
- **Two smaller fixes:** files proof writes are now `rw-r--r--` (they were owner-only), and render names can't collide.

Verified with 102 backend tests and editor runs in headless Chrome. A save produced a full-resolution render, upright, with EXIF; reopen, revert, and the stale-save refusal were all checked. See `docs/decisions.md`.

- `PUT /api/photos/{id}/edit`, a multipart or two-part upload with the rendered JPEG and the recipe JSON:
  - check the render by magic bytes;
  - validate that the recipe is well-formed JSON within a size cap, and otherwise leave it opaque;
  - splice the original's APP1/EXIF segment into the render, with orientation reset to 1;
  - write `edits/<name>.jpg` and `.recipe.json` atomically (write to temp, then move);
  - regenerate the thumbnail and preview from the render, and update the index.
- `GET /api/photos/{id}/edit/recipe` returns the recipe unchanged.
- `DELETE /api/photos/{id}/edit` reverts to the original.
- Frontend: a Save action that runs the full-resolution render and then the upload. Reopening an edited photo loads the original plus its recipe, so the stack can be edited again.

## Phase 12 — Export — DONE (2026-10-04)

Built together with the workflow modes (Upload · Cull · Edit · Export; see `docs/decisions.md`). `GET /api/projects/{id}/export` streams a ZIP of the picks (`java.util.zip`, stored without compression, chunked). Each entry is the pick's saved edit if it has one, otherwise the original.

## Phase 13 — Docker — DONE

Built as listed, on pinned `eclipse-temurin:25.0.4_7-*-alpine-3.24` images:
- **Build stage:** `kotlinc` is checksum-pinned.
- **`backend-test` target:** all 102 tests pass on Alpine/musl, headless AWT and ImageIO included.
- **`runtime` target:** a PUID/PGID entrypoint.
- **`standalone` target:** Postgres 18 bundled, loopback-only.

Smoke-tested via compose and standalone:
- upload, thumbnails, cull with XMP, and a saved edit with the EXIF splice;
- host file ownership and `rw-r--r--` permissions;
- a restart, keeping data and skipping migrations.

See `docs/deployment.md`.

`docker/Dockerfile` with pinned images (the same approach as `larder`), `entrypoint.sh` handling `PUID`/`PGID`, and a compose file plus a standalone image that bundles Postgres, as `shelf` does.

## Phase 14 — FOSS files, CI, smoke pass — DONE (except the human's real-device pass)

- **FOSS files:** the README covers features, a quick start, and the on-disk layout. CONTRIBUTING and SECURITY are updated.
- **CI:** `.github/workflows/docker-build.yml`, on `main`, tags, and PRs. Backend tests run through `docker build --target backend-test`, and pipeline tests through `frontend/test/run-headless.sh` (the runner's preinstalled Chrome, SwiftShader, no npm). On `main` and tags, the standalone image is pushed to GHCR, gated on both.
- **Automated smoke pass:** run on the production compose image in headless Chrome. 54 photos were uploaded through the file picker, culled by keyboard, and one was edited, saved, and reopened, with no errors.
- **Still the human's:** the same pass on their real desktop and phone with real photos.

The README, CONTRIBUTING, and SECURITY files finalized. A GitHub Actions workflow on `main` that runs `backend/test.sh` and builds the image, plus optionally `frontend/test/pipeline.html` under apt-installed headless Chromium. Finally, a manual smoke pass through the whole flow (upload 50+ real photos, cull, edit, save, reopen, export) on each target device.
