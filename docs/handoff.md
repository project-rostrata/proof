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
- **target browsers and devices** (this one blocks the Phase 1 spike);
- XMP sidecar naming;
- the max upload size;
- export options;
- purging rejects;
- sign-off on the v1 edit tool list.

## Next step

Get the target device list from the human, then run `V1_PLAN.md` Phase 1, the throwaway WebGL2 spike, and record its numbers in `decisions.md` before scaffolding any code.
