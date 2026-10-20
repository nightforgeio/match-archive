#!/bin/bash
# Inject a content-derived version into sw.js.
#
# The service worker cannot read its own source at install time, so the cache
# name has to be baked in. Basing it on a hash of the precached files means
# the cache name changes whenever any of them change — no manual bump, no
# stale app shell served to a returning visitor.
#
# Usage: bash scripts/build-sw.sh
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# The files the service worker precaches. A change to any of them must
# produce a new cache name.
FILES=(
  "index.html"
  "404.html"
  "css/style.css"
  "js/i18n.js"
  "js/data.js"
  "js/app.js"
  "manifest.json"
)

# Hash the contents, not the timestamps, so a no-op deploy does not
# invalidate the cache.
HASH=$(cat "${FILES[@]}" 2>/dev/null | sha256sum | cut -c1-12)
VERSION="v${HASH}"

if grep -q "const VERSION = \"${VERSION}\"" sw.js; then
  echo "✓ sw.js already at ${VERSION} (no change)"
else
  sed -i "s/const VERSION = \"[^\"]*\"/const VERSION = \"${VERSION}\"/" sw.js
  echo "✓ sw.js cache version set to ${VERSION}"
fi

echo "  precache hash source: ${FILES[*]}"