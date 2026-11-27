// Optional shared-password gate. Off unless APP_PASSWORD is set.
import { createHmac, createHash, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import { useSsoStore, ssoForEmail } from "./sso.js";
import { DEFAULT_WS, useWorkspaceStore, signupEnabled, getDbUser, putDbUser, getWorkspace, membersOf } from "./workspaces.js";
import { capture } from "./posthog.js";

const COOKIE = "encore_auth";
const MAX_AGE_S = 60 * 60 * 24 * 30;

// Server-side session revocation: each cookie carries a random session id; /api/logout
// records it as revoked in the store (system/ docs, which the data API can't read or write).
let store = null;
const revokedCache = new Set();
export function useAuthStore(s) { store = s; revokedCache.clear(); useWorkspaceStore(s); useSsoStore(s); }
const revokedPath = (sid) => "system/revoked-" + sid;
function isRevoked(sid) {
  if (revokedCache.has(sid)) return true;
  const hit = store?.get(revokedPath(sid));
  if (hit && hit.data.exp > Date.now()) { revokedCache.add(sid); return true; }
  return false;
}
function revoke(sid) {
  if (!/^[a-f0-9]{32}$/.test(sid)) return;
  revokedCache.add(sid);
  store?.set(revokedPath(sid), { exp: Date.now() + MAX_AGE_S * 1000 });
}

// Login rate limits: 10 failed tries per IP + email in 15 minutes, and 20 per email in an hour from any IP;
// past either, 429 until the window passes.
const LIMITS = [
  { fails: new Map(), windowMs: 15 * 60 * 1000, max: 10, key: (req, email) => `${req.ip || req.socket?.remoteAddress || "?"}|${email}` },
  { fails: new Map(), windowMs: 60 * 60 * 1000, max: 20, key: (req, email) => (email ? email : null) },
];
const emailOf = (req) => String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
/** Seconds until the caller may try again, or 0 when not limited. */
function limitedFor(req) {
  const email = emailOf(req); let wait = 0;
  for (const L of LIMITS) {
    const k = L.key(req, email); if (k == null) continue;
    const f = L.fails.get(k); if (!f) continue;
    if (Date.now() - f.first > L.windowMs) { L.fails.delete(k); continue; }
    if (f.n >= L.max) wait = Math.max(wait, Math.ceil((f.first + L.windowMs - Date.now()) / 1000));
  }
  return wait;
}
function noteFail(req) {
  const email = emailOf(req);
  for (const L of LIMITS) {
    const k = L.key(req, email); if (k == null) continue;
    const f = L.fails.get(k);
    if (!f || Date.now() - f.first > L.windowMs) L.fails.set(k, { n: 1, first: Date.now() }); else f.n++;
    if (L.fails.size > 10000) for (const [x, v] of L.fails) if (Date.now() - v.first > L.windowMs) L.fails.delete(x);
  }
}
function clearFails(req) { const email = emailOf(req); for (const L of LIMITS) { const k = L.key(req, email); if (k != null) L.fails.delete(k); } }
/** For tests. */
export function resetLoginLimits() { for (const L of LIMITS) L.fails.clear(); }

export function authEnabled() {
  return !!process.env.APP_PASSWORD || signupEnabled();
}

/**
 * Named team members, so approvals and the audit log record a real person.
 * ENCORE_USERS="Maya Chen|maya@acme.com|Event lead+Account execs;Sam Lee|sam@acme.com|Exec sponsor"
 * Each person signs in with their work email plus the team password (APP_PASSWORD), or with a
 * personal password when a 4th field holds its hash: "Name|email|roles|scrypt$salt$hash".
 */
export function users() {
  return String(process.env.ENCORE_USERS || "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [name, email, roles = "", pw = ""] = x.split("|").map((y) => y.trim());
    return { name, email: String(email || "").toLowerCase(), roles: roles.split("+").map((r) => r.trim()).filter(Boolean), pw };
  }).filter((u) => u.name && u.email);
}
/** A workspace's team: ENCORE_USERS for the default workspace, the accounts stored in the db for the others. */
export function teamOf(ws = DEFAULT_WS) {
  if (ws === DEFAULT_WS) return users().map((u) => ({ ...u, ws: DEFAULT_WS }));
  return store ? membersOf(ws) : [];
}
/** Role names that read like someone who signs off on a plan. Generic roles ("Team member", "AE") never do. */
export const APPROVER_LIKE = /\b(lead|sponsor|exec|executive|vp|svp|evp|head|director|owner|approver|chief|president|founder|gm|cmo|cfo|ceo|coo|cro|cto|cpo|finance|controller|budget|manager|revops|rev\s?ops|revenue\s+operations)\b/i;
const uniq = (list) => [...new Map(list.map((r) => [r.toLowerCase(), r])).values()];
const parseRoles = (v) => String(v || "").split(",").map((r) => r.trim()).filter(Boolean);
/**
 * Roles whose approval a plan needs.
 * Default workspace: ENCORE_APPROVER_ROLES if set, else every role on the ENCORE_USERS list.
 * Sign-up workspaces: the workspace's approverRoles, else ENCORE_APPROVER_ROLES, else the members' roles that read
 * like approvers and weren't filled in by default. Empty means "use the plan's own team leads" (requiredApprovers).
 */
export function approverRoles(ws = DEFAULT_WS) {
  if (ws === DEFAULT_WS) {
    const set = parseRoles(process.env.ENCORE_APPROVER_ROLES);
    return uniq(set.length ? set : teamOf(ws).flatMap((u) => u.roles || []));
  }
  const own = getWorkspace(ws)?.approverRoles || [], env = parseRoles(process.env.ENCORE_APPROVER_ROLES);
  if (own.length) return uniq(own);
  if (env.length) return uniq(env);
  return uniq(teamOf(ws).filter((u) => !u.defaultRole).flatMap((u) => u.roles || []).filter((r) => APPROVER_LIKE.test(r)));
}
/** Whether approver roles are explicitly configured for this workspace (then other roles can't approve). */
export const approverRolesConfigured = (ws = DEFAULT_WS) => !!parseRoles(process.env.ENCORE_APPROVER_ROLES).length || (ws !== DEFAULT_WS && !!getWorkspace(ws)?.approverRoles?.length);
export const hasPersonalPassword = (u) => /^scrypt\$[^$]+\$[a-f0-9]+$/.test(String(u?.pw || ""));
export const isApprover = (u) => { const A = approverRoles().map((r) => r.toLowerCase()); return !!u && u.roles.some((r) => A.includes(r.toLowerCase())); };
/** Reasons the server must not start with this team configuration (empty when it's fine). */
export function startupProblems() {
  if (!process.env.ENCORE_USERS) return [];
  const bad = users().filter((u) => isApprover(u) && !hasPersonalPassword(u));
  return bad.length ? [`These team members hold an approver role (${approverRoles().join(", ")}) but have no personal password, so anyone with the team password could approve as them: ${bad.map((u) => `${u.name} <${u.email}>`).join(", ")}. Add a 4th field with a hash from \`node server/hash-password.js 'their password'\`, or set ENCORE_APPROVER_ROLES to the roles that approve plans.`] : [];
}
/** An env team member (default workspace) or a db account, by email. */
const findUser = (email) => {
  const e = String(email || "").trim().toLowerCase();
  const env = users().find((u) => u.email === e);
  if (env) return { ...env, ws: DEFAULT_WS };
  const db = store && signupEnabled() ? getDbUser(e) : null;
  return db ? { name: db.name, email: db.email, roles: db.roles || [], pw: db.pw, ws: db.ws, owner: !!db.owner } : null;
};
export const emailTaken = (email) => !!users().find((u) => u.email === String(email || "").trim().toLowerCase()) || !!(store && getDbUser(String(email || "").trim().toLowerCase()));
/** "scrypt$salt$hash" for a personal password (see server/hash-password.js). */
export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `scrypt$${salt}$${scryptSync(String(password), salt, 32).toString("hex")}`;
}
function checkPersonal(u, password) {
  const [, salt, hash] = String(u.pw || "").split("$");
  if (!salt || !hash) return null;
  return same(scryptSync(String(password), salt, 32).toString("hex"), hash);
}
// Cookie value: "<email or *>.<workspace>.<session id>.<signature>". The signature covers all three, plus
// APP_PASSWORD, so changing the team password signs everyone out.
function sign(email, ws, sid) {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  const gen = (() => { try { return email && email !== "*" && store ? getDbUser(email)?.gen || 0 : 0; } catch { return 0; } })();
  return createHmac("sha256", secret).update("encore-user:" + email + ":" + ws + ":" + sid + ":" + process.env.APP_PASSWORD + (gen ? ":g" + gen : "")).digest("hex");
}
// Launch review: the cookie no longer carries the email in clear text. A session is "v2.<workspace>.<session id>.<sig>"
// and the server keeps who it belongs to (system/sess-<hash of the id>, which the data API can't read). The signature
// still covers the email, workspace and id, so a stolen store row alone isn't a session. Old cookies
// ("<email>.<ws>.<sid>.<sig>") keep working and are swapped for a v2 one on the next request (upgradeSession).
const sessPath = (sid) => "system/sess-" + createHash("sha256").update(String(sid)).digest("hex").slice(0, 40);
function makeCookie(email, ws = DEFAULT_WS, sid = randomBytes(16).toString("hex")) {
  if (!store) return `${email}.${ws}.${sid}.${sign(email, ws, sid)}`; // no store (a bare team server): the old form
  store.set(sessPath(sid), { email, ws, at: Date.now(), exp: Date.now() + MAX_AGE_S * 1000 });
  return `v2.${ws}.${sid}.${sign(email, ws, sid)}`;
}
/** { email, ws, sid, legacy } from a valid, unrevoked cookie, else null. email is "*" for the shared password. */
function session(req) {
  const parts = readCookie(req, COOKIE).split(".");
  if (parts.length < 4) return null;
  if (parts[0] === "v2" && parts.length === 4) { const [, ws, sid, sig] = parts;
    if (!/^[A-Za-z0-9]{1,40}$/.test(ws) || !/^[a-f0-9]{32}$/.test(sid) || isRevoked(sid)) return null;
    const rec = store?.get(sessPath(sid))?.data; if (!rec || rec.ws !== ws || (rec.exp && rec.exp < Date.now())) return null;
    return same(sig, sign(rec.email, ws, sid)) ? { email: rec.email, ws, sid } : null; }
  const sig = parts.pop(), sid = parts.pop(), ws = parts.pop(), email = parts.join(".");
  if (!email || !/^[A-Za-z0-9]{1,40}$/.test(ws) || !/^[a-f0-9]{32}$/.test(sid) || !same(sig, sign(email, ws, sid)) || isRevoked(sid)) return null;
  return { email, ws, sid, legacy: true };
}
/** Tests only: an old-style cookie value (email in clear text), to check the upgrade. */
export const legacyCookieForTest = (email, ws, sid = randomBytes(16).toString("hex")) => `${email}.${ws}.${sid}.${sign(email, ws, sid)}`;
/** Middleware: a valid old-style cookie (email in clear text) is replaced by a v2 one with the same session id. */
export function upgradeSession(req, res, next) {
  try { if (store && authEnabled() && /(?:^|;\s*)encore_auth=/.test(req.headers.cookie || "")) { const s = session(req);
      if (s?.legacy) { const secure = req.secure ? "; Secure" : ""; res.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeCookie(s.email, s.ws, s.sid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`); } } } catch {}
  next();
}
/** The signed-in team member (with .ws), or null (not signed in as a named person). */
export function currentUser(req) {
  if (!authEnabled()) return null;
  const s = session(req);
  if (!s || s.email === "*") return null;
  const u = findUser(s.email);
  return u && u.ws === s.ws ? u : null;
}
/** The workspace this request acts in: the signed-in person's, or the default one. */
export function sessionWorkspace(req) {
  if (!authEnabled()) return DEFAULT_WS;
  return currentUser(req)?.ws || DEFAULT_WS;
}
/** Set a fresh session cookie for a person (sign-up, join). */
export function startSession(req, res, email, ws) {
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeCookie(email, ws))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
  res.append("Set-Cookie", `encore_in=1; Path=/; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
}
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}
export function isAuthed(req) {
  if (!authEnabled()) return true;
  if (currentUser(req)) return true;
  // The shared team password only works when there's no named team list.
  return !users().length && !!process.env.APP_PASSWORD && session(req)?.email === "*";
}
export function loginHandler(req, res) {
  if (!authEnabled()) return res.json({ ok: true });
  const password = req.body?.password ?? "";
  const isForm = req.is("application/x-www-form-urlencoded");
  const wait = limitedFor(req);
  if (wait) {
    res.setHeader("Retry-After", String(wait));
    return isForm ? res.redirect(303, "/login?error=3") : res.status(429).json({ code: "rate_limited", message: "Too many tries. Take a breather and try again later." });
  }
  const deny = (err, message) => { noteFail(req); return isForm ? res.redirect(303, "/login?error=" + err) : res.status(401).json({ code: "not_granted", message }); };
  let value;
  const named = users().length || (signupEnabled() && String(req.body?.email || "").trim());
  if (named) {
    const u = findUser(req.body?.email);
    if (!u) return deny(2, "That email and password don't match.");
    // Enforced SSO: password sign-in is off for the domain, except for the owner who set SSO up (break-glass).
    const sso = u.ws !== DEFAULT_WS ? ssoForEmail(u.email) : null;
    if (sso && sso.enforce && sso.ws === u.ws && sso.configuredBy !== u.email) return isForm ? res.redirect(303, "/login?error=4") : res.status(401).json({ code: "sso_required", message: "Your company uses single sign-on. Sign in with SSO instead.", sso: "/sso/start?email=" + encodeURIComponent(u.email) });
    // A personal password, when set, is required; the shared team password then doesn't work for that person.
    // Accounts made by sign-up or invite always have one.
    const personal = checkPersonal(u, password);
    if (personal === false || (personal === null && (u.ws !== DEFAULT_WS || !process.env.APP_PASSWORD || !same(password, process.env.APP_PASSWORD)))) return deny(1, "That email and password don't match.");
    value = makeCookie(u.email, u.ws); capture("signed_in", { ws: u.ws, method: "password" }); // server/posthog.js, off unless configured
  } else if (!process.env.APP_PASSWORD || !same(password, process.env.APP_PASSWORD)) {
    return deny(1, "That email and password don't match.");
  } else value = makeCookie("*", DEFAULT_WS);
  clearFails(req);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
  res.append("Set-Cookie", `encore_in=1; Path=/; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
  const nx = String(req.body?.next || ""); const back = /^\/(?!\/)[^\s]*$/.test(nx) ? nx : "/";
  return isForm ? res.redirect(303, back) : res.json({ ok: true });
}
export function logoutHandler(req, res) {
  const s = authEnabled() ? session(req) : null;
  if (s) revoke(s.sid); // the cookie stops working on the server, even if a copy of it survives
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.append("Set-Cookie", "encore_in=; Path=/; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
}
// ---- password reset: a one-time link, good for an hour, stored only as a hash ----
const resetPath = (token) => "system/pwreset-" + createHash("sha256").update(String(token)).digest("hex");
/** A reset token for someone with their own password, or null (unknown email, SSO-only, or team password). */
export function startPasswordReset(email) {
  const u = store && getDbUser(String(email || "").trim().toLowerCase()); if (!u || !hasPersonalPassword(u)) return null;
  const token = randomBytes(24).toString("hex"); store.set(resetPath(token), { email: u.email, exp: Date.now() + 3600e3 }); return { token, user: u };
}
/** Sets the new password and signs out every existing session. Returns the person, or an error string. */
export function finishPasswordReset(token, password) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ""))) return "This link has expired. Get a new one below.";
  if (String(password || "").length < 10) return "Password needs 10+ characters.";
  const hit = store?.get(resetPath(token))?.data; if (!hit || hit.used || hit.exp < Date.now()) return "This link has expired. Get a new one below.";
  const u = getDbUser(hit.email); if (!u) return "This link has expired. Get a new one below.";
  putDbUser({ ...u, pw: hashPassword(password), gen: (u.gen || 0) + 1, pwChangedAt: Date.now() }); store.set(resetPath(token), { ...hit, used: Date.now() }); clearFailsFor(u.email);
  return getDbUser(u.email);
}
function clearFailsFor() { for (const L of LIMITS) L.fails.clear?.(); }
export function loginPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Pottery Lab</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="/playful.css">
<script>
  // Guest RSVP / survey links carry their target in the hash, which never reaches
  // the server. Send those visitors to the guest copy of the page instead.
  if (/^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-|signoff-|confnom)/.test(location.hash)) location.replace("/g" + location.search + location.hash); // keep ?utm_… for the RSVP
</script>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px "IBM Plex Sans",system-ui,sans-serif;background:#EFEBE2;color:#1B1D1C}
  form{background:#fff;padding:32px 24px;border-radius:24px;border:1.5px solid #CFC8B9;box-shadow:none;width:min(360px,calc(100vw - 32px));box-sizing:border-box}
  .brand{display:flex;align-items:center;gap:8px;font:600 20px "Fraunces",Georgia,serif;margin-bottom:18px}
  h1{margin:0 0 4px;font:600 24px "Fraunces",Georgia,serif}.sub{margin:0 0 18px;color:#444845;font-size:14px}
  label{display:block;font-size:14px;font-weight:600;color:#1B1D1C;margin-bottom:16px}
  input,button{width:100%;box-sizing:border-box;font:inherit;padding:11px 14px;border-radius:12px;min-height:48px}
  input{border:1.5px solid #1B1D1C;margin:8px 0 0;background:#fff;font-weight:400;font-size:16px}input:focus{outline:none;border-color:#1B1D1C;box-shadow:0 0 0 3px rgba(201,74,48,.22)}
  button{border:0;background:#29489A;color:#fff;font-weight:600;cursor:pointer;margin-top:8px;border-radius:999px;min-height:52px}button:hover{background:#29489A}button:disabled{opacity:.6;cursor:default}
  .err{color:#A93A3A;margin:0 0 12px;font-size:13px}.err:empty{display:none}p{margin:0 0 12px}
  a{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:2px;padding:0;text-align:center;color:#29489A;font-size:14px;text-decoration:none}
</style><link rel="stylesheet" href="/system.css"></head><body>
<form method="post" action="/api/login"><input type="hidden" name="next" id="nextIn"><script>try{const n=new URLSearchParams(location.search).get("next");if(n&&n.charAt(0)==="/"&&n.charAt(1)!=="/")document.getElementById("nextIn").value=n}catch(e){}</script>
  <div class="brand"><svg viewBox="0 0 48 48" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="1.5" width="45" height="45" rx="6"/><path d="M17 11h14M19 11v4l-6 6v9a7 7 0 0 0 7 7h8a7 7 0 0 0 7-7v-9l-6-6v-4"/><circle cx="20.5" cy="26" r="1.9" stroke="none" style="fill:var(--pl-accent,#29489A)"/><circle cx="27.5" cy="26" r="1.9" stroke="none" style="fill:var(--pl-accent,#29489A)"/></svg>pottery lab</div><h1>Sign in</h1><p style="margin:-6px 0 14px;color:#444845">Good to see you again.</p>
  <script>if (location.search.includes("error=sso")) document.write("<p>Single sign-on didn't work. Try again, or ask your admin.</p>"); else if (location.search.includes("error=4")) document.write("<p>Your company uses single sign-on. Sign in with SSO instead.</p>"); else if (location.search.includes("error=3")) document.write("<p>Too many tries. Take a breather and try again later.</p>"); else if (location.search.includes("error")) document.write("<p>That email and password don't match.</p>"); else if (location.search.includes("why=collab")) document.write("<p>Sign in to suggest a collab. Hosts only.</p>")</script>
  ${users().length || signupEnabled() ? `<label>Email<input type="email" name="email" autocomplete="email" ${users().length || !process.env.APP_PASSWORD ? "required" : ""}></label>` : ""}
  <label>${users().some((u) => u.pw) || signupEnabled() ? "Password" : "Team password"}<input type="password" name="password" autocomplete="current-password" autofocus required></label>
  <button type="submit">Sign in</button>
  ${users().length || signupEnabled() ? `<a class="alt" href="/forgot">Forgot your password?</a>` : ""}
  ${signupEnabled() ? `<a class="alt" href="/signup">New here? Start your page</a><a class="alt" href="/sso/start" style="font-size:13px;opacity:.8">Sign in with SSO</a>` : ""}
</form><script>try{const f=document.querySelector("form"),e=f&&f.querySelector("input[name=email]");if(e){const k="encore.loginEmail",v=sessionStorage.getItem(k);if(v&&!e.value)e.value=v;f.addEventListener("submit",()=>{try{sessionStorage.setItem(k,e.value)}catch(x){}});if(v){const p=f.querySelector("input[type=password]");if(p)setTimeout(()=>p.focus(),50)}}}catch(x){}</script><script src="/help.js" defer></script></body></html>`;
}
