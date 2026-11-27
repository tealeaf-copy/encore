// Paying for a drop before pickup. Pottery Lab never holds the money: a buyer pays the host straight through the host's
// Get paid methods (server/paymethods.js: Venmo, PayPal, Cash App, a pay link), with the amount and a note filled in,
// then taps "I paid", which is a claim on their own order that the host confirms. Or, where the host allows it, they
// choose "I'll pay at pickup". This file is the one reader of where an order stands, used by the order page, Plans,
// the host's Orders and the reminders.
//
// How a drop takes money (drop.payMode, set in the drop setup, public/drop.js):
//   "ahead"   pay before pickup (a drop made before this, with a pay link, reads as "ahead")
//   "either"  pay ahead, or choose to pay at pickup
//   "pickup"  pay at pickup only: no pay step, no reminders
// An order is "Not paid yet" (unpaid) until the buyer taps I paid (claimed) or the host marks it paid (paid). A claim or
// a mark covers the amount it was made for: if the order grows after it, the order is Not paid yet again, for the whole
// new amount (there is no part payment).
//
// Reminders, only for unpaid orders on drops that ask to pay ahead, never in quiet hours (9pm to 8am where the drop is),
// never more than 3 an order (the host's Remind unpaid counts), none once paid, claimed, cancelled or past pickup:
//   placed   about 30 minutes after ordering, when they skipped paying (the bell and a text; the order email already
//            carries the pay link)
//   eve      the day before pickup ("Your pandan cake pickup is tomorrow, 9 to 10am. You haven't paid yet: Pay Maya $36")
//   morning  the morning of pickup, if still unpaid
// Each goes by the bell (which pushes, server/push.js, under Reminders in Settings), email (unless they turned guest
// emails off) and a text when they turned on Potto by text (server/pottotext.js, which keeps its own quiet hours and
// daily limit). Each links straight to the pay step: /e/<id>?pay=1 with the order's own reply link, so a buyer with
// no account opens their order on any phone.
import { scopeStore, getWorkspace, getDbUser, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { eventTz, zonedMs } from "./tz.js";
import { isQuiet, localParts } from "./reminders.js";
import { payOfWs, hasPay, eventMethods } from "./paymethods.js";
import "../public/pickup.js";
const P = () => globalThis.PLPickup;

export const PAY_REMIND = { max: 3, gapMs: 4 * 3600e3, placedAfterMs: 30 * 60e3, hostEveryMs: 12 * 3600e3 };
const ISO = /^\d{4}-\d{2}-\d{2}$/, HM = /^\d{2}:\d{2}$/;
export const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const addDay = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** How a drop takes money: "ahead", "either" or "pickup" ("" for anything that isn't a drop). */
export function payModeOf(ev) {
  if (!ev?.drop) return "";
  if (["ahead", "either", "pickup"].includes(ev.payMode)) return ev.payMode;
  if (ev.payMode === "link") return "ahead";
  return String(ev.ticketUrl || "").trim() ? "ahead" : "pickup"; // made before pay modes: a pay link meant pay ahead
}
/** Does this drop ask buyers to pay before pickup? */
export const asksAhead = (ev) => !!ev?.drop && !ev.cancelled && payModeOf(ev) !== "pickup";
/** May a buyer choose to pay at pickup instead? */
export const pickupOk = (ev) => payModeOf(ev) === "either";
/** An order's amount, in cents, from its own lines (what the server priced). */
export function orderCents(r) {
  const t = Math.round((+r?.orderTotal || 0) * 100); if (t > 0) return t; // the same reading as the pay buttons (server/paymethods.js)
  const L = Array.isArray(r?.orderLines) ? r.orderLines : [];
  return L.reduce((a, l) => a + Math.round((+l.price || 0) * 100) * Math.max(0, Math.floor(+l.qty) || 0), 0);
}
/**
 * Where one order stands. state: "paid" (the host marked it), "claimed" (the buyer said I paid, the host hasn't
 * confirmed), "unpaid" (Not paid yet), "pickup" (paying at pickup: the drop's only way, or their choice), "free"
 * (nothing to pay), "cancelled", or "none" (not a drop order). Pure.
 */
export function payStateOf(ev, r) {
  const cents = orderCents(r), base = { cents, amount: cents ? money(cents) : "", ahead: asksAhead(ev), pickupOk: pickupOk(ev), choice: r?.payChoice || "" };
  if (!ev?.drop || !r || !(r.orderLines || []).length) return { ...base, state: "none" };
  if (r.response !== "going" || r.orderStatus === "cancelled" || ev.cancelled) return { ...base, state: "cancelled" };
  if (!cents) return { ...base, state: "free" };
  const covers = (c) => !(+c > 0) || +c >= cents; // a mark or claim made before amounts were kept covers the order
  if (r.paid && covers(r.paidCents)) return { ...base, state: "paid" };
  if (r.paidClaim && covers(r.paidClaimCents)) return { ...base, state: "claimed" };
  if (!base.ahead) return { ...base, state: "pickup", only: true };
  if (r.payChoice === "pickup" && base.pickupOk) return { ...base, state: "pickup" };
  return { ...base, state: "unpaid", changed: !!((r.paid || r.paidClaim) && cents) };
}
/** The pickup this order is for: its window, the date (a weekly window: the first one on or after the order), the times. */
export function pickupOf(ev, r, tz = "") {
  const W = P().windowsOf(ev), w = P().windowOfSlot(ev, r?.slot) || (W.length === 1 ? W[0] : null);
  const from = localParts(+r?.orderAt || +r?.createdAt || Date.now(), tz).day, date = w ? P().dateFor(w, from) : P().firstDate(ev, from);
  return { w, date: ISO.test(date || "") ? date : "", start: HM.test(w?.start || "") ? w.start : "", end: HM.test(w?.end || "") ? w.end : "", span: w ? P().span(w) : "" };
}
/**
 * Which reminder is due for an order now, or "". Pure: the caller sends it and records it in r.payReminders.
 * Never in quiet hours, at most PAY_REMIND.max, at least gapMs apart, and one a day.
 */
export function dueReminder(ev, r, now = Date.now(), tz = eventTz(ev)) {
  if (!ev?.drop || ev.cancelled || ev.example || !asksAhead(ev)) return "";
  if (payStateOf(ev, r).state !== "unpaid") return "";
  const sent = Array.isArray(r.payReminders) ? r.payReminders : [];
  if (sent.length >= PAY_REMIND.max) return "";
  if (isQuiet(now, tz)) return "";
  const last = Math.max(0, ...sent.map((x) => +x.at || 0));
  if (last && now - last < PAY_REMIND.gapMs) return "";
  const placedAt = +r.orderAt || +r.createdAt || 0;
  if (placedAt && now - placedAt < PAY_REMIND.placedAfterMs) return ""; // the pay step is still on their screen
  const pk = pickupOf(ev, r, tz), today = localParts(now, tz).day, has = (k) => sent.some((x) => x.k === k), sentToday = sent.some((x) => localParts(+x.at || 0, tz).day === today);
  if (pk.date) { const startAt = zonedMs(pk.date, pk.start || "23:59", tz); if (today > pk.date || now >= startAt) return ""; } // pickup has begun: they pay there
  if (pk.date && today === pk.date) return !has("morning") && !sentToday ? "morning" : "";
  if (pk.date && today === addDay(pk.date, -1)) return !has("eve") && !sentToday ? "eve" : "";
  if (!sent.length && placedAt && now - placedAt >= PAY_REMIND.placedAfterMs) return "placed";
  return "";
}
/** The words of a reminder. kind: placed, eve, morning or host (the host's Remind unpaid). Plain, calm, no emoji. */
export function reminderText(kind, { title, host, amount, span = "", pickupDay = "" }) {
  const t = title || "drop", pay = `Pay ${host} ${amount}`;
  if (kind === "eve") return `Your ${t} pickup is tomorrow${span ? `, ${span}` : ""}. You haven't paid yet: ${pay}.`;
  if (kind === "morning") return `Your ${t} pickup is today${span ? `, ${span}` : ""}. Not paid yet: ${pay}.`;
  if (kind === "host") return `A note from ${host}: your ${t} order (${amount}) isn't paid yet. You can pay ahead${pickupDay ? ` before pickup ${pickupDay}` : ""}.`;
  return `Your ${t} order is in. Not paid yet: ${pay} before pickup.`;
}

// ---------------------------------------------------------------- sending ----------
export function makeDropPay({ store, C, X, replyToken = null, potto = () => null }) {
  const hostFirst = (ws, ev) => first(C?.profileOf?.(ws)?.name || ev.hostName || getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || "").replace(/['’]s$/i, "") || "your host";
  const payPath = (id, ws, rid, origin) => `${origin || ""}/e/${encodeURIComponent(id)}?pay=1${replyToken && rid ? `#reply=${encodeURIComponent(rid)}.${replyToken(ws, rid)}` : ""}`;
  /** One reminder to one buyer: the bell, email, a text if they turned it on. Records it on the order. Returns how many channels went. */
  async function send(ws, id, ev, rid, r, kind, now = Date.now(), origin = process.env.ENCORE_PUBLIC_URL || "") {
    const S = scopeStore(store, ws), st = payStateOf(ev, r); if (st.state !== "unpaid") return 0;
    const tz = eventTz(ev), pk = pickupOf(ev, r, tz), title = ev.pubTitle || ev.name || "drop", host = hostFirst(ws, ev);
    const text = reminderText(kind, { title, host, amount: st.amount, span: pk.span, pickupDay: pk.date ? P().day(pk.date) : "" }), link = payPath(id, ws, rid, origin);
    S.update("rsvps/" + rid, { payReminders: [...(Array.isArray(r.payReminders) ? r.payReminders : []), { k: kind, at: now }].slice(-PAY_REMIND.max) });
    const em = String(r.email || "").trim().toLowerCase(); let n = 0;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      try { if (X.notify(em, { kind: "payremind", key: `payrem-${rid}-${kind}-${now}`, text, link: `/e/${encodeURIComponent(id)}?pay=1`, eventId: id }) !== false) n++; } catch {}
      // the order email already carried the pay link, so the first reminder skips email
      if (kind !== "placed" && !(kind === "eve" && r.payEveMailAt) && X.canEmail(em)) { const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
        if (cfg) { const spot = kind === "eve" || kind === "morning" ? [String(ev.venueAddr || "").trim(), ev.hood].filter(Boolean).join(", ") : "";
          const body = [`Hi ${first(r.name) || "there"},`, "", text, "", `Pay ${host} ${st.amount}: ${link}`, "", ...(pk.date ? [`Pickup: ${P().day(pk.date)}${pk.span ? ", " + pk.span : ""}${spot ? ` at ${spot}` : ev.hood ? ` in ${ev.hood}` : ""}`] : []),
            ...(st.pickupOk ? ["Paying at pickup instead? Open the link and choose it."] : []), "Already paid? Open the link and tap I paid.", "", `Payments go straight to ${host}. Pottery Lab doesn't hold the money.`];
          const m = await sendEmail(cfg, { list: "guest", origin, brandWs: ws, to: em, subject: kind === "eve" ? `Pickup tomorrow: ${title}. Not paid yet` : kind === "morning" ? `Pickup today: ${title}. Not paid yet` : `Not paid yet: ${title}`, text: body.join("\n") + "\n", fromName: host }).catch(() => ({}));
          if (m?.ok) { n++; if (kind === "eve") S.update("rsvps/" + rid, { payEveMailAt: now }); } } }
      try { const T = potto(); if (T?.enqueue?.(em, { key: `payrem|${rid}|${kind}|${now}`, kind: "reminder", eventId: id, vars: [first(r.name) || "there", title, pk.span || "your pickup"], text: `${text} ${link}` }, now)) n++; } catch {}
    }
    return n;
  }
  /** Every unpaid order with a reminder due, once each. */
  async function runReminders(now = Date.now(), origin = process.env.ENCORE_PUBLIC_URL || "", wsList = null) {
    let sent = 0;
    for (const ws of wsList || allWorkspaceIds()) { const S = scopeStore(store, ws), E = new Map();
      for (const d of S.list("events")) if (d.data?.drop && !d.data.cancelled && !d.data.example && asksAhead(d.data)) E.set(d.id, d.data);
      if (!E.size) continue;
      for (const d of S.list("rsvps")) { const r = d.data || {}, ev = E.get(r.eventId); if (!ev || (+r.orderAt || +r.createdAt || 0) < (+ev.batchAt || 0) - 1) continue;
        const k = dueReminder(ev, r, now); if (!k) continue; if (await send(ws, r.eventId, ev, d.id, r, k, now, origin)) sent++; } }
    return { sent };
  }
  /** The host's Remind unpaid: one gentle message to each unpaid buyer of this batch, at most every 12 hours a drop. */
  async function remindUnpaid(ws, id, now = Date.now(), origin = "") {
    const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev?.drop) return { error: "No such drop.", status: 404 };
    if (!asksAhead(ev)) return { error: "This drop takes payment at pickup, so there's nothing to remind.", status: 400 };
    const wait = (+ev.remindUnpaidAt || 0) + PAY_REMIND.hostEveryMs - now; if (wait > 0) { const h = Math.ceil(wait / 3600e3); return { error: `You reminded them already. You can again in ${h} hour${h === 1 ? "" : "s"}.`, status: 429, code: "rate_limited" }; }
    if (isQuiet(now, eventTz(ev))) return { error: "It's late where your buyers are. Try again after 8am.", status: 409, code: "quiet" };
    let sent = 0, capped = 0, unpaid = 0;
    for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || (+r.orderAt || +r.createdAt || 0) < (+ev.batchAt || 0) - 1 || payStateOf(ev, r).state !== "unpaid") continue; unpaid++;
      if ((r.payReminders || []).length >= PAY_REMIND.max) { capped++; continue; }
      if (await send(ws, id, ev, d.id, r, "host", now, origin)) sent++; }
    S.update("events/" + id, { remindUnpaidAt: now });
    return { ok: true, unpaid, sent, capped };
  }
  /** What the host's Orders needs: can buyers pay this host ahead at all? */
  const hostCanBePaid = (ws, ev) => { const pay = payOfWs(ws); return hasPay(pay) && eventMethods(pay, ev || {}).length > 0 || !!String(ev?.ticketUrl || "").trim(); };
  return { send, runReminders, remindUnpaid, hostCanBePaid, payPath };
}
