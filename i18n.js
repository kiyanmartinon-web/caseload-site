/* Casebound — shared language handling for every page.
 *
 * Load it in <head>, before theme.js:  <script src="/i18n.js"></script>
 *
 *   CB_I18N.LANGS            [{code, name, dir}]  — the languages on offer, in menu order
 *   CB_I18N.get()            current language code ("en", "it", "es", "fr", "de", "pt", "pl", "ar")
 *   CB_I18N.set(code)        switch language: saves the choice, updates <html lang dir>, notifies listeners
 *   CB_I18N.onChange(fn)     fn(code) runs after every switch
 *   CB_I18N.pick(dict)       dict[current] || dict.en   (dict keyed by language code)
 *   CB_I18N.locale(code?)    BCP-47 locale for Intl (dates, numbers, currency)
 *   CB_I18N.isRTL(code?)     true for Arabic
 *
 * The language menu is mounted automatically: it replaces any `.lang` element on the page,
 * or, when the page has none, is added to `.masthead-in` (before the Settings menu).
 * The choice is remembered in this browser, so it follows the visitor across pages.
 * Priority on load: ?lang=xx, then the legacy #it / #en hash, then the saved choice,
 * then the browser language, then English.
 */
(function () {
  "use strict";
  var LANGS = [
    { code: "en", name: "English" },
    { code: "it", name: "Italiano" },
    { code: "es", name: "Español" },
    { code: "fr", name: "Français" },
    { code: "de", name: "Deutsch" },
    { code: "pt", name: "Português" },
    { code: "pl", name: "Polski" },
    { code: "ar", name: "العربية", dir: "rtl" }
  ];
  var LOCALE = { en: "en-IE", it: "it-IT", es: "es-ES", fr: "fr-FR", de: "de-DE", pt: "pt-PT", pl: "pl-PL", ar: "ar" };
  var LABEL = { en: "Language", it: "Lingua", es: "Idioma", fr: "Langue", de: "Sprache", pt: "Idioma", pl: "Język", ar: "اللغة" };
  var KEY = "casebound:lang";
  var codes = LANGS.map(function (l) { return l.code; });
  var root = document.documentElement;
  var listeners = [];

  function valid(c) { c = String(c || "").toLowerCase().slice(0, 2); return codes.indexOf(c) >= 0 ? c : null; }
  function saved() { try { return valid(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function save(c) { try { localStorage.setItem(KEY, c); } catch (e) {} }
  function browser() {
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < list.length; i++) { var c = valid(list[i]); if (c) return c; }
    return null;
  }
  function fromUrl() {
    var q = null;
    try { q = valid(new URLSearchParams(location.search).get("lang")); } catch (e) {}
    if (q) return q;
    var h = location.hash.replace(/^#/, "");
    return (h === "it" || h === "en") ? h : null;
  }
  function isRTL(c) { c = c || current; return LANGS.some(function (l) { return l.code === c && l.dir === "rtl"; }); }
  function applyRoot(c) {
    root.lang = c;
    root.dir = isRTL(c) ? "rtl" : "ltr";
  }

  var urlLang = fromUrl();
  var current = urlLang || saved() || browser() || "en";
  if (urlLang) save(urlLang);
  applyRoot(current);

  function cleanUrl() {
    try {
      var u = new URL(location.href), changed = false;
      if (u.searchParams.has("lang")) { u.searchParams.delete("lang"); changed = true; }
      if (u.hash === "#it" || u.hash === "#en") { u.hash = ""; changed = true; }
      if (changed) history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  function set(c) {
    c = valid(c) || "en";
    current = c;
    save(c);
    applyRoot(c);
    cleanUrl();
    syncPickers();
    listeners.slice().forEach(function (fn) { try { fn(c); } catch (e) { console.error(e); } });
  }

  /* ---------- the menu ---------- */
  var CSS = [
    ".cb-lang{position:relative;display:inline-flex;align-items:center;margin-inline-start:auto;flex:0 0 auto}",
    ".cb-lang svg{position:absolute;inset-inline-start:9px;width:15px;height:15px;pointer-events:none;color:var(--ink-soft,#5b5550)}",
    ".cb-lang::after{content:'';position:absolute;inset-inline-end:10px;top:50%;width:6px;height:6px;margin-top:-5px;",
    "border-right:1.6px solid var(--ink-soft,#5b5550);border-bottom:1.6px solid var(--ink-soft,#5b5550);transform:rotate(45deg);pointer-events:none}",
    ".cb-lang select{-webkit-appearance:none;-moz-appearance:none;appearance:none;font-family:var(--sans,system-ui,sans-serif);",
    "font-size:13px;font-weight:600;line-height:1.2;color:var(--ink,#1d1a17);background:var(--paper,#fff);",
    "border:1px solid var(--rule,#d8d2c8);border-radius:5px;padding:7px 28px 7px 30px;cursor:pointer;max-width:160px;margin:0}",
    "[dir=rtl] .cb-lang select{padding:7px 30px 7px 28px}",
    ".cb-lang select:hover{border-color:var(--ink-soft,#5b5550)}",
    ".cb-lang select:focus-visible{outline:2px solid var(--oxblood,#6E1F2A);outline-offset:2px}",
    "@media(max-width:760px){.cb-lang select{font-size:12.5px;padding:6px 24px 6px 28px;max-width:120px}[dir=rtl] .cb-lang select{padding:6px 28px 6px 24px}}",
    "@media print{.cb-lang{display:none}}"
  ].join("");
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var pickers = [];

  function makePicker() {
    var wrap = document.createElement("div");
    wrap.className = "cb-lang";
    var sel = document.createElement("select");
    LANGS.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.code; o.textContent = l.name; o.lang = l.code;
      if (l.dir) o.dir = l.dir;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { set(sel.value); });
    wrap.innerHTML = GLOBE;
    wrap.appendChild(sel);
    pickers.push(sel);
    return wrap;
  }
  function syncPickers() {
    pickers.forEach(function (s) { s.value = current; s.setAttribute("aria-label", LABEL[current] || LABEL.en); s.title = LABEL[current] || LABEL.en; });
  }
  function mount() {
    if (!document.getElementById("cb-lang-css")) {
      var st = document.createElement("style"); st.id = "cb-lang-css"; st.textContent = CSS; document.head.appendChild(st);
    }
    var olds = document.querySelectorAll(".lang");
    if (olds.length) {
      olds.forEach(function (old) { old.parentNode.replaceChild(makePicker(), old); });
    } else {
      var host = document.querySelector("[data-lang-picker]") || document.querySelector(".masthead-in");
      if (host && !host.querySelector(".cb-lang")) {
        var p = makePicker();
        var settings = host.querySelector("#cb-settings");
        if (settings) host.insertBefore(p, settings); else host.appendChild(p);
      }
    }
    syncPickers();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.CB_I18N = {
    LANGS: LANGS,
    codes: codes,
    get: function () { return current; },
    set: set,
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    pick: function (dict) { return (dict && (dict[current] != null ? dict[current] : dict.en)); },
    locale: function (c) { return LOCALE[c || current] || "en-IE"; },
    isRTL: isRTL,
    valid: valid,
    mount: mount
  };
})();
