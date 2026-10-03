# Contributing to proof

## Before you write any code

Read [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) for the non-negotiable constraints: no framework, no
Gradle or Maven, no image or WebGL library, and near-zero dependencies. Then read
[`AGENTS.md`](AGENTS.md) for the coding conventions. The single most important rule for getting
a contribution to land cleanly:

**Don't add a dependency without asking first, on either side of the wire.** The Postgres JDBC
driver, any `kotlinx.*` library, and `kotlin-test` are pre-approved. Anything else, such as a
JVM library, a JS library, a WebGL helper, a build tool, or an apt package in the image, needs
to be raised in an issue or PR description before the code that needs it. A reviewer shouldn't
be the one to discover it in the diff.

## Building and testing locally

```
cd backend
./lib/fetch-deps.sh   # downloads and checksum-verifies dependency jars (never committed)
./build.sh            # compiles src/ with bare kotlinc
./test.sh             # compiles src/ + test/ and runs the hand-written test runner
```

To run the app, start a throwaway Postgres, point the backend at it, and open
http://localhost:8080:

```
docker run -d --rm --name proof-dev-postgres -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=proof -e POSTGRES_USER=proof -e POSTGRES_PASSWORD=devpassword postgres:18.6-alpine

cd backend
PROOF_DB_URL=jdbc:postgresql://127.0.0.1:5432/proof PROOF_DB_USER=proof PROOF_DB_PASSWORD=devpassword ./run.sh
```

Migrations apply automatically at startup. `run.sh` defaults `PROOF_DATA` to `../data` (gitignored),
where each registered user gets a directory.

The frontend has no build step. Changes take effect on a page reload. To test the edit
pipeline, serve `frontend/` (`backend/run.sh` does, or `python3 -m http.server` from `frontend/`) and open
`/test/pipeline.html` in a browser, or run it headless (this is what CI does):

```
frontend/test/run-headless.sh   # needs python3 and Chrome/Chromium (set CHROME=... if it isn't found)
```

The backend tests also run inside Docker, on the same Alpine image the app ships on:
`docker build -f docker/Dockerfile --target backend-test .` Each tool is checked against golden
pixel values and for identity at its default parameters.

## Before opening a PR

- Run `backend/test.sh` and `frontend/test/run-headless.sh` (or open `pipeline.html`), and make
  sure both pass.
- If you changed what an existing recipe parameter means, you bumped the recipe schema version
  and added a migration (see `AGENTS.md`). A saved edit must always reopen to the same pixels.
- If your change is a real design decision rather than just a bug fix, consider adding an entry
  to [`docs/decisions.md`](docs/decisions.md) that explains why.

## Reporting bugs / security issues

Regular bugs: open a GitHub issue. Security vulnerabilities: see [`SECURITY.md`](SECURITY.md),
and please don't open a public issue for those.
