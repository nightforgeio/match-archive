// admin.js — the match archive admin panel.
//
// WHAT THIS IS
//   A password-gated editor for data/matches.json and data/team.json.
//
// WHERE THE DATA LIVES — AND WHY THIS MATTERS
//   The published archive is a static file served by GitHub Pages. Every
//   visitor reads data/matches.json. So the admin panel CANNOT store the
//   records in localStorage the way the shop's admin does: a visitor's
//   browser has no access to the owner's localStorage, so records typed
//   there would never reach anyone.
//
//   Instead this panel works on a local working copy and then PUBLISHES:
//     1. EDIT    — records live in this browser while you work on them.
//     2. EXPORT  — download matches.json, drop it into data/, commit, push.
//     3. PUBLISH — paste a GitHub token and the panel commits the file
//                  to your repo through the GitHub API, which triggers
//                  GitHub Pages to rebuild the site.
//
//   The token is held in memory for the session only. It is never written
//   to localStorage, never written to disk, and never appears in the
//   source. The password hash below is the only secret in this file.
//
// PASSWORD
//   Only the SHA-256 hash is stored. To change it:
//     node -e "console.log(require('crypto').createHash('sha256').update('YOUR_PASSWORD','utf8').digest('hex'))"
(function () {
  "use strict";

  // The SHA-256 of the owner's password. The plaintext is NOT in this
  // repository — it is supplied to the admin e2e suite via the
  // ADMIN_PASSWORD environment variable, and tests/admin-hash.test.js
  // keeps this hash and that value in sync.
  const PASS_HASH =
    "1ac0670f9d19fccfead8b605f341acee495d21cd814ac905a646dd6e9fb5e35a";
  const STORAGE_KEY = "nf_admin_matches";
  const TEAM_KEY = "nf_admin_team";
  const MATCHES_URL = "../data/matches.json";
  const TEAM_URL = "../data/team.json";

  const MODES = ["CS", "BR", "LW"];
  // The official Free Fire MAX competitive mode names. The admin shows
  // these next to the code so the owner picks the right one, and so the
  // published record never carries a name the community does not use.
  const MODE_LABELS = {
    CS: "Clash Squad",
    BR: "Battle Royale",
    LW: "Lone Wolf",
  };
  const EVENTS = ["Tournament", "Scrim", "Qualifier", "Showmatch", "Other"];
  const RESULTS = ["W", "L", "D"];
  // The in-game roles a NightForge player can hold. The list is closed on
  // purpose — the public page renders a role as a chip, and an open list
  // would let a typo become a chip that means nothing.
  const ROLES = [
    "IGL",
    "Sniper",
    "Rusher",
    "Supporter",
    "Scout",
    "Anchor",
    "Fragger",
    "Flex",
  ];
  // A record is either a result ("completed") or an announcement
  // ("scheduled"). A scheduled match has no score and no result, and it
  // is excluded from every statistic on the public page.
  const STATUSES = ["completed", "scheduled"];
  const STATUS_LABELS = {
    completed: "Completed — the match has been played",
    scheduled: "Scheduled — the match is announced but not played",
  };

  // The GitHub coordinates used by the Publish button. They are public
  // information — the repository is public — and only the token is secret.
  const GITHUB_OWNER = "nightforgeio";
  const GITHUB_REPO = "match-archive";
  const GITHUB_BRANCH = "master";
  const GITHUB_FILE = "data/matches.json";
  const GITHUB_TEAM_FILE = "data/team.json";

  let sessionToken = null; // In memory only. Never persisted.
  let working = []; // The records being edited.
  let team = {};
  let dirty = false;
  // The rounds being edited in the dialog, as { team, round } entries.
  let editRounds = [];

  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  // --- SHA-256 (UTF-8 aware). Verified against Node's crypto. ---------------

  function sha256(str) {
    function rrot(x, n) {
      return (x >>> n) | (x << (32 - n));
    }
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ];

    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c < 0xd800 || c >= 0xe000) {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        i++;
        const cp =
          0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63),
          0x80 | (cp & 63),
        );
      }
    }

    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    bytes.push(
      (hi >>> 24) & 255,
      (hi >>> 16) & 255,
      (hi >>> 8) & 255,
      hi & 255,
    );
    bytes.push(
      (lo >>> 24) & 255,
      (lo >>> 16) & 255,
      (lo >>> 8) & 255,
      lo & 255,
    );

    const w = new Array(64);
    for (let i = 0; i < bytes.length; i += 64) {
      for (let j = 0; j < 16; j++) {
        w[j] =
          (bytes[i + j * 4] << 24) |
          (bytes[i + j * 4 + 1] << 16) |
          (bytes[i + j * 4 + 2] << 8) |
          bytes[i + j * 4 + 3];
      }
      for (let j = 16; j < 64; j++) {
        const s0 = rrot(w[j - 15], 7) ^ rrot(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rrot(w[j - 2], 17) ^ rrot(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      let a = H[0];
      let b = H[1];
      let c = H[2];
      let d = H[3];
      let e = H[4];
      let f = H[5];
      let g = H[6];
      let h = H[7];
      for (let j = 0; j < 64; j++) {
        const S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[j] + w[j]) | 0;
        const S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      H = [
        (H[0] + a) | 0,
        (H[1] + b) | 0,
        (H[2] + c) | 0,
        (H[3] + d) | 0,
        (H[4] + e) | 0,
        (H[5] + f) | 0,
        (H[6] + g) | 0,
        (H[7] + h) | 0,
      ];
    }
    return H.map(function (x) {
      return (x >>> 0).toString(16).padStart(8, "0");
    }).join("");
  }

  // Constant-time-ish compare. The hash is public in the source, so this
  // is not a real secret — but it costs nothing to avoid the early exit.
  function hashesMatch(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
      return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  // --- Escaping -------------------------------------------------------------

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // --- Storage --------------------------------------------------------------

  // The local draft is stored as a WRAPPER object, not a bare array:
  //
  //   { records: [...], team: {...}, savedAt: "..." }
  //
  // Why not a bare array? Because "no local draft" and "the owner deleted
  // every record" are different states, and a bare array cannot tell them
  // apart — an empty array is falsy-ish to a naive `if (local && local.length)`
  // check, so the panel would silently reload the published records and
  // undo the owner's delete-all. The wrapper makes "a draft exists" a
  // property of the KEY, not of its contents.
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray(parsed.records)
        ) {
          return parsed;
        }
        // A legacy bare array (from an older build) is still a valid
        // draft, including an empty one.
        if (Array.isArray(parsed)) {
          return { records: parsed, team: null, savedAt: "" };
        }
      }
    } catch (e) {
      // Private mode, storage disabled, or corrupt JSON. Fall through to
      // the published file.
    }
    return null;
  }

  function saveLocal() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          records: working,
          team: team,
          savedAt: new Date().toISOString(),
        }),
      );
      localStorage.setItem(TEAM_KEY, JSON.stringify(team));
      dirty = true;
      updateStatus();
    } catch (e) {
      setStatus("Could not save to this browser's storage.", "error");
    }
  }

  function updateStatus() {
    if (!el.status) return;
    if (dirty) {
      setStatus("Unsaved changes in this browser.", "warn");
    } else {
      setStatus("Working copy is in sync with this browser.", "ok");
    }
  }

  function setStatus(message, kind) {
    if (!el.status) return;
    el.status.textContent = message;
    el.status.className = "admin-status admin-status--" + (kind || "ok");
  }

  // --- Load -----------------------------------------------------------------

  function loadFromFiles() {
    return Promise.all([
      fetch(MATCHES_URL, { cache: "no-store" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
      fetch(TEAM_URL, { cache: "no-store" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
    ]).then(function (res) {
      const matchesFile = res[0];
      const teamFile = res[1];
      if (matchesFile && Array.isArray(matchesFile.matches)) {
        // COPY the array. `working` is mutated in place by saveEditor()
        // (working.push), and assigning the fetched array by reference
        // would let an edit reach back into the cached response object.
        working = matchesFile.matches.slice();
      }
      if (teamFile) team = Object.assign({}, teamFile);
      render();
    });
  }

  // --- Rendering ------------------------------------------------------------

  function render() {
    renderList();
    renderTeamForm();
    renderCounts();
  }

  function renderCounts() {
    if (!el.itemCount) return;
    const played = working.filter(function (m) {
      return m.status !== "scheduled";
    });
    const wins = played.filter(function (m) {
      return m.result === "W";
    }).length;
    const scheduled = working.length - played.length;
    // The count describes the RECORD and the ANNOUNCEMENTS separately, so
    // a pending fixture is never read as a played match.
    el.itemCount.textContent =
      played.length +
      " played · " +
      wins +
      " wins · " +
      played.filter(function (m) {
        return m.demo;
      }).length +
      " sample" +
      (scheduled > 0 ? " · " + scheduled + " scheduled" : "");
  }

  function renderList() {
    if (!el.itemList) return;

    if (working.length === 0) {
      el.itemList.innerHTML =
        '<p class="admin-empty">No records yet. Add your first match.</p>';
      return;
    }

    const sorted = working.slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    el.itemList.innerHTML = sorted
      .map(function (m, i) {
        const demoTag = m.demo ? ' <span class="row-tag">Sample</span>' : "";
        const scheduled = m.status === "scheduled";
        // A scheduled record has no result, so the badge says "upcoming"
        // instead of showing a dash that reads like a missing value.
        const resultBadge = scheduled
          ? '<span class="row__badge row__badge--scheduled">Upcoming</span>'
          : '<span class="row__badge row__badge--' +
            esc(m.result || "D") +
            '">' +
            esc(m.result || "—") +
            "</span>";
        const when = [m.date || "—", m.time || ""].filter(Boolean).join(" · ");
        return (
          '<div class="row" data-id="' +
          esc(m.id) +
          '">' +
          '<div class="row__main">' +
          '<div class="row__title">' +
          esc(m.eventName || m.opponent || "(no event name)") +
          demoTag +
          "</div>" +
          '<div class="row__meta">' +
          '<span class="row__date">' +
          esc(when) +
          "</span>" +
          '<span class="row__badge">' +
          esc(m.mode ? m.mode + " — " + (MODE_LABELS[m.mode] || m.mode) : "—") +
          "</span>" +
          '<span class="row__badge">' +
          esc(m.event || "—") +
          "</span>" +
          resultBadge +
          '<span class="row__fee">₹' +
          esc(m.entryFee || 0) +
          " fee · ₹" +
          esc(m.prize || 0) +
          " prize" +
          (m.prizePerWinner
            ? " · ₹" + esc(m.prizePerWinner) + " per winner"
            : "") +
          "</span>" +
          "</div>" +
          "</div>" +
          '<div class="row__actions">' +
          '<button class="btn btn--tiny" data-action="edit" data-id="' +
          esc(m.id) +
          '">Edit</button>' +
          '<button class="btn btn--tiny btn--danger" data-action="delete" data-id="' +
          esc(m.id) +
          '">Delete</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderTeamForm() {
    if (!el.teamForm) return;
    el.teamName.value = team.name || "";
    el.teamTagline.value = team.tagline || "";
    el.teamTaglineHi.value = team.taglineHi || "";
    el.teamAbout.value = team.about || "";
    el.teamAboutHi.value = team.aboutHi || "";
    el.teamCity.value = team.city || "";
    el.teamEmail.value = team.email || "";
    el.teamWhatsapp.value = team.whatsapp || "";
    el.teamInstagram.value = team.instagram || "";
    el.teamYoutube.value = team.youtube || "";
    el.teamRoster.value = (team.roster || []).map(writeRosterLine).join("\n");
  }

  // One player as a single line of the lineup textarea.
  //
  //   TQG.KΛIZEN07 | Sniper, IGL
  //   ASTROO!! | Supporter
  //   Someone | Rusher | guest
  function writeRosterLine(p) {
    const roles = (p.roles && p.roles.length ? p.roles : p.role ? [p.role] : [])
      .filter(Boolean)
      .join(", ");
    const tail = p.status === "guest" ? " | guest" : "";
    return roles ? p.name + " | " + roles + tail : p.name;
  }

  // The lineup textarea into an array of player records.
  //
  // The format is "Name | Role, Role [| guest]". A player with no role
  // is still a player — a name on its own line is valid. An unknown role
  // is an error, because the public page renders a role as a chip and a
  // typo would become a chip that means nothing.
  function readRosterLines(text) {
    const raw = String(text == null ? "" : text).replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    const players = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split("|").map(function (p) {
        return p.trim();
      });
      const name = parts[0];
      if (!name) continue;
      const roles = [];
      let status = "core";
      for (let j = 1; j < parts.length; j++) {
        const chunk = parts[j];
        if (!chunk) continue;
        if (chunk.toLowerCase() === "guest") {
          status = "guest";
          continue;
        }
        chunk.split(",").forEach(function (r) {
          const role = r.trim();
          if (!role) return;
          if (ROLES.indexOf(role) === -1) {
            throw new Error(
              "Line " +
                (i + 1) +
                ": unknown role “" +
                role +
                "”. Use one of: " +
                ROLES.join(", ") +
                ".",
            );
          }
          if (roles.indexOf(role) === -1) roles.push(role);
        });
      }
      players.push({ name: name, roles: roles, status: status });
    }
    return players;
  }

  // --- Editing --------------------------------------------------------------

  // A stable id for a new record. The timestamp is enough — the owner is
  // the only one adding records.
  function newId() {
    return "m-" + Date.now().toString(36);
  }

  function openEditor(record, prefill) {
    const isNew = !record;
    const base = record || {
      id: newId(),
      date: "",
      time: "",
      status: "completed",
      mode: "CS",
      event: "Tournament",
      eventName: "",
      map: "",
      opponent: "",
      score: "",
      result: "W",
      placement: "",
      entryFee: "",
      prize: "",
      prizePerWinner: "",
      roster: [],
      notes: "",
      demo: false,
    };

    // A prefill is a DRAFT — the assistant's suggestion. It fills the
    // fields the assistant worked out, and anything it left blank stays
    // blank so the owner has to complete it by hand. The id is always a
    // fresh one: a drafted record is a new record, never an edit of an
    // existing one.
    const m = prefill
      ? Object.assign({}, base, prefill, {
          id: base.id,
          demo: false,
        })
      : base;

    el.editId.value = m.id;
    el.editDate.value = m.date || "";
    el.editTime.value = m.time || "";
    el.editStatus.value = m.status === "scheduled" ? "scheduled" : "completed";
    el.editMode.value = m.mode || "CS";
    el.editEvent.value = m.event || "Tournament";
    el.editEventName.value = m.eventName || "";
    el.editMap.value = m.map || "";
    el.editOpponent.value = m.opponent || "";
    el.editScore.value = m.score || "";
    el.editResult.value = m.result || "W";
    el.editPlacement.value = m.placement == null ? "" : m.placement;
    el.editEntryFee.value = m.entryFee || "";
    el.editPrize.value = m.prize || "";
    el.editPrizePerWinner.value = m.prizePerWinner || "";
    el.editRoster.value = (m.roster || []).join("\n");
    el.editNotes.value = m.notes || "";
    el.editDemo.checked = m.demo === true;

    // Load the round score into the editor.
    editRounds = Array.isArray(m.rounds) ? m.rounds.slice() : [];
    renderRounds();
    applyStatusToFields();

    el.dialogTitle.textContent = isNew ? "Add match" : "Edit match";
    el.editDialog.showModal();
    el.editEventName.focus();
  }

  // Read the lineup textarea into an array of in-game names.
  //
  // AN EMPTY LINE IS MEANINGFUL. It is an open slot — a player who has
  // not been named yet. The trailing empty line is the one that matters
  // most: the unnamed fourth player in a four-player lineup.
  //
  // So the parser does NOT strip trailing blanks. A lineup of three
  // names and an open slot round-trips exactly: the textarea shows
  // "A\nB\nC\n", and it comes back as ["A", "B", "C", ""]. The only
  // thing that is collapsed is a run of blank lines, so the array
  // mirrors what the public page draws.
  //
  // Stripping the trailing blank here would silently delete the open
  // slot the first time the owner saved the fixture — and the public
  // page would then claim a three-player lineup for a four-player
  // match.
  function readRoster(text) {
    const raw = String(text == null ? "" : text).replace(/\r\n/g, "\n");
    // An entirely empty textarea is an empty lineup, not one open slot.
    if (!raw.trim()) return [];
    const out = [];
    raw.split("\n").forEach(function (line) {
      const name = line.trim();
      // Collapse a run of blank lines into a single open slot.
      if (name === "" && out.length > 0 && out[out.length - 1] === "") return;
      out.push(name);
    });
    return out;
  }

  // Turn the result and score fields on or off depending on the status.
  //
  // A scheduled match is an announcement. It has no result and no score
  // yet, and letting the owner type one would put a phantom win into
  // the published archive.
  function applyStatusToFields() {
    const scheduled = el.editStatus.value === "scheduled";
    el.editResult.disabled = scheduled;
    el.editScore.disabled = scheduled;
    el.editResult.required = !scheduled;
    if (scheduled) {
      el.editResult.value = "";
      el.editScore.value = "";
    }
    updateRoundsVisibility();
  }

  // Whether the match is a round-series format (CS/LW) and is not scheduled.
  function roundsApplicable() {
    const scheduled = el.editStatus.value === "scheduled";
    const mode = el.editMode.value;
    return !scheduled && (mode === "CS" || mode === "LW");
  }

  // Show/hide the rounds builder based on mode and status. A scheduled
  // match has no rounds — the result is still undefined.
  function updateRoundsVisibility() {
    if (!el.roundsEditor) return;
    const show = roundsApplicable();
    el.roundsEditor.hidden = !show;
    if (!show) {
      editRounds = [];
      renderRounds();
    }
  }

  function renderRounds() {
    if (!el.roundsList) return;
    if (!editRounds.length) {
      el.roundsList.innerHTML = "";
      return;
    }
    el.roundsList.innerHTML = editRounds
      .map(function (r, i) {
        const side = r.team === "NF" ? "nf" : "opp";
        const label = r.team === "NF" ? "TQ" : "Opponent";
        return (
          '<div class="round-chip-admin" data-side="' +
          side +
          '"><span class="round-chip-admin__num">R' +
          esc(r.round) +
          '</span><span class="round-chip-admin__team">' +
          esc(label) +
          '</span><button type="button" class="round-chip-admin__remove" data-round="' +
          i +
          '" aria-label="Remove round">×</button></div>'
        );
      })
      .join("");
  }

  function addRound() {
    const team = el.editRoundTeam.value;
    const round = editRounds.length + 1;
    editRounds.push({ team: team, round: round });
    renderRounds();
  }

  function removeRound(index) {
    editRounds.splice(index, 1);
    // Renumber so the rounds stay 1..N in order.
    editRounds.forEach(function (r, i) {
      r.round = i + 1;
    });
    renderRounds();
  }

  function readEditor() {
    const scheduled = el.editStatus.value === "scheduled";
    return {
      id: el.editId.value || newId(),
      date: el.editDate.value.trim(),
      time: el.editTime.value.trim(),
      status: scheduled ? "scheduled" : "completed",
      mode: el.editMode.value,
      event: el.editEvent.value,
      eventName: el.editEventName.value.trim(),
      map: el.editMap.value.trim(),
      opponent: el.editOpponent.value.trim(),
      score: scheduled ? "" : el.editScore.value.trim(),
      result: scheduled ? "" : el.editResult.value,
      placement:
        el.editPlacement.value === "" ? null : Number(el.editPlacement.value),
      entryFee:
        el.editEntryFee.value === "" ? 0 : Number(el.editEntryFee.value),
      prize: el.editPrize.value === "" ? 0 : Number(el.editPrize.value),
      prizePerWinner:
        el.editPrizePerWinner.value === ""
          ? 0
          : Number(el.editPrizePerWinner.value),
      roster: readRoster(el.editRoster.value),
      notes: el.editNotes.value.trim(),
      demo: el.editDemo.checked,
      format: roundsApplicable() ? "bo3" : "",
      rounds: roundsApplicable() ? editRounds.slice() : [],
      roundsTotal: roundsApplicable()
        ? editRounds.filter(function (r) {
            return r.team === "NF";
          }).length
        : 0,
    };
  }

  function validate(m) {
    if (!m.date) return "Date is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date))
      return "Date must be in YYYY-MM-DD format.";
    if (m.time && !/^\d{2}:\d{2}$/.test(m.time))
      return "Start time must be in HH:MM format.";
    if (Number.isNaN(m.entryFee) || m.entryFee < 0)
      return "Entry fee must be zero or more.";
    if (Number.isNaN(m.prize) || m.prize < 0)
      return "Prize must be zero or more.";
    if (Number.isNaN(m.prizePerWinner) || m.prizePerWinner < 0)
      return "Prize per winner must be zero or more.";
    if (
      m.placement !== null &&
      (Number.isNaN(m.placement) || m.placement < 1)
    ) {
      return "Placement must be a positive whole number.";
    }
    // A played match needs a result and a name to be published under.
    // A scheduled one does not — the opponent and the event name are
    // announced later.

    if (m.status !== "scheduled") {
      if (!m.result) return "Result is required for a played match.";
      if (!m.eventName) return "Event name is required for a played match.";
      if (!m.opponent) return "Opponent is required for a played match.";
    }
    // Round score consistency. A series result must agree with the round
    // count: a win needs the required number of rounds we took (2 for
    // bo3, 3 for bo5), a loss needs the same from the opponent.
    if (m.rounds && m.rounds.length) {
      const target = m.format === "bo5" ? 3 : 2;
      const nf = m.rounds.filter(function (r) {
        return r.team === "NF";
      }).length;
      const opp = m.rounds.length - nf;
      if (m.result === "W" && nf < target)
        return (
          "The round score does not add up to a win (need " +
          target +
          " rounds)."
        );
      if (m.result === "L" && opp < target)
        return (
          "The round score does not add up to a loss (opponent needs " +
          target +
          " rounds)."
        );
      if (nf >= target && opp >= target)
        return "The round score cannot be a win for both sides.";
    }
    return null;
  }

  function saveEditor() {
    const m = readEditor();
    const error = validate(m);
    if (error) {
      el.editError.textContent = error;
      el.editError.hidden = false;
      return;
    }
    el.editError.hidden = true;

    const idx = working.findIndex(function (x) {
      return x.id === m.id;
    });
    if (idx === -1) {
      working.push(m);
    } else {
      working[idx] = m;
    }

    saveLocal();
    render();
    el.editDialog.close();
  }

  function deleteRecord(id) {
    const rec = working.find(function (x) {
      return x.id === id;
    });
    const name = rec ? rec.eventName || rec.opponent : "this record";
    if (!window.confirm('Delete "' + name + '"? This cannot be undone.'))
      return;
    working = working.filter(function (x) {
      return x.id !== id;
    });
    saveLocal();
    render();
  }

  function removeDemoRecords() {
    const count = working.filter(function (m) {
      return m.demo;
    }).length;
    if (count === 0) {
      setStatus("There are no sample records to remove.", "ok");
      return;
    }
    if (
      !window.confirm(
        "Remove " + count + " sample record(s)? This cannot be undone.",
      )
    )
      return;
    working = working.filter(function (m) {
      return !m.demo;
    });
    saveLocal();
    render();
    setStatus("Removed " + count + " sample records.", "ok");
  }

  // --- AI assistant ---------------------------------------------------------

  // The archive's own numbers, computed the same way the public page
  // computes them, so the assistant reasons about the real record.
  //
  // The AI never sees the GitHub token and never writes a record. It fills
  // the editor; the owner presses Save.
  function aiContext() {
    const played = working.filter(function (m) {
      return m.status !== "scheduled";
    });
    const wins = played.filter(function (m) {
      return m.result === "W";
    }).length;
    const losses = played.filter(function (m) {
      return m.result === "L";
    }).length;
    const draws = played.filter(function (m) {
      return m.result === "D";
    }).length;
    const decided = wins + losses;
    const totalPrize = played.reduce(function (s, m) {
      return s + (Number(m.prize) || 0);
    }, 0);
    const totalEntry = played.reduce(function (s, m) {
      return s + (Number(m.entryFee) || 0);
    }, 0);
    return {
      played: played.length,
      wins: wins,
      losses: losses,
      draws: draws,
      winRate: decided > 0 ? ((wins / decided) * 100).toFixed(1) : "0.0",
      totalPrize: totalPrize,
      totalEntry: totalEntry,
      net: totalPrize - totalEntry,
      roster: (team.roster || []).map(function (p) {
        return p.name;
      }),
      recent: played.slice(0, 5).map(function (m) {
        return (
          (m.date || "?") +
          " " +
          (m.opponent || "unknown") +
          " " +
          (m.result || "?")
        );
      }),
    };
  }

  // The numbers the assistant worked out, shown under the prompt.
  //
  // This is the "it did the maths" panel: the running totals BEFORE and
  // AFTER the drafted match, so the owner can see the arithmetic without
  // trusting a language model to have done it.
  function renderAiMath(record) {
    if (!el.aiMath || !el.aiMathGrid) return;
    const before = aiContext();
    if (!record) {
      el.aiMath.hidden = true;
      el.aiMathGrid.innerHTML = "";
      return;
    }

    const isScheduled = record.status === "scheduled";
    // A scheduled match changes no totals. Saying so is better than
    // showing a row of zeroes that look like a mistake.
    const afterPlayed = before.played + (isScheduled ? 0 : 1);
    const afterWins =
      before.wins + (!isScheduled && record.result === "W" ? 1 : 0);
    const afterLosses =
      before.losses + (!isScheduled && record.result === "L" ? 1 : 0);
    const afterDraws =
      before.draws + (!isScheduled && record.result === "D" ? 1 : 0);
    const afterDecided = afterWins + afterLosses;
    const afterRate =
      afterDecided > 0 ? ((afterWins / afterDecided) * 100).toFixed(1) : "0.0";

    // A played match adds its prize to the money. A scheduled match adds
    // nothing — the prize is per-winner and depends on the result.
    const afterPrize =
      before.totalPrize + (isScheduled ? 0 : record.prize || 0);
    const afterEntry =
      before.totalEntry + (isScheduled ? 0 : record.entryFee || 0);
    const afterNet = afterPrize - afterEntry;

    const rows = [
      ["Matches", before.played + " → " + afterPlayed],
      ["Wins", before.wins + " → " + afterWins],
      ["Win rate", before.winRate + "% → " + afterRate + "%"],
      ["Prize money", "₹" + before.totalPrize + " → ₹" + afterPrize],
      ["Entry fees", "₹" + before.totalEntry + " → ₹" + afterEntry],
      ["Net earnings", "₹" + before.net + " → ₹" + afterNet],
    ];

    // The space between the term and its value is deliberate. The row is a
    // flex line, so the whitespace is not painted — but it IS in the
    // text content, and without it the panel reads "Matches8 → 9" to a
    // screen reader and to any tool that reads the DOM.
    el.aiMathGrid.innerHTML = rows
      .map(function (r) {
        return (
          '<div class="ai-math__row"><dt>' +
          esc(r[0]) +
          '</dt> <dd class="mono">' +
          esc(r[1]) +
          "</dd></div>"
        );
      })
      .join(" ");
    el.aiMath.hidden = false;
  }

  // Fill the match editor with a drafted record. The editor is the review
  // step: the owner reads every field before it is saved.
  function applyAiRecord(record) {
    if (!record) return;
    openEditor(null, record);
  }

  function setAiStatus(message, kind) {
    if (!el.aiStatus) return;
    el.aiStatus.textContent = message;
    el.aiStatus.className = "admin-help" + (kind ? " admin-help--" + kind : "");
  }

  function setAiConnectStatus(message, kind) {
    if (!el.aiConnectStatus) return;
    el.aiConnectStatus.textContent = message;
    el.aiConnectStatus.className =
      "admin-help" + (kind ? " admin-help--" + kind : "");
  }

  // Run the draft request. The button is disabled while the request is in
  // flight, so a slow endpoint cannot be double-submitted.
  function requestAiDraft() {
    if (!window.NFAssistant) {
      setAiStatus(
        "The assistant script did not load. Reload the page.",
        "error",
      );
      return;
    }
    const prompt = el.aiPrompt.value.trim();
    if (!prompt) {
      setAiStatus("Type what happened in the match first.", "error");
      el.aiPrompt.focus();
      return;
    }

    // The key is read from the field, and falls back to the copy the
    // module holds for the session. The field is cleared after a
    // successful draft so the key is not sitting on screen, but the
    // next draft does not need it typed again.
    const key = el.aiKey.value.trim() || window.NFAssistant.getKey();
    const baseUrl = el.aiBaseUrl.value.trim();
    const model = el.aiModel.value.trim();

    if (!baseUrl) {
      setAiStatus("Set the API base URL first.", "error");
      el.aiBaseUrl.focus();
      return;
    }
    // A local endpoint needs no key. Everything else does.
    if (!key && !/localhost|127\.0\.0\.1/.test(baseUrl)) {
      setAiStatus("Enter your API key first.", "error");
      el.aiKey.focus();
      return;
    }

    // The provider configuration is remembered for the session as soon as it
    // is accepted — BEFORE the request goes out. A key that is correct but
    // temporarily unreachable must not cost the owner a retype, and a failed
    // request must not wipe the settings they just filled in. It stays in
    // module memory only, and is dropped when the panel locks.
    window.NFAssistant.setKey(key);
    window.NFAssistant.setBaseUrl(baseUrl);
    window.NFAssistant.setModel(model);

    el.btnAiDraft.disabled = true;
    el.btnAiDraft.textContent = "Drafting…";
    setAiStatus("Asking the assistant…", "warn");
    renderAiMath(null);

    window.NFAssistant.draft({
      apiKey: key,
      baseUrl: baseUrl,
      model: model,
      message: prompt,
      context: aiContext(),
    })
      .then(function (record) {
        // The key is kept in the module for the session so the next draft
        // does not need it typed again, but the field is cleared so it
        // is not left sitting on screen.
        window.NFAssistant.setKey(key);
        window.NFAssistant.setBaseUrl(baseUrl);
        window.NFAssistant.setModel(model);
        el.aiKey.value = "";

        renderAiMath(record);
        applyAiRecord(record);
        setAiStatus(
          "Draft ready in the editor below. Read it, fix anything, then press Save match.",
          "ok",
        );
      })
      .catch(function (err) {
        renderAiMath(null);
        setAiStatus(err.message || "The draft failed.", "error");
      })
      .then(function () {
        el.btnAiDraft.disabled = false;
        el.btnAiDraft.textContent = "Draft the record";
      });
  }

  // The connection test. It proves the base URL, the key and the model
  // name work BEFORE the owner types a whole match report.
  function requestAiTest() {
    if (!window.NFAssistant) {
      setAiConnectStatus(
        "The assistant script did not load. Reload the page.",
        "error",
      );
      return;
    }
    const key = el.aiKey.value.trim() || window.NFAssistant.getKey();
    const baseUrl = el.aiBaseUrl.value.trim();
    const model = el.aiModel.value.trim();

    if (!baseUrl) {
      setAiConnectStatus("Set the API base URL first.", "error");
      el.aiBaseUrl.focus();
      return;
    }
    if (!key && !/localhost|127\.0\.0\.1/.test(baseUrl)) {
      setAiConnectStatus("Enter your API key first.", "error");
      el.aiKey.focus();
      return;
    }

    // Remembered before the request, on the same rule as the draft: a failed
    // test must not cost the owner their key, URL and model.
    window.NFAssistant.setKey(key);
    window.NFAssistant.setBaseUrl(baseUrl);
    window.NFAssistant.setModel(model);

    el.btnAiTest.disabled = true;
    el.btnAiTest.textContent = "Testing…";
    setAiConnectStatus("Contacting the endpoint…", "warn");

    window.NFAssistant.test({
      apiKey: key,
      baseUrl: baseUrl,
      model: model,
    })
      .then(function (result) {
        window.NFAssistant.setKey(key);
        window.NFAssistant.setBaseUrl(baseUrl);
        window.NFAssistant.setModel(model);
        el.aiKey.value = "";
        setAiConnectStatus(
          "Connected. " + result.model + " answered: “" + result.reply + "”",
          "ok",
        );
      })
      .catch(function (err) {
        setAiConnectStatus(err.message || "The connection failed.", "error");
      })
      .then(function () {
        el.btnAiTest.disabled = false;
        el.btnAiTest.textContent = "Test connection";
      });
  }

  // Populate the provider dropdown and sync the base URL and model.
  function applyAiPreset(id) {
    if (!window.NFAssistant) return;
    const preset = window.NFAssistant.presets.find(function (p) {
      return p.id === id;
    });
    if (!preset) return;
    el.aiBaseUrl.value = preset.baseUrl;
    el.aiModel.value = preset.model;
    el.aiKey.placeholder = preset.keyHint;
    setAiConnectStatus(
      preset.id === "ollama"
        ? "Local model — no API key needed."
        : "Set your key, then describe the match.",
      "ok",
    );
  }

  // The provider dropdown.
  //
  // The assistant is an optional extra. If its script has not loaded — a
  // cached admin page, a failed request — the panel must still work, so
  // every AI path is guarded rather than assumed.
  function buildAiPresets() {
    if (!el.aiPreset || !window.NFAssistant) return;
    el.aiPreset.innerHTML = window.NFAssistant.presets
      .map(function (p) {
        return (
          '<option value="' + esc(p.id) + '">' + esc(p.label) + "</option>"
        );
      })
      .join("");
    el.aiBaseUrl.value = window.NFAssistant.defaults.baseUrl;
    el.aiModel.value = window.NFAssistant.defaults.model;
  }

  // --- Export / publish -----------------------------------------------------

  // The exact bytes that should land in data/matches.json.
  //
  // SCHEMA 2. The version must match the committed file, or a publish
  // would silently downgrade the published schema and drop the roster
  // and the fixture fields.
  function buildMatchesFile() {
    const payload = {
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      matches: working,
    };
    return JSON.stringify(payload, null, 2) + "\n";
  }

  // The exact bytes that should land in data/team.json.
  function buildTeamFile() {
    // schemaVersion is written LAST so a stale draft carrying
    // schemaVersion: 1 cannot override the current schema.
    const out = Object.assign({}, team, { schemaVersion: 2 });
    return JSON.stringify(out, null, 2) + "\n";
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function exportMatches() {
    download("matches.json", buildMatchesFile());
    setStatus("Downloaded matches.json. Copy it into data/ and commit.", "ok");
  }

  function exportTeam() {
    download("team.json", buildTeamFile());
    setStatus("Downloaded team.json. Copy it into data/ and commit.", "ok");
  }

  // Publish through the GitHub API. This is the "one button" path: it
  // commits data/matches.json AND data/team.json, which makes GitHub
  // Pages rebuild the site with both the new records and the new team
  // details.
  //
  // The token is sent as a header over HTTPS. It is never written to
  // localStorage or to disk, and it is cleared when the panel is locked.
  function publishToGitHub() {
    // Read the token from the field at the moment of publishing. It is
    // held in a module-scoped variable for the session and never written
    // to localStorage or to disk.
    const token = el.tokenInput.value.trim();
    if (!token) {
      setStatus("Paste a GitHub token first.", "error");
      el.tokenInput.focus();
      return;
    }
    sessionToken = token;

    if (
      !window.confirm(
        "Publish " +
          working.length +
          " records and your team details to GitHub? This updates the live site.",
      )
    ) {
      el.tokenInput.value = "";
      sessionToken = null;
      return;
    }

    setStatus("Publishing…", "warn");

    const apiBase =
      "https://api.github.com/repos/" +
      GITHUB_OWNER +
      "/" +
      GITHUB_REPO +
      "/contents/";

    const headers = {
      Authorization: "Bearer " + sessionToken,
      Accept: "application/vnd.github+json",
    };

    // base64 of a UTF-8 string. btoa() alone throws on any non-Latin1
    // character, and a Hindi team name or a Devanagari note would break
    // the publish silently.
    function toBase64(text) {
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    // PUT one file. GitHub needs the current blob SHA to update it, and
    // a missing file is created when the SHA is omitted.
    function putFile(filePath, content, message) {
      const url = apiBase + filePath;
      return fetch(url + "?ref=" + GITHUB_BRANCH, { headers: headers })
        .then(function (res) {
          if (res.status === 404) return null; // The file does not exist yet.
          if (!res.ok) {
            throw new Error(
              "Could not read " + filePath + " (HTTP " + res.status + ").",
            );
          }
          return res.json();
        })
        .then(function (existing) {
          return fetch(url, {
            method: "PUT",
            headers: Object.assign({}, headers, {
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              message: message,
              content: toBase64(content),
              branch: GITHUB_BRANCH,
              sha: existing ? existing.sha : undefined,
            }),
          });
        })
        .then(function (res) {
          if (!res.ok) {
            return res.json().then(function (body) {
              throw new Error(
                (body && body.message ? body.message : "HTTP " + res.status) +
                  " (while writing " +
                  filePath +
                  ")",
              );
            });
          }
          return res.json();
        });
    }

    putFile(
      GITHUB_FILE,
      buildMatchesFile(),
      "chore(matches): update match archive (" + working.length + " records)",
    )
      .then(function () {
        // Only publish the team file when it actually carries a name —
        // otherwise a half-filled form would blank out the live team
        // details.
        if (!team || !team.name) return null;
        return putFile(
          GITHUB_TEAM_FILE,
          buildTeamFile(),
          "chore(team): update team details",
        );
      })
      .then(function () {
        dirty = false;
        updateStatus();
        setStatus(
          "Published. GitHub Pages will rebuild the site in about a minute.",
          "ok",
        );
      })
      .catch(function (err) {
        setStatus("Publish failed: " + err.message, "error");
      })
      .then(function () {
        // Drop the token from memory once the request is done, whether it
        // succeeded or failed. The field itself is cleared too.
        sessionToken = null;
        el.tokenInput.value = "";
      });
  }

  // --- Wiring ---------------------------------------------------------------

  function wire() {
    el.pinForm.addEventListener("submit", function (e) {
      e.preventDefault();
      const value = el.pinInput.value;
      if (hashesMatch(sha256(value), PASS_HASH)) {
        el.pinGate.hidden = true;
        el.adminPanel.hidden = false;
        el.pinError.hidden = true;
        el.pinInput.value = "";
        startSession();
      } else {
        el.pinError.hidden = false;
        el.pinInput.value = "";
        el.pinInput.focus();
      }
    });

    el.btnLock.addEventListener("click", function () {
      // Dropping the token is what makes locking meaningful.
      sessionToken = null;
      el.tokenInput.value = "";
      // The API key goes the same way — it is a secret, and a locked
      // panel must not keep one in memory.
      if (window.NFAssistant) window.NFAssistant.clearKey();
      el.aiKey.value = "";
      el.adminPanel.hidden = true;
      el.pinGate.hidden = false;
      el.pinInput.focus();
    });

    el.btnAdd.addEventListener("click", function () {
      openEditor(null);
    });

    el.editForm.addEventListener("submit", function (e) {
      e.preventDefault();
      saveEditor();
    });

    el.btnCancelEdit.addEventListener("click", function () {
      el.editDialog.close();
    });

    // Round-by-round builder.
    if (el.btnAddRound) {
      el.btnAddRound.addEventListener("click", addRound);
    }
    if (el.roundsList) {
      el.roundsList.addEventListener("click", function (e) {
        const btn = e.target.closest
          ? e.target.closest(".round-chip-admin__remove")
          : null;
        if (btn) {
          const i = Number(btn.getAttribute("data-round"));
          if (!Number.isNaN(i)) removeRound(i);
        }
      });
    }

    el.btnExportMatches.addEventListener("click", exportMatches);
    el.btnExportTeam.addEventListener("click", exportTeam);
    el.btnPublish.addEventListener("click", publishToGitHub);
    el.btnRemoveDemo.addEventListener("click", removeDemoRecords);

    // --- AI assistant ------------------------------------------------------
    if (el.aiPreset) {
      el.aiPreset.addEventListener("change", function () {
        applyAiPreset(el.aiPreset.value);
      });
    }
    if (el.btnAiDraft) {
      el.btnAiDraft.addEventListener("click", requestAiDraft);
    }
    if (el.btnAiTest) {
      el.btnAiTest.addEventListener("click", requestAiTest);
    }
    if (el.btnAiSample) {
      el.btnAiSample.addEventListener("click", function () {
        el.aiPrompt.value =
          "Won 3-1 against Team Velocity in the TEAM QUANTUM GAMING Cup on 21 October. " +
          "Clash Squad on Bermuda. Entry fee was 48 in total and we won 448, so 112 each.";
        el.aiPrompt.focus();
        setAiStatus("Example loaded. Press Draft the record.", "ok");
      });
    }
    // Ctrl/Cmd+Enter drafts from the prompt box, because a long note is
    // much easier to write without reaching for the mouse.
    if (el.aiPrompt) {
      el.aiPrompt.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          requestAiDraft();
        }
      });
    }

    el.btnResetAll.addEventListener("click", function () {
      if (
        !window.confirm(
          "Discard all changes in this browser and reload the published records?",
        )
      ) {
        return;
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TEAM_KEY);
      } catch (e) {
        // Storage may be unavailable; the reload below still resets the view.
      }
      dirty = false;
      loadFromFiles();
    });

    el.teamForm.addEventListener("submit", function (e) {
      e.preventDefault();

      // The lineup is parsed first. A bad role must not be allowed to
      // save a half-written team file, and the error has to say WHICH
      // line is wrong.
      let roster;
      try {
        roster = readRosterLines(el.teamRoster.value);
      } catch (err) {
        el.teamRosterError.textContent = err.message;
        el.teamRosterError.hidden = false;
        el.teamRoster.focus();
        return;
      }
      el.teamRosterError.hidden = true;

      // The roster is carried over from the loaded team object rather
      // than rebuilt from scratch. Dropping it here would erase the
      // published lineup the first time the owner saved any other team
      // detail.
      team = {
        schemaVersion: 2,
        name: el.teamName.value.trim(),
        tagline: el.teamTagline.value.trim(),
        taglineHi: el.teamTaglineHi.value.trim(),
        about: el.teamAbout.value.trim(),
        aboutHi: el.teamAboutHi.value.trim(),
        city: el.teamCity.value.trim(),
        email: el.teamEmail.value.trim(),
        whatsapp: el.teamWhatsapp.value.trim(),
        instagram: el.teamInstagram.value.trim(),
        youtube: el.teamYoutube.value.trim(),
        logoText: el.teamName.value.trim().slice(0, 2).toUpperCase() || "NF",
        roster: roster,
      };
      saveLocal();
      setStatus(
        "Team details saved in this browser. Export team.json to publish.",
        "ok",
      );
    });

    // Row actions are delegated, because the list re-renders on every edit.
    el.itemList.addEventListener("click", function (e) {
      const btn = e.target.closest
        ? e.target.closest("button[data-action]")
        : null;
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "edit") {
        const rec = working.find(function (x) {
          return x.id === id;
        });
        if (rec) openEditor(rec);
      }
      if (action === "delete") {
        deleteRecord(id);
      }
    });
  }

  function startSession() {
    const local = loadLocal();

    // A draft exists if the KEY exists — regardless of whether it holds
    // zero records. An intentionally empty draft is a valid state: the
    // owner deleted every record and has not published yet.
    if (local) {
      working = local.records.slice();
      dirty = true;
    } else {
      loadFromFiles();
    }

    // The team draft may live in the wrapper or in its own key. The
    // wrapper wins, because it is the newer write.
    if (local && local.team && typeof local.team === "object") {
      team = local.team;
    } else {
      try {
        const savedTeam = localStorage.getItem(TEAM_KEY);
        if (savedTeam) team = JSON.parse(savedTeam);
      } catch (e) {
        // Fall back to the published team file.
      }
    }

    render();
    updateStatus();
    el.pinInput.focus();
  }

  // --- Boot -----------------------------------------------------------------

  function boot() {
    el.pinGate = $("pinGate");
    el.pinForm = $("pinForm");
    el.pinInput = $("pinInput");
    el.pinError = $("pinError");
    el.adminPanel = $("adminPanel");
    el.status = $("status");
    el.itemList = $("itemList");
    el.itemCount = $("itemCount");
    el.btnAdd = $("btnAdd");
    el.btnExportMatches = $("btnExportMatches");
    el.btnExportTeam = $("btnExportTeam");
    el.btnPublish = $("btnPublish");
    el.btnRemoveDemo = $("btnRemoveDemo");
    el.btnResetAll = $("btnResetAll");
    el.btnLock = $("btnLock");
    el.tokenInput = $("tokenInput");
    el.teamForm = $("teamForm");
    el.teamName = $("teamName");
    el.teamTagline = $("teamTagline");
    el.teamTaglineHi = $("teamTaglineHi");
    el.teamAbout = $("teamAbout");
    el.teamAboutHi = $("teamAboutHi");
    el.teamCity = $("teamCity");
    el.teamEmail = $("teamEmail");
    el.teamWhatsapp = $("teamWhatsapp");
    el.teamInstagram = $("teamInstagram");
    el.teamYoutube = $("teamYoutube");
    el.teamRoster = $("teamRoster");
    el.teamRosterError = $("teamRosterError");
    el.editDialog = $("editDialog");
    el.editForm = $("editForm");
    el.dialogTitle = $("dialogTitle");
    el.editId = $("editId");
    el.editDate = $("editDate");
    el.editTime = $("editTime");
    el.editStatus = $("editStatus");
    el.editMode = $("editMode");
    el.editEvent = $("editEvent");
    el.editEventName = $("editEventName");
    el.editMap = $("editMap");
    el.editOpponent = $("editOpponent");
    el.editScore = $("editScore");
    el.editResult = $("editResult");
    el.editPlacement = $("editPlacement");
    el.editEntryFee = $("editEntryFee");
    el.editPrize = $("editPrize");
    el.editPrizePerWinner = $("editPrizePerWinner");

    el.editRoster = $("editRoster");
    el.editNotes = $("editNotes");
    el.editDemo = $("editDemo");
    el.editError = $("editError");
    el.btnCancelEdit = $("btnCancelEdit");
    // Round-by-round builder.
    el.roundsEditor = $("roundsEditor");
    el.editRoundTeam = $("editRoundTeam");
    el.btnAddRound = $("btnAddRound");
    el.roundsList = $("roundsList");

    // The AI assistant.
    el.aiPreset = $("aiPreset");
    el.aiBaseUrl = $("aiBaseUrl");
    el.aiModel = $("aiModel");
    el.aiKey = $("aiKey");
    el.aiPrompt = $("aiPrompt");
    el.aiStatus = $("aiStatus");
    el.aiConnectStatus = $("aiConnectStatus");
    el.aiMath = $("aiMath");
    el.aiMathGrid = $("aiMathGrid");
    el.btnAiDraft = $("btnAiDraft");
    el.btnAiTest = $("btnAiTest");
    el.btnAiSample = $("btnAiSample");

    buildAiPresets();

    // Populate the mode and event selects from the shared constants, so
    // the admin and the site cannot drift apart.
    el.editMode.innerHTML = MODES.map(function (m) {
      return (
        '<option value="' +
        esc(m) +
        '">' +
        esc(m + " — " + (MODE_LABELS[m] || m)) +
        "</option>"
      );
    }).join("");
    el.editEvent.innerHTML = EVENTS.map(function (e) {
      return '<option value="' + esc(e) + '">' + esc(e) + "</option>";
    }).join("");
    el.editResult.innerHTML = RESULTS.map(function (r) {
      return '<option value="' + esc(r) + '">' + esc(r) + "</option>";
    }).join("");
    el.editStatus.innerHTML = STATUSES.map(function (s) {
      return (
        '<option value="' +
        esc(s) +
        '">' +
        esc(STATUS_LABELS[s] || s) +
        "</option>"
      );
    }).join("");

    // Switching the status switches the result and score fields on and
    // off, so a scheduled match can never carry a result by accident.
    el.editStatus.addEventListener("change", applyStatusToFields);
    // Changing the mode changes whether rounds apply (CS/LW only).
    el.editMode.addEventListener("change", updateRoundsVisibility);

    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
