// Plans: your own upcoming things on one timeline, grouped by day (public/plans.html, public/timeline.js).
//
// - What counts: replies you sent (signed in, by your account's email; signed out, by the reply proofs this browser
//   keeps: event id, reply id and code), the events you host, drop pickups (an order is a reply), classes in a series,
//   to-dos that come from a reply ("Bring a dessert", "Pay $20 to finish", "Add the address" for a host), waitlist
//   holds and asks, and events you saved that are public.
// - One item per thing: { key, kind, eventId, title, date, endDate, time, startMs, endMs, allDay, day, status, place,
//   host, sub, href }. `day` is the item's own date where it happens (localDay in the event's time zone).
// - Privacy: only your own replies and your own workspace. The exact place (venue name) only for guests who are in and
//   for the host; everyone else sees the area. Street addresses never go on the timeline.
// - Itineraries: `itinerary: [{ day, time, kind, title, sub }]` on the event, for multi-day plans (a weekend away, a
//   summit) and anything the host wants to lay out. The host edits it (POST /api/host/events/:id/itinerary); guests
//   who are in see it, or everyone with the link when the host makes it public (itineraryPublic).
// - Peek: tapping a row opens a sheet (public/peek.js) built from GET /api/plans/peek/:id: the cover, the host, when,
//   where (the row's rule; the street address only for people who are in), the description, who's going (first names
//   for people who are in, else the faces the invite already shows) and your reply. A reply changes through
//   POST /api/plans/peek/:id/reply: it finds your reply (the proof this browser holds, or your account's email) and
//   hands it to the invite's own write (POST /api/public/reply/:id). Paid spots, asks to join and orders stay on the
//   event page (replyRule).
// - Calendar: a private webcal feed of your plans (/plans/feed/<token>.ics, built with the .ics code in hooksout.js).
import crypto from "node:crypto";
import { scopeStore, allWorkspaceIds, workspaceOfEvent, getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { seatsTaken, waitlistPos, waitlistOf, guestPlace, replyKey } from "./social.js";
import { eventTz, zonedMs, tzOk, todayIn } from "./tz.js";
import { localDay } from "./hooks.js";
import { episodeOf } from "./episodes.js";
import { vevent, calendar, publicCopy } from "./hooksout.js";
import { slotLabel } from "./preorder.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const dayMs = 864e5;
export const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * dayMs).toISOString().slice(0, 10);
const dayNo = (d) => Math.round(Date.parse(d + "T12:00:00Z") / dayMs);
const titleOf = (ev) => clean(ev?.pubTitle || ev?.name, 120) || "An event";
const areaOf = (ev) => [clean(ev?.hood, 60), clean(String(ev?.city || "").split(",")[0], 60)].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
const listOf = (v) => (Array.isArray(v) ? v : String(v || "").split(/\n|,(?![^(]*\))/)).map((x) => clean(x, 80)).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).slice(0, 12);
const priced = (ev) => !!ev?.price && ev.price !== "chip" && !ev.free;

/** Every kind a timeline item can be. Pure. */
export const KINDS = ["going", "hosting", "pickup", "class", "todo", "waitlist", "saved"];
/** The kinds an itinerary item can be, each with its own small icon on the page. */
export const ITIN_KINDS = ["arrive", "checkin", "meal", "workshop", "talk", "activity", "free", "travel", "checkout"];
const MAX_ITIN = 40;

/** The last day of an event: its endDate when that's after its date. Pure. */
export const lastDay = (ev) => (ISO.test(ev?.endDate || "") && ISO.test(ev?.date || "") && ev.endDate > ev.date ? ev.endDate : ev?.date || "");
/** A plan that spans more than one day (a weekend away, a summit). Pure. */
export const multiDay = (ev) => !!ev && ISO.test(ev.date || "") && lastDay(ev) > ev.date;

/** "Sat 9 to 10am" or "10:00-11:00" starts at "09:00" / "10:00"; "" when there's no time in it. Pure. */
export function slotStart(label) {
  const t = slotLabel(label), m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t.replace(/^[A-Za-z]{3,9}\.?\s+/, "")); if (!m) return "";
  let h = +m[1]; if (h > 23) return ""; const ap = (m[3] || (/(am|pm)/i.exec(t)?.[1]) || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
}
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** The next date (on or after `today`) a weekday named at the start of a slot falls on, or "". Pure. */
export function slotDay(label, today) { const m = /^(sun|mon|tue|wed|thu|fri|sat)/i.exec(String(label || "").trim()); if (!m || !ISO.test(today)) return "";
  const want = WD.indexOf(m[1].toLowerCase()), have = new Date(today + "T12:00:00Z").getUTCDay(); return addDays(today, (want - have + 7) % 7); }

/** Start and end in epoch ms, from the event's own date, times and time zone. Pure apart from the time zone maths. */
export function spanOf(ev, { date = ev?.date, time = ev?.startTime } = {}) {
  const tz = eventTz(ev), st = HHMM.test(time || "") ? time : "", end = lastDay(ev) && date === ev?.date ? lastDay(ev) : date;
  if (!ISO.test(date || "")) return { startMs: null, endMs: null, allDay: true, tz };
  if (!st) { const s = zonedMs(date, "00:00", tz), e = zonedMs(addDays(end, 1), "00:00", tz); return { startMs: s, endMs: e, allDay: true, tz }; }
  const s = zonedMs(date, st, tz); let e = HHMM.test(ev?.endTime || "") && date === ev?.date ? zonedMs(end, ev.endTime, tz) : s + 3 * 3600e3; if (e <= s) e += dayMs;
  return { startMs: s, endMs: e, allDay: false, tz };
}

/** What kind of item a reply or hosted event is. Pure. */
export function kindOf(ev, reply = null, { hosting = false, saved = false, episode = null } = {}) {
  if (hosting) return "hosting";
  if (saved) return "saved";
  const r = reply?.response;
  if (r === "waitlist" || r === "requested") return "waitlist";
  if (ev?.drop || (ev?.preorder && (reply?.orderLines || []).length)) return "pickup";
  if (ev?.series === true || episode || +ev?.sessions > 1) return "class";
  return "going";
}

/** The short status on an item's sub-line ("Going", "Hosting · 12 in", "Waitlist #2", "Pickup 10 to 11am"). Pure. */
export function statusOf(kind, ev, reply = null, { going = 0, asking = 0, orders = 0, pos = 0, hostFirst = "", episode = null } = {}) {
  const host = hostFirst || "the host";
  if (kind === "hosting") { if (!ev?.published && !ev?.discoverable) return "Draft";
    if (ev?.drop) return `Pickup window · ${orders} order${orders === 1 ? "" : "s"}`;
    return [`Hosting · ${going} in`, asking ? `${asking} asking` : ""].filter(Boolean).join(" · "); }
  if (kind === "saved") return "Saved";
  if (kind === "waitlist") return reply?.response === "requested" ? `Asked · waiting on ${host}` : pos ? `Waitlist #${pos}` : "On the waitlist";
  if (kind === "pickup") { const s = slotLabel(reply?.pickupLabel || reply?.slot || ""); const code = String(reply?.code || "").slice(0, 6).toUpperCase(); return [s ? `Pickup ${s}` : "Pickup", code ? `#${code}` : ""].filter(Boolean).join(" · "); }
  if (reply?.response === "maybe") return reply.interest === "in" ? "In · waiting on the date" : "Maybe";
  const pay = reply?.response === "going" && priced(ev) && !reply.paid ? (reply.paidClaim ? `Paid? ${host} will confirm` : ev.ticketNote ? `Pay ${ev.price} at the door` : `Almost in · pay ${ev.price}`) : "";
  const base = kind === "class" && episode ? `Class ${episode.n}${episode.total > episode.n ? ` of ${episode.total}` : ""}` : "Going";
  return [base, pay].filter(Boolean).join(" · ");
}

/** Where to say it is: the venue's name for people who are in and the host, else the area. Never a street address. Pure. */
export function placeOf(ev, { exact = false, say = (x) => x } = {}) {
  const area = areaOf(ev); if (!exact) return area;
  const v = clean(say(ev?.venueName || ""), 60); return v && !/\d{2,}/.test(v) ? [v, clean(ev?.hood, 40)].filter((x, i, a) => x && a.indexOf(x) === i).join(", ") : area;
}

/** "Bring a dessert": the bring-list item a guest claimed, as a to-do. Pure. */
export const bringLine = (slot) => { const s = clean(slot, 60); if (!s) return ""; return `Bring ${/^[A-Z][a-z]*\b/.test(s) && !/^I\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s}`; };

/** One timeline item. Pure apart from the time zone maths. */
export function itemOf({ id, ev, kind, status, place = "", host = "", href = "", key = "", title = "", date = "", time = "", ord = 0, extra = {} }) {
  const d = date || ev?.date || "", t = time || (date && date !== ev?.date ? "" : ev?.startTime || ""), sp = spanOf(ev, { date: d, time: t });
  const day = sp.startMs != null && !sp.allDay ? localDay(sp.startMs, sp.tz) : d;
  const sub = [status, place, host ? `with ${host}` : ""].filter(Boolean).join(" · ");
  return { key: key || `${kind}:${id}`, kind, eventId: id, title: title || titleOf(ev), date: day, endDate: multiDay(ev) && kind !== "todo" && !date ? lastDay(ev) : "", time: HHMM.test(t) ? t : "", tz: sp.tz,
    startMs: sp.startMs, endMs: sp.endMs, allDay: sp.allDay, status, place, host, sub, href: href || `/e/${encodeURIComponent(id)}`, ord, ...extra };
}

// ---------- itineraries ----------
const TIME_IN = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
/** "16:00", "4pm", "4:30 pm" read as "HH:MM"; "" for nothing; null for something that isn't a time. Pure. */
export function timeIn(v) { const s = String(v ?? "").trim().toLowerCase().replace(/\./g, ""); if (!s) return ""; const m = TIME_IN.exec(s); if (!m) return null;
  let h = +m[1]; const mm = m[2] || "00"; if (+mm > 59) return null; if (m[3]) { if (h < 1 || h > 12) return null; if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0; } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${mm}`; }
const short = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/**
 * An itinerary as the host typed it, checked against the event's dates. `day` is a date inside the event's dates or a
 * day number (1 is the first day). Returns { items } sorted by day and time, or { error } (a sentence the host reads).
 */
export function cleanItinerary(raw, ev) {
  if (raw == null) return { items: [] }; if (!Array.isArray(raw)) return { error: "The plan should be a list." };
  if (!ISO.test(ev?.date || "")) return { error: "Pick the date first, then lay out the plan." };
  const from = ev.date, to = lastDay(ev), n = dayNo(to) - dayNo(from) + 1, out = [];
  if (raw.length > MAX_ITIN) return { error: `Keep it to ${MAX_ITIN} things or fewer.` };
  for (const [i, x] of raw.entries()) {
    const title = clean(x?.title, 80), sub = clean(x?.sub, 100), at = `Item ${i + 1}`;
    if (!title && !sub && !String(x?.time ?? "").trim()) continue; // an empty row the host never filled
    if (!title) return { error: `${at} needs a title, like "Check in".` };
    let day = x?.day; if (typeof day === "number" || /^\d{1,2}$/.test(String(day ?? ""))) { const k = Math.floor(+day); if (k < 1 || k > n) return { error: `${title}: pick a day from 1 to ${n}.` }; day = addDays(from, k - 1); }
    else if (day == null || day === "") day = from;
    if (!ISO.test(String(day)) || day < from || day > to) return { error: n > 1 ? `${title}: pick a day from ${short(from)} to ${short(to)}.` : `${title}: this one is on ${short(from)}.` };
    const time = timeIn(x?.time); if (time === null) return { error: `${title}: use a time like 4pm or 16:00.` };
    const kind = ITIN_KINDS.includes(x?.kind) ? x.kind : guessKind(title);
    out.push({ day, time, kind, title, sub });
  }
  out.sort((a, b) => a.day.localeCompare(b.day) || (a.time || "99").localeCompare(b.time || "99"));
  return { items: out };
}
/** A kind from the words, when the host didn't pick one. Pure. */
export function guessKind(t) { const s = lc(t);
  return /check ?in|keys|room/.test(s) ? "checkin" : /check ?out|depart|leave|head home/.test(s) ? "checkout" : /arriv|meet at|pick ?up|station|airport/.test(s) ? "arrive" : /dinner|lunch|breakfast|brunch|supper|meal|coffee|drinks|picnic/.test(s) ? "meal"
    : /workshop|class|session|lab|studio/.test(s) ? "workshop" : /talk|keynote|panel|fireside/.test(s) ? "talk" : /drive|train|ferry|flight|bus|travel/.test(s) ? "travel" : /free|rest|nap|swim|downtime/.test(s) ? "free" : "activity"; }

/** The itinerary a viewer may read: street addresses and the exact meet point are taken out for anyone not in. Pure. */
export function itineraryFor(ev, { exact = false } = {}) {
  const r = cleanItinerary(ev?.itinerary || [], ev); if (r.error) return [];
  if (exact) return r.items;
  const scrub = scrubberOf(ev);
  return r.items.map((x) => ({ ...x, title: scrub(x.title), sub: scrub(x.sub) }));
}
/** Swaps the street address, a private meet point and anything shaped like "12 Java St" for the area. Pure. */
export function scrubberOf(ev) {
  const secret = [ev?.venueAddr, ev?.approvalRequired || !ev?.discoverable ? ev?.meetPoint : "", ev?.venueAddr ? ev?.venueName : ""].map((x) => clean(x, 200)).filter((x) => x && x.length >= 4);
  const area = areaOf(ev) || "the area";
  return (s) => { let t = String(s || ""); for (const x of secret) t = t.split(x).join(area); return t.replace(/\b\d{1,5}\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Pl|Place|Way|Ct)\b\.?(?:,?\s*(?:Apt|Unit|#)\s*\w+)?/g, area); };
}
/** The itinerary in days: [{ date, n, items }], one per day of the event (empty days too). Pure. */
export function itineraryDays(ev, items) { if (!ISO.test(ev?.date || "")) return []; const out = [], to = lastDay(ev);
  for (let d = ev.date, n = 1; d <= to && n <= 31; d = addDays(d, 1), n++) { const tz = eventTz(ev); out.push({ date: d, n, items: items.filter((x) => x.day === d).map((x) => (HHMM.test(x.time || "") ? { ...x, at: zonedMs(d, x.time, tz) } : x)) }); } return out; }
/** The chip on a plan's cover: the host's own label, else "Weekend away", "Summit", "Supper club" and so on. Pure. */
export function typeChip(ev) {
  const own = clean(ev?.typeLabel, 24); if (own) return own;
  const t = lc([ev?.pubTitle, ev?.name, ev?.activity, ev?.kind, ev?.format].join(" ")), days = multiDay(ev) ? dayNo(lastDay(ev)) - dayNo(ev.date) + 1 : 1;
  if (/summit|conference|forum|offsite/.test(t) || ["summit", "owned", "conference"].includes(ev?.kind)) return "Summit";
  if (/retreat/.test(t)) return "Retreat";
  if (days > 1 && /trip|getaway|weekend|cabin|away|upstate|camp/.test(t)) return "Weekend away";
  if (days > 1) return days <= 3 ? "Weekend away" : "Trip";
  if (ev?.drop) return "Pickup";
  if (/supper|dinner/.test(t)) return "Supper club";
  if (/workshop|class|lesson/.test(t)) return "Workshop";
  if (/run|hike|walk/.test(t)) return "Outdoors";
  return "Gathering";
}

// ---------- the peek ----------
const clock12 = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
/** "Fri, Dec 5 · 7pm"; a trip is "Fri, Dec 5 to Sun, Dec 7". Pure. */
export function whenLine(ev) { if (!ISO.test(ev?.date || "")) return "Date to come"; if (multiDay(ev)) return `${short(ev.date)} to ${short(lastDay(ev))}`;
  const t = clock12(ev.startTime); return t ? `${short(ev.date)} · ${t}` : short(ev.date); }
/** No Maybe on this invite (the host's "No Maybe option"; dinners and summits leave it off unless the host turns it on). Same rule as the invite. Pure. */
export const noMaybe = (ev) => (ev?.noMaybe != null ? !!ev.noMaybe : ["dinner", "summit"].includes(String(ev?.kind || "")));
/** A reply's state: going, maybe, no, waitlist, requested, or "" for none. Pure. */
export const replyState = (r) => { const x = r?.response === "declined" ? "no" : r?.response; return ["going", "maybe", "no", "waitlist", "requested"].includes(x) ? x : ""; };
/** The three answers the peek offers. */
export const ANSWERS = [["going", "I'm in"], ["maybe", "Maybe"], ["no", "Can't go"]];
/**
 * Can this reply change to `want` right in the peek? { ok } (with `same` when it already is), { page } (a plain line:
 * finish on the event page, for a paid spot, an ask to join, an order or a reply the invite never keyed), { closed }
 * (cancelled or over) or { error }. Pure apart from today's date where the event is.
 */
export function replyRule(ev, r, want, { host = "the host", today = todayIn(eventTz(ev)) } = {}) {
  if (!ev || ev.cancelled) return { closed: "This one was cancelled, so replies are closed." };
  if (ISO.test(lastDay(ev)) && lastDay(ev) < today) return { closed: "This one already happened." };
  if (!ANSWERS.some(([v]) => v === want)) return { error: "Pick I'm in, Maybe or Can't go." };
  if (!r) return { page: "Reply on the event page." };
  const cur = replyState(r); if (cur === want) return { ok: true, same: true };
  if (want === "maybe" && noMaybe(ev)) return { error: `${host} asked for a yes or no on this one.` };
  if (!(r._k || (Array.isArray(r._keys) && r._keys.length))) return { page: "Change your reply on the event page." };
  if (ev.drop || ev.preorder) return { page: want === "going" ? "Pick your order on the event page." : "Change your order on the event page." };
  if (want === "going" && cur !== "going") {
    if (ev.approvalRequired && !r.letInAt) return { page: `${host} lets each guest in. Ask to join on the event page.`, ask: true };
    if (priced(ev) && !ev.ticketNote && !r.paid) return { page: `This one is ${clean(ev.price, 20)}. Pay on the event page to hold your spot.`, pay: true };
  }
  if (cur === "going" && r.paid && priced(ev)) return { page: `You paid for this one. Change it on the event page so ${host} can sort it out.`, pay: true };
  return { ok: true };
}

// ---------- building the timeline ----------
export function makePlans({ store, C, X }) {
  const profile = (ws) => { try { return C.profileOf?.(ws) || null; } catch { return null; } };
  const hostFirstOf = (ws, ev) => first(profile(ws)?.name || ev?.hostName || getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || "");
  const episode = (id, ws, host = false) => { try { return episodeOf(store, id, ws, { host }); } catch { return null; } };

  /** The reply items for one event: the main item, and its to-dos. */
  function replyItems(ws, id, ev, rid, r, today) {
    if (!ev || ev.example || ev.cancelled || ev.parentId) return [];
    const S = scopeStore(store, ws), ep = episode(id, ws), kind = kindOf(ev, r, { episode: ep }), host = hostFirstOf(ws, ev), inn = r.response === "going";
    let date = ev.date || "", time = "";
    if (kind === "pickup") { const lab = r.pickupLabel || r.slot || ""; time = slotStart(lab); if (!date) date = slotDay(slotLabel(lab), today); }
    const pos = kind === "waitlist" ? waitlistPos(S.list("rsvps").filter((d) => d.data?.eventId === id), rid) : 0;
    const status = statusOf(kind, ev, r, { pos, hostFirst: host, episode: ep });
    const main = itemOf({ id, ev, kind, status, place: placeOf(ev, { exact: inn, say: guestPlace(ws) }), host, date: date !== ev.date ? date : "", time, extra: { rid, in: inn, ...(multiDay(ev) && inn ? { itinerary: itineraryFor(ev, { exact: true }) } : {}) } });
    if (multiDay(ev) || ev.itinerary?.length) main.href = `/plans/${encodeURIComponent(id)}`;
    const out = [main];
    if (!main.date) return out;
    if (inn && r.slot && !ev.drop && (ev.slots || []).includes(r.slot)) out.push(itemOf({ id, ev, kind: "todo", key: `todo:bring:${id}`, title: bringLine(r.slot), status: `For ${titleOf(ev)}`, date: main.date, time: main.time, ord: -1 }));
    if (inn && priced(ev) && !r.paid && !r.paidClaim && !ev.ticketNote && !ev.drop) out.push(itemOf({ id, ev, kind: "todo", key: `todo:pay:${id}`, title: `Pay ${ev.price} to finish`, status: `For ${titleOf(ev)}`, date: main.date, time: main.time, ord: -2 }));
    return out;
  }

  /** The host's own events and their to-dos. */
  function hostItems(ws, from) {
    const S = scopeStore(store, ws), all = S.list("rsvps"), out = [];
    for (const d of S.list("events")) { const ev = d.data, id = d.id; if (!ev || !ID.test(id) || ev.example || ev.sample || ev.cancelled || ev.parentId || !ISO.test(ev.date || "") || lastDay(ev) < from) continue;
      const mine = all.filter((x) => x.data?.eventId === id), going = Math.round(seatsTaken(ev, mine)), asking = mine.filter((x) => x.data?.response === "requested").length, orders = mine.filter((x) => x.data?.response === "going" && (x.data.orderLines || []).length).length;
      const ep = episode(id, ws, true), status = statusOf("hosting", ev, null, { going, asking, orders });
      const it = itemOf({ id, ev, kind: "hosting", status, place: placeOf(ev, { exact: true }), href: `/plans/${encodeURIComponent(id)}`,
        extra: { draft: status === "Draft", ...(ep ? { classNo: ep.n } : {}), ...(multiDay(ev) ? { itinerary: itineraryFor(ev, { exact: true }) } : {}) } });
      if (ev.drop) { const lab = (ev.slots || [])[0] || ""; if (lab) { it.time = slotStart(lab) || it.time; } }
      out.push(it);
      if (going > 0 && !ev.drop && !ev.venueAddr && !ev.venueName && !ev.meetPoint && !ev.online) out.push(itemOf({ id, ev, kind: "todo", key: `todo:addr:${id}`, title: "Add the address", status: `${going} ${going === 1 ? "person is" : "people are"} in`, href: `/plans/${encodeURIComponent(id)}`, date: it.date, time: it.time, ord: -1 }));
    }
    return out;
  }

  /**
   * Everything on one person's plans. `email` (signed in) finds their replies; `proofs` ([{ id, rid, code }]) are the
   * replies this browser holds; `ws` is their own workspace (hosting). Past items only with `past`.
   */
  function timeline({ email = "", ws = "", proofs = [], saved = [], tz = "", now = Date.now(), past = false } = {}) {
    const vz = tzOk(tz) ? tz : "", today = localDay(now, vz), from = past ? addDays(today, -180) : addDays(today, -1);
    const replies = new Map(); // eventId -> { ws, id, rid, r, ev }
    const keep = (ws2, id, rid, r) => { const cur = replies.get(id), at = (x) => x.changedAt || x.at || x.createdAt || 0; if (!cur || at(r) >= at(cur.r)) replies.set(id, { ws: ws2, id, rid, r }); };
    if (email) { const em = lc(email); for (const w of allWorkspaceIds()) { for (const d of scopeStore(store, w).list("rsvps")) { const r = d.data || {}; if (lc(r.email) === em && ID.test(r.eventId || "")) keep(w, r.eventId, d.id, r); } } }
    for (const p of (Array.isArray(proofs) ? proofs : []).slice(0, 80)) { const id = String(p?.id || ""); if (!ID.test(id)) continue; const P = X.rsvpProof?.(id, String(p.rid || "").slice(0, 80), String(p.code || "").slice(0, 40)); if (P) keep(P.ws, id, String(p.rid), P.r); }
    let items = [];
    for (const x of replies.values()) { if (["no", "declined"].includes(x.r.response) || (ws && x.ws === ws)) continue; const ev = scopeStore(store, x.ws).get("events/" + x.id)?.data; items.push(...replyItems(x.ws, x.id, ev, x.rid, x.r, today)); }
    if (ws && ws !== DEFAULT_WS) items.push(...hostItems(ws, from));
    // saves: public events only (the card the whole site shows), never one you've replied to or host
    const savedIds = new Set([...(Array.isArray(saved) ? saved : []), ...(email ? (store.get("system/plsave-" + hash(email))?.data?.items || []).filter((s) => s?.kind === "event").map((s) => s.ref) : [])].filter((x) => ID.test(String(x || ""))).slice(0, 100));
    for (const id of savedIds) { if (replies.has(id) || items.some((i) => i.eventId === id)) continue; const w = workspaceOfEvent(id); if (!w || w === ws) continue; const ev = scopeStore(store, w).get("events/" + id)?.data;
      if (!ev || ev.example || ev.cancelled || !ev.discoverable || ev.approvalRequired || ev.private || ev.friendsOnly || !ISO.test(ev.date || "")) continue;
      items.push(itemOf({ id, ev, kind: "saved", status: "Saved", place: areaOf(ev), host: hostFirstOf(w, ev) })); }
    const undated = items.filter((i) => !i.date), dated = items.filter((i) => i.date && (i.endDate || i.date) >= from);
    const sorted = dated.filter((i) => (past ? (i.endDate || i.date) < today : (i.endDate || i.date) >= today)).sort(byTime);
    return { today, tomorrow: addDays(today, 1), now, tz: vz, items: past ? sorted.reverse() : sorted, undated: past ? [] : undated, pastCount: past ? 0 : dated.filter((i) => (i.endDate || i.date) < today).length };
  }

  /** The plan page for one event: its cover, and its itinerary when the viewer may read it. */
  function planOf(id, { rid = "", code = "", email = "", ws: myWs = "" } = {}) {
    const ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null; if (!ev || ev.example) return null;
    const isHost = !!myWs && myWs === ws; if (!isHost && !(ev.published || ev.discoverable)) return null;
    let mine = rid ? X.rsvpProof?.(id, rid, code)?.r : null;
    if (!mine && email) mine = scopeStore(store, ws).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id && lc(r.email) === lc(email)).sort((a, b) => (b.changedAt || b.at || 0) - (a.changedAt || a.at || 0))[0] || null;
    const inn = isHost || mine?.response === "going", may = inn || !!ev.itineraryPublic, h = profile(ws) || {};
    const items = may ? itineraryFor(ev, { exact: inn }) : [];
    const sp = spanOf(ev), all = scopeStore(store, ws).list("rsvps").filter((d) => d.data?.eventId === id);
    const status = isHost ? statusOf("hosting", ev, null, { going: Math.round(seatsTaken(ev, all)), asking: all.filter((d) => d.data?.response === "requested").length }) : mine ? statusOf(kindOf(ev, mine), ev, mine, { hostFirst: hostFirstOf(ws, ev) }) : "";
    return { id, eventId: id, key: "plan:" + id, title: titleOf(ev), date: ev.date || "", startMs: sp.startMs, endMs: multiDay(ev) ? spanOf({ ...ev, startTime: "" }).endMs : sp.endMs, allDay: multiDay(ev) || sp.allDay, tz: sp.tz, status, editable: isHost && !ev.drop, endDate: lastDay(ev), startTime: ev.startTime || "", endTime: ev.endTime || "", chip: typeChip(ev), multi: multiDay(ev),
      place: placeOf(ev, { exact: inn, say: guestPlace(ws) }), cover: /^\/(_blob|presets)\//.test(ev.coverPhoto || "") ? ev.coverPhoto : (h.gallery || [])[0] || "", coverArt: ev.coverArt || null,
      host: { name: clean(h.name || ev.hostName, 60), first: hostFirstOf(ws, ev), handle: h.handle || "", avatarArt: h.theme?.avatarArt || "", color: h.theme?.accent || h.color || "" },
      isHost, going: inn, response: mine?.response || "", public: !!ev.itineraryPublic, locked: !may, days: may ? itineraryDays(ev, items) : [], count: (ev.itinerary || []).length,
      // what to bring and what the host covers, for the "Before you go" card (the invite shows the same lists to everyone)
      bring: listOf(ev.bring).filter((x) => !/^yourself$/i.test(x)), included: listOf(ev.included), city: clean(String(ev.city || "").split(",")[0], 60) };
  }
  /** Who is looking at one event: its host (their own workspace), or a guest by the proof this browser holds, or by their account's email. */
  function viewerOf(id, { rid = "", code = "", email = "", ws: myWs = "" } = {}) {
    const ws = ID.test(id) ? workspaceOfEvent(id) : null, S = ws && scopeStore(store, ws), ev = S?.get("events/" + id)?.data; if (!ev || ev.example) return null;
    let r = null, mine = "";
    if (rid) { const P = X.rsvpProof?.(id, String(rid).slice(0, 80), String(code || "").slice(0, 40)); if (P) { r = P.r; mine = P.rid; } }
    if (!r && email) { const d = S.list("rsvps").filter((x) => x.data?.eventId === id && lc(x.data?.email) === lc(email)).sort((a, b) => (b.data.changedAt || b.data.at || b.data.createdAt || 0) - (a.data.changedAt || a.data.at || a.data.createdAt || 0))[0]; if (d) { r = d.data; mine = d.id; } }
    return { ws, S, ev, isHost: !!myWs && myWs === ws, r, rid: mine };
  }

  /**
   * The peek: what this viewer may see of one event, and what they can do there. Never another guest's contact, never
   * the street address unless they're in (or host it), first names only for people who are in, and nothing at all for
   * a draft or link-only event they have no reply to.
   */
  function peekOf(id, o = {}) {
    const V = viewerOf(id, o); if (!V) return null; const { ws, S, ev, isHost, r, rid } = V;
    if (!isHost && !r && (!(ev.published || ev.discoverable) || ev.cancelled)) return null;
    const h = profile(ws) || {}, hostFirst = hostFirstOf(ws, ev), all = S.list("rsvps").filter((d) => d.data?.eventId === id), say = guestPlace(ws);
    const state = r ? replyState(r) : "", inn = isHost || state === "going", today = todayIn(eventTz(ev)), past = ISO.test(lastDay(ev)) && lastDay(ev) < today, sp = spanOf(ev);
    const going = Math.round(seatsTaken(ev, all)), asking = all.filter((d) => d.data?.response === "requested").length, waiting = waitlistOf(all).length;
    // who's going: first names (as Who's coming shows them to people who are in), else the faces the invite shows everyone
    let who = null;
    if (isHost || !ev.hideGuests) { const seen = new Set(), names = [];
      if (inn) for (const d of all) { const x = d.data || {}; if (x.response !== "going" || x.pairOf) continue; const k = replyKey(x) || d.id; if (seen.has(k)) continue; seen.add(k);
        if (x.showMe === false && d.id !== rid) continue; if (names.length < 5) names.push({ name: first(x.name) || "Guest", you: d.id === rid }); }
      let faces = []; if (!inn) { try { faces = (C.goingOf?.(ws, id, ev)?.faces || []).slice(0, 5).map((f) => ({ art: String(f.art || "").slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(f.color || "") ? f.color : "" })); } catch {} }
      who = { count: going, names, faces }; }
    const addr = inn ? clean([...new Set([isHost ? ev.meetPoint : say(ev.meetPoint), isHost ? ev.venueAddr : say(ev.venueAddr)].map((x) => clean(x, 120)).filter(Boolean))].join(", "), 200) : "";
    const pos = state === "waitlist" ? waitlistPos(all, rid) : 0, scrub = inn ? (x) => x : scrubberOf(ev);
    const cover = /^\/(_blob|presets)\//.test(ev.coverPhoto || "") || /^https:\/\/[^\s"'<>]+$/.test(ev.coverPhoto || "") ? ev.coverPhoto : "";
    const href = multiDay(ev) || ev.itinerary?.length ? `/plans/${encodeURIComponent(id)}` : `/e/${encodeURIComponent(id)}`, draft = isHost && !ev.published && !ev.discoverable;
    const answers = ANSWERS.filter(([v]) => v !== "maybe" || !noMaybe(ev) || state === "maybe").map(([value, label]) => { const R = replyRule(ev, r, value, { host: hostFirst, today });
      return { value, label, ...(R.page ? { page: R.page } : {}), ...(R.pay ? { pay: true } : {}), ...(R.ask ? { ask: true } : {}), ...(R.error ? { error: R.error } : {}) }; });
    const closed = ev.cancelled ? "This one was cancelled." : past ? "This one already happened." : "";
    return {
      id, eventId: id, key: "peek:" + id, title: titleOf(ev), href, invite: `/e/${encodeURIComponent(id)}`, when: whenLine(ev), date: ev.date || "", endDate: multiDay(ev) ? lastDay(ev) : "", time: HHMM.test(ev.startTime || "") ? ev.startTime : "",
      startMs: sp.startMs, endMs: multiDay(ev) ? spanOf({ ...ev, startTime: "" }).endMs : sp.endMs, allDay: multiDay(ev) || sp.allDay, tz: sp.tz, multi: multiDay(ev), chip: typeChip(ev),
      cover, coverArt: ev.coverArt && typeof ev.coverArt === "object" ? ev.coverArt : null,
      host: { name: clean(h.name || ev.hostName, 60), first: hostFirst, handle: clean(h.handle, 40), href: h.handle ? `/@${encodeURIComponent(h.handle)}` : "", avatarArt: clean(h.theme?.avatarArt, 120),
        avatarUrl: /^(\/_blob\/[A-Za-z0-9_-]{6,80}|https:\/\/[^\s"<>()]+)$/.test(h.theme?.avatarUrl || "") ? h.theme.avatarUrl : "", color: /^#[0-9a-f]{6}$/i.test(h.theme?.accent || h.color || "") ? h.theme?.accent || h.color : "" },
      place: placeOf(ev, { exact: inn, say: isHost ? (x) => x : say }), locked: !inn, address: addr, online: !!ev.online,
      desc: clean(scrub(publicCopy(ev)), 400), who, role: isHost ? "host" : r ? "guest" : "visitor",
      reply: isHost ? null : { state, pos, waiting, paid: !!r?.paid, status: r ? statusOf(kindOf(ev, r), ev, r, { pos, hostFirst }) : "", answers, closed, hostFirst },
      actions: { calendar: ISO.test(ev.date || "") && !draft && !ev.cancelled, invite: state === "going" && !past && !ev.cancelled, chat: inn && !ev.cancelled ? `/chats/${encodeURIComponent(id)}` : "" },
      manage: isHost ? { href: `/?app=1&open=${encodeURIComponent(id)}#studio`, going, asking, waiting, draft, share: !draft && !ev.cancelled, approve: asking ? "/inbox" : "" } : null,
    };
  }
  /** The timeline rows for this viewer's reply to one event, after it changed (none once it's Can't go). */
  function itemsOf(id, o = {}) { const V = viewerOf(id, o); if (!V?.r || ["no", ""].includes(replyState(V.r))) return [];
    return replyItems(V.ws, id, V.ev, V.rid, V.r, todayIn(tzOk(o.tz) ? o.tz : eventTz(V.ev))); }
  return { timeline, planOf, replyItems, hostItems, viewerOf, peekOf, itemsOf };
}
const byTime = (a, b) => a.date.localeCompare(b.date) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.startMs || 0) - (b.startMs || 0) || (a.ord || 0) - (b.ord || 0) || a.title.localeCompare(b.title);

// ---------- calendar files ----------
/** A VEVENT with a reminder (VALARM) `min` minutes before it starts. Pure. */
export function withAlarm(lines, min = 120) { if (!lines.length || !(min > 0)) return lines; const i = lines.lastIndexOf("END:VEVENT");
  return [...lines.slice(0, i), "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", `TRIGGER:-PT${Math.round(min)}M`, "END:VALARM", ...lines.slice(i)]; }
/** The itinerary as its own events (one per item with a time; 1 hour each, or the whole day with no time). Pure apart from the time zone maths. */
export function itineraryEvents(id, ev, items, { url = "", location = "" } = {}) {
  return items.map((x, i) => vevent({ id: `${id}-it${i}`, ev: { ...ev, date: x.day, endDate: "", startTime: x.time || "", endTime: x.time ? endHour(x.time) : "", copy: "", pubDesc: x.sub || "" }, title: `${x.title} · ${titleOf(ev)}`, url, location }));
}
const endHour = (t) => { const [h, m] = t.split(":").map(Number); return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(h >= 23 ? 59 : m).padStart(2, "0")}`; };

// ---------- routes ----------
export function mountPlans(app, { store, small, currentUser, C, X, sendStatic, publicOrigin }) {
  const P = makePlans({ store, C, X });
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req) => { try { return currentUser(req); } catch { return null; } };
  app.locals.plans = P;

  // the timeline: your account's replies and events, plus the replies this browser holds
  app.post("/api/plans/timeline", small, (req, res) => { const u = me(req), b = req.body || {};
    const T = P.timeline({ email: u?.email || "", ws: u?.ws || "", proofs: b.proofs, saved: b.saved, tz: String(b.tz || "").slice(0, 60), past: !!b.past });
    res.set("Cache-Control", "private, no-store").json({ ...T, signedIn: !!u }); });

  // the peek: one event as this viewer may see it, kept for a few seconds (the page asks on touchstart or hover, then on the tap)
  const peeks = new Map(), PEEK_MS = 10e3;
  const peekKey = (id, o) => [id, o.rid, o.code, lc(o.email), o.ws].join("|");
  const bustPeek = (id) => { for (const k of peeks.keys()) if (k.startsWith(id + "|")) peeks.delete(k); };
  app.get("/api/plans/peek/:id", (req, res) => { const id = String(req.params.id || ""); if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found"); const u = me(req);
    const o = { rid: String(req.query.rid || "").slice(0, 80), code: String(req.query.code || "").slice(0, 40), email: u?.email || "", ws: u?.ws || "" }, k = peekKey(id, o), hit = peeks.get(k);
    let p = hit && Date.now() - hit.at < PEEK_MS ? hit.p : undefined;
    if (p === undefined) { p = P.peekOf(id, o); if (peeks.size > 2000) peeks.clear(); peeks.set(k, { at: Date.now(), p }); }
    if (!p) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, max-age=5").json({ peek: p }); });
  // change your reply from the peek: your own reply only (a proof that matches, or your account's), through the invite's
  // own write (POST /api/public/reply/:id: seats, the waitlist, asks to join, the host's bell), then the fresh peek and rows
  app.post("/api/plans/peek/:id/reply", small, (req, res, next) => { const id = String(req.params.id || ""), u = me(req), b = req.body || {};
    if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found");
    const want = { in: "going", going: "going", yes: "going", maybe: "maybe", no: "no", cant: "no", out: "no" }[lc(b.response)], rid = String(b.rid || "").slice(0, 80);
    const V = P.viewerOf(id, { rid, code: String(b.code || "").slice(0, 40), email: rid ? "" : u?.email || "", ws: u?.ws || "" });
    if (!V) return bad(res, "No such event.", 404, "not_found");
    if (rid && !V.r) return bad(res, "No such reply.", 404, "not_found"); // someone else's reply id, or the wrong code: nothing to change
    if (!V.r) return V.isHost ? bad(res, "You're hosting this one.", 409, "host") : u ? bad(res, "Reply on the event page first.", 409, "needs_page") : bad(res, "Sign in, or open the invite on the phone you replied from.", 401, "unauthenticated");
    if (!want) return bad(res, "Pick I'm in, Maybe or Can't go.");
    const R = replyRule(V.ev, V.r, want, { host: first(V.ev.hostName) || first(C.profileOf?.(V.ws)?.name) || "the host" });
    if (R.error) return bad(res, R.error); if (R.closed) return bad(res, R.closed, 409, "closed");
    if (R.page) return res.status(409).json({ code: "needs_page", message: R.page, href: `/e/${encodeURIComponent(id)}`, ...(R.pay ? { pay: true } : {}), ...(R.ask ? { ask: true } : {}) });
    const o = { rid: V.rid, code: String(V.r.code || ""), ws: u?.ws || "", tz: String(b.tz || "").slice(0, 60) }, fresh = () => { bustPeek(id); return { peek: P.peekOf(id, o), items: P.itemsOf(id, o) }; };
    if (R.same) return res.set("Cache-Control", "private, no-store").json({ ok: true, response: want, ...fresh() });
    const send = res.json.bind(res); res.set("Cache-Control", "private, no-store"); res.json = (x) => send(res.statusCode >= 400 ? x : { ...x, ...fresh() });
    req.body = { rid: V.rid, code: o.code, response: want }; req.url = `/api/public/reply/${encodeURIComponent(id)}`; return next(); });

  // one plan: the cover and the itinerary (guests who are in, the host, or everyone when the host made it public)
  app.get("/api/public/plan/:id", (req, res) => { const id = String(req.params.id || ""); if (!ID.test(id)) return bad(res, "No such plan.", 404, "not_found"); const u = me(req);
    const p = P.planOf(id, { rid: String(req.query.rid || "").slice(0, 80), code: String(req.query.code || "").slice(0, 40), email: u?.email || "", ws: u?.ws || "" });
    if (!p) return bad(res, "No such plan.", 404, "not_found"); res.set("Cache-Control", "private, no-store").json({ plan: p }); });

  // the host lays out the plan: [{ day, time, kind, title, sub }], and whether everyone with the link sees it
  app.post("/api/host/events/:id/itinerary", small, (req, res) => { const u = me(req); if (!u?.ws || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated");
    const id = String(req.params.id || ""), S = scopeStore(store, u.ws), ev = ID.test(id) ? S.get("events/" + id)?.data : null; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const r = cleanItinerary(req.body?.itinerary, ev); if (r.error) return bad(res, r.error);
    S.update("events/" + id, { itinerary: r.items, ...(req.body?.public != null ? { itineraryPublic: !!req.body.public } : {}), updatedAt: Date.now() });
    res.json({ ok: true, itinerary: r.items, public: !!S.get("events/" + id).data.itineraryPublic }); });

  // your plans as a calendar you subscribe to: a private link, made the first time you ask, that you can reset
  const feedKey = (email) => "system/plansfeed-of-" + hash(email);
  const feedOf = (req, u, reset = false) => { let tok = store.get(feedKey(u.email))?.data?.token;
    if (!tok || reset) { if (tok) store.delete("system/plansfeed-" + tok); tok = crypto.randomBytes(18).toString("base64url"); store.set(feedKey(u.email), { token: tok, at: Date.now() }); store.set("system/plansfeed-" + tok, { email: lc(u.email), ws: u.ws, at: Date.now() }); }
    const base = publicOrigin(req), host = new URL(base).host; return { webcal: `webcal://${host}/plans/feed/${tok}.ics`, https: `${base}/plans/feed/${tok}.ics` }; };
  app.get("/api/me/plans/feed", (req, res) => { const u = me(req); if (!u?.email) return bad(res, "Sign in first.", 401, "unauthenticated"); res.set("Cache-Control", "private, no-store").json(feedOf(req, u)); });
  // Settings: "Reset link" makes a new one; calendars on the old link stop getting updates
  app.post("/api/me/plans/feed/reset", small, (req, res) => { const u = me(req); if (!u?.email) return bad(res, "Sign in first.", 401, "unauthenticated"); res.set("Cache-Control", "private, no-store").json({ ok: true, ...feedOf(req, u, true) }); });
  app.get(/^\/plans\/feed\/([A-Za-z0-9_-]{20,40})\.ics$/, (req, res) => { const rec = store.get("system/plansfeed-" + req.params[0])?.data; if (!rec?.email) return res.status(404).type("text").send("No such calendar.");
    const T = P.timeline({ email: rec.email, ws: rec.ws || "", now: Date.now() }), base = publicOrigin(req), seen = new Set(), L = [];
    for (const i of T.items) { if (!(i.kind === "hosting" || (i.in && ["going", "pickup", "class"].includes(i.kind))) || seen.has(i.eventId)) continue; seen.add(i.eventId); const w = workspaceOfEvent(i.eventId), ev = w && scopeStore(store, w).get("events/" + i.eventId)?.data; if (!ev) continue;
      const exact = i.kind === "hosting" ? [ev.venueName || ev.meetPoint, ev.venueAddr].filter(Boolean).join(", ") : [guestPlace(w)(ev.meetPoint || ev.venueName), guestPlace(w)(ev.venueAddr)].filter(Boolean).join(", ");
      L.push(withAlarm(vevent({ id: i.eventId, ev: i.kind === "pickup" && i.time && !ev.startTime ? { ...ev, date: i.date, startTime: i.time } : ev, title: i.title, url: `${base}/e/${encodeURIComponent(i.eventId)}`, location: clean(exact, 200) || areaOf(ev) }))); }
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="plans.ics"` }).send(calendar("Your plans on Pottery Lab", L)); });

  // one plan as a calendar file: Apple and iPhone open it in Calendar. The place is what this viewer may see; a reminder
  // two hours before; a multi-day plan is one all-day span, plus each part of the itinerary with ?itinerary=1
  app.get(/^\/plans\/ics\/([A-Za-z0-9_-]{2,80})\.ics$/, (req, res) => { const id = req.params[0], u = me(req), ws = workspaceOfEvent(id), S = ws && scopeStore(store, ws), ev = S?.get("events/" + id)?.data;
    if (!ev || ev.example || ev.cancelled || !ISO.test(ev.date || "")) return res.status(404).type("text").send("No such plan.");
    const isHost = !!u?.ws && u.ws === ws, proof = req.query.rid ? X.rsvpProof?.(id, String(req.query.rid).slice(0, 80), String(req.query.code || "").slice(0, 40))?.r : null;
    const mine = proof || (u?.email ? S.list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id && lc(r.email) === lc(u.email)).sort((a, b) => (b.changedAt || b.at || 0) - (a.changedAt || a.at || 0))[0] : null);
    if (!isHost && !mine && !(ev.discoverable && ev.published !== false)) return res.status(404).type("text").send("No such plan.");
    const inn = isHost || mine?.response === "going", say = guestPlace(ws), url = `${publicOrigin(req)}/e/${encodeURIComponent(id)}`;
    const location = inn ? clean([isHost ? ev.venueName || ev.meetPoint : say(ev.meetPoint || ev.venueName), isHost ? ev.venueAddr : say(ev.venueAddr)].filter(Boolean).join(", "), 200) || areaOf(ev) : areaOf(ev);
    const host = clean(C.profileOf?.(ws)?.name, 80), span = multiDay(ev) ? { ...ev, startTime: "", endTime: "" } : ev;
    const L = [withAlarm(vevent({ id, ev: span, title: titleOf(ev), url, location, host }), multiDay(ev) ? 0 : 120)];
    if (req.query.itinerary === "1" && (inn || ev.itineraryPublic)) L.push(...itineraryEvents(id, ev, itineraryFor(ev, { exact: inn }), { url, location }).map((x) => withAlarm(x, 120)));
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${titleOf(ev).replace(/[^a-z0-9-]+/gi, "-").slice(0, 40) || "plan"}.ics"` }).send(calendar(titleOf(ev), L)); });
  app.get(/^\/plans\/([A-Za-z0-9_-]{2,80})$/, (req, res) => sendStatic(res, "plan.html", "<p>Plan page missing.</p>"));
  return P;
}
