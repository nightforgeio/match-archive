// reveal.test.js — behavioural test for the scroll-reveal lifecycle.
//
// The reveal animation hides content until an IntersectionObserver says
// the element is on screen. That makes it the single most dangerous
// mechanism on the page: if the observer never fires, the content is
// gone. This suite drives the real js/app.js against a controllable
// fake IntersectionObserver and proves four things:
//
//   1. A node that intersects is revealed.
//   2. A node that NEVER intersects is still revealed by the failsafe
//      if the visitor could be looking at it.
//   3. A node below the fold keeps its reveal until it is scrolled to.
//   4. A language change re-observes the freshly rendered nodes.
//
// The fake observer is the point of the suite. A real observer in jsdom
// never fires, because jsdom has no layout engine and therefore no
// viewport — so a jsdom test could only ever prove the FAILSAFE path.
// Controlling the observer lets the normal path be tested too.
//
// Run: node tests/reveal.test.js   (requires jsdom in /root/lint-tools)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/root/lint-tools/node_modules/jsdom");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const html = rd("index.html");
const i18nJs = rd("js/i18n.js");
const dataJs = rd("js/data.js");
const appJs = rd("js/app.js");

const teamData = JSON.parse(rd("tests/fixtures/team.json"));
const matchData = JSON.parse(rd("tests/fixtures/matches.json"));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    console.log("  PASS  " + name);
    pass++;
  } else {
    console.log(
      "  FAIL  " + name + (extra !== undefined ? " -> " + extra : ""),
    );
    fail++;
  }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const settle = () => tick(120);

// Scroll the page and let the scroll listener run.
//
// The scroll sweep is throttled through requestAnimationFrame, so the
// test has to wait for a frame to pass after the offset changes.
async function page_scroll(w, y) {
  w.__scrollY = y;
  w.dispatchEvent(new w.Event("scroll"));
  await tick(60);
}

// A controllable IntersectionObserver.
//
// The real one is driven by the browser's layout engine. This one records
// what it was asked to observe and lets the test decide, later, which of
// those nodes "intersected".
function installFakeObserver(w, intersectFn) {
  const state = {
    instances: [],
    intersect: intersectFn || null,
  };

  class FakeObserver {
    constructor(cb, opts) {
      this.cb = cb;
      this.opts = opts || {};
      this.targets = [];
      state.instances.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    unobserve(target) {
      const i = this.targets.indexOf(target);
      if (i !== -1) this.targets.splice(i, 1);
    }
    disconnect() {
      this.targets.length = 0;
    }
    takeRecords() {
      return [];
    }
  }

  w.IntersectionObserver = FakeObserver;

  // Fire the callback for whatever the test says is intersecting.
  state.fire = function () {
    const last = state.instances[state.instances.length - 1];
    if (!last) return 0;
    const entries = last.targets
      .slice()
      .filter(function (target) {
        return state.intersect ? state.intersect(target) : false;
      })
      .map(function (target) {
        return { target: target, isIntersecting: true };
      });
    if (entries.length) last.cb(entries, last);
    return entries.length;
  };

  state.observedCount = function () {
    let n = 0;
    state.instances.forEach(function (inst) {
      n += inst.targets.length;
    });
    return n;
  };

  state.lastOptions = function () {
    const last = state.instances[state.instances.length - 1];
    return last ? last.opts : null;
  };

  return state;
}

// Build a window with the fake observer in place.
//
// opts.intersect        — decides which observed nodes report as intersecting.
// opts.viewportHeight   — the value reported by window.innerHeight.
// opts.layout           — a map of CSS selector -> { top, height }, used by
//                         getBoundingClientRect to place an element.
function makeWindow(opts) {
  const o = opts || {};
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://127.0.0.1:8899/",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = function (url) {
    const name = String(url).split("/").pop();
    if (name === "matches.json") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(matchData),
      });
    }
    if (name === "team.json") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(teamData),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });
  };
  w.navigator.clipboard = undefined;
  w.TextEncoder = TextEncoder;

  // The viewport height the failsafe compares against.
  Object.defineProperty(w, "innerHeight", {
    value: o.viewportHeight || 800,
    writable: true,
    configurable: true,
  });

  // jsdom has no layout engine, so getBoundingClientRect returns zeroes.
  // The suite needs real positions, so they are supplied here.
  //
  // Any element the layout map does not mention is placed by its index in
  // the reveal list, one screen apart. That puts the first node in the
  // viewport and every other node below the fold, which is what the
  // failsafe and the observer both need to be told apart.
  //
  // The positions are DOCUMENT coordinates. The scroll offset is
  // subtracted, so scrolling the page moves the elements the way it
  // would in a real browser.
  const layout = o.layout || {};
  const selectors = Object.keys(layout);
  w.__scrollY = 0;
  w.Element.prototype.getBoundingClientRect = function () {
    let top = null;
    let height = 200;
    for (let i = 0; i < selectors.length; i++) {
      const sel = selectors[i];
      if (this.matches && this.matches(sel)) {
        top = layout[sel].top;
        if (typeof layout[sel].height === "number") height = layout[sel].height;
        break;
      }
    }
    if (top === null) {
      const rvs = this.ownerDocument.querySelectorAll(".rv");
      const idx = Array.prototype.indexOf.call(rvs, this);
      top = (idx === -1 ? 0 : idx) * 900;
    }
    top = top - w.__scrollY;
    return {
      top: top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 800,
      height: height,
      x: 0,
      y: top,
      toJSON: function () {
        return this;
      },
    };
  };

  const observer = installFakeObserver(w, o.intersect);

  w.eval(i18nJs);
  w.eval(dataJs);
  w.eval(appJs);
  w.__observer = observer;
  return w;
}

(async () => {
  // =========================================================================
  console.log("\n=== OBSERVER CONFIGURATION ===");
  {
    const w = makeWindow({
      intersect: function () {
        return true;
      },
    });
    await settle();
    const doc = w.document;

    ok(
      "an IntersectionObserver was created",
      w.__observer.instances.length >= 1,
      w.__observer.instances.length + " instances",
    );
    const opts = w.__observer.lastOptions();
    ok(
      "the observer uses a zero threshold",
      opts && opts.threshold === 0,
      JSON.stringify(opts),
    );
    ok(
      "the observer has a bottom root margin",
      opts &&
        typeof opts.rootMargin === "string" &&
        opts.rootMargin.indexOf("-10%") !== -1,
      opts ? opts.rootMargin : "no options",
    );
    ok(
      "the board is a wipe reveal node",
      doc.querySelector(".board.rv--wipe") !== null,
    );
    ok(
      "reveal nodes are observed",
      w.__observer.observedCount() > 0,
      w.__observer.observedCount() + " observed",
    );
  }

  // =========================================================================
  console.log("\n=== NORMAL REVEAL PATH ===");
  {
    const w = makeWindow({
      intersect: function (target) {
        return target.classList.contains("board");
      },
    });
    await settle();
    const doc = w.document;

    ok(
      "reveal nodes are pending before the observer fires",
      doc.querySelectorAll(".rv:not(.in)").length > 0,
      doc.querySelectorAll(".rv:not(.in)").length + " pending",
    );

    // The board intersects — nothing else does.
    const fired = w.__observer.fire();
    ok("the observer callback fired", fired >= 1, fired + " entries");

    const board = doc.querySelector(".board");
    ok("the intersected board is revealed", board.classList.contains("in"));
    ok(
      "a node that did not intersect stays hidden",
      doc.querySelectorAll(".rv:not(.in)").length > 0,
      doc.querySelectorAll(".rv:not(.in)").length + " still pending",
    );
  }

  // =========================================================================
  console.log("\n=== FAILSAFE: A NODE THAT NEVER INTERSECTS ===");
  {
    // Nothing ever intersects. This is the case that hid the board: a
    // clipped element reports a zero-area box, so the observer never
    // fires and the content would be lost with it.
    const w = makeWindow({
      intersect: function () {
        return false;
      },
      viewportHeight: 800,
      layout: { ".board": { top: 120, height: 400 } },
    });
    await settle();
    const doc = w.document;

    const board = doc.querySelector(".board");
    ok("the board starts hidden", !board.classList.contains("in"));

    // Wait past the failsafe window.
    await tick(2800);

    ok(
      "the board is revealed by the failsafe",
      board.classList.contains("in"),
      "still hidden",
    );
    // The first reveal node sits at the top of the page, so it is in the
    // viewport and must be open too.
    const first = doc.querySelector(".rv");
    ok(
      "an in-viewport reveal node is opened by the failsafe",
      first.classList.contains("in"),
      "still hidden",
    );
  }

  // =========================================================================
  console.log("\n=== FAILSAFE: NODES BELOW THE FOLD KEEP THEIR REVEAL ===");
  {
    // The visitor has not scrolled. The hero is on screen, the archive
    // section is far below it. The failsafe must open the hero and
    // leave the archive alone, or the scroll choreography is gone.
    const w = makeWindow({
      intersect: function () {
        return false;
      },
      viewportHeight: 800,
      layout: { ".board": { top: 120, height: 400 } },
    });
    await settle();
    const doc = w.document;

    await tick(2800);

    const board = doc.querySelector(".board");
    ok("the in-viewport board is revealed", board.classList.contains("in"));

    // A node that is genuinely below the fold keeps its reveal, so the
    // page still unfolds as the visitor scrolls.
    const belowFold = Array.from(doc.querySelectorAll(".rv")).filter(
      function (n) {
        return n.getBoundingClientRect().top > 800;
      },
    );
    ok(
      "there is at least one node below the fold",
      belowFold.length > 0,
      belowFold.length + " nodes",
    );
    ok(
      "a node below the fold is not force-revealed",
      belowFold.every(function (n) {
        return !n.classList.contains("in");
      }),
      belowFold.filter(function (n) {
        return n.classList.contains("in");
      }).length + " were force-revealed",
    );
  }

  // =========================================================================
  console.log("\n=== LANGUAGE CHANGE RE-OBSERVES ===");
  {
    // A language change re-renders the modes rail, which replaces its
    // reveal nodes with fresh ones. If the observer is not re-created,
    // the new nodes are never watched and the rail stays invisible.
    const w = makeWindow({
      intersect: function () {
        return true;
      },
    });
    await settle();
    const doc = w.document;
    const before = w.__observer.instances.length;

    doc
      .getElementById("langToggle")
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await settle();

    ok(
      "the observer is re-created on a language change",
      w.__observer.instances.length > before,
      before + " -> " + w.__observer.instances.length,
    );
    ok(
      "the new mode rail nodes are observed",
      w.__observer.observedCount() > 0,
      w.__observer.observedCount() + " observed",
    );

    w.__observer.fire();
    ok(
      "the re-rendered mode rail is revealed",
      doc.querySelectorAll("#modeRail .rv.in").length === 3,
      doc.querySelectorAll("#modeRail .rv.in").length + " of 3 revealed",
    );
  }

  // =========================================================================
  console.log("\n=== A SCROLL JUMP DOES NOT LEAVE BLANK SPACE ===");
  {
    // An IntersectionObserver only reports an element WHILE it is on
    // screen. A nav anchor jump can move the viewport past a node
    // between two frames, so the node never intersects and stays
    // hidden forever — a band of empty space in the middle of the page.
    // The scroll sweep opens anything already scrolled past.
    const w = makeWindow({
      intersect: function () {
        return false;
      },
      viewportHeight: 800,
    });
    await settle();
    const doc = w.document;

    // Pretend the visitor jumped straight down the page.
    w.__observer.fire();
    await page_scroll(w, 5000);
    await settle();

    const behind = Array.from(doc.querySelectorAll(".rv")).filter(function (n) {
      return n.getBoundingClientRect().top <= 0;
    });
    ok(
      "there is content above the viewport",
      behind.length > 0,
      behind.length + " nodes",
    );
    ok(
      "content scrolled past is revealed",
      behind.every(function (n) {
        return n.classList.contains("in");
      }),
      behind.filter(function (n) {
        return !n.classList.contains("in");
      }).length + " stayed hidden",
    );
  }

  // =========================================================================
  console.log("\n=== REDUCED MOTION IS A CSS CONTRACT ===");
  {
    // The reduced-motion block has to remove the wipe cover entirely,
    // or the cover stays parked over the board forever.
    const css = rd("css/style.css");
    const rm = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    ok("the reduced-motion block exists", rm.length > 0);
    ok(
      "reduced motion removes the wipe cover",
      /\.js \.rv--wipe::before\s*\{[^}]*display:\s*none/.test(rm),
    );
    ok(
      "the wipe never clips the block away",
      !/\.js \.rv--wipe\s*\{[^}]*clip-path/.test(css),
    );
  }

  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(fail > 0 ? 1 : 0);
})().catch(function (err) {
  console.error("SUITE CRASHED:", err);
  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(1);
});
