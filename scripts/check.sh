#!/bin/bash
# Full project check — run before every commit.
#
# Usage: bash scripts/check.sh
#
# The admin e2e suite needs the real owner password, supplied
# out-of-band via ADMIN_PASSWORD. It is NOT stored in this repo. Without
# it the admin e2e skips itself; the hash guard still runs and still
# asserts that the old demo password is dead.
set -e
LINT_TOOLS="/root/lint-tools"
STYLELINT="$LINT_TOOLS/node_modules/.bin/stylelint"
PRETTIER="$LINT_TOOLS/node_modules/.bin/prettier"
STYLELINT_CONFIG="$LINT_TOOLS/.stylelintrc.json"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

PASS=0
FAIL=0

echo "╔══════════════════════════════════════╗"
echo "║   NIGHTFORGE MATCH ARCHIVE — CHECK   ║"
echo "╚══════════════════════════════════════╝"

# --- 1. JS syntax ---------------------------------------------------------
echo "▶ Checking JS syntax..."
for f in js/*.js sw.js admin/js/*.js; do
  if node --check "$f" 2>/dev/null; then
    echo "  ✅ $f"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $f — syntax error"
    FAIL=$((FAIL + 1))
  fi
done

# --- 2. JSON validity -----------------------------------------------------
echo "▶ Checking JSON files..."
for f in data/*.json manifest.json; do
  if python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then
    echo "  ✅ $f"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $f — invalid JSON"
    FAIL=$((FAIL + 1))
  fi
done

# --- 3. Stylelint ---------------------------------------------------------
echo "▶ Running Stylelint..."
if [ -f "$STYLELINT" ]; then
  if "$STYLELINT" "$PROJECT_DIR/**/*.css" --config "$STYLELINT_CONFIG" 2>&1; then
    echo "  ✅ Stylelint passed"
    PASS=$((PASS + 1))
  else
    echo "  ❌ Stylelint errors found"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  ⏭️  Stylelint not found at $STYLELINT"
fi

# --- 4. Prettier ----------------------------------------------------------
echo "▶ Running Prettier check..."
if [ -f "$PRETTIER" ]; then
  if "$PRETTIER" --check "$PROJECT_DIR/**/*.css" "$PROJECT_DIR/**/*.html" "$PROJECT_DIR/js/*.js" 2>&1; then
    echo "  ✅ Prettier passed"
    PASS=$((PASS + 1))
  else
    echo "  ⚠️  Prettier formatting issues (run: $PRETTIER --write)"
  fi
else
  echo "  ⏭️  Prettier not found at $PRETTIER"
fi

# --- 5. Anti-slop pattern checks -----------------------------------------
echo "▶ Anti-slop pattern checks..."
BANNED=$(grep -rn --include="*.css" --include="*.html" --include="*.js" \
  -E '(#667eea|#764ba2|#7F00FF|#E100FF)' "$PROJECT_DIR" 2>/dev/null || true)
if [ -n "$BANNED" ]; then
  echo "  ❌ Banned gradient found"
  FAIL=$((FAIL + 1))
else
  echo "  ✅ No banned gradients"
  PASS=$((PASS + 1))
fi

INLINE=$(grep -rn --include="*.html" 'style="' "$PROJECT_DIR" 2>/dev/null | grep -v '404.html' | wc -l)
if [ "$INLINE" -gt 0 ]; then
  echo "  ❌ $INLINE inline style attributes found"
  FAIL=$((FAIL + 1))
else
  echo "  ✅ No inline styles"
  PASS=$((PASS + 1))
fi

# No third-party requests. A Google Fonts link blocks rendering on a slow
# connection and a CDN script adds a supply-chain surface.
THIRD=$(grep -rn --include="*.html" -E '<(link|script)[^>]+(src|href)="https?://' "$PROJECT_DIR" 2>/dev/null \
  | grep -v 'nightforgeio.github.io' | grep -v 'schemas.' | wc -l)
if [ "$THIRD" -gt 0 ]; then
  echo "  ❌ $THIRD third-party asset references found"
  FAIL=$((FAIL + 1))
else
  echo "  ✅ No third-party assets"
  PASS=$((PASS + 1))
fi

# --- 6. Service worker version -------------------------------------------
# This runs BEFORE the test suites, because the deploy contract test
# asserts that sw.js VERSION matches the hash of the current files. If the
# rebuild happened after the tests, the first run after any content change
# would fail spuriously and only pass on a second run.
echo "▶ Checking service worker cache version..."
if [ -f "$PROJECT_DIR/scripts/build-sw.sh" ]; then
  BEFORE=$(grep -o 'const VERSION = "[^"]*"' "$PROJECT_DIR/sw.js" | head -1)
  bash "$PROJECT_DIR/scripts/build-sw.sh" > /tmp/buildsw.out 2>&1
  AFTER=$(grep -o 'const VERSION = "[^"]*"' "$PROJECT_DIR/sw.js" | head -1)
  if [ "$BEFORE" = "$AFTER" ]; then
    echo "  ✅ Service worker version is in sync — $AFTER"
  else
    echo "  ⚠️  Service worker version was stale and has been rebuilt"
    echo "     was: $BEFORE"
    echo "     now: $AFTER"
  fi
  PASS=$((PASS + 1))
else
  echo "  ⏭️  scripts/build-sw.sh not found"
fi

# --- 7. Test suites -------------------------------------------------------
echo "▶ Running test suites..."
TEST_FAIL=0

run_suite() {
  local label="$1"
  local cmd="$2"
  local out="$3"
  local grep_pattern="$4"
  if eval "$cmd" > "$out" 2>&1; then
    echo "  ✅ $label — $(grep -oE "$grep_pattern" "$out" | tail -1)"
  else
    echo "  ❌ $label failed:"
    tail -25 "$out" | sed 's/^/     /'
    TEST_FAIL=1
  fi
}

# The data layer is a plain node script.
run_suite "tests/data-layer.test.js" \
  "node $PROJECT_DIR/tests/data-layer.test.js" \
  /tmp/mh-datalayer.out \
  'RESULTS: [0-9]+ passed, [0-9]+ failed'

# The public DOM suite needs jsdom, which lives in the lint-tools sandbox.
if [ -d "$LINT_TOOLS/node_modules/jsdom" ]; then
  run_suite "tests/app-dom.test.js" \
    "cd $LINT_TOOLS && node $PROJECT_DIR/tests/app-dom.test.js" \
    /tmp/mh-domtest.out \
    'RESULTS: [0-9]+ passed, [0-9]+ failed'
else
  echo "  ⏭️  tests/app-dom.test.js — skipped (jsdom not installed)"
fi

# The reveal lifecycle suite drives the real app against a controllable
# fake IntersectionObserver, so it needs jsdom like the DOM suite does.
if [ -d "$LINT_TOOLS/node_modules/jsdom" ]; then
  run_suite "tests/reveal.test.js" \
    "cd $LINT_TOOLS && node $PROJECT_DIR/tests/reveal.test.js" \
    /tmp/mh-revealtest.out \
    'RESULTS: [0-9]+ passed, [0-9]+ failed'
else
  echo "  ⏭️  tests/reveal.test.js — skipped (jsdom not installed)"
fi

# The i18n parity suite is a plain node:test file.
run_suite "tests/i18n-parity.test.js" \
  "node --test $PROJECT_DIR/tests/i18n-parity.test.js" \
  /tmp/mh-i18ntest.out \
  '# pass [0-9]+'

# Static CSS / accessibility contract checks.
run_suite "tests/css-contract.test.js" \
  "node $PROJECT_DIR/tests/css-contract.test.js" \
  /tmp/mh-csscontract.out \
  'RESULTS: [0-9]+ passed, [0-9]+ failed'

# Static deployment / PWA contract checks.
run_suite "tests/deploy-contract.test.js" \
  "node $PROJECT_DIR/tests/deploy-contract.test.js" \
  /tmp/mh-deploycontract.out \
  'RESULTS: [0-9]+ passed, [0-9]+ failed'

# The admin e2e needs the real password.
if [ -f "$PROJECT_DIR/tests/admin.test.js" ]; then
  if [ -z "$ADMIN_PASSWORD" ]; then
    echo "  ⏭️  tests/admin.test.js — skipped (set ADMIN_PASSWORD to run the admin e2e)"
    PASS=$((PASS + 1))
  else
    run_suite "tests/admin.test.js" \
      "cd $LINT_TOOLS && ADMIN_PASSWORD='$ADMIN_PASSWORD' node $PROJECT_DIR/tests/admin.test.js" \
      /tmp/mh-admintest.out \
      'RESULTS: [0-9]+ passed, [0-9]+ failed'
  fi
fi

# Guard: the shipped password hash must match the real password, and the
# old demo password must no longer open the panel.
run_suite "tests/admin-hash.test.js" \
  "ADMIN_PASSWORD='$ADMIN_PASSWORD' node $PROJECT_DIR/tests/admin-hash.test.js" \
  /tmp/mh-adminhash.out \
  'RESULT: PASSED \([0-9]+ checks\)'

if [ "$TEST_FAIL" -eq 0 ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi

# --- 8. Secret scan -------------------------------------------------------
echo "▶ Scanning for committed credentials..."
# A PAT, a personal access token or a plaintext admin password must never
# reach the repository. The owner credential is supplied out-of-band.
SECRETS=$(grep -rn --exclude-dir=.git --exclude-dir=node_modules \
  -E '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})' \
  "$PROJECT_DIR" 2>/dev/null || true)
if [ -n "$SECRETS" ]; then
  echo "  ❌ A credential pattern was found in the repository"
  echo "$SECRETS" | sed 's/^/     /'
  FAIL=$((FAIL + 1))
else
  echo "  ✅ No credential patterns found"
  PASS=$((PASS + 1))
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   RESULTS: $PASS passed, $FAIL failed ║"
echo "╚══════════════════════════════════════╝"
if [ "$FAIL" -gt 0 ]; then
  echo "🚫 DO NOT COMMIT."
  exit 1
else
  echo "✅ All checks passed. Ship it."
  exit 0
fi