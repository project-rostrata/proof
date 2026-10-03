# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: backend skeleton (V1_PLAN.md Phase 3)

```
Browser ──HTTP──> HttpServer (JDK, bounded pool of 8 daemon handler threads)
                     └─ Router
                          ├─ GET /api/health      -> {"status":"ok"}
                          ├─ any other /api/*     -> 404 JSON error envelope
                          └─ other GET paths      -> StaticFileHandler(frontend/) via resolveUnderRoot
```

- **`backend/src/Main.kt`**: the composition root. It reads `PROOF_PORT` (default 8080) and
  `PROOF_FRONTEND_DIR` (required; `run.sh` defaults it to `../frontend`), builds the router, and
  starts the server. A shutdown hook stops it on SIGTERM. `buildRouter()` and `createServer()` are
  separate functions so the HTTP tests run exactly the router `main()` builds.
- **`backend/src/api/`**: `Router.kt`, `ApiResult.kt` (the `Ok`/`Err` result plus the
  `{"error":{"code","message"}}` envelope), `HealthHandler.kt`, and `StaticFileHandler.kt`
  (Content-Type by extension; JS modules are served as `text/javascript`). All are copied from
  shelf with the package renamed.
- **`backend/src/fs/PathSafety.kt`**: shelf's path-safety algorithm, renamed from
  `resolveUserPath` to `resolveUnderRoot` because proof resolves against several kinds of root.
  It catches lexical `..` traversal, and symlink escapes via a `toRealPath()` check on the deepest
  existing ancestor.
- **Tests (`backend/test/`, 20 passing)**:
  - router matching and query parsing (from shelf);
  - path safety, including the symlink escape (from shelf);
  - the static handler (index, JS MIME type, 404, traversal 403);
  - an end-to-end HTTP test on an ephemeral port (health, an unknown `/api` route, the frontend
    root).
- **Backend scaffolding, unchanged since Phase 2**: `build.sh`, `run.sh`, and `test.sh` with
  bare `kotlinc`; jars fetched and sha1-verified by `lib/fetch-deps.sh`; an empty
  `db/migrations/`.
- **Frontend, unchanged since Phase 2**:
  - the shell (`index.html`, `app.js`, `style.css`, `favicon.svg`);
  - VanJS 1.6.1;
  - the verbatim mini-gl seed in `src/pipeline/minigl/`, with its notices in
    `src/pipeline/LICENSES.md`. Nothing loads the seed until Phase 8.

Not yet present: the database and auth (Phase 4), `docker/` (Phase 13),
`frontend/test/pipeline.html` (Phase 8), and `docs/deployment.md` (Phase 13).
