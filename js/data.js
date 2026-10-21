// data.js — loads the archive, normalises records and computes the record.
//
// DATA SHAPE
//   data/team.json     -> { name, tagline, about, city, email, whatsapp, ... }
//   data/matches.json  -> { schemaVersion, updatedAt, matches: [ ... ] }
//
// A match record:
//   id          string   stable unique id (used as the DOM key)
//   date        string   "YYYY-MM-DD"
//   mode        string   "CS" | "BR" | "LW"  (see MODE_LABELS below)
//   event       string   "Tournament" | "Scrim" | "Qualifier" | "Showmatch" | "Other"
//   eventName   string   the tournament's actual name
//   map         string   map / arena played
//   opponent    string   who we played
//   score       string   free text, shown as written ("3-1", "1st - #4")
//   result      string   "W" | "L" | "D"
//   placement   number|null   final standing, null when the format has none
//   entryFee    number   rupees paid to enter
//   prize       number   rupees won
//   notes       string   optional
//   demo        boolean  true while the record is a sample
//
// WHY THE NORMALISER EXISTS
// The admin panel writes records the owner typed, and a human can leave a
// field empty, write a score with a dash instead of a hyphen, or use a
// lowercase mode. Normalising once, on load, means every consumer — the
// list, the stats, the filters — can trust the shape.
(function () {
  "use strict";

  const TEAM_URL = "data/team.json";
  const MATCHES_URL = "data/matches.json";
  const LOAD_TIMEOUT_MS = 10000;

  const MODES = ["CS", "BR", "LW"];
  // The display name for each mode code. These are the official Free Fire
  // MAX competitive mode names, so the community never translates them.
  // They live here, next to MODES, so the public page, the admin panel
  // and the i18n dictionary all read one source instead of three.
  const MODE_LABELS = {
    CS: "Clash Squad",
    BR: "Battle Royale",
    LW: "Lone Wolf",
  };
  const EVENTS = ["Tournament", "Scrim", "Qualifier", "Showmatch", "Other"];
  const RESULTS = ["W", "L", "D"];

  // A team fallback so the page still renders something sane if
  // team.json is unreachable. It is marked as such in the UI.
  const FALLBACK_TEAM = {
    name: "NightForge",
    tagline: "Free Fire MAX competitive roster",
    about: "",
    city: "",
    email: "",
    whatsapp: "",
    instagram: "",
    youtube: "",
    logoText: "NF",
  };

  // --- Helpers --------------------------------------------------------------

  // Parse "YYYY-MM-DD" into a Date at local midnight. Using new Date(str)
  // would parse it as UTC and shift the day for anyone west of Greenwich;
  // splitting the parts keeps the calendar date exactly as written.
  function parseDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    // Reject impossible dates like 2026-02-31, which JS would roll over.
    if (
      dt.getFullYear() !== y ||
      dt.getMonth() !== mo - 1 ||
      dt.getDate() !== d
    )
      return null;
    return dt;
  }

  // Format a date string for display, in the visitor's locale but always
  // with the same calendar day the owner entered.
  function formatDate(dateStr, lang) {
    const dt = parseDate(dateStr);
    if (!dt) return String(dateStr || "");
    const locale = lang === "hi" ? "hi-IN" : "en-IN";
    try {
      return new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(dt);
    } catch (e) {
      return dt.toDateString();
    }
  }

  // Indian grouping: 1,00,000 not 100,000. The locale does this for us.
  function formatMoney(amount, lang) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return "";
    const locale = lang === "hi" ? "hi-IN" : "en-IN";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);
    } catch (e) {
      return "₹" + n;
    }
  }

  function formatNumber(n, lang) {
    const locale = lang === "hi" ? "hi-IN" : "en-IN";
    try {
      return new Intl.NumberFormat(locale).format(n);
    } catch (e) {
      return String(n);
    }
  }

  // Normalise one raw record into the canonical shape.
  function normalizeMatch(raw, index) {
    const mode = MODES.indexOf(String(raw.mode || "").toUpperCase());
    const eventRaw = String(raw.event || "").trim();
    const event =
      EVENTS.find(function (e) {
        return e.toLowerCase() === eventRaw.toLowerCase();
      }) || "Other";
    const resultRaw = String(raw.result || "")
      .trim()
      .toUpperCase();
    const result = RESULTS.indexOf(resultRaw) !== -1 ? resultRaw : "";

    const entryFee = Number(raw.entryFee);
    const prize = Number(raw.prize);
    const placementRaw = Number(raw.placement);

    return {
      id: String(raw.id || "match-" + index + "-" + String(raw.date || index)),
      date: String(raw.date || ""),
      dateValid: parseDate(raw.date) !== null,
      mode: mode !== -1 ? MODES[mode] : "",
      modeValid: mode !== -1,
      event: event,
      eventName: String(raw.eventName || "").trim(),
      map: String(raw.map || "").trim(),
      opponent: String(raw.opponent || "").trim(),
      score: String(raw.score || "").trim(),
      result: result,
      placement:
        Number.isFinite(placementRaw) && placementRaw > 0 ? placementRaw : null,
      entryFee: Number.isFinite(entryFee) && entryFee > 0 ? entryFee : 0,
      prize: Number.isFinite(prize) && prize > 0 ? prize : 0,
      notes: String(raw.notes || "").trim(),
      demo: raw.demo === true,
    };
  }

  // Newest first. Records with an unparseable date sink to the bottom
  // rather than throwing the sort comparator.
  function sortMatches(list) {
    return list.slice().sort(function (a, b) {
      const da = parseDate(a.date);
      const db = parseDate(b.date);
      if (da && db) {
        if (db.getTime() !== da.getTime()) return db.getTime() - da.getTime();
        return String(a.id).localeCompare(String(b.id));
      }
      if (da) return -1;
      if (db) return 1;
      return 0;
    });
  }

  // --- Stats ----------------------------------------------------------------

  // Compute the record from the full match list. Every number shown in the
  // stats section comes from here, so the section can never disagree with
  // the list it is describing.
  function computeStats(matches) {
    const wins = matches.filter(function (m) {
      return m.result === "W";
    }).length;
    const losses = matches.filter(function (m) {
      return m.result === "L";
    }).length;
    const draws = matches.filter(function (m) {
      return m.result === "D";
    }).length;
    const decided = wins + losses;
    const totalPrize = matches.reduce(function (sum, m) {
      return sum + m.prize;
    }, 0);
    const totalEntry = matches.reduce(function (sum, m) {
      return sum + m.entryFee;
    }, 0);

    // Group by mode and by event type.
    function groupBy(key) {
      const map = new Map();
      matches.forEach(function (m) {
        const k = m[key] || "Other";
        if (!map.has(k)) {
          map.set(k, {
            key: k,
            played: 0,
            wins: 0,
            losses: 0,
            prize: 0,
            entry: 0,
          });
        }
        const row = map.get(k);
        row.played += 1;
        if (m.result === "W") row.wins += 1;
        if (m.result === "L") row.losses += 1;
        row.prize += m.prize;
        row.entry += m.entryFee;
      });
      return Array.from(map.values()).sort(function (a, b) {
        return b.played - a.played;
      });
    }

    const dated = matches
      .map(function (m) {
        return parseDate(m.date);
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.getTime() - b.getTime();
      });

    const placements = matches
      .map(function (m) {
        return m.placement;
      })
      .filter(function (p) {
        return p !== null;
      });

    return {
      total: matches.length,
      wins: wins,
      losses: losses,
      draws: draws,
      // Win rate counts decided matches only. A draw is not a win, and
      // including it in the denominator would quietly inflate the number.
      winRate: decided > 0 ? (wins / decided) * 100 : 0,
      totalPrize: totalPrize,
      totalEntry: totalEntry,
      net: totalPrize - totalEntry,
      avgPrize: matches.length > 0 ? totalPrize / matches.length : 0,
      modes: groupBy("mode"),
      events: groupBy("event"),
      firstDate: dated.length > 0 ? dated[0] : null,
      lastDate: dated.length > 0 ? dated[dated.length - 1] : null,
      bestPlacement:
        placements.length > 0 ? Math.min.apply(null, placements) : null,
      demoCount: matches.filter(function (m) {
        return m.demo;
      }).length,
    };
  }

  // --- Loading --------------------------------------------------------------

  // Fetch with a timeout, so a hung connection shows the error state
  // instead of an infinite skeleton.
  function fetchJSON(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("timeout"));
      }, timeoutMs || LOAD_TIMEOUT_MS);

      fetch(url, { cache: "no-store" })
        .then(function (res) {
          if (!res || !res.ok) {
            throw new Error("http " + (res ? res.status : "error"));
          }
          return res.json();
        })
        .then(function (json) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(json);
        })
        .catch(function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // Load both files. The team file is optional — if it fails the page
  // still shows the archive, just without the team blurb.
  function loadAll() {
    return Promise.all([
      fetchJSON(TEAM_URL).catch(function () {
        return FALLBACK_TEAM;
      }),
      fetchJSON(MATCHES_URL),
    ]).then(function (res) {
      const teamRaw = res[0] || FALLBACK_TEAM;
      const matchesRaw = res[1] || {};
      const rawList = Array.isArray(matchesRaw.matches)
        ? matchesRaw.matches
        : [];
      const matches = sortMatches(rawList.map(normalizeMatch));
      return {
        team: Object.assign({}, FALLBACK_TEAM, teamRaw),
        matches: matches,
        stats: computeStats(matches),
        updatedAt: matchesRaw.updatedAt || "",
      };
    });
  }

  window.ArchiveData = {
    loadAll: loadAll,
    computeStats: computeStats,
    normalizeMatch: normalizeMatch,
    sortMatches: sortMatches,
    parseDate: parseDate,
    formatDate: formatDate,
    formatMoney: formatMoney,
    formatNumber: formatNumber,
    MODES: MODES,
    MODE_LABELS: MODE_LABELS,
    EVENTS: EVENTS,
    RESULTS: RESULTS,
  };
})();
