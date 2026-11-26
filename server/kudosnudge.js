// Nudges for kudos, after the event (on top of the one automatic ask in server/kudosask.js).
//
// - The host's "Nudge for kudos" sheet (GET /api/host/kudos-nudge/:eventId): progress ("7 of 12 left kudos" and who),
//   a group message with the group kudos link, each guest who hasn't left kudos with their personal link, the
//   "Send for me" state and the automatic reminder's day.
// - The group kudos link, /k/<event>?g=<token>: one signed token per event (rotatable). Someone who wasn't sent a personal
//   link types the email or phone they replied with; if it matches a reply that was in (and not marked a no-show), the page
//   gets a kudos-only code ("gk_...") for that reply and carries on like a personal link. The code opens the kudos page,
//   Send and Follow, nothing else (not the address, chat or the reply itself). A miss always says the same thing.
// - "Send for me": one reminder to everyone who hasn't left kudos, by text or email, at most 2 times per event, never to
//   anyone the host reminded in the last 3 days, who already left kudos, or who opted out (STOP or emails off).
// - The automatic reminder: 3 days after a guest's first ask, one more message if they still haven't left kudos. On by
//   default, switched off per event by the host. Logged in kudosasks, so it never goes twice.
//
// Everything is logged in the host's kudosasks collection (append-only through /api/db, see AUDIT in server/app.js):
//   <event>--<rid>         the first ask (server/kudosask.js)
//   <event>--<rid>--f      the automatic reminder (kind: "followup")
//   <event>--<rid>--n      the host's last nudge to that guest (kind: "nudge", via: text/email/whatsapp/copy/send)
//   <event>--_nudge        the event's settings (kind: "settings"): the group token's nonce, the reminder switch, sends
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { smsConfig, sendSms, smsStopped } from "./sms.js";
import { localParts } from "./reminders.js";
import { replyKey } from "./social.js";
import { qrSvg } from "./qr.js";

const DAY = 864e5, MORNING = 9, EVENING = 21, AT_SLOT_MS = 10 * 60e3; // review round 8: the at-the-event code changes every 10 minutes
export const NUDGE = { maxHostSends: 2, spacingDays: 3, followUpDays: 3, followUpLastDay: 7, sheetDays: 14, sendDays: 30, pottoBelow: 0.6 };
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const PHONE_OK = (p) => /^\+?[0-9 ()-]{7,20}$/.test(String(p || "").trim());
const digits = (p) => String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const safe = (rid) => String(rid).replace(/[^A-Za-z0-9_-]/g, "");
const askKey = (eventId, rid) => `kudosasks/${eventId}--${safe(rid)}`;
const cfgKey = (eventId) => `kudosasks/${eventId}--_nudge`;
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const endOf = (ev) => (ISO.test(ev?.endDate || "") && ev.endDate >= (ev.date || "") ? ev.endDate : ev?.date || "");
const addDays = (day, n) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const hasKudos = (K) => !!(K && (K.love || (K.tags || []).length));

/** The kudos lines, word for word. */
export const groupMessage = (title, link) => `Thank you for coming to ${title}! If you have 10 seconds, tap a few words about it: ${link}`;
export const sendLine = (host, title, link) => `${host || "Your host"} would love to hear how ${title} was. 10 seconds: ${link}`;
export const followUpLine = (host, title, link) => (host ? `One last ask: how was ${title}? Kudos for ${host} take 10 seconds: ${link}` : `One last ask: how was ${title}? Kudos take 10 seconds: ${link}`);
export const NO_MATCH = "We couldn't find that reply. Use the email or phone you replied with.";
// the group link's one answer, match or not: it never says whether that email or phone replied (review round 6)
export const GROUP_SENT = "Thanks. If that's the email or phone you replied with, your kudos link is on its way there.";

/** Every guest who was in, one per person (their newest reply), with whether they left kudos. Walk-ins count; no-shows don't. */
export function guestsOf(S, eventId) {
  const by = new Map();
  const docs = S.list("rsvps").filter((d) => d.data?.eventId === eventId).sort((a, b) => (b.data.changedAt || b.data.createdAt || 0) - (a.data.changedAt || a.data.createdAt || 0));
  for (const d of docs) { const k = replyKey(d.data) || "id:" + d.id; if (by.has(k)) by.get(k).rids.push(d.id); else by.set(k, { rid: d.id, r: d.data, rids: [d.id] }); }
  return [...by.values()].filter((g) => g.r.response === "going" && g.r.noShow !== true).map((g) => {
    const K = g.rids.map((id) => S.get("kudos/" + id)?.data).find(hasKudos); return { ...g, gave: !!K, kudos: K || null }; });
}

/** "7 of 12 left kudos", with the first names of who did. */
export function progressOf(S, eventId) {
  const G = guestsOf(S, eventId), gave = G.filter((g) => g.gave);
  return { guests: G.length, kudos: gave.length, pct: G.length ? Math.round((100 * gave.length) / G.length) : 0, givers: gave.map((g) => ({ first: first(g.r.name) || "A guest" })).slice(0, 24) };
}

/** When we last messaged this guest about kudos: { host, auto } (ms or 0). */
function lastReminded(S, eventId, rid) {
  const base = askKey(eventId, rid), A = S.get(base)?.data, F = S.get(base + "--f")?.data, N = S.get(base + "--n")?.data;
  const sent = (x) => (x && ["sms", "email"].includes(x.channel) ? x.at || 0 : 0);
  return { host: N?.at || 0, auto: Math.max(sent(A), sent(F)) };
}

/** Who's opted out: replied STOP (or turned texts off on their reply), or turned off emails. */
function optedOut(r, canEmail) {
  if (r.phone && (r.smsOk === false || smsStopped(r.phone))) return true;
  // TODO(unsubscribe): also check the new guest unsubscribe list (server/email.js) once it lands; canEmail covers the
  // "emails off" preference that exists today.
  if (r.email && canEmail(lc(r.email)) === false) return true;
  return false;
}

export function makeKudosNudge(store, { C, canEmail = () => true, hostFirst = () => "" } = {}) {
  const secret = () => { let s0 = store.get("system/secret")?.data?.v; if (!s0) { s0 = crypto.randomBytes(32).toString("hex"); store.set("system/secret", { v: s0 }); } return process.env.SESSION_SECRET || s0; };
  const hmac = (msg, n) => crypto.createHmac("sha256", secret()).update(msg).digest("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, n);
  const settings = (S, eventId) => S.get(cfgKey(eventId))?.data || null;
  const ensure = (S, eventId) => { let s = settings(S, eventId); if (!s?.nonce) { s = { kind: "settings", eventId, followUp: true, sends: [], ...(s || {}), nonce: crypto.randomBytes(8).toString("hex") }; S.set(cfgKey(eventId), s); } return s; };
  const groupToken = (ws, eventId, nonce) => hmac(`kg:${ws}:${eventId}:${nonce}`, 22);
  const gkCode = (ws, eventId, rid, nonce) => "gk_" + hmac(`kk:${ws}:${eventId}:${safe(rid)}:${nonce}`, 24);
  const groupLink = (origin, eventId, token) => `${origin}/k/${encodeURIComponent(eventId)}?g=${encodeURIComponent(token)}`;
  const personalLink = (origin, eventId, rid, code) => `${origin}/k/${encodeURIComponent(eventId)}?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`;
  const codeOf = (S, g) => { let code = String(g.r.code || ""); if (!code) { code = crypto.randomBytes(5).toString("hex").toUpperCase(); try { S.update("rsvps/" + g.rid, { code }); g.r.code = code; } catch { return ""; } } return code; };

  /** The event behind a group token, or null. */
  function groupEvent(eventId, g) {
    const ws = workspaceOfEvent(String(eventId || "")); if (!ws || ws === DEFAULT_WS || !g) return null;
    const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data, s = settings(S, eventId); if (!ev || !s?.nonce) return null;
    return eq(groupToken(ws, eventId, s.nonce), String(g)) ? { ws, S, ev, s, eventId } : null;
  }
  /** The kudos-only proof from the group link: same shape as X.rsvpProof, for the kudos page, Send and Follow only. */
  function kudosProof(eventId, rid, code) {
    if (!/^gk_[A-Za-z0-9]{24}$/.test(String(code || "")) || !rid) return null;
    const ws = workspaceOfEvent(String(eventId || "")); if (!ws || ws === DEFAULT_WS) return null;
    const S = scopeStore(store, ws), s = settings(S, eventId), r = S.get("rsvps/" + safe(rid))?.data;
    if (!s?.nonce || !r || r.eventId !== eventId || r.response !== "going" || r.noShow === true) return null;
    return eq(gkCode(ws, eventId, rid, s.nonce), code) ? { ws, S, r, rid: safe(rid), ev: S.get("events/" + eventId)?.data, viaGroup: true } : null;
  }
  /** Match what someone typed (email or phone) to a reply that was in. Returns the guest or null; never says why. */
  function matchGuest(S, eventId, contact) {
    const t = String(contact || "").trim(); if (!t) return null;
    const G = guestsOf(S, eventId);
    if (t.includes("@")) { const e = lc(t); return EMAIL_RE.test(e) ? G.find((g) => lc(g.r.email) === e) || null : null; }
    const d = digits(t); if (d.length < 7) return null; return G.find((g) => g.r.phone && digits(g.r.phone) === d) || null;
  }

  /** The automatic reminder's day, for the host: { available, on, date, day, sent }. */
  function followUpOf(S, ws, eventId, ev, G, now = Date.now()) {
    const s = settings(S, eventId), on = s?.followUp !== false && ev.autoRemind !== false;
    const available = !!(smsConfig() || emailConfig(ws, false) || emailConfig(DEFAULT_WS, true));
    const asks = G.map((g) => S.get(askKey(eventId, g.rid))?.data).filter((a) => a && ["sms", "email"].includes(a.channel));
    const sent = G.map((g) => S.get(askKey(eventId, g.rid) + "--f")?.data).filter((f) => f && ["sms", "email"].includes(f.channel));
    const tz = ev.tz || process.env.ENCORE_TZ || "";
    let date = "";
    if (sent.length) date = localParts(Math.min(...sent.map((f) => f.at)), tz).day;
    else if (asks.length) date = localParts(Math.min(...asks.map((a) => a.at)) + NUDGE.followUpDays * DAY, tz).day;
    else if (ISO.test(endOf(ev)) && localParts(now, tz).day <= addDays(endOf(ev), 3)) date = addDays(endOf(ev), 1 + NUDGE.followUpDays); // the first ask still to come (it goes up to 3 days after)
    return { available, on, date, day: date ? weekday(date) : "", sent: sent.length > 0, count: sent.length };
  }

  /** The host's sheet. */
  function sheet(ws, eventId, origin, now = Date.now()) {
    const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data; if (!ev) return null;
    const s = ensure(S, eventId), G = guestsOf(S, eventId), title = clean(ev.pubTitle || ev.name, 120) || "the event", host = hostFirst(ws, ev);
    const today = localParts(now, ev.tz || process.env.ENCORE_TZ || "").day, end = endOf(ev), ended = !!end && end < today;
    const daysSince = ended ? Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(end + "T12:00:00Z")) / DAY) : 0;
    const link = groupLink(origin, eventId, groupToken(ws, eventId, s.nonce)), P = progressOf(S, eventId);
    const sms = smsConfig(), email = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
    const pending = G.filter((g) => !g.gave).map((g) => { const N = S.get(askKey(eventId, g.rid) + "--n")?.data, code = codeOf(S, g), em = lc(g.r.email);
      return { rid: g.rid, name: clean(g.r.name, 80) || "A guest", first: first(g.r.name) || "A guest", phone: PHONE_OK(g.r.phone) ? String(g.r.phone).trim() : "", email: EMAIL_RE.test(em) ? em : "",
        link: code ? personalLink(origin, eventId, g.rid, code) : "", nudgedAt: N?.at || null, nudgedVia: N?.via || "", optedOut: optedOut(g.r, canEmail) }; });
    const sends = (s.sends || []).filter((x) => x.n > 0);
    return { eventId, title, hostFirst: host, ended, daysSince, progress: P,
      group: { link, message: groupMessage(title, link) },
      guests: pending, bcc: pending.filter((g) => g.email && !g.optedOut).map((g) => g.email),
      send: { available: !!(sms || email), used: sends.length, max: NUDGE.maxHostSends, lastAt: sends.length ? sends[sends.length - 1].at : null, line: sendLine(host, title, "<link>"), eligible: ended ? sendable(S, ws, eventId, G, now).length : 0 },
      followUp: followUpOf(S, ws, eventId, ev, G, now),
      potto: ended && daysSince <= NUDGE.sheetDays && P.guests > 0 && P.kudos / P.guests < NUDGE.pottoBelow };
  }

  /** Who "Send for me" would reach right now. */
  function sendable(S, ws, eventId, G, now) {
    const sms = smsConfig(), email = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
    return G.filter((g) => !g.gave).filter((g) => { const r = g.r, L = lastReminded(S, eventId, g.rid);
      if (optedOut(r, canEmail)) return false; // STOP, texts off or emails off: never
      if (L.host && now - L.host < NUDGE.spacingDays * DAY) return false; // the host reminded them in the last 3 days
      if (L.auto && now - L.auto < DAY) return false; // and never two kudos messages in one day
      return (PHONE_OK(r.phone) && !!sms) || (EMAIL_RE.test(lc(r.email)) && !!email); });
  }

  async function deliver(ws, S, r, line, title, { fromName = "" } = {}) {
    const sms = smsConfig(), email = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true), em = lc(r.email);
    if (sms && PHONE_OK(r.phone) && r.smsOk !== false) { const x = await sendSms(sms, { to: r.phone, text: `${line} Reply STOP to opt out.` }); if (x.ok) return { channel: "sms", to: r.phone }; if (x.stopped) return { channel: "none", error: "stopped" }; }
    if (email && EMAIL_RE.test(em) && canEmail(em) !== false) { const x = await sendEmail(email, { to: em, subject: `How was ${title}?`, text: `Hi ${first(r.name) || "there"},\n\n${line}\n`, fromName }); if (x.ok) return { channel: "email", to: em }; return { channel: "none", error: x.error || "email failed" }; }
    return { channel: "none", error: "no way to reach" };
  }

  /** "Send for me". Returns { ok, sent, skipped, used, max } or { ok:false, status, code, message }. */
  async function sendForMe(ws, eventId, origin, now = Date.now()) {
    const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data; if (!ev) return { ok: false, status: 404, code: "not_found", message: "No such event." };
    if (!(smsConfig() || emailConfig(ws, false) || emailConfig(DEFAULT_WS, true))) return { ok: false, status: 400, code: "not_configured", message: "Email or texting isn't set up on this server, so send the links yourself." };
    const today = localParts(now, ev.tz || process.env.ENCORE_TZ || "").day, end = endOf(ev);
    if (!end || end >= today) return { ok: false, status: 400, code: "too_early", message: "Kudos open once it's happened." };
    if ((Date.parse(today + "T12:00:00Z") - Date.parse(end + "T12:00:00Z")) / DAY > NUDGE.sendDays) return { ok: false, status: 400, code: "too_late", message: "It's been over a month. Share the group link instead." };
    const s = ensure(S, eventId), used = (s.sends || []).filter((x) => x.n > 0);
    if (used.length >= NUDGE.maxHostSends) return { ok: false, status: 429, code: "cap", message: "You've sent 2 reminders for this event. That's the most we send." };
    const G = guestsOf(S, eventId), who = sendable(S, ws, eventId, G, now), title = clean(ev.pubTitle || ev.name, 120) || "the event", host = hostFirst(ws, ev);
    if (!who.length) return { ok: true, sent: 0, skipped: G.filter((g) => !g.gave).length, used: used.length, max: NUDGE.maxHostSends, message: "Everyone who hasn't left kudos was reminded in the last 3 days, opted out, or has no email or phone." };
    let sent = 0, skipped = 0;
    for (const g of who) { const code = codeOf(S, g); if (!code) { skipped++; continue; }
      const key = askKey(eventId, g.rid) + "--n", prev = S.get(key)?.data;
      S.set(key, { kind: "nudge", eventId, rid: g.rid, at: now, via: "send", channel: "pending", history: [...(prev?.history || []), { at: now, via: "send" }].slice(-10) }); // logged first
      const out = await deliver(ws, S, g.r, sendLine(host, title, personalLink(origin, eventId, g.rid, code)), title, { fromName: C?.profileOf?.(ws)?.name || "" });
      if (out.channel === "none") { if (prev) S.set(key, prev); else S.delete(key); skipped++; continue; }
      S.set(key, { kind: "nudge", eventId, rid: g.rid, at: now, via: "send", channel: out.channel, history: [...(prev?.history || []), { at: now, via: "send", channel: out.channel }].slice(-10) });
      S.add("outbox", { kind: "kudos-nudge", eventId, to: [out.to], subject: sendLine(host, title, "").trim().slice(0, 200), at: now, status: "sent" }); sent++; }
    if (sent) S.set(cfgKey(eventId), { ...ensure(S, eventId), sends: [...(s.sends || []), { at: now, n: sent }] });
    return { ok: true, sent, skipped, used: used.length + (sent ? 1 : 0), max: NUDGE.maxHostSends };
  }

  /** The host tapped Text / Email / WhatsApp / Copy for one guest. */
  function markNudged(ws, eventId, rid, via, now = Date.now()) {
    const S = scopeStore(store, ws), r = S.get("rsvps/" + safe(rid))?.data; if (!r || r.eventId !== eventId) return null;
    const key = askKey(eventId, rid) + "--n", prev = S.get(key)?.data, v = ["text", "email", "whatsapp", "copy"].includes(via) ? via : "copy";
    S.set(key, { kind: "nudge", eventId, rid: safe(rid), at: now, via: v, channel: "tap", history: [...(prev?.history || []), { at: now, via: v }].slice(-10) });
    return { at: now, via: v };
  }

  /** The automatic reminder, for every host (or `workspaces`): 3 days after a guest's first ask, once. */
  async function runFollowUps({ now = Date.now(), workspaces = null, origin = process.env.ENCORE_PUBLIC_URL || "" } = {}) {
    const out = { sent: 0, sms: 0, email: 0, skipped: 0, events: [] };
    for (const ws of workspaces || allWorkspaceIds()) { if (ws === DEFAULT_WS || isDemo(ws)) continue; const S = scopeStore(store, ws);
      for (const d of S.list("events")) { const ev = d.data || {}, eventId = d.id;
        if (ev.example || !ev.casual || ev.stage === "interest" || ev.cancelled || ev.autoRemind === false) continue;
        if (settings(S, eventId)?.followUp === false) continue; // the host's switch: "Reminder goes out Thu"
        const L = localParts(now, ev.tz || process.env.ENCORE_TZ || ""); if (L.hour < MORNING || L.hour >= EVENING) continue;
        const G = guestsOf(S, eventId); let row = null; const title = clean(ev.pubTitle || ev.name, 120) || "the event", host = hostFirst(ws, ev);
        for (const g of G) { const base = askKey(eventId, g.rid), A = S.get(base)?.data; if (!A || !["sms", "email"].includes(A.channel)) continue;
          if (now < A.at + NUDGE.followUpDays * DAY || now > A.at + NUDGE.followUpLastDay * DAY) continue;
          const key = base + "--f"; if (S.get(key)) continue; // once, ever
          row = row || { ws, eventId, sent: 0, skipped: 0 };
          const skip = (why) => { S.set(key, { kind: "followup", eventId, rid: g.rid, at: now, channel: "skipped", reason: why }); row.skipped++; };
          if (g.gave) { skip("kudos"); continue; }
          if (optedOut(g.r, canEmail)) { skip("opted_out"); continue; }
          const N = S.get(base + "--n")?.data; if (N?.at && now - N.at < NUDGE.spacingDays * DAY) { skip("host_nudged"); continue; }
          const code = String(g.r.code || ""); if (!code) { skip("no_code"); continue; }
          S.set(key, { kind: "followup", eventId, rid: g.rid, at: now, channel: "pending" }); // logged first: a crash never means two
          const x = await deliver(ws, S, g.r, followUpLine(host, title, personalLink(origin, eventId, g.rid, code)), title, { fromName: C?.profileOf?.(ws)?.name || "" });
          S.set(key, { kind: "followup", eventId, rid: g.rid, at: now, channel: x.channel, ...(x.error && x.channel === "none" ? { error: String(x.error).slice(0, 200) } : {}) });
          if (x.channel === "none") { row.skipped++; continue; }
          row.sent++; out[x.channel]++; S.add("outbox", { kind: "kudos-followup", eventId, to: [x.to], subject: followUpLine(host, title, "").trim().slice(0, 200), at: now, status: "sent" }); }
        if (row) { out.events.push(row); out.sent += row.sent; out.skipped += row.skipped; } } }
    return out;
  }

  function setFollowUp(ws, eventId, on) { const S = scopeStore(store, ws); if (!S.get("events/" + eventId)) return null; const s = ensure(S, eventId); S.set(cfgKey(eventId), { ...s, followUp: !!on }); return { on: !!on }; }
  function rotate(ws, eventId) { const S = scopeStore(store, ws); if (!S.get("events/" + eventId)) return null; const s = ensure(S, eventId); S.set(cfgKey(eventId), { ...s, nonce: crypto.randomBytes(8).toString("hex"), rotatedAt: Date.now() }); return true; }

  // ---- review round 8: "at the event" codes. The host's QR screen shows a 4-digit code that changes every 10 minutes;
  // a guest standing there types it with their email or phone and goes straight to the kudos page (no email round trip).
  // Only around the event: from an hour before it starts on its day until 4am the next morning, in the event's time zone. ----
  const atSlot = (now) => Math.floor(now / AT_SLOT_MS);
  const atCodeOf = (ws, eventId, nonce, slot) => String(parseInt(crypto.createHmac("sha256", secret()).update(`ka:${ws}:${eventId}:${nonce}:${slot}`).digest("hex").slice(0, 8), 16) % 10000).padStart(4, "0");
  function atLive(ev, now = Date.now()) { const tz = ev?.tz || process.env.ENCORE_TZ || "", L = localParts(now, tz), start = ev?.date || "", end = endOf(ev); if (!ISO.test(start)) return false;
    const h0 = /^\d{2}:\d{2}$/.test(ev.startTime || "") ? Math.max(0, +ev.startTime.slice(0, 2) - 1) : 0;
    if (L.day === start && start === end) return L.hour >= h0; if (L.day > start && L.day <= end) return true; if (L.day === start) return L.hour >= h0; return L.day === addDays(end, 1) && L.hour < 4; }
  /** For the host's QR screen: { live, code, expiresAt } (code only while live). */
  function atNow(ws, eventId, now = Date.now()) { const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data; if (!ev) return { live: false };
    const s = ensure(S, eventId), live = atLive(ev, now); if (!live) return { live: false }; const k = atSlot(now); return { live: true, code: atCodeOf(ws, eventId, s.nonce, k), expiresAt: (k + 1) * AT_SLOT_MS }; }
  /** Is this the code on the host's screen (or the one just before it, for a minute after it changed)? */
  function atOk(G, typed, now = Date.now()) { const t = String(typed || "").replace(/\D/g, ""); if (t.length !== 4 || !atLive(G.ev, now)) return false; const k = atSlot(now);
    return eq(atCodeOf(G.ws, G.eventId, G.s.nonce, k), t) || (now - k * AT_SLOT_MS < 60e3 && eq(atCodeOf(G.ws, G.eventId, G.s.nonce, k - 1), t)); }
  // ---- end review round 8 ----
  return { sheet, sendForMe, markNudged, runFollowUps, setFollowUp, rotate, groupEvent, kudosProof, matchGuest, gkCode, groupToken, ensure, progressOf, guestsOf, personalLink, atNow, atOk, atLive, sign: (m) => hmac("fc:" + m, 24) };
}

export function mountKudosNudge(app, { store, small, C, X, ownerOnly, publicOrigin, hostFirst }) {
  const N = makeKudosNudge(store, { C, canEmail: (e) => X.canEmail(e), hostFirst });
  app.locals.kudosNudge = N;
  // the kudos page, Send and Follow accept the group link's kudos-only code too (server/social.js, server/community.js)
  X.kudosProof = (eventId, rid, code) => X.rsvpProof(eventId, rid, code) || N.kudosProof(eventId, rid, code);
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const hits = new Map(); const over = (key, n) => { const now = Date.now(); let h = hits.get(key); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(key, h); } if (hits.size > 5000) hits.clear(); return ++h.n > n; };
  const host = (req, res) => { const u = ownerOnly(req, res); if (!u) return null; const id = clean(req.params.eventId, 80); if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !scopeStore(store, u.ws).get("events/" + id)) { bad(res, "No such event.", 404, "not_found"); return null; } return { u, id }; };

  // ---- the host's "Nudge for kudos" sheet ----
  app.get("/api/host/kudos-nudge/:eventId", (req, res) => { const h = host(req, res); if (!h) return; res.set("Cache-Control", "private, no-store"); res.json(N.sheet(h.u.ws, h.id, publicOrigin(req))); });
  app.get("/api/host/kudos-nudge/:eventId/qr.svg", (req, res) => { const h = host(req, res); if (!h) return; const s = N.sheet(h.u.ws, h.id, publicOrigin(req));
    res.set("Cache-Control", "private, no-store").type("image/svg+xml").send(qrSvg(s.group.link + (req.query.here === "1" ? "&here=1" : ""))); }); // review round 8: the at-the-event QR asks for the code
  // review round 8: the code guests type at the event (the host's QR screen polls this; it changes every 10 minutes)
  app.get("/api/host/kudos-nudge/:eventId/at", (req, res) => { const h = host(req, res); if (!h) return; res.set("Cache-Control", "private, no-store"); res.json(N.atNow(h.u.ws, h.id)); });
  app.post("/api/host/kudos-nudge/:eventId/nudged", small, (req, res) => { const h = host(req, res); if (!h) return; const r = N.markNudged(h.u.ws, h.id, clean(req.body?.rid, 80), clean(req.body?.via, 20)); if (!r) return bad(res, "No such guest.", 404, "not_found"); res.json({ ok: true, ...r }); });
  app.post("/api/host/kudos-nudge/:eventId/send", small, async (req, res) => { const h = host(req, res); if (!h) return; const r = await N.sendForMe(h.u.ws, h.id, publicOrigin(req)); if (!r.ok) return bad(res, r.message, r.status, r.code); res.json(r); });
  app.post("/api/host/kudos-nudge/:eventId/follow-up", small, (req, res) => { const h = host(req, res); if (!h) return; res.json({ ok: true, ...N.setFollowUp(h.u.ws, h.id, req.body?.on !== false) }); });
  app.post("/api/host/kudos-nudge/:eventId/rotate", small, (req, res) => { const h = host(req, res); if (!h) return; N.rotate(h.u.ws, h.id); res.json({ ok: true, ...N.sheet(h.u.ws, h.id, publicOrigin(req)) }); });

  // ---- the group kudos link: /k/<event>?g=<token> (the page is public/kudos.html) ----
  app.get("/api/public/kudos-group/:eventId", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("gp:" + (req.ip || "?"), 120)) return bad(res, "Slow down.", 429, "rate_limited");
    const id = clean(req.params.eventId, 80), G = N.groupEvent(id, clean(req.query.g, 60)); if (!G) return bad(res, "This link isn't working. Ask your host for a new one.", 403, "not_granted");
    const today = new Date().toISOString().slice(0, 10), h = C.profileOf(G.ws);
    res.json({ title: clean(G.ev.pubTitle || G.ev.name, 120), date: ISO.test(G.ev.date || "") ? G.ev.date : "", hostFirst: hostFirst(G.ws, G.ev), host: h?.handle ? { name: clean(h.name, 60) } : null, open: !G.ev.date || G.ev.date <= today, here: N.atLive(G.ev) /* review round 8 */ }); });
  app.post("/api/public/kudos-group/:eventId", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    const id = clean(req.params.eventId, 80), perIp = Number(process.env.ENCORE_KUDOS_GROUP_PER_IP || 10), perEvent = Number(process.env.ENCORE_KUDOS_GROUP_PER_EVENT || 60);
    // round 9: at the event (a code on the host's phone), only wrong codes count against the venue's shared wifi
    const atTry = req.body?.at != null && req.body.at !== "";
    if (atTry ? over("gat:" + id, 400) : (over("gi:" + (req.ip || "?"), perIp) || over("ge:" + id, perEvent))) return bad(res, "Too many tries. Try again in an hour.", 429, "rate_limited");
    const G = N.groupEvent(id, clean(req.body?.g, 60)); if (!G || isDemo(G.ws)) return bad(res, "This link isn't working. Ask your host for a new one.", 403, "not_granted");
    const contact = clean(req.body?.contact, 200); if (!contact) return bad(res, "Add the email or phone you replied with.");
    // per contact too, so one guest's email can't be tried from many places
    const ck = contact.includes("@") ? lc(contact) : digits(contact); if (over("gc:" + id + ":" + ck, Number(process.env.ENCORE_KUDOS_GROUP_PER_CONTACT || 5))) return bad(res, "Too many tries. Try again in an hour.", 429, "rate_limited");
    // ---- review round 8: at the event, the code on the host's phone instead of the email round trip. The code is checked
    // before the contact, so a wrong code gets the same answer whether or not that email or phone replied. ----
    if (req.body?.at != null && req.body.at !== "") { const t0a = Date.now(), okAt = N.atOk(G, clean(req.body.at, 12)), ga = okAt ? N.matchGuest(G.S, id, contact) : null;
      if (!okAt && over("ga:" + (req.ip || "?") + ":" + id, Number(process.env.ENCORE_KUDOS_AT_WRONG || 8))) return bad(res, "Too many tries. Try again in an hour.", 429, "rate_limited");
      const reply = () => { if (!okAt) return bad(res, "That code didn't match. Type the 4 digits on your host's phone.", 400, "at_code");
        if (!ga) return bad(res, NO_MATCH, 404, "no_match");
        res.json({ ok: true, next: `/k/${encodeURIComponent(id)}?rid=${encodeURIComponent(ga.rid)}&code=${encodeURIComponent(N.gkCode(G.ws, id, ga.rid, G.s.nonce))}` }); };
      return void setTimeout(reply, Math.max(0, 350 - (Date.now() - t0a))); }
    // ---- end review round 8 ----
    // Match or not, the same answer, at the same pace. On a match the kudos link goes to that email or phone when we can
    // send there (the safe way); with no email or texting set up, the page goes on with a kudos-only code instead.
    const t0 = Date.now(), g = N.matchGuest(G.S, id, contact), code = g ? N.gkCode(G.ws, id, g.rid, G.s.nonce) : N.gkCode(G.ws, id, "none:" + ck, G.s.nonce);
    const byEmail = contact.includes("@"), cfg = byEmail ? emailConfig(G.ws, false) || emailConfig(DEFAULT_WS, true) : smsConfig(), canSend = !!cfg;
    let next = null;
    if (g && canSend) { const link = N.personalLink(publicOrigin(req), id, g.rid, code), title = clean(G.ev.pubTitle || G.ev.name, 120), who = hostFirst(G.ws, G.ev);
      const p = byEmail ? sendEmail(cfg, { list: "guest", origin: publicOrigin(req), to: lc(g.r.email), subject: `Your kudos link for ${title}`, text: `${sendLine(who, title, link)}

You asked for this on the group link. If that wasn't you, ignore it.`, fromName: who || "Pottery Lab" })
        : sendSms(cfg, { to: g.r.phone, text: sendLine(who, title, link) });
      p.catch(() => {}); }
    else if (g) next = `/k/${encodeURIComponent(id)}?rid=${encodeURIComponent(g.rid)}&code=${encodeURIComponent(code)}`;
    const wait = Math.max(0, 350 - (Date.now() - t0)); setTimeout(() => res.json({ ok: true, message: GROUP_SENT, sent: canSend, ...(next ? { next } : {}) }), wait); });

  // ---- a follow from the group link's kudos-only code: pending until confirmed by email, else counted as unverified ----
  X.groupFollow = async ({ ws, email, name, eventId, origin }) => { const S = scopeStore(store, ws), h = C.profileOf(ws) || {}, before = C.followersOf(ws).find((f) => f.email === lc(email));
    if (before && !before.pending) return { ok: true, followers: C.followersOf(ws).length, confirmed: !before.unverified, unverified: !!before.unverified };
    C.follow(ws, { email, name, via: "kudos-group" }); const k = S.list("followers").find((d) => d.data?.email === lc(email)); const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
    if (cfg && k) { S.update("followers/" + k.id, { pending: true, unverified: false });
      const link = `${origin}/api/public/follow-confirm?h=${encodeURIComponent(h.handle || "")}&f=${encodeURIComponent(k.id)}&t=${N.sign(ws + ":" + k.id)}`;
      sendEmail(cfg, { list: "guest", origin, to: lc(email), subject: `Confirm: follow ${h.name || "your host"} on Pottery Lab`, text: `Hi ${first(name) || "there"},

Tap to confirm you want to hear first about ${h.name || "this host"}'s next events: ${link}

If you didn't ask for this, ignore it and nothing happens.`, fromName: "Pottery Lab" }).catch(() => {});
      return { ok: true, followers: C.followersOf(ws).length, confirmed: false, pending: true, emailed: true }; }
    if (k) S.update("followers/" + k.id, { unverified: true, pending: false });
    return { ok: true, followers: C.followersOf(ws).length, confirmed: false, unverified: true }; };
  app.get("/api/public/follow-confirm", (req, res) => { const ws = C.wsOfHandle(lc(req.query.h)), fid = clean(req.query.f, 40).replace(/[^A-Za-z0-9]/g, "");
    if (!ws || !fid || !eq(N.sign(ws + ":" + fid), clean(req.query.t, 40))) return res.status(403).type("text/plain").send("This link isn't working.");
    const S = scopeStore(store, ws); if (!S.get("followers/" + fid)) return res.status(404).type("text/plain").send("Nothing to confirm.");
    S.update("followers/" + fid, { pending: false, unverified: false, confirmedAt: Date.now() }); res.redirect(302, `/@${encodeURIComponent(C.profileOf(ws)?.handle || "")}?followed=1`); });

  return N;
}
