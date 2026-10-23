// ai.js — the AI match assistant for the admin panel.
//
// WHAT IT DOES
//   The owner pastes a base URL and an API key for any OpenAI-compatible
//   endpoint (OpenAI, OpenRouter, Groq, Together, a local Ollama, a
//   self-hosted vLLM — anything that speaks /chat/completions). The
//   assistant reads the current archive, works out the numbers, and DRAFTS
//   a match record from what the owner types in plain language.
//
//   The assistant NEVER publishes. It fills the match editor and waits for
//   the owner to read it, change it, and press Save. The AI has no
//   publish button and no token, and it never writes to localStorage.
//
// WHERE THE KEY LIVES
//   The API key is held in a module-scoped variable for the session only.
//   It is never written to localStorage, never written to disk, and never
//   appears in the page source — the same rule the GitHub token follows.
//   Locking the panel drops it.
//
// WHY THE MODEL IS TOLD TO CALCULATE RATHER THAN BEING ASKED TO
//   A language model is good at turning "we won 3-1 against Velocity for
//   1500" into a record, and bad at arithmetic it has to do in its head.
//   So the client sends the ALREADY-COMPUTED totals as context and asks
//   the model to reason about the new record only. The numbers on the page
//   come from computeStats(); the model never touches them.
//
// THE REQUEST SHAPE
//   OpenAI-compatible chat completions, with response_format requesting
//   JSON. The reply is parsed defensively — a model that returns prose
//   with a code fence still produces a usable draft, and a model that
//   returns nothing usable produces a clear error rather than a broken
//   form.
(function () {
  "use strict";

  const DEFAULTS = {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    // The request is abandoned after this long. A free or local endpoint
    // can be slow, but a visitor should never wait forever on a spinner.
    timeoutMs: 45000,
  };

  // The systems the admin panel can talk to. The list is a convenience,
  // not a restriction — the base URL and model are both editable.
  const PRESETS = [
    {
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      keyHint: "sk-…",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      keyHint: "sk-or-…",
    },
    {
      id: "groq",
      label: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      keyHint: "gsk_…",
    },
    {
      id: "together",
      label: "Together AI",
      baseUrl: "https://api.together.xyz/v1",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      keyHint: "…",
    },
    {
      id: "ollama",
      label: "Ollama (local)",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.2",
      keyHint: "not needed",
    },
  ];

  // The modes the assistant may file a record under. It uses the same
  // codes the archive uses, so a drafted record never lands in a mode the
  // public page cannot render.
  const MODES = ["CS", "BR", "LW"];
  const MODE_LABELS = {
    CS: "Clash Squad",
    BR: "Battle Royale",
    LW: "Lone Wolf",
  };
  const EVENTS = ["Tournament", "Scrim", "Qualifier", "Showmatch", "Other"];
  const STATUSES = ["completed", "scheduled"];

  // The AI session state. The key lives here and nowhere else.
  let apiKey = "";
  let baseUrl = DEFAULTS.baseUrl;
  let model = DEFAULTS.model;

  // --- Escaping -------------------------------------------------------------

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // --- Prompt construction -------------------------------------------------

  // The instruction. It tells the model exactly what shape to answer in,
  // what the archive looks like right now, and — importantly — what it must
  // NOT do: invent an opponent, a map or a score.
  function buildSystemPrompt(context) {
    // The context is defensive on purpose. A caller that has not built the
    // full context object — the connection test, or a draft made before
    // the archive finished loading — must get a working prompt, not a
    // crash halfway through the request.
    const ctx = context || {};
    const roster = Array.isArray(ctx.roster) ? ctx.roster : [];
    const recent = Array.isArray(ctx.recent) ? ctx.recent : [];
    return [
      "You are the match-record assistant for TEAM QUANTUM GAMING, a Free Fire MAX esports roster.",
      "You turn a plain-language report of a match into one structured record.",
      "",
      "THE ARCHIVE RIGHT NOW:",
      "- Played matches: " + (ctx.played != null ? ctx.played : 0),
      "- Wins: " +
        (ctx.wins != null ? ctx.wins : 0) +
        ", Losses: " +
        (ctx.losses != null ? ctx.losses : 0) +
        ", Draws: " +
        (ctx.draws != null ? ctx.draws : 0),
      "- Win rate: " + (ctx.winRate != null ? ctx.winRate : 0) + "%",
      "- Total prize money: " +
        (ctx.totalPrize != null ? ctx.totalPrize : 0) +
        " INR",
      "- Total entry fees paid: " +
        (ctx.totalEntry != null ? ctx.totalEntry : 0) +
        " INR",
      "- Net earnings: " + (ctx.net != null ? ctx.net : 0) + " INR",
      "- Standing roster: " +
        (roster.length ? roster.join(", ") : "(not published)"),
      "- Recent results, newest first: " +
        (recent.length ? recent.join(", ") : "(none)"),
      "",
      "RULES — follow every one:",
      "1. Answer with ONE JSON object and nothing else. No prose, no markdown, no code fence.",
      "2. Use exactly these keys: date, time, status, mode, event, eventName, map, opponent, score,",
      "   result, placement, entryFee, prize, prizePerWinner, roster, notes.",
      "3. mode is one of: " +
        MODES.join(", ") +
        " (these are Free Fire MAX competitive modes).",
      "4. event is one of: " + EVENTS.join(", ") + ".",
      "5. status is 'completed' for a match that was played, 'scheduled' for an announced match.",
      "6. result is 'W', 'L' or 'D'. Leave it as an empty string for a scheduled match.",
      "7. date is 'YYYY-MM-DD'. time is 'HH:MM' in 24-hour form, or an empty string.",
      "8. entryFee, prize, prizePerWinner and placement are NUMBERS. Use 0 when unknown.",
      "9. If the owner did not tell you the opponent, the map, the score or the event name, leave",
      "   that field as an empty string. NEVER invent one. An empty field is honest; a guess is a lie.",
      "10. roster is an array of the in-game names who played, in the order they were listed.",
      "    If the owner did not give the lineup, leave it as an empty array.",
      "11. If the match is a round series (Clash Squad / Lone Wolf) and the owner described who won",
      '    each round, fill \'rounds\' as an array of { team: "NF" | "OPP", round: 1,2,3... }.',
      "    \"NF\" means we won that round. If the owner said 'won 3-1', the round wins agree",
      "    with the result. If no rounds were described, leave 'rounds' as an empty array and",
      "    'format' as \"bo3\" for CS/LW.",
      "12. Notes should be one short factual sentence in the owner's own words if possible.",
      "",
      "Example answer:",
      '{"date":"2026-10-21","time":"13:40","status":"completed","mode":"CS","event":"Tournament",',
      '"eventName":"TEAM QUANTUM GAMING Cup #13","map":"Bermuda","opponent":"Team Velocity",',
      '"score":"3-1","result":"W","placement":1,"entryFee":48,"prize":448,"prizePerWinner":112,',
      '"format":"bo3","rounds":[{"team":"NF","round":1},{"team":"NF","round":2},{"team":"OPP","round":3},{"team":"NF","round":4}],',
      '"roster":["TQG.KΛIZEN07","ASTROO!!","TQG.ZYOTO17"],',
      '"notes":"Won 3-1 on Bermuda."}',
    ].join("\n");
  }

  // The context block. The numbers are computed by the archive, not by the
  // model, so the assistant reasons about the record it already has.
  function buildContext(stats, matches, team) {
    const played = matches.filter(function (m) {
      return m.status !== "scheduled";
    });
    const roster = (team && team.roster ? team.roster : []).map(function (p) {
      return p.name;
    });
    const recent = played.slice(0, 5).map(function (m) {
      return (
        (m.date || "?") +
        " " +
        (m.opponent || "unknown opponent") +
        " " +
        (m.result || "?")
      );
    });
    return {
      played: played.length,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      winRate: stats.winRate.toFixed(1),
      totalPrize: stats.totalPrize,
      totalEntry: stats.totalEntry,
      net: stats.net,
      roster: roster,
      recent: recent,
    };
  }

  // --- Response parsing ----------------------------------------------------

  // Pull the JSON object out of a model reply.
  //
  // A well-behaved model answers with a bare object. A chatty one wraps it
  // in a code fence, or puts a sentence before it. Both are handled here so
  // the owner sees a draft instead of an error.
  function extractJSON(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;

    // 1. The clean case.
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (e) {
      // Not bare JSON. Keep going.
    }

    // 2. A fenced block: ```json ... ```
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) {
      try {
        const parsed = JSON.parse(fence[1].trim());
        if (parsed && typeof parsed === "object") return parsed;
      } catch (e) {
        // Keep going.
      }
    }

    // 3. The first balanced object in the text.
    const start = raw.indexOf("{");
    if (start !== -1) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(raw.slice(start, i + 1));
              if (parsed && typeof parsed === "object") return parsed;
            } catch (e) {
              return null;
            }
            break;
          }
        }
      }
    }
    return null;
  }

  // Coerce one field from the model's answer into the shape the editor
  // expects. Every value is clamped, so a hallucinated number cannot
  // produce a negative fee or a 300% win rate in the published archive.
  function cleanString(value, maxLen) {
    return String(value == null ? "" : value)
      .trim()
      .slice(0, maxLen || 200);
  }

  // A real calendar date. "2026-02-31" is not a date — it is a mistake —
  // so the parts are checked against the actual month length rather than
  // trusted on the shape alone.
  function validDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    const dt = new Date(y, mo - 1, d);
    return (
      dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
    );
  }

  function cleanNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n);
  }

  // Turn the model's answer into a record the editor can open.
  function toRecord(raw) {
    if (!raw || typeof raw !== "object") return null;

    const modeRaw = String(raw.mode || "")
      .trim()
      .toUpperCase();
    const mode = MODES.indexOf(modeRaw) !== -1 ? modeRaw : "CS";

    const eventRaw = String(raw.event || "").trim();
    const event =
      EVENTS.find(function (e) {
        return e.toLowerCase() === eventRaw.toLowerCase();
      }) || "Other";

    const statusRaw = String(raw.status || "")
      .trim()
      .toLowerCase();
    const scheduled = statusRaw === "scheduled";
    const status = scheduled ? "scheduled" : "completed";

    const resultRaw = String(raw.result || "")
      .trim()
      .toUpperCase();
    const result = scheduled
      ? ""
      : resultRaw === "W" || resultRaw === "L" || resultRaw === "D"
        ? resultRaw
        : "";

    // The date and the time are checked BEFORE anything is trimmed down,
    // so a value with trailing junk ("13:40 pm", "2026-10-21ish") is
    // dropped instead of being quietly truncated into a valid-looking
    // value that would publish the wrong fixture time.
    const dateRaw = String(raw.date == null ? "" : raw.date).trim();
    const date = validDate(dateRaw) ? dateRaw : "";

    const timeRaw = String(raw.time == null ? "" : raw.time).trim();
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeRaw);
    const time =
      timeMatch && Number(timeMatch[1]) < 24 && Number(timeMatch[2]) < 60
        ? timeMatch[1].padStart(2, "0") + ":" + timeMatch[2]
        : "";

    const placementRaw = cleanNumber(raw.placement);
    const placement = placementRaw > 0 ? placementRaw : null;

    // The lineup. An empty string inside the list is an OPEN SLOT — a player
    // who has not been named yet — and the archive keeps it, so the public
    // page shows the gap instead of quietly listing three players.
    const rawRoster = Array.isArray(raw.roster)
      ? raw.roster.map(function (name) {
          return cleanString(name, 40);
        })
      : [];

    // An array of nothing but empty strings is noise, not a lineup. A list
    // with at least one named player keeps its open slots.
    const hasNamedPlayer = rawRoster.some(function (name) {
      return name !== "";
    });
    const roster = hasNamedPlayer ? rawRoster : [];

    // The round score. A Clash Squad / Lone Wolf series carries who won
    // each round. The list is validated against the result: a win needs
    // the target rounds (2 for bo3, 3 for bo5), a loss gives the opponent
    // that many. A mismatch is dropped so a hallucinated round score never
    // reaches the editor as a contradiction.
    const isSeries = !scheduled && (mode === "CS" || mode === "LW");
    const formatRaw2 = String(raw.format || "")
      .trim()
      .toLowerCase();
    const format = isSeries
      ? formatRaw2 === "bo5" || formatRaw2 === "bo3"
        ? formatRaw2
        : "bo3"
      : "";
    const winTarget = format === "bo5" ? 3 : 2;
    const rawRounds = Array.isArray(raw.rounds) ? raw.rounds : [];
    const roundsValid2 = rawRounds.every(function (r) {
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
    const rounds = roundsValid2
      ? rawRounds.map(function (r) {
          return {
            team: String(r.team).toUpperCase() === "NF" ? "NF" : "OPP",
            round: Number(r.round),
          };
        })
      : [];
    const nfCount = rounds.filter(function (r) {
      return r.team === "NF";
    }).length;
    const oppCount = rounds.length - nfCount;
    let roundDataOk = true;
    if (rounds.length) {
      if (result === "W" && nfCount < winTarget) roundDataOk = false;
      if (result === "L" && oppCount < winTarget) roundDataOk = false;
      if (nfCount >= winTarget && oppCount >= winTarget) roundDataOk = false;
    }
    const finalsRounds = roundDataOk ? rounds : [];

    return {
      date: date,
      time: time,
      status: status,
      mode: mode,
      event: event,
      eventName: cleanString(raw.eventName, 120),
      map: cleanString(raw.map, 60),
      opponent: cleanString(raw.opponent, 80),
      score: cleanString(raw.score, 40),
      result: result,
      placement: placement,
      entryFee: cleanNumber(raw.entryFee),
      prize: cleanNumber(raw.prize),
      prizePerWinner: cleanNumber(raw.prizePerWinner),

      roster: roster,
      notes: cleanString(raw.notes, 400),
      format: finalsRounds.length ? format : isSeries ? "bo3" : "",
      rounds: finalsRounds,
      roundsTotal: finalsRounds.filter(function (r) {
        return r.team === "NF";
      }).length,
    };
  }

  // --- The request ---------------------------------------------------------

  // Normalise the base URL. The owner pastes the API root; the chat
  // endpoint is appended. A URL that already ends in /chat/completions is
  // left alone, so both forms work.
  function endpointFor(base) {
    const trimmed = String(base || "")
      .trim()
      .replace(/\/+$/, "");
    if (!trimmed) return "";
    if (/\/chat\/completions$/.test(trimmed)) return trimmed;
    return trimmed + "/chat/completions";
  }

  // One POST to the chat endpoint. Shared by the draft request and the
  // connection test so both behave identically — same timeout, same
  // error wording, same abort handling.
  function postChat(endpoint, headers, body, timeoutMs) {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(function () {
        controller.abort();
      }, timeoutMs);
    }

    return fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          // The error body usually names the real problem — a bad key, a
          // model that does not exist, a rate limit. It is shown to the
          // owner, not swallowed.
          return res
            .text()
            .then(function (text) {
              let detail = "";
              try {
                const body2 = JSON.parse(text);
                if (body2 && body2.error) {
                  detail = body2.error.message || JSON.stringify(body2.error);
                }
              } catch (e) {
                detail = text.slice(0, 200);
              }
              const err = new Error(
                "The API returned " +
                  res.status +
                  (detail ? ": " + detail : ""),
              );
              // The status and the raw detail are kept so the caller can
              // decide whether this is worth a retry.
              err.status = res.status;
              err.detail = detail;
              throw err;
            })
            .catch(function (err) {
              if (err && err.status) throw err;
              throw new Error("The API returned " + res.status + ".");
            });
        }
        return res.json();
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === "AbortError") {
          throw new Error(
            "The request took too long. Check the base URL, or try a faster model.",
          );
        }
        throw err;
      });
  }

  // Does this endpoint understand the JSON mode? Some self-hosted and
  // older compatible endpoints reject the response_format field outright.
  // That is a 400, and the message names the field.
  function rejectsJsonMode(err) {
    if (!err || err.status !== 400) return false;
    const text = String(err.detail || err.message || "").toLowerCase();
    return (
      text.indexOf("response_format") !== -1 ||
      text.indexOf("json_object") !== -1 ||
      text.indexOf("json mode") !== -1
    );
  }

  // Ask the endpoint for a draft record.
  function requestDraft(options) {
    const opts = options || {};
    const key = opts.apiKey != null ? opts.apiKey : apiKey;
    const base = opts.baseUrl != null ? opts.baseUrl : baseUrl;
    const useModel = opts.model != null ? opts.model : model;
    const message = String(opts.message || "").trim();
    const context = opts.context || {};

    if (!message) {
      return Promise.reject(
        new Error("Type what happened in the match first."),
      );
    }
    if (!base) {
      return Promise.reject(new Error("Set the API base URL first."));
    }
    if (!key && !/localhost|127\.0\.0\.1/.test(base)) {
      return Promise.reject(new Error("Enter your API key first."));
    }

    const endpoint = endpointFor(base);
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;

    const body = {
      model: useModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSystemPrompt(context) },
        { role: "user", content: message },
      ],
    };
    // The JSON mode. An endpoint that does not support it either ignores
    // the field — in which case extractJSON() still finds the object in
    // the reply — or rejects it with a 400, in which case the request is
    // retried once without the field.
    body.response_format = { type: "json_object" };

    const timeoutMs = opts.timeoutMs || DEFAULTS.timeoutMs;

    return postChat(endpoint, headers, body, timeoutMs)
      .catch(function (err) {
        if (!rejectsJsonMode(err)) throw err;
        // Retry once, without the JSON mode. The parser copes with prose.
        const plain = Object.assign({}, body);
        delete plain.response_format;
        return postChat(endpoint, headers, plain, timeoutMs);
      })
      .then(function (payload) {
        const choice =
          payload &&
          payload.choices &&
          payload.choices[0] &&
          payload.choices[0].message &&
          payload.choices[0].message.content;
        const parsed = extractJSON(choice);
        if (!parsed) {
          throw new Error(
            "The model did not return a record. Try rephrasing, or check the model name.",
          );
        }
        const record = toRecord(parsed);
        if (!record) {
          throw new Error("The model returned something that is not a record.");
        }
        return record;
      });
  }

  // The connection test. It sends the smallest possible request and
  // reports what came back, so the owner finds out that the key, the URL
  // and the model name are right BEFORE typing a whole match report.
  function testConnection(options) {
    const opts = options || {};
    const key = opts.apiKey != null ? opts.apiKey : apiKey;
    const base = opts.baseUrl != null ? opts.baseUrl : baseUrl;
    const useModel = opts.model != null ? opts.model : model;

    if (!base) {
      return Promise.reject(new Error("Set the API base URL first."));
    }
    if (!key && !/localhost|127\.0\.0\.1/.test(base)) {
      return Promise.reject(new Error("Enter your API key first."));
    }

    const endpoint = endpointFor(base);
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;

    const body = {
      model: useModel,
      temperature: 0,
      max_tokens: 16,
      messages: [
        {
          role: "user",
          content: "Reply with the single word: connected.",
        },
      ],
    };

    const timeoutMs = opts.timeoutMs || DEFAULTS.timeoutMs;
    return postChat(endpoint, headers, body, timeoutMs).then(
      function (payload) {
        const reply =
          payload &&
          payload.choices &&
          payload.choices[0] &&
          payload.choices[0].message &&
          payload.choices[0].message.content;
        const model = (payload && payload.model) || useModel || "the model";
        return {
          ok: true,
          model: String(model),
          reply: String(reply || "")
            .trim()
            .slice(0, 80),
        };
      },
    );
  }

  // --- Public API ----------------------------------------------------------

  window.NFAssistant = {
    presets: PRESETS,
    defaults: DEFAULTS,
    modes: MODES,
    modeLabels: MODE_LABELS,
    events: EVENTS,
    statuses: STATUSES,

    setKey: function (value) {
      apiKey = String(value || "");
    },
    getKey: function () {
      return apiKey;
    },
    clearKey: function () {
      apiKey = "";
    },
    setBaseUrl: function (value) {
      baseUrl = String(value || "").trim();
    },
    getBaseUrl: function () {
      return baseUrl;
    },
    setModel: function (value) {
      model = String(value || "").trim();
    },
    getModel: function () {
      return model;
    },
    // The draft request. The key is passed in explicitly so the caller
    // controls the lifecycle; the module-level copy is only a fallback.
    draft: function (options) {
      return requestDraft(options);
    },
    // The connection test — same endpoint, same key, tiny request.
    test: function (options) {
      return testConnection(options);
    },
    // Exposed for the admin's own parsing checks and for tests.
    extractJSON: extractJSON,
    toRecord: toRecord,
    endpointFor: endpointFor,
    esc: esc,
  };
})();
