// Text messages (pickup reminders for giveaways, host broadcasts). Optional: set ENCORE_TWILIO_SID, ENCORE_TWILIO_TOKEN
// and ENCORE_TWILIO_FROM on the server. Without them, Pottery Lab hands the host tap-to-text links instead.
export const fakeTexts = [];
// numbers that replied STOP are never texted again (until they reply START)
let stopCheck = null; export const useSmsStop = (fn) => { stopCheck = fn; };
export function smsConfig() {
  const e = process.env;
  if (e.ENCORE_FAKE_SMS === "1") return { service: "fake" };
  if (e.ENCORE_TWILIO_SID && e.ENCORE_TWILIO_TOKEN && /^\+\d{6,16}$/.test(e.ENCORE_TWILIO_FROM || "")) return { service: "twilio", sid: e.ENCORE_TWILIO_SID, token: e.ENCORE_TWILIO_TOKEN, from: e.ENCORE_TWILIO_FROM };
  return null;
}
const norm = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d.length === 10 ? "+1" + d : d.length === 11 && d.startsWith("1") ? "+" + d : "+" + d; };
/** Send one text. Returns { ok } or { ok:false, error }. Never throws. */
export async function sendSms(cfg, { to, text }) {
  if (!cfg) return { ok: false, error: "Texting isn't set up." };
  const num = norm(to), body = String(text || "").slice(0, 600);
  if (!/^\+\d{7,16}$/.test(num)) return { ok: false, error: "Not a phone number." };
  try { if (stopCheck && stopCheck(num)) return { ok: false, error: "This number replied STOP.", stopped: true }; } catch {}
  if (cfg.service === "fake") { fakeTexts.push({ to: num, text: body }); return { ok: true }; }
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.sid)}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ To: num, From: cfg.from, Body: body }) });
    return r.ok ? { ok: true } : { ok: false, error: `Twilio said ${r.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}
