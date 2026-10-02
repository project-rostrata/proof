# AGENTS.md — conventions for anyone (human or AI) writing code in this repo

This file covers coding conventions and patterns, the "how" of writing proof's code. The other planning docs each have their own job:
- `PROJECT_BRIEF.md` is the "what": the target design and non-negotiable constraints.
- `V1_PLAN.md` is the "in what order".
- `docs/decisions.md` is the append-only log of *why* each convention below was chosen over the alternatives. Read it if you want the reasoning, not just the rule.

If anything here ever conflicts with the brief, the brief wins. Flag the conflict rather than silently picking one.

The backend conventions are `shelf`'s, carried over unchanged. Most of the new material is about the frontend's WebGL pipeline, the one place proof's frontend holds real logic.

## Language & style (Kotlin)

- `val` over `var`. Use `var` only when there's a real, local reason (a loop accumulator, for example), never as a default.
- Non-null types by default. Avoid `!!`. If you're reaching for it, either the type shouldn't be nullable or the code needs an explicit null check with a real error path.
- `data class` for every value object, DB rows and API DTOs alike.
- Classes stay small and single-purpose. If describing a class's responsibility needs the word "and", split it.
- Minimal public surface: `private` by default, widened only for what callers actually need.
- File I/O goes through `java.nio.file.Path` and `java.nio.file.Files` (NIO.2) exclusively, never legacy `java.io.File`. The path-safety layer depends on `Path.toRealPath()` and friends.

## Layering: database objects vs. API objects

Database-row classes and API request/response classes are separate `data class` hierarchies and are never shared. Convert between them with small, explicit mapper functions (for example `fun PhotoRow.toApiPhoto(): ApiPhoto`).

## Dependency injection

**No DI framework.** Wire the object graph by hand, once, in a single composition root (`Main.kt`, or a small `Wiring.kt` it calls into). A service that conceptually exists once per process is *one instance, constructed in the composition root and passed via constructor*, not a Kotlin `object`. Reserve `object` for genuinely stateless helpers and constants.

## Error handling

Handlers signal expected outcomes with a sealed result type, not exceptions:

```kotlin
sealed class ApiResult<out T>
data class Ok<T>(val value: T) : ApiResult<T>()
data class Err(val status: Int, val code: String, val message: String) : ApiResult<Nothing>()
```

Thrown exceptions are for genuinely unexpected errors, caught once at the top of the router and turned into a 500. Every error response has the same shape, `{"error": {"code": "...", "message": "..."}}`. Status codes follow `shelf`'s table:

| Status | Meaning |
|---|---|
| 400 | Malformed or invalid input (including an unsupported image type, or a recipe that isn't valid JSON) |
| 401 | Missing or invalid session |
| 403 | Path-safety violation, or acting outside the user's permissions |
| 404 | Not found |
| 409 | A write based on a stale version (for example, saving an edit over a render that changed since it was loaded) |
| 413 | Upload exceeds the configured size cap |
| 500 | Unexpected error |

## The API is the source of truth; the UI stays dumb (except for pixels)

This is the human's standing direction from `larder`: filtering, formatting, and derived values belong in the API, not the frontend.
- **Filtering and sorting happen in queries.** The "picks", "rejects", "unrated", and "≥N stars" views are query parameters on the API, and the frontend never filters a photo list itself.
- **Display strings come from the API.** That includes capture dates, the exposure line ("23mm · f/2 · 1/250s · ISO 400"), file sizes, and counts ("38 of 212 rated"). Raw values stay in responses only where the UI needs them, for example the current rating to highlight a star.
- **Derived values are computed by the API**, for example a photo's oriented dimensions.

**The one sanctioned exception is the pixel pipeline** (`PROJECT_BRIEF.md` §4). The browser renders edits, and that code really is logic. Keep the exception narrow:
- Pipeline code lives in `frontend/src/pipeline/` and nowhere else.
- It never reaches into project, rating, or list state.
- If you're writing a formatter, filter, or calculation in `frontend/` *outside* `src/pipeline/`, put it in the API response instead.

## Frontend pipeline conventions (`frontend/src/pipeline/`)

- **WebGL2 and GLSL: a narrow mini-gl fork for the plumbing, darktable for the filters, and no other graphics or image library** (brief §2).
- **Provenance headers are mandatory.** Every file derived from someone else's code starts with a header naming:
  - the upstream project, file, and pinned commit;
  - its copyright holders and licence;
  - what proof changed.

  Files from mini-gl keep the MIT notices of both xdadda (2025) and Evan Wallace (glfx.js, 2011). Files ported from darktable carry "Copyright (C) <years> darktable developers", GPL-3.0-or-later. Every third-party source is listed in `src/pipeline/LICENSES.md`.
- **Only copy from licence-clean sources:** MIT/BSD/Apache, or GPL-3.0-compatible (darktable). Never copy from Shadertoy (CC BY-NC-SA by default), Stack Overflow answers from before May 2018 (CC BY-SA 3.0), or any proprietary editor, even when another project cites it. When the provenance of a snippet is unclear, write it from the algorithm's description instead.
- **Porting from darktable.** darktable's OpenCL kernels (`data/kernels/*.cl`) translate most directly into GLSL fragment shaders. Work by kernel type:
  - Per-pixel kernels map one-to-one.
  - Pyramids and blurs become several passes.
  - darktable's pipeline is scene-referred linear with a Rec.2020 working space, while proof's is linear sRGB/Rec.709 from JPEG input. Any colour-space matrix or primaries-dependent constant has to be converted, not copied.
  - Snapseed sets the UX (which sliders exist, and their −100…+100 ranges). darktable sets the math.

Each tool is a small file in `src/pipeline/ops/` that exports:
  - a stable tool `id` (it's written into recipes, so never rename it);
  - its parameter schema, with a default (identity) value for each parameter;
  - its GLSL fragment source (or, for geometry tools, its UV transform);
  - a function that binds the tool's uniforms from a params object.
- **An op is a pure function of (input texture, params) → output texture.** No hidden state, no reading the DOM, no reaching into other ops. The stack runner owns the GL context and framebuffers and alternates passes between the two framebuffers. Ops never allocate GL resources themselves. A multi-pass op, such as local contrast or shadows/highlights with a blurred mask, declares its internal passes and asks the runner for scratch textures, including reduced-resolution ones.
- **Spatial parameters are resolution-independent.** Blur radii and similar values are expressed relative to the image's long edge, so editing on the preview-sized source gives the same look as the full-resolution render on save.
- **Default parameters must be an exact identity.** A tool added at its defaults must not change any pixel beyond float rounding. `frontend/test/pipeline.html` asserts this for every op.
- **The preview path and the export path run the same ops.** The only difference is the render target size. Never add a "preview-only approximation" of a tool, because what you see must be what gets saved.
- **The recipe schema is versioned, and only the frontend reads it.** A recipe is `{"version": N, "stack": [{"tool": "<id>", "params": {...}}, ...]}`. When a change would alter an existing recipe's meaning (a parameter rename, or a change of scale), bump `version` and add a migration in `src/pipeline/recipe.js` that upgrades older recipes on load. A saved recipe must always reopen to the same look. GPUs aren't bit-identical, so the guarantee is "within the tested tolerance". The Phase 1 spike measured a 1-level difference between a desktop and a phone. The stored render stays the truth.
- **Colour:** inputs are sRGB. Decide per op whether it works in sRGB or linear light, and say so in a comment at the top of the op. Intermediates are half-float (RGBA16F), and `EXT_color_buffer_float` is required. Every v1 target browser had it in the Phase 1 spike. Without it, the editor shows an "unsupported browser" message rather than falling back to 8-bit. Float storage doesn't clamp, so every op must be NaN- and range-safe: guard any division by luminance, and clamp wherever a later op assumes 0…1.

## Images on the server

- **JDK only:** `javax.imageio` for decoding and encoding, and `java.awt.Graphics2D` for scaling. Downscale in multiple steps (halving with bilinear until within 2× of the target, then a final bicubic step) so thumbnails don't alias.
- **Detect file types by magic bytes**, never by extension or client-supplied `Content-Type`.
- **Never modify an original.** Ratings go to the XMP sidecar, edits go to `edits/`, and cache files go to `.cache/`.
- **Writes are atomic:** write to a temp file in the same directory, then `Files.move(..., ATOMIC_MOVE)`.
- **Apply orientation everywhere the server produces pixels** (thumbnails, previews), and report oriented dimensions in the API.
- **The recipe is opaque.** The server parses it only to check that it's valid JSON and reads its `version` for the index. Never add server-side logic that depends on the contents of `stack`.

## Security rules

- **Filenames reaching the filesystem.** Project names and uploaded filenames become paths, so they go through the path-safety module reused from `shelf` (canonicalize, verify the path is under the user's root, reject anything that isn't). Never pass a client-supplied name directly to `Path.resolve`.
- **Running external tools** (if v1.5 adds the HEIC/RAW decoders) uses `ProcessBuilder`'s array-args form only, as in `press`. A client-controlled string must never reach a shell.

## Concurrency

Handlers are plain blocking code, run on a bounded thread-pool `Executor`. Thumbnail and preview generation is CPU- and memory-heavy, because a decoded 24 MP image is about 100 MB. Run it on its own small, bounded executor so a big batch upload can't starve request handling or exhaust the heap. The reconciliation backstop scan uses a plain `ScheduledExecutorService`. No coroutines by default (`kotlinx.coroutines` is pre-approved if a genuine need shows up).

## Logging

`java.util.logging`. No SLF4J/Logback.

## Configuration

Environment variables only, `PROOF_`-prefixed (`PROOF_DATA`, `PROOF_PORT`, `PROOF_DB_URL`, `PROOF_MAX_UPLOAD_BYTES`, ...), read at startup with sane defaults.

## Testing

- **Backend:** no test framework dependency. Tests are plain top-level `test<Something>()` functions under `backend/test/`, discovered by a hand-rolled `TestMain.kt` and asserted with `kotlin.test.*` from the `kotlinc` distribution. `backend/test.sh` compiles and runs them, as in `shelf`. The EXIF reader, the EXIF splice, and XMP read/write get real-camera fixture files, small and committed as test data, covering all 8 EXIF orientations.
- **Frontend pipeline:** `frontend/test/pipeline.html` is a zero-dependency test page. It renders small synthetic inputs through each op, asserts golden pixel values within a tolerance, and asserts identity at defaults. Open it in a browser and read the result. CI may run it under apt-installed headless Chromium, but never through npm.

## Dependency policy

Pre-approved: the Postgres JDBC driver, any `kotlinx.*` library, and `kotlin-test`. Anything else needs the human's explicit sign-off before it's added, on **either** side of the wire. That includes a JS library, a WebGL helper, an image or metadata library, a test framework, or an apt package added to the image. When a jar is approved, add it to `backend/lib/DEPENDENCIES.sha1` (filename, sha1, source URL) and let `backend/lib/fetch-deps.sh` fetch it. Never commit the `.jar`. Vendored frontend JS (VanJS) is pinned to an exact version in its filename.
