/* Casebound — appearance (light / dark / match device) and the Settings menu.
   Loaded in <head> on every page so the right theme is applied before the page
   paints (no white flash). The choice is kept in this browser's local storage
   under "casebound:theme"; nothing is sent to the server. */
(function () {
  var KEY = "casebound:theme";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var docs = [];          // same-origin documents (the embedded panes) that follow the theme
  var listeners = [];

  function stored() {
    try { var v = localStorage.getItem(KEY); return v === "dark" || v === "light" || v === "system" ? v : "light"; }
    catch (e) { return "light"; }
  }
  function effective(choice) {
    return choice === "system" ? (mq && mq.matches ? "dark" : "light") : choice;
  }

  /* Dark palette: the same tokens the pages already use, re-tuned for a dark
     background. Accent colours are lifted so text in them stays readable, and
     solid buttons get dark text instead of white. */
  var CSS = [
    'html[data-theme="dark"]{color-scheme:dark;',
    '--paper:#14171E;--paper-2:#1B1F28;--ink:#E7E9EE;--ink-soft:#A4ABBA;',
    '--rule:#343A47;--rule-soft:#272C37;',
    '--oxblood:#E0939C;--oxblood-wash:#3A2328;',
    '--verdigris:#86C3C6;--verdigris-wash:#1D3234;',
    '--amber:#E3B76B;--amber-wash:#382D1B;',
    '--slate:#BAC4D2;--slate-wash:#262C37}',
    /* solid dark-ink or oxblood buttons → light fill, dark label */
    'html[data-theme="dark"] .lang button[aria-pressed="true"],html[data-theme="dark"] .btn,html[data-theme="dark"] .btn:hover,',
    'html[data-theme="dark"] .btn.danger:hover,html[data-theme="dark"] .plan .tag,html[data-theme="dark"] .hub-btn,',
    'html[data-theme="dark"] .case-card-open,html[data-theme="dark"] .mode-sw button.on,html[data-theme="dark"] .build-btn,',
    'html[data-theme="dark"] .chip.on,html[data-theme="dark"] .run,html[data-theme="dark"] .add-doc-btn,',
    'html[data-theme="dark"] .node-case{color:var(--paper)!important}',
    'html[data-theme="dark"] .btn.ghost{color:var(--ink)!important}',
    'html[data-theme="dark"] .btn.danger{color:var(--oxblood)!important}',
    'html[data-theme="dark"] .btn.danger:hover{color:var(--paper)!important}',
    'html[data-theme="dark"] .hub-btn:hover,html[data-theme="dark"] .case-card-open:hover{background:#EBA9B1!important}',
    'html[data-theme="dark"] .build-btn:hover,html[data-theme="dark"] .run:hover,html[data-theme="dark"] .add-doc-btn:hover{background:#FFFFFF!important}',
    'html[data-theme="dark"] .run:disabled{background:#4A5160!important;color:#A4ABBA!important}',
    'html[data-theme="dark"] .hub-btn.secondary{color:var(--ink)!important;background:var(--paper)!important}',
    'html[data-theme="dark"] .hub-btn.secondary:hover{background:var(--rule-soft)!important}',
    'html[data-theme="dark"] input,html[data-theme="dark"] textarea,html[data-theme="dark"] select{background-color:var(--paper);color:var(--ink)}',
    'html[data-theme="dark"] input[type=email],html[data-theme="dark"] input[type=password],html[data-theme="dark"] input[type=text]{background:var(--paper)}',
    'html[data-theme="dark"] .gc-item .gc-badge2{background:var(--slate-wash);color:var(--slate)}',
    'html[data-theme="dark"] .banner{border-color:#5A3036}',
    'html[data-theme="dark"] .node{box-shadow:0 1px 3px rgba(0,0,0,.4)}',
    'html[data-theme="dark"] img{opacity:.92}',
    '@media print{html[data-theme="dark"]{color-scheme:light;--paper:#fff;--paper-2:#fff;--ink:#1A2438;--ink-soft:#5A6376;--rule:#D8D7CF;--rule-soft:#E8E7E0;--oxblood:#6E1F2A;--verdigris:#29565A;--amber:#8A5A12}}'
  ].join("");

  function inject(doc) {
    if (!doc || !doc.head || doc.getElementById("cb-theme-css")) return;
    var s = doc.createElement("style"); s.id = "cb-theme-css"; s.textContent = CSS;
    doc.head.appendChild(s);
  }
  function paint(doc, mode) {
    try {
      inject(doc);
      doc.documentElement.setAttribute("data-theme", mode);
    } catch (e) {}
  }
  function apply() {
    var choice = stored(), mode = effective(choice);
    root.setAttribute("data-theme", mode);
    root.setAttribute("data-theme-choice", choice);
    if (document.head) paint(document, mode);
    docs = docs.filter(function (d) { try { return !!d.documentElement; } catch (e) { return false; } });
    docs.forEach(function (d) { paint(d, mode); });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "dark" ? "#1B1F28" : "#6E1F2A");
    listeners.forEach(function (fn) { try { fn(mode, choice); } catch (e) {} });
  }

  window.CBTheme = {
    get: stored,
    mode: function () { return effective(stored()); },
    set: function (choice) {
      try { localStorage.setItem(KEY, choice); } catch (e) {}
      apply();
    },
    /* Called by the main page for each embedded pane once it has loaded. */
    attach: function (doc) {
      if (!doc) return;
      if (docs.indexOf(doc) < 0) docs.push(doc);
      paint(doc, effective(stored()));
    },
    onChange: function (fn) { listeners.push(fn); }
  };

  root.setAttribute("data-theme", effective(stored()));
  if (document.head) inject(document);
  if (mq) {
    var onSys = function () { if (stored() === "system") apply(); };
    mq.addEventListener ? mq.addEventListener("change", onSys) : mq.addListener(onSys);
  }
  // Another tab changed the setting.
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(); });

  /* ---------------- Admin: view pages as client or lawyer ----------------
     Only for accounts the server reports as admin (/api/auth/me → user.isAdmin).
     The choice lives in this browser ("casebound:viewAs") and only changes what
     the pages SHOW; the server still applies the admin's real permissions. */
  var VKEY = "casebound:viewAs";
  function viewStored() {
    try { var v = localStorage.getItem(VKEY); return v === "client" || v === "lawyer" ? v : "admin"; }
    catch (e) { return "admin"; }
  }
  window.CBView = {
    // "admin" (own view), "client" or "lawyer"; always "admin" for non-admins
    get: function (u) { return u && u.isAdmin ? viewStored() : "admin"; },
    // the role a page should render for this user
    role: function (u) {
      if (!u) return "client";
      var v = u.isAdmin ? viewStored() : "admin";
      return v === "admin" ? (u.role === "lawyer" ? "lawyer" : "client") : v;
    },
    set: function (v) {
      try { if (v === "client" || v === "lawyer") localStorage.setItem(VKEY, v); else localStorage.removeItem(VKEY); } catch (e) {}
      location.reload();
    }
  };

  /* ---------------- Settings menu in the top bar ---------------- */
  var L = {
    en: { settings: "Settings", appearance: "Appearance", light: "Light", dark: "Dark", system: "Auto",
          systemHint: "Auto follows your device setting.", account: "Account", signin: "Sign in",
          plans: "Plans", terms: "Terms of use", privacy: "Privacy notice", contact: "Contact / complaints",
          home: "Casebound home", viewAs: "Admin · view pages as", vAdmin: "Admin", vClient: "Client", vLawyer: "Lawyer",
          viewHint: "Only changes what the pages show you. Your account stays admin.",
          gRisk: "Risk check", gMine: "My cases", gBoard: "Case board", gAcc: "Account",
          bannerP: "Admin preview: you are seeing the site as a", bannerC: "client", bannerL: "lawyer", back: "Back to admin view",
          switchTo: "Switch to" },
    it: { settings: "Impostazioni", appearance: "Aspetto", light: "Chiaro", dark: "Scuro", system: "Auto",
          systemHint: "Auto segue l'impostazione del dispositivo.", account: "Account", signin: "Accedi",
          plans: "Piani", terms: "Condizioni d'uso", privacy: "Informativa privacy", contact: "Contatti / reclami",
          home: "Home di Casebound", viewAs: "Admin · vedi le pagine come", vAdmin: "Admin", vClient: "Cliente", vLawyer: "Avvocato",
          viewHint: "Cambia solo ciò che le pagine ti mostrano. Il tuo account resta admin.",
          gRisk: "Verifica del rischio", gMine: "I miei casi", gBoard: "Bacheca casi", gAcc: "Account",
          bannerP: "Anteprima admin: stai vedendo il sito come", bannerC: "cliente", bannerL: "avvocato", back: "Torna alla vista admin",
          switchTo: "Passa a" }
  };
  var MENU_CSS = [
    '.cb-set{position:relative;flex:0 0 auto;font-family:"Archivo",system-ui,sans-serif}',
    '.cb-set-btn{display:inline-flex;align-items:center;gap:6px;background:none;border:1px solid var(--rule);color:var(--ink-soft);',
    'border-radius:5px;padding:6px 10px;font:600 13px "Archivo",system-ui,sans-serif;cursor:pointer;white-space:nowrap}',
    '.cb-set-btn:hover,.cb-set-btn[aria-expanded="true"]{color:var(--ink);border-color:var(--ink-soft);background:var(--paper)}',
    '.cb-set-btn svg{width:16px;height:16px;flex:0 0 auto}',
    '.cb-set-panel{position:absolute;right:0;top:calc(100% + 8px);width:260px;max-width:calc(100vw - 24px);background:var(--paper-2);',
    'border:1px solid var(--rule);border-radius:8px;box-shadow:0 10px 30px rgba(10,14,25,.18);padding:12px;z-index:1000;text-align:left}',
    '.cb-set-h{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);margin:2px 4px 8px}',
    '.cb-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:2px}',
    '.cb-seg button{display:flex;flex-direction:column;align-items:center;gap:3px;border:none;background:none;color:var(--ink-soft);',
    'font:600 12px "Archivo",system-ui,sans-serif;padding:8px 4px;border-radius:4px;cursor:pointer}',
    '.cb-seg button svg{width:16px;height:16px}',
    '.cb-seg button:hover{color:var(--ink)}',
    '.cb-seg button[aria-checked="true"]{background:var(--paper-2);color:var(--ink);box-shadow:0 0 0 1px var(--rule)}',
    '.cb-hint{font-size:11.5px;color:var(--ink-soft);margin:6px 4px 0;line-height:1.4}',
    '.cb-sep{height:1px;background:var(--rule-soft);margin:12px -12px 8px}',
    '.cb-links a{display:block;padding:8px 6px;border-radius:4px;font-size:13.5px;font-weight:600;color:var(--ink)!important;',
    'text-decoration:none;background:none!important}',
    '.cb-links a:hover{background:var(--paper)!important;color:var(--oxblood)!important}',
    '.cb-links a.cb-strong{color:var(--verdigris)!important}',
    '.cb-seg.cb-seg-v button{padding:7px 4px}',
    '.cb-go{display:flex;flex-wrap:wrap;gap:6px;margin:8px 2px 0}',
    '.cb-go a{font-size:12.5px;font-weight:600;padding:5px 9px;border:1px solid var(--rule);border-radius:999px;color:var(--ink)!important;text-decoration:none;background:var(--paper)!important}',
    '.cb-go a:hover{border-color:var(--ink-soft)}',
    '.cb-view-bar{background:var(--ink);color:var(--paper);font:600 13px "Archivo",system-ui,sans-serif;padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;justify-content:center;text-align:center}',
    '.cb-view-bar b{text-transform:uppercase;letter-spacing:.05em}',
    '.cb-view-bar button{background:none;border:1px solid currentColor;color:inherit;font:inherit;border-radius:999px;padding:3px 10px;cursor:pointer;opacity:.9}',
    '.cb-view-bar button:hover{opacity:1}',
    '@media print{.cb-view-bar{display:none}}',
    '@media(max-width:760px){.cb-set-btn .cb-set-lbl{display:none}.cb-set-btn{padding:6px 8px}.cb-set-panel{position:fixed;right:12px;left:auto;top:62px}}',
    '@media print{.cb-set{display:none}}'
  ].join("");

  var ICON = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };

  var signedIn = null;
  function lang() { return /^it/i.test(root.lang || "") ? "it" : "en"; }

  function buildMenu() {
    var host = document.querySelector(".masthead-in");
    if (!host || document.getElementById("cb-settings")) return;
    var st = document.createElement("style"); st.textContent = MENU_CSS; document.head.appendChild(st);

    var wrap = document.createElement("div"); wrap.className = "cb-set"; wrap.id = "cb-settings";
    wrap.innerHTML =
      '<button type="button" class="cb-set-btn" aria-haspopup="true" aria-expanded="false" aria-controls="cb-set-panel">' +
        ICON.gear + '<span class="cb-set-lbl" data-l="settings"></span></button>' +
      '<div class="cb-set-panel" id="cb-set-panel" role="dialog" hidden>' +
        '<div class="cb-set-h" data-l="appearance"></div>' +
        '<div class="cb-seg" role="radiogroup">' +
          ['light', 'dark', 'system'].map(function (k) {
            return '<button type="button" role="radio" data-theme-opt="' + k + '">' + ICON[k] + '<span data-l="' + k + '"></span></button>';
          }).join("") +
        '</div>' +
        '<p class="cb-hint" data-l="systemHint"></p>' +
        '<div id="cb-view" hidden><div class="cb-sep"></div>' +
          '<div class="cb-set-h" data-l="viewAs"></div>' +
          '<div class="cb-seg cb-seg-v" role="radiogroup">' +
            ['admin', 'client', 'lawyer'].map(function (k) {
              return '<button type="button" role="radio" data-view-opt="' + k + '"><span data-l="v' + k.charAt(0).toUpperCase() + k.slice(1) + '"></span></button>';
            }).join("") +
          '</div>' +
          '<p class="cb-hint" data-l="viewHint"></p>' +
          '<div class="cb-go" id="cb-go"></div>' +
        '</div>' +
        '<div class="cb-sep"></div>' +
        '<nav class="cb-links">' +
          '<a href="/account.html" class="cb-strong" id="cb-acc" data-l="signin"></a>' +
          '<a href="/pricing.html" data-l="plans"></a>' +
          '<a href="/terms.html" data-l="terms"></a>' +
          '<a href="/privacy.html" data-l="privacy"></a>' +
          '<a href="mailto:admin@case-bound.com?subject=Casebound%20%E2%80%94%20contact%20or%20complaint" data-l="contact"></a>' +
        '</nav>' +
      '</div>';
    host.appendChild(wrap);

    var btn = wrap.querySelector(".cb-set-btn"), panel = wrap.querySelector(".cb-set-panel");
    function label() {
      var t = L[lang()];
      wrap.querySelectorAll("[data-l]").forEach(function (el) { el.textContent = t[el.getAttribute("data-l")]; });
      wrap.querySelector("#cb-acc").textContent = signedIn ? t.account : t.signin;
      btn.setAttribute("aria-label", t.settings);
      var vc = viewStored();
      wrap.querySelectorAll("[data-view-opt]").forEach(function (b) {
        b.setAttribute("aria-checked", b.getAttribute("data-view-opt") === vc ? "true" : "false");
      });
      var go = wrap.querySelector("#cb-go");
      if (go) {
        var links = vc === "lawyer" ? [["/lawyers.html", t.gBoard], ["/account.html", t.gAcc]]
          : vc === "client" ? [["/risk-check.html", t.gRisk], ["/account.html#mycases", t.gMine]]
          : [["/risk-check.html", t.gRisk], ["/lawyers.html", t.gBoard], ["/account.html", t.gAcc]];
        go.innerHTML = links.map(function (l) { return '<a href="' + l[0] + '">' + l[1] + '</a>'; }).join("");
      }
      if (bar) paintBar();
      var choice = stored();
      wrap.querySelectorAll("[data-theme-opt]").forEach(function (b) {
        b.setAttribute("aria-checked", b.getAttribute("data-theme-opt") === choice ? "true" : "false");
      });
    }
    function open(v) {
      panel.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false");
      if (v) { var on = panel.querySelector('[aria-checked="true"]'); if (on) on.focus(); }
    }
    btn.addEventListener("click", function (e) { e.stopPropagation(); open(panel.hidden); });
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) open(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { open(false); btn.focus(); } });
    wrap.querySelectorAll("[data-theme-opt]").forEach(function (b) {
      b.addEventListener("click", function () { window.CBTheme.set(b.getAttribute("data-theme-opt")); });
    });
    wrap.querySelectorAll("[data-view-opt]").forEach(function (b) {
      b.addEventListener("click", function () { if (b.getAttribute("data-view-opt") !== viewStored()) window.CBView.set(b.getAttribute("data-view-opt")); });
    });

    // Strip under the top bar while an admin previews as client or lawyer.
    var bar = null;
    function paintBar() {
      var t = L[lang()], v = viewStored(), other = v === "client" ? "lawyer" : "client";
      bar.innerHTML = '<span>' + t.bannerP + ' <b>' + (v === "client" ? t.bannerC : t.bannerL) + '</b></span>' +
        '<button type="button" data-bar="' + other + '">' + t.switchTo + ' ' + (other === "client" ? t.bannerC : t.bannerL) + '</button>' +
        '<button type="button" data-bar="admin">' + t.back + '</button>';
    }
    function showBar() {
      if (viewStored() === "admin" || bar) return;
      bar = document.createElement("div"); bar.className = "cb-view-bar"; bar.setAttribute("role", "status");
      var mh = document.querySelector(".masthead");
      if (mh && mh.parentNode) mh.parentNode.insertBefore(bar, mh.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
      bar.addEventListener("click", function (e) { var b = e.target.closest("[data-bar]"); if (b) window.CBView.set(b.getAttribute("data-bar")); });
      paintBar();
    }
    listeners.push(label);
    // The pages switch language by changing <html lang>; follow along.
    new MutationObserver(label).observe(root, { attributes: true, attributeFilter: ["lang"] });
    label();

    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) {
        signedIn = !!(j && j.user);
        if (j && j.user && j.user.isAdmin) { wrap.querySelector("#cb-view").hidden = false; showBar(); }
        label();
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { apply(); buildMenu(); });
  else { apply(); buildMenu(); }
})();
