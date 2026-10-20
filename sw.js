// Service worker — offline cache for the match archive.
//
// CACHE NAMING
//   The cache name is derived from a content hash of the precached files,
//   so a new build always lands in a NEW cache and the old one is dropped
//   on activate. A hand-maintained "archive-v3" string is easy to forget to
//   bump, which is exactly how a stale app shell gets served forever.
//
// HOW THE HASH IS BUILT
//   The service worker cannot read its own source file at install time, so
//   the hash is injected by scripts/build-sw.sh, which runs as part of the
//   build. When that script has not run, VERSION falls back to a constant
//   and the worker still works — it just needs a manual bump.
//
// STRATEGY
//   - data/*.json  -> NETWORK-FIRST. The match record must never be stale;
//                     a new result has to show up on the next visit.
//   - navigations  -> NETWORK-FIRST with a cached index.html fallback, so a
//                     deployed update is picked up immediately.
//   - everything else -> CACHE-FIRST.
//
// NOTE: the service worker caches the app SHELL only. The match records
// themselves live in data/matches.json and are always fetched fresh.
const VERSION = "v4e24bd696d93";
const CACHE = "nfa-" + VERSION;
const PRECACHE = [
  "./",
  "index.html",
  "404.html",
  "css/style.css",
  "js/i18n.js",
  "js/data.js",
  "js/app.js",
  "manifest.json",
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "fonts/space-grotesk-var.woff2",
  "fonts/jetbrains-mono-var.woff2",
  "fonts/noto-sans-devanagari.woff2"
];

// Data files are handled network-first, never served stale-first.
function isDataRequest(pathname) {
  return /\/data\/.*\.json$/.test(pathname);
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Precache individually so one 404 cannot abort the whole install.
      return Promise.all(
        PRECACHE.map(function (file) {
          return cache.add(file).catch(function () {
            return undefined;
          });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for JSON data: always try the network so records are fresh.
  if (isDataRequest(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || Response.error();
          });
        })
    );
    return;
  }

  // Network-first for navigations, so a freshly deployed update is picked
  // up on the next load instead of being pinned to a cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("index.html");
          });
        })
    );
    return;
  }

  // Cache-first for the shell: CSS, JS, fonts and images.
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      });
    })
  );
});