// admin.test.js — the admin panel end-to-end.
//
// The panel is the only way the owner changes the public archive, so it
// gets the same treatment as the public page: real files, real DOM, real
// click handlers.
//
// The password is supplied out-of-band via the ADMIN_PASSWORD environment
// variable. It is NOT stored in this repository. Without it the suite
// skips itself — the hash guard in admin-hash.test.js still runs.
//
// Run: ADMIN_PASSWORD='...' node tests/admin.test.js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/root/lint-tools/node_modules/jsdom");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const html = rd("admin/index.html");
const adminJs = rd("admin/js/admin.js");
const matchData = JSON.parse(rd("data/matches.json"));
const teamData = JSON.parse(rd("data/team.json"));

const PASSWORD = process.env.ADMIN_PASSWORD;

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
const settle = () => tick(140);

function makeWindow(opts) {
  const o = opts || {};
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://127.0.0.1:8899/admin/"
  });
  const w = dom.window;
  w.fetch = function (url) {
    const name = String(url).split("/").pop();
    if (name === "matches.json") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(matchData) });
    }
    if (name === "team.json") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(teamData) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
  // jsdom has no <dialog>.showModal(), so the panel needs a stand-in.
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.confirm = function () {
    return o.confirm !== false;
  };
  w.TextEncoder = TextEncoder;
  w.eval(adminJs);
  return w;
}

const click = (w, node) => node.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const submit = (w, node) =>
  node.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));

(async () => {
  // =========================================================================
  console.log("\n=== GATE ===");
  const w = makeWindow();
  const doc = w.document;
  await settle();

  ok("the gate is shown at boot", !doc.getElementById("pinGate").hidden);
  ok("the panel is hidden at boot", doc.getElementById("adminPanel").hidden);
  ok("the password field is a password input", doc.getElementById("pinInput").type === "password");
  ok("the password field has a label", !!doc.querySelector('label[for="pinInput"]'));
  ok("the admin page is noindex", /noindex/.test(html));

  // A wrong password must not open the panel.
  doc.getElementById("pinInput").value = "definitely-wrong";
  submit(w, doc.getElementById("pinForm"));
  await settle();
  ok("a wrong password shows the error", !doc.getElementById("pinError").hidden);
  ok("a wrong password does not open the panel", doc.getElementById("adminPanel").hidden);
  ok("a wrong password clears the field", doc.getElementById("pinInput").value === "");
  ok("the old demo PIN does not work", await (async () => {
    const w2 = makeWindow();
    // The panel wires its listeners on DOMContentLoaded, so the window
    // has to settle before it can be interacted with.
    await settle();
    const d2 = w2.document;
    d2.getElementById("pinInput").value = "1234";
    submit(w2, d2.getElementById("pinForm"));
    await settle();
    return d2.getElementById("adminPanel").hidden;
  })());

  if (!PASSWORD) {
    console.log("\n⏭️  ADMIN_PASSWORD not set — skipping the authenticated suite.");
    console.log("   (the gate rejection checks above still ran)");
    console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
    process.exit(fail > 0 ? 1 : 0);
  }

  // =========================================================================
  console.log("\n=== UNLOCK ===");
  doc.getElementById("pinInput").value = PASSWORD;
  submit(w, doc.getElementById("pinForm"));
  await settle();
  ok("the correct password opens the panel", !doc.getElementById("adminPanel").hidden);
  ok("the gate is hidden after unlock", doc.getElementById("pinGate").hidden);
  ok("the password field is cleared", doc.getElementById("pinInput").value === "");
  ok("the records loaded from the published file", doc.querySelectorAll("#itemList .row").length === 8, doc.querySelectorAll("#itemList .row").length);
  ok("the record count is shown", /8 records/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
  ok("the win count is shown", /6 wins/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
  ok("the sample count is shown", /8 sample/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
  ok("the team form is filled", doc.getElementById("teamName").value === teamData.name, doc.getElementById("teamName").value);
  ok("the newest record is listed first", doc.querySelector("#itemList .row .row__date").textContent.trim() === "2026-02-14", doc.querySelector("#itemList .row .row__date").textContent);

  // =========================================================================
  console.log("\n=== ADD ===");
  click(w, doc.getElementById("btnAdd"));
  await settle();
  ok("the editor opens", doc.getElementById("editDialog").open === true);
  ok("the dialog title says Add", doc.getElementById("dialogTitle").textContent.trim() === "Add match");
  ok("the mode select is populated", doc.getElementById("editMode").options.length === 3);
  // The admin must show the official Free Fire MAX mode names, so the
  // owner cannot publish a record with the wrong vocabulary.
  ok(
    "the mode select names the Free Fire MAX modes",
    Array.from(doc.getElementById("editMode").options)
      .map((o) => o.textContent)
      .join("|") === "CS — Clash Squad|BR — Battle Royale|LW — Lone Wolf",
    Array.from(doc.getElementById("editMode").options)
      .map((o) => o.textContent)
      .join("|")
  );
  ok("the event select is populated", doc.getElementById("editEvent").options.length === 5);
  ok("the result select is populated", doc.getElementById("editResult").options.length === 3);

  // Submit with an empty form: the required fields must block it.
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok("an empty form is rejected", doc.getElementById("editDialog").open === true);
  ok("the error is shown", !doc.getElementById("editError").hidden);
  ok("the error is announced", doc.getElementById("editError").getAttribute("role") === "alert");
  ok("no record was added", doc.querySelectorAll("#itemList .row").length === 8);

  // A missing event name.
  doc.getElementById("editDate").value = "2026-05-05";
  doc.getElementById("editEventName").value = "";
  doc.getElementById("editOpponent").value = "Test Squad";
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok("a missing event name is rejected", /event name/i.test(doc.getElementById("editError").textContent), doc.getElementById("editError").textContent);

  // A missing opponent.
  doc.getElementById("editEventName").value = "Test Cup";
  doc.getElementById("editOpponent").value = "";
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok("a missing opponent is rejected", /opponent/i.test(doc.getElementById("editError").textContent), doc.getElementById("editError").textContent);

  // A bad date.
  doc.getElementById("editOpponent").value = "Test Squad";
  doc.getElementById("editDate").value = "05-05-2026";
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok("a bad date is rejected", /date/i.test(doc.getElementById("editError").textContent), doc.getElementById("editError").textContent);

  // A valid record.
  doc.getElementById("editDate").value = "2026-05-05";
  doc.getElementById("editMode").value = "BR";
  doc.getElementById("editEvent").value = "Tournament";
  doc.getElementById("editEventName").value = "Test Cup 2026";
  doc.getElementById("editMap").value = "Bermuda";
  doc.getElementById("editOpponent").value = "Test Squad";
  doc.getElementById("editScore").value = "3-1";
  doc.getElementById("editResult").value = "W";
  doc.getElementById("editPlacement").value = "2";
  doc.getElementById("editEntryFee").value = "250";
  doc.getElementById("editPrize").value = "1500";
  doc.getElementById("editNotes").value = "A test record.";
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok("a valid record is saved", doc.querySelectorAll("#itemList .row").length === 9, doc.querySelectorAll("#itemList .row").length);
  ok("the dialog closes after saving", doc.getElementById("editDialog").open === false);
  ok("the error is cleared", doc.getElementById("editError").hidden);
  ok("the new record is in the list", doc.getElementById("itemList").textContent.indexOf("Test Cup 2026") !== -1);
  ok("the new record is the newest", doc.querySelector("#itemList .row .row__date").textContent.trim() === "2026-05-05");
  ok("the count updates", /9 records/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
  ok("the draft is saved to localStorage", !!w.localStorage.getItem("nf_admin_matches"));
  ok("the draft is a wrapper, not a bare array", (function () {
    const parsed = JSON.parse(w.localStorage.getItem("nf_admin_matches"));
    return parsed && Array.isArray(parsed.records);
  })());

  // =========================================================================
  console.log("\n=== EDIT ===");
  {
    const rows = doc.querySelectorAll("#itemList .row");
    const target = Array.from(rows).find((r) => r.textContent.indexOf("Test Cup 2026") !== -1);
    click(w, target.querySelector('button[data-action="edit"]'));
    await settle();
    ok("the editor opens for an existing record", doc.getElementById("editDialog").open === true);
    ok("the dialog title says Edit", doc.getElementById("dialogTitle").textContent.trim() === "Edit match");
    ok("the event name is prefilled", doc.getElementById("editEventName").value === "Test Cup 2026");
    ok("the opponent is prefilled", doc.getElementById("editOpponent").value === "Test Squad");
    ok("the prize is prefilled", doc.getElementById("editPrize").value === "1500");

    doc.getElementById("editPrize").value = "2500";
    doc.getElementById("editEventName").value = "Test Cup 2026 (edited)";
    submit(w, doc.getElementById("editForm"));
    await settle();
    ok("the edit is saved", doc.getElementById("itemList").textContent.indexOf("Test Cup 2026 (edited)") !== -1);
    ok("the edit did not add a record", doc.querySelectorAll("#itemList .row").length === 9, doc.querySelectorAll("#itemList .row").length);
    ok("the new prize is shown", doc.getElementById("itemList").textContent.indexOf("₹2500") !== -1);
  }

  // =========================================================================
  console.log("\n=== DELETE ===");
  {
    const rows = doc.querySelectorAll("#itemList .row");
    const target = Array.from(rows).find((r) => r.textContent.indexOf("Test Cup 2026 (edited)") !== -1);
    click(w, target.querySelector('button[data-action="delete"]'));
    await settle();
    ok("the record is deleted", doc.querySelectorAll("#itemList .row").length === 8, doc.querySelectorAll("#itemList .row").length);
    ok("the deleted record is gone from the list", doc.getElementById("itemList").textContent.indexOf("Test Cup 2026") === -1);
  }

  // =========================================================================
  console.log("\n=== REMOVE SAMPLE RECORDS ===");
  {
    ok("the sample records are still there", /8 sample/.test(doc.getElementById("itemCount").textContent));
    click(w, doc.getElementById("btnRemoveDemo"));
    await settle();
    ok("the sample records are removed", doc.querySelectorAll("#itemList .row").length === 0, doc.querySelectorAll("#itemList .row").length);
    ok("the empty message is shown", /No records yet/.test(doc.getElementById("itemList").textContent));
    ok("the count updates", /0 records/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
    ok("the status reports the removal", /Removed 8 sample/.test(doc.getElementById("status").textContent), doc.getElementById("status").textContent);

    // Removing again is a no-op, not an error.
    click(w, doc.getElementById("btnRemoveDemo"));
    await settle();
    ok("removing again is a no-op", /no sample records/.test(doc.getElementById("status").textContent), doc.getElementById("status").textContent);
  }

  // =========================================================================
  console.log("\n=== EMPTY DRAFT IS NOT 'NO DRAFT' ===");
  {
    // The draft now holds zero records. Reloading the panel must NOT
    // silently restore the eight published records — that would undo the
    // owner's delete-all.
    const w2 = makeWindow();
    await settle();
    const d2 = w2.document;
    // Seed the same empty-draft state.
    w2.localStorage.setItem(
      "nf_admin_matches",
      JSON.stringify({ records: [], team: null, savedAt: new Date().toISOString() })
    );
    d2.getElementById("pinInput").value = PASSWORD;
    submit(w2, d2.getElementById("pinForm"));
    await settle();
    ok("an empty draft is preserved, not overwritten", d2.querySelectorAll("#itemList .row").length === 0, d2.querySelectorAll("#itemList .row").length);
    ok("the panel reports unsaved changes", /Unsaved changes/.test(d2.getElementById("status").textContent), "[" + d2.getElementById("status").textContent + "] panelHidden=" + d2.getElementById("adminPanel").hidden);
  }

  // =========================================================================
  console.log("\n=== PUBLISH PATH ===");
  {
    // The token is never written to storage.
    doc.getElementById("tokenInput").value = "nftoken_TESTONLY_marker_001";
    ok("the token field is a password input", doc.getElementById("tokenInput").type === "password");
    ok("the token is not in localStorage", w.localStorage.getItem("nf_admin_matches").indexOf("nftoken_TESTONLY_marker_001") === -1);
    ok("the token is not in the team key", String(w.localStorage.getItem("nf_admin_team")).indexOf("nftoken_TESTONLY_marker_001") === -1);
    ok("the token is not in the page source", adminJs.indexOf("nftoken_TESTONLY_marker_001") === -1);
  }

  // =========================================================================
  console.log("\n=== EXPORT ===");
  {
    // The download helper is exercised through a Blob capture.
    let downloaded = null;
    const origCreate = w.URL.createObjectURL;
    w.URL.createObjectURL = function (blob) {
      downloaded = blob;
      return "blob:fake";
    };
    w.URL.revokeObjectURL = function () {};

    click(w, doc.getElementById("btnExportMatches"));
    await settle();
    ok("the matches export produces a file", downloaded !== null);
    ok("the export is reported in the status", /Downloaded matches.json/.test(doc.getElementById("status").textContent), doc.getElementById("status").textContent);
    w.URL.createObjectURL = origCreate;
  }

  // =========================================================================
  console.log("\n=== TEAM FORM ===");
  {
    doc.getElementById("teamName").value = "NightForge XI";
    doc.getElementById("teamCity").value = "Mumbai, India";
    doc.getElementById("teamEmail").value = "team@example.com";
    doc.getElementById("teamWhatsapp").value = "919876543210";
    doc.getElementById("teamTaglineHi").value = "Free Fire MAX प्रतिस्पर्धा टीम";
    doc.getElementById("teamAboutHi").value = "यह पूरा मैच रिकॉर्ड है।";
    submit(w, doc.getElementById("teamForm"));
    await settle();
    ok("the team details are saved", /Team details saved/.test(doc.getElementById("status").textContent), doc.getElementById("status").textContent);
    ok("the team draft is in localStorage", (String(w.localStorage.getItem("nf_admin_team")).indexOf("NightForge XI") !== -1));
    // The Hindi team copy is optional, but when it is supplied it has to
    // survive the save so the public page can show it in the Hindi view.
    ok("the Hindi tagline is saved", (function () {
      const parsed = JSON.parse(w.localStorage.getItem("nf_admin_team"));
      return parsed.taglineHi === "Free Fire MAX प्रतिस्पर्धा टीम";
    })());
    ok("the Hindi about text is saved", (function () {
      const parsed = JSON.parse(w.localStorage.getItem("nf_admin_team"));
      return parsed.aboutHi === "यह पूरा मैच रिकॉर्ड है।";
    })());
    ok("the logo text is derived from the name", (function () {
      const parsed = JSON.parse(w.localStorage.getItem("nf_admin_team"));
      return parsed.logoText === "NI";
    })());
  }

  // =========================================================================
  console.log("\n=== LOCK ===");
  {
    doc.getElementById("tokenInput").value = "nftoken_TESTONLY_marker_002";
    click(w, doc.getElementById("btnLock"));
    await settle();
    ok("locking hides the panel", doc.getElementById("adminPanel").hidden);
    ok("locking shows the gate", !doc.getElementById("pinGate").hidden);
    ok("locking clears the token field", doc.getElementById("tokenInput").value === "");
    ok("the token was never persisted", w.localStorage.getItem("nf_admin_team").indexOf("nftoken_TESTONLY_marker_002") === -1);
  }

  // =========================================================================
  console.log("\n=== DISCARD LOCAL CHANGES ===");
  {
    click(w, doc.getElementById("btnLock"));
    await settle();
    // Unlock again — the draft is still in localStorage.
    doc.getElementById("pinInput").value = PASSWORD;
    submit(w, doc.getElementById("pinForm"));
    await settle();
    ok("the draft is restored on unlock", doc.querySelectorAll("#itemList .row").length === 0, doc.querySelectorAll("#itemList .row").length);

    click(w, doc.getElementById("btnResetAll"));
    await settle();
    ok("the published records come back after a discard", doc.querySelectorAll("#itemList .row").length === 8, doc.querySelectorAll("#itemList .row").length);
    ok("the team name is back from the published file", doc.getElementById("teamName").value === teamData.name, doc.getElementById("teamName").value);
  }

  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(fail > 0 ? 1 : 0);
})().catch(function (err) {
  console.error("SUITE CRASHED:", err);
  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(1);
});