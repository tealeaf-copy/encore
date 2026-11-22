// Optional shared-password gate. Off unless APP_PASSWORD is set.
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import { DEFAULT_WS, useWorkspaceStore, signupEnabled, getDbUser, getWorkspace, membersOf } from "./workspaces.js";

const COOKIE = "encore_auth";
const MAX_AGE_S = 60 * 60 * 24 * 30;

// Server-side session revocation: each cookie carries a random session id; /api/logout
// records it as revoked in the store (system/ docs, which the data API can't read or write).
let store = null;
const revokedCache = new Set();
export function useAuthStore(s) { store = s; revokedCache.clear(); useWorkspaceStore(s); }
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
/** Roles whose approval a plan needs: ENCORE_APPROVER_ROLES (default workspace) or the workspace's own
 * approverRoles if set, else every role on the team list. */
export function approverRoles(ws = DEFAULT_WS) {
  const conf = ws === DEFAULT_WS ? String(process.env.ENCORE_APPROVER_ROLES || "") : (getWorkspace(ws)?.approverRoles || []).join(",");
  const set = conf.split(",").map((r) => r.trim()).filter(Boolean);
  if (set.length) return [...new Map(set.map((r) => [r.toLowerCase(), r])).values()];
  return [...new Map(teamOf(ws).flatMap((u) => u.roles || []).map((r) => [r.toLowerCase(), r])).values()];
}
/** Whether approver roles are explicitly configured for this workspace (then other roles can't approve). */
export const approverRolesConfigured = (ws = DEFAULT_WS) => ws === DEFAULT_WS ? !!String(process.env.ENCORE_APPROVER_ROLES || "").trim() : !!getWorkspace(ws)?.approverRoles?.length;
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
  return createHmac("sha256", secret).update("encore-user:" + email + ":" + ws + ":" + sid + ":" + process.env.APP_PASSWORD).digest("hex");
}
function makeCookie(email, ws = DEFAULT_WS) { const sid = randomBytes(16).toString("hex"); return `${email}.${ws}.${sid}.${sign(email, ws, sid)}`; }
/** { email, ws, sid } from a valid, unrevoked cookie, else null. email is "*" for the shared password. */
function session(req) {
  const parts = readCookie(req, COOKIE).split(".");
  if (parts.length < 4) return null;
  const sig = parts.pop(), sid = parts.pop(), ws = parts.pop(), email = parts.join(".");
  if (!email || !/^[A-Za-z0-9]{1,40}$/.test(ws) || !/^[a-f0-9]{32}$/.test(sid) || !same(sig, sign(email, ws, sid)) || isRevoked(sid)) return null;
  return { email, ws, sid };
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
    return isForm ? res.redirect(303, "/login?error=3") : res.status(429).json({ code: "rate_limited", message: "Too many sign-in attempts. Try again later." });
  }
  const deny = (err, message) => { noteFail(req); return isForm ? res.redirect(303, "/login?error=" + err) : res.status(401).json({ code: "not_granted", message }); };
  let value;
  const named = users().length || (signupEnabled() && String(req.body?.email || "").trim());
  if (named) {
    const u = findUser(req.body?.email);
    if (!u) return deny(2, "That email isn't on the team list.");
    // A personal password, when set, is required; the shared team password then doesn't work for that person.
    // Accounts made by sign-up or invite always have one.
    const personal = checkPersonal(u, password);
    if (personal === false || (personal === null && (u.ws !== DEFAULT_WS || !process.env.APP_PASSWORD || !same(password, process.env.APP_PASSWORD)))) return deny(1, "Wrong password.");
    value = makeCookie(u.email, u.ws);
  } else if (!process.env.APP_PASSWORD || !same(password, process.env.APP_PASSWORD)) {
    return deny(1, "Wrong password.");
  } else value = makeCookie("*", DEFAULT_WS);
  clearFails(req);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
  return isForm ? res.redirect(303, "/") : res.json({ ok: true });
}
export function logoutHandler(req, res) {
  const s = authEnabled() ? session(req) : null;
  if (s) revoke(s.sid); // the cookie stops working on the server, even if a copy of it survives
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}
export function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Encore</title>
<script>
  // Guest RSVP / survey links carry their target in the hash, which never reaches
  // the server. Send those visitors to the guest copy of the page instead.
  if (/^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-)/.test(location.hash)) location.replace("/g" + location.search + location.hash); // keep ?utm_… for the RSVP
</script>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#f4f7ff;color:#1b2340}
  form{background:#fff;padding:28px;border-radius:16px;box-shadow:0 6px 30px rgba(30,50,120,.12);width:min(320px,calc(100vw - 32px));box-sizing:border-box}
  h1{margin:0 0 16px;font-size:22px}
  input,button{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border-radius:10px}
  input{border:1px solid #cfd6ea;margin-bottom:12px}
  button{border:0;background:#3355ff;color:#fff;font-weight:600;cursor:pointer}
  p{color:#b3261e;margin:0 0 12px;font-size:13px}
  a.alt{display:block;margin-top:14px;text-align:center;color:#3355ff;font-size:13px;text-decoration:none}
</style></head><body>
<form method="post" action="/api/login">
  <h1>encore</h1>
  <script>if (location.search.includes("error=3")) document.write("<p>Too many sign-in attempts. Try again later.</p>"); else if (location.search.includes("error=2")) document.write("<p>That email isn't on the team list.</p>"); else if (location.search.includes("error")) document.write("<p>That password didn't work.</p>")</script>
  ${users().length || signupEnabled() ? `<input type="email" name="email" placeholder="Work email" autocomplete="email" ${users().length || !process.env.APP_PASSWORD ? "required" : ""}>` : ""}
  <input type="password" name="password" placeholder="${users().some((u) => u.pw) || signupEnabled() ? "Your password" : "Team password"}" autocomplete="current-password" autofocus required>
  <button type="submit">Sign in</button>
  ${signupEnabled() ? `<a class="alt" href="/signup">New to Encore? Start a free trial</a>` : ""}
</form></body></html>`;
}
