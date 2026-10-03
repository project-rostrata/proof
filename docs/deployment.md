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
| `PROOF_ALLOW_REGISTRATION` | `false` | Whether anyone can create an account. The first account can always be created, so a fresh install works. To add a household member later, set it to `true`, restart, let them register, then set it back. |
| `PROOF_MAX_UPLOAD_BYTES` | `100000000` | 100 MB per photo. |
| `PROOF_SESSION_DURATION_HOURS` | `720` | |
| `PROOF_RECONCILE_INTERVAL_MINUTES` | `15` | How often the background pass looks for changes made outside the app (over SMB, by darktable). Opening a page already checks what it shows. `0` turns the background pass off. |

## Standalone (one container, Postgres bundled)

```
docker build -f docker/Dockerfile --target standalone -t proof .
docker run -d -p 8080:8080 -e PROOF_DB_PASSWORD=... -e PUID=$(id -u) -e PGID=$(id -g) -v /srv/proof:/data proof
```

`/data/photos` holds proof's files and `/data/postgres` holds the database (owned by the container's
`postgres` user). Postgres listens on loopback only.

## Reaching it from outside your home network

proof is built for a home server. If it's reachable from the internet:
- **Serve it over HTTPS** through a reverse proxy (Caddy, nginx, Traefik), and set `PROOF_SECURE_COOKIES=true` so the session cookie is never sent in the clear.
- **Change `PROOF_DB_PASSWORD`** from its default. In compose, Postgres has no host port. In the standalone image it listens on loopback only.
- **Leave `PROOF_ALLOW_REGISTRATION` off**, apart from while adding someone.
- **What's built in:**
  - repeated failed sign-ins for a username are throttled (10 in 15 minutes);
  - request bodies, uploads, and image dimensions are capped;
  - pages can't be framed by other sites.

  There's no two-factor sign-in. For more than a household, put an authenticating proxy in front.
- **Proxy upload limit:** set the proxy's request size limit to at least `PROOF_MAX_UPLOAD_BYTES`. nginx's default is 1 MB, which refuses most photos.

## Notes

- **File layout:** files on disk are the truth. Back up `PROOF_DATA_DIR` (or `/data`). `.cache/`
  is derived and can be deleted at any time.
- **Permissions:** files are written `rw-r--r--` and owned by `PUID:PGID`, so SMB and tools such
  as darktable can read them.
- **Memory:** the JVM may use 60 % of the container's memory (`JAVA_TOOL_OPTIONS`). Decoding a
  24 MP photo for thumbnails needs a few hundred MB.
- **Backend tests in Docker:** `docker build -f docker/Dockerfile --target backend-test .` runs
  them on the same Alpine/musl base the runtime decodes images with.
