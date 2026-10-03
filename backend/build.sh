#!/usr/bin/env bash
# Compiles the proof backend with the bare kotlinc compiler -- no Gradle/Maven (PROJECT_BRIEF.md §2).
# This is the single source of truth for the compile command; the Dockerfile build stage (Phase 13)
# calls this script rather than duplicating the invocation. Run lib/fetch-deps.sh once first.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

OUT_DIR="out"
LIB_DIR="lib"
KOTLIN_HOME="${KOTLIN_HOME:-/opt/kotlinc}"

CP="$LIB_DIR/postgresql-42.7.13.jar:$LIB_DIR/kotlinx-serialization-core-jvm-1.11.0.jar:$LIB_DIR/kotlinx-serialization-json-jvm-1.11.0.jar"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# -Xjdk-release: compile against Java 25's API, the runtime the image will ship, whatever JDK kotlinc
# itself happens to run on.
kotlinc \
  -Xjdk-release=25 \
  -Xplugin="$KOTLIN_HOME/lib/kotlinx-serialization-compiler-plugin.jar" \
  -cp "$CP" \
  -d "$OUT_DIR" \
  $(find src -name '*.kt')

echo "Built to $OUT_DIR/"
