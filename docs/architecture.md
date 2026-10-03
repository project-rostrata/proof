# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: scaffold (V1_PLAN.md Phase 2)

Nothing serves requests yet. What exists:

- **`backend/`**: builds with bare `kotlinc` and contains no application logic yet.
  - `build.sh`, `run.sh`, and `test.sh` are each the single source of truth for their command.
  - `lib/fetch-deps.sh` downloads the three pre-approved jars (Postgres JDBC 42.7.13,
    kotlinx-serialization core/json 1.11.0) and verifies them against `lib/DEPENDENCIES.sha1`. The
    jars themselves are gitignored.
  - `src/Main.kt` is the composition root, currently a placeholder.
  - `test/TestMain.kt` is the hand-rolled test runner. It has no tests yet.
- **`db/migrations/`**: empty until Phase 4.
- **`frontend/`**:
  - `index.html`, `app.js` (a placeholder view), and `style.css`, which holds the neutral-grey
    theme tokens and the safelight-amber accent.
  - `favicon.svg`.
  - VanJS 1.6.1 in `lib/`, byte-identical to upstream and to the sibling projects' copies.
  - **`src/pipeline/minigl/`**: the narrow mini-gl fork's seed. Four files are copied verbatim from
    upstream commit `28238857`, apart from a provenance header: the GL core and runner, the cubic
    spline, the perspective warp, and the matrix transform. Nothing loads them yet. The core still
    imports mini-gl's `minigl_filters.js`, which was deliberately not carried over. Phase 8
    restructures them into `gl.js` and `runner.js` with half-float intermediates. Keeping the first
    commit verbatim means proof's changes to them show up as reviewable diffs.
  - **`src/pipeline/LICENSES.md`**: third-party notices for the pipeline. Both MIT texts are in
    full (mini-gl and glfx.js), and there's a darktable section ready for the first ports.

Not yet present: `docker/` (Phase 13), `frontend/test/pipeline.html` (Phase 8), `docs/deployment.md`
(Phase 13).
