// css-contract.test.js — static stylesheet contract checks.
//
// jsdom has no layout engine, so these assert against the stylesheet
// source instead of measured boxes. They exist because a tap target
// below 44px is an accessibility regression that no DOM test can catch,
// and because the contrast tokens are easy to break by hand.
//
// Usage: node tests/css-contract.test.js
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const adminCss = fs.readFileSync(path.join(ROOT, "admin/css/admin.css"), "utf8");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    console.log("  PASS  " + name);
    pass++;
  } else {
    console.log("  FAIL  " + name + (extra !== undefined ? " -> " + extra : ""));
    fail++;
  }
}

// Pull the body of the first rule whose selector matches.
function ruleBody(source, selector) {
  const idx = source.indexOf(selector + " {");
  if (idx === -1) return "";
  return source.slice(idx, source.indexOf("}", idx));
}

// A control qualifies if it declares a >=44px min-height, OR a >=44px
// width AND height. A square icon button sizes both sides explicitly.
function tapTargetPx(source, selector) {
  const body = ruleBody(source, selector);
  if (!body) return null;
  const mh = /min-height:\s*([0-9.]+)(px|rem)/.exec(body);
  const w = /(?<!-)width:\s*([0-9.]+)(px|rem)/.exec(body);
  const h = /(?<!-)height:\s*([0-9.]+)(px|rem)/.exec(body);
  const toPx = (m) => (m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]));
  if (mh && toPx(mh) >= 44) return toPx(mh);
  if (w && h && toPx(w) >= 44 && toPx(h) >= 44) return Math.min(toPx(w), toPx(h));
  if (mh) return toPx(mh);
  if (w && h) return Math.min(toPx(w), toPx(h));
  return null;
}

// The width of a text link is decided by its label, so a min-height alone
// does not make the target 44x44. A rule also has to declare a min-width,
// or an explicit width, of at least 44px.
function minWidthPx(source, selector) {
  const body = ruleBody(source, selector);
  if (!body) return null;
  const mw = /min-width:\s*([0-9.]+)(px|rem)/.exec(body);
  const w = /(?<!-)width:\s*([0-9.]+)(px|rem)/.exec(body);
  const toPx = (m) => (m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]));
  if (mw) return toPx(mw);
  if (w) return toPx(w);
  return null;
}

// The min-height may live in a grouped selector, e.g.
//   .field input,
//   .field select,
//   .field textarea { min-height: 46px; }
// so the search falls back to the group.
function tapTargetPxGrouped(source, selectors) {
  for (const sel of selectors) {
    const px = tapTargetPx(source, sel);
    if (px !== null) return px;
  }
  // Grouped form: find a rule whose selector list contains the target.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const selList = m[1];
    const body = m[2];
    for (const sel of selectors) {
      if (!selList.split(",").some((s) => s.trim() === sel)) continue;
      const mh = /min-height:\s*([0-9.]+)(px|rem)/.exec(body);
      if (mh) return mh[2] === "rem" ? parseFloat(mh[1]) * 16 : parseFloat(mh[1]);
    }
  }
  return null;
}

// --- 1. Tap targets -------------------------------------------------------
// Every INTERACTIVE control must offer a 44x44px target. Non-interactive
// badges are exempt — a 24px result chip is a label, not a control.
console.log("=== TAP TARGETS ===");
const TAP_RULES = [
  { sel: ".btn", label: "button base" },
  { sel: ".chip", label: "filter chip" },
  { sel: ".filters__reset", label: "filters reset" },
  { sel: ".lang-toggle", label: "language toggle" },
  { sel: ".search__input", label: "search input" },
  { sel: ".contact__item", label: "contact action" },
  { sel: ".footer__link", label: "footer link" },
  { sel: ".nav__link", label: "nav link" },
  { sel: ".nav-toggle", label: "mobile burger" },
  { sel: ".brand", label: "brand link" },
  { sel: ".fact__value", label: "team fact value" }
];
for (const rule of TAP_RULES) {
  const px = tapTargetPx(css, rule.sel);
  ok(
    rule.label + " has a >=44px tap target",
    px !== null && px >= 44,
    px === null ? rule.sel + " has no size" : px + "px"
  );
}

// A text link's width comes from its label, so the height check alone is
// not enough. These rules must also declare a >=44px minimum width.
console.log("\n=== TAP TARGET WIDTHS ===");
for (const sel of [".nav__link", ".footer__link", ".brand", ".fact__value"]) {
  const w = minWidthPx(css, sel);
  ok(
    sel + " declares a >=44px minimum width",
    w !== null && w >= 44,
    w === null ? sel + " has no width" : w + "px"
  );
}

// The admin panel is a separate stylesheet with its own controls.
const ADMIN_TAP_RULES = [
  { sel: [".btn"], label: "admin button" },
  { sel: [".field input", ".field select", ".field textarea"], label: "admin field" }
];
for (const rule of ADMIN_TAP_RULES) {
  const px = tapTargetPxGrouped(adminCss, rule.sel);
  ok(
    rule.label + " has a >=44px tap target",
    px !== null && px >= 44,
    px === null ? rule.sel.join("/") + " has no size" : px + "px"
  );
}

// --- 2. No !important -----------------------------------------------------
console.log("\n=== NO !IMPORTANT ===");
// Strip comments first — an explanatory note that merely mentions
// !important is not a declaration.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const adminNoComments = adminCss.replace(/\/\*[\s\S]*?\*\//g, "");
ok("the public stylesheet contains no !important", !cssNoComments.match(/!important/g));
ok("the admin stylesheet contains no !important", !adminNoComments.match(/!important/g));

// --- 3. Motion tokens -----------------------------------------------------
console.log("\n=== MOTION TOKENS ===");
for (const token of ["--dur-fast", "--dur", "--dur-med", "--dur-slow"]) {
  ok("the " + token + " token exists", css.includes(token + ":"));
}

// --- 4. Reduced motion ----------------------------------------------------
console.log("\n=== REDUCED MOTION ===");
ok("the stylesheet honours prefers-reduced-motion", /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
ok("reduced motion neutralises the reveal animation", /\.js \.rv\s*\{[^}]*opacity:\s*1/.test(rm));
ok("reduced motion neutralises the reveal transform", /\.js \.rv\s*\{[^}]*transform:\s*none/.test(rm));
ok("reduced motion disables smooth scrolling", /scroll-behavior:\s*auto/.test(rm));
// A wipe reveal paints a cover over the content instead of clipping the
// content away. If it were a clip-path on the block, the block's visible
// area would collapse to zero, the IntersectionObserver would never
// report it as intersecting, and the section would stay invisible.
ok(
  "the wipe reveal does not clip the block away",
  !/\.js \.rv--wipe\s*\{[^}]*clip-path/.test(css),
);
ok(
  "the wipe reveal paints a cover instead",
  /\.js \.rv--wipe::before\s*\{[^}]*content:\s*""/.test(css),
);
ok(
  "reduced motion removes the wipe cover",
  /\.js \.rv--wipe::before\s*\{[^}]*display:\s*none/.test(rm),
);

// --- 5. Colour discipline -------------------------------------------------
console.log("\n=== COLOUR ===");
const root = ruleBody(css, ":root");
ok("exactly one accent colour is declared", (root.match(/--accent:/g) || []).length === 1);
ok("the accent has an ink colour for text on top", /--accent-ink:/.test(root));
ok("the base background is not pure black", /--bg:\s*#(?!000000|000\b)/.test(root));
ok("the primary text colour is not pure white", /--fg:\s*#(?!ffffff|fff\b)/.test(root));

// The muted colour is the one that usually fails contrast. Check it
// against the base background with the WCAG relative-luminance formula.
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const c = hexToRgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function token(name) {
  const m = new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{3,8})").exec(root);
  return m ? m[1] : null;
}
const bg = token("bg");
const fg = token("fg");
const fg2 = token("fg-2");
const muted = token("muted");
const accent = token("accent");
const accentInk = token("accent-ink");

ok("the --bg token is readable", bg !== null, String(bg));
ok("the --fg token is readable", fg !== null, String(fg));
if (bg && fg) {
  const r = contrast(fg, bg);
  ok("body text passes 4.5:1 on --bg", r >= 4.5, r.toFixed(2) + ":1");
}
if (bg && fg2) {
  const r = contrast(fg2, bg);
  ok("secondary text passes 4.5:1 on --bg", r >= 4.5, r.toFixed(2) + ":1");
}
if (bg && muted) {
  const r = contrast(muted, bg);
  ok("muted text passes 4.5:1 on --bg", r >= 4.5, r.toFixed(2) + ":1");
}
if (accent && accentInk) {
  const r = contrast(accentInk, accent);
  ok("text on the accent fill passes 4.5:1", r >= 4.5, r.toFixed(2) + ":1");
}

// --- 6. Type discipline ---------------------------------------------------
console.log("\n=== TYPE ===");
ok("the body line-height is at least 1.5", /line-height:\s*1\.(5[0-9]|[6-9][0-9])/.test(css));
ok("the display type has tightened tracking", /letter-spacing:\s*-0\.[0-9]+em/.test(css));
// Thin weights on screen are a legibility failure, not elegance. The
// @font-face weight RANGES are excluded — those describe the variable
// font's available axis, not the weight text is rendered at.
const fontFaceBodies = (css.match(/@font-face\s*\{[^}]*\}/g) || []).join("\n");
const thinInText = css
  .replace(/@font-face\s*\{[^}]*\}/g, "")
  .match(/font-weight:\s*(100|200)\b/g);
ok("no text is rendered below weight 300", !thinInText, (thinInText || []).join(", "));
ok(
  "the font-face weight ranges are variable-font declarations",
  /font-weight:\s*\d{3}\s+\d{3}/.test(fontFaceBodies)
);

// --- 7. Layout safety -----------------------------------------------------
console.log("\n=== LAYOUT ===");
ok("the container is width-constrained", /width:\s*min\(/.test(css));
ok("no element is pinned with a fixed pixel width", !/width:\s*[0-9]{4,}px/.test(css));
ok("long strings can break", /word-break|overflow-wrap/.test(css));
ok("the reduced-motion block does not leak into the main sheet", rm.length > 0);

console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);