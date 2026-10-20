// deploy-contract.test.js — static deployment + PWA contract checks.
//
// jsdom has no layout engine and no service worker, so these checks run
// against the raw file contents instead. They exist to catch the class
// of bug that only shows up AFTER a deploy:
//
//   - a manifest that points at an icon that does not exist
//   - a service worker that precaches a file that was renamed
//   - a canonical URL that does not match the live domain
//   - a sitemap or robots.txt that still names the old domain
//   - a page that loads sw.js as a normal script (the fetch handler
//     would then run in the page realm and break every request)
//
// Usage: node tests/deploy-contract.test.js
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

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

const index = rd("index.html");
const sw = rd("sw.js");
const manifest = JSON.parse(rd("manifest.json"));
const robots = rd("robots.txt");
const sitemap = rd("sitemap.xml");
const env = exists(".deploy.env") ? rd(".deploy.env") : "";

// The live domain. It is read from .deploy.env so the test follows the
// deploy config instead of hard-coding a second copy of the truth.
const siteMatch = env.match(/^SITE_URL=(.+)$/m);
const SITE_URL = siteMatch ? siteMatch[1].trim().replace(/\/$/, "") : "";

console.log("=== DEPLOY CONFIG ===");
ok(".deploy.env exists", exists(".deploy.env"));
ok("SITE_URL is set in .deploy.env", SITE_URL !== "", SITE_URL);
ok("SITE_URL is an https URL", SITE_URL.startsWith("https://"), SITE_URL);

console.log("\n=== CANONICAL + SOCIAL ===");
// The formatter may wrap a long attribute across lines, so the meta
// tags are read as "attribute present with this value anywhere in the
// tag" rather than as a single-line string match.
function hasMeta(attr, value) {
  const re = new RegExp(
    attr + '\\s*=\\s*"' + value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"',
    "i"
  );
  return re.test(index);
}
ok("the canonical link is absolute", /rel="canonical"\s*\n?\s*href="https?:\/\//.test(index) || hasMeta("href", "https://nightforgeio.github.io/match-archive/"));
ok("the canonical link matches SITE_URL", hasMeta("href", SITE_URL + "/"));
ok("og:url matches SITE_URL", hasMeta("content", SITE_URL + "/"));
ok("og:image is absolute", /property="og:image"[\s\S]{0,200}?content="https?:\/\//.test(index));
ok("og:image points at the site", hasMeta("content", SITE_URL + "/assets/og-image.png"));
ok("twitter:image points at the site", hasMeta("content", SITE_URL + "/assets/og-image.png"));
ok("twitter:card is summary_large_image", hasMeta("content", "summary_large_image"));
ok("there is a theme-color meta tag", /name="theme-color"/.test(index));
ok("the viewport is set", /name="viewport"[\s\S]{0,160}?width=device-width/.test(index));
ok("the viewport supports notched displays", index.includes("viewport-fit=cover"));
ok("the page declares a language", /<html lang="en">/.test(index));

console.log("\n=== SEO FILES ===");
ok("robots.txt exists", exists("robots.txt"));
ok("robots.txt allows the public pages", robots.includes("Allow: /"));
ok("robots.txt blocks the admin panel", robots.includes("Disallow: /admin/"));
ok("robots.txt names the sitemap", robots.includes("Sitemap: " + SITE_URL + "/sitemap.xml"));
ok("sitemap.xml exists", exists("sitemap.xml"));
ok("sitemap.xml names the site URL", sitemap.includes("<loc>" + SITE_URL + "/</loc>"));
ok("the sitemap has no stale domain", !/nightforgeio\.github\.io\/(?!match-archive)/.test(sitemap));

console.log("\n=== MANIFEST ===");
ok("the manifest has a name", !!manifest.name);
ok("the manifest has a short_name", !!manifest.short_name);
ok("the manifest has a description", !!manifest.description);
ok("the manifest declares a display mode", !!manifest.display);
ok("the manifest start_url is relative", manifest.start_url.startsWith("."));
ok("the manifest scope is relative", manifest.scope.startsWith("."));
ok("the manifest has a theme_color", /^#[0-9a-f]{6}$/i.test(manifest.theme_color || ""));
ok("the manifest has a background_color", /^#[0-9a-f]{6}$/i.test(manifest.background_color || ""));
ok("the manifest declares a language", !!manifest.lang);
ok("the manifest has icons", Array.isArray(manifest.icons) && manifest.icons.length >= 2);
ok("the manifest has a 192 icon", manifest.icons.some((i) => i.sizes === "192x192"));
ok("the manifest has a 512 icon", manifest.icons.some((i) => i.sizes === "512x512"));
ok("the manifest has a maskable icon", manifest.icons.some((i) => i.purpose === "maskable"));
manifest.icons.forEach((icon) => {
  ok("the manifest icon " + icon.src + " exists", exists(icon.src));
});

console.log("\n=== SERVICE WORKER ===");
// The single most damaging mistake: loading sw.js with a <script> tag.
// In a page context `self` IS `window`, so the worker's fetch handler
// intercepts every request the page makes.
ok("sw.js is NOT loaded as a page script", !/<script[^>]+src="sw\.js"/.test(index));
ok("sw.js is registered through the API", index.includes('navigator.serviceWorker.register("sw.js")'));
ok("the registration is guarded to http(s)", /location\.protocol\s*!==\s*"http:"/.test(index));

// Every precached file must exist, or the install handler logs a miss on
// every single deploy.
const precache = (sw.match(/const PRECACHE = \[([\s\S]*?)\];/) || [, ""])[1];
const precacheFiles = (precache.match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ""));
precacheFiles.forEach((f) => {
  if (f === "./") return; // the site root
  ok("the precached file " + f + " exists", exists(f));
});

// The data files are deliberately NOT precached — they are network-first,
// so a new match must never be hidden by a stale cache.
ok("the data files are not precached", !precacheFiles.some((f) => f.startsWith("data/")));

// The cache name has to change when the shell changes, or a returning
// visitor keeps the old app forever.
ok("the worker has a version constant", /const VERSION = "[^"]+"/.test(sw));
ok("the cache name is derived from the version", /const CACHE = "nfa-" \+ VERSION/.test(sw));
ok("the worker deletes old caches on activate", /caches\.delete/.test(sw));
ok("the worker claims clients on activate", /clients\.claim\(\)/.test(sw));

console.log("\n=== FONTS ===");
// Local fonts only. A Google Fonts link blocks rendering on a slow
// connection and adds a third-party request.
ok("no Google Fonts link", !/fonts\.googleapis\.com/.test(index));
ok("no third-party CSS or JS", !/<(link|script)[^>]+(src|href)="https?:\/\/(?!nightforgeio\.github\.io)/.test(index));
// The Devanagari face is declared with font-display: swap and is only
// applied under html[lang="hi"]. It is deliberately NOT preloaded — an
// English visitor should never download a font they will not use.
const css = rd("css/style.css");
ok(
  "the Devanagari font is declared with font-display: swap",
  /noto-sans-devanagari\.woff2[\s\S]{0,120}font-display:\s*swap/.test(css)
);
ok("the Devanagari font is applied to the Hindi locale", /html\[lang="hi"\]/.test(css));

console.log("\n=== NO PLACEHOLDER TEXT ===");
ok("no lorem ipsum on the page", !/lorem ipsum/i.test(index));
ok("no TODO markers on the page", !/TODO/.test(index));
ok("no empty href attributes", !/href=""/.test(index));

console.log("\n=== ACCESSIBILITY BASICS ===");
ok("there is a skip link", /class="skip-link"/.test(index));
ok("the page has exactly one h1", (index.match(/<h1[\s>]/g) || []).length === 1);
ok("every section has an id", !/<section(?![^>]*id=)/.test(index));
ok("the burger button declares aria-expanded", /aria-expanded="false"/.test(index));
ok("the burger button declares aria-controls", /aria-controls="nav"/.test(index));
ok("the search input has a label", /<label[^>]+for="searchInput"/.test(index));
ok("the result count is a live region", /id="resultCount"[^>]*aria-live="polite"/.test(index));
ok("the reduced-motion block is present", /prefers-reduced-motion/.test(rd("css/style.css")));

console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);