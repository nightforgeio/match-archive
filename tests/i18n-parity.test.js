// i18n-parity.test.js — every key must exist in BOTH dictionaries.
//
// A missing Hindi key falls back to English at runtime, which ships a
// half-translated page. Catching it here means the build fails instead.
//
// Run: node --test tests/i18n-parity.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const I18N_PATH = path.join(__dirname, "..", "js", "i18n.js");

// Load i18n.js in a sandbox with a fake window/document, and grab the
// dictionary it exposes. Reading it this way means the test checks the
// actual shipped strings, not a copy.
function loadStrings() {
  const src = fs.readFileSync(I18N_PATH, "utf8");
  const listeners = {};
  const sandbox = {
    window: {},
    document: {
      documentElement: { lang: "en" },
      querySelectorAll: function () {
        return [];
      },
      addEventListener: function (evt, fn) {
        listeners[evt] = fn;
      },
      dispatchEvent: function () {}
    },
    localStorage: {
      getItem: function () {
        return null;
      },
      setItem: function () {}
    },
    CustomEvent: function () {}
  };
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.I18N.strings;
}

const strings = loadStrings();

test("both dictionaries exist", function () {
  assert.ok(strings.en, "english dictionary missing");
  assert.ok(strings.hi, "hindi dictionary missing");
});

test("every english key has a hindi counterpart", function () {
  const enKeys = Object.keys(strings.en);
  const hiKeys = Object.keys(strings.hi);
  const missing = enKeys.filter(function (k) {
    return !Object.prototype.hasOwnProperty.call(strings.hi, k);
  });
  assert.deepStrictEqual(
    missing,
    [],
    "missing hindi keys: " + missing.join(", ")
  );
});

test("every hindi key has an english counterpart", function () {
  const enKeys = Object.keys(strings.en);
  const hiKeys = Object.keys(strings.hi);
  const orphan = hiKeys.filter(function (k) {
    return !Object.prototype.hasOwnProperty.call(strings.en, k);
  });
  assert.deepStrictEqual(
    orphan,
    [],
    "hindi keys with no english source: " + orphan.join(", ")
  );
});

test("no value is empty in either language", function () {
  const problems = [];
  ["en", "hi"].forEach(function (lang) {
    Object.keys(strings[lang]).forEach(function (key) {
      const value = strings[lang][key];
      if (typeof value !== "string" || value.trim() === "") {
        problems.push(lang + "." + key);
      }
    });
  });
  assert.deepStrictEqual(problems, [], "empty strings: " + problems.join(", "));
});

test("no hindi string contains a stray backslash", function () {
  // A backslash before a Devanagari character renders as a visible glyph.
  const problems = [];
  Object.keys(strings.hi).forEach(function (key) {
    if (/\\/.test(strings.hi[key])) problems.push(key);
  });
  assert.deepStrictEqual(problems, [], "backslash in: " + problems.join(", "));
});

test("no hindi string has a doubled Devanagari character", function () {
  const problems = [];
  Object.keys(strings.hi).forEach(function (key) {
    if (/([ऀ-ॿ])\1/.test(strings.hi[key])) problems.push(key);
  });
  assert.deepStrictEqual(problems, [], "doubled character in: " + problems.join(", "));
});

test("hindi strings contain no latin letters outside allowed terms", function () {
  // Common English words are fine in Hindi copy (WhatsApp, SEO, CS, BR),
  // and a brand name is never translated. But a whole English sentence
  // means the key was never translated at all.
  const allowed = /\b(WhatsApp|CS|BR|LW|Instagram|YouTube|SEO|NightForge)\b/g;
  const problems = [];
  Object.keys(strings.hi).forEach(function (key) {
    const stripped = strings.hi[key].replace(allowed, "");
    if (/[A-Za-z]{3,}/.test(stripped)) problems.push(key + ": " + stripped);
  });
  assert.deepStrictEqual(problems, [], "untranslated: " + problems.join(" | "));
});

test("the t() fallback never returns an empty string", function () {
  const problems = Object.keys(strings.en).filter(function (key) {
    return !strings.en[key] || !strings.hi[key];
  });
  assert.deepStrictEqual(problems, []);
});