# Session handoff

This file is *state*, not documentation: where things stand now, for whoever picks the project up next. Rewrite it each session; don't append to it. The history of how it got here is in `../V1_PLAN.md` (phase by phase) and `decisions.md` (why).

## Where things stand (2026-10-18)

**v1.0.0 is released:** the annotated tag `v1.0.0` on `main`. Every phase in `V1_PLAN.md` is done, including reconciliation (Phase 6) and export (Phase 12). Since the plan's phases, the project gained:
- the home-server security audit;
- Snapseed's one-thumb editing on phones;
- the four workflow steps: Upload · Cull · Edit · Export.

`decisions.md` covers each.

Checked for the release:
- **Backend:** 119 tests pass (`backend/test.sh`), and in Docker (`docker build -f docker/Dockerfile --target backend-test .`).
- **Pipeline:** 45 tests pass in headless Chrome (`frontend/test/run-headless.sh`).
- **Images:** the `runtime` and `standalone` images build. The standalone image was smoke-tested from scratch: health, register, upload, cull, steps, a ZIP export, thumbnails, and a restart with the data intact, with files owned by the host user.

**CI** (`.github/workflows/docker-build.yml`) has never run on GitHub, because there's no remote yet. Pushing `main` and the `v1.0.0` tag will build and publish the standalone image to GHCR as `:v1.0.0`.

## For the human

- Create a GitHub repo and push `main` with its tags (`git push -u origin main --follow-tags`), as with the siblings, so CI runs for real.
- Try the whole flow on a real phone with real photos. The cull pass and the edit pass have only been run in emulation.
- Still open: purging rejects (`PROJECT_BRIEF.md` §5), and whether the Cull step should be called "Pick" (asked 2026-10-04, not decided).

## Known limitations

Listed in `decisions.md` (the Phase 14 entry):
- banding when shadows are lifted hard on 8-bit sources;
- Perspective has keystone sliders, not free corners;
- no tiled rendering for photos larger than the GPU's maximum texture size.

Edits saved before 2026-10-04 (the tool merge) don't reopen in the editor. Their saved JPEGs still show and export.

## Working on it

- **Running locally:** see `../CONTRIBUTING.md` for the Postgres one-liner and `backend/run.sh`, and `deployment.md` for Docker.
- **Headless checks:** these sessions drove the real UI through Chrome's DevTools protocol, using `chrome-headless-shell` from Chrome for Testing and Node's built-in WebSocket. That's a dev-machine tool only, and nothing in the repo depends on it. `frontend/test/run-headless.sh` needs only `python3` and a Chrome or Chromium.
