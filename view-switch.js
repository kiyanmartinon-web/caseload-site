/* Casebound — lawyer / client view switch.
   Lawyer accounts see the case board (/lawyers.html) as their home. On the client
   pages (research tool, risk check) they are sent to the board, unless they chose
   "Client" in the switch. The switch sits in the top bar of those pages and the board.
   Loaded in <head> with data-page="client" or data-page="lawyer". The role is cached
   in this browser (local storage) so the redirect happens before the page paints. */
(function () {
  var ROLE_KEY = "casebound:role", VIEW_KEY = "casebound:view";
  var me = document.currentScript;
  var page = (me && me.getAttribute("data-page")) || "client";
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  window.CaseboundView = {
    toClient: function () { set(VIEW_KEY, "client"); location.href = "/"; },
    toLawyer: function () { set(VIEW_KEY, "lawyer"); location.href = "/lawyers.html"; }
  };

  // Fast path: a lawyer who hasn't chosen the client view goes straight to the board.
  if (page === "client" && get(ROLE_KEY) === "lawyer" && get(VIEW_KEY) !== "client") {
    location.replace("/lawyers.html");
    return;
  }

  var CSS =
    ".cb-viewsw{display:inline-flex;gap:2px;background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:3px;flex:none}" +
    ".cb-viewsw button{font-family:var(--sans);font-size:12.5px;font-weight:600;border:none;background:none;color:var(--ink-soft);padding:6px 12px;border-radius:4px;cursor:pointer;white-space:nowrap}" +
    ".cb-viewsw button[aria-pressed=true]{background:var(--ink);color:var(--paper-2)}" +
    "@media(max-width:1400px){.cb-viewsw .cb-long{display:none}}" +
    "@media(max-width:640px){.cb-viewsw{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 72px);z-index:90;box-shadow:0 4px 14px rgba(0,0,0,.18)}.cb-viewsw button{padding:8px 14px}}";

  var TXT = {
    en: { aria: "Switch view", client: "Client", clientL: ": research &amp; risk check", lawyer: "Lawyer", lawyerL: ": case board" },
    it: { aria: "Cambia vista", client: "Cliente", clientL: ": ricerca e verifica del rischio", lawyer: "Avvocato", lawyerL: ": bacheca casi" },
    es: { aria: "Cambiar de vista", client: "Cliente", clientL: ": investigación y evaluación de riesgo", lawyer: "Abogado", lawyerL: ": tablón de casos" },
    fr: { aria: "Changer de vue", client: "Client", clientL: " : recherche et évaluation du risque", lawyer: "Avocat", lawyerL: " : tableau des affaires" },
    de: { aria: "Ansicht wechseln", client: "Mandant", clientL: ": Recherche &amp; Risikocheck", lawyer: "Anwalt", lawyerL: ": Fallbörse" },
    pt: { aria: "Mudar de vista", client: "Cliente", clientL: ": pesquisa e avaliação de risco", lawyer: "Advogado", lawyerL: ": quadro de casos" },
    pl: { aria: "Przełącz widok", client: "Klient", clientL: ": wyszukiwanie i ocena ryzyka", lawyer: "Prawnik", lawyerL: ": tablica spraw" },
    ar: { aria: "تبديل العرض", client: "عميل", clientL: ": البحث وتقييم المخاطر", lawyer: "محامٍ", lawyerL: ": لوحة القضايا" }
  };

  function mount() {
    if (document.querySelector(".cb-viewsw")) return;
    var host = document.querySelector(".top-links");
    if (!host) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var box = document.createElement("div");
    box.className = "cb-viewsw"; box.setAttribute("role", "group");
    function label() {
      var I = window.CB_I18N, t = (I && I.pick(TXT)) || TXT.en;
      box.setAttribute("aria-label", t.aria);
      box.innerHTML =
        '<button type="button" data-v="client" aria-pressed="' + (page === "client") + '">' + t.client + '<span class="cb-long">' + t.clientL + '</span></button>' +
        '<button type="button" data-v="lawyer" aria-pressed="' + (page === "lawyer") + '">' + t.lawyer + '<span class="cb-long">' + t.lawyerL + '</span></button>';
    }
    label();
    if (window.CB_I18N) window.CB_I18N.onChange(label);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.getAttribute("data-v") === "client") { if (page !== "client") window.CaseboundView.toClient(); }
      else if (page !== "lawyer") window.CaseboundView.toLawyer();
    });
    host.insertBefore(box, host.firstChild);
  }

  function apply(role) {
    set(ROLE_KEY, role === "lawyer" ? "lawyer" : "");
    if (role !== "lawyer") { set(VIEW_KEY, ""); return; }
    if (page === "lawyer") set(VIEW_KEY, "lawyer");
    if (page === "client" && get(VIEW_KEY) !== "client") { location.replace("/lawyers.html"); return; }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) { apply(j && j.user && j.user.role); })
    .catch(function () {});
})();
