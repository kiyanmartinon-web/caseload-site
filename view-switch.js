/* Casebound — Client / Lawyer switch, shown to everyone in the top bar next to the logo.
   Client side: Can I…?, Find a lawyer (Pro), Risk check (Pro).
   Lawyer side: Case building (the research tool), Cases & clients (Pro + verified lawyers).
   The shared menu (shell.js) shows the links of the chosen side.

   Loaded in <head> with data-page="client" (Can I…?, risk check), "lawyer" (research tool,
   case board), "home" (the homepage) or "info" (plans, account, sign-in, legal pages).
   On the homepage the switch swaps the opening in place (Can I…? or Case building), with no
   page load. Elsewhere picking a side opens that side's first page: Client → Can I…?,
   Lawyer → Case building. The dark thumb slides to the chosen side either way.
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
  var REDUCED = false; try { REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  function side() {
    if (page === "client" || page === "lawyer") return page;
    var v = get(VIEW_KEY);
    if (v === "client" || v === "lawyer") return v;
    return get(ROLE_KEY) === "lawyer" ? "lawyer" : "client";
  }
  function choose(v) {
    set(VIEW_KEY, v);
    if (page === "home") { render(); document.dispatchEvent(new CustomEvent("cb:side", { detail: v })); return; }
    if (v === page) return;
    render(v);   // slide the thumb and fade the colours first, then open the page
    mark(v);
    setTimeout(function () { location.href = HOME[v]; }, REDUCED ? 0 : 200);
  }
  function mark(v) { document.documentElement.setAttribute("data-side", v === "lawyer" ? "lawyer" : "client"); }
  mark(side());
  window.CaseboundView = {
    side: side,
    toClient: function () { set(VIEW_KEY, "client"); location.href = HOME.client; },
    toLawyer: function () { set(VIEW_KEY, "lawyer"); location.href = "/lawyers.html"; },
    mark: mark
  };

  // Fast path: a lawyer who hasn't chosen the client side goes straight to Case building.
  if (page === "client" && get(ROLE_KEY) === "lawyer" && get(VIEW_KEY) !== "client") {
    location.replace(HOME.lawyer);
    return;
  }

  var CSS =
    ".cb-viewsw{position:relative;isolation:isolate;display:inline-flex;gap:2px;background:var(--paper);border:1px solid var(--rule);border-radius:var(--radius,8px);padding:3px;flex:none}" +
    ".cb-viewsw button{font-family:var(--sans);font-size:12.5px;font-weight:650;border:none;background:none;color:var(--ink-soft);padding:6px 12px;border-radius:calc(var(--radius,8px) - 3px);cursor:pointer;white-space:nowrap}" +
    ".cb-viewsw button:not([aria-pressed=true]):hover{color:var(--ink);background:var(--paper-2)}" +
    ".cb-viewsw button{position:relative;z-index:1;transition:color .22s ease,background-color .15s ease}" +
    ".cb-viewsw button[aria-pressed=true]{background:var(--ink);color:var(--paper-2)}" +
    "html[data-theme=dark] .cb-viewsw button[aria-pressed=true]{color:var(--paper)}" +
    /* once the sliding thumb is placed it carries the dark background instead of the button */
    ".cb-viewsw .cb-thumb{position:absolute;z-index:0;top:3px;bottom:3px;left:0;width:0;border-radius:calc(var(--radius,8px) - 3px);background:var(--ink);opacity:0;pointer-events:none}" +
    ".cb-viewsw.has-thumb .cb-thumb{opacity:1}" +
    ".cb-viewsw.has-thumb button[aria-pressed=true]{background:none}" +
    ".cb-viewsw.anim .cb-thumb{transition:transform .26s cubic-bezier(.3,.7,.2,1),width .26s cubic-bezier(.3,.7,.2,1)}" +
    "@media(prefers-reduced-motion:reduce){.cb-viewsw.anim .cb-thumb,.cb-viewsw button{transition:none}}" +
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

  var box = null, thumb = null;
  function place() {
    if (!box || !thumb) return;
    var on = box.querySelector("button[aria-pressed=true]");
    if (!on || !on.offsetWidth) return;
    thumb.style.width = on.offsetWidth + "px";
    thumb.style.transform = "translateX(" + on.offsetLeft + "px)";
    box.classList.add("has-thumb");
  }
  function render(force) {
    if (!box) return;
    var I = window.CB_I18N, t = (I && I.pick(TXT)) || TXT.en, s = force || side();
    box.setAttribute("aria-label", t.aria);
    if (!box.querySelector("button")) {
      box.innerHTML = '<span class="cb-thumb" aria-hidden="true"></span>' +
        '<button type="button" data-v="client"></button><button type="button" data-v="lawyer"></button>';
      thumb = box.querySelector(".cb-thumb");
    }
    var bc = box.querySelector("[data-v=client]"), bl = box.querySelector("[data-v=lawyer]");
    bc.textContent = t.client; bl.textContent = t.lawyer;
    bc.setAttribute("aria-pressed", String(s === "client"));
    bl.setAttribute("aria-pressed", String(s === "lawyer"));
    place();
  }
  function mount() {
    if (document.querySelector(".cb-viewsw")) return;
    var head = document.querySelector(".masthead-in");
    if (!head) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    box = document.createElement("div");
    box.className = "cb-viewsw"; box.setAttribute("role", "group");
    render();
    if (window.CB_I18N) window.CB_I18N.onChange(function () { render(); });
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var v = b.getAttribute("data-v");
      box.classList.add("anim");
      if (page === "home" ? v !== side() : v !== page) choose(v);
    });
    // right after the logo (and its "for lawyers" label)
    var wm = head.querySelector(".wordmark");
    head.insertBefore(box, wm ? wm.nextSibling : head.firstChild);
    // place the thumb once fonts and the menu have settled, then let it animate
    place();
    requestAnimationFrame(place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    addEventListener("resize", place);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

  function apply(role) {
    set(ROLE_KEY, role === "lawyer" ? "lawyer" : "");
    if (role !== "lawyer") return;
    if (page === "lawyer") set(VIEW_KEY, "lawyer");
    if (page === "client" && get(VIEW_KEY) !== "client") { location.replace(HOME.lawyer); return; }
    if (page === "info") mark(side());
    if (page === "info" || page === "home") { render(); document.dispatchEvent(new CustomEvent("cb:side", { detail: side() })); }
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) { apply(j && j.user && j.user.role); })
    .catch(function () {});
})();
