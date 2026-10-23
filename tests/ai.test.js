// ai.test.js — the AI assistant's own contract.
//
// The assistant is the one part of the admin panel that talks to something
// outside the repo, so it gets the same kind of tests the archive does:
// the JSON extraction, the field cleaning, the endpoint builder, the
// request shape against a mocked fetch, and — the most important rule of
// all — the fact that the API key is never written to storage.
//
// Usage: node tests/ai.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

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

// --- Load the module in a sandbox ------------------------------------------
// The module writes to window, so a minimal window stand-in is enough. No
// DOM is needed: the assistant is pure logic plus one fetch call.
//
// The sandbox's fetch is a stub. It records what it was called with and
// answers from a queue the test fills BEFORE making the call.
const calls = [];
const queue = [];
function queueResponse(r) {
  queue.push(r);
}
const sandbox = {
  window: {},
  console: console,
  fetch: function (url, init) {
    calls.push({ url: url, init: init });
    if (!queue.length) {
      return Promise.reject(new Error("no response queued"));
    }
    const r = queue.shift();
    if (typeof r === "function") return Promise.resolve(r(url, init));
    return Promise.resolve(r);
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  AbortController:
    typeof AbortController !== "undefined" ? AbortController : undefined,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(rd("admin/js/ai.js"), sandbox, { filename: "ai.js" });

const AI = sandbox.window.NFAssistant;
ok("the module exposes an API", !!AI);
if (!AI) {
  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(1);
}

// A helper that builds a fake OpenAI-compatible response.
function okResponse(content, model) {
  return {
    ok: true,
    status: 200,
    json: function () {
      return Promise.resolve({
        model: model || "test-model",
        choices: [{ message: { content: content } }],
      });
    },
    text: function () {
      return Promise.resolve(content);
    },
  };
}

function errorResponse(status, body) {
  return {
    ok: false,
    status: status,
    json: function () {
      return Promise.resolve(JSON.parse(body));
    },
    text: function () {
      return Promise.resolve(body);
    },
  };
}

// The context the admin would send.
const CONTEXT = {
  played: 8,
  wins: 6,
  losses: 2,
  draws: 0,
  winRate: "75.0",
  totalPrize: 100,
  totalEntry: 40,
  net: 60,
  roster: ["A"],
  recent: [],
};

const DRAFT_REPLY = JSON.stringify({
  date: "2026-10-21",
  time: "13:40",
  status: "completed",
  mode: "CS",
  event: "Tournament",
  eventName: "NightForge Weekly Cup #13",
  map: "Bermuda",
  opponent: "Team Velocity",
  score: "3-1",
  result: "W",
  placement: 1,
  entryFee: 48,
  prize: 448,
  prizePerWinner: 112,
  roster: ["TQG.KΛIZEN07", "ASTROO!!"],
  notes: "Won 3-1.",
});

// --- JSON extraction --------------------------------------------------------
console.log("\n=== JSON EXTRACTION ===");
ok(
  "a bare object is parsed",
  AI.extractJSON('{"a":1}') && AI.extractJSON('{"a":1}').a === 1
);
ok(
  "a fenced block is parsed",
  AI.extractJSON('```json\n{"a":2}\n```') && AI.extractJSON('```json\n{"a":2}\n```').a === 2
);
ok(
  "a fenced block without a language tag is parsed",
  AI.extractJSON('```\n{"a":3}\n```') && AI.extractJSON('```\n{"a":3}\n```').a === 3
);
ok(
  "prose around the object is stripped",
  AI.extractJSON('Here you go:\n{"a":4}\nHope that helps!') &&
    AI.extractJSON('Here you go:\n{"a":4}\nHope that helps!').a === 4
);
ok(
  "a nested object is found whole",
  AI.extractJSON('{"a":{"b":5}}') && AI.extractJSON('{"a":{"b":5}}').a.b === 5
);
ok(
  "a brace inside a string does not break the scan",
  AI.extractJSON('{"notes":"we won {3-1}"}') &&
    AI.extractJSON('{"notes":"we won {3-1}"}').notes === "we won {3-1}"
);
ok("empty text returns null", AI.extractJSON("") === null);
ok("prose with no object returns null", AI.extractJSON("I cannot help with that") === null);
ok("a null reply returns null", AI.extractJSON(null) === null);

// --- Field cleaning --------------------------------------------------------
console.log("\n=== FIELD CLEANING ===");
const good = AI.toRecord({
  date: "2026-10-21",
  time: "13:40",
  status: "completed",
  mode: "CS",
  event: "Tournament",
  eventName: "NightForge Weekly Cup #13",
  map: "Bermuda",
  opponent: "Team Velocity",
  score: "3-1",
  result: "W",
  placement: 1,
  entryFee: 48,
  prize: 448,
  prizePerWinner: 112,
  roster: ["TQG.KΛIZEN07", "ASTROO!!", "TQG.ZYOTO17"],
  notes: "Won 3-1.",
});
ok("a good record survives cleaning", good !== null);
ok("the date is kept", good.date === "2026-10-21");
ok("the time is kept", good.time === "13:40");
ok("the mode is kept", good.mode === "CS");
ok("the event is kept", good.event === "Tournament");
ok("the result is kept", good.result === "W");
ok("the placement is kept", good.placement === 1);
ok("the entry fee is kept", good.entryFee === 48);
ok("the prize is kept", good.prize === 448);
ok("the prize per winner is kept", good.prizePerWinner === 112);
ok("the notes are kept", good.notes === "Won 3-1.");
ok("the lineup is kept", good.roster.length === 3, good.roster.length);
ok(
  "the lineup keeps the exact in-game names",
  good.roster[0] === "TQG.KΛIZEN07" && good.roster[1] === "ASTROO!!"
);

// The clamps. A hallucinated value must not reach the published archive.
const bad = AI.toRecord({
  date: "21-10-2026",
  time: "13:40 pm",
  status: "banana",
  mode: "VALORANT",
  event: "random event",
  result: "Q",
  placement: -5,
  entryFee: -100,
  prize: "not a number",
  prizePerWinner: -1,
  eventName: "x".repeat(500),
});
ok("a malformed date is dropped", bad.date === "");
ok("a time with trailing junk is dropped", bad.time === "");
ok("an unknown status becomes completed", bad.status === "completed");
ok("an unknown mode falls back to CS", bad.mode === "CS");
ok("an unknown event falls back to Other", bad.event === "Other");
ok("an unknown result is dropped", bad.result === "");
ok("a negative placement becomes null", bad.placement === null);
ok("a negative fee becomes zero", bad.entryFee === 0);
ok("a non-numeric prize becomes zero", bad.prize === 0);
ok("a negative prize per winner becomes zero", bad.prizePerWinner === 0);
ok("a long event name is truncated", bad.eventName.length <= 120, bad.eventName.length);

// Dates that do not exist must not be accepted.
ok("31 February is dropped", AI.toRecord({ date: "2026-02-31" }).date === "");
ok("13 October 2026 is kept", AI.toRecord({ date: "2026-10-13" }).date === "2026-10-13");
ok("a month of 00 is dropped", AI.toRecord({ date: "2026-00-10" }).date === "");
ok("a day of 00 is dropped", AI.toRecord({ date: "2026-10-00" }).date === "");
ok("an hour of 24 is dropped", AI.toRecord({ time: "24:00" }).time === "");
ok("a minute of 60 is dropped", AI.toRecord({ time: "13:60" }).time === "");
ok("a single-digit hour is padded", AI.toRecord({ time: "9:05" }).time === "09:05");

// A scheduled match must not carry a result — a phantom win in the record
// is exactly the bug the schema-2 work exists to prevent.
const sched = AI.toRecord({
  date: "2026-10-21",
  status: "scheduled",
  result: "W",
  mode: "CS",
});
ok("a scheduled record has no result", sched.result === "");
ok("a scheduled record is marked scheduled", sched.status === "scheduled");

// The lineup rules.
const slotRoster = AI.toRecord({
  date: "2026-10-21",
  status: "scheduled",
  roster: ["TQG.KΛIZEN07", "", "TQG.ZYOTO17", ""],
});
ok("an open slot is kept in the lineup", slotRoster.roster.length === 4, slotRoster.roster.length);
ok("the open slot is an empty string", slotRoster.roster[1] === "");
ok("a lineup of nothing but empty slots is dropped", AI.toRecord({ roster: ["", ""] }).roster.length === 0);
ok("a missing lineup is an empty lineup", AI.toRecord({}).roster.length === 0);

// --- Endpoint building -----------------------------------------------------
console.log("\n=== ENDPOINT ===");
ok(
  "a bare API root gets the chat path",
  AI.endpointFor("https://api.openai.com/v1") ===
    "https://api.openai.com/v1/chat/completions"
);
ok(
  "a trailing slash is trimmed",
  AI.endpointFor("https://api.openai.com/v1/") ===
    "https://api.openai.com/v1/chat/completions"
);
ok(
  "a full endpoint is left alone",
  AI.endpointFor("https://api.openai.com/v1/chat/completions") ===
    "https://api.openai.com/v1/chat/completions"
);
ok("an empty base returns an empty string", AI.endpointFor("") === "");

// --- Presets ----------------------------------------------------------------
console.log("\n=== PRESETS ===");
ok("there are presets", AI.presets.length >= 3);
ok(
  "every preset has a base URL and a model",
  AI.presets.every(function (p) {
    return !!p.baseUrl && !!p.model && !!p.label;
  })
);
ok(
  "every preset base URL is https or a local host",
  AI.presets.every(function (p) {
    return /^https:\/\//.test(p.baseUrl) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(p.baseUrl);
  })
);
ok(
  "the local preset needs no key",
  AI.presets.some(function (p) {
    return /^http:\/\/(localhost|127\.0\.0\.1)/.test(p.baseUrl);
  })
);

// --- KEY HANDLING -----------------------------------------------------------
// The rule the whole panel depends on: the key is in memory only.
console.log("\n=== KEY HANDLING ===");
const aiSource = rd("admin/js/ai.js");
ok("the key is never written to localStorage", !/localStorage\.setItem\([^)]*key/i.test(aiSource));
ok("the key is never written to sessionStorage", !/sessionStorage/.test(aiSource));
ok("the key is never written to a cookie", !/document\.cookie/.test(aiSource));
ok("the key is never written to the DOM", !/aiKey\.value\s*=/.test(aiSource));

AI.setKey("sk-test-123");
ok("the key can be set", AI.getKey() === "sk-test-123");
AI.clearKey();
ok("the key can be cleared", AI.getKey() === "");

// The admin panel must not persist it either.
const adminSource = rd("admin/js/admin.js");
ok(
  "the admin never stores the AI key",
  !/localStorage\.setItem\([^)]*ai/i.test(adminSource)
);
ok(
  "the admin clears the AI key on lock",
  /NFAssistant\.clearKey\(\)/.test(adminSource)
);
ok(
  "the admin clears the key field on lock",
  /aiKey\.value\s*=\s*""/.test(adminSource)
);

// --- THE PUBLISH RULE ------------------------------------------------------
// The assistant must not be able to publish. It has no token and no
// publish call. The check looks at the CODE, not the comments — the
// module's own header talks about publishing a lot.
console.log("\n=== PUBLISH SAFETY ===");
const aiCode = aiSource
  .split("\n")
  .filter(function (line) {
    return !/^\s*(\/\/|\*|\/\*)/.test(line);
  })
  .join("\n");
ok("the assistant code has no publish function", !/\bpublish\b/i.test(aiCode));
ok("the assistant never touches the GitHub API", !/api\.github\.com/.test(aiCode));
ok("the assistant never writes a record to storage", !/nf_admin/.test(aiCode));
ok(
  "the assistant only exposes a draft function",
  typeof AI.draft === "function"
);
ok("the assistant exposes no token getter", !/getToken/.test(aiCode));

// --- The admin page ---------------------------------------------------------
console.log("\n=== ADMIN PAGE ===");
const adminHtml = rd("admin/index.html");
ok("the AI script is loaded", /<script src="js\/ai\.js"><\/script>/.test(adminHtml));
ok(
  "the AI script loads before the admin script",
  adminHtml.indexOf("js/ai.js") < adminHtml.indexOf("js/admin.js")
);
ok("there is a base URL field", /id="aiBaseUrl"/.test(adminHtml));
ok("there is a model field", /id="aiModel"/.test(adminHtml));
ok("there is an API key field", /id="aiKey"/.test(adminHtml));
ok(
  "the key field is a password field",
  /type="password"[\s\S]{0,80}id="aiKey"/.test(adminHtml)
);
ok("there is a prompt field", /id="aiPrompt"/.test(adminHtml));
ok("there is a draft button", /id="btnAiDraft"/.test(adminHtml));
ok("there is a test connection button", /id="btnAiTest"/.test(adminHtml));
ok("the AI section states it only drafts", /Draft only/i.test(adminHtml));
ok("the maths panel exists", /id="aiMath"/.test(adminHtml));
ok(
  "every AI input has a label",
  /<label class="field">\s*<span>[^<]*<\/span>\s*<[^>]*id="ai(BaseUrl|Model|Key|Prompt)"/.test(adminHtml)
);

// The label check above only proves one of them. Check each.
["aiBaseUrl", "aiModel", "aiKey", "aiPrompt"].forEach(function (id) {
  const re = new RegExp('<label class="field">[\\s\\S]{0,400}?id="' + id + '"');
  ok("the " + id + " field has a wrapping label", re.test(adminHtml));
});

// The admin must actually wire the buttons.
ok(
  "the admin wires the draft button",
  /btnAiDraft[\s\S]{0,120}addEventListener/.test(adminSource)
);
ok(
  "the admin wires the test button",
  /btnAiTest[\s\S]{0,120}addEventListener/.test(adminSource)
);
ok("the admin calls the assistant's draft function", /NFAssistant\.draft\(/.test(adminSource));
ok("the admin calls the assistant's test function", /NFAssistant\.test\(/.test(adminSource));

// --- The escaping helper ---------------------------------------------------
// The esc() helper must ENCODE a quote, not delete it. A deleted quote
// silently changes the string it was meant to protect.
//
// The quote and the ampersand are built from char codes so the expected
// values cannot be rewritten by an editor that expands HTML entities.
console.log("\n=== ESCAPING ===");
const Q = String.fromCharCode(34);
const AMP = String.fromCharCode(38);
ok(
  "a quote becomes an entity",
  AI.esc("a" + Q + "b") === "a" + AMP + "quot;b",
  AI.esc("a" + Q + "b")
);
ok("an ampersand is encoded first", AI.esc("a&b") === "a" + AMP + "amp;b");
ok("a tag is neutralised", AI.esc("<script>") === "&lt;script&gt;");
ok(
  "a single quote is encoded",
  AI.esc("a'b") === "a" + AMP + "#39;b",
  AI.esc("a'b")
);

// --- The asynchronous request tests -----------------------------------------
// The assistant calls fetch() inside the promise chain, so every request
// test queues its answer FIRST and then makes the call.
async function run() {
  // --- THE REQUEST SHAPE ---------------------------------------------------
  console.log("\n=== REQUEST SHAPE ===");
  queueResponse(okResponse(DRAFT_REPLY));
  const record = await AI.draft({
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    message: "We won 3-1 against Team Velocity.",
    context: CONTEXT,
  });
  ok("the draft has the right opponent", record.opponent === "Team Velocity");
  ok("the draft has the right score", record.score === "3-1");
  ok("the draft has the right result", record.result === "W");
  ok("the draft has the right prize", record.prize === 448);
  ok("the draft carries the lineup", record.roster.length === 2);

  ok("the fetch was called once", calls.length === 1, calls.length);
  const call = calls[0];
  ok(
    "the chat endpoint is called",
    call.url === "https://api.openai.com/v1/chat/completions",
    call.url
  );
  ok("the method is POST", call.init.method === "POST");
  ok(
    "the key is sent as a bearer token",
    call.init.headers.Authorization === "Bearer sk-test"
  );
  const sent = JSON.parse(call.init.body);
  ok("the model name is sent", sent.model === "gpt-4o-mini");
  ok("the JSON mode is requested", sent.response_format.type === "json_object");
  ok("there are two messages", sent.messages.length === 2);
  ok("the system message leads", sent.messages[0].role === "system");
  ok("the owner message is second", sent.messages[1].role === "user");
  ok(
    "the owner's words are sent verbatim",
    sent.messages[1].content === "We won 3-1 against Team Velocity."
  );
  ok(
    "the archive totals are sent as context",
    sent.messages[0].content.indexOf("Played matches: 8") !== -1
  );
  ok(
    "the system prompt names the modes",
    sent.messages[0].content.indexOf("CS, BR, LW") !== -1
  );
  ok(
    "the system prompt forbids inventing an opponent",
    sent.messages[0].content.indexOf("NEVER invent") !== -1
  );
  ok(
    "the system prompt is Free Fire MAX specific",
    sent.messages[0].content.indexOf("Free Fire MAX") !== -1
  );
  ok(
    "the system prompt does not drift to another game",
    !/valorant|counter.strike|cs:go|overwatch/i.test(sent.messages[0].content)
  );

  // --- REQUEST GUARDS ------------------------------------------------------
  console.log("\n=== REQUEST GUARDS ===");
  await AI.draft({ message: "", baseUrl: "https://api.openai.com/v1" }).then(
    function () {
      ok("an empty message is refused", false);
    },
    function (err) {
      ok("an empty message is refused", /type what happened/i.test(err.message));
    }
  );
  await AI.draft({ message: "hi", baseUrl: "" }).then(
    function () {
      ok("an empty base URL is refused", false);
    },
    function (err) {
      ok("an empty base URL is refused", /base URL/i.test(err.message));
    }
  );
  await AI.draft({
    message: "hi",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
  }).then(
    function () {
      ok("a missing key is refused on a remote endpoint", false);
    },
    function (err) {
      ok("a missing key is refused on a remote endpoint", /api key/i.test(err.message));
    }
  );
  // A local endpoint needs no key, so the request is allowed through. The
  // fetch is stubbed, so the answer does not matter.
  queueResponse(okResponse(DRAFT_REPLY));
  await AI.draft({
    message: "hi",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
  }).then(
    function () {
      ok("a local endpoint is allowed without a key", true);
    },
    function (err) {
      ok("a local endpoint is allowed without a key", false, err && err.message);
    }
  );

  // --- ERROR HANDLING ------------------------------------------------------
  console.log("\n=== ERROR HANDLING ===");
  queueResponse(
    errorResponse(401, JSON.stringify({ error: { message: "Invalid API key" } }))
  );
  await AI.draft({
    apiKey: "sk-bad",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    message: "test",
  }).then(
    function () {
      ok("a bad key is reported", false);
    },
    function (err) {
      ok("a bad key is reported", /401/.test(err.message), err && err.message);
      ok("the provider's own message is shown", /Invalid API key/.test(err.message));
    }
  );

  // A provider that rejects the JSON mode is retried without it. The
  // first call is the rejection, the second is the retry that works.
  let rejectCount = 0;
  const rejectThenSucceed = function () {
    rejectCount += 1;
    if (rejectCount === 1) {
      return errorResponse(
        400,
        JSON.stringify({ error: { message: "response_format is not supported" } })
      );
    }
    return okResponse(DRAFT_REPLY);
  };
  queueResponse(rejectThenSucceed);
  queueResponse(rejectThenSucceed);
  await AI.draft({
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    message: "test",
  }).then(
    function (retried) {
      ok(
        "a provider that rejects the JSON mode is retried",
        rejectCount === 2,
        rejectCount
      );
      ok("the retry still produces a record", retried.opponent === "Team Velocity");
      const retriedBody = JSON.parse(calls[calls.length - 1].init.body);
      ok("the retry drops the JSON mode", retriedBody.response_format === undefined);
    },
    function (err) {
      ok(
        "a provider that rejects the JSON mode is retried",
        false,
        err && err.message
      );
    }
  );

  // A model that answers with prose and no record is an error, not a
  // half-filled form.
  queueResponse(okResponse("I am not sure what you mean."));
  await AI.draft({
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    message: "test",
  }).then(
    function () {
      ok("a reply with no record is refused", false);
    },
    function (err) {
      ok("a reply with no record is refused", /did not return a record/i.test(err.message));
    }
  );

  // --- THE CONNECTION TEST -------------------------------------------------
  console.log("\n=== CONNECTION TEST ===");
  queueResponse(okResponse("connected.", "gpt-4o-mini"));
  const result = await AI.test({
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  });
  ok("the connection test succeeds", result.ok === true);
  ok("the connection test names the model", result.model === "gpt-4o-mini");
  ok("the connection test shows the reply", result.reply === "connected.");
  const connBody = JSON.parse(calls[calls.length - 1].init.body);
  ok("the connection test is a tiny request", connBody.max_tokens === 16);
  ok(
    "the connection test sends the model name",
    connBody.model === "gpt-4o-mini"
  );

  await AI.test({ baseUrl: "https://api.openai.com/v1", apiKey: "" }).then(
    function () {
      ok("the connection test needs a key on a remote endpoint", false);
    },
    function (err) {
      ok(
        "the connection test needs a key on a remote endpoint",
        /api key/i.test(err.message)
      );
    }
  );

  // A local endpoint needs no key for the test either.
  queueResponse(okResponse("connected.", "llama3.2"));
  await AI.test({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    apiKey: "",
  }).then(
    function (r) {
      ok("the connection test allows a local endpoint without a key", r.ok === true);
    },
    function (err) {
      ok(
        "the connection test allows a local endpoint without a key",
        false,
        err && err.message
      );
    }
  );

  console.log("\nRESULTS: " + pass + " passed, " + fail + " failed");
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(function (err) {
  console.log("  FAIL  the async suite threw -> " + (err && err.message));
  console.log(err && err.stack);
  console.log("\nRESULTS: " + pass + " passed, " + (fail + 1) + " failed");
  process.exit(1);
});