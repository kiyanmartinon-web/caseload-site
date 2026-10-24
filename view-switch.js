/* Casebound — Client / Lawyer switch, shown to everyone in the top bar next to the logo.
   Client side: Can I…?, Find a lawyer (Pro), Risk check (Pro).
   Lawyer side: Case building (the research tool), Cases & clients (Pro + verified lawyers).
   The shared menu (shell.js) shows the links of the chosen side.

   Loaded in <head> with data-page="client" (Can I…?, risk check), "lawyer" (research tool,
   case board) or "info" (homepage, plans, account, sign-in, legal pages: they belong to both).
   Picking a side always opens that side's first page: Client → Can I…?, Lawyer → Case building.
   On a client or lawyer page the switch shows that page's side.
   The choice is kept in this browser (casebound:view). Lawyer accounts treat the case board as
   home side: on client pages they are sent to Case building unless they chose "Client". The role is cached
   (casebound:role) so that redirect happens before the page paints. */
(function () {
  var ROLE_KEY = "casebound:role", VIEW_KEY = "casebound:view";
  var me = document.currentScript;
  var page = (me && me.getAttribute("data-page")) || "info";
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }

  var HOME = { client: "/can-i.html", lawyer: "/research.html" };
  function side() {
    if (page === "client" || page === "lawyer") return page;
    var v = get(VIEW_KEY);
    if (v === "client" || v === "lawyer") return v;
    return get(ROLE_KEY) === "lawyer" ? "lawyer" : "client";
  }
  function choose(v) {
    set(VIEW_KEY, v);
    if (v !== page) location.href = HOME[v];
  }
  window.CaseboundView = {
    side: side,
    toClient: function () { set(VIEW_KEY, "client"); location.href = HOME.client; },
    toLawyer: function () { set(VIEW_KEY, "lawyer"); location.href = "/lawyers.html"; }
  };

  // Fast path: a lawyer who hasn't chosen the client side goes straight to Case building.
  if (page === "client" && get(ROLE_KEY) === "lawyer" && get(VIEW_KEY) !== "client") {
    location.replace(HOME.lawyer);
    return;
  }

  var CSS =
    ".cb-viewsw{display:inline-flex;gap:2px;background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius,8px);padding:3px;flex:none}" +
    ".cb-viewsw button{font-family:var(--sans);font-size:12.5px;font-weight:650;border:none;background:none;color:var(--ink-soft);padding:6px 12px;border-radius:calc(var(--radius,8px) - 3px);cursor:pointer;white-space:nowrap}" +
    ".cb-viewsw button:not([aria-pressed=true]):hover{color:var(--ink);background:var(--paper-2)}" +
    ".cb-viewsw button[aria-pressed=true]{background:var(--ink);color:var(--paper-2)}" +
    "html[data-theme=dark] .cb-viewsw button[aria-pressed=true]{color:var(--paper)}" +
    ".wordmark+.cb-viewsw{margin-inline-start:6px}" +
    "@media(max-width:760px){.masthead-in .cb-viewsw{order:0}.cb-viewsw button{padding:5px 10px;font-size:12px}}";

  var TXT = {
    en: { aria: "Client or lawyer", client: "Client", lawyer: "Lawyer" },
    it: { aria: "Cliente o avvocato", client: "Cliente", lawyer: "Avvocato" },
    es: { aria: "Cliente o abogado", client: "Cliente", lawyer: "Abogado" },
    fr: { aria: "Client ou avocat", client: "Client", lawyer: "Avocat" },
    de: { aria: "Mandant oder Anwalt", client: "Mandant", lawyer: "Anwalt" },
    pt: { aria: "Cliente ou advogado", client: "Cliente", lawyer: "Advogado" },
    pl: { aria: "Klient czy prawnik", client: "Klient", lawyer: "Prawnik" },
    ar: { aria: "عميل أم محامٍ", client: "عميل", lawyer: "محامٍ" }
  };

  var box = null;
  function render() {
    if (!box) return;
    var I = window.CB_I18N, t = (I && I.pick(TXT)) || TXT.en, s = side();
    box.setAttribute("aria-label", t.aria);
    box.innerHTML =
      '<button type="button" data-v="client" aria-pressed="' + (s === "client") + '">' + t.client + '</button>' +
      '<button type="button" data-v="lawyer" aria-pressed="' + (s === "lawyer") + '">' + t.lawyer + '</button>';
  }
  function mount() {
    if (document.querySelector(".cb-viewsw")) return;
    var head = document.querySelector(".masthead-in");
    if (!head) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    box = document.createElement("div");
    box.className = "cb-viewsw"; box.setAttribute("role", "group");
    render();
    if (window.CB_I18N) window.CB_I18N.onChange(render);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var v = b.getAttribute("data-v");
      if (v !== page) choose(v);
    });
    // right after the logo (and its "for lawyers" label)
    var wm = head.querySelector(".wordmark");
    head.insertBefore(box, wm ? wm.nextSibling : head.firstChild);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

  function apply(role) {
    set(ROLE_KEY, role === "lawyer" ? "lawyer" : "");
    if (role !== "lawyer") return;
    if (page === "lawyer") set(VIEW_KEY, "lawyer");
    if (page === "client" && get(VIEW_KEY) !== "client") { location.replace(HOME.lawyer); return; }
    if (page === "info") { render(); document.dispatchEvent(new CustomEvent("cb:side", { detail: side() })); }
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) { apply(j && j.user && j.user.role); })
    .catch(function () {});
})();
