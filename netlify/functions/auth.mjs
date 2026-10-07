// /api/auth/register  POST {email, password, name, acceptTerms, adult, lang, role, lawyer}
//                      role: "client" (default) or "lawyer"; lawyer: {bar, barNumber, city, areas[], bio}
// /api/auth/login     POST {email, password}
// /api/auth/logout    POST
// /api/auth/me        GET   → {user, subscription} or {user:null}
// /api/auth/delete    POST {password}
// /api/auth/update    POST {name, lang, role, lawyer}    profile details (lawyer details re-verified if bar details change)
// /api/auth/email     POST {password, email}             change sign-in email
// /api/auth/password  POST {password, newPassword}       change password (signs out other devices)
// /api/auth/logout-all POST {}                           sign out on every device
// /api/auth/export    GET   → JSON download of everything stored about the account
// /api/auth/forgot    POST {email, lang}                 email a 6-digit code (same answer whether or not the account exists)
// /api/auth/reset     POST {email, code, password}       set a new password with the code; signs in, signs out other devices
import {
  normEmail, validEmail, passwordProblem, findUserByEmail, createUser, verifyPassword,
  isLocked, recordFailure, recordSuccess, createSession, sessionCookie, currentUser,
  endSession, sameOrigin, publicUser, deleteUser, saveUser, changeEmail, changePassword,
  revokeSessions, cleanLawyer,
} from "../lib/auth.mjs";
import { allCases, deleteCase, saveCase } from "../lib/matches.mjs";
import { json, isConfigured, stripe } from "../lib/stripe.mjs";
import { subscriptionFor, tierOf } from "../lib/subscription.mjs";
import { issueCode, checkCode, useCode } from "../lib/reset.mjs";
import { mailConfigured, sendMail } from "../lib/mail.mjs";
import { LANGS, normLang } from "../lib/plans.mjs";

const CODE_EMAIL = {
  en: { subject: (c) => `Your Casebound code: ${c}`, intro: "Your code to reset your Casebound password is:",
        works: (m) => `It works for ${m} minutes. Enter it on the sign-in page to choose a new password.`,
        ignore: "If you didn't ask for this, ignore this email: your password stays the same." },
  it: { subject: (c) => `Il tuo codice Casebound: ${c}`, intro: "Il tuo codice per reimpostare la password di Casebound è:",
        works: (m) => `Vale ${m} minuti. Inseriscilo nella pagina di accesso per scegliere una nuova password.`,
        ignore: "Se non l'hai richiesto tu, ignora questa email: la tua password non cambia." },
  es: { subject: (c) => `Tu código de Casebound: ${c}`, intro: "Tu código para restablecer la contraseña de Casebound es:",
        works: (m) => `Es válido durante ${m} minutos. Introdúcelo en la página de inicio de sesión para elegir una nueva contraseña.`,
        ignore: "Si no lo has solicitado, ignora este correo: tu contraseña no cambia." },
  fr: { subject: (c) => `Votre code Casebound : ${c}`, intro: "Votre code pour réinitialiser votre mot de passe Casebound est :",
        works: (m) => `Il est valable ${m} minutes. Saisissez-le sur la page de connexion pour choisir un nouveau mot de passe.`,
        ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé." },
  de: { subject: (c) => `Dein Casebound-Code: ${c}`, intro: "Dein Code zum Zurücksetzen deines Casebound-Passworts lautet:",
        works: (m) => `Er gilt ${m} Minuten. Gib ihn auf der Anmeldeseite ein, um ein neues Passwort festzulegen.`,
        ignore: "Wenn du das nicht angefordert hast, ignoriere diese E-Mail: Dein Passwort bleibt unverändert." },
  pt: { subject: (c) => `O seu código Casebound: ${c}`, intro: "O seu código para redefinir a palavra-passe do Casebound é:",
        works: (m) => `É válido durante ${m} minutos. Introduza-o na página de início de sessão para escolher uma nova palavra-passe.`,
        ignore: "Se não fez este pedido, ignore este e-mail: a sua palavra-passe não muda." },
  pl: { subject: (c) => `Twój kod Casebound: ${c}`, intro: "Twój kod do zresetowania hasła w Casebound to:",
        works: (m) => `Kod jest ważny przez ${m} min. Wpisz go na stronie logowania, aby ustawić nowe hasło.`,
        ignore: "Jeśli to nie ty o to prosiłeś, zignoruj tę wiadomość: twoje hasło się nie zmieni." },
  ar: { subject: (c) => `رمز Casebound الخاص بك: ${c}`, intro: "رمز إعادة تعيين كلمة مرور Casebound الخاصة بك هو:",
        works: (m) => `الرمز صالح لمدة ${m} دقيقة. أدخله في صفحة تسجيل الدخول لاختيار كلمة مرور جديدة.`,
        ignore: "إذا لم تطلب ذلك، فتجاهل هذه الرسالة: ستبقى كلمة مرورك كما هي." },
};

function codeEmail(code, minutes, lang) {
  const l = normLang(lang);
  const t = CODE_EMAIL[l];
  const subject = t.subject(code);
  const lines = [t.intro, ``, `    ${code}`, ``, t.works(minutes), ``, t.ignore, ``, `Casebound — case-bound.com`];
  const dir = l === "ar" ? ` dir="rtl"` : "";
  const html = `<div${dir} style="font-family:Arial,sans-serif;font-size:15px;color:#1b2333;line-height:1.5;max-width:480px">` +
    `<p>${lines[0]}</p><p dir="ltr" style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>` +
    `<p>${lines[4]}</p><p style="color:#5b6475;font-size:13px">${lines[6]}</p><p style="color:#5b6475;font-size:13px">Casebound — case-bound.com</p></div>`;
  return { subject, text: lines.join("\n"), html };
}

const ok = (body, cookie) => json(body, 200, cookie ? { "Set-Cookie": cookie } : {});
const bad = (msg, status = 400) => json({ error: msg }, status);

async function body(req) {
  try { return await req.json(); } catch { return null; }
}

export default async (req, context) => {
  const action = (context && context.params && context.params.action) || new URL(req.url).pathname.split("/").pop();

  if (action === "me") {
    if (req.method !== "GET") return bad("Method not allowed", 405);
    const user = await currentUser(req);
    if (!user) return ok({ user: null });
    const subscription = await subscriptionFor(user);
    const tier = tierOf(user, subscription);
    return ok({ user: publicUser(user), subscription, tier });
  }

  if (action === "export") {
    if (req.method !== "GET") return bad("Method not allowed", 405);
    const user = await currentUser(req);
    if (!user) return bad("Please sign in again.", 401);
    const subscription = await subscriptionFor(user);
    const data = {
      exportedAt: new Date().toISOString(),
      service: "Casebound (case-bound.com)",
      controller: "Kiyan Martinon — admin@case-bound.com",
      account: {
        id: user.id, email: user.email, name: user.name, language: user.lang,
        createdAt: user.createdAt, lastLoginAt: user.lastLoginAt || null,
        passwordChangedAt: user.passwordChangedAt || null,
        termsAcceptedAt: user.termsAcceptedAt, termsVersion: user.termsVersion,
        stripeCustomerLinked: !!user.stripeCustomer,
        profileType: user.role === "lawyer" ? "lawyer" : "client",
        lawyerProfile: user.role === "lawyer" ? user.lawyer : null,
      },
      subscription,
      casesSentToLawyers: (await allCases()).filter((c) => c.clientId === user.id).map(({ clientId, ...c }) => c),
      note: "Your password is stored only as a one-way hash and is not included. Cases you sent to lawyers are included above. Other case facts and saved cases are kept in your browser, not on our servers; the account page adds the ones in this browser to the download.",
    };
    return ok(data);
  }

  if (req.method !== "POST") return bad("Method not allowed", 405);
  if (!sameOrigin(req)) return bad("Request blocked.", 403);

  if (action === "logout") {
    await endSession(req);
    return ok({ ok: true }, sessionCookie(req, ""));
  }

  const b = await body(req);
  if (!b) return bad("Invalid request.");

  if (action === "register") {
    const email = normEmail(b.email);
    if (!validEmail(email)) return bad("Enter a valid email address.");
    const pw = passwordProblem(b.password);
    if (pw) return bad(pw);
    if (b.acceptTerms !== true) return bad("Please accept the Terms of use.");
    if (b.adult !== true) return bad("You must be at least 18 to create an account.");
    if (await findUserByEmail(email)) return bad("An account with this email already exists. Sign in instead.", 409);
    const role = b.role === "lawyer" ? "lawyer" : "client";
    let lawyer = null;
    if (role === "lawyer") {
      if (!String(b.name || "").trim()) return bad("Lawyers need to give their full name, as it appears on the register.");
      const r = cleanLawyer(b.lawyer, null);
      if (r.error) return bad(r.error);
      lawyer = r.lawyer;
    }
    const user = await createUser({ email, password: b.password, name: b.name, lang: b.lang, role, lawyer });
    const s = await createSession(user.id);
    return ok({ user: publicUser(user) }, sessionCookie(req, s.token, s.exp));
  }

  if (action === "login") {
    const email = normEmail(b.email);
    const generic = "Wrong email or password.";
    if (!validEmail(email) || typeof b.password !== "string") return bad(generic, 401);
    const user = await findUserByEmail(email);
    if (!user) { await verifyPassword(b.password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"); return bad(generic, 401); }
    if (isLocked(user)) return bad("Too many attempts. Try again in 15 minutes.", 429);
    if (!(await verifyPassword(b.password, user.passwordHash))) { await recordFailure(user); return bad(generic, 401); }
    await recordSuccess(user);
    const s = await createSession(user.id);
    return ok({ user: publicUser(user) }, sessionCookie(req, s.token, s.exp));
  }

  if (action === "forgot") {
    const email = normEmail(b.email);
    if (!validEmail(email)) return bad("Enter a valid email address.");
    if (!mailConfigured()) return bad("Password reset by email isn't switched on yet. Email admin@case-bound.com.", 503);
    const user = await findUserByEmail(email);
    // Same answer whether or not there is an account, so nobody can test which emails are registered.
    if (!user) return ok({ ok: true });
    const r = await issueCode(email);
    if (r.code) {
      try {
        await sendMail({ to: email, ...codeEmail(r.code, r.minutes, LANGS.includes(b.lang) ? b.lang : user.lang) });
      } catch (err) {
        console.error("reset email failed", err && err.message);
        return bad("We couldn't send the email just now. Try again in a few minutes.", 502);
      }
    }
    return ok({ ok: true });
  }

  if (action === "reset") {
    const email = normEmail(b.email);
    const wrong = "That code is wrong. Check the email and try again.";
    if (!validEmail(email) || !/^\s*\d{3}\s?\d{3}\s*$/.test(String(b.code || ""))) return bad(wrong);
    const pw = passwordProblem(b.password);
    if (pw) return bad(pw);
    const user = await findUserByEmail(email);
    if (!user) return bad("That code has expired. Ask for a new one.");
    const res = await checkCode(email, b.code);
    if (res === "wrong") return bad(wrong);
    if (res === "expired") return bad("That code has expired. Ask for a new one.");
    if (res === "locked") return bad("Too many wrong codes. Ask for a new one.", 429);
    await useCode(email);
    user.failedLogins = 0; user.lockedUntil = 0;
    user.emailVerifiedAt = new Date().toISOString();   // they proved they read this inbox
    await changePassword(user, b.password);             // saves, and signs out every other device
    await recordSuccess(user);
    const s = await createSession(user.id);
    return ok({ user: publicUser(user) }, sessionCookie(req, s.token, s.exp));
  }

  if (["update", "email", "password", "logout-all"].includes(action)) {
    const user = await currentUser(req);
    if (!user) return bad("Please sign in again.", 401);

    if (action === "update") {
      if (typeof b.name === "string") user.name = b.name.trim().slice(0, 100);
      if (typeof b.lang === "string" && LANGS.includes(b.lang)) user.lang = b.lang;
      const role = b.role === "lawyer" || b.role === "client" ? b.role : user.role || "client";
      if (role === "lawyer" && (b.lawyer || user.role !== "lawyer")) {
        if (!user.name) return bad("Lawyers need to give their full name, as it appears on the register.");
        const r = cleanLawyer(b.lawyer || user.lawyer, user.role === "lawyer" ? user.lawyer : null);
        if (r.error) return bad(r.error);
        user.lawyer = r.lawyer;
      }
      user.role = role;
      await saveUser(user);
      return ok({ user: publicUser(user) });
    }

    if (action === "logout-all") {
      await revokeSessions(user);
      return ok({ ok: true }, sessionCookie(req, ""));
    }

    // Email and password changes need the current password.
    if (isLocked(user)) return bad("Too many attempts. Try again in 15 minutes.", 429);
    if (!(await verifyPassword(String(b.password || ""), user.passwordHash))) {
      await recordFailure(user);
      return bad("Wrong password.", 401);
    }

    if (action === "email") {
      const email = normEmail(b.email);
      if (!validEmail(email)) return bad("Enter a valid email address.");
      if (email === user.email) return bad("That is already your email address.");
      if (await findUserByEmail(email)) return bad("An account with this email already exists.", 409);
      await changeEmail(user, email);
      // Keep Stripe receipts going to the new address (best effort; needs Customers write).
      if (user.stripeCustomer && isConfigured()) {
        try { await stripe("POST", `customers/${user.stripeCustomer}`, { email }); }
        catch (e) { console.error("[auth] stripe email update failed", e && e.message); }
      }
      return ok({ user: publicUser(user) });
    }

    if (action === "password") {
      const pw = passwordProblem(b.newPassword);
      if (pw) return bad(pw);
      if (b.newPassword === b.password) return bad("Choose a password different from the current one.");
      await changePassword(user, b.newPassword);
      const s = await createSession(user.id);   // stay signed in here; every other device is signed out
      return ok({ user: publicUser(user) }, sessionCookie(req, s.token, s.exp));
    }
  }

  if (action === "delete") {
    const user = await currentUser(req);
    if (!user) return bad("Please sign in again.", 401);
    if (!(await verifyPassword(String(b.password || ""), user.passwordHash))) return bad("Wrong password.", 401);
    const sub = await subscriptionFor(user);
    if (sub && ["active", "trialing", "past_due", "unpaid"].includes(sub.status) && !sub.cancelAtPeriodEnd) {
      return bad("Cancel your subscription first (Manage subscription), then delete the account.", 409);
    }
    // Remove the cases this person sent to lawyers, and their reviews as a lawyer.
    for (const c of await allCases()) {
      if (c.clientId === user.id) await deleteCase(c.id);
      else if (c.reviews && c.reviews[user.id]) { delete c.reviews[user.id]; await saveCase(c); }
    }
    await endSession(req);
    await deleteUser(user);
    return ok({ ok: true }, sessionCookie(req, ""));
  }

  return bad("Not found", 404);
};

export const config = { path: "/api/auth/:action" };
