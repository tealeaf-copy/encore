// Optional shared-password gate. Off unless APP_PASSWORD is set.
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";

const COOKIE = "encore_auth";
const MAX_AGE_S = 60 * 60 * 24 * 30;

// Server-side session revocation: each cookie carries a random session id; /api/logout
// records it as revoked in the store (system/ docs, which the data API can't read or write).
let store = null;
const revokedCache = new Set();
export function useAuthStore(s) { store = s; revokedCache.clear(); }
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

// Login rate limit: 10 failed tries per IP + email in 15 minutes, then 429 until the window passes.
const LOGIN_WINDOW_MS = 15 * 60 * 1000, LOGIN_MAX_FAILS = 10;
const fails = new Map(); // key -> { n, first }
const failKey = (req) => `${req.ip || req.socket?.remoteAddress || "?"}|${String(req.body?.email || "").trim().toLowerCase()}`;
function limited(key) {
  const f = fails.get(key);
  if (!f) return false;
  if (Date.now() - f.first > LOGIN_WINDOW_MS) { fails.delete(key); return false; }
  return f.n >= LOGIN_MAX_FAILS;
}
function noteFail(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first > LOGIN_WINDOW_MS) fails.set(key, { n: 1, first: Date.now() });
  else f.n++;
  if (fails.size > 10000) for (const [k, v] of fails) if (Date.now() - v.first > LOGIN_WINDOW_MS) fails.delete(k);
}
/** For tests. */
export function resetLoginLimits() { fails.clear(); }

export function authEnabled() {
  return !!process.env.APP_PASSWORD;
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
/** Roles whose approval a plan needs: ENCORE_APPROVER_ROLES if set, else every role on the team list. */
export function approverRoles() {
  const set = String(process.env.ENCORE_APPROVER_ROLES || "").split(",").map((r) => r.trim()).filter(Boolean);
  if (set.length) return [...new Map(set.map((r) => [r.toLowerCase(), r])).values()];
  return [...new Map(users().flatMap((u) => u.roles).map((r) => [r.toLowerCase(), r])).values()];
}
export const hasPersonalPassword = (u) => /^scrypt\$[^$]+\$[a-f0-9]+$/.test(String(u?.pw || ""));
export const isApprover = (u) => { const A = approverRoles().map((r) => r.toLowerCase()); return !!u && u.roles.some((r) => A.includes(r.toLowerCase())); };
/** Reasons the server must not start with this team configuration (empty when it's fine). */
export function startupProblems() {
  if (!process.env.ENCORE_USERS) return [];
  const bad = users().filter((u) => isApprover(u) && !hasPersonalPassword(u));
  return bad.length ? [`These team members hold an approver role (${approverRoles().join(", ")}) but have no personal password, so anyone with the team password could approve as them: ${bad.map((u) => `${u.name} <${u.email}>`).join(", ")}. Add a 4th field with a hash from \`node server/hash-password.js 'their password'\`, or set ENCORE_APPROVER_ROLES to the roles that approve plans.`] : [];
}
const findUser = (email) => users().find((u) => u.email === String(email || "").trim().toLowerCase()) || null;
/** "scrypt$salt$hash" for a personal password (see server/hash-password.js). */
export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `scrypt$${salt}$${scryptSync(String(password), salt, 32).toString("hex")}`;
}
function checkPersonal(u, password) {
  const [, salt, hash] = String(u.pw || "").split("$");
  if (!salt || !hash) return null;
  return same(scryptSync(String(password), salt, 32).toString("hex"), hash);
}
// Cookie value: "<email or *>.<session id>.<signature>". The signature covers both, plus APP_PASSWORD,
// so changing the team password signs everyone out.
function sign(email, sid) {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  return createHmac("sha256", secret).update("encore-user:" + email + ":" + sid + ":" + process.env.APP_PASSWORD).digest("hex");
}
function makeCookie(email) { const sid = randomBytes(16).toString("hex"); return `${email}.${sid}.${sign(email, sid)}`; }
/** { email, sid } from a valid, unrevoked cookie, else null. email is "*" for the shared password. */
function session(req) {
  const parts = readCookie(req, COOKIE).split(".");
  if (parts.length < 3) return null;
  const sig = parts.pop(), sid = parts.pop(), email = parts.join(".");
  if (!email || !/^[a-f0-9]{32}$/.test(sid) || !same(sig, sign(email, sid)) || isRevoked(sid)) return null;
  return { email, sid };
}
/** The signed-in team member, or null (no users configured, or not signed in as one). */
export function currentUser(req) {
  if (!authEnabled() || !users().length) return null;
  const s = session(req);
  return s && s.email !== "*" ? findUser(s.email) : null;
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
  if (users().length) return !!currentUser(req);
  return session(req)?.email === "*";
}
export function loginHandler(req, res) {
  if (!authEnabled()) return res.json({ ok: true });
  const password = req.body?.password ?? "";
  const isForm = req.is("application/x-www-form-urlencoded");
  const key = failKey(req);
  if (limited(key)) {
    res.setHeader("Retry-After", String(Math.ceil((fails.get(key).first + LOGIN_WINDOW_MS - Date.now()) / 1000)));
    return isForm ? res.redirect(303, "/login?error=3") : res.status(429).json({ code: "rate_limited", message: "Too many sign-in attempts. Try again in 15 minutes." });
  }
  const deny = (err, message) => { noteFail(key); return isForm ? res.redirect(303, "/login?error=" + err) : res.status(401).json({ code: "not_granted", message }); };
  let value;
  if (users().length) {
    const u = findUser(req.body?.email);
    if (!u) return deny(2, "That email isn't on the team list.");
    // A personal password, when set, is required; the shared team password then doesn't work for that person.
    const personal = checkPersonal(u, password);
    if (personal === false || (personal === null && !same(password, process.env.APP_PASSWORD))) return deny(1, "Wrong password.");
    value = makeCookie(u.email);
  } else if (!same(password, process.env.APP_PASSWORD)) {
    return deny(1, "Wrong password.");
  } else value = makeCookie("*");
  fails.delete(key);
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
  if (/^#(rsvp-|survey-|nominate-|plan-|roadmap|guests-|approve-)/.test(location.hash)) location.replace("/g" + location.hash);
</script>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#f4f7ff;color:#1b2340}
  form{background:#fff;padding:28px;border-radius:16px;box-shadow:0 6px 30px rgba(30,50,120,.12);width:min(320px,calc(100vw - 32px));box-sizing:border-box}
  h1{margin:0 0 16px;font-size:22px}
  input,button{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border-radius:10px}
  input{border:1px solid #cfd6ea;margin-bottom:12px}
  button{border:0;background:#3355ff;color:#fff;font-weight:600;cursor:pointer}
  p{color:#b3261e;margin:0 0 12px;font-size:13px}
</style></head><body>
<form method="post" action="/api/login">
  <h1>encore</h1>
  <script>if (location.search.includes("error=3")) document.write("<p>Too many sign-in attempts. Try again in 15 minutes.</p>"); else if (location.search.includes("error=2")) document.write("<p>That email isn't on the team list.</p>"); else if (location.search.includes("error")) document.write("<p>That password didn't work.</p>")</script>
  ${users().length ? `<input type="email" name="email" placeholder="Work email" autocomplete="email" required>` : ""}
  <input type="password" name="password" placeholder="${users().some((u) => u.pw) ? "Your password" : "Team password"}" autocomplete="current-password" autofocus required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}
