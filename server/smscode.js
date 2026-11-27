// Sign-in codes by text message: a small provider module for server/signin.js. Twilio's REST API over fetch, no SDK.
// Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (an E.164 number like +15551234567, or a Messaging Service
// SID that starts with MG). The ENCORE_TWILIO_SID / ENCORE_TWILIO_TOKEN / ENCORE_TWILIO_FROM names that server/sms.js
// already reads also work, so a server that texts reminders can text codes too. Without either, text sign-in is off and
// the sign-in page points people to email instead.
// ENCORE_FAKE_SMS=1 (never with NODE_ENV=production) keeps the texts in fakeCodeTexts instead of sending them (tests, demos).

/** Texts the fake provider "sent": { to, text }. Tests read codes from here. */
export const fakeCodeTexts = [];

export function codeSmsConfig(env = process.env) {
  if (env.ENCORE_FAKE_SMS === "1" && env.NODE_ENV !== "production") return { service: "fake" };
  const sid = String(env.TWILIO_ACCOUNT_SID || env.ENCORE_TWILIO_SID || "").trim(), token = String(env.TWILIO_AUTH_TOKEN || env.ENCORE_TWILIO_TOKEN || "").trim();
  const from = String(env.TWILIO_FROM || env.ENCORE_TWILIO_FROM || "").trim();
  if (sid && token && (/^\+\d{7,15}$/.test(from) || /^MG[0-9a-f]{32}$/i.test(from))) return { service: "twilio", sid, token, from };
  return null;
}

/**
 * A phone number in E.164 (+15551234567), or "" when it isn't one. No leading + means a US number: 10 digits, or 11
 * starting with 1. "00" in front is the international prefix. Spaces, dots, dashes and brackets are ignored.
 */
export function toE164(input) {
  let s = String(input || "").trim(); if (!s || s.length > 32 || !/^[\d\s().+-]+$/.test(s)) return "";
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const plus = s.startsWith("+"), d = s.replace(/\D/g, "");
  if (plus) { if (d.startsWith("1")) return /^1[2-9]\d{9}$/.test(d) ? "+" + d : ""; return /^[2-9]\d{7,14}$/.test(d) ? "+" + d : ""; }
  const us = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{9}$/.test(us) ? "+1" + us : "";
}
/** For logs: never the whole number. */
export const maskPhone = (p) => { const s = String(p || ""); return s.length > 6 ? s.slice(0, 2) + "***" + s.slice(-2) : "***"; };

/** Send one text. Returns { ok } or { ok:false, error }. Never throws, and never logs the number or the text. */
export async function sendCodeText(cfg, { to, text }, fetchFn = (...a) => globalThis.fetch(...a)) {
  if (!cfg) return { ok: false, error: "Text sign-in isn't set up." };
  if (!/^\+\d{8,15}$/.test(String(to || ""))) return { ok: false, error: "Not a phone number." };
  const body = String(text || "").slice(0, 320);
  if (cfg.service === "fake") { fakeCodeTexts.push({ to, text: body }); if (fakeCodeTexts.length > 500) fakeCodeTexts.splice(0, 100); return { ok: true }; }
  const params = new URLSearchParams({ To: to, Body: body, ...(cfg.from.startsWith("MG") ? { MessagingServiceSid: cfg.from } : { From: cfg.from }) });
  try {
    const r = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.sid)}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: AbortSignal.timeout(10_000) });
    if (r.ok) return { ok: true };
    let j = null; try { j = await r.json(); } catch {}
    return { ok: false, error: `Twilio answered ${r.status}${j?.code ? " (" + j.code + ")" : ""}` };
  } catch { return { ok: false, error: "Couldn't reach Twilio." }; }
}
