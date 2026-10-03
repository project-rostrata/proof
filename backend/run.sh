#!/usr/bin/env bash
# Runs the compiled proof backend (build.sh first). Single source of truth for the run command; the
# Dockerfile runtime stage (Phase 13) calls this script directly.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

OUT_DIR="out"
LIB_DIR="lib"
KOTLIN_HOME="${KOTLIN_HOME:-/opt/kotlinc}"

CP="$OUT_DIR:$LIB_DIR/postgresql-42.7.13.jar:$LIB_DIR/kotlinx-serialization-core-jvm-1.11.0.jar:$LIB_DIR/kotlinx-serialization-json-jvm-1.11.0.jar:$KOTLIN_HOME/lib/kotlin-stdlib.jar"

# Local-dev defaults; the Docker deployment sets these explicitly instead.
: "${PROOF_FRONTEND_DIR:=../frontend}"
: "${PROOF_MIGRATIONS_DIR:=../db/migrations}"
export PROOF_FRONTEND_DIR PROOF_MIGRATIONS_DIR

java \
  -cp "$CP" \
  MainKt "$@"
