# proof: one image with the Kotlin backend and the static frontend. Postgres runs alongside it,
# either as a second container (docker-compose.yml, target `runtime`) or bundled into the
# `standalone` image for a single `docker run`, as in shelf. See docs/deployment.md.

# ---- pinned base images: bump versions here and only here. Exact Temurin patch and Alpine
# release, so nothing changes under a rebuild unless it's changed on purpose. Temurin 25 is the
# current Java LTS; build and runtime use the same release.
ARG TEMURIN=25.0.4_7
ARG ALPINE=3.24

# ---- build: compile the backend with bare kotlinc, the same way backend/build.sh does locally ----
FROM eclipse-temurin:${TEMURIN}-jdk-alpine-${ALPINE} AS build

ARG KOTLIN_VERSION=2.4.20
ARG KOTLIN_COMPILER_SHA256=59e9ca74c7904ef2c122b12114937673ccce68de820a663f0ed66ccf8799e0b7

RUN apk add --no-cache bash curl

RUN curl -fsSLo /tmp/kotlin-compiler.zip \
      "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" \
    && echo "${KOTLIN_COMPILER_SHA256}  /tmp/kotlin-compiler.zip" | sha256sum -c - \
    && unzip -q /tmp/kotlin-compiler.zip -d /opt \
    && rm /tmp/kotlin-compiler.zip
ENV KOTLIN_HOME=/opt/kotlinc
ENV PATH="${KOTLIN_HOME}/bin:${PATH}"

WORKDIR /build
COPY backend/ backend/
RUN backend/lib/fetch-deps.sh
RUN backend/build.sh

# ---- backend tests, for CI only (`docker build --target backend-test`); never in an image. They
# run on Alpine/musl, the same libc the runtime decodes images with (headless AWT and ImageIO). ----
FROM build AS backend-test
RUN backend/test.sh

# ---- runtime: the app on a JRE, run as the PUID/PGID user so files on the bind-mounted /data
# stay owned by whoever owns that directory on the host ----
FROM eclipse-temurin:${TEMURIN}-jre-alpine-${ALPINE} AS runtime

RUN apk add --no-cache bash su-exec

WORKDIR /app
COPY --from=build /build/backend/out/ ./out/
COPY --from=build /build/backend/lib/*.jar ./lib/
COPY --from=build /opt/kotlinc/lib/kotlin-stdlib.jar ./lib/kotlin-stdlib.jar
COPY db/migrations/ ./db/migrations/
COPY frontend/ ./frontend/
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PROOF_PORT=8080
ENV PROOF_DATA=/data
ENV PROOF_MIGRATIONS_DIR=/app/db/migrations
ENV PROOF_FRONTEND_DIR=/app/frontend
# Decoding a 24 MP photo for its thumbnails takes a few hundred MB of heap. The default (25 % of the
# container's memory) is too little in a small container, so the JVM may use 60 %. No display:
# AWT runs headless.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -Djava.awt.headless=true"
EXPOSE 8080
VOLUME /data

ENTRYPOINT ["/entrypoint.sh"]
CMD ["java", "-cp", "/app/out:/app/lib/*", "MainKt"]

# ---- standalone: runtime plus a bundled, loopback-only Postgres 18, for a single `docker run`
# with no compose file (shelf's pattern). Keep it the LAST stage, and never the implicit default:
# docker-compose.yml pins `target: runtime`, because a plain `docker build` builds the last stage.
FROM runtime AS standalone

RUN apk add --no-cache postgresql18

COPY docker/standalone-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PROOF_DATA_DIR=/data
CMD []
