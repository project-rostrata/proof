#!/usr/bin/env bash
# Runs the pipeline test page (pipeline.html) in headless Chrome or Chromium and fails if any test
# fails. Used by CI, and runnable locally. No npm: it needs only Python's built-in HTTP server
# (ES modules don't load from file://) and a Chrome binary.
#
#   frontend/test/run-headless.sh              # uses $CHROME, else google-chrome / chromium
#
# SwiftShader (Chrome's software GPU) is enough: the tests check correctness, not speed.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$CHROME" ] || { echo "no Chrome/Chromium found; set CHROME" >&2; exit 2; }
PORT="${PORT:-8791}"

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/test/pipeline.html" && break
  sleep 0.1
done

DOM="$("$CHROME" --headless --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --virtual-time-budget=300000 --dump-dom "http://127.0.0.1:$PORT/test/pipeline.html" 2>/dev/null)"

summary="$(grep -o 'data-summary="[^"]*"' <<<"$DOM" | head -1 | cut -d'"' -f2 || true)"
if [ -z "$summary" ]; then
  echo "pipeline tests didn't finish (no summary in the page)" >&2
  exit 1
fi
# List failures with their messages.
grep -o '<tr><td><span class="fail">FAIL</span></td><td>[^<]*' <<<"$DOM" | sed 's/.*<td>/FAIL: /' || true
echo "pipeline tests: $summary"
grep -q 'data-result="pass"' <<<"$DOM"
