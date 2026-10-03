#!/usr/bin/env bash
# Compiles src/ + test/ together and runs the hand-rolled test runner (test/TestMain.kt). Sibling to
# build.sh/run.sh -- see AGENTS.md's Testing section for why there's no JUnit/Gradle here.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

OUT_DIR="out-test"
LIB_DIR="lib"
KOTLIN_HOME="${KOTLIN_HOME:-/opt/kotlinc}"

CP="$LIB_DIR/postgresql-42.7.13.jar:$LIB_DIR/kotlinx-serialization-core-jvm-1.11.0.jar:$LIB_DIR/kotlinx-serialization-json-jvm-1.11.0.jar:$KOTLIN_HOME/lib/kotlin-test.jar"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

kotlinc \
  -Xjdk-release=25 \
  -Xplugin="$KOTLIN_HOME/lib/kotlinx-serialization-compiler-plugin.jar" \
  -cp "$CP" \
  -d "$OUT_DIR" \
  $(find src test -name '*.kt')

java \
  -cp "$OUT_DIR:$CP:$KOTLIN_HOME/lib/kotlin-stdlib.jar" \
  TestMainKt
