# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: saving edits (V1_PLAN.md Phase 11)

### Saved edits

```
Editor ──Save──> fetch original ─> createImageBitmap (upright) ─> Pipeline.renderToPixels(recipe), full resolution
       ─> canvas.toBlob(JPEG 0.92) ─> PUT /api/photos/:id/edit?base=<editVersion>
          body: [4-byte recipe length][recipe JSON][JPEG]   (fs/EditBody.kt)
Server: check base (409 EDIT_CHANGED) ─> parse the frame (recipe must be {version:int, stack:[]}; render must be a JPEG)
        ─> splice the original's EXIF in (JpegExif: orientation reset to 1, no ICC)
        ─> atomic writes: edits/<render name> + edits/<original>.recipe.json (rw-r--r--)
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
  | Tune Image | brightness, contrast, saturation, ambiance, highlights, shadows, warmth | 1–5 passes |
  | White Balance | temperature, tint | 1 pass, a CAT16 matrix |
  | Curves | RGB, red, green, blue | 1 pass, a cached 1024-entry LUT |
  | Details | structure, sharpening | guided filter at reduced resolution, plus a small Gaussian |
  | Crop | normalised rect, aspect | exact copy, output = the crop |
  | Rotate | quarter turns, flip, straighten | exact copy for turns and flips; bicubic and an auto-crop for a fine angle |
  | Perspective | vertical, horizontal keystone | bicubic homography, output fully covered |
  | Vignette | outer brightness, inner brightness, size | 1 pass |
  | Black & White | film, colour filter, brightness, contrast, grain | 1 pass, plus a blurred filter mask when filtered; grain is simplex noise averaged over the pixel footprint in previews |

  Each op gets a context sized from its own input, so tools after a crop or turn work on the new size.

### Editor (`frontend/src/views/Editor.js`)

- **Opening:** E, or the loupe's Edit button, opens a full-screen editor on the photo's 2048 px preview. The canvas is fitted into the stage in JS (`layout()`), and overlays sit in a frame of exactly that size.
- **What the stage shows:** a selected Crop shows its *input* (`upTo`) with a crop box (`components/CropOverlay.js`: shaded outside, rule of thirds, corner and edge handles, aspect-locked corners). Rotate and Perspective show the result up to themselves with a grid. Otherwise the whole stack. **Done** or Enter finishes a tool.
- **Panel:** add a tool, the stack (select or remove entries), the active tool's sliders or curve editor, and Compare (hold the button or `\`).
- **Cleanup:** one session at a time, disposed whenever `state.editing` changes. That releases the GL context and the key listeners.
- **Re-rendering:** the recipe is mutated in place, and only structural changes re-render the panel, so sliders aren't re-created mid-drag.

### Cull (Phase 7)

Phase 6 (reconciliation) is **deferred** (see the decisions log), so nothing re-reads disk changes made outside the app.

**Cull data flow.** `PATCH /api/photos/:photoId` takes any of `{rating 0-5, flag none|pick|reject, label Red|Yellow|Green|Blue|Purple|null}`:
1. Take the per-photo lock (64 striped monitors), so concurrent keypresses can't race the sidecar's read-modify-write.
2. Read the current state from the XMP sidecar `originals/<file>.xmp`, which is the truth.
3. Merge the change and write the sidecar (`image/Xmp`). This parses the existing document, updates only proof's properties, and writes it back atomically.
4. Update the `photos` index row.
5. Return `{ photo, views }`: the updated photo plus recounted view totals.

A sidecar that can't be parsed returns 409 `SIDECAR_UNREADABLE` and is never overwritten.

**XMP mapping** (`image/Xmp.kt`):
- `xmp:Rating` holds the stars, or `-1` when rejected (the de facto reject value).
- `xmp:Label` holds the colour label (Lightroom's field).
- `proof:Flag` holds the pick/reject flag and `proof:Rating` the stars, which survive a reject. The namespace is `urn:x-proof:xmp:1.0`.
- Properties are read in attribute or element form.
- Parsing is XXE-safe (no DTDs).
- Existing sidecars are written back un-reindented, with a hand-written XML declaration and exactly one trailing newline, so repeated writes are byte-stable.

**Filtered views.** `GET /api/projects/:id/photos?view=all|picks|unrated|rejects&minRating=0..5` filters in SQL. The `CullView` predicates are fixed and never built from input. Each response carries `views[]` with every view's count, so the UI never counts or filters.

**Frontend.**
- **Per-photo state:** each photo is its own `van.state`. A cull change re-renders that frame's badges and class only, and the static parts are read through `rawVal`, so `<img>` nodes are never re-created.
- **Keyboard (`src/cull.js`):** 0–5, P/X/U, 6–9 label toggle, arrows (up/down by the laid-out column count), Enter/Space opens the loupe, Esc closes it. Updates are optimistic, then replaced by the server's photo, and reverted on error.
- **Filter state:** the filter lives in the URL (`?project=&view=&minRating=`).
- **Loupe:** a full-screen 2048 px preview on a neutral surround, with the neighbouring previews preloaded.

**Earlier phases, unchanged:**
- auth (Phase 4): shelf-style accounts and `proof_session` cookies;
- router, static files, and path safety (Phase 3);
- build scripts and jar fetching (Phase 2);
- the mini-gl seed (not loaded until Phase 8).

**Backend tests: 102**, none needing Postgres. **Pipeline tests: 48**, in `frontend/test/pipeline.html`. Backend tests added through Phase 7:
- EXIF in both byte orders, with truncation, random garbage, and a self-referencing IFD;
- all 8 orientations, checked against an independent reference;
- type sniffing;
- renditions (upright, sized, never upscaled);
- name validation, and the rename regression;
- the upload receiver (cap, cleanup, hash);
- display strings;
- XMP read/write: the darktable merge, element-form properties, XXE and broken files refused, and byte-stable rewrites.

Not yet present: reconciliation (Phase 6, deferred), export (Phase 12, skipped for now),
export (Phase 12), `docker/` and `docs/deployment.md` (Phase 13).
