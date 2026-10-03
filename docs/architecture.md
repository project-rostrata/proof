# Architecture — what's actually built

A living doc: it describes the system as it exists right now, not the target design
(`PROJECT_BRIEF.md` has that). Update it whenever a phase lands.

## Current state: database and accounts (V1_PLAN.md Phase 4)

```
Browser ──HTTP──> HttpServer (JDK, bounded pool of 8 daemon handler threads)
                     └─ Router
                          ├─ GET  /api/health
                          ├─ POST /api/register   -> users row + $PROOF_DATA/<username>/ + session cookie
                          ├─ POST /api/login      -> session cookie (proof_session, HttpOnly, SameSite=Lax)
                          ├─ POST /api/logout     -> deletes the session, clears the cookie
                          ├─ GET  /api/me         -> requireAuth(...)
                          ├─ any other /api/*     -> 404 JSON error envelope
                          └─ other GET paths      -> StaticFileHandler(frontend/) via resolveUnderRoot
                                    │
                        ConnectionPool (fixed size, PROOF_DB_POOL_SIZE) -> Postgres 18.6
```

- **`backend/src/Main.kt`**: the composition root.
  - It reads `PROOF_PORT`, `PROOF_FRONTEND_DIR`, `PROOF_DATA`, `PROOF_MIGRATIONS_DIR`, `PROOF_DB_URL`,
    `PROOF_DB_USER`, `PROOF_DB_PASSWORD`, `PROOF_DB_POOL_SIZE`, `PROOF_SESSION_DURATION_HOURS`
    (default 720), and `PROOF_SECURE_COOKIES`.
  - On startup it creates the data root, runs pending migrations, and builds the router.
  - `buildRouter()` takes its services as arguments, so the HTTP tests run the real router against a
    fake database that fails on any access.
- **`backend/src/db/`**: copied from shelf. `ConnectionPool` (an `ArrayBlockingQueue` of
  connections), `Database` (PreparedStatement helpers only), `MigrationRunner` (numbered `.sql` files,
  each applied once in a transaction and recorded in `schema_migrations`), and the
  `UserRepository`/`SessionRepository` row classes.
- **`backend/src/auth/`**: `PasswordHasher` (PBKDF2-HMAC-SHA256 with 600k iterations; the format
  carries the iteration count) and `AuthConfig`. Copied from shelf.
- **`backend/src/api/`**: the register, login, logout, and me handlers, cookie helpers, and
  `requireAuth`/`requireAuthStream`. These are shelf's, minus device tokens. Login returns the same
  401 for an unknown user and a wrong password.
- **`backend/src/fs/`**: `PathSafety.kt` (`resolveUnderRoot`) and `UserRoot.kt`. A user's directory
  is `$PROOF_DATA/<username>/`. Usernames are shelf's safe-segment rule plus **no leading dot**,
  because leading-dot names under `$PROOF_DATA` are reserved for proof's own state (`.cache/`).
- **`db/migrations/0001_users_and_sessions.sql`**: `users` (id, username, password_hash, created_at)
  and `sessions`.
- **Tests: 46, none needing Postgres.** They cover the router, path safety, the static handler, HTTP
  end-to-end (health, 404, frontend, 401 on `/api/me`, register validation), migration discovery,
  password hashing, cookies, the connection pool, and username validation. The DB-backed flow was
  smoke-tested by hand against `postgres:18.6-alpine` (see the decisions log for the checklist).
- **Frontend: unchanged since Phase 2.** It's still the scaffold, and nothing uses the auth API yet.
  The login view comes with the first real UI in Phase 5.

Not yet present: projects, photos, and ingest (Phase 5), `docker/` (Phase 13),
`frontend/test/pipeline.html` (Phase 8), and `docs/deployment.md` (Phase 13).
