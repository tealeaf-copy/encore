// Optional shared-password gate. Off unless APP_PASSWORD is set.
import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "encore_auth";
const MAX_AGE_S = 60 * 60 * 24 * 30;

export function authEnabled() {
  return !!process.env.APP_PASSWORD;
}
function token() {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  return createHmac("sha256", secret).update("encore-session:" + process.env.APP_PASSWORD).digest("hex");
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
  const c = readCookie(req, COOKIE);
  return !!c && same(c, token());
}
export function loginHandler(req, res) {
  if (!authEnabled()) return res.json({ ok: true });
  const password = req.body?.password ?? "";
  const isForm = req.is("application/x-www-form-urlencoded");
  if (!same(password, process.env.APP_PASSWORD)) {
    return isForm ? res.redirect(303, "/login?error=1") : res.status(401).json({ code: "not_granted", message: "Wrong password." });
  }
  const secure = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
  return isForm ? res.redirect(303, "/") : res.json({ ok: true });
}
export function logoutHandler(req, res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}
export function loginPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Encore</title>
<script>
  // Guest RSVP / survey links carry their target in the hash, which never reaches
  // the server. Send those visitors to the guest copy of the page instead.
  if (/^#(rsvp|survey)-/.test(location.hash)) location.replace("/g" + location.hash);
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
  <script>if (location.search.includes("error")) document.write("<p>That password didn't work.</p>")</script>
  <input type="password" name="password" placeholder="Team password" autocomplete="current-password" autofocus required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}
