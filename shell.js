/* Casebound — shared page shell.
   Gives every standalone page the same top navigation, which follows the Client / Lawyer switch
   (view-switch.js). Client: Can I…?, Find a lawyer (Pro), Risk check (Pro). Lawyer: Case building,
   Cases & clients (Pro, verified lawyers). Both: Plans and Sign in / Account. It marks the page
   you are on and keeps the footer at the bottom of the window
   on short pages. Load it after i18n.js and theme.js. The lawyer pages (Case building and the
   case board) use the same top bar as the client pages. Nothing here is sent anywhere except the usual
   /api/auth/me check, used only to label the account link. */
(function () {
  "use strict";

  var T = {
    en: { find: "Find a lawyer", build: "Case building", cases: "Cases & clients", saved: "Saved cases", research: "Research", cani: "Can I…?", risk: "Risk check", plans: "Plans", signIn: "Sign in", account: "Account", nav: "Main" },
    it: { find: "Trova un avvocato", build: "Costruzione del caso", cases: "Casi e clienti", saved: "Casi salvati", research: "Ricerca", cani: "Posso…?", risk: "Verifica rischio", plans: "Piani", signIn: "Accedi", account: "Account", nav: "Principale" },
    es: { find: "Encontrar abogado", build: "Preparación del caso", cases: "Casos y clientes", saved: "Casos guardados", research: "Investigación", cani: "¿Puedo…?", risk: "Evaluación de riesgo", plans: "Planes", signIn: "Iniciar sesión", account: "Cuenta", nav: "Principal" },
    fr: { find: "Trouver un avocat", build: "Construction du dossier", cases: "Dossiers et clients", saved: "Dossiers enregistrés", research: "Recherche", cani: "Puis-je… ?", risk: "Évaluation du risque", plans: "Offres", signIn: "Se connecter", account: "Compte", nav: "Principal" },
    de: { find: "Anwalt finden", build: "Fallaufbau", cases: "Fälle & Mandanten", saved: "Gespeicherte Fälle", research: "Recherche", cani: "Darf ich…?", risk: "Risikoprüfung", plans: "Tarife", signIn: "Anmelden", account: "Konto", nav: "Hauptmenü" },
    pt: { find: "Encontrar advogado", build: "Construção do caso", cases: "Casos e clientes", saved: "Casos guardados", research: "Pesquisa", cani: "Posso…?", risk: "Avaliação de risco", plans: "Planos", signIn: "Entrar", account: "Conta", nav: "Principal" },
    pl: { find: "Znajdź prawnika", build: "Budowanie sprawy", cases: "Sprawy i klienci", saved: "Zapisane sprawy", research: "Wyszukiwanie", cani: "Czy mogę…?", risk: "Ocena ryzyka", plans: "Plany", signIn: "Zaloguj się", account: "Konto", nav: "Główne" },
    ar: { find: "ابحث عن محامٍ", build: "بناء القضية", cases: "القضايا والعملاء", saved: "القضايا المحفوظة", research: "البحث", cani: "هل يمكنني…؟", risk: "تقييم المخاطر", plans: "الخطط", signIn: "تسجيل الدخول", account: "الحساب", nav: "الرئيسية" }
  };
  var I = window.CB_I18N || null;
  function t() { var l = I ? I.get() : "en"; return T[l] || T.en; }

  var path = location.pathname.replace(/\/index\.html$/, "/");

  var CSS = [
    /* footer stays at the bottom of the window on short pages */
    "body{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column}",
    "body>header,body>main,body>footer,body>section,body>div:not([hidden]){width:100%}",
    "body>footer{margin-top:auto}",
    /* navigation */
    ".cb-nav{margin-inline-start:auto;display:flex;align-items:center;gap:4px;font-family:var(--sans,system-ui,sans-serif);font-size:13px;font-weight:600}",
    ".cb-nav a{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border-radius:5px;text-decoration:none;color:var(--ink-soft);white-space:nowrap}",
    ".cb-nav a:hover{color:var(--oxblood);background:var(--oxblood-wash)}",
    ".cb-nav a[aria-current=page]{color:var(--ink);box-shadow:inset 0 -2px 0 var(--oxblood);border-radius:0}",
    ".cb-nav a[aria-current=page]:hover{background:none}",
    ".cb-nav .cb-pro{font-size:9px;font-weight:700;letter-spacing:.06em;padding:1px 4px;border-radius:3px;background:var(--oxblood);color:var(--paper-2)}",
    ".cb-nav a.cb-acct{margin-inline-start:8px;padding:7px 14px;border-radius:var(--radius,8px);background:var(--ink);color:var(--paper-2)}",
    ".cb-nav a.cb-acct:hover{background:var(--oxblood);color:#fff}",
    ".cb-nav a.cb-acct[aria-current=page]{box-shadow:none;border-radius:var(--radius,8px)}",
    ".masthead-in .cb-nav~.cb-lang{margin-inline-start:4px}",
    /* the same header width on every page, so the bar never runs out of room */
    ".masthead-in{max-width:1180px!important}",
    "@media(max-width:760px){",
    "  .masthead-in{flex-wrap:wrap!important;height:auto!important;row-gap:0!important;column-gap:8px!important;padding-top:8px!important;padding-left:16px!important;padding-right:16px!important}",
    "  .masthead-in .wordmark{order:0}.masthead-in .cb-lang{order:1;margin-inline-start:auto!important}.masthead-in .cb-set{order:2}",
    "  .cb-nav{order:3;width:100%;margin:6px 0 0;gap:0;overflow-x:auto;scrollbar-width:none;border-top:1px solid var(--rule-soft)}",
    "  .cb-nav::-webkit-scrollbar{display:none}",
    "  .cb-nav{font-size:12.5px}.cb-nav a{padding:10px 7px}.cb-nav .cb-pro{display:none}",
    /* language menu shrinks to its globe icon, as in the research app */
    "  html .masthead-in .cb-lang select{width:34px;max-width:34px;min-width:0;padding:6px 0;color:transparent}",
    "  html .masthead-in .cb-lang select option{color:var(--ink)}",
    "  .masthead-in .cb-lang::after{display:none}",
    "  .masthead-in .cb-lang svg{inset-inline-start:9px}",
    "  .masthead-in .cb-set-btn span,.masthead-in .cb-set-lbl{display:none}",
    "  .cb-nav a.cb-acct{margin-inline-start:auto;border:0;background:none;color:var(--oxblood)}",
    "}"
  ].join("");

  function build() {
    var head = document.querySelector(".masthead-in");
    if (!head || head.querySelector(".cb-nav")) return;
    if (!document.getElementById("cb-shell-css")) {
      var s = document.createElement("style"); s.id = "cb-shell-css"; s.textContent = CSS;
      document.head.appendChild(s);
    }

    // Reuse the page's own account link if it has one: the page's script keeps its label up to date.
    var acct = document.getElementById("top-account");
    var old = head.querySelector(".top-links");
    if (old) old.remove();

    var nav = document.createElement("nav");
    nav.className = "cb-nav";
    var SIDES = {
      client: [["cani", "/can-i.html", /\/can-i\.html$/], ["find", "/risk-check.html#connect", /^$/, 1],
               ["risk", "/risk-check.html", /\/risk-check\.html$/, 1], ["plans", "/pricing.html", /\/pricing\.html$/]],
      lawyer: [["build", "/research.html", /\/research\.html$/], ["cases", "/lawyers.html", /\/lawyers\.html$/, 1],
               ["plans", "/pricing.html", /\/pricing\.html$/]]
    };
    var V = window.CaseboundView;
    function currentSide() { return V && V.side ? V.side() : "client"; }
    function links() {
      nav.querySelectorAll("[data-cb-nav]").forEach(function (a) { a.remove(); });
      SIDES[currentSide()].forEach(function (l) {
        var a = document.createElement("a");
        a.href = l[1]; a.setAttribute("data-cb-nav", l[0]);
        if (l[3]) a.setAttribute("data-pro", "");
        if (l[2].test(path)) a.setAttribute("aria-current", "page");
        nav.insertBefore(a, acct);
      });
    }

    var own = !!acct;
    if (!acct) { acct = document.createElement("a"); acct.id = "top-account"; acct.href = "/account.html"; }
    acct.className = "cb-acct";
    if (/\/(account|login)\.html$/.test(path)) acct.setAttribute("aria-current", "page");
    nav.appendChild(acct);
    links();

    var wm = head.querySelector(".cb-viewsw") || head.querySelector(".wordmark");
    if (wm && wm.nextSibling) head.insertBefore(nav, wm.nextSibling); else head.appendChild(nav);

    var signedIn = null;
    function label() {
      var tt = t();
      nav.setAttribute("aria-label", tt.nav);
      nav.querySelectorAll("[data-cb-nav]").forEach(function (a) {
        var k = a.getAttribute("data-cb-nav");
        a.textContent = tt[k];
        if (a.hasAttribute("data-pro")) { var p = document.createElement("span"); p.className = "cb-pro"; p.textContent = "PRO"; a.appendChild(p); }
      });
      if (!own) acct.textContent = signedIn ? tt.account : tt.signIn;
    }
    label();
    if (I && I.onChange) I.onChange(label);
    // the Client / Lawyer switch changed side on this page: swap the links
    document.addEventListener("cb:side", function () { links(); label(); });

    if (!own) {
      fetch("/api/auth/me", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { signedIn = !!(d && d.user); label(); })
        .catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
