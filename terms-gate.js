/* Casebound — terms acceptance gate.
   Every visitor must accept the Terms of use (including the final disclaimer, section 11) before
   using the site. Acceptance is stored in this browser with the terms version; when the terms
   change, bump VERSION (and TERMS_VERSION in netlify/lib/auth.mjs) and everyone is asked again.
   On the Terms and Privacy pages the prompt is a bar at the bottom so the text stays readable;
   everywhere else it is a blocking dialog. Load it after i18n.js. Nothing is sent anywhere. */
(function () {
  "use strict";
  var VERSION = "2026-10-24";
  var KEY = "cb-terms-accepted";

  function accepted() {
    try { if (localStorage.getItem(KEY) === VERSION) return true; } catch (e) {}
    return document.cookie.split("; ").indexOf(KEY + "=" + VERSION) !== -1;
  }
  function remember() {
    try { localStorage.setItem(KEY, VERSION); } catch (e) {}
    document.cookie = KEY + "=" + VERSION + "; max-age=31536000; path=/; SameSite=Lax";
  }
  if (accepted()) return;

  var T = {
    en: { h: "Before you use Casebound", p: "Casebound is a research aid, not legal advice, and you use it entirely at your own risk. To continue you must accept the <a href=\"/terms.html\">Terms of use</a>, including the <a href=\"/terms.html#disclaimer\">final disclaimer</a> excluding our liability as far as the law allows, and confirm you are 18 or older.", ok: "I accept", no: "Leave", read: "Read the terms" },
    it: { h: "Prima di usare Casebound", p: "Casebound è un supporto alla ricerca, non consulenza legale, e lo usi interamente a tuo rischio. Per continuare devi accettare le <a href=\"/terms.html\">Condizioni d'uso</a>, compresa l'<a href=\"/terms.html#disclaimer-it\">esclusione finale di responsabilità</a> nei limiti consentiti dalla legge, e confermare di avere almeno 18 anni.", ok: "Accetto", no: "Esci", read: "Leggi le condizioni" },
    es: { h: "Antes de usar Casebound", p: "Casebound es una herramienta de investigación, no asesoramiento jurídico, y la usas enteramente bajo tu propio riesgo. Para continuar debes aceptar las <a href=\"/terms.html\">Condiciones de uso</a>, incluida la <a href=\"/terms.html#disclaimer-es\">exención final de responsabilidad</a> en la medida permitida por la ley, y confirmar que tienes al menos 18 años.", ok: "Acepto", no: "Salir", read: "Leer las condiciones" },
    fr: { h: "Avant d'utiliser Casebound", p: "Casebound est une aide à la recherche, pas un conseil juridique, et vous l'utilisez entièrement à vos propres risques. Pour continuer, vous devez accepter les <a href=\"/terms.html\">Conditions d'utilisation</a>, y compris la <a href=\"/terms.html#disclaimer-fr\">clause finale d'exonération</a> dans les limites permises par la loi, et confirmer avoir au moins 18 ans.", ok: "J'accepte", no: "Quitter", read: "Lire les conditions" },
    de: { h: "Bevor du Casebound nutzt", p: "Casebound ist eine Recherchehilfe, keine Rechtsberatung, und die Nutzung erfolgt vollständig auf eigenes Risiko. Um fortzufahren, musst du die <a href=\"/terms.html\">Nutzungsbedingungen</a> einschließlich des <a href=\"/terms.html#disclaimer-de\">abschließenden Haftungsausschlusses</a> im gesetzlich zulässigen Umfang akzeptieren und bestätigen, dass du mindestens 18 Jahre alt bist.", ok: "Ich akzeptiere", no: "Verlassen", read: "Bedingungen lesen" },
    pt: { h: "Antes de utilizar o Casebound", p: "O Casebound é um auxiliar de pesquisa, não aconselhamento jurídico, e utiliza-o inteiramente por sua conta e risco. Para continuar, tem de aceitar os <a href=\"/terms.html\">Termos de utilização</a>, incluindo a <a href=\"/terms.html#disclaimer-pt\">exclusão final de responsabilidade</a> na medida permitida por lei, e confirmar que tem pelo menos 18 anos.", ok: "Aceito", no: "Sair", read: "Ler os termos" },
    pl: { h: "Zanim skorzystasz z Casebound", p: "Casebound to narzędzie do badań, a nie porada prawna, i korzystasz z niego wyłącznie na własne ryzyko. Aby kontynuować, musisz zaakceptować <a href=\"/terms.html\">Warunki korzystania</a>, w tym <a href=\"/terms.html#disclaimer-pl\">końcowe wyłączenie odpowiedzialności</a> w zakresie dozwolonym przez prawo, i potwierdzić, że masz co najmniej 18 lat.", ok: "Akceptuję", no: "Wyjdź", read: "Przeczytaj warunki" },
    ar: { h: "قبل أن تستخدم Casebound", p: "Casebound أداة مساعدة في البحث وليس استشارة قانونية، وتستخدمه على مسؤوليتك الخاصة بالكامل. للمتابعة يجب أن توافق على <a href=\"/terms.html\">شروط الاستخدام</a>، بما فيها <a href=\"/terms.html#disclaimer-ar\">إخلاء المسؤولية النهائي</a> إلى الحد الذي يسمح به القانون، وأن تؤكد أن عمرك 18 عامًا على الأقل.", ok: "أوافق", no: "مغادرة", read: "اقرأ الشروط" }
  };
  var I = window.CB_I18N || null;
  function t() { return (I && T[I.get()]) || T.en; }

  var soft = /\/(terms|privacy)\.html$/.test(location.pathname);

  var CSS = [
    ".cbg-back{position:fixed;inset:0;z-index:2147483000;background:rgba(20,26,40,.62);display:flex;align-items:center;justify-content:center;padding:16px}",
    ".cbg-box{background:var(--paper-2,#fff);color:var(--ink,#1A2438);max-width:520px;width:100%;border-radius:10px;border-top:4px solid var(--oxblood,#6E1F2A);box-shadow:0 18px 50px rgba(0,0,0,.3);padding:24px 24px 20px;font-family:var(--sans,\"Archivo\",system-ui,sans-serif)}",
    ".cbg-box h2{font-family:var(--serif,Georgia,serif);font-size:22px;font-weight:600;margin:0 0 10px;border:0;padding:0}",
    ".cbg-box p{font-size:14.5px;line-height:1.55;margin:0 0 18px;color:var(--ink-soft,#5A6376)}",
    ".cbg-box a,.cbg-bar a{color:var(--verdigris,#29565A)}",
    ".cbg-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;align-items:center}",
    ".cbg-ok{font:inherit;font-size:14px;font-weight:700;border:0;border-radius:8px;padding:10px 18px;background:var(--oxblood,#6E1F2A);color:#fff;cursor:pointer}",
    ".cbg-ok:hover{filter:brightness(1.1)}",
    ".cbg-no{font:inherit;font-size:13.5px;font-weight:600;color:var(--ink-soft,#5A6376);text-decoration:none;padding:10px 8px}",
    ".cbg-bar{position:fixed;inset-inline:0;bottom:0;z-index:2147483000;background:var(--paper-2,#fff);border-top:3px solid var(--oxblood,#6E1F2A);box-shadow:0 -8px 24px rgba(0,0,0,.15);font-family:var(--sans,\"Archivo\",system-ui,sans-serif)}",
    ".cbg-bar .cbg-in{max-width:960px;margin:0 auto;padding:12px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}",
    ".cbg-bar p{flex:1 1 320px;margin:0;font-size:13.5px;line-height:1.5;color:var(--ink,#1A2438)}",
    "body.cbg-lock{overflow:hidden}",
    "body.cbg-pad{padding-bottom:140px}"
  ].join("");

  var root, others = [];

  function render() {
    var s = t();
    if (soft) {
      root.innerHTML = '<div class="cbg-in"><p role="status"><b>' + s.h + ".</b> " + s.p + '</p><button type="button" class="cbg-ok">' + s.ok + "</button></div>";
    } else {
      root.innerHTML = '<div class="cbg-box" role="dialog" aria-modal="true" aria-labelledby="cbg-h" aria-describedby="cbg-p"><h2 id="cbg-h">' + s.h + '</h2><p id="cbg-p">' + s.p +
        '</p><div class="cbg-row"><a class="cbg-no" href="https://www.google.com/">' + s.no + '</a><a class="cbg-no" href="/terms.html">' + s.read +
        '</a><button type="button" class="cbg-ok">' + s.ok + "</button></div></div>";
    }
    var b = root.querySelector(".cbg-ok");
    b.addEventListener("click", accept);
    if (!soft) b.focus();
  }

  function accept() {
    remember();
    root.remove();
    document.body.classList.remove("cbg-lock", "cbg-pad");
    others.forEach(function (el) { el.removeAttribute("inert"); el.removeAttribute("aria-hidden"); });
  }

  function show() {
    if (accepted() || document.getElementById("cbg-root")) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement("div");
    root.id = "cbg-root";
    root.className = soft ? "cbg-bar" : "cbg-back";
    if (!soft) {
      Array.prototype.forEach.call(document.body.children, function (el) {
        if (el.tagName === "SCRIPT") return;
        el.setAttribute("inert", ""); el.setAttribute("aria-hidden", "true"); others.push(el);
      });
      document.body.classList.add("cbg-lock");
    } else {
      document.body.classList.add("cbg-pad");
    }
    document.body.appendChild(root);
    render();
    if (I && I.onChange) I.onChange(function () { if (document.getElementById("cbg-root")) render(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
})();
