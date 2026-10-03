#!/usr/bin/env bash
# Downloads every jar listed in DEPENDENCIES.sha1 and verifies it against the
# recorded checksum. Jars themselves aren't committed to git — only this
# script and the checksum manifest are. Run this once before build.sh/run.sh/
# test.sh; re-run any time DEPENDENCIES.sha1 changes.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

while read -r name sha1 url; do
  [ -z "$name" ] && continue
  if [ -f "$name" ] && echo "$sha1  $name" | sha1sum -c - > /dev/null 2>&1; then
    echo "ok (cached): $name"
    continue
  fi
  echo "fetching: $name"
  curl -sL -o "$name" "$url"
  echo "$sha1  $name" | sha1sum -c -
done < DEPENDENCIES.sha1

echo "All dependencies fetched and verified."
