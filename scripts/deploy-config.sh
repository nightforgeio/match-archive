#!/bin/bash
# Rewrite the deploy-time URLs so they always point at the live domain.
#
# The absolute URLs in index.html (canonical, og:url, og:image, twitter:image)
# are the ones a social crawler reads. A relative og:image means a shared
# link renders with NO preview image at all, so these have to be absolute
# and they have to match the domain the site is actually served from.
#
# The site URL lives in .deploy.env. Change it there, not here.
#
# Usage: bash scripts/deploy-config.sh
set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="$PROJECT_DIR/.deploy.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ .deploy.env not found. Create it with SITE_URL=https://your-domain"
  exit 1
fi

# shellcheck disable=SC1090
. "$ENV_FILE"

if [ -z "${SITE_URL:-}" ]; then
  echo "✗ SITE_URL is not set in .deploy.env"
  exit 1
fi

# Strip any trailing slash so the URLs join cleanly.
SITE_URL="${SITE_URL%/}"

echo "✓ Deploying for $SITE_URL"

# --- index.html: absolute URLs ---------------------------------------------
if [ -f index.html ]; then
  sed -i \
    -e "s|https://nightforgeio.github.io/match-archive/|${SITE_URL}/|g" \
    -e "s|href=\"${SITE_URL}/\"|href=\"${SITE_URL}/\"|g" \
    index.html
  echo "✓ index.html URLs rewritten"
fi

# --- sitemap.xml -----------------------------------------------------------
if [ -f sitemap.xml ]; then
  cat > sitemap.xml <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
EOF
  echo "✓ sitemap.xml rewritten"
fi

# --- robots.txt ------------------------------------------------------------
if [ -f robots.txt ]; then
  cat > robots.txt <<EOF
User-agent: *
Allow: /

# The admin panel is for the owner only — keep it out of search results.
Disallow: /admin/

Sitemap: ${SITE_URL}/sitemap.xml
EOF
  echo "✓ robots.txt rewritten"
fi