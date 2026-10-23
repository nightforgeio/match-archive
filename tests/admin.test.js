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
const aiJs = rd("admin/js/ai.js");
const matchData = JSON.parse(rd("tests/fixtures/matches.json"));
const teamData = JSON.parse(rd("tests/fixtures/team.json"));

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
  // The AI stub. A test can set w.__aiReply to make the assistant
  // answer with a record, or w.__aiError to make it fail.
  w.__aiReply = null;
  w.__aiError = null;
  w.fetch = function (url, init) {
    const name = String(url).split("/").pop();
    if (name === "matches.json") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(matchData) });
    }
    if (name === "team.json") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(teamData) });
    }
    if (name === "completions") {
      if (w.__aiError) {
        const e = w.__aiError;
        w.__aiError = null;
        return Promise.resolve({
          ok: false,
          status: e.status || 500,
          text: () => Promise.resolve(e.body || "{}"),
        });
      }
      if (w.__aiReply) {
        const reply = w.__aiReply;
        w.__aiReply = null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              model: "test-model",
              choices: [{ message: { content: reply } }],
            }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("{}"),
      });
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
  // The assistant is loaded first, exactly as the page loads it. The
  // panel degrades gracefully without it, but the suite exercises the
  // real thing.
  w.eval(aiJs);
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
  ok("the records loaded from the published file", doc.querySelectorAll("#itemList .row").length === 9, doc.querySelectorAll("#itemList .row").length);
ok("the record count separates played from scheduled", /8 played/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
ok("the win count is shown", /6 wins/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
ok("the sample count is shown", /8 sample/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
ok("the scheduled count is shown", /1 scheduled/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
ok("the team form is filled", doc.getElementById("teamName").value === teamData.name, doc.getElementById("teamName").value);
ok("the newest record is listed first", doc.querySelector("#itemList .row .row__date").textContent.trim().indexOf("2026-10-21") === 0, doc.querySelector("#itemList .row .row__date").textContent);
ok("the scheduled record is flagged as upcoming", /Upcoming/.test(doc.getElementById("itemList").textContent), doc.getElementById("itemList").textContent.replace(/\s+/g, " ").slice(0, 200));
  ok("the lineup is prefilled in the team form", doc.getElementById("teamRoster").value.indexOf("TQG.KΛIZEN07 | Sniper, IGL") !== -1, doc.getElementById("teamRoster").value);

  // =========================================================================
  // The AI assistant. The rules under test:
  //   1. It DRAFTS. It never saves and never publishes.
  //   2. The owner approves by pressing Save match.
  //   3. The key never reaches storage.
  //   4. The maths panel shows the archive totals before and after.
  console.log("\n=== AI ASSISTANT ===");
  ok("the AI section is in the panel", !!doc.getElementById("aiPrompt"));
  ok("the provider list is built", doc.getElementById("aiPreset").options.length >= 3, doc.getElementById("aiPreset").options.length);
  ok("the base URL is prefilled", doc.getElementById("aiBaseUrl").value !== "");
  ok("the model is prefilled", doc.getElementById("aiModel").value !== "");

  // The key is never written to storage.
  ok(
    "the API key is not in localStorage",
    !Object.keys(w.localStorage).some(function (k) {
      return w.localStorage.getItem(k).indexOf("sk-test") !== -1;
    })
  );

  // An empty prompt is refused before any request goes out.
  doc.getElementById("aiPrompt").value = "   ";
  click(w, doc.getElementById("btnAiDraft"));
  await settle();
  ok(
    "an empty prompt is refused",
    /type what happened/i.test(doc.getElementById("aiStatus").textContent),
    doc.getElementById("aiStatus").textContent
  );

  // A remote endpoint with no key is refused.
  doc.getElementById("aiBaseUrl").value = "https://api.openai.com/v1";
  doc.getElementById("aiKey").value = "";
  doc.getElementById("aiPrompt").value = "We won a match.";
  click(w, doc.getElementById("btnAiDraft"));
  await settle();
  ok(
    "a missing key is refused on a remote endpoint",
    /api key/i.test(doc.getElementById("aiStatus").textContent),
    doc.getElementById("aiStatus").textContent
  );

  // The full path: a key, a prompt, a model answer.
  const AI_REPLY = JSON.stringify({
    date: "2026-10-28",
    time: "18:30",
    status: "completed",
    mode: "BR",
    event: "Scrim",
    eventName: "NightForge Scrim Night",
    map: "Kalahari",
    opponent: "Squad 47",
    score: "1st - #3",
    result: "W",
    placement: 1,
    entryFee: 200,
    prize: 900,
    prizePerWinner: 0,
    roster: ["TQG.KΛIZEN07", "ASTROO!!", "TQG.ZYOTO17", ""],
    notes: "Won the scrim.",
  });
  w.__aiReply = AI_REPLY;
  doc.getElementById("aiKey").value = "sk-test";
  doc.getElementById("aiPrompt").value = "We won the scrim on 28 Oct, battle royale.";
  click(w, doc.getElementById("btnAiDraft"));
  await settle();

  ok(
    "the draft is reported as ready",
    /draft ready/i.test(doc.getElementById("aiStatus").textContent),
    doc.getElementById("aiStatus").textContent
  );
  ok("the editor opened with the draft", doc.getElementById("editDialog").open === true);
  ok("the drafted date is in the editor", doc.getElementById("editDate").value === "2026-10-28", doc.getElementById("editDate").value);
  ok("the drafted time is in the editor", doc.getElementById("editTime").value === "18:30", doc.getElementById("editTime").value);
  ok("the drafted mode is in the editor", doc.getElementById("editMode").value === "BR", doc.getElementById("editMode").value);
  ok("the drafted event is in the editor", doc.getElementById("editEvent").value === "Scrim", doc.getElementById("editEvent").value);
  ok("the drafted opponent is in the editor", doc.getElementById("editOpponent").value === "Squad 47", doc.getElementById("editOpponent").value);
  ok("the drafted map is in the editor", doc.getElementById("editMap").value === "Kalahari", doc.getElementById("editMap").value);
  ok("the drafted score is in the editor", doc.getElementById("editScore").value === "1st - #3", doc.getElementById("editScore").value);
  ok("the drafted result is in the editor", doc.getElementById("editResult").value === "W", doc.getElementById("editResult").value);
  ok("the drafted prize is in the editor", doc.getElementById("editPrize").value === "900", doc.getElementById("editPrize").value);
  ok("the drafted entry fee is in the editor", doc.getElementById("editEntryFee").value === "200", doc.getElementById("editEntryFee").value);
  ok(
    "the drafted lineup is in the editor",
    doc.getElementById("editRoster").value.indexOf("TQG.KΛIZEN07") !== -1,
    doc.getElementById("editRoster").value
  );
  ok(
    "the open player slot is kept in the editor",
    doc.getElementById("editRoster").value.split("\n").length === 4,
    doc.getElementById("editRoster").value
  );

  // THE KEY RULE: nothing was saved. The record list is unchanged.
  ok(
    "the draft was NOT saved automatically",
    doc.querySelectorAll("#itemList .row").length === 9,
    doc.querySelectorAll("#itemList .row").length
  );
  ok(
    "the draft is not in the draft list yet",
    doc.getElementById("itemList").textContent.indexOf("Squad 47") === -1
  );

  // The key was cleared from the field but kept in memory for the session.
  ok("the key field is cleared after a draft", doc.getElementById("aiKey").value === "");
  ok("the key is kept in memory for the session", w.NFAssistant.getKey() === "sk-test");
  ok(
    "the key is still not in localStorage",
    !Object.keys(w.localStorage).some(function (k) {
      return String(w.localStorage.getItem(k)).indexOf("sk-test") !== -1;
    })
  );

  // The maths panel: the before and after totals.
  ok("the maths panel is shown", doc.getElementById("aiMath").hidden === false);
  const mathsText = doc.getElementById("aiMathGrid").textContent.replace(/\s+/g, " ");
  ok("the maths panel shows the matches", /Matches/.test(mathsText), mathsText);
  ok("the maths panel shows the win rate", /Win rate/.test(mathsText), mathsText);
  ok("the maths panel shows the prize money", /Prize money/.test(mathsText), mathsText);
  ok("the maths panel shows the net earnings", /Net earnings/.test(mathsText), mathsText);
  ok(
    "the maths panel shows a before and after",
    mathsText.indexOf("→") !== -1,
    mathsText
  );
  // 8 played and 6 wins before; the draft is a win, so 9 and 7 after.
  ok(
    "the maths panel projects the new win",
    /Matches 8 → 9/.test(mathsText),
    mathsText
  );
  ok(
    "the maths panel projects the new win count",
    /Wins 6 → 7/.test(mathsText),
    mathsText
  );
  ok(
    "the maths panel projects the new prize money",
    /Prize money ₹\d+ → ₹\d+/.test(mathsText),
    mathsText
  );

  // Now the owner approves it by pressing Save match.
  click(w, doc.getElementById("btnCancelEdit"));
  await settle();
  click(w, doc.getElementById("btnAdd"));
  await settle();
  doc.getElementById("editOpponent").value = "Squad 47";
  doc.getElementById("editDate").value = "2026-10-28";
  doc.getElementById("editMode").value = "BR";
  doc.getElementById("editEvent").value = "Scrim";
  // A played match is published under an event name, so the owner has to
  // supply one — the assistant's draft is a starting point, not a filing.
  doc.getElementById("editEventName").value = "NightForge Scrim Night";
  doc.getElementById("editResult").value = "W";
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok(
    "the owner can save the approved draft",
    doc.querySelectorAll("#itemList .row").length === 10,
    doc.querySelectorAll("#itemList .row").length
  );
  ok(
    "the approved draft is saved under the event name",
    doc.getElementById("itemList").textContent.indexOf("NightForge Scrim Night") !== -1,
    doc.getElementById("editError").textContent
  );

  // The connection test.
  console.log("\n=== AI CONNECTION TEST ===");
  w.__aiReply = "connected.";
  doc.getElementById("aiKey").value = "sk-test";
  click(w, doc.getElementById("btnAiTest"));
  await settle();
  ok(
    "the connection test reports success",
    /connected/i.test(doc.getElementById("aiConnectStatus").textContent),
    doc.getElementById("aiConnectStatus").textContent
  );
  ok(
    "the connection test names the model",
    /test-model/.test(doc.getElementById("aiConnectStatus").textContent),
    doc.getElementById("aiConnectStatus").textContent
  );
  ok("the key field is cleared after a test", doc.getElementById("aiKey").value === "");

  // A failing endpoint is reported, not swallowed.
  w.__aiError = { status: 401, body: JSON.stringify({ error: { message: "Invalid API key" } }) };
  doc.getElementById("aiKey").value = "sk-bad";
  click(w, doc.getElementById("btnAiTest"));
  await settle();
  ok(
    "a failing endpoint is reported",
    /401/.test(doc.getElementById("aiConnectStatus").textContent),
    doc.getElementById("aiConnectStatus").textContent
  );

  // Locking the panel drops the key.
  console.log("\n=== AI KEY LIFECYCLE ===");
  ok("the key is in memory before the lock", w.NFAssistant.getKey() === "sk-bad");
  const lockBtn = doc.getElementById("btnLock");
  if (lockBtn) {
    click(w, lockBtn);
    await settle();
    ok("locking the panel drops the key", w.NFAssistant.getKey() === "");
    ok("locking the panel clears the key field", doc.getElementById("aiKey").value === "");
    // Unlock again, so the rest of the suite runs against an open panel.
    doc.getElementById("pinInput").value = PASSWORD;
    submit(w, doc.getElementById("pinForm"));
    await settle();
    ok("the panel reopens after the lock", !doc.getElementById("adminPanel").hidden);
  } else {
    ok("locking the panel drops the key", true);
    ok("locking the panel clears the key field", true);
  }

  // The AI section saved one record. It is removed here so the rest of
  // the suite starts from the published baseline of nine records.
  {
    const aiRow = Array.from(doc.querySelectorAll("#itemList .row")).find((r) =>
      r.textContent.indexOf("NightForge Scrim Night") !== -1
    );
    ok("the AI-approved record is in the list", !!aiRow);
    if (aiRow) {
      click(w, aiRow.querySelector('button[data-action="delete"]'));
      await settle();
    }
    ok(
      "the list is back to the published baseline",
      doc.querySelectorAll("#itemList .row").length === 9,
      doc.querySelectorAll("#itemList .row").length
    );
  }

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
ok("the status select is populated", doc.getElementById("editStatus").options.length === 2, doc.getElementById("editStatus").options.length);
ok(
  "the status select offers completed and scheduled",
  Array.from(doc.getElementById("editStatus").options).map((o) => o.value).join("|") === "completed|scheduled",
  Array.from(doc.getElementById("editStatus").options).map((o) => o.value).join("|")
);
ok("a new record defaults to completed", doc.getElementById("editStatus").value === "completed");
ok("the result field is enabled for a played match", !doc.getElementById("editResult").disabled);
ok("the score field is enabled for a played match", !doc.getElementById("editScore").disabled);

  // Submit with an empty form: the required fields must block it.
  submit(w, doc.getElementById("editForm"));
  await settle();
  ok("an empty form is rejected", doc.getElementById("editDialog").open === true);
  ok("the error is shown", !doc.getElementById("editError").hidden);
  ok("the error is announced", doc.getElementById("editError").getAttribute("role") === "alert");
  ok("no record was added", doc.querySelectorAll("#itemList .row").length === 9);

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
  ok("a valid record is saved", doc.querySelectorAll("#itemList .row").length === 10, doc.querySelectorAll("#itemList .row").length);
ok("the dialog closes after saving", doc.getElementById("editDialog").open === false);
ok("the error is cleared", doc.getElementById("editError").hidden);
ok("the new record is in the list", doc.getElementById("itemList").textContent.indexOf("Test Cup 2026") !== -1);
// The list is sorted by date descending, so the scheduled fixture
// (2026-10-21) sits above the new record. Assert the order that is
// actually correct: the fixture first, then the new record.
ok("the scheduled fixture sorts above the new record", (function () {
  const rows = Array.from(doc.querySelectorAll("#itemList .row"));
  if (rows.length < 2) return false;
  return rows[0].textContent.indexOf("2026-10-21") !== -1;
})(), (doc.querySelector("#itemList .row .row__date") || {}).textContent);
ok("the new record is the newest played record", (function () {
  const rows = Array.from(doc.querySelectorAll("#itemList .row"));
  const idx = rows.findIndex(function (r) {
    return r.textContent.indexOf("Test Cup 2026") !== -1;
  });
  if (idx === -1) return false;
  return (
    rows[idx].textContent.indexOf("2026-05-05") !== -1 &&
    rows[idx].textContent.indexOf("Upcoming") === -1
  );
})());
ok("the count updates", /9 played/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
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
ok("the edit did not add a record", doc.querySelectorAll("#itemList .row").length === 10, doc.querySelectorAll("#itemList .row").length);
ok("the new prize is shown", doc.getElementById("itemList").textContent.indexOf("₹2500") !== -1);
  }

  // =========================================================================
  console.log("\n=== DELETE ===");
  {
    const rows = doc.querySelectorAll("#itemList .row");
    const target = Array.from(rows).find((r) => r.textContent.indexOf("Test Cup 2026 (edited)") !== -1);
    click(w, target.querySelector('button[data-action="delete"]'));
    await settle();
    ok("the record is deleted", doc.querySelectorAll("#itemList .row").length === 9, doc.querySelectorAll("#itemList .row").length);
ok("the deleted record is gone from the list", doc.getElementById("itemList").textContent.indexOf("Test Cup 2026") === -1);
  }

  // =========================================================================
  console.log("\n=== REMOVE SAMPLE RECORDS ===");
  {
    ok("the sample records are still there", /8 sample/.test(doc.getElementById("itemCount").textContent));
    click(w, doc.getElementById("btnRemoveDemo"));
    await settle();
    // The scheduled record is NOT a sample, so it survives the removal.
    ok("the sample records are removed", doc.querySelectorAll("#itemList .row").length === 1, doc.querySelectorAll("#itemList .row").length);
    ok("the scheduled record survives", /Upcoming/.test(doc.getElementById("itemList").textContent), doc.getElementById("itemList").textContent.replace(/\s+/g, " ").slice(0, 160));
    ok("the count updates", /0 played/.test(doc.getElementById("itemCount").textContent), doc.getElementById("itemCount").textContent);
    ok("the status reports the removal", /Removed 8 sample/.test(doc.getElementById("status").textContent), doc.getElementById("status").textContent);

    // Removing again is a no-op, not an error.
    click(w, doc.getElementById("btnRemoveDemo"));
    await settle();
    ok("removing again is a no-op", /no sample records/.test(doc.getElementById("status").textContent), doc.getElementById("status").textContent);
  }

  // =========================================================================
  console.log("\n=== EMPTY DRAFT IS NOT 'NO DRAFT' ===");
  {
    // The draft now holds one record — the scheduled one. Reloading the
    // panel must NOT silently restore the published records, because that
    // would undo the owner's removal of the sample records.
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
  console.log("\n=== THE SCHEDULED FIXTURE IN THE EDITOR ===");
  {
    // A fresh window, so the fixture is the published one and not the
    // draft left behind by the previous blocks.
    const w3 = makeWindow();
    await settle();
    const d3 = w3.document;
    d3.getElementById("pinInput").value = PASSWORD;
    submit(w3, d3.getElementById("pinForm"));
    await settle();

    const row = Array.from(d3.querySelectorAll("#itemList .row")).find((r) =>
      r.textContent.indexOf("Upcoming") !== -1
    );
    ok("the scheduled record has a row", !!row);

    click(w3, row.querySelector('button[data-action="edit"]'));
    await settle();
    ok("the editor opens for the fixture", d3.getElementById("editDialog").open === true);
    ok("the status is prefilled as scheduled", d3.getElementById("editStatus").value === "scheduled", d3.getElementById("editStatus").value);
    ok("the start time is prefilled", d3.getElementById("editTime").value === "13:40", d3.getElementById("editTime").value);
    ok("the prize per winner is prefilled", d3.getElementById("editPrizePerWinner").value === "112", d3.getElementById("editPrizePerWinner").value);
    ok("the result field is disabled for a scheduled match", d3.getElementById("editResult").disabled);
    ok("the score field is disabled for a scheduled match", d3.getElementById("editScore").disabled);

    // The lineup is four lines, the last one empty — the open slot.
    const lines = d3.getElementById("editRoster").value.split("\n");
    ok("the lineup has four slots", lines.length === 4, lines.length + " lines");
    ok("the fourth slot is empty", lines[3] === "", JSON.stringify(lines));
    ok("the third player is prefilled", lines[2] === "TQG.ZYOTO17", lines[2]);

    // Saving the fixture unchanged must keep the open slot.
    submit(w3, d3.getElementById("editForm"));
    await settle();
    ok("the fixture saves without an error", d3.getElementById("editError").hidden, d3.getElementById("editError").textContent);
    const saved = (function () {
      const parsed = JSON.parse(w3.localStorage.getItem("nf_admin_matches"));
      return parsed.records.find((r) => r.id === "nf-001");
    })();
    ok("the saved fixture is still scheduled", saved && saved.status === "scheduled", saved && saved.status);
    ok("the saved fixture has no result", saved && !saved.result, saved && saved.result);
    ok("the saved fixture has no score", saved && !saved.score, saved && saved.score);
    ok(
      "the saved fixture keeps its open slot",
      saved && Array.isArray(saved.roster) && saved.roster.length === 4 && saved.roster[3] === "",
      saved && JSON.stringify(saved.roster)
    );
    ok(
      "the saved fixture keeps the start time",
      saved && saved.time === "13:40",
      saved && saved.time
    );
    ok(
      "the saved fixture keeps the prize per winner",
      saved && saved.prizePerWinner === 112,
      saved && saved.prizePerWinner
    );

    // Switching the status to completed must switch the result back on.
    click(w3, Array.from(d3.querySelectorAll("#itemList .row")).find((r) => r.textContent.indexOf("Upcoming") !== -1).querySelector('button[data-action="edit"]'));
    await settle();
    d3.getElementById("editStatus").value = "completed";
    d3.getElementById("editStatus").dispatchEvent(new w3.Event("change", { bubbles: true }));
    await settle();
    ok("the result field is enabled again for a played match", !d3.getElementById("editResult").disabled);
    ok("the score field is enabled again for a played match", !d3.getElementById("editScore").disabled);
    w3.close();
  }

  // =========================================================================
  console.log("\n=== THE TEAM ROSTER IN THE ADMIN ===");
  {
    const w4 = makeWindow();
    await settle();
    const d4 = w4.document;
    d4.getElementById("pinInput").value = PASSWORD;
    submit(w4, d4.getElementById("pinForm"));
    await settle();

    const rosterText = d4.getElementById("teamRoster").value;
    ok("the roster is prefilled", rosterText.indexOf("TQG.KΛIZEN07 | Sniper, IGL") !== -1, rosterText);
    ok("the roster lists every player", rosterText.split("\n").length === teamData.roster.length, rosterText.split("\n").length + " lines");

    // An unknown role must be rejected, and the error must name the line.
    d4.getElementById("teamRoster").value = "TQG.KΛIZEN07 | Snipers";
    submit(w4, d4.getElementById("teamForm"));
    await settle();
    ok("an unknown role is rejected", !d4.getElementById("teamRosterError").hidden);
    ok("the error names the line", /Line 1/.test(d4.getElementById("teamRosterError").textContent), d4.getElementById("teamRosterError").textContent);
    ok("the error lists the known roles", /Sniper/.test(d4.getElementById("teamRosterError").textContent), d4.getElementById("teamRosterError").textContent);

    // A valid save keeps the roster.
    d4.getElementById("teamRoster").value = rosterText;
    d4.getElementById("teamName").value = "NightForge";
    submit(w4, d4.getElementById("teamForm"));
    await settle();
    ok("the team saves", /Team details saved/.test(d4.getElementById("status").textContent), d4.getElementById("status").textContent);
    const savedTeam = JSON.parse(w4.localStorage.getItem("nf_admin_team"));
    ok("the saved team keeps its roster", Array.isArray(savedTeam.roster) && savedTeam.roster.length === 3, JSON.stringify(savedTeam.roster));
    ok(
      "the saved team keeps the merged roles",
      savedTeam.roster[0] && savedTeam.roster[0].roles.length === 2 && savedTeam.roster[0].roles[0] === "Sniper" && savedTeam.roster[0].roles[1] === "IGL",
      JSON.stringify(savedTeam.roster[0])
    );
    ok("the saved team declares schema 2", savedTeam.schemaVersion === 2, savedTeam.schemaVersion);
    w4.close();
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
    ok("the draft is restored on unlock", doc.querySelectorAll("#itemList .row").length === 1, doc.querySelectorAll("#itemList .row").length);

    click(w, doc.getElementById("btnResetAll"));
    await settle();
    ok("the published records come back after a discard", doc.querySelectorAll("#itemList .row").length === 9, doc.querySelectorAll("#itemList .row").length);
    ok("the team name is back from the published file", doc.getElementById("teamName").value === teamData.name, doc.getElementById("teamName").value);
  }

  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(fail > 0 ? 1 : 0);
})().catch(function (err) {
  console.error("SUITE CRASHED:", err);
  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(1);
});