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
    const wins = working.filter(function (m) {
      return m.result === "W";
    }).length;
    el.itemCount.textContent =
      working.length +
      " records · " +
      wins +
      " wins · " +
      working.filter(function (m) {
        return m.demo;
      }).length +
      " sample";
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
        return (
          '<div class="row" data-id="' +
          esc(m.id) +
          '">' +
          '<div class="row__main">' +
          '<div class="row__title">' +
          esc(m.eventName || "(no event name)") +
          demoTag +
          "</div>" +
          '<div class="row__meta">' +
          '<span class="row__date">' +
          esc(m.date || "—") +
          "</span>" +
          '<span class="row__badge">' +
          esc(m.mode ? m.mode + " — " + (MODE_LABELS[m.mode] || m.mode) : "—") +
          "</span>" +
          '<span class="row__badge">' +
          esc(m.event || "—") +
          "</span>" +
          '<span class="row__badge row__badge--' +
          esc(m.result || "D") +
          '">' +
          esc(m.result || "—") +
          "</span>" +
          '<span class="row__fee">₹' +
          esc(m.entryFee || 0) +
          " fee · ₹" +
          esc(m.prize || 0) +
          " prize</span>" +
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
  }

  // --- Editing --------------------------------------------------------------

  // A stable id for a new record. The timestamp is enough — the owner is
  // the only one adding records.
  function newId() {
    return "m-" + Date.now().toString(36);
  }

  function openEditor(record) {
    const isNew = !record;
    const m = record || {
      id: newId(),
      date: "",
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
      notes: "",
      demo: false,
    };

    el.editId.value = m.id;
    el.editDate.value = m.date || "";
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
    el.editNotes.value = m.notes || "";
    el.editDemo.checked = m.demo === true;

    el.dialogTitle.textContent = isNew ? "Add match" : "Edit match";
    el.editDialog.showModal();
    el.editEventName.focus();
  }

  function readEditor() {
    return {
      id: el.editId.value || newId(),
      date: el.editDate.value.trim(),
      mode: el.editMode.value,
      event: el.editEvent.value,
      eventName: el.editEventName.value.trim(),
      map: el.editMap.value.trim(),
      opponent: el.editOpponent.value.trim(),
      score: el.editScore.value.trim(),
      result: el.editResult.value,
      placement:
        el.editPlacement.value === "" ? null : Number(el.editPlacement.value),
      entryFee:
        el.editEntryFee.value === "" ? 0 : Number(el.editEntryFee.value),
      prize: el.editPrize.value === "" ? 0 : Number(el.editPrize.value),
      notes: el.editNotes.value.trim(),
      demo: el.editDemo.checked,
    };
  }

  function validate(m) {
    if (!m.date) return "Date is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date))
      return "Date must be in YYYY-MM-DD format.";
    if (!m.eventName) return "Event name is required.";
    if (!m.opponent) return "Opponent is required.";
    if (Number.isNaN(m.entryFee) || m.entryFee < 0)
      return "Entry fee must be zero or more.";
    if (Number.isNaN(m.prize) || m.prize < 0)
      return "Prize must be zero or more.";
    if (
      m.placement !== null &&
      (Number.isNaN(m.placement) || m.placement < 1)
    ) {
      return "Placement must be a positive whole number.";
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

  // --- Export / publish -----------------------------------------------------

  // The exact bytes that should land in data/matches.json.
  function buildMatchesFile() {
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      matches: working,
    };
    return JSON.stringify(payload, null, 2) + "\n";
  }

  // The exact bytes that should land in data/team.json.
  function buildTeamFile() {
    return (
      JSON.stringify(Object.assign({ schemaVersion: 1 }, team), null, 2) + "\n"
    );
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

    el.btnExportMatches.addEventListener("click", exportMatches);
    el.btnExportTeam.addEventListener("click", exportTeam);
    el.btnPublish.addEventListener("click", publishToGitHub);
    el.btnRemoveDemo.addEventListener("click", removeDemoRecords);

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
      team = {
        schemaVersion: 1,
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
    el.editDialog = $("editDialog");
    el.editForm = $("editForm");
    el.dialogTitle = $("dialogTitle");
    el.editId = $("editId");
    el.editDate = $("editDate");
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
    el.editNotes = $("editNotes");
    el.editDemo = $("editDemo");
    el.editError = $("editError");
    el.btnCancelEdit = $("btnCancelEdit");

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

    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
