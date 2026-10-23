// data.js — loads the archive, normalises records and computes the record.
//
// DATA SHAPE
//   data/team.json     -> { name, tagline, about, city, email, whatsapp, ... }
//   data/matches.json  -> { schemaVersion, updatedAt, matches: [ ... ] }
//
// A match record:
//   id          string   stable unique id (used as the DOM key)
//   date        string   "YYYY-MM-DD"
//   time        string   "HH:MM" start time, local to the event (IST). Optional.
//   status      string   "completed" | "scheduled"  (default "completed")
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
// SCHEMA 2 — THE LINEUP AND THE UPCOMING FIXTURE
//   roster          array   the players who played, by in-game name. An empty
//                           string is an open slot (a random player whose
//                           name is not confirmed yet).
//   prizePerWinner  number  rupees each winner of the match receives
//
// SCHEMA 2.1 — ROUND-BY-ROUND SCORES (Clash Squad / Lone Wolf)
//   format          string  "bo3" | "bo5" — the winning score for a round
//                           series. Defaults to "bo3" for CS/LW.
//   rounds          array   one entry per round played. Each entry is:
//                             { team: "NF" | "opp", round: 1,2,3... }
//                           "NF" is a round we won, "opp" a round we lost.
//   roundsTotal      number   the current score for our side, derived from
//                           the "NF" entries. The sum of both sides is the
//                           number of rounds played so far.
//
//   A "W"/"L" result on a round-series must agree with the round score: a
//   win is a series where the "NF" count crossed the required target
//   (2 for bo3, 3 for bo5) first.
//
//   A record with status "scheduled" is an ANNOUNCEMENT, not a result. It
//   is published on the page as the next fixture, and it is deliberately
//   excluded from every statistic — a match that has not been played
//   cannot have a win, a prize or a placement.
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
  // "completed" is a match that has been played. "scheduled" is a fixture
  // that has not. The two are kept apart all the way through the data
  // layer, so a pending match can never reach the win rate.
  const STATUSES = ["completed", "scheduled"];
  // The in-game roles a NightForge player can hold. The vocabulary is
  // closed on purpose: the public page renders a role as a chip, and an
  // open vocabulary would let a typo become a chip.
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
    roster: [],
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

    // The status decides whether this record is a result or an announcement.
    // An unknown status falls back to "completed" so a hand-edited file
    // never silently hides a played match from the record.
    const statusRaw = String(raw.status || "")
      .trim()
      .toLowerCase();
    const status = STATUSES.indexOf(statusRaw) !== -1 ? statusRaw : "completed";

    // The start time is "HH:MM" in 24-hour form. Anything else is dropped,
    // because a half-parsed time would render as a wrong fixture time.
    const timeRaw = String(raw.time || "").trim();
    const time = /^\d{2}:\d{2}$/.test(timeRaw)
      ? timeRaw
      : /^([0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/.test(timeRaw)
        ? timeRaw.padStart(5, "0")
        : "";

    // The roster is a list of in-game names. An empty string is an OPEN
    // SLOT — a player who has not been named yet (a random fourth member).
    // The slot is kept so the public lineup can show the gap honestly
    // instead of quietly listing three players for a four-player match.
    const roster = Array.isArray(raw.roster)
      ? raw.roster.map(function (name) {
          return String(name == null ? "" : name).trim();
        })
      : [];

    const prizePerWinnerRaw = Number(raw.prizePerWinner);

    // Round-by-round. The series format is "bo3" or "bo5"; the default for
    // a round-series mode (CS/LW) is bo3. Rounds are a list of { team, round }
    // entries. They are validated: a round must belong to a known side, and
    // a "W"/"L" result must agree with the round count (a win needs the
    // required round total crossed). A mismatch is a data error, so the
    // field is dropped rather than publishing a contradictory record.
    const modeCode = mode !== -1 ? MODES[mode] : "";
    const formatRaw = String(raw.format || "")
      .trim()
      .toLowerCase();
    const format =
      formatRaw === "bo5" || formatRaw === "bo3"
        ? formatRaw
        : modeCode === "CS" || modeCode === "LW"
          ? "bo3"
          : "";
    const winTarget = format === "bo5" ? 3 : 2;
    const rawRounds = Array.isArray(raw.rounds) ? raw.rounds : [];
    const roundsValid = rawRounds.every(function (r) {
      if (!r || typeof r !== "object") return false;
      const side = String(r.team || "").toUpperCase();
      const round = Number(r.round);
      return (
        (side === "NF" || side === "OPP") &&
        Number.isFinite(round) &&
        round >= 1 &&
        round <= winTarget * 2 - 1
      );
    });
    const rounds = roundsValid
      ? rawRounds.map(function (r) {
          return {
            team: String(r.team).toUpperCase() === "NF" ? "NF" : "OPP",
            round: Number(r.round),
          };
        })
      : [];
    const nfRounds = rounds.filter(function (r) {
      return r.team === "NF";
    }).length;
    const oppRounds = rounds.length - nfRounds;
    const resultClean = RESULTS.indexOf(result) !== -1 ? result : "";
    let roundResultsAgree = true;
    if (resultClean === "W" && nfRounds < winTarget) roundResultsAgree = false;
    if (resultClean === "L" && oppRounds < winTarget) roundResultsAgree = false;
    // A round series cannot be both won and lost.
    if (nfRounds >= winTarget && oppRounds >= winTarget)
      roundResultsAgree = false;
    const roundsFinal = roundResultsAgree ? rounds : [];

    return {
      id: String(raw.id || "match-" + index + "-" + String(raw.date || index)),
      date: String(raw.date || ""),
      dateValid: parseDate(raw.date) !== null,
      time: time,
      status: status,
      scheduled: status === "scheduled",
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
      roster: roster,
      prizePerWinner:
        Number.isFinite(prizePerWinnerRaw) && prizePerWinnerRaw > 0
          ? prizePerWinnerRaw
          : 0,
      format: format,
      rounds: roundsFinal,
      roundsTotal: roundsFinal.filter(function (r) {
        return r.team === "NF";
      }).length,
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
  //
  // SCHEDULED MATCHES ARE NOT COUNTED.
  // A fixture that has not been played has no result, no prize and no
  // placement, so including it would put a phantom win in the win rate and
  // a phantom rupee in the prize money. The stats run over the completed
  // records only; the pending ones are published separately as the next
  // fixture.
  function computeStats(matches) {
    const played = matches.filter(function (m) {
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
    const totalPrize = played.reduce(function (sum, m) {
      return sum + m.prize;
    }, 0);
    const totalEntry = played.reduce(function (sum, m) {
      return sum + m.entryFee;
    }, 0);
    // Group by mode and by event type.
    function groupBy(key) {
      const map = new Map();
      played.forEach(function (m) {
        const k = m[key] || "Other";
        if (!map.has(k)) {
          map.set(k, {
            key: k,
            played: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            prize: 0,
            entry: 0,
          });
        }
        const row = map.get(k);
        row.played += 1;
        if (m.result === "W") row.wins += 1;
        if (m.result === "L") row.losses += 1;
        if (m.result === "D") row.draws += 1;
        row.prize += m.prize;
        row.entry += m.entryFee;
      });
      return Array.from(map.values()).sort(function (a, b) {
        return b.played - a.played;
      });
    }
    const dated = played
      .map(function (m) {
        return parseDate(m.date);
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.getTime() - b.getTime();
      });
    const placements = played
      .map(function (m) {
        return m.placement;
      })
      .filter(function (p) {
        return p !== null;
      });

    return {
      total: played.length,
      wins: wins,
      losses: losses,
      draws: draws,
      // Win rate counts decided matches only. A draw is not a win, and
      // including it in the denominator would quietly inflate the number.
      winRate: decided > 0 ? (wins / decided) * 100 : 0,
      totalPrize: totalPrize,
      totalEntry: totalEntry,
      net: totalPrize - totalEntry,
      avgPrize: played.length > 0 ? totalPrize / played.length : 0,
      modes: groupBy("mode"),
      events: groupBy("event"),
      firstDate: dated.length > 0 ? dated[0] : null,
      lastDate: dated.length > 0 ? dated[dated.length - 1] : null,
      bestPlacement:
        placements.length > 0 ? Math.min.apply(null, placements) : null,
      demoCount: played.filter(function (m) {
        return m.demo;
      }).length,
      // How many fixtures are still to be played. The archive shows this so
      // a visitor can tell an announced match from a played one.
      scheduledCount: matches.length - played.length,
    };
  }

  // Normalise one raw player record.
  //
  //   name   string   the in-game name, preserved EXACTLY. It is a handle,
  //                   not prose — the stylisation is the player's own and
  //                   rewriting it would be a factual error.
  //   roles  array    the roles the player holds. A player can hold more
  //                   than one — an in-game leader who is also the
  //                   sniper, for example.
  //   status string   "core" | "guest" — a guest is a player who joined
  //                   for one match and is not a permanent member.
  function normalizePlayer(raw) {
    const obj = raw && typeof raw === "object" ? raw : {};
    // Both "role" (one) and "roles" (many) are accepted, so a hand-edited
    // file with either shape still loads.
    const rawRoles = Array.isArray(obj.roles)
      ? obj.roles
      : obj.role != null
        ? [obj.role]
        : [];
    const roles = rawRoles
      .map(function (r) {
        const roleRaw = String(r == null ? "" : r).trim();
        return (
          ROLES.find(function (known) {
            return known.toLowerCase() === roleRaw.toLowerCase();
          }) || ""
        );
      })
      .filter(function (r) {
        return r !== "";
      });
    const statusRaw = String(obj.status || "")
      .trim()
      .toLowerCase();
    return {
      name: String(obj.name == null ? "" : obj.name).trim(),
      roles: roles,
      role: roles[0] || "",
      status: statusRaw === "guest" ? "guest" : "core",
    };
  }

  // Normalise the team roster. A missing roster is an empty roster, not
  // an error — the page still renders the team copy without the lineup.
  //
  // The same player can appear more than once in the source — one entry
  // per role. Those entries are merged into a single card that holds
  // every role, so a player who is both the sniper and the in-game
  // leader gets one card with both roles, not two identical cards.
  function normalizeRoster(raw) {
    if (!Array.isArray(raw)) return [];
    const byName = new Map();
    raw.map(normalizePlayer).forEach(function (p) {
      if (!p.name) return;
      const existing = byName.get(p.name);
      if (!existing) {
        byName.set(p.name, {
          name: p.name,
          roles: p.roles.slice(),
          role: p.role,
          status: p.status,
        });
        return;
      }
      p.roles.forEach(function (r) {
        if (existing.roles.indexOf(r) === -1) existing.roles.push(r);
      });
      existing.role = existing.roles[0] || existing.role;
    });
    return Array.from(byName.values());
  }

  // The next fixture — the scheduled match with the closest start time.
  // The list is sorted newest-first, so "scheduled" matches are collected
  // and the earliest one wins. A fixture with no time still counts; it is
  // the only one, so it is the next one.
  function nextFixture(matches) {
    const pending = matches.filter(function (m) {
      return m.status === "scheduled";
    });
    if (!pending.length) return null;
    pending.sort(function (a, b) {
      const da = parseDate(a.date);
      const db = parseDate(b.date);
      if (da && db && da.getTime() !== db.getTime())
        return da.getTime() - db.getTime();
      if (da && !db) return -1;
      if (!da && db) return 1;
      // Same day — the earlier start time goes first.
      if (a.time && b.time && a.time !== b.time)
        return a.time < b.time ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
    return pending[0];
  }

  // Format a start time for display. "13:40" becomes "1:40 pm" in
  // English and "दोपहर 1:40" in Hindi. The stored value is always 24-hour
  // so it can be sorted and compared as a string.
  function formatTime(time, lang) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
    if (!m) return "";
    const h = Number(m[1]);
    const min = m[2];
    const suffix = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const clock = h12 + ":" + min + " " + suffix;
    if (lang === "hi") {
      return (h < 12 ? "सुबह " : h < 17 ? "दोपहर " : "रात ") + h12 + ":" + min;
    }
    return clock;
  }

  // --- Extended analysis ----------------------------------------------------
  //
  // The headline numbers live in computeStats(). These are the record's
  // SHAPE — the runs, the opponents and the per-player numbers — the things
  // a team actually argues about.

  // The current run of results, and the longest runs in the record.
  //
  // A streak counts CONSECUTIVE results. The list arrives newest-first, so
  // the walk is reversed to get chronological order: the current streak is
  // the run at the END of the history, and the longest run is the biggest
  // run anywhere in it.
  function computeStreaks(played) {
    const chrono = played
      .slice()
      .reverse()
      .filter(function (m) {
        return m.result === "W" || m.result === "L" || m.result === "D";
      });

    let longestWin = 0;
    let longestLoss = 0;
    let winRun = 0;
    let lossRun = 0;

    chrono.forEach(function (m) {
      if (m.result === "W") {
        winRun += 1;
        lossRun = 0;
      } else if (m.result === "L") {
        lossRun += 1;
        winRun = 0;
      } else {
        winRun = 0;
        lossRun = 0;
      }
      if (winRun > longestWin) longestWin = winRun;
      if (lossRun > longestLoss) longestLoss = lossRun;
    });

    // The current streak: walk backwards from the most recent result until
    // the result changes.
    let currentType = "";
    let currentCount = 0;
    for (let i = chrono.length - 1; i >= 0; i--) {
      const r = chrono[i].result;
      if (currentType === "" || r === currentType) {
        currentType = r;
        currentCount += 1;
      } else {
        break;
      }
    }

    return {
      currentType: currentType,
      currentCount: currentCount,
      longestWin: longestWin,
      longestLoss: longestLoss,
      // The last five results, newest first — the form guide.
      form: played
        .slice(0, 5)
        .map(function (m) {
          return m.result;
        })
        .filter(Boolean),
    };
  }

  // Head to head: every opponent we have faced, and the record against them.
  function computeOpponents(played) {
    const map = new Map();
    played.forEach(function (m) {
      const key = m.opponent;
      // A record with no opponent is not a head-to-head row.
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          opponent: key,
          played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          prize: 0,
          entry: 0,
        });
      }
      const row = map.get(key);
      row.played += 1;
      if (m.result === "W") row.wins += 1;
      if (m.result === "L") row.losses += 1;
      if (m.result === "D") row.draws += 1;
      row.prize += m.prize;
      row.entry += m.entryFee;
    });
    return Array.from(map.values()).sort(function (a, b) {
      if (b.played !== a.played) return b.played - a.played;
      return a.opponent.localeCompare(b.opponent);
    });
  }

  // The per-player record.
  //
  // Built from the LINEUP stored on each match — the players are counted
  // only in the matches they are recorded in. A player with no recorded
  // lineup has no personal record, and the page says so rather than
  // showing a zero that reads like a loss.
  //
  // Names are matched case-insensitively, because an in-game handle typed
  // in the admin box can pick up a capital letter the published file does
  // not have, and that should not silently split one player in two.
  function computePlayerStats(matches, roster) {
    const played = matches.filter(function (m) {
      return m.status !== "scheduled";
    });

    const byKey = new Map();
    function touch(name) {
      const key = name.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, {
          name: name,
          played: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          lastResult: "",
        });
      }
      return byKey.get(key);
    }

    // The standing roster first, so the order of the list is the order the
    // team published and not the order the matches happened in.
    (roster || []).forEach(function (p) {
      if (p && p.name) touch(p.name);
    });

    played.forEach(function (m) {
      (m.roster || []).forEach(function (name) {
        if (!name) return;
        const row = touch(name);
        row.played += 1;
        if (m.result === "W") row.wins += 1;
        if (m.result === "L") row.losses += 1;
        if (m.result === "D") row.draws += 1;
        // The list is newest-first, so the first match a player appears in
        // is their most recent one.
        if (!row.lastResult) row.lastResult = m.result;
      });
    });

    return Array.from(byKey.values()).map(function (row) {
      const decided = row.wins + row.losses;
      return {
        name: row.name,
        played: row.played,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        winRate: decided > 0 ? (row.wins / decided) * 100 : 0,
        lastResult: row.lastResult,
      };
    });
  }

  // Everything the extra sections need, in one call.
  function computeExtras(matches, team) {
    const played = matches.filter(function (m) {
      return m.status !== "scheduled";
    });
    return {
      streaks: computeStreaks(played),
      opponents: computeOpponents(played),
      players: computePlayerStats(matches, (team && team.roster) || []),
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
      const team = Object.assign({}, FALLBACK_TEAM, teamRaw, {
        roster: normalizeRoster(teamRaw.roster),
      });
      return {
        team: team,
        matches: matches,
        stats: computeStats(matches),
        extras: computeExtras(matches, team),
        fixture: nextFixture(matches),
        updatedAt: matchesRaw.updatedAt || "",
      };
    });
  }

  window.ArchiveData = {
    loadAll: loadAll,
    computeStats: computeStats,
    computeExtras: computeExtras,
    computeStreaks: computeStreaks,
    computeOpponents: computeOpponents,
    computePlayerStats: computePlayerStats,
    normalizeMatch: normalizeMatch,
    normalizePlayer: normalizePlayer,
    normalizeRoster: normalizeRoster,
    nextFixture: nextFixture,
    sortMatches: sortMatches,
    parseDate: parseDate,
    formatDate: formatDate,
    formatTime: formatTime,
    formatMoney: formatMoney,
    formatNumber: formatNumber,
    MODES: MODES,
    MODE_LABELS: MODE_LABELS,
    EVENTS: EVENTS,
    RESULTS: RESULTS,
    STATUSES: STATUSES,
    ROLES: ROLES,
  };
})();
