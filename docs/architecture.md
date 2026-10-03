# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: cull (V1_PLAN.md Phase 7)

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

**Tests: 90**, none needing Postgres. Added through Phase 7:
- EXIF in both byte orders, with truncation, random garbage, and a self-referencing IFD;
- all 8 orientations, checked against an independent reference;
- type sniffing;
- renditions (upright, sized, never upscaled);
- name validation, and the rename regression;
- the upload receiver (cap, cleanup, hash);
- display strings;
- XMP read/write: the darktable merge, element-form properties, XXE and broken files refused, and byte-stable rewrites.

Not yet present: reconciliation (Phase 6, deferred), the edit pipeline (Phases 8-11),
export (Phase 12), `docker/` and `docs/deployment.md` (Phase 13).
