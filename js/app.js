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

  function renderMatch(m) {
    const l = lang();
    const resultLabel = m.result ? t("result" + m.result) : "";
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

    const modeLabel = m.mode
      ? '<span class="badge badge--mode">' + esc(m.mode) + "</span>"
      : "";

    const resultBadge = m.result
      ? '<span class="match__result" data-r="' +
        esc(m.result) +
        '" title="' +
        esc(resultLabel) +
        '">' +
        esc(m.result) +
        "</span>"
      : "";

    const notes = m.notes
      ? '<p class="match__notes">' + esc(m.notes) + "</p>"
      : "";

    const opponent = m.opponent ? esc(m.opponent) : "—";
    const score = m.score ? esc(m.score) : "—";
    const map = m.map ? esc(m.map) : "—";

    return (
      '<article class="match" data-result="' +
      esc(m.result) +
      '" data-id="' +
      esc(m.id) +
      '">' +
      '<div class="match__head">' +
      '<span class="match__date">' +
      esc(window.ArchiveData.formatDate(m.date, l)) +
      "</span>" +
      modeLabel +
      eventLabel +
      resultBadge +
      "</div>" +
      '<h3 class="match__event">' +
      esc(m.eventName || m.event || "—") +
      demoTag +
      "</h3>" +
      '<div class="match__scoreline">' +
      '<span class="match__score">' +
      score +
      "</span>" +
      '<span class="match__vs">' +
      esc(t("vs")) +
      "</span>" +
      '<span class="match__opponent">' +
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
      notes +
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
      m.result,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(q.toLowerCase()) !== -1;
  }

  function filteredMatches() {
    const f = state.filters;
    return state.matches.filter(function (m) {
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
    renderBreakdown(el.breakdownModes, s.modes);
    renderBreakdown(el.breakdownEvents, s.events);
  }

  // Back to "YYYY-MM-DD" for a Date the stats layer produced.
  function toISODate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  // A breakdown row: the key, a proportional bar and the W/L count.
  function renderBreakdown(container, rows) {
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
        const label = r.key;
        const pct = max > 0 ? Math.round((r.played / max) * 100) : 0;
        return (
          '<div class="breakdown__row">' +
          '<div class="breakdown__head">' +
          '<span class="breakdown__key">' +
          esc(
            t("event" + label) !== "event" + label ? t("event" + label) : label,
          ) +
          "</span>" +
          '<span class="breakdown__val mono">' +
          esc(r.wins) +
          "W / " +
          esc(r.losses) +
          "L · " +
          esc(r.played) +
          "</span>" +
          "</div>" +
          '<div class="breakdown__bar"><span style="--w:' +
          pct +
          '%"></span></div>' +
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

    if (el.heroMatches) el.heroMatches.textContent = num(s.total, l);
    if (el.heroWins) el.heroWins.textContent = num(s.wins, l);
    if (el.heroPrize) el.heroPrize.textContent = money(s.totalPrize, l) || "—";
    if (el.heroWinRate) el.heroWinRate.textContent = s.winRate.toFixed(1) + "%";

    // Recent form — the last 10 results, newest first.
    if (el.formRow) {
      const recent = state.matches.slice(0, 10);
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

  function renderTeam() {
    const team = state.team;
    if (!team) return;

    if (el.brandName) el.brandName.textContent = team.name;
    if (el.brandMark) el.brandMark.textContent = team.logoText || "NF";
    if (el.heroTeamName) el.heroTeamName.textContent = team.name;
    if (el.teamAbout)
      el.teamAbout.textContent = team.about || team.tagline || "";
    if (el.teamTagline) el.teamTagline.textContent = team.tagline || "";

    function setFact(id, value, href, isLink) {
      const node = $(id);
      if (!node) return;
      if (!value) {
        node.textContent = t("notSet");
        return;
      }
      if (isLink && href) {
        node.textContent = value;
        node.setAttribute("href", href);
        node.removeAttribute("data-no-link");
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

  function renderAll() {
    renderTeam();
    renderHero();
    renderList();
    renderStats();
  }

  // --- Filters UI -----------------------------------------------------------

  function buildChips() {
    if (!el.chipMode) return;
    const modes = window.ArchiveData.MODES;

    let html =
      '<button class="chip" data-filter="mode" data-value="" aria-pressed="true">' +
      esc(t("filterAll")) +
      "</button>";
    modes.forEach(function (m) {
      const count = state.matches.filter(function (x) {
        return x.mode === m;
      }).length;
      html +=
        '<button class="chip" data-filter="mode" data-value="' +
        esc(m) +
        '" aria-pressed="false">' +
        esc(m) +
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
        const count = state.matches.filter(function (x) {
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
        const count = state.matches.filter(function (x) {
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
      state.matches.forEach(function (m) {
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
        const count = state.matches.filter(function (x) {
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

  function setupReveal() {
    const nodes = document.querySelectorAll(".rv");
    if (!nodes.length) return;

    if (!("IntersectionObserver" in window)) {
      nodes.forEach(function (n) {
        n.classList.add("in");
      });
      return;
    }

    const io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    nodes.forEach(function (n) {
      io.observe(n);
    });
  }

  function setupProgress() {
    const bar = $("progress");
    if (!bar) return;
    let ticking = false;

    function update() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      bar.style.transform = "scaleX(" + pct + ")";
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
    el.heroMatches = $("heroMatches");
    el.heroWins = $("heroWins");
    el.heroPrize = $("heroPrize");
    el.heroWinRate = $("heroWinRate");
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
    el.teamAbout = $("teamAbout");
    el.teamTagline = $("teamTagline");
    el.footerYear = $("footerYear");
    el.contactWhatsapp = $("contactWhatsapp");
    el.contactEmail = $("contactEmail");
    el.copyEmail = $("copyEmail");
    el.shareBtn = $("shareBtn");

    wire();
    setupProgress();

    window.ArchiveData.loadAll()
      .then(function (data) {
        state.team = data.team;
        state.matches = data.matches;
        state.stats = data.stats;
        state.loaded = true;

        if (el.skeleton) el.skeleton.hidden = true;
        if (el.errorState) el.errorState.hidden = true;

        buildChips();
        renderAll();
        setupReveal();
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
})();
