// i18n.js — English / Hindi strings for the match archive.
//
// Team and match data come from data/team.json and data/matches.json.
// Everything the UI chrome says lives here.
//
// ATTRIBUTE TRANSLATION
//   data-i18n              -> textContent
//   data-i18n-html         -> innerHTML (only for trusted, in-repo strings)
//   data-i18n-placeholder   -> placeholder attribute
//   data-i18n-aria         -> aria-label attribute
//   data-i18n-title        -> title attribute
//
// The parity test compares the two dictionaries key by key, so a missing
// Hindi string fails the build instead of shipping a half-translated page.
(function () {
  "use strict";

  const strings = {
    en: {
      langSwitchTo: "Switch language to Hindi",
      navArchive: "Archive",
      mainNavLabel: "Main navigation",
      navStats: "Stats",
      navTeam: "Team",
      navContact: "Contact",
      adminLink: "Admin",
      menuOpen: "Open menu",
      menuClose: "Close menu",

      heroKicker: "Free Fire MAX match archive",
      heroTitle: "Every match. Every entry fee. Every prize.",
      heroSub:
        "The complete record of our Free Fire MAX tournament and scrim run — filterable, searchable and open for anyone to check.",
      heroCtaPrimary: "Browse the archive",
      heroCtaSecondary: "Team and contact",
      heroStatMatches: "Matches played",
      heroStatWins: "Wins",
      heroStatPrize: "Prize won",
      heroStatWinRate: "Win rate",
      formLabel: "Recent form",
      formLastTen: "Last 10 results",

      demoBanner:
        "These are sample records, so you can see how the archive works. The owner replaces them with the real Free Fire MAX match log.",

      archiveKicker: "Archive",
      archiveTitle: "The full match log",
      archiveSub:
        "Filter by mode, event type or year. Search by opponent, event or map.",
      filterMode: "Mode",
      filterEvent: "Event",
      filterResult: "Result",
      filterYear: "Year",
      filterAll: "All",
      searchPlaceholder: "Search opponent, event or map",
      searchLabel: "Search the match archive",
      clearSearch: "Clear search",
      resultsCount: "matches",
      resetFilters: "Reset filters",
      modeAll: "All modes",
      eventAll: "All events",
      resultAll: "All results",
      filterByMode: "Filter by game mode",
      filterByEvent: "Filter by event type",
      filterByResult: "Filter by result",
      filterByYear: "Filter by year",
      modeCs: "Clash Squad",
      modeBr: "Battle Royale",
      modeLw: "Lone Wolf",
      eventTournament: "Tournament",
      eventScrim: "Scrim",
      eventQualifier: "Qualifier",
      eventShowmatch: "Showmatch",
      eventOther: "Other",

      resultWin: "Win",
      resultLoss: "Loss",
      resultDraw: "Draw",
      resultW: "W",
      resultL: "L",
      resultD: "D",

      colDate: "Date",
      colEvent: "Event",
      colMap: "Map",
      colOpponent: "Opponent",
      colScore: "Score",
      colResult: "Result",
      colEntry: "Entry fee",
      colPrize: "Prize",
      colPlacement: "Placement",
      labelEntryFee: "Entry fee",
      labelPrize: "Prize won",
      labelPlacement: "Placement",
      labelNotes: "Notes",
      noFee: "No entry fee",
      noPrize: "No prize",
      vs: "vs",
      demoTag: "Sample",

      emptyTitle: "No matches match those filters",
      emptyBody: "Try widening the filters, or clear the search box.",
      loadError: "Could not load the match archive",
      loadErrorHint:
        "The data file could not be read. Check your connection and reload.",
      loadTimeout: "The archive took too long to load",
      offline: "You are offline. Showing the last saved archive.",
      online: "Back online.",

      statsKicker: "Record",
      statsTitle: "The numbers behind the record",
      statsSub:
        "Win rate, prize money and event breakdown across every match in the archive.",
      statTotalMatches: "Total matches",
      statWins: "Wins",
      statLosses: "Losses",
      statDraws: "Draws",
      statWinRate: "Win rate",
      statPrizeTotal: "Total prize money",
      statEntryTotal: "Total entry fees",
      statNet: "Net earnings",
      statAvgPrize: "Average prize",
      statModes: "Modes played",
      statEvents: "Event types",
      statFirstMatch: "First match",
      statLatestMatch: "Latest match",
      statBestPlacement: "Best placement",
      statNetNote: "Prize money minus entry fees across all listed matches.",
      breakdownTitle: "By mode",
      breakdownEventTitle: "By event type",

      teamKicker: "Team",
      teamTitle: "About the roster",
      teamFactBased: "Based in",
      teamFactEmail: "Email",
      teamFactWhatsapp: "WhatsApp",
      teamFactInstagram: "Instagram",
      teamFactYouTube: "YouTube",
      teamFactArchive: "Archive entries",
      notSet: "Not set",
      contactTitle: "Get in touch",
      contactSub:
        "Sponsorship, scrims, or a match to challenge. Send a message and we will reply.",
      contactWhatsapp: "WhatsApp us",
      contactEmail: "Email us",
      contactCopy: "Copy email",
      contactCopied: "Email copied",
      contactShare: "Share archive",
      contactShared: "Link copied",
      joinCta: "Challenge our squad",

      footerNote:
        "Match records are added and maintained by the team. Sample records are marked and can be removed at any time.",
      footerAdmin: "Admin",
      footerTop: "Back to top",
      footerRights: "All rights reserved.",
      footerBuiltBy: "Built by NightForge.",
    },
    hi: {
      langSwitchTo: "भाषा अंग्रेज़ी में बदलें",
      navArchive: "रिकॉर्ड",
      mainNavLabel: "मुख्य नेविगेशन",
      navStats: "आँकड़े",
      navTeam: "टीम",
      navContact: "संपर्क",
      adminLink: "एडमिन",
      menuOpen: "मेन्यू खोलें",
      menuClose: "मेन्यू बंद करें",

      heroKicker: "Free Fire MAX मैच रिकॉर्ड",
      heroTitle: "हर मैच। हर एंट्री फीस। हर इनाम।",
      heroSub:
        "हमारे Free Fire MAX टूर्नामेंट व स्क्रिम का पूरा रिकॉर्ड — फ़िल्टर करने योग्य, खोजने योग्य और किसी के लिए भी खुला।",
      heroCtaPrimary: "रिकॉर्ड देखें",
      heroCtaSecondary: "टीम और संपर्क",
      heroStatMatches: "खेले गए मैच",
      heroStatWins: "जीत",
      heroStatPrize: "जीता इनाम",
      heroStatWinRate: "जीत दर",
      formLabel: "हाल का प्रदर्शन",
      formLastTen: "पिछले 10 नतीजे",

      demoBanner:
        "ये नमूना रिकॉर्ड हैं, ताकि आपको पता चले रिकॉर्ड कैसा दिखता है। असली Free Fire MAX मैच लॉग इन्हीं की जगह आएगा।",

      archiveKicker: "रिकॉर्ड",
      archiveTitle: "पूरा मैच लॉग",
      archiveSub:
        "मोड, इवेंट या साल से फ़िल्टर करें। प्रतिद्वंद्वी, इवेंट या नक्शे से खोजें।",
      filterMode: "मोड",
      filterEvent: "इवेंट",
      filterResult: "नतीजा",
      filterYear: "साल",
      filterAll: "सभी",
      searchPlaceholder: "प्रतिद्वंद्वी, इवेंट या नक्शा खोजें",
      searchLabel: "मैच रिकॉर्ड में खोजें",
      clearSearch: "खोज मिटाएँ",
      resultsCount: "मैच",
      resetFilters: "फ़िल्टर हटाएँ",
      modeAll: "सभी मोड",
      eventAll: "सभी इवेंट",
      resultAll: "सभी नतीजे",
      filterByMode: "गेम मोड से फ़िल्टर करें",
      filterByEvent: "इवेंट प्रकार से फ़िल्टर करें",
      filterByResult: "नतीजे से फ़िल्टर करें",
      filterByYear: "साल से फ़िल्टर करें",
      modeCs: "Clash Squad",
      modeBr: "Battle Royale",
      modeLw: "Lone Wolf",
      eventTournament: "टूर्नामेंट",
      eventScrim: "स्क्रिम",
      eventQualifier: "क्वालिफ़ायर",
      eventShowmatch: "शोमैच",
      eventOther: "अन्य",

      resultWin: "जीत",
      resultLoss: "हार",
      resultDraw: "ड्रॉ",
      resultW: "जी",
      resultL: "हा",
      resultD: "ड्र",

      colDate: "तारीख",
      colEvent: "इवेंट",
      colMap: "नक्शा",
      colOpponent: "प्रतिद्वंद्वी",
      colScore: "स्कोर",
      colResult: "नतीजा",
      colEntry: "एंट्री फीस",
      colPrize: "इनाम",
      colPlacement: "स्थान",
      labelEntryFee: "एंट्री फीस",
      labelPrize: "जीता इनाम",
      labelPlacement: "स्थान",
      labelNotes: "टिप्पणी",
      noFee: "कोई एंट्री फीस नहीं",
      noPrize: "कोई इनाम नहीं",
      vs: "बनाम",
      demoTag: "नमूना",

      emptyTitle: "इन फ़िल्टर से कोई मैच नहीं मिला",
      emptyBody: "फ़िल्टर थोड़े चौड़े करें, या खोज खाली कर दें।",
      loadError: "मैच रिकॉर्ड लोड नहीं हुआ",
      loadErrorHint:
        "डेटा फ़ाइल पढ़ी नहीं जा सकी। कनेक्शन जाँचें और दोबारा लोड करें।",
      loadTimeout: "रिकॉर्ड लोड होने में बहुत समय लगा",
      offline: "आप ऑफ़लाइन हैं। पिछला सेव किया रिकॉर्ड दिख रहा है।",
      online: "दोबारा ऑनलाइन।",

      statsKicker: "रिकॉर्ड",
      statsTitle: "रिकॉर्ड के पीछे के आँकड़े",
      statsSub: "रिकॉर्ड के हर मैच पर जीत दर, इनाम की रकम और इवेंट का बँटवारा।",
      statTotalMatches: "कुल मैच",
      statWins: "जीत",
      statLosses: "हार",
      statDraws: "ड्रॉ",
      statWinRate: "जीत दर",
      statPrizeTotal: "कुल इनाम रकम",
      statEntryTotal: "कुल एंट्री फीस",
      statNet: "शुद्ध कमाई",
      statAvgPrize: "औसत इनाम",
      statModes: "खेले गए मोड",
      statEvents: "इवेंट प्रकार",
      statFirstMatch: "पहला मैच",
      statLatestMatch: "नवीनतम मैच",
      statBestPlacement: "सर्वश्रेष्ठ स्थान",
      statNetNote: "सभी सूचीबद्ध मैचों में इनाम रकम और एंट्री फीस का अंतर।",
      breakdownTitle: "मोड के अनुसार",
      breakdownEventTitle: "इवेंट प्रकार के अनुसार",

      teamKicker: "टीम",
      teamTitle: "रोस्टर के बारे में",
      teamFactBased: "आधार",
      teamFactEmail: "ईमेल",
      teamFactWhatsapp: "WhatsApp",
      teamFactInstagram: "Instagram",
      teamFactYouTube: "YouTube",
      teamFactArchive: "रिकॉर्ड एंट्री",
      notSet: "सेट नहीं",
      contactTitle: "संपर्क करें",
      contactSub:
        "स्पॉन्सरशिप, स्क्रिम, या कोई मैच — संदेश भेजें, हम जवाब देंगे।",
      contactWhatsapp: "WhatsApp करें",
      contactEmail: "ईमेल करें",
      contactCopy: "ईमेल कॉपी करें",
      contactCopied: "ईमेल कॉपी हो गया",
      contactShare: "रिकॉर्ड शेयर करें",
      contactShared: "लिंक कॉपी हो गया",
      joinCta: "हमारी टीम को चुनौती दें",

      footerNote:
        "मैच रिकॉर्ड टीम द्वारा जोड़े और रखे जाते हैं। नमूना रिकॉर्ड चिह्नित हैं और कभी भी हटाए जा सकते हैं।",
      footerAdmin: "एडमिन",
      footerTop: "ऊपर जाएँ",
      footerRights: "सर्वाधिकार सुरक्षित।",
      footerBuiltBy: "NightForge द्वारा निर्मित।",
    },
  };

  let currentLang = "en";

  // Translate a key. Falls back to English, then to the key itself, so a
  // missing string is visible rather than silently blank.
  function t(key) {
    const s = strings[currentLang];
    if (s && s[key] != null) return s[key];
    if (strings.en[key] != null) return strings.en[key];
    return key;
  }

  function isHindi() {
    return currentLang === "hi";
  }

  // Every translated attribute goes through one helper, so adding an
  // attribute is a one-line change rather than a new querySelectorAll.
  const ATTRIBUTE_MAP = [
    ["data-i18n-placeholder", "placeholder"],
    ["data-i18n-aria", "aria-label"],
    ["data-i18n-title", "title"],
  ];

  function apply() {
    document.documentElement.lang = currentLang;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });

    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });

    ATTRIBUTE_MAP.forEach(function (pair) {
      const attr = pair[0];
      const target = pair[1];
      document.querySelectorAll("[" + attr + "]").forEach(function (el) {
        el.setAttribute(target, t(el.getAttribute(attr)));
      });
    });

    document.querySelectorAll("[data-lang-toggle]").forEach(function (btn) {
      btn.textContent = currentLang === "en" ? "हिंदी" : "English";
      btn.setAttribute("aria-label", t("langSwitchTo"));
      btn.setAttribute("aria-pressed", currentLang === "hi" ? "true" : "false");
    });
  }

  function setLang(lang) {
    currentLang = lang === "hi" ? "hi" : "en";
    try {
      localStorage.setItem("nf_lang", currentLang);
    } catch (e) {
      // Private mode / storage disabled — language still switches for this visit.
    }
    apply();
    document.dispatchEvent(
      new CustomEvent("langchange", { detail: { lang: currentLang } }),
    );
  }

  function getLang() {
    return currentLang;
  }

  function initLang() {
    let saved = null;
    try {
      saved = localStorage.getItem("nf_lang");
    } catch (e) {
      saved = null;
    }
    currentLang = saved === "hi" ? "hi" : "en";
    apply();
  }

  window.I18N = {
    t: t,
    setLang: setLang,
    getLang: getLang,
    isHindi: isHindi,
    initLang: initLang,
    // Exposed so the parity test can compare the two dictionaries directly
    // instead of re-parsing this file. Read-only by convention.
    strings: strings,
  };

  document.addEventListener("DOMContentLoaded", initLang);
})();
