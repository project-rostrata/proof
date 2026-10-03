# Deployment

proof ships as one Docker image with the Kotlin backend and the static frontend. Postgres runs
beside it, either as a second container (compose) or bundled into the same container
(standalone).

## Compose (app + Postgres containers)

```
docker compose -f docker/docker-compose.yml up -d --build
```

Settings, all set through the environment or a `docker/.env` file:

| Variable | Default | Notes |
|---|---|---|
| `PROOF_DB_PASSWORD` | `devpassword` | **Change it.** |
| `PROOF_DATA_DIR` | `./data` | The host directory holding photos, edits, sidecars, and `.cache/`. |
| `PUID` / `PGID` | `1000` | The owner of files proof writes on the host. |
| `PROOF_PORT` | `8080` | The host port. |
| `PROOF_SECURE_COOKIES` | `false` | **Set to `true` behind HTTPS.** |
| `PROOF_MAX_UPLOAD_BYTES` | `100000000` | 100 MB per photo. |
| `PROOF_SESSION_DURATION_HOURS` | `720` | |

## Standalone (one container, Postgres bundled)

```
docker build -f docker/Dockerfile --target standalone -t proof .
docker run -d -p 8080:8080 -e PROOF_DB_PASSWORD=... -e PUID=$(id -u) -e PGID=$(id -g) -v /srv/proof:/data proof
```

`/data/photos` holds proof's files and `/data/postgres` holds the database (owned by the container's
`postgres` user). Postgres listens on loopback only.

## Notes

- **File layout:** files on disk are the truth. Back up `PROOF_DATA_DIR` (or `/data`). `.cache/`
  is derived and can be deleted at any time.
- **Permissions:** files are written `rw-r--r--` and owned by `PUID:PGID`, so SMB and tools such
  as darktable can read them.
- **Memory:** the JVM may use 60 % of the container's memory (`JAVA_TOOL_OPTIONS`). Decoding a
  24 MP photo for thumbnails needs a few hundred MB.
- **Backend tests in Docker:** `docker build -f docker/Dockerfile --target backend-test .` runs
  them on the same Alpine/musl base the runtime decodes images with.
