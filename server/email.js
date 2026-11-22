// Sending email from Encore: sign-off requests, guest invites and deadline reminders.
// Each workspace connects its own sending service (Resend, Postmark or SendGrid) in Setup; the key is stored
// encrypted with its other connections. The default workspace can use ENCORE_EMAIL_SERVICE / ENCORE_EMAIL_KEY /
// ENCORE_EMAIL_FROM instead. ENCORE_FAKE_EMAIL=1 records messages without sending them (demos and tests).
import { connectionTokens } from "./workspaces.js";

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

/** Send one plain-text message. Returns { ok, id } or { ok:false, error }. Never throws. */
export async function sendEmail(cfg, { to, cc, subject, text, replyTo, fromName }) {
  if (!cfg) return { ok: false, error: "Email isn't set up for this workspace." };
  const rcpt = [].concat(to || []).map((x) => String(x).trim()).filter((x) => EMAIL_RE.test(x));
  const copy = [].concat(cc || []).map((x) => String(x).trim()).filter((x) => EMAIL_RE.test(x));
  if (!rcpt.length) return { ok: false, error: "No valid recipient." };
  const subj = clean(subject, 200) || "(no subject)", body = String(text || "").slice(0, 20000);
  const name = clean(fromName || cfg.fromName, 80).replace(/[<>"]/g, ""), from = name ? `${name} <${cfg.from}>` : cfg.from;
  const reply = replyTo && EMAIL_RE.test(replyTo) ? replyTo : null;
  if (cfg.service === "fake") { const id = "fake-" + (fakeOutbox.length + 1); fakeOutbox.push({ id, from, to: rcpt, cc: copy, subject: subj, text: body, replyTo: reply }); return { ok: true, id }; }
  let url, init;
  if (cfg.service === "resend") {
    url = "https://api.resend.com/emails";
    init = { headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: rcpt, ...(copy.length ? { cc: copy } : {}), subject: subj, text: body, ...(reply ? { reply_to: reply } : {}) }) };
  } else if (cfg.service === "postmark") {
    url = "https://api.postmarkapp.com/email";
    init = { headers: { "X-Postmark-Server-Token": cfg.key, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ From: from, To: rcpt.join(","), ...(copy.length ? { Cc: copy.join(",") } : {}), Subject: subj, TextBody: body, ...(reply ? { ReplyTo: reply } : {}), MessageStream: "outbound" }) };
  } else if (cfg.service === "sendgrid") {
    url = "https://api.sendgrid.com/v3/mail/send";
    init = { headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ personalizations: [{ to: rcpt.map((email) => ({ email })), ...(copy.length ? { cc: copy.map((email) => ({ email })) } : {}) }], from: name ? { email: cfg.from, name } : { email: cfg.from }, ...(reply ? { reply_to: { email: reply } } : {}), subject: subj, content: [{ type: "text/plain", value: body }] }) };
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
