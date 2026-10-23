// app.js — renders the archive, wires the filters and the stats section.
//
// Rendering is a full re-render of the list on every state change. The
// list is at most a few hundred rows, so a virtualised diff would add
// complexity without buying anything measurable. The stats section is
// recomputed from the same array the list renders, so the two can never
// disagree.
(function () {
  "use strict";

  const state = {
    team: null,
    matches: [],
    stats: null,
    fixture: null,
    // The record's SHAPE — streaks, head-to-head rows and per-player
    // numbers. Computed by the data layer over the played matches only.
    extras: null,
    filters: { mode: "", event: "", result: "", year: "", query: "" },
    loaded: false,
  };

  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function t(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  function lang() {
    return window.I18N ? window.I18N.getLang() : "en";
  }
  // The display name of a mode code, e.g. "CS" -> "Clash Squad".
  //
  // The mode name is a proper noun in the game, so it is never translated
  // into a different word — but the label still has to come from one
  // place. The i18n dictionary is checked first, and the shared
  // MODE_LABELS map in data.js is the fallback, so a code with no
  // dictionary entry still renders a real name instead of a bare code.
  function modeLabel(code) {
    const key =
      "mode" +
      String(code || "").charAt(0) +
      String(code || "")
        .slice(1)
        .toLowerCase();
    const label = t(key);
    if (label && label !== key) return label;
    const labels = window.ArchiveData ? window.ArchiveData.MODE_LABELS : null;
    return (labels && labels[code]) || code || "";
  }

  // --- Escaping -------------------------------------------------------------

  // Every value that reaches innerHTML goes through this. Match records are
  // owner-authored, but "owner-authored" is not "safe" — an opponent name
  // containing a quote must not be able to break out of an attribute.
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // --- Match card -----------------------------------------------------------

  // The word behind a one-letter result code: "W" -> "Win".
  //
  // The dictionary holds both — `resultW` is the letter used on the rail
  // and in the form flags, `resultWin` is the word used in titles. Looking
  // up "result" + "W" would return the letter, so the code is expanded
  // first.
  function resultCode(code) {
    if (code === "W") return "Win";
    if (code === "L") return "Loss";
    if (code === "D") return "Draw";
    return "";
  }

  function renderMatch(m) {
    const l = lang();
    // The short code is the letter; the rail's word comes from the
    // full-word key, so "W" is painted as "Win".
    const resultWord = m.result ? t("result" + resultCode(m.result)) : "";
    const money = window.ArchiveData.formatMoney;

    let meta = "";
    if (m.placement) {
      meta +=
        "<div><dt>" +
        esc(t("labelPlacement")) +
        "</dt><dd>#" +
        esc(m.placement) +
        "</dd></div>";
    }
    meta +=
      "<div><dt>" +
      esc(t("labelEntryFee")) +
      "</dt><dd>" +
      (m.entryFee ? esc(money(m.entryFee, l)) : esc(t("noFee"))) +
      "</dd></div>";
    meta +=
      "<div><dt>" +
      esc(t("labelPrize")) +
      "</dt><dd>" +
      (m.prize ? esc(money(m.prize, l)) : esc(t("noPrize"))) +
      "</dd></div>";

    const demoTag = m.demo
      ? ' <span class="match__demo-tag">' + esc(t("demoTag")) + "</span>"
      : "";

    const eventLabel = m.event
      ? '<span class="badge badge--event">' +
        esc(t("event" + m.event)) +
        "</span>"
      : "";

    const modeBadge = m.mode
      ? '<span class="badge badge--mode">' + esc(modeLabel(m.mode)) + "</span>"
      : "";

    // The result rail. The letter is the only text in the element, so a
    // test (or a screen reader) reads "W". The full word is painted by CSS
    // from the data-word attribute, so generated content cannot leak into
    // the element's text.
    const resultBadge = m.result
      ? '<span class="match__result" data-r="' +
        esc(m.result) +
        '" data-word="' +
        esc(resultWord) +
        '" title="' +
        esc(resultWord) +
        '">' +
        esc(m.result) +
        "</span>"
      : '<span class="match__result" data-r="" data-word="" aria-hidden="true">·</span>';

    const notes = m.notes
      ? '<p class="match__notes">' + esc(m.notes) + "</p>"
      : "";

    // Round-by-round — the per-round winners for a round series. Only when
    // the match actually records them. Each round is a chip that shows who
    // won that round (NF or the opponent), with the round number.
    let roundsHtml = "";
    if (m.rounds && m.rounds.length) {
      const roundChips = m.rounds
        .map(function (r) {
          const side = r.team === "NF" ? "nf" : "opp";
          const word = r.team === "NF" ? t("roundNf") : t("roundOpp");
          return (
            '<span class="round-chip" data-side="' +
            side +
            '" title="' +
            esc(t("roundWon") + " " + word) +
            '"><span class="round-chip__num" aria-hidden="true">R' +
            esc(r.round) +
            '</span><span class="round-chip__team">' +
            esc(word) +
            "</span></span>"
          );
        })
        .join("");
      roundsHtml =
        '<div class="match__rounds"><span class="round-chip__label">' +
        esc(t("labelRounds")) +
        '</span><span class="round-chip__list">' +
        roundChips +
        "</span></div>";
    }

    const opponent = m.opponent
      ? '<span class="match__opponent">' + esc(m.opponent) + "</span>"
      : '<span class="match__opponent" data-empty="true">—</span>';
    const score = m.score
      ? '<span class="match__score">' + esc(m.score) + "</span>"
      : '<span class="match__score" data-empty="true">—</span>';
    const map = m.map ? esc(m.map) : "—";

    return (
      '<article class="match" data-result="' +
      esc(m.result || "none") +
      '" data-id="' +
      esc(m.id) +
      '">' +
      resultBadge +
      '<div class="match__body">' +
      '<div class="match__head">' +
      '<span class="match__date">' +
      esc(window.ArchiveData.formatDate(m.date, l)) +
      "</span>" +
      modeBadge +
      eventLabel +
      "</div>" +
      '<h3 class="match__event">' +
      esc(m.eventName || m.event || "—") +
      demoTag +
      "</h3>" +
      '<div class="match__scoreline">' +
      '<span class="match__scorebox">' +
      '<span class="visually-hidden">' +
      esc(t("labelScore")) +
      " </span>" +
      score +
      "</span>" +
      '<span class="match__vs">' +
      esc(t("vs")) +
      "</span>" +
      '<span class="match__opponentbox">' +
      '<span class="match__opponent-label">' +
      esc(t("labelOpponent")) +
      "</span>" +
      opponent +
      "</span>" +
      "</div>" +
      '<dl class="match__meta">' +
      "<div><dt>" +
      esc(t("colMap")) +
      "</dt><dd>" +
      map +
      "</dd></div>" +
      meta +
      "</dl>" +
      roundsHtml +
      notes +
      "</div>" +
      "</article>"
    );
  }

  // --- Filtering ------------------------------------------------------------

  // The calendar year of a match, taken from the ISO date string.
  // The date is always "YYYY-MM-DD" after normalization, so the first
  // four characters are the year. No Date parsing, no timezone drift.
  function matchYear(m) {
    return String(m.date || "").slice(0, 4);
  }

  // The matches that have actually been played. A scheduled fixture is an
  // announcement and never enters the log, the form strip, the chips or
  // the statistics.
  function playedMatches() {
    return state.matches.filter(function (m) {
      return m.status !== "scheduled";
    });
  }

  // The query matches against the fields a player would actually type:
  // opponent, event name, event type, map and notes.
  function matchesQuery(m, q) {
    if (!q) return true;
    const haystack = [
      m.opponent,
      m.eventName,
      m.event,
      m.map,
      m.notes,
      m.score,
      m.mode,
      m.mode ? modeLabel(m.mode) : "",
      m.result,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(q.toLowerCase()) !== -1;
  }

  function filteredMatches() {
    const f = state.filters;
    return playedMatches().filter(function (m) {
      if (f.mode && m.mode !== f.mode) return false;
      if (f.event && m.event !== f.event) return false;
      if (f.result && m.result !== f.result) return false;
      if (f.year && matchYear(m) !== f.year) return false;
      if (!matchesQuery(m, f.query.trim())) return false;
      return true;
    });
  }

  // --- Rendering ------------------------------------------------------------

  function renderList() {
    const list = filteredMatches();
    const count = list.length;

    if (el.resultCount) {
      el.resultCount.textContent = count + " " + t("resultsCount");
    }

    // The empty state and the error state are separate elements, so the
    // error is never wiped by a filter that happens to match nothing.
    if (el.emptyState) {
      el.emptyState.hidden = count > 0;
    }

    if (!el.matchList) return;

    if (count === 0) {
      el.matchList.innerHTML = "";
      el.matchList.hidden = true;
      return;
    }

    el.matchList.hidden = false;
    el.matchList.innerHTML = list.map(renderMatch).join("");
  }

  function renderStats() {
    if (!state.stats || !el.statsGrid) return;
    const s = state.stats;
    const l = lang();
    const money = window.ArchiveData.formatMoney;
    const num = window.ArchiveData.formatNumber;

    function stat(label, value, accent) {
      return (
        '<div class="stat"><span class="stat__label">' +
        esc(label) +
        '</span><span class="stat__value' +
        (accent ? " stat__value--accent" : "") +
        '">' +
        esc(value) +
        "</span></div>"
      );
    }

    let html = "";
    html += stat(t("statTotalMatches"), num(s.total, l));
    html += stat(t("statWins"), num(s.wins, l));
    html += stat(t("statLosses"), num(s.losses, l));
    html += stat(t("statDraws"), num(s.draws, l));
    html += stat(t("statWinRate"), s.winRate.toFixed(1) + "%", true);
    html += stat(t("statPrizeTotal"), money(s.totalPrize, l) || "—", true);
    html += stat(t("statEntryTotal"), money(s.totalEntry, l) || "—");
    html += stat(t("statNet"), money(s.net, l) || "—");
    html += stat(t("statAvgPrize"), money(Math.round(s.avgPrize), l) || "—");
    html += stat(t("statModes"), num(s.modes.length, l));
    html += stat(t("statEvents"), num(s.events.length, l));
    if (s.bestPlacement)
      html += stat(t("statBestPlacement"), "#" + s.bestPlacement);
    if (s.firstDate) {
      html += stat(
        t("statFirstMatch"),
        window.ArchiveData.formatDate(toISODate(s.firstDate), l),
      );
    }
    if (s.lastDate) {
      html += stat(
        t("statLatestMatch"),
        window.ArchiveData.formatDate(toISODate(s.lastDate), l),
      );
    }

    el.statsGrid.innerHTML = html;
    renderBreakdown(el.breakdownModes, s.modes, "mode");
    renderBreakdown(el.breakdownEvents, s.events, "event");
  }

  // Back to "YYYY-MM-DD" for a Date the stats layer produced.
  function toISODate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  // A breakdown row: the key, a proportional bar and the W/L count.
  //
  // The same renderer draws the mode breakdown and the event breakdown, so
  // it needs to know which kind of key it is holding. A mode key is a code
  // like "CS" and gets the full mode name; an event key is a word like
  // "Tournament" and gets the translated event name.
  //
  // The bar is a split, not a single fill: the wins take the win colour,
  // the losses take the loss colour, and the part of the scale the row did
  // not reach stays neutral. That way the bar shows the record, not just
  // the volume.
  function renderBreakdown(container, rows, kind) {
    if (!container) return;
    if (!rows || rows.length === 0) {
      container.innerHTML = '<p class="state__body">—</p>';
      return;
    }
    const max = rows.reduce(function (m, r) {
      return Math.max(m, r.played);
    }, 0);

    container.innerHTML = rows
      .map(function (r) {
        const label =
          kind === "mode"
            ? modeLabel(r.key)
            : t("event" + r.key) !== "event" + r.key
              ? t("event" + r.key)
              : r.key;
        const scale = max > 0 ? max : 1;
        const wins = r.wins || 0;
        const losses = r.losses || 0;
        const draws = r.draws || 0;
        const played = r.played || 0;
        // Each segment is a share of the widest row, so the bars stay
        // comparable down the column.
        const winPct = (wins / scale) * 100;
        const lossPct = (losses / scale) * 100;
        const drawPct = (draws / scale) * 100;
        const restPct = Math.max(0, 100 - winPct - lossPct - drawPct);

        let bar = "";
        if (wins > 0)
          bar +=
            '<span class="breakdown__bar-win" style="--w:' +
            winPct.toFixed(2) +
            '%"></span>';
        if (losses > 0)
          bar +=
            '<span class="breakdown__bar-loss" style="--w:' +
            lossPct.toFixed(2) +
            '%"></span>';
        if (draws > 0)
          bar +=
            '<span class="breakdown__bar-draw" style="--w:' +
            drawPct.toFixed(2) +
            '%"></span>';
        if (restPct > 0)
          bar +=
            '<span class="breakdown__bar-rest" style="--w:' +
            restPct.toFixed(2) +
            '%"></span>';

        return (
          '<div class="breakdown__row">' +
          '<div class="breakdown__head">' +
          '<span class="breakdown__key">' +
          esc(label) +
          "</span>" +
          '<span class="breakdown__val mono">' +
          esc(wins) +
          "W / " +
          esc(losses) +
          "L" +
          (draws > 0 ? " / " + esc(draws) + "D" : "") +
          " · " +
          esc(played) +
          "</span>" +
          "</div>" +
          '<div class="breakdown__bar">' +
          bar +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderHero() {
    const s = state.stats;
    if (!s) return;
    const l = lang();
    const num = window.ArchiveData.formatNumber;
    const money = window.ArchiveData.formatMoney;

    // The headline numbers live in the board panel in the hero. They read
    // from the same stats object the stats section uses, so the two can
    // never disagree.
    if (el.boardMatches) el.boardMatches.textContent = num(s.total, l);
    if (el.boardWins) el.boardWins.textContent = num(s.wins, l);
    if (el.boardWinRate)
      el.boardWinRate.textContent = s.winRate.toFixed(1) + "%";
    if (el.boardPrize)
      el.boardPrize.textContent = money(s.totalPrize, l) || "—";

    // The season label follows the archive, not a hard-coded year. The
    // window is the span between the first and the last record, so a
    // roster that only played in one year reads as one season.
    if (el.boardSeason) {
      const first = s.firstDate ? s.firstDate.getFullYear() : null;
      const last = s.lastDate ? s.lastDate.getFullYear() : null;
      if (first && last && first !== last) {
        el.boardSeason.textContent = first + "–" + last;
      } else if (first) {
        el.boardSeason.textContent = String(first);
      } else {
        el.boardSeason.textContent = "—";
      }
    }
    // Recent form — the last 10 results, newest first.
    if (el.formRow) {
      const recent = playedMatches().slice(0, 10);
      el.formRow.innerHTML = recent
        .map(function (m) {
          return (
            '<span class="form-dot" data-r="' +
            esc(m.result) +
            '" title="' +
            esc(m.eventName || m.event) +
            '">' +
            esc(m.result || "—") +
            "</span>"
          );
        })
        .join("");
    }

    // The sample banner only appears while sample records exist.
    if (el.demoBanner) {
      el.demoBanner.hidden = s.demoCount === 0;
    }
  }

  // --- Modes rail ----------------------------------------------------------
  //
  // The three Free Fire MAX competitive modes, each with its own record
  // and a link that filters the archive to it. The description is what
  // the mode actually is, so a visitor who does not know the game can
  // still tell what they are looking at.

  const MODE_DESCRIPTIONS = {
    CS: "modeDescCs",
    BR: "modeDescBr",
    LW: "modeDescLw",
  };

  function renderModes() {
    if (!el.modeRail) return;
    const l = lang();
    const num = window.ArchiveData.formatNumber;
    const modes = window.ArchiveData.MODES;

    el.modeRail.innerHTML = modes
      .map(function (code, i) {
        const rows = playedMatches().filter(function (m) {
          return m.mode === code;
        });
        const wins = rows.filter(function (m) {
          return m.result === "W";
        }).length;
        const descKey = MODE_DESCRIPTIONS[code];
        const desc = descKey ? t(descKey) : "";

        return (
          '<li class="rv">' +
          '<a class="mode" href="#archive" data-mode-link="' +
          esc(code) +
          '">' +
          '<span class="mode__index" aria-hidden="true">' +
          String(i + 1).padStart(2, "0") +
          "</span>" +
          '<span class="mode__name">' +
          esc(modeLabel(code)) +
          "</span>" +
          '<span class="mode__desc">' +
          esc(desc) +
          "</span>" +
          '<span class="mode__stat"><b>' +
          esc(num(rows.length, l)) +
          "</b>" +
          esc(t("modePlayed")) +
          "</span>" +
          '<span class="mode__stat mode__stat--plain"><b>' +
          esc(num(wins, l)) +
          "</b>" +
          esc(t("modeWon")) +
          "</span>" +
          '<span class="mode__go">' +
          esc(t("modeView")) +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>' +
          "</span>" +
          "</a>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderTeam() {
    const team = state.team;
    if (!team) return;

    if (el.brandName) el.brandName.textContent = team.name;
    if (el.brandMark) el.brandMark.textContent = team.logoText || "NF";
    if (el.heroTeamName) el.heroTeamName.textContent = team.name;

    // The board panel repeats the team identity, so the hero reads as a
    // roster card rather than a page of floating text.
    if (el.boardName) el.boardName.textContent = team.name;
    if (el.boardMark) el.boardMark.textContent = team.logoText || "NF";
    if (el.boardCity) el.boardCity.textContent = team.city || "";

    // The owner can supply a Hindi tagline and description. When they are
    // present the Hindi view uses them; otherwise the English text stays,
    // which is better than showing an empty panel.
    const hi = lang() === "hi";
    const aboutText = hi ? team.aboutHi || team.about || "" : team.about || "";
    const taglineText = hi
      ? team.taglineHi || team.tagline || ""
      : team.tagline || "";
    if (el.teamAbout) el.teamAbout.textContent = aboutText;
    if (el.teamTagline) el.teamTagline.textContent = taglineText;

    function setFact(id, value, href, isLink) {
      const node = $(id);
      if (!node) return;
      // A value that is not set must not stay a link. Leaving href="#"
      // behind makes "Not set" a dead control: it is focusable, it looks
      // clickable, and activating it jumps the page to the top.
      if (!value) {
        node.textContent = t("notSet");
        node.removeAttribute("href");
        node.setAttribute("aria-disabled", "true");
        node.setAttribute("data-not-set", "true");
        return;
      }
      node.removeAttribute("aria-disabled");
      node.removeAttribute("data-not-set");
      if (isLink && href) {
        node.textContent = value;
        node.setAttribute("href", href);
      } else {
        node.textContent = value;
        node.removeAttribute("href");
      }
    }

    setFact("factCity", team.city);
    setFact("factEmail", team.email, "mailto:" + team.email, true);
    setFact(
      "factWhatsapp",
      team.whatsapp ? "+91 " + team.whatsapp : "",
      team.whatsapp ? "https://wa.me/" + team.whatsapp : "",
      true,
    );
    setFact(
      "factInstagram",
      team.instagram ? "@" + team.instagram.replace(/^@/, "") : "",
      team.instagram
        ? "https://instagram.com/" + team.instagram.replace(/^@/, "")
        : "",
      true,
    );
    setFact(
      "factYoutube",
      team.youtube ? team.youtube : "",
      team.youtube ? "https://youtube.com/" + team.youtube : "",
      true,
    );

    if (el.footerYear)
      el.footerYear.textContent = String(new Date().getFullYear());
    if (el.contactWhatsapp) {
      if (team.whatsapp) {
        el.contactWhatsapp.setAttribute(
          "href",
          "https://wa.me/" + team.whatsapp,
        );
      } else {
        el.contactWhatsapp.hidden = true;
      }
    }
    if (el.contactEmail) {
      if (team.email) {
        el.contactEmail.setAttribute("href", "mailto:" + team.email);
      } else {
        el.contactEmail.hidden = true;
      }
    }
  }

  // --- Roster + fixture ------------------------------------------------------

  // The role label. The role key is derived from the role name, so
  // "Sniper" reads the "roleSniper" string from the dictionary. A role
  // with no dictionary entry falls back to the raw name, so a new role is
  // still shown rather than rendering as a blank chip.
  function roleLabel(role) {
    if (!role) return "";
    const key = "role" + role.charAt(0) + role.slice(1).toLowerCase();
    const label = t(key);
    if (label && label !== key) return label;
    return role;
  }

  // One player card. A guest player is marked as such — a player who
  // joined for one match is not a permanent member, and the page should
  // not imply that they are.
  function renderPlayer(p, index) {
    const roles = p.roles && p.roles.length ? p.roles : p.role ? [p.role] : [];
    const isGuest = p.status === "guest";
    return (
      '<li class="player' +
      (isGuest ? " player--guest" : "") +
      '">' +
      '<span class="player__slot" aria-hidden="true">' +
      String(index + 1).padStart(2, "0") +
      "</span>" +
      '<span class="player__name">' +
      esc(p.name) +
      "</span>" +
      (roles.length
        ? '<span class="player__role">' +
          roles
            .map(function (r) {
              return esc(roleLabel(r));
            })
            .join(" · ") +
          "</span>"
        : "") +
      (isGuest
        ? '<span class="player__tag">' + esc(t("roleGuest")) + "</span>"
        : "") +
      "</li>"
    );
  }

  // The published lineup. The names come straight from data/team.json and
  // are the players' own handles — they are escaped, never translated and
  // never rewritten.
  function renderRoster() {
    if (!el.rosterList) return;
    const roster = (state.team && state.team.roster) || [];
    if (!roster.length) {
      el.rosterList.innerHTML =
        '<li class="player player--empty">' + esc(t("rosterEmpty")) + "</li>";
      return;
    }
    el.rosterList.innerHTML = roster.map(renderPlayer).join("");
  }

  // The next fixture — the announced match that has not been played.
  //
  // A fixture carries no score and no result, so it is drawn as a fixture
  // board: what we know, and an explicit "to be announced" for what we do
  // not. Inventing an opponent or a map would be a factual error, so the
  // unknown fields say so.
  function renderFixture() {
    if (!el.fixture) return;
    const m = state.fixture;
    // The whole section disappears when there is no announced match. An
    // empty "Up next" board would be a promise the archive cannot keep.
    if (el.fixtureSection) el.fixtureSection.hidden = !m;
    if (!m) {
      el.fixture.innerHTML = "";
      return;
    }
    const l = lang();
    const money = window.ArchiveData.formatMoney;
    const dateText = window.ArchiveData.formatDate(m.date, l);
    const timeText = window.ArchiveData.formatTime(m.time, l);

    function row(label, value, fallback) {
      return (
        '<div class="fixture__row">' +
        '<dt class="fixture__label">' +
        esc(label) +
        "</dt>" +
        '<dd class="fixture__value' +
        (value ? "" : " fixture__value--tbd") +
        '">' +
        esc(value || fallback) +
        "</dd>" +
        "</div>"
      );
    }

    // The lineup for this fixture. The roster on the team file is the
    // standing squad; the fixture may name a different one — a random
    // fourth player, for example — so the fixture's own list wins when
    // it has one.
    const lineup = m.roster && m.roster.length ? m.roster : [];
    const lineupHtml = lineup.length
      ? '<ul class="fixture__players">' +
        lineup
          .map(function (name, i) {
            return (
              '<li class="fixture__player' +
              (name ? "" : " fixture__player--open") +
              '">' +
              '<span class="fixture__player-slot" aria-hidden="true">' +
              String(i + 1).padStart(2, "0") +
              "</span>" +
              '<span class="fixture__player-name">' +
              (name ? esc(name) : esc(t("playerSlot"))) +
              "</span>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="state__body">' + esc(t("rosterEmpty")) + "</p>";

    el.fixture.innerHTML =
      '<div class="fixture__head">' +
      '<span class="fixture__tag">' +
      esc(t("fixturePending")) +
      "</span>" +
      '<span class="fixture__mode">' +
      esc(modeLabel(m.mode)) +
      "</span>" +
      "</div>" +
      '<div class="fixture__when">' +
      '<span class="fixture__date">' +
      esc(dateText) +
      "</span>" +
      (timeText
        ? '<span class="fixture__time">' +
          esc(t("fixtureStarts")) +
          " " +
          esc(timeText) +
          "</span>"
        : "") +
      "</div>" +
      '<h3 class="fixture__event">' +
      esc(m.eventName || t("fixtureEventTbd")) +
      "</h3>" +
      '<dl class="fixture__rows">' +
      row(t("fixtureOpponent"), m.opponent, t("fixtureOpponentTbd")) +
      row(t("fixtureMap"), m.map, t("fixtureMapTbd")) +
      row(t("fixtureEvent"), m.eventName, t("fixtureEventTbd")) +
      row(
        t("fixtureEntry"),
        m.entryFee ? money(m.entryFee, l) : "",
        t("fixtureNoPrize"),
      ) +
      row(
        t("fixturePrize"),
        m.prizePerWinner ? money(m.prizePerWinner, l) : "",
        t("fixtureNoPrize"),
      ) +
      "</dl>" +
      '<div class="fixture__lineup">' +
      '<span class="fixture__lineup-label">' +
      esc(t("fixtureLineup")) +
      "</span>" +
      lineupHtml +
      "</div>" +
      '<p class="fixture__note">' +
      esc(t("fixturePendingNote")) +
      "</p>";
  }

  // --- Form: the streaks ----------------------------------------------------
  //
  // The shape of the record. A streak is a run of consecutive results, and
  // it is the number a team actually argues about — a 75% win rate is an
  // average, a four-match win run is a story.
  //
  // Everything here comes from `extras.streaks`, which the data layer
  // computes over the PLAYED matches only. A scheduled fixture is an
  // announcement and never counts as a result.

  // The word that describes the live run. A draw is not a win and not a
  // loss, so it gets its own label rather than being folded into one.
  function streakUnit(type) {
    if (type === "W") return t("streakCurrentWin");
    if (type === "L") return t("streakCurrentLoss");
    if (type === "D") return t("streakCurrentDraw");
    return "";
  }

  function renderStreaks() {
    if (!el.streakGrid) return;
    const extras = state.extras;
    if (!extras || !extras.streaks) {
      el.streakGrid.innerHTML = "";
      return;
    }
    const s = extras.streaks;

    function tile(label, value, unit, modifier) {
      return (
        '<div class="streak' +
        (modifier ? " streak--" + modifier : "") +
        '">' +
        '<span class="streak__label">' +
        esc(label) +
        "</span>" +
        '<span class="streak__value">' +
        esc(value) +
        (unit ? '<span class="streak__unit">' + esc(unit) + "</span>" : "") +
        "</span>" +
        "</div>"
      );
    }

    let html = "";
    // A run of one is not a streak — it is a single result. The board says
    // so rather than dressing up one win as a streak.
    if (s.currentCount >= 2 && s.currentType) {
      html += tile(
        t("streakCurrent"),
        String(s.currentCount),
        streakUnit(s.currentType),
        "live",
      );
    } else {
      html += tile(t("streakCurrent"), "—", "", "live");
    }
    html += tile(t("streakLongestWin"), String(s.longestWin), "", "plain");
    html += tile(t("streakLongestLoss"), String(s.longestLoss), "", "plain");

    el.streakGrid.innerHTML = html;

    // The last five results, as a row of flags.
    if (el.streakForm) {
      const form = s.form || [];
      if (!form.length) {
        el.streakForm.innerHTML = "";
      } else {
        el.streakForm.innerHTML =
          '<span class="streak-form__label">' +
          esc(t("streakForm")) +
          "</span>" +
          '<span class="streak-form__row">' +
          form
            .map(function (r) {
              return (
                '<span class="form-dot" data-r="' +
                esc(r) +
                '" title="' +
                esc(t("result" + r)) +
                '">' +
                esc(r) +
                "</span>"
              );
            })
            .join("") +
          "</span>";
      }
    }
  }

  // --- Head to head ---------------------------------------------------------
  //
  // One row per opponent, with the record against them. Only opponents the
  // archive actually names appear, so the board can never invent a team.
  function renderHeadToHead() {
    if (!el.h2hList) return;
    const extras = state.extras;
    const rows = (extras && extras.opponents) || [];

    if (!rows.length) {
      el.h2hList.innerHTML = "";
      if (el.h2hEmpty) el.h2hEmpty.hidden = false;
      return;
    }
    if (el.h2hEmpty) el.h2hEmpty.hidden = true;

    const money = window.ArchiveData.formatMoney;
    const l = lang();

    el.h2hList.innerHTML = rows
      .map(function (r) {
        function flag(code, count) {
          if (!count) return "";
          return (
            '<span class="h2h__flag" data-r="' +
            code +
            '" data-zero="false" title="' +
            esc(t("result" + code)) +
            '">' +
            esc(count) +
            "</span>"
          );
        }
        // The stagger is applied by nth-child in the stylesheet, the same
        // way the match cards land in sequence. No inline style is needed.
        return (
          '<div class="h2h__row">' +
          '<span class="h2h__name">' +
          esc(r.opponent) +
          "</span>" +
          '<span class="h2h__record">' +
          flag("W", r.wins) +
          flag("L", r.losses) +
          flag("D", r.draws) +
          "</span>" +
          '<span class="h2h__prize">' +
          (r.prize ? esc(money(r.prize, l)) : esc(t("noPrize"))) +
          "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  // --- Player analysis ------------------------------------------------------
  //
  // Each player's own record, counted from the lineups saved with the
  // matches they played in.
  //
  // A player with no recorded lineup has NO personal record. The section
  // says that plainly instead of showing a zero that reads like a loss —
  // "0 matches played" is a statement about the archive, and "0 wins" is a
  // statement about the player. Only one of those is true here.
  function renderPlayerStats() {
    if (!el.playerStats) return;
    const extras = state.extras;
    const rows = (extras && extras.players) || [];
    // A player counts only if a match actually recorded them.
    const recorded = rows.filter(function (p) {
      return p.played > 0;
    });

    if (!recorded.length) {
      el.playerStats.innerHTML = "";
      if (el.playerEmpty) el.playerEmpty.hidden = false;
      return;
    }
    if (el.playerEmpty) el.playerEmpty.hidden = true;

    // The roles live on the team file, not on the match. The player rows
    // are keyed by the lower-cased handle so a name typed with different
    // capitalisation still finds its role.
    const roster = (state.team && state.team.roster) || [];
    function roleFor(name) {
      const key = String(name || "").toLowerCase();
      const p = roster.find(function (r) {
        return String(r.name || "").toLowerCase() === key;
      });
      if (!p) return "";
      const roles = p.roles && p.roles.length ? p.roles : [p.role];
      return roles
        .filter(Boolean)
        .map(function (r) {
          return roleLabel(r);
        })
        .join(" · ");
    }

    el.playerStats.innerHTML = recorded
      .map(function (p, i) {
        const role = roleFor(p.name);
        const last = p.lastResult
          ? '<span class="h2h__flag" data-r="' +
            esc(p.lastResult) +
            '" title="' +
            esc(t("result" + p.lastResult)) +
            '">' +
            esc(p.lastResult) +
            "</span>"
          : "";
        return (
          '<article class="pstat">' +
          '<div class="pstat__head">' +
          '<span class="pstat__slot" aria-hidden="true">' +
          String(i + 1).padStart(2, "0") +
          "</span>" +
          "<span>" +
          '<span class="pstat__name">' +
          esc(p.name) +
          "</span>" +
          (role ? '<span class="pstat__role">' + esc(role) + "</span>" : "") +
          "</span>" +
          "</div>" +
          '<dl class="pstat__grid">' +
          "<div><dt>" +
          esc(t("playerAppearances")) +
          "</dt><dd>" +
          esc(p.played) +
          "</dd></div>" +
          "<div><dt>" +
          esc(t("statWins")) +
          "</dt><dd>" +
          esc(p.wins) +
          "</dd></div>" +
          "<div><dt>" +
          esc(t("playerWinRate")) +
          "</dt><dd>" +
          esc(p.winRate.toFixed(1)) +
          "%</dd></div>" +
          "</dl>" +
          '<div class="pstat__last">' +
          esc(t("playerLastResult")) +
          last +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderAll() {
    renderTeam();
    renderRoster();
    renderFixture();
    renderHero();
    renderModes();
    renderList();
    renderStats();
    renderStreaks();
    renderHeadToHead();
    renderPlayerStats();
  }

  // --- Filters UI -----------------------------------------------------------

  function buildChips() {
    if (!el.chipMode) return;
    const modes = window.ArchiveData.MODES;
    // The chip counts describe the LOG, so they count played matches only.
    // A scheduled fixture has no result and must not inflate a chip.
    const played = playedMatches();

    let html =
      '<button class="chip" data-filter="mode" data-value="" aria-pressed="true">' +
      esc(t("filterAll")) +
      "</button>";
    modes.forEach(function (m) {
      const count = played.filter(function (x) {
        return x.mode === m;
      }).length;
      html +=
        '<button class="chip" data-filter="mode" data-value="' +
        esc(m) +
        '" aria-pressed="false">' +
        esc(modeLabel(m)) +
        ' <span class="chip__count">' +
        esc(count) +
        "</span></button>";
    });
    el.chipMode.innerHTML = html;

    if (el.chipEvent) {
      const events = window.ArchiveData.EVENTS;
      let ev =
        '<button class="chip" data-filter="event" data-value="" aria-pressed="true">' +
        esc(t("filterAll")) +
        "</button>";
      events.forEach(function (e) {
        const count = played.filter(function (x) {
          return x.event === e;
        }).length;
        ev +=
          '<button class="chip" data-filter="event" data-value="' +
          esc(e) +
          '" aria-pressed="false">' +
          esc(t("event" + e)) +
          ' <span class="chip__count">' +
          esc(count) +
          "</span></button>";
      });
      el.chipEvent.innerHTML = ev;
    }

    if (el.chipResult) {
      const results = window.ArchiveData.RESULTS;
      let rs =
        '<button class="chip" data-filter="result" data-value="" aria-pressed="true">' +
        esc(t("filterAll")) +
        "</button>";
      results.forEach(function (r) {
        const count = played.filter(function (x) {
          return x.result === r;
        }).length;
        rs +=
          '<button class="chip" data-filter="result" data-value="' +
          esc(r) +
          '" aria-pressed="false">' +
          esc(t("result" + r)) +
          ' <span class="chip__count">' +
          esc(count) +
          "</span></button>";
      });
      el.chipResult.innerHTML = rs;
    }

    if (el.chipYear) {
      // The years come from the records themselves, newest first, so the
      // chip list never offers a year that has no matches.
      const years = [];
      played.forEach(function (m) {
        const y = matchYear(m);
        if (y && years.indexOf(y) === -1) years.push(y);
      });
      years.sort(function (a, b) {
        return b.localeCompare(a);
      });

      let ys =
        '<button class="chip" data-filter="year" data-value="" aria-pressed="true">' +
        esc(t("filterAll")) +
        "</button>";
      years.forEach(function (y) {
        const count = played.filter(function (x) {
          return matchYear(x) === y;
        }).length;
        ys +=
          '<button class="chip" data-filter="year" data-value="' +
          esc(y) +
          '" aria-pressed="false">' +
          esc(y) +
          ' <span class="chip__count">' +
          esc(count) +
          "</span></button>";
      });
      el.chipYear.innerHTML = ys;
    }
  }

  function syncChips() {
    document.querySelectorAll(".chip[data-filter]").forEach(function (chip) {
      const key = chip.getAttribute("data-filter");
      const value = chip.getAttribute("data-value");
      chip.setAttribute(
        "aria-pressed",
        state.filters[key] === value ? "true" : "false",
      );
    });
  }

  function resetFilters() {
    state.filters = { mode: "", event: "", result: "", year: "", query: "" };
    if (el.searchInput) el.searchInput.value = "";
    syncChips();
    renderList();
  }

  // --- Mobile menu ---------------------------------------------------------
  //
  // The nav links are hidden under 820px, so the burger is the only way to
  // reach them on a phone. It is a real button with aria-expanded, and
  // Escape closes it.
  //
  // These live at module scope, not inside wire(), because the label has
  // to be re-stated after a language change and after boot.

  function menuIsOpen() {
    return (
      !!el.navToggle && el.navToggle.getAttribute("aria-expanded") === "true"
    );
  }

  // The label depends on the CURRENT state, so it cannot be a static
  // data-i18n-aria value alone — i18n.apply() would overwrite it with
  // "Open menu" every time the language changes.
  function updateMenuLabel() {
    if (!el.navToggle) return;
    el.navToggle.setAttribute(
      "aria-label",
      window.I18N ? window.I18N.t(menuIsOpen() ? "menuClose" : "menuOpen") : "",
    );
  }

  function setMenu(open) {
    if (!el.nav || !el.navToggle) return;
    el.nav.classList.toggle("is-open", open);
    el.navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    updateMenuLabel();
  }

  // --- Wiring ---------------------------------------------------------------

  function wire() {
    // Chip clicks are delegated, because the chips are re-rendered whenever
    // the language changes.
    document.addEventListener("click", function (e) {
      const chip = e.target.closest
        ? e.target.closest(".chip[data-filter]")
        : null;
      if (chip) {
        const key = chip.getAttribute("data-filter");
        const value = chip.getAttribute("data-value");
        state.filters[key] = state.filters[key] === value ? "" : value;
        syncChips();
        renderList();
        return;
      }

      // A mode card in the modes rail applies that mode as a filter and
      // sends the visitor to the archive. It is a shortcut, not a
      // separate view — the archive list stays the single source.
      const modeLink = e.target.closest
        ? e.target.closest("[data-mode-link]")
        : null;
      if (modeLink) {
        const code = modeLink.getAttribute("data-mode-link");
        state.filters.mode = state.filters.mode === code ? "" : code;
        syncChips();
        renderList();
      }
    });

    if (el.searchInput) {
      el.searchInput.addEventListener("input", function () {
        state.filters.query = el.searchInput.value;
        renderList();
      });
    }

    if (el.resetBtn) {
      el.resetBtn.addEventListener("click", resetFilters);
    }

    // The empty state carries its own reset button, so a visitor who has
    // filtered everything away can get back without scrolling up.
    if (el.resetBtnEmpty) {
      el.resetBtnEmpty.addEventListener("click", resetFilters);
    }

    if (el.langToggle) {
      el.langToggle.addEventListener("click", function () {
        window.I18N.setLang(window.I18N.isHindi() ? "en" : "hi");
      });
    }

    // --- Mobile menu -------------------------------------------------------
    if (el.navToggle) {
      el.navToggle.addEventListener("click", function () {
        setMenu(!menuIsOpen());
      });
    }

    if (el.nav) {
      // A tap on any nav link closes the menu — otherwise the menu covers
      // the section the visitor just jumped to.
      el.nav.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("a")) setMenu(false);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setMenu(false);
    });

    // Re-render everything on a language change: the filters, the match
    // cards and the stats all contain translated strings.
    document.addEventListener("langchange", function () {
      buildChips();
      syncChips();
      renderAll();
      // i18n.apply() rewrites every data-i18n-aria label, including the
      // burger's — which is state-dependent, so it has to be re-stated.
      updateMenuLabel();
      // The modes rail is re-rendered, which replaces its reveal nodes
      // with fresh ones that have not been observed yet. Without this
      // they would stay invisible.
      setupReveal();
    });

    // Copy / share actions.
    if (el.copyEmail) {
      el.copyEmail.addEventListener("click", function () {
        const email = state.team && state.team.email;
        if (!email) return;
        copyText(email);
        flash(el.copyEmail, t("contactCopied"));
      });
    }

    if (el.shareBtn) {
      el.shareBtn.addEventListener("click", function () {
        const url = window.location.origin + window.location.pathname;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () {
              flash(el.shareBtn, t("contactShared"));
            },
            function () {
              flash(el.shareBtn, t("contactShared"));
            },
          );
        }
      });
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text);
      });
      return;
    }
    fallbackCopy(text);
  }

  // Older browsers, and any context where the clipboard API is blocked.
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      // Nothing more we can do here; the button still gives feedback.
    }
    document.body.removeChild(ta);
  }

  // Swap a button's label briefly, then restore it.
  function flash(node, message) {
    if (!node) return;
    const original = node.getAttribute("data-i18n")
      ? t(node.getAttribute("data-i18n"))
      : node.textContent;
    node.textContent = message;
    node.setAttribute("data-flash", "1");
    setTimeout(function () {
      node.textContent = original;
      node.removeAttribute("data-flash");
    }, 1600);
  }

  // --- Reveal + progress ----------------------------------------------------

  // The reveal observer is kept so it can be torn down before a new one is
  // created. Every language change re-renders the modes rail, which
  // replaces its reveal nodes — without re-observing them they would stay
  // invisible, and without tearing the old observer down they would leak.
  let revealObserver = null;
  let revealFailsafe = null;

  // How long a reveal may stay pending before the content is checked.
  // Long enough for a real scroll to trigger the observer, short enough
  // that a visitor is never looking at a blank section.
  const REVEAL_FAILSAFE_MS = 2500;

  // Every reveal node that has not been revealed yet.
  function pendingRevealNodes() {
    return Array.prototype.filter.call(
      document.querySelectorAll(".rv"),
      function (n) {
        return !n.classList.contains("in");
      },
    );
  }

  // Reveal anything the visitor has already scrolled past.
  //
  // An IntersectionObserver only reports an element WHILE it is on
  // screen. A jump — a nav anchor link, a restored scroll position, a
  // fast flick on a touchpad — can move the viewport past a node
  // between two frames, so the node never intersects and stays hidden
  // forever. The result is a band of empty space in the middle of the
  // page. Anything whose top has already passed the viewport top is
  // behind the visitor, so it is revealed whether it was seen or not.
  function revealScrolledPast() {
    var nodes = pendingRevealNodes();
    if (!nodes.length) return;
    nodes.forEach(function (n) {
      var rect = n.getBoundingClientRect();
      if (rect.top <= 0) n.classList.add("in");
    });
  }

  function setupReveal() {
    if (revealObserver) {
      revealObserver.disconnect();
      revealObserver = null;
    }
    // Only the nodes that are still hidden are worth observing. A node
    // that already carries .in has been revealed and will not change.
    const nodes = pendingRevealNodes();
    if (!nodes.length) return;

    // SAFETY NET. A reveal node that never fires must not stay invisible
    // forever. An element that is clipped, collapsed or painted with a
    // zero-area mask reports itself as never intersecting, and the
    // content would be lost with it.
    //
    // Only the nodes the visitor could actually be looking at are forced
    // open — the ones inside or above the viewport. A node further down
    // the page keeps its scroll reveal, so the page still unfolds as the
    // visitor moves through it instead of dumping the whole document on
    // them at once.
    if (revealFailsafe) {
      window.clearTimeout(revealFailsafe);
      revealFailsafe = null;
    }
    revealFailsafe = window.setTimeout(function () {
      var vh = window.innerHeight || 0;
      nodes.forEach(function (n) {
        var rect = n.getBoundingClientRect();
        // top <= vh covers "on screen" and "already scrolled past".
        // A node entirely below the fold is left for the observer.
        if (rect.top <= vh) n.classList.add("in");
      });
      revealFailsafe = null;
    }, REVEAL_FAILSAFE_MS);

    if (!("IntersectionObserver" in window)) {
      nodes.forEach(function (n) {
        n.classList.add("in");
      });
      return;
    }

    // threshold 0 with a negative bottom root margin: the reveal fires
    // when the element's top crosses 90% of the viewport height. A ratio
    // threshold would fail for an element taller than the viewport — 12%
    // of a very tall block can be more than a screenful, so the ratio
    // could never be reached and the section would stay hidden.
    revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );

    nodes.forEach(function (n) {
      revealObserver.observe(n);
    });
  }

  // The scroll sweep is registered ONCE, not on every setupReveal call,
  // so a language change cannot stack listeners. It reads the pending
  // nodes fresh each time, so it picks up the nodes a language change
  // replaced.
  let revealScrollBound = false;
  function setupRevealScroll() {
    if (revealScrollBound) return;
    revealScrollBound = true;
    var ticking = false;
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(function () {
            revealScrolledPast();
            ticking = false;
          });
        }
      },
      { passive: true },
    );
  }

  function setupProgress() {
    const bar = $("progress");
    const header = el.header;
    let ticking = false;

    function update() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (bar) bar.style.transform = "scaleX(" + pct + ")";

      // The header picks up an ember hairline once the page has moved, so
      // the sticky bar separates from the content behind it.
      if (header) {
        if (window.scrollY > 8) header.classList.add("is-scrolled");
        else header.classList.remove("is-scrolled");
      }
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true },
    );

    update();
  }

  // --- Boot -----------------------------------------------------------------

  function showError() {
    if (el.skeleton) el.skeleton.hidden = true;
    if (el.errorState) el.errorState.hidden = false;
    if (el.matchList) {
      el.matchList.hidden = true;
      el.matchList.innerHTML = "";
    }
    if (el.emptyState) el.emptyState.hidden = true;
  }

  function boot() {
    el.brandName = $("brandName");
    el.brandMark = $("brandMark");
    el.heroTeamName = $("heroTeamName");
    el.formRow = $("formRow");
    el.demoBanner = $("demoBanner");
    el.matchList = $("matchList");
    el.skeleton = $("skeleton");
    el.emptyState = $("emptyState");
    el.errorState = $("errorState");
    el.resultCount = $("resultCount");
    el.chipMode = $("chipMode");
    el.chipEvent = $("chipEvent");
    el.chipResult = $("chipResult");
    el.chipYear = $("chipYear");
    el.searchInput = $("searchInput");
    el.resetBtn = $("resetBtn");
    el.resetBtnEmpty = $("resetBtnEmpty");
    el.langToggle = $("langToggle");
    el.nav = $("nav");
    el.navToggle = $("navToggle");
    el.statsGrid = $("statsGrid");
    el.breakdownModes = $("breakdownModes");
    el.breakdownEvents = $("breakdownEvents");
    // The form board, the head-to-head board and the player analysis.
    el.streakGrid = $("streakGrid");
    el.streakForm = $("streakForm");
    el.h2hList = $("h2hList");
    el.h2hEmpty = $("h2hEmpty");
    el.playerStats = $("playerStats");
    el.playerEmpty = $("playerEmpty");
    // The board panel and the modes rail.
    el.boardMark = $("boardMark");
    el.boardName = $("boardName");
    el.boardCity = $("boardCity");
    el.boardSeason = $("boardSeasonValue");
    el.boardMatches = $("boardMatches");
    el.boardWins = $("boardWins");
    el.boardWinRate = $("boardWinRate");
    el.boardPrize = $("boardPrize");
    el.modeRail = $("modeRail");
    el.header = $("header");

    el.teamAbout = $("teamAbout");
    el.teamTagline = $("teamTagline");
    el.rosterList = $("rosterList");
    el.fixture = $("fixture");
    el.fixtureSection = $("next-match");
    el.footerYear = $("footerYear");
    el.contactWhatsapp = $("contactWhatsapp");
    el.contactEmail = $("contactEmail");
    el.copyEmail = $("copyEmail");
    el.shareBtn = $("shareBtn");

    wire();
    setupProgress();
    setupRevealScroll();

    window.ArchiveData.loadAll()
      .then(function (data) {
        state.team = data.team;
        state.matches = data.matches;
        state.stats = data.stats;
        state.fixture = data.fixture;
        state.extras = data.extras;
        state.loaded = true;

        if (el.skeleton) el.skeleton.hidden = true;
        if (el.errorState) el.errorState.hidden = true;

        buildChips();
        renderAll();
        setupReveal();
        // The page may have been opened with a hash in the URL, or the
        // browser may have restored a scroll position. Either way the
        // visitor is already past sections the observer never saw, so
        // those are opened straight away.
        revealScrolledPast();
      })
      .catch(function () {
        showError();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // A tiny read-only seam for the test suite.
  //
  // The scheduled fixture is deliberately kept out of the public log, so
  // the DOM alone can never show how an UNPLAYED card renders. The empty
  // score treatment ("—", never 0) is a correctness rule about the card,
  // and a rule with no test is a rule that quietly breaks. This exposes
  // the one pure renderer so the card can be rendered from a fixture
  // record that is not in the published list.
  //
  // It returns a string and touches no state: the app still only reads
  // the committed JSON, and nothing here can write to the archive.
  window.ArchiveApp = {
    renderMatchForTest: renderMatch,
  };
})();
