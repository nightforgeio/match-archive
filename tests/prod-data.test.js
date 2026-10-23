// prod-data.test.js — the PUBLISHED archive's integrity contract.
//
// The behavioral suites (app-dom, reveal, admin, data-layer) run against
// tests/fixtures/, which holds a rich dataset with demos and round scores
// so the renderers and interactions are exercised. THIS file checks the
// real shipped data/ files — the thing the public site actually serves.
//
// The production archive is what the owner publishes. It must be clean:
// no demo/sample records, a consistent schema, a roster that matches the
// squad, and no placeholder contact information.
//
// Run: node tests/prod-data.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

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

console.log("\n=== PRODUCTION ARCHIVE IS CLEAN ===");
ok(
  "the archive has a matches array",
  Array.isArray(published.matches)
);
ok("the archive declares schemaVersion 2", published.schemaVersion === 2);
ok(
  "every record has an id, valid date and known mode",
  published.matches.every(
    (m) =>
      !!m.id && A.parseDate(m.date) !== null && A.MODES.indexOf(m.mode) !== -1,
  )
);
ok(
  "no production record is a demo",
  published.matches.every((m) => m.demo !== true),
  JSON.stringify(published.matches.filter((m) => m.demo === true).map((m) => m.id))
);
ok(
  "no demo flag survives normalization",
  published.matches
    .map((m, i) => A.normalizeMatch(m, i))
    .every((m) => m.demo !== true)
);

console.log("\n=== PRODUCTION SCHEDULED FIXTURE ===");
const scheduled = published.matches.filter((m) => m.status === "scheduled");
const played = published.matches.filter((m) => m.status !== "scheduled");
ok("there is at least one scheduled fixture", scheduled.length > 0, scheduled.length);
ok(
  "every scheduled record has no result and no score",
  scheduled.every((m) => !m.result && !m.score)
);
ok(
  "every scheduled record keeps its open slot",
  scheduled.every(
    (m) => Array.isArray(m.roster) && m.roster.indexOf("") !== -1,
  )
);
ok(
  "every completed record carries a known result",
  played.every((m) => A.RESULTS.indexOf(m.result) !== -1)
);
ok(
  "the stats count only played records",
  (() => {
    const s = A.computeStats(published.matches.map((m, i) => A.normalizeMatch(m, i)));
    return s.total === played.length;
  })()
);

console.log("\n=== PRODUCTION TEAM ===");
ok("the team has a name", typeof teamFile.name === "string" && teamFile.name.length > 0);
ok("the team name is TEAM QUANTUM GAMING", teamFile.name === "TEAM QUANTUM GAMING", teamFile.name);
ok("the logo text is TQ", teamFile.logoText === "TQ", teamFile.logoText);
ok("the team names Free Fire MAX", /free fire max/i.test(teamFile.tagline + " " + teamFile.about));
ok("every roster player has a name and a role", teamFile.roster.every((p) => !!p.name && (p.roles || []).length > 0));
ok("the roster names are unique", new Set(teamFile.roster.map((p) => p.name)).size === teamFile.roster.length);
ok(
  "every roster role is a known role",
  teamFile.roster.every((p) => (p.roles || []).every((r) => A.ROLES.indexOf(r) !== -1))
);

console.log("\n=== PRODUCTION CONTACT PLACEHOLDERS ===");
const PLACEHOLDER_NUMBER = /^9+$/;
ok(
  "no placeholder phone number is published",
  !teamFile.whatsapp || !PLACEHOLDER_NUMBER.test(teamFile.whatsapp),
  teamFile.whatsapp
);
ok(
  "no placeholder email is published",
  !/hello@nightforge\.io/.test(teamFile.email || ""),
  teamFile.email
);

console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);