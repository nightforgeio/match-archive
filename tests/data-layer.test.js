// data-layer.test.js — the archive's data contract.
//
// The whole site hangs off two guarantees:
//   1. A record in ANY shape normalises to the SAME canonical shape, and
//   2. Every number on the page comes from computeStats() over that
//      canonical array.
//
// If either breaks, the stats section can disagree with the list it is
// describing. These tests pin both.
//
// Run: node tests/data-layer.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

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

// --- Load js/data.js in a sandbox ------------------------------------------
// It only needs `window`, so a tiny fake is enough and much faster than
// spinning up a DOM.
function loadDataModule() {
  const sandbox = { window: {}, console: console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(rd("js/data.js"), sandbox);
  return sandbox.window.ArchiveData;
}

const A = loadDataModule();
const published = JSON.parse(rd("data/matches.json"));
const teamFile = JSON.parse(rd("data/team.json"));

console.log("\n=== MODULE EXPORTS ===");
ok("exports loadAll", typeof A.loadAll === "function");
ok("exports computeStats", typeof A.computeStats === "function");
ok("exports normalizeMatch", typeof A.normalizeMatch === "function");
ok("exports sortMatches", typeof A.sortMatches === "function");
ok("exports parseDate", typeof A.parseDate === "function");
ok("exports formatMoney", typeof A.formatMoney === "function");
ok("MODES is CS/BR/LW", JSON.stringify(A.MODES) === '["CS","BR","LW"]', JSON.stringify(A.MODES));
ok("MODE_LABELS names every mode", A.MODES.every((m) => !!A.MODE_LABELS[m]), JSON.stringify(A.MODE_LABELS));
ok("CS is Clash Squad", A.MODE_LABELS.CS === "Clash Squad", A.MODE_LABELS.CS);
ok("BR is Battle Royale", A.MODE_LABELS.BR === "Battle Royale", A.MODE_LABELS.BR);
ok("LW is Lone Wolf", A.MODE_LABELS.LW === "Lone Wolf", A.MODE_LABELS.LW);
ok("RESULTS is W/L/D", JSON.stringify(A.RESULTS) === '["W","L","D"]', JSON.stringify(A.RESULTS));
ok("EVENTS has 5 types", A.EVENTS.length === 5, A.EVENTS.join(","));

console.log("\n=== DATE PARSING ===");
// The Date objects are created inside a vm context, so they come from a
// different realm and `instanceof Date` is false against the host realm.
// Duck-typing on the Date API is the correct check here.
const isDate = (v) => v !== null && typeof v.getTime === "function" && typeof v.getFullYear === "function";
ok("parses a valid date", isDate(A.parseDate("2026-02-14")));
ok("keeps the calendar day (no TZ shift)", A.parseDate("2026-02-14").getDate() === 14);
ok("rejects an empty string", A.parseDate("") === null);
ok("rejects null", A.parseDate(null) === null);
ok("rejects undefined", A.parseDate(undefined) === null);
ok("rejects a non ISO string", A.parseDate("14/02/2026") === null);
ok("rejects a partial date", A.parseDate("2026-02") === null);
ok("rejects month 13", A.parseDate("2026-13-01") === null);
ok("rejects day 32", A.parseDate("2026-01-32") === null);
ok("rejects 2026-02-31 (rollover)", A.parseDate("2026-02-31") === null);
ok("rejects 2025-02-29 (not a leap year)", A.parseDate("2025-02-29") === null);
ok("accepts 2024-02-29 (leap year)", isDate(A.parseDate("2024-02-29")));

console.log("\n=== NORMALISATION ===");
const n = A.normalizeMatch.bind(A);
{
  const m = n(
    {
      id: "x1",
      date: "2026-01-05",
      mode: "cs",
      event: "tournament",
      eventName: "  Weekly Cup  ",
      map: "  Bermuda ",
      opponent: "  Velocity ",
      score: "  3-1 ",
      result: "w",
      placement: "2",
      entryFee: "500",
      prize: "1000",
      notes: "  good game ",
      demo: true
    },
    0
  );
  ok("uppercases a lowercase mode", m.mode === "CS", m.mode);
  ok("canonicalises event case", m.event === "Tournament", m.event);
  ok("uppercases a lowercase result", m.result === "W", m.result);
  ok("trims the event name", m.eventName === "Weekly Cup", JSON.stringify(m.eventName));
  ok("trims the map", m.map === "Bermuda", JSON.stringify(m.map));
  ok("trims the opponent", m.opponent === "Velocity", JSON.stringify(m.opponent));
  ok("trims the score", m.score === "3-1", JSON.stringify(m.score));
  ok("trims the notes", m.notes === "good game", JSON.stringify(m.notes));
  ok("coerces a string placement to a number", m.placement === 2, m.placement);
  ok("coerces a string entry fee to a number", m.entryFee === 500, m.entryFee);
  ok("coerces a string prize to a number", m.prize === 1000, m.prize);
  ok("keeps the demo flag", m.demo === true);
  ok("marks a valid date", m.dateValid === true);
  ok("marks a valid mode", m.modeValid === true);
}

{
  const m = n({ date: "2026-13-99", mode: "XY", event: "Freestyle", result: "Q" }, 3);
  ok("flags an invalid date", m.dateValid === false);
  ok("flags an invalid mode", m.modeValid === false);
  ok("an unknown mode becomes empty", m.mode === "", m.mode);
  ok("an unknown event becomes Other", m.event === "Other", m.event);
  ok("an unknown result becomes empty", m.result === "", m.result);
  ok("a missing id is generated", typeof m.id === "string" && m.id.length > 0, m.id);
  ok("a missing placement becomes null", m.placement === null);
  ok("a negative entry fee becomes 0", m.entryFee === 0);
  ok("a negative prize becomes 0", n({ entryFee: -5, prize: -1 }, 0).prize === 0);
  ok("a zero placement becomes null", n({ placement: 0 }, 0).placement === null);
  ok("a negative placement becomes null", n({ placement: -3 }, 0).placement === null);
  ok("a non-numeric fee becomes 0", n({ entryFee: "abc" }, 0).entryFee === 0);
  ok("demo defaults to false", n({}, 0).demo === false);
}

console.log("\n=== SORTING ===");
// mapRaw -> normalise a list of raw records the way loadAll() does.
const mapRaw = (list) => list.map((raw, i) => n(raw, i));
{
  const list = mapRaw([
    { id: "a", date: "2026-01-01" },
    { id: "b", date: "2026-03-01" },
    { id: "c", date: "2026-02-01" },
  ]);
  const sorted = A.sortMatches(list);
  ok("sorts newest first", sorted[0].id === "b" && sorted[2].id === "a", sorted.map((x) => x.id).join(","));
}
{
  const list = mapRaw([
    { id: "bad", date: "not-a-date" },
    { id: "good", date: "2026-01-01" },
  ]);
  const sorted = A.sortMatches(list);
  ok("an unparseable date sinks to the bottom", sorted[sorted.length - 1].id === "bad");
}
{
  const list = mapRaw([
    { id: "b", date: "2026-01-01" },
    { id: "a", date: "2026-01-01" },
  ]);
  const sorted = A.sortMatches(list);
  ok("ties break by id", sorted[0].id === "a", sorted.map((x) => x.id).join(","));
}
{
  const src = mapRaw([{ id: "a", date: "2026-01-01" }]);
  A.sortMatches(src);
  ok("sortMatches does not mutate its input", src.length === 1);
}

console.log("\n=== STATS ===");
{
  const ms = mapRaw([
    { id: "1", date: "2026-01-01", mode: "CS", event: "Tournament", result: "W", entryFee: 500, prize: 10000, placement: 1 },
    { id: "2", date: "2026-01-02", mode: "CS", event: "Tournament", result: "L", entryFee: 500, prize: 0, placement: 5 },
    { id: "3", date: "2026-01-03", mode: "BR", event: "Scrim", result: "D", entryFee: 0, prize: 0, placement: null },
  ]);
  const s = A.computeStats(ms);
  ok("counts the total", s.total === 3, s.total);
  ok("counts the wins", s.wins === 1, s.wins);
  ok("counts the losses", s.losses === 1, s.losses);
  ok("counts the draws", s.draws === 1, s.draws);
  ok("win rate counts decided matches only", Math.abs(s.winRate - 50) < 0.001, s.winRate);
  ok("sums the prize money", s.totalPrize === 10000, s.totalPrize);
  ok("sums the entry fees", s.totalEntry === 1000, s.totalEntry);
  ok("computes the net", s.net === 9000, s.net);
  ok("computes the average prize", Math.abs(s.avgPrize - 10000 / 3) < 0.001, s.avgPrize);
  ok("groups by mode", s.modes.length === 2, JSON.stringify(s.modes.map((m) => m.key)));
  ok("groups by event", s.events.length === 2, JSON.stringify(s.events.map((m) => m.key)));
  ok("sorts groups by matches played", s.modes[0].key === "CS", s.modes[0].key);
  ok("tracks the first date", s.firstDate.getFullYear() === 2026 && s.firstDate.getDate() === 1);
  ok("tracks the last date", s.lastDate.getDate() === 3);
  ok("tracks the best placement", s.bestPlacement === 1, s.bestPlacement);
  ok("counts the demo records", s.demoCount === 0);
}
{
  const s = A.computeStats([]);
  ok("empty stats do not divide by zero", s.winRate === 0, s.winRate);
  ok("empty stats have a zero average", s.avgPrize === 0);
  ok("empty stats have no first date", s.firstDate === null);
  ok("empty stats have no best placement", s.bestPlacement === null);
  ok("empty stats have no modes", s.modes.length === 0);
}
{
  // A draw is not a win and must not dilute the win rate.
  const ms = mapRaw([
    { id: "1", date: "2026-01-01", result: "W" },
    { id: "2", date: "2026-01-02", result: "W" },
    { id: "3", date: "2026-01-03", result: "D" },
    { id: "4", date: "2026-01-04", result: "D" },
  ]);
  const s = A.computeStats(ms);
  ok("2 wins out of 2 decided = 100%", Math.abs(s.winRate - 100) < 0.001, s.winRate);
}

console.log("\n=== MONEY FORMATTING ===");
ok("formats 1000 as Indian grouping", A.formatMoney(100000, "en") === "₹1,00,000", A.formatMoney(100000, "en"));
ok("formats zero as an empty string", A.formatMoney(0, "en") === "");
ok("formats undefined as an empty string", A.formatMoney(undefined, "en") === "");
ok("formats NaN as an empty string", A.formatMoney(NaN, "en") === "");
ok("includes the rupee sign", A.formatMoney(500, "en").indexOf("₹") === 0, A.formatMoney(500, "en"));

console.log("\n=== PUBLISHED DATA FILE ===");
ok("data/matches.json has a matches array", Array.isArray(published.matches));
ok("data/matches.json declares schemaVersion 1", published.schemaVersion === 1);
ok("every published record has an id", published.matches.every((m) => !!m.id));
ok("every published record has a valid date", published.matches.every((m) => A.parseDate(m.date) !== null));
ok("every published record has a known mode", published.matches.every((m) => A.MODES.indexOf(m.mode) !== -1));
ok("every published record has a known result", published.matches.every((m) => A.RESULTS.indexOf(m.result) !== -1));
ok("every published record has an event type", published.matches.every((m) => A.EVENTS.indexOf(m.event) !== -1));
ok("no published record has a negative fee", published.matches.every((m) => m.entryFee >= 0));
ok("no published record has a negative prize", published.matches.every((m) => m.prize >= 0));
ok("the ids are unique", (function () {
  const ids = published.matches.map((m) => m.id);
  return new Set(ids).size === ids.length;
})());
ok("every published record is flagged as a sample", published.matches.every((m) => m.demo === true));
// The archive is a Free Fire MAX record. A map or note from a different
// game is a factual error that no schema check would catch, so the
// published data is checked for the vocabulary of the wrong game.
const WRONG_GAME = /mirage|inferno|dust ?ii|erangel|livik|nuketown|firing range|ancient|counter.?strike|lucky wheel|valorant/i;
const wrongGameRecords = published.matches.filter(function (m) {
  return (
    WRONG_GAME.test(m.map || "") ||
    WRONG_GAME.test(m.notes || "") ||
    WRONG_GAME.test(m.eventName || "")
  );
});
ok(
  "no published record names a map or mode from another game",
  wrongGameRecords.length === 0,
  JSON.stringify(wrongGameRecords.map((m) => m.id + ":" + m.map))
);
ok(
  "every published map is a Free Fire map",
  published.matches.every(function (m) {
    return /bermuda|purgatory|kalahari|alpine|nexterra|solara/i.test(m.map || "");
  }),
  JSON.stringify(published.matches.map((m) => m.map))
);

console.log("\n=== PUBLISHED TEAM FILE ===");
ok("data/team.json has a name", typeof teamFile.name === "string" && teamFile.name.length > 0);
ok("data/team.json has a city", typeof teamFile.city === "string" && teamFile.city.length > 0);
ok("the whatsapp number is digits only", /^[0-9]+$/.test(teamFile.whatsapp), teamFile.whatsapp);
ok("the whatsapp number has the country code", teamFile.whatsapp.slice(0, 2) === "91", teamFile.whatsapp);
// The team copy is the first thing a visitor reads. It has to name the
// game the archive is actually about.
ok("the team copy names Free Fire MAX", /free fire max/i.test(teamFile.tagline + " " + teamFile.about), teamFile.tagline);
ok("the team copy does not name another game", !/counter.?strike|lucky wheel|valorant/i.test(teamFile.tagline + " " + teamFile.about), teamFile.about);
ok("the Hindi team copy is present", typeof teamFile.aboutHi === "string" && teamFile.aboutHi.length > 0);
ok("the Hindi team copy names Free Fire MAX", /free fire max/i.test(teamFile.taglineHi + " " + teamFile.aboutHi), teamFile.taglineHi);
ok("the Hindi team copy does not name another game", !/counter.?strike|lucky wheel/i.test(teamFile.taglineHi + " " + teamFile.aboutHi), teamFile.aboutHi);

console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
