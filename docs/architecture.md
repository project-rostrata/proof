# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: v1 (V1_PLAN.md Phases 1–14; export deferred)

Docker images: see `deployment.md`. CI: `.github/workflows/docker-build.yml` (backend tests in Docker, pipeline tests via `frontend/test/run-headless.sh`, then the standalone image to GHCR).

### Saved edits (Phase 11)

```
Editor ──Save──> fetch original ─> createImageBitmap (upright) ─> Pipeline.renderToPixels(recipe), full resolution
       ─> canvas.toBlob(JPEG 0.92) ─> PUT /api/photos/:id/edit?base=<editVersion>
          body: [4-byte recipe length][recipe JSON][JPEG]   (fs/EditBody.kt)
Server: check base (409 EDIT_CHANGED) ─> parse the frame (recipe must be {version:int, stack:[]}; render must be a JPEG)
        ─> splice the original's EXIF in (JpegExif: orientation reset to 1, no ICC)
        ─> under the project lock: check base again, then atomic writes:
           edits/<render name> + edits/<original>.recipe.json (rw-r--r--)
        ─> photos.has_edit / edit_mtime / recipe_version ─> regenerate the display renditions from the render
GET /api/photos/:id/edit    -> {editVersion, recipe}   (reopen; the frontend migrates it with loadRecipe)
DELETE /api/photos/:id/edit -> deletes both files and reverts the thumbnails to the original
GET /api/photos/:id/source  -> a 2048 px preview of the *original* (the editor always edits the original)
```

- **Render names:** `IMG_0001.jpg` → `edits/IMG_0001.jpg`, `scan.png` → `edits/scan.png.jpg`. Two originals that would share a render file are refused (409).
- **Renditions:** two groups. DISPLAY (thumbnail and preview) comes from the render once there is one. SOURCE comes from the original. A save or revert invalidates DISPLAY only.
- **Editor:**
  - Save is enabled only with unsaved changes. The footer shows Unsaved changes, Saved, or progress.
  - Revert appears when there's a saved edit.
  - Closing asks only when there are unsaved changes.
  - The grid's thumbnail and the loupe's preview `src` follow the photo's state, so a save shows up immediately, with a ✎ badge on edited frames.

### Edit pipeline (`frontend/src/pipeline/`)

```
preview JPEG (2048 px, upright) ──> Pipeline.setSource ──> SRGB8 texture
  DECODE pass ──> RGBA16F linear working texture
  for each recipe entry: TOOLS[tool].apply(ctx, current, params) ──> next texture (pooled)
  ENCODE pass: NaN-safe clamp, sRGB encode, sub-LSB dither ──> canvas (flipped) | RGBA8 readback
```

- **`gl.js`:** WebGL2 context (requires `EXT_color_buffer_float`), `Texture` (srgb8 / rgba16f / rgba8), and `Program`, which uses a static full-screen triangle and cached uniform locations. Restructured from mini-gl.
- **`runner.js`:** `Pipeline` exposes `setSource`, `renderToCanvas`, `renderToPixels` (top-down RGBA8, exactly what the canvas shows), and `renderToFloats` (tests), plus `PassContext` and a texture pool keyed by size. Shared passes: 2×2 box halving, a separable Gaussian, and a separable box.
- **`color.js`:** linear sRGB ↔ XYZ, darktable's CIE 2006 LMS / Filmlight Yrg / Ych and its gamut check, CAT16 white balance along the CIE daylight locus, and CIE Lab (D65). `WHITE_RG` and `WHITE_Y` are computed for proof's matrices, so neutral greys stay exactly neutral and white maps to white.
- **`curve.js`:** darktable's monotone Hermite interpolation, shared by the LUT and the curve editor's drawing.
- **`recipe.js`:** `{version: 1, stack: [{tool, params}]}`. `loadRecipe` migrates, defaults, clamps, and refuses unknown tools and newer versions.
- **`geometry.js`:** the homography (mini-gl/glfx's square-to-quad), crop rounding and aspect presets, quarter-turn, flip, and straighten mapping with its auto-crop scale, and keystone quads.
- **Tools (`ops/`):**

  | Tool | Parameters | What it runs |
  |---|---|---|
  | Tune | brightness, contrast, saturation, ambiance, highlights, shadows, temperature, tint | 1–5 passes; white balance is a CAT16 matrix in the first |
  | Details | structure, sharpening | guided filter at reduced resolution, plus a small Gaussian |
  | Curves | RGB, red, green, blue | 1 pass, a cached 1024-entry LUT |
  | Crop & Rotate | normalised rect, aspect, quarter turns, flip, straighten, vertical and horizontal keystone | 1 warp pass through one composed matrix (turns and flip, keystone, straighten with its auto-crop, crop): an exact copy unless straightened or keystoned, bicubic otherwise |
  | Vignette | outer brightness, inner brightness, size | 1 pass |
  | Black & White | film, colour filter, brightness, contrast, grain | 1 pass, plus a blurred filter mask when filtered; grain is simplex noise averaged over the pixel footprint in previews |

  Each op gets a context sized from its own input, so tools after a crop or turn work on the new size.

### Editor (`frontend/src/views/Editor.js` and `views/editor/`)

Snapseed's model:
- **One tool open at a time.** You open a tool from the grouped list (`TOOL_GROUPS`: Adjust, Geometry, Looks), adjust it, and apply it (✓, Done, Enter) or discard it (✕, Cancel, Esc). Each use of a tool is one layer in the stack, and selecting a layer reopens it.
- **Discarding** drops a new layer, or restores a reopened one's parameters and the session's unsaved flag.

The files:
- **`Editor.js` is the session:**
  - the pipeline, save, revert, keys, and the overlays;
  - opening, applying, and discarding tools;
  - a live `(max-width: 800px)` query that chooses the layout.
  - Opening: E, or the loupe's Edit button, opens a full-screen editor on the photo's 2048 px preview. The canvas is fitted into the stage in JS (`layout()`), and overlays sit in a frame of exactly that size.
  - Cleanup: one session at a time, disposed whenever `state.editing` changes. That releases the GL context and the listeners.
- **`editor/tool.js` is the open tool.**
  - Its *picks* are its plain sliders, plus the crop box for Crop & Rotate. One is active.
  - `shown` holds each slider's value as a van state, shared by everything that displays it.
  - `before` is the snapshot ✕ restores.
- **`editor/gestures.js` is adjusting on the photo:**
  - dragging sideways (or scrolling) changes the active slider. As in Snapseed, half the photo's width takes a slider from its default to its furthest end;
  - dragging up or down picks. As in Snapseed, a highlight band stays fixed at the centre of the photo and the whole list slides through it with the finger, pixel for pixel (rows are 40 px, the drag per control). Whichever control is in the band is selected;
  - a pill shows the active pick and its value.

  The crop box stops the drags it uses (resizing, or moving a box smaller than the photo), and everything else reaches the gestures, so you can always swipe from Crop to Straighten.
- **`editor/controls.js` has the two layouts, built from shared pieces** (tool groups, the stack, the aspect and turn controls):
  - **Desktop:** a panel beside the photo, with the tools, the stack, the open tool's sliders and other controls, and the footer (Compare, Revert, Save).
  - **Phones:** the photo fills the screen, with one bar under it. With no tool open the bar is ✕, Tools, Edits, Compare, and Save. With a tool open it's ✕, the tool's name, ≡, and ✓. Tools, Edits, and ≡ open sheets over the photo. ≡ lists the picks with their values (tap to choose) and the tool's other controls. There are no sliders on phones: the photo is the slider. Curves is drawn over the photo.
- **What the stage shows:** the whole stack, except while Crop & Rotate is open. Then it's the stack up to and including it, with its crop left out, and the crop box drawn over it (`components/CropOverlay.js`). The box takes drags only while Crop is the active pick. Otherwise its handles hide and an alignment grid shows.
- **Re-rendering:** the recipe is mutated in place, and only structural changes (open, apply, discard, add, remove) re-render the controls, so nothing is re-created mid-drag.

### Cull (Phase 7)

Sidecars changed by other tools are re-read by reconciliation (below). Cull writes record the sidecar's mtime (`photos.sidecar_mtime`), so proof's own writes aren't re-read.

### Reconciliation (Phase 6)

`backend/src/index/`. The files are the truth, and the index is brought back in line with them.
- **`ReconcilePlan.kt` is pure.** It compares a project's originals on disk (`DiskPhoto`: size, mtime, sidecar mtime, edit mtime) with its rows. The result is added, removed, replaced, sidecar-changed, and edit-changed photos. It also compares project folder names with project rows.
- **`Reconciler.kt` does the I/O.**
  - It lists only real directories and regular files, and never follows symlinks.
  - It skips hidden files and invalid names.
  - It hashes and decodes new or replaced originals *before* taking the project lock. Under the lock it re-lists, re-plans, and applies, using prepared work only for files whose size and mtime haven't changed since.
  - It counts what was applied, so a junk `.jpg` or an unparseable sidecar doesn't log every pass.
  - A missing user folder (unmounted storage) is skipped, never read as "every project deleted".
- **`Locks.kt`:** striped user and project locks, taken user first. Upload (name check, move, and insert), cull, edit commit and revert, and project create, rename, and delete all take the same locks reconciliation does.
- **Triggers:**
  - `GET /api/projects` reconciles the project set, and a newly found project's photos.
  - `GET /api/projects/:id/photos` reconciles that project.
  - A backstop pass runs every `PROOF_RECONCILE_INTERVAL_MINUTES` (default 15, 0 off), first a minute after startup.
- **Timestamps** go through `fs/FileTimes.kt` (truncated to microseconds, Postgres's precision), or every file would look changed on every pass.

**Cull data flow.** `PATCH /api/photos/:photoId` takes either or both of `{rating 0-5, flag none|pick|reject}`:
1. Take the project lock (`index/Locks.kt`), so concurrent keypresses, and reconciliation, can't race the sidecar's read-modify-write.
2. Read the current state from the XMP sidecar `originals/<file>.xmp`, which is the truth.
3. Merge the change and write the sidecar (`image/Xmp`). This parses the existing document, updates only proof's properties, and writes it back atomically.
4. Update the `photos` index row.
5. Return `{ photo, views }`: the updated photo plus recounted view totals.

A sidecar that can't be parsed returns 409 `SIDECAR_UNREADABLE` and is never overwritten.

**XMP mapping** (`image/Xmp.kt`):
- `xmp:Rating` holds the stars, or `-1` when rejected (the de facto reject value).
- `xmp:Label` (a colour label from Lightroom or darktable) is never read or written: proof has no labels, so it survives untouched.
- `proof:Flag` holds the pick/reject flag and `proof:Rating` the stars, which survive a reject. The namespace is `urn:x-proof:xmp:1.0`.
- Properties are read in attribute or element form.
- Parsing is XXE-safe (no DTDs).
- Existing sidecars are written back un-reindented, with a hand-written XML declaration and exactly one trailing newline, so repeated writes are byte-stable.

**Filtered views.** `GET /api/projects/:id/photos?view=all|picks|unrated|rejects&minRating=0..5` filters in SQL. The `CullView` predicates are fixed and never built from input. Each response carries `views[]` with every view's count, so the UI never counts or filters.

**Frontend.**
- **Per-photo state:** each photo is its own `van.state`. A cull change re-renders that frame's badges and class only, and the static parts are read through `rawVal`, so `<img>` nodes are never re-created.
- **Keyboard (`src/cull.js`):** 0–5, P/X/U, arrows (up/down by the laid-out column count), Enter/Space opens the loupe, Esc closes it. Updates are optimistic, then replaced by the server's photo, and reverted on error.
- **Filter state:** the filter lives in the URL (`?project=&view=&minRating=`).
- **Theme:** dark by default. `theme.js`, a classic script in `<head>`, sets `<html data-theme>` before first paint, from the footer switch's saved choice (`localStorage`, `proof-theme`) or else the system setting, live. `style.css` keys the light tokens off that attribute, and `src/theme.js` mirrors it for the footer button. The loupe and editor always use the dark tokens. This is the same as larder's.
- **Loupe:** a full-screen 2048 px preview on a neutral surround, on a strip with the neighbouring previews either side (so they're loaded before they're needed). On touch, a one-finger horizontal swipe drags the strip and moves to the next or previous photo; pinch-zoom is left to the browser, and while zoomed, drags pan instead of swiping. Its bar has clickable culling (`components/CullControls.js`): Pick/Reject toggles and stars (clicking the current rating clears it). They call the same `cull()` as the keyboard and never take focus, so the keys keep working after a click.

**Earlier phases, unchanged:**
- auth (Phase 4): shelf-style accounts and `proof_session` cookies;
- router, static files, and path safety (Phase 3);
- build scripts and jar fetching (Phase 2);
- the mini-gl seed (not loaded until Phase 8).

### Security (the 2026-10-03 audit)

For a home server that may be reachable from outside. The reasons are in `decisions.md`.
- **Accounts:**
  - registration is closed once the first account exists, unless `PROOF_ALLOW_REGISTRATION=true`;
  - after 10 failed sign-ins in 15 minutes, a username gets 429 until the window ends (`auth/LoginThrottle.kt`, in memory);
  - an unknown username is hashed against a decoy, so the response time doesn't reveal which usernames exist.
- **Requests:**
  - JSON bodies go through `readBody()`, capped at 64 KB (413). Uploads and edit saves stream with their own caps.
  - Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: same-origin` (`api/Router.kt`).
  - CSRF protection is the `SameSite=Lax` session cookie: every state change is a non-GET request.
- **Images:** anything over 250 MP (`image/OriginalFacts.kt` `MAX_PIXELS`) is refused on upload and edit save, and skipped by reconciliation. This is checked from the header, before any decode.
- **Paths:** see path safety (Phase 3) and reconciliation (no symlinks followed).

### Tests

**Backend: 114**, none needing Postgres. **Pipeline: 48**, in `frontend/test/pipeline.html`. Backend coverage:
- EXIF in both byte orders, with truncation, random garbage, and a self-referencing IFD;
- all 8 orientations, checked against an independent reference;
- type sniffing;
- renditions (upright, sized, never upscaled);
- name validation, and the rename regression;
- the upload receiver (cap, cleanup, hash);
- display strings;
- XMP read/write: the darktable merge, element-form properties, XXE and broken files refused, byte-stable rewrites, and another tool's colour label left alone;
- the edit body framing and recipe version;
- the reconciliation planner, and timestamp precision;
- the login throttle, the JSON body cap, and the security headers.

Not yet present: export (Phase 12, skipped for now).
