# Session handoff

This file is *state*, not documentation: where things stand now, for whoever picks the project up next. Rewrite it each session; don't append to it. The history of how it got here is in `../V1_PLAN.md` (phase by phase) and `decisions.md` (why).

## Where things stand (2026-10-03)

v1 is built, except export (Phase 12, skipped at the human's request). That includes reconciliation (Phase 6), which was deferred and then built after Phase 14. A full audit followed, for security on a home server and for maintainability. See the last entries in `decisions.md`.

- **Backend:** 114 tests pass (`backend/test.sh`), and in Docker (`docker build -f docker/Dockerfile --target backend-test .`).
- **Pipeline:** 48 tests pass in headless Chrome (`frontend/test/run-headless.sh`).
- **CI** (`.github/workflows/docker-build.yml`) has never run on GitHub, because there's no remote yet.

Everything has been checked in headless Chrome (software GPU, synthetic photos) and against real Postgres. The human has used it on their own desktop, and their feedback shaped the work after Phase 14: the loupe culling controls, swiping, Snapseed-style adjusting, the theme switch, and the eel-green accent.

## For the human

- Try the whole flow on a real desktop and phone with real photos, especially swiping in the loupe and adjusting on the photo in the editor.
- Create a GitHub repo and push, as with the siblings, so CI runs for real.
- Decide on the open items: export (Phase 12), and purging rejects (`PROJECT_BRIEF.md` §5).
- Consider porting the audit's security fixes to `shelf` and `larder`, which have the same gaps (`decisions.md`, the audit entry).

## Known limitations

Listed in `decisions.md` (the Phase 14 entry):
- banding when shadows are lifted hard on 8-bit sources;
- Perspective has keystone sliders, not free corners;
- no tiled rendering for photos larger than the GPU's maximum texture size.

## Working on it

- **Running locally:** see `../CONTRIBUTING.md` for the Postgres one-liner and `backend/run.sh`, and `deployment.md` for Docker.
- **Headless checks:** these sessions drove the real UI through Chrome's DevTools protocol, using `chrome-headless-shell` from Chrome for Testing and Node's built-in WebSocket. That's a dev-machine tool only, and nothing in the repo depends on it. `frontend/test/run-headless.sh` needs only `python3` and a Chrome or Chromium.
