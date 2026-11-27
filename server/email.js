// Sending email from Pottery Lab: sign-off requests, guest invites and deadline reminders.
// Each workspace connects its own sending service (Resend, Postmark or SendGrid) in Setup; the key is stored
// encrypted with its other connections. The default workspace can use ENCORE_EMAIL_SERVICE / ENCORE_EMAIL_KEY /
// ENCORE_EMAIL_FROM instead. ENCORE_FAKE_EMAIL=1 records messages without sending them (demos and tests).
import { connectionTokens, getWorkspace } from "./workspaces.js";
import { inDemo, isDemoEmail } from "./democtx.js";
import { emailBrand, emailHtml } from "./brandkit.js"; // guest emails wear the host's accent and logo
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------- unsubscribe (guest and follower mail) ----------
// Mail to guests and followers (reminders, announcements, kudos asks, confirmations) is sent with list: "guest". Each such
// message carries a List-Unsubscribe header and a footer link to /unsubscribe?t=<token>; the token is the address, signed
// with SESSION_SECRET. Once an address unsubscribes, sendEmail drops every list: "guest" message to it.
let unsubStore = null;
export const useUnsubStore = (store) => { unsubStore = store; };
const lc = (e) => String(e || "").trim().toLowerCase();
const RANDOM_SECRET = randomBytes(32).toString("hex"); // without SESSION_SECRET (local use), links work until a restart
const unsubSecret = () => process.env.SESSION_SECRET || RANDOM_SECRET;
const unsubKey = (email) => "system/unsub-" + createHash("sha256").update(lc(email)).digest("hex").slice(0, 32);
const sig = (email) => createHmac("sha256", unsubSecret()).update("unsub|" + lc(email)).digest("base64url").slice(0, 32);
export const unsubToken = (email) => Buffer.from(lc(email)).toString("base64url") + "." + sig(email);
/** The address a token was made for, or null when it isn't one of ours. */
export function readUnsubToken(t) {
  const [a, s] = String(t || "").split("."); if (!a || !s) return null;
  let email = ""; try { email = Buffer.from(a, "base64url").toString("utf8"); } catch { return null; }
  if (!EMAIL_RE.test(email)) return null; const want = Buffer.from(sig(email)), got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? lc(email) : null;
}
export const isUnsubscribed = (email) => { try { return !!unsubStore?.get(unsubKey(email))?.data?.off; } catch { return false; } };
export function setUnsubscribed(email, off = true) { if (!unsubStore || !EMAIL_RE.test(lc(email))) return false; unsubStore.set(unsubKey(email), { email: lc(email), off: !!off, at: Date.now() }); return true; }
const baseUrl = (origin) => String(origin || process.env.ENCORE_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
export const unsubLink = (email, origin) => `${baseUrl(origin)}/unsubscribe?t=${unsubToken(email)}`;

export const EMAIL_SERVICES = {
  resend: { name: "Resend", check: (key) => ["https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } }] },
  postmark: { name: "Postmark", check: (key) => ["https://api.postmarkapp.com/server", { headers: { "X-Postmark-Server-Token": key, Accept: "application/json" } }] },
  sendgrid: { name: "SendGrid", check: (key) => ["https://api.sendgrid.com/v3/scopes", { headers: { Authorization: `Bearer ${key}` } }] },
};
export const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]{2,}$/;
export const fakeOutbox = [];

/** The workspace's sending setup, or null when email isn't set up. */
export function emailConfig(ws, isDefault) {
  const t = (() => { try { return connectionTokens(ws); } catch { return {}; } })();
  if (t.email) { try { const c = JSON.parse(t.email); if (EMAIL_SERVICES[c.service] && c.key && EMAIL_RE.test(c.from)) return c; } catch {} }
  const env = process.env;
  if (isDefault && env.ENCORE_EMAIL_KEY && EMAIL_RE.test(env.ENCORE_EMAIL_FROM || "") && EMAIL_SERVICES[env.ENCORE_EMAIL_SERVICE || "resend"])
    return { service: env.ENCORE_EMAIL_SERVICE || "resend", key: env.ENCORE_EMAIL_KEY, from: env.ENCORE_EMAIL_FROM, fromName: env.ENCORE_EMAIL_FROM_NAME || "" };
  if (env.ENCORE_FAKE_EMAIL === "1") return { service: "fake", from: env.ENCORE_EMAIL_FROM || "events@encore.example", fromName: "" };
  return null;
}
export const publicEmailConfig = (c) => (c ? { enabled: true, service: c.service, from: c.from } : { enabled: false });

const clean = (s, n) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);

/** Send one plain-text message. Returns { ok, id } or { ok:false, error }. Never throws.
 * list: "guest" for mail to guests and followers: skipped for unsubscribed addresses, and sent with a List-Unsubscribe
 * header and an unsubscribe footer (origin: the public address for the link, else ENCORE_PUBLIC_URL). */
// brandWs: the workspace of the host a guest email is from. The email then also goes as simple HTML with the host's
// accent and logo (server/brandkit.js); the plain text stays the same.
// html: a ready-made HTML body for a system email with one button (the host's reply summary); the text stays the fallback.
export async function sendEmail(cfg, { to, cc, subject, text, replyTo, fromName, list, origin, brandWs, html: ownHtml = "" }) {
  if (!cfg) return { ok: false, error: "Email isn't set up for this workspace." };
  // the marketer demo sends nothing, and demo and example people are never mailed (server/democtx.js)
  if (inDemo() || (brandWs && getWorkspace(brandWs)?.demo === true)) return { ok: true, demo: true, sent: 0 };
  to = [].concat(to || []).filter((x) => !isDemoEmail(x)); cc = [].concat(cc || []).filter((x) => !isDemoEmail(x)); if (!to.length) return { ok: true, demo: true, sent: 0 };
  // the reserved .invalid domain is never mailed: phone-only accounts hold a stand-in address there (server/signin.js)
  const mailable = (x) => EMAIL_RE.test(x) && !/\.invalid$/i.test(x);
  let rcpt = [].concat(to || []).map((x) => String(x).trim()).filter(mailable);
  const copy = list === "guest" ? [] : [].concat(cc || []).map((x) => String(x).trim()).filter(mailable);
  if (!rcpt.length) return { ok: false, error: "No valid recipient." };
  let headers = null, footer = "";
  if (list === "guest") {
    rcpt = rcpt.filter((x) => !isUnsubscribed(x)); if (!rcpt.length) return { ok: false, code: "unsubscribed", error: "They unsubscribed from these emails." };
    if (rcpt.length > 1) { const rs = []; for (const x of rcpt) rs.push(await sendEmail(cfg, { to: x, subject, text, replyTo, fromName, list, origin, brandWs })); return rs.find((r) => r.ok) || rs[0]; }
    const link = unsubLink(rcpt[0], origin);
    headers = { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    footer = `\n\n--\nDon't want these emails? Unsubscribe: ${link}\n`;
  }
  const subj = clean(subject, 200) || "(no subject)", body = String(text || "").slice(0, 20000 - footer.length) + footer;
  const name = clean(fromName || cfg.fromName, 80).replace(/[<>"]/g, ""), from = name ? `${name} <${cfg.from}>` : cfg.from;
  const reply = replyTo && EMAIL_RE.test(replyTo) ? replyTo : null;
  let html = list === "guest" ? "" : String(ownHtml || ""); if (!html && brandWs) { try { const b = emailBrand(getWorkspace(brandWs)?.host); if (b) html = emailHtml(body, b, origin); } catch {} }
  if (cfg.service === "fake") { const id = "fake-" + (fakeOutbox.length + 1); fakeOutbox.push({ id, from, to: rcpt, cc: copy, subject: subj, text: body, replyTo: reply, ...(headers ? { headers } : {}), ...(html ? { html } : {}) }); return { ok: true, id }; }
  let url, init;
  if (cfg.service === "resend") {
    url = "https://api.resend.com/emails";
    init = { headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: rcpt, ...(copy.length ? { cc: copy } : {}), subject: subj, text: body, ...(html ? { html } : {}), ...(reply ? { reply_to: reply } : {}), ...(headers ? { headers } : {}) }) };
  } else if (cfg.service === "postmark") {
    url = "https://api.postmarkapp.com/email";
    init = { headers: { "X-Postmark-Server-Token": cfg.key, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ From: from, To: rcpt.join(","), ...(copy.length ? { Cc: copy.join(",") } : {}), Subject: subj, TextBody: body, ...(html ? { HtmlBody: html } : {}), ...(reply ? { ReplyTo: reply } : {}), ...(headers ? { Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) } : {}), MessageStream: "outbound" }) };
  } else if (cfg.service === "sendgrid") {
    url = "https://api.sendgrid.com/v3/mail/send";
    init = { headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ personalizations: [{ to: rcpt.map((email) => ({ email })), ...(copy.length ? { cc: copy.map((email) => ({ email })) } : {}) }], from: name ? { email: cfg.from, name } : { email: cfg.from }, ...(reply ? { reply_to: { email: reply } } : {}), subject: subj, content: [{ type: "text/plain", value: body }, ...(html ? [{ type: "text/html", value: html }] : [])], ...(headers ? { headers } : {}) }) };
  } else return { ok: false, error: "Unknown email service." };
  try {
    const r = await fetch(url, { method: "POST", ...init, signal: AbortSignal.timeout(15_000) });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) return { ok: false, error: `${EMAIL_SERVICES[cfg.service].name} answered ${r.status}${j?.message || j?.Message ? ": " + String(j.message || j.Message).slice(0, 200) : ""}` };
    return { ok: true, id: String(j?.id || j?.MessageID || r.headers.get("x-message-id") || "") };
  } catch { return { ok: false, error: `Couldn't reach ${EMAIL_SERVICES[cfg.service].name}.` }; }
}

/** Check a key with one cheap read before it's stored. */
export async function verifyEmailKey(service, key) {
  const s = EMAIL_SERVICES[service]; if (!s) return { ok: false, status: 400, message: "service must be resend, postmark or sendgrid." };
  const [url, init] = s.check(key);
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, status: 400, code: "invalid_token", message: `${s.name} didn't accept that API key.` };
    if (!r.ok) return { ok: false, status: 502, code: "upstream_error", message: `${s.name} answered ${r.status} when checking the key.` };
    return { ok: true };
  } catch { return { ok: false, status: 502, code: "upstream_error", message: `Couldn't reach ${s.name} to check the key.` }; }
}
