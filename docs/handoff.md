# Session handoff

This file is *state*, not documentation. For durable decisions, read `decisions.md`. It gets rewritten each session to reflect where things stand, rather than appended to indefinitely.

## Where things stand

As of 2026-10-02 there are planning docs only, and no code exists yet. The initial planning conversation settled:
- the name (**proof**);
- rendering in the browser with WebGL2;
- storing the render plus an opaque recipe;
- files as truth with a Postgres index;
- JPEG and PNG only for v1.

All of these are recorded in `PROJECT_BRIEF.md` §4 and `decisions.md`.

## What's still open

`PROJECT_BRIEF.md` §5 lists the open questions:
- **auth** (the recommendation is `shelf`-style accounts);
- XMP sidecar naming;
- the max upload size;
- export options;
- purging rejects;
- sign-off on the v1 edit tool list.

## Phase 1 spike status (2026-10-02)

- mini-gl was approved as the base for the edit pipeline. The spike is built in `spike/` and tests two variants: upstream as-is (vendored at `28238857`) and a minimal half-float fork.
- Correctness was verified headless (Chrome 154 on SwiftShader, run from the dev VM over CDP, with no npm involved). See `decisions.md` and `spike/README.md`. The short version: orientation, the Exif splice, and colour all pass. mini-gl's *tonal* filters (contrast, brightness, curves, highlights/shadows) have real quality defects. Half-float helps banding modestly but exposes a NaN bug in Highlights/Shadows.
- The human ran it on Firefox 156 on a Linux desktop with a real 16 MP JPEG. Correctness repeated exactly. Preview frames took 8 ms (8-bit) and 13 ms (half-float), and a full-resolution save about 630 ms. The human said it felt "pretty good", with the sliders a bit too sensitive. All recorded in `decisions.md`.
- Phone run (Firefox 157 on Android, Pixel 7a): also good, with a 13/20 ms preview and a 0.5 s save. GPU output isn't bit-identical across devices, so the pipeline tests need a tolerance.
- **Provenance audit done** (`decisions.md`). Several mini-gl filters cite Shadertoy (CC BY-NC-SA by default), a 2014 Stack Overflow answer (CC BY-SA 3.0), or Pintura (proprietary). Only the GL core, runner, spline, perspective, and matrix transform can be carried over. All pixel filters get written fresh.
- **Phase 1 closed (2026-10-02).** The human confirmed the narrow fork and said to take filters from darktable. Safari and iPad are out of scope for v1, and the targets are Firefox and Chromium on desktop and Android. The raw results JSON was not kept, because the numbers are in `decisions.md`.

## Phase 2 status (2026-10-02)

Scaffolding is done (see `architecture.md`). The backend builds, runs, and tests (0 tests) with bare `kotlinc` 2.4.20 on JDK 25. The jars are fetched and verified. The frontend shell renders (checked in headless Chrome). The mini-gl seed is committed verbatim, with license notices.

## Phase 3 status (2026-10-02)

The backend skeleton is done (see `architecture.md`). `run.sh` serves `/api/health` and the frontend. 20 tests pass, and the server was smoke-tested over real HTTP and in headless Chrome.

## Phase 4 status (2026-10-02)

Accounts are done. The human chose `shelf`-style auth. Register, login, logout, and me work against real Postgres 18.6 (smoke-tested), with 46 DB-free tests passing. The `projects`/`photos` tables moved to Phase 5. See `decisions.md` and `architecture.md`. To run locally, see the Postgres one-liner in `CONTRIBUTING.md`.

## Phase 5 status (2026-10-02)

Projects, upload, and ingest are done:
- **Backend:** EXIF, upright thumbnails and previews, and server-built display strings.
- **Frontend:** the first real UI, meaning sign-in, the project list, and the project page with its upload queue and contact sheet.

78 tests pass. It was smoke-tested end to end against Postgres 18.6 and in headless Chrome, including an upload through the real file picker. The smoke test caught a data-loss bug (renaming onto an empty project's name), which is now fixed with a regression test. See `decisions.md`.

Phase 6 (reconciliation) is **deferred** at the human's request. See `decisions.md` for what that means in practice.

## Phase 7 status (2026-10-02)

Culling is done:
- **Sidecars:** XMP sidecars are merged into, never overwritten, so darktable's edit history survives.
- **API:** a PATCH endpoint for rating, flag, and label, with view counts in the response, plus SQL-filtered views.
- **Keyboard and display:** a keyboard-driven contact sheet and a loupe.

90 tests pass, and the full keyboard flow was verified in headless Chrome against Postgres 18.6. The smoke test caught a sidecar-bloat bug, now fixed.

## Phase 8 status (2026-10-02)

The edit pipeline core is done:
- **Engine:** `gl.js` and `runner.js`, restructured from mini-gl with half-float intermediates.
- **Tools:** Tune Image, White Balance, Curves, and Details, ported from darktable at a pinned commit. The decisions log has the table of sources and divergences.
- **Recipes:** schema v1 with migrations.
- **Editor UI:** opens with E, or Edit in the loupe.

27 pipeline tests pass in headless Chrome. The editor was driven end to end against the real stack. **Edits aren't saved yet**: that's Phase 11.

**Not yet seen on a real GPU or a real photo.** The headless runs use SwiftShader and synthetic images. The human should try the editor on their desktop and phone with real photos, checking feel, slider response, and whether a lifted sky bands (decisions log, known limitation).

## Next step

Phase 9, the geometry tools (Crop, Rotate/Straighten, Perspective). These rework the two remaining verbatim mini-gl files (`minigl/filters/filterPerspective.js`, `filterMatrix.js`) into ops, and add interactive overlays to the editor.
