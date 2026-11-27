// Potto by text: talk to Potto over SMS and WhatsApp. Built and tested, switched on by config (docs/potto-text.md).
//
// Webhooks (Twilio): POST /api/potto/sms and POST /api/potto/whatsapp. Each request must carry a valid
// X-Twilio-Signature (HMAC-SHA1 of the public URL plus the sorted form fields, keyed with the auth token); anything
// else gets a 403 and is never read. Optional Meta WhatsApp Cloud API on the same /api/potto/whatsapp path:
// GET answers the verify-token handshake, POST must carry X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the
// app secret). Outbound goes through Twilio's Messages API or the Cloud API with fetch: no new dependency.
//
// Who: the sender's number must be a verified phone on an account (an identity made by /api/me/phone/verify, the
// same one that signs in). An unknown number gets one kind reply pointing to Settings, at most once a day, and nothing
// else. A known number that hasn't turned on "Text with Potto" (Settings, off by default) gets one nudge and nothing
// is done for it. Potto never acts for a number it can't tie to a verified account.
//
// Consent and care: the switch records when and what they agreed to. STOP, UNSUBSCRIBE, CANCEL, END, QUIT (and
// STOPALL) stop every message to that number and are recorded on the shared stop list (system/smsstop-<hash>, which
// server/sms.js reads too); START comes back; HELP answers with the support line. Proactive messages (the day-before
// reminder, "your order is ready", replies to a host's event in a batch, "a spot opened up") go only to people who
// turned it on, never from 9pm to 9am where they are (their city, else ENCORE_TZ), never to a host they muted, at
// most ENCORE_POTTO_TEXT_DAILY a day each. Inbound is limited per number (ENCORE_POTTO_TEXT_PER_HOUR) and everything
// outbound is limited per minute across the server (ENCORE_POTTO_TEXT_GLOBAL_PER_MIN). Replies stay under 320
// characters where they can, never over 600.
//
// What Potto can do: tools that call the app's own API as that person, over loopback with a session that lasts one
// message (callAs), so it has no power the person doesn't have in the app: replies go through POST
// /api/plans/peek/:id/reply (the invite's own write), new replies and drop orders through /api/db/collection?path=rsvps
// as a guest, drafts and changes through /api/db (the event's own write path, which tells guests about a new time),
// reminders through the group chat, and "talk to a person" through /api/help/ticket. Reads use the same functions the
// pages use (plans.peekOf, plans.timeline, hooks.digest), with the person's email. Anything that changes something
// for other people (an order, a reminder, a new time, publishing) waits for an explicit YES.
//
// Words: a small parser reads the usual asks; anything else goes to the model (server/ai.js complete) to pick one
// of the same intents, never to act on its own. With ENCORE_FAKE_AI=1 that step answers deterministically.
//
// Log: system/pottotlog-<hash> keeps a person's last 200 messages, readable by them only (GET /api/me/potto-text/log,
// deletable). Admins see counts only (GET /api/admin/potto-text, /admin/invites). Unknown numbers are counted, never kept.
// ENCORE_FAKE_SMS=1 (never in production) keeps outbound messages in pottoOutbox for tests and demos.
import crypto from "node:crypto";
import express from "express";
import { getDbUser, scopeStore, allWorkspaceIds, workspaceOfEvent, getWorkspace, DEFAULT_WS } from "./workspaces.js";
import { startSession } from "./auth.js";
import { phoneAccountOf } from "./signin.js";
import { toE164, maskPhone } from "./smscode.js";
import { complete, aiMode, parseJsonLoose } from "./ai.js";
import { eventTz, todayIn, hourIn, tzOk } from "./tz.js";
import { zoneOf } from "./hooks.js";
import { priceOf } from "./drops.js";
import { isAdmin } from "./metrics.js";

const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // the same key as server/social.js (smsstop)
const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const ISO = /^\d{4}-\d{2}-\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const prettyTime = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m[2] === "00" ? `${h}${ap}` : `${h}:${m[2]}${ap}`; };
const shortDay = (d, today) => (!ISO.test(d || "") ? "" : d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : `${WD[dow(d)]} ${new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`);
const titleOf = (ev) => clean(ev?.pubTitle || ev?.name, 80) || "your event";
const list = (L) => (L.length <= 1 ? L.join("") : L.length === 2 ? `${L[0]} and ${L[1]}` : `${L.slice(0, -1).join(", ")} and ${L[L.length - 1]}`);

// ---------- Potto's voice: one place, so it's easy to update with docs/potto-voice.md ----------
export const POTTO_TEXT_VOICE = `You are Potto, the small clay pot who helps people on Pottery Lab, talking by text message.
Be playful, friendly, warm, understanding and empathetic: a very smart, humble, fun friend to go to parties with.
Short and specific, a little playful. Kind when something goes wrong (a cancelled event, a full waitlist). Never pushy, never corporate.
Plain words, short sentences, under 320 characters. No em dashes. No exclamation storms. One emoji at most, only when it fits.
Never brag about being AI. Credit the hosts and guests. Say "spots", not "seats", and "guests", not "attendees".`;

/** Every canned line in one place, in Potto's voice. Links are passed in. */
export const SAY = {
  unknown: (link) => `Hi, I'm Potto from Pottery Lab. I'd love to help, but I don't know this number yet. Add it in your settings and we're set: ${link}`,
  notOn: (name, link) => `Hi${name ? " " + name : ""}, it's Potto. Texting with me is off for this number. Turn on Text with Potto in your settings, or reply START: ${link}`,
  stopped: "You're unsubscribed, so no more texts from Potto. Reply START any time to come back.",
  started: "You're back on. Text me things like \"my plans\" or \"what's on this weekend\". Reply STOP to stop.",
  welcome: (name) => `Hi${name ? " " + name : ""}, it's Potto. You're set to text with me here. Try "my plans" or "what's on this weekend". Msg & data rates may apply. Reply HELP for help, STOP to stop.`,
  help: (link, email) => `Potto from Pottery Lab. I can reply to invites, share your plans and place orders by text. Help: ${link}${email ? ` or ${email}` : ""}. Msg & data rates may apply. Reply STOP to stop.`,
  slow: "That's a lot of texts at once. Give me a few minutes and try again.",
  menu: (host) => `I can help by text. Try "my plans", "what's on this weekend", "I'm in", "where is it"${host ? `, "who's in", "remind my guests"` : ""} or "talk to a person".`,
  noEvent: "I couldn't tell which event you mean. Text its name, like \"I'm in for dumpling night\".",
  nothingNext: "Nothing on your plans yet. Text \"what's on this weekend\" and I'll find you something small.",
  cancelled: "Never mind, I didn't change anything.",
  expired: "That one timed out, so I didn't do anything. Text it again when you're ready.",
  oops: "Something went wrong on my end, sorry. Try again in a minute, or tap the link in the app.",
};

// ---------- config ----------
const fakeOn = (env) => env.ENCORE_FAKE_SMS === "1" && env.NODE_ENV !== "production";
const waNumber = (s) => { const v = String(s || "").trim().replace(/^whatsapp:/i, ""); return /^\+\d{7,15}$/.test(v) ? "whatsapp:" + v : ""; };
/** What's set up: Twilio SMS, WhatsApp through Twilio, WhatsApp through Meta's Cloud API. Off unless configured. */
export function textConfig(env = process.env) {
  if (env.ENCORE_POTTO_TEXT === "0") return { on: false, sms: null, whatsapp: null, token: "" };
  const fake = fakeOn(env), sid = String(env.TWILIO_ACCOUNT_SID || env.ENCORE_TWILIO_SID || "").trim(), token = String(env.TWILIO_AUTH_TOKEN || env.ENCORE_TWILIO_TOKEN || "").trim();
  const from = String(env.TWILIO_FROM || env.ENCORE_TWILIO_FROM || "").trim(), waFrom = waNumber(env.TWILIO_WHATSAPP_FROM);
  const twilio = sid && token ? { sid, token } : null;
  const sms = fake ? { service: "fake", from: from || "+15555550100" } : twilio && (/^\+\d{7,15}$/.test(from) || /^MG[0-9a-f]{32}$/i.test(from)) ? { service: "twilio", ...twilio, from } : null;
  const meta = env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? { service: "meta", token: env.WHATSAPP_TOKEN, phoneId: String(env.WHATSAPP_PHONE_NUMBER_ID), secret: String(env.WHATSAPP_APP_SECRET || ""), verify: String(env.WHATSAPP_VERIFY_TOKEN || ""), number: String(env.WHATSAPP_NUMBER || "") } : null;
  const whatsapp = fake ? { service: "fake", from: waFrom || "whatsapp:+15555550100" } : twilio && waFrom ? { service: "twilio", ...twilio, from: waFrom } : meta;
  return { on: !!(sms || whatsapp), sms, whatsapp, meta, token, fake };
}
/** WhatsApp template names (Twilio Content SIDs "HX…", or Cloud API template names) for messages outside the 24-hour window. */
export const TEMPLATES = { reminder: "POTTO_WA_TEMPLATE_REMINDER", ready: "POTTO_WA_TEMPLATE_ORDER_READY", replies: "POTTO_WA_TEMPLATE_REPLIES", waitlist: "POTTO_WA_TEMPLATE_WAITLIST", welcome: "POTTO_WA_TEMPLATE_WELCOME" };
const templateOf = (kind, env = process.env) => String(env[TEMPLATES[kind]] || "").trim();
const num = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
export const limits = () => ({ perHour: num("ENCORE_POTTO_TEXT_PER_HOUR", 30), globalPerMin: num("ENCORE_POTTO_TEXT_GLOBAL_PER_MIN", 120), daily: num("ENCORE_POTTO_TEXT_DAILY", 6), batchMin: num("ENCORE_POTTO_TEXT_BATCH_MIN", 30) });
export const MAX_LEN = 600, SOFT_LEN = 320;

// ---------- signatures ----------
/** Twilio's X-Twilio-Signature: base64 HMAC-SHA1 of the URL plus every form field (sorted by name) as name+value. Pure. */
export function twilioSignature(token, url, params = {}) {
  const data = url + Object.keys(params).sort().map((k) => [].concat(params[k]).map((v) => k + v).join("")).join("");
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64");
}
const sameStr = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
export const metaSignature = (secret, raw) => "sha256=" + crypto.createHmac("sha256", secret).update(raw || Buffer.alloc(0)).digest("hex");

/** Keep a text short: at most `max` characters, cut at a word, links kept whole. Pure. */
export function capText(s, max = MAX_LEN) {
  const t = String(s || "").replace(/\u2014/g, ", ").replace(/[ \t]+/g, " ").trim(); if (t.length <= max) return t;
  const url = (t.match(/https?:\/\/\S+$/) || [])[0] || ""; const room = max - (url ? url.length + 1 : 0) - 1;
  const head = t.slice(0, Math.max(0, room)).replace(/\s+\S*$/, ""); return (head + "…" + (url ? " " + url : "")).slice(0, max);
}

// ---------- reading what someone means ----------
const DAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)|\b(\d{1,2}):(\d{2})\b|\b(noon|midnight)\b/i;
/** "7pm", "7:30 pm", "19:00", "noon" as "HH:MM"; "" when there's no time. Pure. */
export function parseTime(s) {
  const m = TIME_RE.exec(String(s || "")); if (!m) return "";
  if (m[6]) return lc(m[6]) === "noon" ? "12:00" : "00:00";
  if (m[4] != null) { const h = +m[4]; return h < 24 && +m[5] < 60 ? `${String(h).padStart(2, "0")}:${m[5]}` : ""; }
  let h = +m[1]; const mm = m[2] || "00", pm = /^p/i.test(m[3]); if (h < 1 || h > 12 || +mm > 59) return ""; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mm}`;
}
/** "tonight", "tomorrow", "sat", "next friday", "dec 12", "12/12" as a date after `today`; "" when there's none. Pure. */
export function parseDay(s, today) {
  const t = lc(s); if (!ISO.test(today)) return "";
  if (/\b(tonight|today)\b/.test(t)) return today; if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) return addDays(today, 1);
  const w = /\b(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/.exec(t);
  if (w) { const d = DAYS[w[2]] ?? DAYS[w[2].slice(0, 3)]; let n = (d - dow(today) + 7) % 7; if (w[1] && n === 0) n = 7; return addDays(today, n); }
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t) || (() => { const x = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\b/.exec(t); return x ? [x[0], x[2], x[1]] : null; })();
  const nm = !md && /\b(\d{1,2})\/(\d{1,2})\b/.exec(t);
  const mo = md ? MONTHS[md[1]] : nm ? +nm[1] : 0, da = md ? +md[2] : nm ? +nm[2] : 0;
  if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) { let y = +today.slice(0, 4); let d = `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`; if (d < today) d = `${y + 1}${d.slice(4)}`; return isNaN(Date.parse(d)) ? "" : d; }
  return "";
}
/** A host's one-line event: "dumpling night sat 7pm at mine for 8" -> { title, date, startTime, meetPoint, headcount }. Pure. */
export function parseDraft(s, today) {
  const raw = clean(s, 300), t = raw.replace(/^(?:can you |could you |please )?(?:i'?m hosting|i want to host|i'?d like to host|let'?s do|help me host|host|hosting|plan|draft|throw|start|make|new event:?|create)\s+(?:an?\s+)?/i, "");
  const date = parseDay(t, today), startTime = parseTime(t), hc = /\bfor\s+(\d{1,3})(?:\s*(?:people|guests|ppl|friends|of us))?\b/i.exec(t), headcount = hc ? Math.min(500, +hc[1]) : 0;
  const mine = /\bat\s+(?:mine|my place|my house|my apartment|my flat|home|ours|our place)\b/i.test(t);
  const at = !mine ? /\bat\s+(?!\d|noon|midnight)([a-z0-9'&.\- ]{2,40}?)(?=\s+(?:for|on|this|next|sat|sun|mon|tue|wed|thu|fri|tonight|tomorrow|\d)|[,.]|$)/i.exec(t) : null;
  const cut = t.search(/\s(?:this |next )?(?:tonight|today|tomorrow|tmrw|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|on |at |for |\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}\/\d{1,2})\b/i);
  let title = clean((cut > 0 ? t.slice(0, cut) : t).replace(/[,.:;!?]+$/, ""), 60); title = title ? title[0].toUpperCase() + title.slice(1) : "";
  return { title, date, startTime, meetPoint: mine ? "My place" : at ? clean(at[1], 60) : "", headcount };
}
const RSVP_GOING = /^(?:yes|yep|yeah|yup|y|i'?m in|im in|i am in|count me in|in|i'?ll be there|i'?ll come|i'?m coming|going|see you there|i'?m going)\b/;
const RSVP_NO = /^(?:no|nope|n|can'?t make it|cant make it|can'?t go|cannot make it|can not make it|can'?t come|i'?m out|im out|not going|out|pass|i can'?t)\b/;
const RSVP_MAYBE = /^(?:maybe|perhaps|not sure|possibly|might)\b/;
const FILLER = /^(?:hey|hi|hello|ok(?:ay)?|so|actually|sorry|oh|um|potto)[,!.]?\s+/;
/** What a text asks for: { intent, ...args }. Pure, apart from today's date. */
export function readIntent(text, { today = todayIn(""), pending = null } = {}) {
  let t = lc(text).replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}'&:/$.,?\- ]/gu, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && FILLER.test(t); i++) t = t.replace(FILLER, "");
  const word = t.replace(/[^a-z ]/g, "").trim();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out)$/.test(word)) return { intent: "stop" };
  if (/^(start|unstop|subscribe|yes start)$/.test(word)) return { intent: "start" };
  if (/^(help|info)$/.test(word)) return { intent: "help" };
  if (pending) { if (/^(yes|y|yep|yeah|yup|ok|okay|confirm|do it|send|send it|place it|go ahead|sure|please do|publish|publish it|move it|sounds good|perfect)\b/.test(word)) return { intent: "confirm" };
    if (/^(no|nope|n|don'?t|dont|never ?mind|nah|not now|wait|hold on)\b/.test(word)) return { intent: "cancel" }; }
  const named = (re) => { const m = re.exec(t); return m ? clean(m[1], 80).replace(/[?.!]+$/, "").replace(/^(?:the|my)\s+/, "") : ""; };
  // ideas to host (server/trends.js): "what should I host?", "any ideas for saturday"
  if (/\b(what should i host|what (?:can|could|do) i host|what to host|host next|ideas? (?:for|to) (?:host|throw|plan)|ideas? for (?:a |an |my )?(?:party|get-?together|event|night|weekend|saturday|friday|sunday)|any ideas)\b/.test(t)) return { intent: "ideas" };
  // hosts
  if (/^publish\b/.test(t)) return { intent: "publish", event: named(/^publish\s+(.+)/) };
  if (/\b(remind (?:my |the |all )?(?:guests|people|everyone|group)|send (?:a |the )?reminder)\b/.test(t)) return { intent: "remind", event: named(/\b(?:for|about|to)\s+(.+)$/) };
  if (/\b(today'?s summary|daily summary|summary|catch me up|what did i miss|how are my events|how'?s my event|how is my event)\b/.test(t)) return { intent: "summary" };
  if (/^(?:can you |please )?(?:move|push|change|shift|bump)\b/.test(t) && (parseTime(t) || parseDay(t.replace(/^.*?\bto\b/, ""), today))) { const to = t.replace(/^.*?\b(?:to|at)\b/, ""); return { intent: "move", time: parseTime(to), date: parseDay(to, today), event: named(/\b(?:move|push|change|shift|bump)\s+(?!it\b)(.+?)\s+(?:to|at)\b/) }; }
  const D = parseDraft(t, today), hostVerb = /^(?:can you |could you |please )?(?:i'?m hosting|i want to host|i'?d like to host|let'?s do|help me host|host|hosting|plan|draft|throw|new event|create an event)\b/.test(t);
  if (D.title && D.startTime && D.date && (hostVerb || D.meetPoint === "My place" || D.headcount) && !RSVP_GOING.test(t) && !RSVP_NO.test(t)) return { intent: "draft", draft: D };
  // a drop order: "2 slices for saturday pickup", "order 2 cakes"
  const om = /^(?:order |can i (?:get|order) |i'?d like |i want |get me )?(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+?)(?:\s+(?:for|on)\s+(.+?))?(?:\s+pick ?up)?[?.!]*$/.exec(t);
  if (om && (/^order\b/.test(t) || /pick ?up/.test(t) || /^(can i|i'?d like|i want|get me)/.test(t))) { const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }[om[1]] || +om[1]; return { intent: "order", qty: Math.max(1, Math.min(20, n)), item: clean(om[2], 60), when: clean(om[3] || "", 40) }; }
  if (/^order\b/.test(t)) return { intent: "order", qty: 0, item: clean(t.replace(/^order\s*/, ""), 60), when: "" };
  // replies
  const ch = /\bchange (?:my )?(?:reply|rsvp|answer)(?: for (.+?))? to (yes|in|i'?m in|going|no|out|can'?t make it|maybe)\b/.exec(t);
  if (ch) return { intent: "rsvp", response: /^(yes|in|i'?m in|going)/.test(ch[2]) ? "going" : /^maybe/.test(ch[2]) ? "maybe" : "no", event: clean(ch[1] || "", 80) };
  const rsvpEv = named(/^(?:[^,]*?)\b(?:for|to)\s+(?:the\s+)?(.+)$/);
  if (RSVP_GOING.test(t) && !/\?$/.test(t)) return { intent: "rsvp", response: "going", event: /\b(for|to)\b/.test(t) ? rsvpEv : "", bare: /^(yes|yep|yeah|yup|y)$/.test(word) };
  if (RSVP_NO.test(t)) return { intent: "rsvp", response: "no", event: /\b(for|to)\b/.test(t) ? rsvpEv : "", bare: /^(no|nope|n)$/.test(word) };
  if (RSVP_MAYBE.test(t)) return { intent: "rsvp", response: "maybe", event: /\b(for|to)\b/.test(t) ? rsvpEv : "" };
  // questions about an event
  if (/\b(who'?s (?:going|coming|in)|who is (?:going|coming|in)|who else|guest list|who'?ll be there|who said yes)\b/.test(t)) return { intent: "who", event: named(/\b(?:going to|coming to|in for|for|to|at)\s+(.+)$/) };
  if (/\b(calendar|ics|add (?:it )?to (?:my )?cal)\b/.test(t)) return { intent: "calendar", event: named(/\badd\s+(.+?)\s+to\b/) || named(/\bfor\s+(.+)$/) };
  if (/\b(bring|what do i need)\b/.test(t)) return { intent: "bring", event: named(/\b(?:to|for)\s+(.+)$/) };
  if (/\b(where is|where'?s|wheres|address|location|where)\b/.test(t)) return { intent: "where", event: named(/\b(?:where is|where'?s|wheres|address for|address of|location of)\s+(?!it\b)(.+)$/) };
  if (/\b(when is|when'?s|whens|what time|when)\b/.test(t)) return { intent: "when", event: named(/\b(?:when is|when'?s|whens|what time is)\s+(?!it\b)(.+)$/) };
  if (/\b(my plans|what'?s next|whats next|what am i doing|my week|upcoming|my events|plans)\b/.test(t)) return { intent: "plans" };
  if (/\b(this weekend|what'?s on|whats on|anything (?:on|fun|good|to do)|something to do|what'?s happening|whats happening|what should i do|recommend)\b/.test(t)) return { intent: "weekend" };
  if (/\b(talk to|speak to|speak with|talk with|reach) (?:a |an |the )?(?:person|human|someone|real person|team|people)\b|\bhuman\b|\bagent\b|\bsupport\b|\bneed help\b|\bhelp me\b|\bsomething'?s wrong\b|\bbroken\b/.test(t)) return { intent: "person" };
  if (/\b(photo|photos|picture|pictures|pics|cover|pay|payment|venmo|paypal|ticket|tickets|refund|card)\b/.test(t)) return { intent: "rich", what: /\b(pay|payment|venmo|paypal|ticket|tickets|refund|card)\b/.test(t) ? "pay" : "photos" };
  if (/^(thanks|thank you|thx|ty|cheers|ok|okay|cool|great|nice|perfect|love it)\b/.test(word)) return { intent: "thanks" };
  if (/^(hi|hey|hello|yo|sup|hiya)$/.test(word)) return { intent: "hello" };
  return { intent: "unknown" };
}
export const INTENTS = ["rsvp", "where", "when", "calendar", "bring", "who", "plans", "weekend", "ideas", "order", "person", "draft", "publish", "remind", "summary", "move", "rich", "unknown"];
/** The model's job for free text: pick one intent and (maybe) an event name. It never acts. */
export function intentPrompt(text, ctx) {
  return `POTTO-TEXT
${POTTO_TEXT_VOICE}
Read the person's text and pick what they want. Choose one intent from: ${INTENTS.join(", ")}.
For rsvp, also give response: "going", "maybe" or "no". For an event, give its name as they wrote it, or "".
If nothing fits, use "unknown" and write a short kind reply (under 200 characters) in "reply" that says what you can help with. Never invent events, people, times or places.
Reply with only JSON: {"intent": string, "response": string, "event": string, "reply": string}
<context>
${JSON.stringify(ctx)}
</context>
<text>
${clean(text, 600)}
</text>`;
}

// ---------- the module ----------
export const pottoOutbox = [];
export function makePottoText({ app, store, X, C, publicOrigin = () => process.env.ENCORE_PUBLIC_URL || "", fetchFn = (...a) => globalThis.fetch(...a) }) {
  const key = crypto.randomBytes(24).toString("hex"); // marks Potto's own loopback calls (the reply limiter keys them by person, not by 127.0.0.1)
  const ref = { port: 0, base: "" };
  const statePath = (em) => "system/pottot-" + hash(em), logPath = (em) => "system/pottotlog-" + hash(em), stopPath = (p) => "system/smsstop-" + hash(p);
  const sentPath = (k) => "system/pottotsent-" + hash(k), qPath = (id) => "system/pottotq-" + id, batchPath = (em) => "system/pottotbatch-" + hash(em), unkPath = (p) => "system/pottotunk-" + hash(p), countPath = (d) => "system/pottotcount-" + d;
  const stateOf = (em) => store.get(statePath(em))?.data || null;
  const saveState = (em, patch) => { const cur = stateOf(em) || { kind: "pottot", email: lc(em) }; const next = { ...cur, ...patch, email: lc(em) }; store.set(statePath(em), next); return next; };
  const stopped = (phone) => !!store.get(stopPath(phone));
  const baseUrl = () => String(process.env.ENCORE_PUBLIC_URL || ref.base || "").replace(/\/+$/, "");
  const link = (p) => baseUrl() + p;
  const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
  function count(k, n = 1, now = Date.now()) { try { const p = countPath(day(now)), cur = store.get(p)?.data || { kind: "pottotcount", day: day(now) }; store.set(p, { ...cur, [k]: (cur[k] || 0) + n }); } catch {} }
  function logMsg(em, dir, text, ch) { if (!em) return; const p = logPath(em), L = store.get(p)?.data?.list || []; L.push({ dir, text: String(text || "").slice(0, MAX_LEN), ch, at: Date.now() }); store.set(p, { kind: "pottotlog", email: lc(em), list: L.slice(-200) }); }
  // limits in memory (a restart forgets them, which only ever lets a few more through)
  const hits = new Map(); const over = (k, n, ms) => { const now = Date.now(), L = (hits.get(k) || []).filter((t) => now - t < ms); if (L.length >= n) { hits.set(k, L); return true; } L.push(now); hits.set(k, L); if (hits.size > 50000) hits.clear(); return false; };
  const globalOver = () => over("global", limits().globalPerMin, MIN);

  /** Who a number belongs to: a verified phone on an account, or null. */
  function accountOf(phone) {
    const em = phoneAccountOf(store, phone); if (!em) return null; const u = getDbUser(em);
    if (!u || u.phone !== phone || !u.phoneVerifiedAt || u.deleteAt) return null;
    return { email: lc(u.email), ws: u.ws, name: u.name || "", phone };
  }
  const tzOfUser = (em) => { let city = ""; try { city = app.locals.hooks?.interestsOfUser?.(em)?.city || ""; } catch {} if (!city) { try { const u = getDbUser(em), W = u?.ws ? getWorkspace(u.ws) : null; city = W?.host?.city || W?.city || ""; } catch {} } return zoneOf(city); };
  const quiet = (em, now = Date.now()) => { const h = hourIn(tzOfUser(em), now); return h >= 21 || h < 9; };
  /** The next 9am where they are. */
  function nextMorning(em, now = Date.now()) { const tz = tzOfUser(em); let t = now; for (let i = 0; i < 48 * 4 && quiet(em, t); i++) t += 15 * MIN; const h = hourIn(tz, t); return h >= 9 ? t : now + 12 * HOUR; }

  // ---------- acting as the person: the app's own API over loopback, one short session per message ----------
  function mint(u) {
    const H = []; const res = { setHeader: (k, v) => H.push(...[].concat(v)), append: (k, v) => H.push(...[].concat(v)) };
    startSession({ secure: false }, res, u.email, u.ws);
    const c = H.find((h) => /^encore_auth=/.test(h)); return c ? c.split(";")[0] : "";
  }
  function unmint(cookie) { try { const v = decodeURIComponent(cookie.split("=").slice(1).join("=")), sid = v.split(".")[2]; if (sid) store.delete("system/sess-" + crypto.createHash("sha256").update(sid).digest("hex").slice(0, 40)); } catch {} }
  async function callAs(u, method, path, body, headers = {}) {
    const port = ref.port || Number(process.env.PORT || 0); if (!port) return { ok: false, status: 0, j: { message: "Not ready yet." } };
    const cookie = mint(u);
    try { const r = await fetchFn(`http://127.0.0.1:${port}${path}`, { method, headers: { cookie, "content-type": "application/json", "x-potto-text": key, "x-potto-who": hash(u.email), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
      const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j }; }
    catch { return { ok: false, status: 0, j: {} }; } finally { unmint(cookie); }
  }
  /** Is this request one of Potto's own (so limits that key on the IP key on the person instead)? */
  const isOwn = (req) => sameStr(req.get?.("x-potto-text"), key);

  // ---------- what the person has: their replies, invites and the events they host ----------
  const plans = () => app.locals.plans;
  function evOf(id) { if (!ID.test(String(id || ""))) return null; const ws = workspaceOfEvent(id); if (!ws || ws === DEFAULT_WS) return null; const ev = scopeStore(store, ws).get("events/" + id)?.data; return ev && !ev.example ? { ws, id, ev } : null; }
  const upcoming = (ev) => !!ev && !ev.cancelled && (!ISO.test(ev.date || "") || (ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date) >= todayIn(eventTz(ev)));
  function myReplies(em) { const out = []; for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws); for (const d of S.list("rsvps")) { const r = d.data || {}; if (lc(r.email) !== em || !ID.test(r.eventId || "")) continue; const ev = S.get("events/" + r.eventId)?.data; if (!ev || ev.example) continue; out.push({ ws, id: r.eventId, ev, rid: d.id, r, at: r.changedAt || r.at || r.createdAt || 0 }); } }
    const best = new Map(); for (const x of out) if (!best.has(x.id) || x.at > best.get(x.id).at) best.set(x.id, x); return [...best.values()]; }
  function myInvites(em) { const L = (store.get("system/inbox-" + hash(em))?.data?.list || []).filter((n) => n.eventId && /^(invite|event|itson|ifwith|drop|letin|waitlist|alert|saved)$/.test(n.kind || "")).sort((a, b) => (b.at || 0) - (a.at || 0));
    const seen = new Set(), out = []; for (const n of L) { if (seen.has(n.eventId)) continue; seen.add(n.eventId); const E = evOf(n.eventId); if (E && upcoming(E.ev)) out.push({ ...E, at: n.at || 0 }); } return out; }
  function hosted(u) { if (!u.ws || u.ws === DEFAULT_WS) return []; return scopeStore(store, u.ws).list("events").filter((d) => d.data && !d.data.example && !d.data.sample && upcoming(d.data)).map((d) => ({ ws: u.ws, id: d.id, ev: d.data })).sort((a, b) => String(a.ev.date || "9").localeCompare(String(b.ev.date || "9"))); }
  const score = (name, ev) => { const words = lc(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(the|and|for|night|event)$/.test(w)), tt = lc(titleOf(ev) + " " + (ev.name || "")); if (!words.length) return tt.includes(lc(name)) && lc(name) ? 1 : 0; return words.filter((w) => tt.includes(w)).length / words.length; };
  /** The event a text means: a named one among theirs, else the one in the conversation, else the latest. */
  function pick(u, name, { role = "any", st = null } = {}) {
    const R = myReplies(u.email).filter((x) => upcoming(x.ev)), I = myInvites(u.email), H = hosted(u);
    const pool = role === "host" ? H : role === "guest" ? [...R, ...I] : [...R, ...I, ...H];
    if (name) { let best = null, bs = 0; for (const x of pool) { const s = score(name, x.ev); if (s > bs) { bs = s; best = x; } } return bs >= 0.5 ? best : null; }
    if (st?.lastEventId) { const x = pool.find((p) => p.id === st.lastEventId); if (x) return x; }
    if (role === "host") return H[0] || null;
    // the latest invite they haven't answered, else their soonest plan, else the event they host next
    const unanswered = I.filter((x) => !R.some((r) => r.id === x.id))[0]; if (unanswered) return unanswered;
    const soon = R.filter((x) => !["no", "declined"].includes(x.r.response)).sort((a, b) => String(a.ev.date || "9").localeCompare(String(b.ev.date || "9")))[0];
    return soon || (role === "any" ? H[0] : null) || null;
  }
  const peek = (u, id) => { try { return plans()?.peekOf?.(id, { email: u.email, ws: u.ws }) || null; } catch { return null; } };
  const hostFirst = (E) => first(C?.profileOf?.(E.ws)?.name || E.ev.hostName) || "your host";

  // ---------- tools: each answers in a line or two ----------
  async function rsvp(u, st, a) {
    const E = pick(u, a.event, { role: "guest", st }); if (!E) return { text: a.event ? `I couldn't find "${clean(a.event, 40)}" in your invites. Check the name, or open the invite link.` : SAY.noEvent };
    const today = todayIn(eventTz(E.ev)), when = shortDay(E.ev.date, today), title = titleOf(E.ev), page = link(`/e/${encodeURIComponent(E.id)}`), h = hostFirst(E);
    if (E.ev.cancelled) return { text: `${title} was cancelled, sorry. ${h} will be bummed too. Want me to find something else? Text "what's on this weekend".`, eventId: E.id };
    const mine = myReplies(u.email).find((x) => x.id === E.id);
    let r;
    if (mine) r = await callAs(u, "POST", `/api/plans/peek/${encodeURIComponent(E.id)}/reply`, { response: a.response, tz: eventTz(E.ev) });
    else {
      if (E.ev.drop || E.ev.preorder) return { text: `${title} is an order, so pick what you'd like here: ${page}. Or text me something like "2 cakes for sat pickup".`, eventId: E.id };
      if (E.ev.approvalRequired && a.response === "going") return { text: `${h} lets each guest in for ${title}. Ask to join here: ${page}`, eventId: E.id };
      if (E.ev.price && E.ev.price !== "chip" && !E.ev.free && a.response === "going") return { text: `${title} has a price, so hold your spot on the page: ${page}`, eventId: E.id };
      const code = Array.from(crypto.randomBytes(6), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
      r = await callAs(u, "POST", "/api/db/collection?path=rsvps", { eventId: E.id, response: a.response, name: clean(u.name, 80) || "Guest", email: u.email, code, createdAt: Date.now(), via: "potto-text", showMe: true }, { "x-encore-guest": "1", "x-encore-workspace": E.ws, "x-encore-key": "potto-" + hash(u.email) });
    }
    if (!r.ok) { if (r.j?.code === "needs_page") return { text: `${clean(r.j.message, 160)} ${page}`, eventId: E.id }; if (r.j?.code === "closed") return { text: `${clean(r.j.message, 120)} Sorry about that.`, eventId: E.id }; return { text: r.j?.message ? `${clean(r.j.message, 200)} ${page}` : SAY.oops, eventId: E.id }; }
    const now = myReplies(u.email).find((x) => x.id === E.id)?.r?.response || r.j?.response || r.j?.data?.response || a.response;
    const text = now === "going" ? `You're in for ${title}${when ? ` ${/^(today|tomorrow)$/.test(when) ? when : "on " + when}` : ""}. I'll text you the address the day before.`
      : now === "waitlist" ? `${title} is full right now, sorry, so you're on the waitlist. I'll tell you the second a spot opens.`
      : now === "requested" ? `Asked. ${h} lets each guest in, so I'll text you as soon as they do.`
      : now === "maybe" ? `Marked you as maybe for ${title}. Text "I'm in" when you know.`
      : `Got it, you're out for ${title}. Thanks for telling ${h}, that really helps.`;
    return { text, eventId: E.id };
  }
  function where(u, st, a) { const E = pick(u, a.event, { st }); if (!E) return { text: SAY.noEvent }; const P = peek(u, E.id); if (!P) return { text: SAY.noEvent };
    if (P.online) return { text: `${P.title} is online. The link is on the event page: ${link(P.invite)}`, eventId: E.id };
    if (P.address && !P.locked) return { text: `${P.title}: ${P.address}.${P.place && !P.address.includes(P.place) ? ` ${P.place}.` : ""}`, eventId: E.id };
    return { text: `${P.title} is in ${P.place || "the area on the invite"}. ${P.host?.first || "The host"} shares the exact address once you're in.`, eventId: E.id }; }
  function when(u, st, a) { const E = pick(u, a.event, { st }); if (!E) return { text: SAY.noEvent }; const P = peek(u, E.id); if (!P) return { text: SAY.noEvent };
    return { text: `${P.title} is ${String(P.when || "").replace(/\s*·\s*/g, " at ")}${P.time && !/\d(am|pm)/.test(P.when) ? ` at ${prettyTime(P.time)}` : ""}.${P.reply?.state === "going" ? " You're in." : ""}`, eventId: E.id }; }
  function calendar(u, st, a) { const E = pick(u, a.event, { st }); if (!E) return { text: SAY.noEvent }; const mine = myReplies(u.email).find((x) => x.id === E.id), isHost = E.ws === u.ws;
    if (!ISO.test(E.ev.date || "")) return { text: `${titleOf(E.ev)} doesn't have a date yet. I'll tell you when it does.`, eventId: E.id };
    const q = mine ? `?rid=${encodeURIComponent(mine.rid)}&code=${encodeURIComponent(mine.r.code || "")}` : "";
    return { text: mine || isHost || E.ev.discoverable ? `Tap to add ${titleOf(E.ev)} to your calendar: ${link(`/plans/ics/${encodeURIComponent(E.id)}.ics${q}`)}` : `Reply to ${titleOf(E.ev)} first, then I can add it: ${link(`/e/${encodeURIComponent(E.id)}`)}`, eventId: E.id }; }
  function bring(u, st, a) { const E = pick(u, a.event, { st }); if (!E) return { text: SAY.noEvent }; let P = null; try { P = plans()?.planOf?.(E.id, { email: u.email, ws: u.ws }); } catch {}
    const B = P?.bring || [], inc = P?.included || [];
    if (!B.length && !inc.length) return { text: `${hostFirst(E)} didn't ask for anything for ${titleOf(E.ev)}. Just bring yourself.`, eventId: E.id };
    return { text: `For ${titleOf(E.ev)}: ${B.length ? `bring ${list(B.slice(0, 4).map(lc))}` : "nothing to bring"}.${inc.length ? ` ${hostFirst(E)} has ${list(inc.slice(0, 3).map(lc))} covered.` : ""}`, eventId: E.id }; }
  function who(u, st, a) {
    const E = pick(u, a.event, { st }); if (!E) return { text: SAY.noEvent };
    if (E.ws === u.ws) { const R = scopeStore(store, E.ws).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === E.id), names = (k) => [...new Set(R.filter((r) => r.response === k).map((r) => first(r.name)).filter(Boolean))];
      const g = names("going"), m = names("maybe"), w = names("waitlist"), ask = names("requested"), spots = +E.ev.headcount || 0;
      if (!R.length) return { text: `No replies yet for ${titleOf(E.ev)}. Want me to nudge people? Text "remind my guests".`, eventId: E.id };
      return { text: `${titleOf(E.ev)}: ${g.length ? `${g.length} in (${list(g.slice(0, 6))}${g.length > 6 ? " and more" : ""})` : "nobody in yet"}${m.length ? `, ${m.length} maybe` : ""}${ask.length ? `, ${ask.length} asking to join` : ""}${w.length ? `, ${w.length} waiting` : ""}.${spots ? ` ${Math.max(0, spots - g.length)} of ${spots} spots open.` : ""}`, eventId: E.id }; }
    const P = peek(u, E.id); if (!P) return { text: SAY.noEvent };
    if (!P.who) return { text: `${P.host?.first || "The host"} keeps the guest list private on ${P.title}. It'll be a nice surprise.`, eventId: E.id };
    const N = (P.who.names || []).filter((n) => !n.you).map((n) => n.name), others = Math.max(0, P.who.count - (P.reply?.state === "going" ? 1 : 0));
    if (N.length) return { text: `${N.length >= others ? list(N) : `${list(N)} and ${others - N.length} more`} ${N.length === 1 && N.length >= others ? "is" : "are"} in for ${P.title}${P.reply?.state === "going" ? ", plus you" : ""}.`, eventId: E.id };
    return { text: P.who.count ? `${P.who.count} ${P.who.count === 1 ? "person is" : "people are"} in for ${P.title} so far. You'll see names once you're in.` : `Nobody's in for ${P.title} yet. You could be the first yes.`, eventId: E.id };
  }
  function myPlans(u) { let T = null; try { T = plans()?.timeline?.({ email: u.email, ws: u.ws, tz: tzOfUser(u.email) }); } catch {} const L = (T?.items || []).filter((i) => i.kind !== "saved").slice(0, 3);
    if (!L.length) return { text: SAY.nothingNext };
    return { text: `Coming up: ${L.map((i) => `${shortDay(i.date, T.today)}${i.time ? " " + prettyTime(i.time) : ""}, ${clean(i.title, 40)}${i.kind === "hosting" ? " (you're hosting)" : i.kind === "waitlist" ? " (waitlist)" : ""}`).join("; ")}. All of it: ${link("/plans")}`, eventId: L[0]?.eventId }; }
  function weekend(u) { const H = app.locals.hooks, b = baseUrl(); let D = null; try { D = H?.digest?.(b, u.email); } catch {}
    let L = (D?.events || []).slice(0, 3); if (!L.length) { try { L = (H?.weekend?.(b, { city: H?.interestsOfUser?.(u.email)?.city || "" })?.events || []).slice(0, 3); } catch {} }
    if (!L.length) return { text: `Nothing I can see this weekend yet. Hosts post all week, so check back, or browse here: ${link("/discover")}` };
    const abs = (x) => (/^https?:/.test(x) ? x : link(x));
    return { text: `This weekend: ${L.map((e, i) => `${i + 1}. ${clean(e.title, 40)}, ${clean(e.when, 24)}${e.area || e.city ? ", " + clean(e.area || e.city, 24) : ""} ${abs(e.url)}`).join(" ")}` }; }
  // ideas to host: what people here loved first, each with its source (server/trends.js)
  function ideasText(u) { let L = []; try { L = (app.locals.trends?.forPotto(u, { n: 3 }) || []).slice(0, 3); } catch {}
    if (!L.length) return { text: `A few to start from are on the Ideas page: ${link("/ideas")}` };
    const say = (x) => `${clean(x.title, 40)} (${clean(x.label, 60)})`; let text = `Ideas to host: ${L.map((x, i) => `${i + 1}. ${say(x)}`).join(" ")} Reply with one and a day, like "${clean(L[0].title, 30).toLowerCase()} sat 7pm", and I'll draft it.`;
    if (text.length > 600) text = text.slice(0, 597) + "...";
    return { text }; }
  // drops: the ones they can see (invited, following the host, or ordered before)
  function dropsFor(u) { const out = new Map(), add = (E) => { if (E?.ev?.drop && upcoming(E.ev) && !E.ev.ordersPaused) out.set(E.id, E); };
    for (const x of [...myInvites(u.email), ...myReplies(u.email)]) add(x);
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; let f = false; try { f = (C?.followersOf?.(ws) || []).some((x) => lc(x.email) === u.email); } catch {} if (!f) continue; for (const d of scopeStore(store, ws).list("events")) if (d.data?.drop && (d.data.discoverable || d.data.published)) add({ ws, id: d.id, ev: d.data }); }
    return [...out.values()]; }
  function order(u, st, a) {
    const D = dropsFor(u); if (!D.length) return { text: `I don't see a drop you can order from right now. When a host you follow opens one, I can take your order here.` };
    const itemWords = lc(a.item).replace(/\b(please|thanks?)\b/g, "").trim(); let best = null, bs = 0;
    for (const E of D) for (const [i, x] of (E.ev.orderItems || []).entries()) { const nm = lc(x.name), w = itemWords.split(/\s+/).filter((t) => t.length >= 3).map((t) => t.replace(/s$/, "")); const s = w.length ? w.filter((t) => nm.includes(t)).length / w.length : 0; if (s > bs) { bs = s; best = { E, i, x }; } }
    if (!best || bs < 0.5 || !a.qty) { const E = D[0], menu = (E.ev.orderItems || []).slice(0, 4).map((x) => `${x.name} ($${priceOf(x.price)})`); return { text: `${titleOf(E.ev)} has ${list(menu)}. Text me what you'd like, like "2 ${lc(menu[0] || "items").replace(/\s*\(.*$/, "")} for ${lc((E.ev.slots || ["sat"])[0]).split(" ")[0]} pickup".`, eventId: E.id }; }
    const slots = best.E.ev.slots || [], wd = lc(a.when).slice(0, 3), slot = slots.length === 1 ? slots[0] : slots.find((s) => wd && lc(s).startsWith(wd)) || "";
    if (slots.length > 1 && !slot) return { text: `Which pickup works: ${list(slots.slice(0, 4))}? Text it with your order, like "${a.qty} ${a.item} for ${lc(slots[0]).split(" ")[0]} pickup".`, eventId: best.E.id };
    const total = priceOf(best.x.price) * a.qty, from = clean(C?.profileOf?.(best.E.ws)?.name, 40) || hostFirst(best.E);
    return { text: `${a.qty} × ${best.x.name} ($${total % 1 ? total.toFixed(2) : total})${slot ? `, pickup ${slot}` : ""}, from ${from}. Reply YES to place it, or NO to skip.`, eventId: best.E.id,
      pending: { type: "order", eventId: best.E.id, ws: best.E.ws, i: best.i, qty: a.qty, slot, name: best.x.name } };
  }
  async function placeOrder(u, p) {
    const E = evOf(p.eventId); if (!E?.ev?.drop) return { text: "That drop isn't open any more, sorry." };
    const code = Array.from(crypto.randomBytes(6), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    const r = await callAs(u, "POST", "/api/db/collection?path=rsvps", { eventId: E.id, response: "going", name: clean(u.name, 80) || "Guest", email: u.email, phone: u.phone, contactVia: "sms", slot: p.slot, orderQty: [{ i: p.i, qty: p.qty }], code, createdAt: Date.now(), via: "potto-text" }, { "x-encore-guest": "1", "x-encore-workspace": E.ws, "x-encore-key": "potto-" + hash(u.email) });
    if (!r.ok) return { text: r.j?.code === "sold_out" ? `${clean(r.j.message, 160)} Sorry, it's been a popular one.` : r.j?.message ? clean(r.j.message, 200) : SAY.oops, eventId: E.id };
    return { text: `Placed: ${p.qty} × ${p.name}${p.slot ? `, pickup ${p.slot}` : ""}. I'll text you when it's ready. Your order: ${link(`/e/${encodeURIComponent(E.id)}`)}`, eventId: E.id };
  }
  async function person(u, st, text) {
    const T = (store.get(logPath(u.email))?.data?.list || []).slice(-6).map((m) => ({ role: m.dir === "in" ? "host" : "potto", text: m.text }));
    const r = await callAs(u, "POST", "/api/help/ticket", { message: clean(text, 2000), transcript: T, page: "/text", phone: u.phone, topic: "" });
    if (!r.ok) return { text: r.status === 429 ? "We've got your messages, and a person will reply soon. Thanks for your patience." : SAY.oops };
    return { text: `Done. I passed this to a person on the team, and they'll reply by email${r.j?.expect ? "" : " soon"}. Thanks for telling us.` };
  }
  function rich(u, st, a) { const E = pick(u, "", { st }); const to = E ? `/e/${encodeURIComponent(E.id)}` : a.what === "pay" ? "/plans" : "/feed";
    return { text: a.what === "pay" ? `Payments are easier in the app, where it's safe: ${link(to)}` : `Photos look better in the app. Here you go: ${link(E && E.ws === u.ws ? `/?app=1&open=${encodeURIComponent(E.id)}#studio` : to)}`, eventId: E?.id }; }
  // ---- hosts ----
  async function draft(u, st, a) {
    if (!u.ws || u.ws === DEFAULT_WS) return { text: "Hosting starts in the app. Open it here: " + link("/?app=1&new=1") };
    const D = a.draft, body = { name: D.title, pubTitle: D.title, date: D.date, startTime: D.startTime, ...(D.meetPoint ? { meetPoint: D.meetPoint } : {}), ...(D.headcount ? { headcount: D.headcount } : {}), casual: true, published: false, createdVia: "potto-text" };
    const r = await callAs(u, "POST", "/api/db/collection?path=events", body); const id = r.j?.id || String(r.j?.path || "").split("/").pop();
    if (!r.ok || !id) return { text: r.j?.message ? clean(r.j.message, 200) : SAY.oops };
    const today = todayIn(tzOfUser(u.email));
    return { text: `Drafted ${D.title}: ${shortDay(D.date, today)} at ${prettyTime(D.startTime)}${D.meetPoint ? `, ${D.meetPoint === "My place" ? "at your place" : "at " + D.meetPoint}` : ""}${D.headcount ? `, ${D.headcount} spots` : ""}. Look it over: ${link(`/?app=1&open=${encodeURIComponent(id)}#studio`)} Text "publish" when it's ready. Nothing goes out until then.`,
      eventId: id, pending: { type: "publish", eventId: id } };
  }
  async function publish(u, p) { const E = evOf(p.eventId); if (!E || E.ws !== u.ws) return { text: "I couldn't find that draft. It's in the app: " + link("/?app=1") };
    if (E.ev.published) return { text: `${titleOf(E.ev)} is already live. Share it: ${link(`/e/${encodeURIComponent(E.id)}`)}`, eventId: E.id };
    const r = await callAs(u, "PATCH", `/api/db/doc?path=${encodeURIComponent("events/" + E.id)}`, { published: true });
    if (!r.ok) return { text: r.j?.message ? clean(r.j.message, 220) : SAY.oops, eventId: E.id };
    return { text: `${titleOf(E.ev)} is live. Send it to your people: ${link(`/e/${encodeURIComponent(E.id)}`)}`, eventId: E.id }; }
  function remind(u, st, a) { const E = pick(u, a.event, { role: "host", st }); if (!E) return { text: "You don't have an upcoming event to remind people about. Text me one to draft, like \"dumpling night sat 7pm at mine for 8\"." };
    const going = scopeStore(store, E.ws).list("rsvps").filter((d) => d.data?.eventId === E.id && d.data?.response === "going").length; if (!going) return { text: `Nobody's in for ${titleOf(E.ev)} yet, so there's no one to remind. Share it: ${link(`/e/${encodeURIComponent(E.id)}`)}`, eventId: E.id };
    const today = todayIn(eventTz(E.ev)), msg = `Reminder: ${titleOf(E.ev)} is ${shortDay(E.ev.date, today)}${E.ev.startTime ? ` at ${prettyTime(E.ev.startTime)}` : ""}. Can't wait to see you.`;
    return { text: `I'll post this in the ${titleOf(E.ev)} chat for your ${going} ${going === 1 ? "guest" : "guests"}: "${msg}" Reply YES to send.`, eventId: E.id, pending: { type: "remind", eventId: E.id, msg } }; }
  async function sendRemind(u, p) { const r = await callAs(u, "POST", `/api/chats/${encodeURIComponent(p.eventId)}/messages`, { text: p.msg }); return { text: r.ok ? "Sent. It's in the group chat, and your guests will see it." : r.j?.message ? clean(r.j.message, 200) : SAY.oops, eventId: p.eventId }; }
  function summary(u) { const H = hosted(u).filter((x) => ISO.test(x.ev.date || "")).slice(0, 4); if (!H.length) return { text: `Nothing on your hosting list right now. Text me one to draft, like "dumpling night sat 7pm at mine for 8".` };
    const since = Date.now() - DAY, today = todayIn(tzOfUser(u.email));
    const parts = H.map((E) => { const R = scopeStore(store, E.ws).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === E.id), g = R.filter((r) => r.response === "going").length, m = R.filter((r) => r.response === "maybe").length, ask = R.filter((r) => r.response === "requested").length, fresh = R.filter((r) => (r.changedAt || r.at || r.createdAt || 0) > since).length;
      return `${titleOf(E.ev)} (${shortDay(E.ev.date, today)}): ${g} in${m ? `, ${m} maybe` : ""}${ask ? `, ${ask} asking` : ""}${fresh ? `, ${fresh} new today` : ""}`; });
    return { text: `Today: ${parts.join("; ")}.`, eventId: H[0].id }; }
  function move(u, st, a) { const E = pick(u, a.event, { role: "host", st }); if (!E) return { text: "Which event? Text its name, like \"move dumpling night to 8pm\"." };
    const patch = { ...(a.time ? { startTime: a.time } : {}), ...(a.date ? { date: a.date } : {}) }; if (!Object.keys(patch).length) return { text: "What time should it move to? Text something like \"move it to 8pm\"." };
    const going = scopeStore(store, E.ws).list("rsvps").filter((d) => d.data?.eventId === E.id && ["going", "maybe"].includes(d.data?.response)).length, today = todayIn(eventTz(E.ev));
    const to = [a.date ? shortDay(a.date, today) : shortDay(E.ev.date, today), a.time ? `at ${prettyTime(a.time)}` : E.ev.startTime ? `at ${prettyTime(E.ev.startTime)}` : ""].filter(Boolean).join(" ");
    return { text: `Move ${titleOf(E.ev)} to ${to}?${going ? ` I'll let your ${going} ${going === 1 ? "guest" : "guests"} know.` : ""} Reply YES to move it.`, eventId: E.id, pending: { type: "move", eventId: E.id, patch, to } }; }
  async function doMove(u, p) { const r = await callAs(u, "PATCH", `/api/db/doc?path=${encodeURIComponent("events/" + p.eventId)}`, p.patch);
    return { text: r.ok ? `Moved. It's now ${p.to}, and your guests will hear about it.` : r.j?.message ? clean(r.j.message, 200) : SAY.oops, eventId: p.eventId }; }

  // ---------- one message in, one reply out ----------
  async function modelIntent(u, text, st) {
    const mode = aiMode(); if (mode === "missing_key") return null;
    const ctx = { first: first(u.name), host: hosted(u).length > 0, events: [...myReplies(u.email).filter((x) => upcoming(x.ev)), ...hosted(u)].slice(0, 8).map((x) => titleOf(x.ev)) };
    try { const r = await Promise.race([complete({ prompt: intentPrompt(text, ctx), effort: "low" }), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 8000))]);
      const j = parseJsonLoose(r.text); if (!j || typeof j !== "object" || !INTENTS.includes(j.intent)) return null;
      return { intent: j.intent, response: ["going", "maybe", "no"].includes(j.response) ? j.response : "going", event: clean(j.event, 80), reply: clean(j.reply, 240) }; }
    catch { return null; }
  }
  async function answer(u, text, now = Date.now()) {
    let st = stateOf(u.email) || {}; const pend = st.pending && now - (st.pending.at || 0) < 30 * MIN ? st.pending : null;
    let a = readIntent(text, { today: todayIn(tzOfUser(u.email), now), pending: pend });
    if (st.pending && !pend && /^(yes|y|yep|yeah|ok|okay|confirm|send|publish|place it)$/i.test(clean(text, 20))) { saveState(u.email, { pending: null }); return { text: SAY.expired }; }
    if (a.intent === "unknown") { const m = await modelIntent(u, text, st); if (m && m.intent !== "unknown") a = { ...m, ...(m.intent === "draft" ? { draft: parseDraft(text, todayIn(tzOfUser(u.email), now)) } : {}) }; else if (m?.reply) return { text: m.reply }; }
    // a bare "yes" with nothing to say yes to answers the latest invite, if there's one waiting
    if (a.intent === "rsvp" && a.bare && !myInvites(u.email).some((x) => !myReplies(u.email).some((r) => r.id === x.id))) return { text: `Yes to what? ${SAY.menu(hosted(u).length > 0)}` };
    const isHost = hosted(u).length > 0;
    switch (a.intent) {
      case "confirm": { saveState(u.email, { pending: null }); const p = pend; if (p.type === "order") return placeOrder(u, p); if (p.type === "remind") return sendRemind(u, p); if (p.type === "move") return doMove(u, p); if (p.type === "publish") return publish(u, p); return { text: SAY.cancelled }; }
      case "cancel": saveState(u.email, { pending: null }); return { text: SAY.cancelled };
      case "rsvp": return rsvp(u, st, a);
      case "where": return where(u, st, a);
      case "when": return when(u, st, a);
      case "calendar": return calendar(u, st, a);
      case "bring": return bring(u, st, a);
      case "who": return who(u, st, a);
      case "plans": return myPlans(u);
      case "weekend": return weekend(u);
      case "ideas": return ideasText(u);
      case "order": return order(u, st, a);
      case "person": return person(u, st, text);
      case "rich": return rich(u, st, a);
      case "draft": return a.draft?.title && a.draft?.date && a.draft?.startTime ? draft(u, st, a) : { text: "Tell me the name, day and time, like \"dumpling night sat 7pm at mine for 8\", and I'll draft it." };
      case "publish": { const E = a.event ? pick(u, a.event, { role: "host" }) : pend?.type === "publish" ? evOf(pend.eventId) : st.lastEventId && evOf(st.lastEventId)?.ws === u.ws ? evOf(st.lastEventId) : null;
        if (!E) return { text: "Which draft? Text \"publish\" and its name, or tap Publish in the app." }; saveState(u.email, { pending: null }); return publish(u, { eventId: E.id }); }
      case "remind": return remind(u, st, a);
      case "summary": return summary(u);
      case "move": return move(u, st, a);
      case "thanks": return { text: "Anytime. I'm here when you need me." };
      case "hello": return { text: `Hi${first(u.name) ? " " + first(u.name) : ""}, it's Potto. ${SAY.menu(isHost)}` };
      default: return { text: SAY.menu(isHost) };
    }
  }

  /** Handle one inbound text. Returns the reply ("" for none). ch: "sms" | "whatsapp". */
  async function inbound({ from, body, ch, now = Date.now() }) {
    const phone = toE164(String(from || "").replace(/^whatsapp:/i, "")); if (!phone) return "";
    const text = clean(body, 1000), a0 = readIntent(text, {});
    count("in", 1, now);
    if (over("in:" + phone, limits().perHour, HOUR)) return over("slow:" + phone, 1, HOUR) ? "" : SAY.slow;
    const u = accountOf(phone);
    // STOP works for every number, known or not: recorded on the shared stop list, and nothing more is sent
    if (a0.intent === "stop") { store.set(stopPath(phone), { kind: "smsstop", phone, at: now, via: "potto-" + ch }); if (u) { saveState(u.email, { on: false, stoppedAt: now }); logMsg(u.email, "in", text, ch); } count("stops", 1, now); console.log(`[pottotext] stop from ${maskPhone(phone)}`);
      return ch === "whatsapp" ? SAY.stopped : ""; } // SMS: the carrier's own opt-out confirmation goes out (Twilio Advanced Opt-Out)
    if (!u) { if (a0.intent === "help") return SAY.help(link("/help"), supportEmail()); count("unknown", 1, now); if (store.get(unkPath(phone))?.data?.at > now - DAY) return ""; store.set(unkPath(phone), { kind: "pottotunk", at: now }); return SAY.unknown(link("/settings#text")); }
    logMsg(u.email, "in", text, ch);
    const reply = async (t) => { const out = capText(t, MAX_LEN); logMsg(u.email, "out", out, ch); count("out", 1, now); return out; };
    if (a0.intent === "start") { store.delete(stopPath(phone)); saveState(u.email, { on: true, onAt: now, stoppedAt: null, channel: ch, consent: { at: now, how: "texted START", ch } }); return reply(SAY.started); }
    if (a0.intent === "help") return reply(SAY.help(link("/help"), supportEmail()));
    const st = stateOf(u.email);
    if (stopped(phone)) return ""; // after STOP: nothing but START and HELP get an answer
    if (!st?.on) { if (over("noton:" + phone, 1, DAY)) return ""; return reply(SAY.notOn(first(u.name), link("/settings#text"))); }
    saveState(u.email, { channel: ch, ...(ch === "whatsapp" ? { waAt: now } : {}), lastInAt: now });
    let out; try { out = await answer(u, text, now); } catch (e) { console.warn("[pottotext] answer failed:", e?.message); out = { text: SAY.oops }; }
    saveState(u.email, { ...(out.eventId ? { lastEventId: out.eventId } : {}), ...(out.pending ? { pending: { ...out.pending, at: now } } : {}) });
    return reply(out.text);
  }
  const supportEmail = () => String(process.env.ENCORE_SUPPORT_EMAIL || process.env.ENCORE_SAFETY_EMAIL || "").split(/[\s,]+/).find((x) => /@/.test(x)) || "";

  // ---------- sending ----------
  /** Send one message now. Never throws. kind picks the WhatsApp template outside the 24-hour window. */
  async function send({ to, text, ch = "sms", kind = "", vars = [], now = Date.now() }) {
    const cfg = textConfig(), out = capText(text, MAX_LEN); if (!cfg.on) return { ok: false, error: "off" };
    if (stopped(to)) return { ok: false, error: "stopped" };
    if (globalOver()) return { ok: false, error: "busy", retry: true };
    const C2 = ch === "whatsapp" ? cfg.whatsapp : cfg.sms; if (!C2) return { ok: false, error: "no_channel" };
    let template = null;
    if (ch === "whatsapp") { const u = accountOf(to), st = u ? stateOf(u.email) : null; if (!st?.waAt || now - st.waAt > 24 * HOUR - 10 * MIN) { const t = templateOf(kind); if (!t) return { ok: false, error: "needs_template" }; template = { name: t, vars }; } }
    if (C2.service === "fake") { pottoOutbox.push({ to, ch, text: template ? "" : out, template, at: now }); if (pottoOutbox.length > 500) pottoOutbox.splice(0, 100); return { ok: true, template: !!template }; }
    try {
      let r;
      if (C2.service === "twilio") { const dest = ch === "whatsapp" ? "whatsapp:" + to : to;
        const p = new URLSearchParams({ To: dest, ...(C2.from.startsWith("MG") ? { MessagingServiceSid: C2.from } : { From: C2.from }), ...(template ? { ContentSid: template.name, ContentVariables: JSON.stringify(Object.fromEntries(template.vars.map((v, i) => [String(i + 1), clean(v, 200)]))) } : { Body: out }) });
        r = await fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(C2.sid)}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${C2.sid}:${C2.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: p, signal: AbortSignal.timeout(10_000) }); }
      else { const payload = template ? { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template", template: { name: template.name, language: { code: process.env.POTTO_WA_TEMPLATE_LANG || "en_US" }, components: template.vars.length ? [{ type: "body", parameters: template.vars.map((v) => ({ type: "text", text: clean(v, 200) })) }] : [] } } : { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body: out } };
        r = await fetchFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(C2.phoneId)}/messages`, { method: "POST", headers: { Authorization: "Bearer " + C2.token, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) }); }
      return r.ok ? { ok: true, template: !!template } : { ok: false, error: "provider " + r.status };
    } catch { return { ok: false, error: "unreachable" }; }
  }
  /** A message Potto starts: only for people who turned it on, never in quiet hours (queued for 9am), never to a muted host. */
  function enqueue(em, { key: k, kind, text, vars = [], eventId = "" }, now = Date.now()) {
    if (!k || store.get(sentPath(k))) return false; const st = stateOf(em); if (!st?.on || !st.phone) return false;
    store.set(sentPath(k), { kind: "pottotsent", at: now, email: lc(em) });
    const id = crypto.randomBytes(8).toString("hex"); store.set(qPath(id), { kind: "pottotq", id, email: lc(em), k, type: kind, text, vars, eventId, at: now, notBefore: quiet(em, now) ? nextMorning(em, now) : now }); return true;
  }
  const mutedHost = (em, eventId) => { if (!eventId) return false; const ws = workspaceOfEvent(eventId), h = ws ? C?.profileOf?.(ws)?.handle : ""; const M = store.get("system/inboxprefs-" + hash(em))?.data?.mutedHosts || []; return !!h && M.map(lc).includes(lc(h)); };
  async function flushQueue(now = Date.now()) { let sent = 0;
    for (const d of store.listPrefix("system", "pottotq-")) { const q = d.data; if (q?.kind !== "pottotq") continue; if (q.notBefore > now) continue;
      const st = stateOf(q.email); if (!st?.on || !st.phone || stopped(st.phone) || mutedHost(q.email, q.eventId)) { store.delete("system/" + d.id); continue; }
      if (quiet(q.email, now)) { store.update("system/" + d.id, { notBefore: nextMorning(q.email, now) }); continue; }
      const dk = st.sentDay?.day === day(now) ? st.sentDay.n : 0; if (dk >= limits().daily) { store.update("system/" + d.id, { notBefore: now + 12 * HOUR }); continue; }
      const r = await send({ to: st.phone, text: q.text, ch: st.channel === "whatsapp" ? "whatsapp" : textConfig().sms ? "sms" : "whatsapp", kind: q.type, vars: q.vars, now });
      if (r.retry) continue; store.delete("system/" + d.id);
      if (r.ok) { sent++; saveState(q.email, { sentDay: { day: day(now), n: dk + 1 } }); logMsg(q.email, "out", r.template ? `[template ${q.type}] ${q.text}` : q.text, st.channel || "sms"); count("out", 1, now); count("proactive", 1, now); }
      else console.log(`[pottotext] not sent (${r.error}) to ${maskPhone(st.phone)}`); }
    return sent; }
  // the day before an event they're in
  function queueReminders(now = Date.now()) { let n = 0;
    for (const d of store.listPrefix("system", "pottot-")) { const st = d.data; if (st?.kind !== "pottot" || !st.on || !st.phone) continue; const u = { email: st.email, ws: getDbUser(st.email)?.ws || "" };
      for (const x of myReplies(st.email)) { if (x.r.response !== "going" || x.ev.cancelled || !ISO.test(x.ev.date || "")) continue; const tz = eventTz(x.ev); if (addDays(todayIn(tz, now), 1) !== x.ev.date) continue;
        const P = peek(u, x.id), where2 = P?.address && !P.locked ? P.address : P?.place || "";
        if (enqueue(st.email, { key: `rem|${st.email}|${x.id}|${x.ev.date}|${x.ev.startTime || ""}`, kind: "reminder", eventId: x.id, vars: [first(getDbUser(st.email)?.name) || "there", titleOf(x.ev), prettyTime(x.ev.startTime) || "the time on the invite"],
          text: `Tomorrow: ${titleOf(x.ev)}${x.ev.startTime ? ` at ${prettyTime(x.ev.startTime)}` : ""}${where2 ? `, ${where2}` : ""}. Text "can't make it" if plans change. See you there.` }, now)) n++; } }
    return n; }
  // replies to a host's event: the first yes right away, the rest in one text every half hour or so
  function onReply(hostEm, item, now = Date.now()) {
    const m = /^rsvp-([A-Za-z0-9_-]+?)-(going|maybe|no|declined|waitlist|requested)$/.exec(String(item.key || "")); if (!m || !item.eventId) return;
    const E = evOf(item.eventId); if (!E) return; const r = scopeStore(store, E.ws).get("rsvps/" + m[1])?.data; if (!r) return; const who = first(r.name) || "Someone";
    const goingN = scopeStore(store, E.ws).list("rsvps").filter((d) => d.data?.eventId === E.id && d.data?.response === "going").length;
    if (m[2] === "going" && goingN === 1) return enqueue(hostEm, { key: `first|${E.id}`, kind: "replies", eventId: E.id, vars: [titleOf(E.ev), `${who} is coming`], text: `Your first yes just came in for ${titleOf(E.ev)}: ${who}'s coming. Nice.` }, now);
    const p = batchPath(hostEm), B = store.get(p)?.data || { kind: "pottotbatch", email: lc(hostEm), items: [], firstAt: now };
    B.items = [...B.items.filter((x) => x.rid !== m[1]), { rid: m[1], who, state: m[2], eventId: E.id, title: titleOf(E.ev) }].slice(-40); store.set(p, B);
  }
  function flushBatches(now = Date.now()) { let n = 0;
    for (const d of store.listPrefix("system", "pottotbatch-")) { const B = d.data; if (!B?.items?.length || now - (B.firstAt || 0) < limits().batchMin * MIN) continue; store.delete("system/" + d.id);
      const byEv = new Map(); for (const x of B.items) { if (!byEv.has(x.eventId)) byEv.set(x.eventId, []); byEv.get(x.eventId).push(x); }
      const parts = [...byEv.values()].map((L) => { const g = L.filter((x) => x.state === "going").map((x) => x.who), mb = L.filter((x) => x.state === "maybe").map((x) => x.who), no = L.filter((x) => /no|declined/.test(x.state)).map((x) => x.who), ask = L.filter((x) => x.state === "requested").map((x) => x.who);
        return `${L[0].title}: ${[g.length ? `${list(g)} ${g.length === 1 ? "is" : "are"} in` : "", mb.length ? `${list(mb)} said maybe` : "", no.length ? `${list(no)} can't make it` : "", ask.length ? `${list(ask)} asked to join` : ""].filter(Boolean).join(", ")}`; });
      const text = `New replies. ${parts.join(". ")}. Text "who's in" for the list.`;
      if (enqueue(B.email, { key: `batch|${B.email}|${B.firstAt}`, kind: "replies", eventId: B.items[0].eventId, vars: [B.items[0].title, parts.join(". ").slice(0, 200)], text }, now)) n++; }
    return n; }
  // the bell: replies (hosts) and "a spot opened up" (guests), read off the same store changes push uses
  function fromInbox(path, now = Date.now()) {
    const d = store.get(path)?.data; if (!d?.email || !Array.isArray(d.list)) return; const em = lc(d.email), st = stateOf(em); if (!st?.on) return;
    const last = st.inboxAt || st.onAt || 0, fresh = d.list.filter((n) => (n.at || 0) > last); if (!fresh.length) return;
    saveState(em, { inboxAt: Math.max(...fresh.map((n) => n.at || 0)) });
    for (const n of fresh) { if (n.kind === "reply") onReply(em, n, now);
      else if (n.kind === "waitlist" && /^in-/.test(n.key || "")) { const E = evOf(n.eventId); if (E) enqueue(em, { key: `wl|${n.key}`, kind: "waitlist", eventId: E.id, vars: [titleOf(E.ev), link(`/e/${encodeURIComponent(E.id)}`)], text: `Good news: a spot opened up for ${titleOf(E.ev)}, and it's yours. You're in. Details: ${link(`/e/${encodeURIComponent(E.id)}`)}` }, now); } }
  }
  // an order marked ready by the host
  function fromRsvp(path, now = Date.now()) {
    const m = /^ws\/([^/]+)\/rsvps\/([^/]+)$/.exec(path); if (!m) return; const r = store.get(path)?.data; if (!r || r.orderStatus !== "ready" || !r.email) return;
    const em = lc(r.email); if (!stateOf(em)?.on) return; const ev = scopeStore(store, m[1]).get("events/" + r.eventId)?.data; if (!ev) return;
    const from = clean(C?.profileOf?.(m[1])?.name, 40) || "your host", slot = clean(r.pickupLabel || r.slot, 40);
    enqueue(em, { key: `ready|${m[2]}|${r.readyAt || ""}`, kind: "ready", eventId: r.eventId, vars: [from, slot ? `Pickup ${slot}.` : "See you soon."], text: `Your order from ${from} is ready for pickup${slot ? `: ${slot}` : ""}. Enjoy it.` }, now);
  }
  let watching = false;
  function watch() { if (watching || !store.events) return; watching = true;
    store.events.on("change", (e) => { const p = String(e?.path || ""); if (/^system\/inbox-[a-f0-9]+$/.test(p)) setImmediate(() => { try { fromInbox(p); } catch (err) { console.warn("[pottotext]", err.message); } });
      else if (/^ws\/[^/]+\/rsvps\/[^/]+$/.test(p)) setImmediate(() => { try { fromRsvp(p); } catch (err) { console.warn("[pottotext]", err.message); } }); }); }
  async function runDue(now = Date.now()) { if (!textConfig().on) return { reminders: 0, batches: 0, sent: 0 }; const reminders = queueReminders(now), batches = flushBatches(now), sent = await flushQueue(now); return { reminders, batches, sent }; }

  // ---------- the switch in Settings ----------
  const CONSENT = "I agree to get texts from Potto at Pottery Lab about my plans, replies and orders, and to text Potto to use the app. Up to 6 messages a day. Msg & data rates may apply. Reply STOP to stop, HELP for help.";
  function settingsOf(u) { const rec = getDbUser(u.email) || {}, st = stateOf(u.email) || {}, cfg = textConfig(), phone = rec.phone && rec.phoneVerifiedAt ? rec.phone : "";
    const smsNum = cfg.sms?.from && /^\+/.test(cfg.sms.from) ? cfg.sms.from : "", waNum = String(cfg.whatsapp?.from || cfg.meta?.number || "").replace(/^whatsapp:/, "");
    return { available: cfg.on, sms: !!cfg.sms, whatsapp: !!cfg.whatsapp, phone, on: !!st.on && !!phone && !stopped(phone), stopped: !!phone && stopped(phone), number: smsNum, whatsappNumber: waNum, consent: CONSENT, since: st.onAt || null }; }
  async function setOn(u, on, now = Date.now()) {
    const s = settingsOf(u); if (!s.available) return { error: "Texting with Potto isn't on yet. It will be soon.", status: 503 };
    if (on && !s.phone) return { error: "Add and confirm your number first.", status: 409 };
    if (on) { store.delete(stopPath(s.phone)); saveState(u.email, { on: true, onAt: now, phone: s.phone, stoppedAt: null, inboxAt: now, consent: { at: now, text: CONSENT, how: "settings switch" }, channel: s.sms ? "sms" : "whatsapp" });
      if (!s.on) { const r = await send({ to: s.phone, text: SAY.welcome(first(u.name)), ch: s.sms ? "sms" : "whatsapp", kind: "welcome", vars: [first(u.name) || "there"], now }); if (r.ok) logMsg(u.email, "out", SAY.welcome(first(u.name)), s.sms ? "sms" : "whatsapp"); } }
    else saveState(u.email, { on: false, offAt: now, pending: null });
    return { ok: true, ...settingsOf(u) }; }
  /** One text to someone with no account (a waitlist approval): the stop list and the global limit still apply. */
  async function textOnce(phone, text) { const p = toE164(phone); if (!p) return { ok: false }; return send({ to: p, text, ch: "sms" }); }
  function status() { const cfg = textConfig(), opted = store.listPrefix("system", "pottot-").filter((d) => d.data?.kind === "pottot" && d.data.on).length, c = store.get(countPath(day()))?.data || {};
    const ch = [cfg.sms ? `SMS${cfg.sms.from && /^\+/.test(cfg.sms.from) ? ` (${cfg.sms.from})` : ""}` : "", cfg.whatsapp ? `WhatsApp via ${cfg.whatsapp.service === "meta" ? "Meta" : "Twilio"}` : ""].filter(Boolean);
    return { on: cfg.on, sms: !!cfg.sms, whatsapp: !!cfg.whatsapp, signed: !!cfg.token || !!cfg.meta?.secret, opted, today: { in: c.in || 0, out: c.out || 0, unknown: c.unknown || 0, stops: c.stops || 0 },
      templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, !!templateOf(k)])),
      line: cfg.on ? `On: ${ch.join(", ")}. Webhooks: ${baseUrl() || ""}/api/potto/sms and /api/potto/whatsapp. ${opted} ${opted === 1 ? "person has" : "people have"} it on. Today: ${c.in || 0} in, ${c.out || 0} out, ${c.stops || 0} stops.${!cfg.token && !cfg.fake ? " Missing the Twilio auth token, so webhooks are refused." : ""}` : "Off. Add the Twilio or WhatsApp settings in docs/potto-text.md to switch it on." }; }
  return { ideasText, key, ref, isOwn, inbound, answer, send, enqueue, runDue, queueReminders, flushBatches, flushQueue, fromInbox, fromRsvp, watch, settingsOf, setOn, textOnce, status, accountOf, stateOf, callAs, CONSENT };
}

// ---------- routes ----------
export function mountPottoText(app, { store, small, currentUser, C, X, publicOrigin }) {
  const T = makePottoText({ app, store, X, C, publicOrigin }); app.locals.pottoText = T; T.watch();
  const origin = (req) => String(process.env.ENCORE_PUBLIC_URL || publicOrigin(req) || "").replace(/\/+$/, "");
  const seen = (req) => { if (req.socket?.localPort) T.ref.port = req.socket.localPort; if (!T.ref.base) T.ref.base = origin(req); };
  const twiml = (res, msg) => res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${String(msg).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</Message>` : ""}</Response>`);
  const form = express.urlencoded({ extended: false, limit: "20kb" }), raw = express.json({ limit: "200kb", verify: (req, res, buf) => { req.rawBody = buf; } });
  const twilioOk = (req) => { const tok = textConfig().token; if (!tok) return false; const want = twilioSignature(tok, origin(req) + req.originalUrl, req.body || {}); return sameStr(req.get("x-twilio-signature"), want); };
  async function fromTwilio(req, res, ch) { seen(req);
    if (!twilioOk(req)) { console.warn(`[pottotext] refused a ${ch} webhook with a bad signature`); return res.status(403).type("text").send("forbidden"); }
    if (!textConfig().on) return twiml(res, "");
    const out = await T.inbound({ from: req.body?.From, body: req.body?.Body, ch }); twiml(res, out); }
  app.post("/api/potto/sms", form, (req, res) => fromTwilio(req, res, "sms").catch(() => twiml(res, "")));
  // WhatsApp: Twilio posts a form; Meta's Cloud API posts signed JSON (and checks the webhook with a GET first)
  app.get("/api/potto/whatsapp", (req, res) => { const M = textConfig().meta; if (!M?.verify || req.query["hub.mode"] !== "subscribe" || !sameStr(req.query["hub.verify_token"], M.verify)) return res.status(403).type("text").send("forbidden"); res.type("text").send(String(req.query["hub.challenge"] || "")); });
  app.post("/api/potto/whatsapp", (req, res, next) => (/json/i.test(req.get("content-type") || "") ? raw(req, res, next) : form(req, res, next)), async (req, res) => {
    if (!/json/i.test(req.get("content-type") || "")) return fromTwilio(req, res, "whatsapp").catch(() => twiml(res, ""));
    seen(req); const M = textConfig().meta; if (!M?.secret || !sameStr(req.get("x-hub-signature-256"), metaSignature(M.secret, req.rawBody))) { console.warn("[pottotext] refused a WhatsApp Cloud webhook with a bad signature"); return res.status(403).type("text").send("forbidden"); }
    res.sendStatus(200); // Meta wants a quick 200; the answer goes out through the API
    try { for (const e of req.body?.entry || []) for (const c of e.changes || []) for (const m of c.value?.messages || []) { if (m.type !== "text") continue; const from = "+" + String(m.from || "").replace(/\D/g, "");
      const out = await T.inbound({ from, body: m.text?.body, ch: "whatsapp" }); if (out) await T.send({ to: from, text: out, ch: "whatsapp" }); } } catch (e) { console.warn("[pottotext] cloud message failed:", e?.message); } });

  // the person: the switch, and their own log
  const me = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u?.email || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } res.set("Cache-Control", "private, no-store"); seen(req); return u; };
  app.get("/api/me/potto-text", (req, res) => { const u = me(req, res); if (!u) return; res.json(T.settingsOf(u)); });
  app.post("/api/me/potto-text", small, async (req, res) => { const u = me(req, res); if (!u) return; const r = await T.setOn(u, req.body?.on === true); if (r.error) return res.status(r.status || 400).json({ code: "invalid", message: r.error }); res.json(r); });
  app.get("/api/me/potto-text/log", (req, res) => { const u = me(req, res); if (!u) return; res.json({ messages: (store.get("system/pottotlog-" + hash(u.email))?.data?.list || []).slice(-100) }); });
  app.delete("/api/me/potto-text/log", (req, res) => { const u = me(req, res); if (!u) return; store.delete("system/pottotlog-" + hash(u.email)); res.json({ ok: true }); });
  // admins: counts only, never what anyone said
  app.get("/api/admin/potto-text", (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || !isAdmin(u.email)) return res.status(404).json({ code: "not_found", message: "Not found." });
    const days = store.listPrefix("system", "pottotcount-").map((d) => d.data).filter(Boolean).sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 30);
    res.set("Cache-Control", "private, no-store").json({ ...T.status(), days }); });
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => T.runDue().catch((e) => console.warn("[pottotext]", e?.message)), 5 * MIN); t.unref?.(); }
  return T;
}
