// app-dom.test.js — headless DOM test for the public archive.
//
// Exercises the real shipped files (index.html, js/*.js) in jsdom, with
// a stubbed fetch. It covers rendering, filtering, search, the language
// toggle, the mobile menu and the error state.
//
// Run: node tests/app-dom.test.js   (requires jsdom in /root/lint-tools)
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/root/lint-tools/node_modules/jsdom");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const html = rd("index.html");
const i18nJs = rd("js/i18n.js");
const dataJs = rd("js/data.js");
const appJs = rd("js/app.js");

const teamData = JSON.parse(rd("data/team.json"));
const matchData = JSON.parse(rd("data/matches.json"));

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

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));
const settle = () => tick(120);

// Capture the RAW string app.js writes into the list. The innerHTML
// getter re-serialises the parsed DOM, so it cannot be used to check
// escaping — the serialiser is allowed to leave a bare "<" inside a
// quoted attribute value. Only the string the app actually produced
// proves the escaping.
function captureRawHtml(w) {
  const list = w.document.getElementById("matchList");
  // innerHTML lives on Element.prototype, several levels up from the
  // element's own prototype, so the chain has to be walked.
  let desc = null;
  let proto = Object.getPrototypeOf(list);
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, "innerHTML");
    proto = Object.getPrototypeOf(proto);
  }
  if (!desc) throw new Error("could not find the innerHTML descriptor");
  const captured = { value: "" };
  Object.defineProperty(list, "innerHTML", {
    configurable: true,
    get: function () {
      return desc.get.call(this);
    },
    set: function (v) {
      captured.value = String(v);
      desc.set.call(this, v);
    }
  });
  return captured;
}

function makeWindow(opts) {
  const o = opts || {};
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://127.0.0.1:8899/"
  });
  const w = dom.window;
  w.fetch = function (url) {
    const name = String(url).split("/").pop();
    if (o.failMatches) {
      return Promise.reject(new Error("network down"));
    }
    if (name === "matches.json") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(o.matches || matchData)
      });
    }
    if (name === "team.json") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(o.team || teamData)
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
  w.navigator.clipboard = undefined;
  w.TextEncoder = TextEncoder;
  const captured = captureRawHtml(w);
  w.eval(i18nJs);
  w.eval(dataJs);
  w.eval(appJs);
  w.__captured = captured;
  return w;
}

(async () => {
  // =========================================================================
  console.log("\n=== BOOT ===");
  const w = makeWindow();
  await settle();
  const doc = w.document;
  const T = (id) => (doc.getElementById(id) ? doc.getElementById(id).textContent.trim() : "");
  const cards = () => doc.querySelectorAll("#matchList .match");

  ok("the match list rendered", cards().length === 8, cards().length + " cards");
  ok("the skeleton is hidden", doc.getElementById("skeleton").hidden);
  ok("the error state is hidden", doc.getElementById("errorState").hidden);
  ok("the empty state is hidden", doc.getElementById("emptyState").hidden);
  ok("the result count is shown", T("resultCount").indexOf("8") === 0, T("resultCount"));
  // The headline numbers live in the board panel in the hero.
  ok("the board shows the match count", T("boardMatches") === "8", T("boardMatches"));
  ok("the board shows the win count", T("boardWins") === "6", T("boardWins"));
  ok("the board shows a win rate", /%/.test(T("boardWinRate")), T("boardWinRate"));
  ok("the board shows the prize money", T("boardPrize").indexOf("₹") === 0, T("boardPrize"));
  ok("the board shows the team name", T("boardName") === teamData.name, T("boardName"));
  ok("the board shows the city", T("boardCity") === teamData.city, T("boardCity"));
  // The season follows the archive: the records run from Dec 2025 to
  // Feb 2026, so the board must show that window, not a fixed year.
  ok("the board shows the season window", T("boardSeasonValue") === "2025–2026", T("boardSeasonValue"));
  ok("the recent form strip rendered", doc.querySelectorAll("#formRow .form-dot").length === 8);
  ok("the sample banner is visible while samples exist", !doc.getElementById("demoBanner").hidden);
  ok("the stats grid rendered", doc.querySelectorAll("#statsGrid .stat").length >= 12, doc.querySelectorAll("#statsGrid .stat").length);
  ok("the mode breakdown rendered", doc.querySelectorAll("#breakdownModes .breakdown__row").length === 3);
  ok(
    "the mode breakdown shows the full mode names",
    Array.from(doc.querySelectorAll("#breakdownModes .breakdown__key")).map((e) => e.textContent.trim()).join("|") ===
      "Clash Squad|Battle Royale|Lone Wolf",
    Array.from(doc.querySelectorAll("#breakdownModes .breakdown__key")).map((e) => e.textContent.trim()).join("|")
  );
  ok("the event breakdown rendered", doc.querySelectorAll("#breakdownEvents .breakdown__row").length > 0);

  // =========================================================================
  console.log("\n=== MODES RAIL ===");
  // The rail is navigation, not decoration: each card filters the archive.
  const modeCards = () => doc.querySelectorAll("#modeRail .mode");
  ok("the mode rail rendered three cards", modeCards().length === 3, modeCards().length + " cards");
  ok(
    "the mode rail shows the full mode names",
    Array.from(modeCards()).map((c) => c.querySelector(".mode__name").textContent.trim()).join("|") ===
      "Clash Squad|Battle Royale|Lone Wolf",
    Array.from(modeCards()).map((c) => c.querySelector(".mode__name").textContent.trim()).join("|")
  );
  ok(
    "the mode rail cards carry a mode link",
    Array.from(modeCards()).every((c) => c.getAttribute("data-mode-link")),
    Array.from(modeCards()).map((c) => c.getAttribute("data-mode-link")).join("|")
  );
  ok(
    "the mode rail shows a description for each mode",
    Array.from(modeCards()).every((c) => c.querySelector(".mode__desc").textContent.trim().length > 10),
    Array.from(modeCards()).map((c) => c.querySelector(".mode__desc").textContent.trim()).join(" | ")
  );
  ok(
    "the mode rail shows played and won counts",
    Array.from(modeCards()).every((c) => c.querySelectorAll(".mode__stat").length === 2),
    Array.from(modeCards()).map((c) => c.querySelectorAll(".mode__stat").length).join("|")
  );
  // The Clash Squad record is four matches, two of them won.
  {
    const cs = doc.querySelector('#modeRail [data-mode-link="CS"]');
    const stats = cs.querySelectorAll(".mode__stat b");
    ok("the Clash Squad card shows the played count", stats[0].textContent.trim() === "4", stats[0].textContent.trim());
    ok("the Clash Squad card shows the win count", stats[1].textContent.trim() === "2", stats[1].textContent.trim());
  }

  // =========================================================================
  console.log("\n=== BREAKDOWN BAR ===");
  // The bar is a split, not a single fill: the wins, the losses and the
  // neutral remainder are separate segments.
  {
    const row = doc.querySelector("#breakdownModes .breakdown__row");
    const bar = row.querySelector(".breakdown__bar");
    ok("the breakdown bar has segments", bar.querySelectorAll("span").length >= 2, bar.querySelectorAll("span").length + " segments");
    ok(
      "the breakdown bar has a win segment",
      bar.querySelector(".breakdown__bar-win") !== null
    );
    ok(
      "the breakdown bar has a loss segment",
      bar.querySelector(".breakdown__bar-loss") !== null
    );
    // The widest row fills the bar completely, so it has no remainder.
    // A narrower row does — that is what makes the bars comparable.
    const rows = Array.from(doc.querySelectorAll("#breakdownModes .breakdown__row"));
    const withRest = rows.filter((r) => r.querySelector(".breakdown__bar-rest") !== null);
    ok(
      "a narrower breakdown row carries a neutral remainder",
      withRest.length >= 1,
      withRest.length + " of " + rows.length + " rows have a remainder"
    );
    // The remainder fills whatever the wins and losses did not take.
    {
      const narrow = withRest[0];
      const segs = Array.from(narrow.querySelectorAll(".breakdown__bar span"));
      const total = segs.reduce((sum, sp) => sum + parseFloat((/--w:\s*([\d.]+)%/.exec(sp.getAttribute("style") || "") || [0, 0])[1]), 0);
      ok("the breakdown bar segments add up to 100%", Math.abs(total - 100) < 0.5, total.toFixed(2) + "%");
    }
    // The segments carry a width, so the bar is proportional rather than
    // a fixed-width decoration.
    ok(
      "the breakdown segments carry a width",
      Array.from(bar.querySelectorAll("span")).every((sp) => /--w:\s*[\d.]+%/.test(sp.getAttribute("style") || "")),
      Array.from(bar.querySelectorAll("span")).map((sp) => sp.getAttribute("style")).join(" | ")
    );
  }

  // =========================================================================
  console.log("\n=== ORDERING & CONTENT ===");
  const dates = Array.from(doc.querySelectorAll("#matchList .match__date")).map((e) => e.textContent.trim());
  ok("the newest match is first", dates[0] === "14 Feb 2026", dates[0]);
  ok("the oldest match is last", dates[dates.length - 1] === "20 Dec 2025", dates[dates.length - 1]);
  ok(
    "the list is newest-first",
    dates.join(" ") === "14 Feb 2026 07 Feb 2026 31 Jan 2026 24 Jan 2026 17 Jan 2026 10 Jan 2026 03 Jan 2026 20 Dec 2025",
    dates.join(" | ")
  );
  const firstCard = cards()[0];
  ok("the card shows the event name", firstCard.querySelector(".match__event").textContent.indexOf("Weekly Cup #12") !== -1);
  ok("the card shows the mode badge", firstCard.querySelector(".badge--mode").textContent.trim() === "Clash Squad", firstCard.querySelector(".badge--mode").textContent.trim());
  ok("the card shows the opponent", firstCard.querySelector(".match__opponent").textContent.trim() === "Team Velocity");
  ok("the card shows the score", firstCard.querySelector(".match__score").textContent.trim() === "3-1");
  ok("the card shows the result", firstCard.querySelector(".match__result").textContent.trim() === "W");
  ok("the card carries the result on the article", firstCard.getAttribute("data-result") === "W");
  ok("the card carries the record id", firstCard.getAttribute("data-id") === "demo-001");
  ok("the card shows the entry fee", firstCard.querySelector(".match__meta").textContent.indexOf("500") !== -1);
  ok("the card shows the prize", firstCard.querySelector(".match__meta").textContent.indexOf("10,000") !== -1);
  ok("the card shows the placement", firstCard.querySelector(".match__meta").textContent.indexOf("#1") !== -1);
  ok("the card shows the map", firstCard.querySelector(".match__meta").textContent.indexOf("Bermuda") !== -1);
  ok("the card is marked as a sample", firstCard.querySelector(".match__demo-tag") !== null);
  ok("the card shows the notes", firstCard.querySelector(".match__notes").textContent.indexOf("Sample record") === 0, firstCard.querySelector(".match__notes").textContent);

  // =========================================================================
  console.log("\n=== FILTERS ===");
  const chip = (group, value) =>
    doc.querySelector('#' + group + ' .chip[data-value="' + value + '"]');
  const click = (node) => node.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

  // =========================================================================
  console.log("\n=== MODE RAIL FILTERING ===");
  // Clicking a mode card applies that mode as a filter and lands the
  // visitor in the archive. It is a shortcut into the same list, not a
  // separate view.
  {
    const cs = doc.querySelector('#modeRail [data-mode-link="CS"]');
    click(cs);
    await settle();
    ok("a mode card filters the archive", cards().length === 4, cards().length + " cards");
    ok(
      "every visible card is that mode",
      Array.from(cards()).every((c) => c.querySelector(".badge--mode").textContent.trim() === "Clash Squad")
    );
    ok(
      "the mode chip follows the mode card",
      chip("chipMode", "CS").getAttribute("aria-pressed") === "true"
    );
    // Clicking the same card again clears the filter.
    click(doc.querySelector('#modeRail [data-mode-link="CS"]'));
    await settle();
    ok("clicking the same mode card clears the filter", cards().length === 8, cards().length + " cards");
    ok(
      "the mode chip is released",
      chip("chipMode", "CS").getAttribute("aria-pressed") === "false"
    );
  }

  click(chip("chipMode", "CS"));
  await settle();
  ok("filtering by CS narrows the list", cards().length === 4, cards().length + " cards");
  ok("the CS chip is pressed", chip("chipMode", "CS").getAttribute("aria-pressed") === "true");
  ok("the All chip is no longer pressed", chip("chipMode", "").getAttribute("aria-pressed") === "false");
  ok("the count follows the filter", T("resultCount").indexOf("4") === 0, T("resultCount"));
  ok(
    "the mode chip shows the full mode name",
    chip("chipMode", "CS").textContent.indexOf("Clash Squad") !== -1,
    chip("chipMode", "CS").textContent.trim()
  );
  ok(
    "every visible card is Clash Squad",
    Array.from(cards()).every((c) => c.querySelector(".badge--mode").textContent.trim() === "Clash Squad")
  );

  click(chip("chipMode", "CS"));
  await settle();
  ok("clicking the pressed chip clears the filter", cards().length === 8, cards().length + " cards");

  click(chip("chipResult", "W"));
  await settle();
  ok("filtering by win", cards().length === 6, cards().length + " cards");
  ok(
    "every visible card is a win",
    Array.from(cards()).every((c) => c.getAttribute("data-result") === "W")
  );

  click(chip("chipResult", "W"));
  await settle();
  ok("clearing the result filter restores the list", cards().length === 8, cards().length + " cards");
  click(chip("chipEvent", "Scrim"));
  await settle();
  ok("filtering by scrim", cards().length === 2, cards().length + " cards");

  click(chip("chipMode", "BR"));
  await settle();
  ok("filters combine (BR AND Scrim)", cards().length === 0, cards().length + " cards");
  ok("the empty state appears", !doc.getElementById("emptyState").hidden);
  ok("the match list is hidden", doc.getElementById("matchList").hidden);
  ok("the error state is still hidden", doc.getElementById("errorState").hidden);

  // The empty state has its own reset button, which used to be dead.
  click(doc.getElementById("resetBtnEmpty"));
  await settle();
  ok("the empty-state reset button clears the filters", cards().length === 8, cards().length + " cards");
  ok("the empty state is hidden again", doc.getElementById("emptyState").hidden);

  // =========================================================================
  console.log("\n=== YEAR FILTER ===");
  // The section intro promises a year filter, so it has to exist and it
  // has to actually narrow the list.
  ok("the year chip group exists", doc.getElementById("chipYear") !== null);
  const yearChips = Array.from(doc.querySelectorAll('#chipYear .chip[data-value]'));
  ok("the year group has an All chip", yearChips.some((c) => c.getAttribute("data-value") === ""));
  const yearValues = yearChips
    .map((c) => c.getAttribute("data-value"))
    .filter((v) => v !== "");
  ok("the year group lists 2025 and 2026", yearValues.join(",") === "2026,2025", yearValues.join(","));
  ok("the years are newest first", yearValues[0] === "2026", yearValues.join(","));

  click(chip("chipYear", "2026"));
  await settle();
  ok("filtering by 2026 narrows the list", cards().length === 7, cards().length + " cards");
  ok(
    "every visible card is from 2026",
    Array.from(cards()).every((c) => c.querySelector(".match__date").textContent.indexOf("2026") !== -1),
    Array.from(cards())
      .map((c) => c.querySelector(".match__date").textContent)
      .join(" | ")
  );
  ok("the 2026 chip is pressed", chip("chipYear", "2026").getAttribute("aria-pressed") === "true");
  ok("the count follows the year filter", T("resultCount").indexOf("7") === 0, T("resultCount"));

  click(chip("chipYear", "2025"));
  await settle();
  ok("switching the year replaces the filter", cards().length === 1, cards().length + " cards");
  ok(
    "the remaining card is the 2025 match",
    cards()[0].querySelector(".match__date").textContent.indexOf("20 Dec 2025") !== -1,
    cards()[0] ? cards()[0].querySelector(".match__date").textContent : "no card"
  );

  // The year filter has to combine with the other filters, not sit apart.
  click(chip("chipYear", "2026"));
  await settle();
  click(chip("chipMode", "CS"));
  await settle();
  ok("the year filter combines with the mode filter", cards().length === 3, cards().length + " cards");
  ok(
    "every visible card is Clash Squad from 2026",
    Array.from(cards()).every(
      (c) =>
        c.querySelector(".badge--mode").textContent.trim() === "Clash Squad" &&
        c.querySelector(".match__date").textContent.indexOf("2026") !== -1
    )
  );

  click(doc.getElementById("resetBtn"));
  await settle();
  ok("the reset button clears the year filter too", cards().length === 8, cards().length + " cards");
  ok("the All year chip is pressed again", chip("chipYear", "").getAttribute("aria-pressed") === "true");
  ok("the All mode chip is pressed again", chip("chipMode", "").getAttribute("aria-pressed") === "true");


  // =========================================================================
  console.log("\n=== SEARCH ===");
  const search = doc.getElementById("searchInput");
  search.value = "velocity";
  search.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle();
  ok("search matches on the opponent", cards().length === 1, cards().length + " cards");

  search.value = "purgatory";
  search.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle();
  ok("search is case-insensitive", cards().length === 1, cards().length + " cards");
  search.value = "Kalahari";
  search.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle();
  ok("search matches on the map", cards().length === 1, cards().length + " cards");
  // The full mode name is searchable, so a visitor can type what they
  // see on the card rather than the internal code.
  search.value = "lone wolf";
  search.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle();
  ok("search matches on the mode name", cards().length === 2, cards().length + " cards");
  search.value = "zzz-no-such-opponent";
  search.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle();
  ok("a search with no hits shows the empty state", !doc.getElementById("emptyState").hidden);

  search.value = "";
  search.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle();
  ok("clearing the search restores the list", cards().length === 8, cards().length + " cards");

  // =========================================================================
  console.log("\n=== RESET ===");
  click(chip("chipMode", "CS"));
  await settle();
  click(doc.getElementById("resetBtn"));
  await settle();
  ok("the reset button clears the mode filter", cards().length === 8, cards().length + " cards");
  ok("the reset button clears the search box", doc.getElementById("searchInput").value === "");
  ok("the All chip is pressed again", chip("chipMode", "").getAttribute("aria-pressed") === "true");

  // =========================================================================
  console.log("\n=== LANGUAGE TOGGLE ===");
  const toggle = doc.getElementById("langToggle");
  ok("the toggle starts in English", doc.documentElement.lang === "en");
  ok("the toggle says Hindi when in English", toggle.textContent.trim() === "हिंदी");
  ok("the toggle is not pressed", toggle.getAttribute("aria-pressed") === "false");

  const enHeading = doc.querySelector("#archive .h-section").textContent.trim();
  const enPlaceholder = doc.getElementById("searchInput").getAttribute("placeholder");
  const enCta = doc.querySelector(".hero__actions .btn--primary").textContent.trim();

  click(toggle);
  await settle();
  ok("the document language flips to Hindi", doc.documentElement.lang === "hi");
  ok("the toggle now says English", toggle.textContent.trim() === "English");
  ok("the toggle is pressed", toggle.getAttribute("aria-pressed") === "true");
  ok("the heading is translated", doc.querySelector("#archive .h-section").textContent.trim() !== enHeading);
  ok("the heading is in Devanagari", /[ऀ-ॿ]/.test(doc.querySelector("#archive .h-section").textContent));
  ok("the placeholder is translated", doc.getElementById("searchInput").getAttribute("placeholder") !== enPlaceholder);
  ok("the placeholder is in Devanagari", /[ऀ-ॿ]/.test(doc.getElementById("searchInput").getAttribute("placeholder")));
  ok("the CTA is translated", doc.querySelector(".hero__actions .btn--primary").textContent.trim() !== enCta);
  ok("the chips are rebuilt in Hindi", /[ऀ-ॿ]/.test(chip("chipMode", "").textContent));
  ok("the match cards survive the language switch", cards().length === 8, cards().length + " cards");
  ok("the board stats survive the language switch", T("boardMatches") === "8", T("boardMatches"));
  ok("the board season survives the language switch", T("boardSeasonValue") === "2025–2026", T("boardSeasonValue"));
  ok("the mode rail survives the language switch", doc.querySelectorAll("#modeRail .mode").length === 3, doc.querySelectorAll("#modeRail .mode").length + " mode cards");
  ok("the sample banner survives the language switch", !doc.getElementById("demoBanner").hidden);
  ok("the search label is translated", /[ऀ-ॿ]/.test(doc.querySelector('label[for="searchInput"]').textContent));
  ok("the nav label is translated", /[ऀ-ॿ]/.test(doc.getElementById("nav").getAttribute("aria-label")));
  ok("no stray backslash before Devanagari", !/\\[ऀ-ॿ]/.test(doc.body.textContent));
  ok("no doubled Devanagari characters", !/([ऀ-ॿ])\1/.test(doc.body.textContent));

  // The team description is owner-supplied copy, so the Hindi view needs
  // a Hindi variant of it. data/team.json carries one, and it must be
  // the version the Hindi page shows.
  ok(
    "the Hindi view shows the Hindi team description",
    T("teamAbout") === teamData.aboutHi,
    T("teamAbout")
  );
  ok(
    "the Hindi view shows the Hindi tagline",
    T("teamTagline") === teamData.taglineHi,
    T("teamTagline")
  );
  ok("the Hindi team description is in Devanagari", /[ऀ-ॿ]/.test(T("teamAbout")));

  click(toggle);
  await settle();
  ok("toggling back restores English", doc.documentElement.lang === "en");
  ok("the English heading comes back exactly", doc.querySelector("#archive .h-section").textContent.trim() === enHeading);
  ok("the English placeholder comes back exactly", doc.getElementById("searchInput").getAttribute("placeholder") === enPlaceholder);
  ok("the English CTA comes back exactly", doc.querySelector(".hero__actions .btn--primary").textContent.trim() === enCta);
  ok("the cards are still there", cards().length === 8, cards().length + " cards");

  // =========================================================================
  console.log("\n=== MOBILE MENU ===");
  const navToggle = doc.getElementById("navToggle");
  const nav = doc.getElementById("nav");
  ok("the burger exists", navToggle !== null);
  ok("the burger starts collapsed", navToggle.getAttribute("aria-expanded") === "false");
  ok("the burger has a label", !!navToggle.getAttribute("aria-label"));
  ok("the burger controls the nav", navToggle.getAttribute("aria-controls") === "nav");

  click(navToggle);
  await settle();
  ok("the burger opens the menu", navToggle.getAttribute("aria-expanded") === "true");
  ok("the nav gets the open class", nav.classList.contains("is-open"));
  ok("the open burger says Close menu", navToggle.getAttribute("aria-label") === "Close menu");

  click(navToggle);
  await settle();
  ok("the burger closes the menu", navToggle.getAttribute("aria-expanded") === "false");
  ok("the nav loses the open class", !nav.classList.contains("is-open"));

  click(navToggle);
  await settle();
  doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  ok("Escape closes the menu", navToggle.getAttribute("aria-expanded") === "false");

  click(navToggle);
  await settle();
  click(doc.querySelector('#nav a[href="#stats"]'));
  await settle();
  ok("tapping a nav link closes the menu", navToggle.getAttribute("aria-expanded") === "false");

  // =========================================================================
  console.log("\n=== TEAM SECTION ===");
  ok("the team name is rendered", T("brandName") === teamData.name, T("brandName"));
  ok("the team about text is rendered", T("teamAbout").length > 10);
  ok("the city is rendered", T("factCity") === teamData.city, T("factCity"));

  // The team copy is owner-supplied, so the Hindi view needs a Hindi
  // variant of it. When data/team.json carries one, the Hindi page must
  // show it — not the English text.
  {
    const hasHi = typeof teamData.aboutHi === "string" && teamData.aboutHi.length > 0;
    const hasTaglineHi = typeof teamData.taglineHi === "string" && teamData.taglineHi.length > 0;
    ok("the team data carries a Hindi description", hasHi);
    ok("the team data carries a Hindi tagline", hasTaglineHi);
    ok(
      "the English view shows the English description",
      T("teamAbout") === teamData.about,
      T("teamAbout")
    );
    ok(
      "the English view shows the English tagline",
      T("teamTagline") === teamData.tagline,
      T("teamTagline")
    );
  }
  ok("the email is a mailto link", doc.getElementById("factEmail").getAttribute("href") === "mailto:" + teamData.email);
  ok(
    "the whatsapp link is a wa.me link",
    doc.getElementById("factWhatsapp").getAttribute("href") === "https://wa.me/" + teamData.whatsapp,
    doc.getElementById("factWhatsapp").getAttribute("href")
  );
  ok(
    "the contact whatsapp button is a wa.me link",
    doc.getElementById("contactWhatsapp").getAttribute("href") === "https://wa.me/" + teamData.whatsapp
  );
  ok(
    "the contact email button is a mailto link",
    doc.getElementById("contactEmail").getAttribute("href") === "mailto:" + teamData.email
  );
  ok("the footer year is the current year", T("footerYear") === String(new Date().getFullYear()), T("footerYear"));

  // A team value that is not set must not stay a live link. Leaving
  // href="#" behind makes "Not set" a dead control: focusable, styled
  // like a link, and clicking it jumps the page to the top.
  {
    const unset = doc.getElementById("factInstagram");
    ok(
      "an unset social link has no href",
      !unset.getAttribute("href"),
      unset.getAttribute("href")
    );
    ok("an unset social link is marked as not set", unset.getAttribute("data-not-set") === "true");
    ok("an unset social link is announced as disabled", unset.getAttribute("aria-disabled") === "true");
    ok("an unset social link shows the not-set text", unset.textContent.trim() === "Not set", unset.textContent);

    // A value that IS set must still be a working link.
    const email = doc.getElementById("factEmail");
    ok("a set email link keeps its mailto href", email.getAttribute("href") === "mailto:" + teamData.email);
    ok("a set email link is not marked as not set", !email.getAttribute("data-not-set"));
    ok("a set email link is not disabled", !email.getAttribute("aria-disabled"));
  }

  // =========================================================================
  console.log("\n=== NO-JS FALLBACK ===");
  {
    // The .js class is what hides the reveal-animated content. If the
    // class were added by a script that runs late, content would flash.
    const raw = html;
    ok("the js class is set inline in the head", /<script>\s*document\.documentElement\.classList\.add\("js"\)/.test(raw));
    ok("the inline js script comes before the stylesheet end", raw.indexOf('classList.add("js")') < raw.indexOf("</head>"));
  }

  // =========================================================================
  console.log("\n=== GAME IDENTITY ===");
  // The archive is a Free Fire MAX record. The mode codes stay short in
  // the data, but the page has to show the official mode names, and no
  // part of the page may name a mode or a map from a different game.
  {
    const pageText = doc.body.textContent;
    ok(
      "the page names Free Fire MAX",
      /free fire max/i.test(pageText),
      pageText.slice(0, 120)
    );
    ok(
      "the page does not name another game",
      !/counter.?strike|lucky wheel|valorant/i.test(pageText)
    );
    ok(
      "the page shows the Clash Squad mode name",
      pageText.indexOf("Clash Squad") !== -1
    );
    ok(
      "the page shows the Battle Royale mode name",
      pageText.indexOf("Battle Royale") !== -1
    );
    ok(
      "the page shows the Lone Wolf mode name",
      pageText.indexOf("Lone Wolf") !== -1
    );
    // The raw codes are internal, so they must not leak into the page.
    ok(
      "the bare mode codes are not shown as badges",
      Array.from(doc.querySelectorAll("#matchList .badge--mode")).every(
        (b) => b.textContent.trim() !== "CS" && b.textContent.trim() !== "BR" && b.textContent.trim() !== "LW"
      )
    );
  }

  // =========================================================================
  console.log("\n=== ERROR STATE ===");
  {
    const w2 = makeWindow({ failMatches: true });
    await settle();
    const d2 = w2.document;
    ok("the error state is shown when the data fails", !d2.getElementById("errorState").hidden);
    ok("the skeleton is hidden on error", d2.getElementById("skeleton").hidden);
    ok("the match list is hidden on error", d2.getElementById("matchList").hidden);
    ok("no match cards are rendered on error", d2.querySelectorAll("#matchList .match").length === 0);
    ok("the empty state is hidden on error", d2.getElementById("emptyState").hidden);
  }

  // =========================================================================
  console.log("\n=== EMPTY ARCHIVE ===");
  {
    const w3 = makeWindow({ matches: { schemaVersion: 1, matches: [] } });
    await settle();
    const d3 = w3.document;
    ok("an empty archive renders no cards", d3.querySelectorAll("#matchList .match").length === 0);
    ok("an empty archive shows the empty state", !d3.getElementById("emptyState").hidden);
    ok("an empty archive shows a zero match count", d3.getElementById("boardMatches").textContent.trim() === "0");
    ok("an empty archive does not error", d3.getElementById("errorState").hidden);
  }

  // =========================================================================
  console.log("\n=== ESCAPING ===");
  {
    const hostile = {
      schemaVersion: 1,
      matches: [
        {
          id: '"><img src=x onerror=alert(1)>',
          date: "2026-05-05",
          mode: "CS",
          event: "Tournament",
          eventName: '<script>alert("xss")</script>',
          map: "Bermuda",
          opponent: '"><b>bold</b>',
          score: "3-1",
          result: "W",
          entryFee: 100,
          prize: 200,
          notes: "safe & sound"
        }
      ]
    };
    const w4 = makeWindow({ matches: hostile });
    await settle();
    const d4 = w4.document;
    ok("no injected element is created", d4.querySelectorAll("#matchList img").length === 0);
    ok("no injected script is created", d4.querySelectorAll("#matchList script").length === 0);
    ok("no injected bold is created", d4.querySelectorAll("#matchList b").length === 0);
    ok("the hostile text is shown as text", d4.querySelector("#matchList .match__opponent").textContent.indexOf("<b>") !== -1);
    // The id contains a double quote and a bracket. The RAW string app.js
    // produced must entity-encode both, so the quote cannot terminate
    // the attribute early and the bracket cannot start a tag.
    //
    // The innerHTML getter cannot be used for this: it re-serialises the
    // parsed DOM, and the serialiser is allowed to leave a bare "<"
    // inside a quoted attribute value.
    const card4 = d4.querySelector("#matchList .match");
    const rawId = card4.getAttribute("data-id");
    const raw = w4.__captured.value;
    const QUOT = String.fromCharCode(34);
    const quotEntity = "&" + "quo" + "t;";
    ok("the quote is entity-encoded in the raw output", raw.indexOf("data-id=" + QUOT + quotEntity) !== -1, raw.slice(0, 180));
    ok("the angle bracket is entity-encoded in the raw output", raw.indexOf("&lt;img") !== -1);
    ok("no unescaped quote leaks inside the id attribute", raw.indexOf("onerror=alert(1)>" + QUOT) === -1);
    ok("the id round-trips to the original value", rawId === hostile.matches[0].id, JSON.stringify(rawId));
  }

  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(fail > 0 ? 1 : 0);
})().catch(function (err) {
  console.error("SUITE CRASHED:", err);
  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(1);
});
