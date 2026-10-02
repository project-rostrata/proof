# proof — self-hosted browser photo editor — project brief

This is a handoff document from a planning conversation, written the same way `shelf`'s, `larder`'s, and `press`'s were. It records the decisions already made, why they were made, and what's still open. Treat section 2 as hard constraints. Treat section 4 as decisions not to relitigate without flagging it to the human first. Treat section 5 as things to check with the human before building. Everything else is a reasonable default that can be refined.

## 1. What this is

A self-hosted web app for working through a batch of photos from start to finish, in three stages:

1. **Ingest.** Start a new project by batch-uploading a set of photos.
2. **Cull.** Go through the set quickly and keyboard-first. Rate each photo 0–5 stars and flag it as pick or reject, the way you'd mark up a contact sheet.
3. **Edit.** Do a detailed edit on the keepers. The edit tools copy Google's Snapseed: a non-destructive *stack* of global adjustments and geometry tools, where any step can be revisited, changed, or removed later.

The name comes from the proof sheet (contact sheet), which is literally what culling is done on. It also pairs with `press`.

This is the fourth sibling project in this workspace, after `shelf` (a self-hosted file share), `larder` (a recipe/pantry manager), and `press` (upload-and-print). It follows their house style: a near-zero-dependency Kotlin backend, a VanJS frontend, and strict docs/phasing discipline. It has one headline divergence, stated up front: **the pixel pipeline runs in the browser** (section 4).

**proof is not a digital asset manager.** It doesn't try to be a long-term photo library with search, albums, face recognition, or a timeline. A project is one batch of photos taken through cull and edit. Long-term storage of the finished output is `shelf`'s job.

## 2. Non-negotiable constraints

- **Backend language: Kotlin**, written directly against the JDK standard library. No web framework: not Spring, not Ktor. Use `com.sun.net.httpserver.HttpServer` with a hand-rolled router, reused from `shelf`'s `Router.kt`. Use `java.sql`/JDBC for Postgres. Use `javax.crypto.SecretKeyFactory` (`PBKDF2WithHmacSHA256`) for password hashing, if auth is confirmed (section 5).
  - Pre-approved without asking: the Postgres JDBC driver, any `kotlinx.*` library (for example `kotlinx.serialization` for JSON), and `kotlin-test`. Any other dependency needs the human's approval first. Ask before adding it, don't just add it.
- **No Gradle or Maven.** Compile directly with `kotlinc`, using hand-written `build.sh`/`run.sh`/`test.sh`. No hidden build-tool magic.
- **Dependency jars are fetched, never committed.** Use a git-tracked `backend/lib/DEPENDENCIES.sha1` manifest plus `backend/lib/fetch-deps.sh`, the same as `shelf`.
- **Frontend: VanJS and plain ES modules.** No bundler, no npm dependency tree, no build step.
- **The edit pipeline is hand-written WebGL2 and GLSL in the browser.** No graphics or image-processing library: not glfx.js, PixiJS, three.js, or a WASM image library. Each edit tool is a small, readable shader. See section 4.
- **No image library on the server.** Decoding, thumbnailing, and encoding use the JDK's `javax.imageio` and `java.awt` (`Graphics2D`). The EXIF and XMP handling is hand-written: a small TIFF/EXIF reader, and `javax.xml` for XMP.
- **v1 input formats: JPEG and PNG only.** Both are what ImageIO decodes natively. HEIC and camera RAW are deferred (section 6).
- **Storage: the filesystem is the source of truth, and Postgres is an index over it**, the same model as `shelf`. Originals, renders, recipes, and rating sidecars are real files in normal, readable formats. Postgres caches their state for fast querying and can be rebuilt from disk.
- **Originals are never modified.** Every write goes to a sidecar or to the `edits/` folder.
- **Deployment: Docker.** One app image (the Kotlin backend plus the static frontend), plus a standalone variant that bundles Postgres, as `shelf` does. A bind-mounted data volume uses the `PUID`/`PGID` entrypoint pattern.
- **License: GPL-3.0-or-later**, the same as the siblings.

## 3. Architecture

```
Browser
  VanJS UI (upload queue, cull grid/loupe, edit panels — "dumb": renders what the API returns)
  WebGL2 pipeline (the one exception: renders edits, both live preview and full-res final)
      |                                     ^
      | upload originals                    | originals / previews / thumbs
      | PUT render (JPEG) + recipe (JSON)   | recipe JSON (opaque, handed back for re-edit)
      v                                     |
App server (Kotlin, JDK stdlib HTTP, REST/JSON API)
  - ingest: stream to disk, EXIF read, thumbnail + preview generation (ImageIO/Graphics2D)
  - ratings/flags: write XMP sidecars, update index
  - renders: splice original EXIF into the browser's JPEG, regenerate thumbnails
  - export: zip of picks (java.util.zip)
      |                         |
      v                         v
  Filesystem (truth)       Postgres (index — rebuildable)
  $PROOF_DATA/<user>/<project>/
    originals/IMG_0001.jpg            never modified
    originals/IMG_0001.jpg.xmp        rating / pick-reject / label
    edits/IMG_0001.jpg                latest browser render
    edits/IMG_0001.recipe.json        opaque, versioned edit stack
  $PROOF_DATA/.cache/                 thumbnails + previews — derived, deletable
```

## 4. Key design decisions already made (with rationale)

**Language and backend shape: the same as `shelf`.** This is not relitigated here. See `shelf`'s brief for the reasoning: data classes, sealed result types, JDK stdlib, and less boilerplate than Java without a framework dependency.

**Rendering happens entirely in the browser, with WebGL2.** This is the headline divergence from every sibling project. The browser renders both the live preview while sliders move and the final full-resolution output. When an edit is saved, the browser sends the rendered JPEG to the API. The server never runs an edit pipeline.
- *Why:* Snapseed-style editing only works if slider feedback is immediate, at display frame rate. Three options were weighed:
  - **Server-rendered previews.** One Kotlin pipeline, but a network round-trip and a JPEG encode on every slider movement.
  - **WebGL preview plus a Kotlin export.** Instant, but every tool gets written twice (GLSL and Kotlin) and the two silently drift apart.
  - **Browser-only rendering.** The human chose this. It gives one implementation of every tool, in the place where it has to be fast anyway.
- *How this squares with the server being the source of truth:* a photo that's being edited is **ephemeral** working state. Once the edit is saved, the server holds the truth, which is the rendered JPEG plus its recipe. That truth just happens to be generated by the browser. The server makes thumbnails and exports from the stored render, never by re-running edits.

**The server stores the render *and* the recipe, and treats the recipe as opaque.** Each saved edit is two files: `edits/<name>.jpg` (the rendered full-resolution JPEG) and `edits/<name>.recipe.json` (the ordered edit stack: tool ids and parameter values, with a schema version).
- The server validates that the recipe is well-formed JSON within a size cap, stores it, indexes its schema version, and hands it back unchanged when the browser reopens the photo. It never interprets it.
- Storing the recipe makes edits non-destructive and reopenable, like Snapseed's "View edits", so re-editing doesn't mean starting over from the original. The cost is a few KB per photo.
- Schema evolution is entirely the frontend's concern. The browser migrates an old recipe forward when it loads one.

**This is a recorded exception to the "API is the source of truth, UI stays dumb" rule.** That rule comes from `larder`: filtering, formatting, and derived values belong in the API, not frontend code. It still holds for everything in proof *except pixels*. The browser acts as a render worker, and the pixel pipeline is the one sanctioned piece of real logic in the frontend. Everything else stays server-side:
- filtering and sorting by rating or flag (the "picks", "3★ and up", and "rejects" views are API queries);
- counts and progress ("38 of 212 rated");
- display strings (capture date, "Fujifilm X-T5 · 23mm · f/2 · 1/250s", file sizes);
- project state.

The UI must not filter or format photo lists itself.

**Files are the truth and Postgres is the index: `shelf`'s model, not `larder`'s.** Photos are the clearest case in this workspace of content that has a natural file form, and that someone might reasonably want to reach outside the app. Examples: copying originals off over SMB, or opening the project folder in darktable, which reads the XMP ratings. So proof follows `shelf`, not `larder`: real files on disk, and Postgres as a rebuildable cache that keeps rating and flag queries fast across large projects.
- The cost is `shelf`'s reconciliation machinery (mtime scanning, a backstop scan, a path-safety layer). That is reused from `shelf` rather than redesigned.
- Pure files with no DB (`press`'s model) was considered and rejected. Cull views need fast filter, sort, and count queries over hundreds of photos per project, and scanning sidecars on every request doesn't scale to that.

**Ratings and flags live in XMP sidecars, the de facto standard.** Star rating (`xmp:Rating`, 0–5, with −1 meaning rejected, as in Lightroom and darktable), a pick flag, and an optional color label are written to a sidecar next to each original. This keeps cull work portable: another tool pointed at the project folder sees the same ratings. The exact sidecar naming convention is open (section 5).

**JPEG and PNG only in v1, with no new dependency.** `javax.imageio` reads and writes both natively. Two pieces are hand-written instead of pulling in a metadata library:
- **A small TIFF/EXIF reader**, a few hundred lines, for orientation, capture time, and camera/lens/exposure. **Orientation correctness is a hard requirement.** A sideways thumbnail in the cull grid is a correctness bug, not cosmetic.
- **An EXIF splice on save.** `canvas.toBlob()` strips all metadata from the browser's render. The server copies the original's APP1/EXIF segment into the stored render and resets the orientation tag to 1, since the render is already upright. This is a byte-level JPEG segment splice and needs no library.

HEIC (iPhone) and camera RAW are deferred to v1.5. Both need a decoder the JDK doesn't have. The expected route is `press`'s pattern: an apt-packaged CLI (`libheif`'s `heif-convert`, `libraw`'s `dcraw_emu`) called through array-args `ProcessBuilder` at ingest time to decode to a lossless intermediate. That would be a dependency proposal at the time, not a default.

**Batch upload uses single-shot `POST`s with a client-side queue, not `shelf`'s chunked/resumable upload.** Photos are 5–20 MB JPEGs, not multi-gigabyte files. A queue of about 3 concurrent per-file `POST`s, each streamed straight to disk (the `requestBody.copyTo` primitive from `shelf` and `press`), is enough, and progress is shown per file. This is the same reasoning as `press`'s single-shot decision.

**The thumbnail and preview cache is derived and deletable.** At ingest the server generates a grid thumbnail (about 400 px) and a loupe/cull preview (about 2048 px long edge), oriented upright, under `$PROOF_DATA/.cache/`. Losing the cache is never data loss. It gets regenerated on demand or by the reconciliation scan. It gets regenerated from the render when an edit is saved.

**Edit tools follow Snapseed's model: a non-destructive stack.** Every tool application is one entry in an ordered stack. Opening the stack lets you change any entry's parameters, or remove it, and everything above it re-renders. In the WebGL pipeline:
- each color/tone tool is one fragment-shader pass, alternating between two framebuffers;
- geometry tools (crop, rotate/straighten, perspective) are UV/vertex transforms;
- intermediates use half-float textures where `EXT_color_buffer_float` is available, so stacked adjustments don't band.

## 5. Open questions — resolved or still open

- **App name.** Decided: **proof**. Other candidates considered were easel ("too painterly"), mantel, tray, plate, and contact.
- **Rendering location.** Decided: in the browser (section 4).
- **Storage model.** Decided: files as truth, with a Postgres index (section 4).
- **Store the recipe as well as the render?** Decided: yes, store both (section 4).
- **v1 input formats.** Decided: JPEG and PNG only.
- **Auth.** Open. The recommendation is `shelf`-style accounts (username/password, PBKDF2, cookie sessions, a per-user data directory), because personal photos are private data in a way that `press`'s print jobs aren't. The alternative is `press`'s no-auth, trusted-LAN model.
- **Target browsers and devices.** Open. Desktop browsers only, or tablets (iPad Safari) too? This decides which devices the Phase 1 WebGL spike has to pass on (`MAX_TEXTURE_SIZE`, half-float support, memory for a 24 MP texture), and whether the edit UI needs touch-first controls like Snapseed's swipe-to-adjust.
- **XMP sidecar naming.** Open. `IMG_0001.jpg.xmp` (darktable-style) or `IMG_0001.xmp` (Lightroom-style; the two collide if `IMG_0001.jpg` and `IMG_0001.png` are both in a project). The proposal is darktable-style.
- **Max upload size per file.** Open. The proposed default is 100 MB, set by an env var.
- **Export options.** Open. The proposal is: download the picks (rendered if edited, original otherwise) as a ZIP. JPEG quality is fixed at the browser's encode setting (about 0.92). No resize-on-export in v1.
- **Purging rejects.** Open. Can rejected originals be deleted from disk from inside the app, or does proof never delete an original? The proposal is an explicit, confirmed per-project "delete rejects" action, with hard deletion as in `shelf` v1.
- **v1 edit tool list.** Open, needs sign-off. The proposal is in section 6.

## 6. Suggested scope phasing

**v1 (MVP)**
- Projects: create, list, rename, delete.
- Batch upload of JPEG/PNG, with progress per file.
- Cull:
  - a keyboard-driven grid and a full-screen loupe;
  - keys `0`–`5` set stars, `P`/`X` pick or reject, `U` unflags, arrow keys navigate;
  - views filtered by the API (all, picks, ≥N stars, rejects, unrated).
- Edit, as a Snapseed subset on a non-destructive stack:
  - **Tune Image:** brightness, contrast, saturation, ambiance, highlights, shadows, warmth.
  - **White Balance:** temperature and tint.
  - **Curves:** RGB and per-channel.
  - **Details:** structure and sharpening.
  - **Crop** (free and fixed aspect ratios), **Rotate/Straighten**, and **Perspective**.
  - **Vignette.**
  - **Black & White:** color-filter presets, plus brightness/contrast/grain.
  - A stack view where any entry can be edited or removed, and a before/after toggle.
- Save: the render and recipe go to the server, with EXIF spliced back in and thumbnails regenerated.
- Export: the picks downloaded as a ZIP.

**v1.5**
- HEIC and camera RAW ingest, using CLI decoders via `ProcessBuilder` (a dependency proposal at the time).
- Local adjustments: **Selective** (control points), **Brush** (masked dodge/burn, exposure, saturation, temperature), and **Healing**.
- The heavier Snapseed looks: HDR Scape, Drama, Tonal Contrast, Glamour Glow, Grainy Film, Vintage, Retrolux, Grunge, Noir, Lens Blur, and Expand.
- Side-by-side compare of 2–4 photos during the cull.
- Copying or pasting a recipe across several photos.

**v2 / stretch**
- Tiled full-resolution rendering, if photos bigger than `MAX_TEXTURE_SIZE` turn out to matter.
- "Send to `shelf`" as an export target.

**Out of scope entirely**
- Snapseed's ML-driven face tools (Portrait, Head Pose, Face Enhance).
- Text, Frames, and Double Exposure.
- Library or DAM features: search, albums, timeline, and face recognition.

## 7. Data model (sketch)

Postgres is an index. Every column here can be rebuilt from the filesystem.

- `users` and `sessions`: as in `shelf`, if auth is confirmed.
- `projects`: `id`, `owner_id`, `name` (also the directory name, validated by path safety), `created_at`, `updated_at`.
- `photos`:
  - identity and file state: `id`, `project_id`, `filename`, `size_bytes`, `mtime`, `content_sha256`;
  - from EXIF: `width`, `height` (both oriented), `orientation`, `capture_time`, `camera`, `lens`, `exposure` (raw EXIF values, with display strings formatted at the API layer);
  - from the XMP sidecar: `rating` (0–5), `flag` (`none`/`pick`/`reject`), `label`;
  - edit state: `has_edit`, `edit_mtime`, `recipe_version`.

The recipe body is **not** stored in Postgres. It lives only in its `.recipe.json` file and is read from disk when requested.

## 8. Docker notes

- One app image built from a pinned `eclipse-temurin` JDK/JRE, with the same pinning approach as `larder/docker/Dockerfile`: exact patch versions, and `kotlinc` fetched with a pinned sha256. A standalone variant bundles Postgres 18.6, as `shelf` does.
- `/data` is bind-mounted, and `docker/entrypoint.sh` handles `PUID`/`PGID` (best-effort `chown`, as in `shelf`).
- No extra native packages in v1, because ImageIO covers JPEG and PNG. HEIC/RAW decoders would be the first apt additions, in v1.5.

## 9. Notes for the agent picking this up

- Sections 2 and 4 are settled. Don't silently deviate from them. In particular:
  - don't add a server-side render path "for consistency";
  - don't pull in a WebGL or image library;
  - don't start interpreting the recipe on the server;
  - don't let the UI start filtering or formatting photo lists.
- The open items in section 5 need a human decision before they're built. Surface the question rather than guessing.
- **Phase 1 of `V1_PLAN.md` is a WebGL2 spike, done before any repo code.** The browser pipeline is the one genuinely novel risk here, the way the printer driver was for `press`. Everything else is upload/CRUD/index work already proven in `shelf`.
