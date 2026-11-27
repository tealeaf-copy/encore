// During and after the event: the small moments that make a night feel looked after (public/delightafter.js draws them).
//
// 5. The morning-of card (guests who are in): on the day, the event page and Plans show one card with the address (only
//    when the guest may see it: plans.peekOf's rule), the start time, who's coming (first names, the same privacy as
//    Who's coming: showMe and hideGuests), the weather for the area at the start time (only when ENCORE_WEATHER is set;
//    otherwise the line is left out), what to bring, and the host's note for the day. One bell note at 9am where the
//    event is (2 hours before an early start, never before 7am), which pushes (server/push.js), and one text through
//    Potto by text for people who turned texting on (server/pottotext.js enqueue: opt-in, quiet hours, daily cap).
// 6. Live photos: from 30 minutes before the start to 2 hours after the end, guests who are in and the host get
//    "Add a photo" on the event page. It uploads through POST /api/moments (server/social.js: who may add, sniffed
//    types, sizes, the host's No photos switch, moderation by hiding), so the photo lands in the event's recap, the
//    scrapbook and the places story with no album to find.
// 7. The host's hour before: the manage view shows a quiet checklist (chairs and spots for who's in, dietary notes
//    from people actually coming, the playlist link, the address, pay links when there's a price) with tick-offs, and
//    one bell note an hour before. Nothing repeats; no nagging.
// 8. The morning after: guests get "How was it?" on the event page and Plans with one-tap kudos (POST
//    /api/public/kudos, the existing write) and an optional private note to the host (only the host reads it). The
//    host wakes on day two to one note: "6 people loved it, 2 want to come back", with the notes in the manage view.
// 9. The polaroid recap: the night's photos (guests' and host's, never hidden ones) as polaroids with the date stamped
//    on the frame. A draft until the host posts it; posted, it leads the event's recap card in the feed
//    (server/feedblend.js recapItem reads polaroidOf). The share image (sharecards, frame "polaroid") carries the
//    stamp, counts and the event's drawing, never photos, like every share card (no faces on a PNG).
// 10. "When's the next one?": after the summary, Potto suggests a date at the event's own rhythm (the gap since the
//    last date of the same night, else four weeks on the same weekday) with the people who came pre-filled, ticked
//    when they said they'd go again. One tap makes the next date (a draft) or a series (repeats weekly, every two
//    weeks or monthly, server/repeats.js carries it on).
// 11. Scrapbook and places: places are counted from replies and hosted events by themselves (server/places.js). The
//    morning after, each person who was there (and the host) gets "Added to your scrapbook" once, with the night's
//    number this year and a link to the year in nights, only when the night is really in their places.
// 12. Keep in touch: from a month after someone's last night out, at most one note a week, off with one switch:
//    a host they loved (kudos with Would go again or a few words) posted a new public event, or a friend (on their
//    friends list) is going to a public event and shows themselves on it, and they haven't been out together for
//    60 days. Never a private event, never a hidden guest, never a blocked person or a muted host.
//
// Every note: Potto's voice, honest counts, one tap, quiet hours (9pm to 8am where the event or person is; the
// hour-before note still lands in the bell then, without a push), each person's switches (GET/PUT
// /api/delight/prefs, and the bell's own kind switches), and one PostHog event per moment (delight_sent,
// delight_shown, delight_tapped) with only a moment name and counts.
//
// Storage: system/dlsent-<hash> (each note once, ever), system/dlprefs-<hash of email>, system/dlhost-<event id>
// (ticks and the host's day-of note), system/dlpol-<event id> (the polaroid), system/dlnext-<event id> (the next date
// made from it), system/dlkeep-<hash of email> (keep-in-touch history). Private notes live on the kudos doc
// (privateNote), which only the host's own routes return.
import crypto from "node:crypto";
import { scopeStore, allWorkspaceIds, workspaceOfEvent, getWorkspace, getDbUser, claimEvent, DEFAULT_WS } from "./workspaces.js";
import { randomId } from "./db.js";
import { spanOf, addDays } from "./plans.js";
import { eventTz, tzOk, tzOfCity } from "./tz.js";
import { localParts } from "./reminders.js";
import { kudosTagsFor, seatsTaken } from "./social.js";
import { artOf, privateLabel, isPublicEvent } from "./places.js";
import { nextCopy, titleKey, REPEATS } from "./repeats.js";
import { hoodCentre, cityCentre } from "./geo.js";
import { capture } from "./posthog.js";
import { renderCardAsync, cardText } from "./sharecards.js";
import { complete } from "./ai.js";
import { POTTO_VOICE } from "./pottovoice.js";
import { payOfWs, hasPay } from "./paymethods.js";

const DAY = 864e5, MIN = 60e3, HOUR = 3600e3, ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const scrub = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "(email hidden)").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "(number hidden)");
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const titleOf = (ev) => clean(ev?.pubTitle || ev?.name, 120) || "your event";
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const dayNo = (d) => Math.round(Date.parse(d + "T12:00:00Z") / DAY);
const clock = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] !== "00" ? ":" + m[2] : ""}${ap}`; };
const niceDay = (d) => (ISO.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const listWords = (L) => (L.length <= 1 ? L[0] || "" : L.length === 2 ? `${L[0]} and ${L[1]}` : `${L.slice(0, -1).join(", ")} and ${L[L.length - 1]}`);
const PHOTO_URL = /^\/_blob\/[A-Za-z0-9_-]{6,80}$/;

/** The timing, in one place (test/delight-after.test.js holds each window). */
export const DELIGHT = { morningHour: 9, earliestHour: 7, earlyStartLead: 2, liveBefore: 30 * MIN, liveAfter: 2 * HOUR, hostLead: 60 * MIN, hostSlack: 15 * MIN,
  afterFrom: 8, afterDays: 3, scrapbookHour: 10, summaryDay: 2, summaryHour: 9, summaryLastDay: 4, quiet: [21, 8],
  keepAfterDays: 28, keepGapDays: 7, keepApartDays: 60, keepLovedDays: 14, keepWindow: [10, 20], polaroidMax: 8, noteMax: 500, hostNoteMax: 280 };
/** Each person's switches, all on until turned off. */
export const PREF_KEYS = ["dayof", "after", "scrapbook", "keep", "hostcheck"];
export const PREF_LABELS = { dayof: "The morning-of card for events I'm going to", after: "\"How was it?\" the morning after", scrapbook: "\"Added to your scrapbook\" after a night out", keep: "Keep in touch: at most one note a week", hostcheck: "The hour-before checklist and the summary after I host" };

// ---------------------------------------------------------------- time
/** Where and when an event is: { tz, startMs, endMs, date, hasTime }. Pure. */
export function timesOf(ev) { const sp = spanOf(ev), tz = eventTz(ev); return { tz, startMs: sp.startMs, endMs: sp.endMs, date: ev?.date || "", hasTime: !sp.allDay }; }
const localOf = (now, tz) => localParts(now, tz);
/** Quiet hours where `tz` is (9pm to 8am). Pure. */
export const quietAt = (now, tz) => { const h = localOf(now, tz).hour; return h >= DELIGHT.quiet[0] || h < DELIGHT.quiet[1]; };
const daysAfter = (ev, now) => { const t = timesOf(ev); return t.date ? dayNo(localOf(now, t.tz).day) - dayNo(t.date) : NaN; };
const ok = (ev) => !!ev && !ev.example && !ev.sample && !ev.cancelled && ev.stage !== "interest" && !ev.drop && !ev.preorder && ISO.test(ev.date || "");

/** The phase of an event for a card: "dayof" (its day, before the live window), "live", "after" (the morning after,
 *  for 3 days) or "" (anything else). Pure. */
export function phaseOf(ev, now = Date.now()) {
  if (!ok(ev)) return ""; const t = timesOf(ev), L = localOf(now, t.tz), dd = dayNo(L.day) - dayNo(t.date);
  if (t.hasTime && now >= t.startMs - DELIGHT.liveBefore && now <= t.endMs + DELIGHT.liveAfter) return "live";
  if (dd === 0 && (!t.hasTime || now < t.startMs)) return "dayof";
  if ((dd === 1 && L.hour >= DELIGHT.afterFrom) || (dd >= 2 && dd <= DELIGHT.afterDays)) return "after";
  return "";
}
/** When the morning-of note goes: 9am on the day, or 2 hours before a start earlier than 11am, never before 7am. Pure. */
export function morningSendMs(ev) { const t = timesOf(ev); if (!t.date) return NaN;
  let h = DELIGHT.morningHour; if (t.hasTime) { const sh = +String(ev.startTime).slice(0, 2); if (sh < 11) h = Math.max(DELIGHT.earliestHour, sh - DELIGHT.earlyStartLead); }
  return zoned(t.date, String(h).padStart(2, "0") + ":00", t.tz); }
const zoned = (date, time, tz) => spanOf({ date, startTime: time, tz }).startMs;
/** The morning-of note is due: on the day, from its send time until the start. Pure. */
export function morningDue(ev, now = Date.now()) { if (!ok(ev)) return false; const t = timesOf(ev), s = morningSendMs(ev); return localOf(now, t.tz).day === t.date && now >= s && (!t.hasTime || now < t.startMs) && !quietAt(now, t.tz); }
/** The host's hour-before note is due: 75 to 15 minutes before the start (the job runs every 15 minutes). Pure. */
export function hostHourDue(ev, now = Date.now()) { if (!ok(ev)) return false; const t = timesOf(ev); if (!t.hasTime) return false; const lead = t.startMs - now; return lead <= DELIGHT.hostLead + DELIGHT.hostSlack && lead > DELIGHT.hostSlack; }
/** The host's checklist shows in the manage view: from 3 hours before the start until it starts. Pure. */
export function checklistOn(ev, now = Date.now()) { if (!ok(ev)) return false; const t = timesOf(ev); return t.hasTime ? now >= t.startMs - 3 * HOUR && now < t.startMs + 30 * MIN : localOf(now, t.tz).day === t.date; }
/** "Added to your scrapbook": the morning after, from 10am, for 3 days. Pure. */
export function scrapbookDue(ev, now = Date.now()) { if (!ok(ev)) return false; const t = timesOf(ev), L = localOf(now, t.tz), dd = dayNo(L.day) - dayNo(t.date); return ((dd === 1 && L.hour >= DELIGHT.scrapbookHour) || (dd > 1 && dd <= 3)) && !quietAt(now, t.tz); }
/** The host's summary: the second morning after, from 9am (guests have had a day to send kudos), until day 4. Pure. */
export function summaryDue(ev, now = Date.now()) { if (!ok(ev)) return false; const t = timesOf(ev), L = localOf(now, t.tz), dd = dayNo(L.day) - dayNo(t.date); return ((dd === DELIGHT.summaryDay && L.hour >= DELIGHT.summaryHour) || (dd > DELIGHT.summaryDay && dd <= DELIGHT.summaryLastDay)) && !quietAt(now, t.tz); }

/** Who's coming in one line: first names people allowed, the rest as a count. Pure. */
export function whoLine({ count = 0, names = [], guest = false }) { const N = names.slice(0, 4), others = Math.max(0, count - (guest ? 1 : 0)), rest = others - N.length;
  if (!others) return guest ? "Just you so far. The host will be glad you're in." : "Nobody is in yet.";
  if (!N.length) return guest ? `You and ${plural(others, "other person", "other people")}.` : `${plural(others, "person", "people")} in.`;
  return `${listWords(rest > 0 ? [...N, plural(rest, "more", "more")] : N)}${guest ? ", and you" : ""}.`; }

// ---------------------------------------------------------------- the next one
const GAPS = [["weekly", 7], ["biweekly", 14], ["monthly", 28]];
/** The rhythm and date for the next one. prev: the date before this one in the same night (or ""). Pure. */
export function suggestNext(ev, { prev = "", today = "" } = {}) {
  if (!ISO.test(ev?.date || "")) return null; let repeat = REPEATS.includes(ev.repeat) ? ev.repeat : "";
  if (!repeat && ISO.test(prev || "")) { const gap = dayNo(ev.date) - dayNo(prev); repeat = gap <= 10 ? "weekly" : gap <= 21 ? "biweekly" : "monthly"; }
  const step = repeat ? GAPS.find(([k]) => k === repeat)[1] : 28; let date = addDays(ev.date, step); const t = today || ev.date;
  while (date <= t) date = addDays(date, 7);
  const why = ev.repeat ? "It's a series, so the next one is on the same rhythm." : prev ? `Your last two were ${plural(dayNo(ev.date) - dayNo(prev), "day")} apart, so the same gap again.` : "Four weeks on, the same weekday. Enough time to miss it, not enough to forget.";
  return { date, repeat: repeat || "monthly", step, why };
}
/** Potto's line for the suggestion: honest about who wants to come back. Pure. */
export function nextLine({ date, back = 0, came = 0, title = "" }) {
  const d = niceDay(date); if (!came) return `How about ${d} for the next ${title}? Same night, same feel.`;
  return back ? `${back === came ? "Everyone" : plural(back, "person", "people")} said they'd come back. ${d} could be the next ${title}, with them already on the list.` : `${d} could be the next ${title}. The people who came are on the list, ready to invite.`;
}

// ---------------------------------------------------------------- the polaroid
/** The stamp on the frame: "NOV 26 2026". Pure. */
export const stampOf = (date) => (ISO.test(date || "") ? new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).replace(",", "").toUpperCase() : "");
/** A posted polaroid for one event, or null (server/feedblend.js reads this). */
export function polaroidOf(store, eventId) { try { const d = store.get("system/dlpol-" + String(eventId || "").replace(/[^A-Za-z0-9_-]/g, ""))?.data; return d && d.status === "posted" && Array.isArray(d.photos) ? d : null; } catch { return null; } }
/** The photos a polaroid may use, best first: images only, never hidden, the host's and every guest's, a few each. Pure. */
export function polaroidPick(moments, { max = DELIGHT.polaroidMax } = {}) {
  const L = moments.filter((m) => m && !m.hidden && m.type !== "video" && PHOTO_URL.test(m.url || "")).sort((a, b) => (a.at || 0) - (b.at || 0)), by = new Map();
  for (const m of L) { const k = lc(m.authorEmail) || m.authorKey || "?"; if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
  const out = []; for (let i = 0; out.length < max && i < 30; i++) for (const ms of by.values()) if (ms[i] && out.length < max) out.push(ms[i]);
  return out.sort((a, b) => (a.at || 0) - (b.at || 0));
}

// ---------------------------------------------------------------- weather (optional)
/** The weather source from env: ENCORE_WEATHER=open-meteo (no key) or fake (tests and demos). Off when unset. */
export const weatherConfig = (env = process.env) => { const w = lc(env.ENCORE_WEATHER); return ["open-meteo", "fake"].includes(w) ? { source: w } : null; };
const WMO = [[0, "clear"], [1, "mostly clear"], [3, "cloudy"], [48, "foggy"], [57, "drizzle"], [67, "rain"], [77, "snow"], [82, "showers"], [86, "snow showers"], [99, "thunderstorms"]];
const sky = (code) => (WMO.find(([n]) => +code <= n) || WMO[WMO.length - 1])[1];
/** One plain line: "Around 7pm: 64°F and clear. A 10% chance of rain." Pure. */
export function weatherLine({ temp, code, rain }, { time = "", fahrenheit = true } = {}) { if (!Number.isFinite(+temp)) return "";
  const T = Math.round(fahrenheit ? +temp * 9 / 5 + 32 : +temp), r = Number.isFinite(+rain) ? Math.round(+rain / 10) * 10 : null;
  return `${time ? `Around ${time}: ` : ""}${T}°${fahrenheit ? "F" : "C"} and ${sky(code)}.${r != null && r >= 30 ? ` A ${r}% chance of rain, so maybe a jacket.` : ""}`; }
const wcache = new Map();
async function weatherFor(ev, { fetchFn = (...a) => globalThis.fetch(...a), env = process.env } = {}) {
  const cfg = weatherConfig(env); if (!cfg || !ok(ev)) return null; const t = timesOf(ev);
  const at = hoodCentre(ev.hood, ev.city) || cityCentre(ev.city); if (!at) return null; // the area's centre, never the address
  const fahrenheit = /^America\//.test(t.tz || "") || !t.tz, time = t.hasTime ? clock(ev.startTime) : "";
  const hr = t.hasTime ? String(ev.startTime).slice(0, 2) : "18";
  if (cfg.source === "fake") return { line: weatherLine({ temp: 18, code: 1, rain: 10 }, { time, fahrenheit }), source: "fake" };
  const key = `${at.lat.toFixed(2)},${at.lng.toFixed(2)},${t.date},${hr}`, hit = wcache.get(key); if (hit && Date.now() - hit.at < HOUR) return hit.v;
  let v = null;
  try { const u = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat.toFixed(3)}&longitude=${at.lng.toFixed(3)}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=${encodeURIComponent(t.tz || "auto")}&start_date=${t.date}&end_date=${t.date}`;
    const r = await fetchFn(u, { signal: AbortSignal.timeout(3000) }); if (r.ok) { const j = await r.json(), H = j?.hourly || {}, i = (H.time || []).findIndex((x) => String(x).endsWith(`T${hr}:00`));
      if (i >= 0) v = { line: weatherLine({ temp: H.temperature_2m?.[i], code: H.weather_code?.[i], rain: H.precipitation_probability?.[i] }, { time, fahrenheit }), source: "open-meteo" }; } } catch {}
  wcache.set(key, { at: Date.now(), v }); if (wcache.size > 500) wcache.delete(wcache.keys().next().value); return v;
}

// ---------------------------------------------------------------- the engine
export function makeDelight({ store, C, X, app = null, now = () => Date.now() }) {
  let clockFn = now; const clock0 = () => clockFn(); // tests move the clock with setNow
  const L = () => app?.locals || {};
  const sys = (k) => store.get("system/" + k)?.data || null, put = (k, v) => store.set("system/" + k, v);
  const once = (key) => { const p = "dlsent-" + hash(key); if (sys(p)) return false; put(p, { kind: "dlsent", at: clock0() }); return true; };
  const sent = (key) => !!sys("dlsent-" + hash(key));
  const prefsOf = (email) => { const d = sys("dlprefs-" + hash(email)) || {}; return Object.fromEntries(PREF_KEYS.map((k) => [k, d[k] !== false])); };
  const setPrefs = (email, b = {}) => { const cur = prefsOf(email), next = { ...cur }; for (const k of PREF_KEYS) if (typeof b[k] === "boolean") next[k] = b[k]; put("dlprefs-" + hash(email), { kind: "dlprefs", email: lc(email), ...next, at: clock0() }); return next; };
  const measure = (event, ws, kind, extra = {}) => { try { capture(event, { ws, kind, ...extra }); } catch {} };
  const bell = (email, n, { quiet = false } = {}) => { if (!email || !X?.notify) return false; return X.notify(lc(email), { ...n, ...(quiet ? { nopush: true } : {}) }) !== false; };
  const hostOf = (ws) => { try { return C.profileOf(ws) || {}; } catch { return {}; } };
  const hostFirst = (ws, ev) => first(hostOf(ws).name || ev?.hostName || getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || "").replace(/['’]s$/i, "");
  const ownerOf = (ws) => lc(getWorkspace(ws)?.ownerEmail || "");
  const evOf = (id) => { if (!ID.test(id || "")) return null; const ws = workspaceOfEvent(id); if (!ws || ws === DEFAULT_WS) return null; const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; return ev ? { id, ws, S, ev } : null; };
  const goingOf = (S, id) => S.list("rsvps").map((d) => ({ rid: d.id, ...d.data })).filter((r) => r.eventId === id && r.response === "going" && r.noShow !== true && !r.pairOf);
  const hostData = (id) => sys("dlhost-" + id) || { ticks: {}, note: "" };
  const plans = () => L().plans || null, places = () => L().places || null;

  // ---------- 5. the morning-of card ----------
  async function dayOfCard(E, { rid = "", code = "", email = "", ws = "" } = {}, { weather = true } = {}) {
    const P = plans()?.peekOf?.(E.id, { rid, code, email, ws }); if (!P) return null;
    const plan = plans()?.planOf?.(E.id, { rid, code, email, ws }) || {}, H = hostData(E.id), w = weather ? await weatherFor(E.ev) : null;
    const names = (P.who?.names || []).filter((x) => !x.you).map((x) => x.name), count = P.who?.count || 0;
    return { title: P.title, when: [niceDay(E.ev.date), clock(E.ev.startTime)].filter(Boolean).join(" · "), time: clock(E.ev.startTime),
      where: P.address || P.place || "", exact: !!P.address, locked: !!P.locked, online: !!P.online,
      who: P.who ? { count, names: names.slice(0, 6), line: whoLine({ count, names, guest: P.role === "guest" }) } : null,
      weather: w?.line || "", bring: (plan.bring || []).slice(0, 6), note: clean(H.note, DELIGHT.hostNoteMax), host: P.host?.first || hostFirst(E.ws, E.ev), chat: P.actions?.chat || "", href: `/e/${encodeURIComponent(E.id)}` };
  }

  // ---------- 7. the host's checklist ----------
  function checklist(E) {
    const { S, ev, id } = E, G = goingOf(S, id), seats = Math.round(seatsTaken(ev, S.list("rsvps").filter((d) => d.data?.eventId === id))) || 0, H = hostData(id), items = [];
    const diet = G.filter((r) => clean(r.dietary, 120)).map((r) => ({ name: first(r.name) || "A guest", note: scrub(clean(r.dietary, 120)) }));
    items.push({ id: "chairs", label: `Chairs and spots for ${seats + 1}`, sub: seats ? `${plural(seats, "person", "people")} in, plus you.` : "Nobody is in yet, so just you for now.", auto: false });
    items.push({ id: "diet", label: diet.length ? `Food notes from ${plural(diet.length, "guest")}` : "No food notes", sub: diet.length ? diet.map((d) => `${d.name}: ${d.note}`).join(" · ") : "Nobody who's coming mentioned anything.", auto: !diet.length, notes: diet });
    items.push({ id: "playlist", label: ev.playlistUrl ? "Playlist ready" : "A playlist link", sub: ev.playlistUrl ? "It's on the invite." : "Optional. Add one in Edit if you like.", auto: !!/^https:\/\//.test(ev.playlistUrl || ""), link: /^https:\/\//.test(ev.playlistUrl || "") ? ev.playlistUrl : "" });
    const addr = !!(ev.venueAddr || ev.meetPoint || ev.online);
    items.push({ id: "address", label: addr ? "Address sent" : "Add the address", sub: addr ? "Everyone who's in sees it on their invite and their morning-of card." : "People who are in see it once you add it.", auto: addr });
    if (ev.price && !ev.free && ev.price !== "chip") { let pay = !!ev.payLink; try { pay = pay || hasPay(payOfWs(E.ws)); } catch {} items.push({ id: "pay", label: pay ? "Pay links ready" : "Pay links", sub: pay ? "Guests who are in see how to pay." : "Add Venmo, PayPal or Cash App under Get paid.", auto: pay }); }
    return { items: items.map((x) => ({ ...x, done: !!x.auto || !!H.ticks?.[x.id] })), note: clean(H.note, DELIGHT.hostNoteMax), seats, start: clock(ev.startTime) };
  }

  // ---------- 8. the morning after ----------
  function kudosOf(S, id) { return S.list("kudos").map((d) => ({ rid: d.id, ...d.data })).filter((k) => k.eventId === id); }
  function summary(E) {
    const K = kudosOf(E.S, E.id), loved = K.filter((k) => (k.tags || []).length || k.love).length, back = K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length;
    const came = goingOf(E.S, E.id).length, notes = K.filter((k) => clean(k.privateNote) || clean(k.improve)).map((k) => ({ name: first(k.name) || "A guest", note: clean(k.privateNote, DELIGHT.noteMax), next: clean(k.improve, DELIGHT.noteMax) }));
    const line = loved ? `${loved === came && came > 1 ? "Everyone" : plural(loved, "person", "people")} loved it${back ? `, ${back} ${back === 1 ? "wants" : "want"} to come back` : ""}.` : came ? "No kudos yet. They usually come in by tonight." : "Nobody was marked as in, so there's nothing to add up.";
    return { loved, back, came, line, notes, quotes: K.filter((k) => clean(k.love)).slice(0, 3).map((k) => ({ name: first(k.name) || "A guest", text: scrub(clean(k.love, 200)) })) };
  }
  function afterCard(E, R) { const k = R ? E.S.get("kudos/" + R.rid)?.data : null, sentK = !!(k && ((k.tags || []).length || k.love));
    return { host: hostFirst(E.ws, E.ev), title: titleOf(E.ev), chips: kudosTagsFor(E.ev).slice(0, 4).map(([id, , label]) => ({ id, label })), sent: sentK, tags: k?.tags || [], noted: !!clean(k?.privateNote) }; }
  function scrapLine(email, id) { try { const P = places(); if (!P || !email) return null; P.bust?.(); const Y = new Date(clock0()).getUTCFullYear(), rows = P.nightsOf(email, { year: 0, withHidden: false }), r = rows.find((x) => x.id === id); if (!r) return null;
    const yr = +String(r.date).slice(0, 4) || Y, n = rows.filter((x) => +String(x.date).slice(0, 4) === yr && String(x.date) <= String(r.date)).length;
    return { line: `Added to your scrapbook. Your ${ord(n)} night of ${yr}.`, link: `/year/${yr}`, n, year: yr }; } catch { return null; } }

  // ---------- 10. the next one ----------
  function nextOf(E, today) {
    const { S, ev, id } = E, made = sys("dlnext-" + id);
    if (made?.nextId && S.get("events/" + made.nextId)?.data) return { made: { id: made.nextId, date: made.date, repeat: made.repeat || "", href: `/?app=1&open=${encodeURIComponent(made.nextId)}#studio` } };
    const key = titleKey(ev), sib = S.list("events").filter((d) => d.id !== id && d.data && !d.data.cancelled && !d.data.example && ISO.test(d.data.date || "") && ((d.data.seriesId || d.id) === (ev.seriesId || id) || d.id === ev.seriesId || (key && titleKey(d.data) === key)));
    const later = sib.filter((d) => d.data.date > ev.date).sort((a, b) => a.data.date.localeCompare(b.data.date))[0];
    if (later) return { already: { id: later.id, date: later.data.date, title: titleOf(later.data), href: `/?app=1&open=${encodeURIComponent(later.id)}#studio` } };
    const prev = sib.filter((d) => d.data.date < ev.date).sort((a, b) => b.data.date.localeCompare(a.data.date))[0]?.data.date || "", s = suggestNext(ev, { prev, today });
    const K = new Map(kudosOf(S, id).map((k) => [k.rid, k])), seen = new Set(), people = [];
    for (const r of goingOf(S, id)) { const k = lc(r.email) || "rid:" + r.rid; if (seen.has(k)) continue; seen.add(k); const kd = K.get(r.rid); people.push({ key: r.rid, first: first(r.name) || "A guest", back: !!kd && ((kd.tags || []).includes("again") || kd.compare === "better"), kudos: !!kd }); }
    for (const g of ev.guests || []) { if (!/Attended|Going/.test(g?.status || "") || g.noShow) continue; const k = lc(g.email) || "g:" + lc(g.name); if (!g.name || seen.has(k)) continue; seen.add(k); people.push({ key: "g:" + hash(k), first: first(g.name), back: false, kudos: false }); }
    const back = people.filter((p) => p.back).length;
    return { suggestion: { ...s, label: niceDay(s.date), line: nextLine({ date: s.date, back, came: people.length, title: titleOf(ev) }), series: !!ev.repeat, rhythm: { weekly: "Every week", biweekly: "Every two weeks", monthly: "Every month" }[s.repeat] }, people };
  }
  async function pottoNext(E, n) { // Potto's own words when the model is on; the plain line otherwise (and in tests)
    if (!n?.suggestion) return n; try { const r = await complete({ prompt: `${POTTO_VOICE}\nWrite one short line (under 30 words) suggesting the next date of a host's event. Facts: title "${titleOf(E.ev)}", suggested date ${n.suggestion.label}, ${n.people.length} came, ${n.people.filter((p) => p.back).length} said they'd come back. No exclamation marks, no emoji, no em dashes. Answer as JSON: {"line":"..."}`, effort: "low" });
      const j = JSON.parse(String(r.text || "").replace(/^[^{]*/, "").replace(/[^}]*$/, "") || "{}"); const line = clean(j.line, 200).replace(/\u2014/g, ", "); if (line && line.length > 12 && !/[\u{1F000}-\u{1FFFF}]/u.test(line)) n.suggestion.line = line; } catch {}
    return n; }
  function makeNext(E, { date, repeat = "", keys = [] } = {}, now = clock0()) {
    const { S, ev, id, ws } = E, made = sys("dlnext-" + id); if (made?.nextId && S.get("events/" + made.nextId)?.data) return { ok: true, id: made.nextId, date: made.date, existed: true, href: `/?app=1&open=${encodeURIComponent(made.nextId)}#studio` };
    if (!ISO.test(date || "") || date <= localOf(now, eventTz(ev)).day) return { error: "Pick a date after today.", status: 400 };
    const N = nextOf(E, localOf(now, eventTz(ev)).day), pick = new Set((Array.isArray(keys) ? keys : []).map(String)), R = new Map(goingOf(S, id).map((r) => [r.rid, r]));
    let nid = randomId(); for (let i = 0; i < 20 && !claimEvent(nid, ws); i++) nid = randomId();
    put("dlnext-" + id, { kind: "dlnext", eventId: id, nextId: nid, date, repeat: REPEATS.includes(repeat) ? repeat : "", at: now }); // logged first: a double tap never makes two
    const c = nextCopy(id, ev, date, now); delete c.autoMade; delete c.publishedAt; c.published = false; c.discoverable = false; c.madeFrom = "next-one";
    if (REPEATS.includes(repeat)) c.repeat = repeat; else delete c.repeat;
    const guests = []; for (const p of N.people || []) { if (!pick.has(p.key)) continue; const r = R.get(p.key); if (r) guests.push({ name: clean(r.name, 80), ...(r.email ? { email: lc(r.email) } : {}), ...(r.phone ? { phone: clean(r.phone, 30) } : {}), status: "Invited", rsvpAt: null, invitedAt: null, from: "came-last-time" });
      else { const g = (ev.guests || []).find((x) => "g:" + hash(lc(x.email) || "g:" + lc(x.name)) === p.key); if (g) guests.push({ ...g, status: "Invited", rsvpAt: null, invitedAt: null, slot: "", ride: "", from: "came-last-time" }); } }
    c.guests = guests; S.set("events/" + nid, { ...c, id: nid });
    measure("delight_tapped", ws, "next_made", { count: guests.length, via: REPEATS.includes(repeat) ? "series" : "once" });
    return { ok: true, id: nid, date, repeat: c.repeat || "", guests: guests.length, href: `/?app=1&open=${encodeURIComponent(nid)}#studio` };
  }

  // ---------- 9. the polaroid ----------
  function momentsOf(S, id) { return S.list("moments").map((d) => ({ id: d.id, ...d.data })).filter((m) => m.eventId === id); }
  function polaroidView(E, { host = false } = {}) {
    const all = momentsOf(E.S, E.id), D = sys("dlpol-" + E.id), byId = new Map(all.map((m) => [m.id, m])), pick = polaroidPick(all);
    const chosen = (D?.photos || []).map((x) => byId.get(x)).filter((m) => m && !m.hidden && PHOTO_URL.test(m.url || "")), use = D ? chosen : pick;
    const out = (m) => ({ id: m.id, url: m.url, by: first(m.authorName) || "", host: lc(m.authorEmail) === ownerOf(E.ws) });
    return { status: D?.status || "draft", stamp: stampOf(E.ev.date), caption: clean(D?.caption, 140), photos: use.map(out), ...(host ? { pool: all.filter((m) => !m.hidden && m.type !== "video" && PHOTO_URL.test(m.url || "")).map(out) } : {}), postedAt: D?.postedAt || 0, ready: use.length >= 2 };
  }
  function savePolaroid(E, { photos, caption, post = false, unpost = false } = {}) {
    const all = new Map(momentsOf(E.S, E.id).filter((m) => !m.hidden && m.type !== "video" && PHOTO_URL.test(m.url || "")).map((m) => [m.id, m])), cur = sys("dlpol-" + E.id) || {};
    const ids = Array.isArray(photos) ? [...new Set(photos.map(String))].filter((x) => all.has(x)).slice(0, DELIGHT.polaroidMax) : cur.photos || polaroidPick([...all.values()]).map((m) => m.id);
    if (post && ids.length < 1) return { error: "Pick at least one photo first.", status: 400 };
    const status = unpost ? "draft" : post ? "posted" : cur.status || "draft";
    put("dlpol-" + E.id, { kind: "dlpol", eventId: E.id, ws: E.ws, photos: ids, caption: scrub(clean(caption ?? cur.caption, 140)), status, postedAt: post ? clock0() : cur.postedAt || 0, at: clock0() });
    try { X?.bust?.(); } catch {}
    if (post && cur.status !== "posted") measure("delight_tapped", E.ws, "polaroid_posted", { count: ids.length });
    return { ok: true, ...polaroidView(E, { host: true }) };
  }
  function polaroidSpec(E) { const V = polaroidView(E), pub = isPublicEvent(E.ev), h = hostOf(E.ws), S2 = summary(E);
    return { tone: "linen", frame: "polaroid", stamp: V.stamp, kicker: "Recap", title: pub ? titleOf(E.ev) : privateLabel(E.ev, h), sub: [clean(E.ev.hood, 40), clean(String(E.ev.city || "").split(",")[0], 40)].filter(Boolean).join(", "),
      stats: [...(S2.came ? [{ n: String(S2.came), label: S2.came === 1 ? "came" : "came" }] : []), ...(S2.loved ? [{ n: String(S2.loved), label: "loved it" }] : []), ...(S2.back ? [{ n: String(S2.back), label: "want to come back" }] : []), { n: String(V.photos.length), label: V.photos.length === 1 ? "photo" : "photos" }].slice(0, 4),
      art: artOf(E.ev), foot: clean(h.name, 40) || "pottery lab" }; }

  // ---------- 12. keep in touch ----------
  function keepFor(email, now = clock0()) {
    const em = lc(email); if (!em || !prefsOf(em).keep) return null; const K = sys("dlkeep-" + hash(em)) || { sent: [] }; if (now - (K.lastAt || 0) < DELIGHT.keepGapDays * DAY) return null;
    const P = places(); if (!P) return null; const nights = P.nightsOf(em, { year: 0, withHidden: true }), today = new Date(now).toISOString().slice(0, 10), lastNight = nights[0]?.date || "";
    if (!lastNight || dayNo(today) - dayNo(lastNight) < DELIGHT.keepAfterDays) return null; // a month after their last night out, not before
    const muted = new Set((sys("inboxprefs-" + hash(em))?.mutedHosts || []).map(lc)), seen = new Set(K.sent || []);
    const myReplies = new Set(); const evs = new Map();
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws);
      for (const d of S.list("events")) { const e = d.data; if (e && !e.example && !e.cancelled && ISO.test(e.date || "") && e.date >= today) evs.set(d.id, { id: d.id, ws, e, S }); }
      for (const d of S.list("rsvps")) if (lc(d.data?.email) === em) myReplies.add(d.data.eventId); }
    const open = (x) => isPublicEvent(x.e) && !x.e.approvalRequired && !myReplies.has(x.id) && lc(ownerOf(x.ws)) !== em && !muted.has(lc(hostOf(x.ws).handle)) && !P.blocked(em, ownerOf(x.ws));
    // a host they loved posted something new
    const loved = new Map(); for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; for (const d of scopeStore(store, ws).list("kudos")) { const k = d.data; if (lc(k?.email) === em && ((k.tags || []).includes("again") || clean(k.love))) loved.set(ws, Math.max(loved.get(ws) || 0, k.at || 0)); } }
    for (const x of [...evs.values()].sort((a, b) => a.e.date.localeCompare(b.e.date))) { const at = loved.get(x.ws); if (!at || !open(x)) continue; const made = x.e.createdAt || x.e.publishedAt || 0;
      if (made <= at || now - made > DELIGHT.keepLovedDays * DAY || seen.has("e:" + x.id)) continue; const h = hostOf(x.ws);
      return { kind: "host", key: "e:" + x.id, eventId: x.id, ws: x.ws, text: `${clean(h.name, 60) || "A host you loved"} just posted ${titleOf(x.e)}, ${niceDay(x.e.date)}. You loved the last one.`, link: `/e/${encodeURIComponent(x.id)}` }; }
    // a friend going to something public, not seen together in a while
    const friends = (() => { try { return (X?.friendsOf?.(em) || []).map((f) => lc(f.email)); } catch { return []; } })();
    const mine = new Map(nights.map((n) => [n.id, n.date]));
    for (const f of friends) { if (P.blocked(em, f)) continue; const theirs = P.nightsOf(f, { year: 0, withHidden: false }), shared = theirs.filter((n) => mine.has(n.id)).map((n) => n.date).sort().pop() || "";
      if (shared && dayNo(today) - dayNo(shared) < DELIGHT.keepApartDays) continue; const name = first(getDbUser(f)?.name || "");
      for (const x of [...evs.values()].sort((a, b) => a.e.date.localeCompare(b.e.date))) { if (!open(x) || x.e.hideGuests || seen.has(`f:${hash(f)}:${x.id}`)) continue;
        const r = x.S.list("rsvps").map((d) => d.data).find((r2) => r2?.eventId === x.id && lc(r2.email) === f && r2.response === "going" && r2.showMe !== false); if (!r || !name) continue;
        return { kind: "friend", key: `f:${hash(f)}:${x.id}`, eventId: x.id, ws: x.ws, text: `${name} is going to ${titleOf(x.e)} on ${niceDay(x.e.date)}. ${shared ? "It's been a while since you two were out together." : "You haven't been to one together yet."}`, link: `/e/${encodeURIComponent(x.id)}` }; } }
    return null;
  }

  // ---------- the job ----------
  async function run({ now = clock0(), origin = process.env.ENCORE_PUBLIC_URL || "" } = {}) {
    const out = { dayof: 0, texts: 0, hostcheck: 0, summary: 0, scrapbook: 0, keep: 0 }, T = L().pottoText, P = places(); try { P?.bust?.(); } catch {}
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS || /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "")) continue; const S = scopeStore(store, ws), owner = ownerOf(ws);
      for (const d of S.list("events")) { const ev = d.data, id = d.id; if (!ok(ev) || !ID.test(id)) continue; const t = timesOf(ev), dd = dayNo(localOf(now, t.tz).day) - dayNo(t.date); if (dd < -1 || dd > 5) continue;
        const E = { id, ws, S, ev }, title = titleOf(ev), G = goingOf(S, id);
        // 5. the morning of, to guests who are in (the host's guest-messages switch turns it off)
        if (morningDue(ev, now) && ev.autoRemind !== false && (ev.published || ev.discoverable)) for (const r of G) { const em = lc(r.email); if (!em || em === owner || !prefsOf(em).dayof) continue; const key = `dayof|${id}|${ev.date}|${em}`; if (!once(key)) continue;
          const card = await dayOfCard(E, { rid: r.rid, code: r.code }, { weather: true }); if (!card) continue;
          bell(em, { kind: "dayof", type: "reminder", key: "dayof-" + id + "-" + ev.date, text: `Today: ${title}${card.time ? ` at ${card.time}` : ""}. Your card for the day is ready${card.weather ? `, weather and all` : ""}.`, link: `/e/${encodeURIComponent(id)}`, eventId: id }); out.dayof++;
          if (T?.enqueue && T.enqueue(em, { key: `dl-dayof|${em}|${id}|${ev.date}`, kind: "reminder", eventId: id, vars: [first(r.name) || "there", title, card.time || "the time on the invite"], text: [`Today: ${title}${card.time ? ` at ${card.time}` : ""}${card.exact ? `, ${card.where}` : ""}.`, card.weather, card.note ? `From ${card.host || "your host"}: ${card.note}` : "", `${origin}/e/${encodeURIComponent(id)}`].filter(Boolean).join(" ") }, now)) out.texts++;
          measure("delight_sent", ws, "dayof", { via: "bell" }); }
        // 7. an hour before, to the host: one bell note (in quiet hours it stays in the bell, no push)
        if (hostHourDue(ev, now) && owner && prefsOf(owner).hostcheck && once(`hostcheck|${id}|${ev.date}|${ev.startTime}`)) { const CL = checklist(E), open = CL.items.filter((x) => !x.done).length;
          bell(owner, { kind: "hostcheck", type: "reminder", key: "hostcheck-" + id + "-" + ev.date, text: `${title} starts at ${clock(ev.startTime)}. ${plural(CL.seats, "person is", "people are")} in. ${open ? `Your checklist has ${plural(open, "thing")} to glance at.` : "Everything on your checklist is set."}`, link: `/?app=1&open=${encodeURIComponent(id)}#studio`, eventId: id }, { quiet: quietAt(now, t.tz) }); out.hostcheck++; measure("delight_sent", ws, "hostcheck", { count: open }); }
        // 11. added to your scrapbook, for everyone who was there and the host
        if (scrapbookDue(ev, now)) { const who = [...new Set([...G.map((r) => lc(r.email)).filter(Boolean), owner].filter(Boolean))];
          for (const em of who) { if (!prefsOf(em).scrapbook) continue; const key = `scrap|${id}|${em}`; if (sent(key)) continue; const s = scrapLine(em, id); if (!s) continue; once(key);
            bell(em, { kind: "scrapbook", type: "note", key: "scrap-" + id, text: `${title} is in your scrapbook now. Your ${ord(s.n)} night of ${s.year}.`, link: s.link, eventId: id }); out.scrapbook++; measure("delight_sent", ws, "scrapbook", { count: s.n }); } }
        // 8 and 9 and 10. the host's summary, the polaroid and the next one, in one note on the second morning
        if (summaryDue(ev, now) && owner && prefsOf(owner).hostcheck && !sent(`summary|${id}`)) { const SM = summary(E); if (!SM.loved && !polaroidView(E).ready) continue; once(`summary|${id}`);
          const pol = polaroidView(E).ready && polaroidView(E).status !== "posted";
          bell(owner, { kind: "aftersum", type: "kudos", key: "aftersum-" + id, text: `${title}: ${SM.line}${SM.notes.length ? ` ${plural(SM.notes.length, "private note")} for you.` : ""}${pol ? " Your polaroid recap is ready to look at." : ""} Potto has a date in mind for the next one.`, link: `/?app=1&open=${encodeURIComponent(id)}#studio`, eventId: id }); out.summary++; measure("delight_sent", ws, "summary", { count: SM.loved, guests: SM.came }); }
      } }
    // 12. keep in touch: at most one a week each, in the daytime where they are
    const people = new Set(); for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = scopeStore(store, ws); const o = ownerOf(ws); if (o) people.add(o); for (const d of S.list("rsvps")) if (d.data?.email && d.data.response === "going") people.add(lc(d.data.email)); }
    for (const em of people) { const tz = (() => { const u = getDbUser(em), p = u?.ws ? hostOf(u.ws) : {}; return tzOfCity(p.city) || process.env.ENCORE_TZ || ""; })(), h = localOf(now, tz && tzOk(tz) ? tz : "").hour;
      if (h < DELIGHT.keepWindow[0] || h >= DELIGHT.keepWindow[1]) continue; let k = null; try { k = keepFor(em, now); } catch {} if (!k) continue;
      const K = sys("dlkeep-" + hash(em)) || { sent: [] }; put("dlkeep-" + hash(em), { kind: "dlkeep", email: em, lastAt: now, sent: [...(K.sent || []), k.key].slice(-60) });
      bell(em, { kind: "keepintouch", type: "event", key: "keep-" + k.key, text: k.text, link: k.link, eventId: k.eventId }); out.keep++; measure("delight_sent", k.ws, "keep", { via: k.kind }); }
    return out;
  }

  return { now: clock0, setNow: (f) => { clockFn = typeof f === "function" ? f : now; }, prefsOf, setPrefs, dayOfCard, checklist, summary, afterCard, scrapLine, nextOf, pottoNext, makeNext, polaroidView, savePolaroid, polaroidSpec, keepFor, run, evOf, goingOf, hostData, measure, phaseOf };
}

// ---------------------------------------------------------------- routes
export function mountDelightAfter(app, { store, small, currentUser, C, X, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const D = makeDelight({ store, C, X, app }); app.locals.delight = D;
  const hits = new Map(), limited = (req, n, tag = "") => { const k = (req.ip || "?") + "|dl" + tag, t = Date.now(); let h = hits.get(k); if (!h || t - h.start > HOUR) { h = { n: 0, start: t }; hits.set(k, h); if (hits.size > 20000) hits.clear(); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "bad_request") => res.status(status).json({ code, message });
  const user = (req) => { const u = currentUser(req); return u && u.ws !== DEFAULT_WS ? u : null; };
  const hostOnly = (req, res) => { const u = user(req), E = D.evOf(String(req.params.id || "")); if (!E) { bad(res, "No such event.", 404, "not_found"); return null; } if (!u || u.ws !== E.ws) { bad(res, "Only the host can see this.", 403, "not_granted"); return null; } return { u, E }; };
  /** Who is looking at an event: its host, or a guest who is in (by their reply proof, or their account's email). */
  const viewer = (req, id, src = req.query) => { const E = D.evOf(id); if (!E) return null; const u = user(req); if (u && u.ws === E.ws) return { E, host: true, u };
    const V = app.locals.plans?.viewerOf?.(id, { rid: String(src.rid || "").slice(0, 80), code: String(src.code || "").slice(0, 40), email: u?.email || "" });
    if (!V?.r || V.r.response !== "going" || V.r.noShow === true) return { E, host: false, u, out: true }; return { E, host: false, u, r: { rid: V.rid, ...V.r } }; };
  const nowOf = () => D.now();

  /** One event's cards for this viewer (the event page). */
  async function cardsFor(req, id, src) { const V = viewer(req, id, src); if (!V) return null; const { E } = V, phase = D.phaseOf(E.ev, nowOf()), out = { eventId: id, phase };
    if (!phase || V.out) return out; const prefs = V.u ? D.prefsOf(V.u.email) : null, proof = V.r ? { rid: V.r.rid, code: V.r.code } : {};
    if (phase === "dayof" && (!prefs || prefs.dayof || V.host)) out.dayof = await D.dayOfCard(E, V.host ? { ws: V.u.ws } : { ...proof, email: V.u?.email || "" });
    if (phase === "live") { out.live = { noPhotos: !!E.ev.noPhotos, photos: E.S.list("moments").filter((d) => d.data?.eventId === id && !d.data.hidden).length };
      if (!V.host) out.dayof = await D.dayOfCard(E, { ...proof, email: V.u?.email || "" }, { weather: false }); }
    if (phase === "after" && !V.host && (!prefs || prefs.after)) { out.after = D.afterCard(E, V.r); const em = lc(V.r.email) || V.u?.email; if (em && (!prefs || prefs.scrapbook)) out.scrapbook = D.scrapLine(em, id); }
    // a signed-in guest without this browser's proof gets their own reply's proof, so one-tap kudos and photos work here too
    if (V.r && V.u && lc(V.r.email) === lc(V.u.email) && !(src.rid && src.code)) out.proof = proof;
    return out; }

  app.get("/api/delight/event/:id", async (req, res) => { if (limited(req, 1200)) return bad(res, "Slow down a little.", 429, "rate_limited"); res.set("Cache-Control", "private, no-store");
    const r = await cardsFor(req, String(req.params.id || ""), req.query); if (!r) return bad(res, "No such event.", 404, "not_found"); res.json(r); });
  // Plans: today's and the morning after's cards for every reply this person holds, and a keep-in-touch suggestion
  app.post("/api/delight/plans", small, async (req, res) => { if (limited(req, 600)) return bad(res, "Slow down a little.", 429, "rate_limited"); res.set("Cache-Control", "private, no-store");
    const u = user(req), proofs = (Array.isArray(req.body?.proofs) ? req.body.proofs : []).slice(0, 40), ids = new Map();
    for (const p of proofs) if (ID.test(String(p?.id || ""))) ids.set(String(p.id), { rid: String(p.rid || ""), code: String(p.code || "") });
    if (u) for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; for (const d of scopeStore(store, ws).list("rsvps")) if (lc(d.data?.email) === lc(u.email) && d.data.response === "going" && !ids.has(d.data.eventId)) ids.set(d.data.eventId, {}); }
    const cards = []; for (const [id, src] of [...ids].slice(0, 60)) { const E = D.evOf(id); if (!E || !D.phaseOf(E.ev, nowOf())) continue; const c = await cardsFor(req, id, src); if (c && (c.dayof || c.live || c.after)) cards.push({ ...c, title: titleOf(E.ev), date: E.ev.date }); }
    const order = { live: 0, dayof: 1, after: 2 }; cards.sort((a, b) => order[a.phase] - order[b.phase]);
    const prefs = u ? D.prefsOf(u.email) : null, K = u && req.body?.keep ? D.keepFor(u.email, nowOf()) : null;
    res.json({ cards: cards.slice(0, 4), keep: K ? { text: K.text, link: K.link } : null, keepOn: prefs ? prefs.keep : null }); });
  // the private note to the host (only the host's own routes return it)
  app.post("/api/delight/after/:id/note", small, (req, res) => { if (limited(req, 30, "n")) return bad(res, "Slow down a little.", 429, "rate_limited"); const V = viewer(req, String(req.params.id || ""), req.body || {});
    if (!V || V.host || !V.r) return bad(res, "Notes come from guests who were there. Open this from your invite.", 403, "not_granted"); if (D.phaseOf(V.E.ev, nowOf()) !== "after" && (V.E.ev.date || "9") >= new Date().toISOString().slice(0, 10)) return bad(res, "Notes open once it's happened.");
    const text = scrub(clean(req.body?.text, DELIGHT.noteMax)); if (text.length < 2) return bad(res, "Write a few words first.");
    const cur = V.E.S.get("kudos/" + V.r.rid)?.data; if (cur) V.E.S.update("kudos/" + V.r.rid, { privateNote: text, noteAt: Date.now() }); else V.E.S.set("kudos/" + V.r.rid, { eventId: V.E.id, rid: V.r.rid, name: V.r.name || "", email: lc(V.r.email), tags: [], love: "", privateNote: text, noteAt: Date.now(), via: "note", at: Date.now() });
    try { X?.bust?.(); } catch {} D.measure("delight_tapped", V.E.ws, "private_note"); res.json({ ok: true }); });
  // the host's view: the checklist, the live photos, the summary, the polaroid and the next one
  app.get("/api/delight/host/:id", async (req, res) => { const H = hostOnly(req, res); if (!H) return; res.set("Cache-Control", "private, no-store"); const { E } = H, now = nowOf(), phase = D.phaseOf(E.ev, now), t = timesOf(E.ev), dd = dayNo(localParts(now, t.tz).day) - dayNo(E.ev.date || "1970-01-01");
    const out = { eventId: E.id, phase }; if (!ok(E.ev)) return res.json(out);
    if (checklistOn(E.ev, now)) { out.checklist = D.checklist(E); out.preview = await D.dayOfCard(E, { ws: H.u.ws }, { weather: true }); }
    if (phase === "live") out.live = { noPhotos: !!E.ev.noPhotos, photos: E.S.list("moments").filter((d) => d.data?.eventId === E.id && !d.data.hidden).length };
    if (dd >= 1 && dd <= 30) { out.summary = D.summary(E); out.polaroid = D.polaroidView(E, { host: true }); if (dd >= 1) out.next = await D.pottoNext(E, D.nextOf(E, localParts(now, t.tz).day)); }
    res.json(out); });
  app.put("/api/delight/host/:id/check", small, (req, res) => { const H = hostOnly(req, res); if (!H) return; const k = String(req.body?.item || ""); if (!["chairs", "diet", "playlist", "address", "pay"].includes(k)) return bad(res, "No such item.");
    const cur = D.hostData(H.E.id); store.set("system/dlhost-" + H.E.id, { kind: "dlhost", ...cur, ticks: { ...(cur.ticks || {}), [k]: req.body?.done !== false } }); res.json({ ok: true, checklist: D.checklist(H.E) }); });
  app.put("/api/delight/host/:id/note", small, (req, res) => { const H = hostOnly(req, res); if (!H) return; const cur = D.hostData(H.E.id); store.set("system/dlhost-" + H.E.id, { kind: "dlhost", ...cur, note: clean(req.body?.note, DELIGHT.hostNoteMax) }); res.json({ ok: true, note: clean(req.body?.note, DELIGHT.hostNoteMax) }); });
  app.post("/api/delight/host/:id/polaroid", small, (req, res) => { const H = hostOnly(req, res); if (!H) return; const r = D.savePolaroid(H.E, { photos: req.body?.photos, caption: req.body?.caption, post: req.body?.post === true, unpost: req.body?.unpost === true }); if (r.error) return bad(res, r.error, r.status); res.json(r); });
  app.post("/api/delight/host/:id/next", small, (req, res) => { if (limited(req, 30, "x")) return bad(res, "Slow down a little.", 429, "rate_limited"); const H = hostOnly(req, res); if (!H) return; const r = D.makeNext(H.E, req.body || {}); if (r.error) return bad(res, r.error, r.status); res.json(r); });
  // the polaroid as a share image: the host any time, everyone else once it's posted
  app.get("/api/delight/polaroid/:id.png", async (req, res) => { if (limited(req, 300, "p")) return res.status(429).end(); const E = D.evOf(String(req.params.id || "")); if (!E) return res.status(404).end(); const u = user(req), own = !!u && u.ws === E.ws;
    if (!own && !polaroidOf(store, E.id)) return res.status(404).end(); const png = await renderCardAsync(D.polaroidSpec(E), req.query.size === "link" ? "link" : "story");
    res.set({ "Content-Type": "image/png", "Cache-Control": own ? "private, max-age=60" : "public, max-age=600", "Content-Disposition": "inline" }).send(png); });
  // switches
  app.get("/api/delight/prefs", (req, res) => { const u = user(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); res.set("Cache-Control", "private, no-store"); res.json({ prefs: D.prefsOf(u.email), labels: PREF_LABELS }); });
  app.put("/api/delight/prefs", small, (req, res) => { const u = user(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); const p = D.setPrefs(u.email, req.body || {}); D.measure("delight_tapped", u.ws, "prefs", { count: Object.values(p).filter((x) => !x).length }); res.json({ ok: true, prefs: p }); });
  // what people saw and tapped: a moment name and nothing else
  const MOMENTS = ["dayof", "live", "live_photo", "after", "kudos", "scrapbook", "checklist", "check", "summary", "polaroid", "next", "keep"];
  app.post("/api/delight/track", small, (req, res) => { if (limited(req, 300, "t")) return res.json({ ok: false }); const m = String(req.body?.moment || ""), act = req.body?.act === "tap" ? "delight_tapped" : "delight_shown"; if (!MOMENTS.includes(m)) return res.json({ ok: false });
    const E = D.evOf(String(req.body?.eventId || "")), u = user(req); D.measure(act, E?.ws || u?.ws || "", m, { signed_in: !!u }); res.json({ ok: true }); });

  if (jobs) { const tick = () => D.run().catch((e) => console.warn("[delight]", e?.message || e)); const t = setInterval(tick, 15 * MIN); t.unref?.(); setTimeout(tick, 120e3).unref?.(); }
  return D;
}
