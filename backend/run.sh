#!/usr/bin/env bash
# Runs the compiled proof backend (build.sh first). Single source of truth for the run command; the
# Dockerfile runtime stage (Phase 13) calls this script directly.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

OUT_DIR="out"
LIB_DIR="lib"
KOTLIN_HOME="${KOTLIN_HOME:-/opt/kotlinc}"

CP="$OUT_DIR:$LIB_DIR/postgresql-42.7.13.jar:$LIB_DIR/kotlinx-serialization-core-jvm-1.11.0.jar:$LIB_DIR/kotlinx-serialization-json-jvm-1.11.0.jar:$KOTLIN_HOME/lib/kotlin-stdlib.jar"

# Local-dev defaults; the Docker deployment sets these explicitly instead. The database settings
# (PROOF_DB_URL, PROOF_DB_USER, PROOF_DB_PASSWORD) have no defaults -- see CONTRIBUTING.md.
: "${PROOF_FRONTEND_DIR:=../frontend}"
: "${PROOF_MIGRATIONS_DIR:=../db/migrations}"
: "${PROOF_DATA:=../data}"
export PROOF_FRONTEND_DIR PROOF_MIGRATIONS_DIR PROOF_DATA

java \
  -cp "$CP" \
  MainKt "$@"
