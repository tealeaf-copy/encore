// Tables: small, recurring groups that come back for the same faces (review round 11, the quiet crowd).
//
// Everything here reads the host's own event fields and keeps its own records, so the RSVP path in app.js stays as it is:
//
// - The plan, up front: what we're doing for the first 30 minutes (`first30`), the expected group size (`sizeMin`..`sizeMax`),
//   comfort notes (`comfort`: solo, quiet, leave, nospeech, beginner), a noise level (`noise`), a short agenda (`agenda`) and
//   co-hosts (`cohosts`: [{ name, handle? }]). GET /api/public/table/:id gives guests the cleaned version, plus a few first
//   names of who is in (never on a hidden, discreet or Chatham event; on a private or friends-only one, only to guests who
//   are in) and who came last time when the event is one date of a series.
// - "I'm in if Sam is": a guest who replied Maybe names a friend (POST /api/public/table/:id/ifwith). When someone by that name
//   replies I'm in, the Maybe turns into I'm in (or the waitlist when it's full). Sam is never told. Records: `ifwith/<rid>`.
// - Open table: the host turns on `openTable` with 2 or 3 taste questions. Guests who are in answer them (`taste/<rid>`);
//   the host sees suggested tables of about 4 (`suggestTables`, friends who came together stay together) and confirms them
//   (`tables/<eventId>`); then each guest sees "You're at table 2 with Ada and Lin".
// - Same table next time?: within 24 hours after the event ends (from an hour after, between 9am and 9pm where the event is),
//   each guest who came gets one email and one inbox note, logged in `sametable/<event>--<rid>` before it goes out. Their one
//   tap (/again/:id) replies I'm in to the next date, or, when it isn't made yet, holds their spot (`againpledge/...`) and
//   replies for them once it is.
// - For the host: second-RSVP rate (of guests who came, how many replied I'm in to a later date), per host and per series,
//   the group's roster as CSV or JSON with consent fields, and suggested tables.
import crypto from "node:crypto";
import { randomId } from "./db.js";
import { scopeStore, allWorkspaceIds, getWorkspace, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail, EMAIL_RE, isUnsubscribed } from "./email.js";
import { replyKey } from "./social.js";
import { seriesSiblings } from "./repeats.js";
import { hostFirst } from "./kudosask.js";
import { tokenFromCookie, findHold, friendTermsByHash } from "./comewith.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12);
const andList = (L) => (L.length <= 1 ? L.join("") : L.length === 2 ? `${L[0]} and ${L[1]}` : `${L.slice(0, -1).join(", ")} and ${L[L.length - 1]}`);

export const COMFORT = [["solo", "Come alone friendly"], ["beginner", "Beginner friendly"], ["quiet", "Quiet corner"], ["leave", "Leave anytime"], ["nospeech", "No speeches"]];
export const NOISE = { low: "Low noise", medium: "Some chatter", lively: "Lively" };
const COMFORT_KEYS = new Set(COMFORT.map(([k]) => k));

/** The plan as guests see it, cleaned from whatever the event carries. Pure. */
export function tableOf(ev) {
  const e = ev || {}, n = (v) => (Number.isFinite(+v) && +v > 0 ? Math.min(500, Math.round(+v)) : 0);
  let lo = n(e.sizeMin), hi = n(e.sizeMax); if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  const comfort = (Array.isArray(e.comfort) ? e.comfort : []).map(String).filter((k, i, a) => COMFORT_KEYS.has(k) && a.indexOf(k) === i);
  const agenda = (Array.isArray(e.agenda) ? e.agenda : []).map((x) => clean(typeof x === "object" ? [x?.t, x?.what].filter(Boolean).join(" ") : x, 120)).filter(Boolean).slice(0, 6);
  const cohosts = (Array.isArray(e.cohosts) ? e.cohosts : []).map((c) => ({ name: clean(typeof c === "object" ? c?.name : c, 60), handle: clean(c?.handle, 30).replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "") })).filter((c) => c.name).slice(0, 4);
  const O = e.openTable && typeof e.openTable === "object" && e.openTable.on !== false ? e.openTable : null;
  const questions = O ? (Array.isArray(O.questions) ? O.questions : []).map((q, i) => ({ id: "q" + (i + 1), q: clean(q?.q, 120), options: (Array.isArray(q?.options) ? q.options : []).map((o) => clean(o, 40)).filter(Boolean).slice(0, 5) })).filter((q) => q.q && q.options.length >= 2).slice(0, 3) : [];
  return { first30: clean(e.first30, 220), size: lo || hi ? { min: lo || hi, max: hi || lo } : null, comfort, noise: NOISE[e.noise] ? e.noise : "", agenda, cohosts,
    open: O ? { size: Math.max(3, Math.min(8, Math.round(+O.size) || 4)), questions } : null, roundtable: e.hostRoundtable === true };
}
/** "6 to 12", "about 8". Pure. */
export const sizeText = (s) => (!s ? "" : s.min === s.max ? `about ${s.min}` : `${s.min} to ${s.max}`);
export const comfortLabels = (T) => [...T.comfort.map((k) => COMFORT.find((c) => c[0] === k)[1]), ...(T.noise ? [NOISE[T.noise]] : [])];

// ---- who's in, by first name ----
const hiddenNames = (ev) => !!(ev?.hideGuests || ev?.noWall || ev?.discreet || ev?.chatham);
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
/** Latest reply per person for one event. */
export function latestReplies(S, eventId) {
  const seen = new Set(), out = [];
  for (const d of S.list("rsvps").filter((x) => x.data?.eventId === eventId).sort((a, b) => (b.data.changedAt || b.data.createdAt || 0) - (a.data.changedAt || a.data.createdAt || 0))) {
    const k = replyKey(d.data) || "id:" + d.id; if (seen.has(k)) continue; seen.add(k); out.push({ id: d.id, r: d.data, k }); }
  return out;
}
/** Who came (or is in, for an upcoming date): replies I'm in that weren't no-shows; after a door check-in, only those checked in. */
export function cameTo(S, eventId, ev) {
  const L = latestReplies(S, eventId).filter((x) => x.r.response === "going" && x.r.noShow !== true), door = L.some((x) => x.r.checkedInAt);
  const out = door ? L.filter((x) => x.r.checkedInAt) : L, keys = new Set(out.map((x) => x.k));
  for (const g of ev?.guests || []) { const k = replyKey(g); if (k && !keys.has(k) && /^(Going|Attended)$/.test(g.status || "") && (!door || g.status === "Attended")) { keys.add(k); out.push({ id: null, r: { name: g.name, email: g.email, phone: g.phone, showMe: g.optIn ? true : false, host: true }, k }); } }
  return out;
}
const shownNames = (L) => L.filter((x) => x.r.showMe !== false && !(x.r.host && x.r.showMe === false)).map((x) => first(x.r.name)).filter(Boolean);
/** "Table 2 with Ada and 2 others": tablemates who chose to show their name by first name, the rest only counted. Pure. */
export const withLine = (names, others = 0) => { const L = [...names]; if (others > 0) L.push(`${others} other${others === 1 ? "" : "s"}`); return andList(L); };
/** review round 13: the one "New" badge: first time with this host. Of the people replying to this event, the reply keys
 *  of those who didn't come to any earlier date the host ran (any of their events, not only this series). */
export function newWithHost(S, eventId, ev = S.get("events/" + eventId)?.data, today = new Date().toISOString().slice(0, 10)) {
  const cut = ev && ISO.test(ev.date || "") && ev.date < today ? ev.date : today, before = new Set();
  for (const d of S.list("events")) { const e = d.data; if (!e || d.id === eventId || e.example || e.sample || e.cancelled || !ISO.test(e.date || "") || !(e.date < cut)) continue; for (const x of cameTo(S, d.id, e)) before.add(x.k); }
  return new Set(latestReplies(S, eventId).map((x) => x.k).filter((k) => k && !before.has(k)));
}

// ---- "I'm in if Sam is" ----
const norm = (s) => lc(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9@. ]/g, "").replace(/\s+/g, " ").trim();
/** Does this reply's name (or email) match what the guest typed? "Sam" matches Sam Ortiz; "Sam O" too; an email matches exactly. Pure. */
export function nameMatches(r, want) {
  const w = norm(want), n = norm(r?.name); if (!w) return false;
  if (w.includes("@")) return lc(r?.email) === w;
  if (!n) return false; if (n === w) return true;
  const W = w.split(" "), N = n.split(" ");
  if (W.length === 1) return N[0] === W[0];
  return N[0] === W[0] && !!N[1] && N[1].startsWith(W[1].replace(/\.$/, ""));
}

// ---- open tables ----
/** Suggested tables: about `size` each, sizes within one of each other, people with the most answers in common together,
 *  and a guest who came in with a friend ("I'm in if Sam is") at the friend's table. Pure.
 *  guests: [{ rid, name, answers: { q1: "Root", ... }, with: rid|null }] in reply order. Returns [[rid, ...], ...]. */
export function suggestTables(guests, size = 4) {
  const G = guests.filter((g) => g && g.rid), n = G.length; if (!n) return [];
  const k = Math.max(1, Math.round(n / size)), base = Math.floor(n / k), extra = n % k, caps = Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
  const by = new Map(G.map((g) => [g.rid, g])), sim = (a, b) => Object.keys(a.answers || {}).reduce((s, q) => s + (a.answers[q] && a.answers[q] === b.answers?.[q] ? 1 : 0), 0);
  const unit = (g) => { const U = [g.rid]; if (g.with && by.has(g.with) && g.with !== g.rid) U.push(g.with); for (const h of G) if (h.with === g.rid && !U.includes(h.rid)) U.push(h.rid); return U; };
  const left = new Set(G.map((g) => g.rid)), T = [];
  // review round 13: each table starts with someone who has been before (back: true) while there are enough of them, and
  // tables lean towards a mix of new and returning faces; answers in common still decide within that
  const mixed = G.some((g) => g.back) && G.some((g) => !g.back), seeds = new Set(mixed ? G.filter((g) => g.back).slice(0, caps.length).map((g) => g.rid) : []);
  for (const cap of caps) { const t = []; const seed = G.find((g) => left.has(g.rid) && seeds.has(g.rid)) || G.find((g) => left.has(g.rid) && !seeds.has(g.rid)) || G.find((g) => left.has(g.rid)); if (!seed) break; seeds.delete(seed.rid);
    for (const r of unit(seed)) if (left.has(r) && t.length < Math.max(cap, 2)) { t.push(r); left.delete(r); seeds.delete(r); }
    while (t.length < cap && left.size) { let best = null, bs = -1; const nb = t.filter((x) => by.get(x).back).length, nn = t.length - nb, free = [...left].some((x) => !seeds.has(x));
      for (const r of left) { if (free && seeds.has(r)) continue; const s = 2 * t.reduce((a, x) => a + sim(by.get(x), by.get(r)), 0) + (mixed && (by.get(r).back ? nb < nn : nn <= nb) ? 1 : 0); if (s > bs) { bs = s; best = r; } }
      for (const r of unit(by.get(best))) if (left.has(r) && t.length < cap + 1) { t.push(r); left.delete(r); seeds.delete(r); } }
    T.push(t); }
  for (const r of left) T.sort((a, b) => a.length - b.length)[0].push(r); // anyone left joins the smallest table
  return T.filter((t) => t.length);
}

// ---- time, where the event is ----
function localStamp(now, tz) {
  let f; try { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch { f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, "0")}:${p.minute}`;
}
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** When the event ends, local to it: "YYYY-MM-DDTHH:MM". The end time, else three hours after the start, else 9pm. Pure. */
export function endLocal(ev) {
  if (!ISO.test(ev?.date || "")) return ""; const st = HHMM.test(ev.startTime || "") ? ev.startTime : "", en = HHMM.test(ev.endTime || "") ? ev.endTime : "";
  let day = ISO.test(ev.endDate || "") && ev.endDate > ev.date ? ev.endDate : ev.date, t = en || (st ? String(Math.min(23, +st.slice(0, 2) + 3)).padStart(2, "0") + st.slice(2) : "21:00");
  if (en && st && en < st && day === ev.date) day = addDays(day, 1); // ends after midnight
  return `${day}T${t}`;
}
/** Is it time to ask "Same table next time?": from an hour after the end to 24 hours after, between 9am and 9pm local. Pure. */
export function sameTableWindow(ev, now, tz = ev?.tz || process.env.ENCORE_TZ || "") {
  const end = endLocal(ev); if (!end) return false; const loc = localStamp(now, tz), mins = (Date.parse(loc + ":00Z") - Date.parse(end + ":00Z")) / 6e4, h = +loc.slice(11, 13);
  return mins >= 60 && mins < 24 * 60 && h >= 9 && h < 21;
}
const todayAt = (ev, now = Date.now()) => localStamp(now, ev?.tz || process.env.ENCORE_TZ || "").slice(0, 10);
const fmtDay = (d) => (ISO.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");

// ---- second replies ----
/** Second-RSVP rate: of the people who came to a past date, how many replied I'm in to another date. Per host and per series. */
export function secondRsvp(S, today = new Date().toISOString().slice(0, 10)) {
  const E = S.list("events").filter((d) => d.data && !d.data.example && !d.data.sample && !d.data.cancelled && d.data.stage !== "interest" && ISO.test(d.data.date || ""));
  const rootOf = (d) => d.data.seriesId || d.id, per = new Map(), series = new Map();
  for (const d of E) { const root = rootOf(d); if (!series.has(root)) series.set(root, { id: root, title: "", dates: 0, people: new Map() }); const s = series.get(root); s.dates++; if (d.id === root || !s.title) s.title = clean(d.data.pubTitle || d.data.name, 120);
    for (const x of cameTo(S, d.id, d.data)) { const P = per.get(x.k) || []; P.push({ date: d.data.date, id: d.id }); per.set(x.k, P); const Q = s.people.get(x.k) || []; Q.push(d.data.date); s.people.set(x.k, Q); } }
  const rate = (M) => { let came = 0, again = 0; for (const L of M.values()) { const ds = [...new Set(L.map((x) => (typeof x === "string" ? x : x.date)))].sort(); if (!(ds[0] < today)) continue; came++; if (ds.length >= 2) again++; } return { came, again, rate: came ? Math.round((100 * again) / came) : null }; };
  return { ...rate(per), series: [...series.values()].filter((s) => s.dates > 1 || s.people.size).map((s) => ({ id: s.id, title: s.title, dates: s.dates, ...rate(s.people) })).sort((a, b) => b.dates - a.dates).slice(0, 20) };
}

// ---- the roster ----
const CSV_COLS = ["name", "email", "phone", "times_in", "no_shows", "first_date", "last_date", "events", "emails_ok", "texts_ok", "shown_to_guests", "follows_you"];
// a cell that a spreadsheet would run as a formula gets a leading ', except a phone number ("+1 (555) 123-4567") stays as typed
const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s()-]+$/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function rosterOf(S, { root = "", followers = [], canEmail = () => true } = {}) {
  const F = new Set(followers.map((f) => lc(f.email)).filter(Boolean)), people = new Map();
  for (const d of S.list("events")) { const ev = d.data; if (!ev || ev.example || ev.sample || ev.cancelled || !ISO.test(ev.date || "")) continue; if (root && (ev.seriesId || d.id) !== root && d.id !== root) continue;
    for (const x of latestReplies(S, d.id)) { if (!["going", "maybe", "waitlist"].includes(x.r.response)) continue; const p = people.get(x.k) || { name: "", email: "", phone: "", dates: [], events: [], noShows: 0, smsOk: null, showMe: null };
      p.name = p.name || clean(x.r.name, 80); p.email = p.email || lc(x.r.email); p.phone = p.phone || clean(x.r.phone, 30);
      if (x.r.response === "going" && x.r.noShow !== true) { p.dates.push(ev.date); p.events.push(`${clean(ev.pubTitle || ev.name, 60)} (${ev.date})`); }
      if (x.r.response === "going" && x.r.noShow === true) p.noShows++;
      // texts only with a yes to texts (the reply's texts box, or "text me" as how to reach them), never from a phone alone; STOP wins
      if (x.r.smsOk === false) p.smsOk = false; else if (p.smsOk !== false && (x.r.smsOk === true || x.r.contactVia === "sms")) p.smsOk = true; if (x.r.showMe === false) p.showMe = false; else if (p.showMe == null) p.showMe = true;
      people.set(x.k, p); } }
  return [...people.values()].map((p) => { const ds = [...new Set(p.dates)].sort(); return { name: p.name, email: p.email, phone: p.phone, times_in: ds.length, no_shows: p.noShows, first_date: ds[0] || "", last_date: ds[ds.length - 1] || "", events: p.events.join("; "),
    emails_ok: !!p.email && EMAIL_RE.test(p.email) && !isUnsubscribed(p.email) && canEmail(p.email) !== false, texts_ok: !!p.phone && p.smsOk === true, shown_to_guests: p.showMe !== false, follows_you: !!p.email && F.has(p.email) }; })
    .sort((a, b) => b.times_in - a.times_in || a.name.localeCompare(b.name));
}
export const rosterCsv = (rows) => [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => csvCell(typeof r[c] === "boolean" ? (r[c] ? "yes" : "no") : r[c])).join(","))].join("\r\n") + "\r\n";

export function mountTables(app, { store, small, C, X, ownerOnly, currentUser = () => null, sendStatic, publicOrigin, serverReply = null, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const hits = new Map(), limited = (req, n = 240) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); if (hits.size > 20000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const mailCfg = (ws) => emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
  const evOf = (id) => { if (!ID.test(id || "")) return null; const ws = workspaceOfEvent(id); if (!ws) return null; const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; return ev && !ev.example ? { ws, S, ev, id } : null; };
  const proof = (id, rid, code) => { const P = X.rsvpProof(String(id || ""), clean(rid, 80), clean(code, 40)); return P && P.ev ? P : null; };
  const title = (ev) => clean(ev?.pubTitle || ev?.name, 120) || "the event";
  const canMail = (em) => EMAIL_RE.test(em || "") && !isUnsubscribed(em) && X.canEmail?.(em) !== false;
  async function mail(ws, ev, to, subject, text, origin) { const cfg = mailCfg(ws); if (!cfg || !canMail(to)) return false; try { const m = await sendEmail(cfg, { list: "guest", origin, to, subject, text, fromName: C?.profileOf?.(ws)?.name || "" }); if (m.ok) scopeStore(store, ws).add("outbox", { kind: "tables", eventId: "", to: [to], subject, at: Date.now(), status: "sent" }); return !!m.ok; } catch { return false; } }
  const hostOf = (ws, ev) => { const T = tableOf(ev), h = hostFirst(C, ws, ev) || ""; return [h, ...T.cohosts.map((c) => first(c.name))].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i); };
  const ownerEmail = (ws) => getWorkspace(ws)?.ownerEmail || "";

  // ---------- the plan, who's in, last time (guests) ----------
  function publicTable(E, P, isHost = false) {
    const { S, ev, id, ws } = E, T = tableOf(ev), today = todayAt(ev), going = P && P.r.response === "going";
    const namesOk = !hiddenNames(ev) && (!closed(ev) || going || isHost), now = cameTo(S, id, ev), names = namesOk ? shownNames(now) : [];
    let last = null; const prev = seriesSiblings(S, id, ev).filter((x) => x.data.date < ev.date && x.data.date < today).sort((a, b) => b.data.date.localeCompare(a.data.date))[0];
    if (prev && !hiddenNames(ev)) { const L = cameTo(S, prev.id, prev.data), nowK = new Set(now.map((x) => x.k)); last = { date: prev.data.date, count: L.length, names: namesOk ? shownNames(L).slice(0, 6) : [], back: namesOk ? shownNames(L.filter((x) => nowK.has(x.k))).slice(0, 6) : [] }; }
    const out = { first30: T.first30, size: T.size, sizeText: sizeText(T.size), comfort: T.comfort.map((k) => ({ k, label: COMFORT.find((c) => c[0] === k)[1] })), noise: T.noise ? { k: T.noise, label: NOISE[T.noise] } : null, agenda: T.agenda,
      start: HHMM.test(ev.startTime || "") ? ev.startTime : "", end: HHMM.test(ev.endTime || "") ? ev.endTime : "", hosts: hostOf(ws, ev), cohosts: T.cohosts.map((c) => ({ name: first(c.name), handle: c.handle || "" })),
      names: names.slice(0, 4), more: namesOk ? Math.max(0, now.length - Math.min(4, names.length)) : 0, count: namesOk ? now.length : 0, // review round 13: no head count where names are hidden
      last, open: T.open ? { size: T.open.size, questions: T.open.questions } : null, past: ISO.test(ev.date || "") && ev.date < today, me: null };
    if (P) { const I = S.get("ifwith/" + P.rid)?.data, tasted = S.get("taste/" + P.rid)?.data, TB = S.get("tables/" + id)?.data; let table = null;
      if (TB?.confirmedAt && going) { const i = (TB.tables || []).findIndex((t) => t.includes(P.rid)); if (i >= 0) { const M = TB.tables[i].filter((r) => r !== P.rid).map((r) => S.get("rsvps/" + r)?.data).filter(Boolean), shown = M.filter((r) => r.showMe !== false).map((r) => first(r.name)).filter(Boolean); table = { n: i + 1, with: shown, others: M.length - shown.length }; } }
      const ag = S.get("sametable/" + id + "--" + P.rid)?.data;
      out.me = { response: P.r.response, ifWith: I && I.state === "waiting" ? clean(I.name, 60) : "", metWith: I?.state === "in" ? clean(I.name, 60) : "", order: I?.state === "in" && I.landed === "order", taste: tasted?.answers || null, table, again: ag ? { tapped: !!ag.tappedAt, state: ag.state || "" } : null }; }
    return out;
  }
  app.get("/api/public/table/:eventId", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const E = evOf(clean(req.params.eventId, 80)); if (!E) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, no-store"); const P = req.query.rid ? proof(E.id, req.query.rid, req.query.code) : null, u = currentUser(req); res.json(publicTable(E, P, !!u && u.ws === E.ws)); });

  // ---------- "I'm in if Sam is" ----------
  const resolving = new Set();
  async function resolveIfWith(ws, eventId, origin = process.env.ENCORE_PUBLIC_URL || "") {
    const key = ws + "|" + eventId; if (resolving.has(key)) return 0; resolving.add(key); let n = 0;
    try { const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data; if (!ev) return 0;
      for (let pass = 0; pass < 5; pass++) { let changed = false;
        for (const d of S.list("ifwith").filter((x) => x.data?.eventId === eventId && x.data.state === "waiting")) { const I = d.data, me = S.get("rsvps/" + I.rid)?.data;
          if (!me) { S.update("ifwith/" + d.id, { state: "off" }); continue; }
          if (["no", "declined"].includes(me.response)) { S.update("ifwith/" + d.id, { state: "off" }); continue; }
          if (me.response === "going") { S.update("ifwith/" + d.id, { state: "in", metAt: Date.now() }); continue; }
          const all = S.list("rsvps").filter((x) => x.data?.eventId === eventId), hit = latestReplies(S, eventId).find((x) => x.id !== I.rid && x.r.response === "going" && x.r.noShow !== true && nameMatches(x.r, I.name));
          if (!hit) continue;
          const now = Date.now(), em = lc(me.email), t = title(ev), who = first(I.name) || "Your friend", link = `/g#rsvp-${eventId}`, invite = `${origin}/e/${encodeURIComponent(eventId)}`;
          // review round 13: a pre-order is never ordered for them: the Maybe stays, and they're told to pick what they want
          if (ev.preorder) { S.update("ifwith/" + d.id, { state: "in", metAt: now, landed: "order" }); n++; changed = true;
            if (em) { X.notify(em, { kind: "ifwith", key: `ifwith-${d.id}`, text: `${who} is in for ${t}. Open your invite to order.`, link, eventId });
              await mail(ws, ev, em, `${who} is in: ${t}`, `Hi ${first(me.name) || "there"},\n\n${who} is in for ${t}, like you asked. Open your invite to order what you'd like:\n${invite}\n`, origin); }
            continue; }
          S.update("ifwith/" + d.id, { state: "in", metAt: now }); // marked first: never twice
          // the same rules as their own I'm in (ask to join, the waitlist, a Come with me link they opened), and the same emails
          const cw = I.withH ? friendTermsByHash(S, ev, eventId, I.withH, I.rid) : null, guest = first(me.name) || "A guest";
          const R = serverReply ? await serverReply(ws, { eventId, rid: I.rid, patch: { ifWithMet: clean(I.name, 60) }, origin, cw, hostLine: (st) => (st === "going" ? `${guest} is in for ${t} (they were in if ${who} was).` : "") }) : { state: "gone" };
          const landed = R.state === "in" ? "going" : R.state; S.update("ifwith/" + d.id, { landed }); n++; changed = true;
          if (em && ["going", "requested", "waitlist"].includes(landed)) { X.notify(em, { kind: "ifwith", key: `ifwith-${d.id}`, text: landed === "requested" ? `${who} is in for ${t}, so you asked to join. The host lets each guest in.` : landed === "waitlist" ? `${who} is in for ${t}. It's full, so you're on the waitlist.` : `${who} is in, so you're in for ${t}.`, link, eventId });
            if (landed === "going" && !R.confirmEmailed) await mail(ws, ev, em, `You're in: ${t}`, `Hi ${first(me.name) || "there"},\n\n${who} is in for ${t}, so you are too, like you asked.${ev.date ? `\n\nWhen: ${fmtDay(ev.date)}${ev.startTime ? `, ${ev.startTime}` : ""}` : ""}\n\nYour invite: ${invite}\n\nPlans changed? Open it and tap Can't go.\n`, origin); } }
        if (!changed) break; } } finally { resolving.delete(key); }
    return n;
  }
  // a reply changed anywhere: settle that event's conditional replies (deferred, outside the write)
  store.events?.on?.("change", (e) => { const m = /^ws\/([^/]+)\/rsvps\/([A-Za-z0-9_-]+)$/.exec(String(e?.path || "")); if (!m) return; setImmediate(() => { try { const r = store.get(e.path)?.data; if (r?.eventId && scopeStore(store, m[1]).list("ifwith").some((d) => d.data?.eventId === r.eventId && d.data.state === "waiting")) resolveIfWith(m[1], r.eventId).catch(() => {}); } catch {} }); });
  app.post("/api/public/table/:eventId/ifwith", small, async (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, id = clean(req.params.eventId, 80); let P = b.rid ? proof(id, b.rid, b.code) : null, made = null;
    // no reply yet: this is their reply ("I'm in if Sam is"), held as Maybe until Sam is in
    if (!b.rid) { const E = evOf(id), gk = clean(req.get("x-encore-key"), 64), me = clean(b.me, 80), email = lc(clean(b.email, 200)), phone = clean(b.phone, 30).replace(/[^\d+ ()-]/g, "");
      if (!E || E.ev.cancelled) return bad(res, "That event isn't here any more.", 404, "not_found"); if (isDemo(E.ws) && process.env.ENCORE_ALLOW_DEMO_WRITES !== "1") return bad(res, "This is an example event, so it can't take replies.", 403, "example");
      if (ISO.test(E.ev.date || "") && E.ev.date < todayAt(E.ev)) return bad(res, "This one has already happened, so replies are closed.", 409, "past");
      if (!gk) return bad(res, "Missing guest key.", 403, "not_granted"); if (me.length < 2) return bad(res, "Add your name."); if (email && !EMAIL_RE.test(email)) return bad(res, "Check your email.");
      const k = replyKey({ email, name: me, phone }), prior = latestReplies(E.S, id).find((x) => x.k === k && (email || phone));
      if (prior && prior.r._k !== gk && !(Array.isArray(prior.r._keys) && prior.r._keys.includes(gk))) return bad(res, "You already replied with this email. Open the invite on the phone or browser you used.", 409, "rsvp_exists");
      if (prior) P = { ...E, r: prior.r, rid: prior.id };
      else { const code = crypto.randomBytes(4).toString("hex").toUpperCase(), now = Date.now(), body = { eventId: id, name: me, ...(email ? { email } : {}), ...(phone ? { phone } : {}), response: "maybe", code, createdAt: now, changedAt: now, source: "guest", via: "ifwith", showMe: true, _k: gk };
        const a = E.S.add("rsvps", body); P = { ...E, r: body, rid: a.id }; made = { rid: a.id, code };
        const owner = ownerEmail(E.ws); if (owner) X.notify(owner, { kind: "reply", key: `rsvp-${a.id}-maybe`, text: `${first(me)} said Maybe to ${title(E.ev)}.`, link: `/?app=1&open=${encodeURIComponent(id)}#studio`, eventId: id }); } }
    if (!P) return bad(res, "Reply first, then tell us who you'd come with.", 403, "not_granted");
    const name = clean(b.name, 60); if (!name) { if (P.S.get("ifwith/" + P.rid)) P.S.set("ifwith/" + P.rid, { ...P.S.get("ifwith/" + P.rid).data, state: "off" }); return res.json({ ok: true, state: "off" }); }
    if (name.length < 2) return bad(res, "Add their name.");
    if (nameMatches(P.r, name) && !name.includes("@")) return bad(res, "That's your own name. Who would you come with?");
    if (P.r.response === "going") return res.json({ ok: true, state: "in" });
    // review round 13: a Come with me link this browser opened goes with the record, so when it settles their reply fills the held spot
    const tok = tokenFromCookie(req, id), F = tok ? findHold(P.S, id, tok) : null, withH = F && F.inviter.id !== P.rid ? F.hold.h : "";
    P.S.set("ifwith/" + P.rid, { eventId: id, rid: P.rid, name, state: "waiting", at: Date.now(), ...(withH ? { withH } : {}) });
    if (!["maybe", "waitlist", "requested"].includes(P.r.response)) P.S.update("rsvps/" + P.rid, { response: "maybe", changedAt: Date.now() });
    await resolveIfWith(P.ws, id, publicOrigin(req)); const I = P.S.get("ifwith/" + P.rid)?.data;
    res.json({ ok: true, state: I?.state === "in" ? (["waitlist", "requested", "order"].includes(I.landed) ? I.landed : "in") : "waiting", name, ...(made ? made : {}), response: P.S.get("rsvps/" + P.rid)?.data?.response || "" }); });

  // ---------- open table: taste answers, suggested and confirmed tables ----------
  app.post("/api/public/table/:eventId/taste", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, id = clean(req.params.eventId, 80), P = proof(id, b.rid, b.code);
    if (!P) return bad(res, "Reply first.", 403, "not_granted"); if (P.r.response !== "going") return bad(res, "These are for guests who are in.", 403, "not_granted"); const T = tableOf(P.ev); if (!T.open) return bad(res, "This one doesn't have tables.", 404, "not_found");
    const A = {}; for (const q of T.open.questions) { const v = clean(b.answers?.[q.id], 40); if (v && q.options.includes(v)) A[q.id] = v; }
    P.S.set("taste/" + P.rid, { eventId: id, rid: P.rid, answers: A, at: Date.now() }); res.json({ ok: true, answers: A }); });
  function hostTable(ws, id) {
    const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; if (!ev) return null; const T = tableOf(ev), today = todayAt(ev);
    const now = latestReplies(S, id).filter((x) => x.r.response === "going" && x.r.noShow !== true), If = S.list("ifwith").filter((d) => d.data?.eventId === id).map((d) => d.data);
    const withOf = (rid) => { const I = If.find((x) => x.rid === rid && x.state === "in"); if (!I) return null; const h = now.find((x) => x.id !== rid && nameMatches(x.r, I.name)); return h?.id || null; };
    const NEW = newWithHost(S, id, ev), G = now.filter((x) => x.id).sort((a, b) => (a.r.createdAt || 0) - (b.r.createdAt || 0)).map((x) => ({ rid: x.id, name: clean(x.r.name, 60), answers: S.get("taste/" + x.id)?.data?.answers || {}, with: withOf(x.id), back: !NEW.has(x.k) }));
    const TB = S.get("tables/" + id)?.data, confirmed = !!TB?.confirmedAt, valid = new Set(G.map((g) => g.rid));
    const tables = confirmed ? (TB.tables || []).map((t) => t.filter((r) => valid.has(r))).filter((t) => t.length) : T.open ? suggestTables(G, T.open.size) : [];
    if (confirmed) { const placed = new Set(tables.flat()), late = G.filter((g) => !placed.has(g.rid)).map((g) => g.rid); if (late.length) tables.push(late); }
    const prev = seriesSiblings(S, id, ev).filter((x) => x.data.date < ev.date && x.data.date < today).sort((a, b) => b.data.date.localeCompare(a.data.date))[0];
    const lastL = prev ? cameTo(S, prev.id, prev.data) : [], lastK = new Set(lastL.map((x) => x.k)), nowK = new Set(now.map((x) => x.k));
    const AG = S.list("sametable").filter((d) => d.data?.eventId === id).map((d) => d.data), M = secondRsvp(S, today), root = ev.seriesId || id;
    return { table: T, open: !!T.open, confirmed, confirmedAt: TB?.confirmedAt || null,
      guests: G.map((g) => ({ rid: g.rid, name: g.name, answers: g.answers, back: lastK.has(replyKey(S.get("rsvps/" + g.rid)?.data)), new: !g.back })),
      // review round 13: everyone replying, with the one "New" (first time with this host) the Guests step and Your crowd use too
      people: latestReplies(S, id).filter((x) => x.id && ["going", "maybe", "requested", "waitlist"].includes(x.r.response)).map((x) => ({ rid: x.id, name: clean(x.r.name, 60), new: NEW.has(x.k) })),
      tables: tables.map((t) => t.map((rid) => { const g = G.find((x) => x.rid === rid); return { rid, name: g?.name || "Guest", answers: g?.answers || {}, new: !!g && !g.back }; })),
      ifWith: If.map((I) => ({ rid: I.rid, guest: clean(S.get("rsvps/" + I.rid)?.data?.name, 60), name: clean(I.name, 60), state: I.state, landed: I.landed || "" })),
      last: prev ? { id: prev.id, date: prev.data.date, came: lastL.map((x) => clean(x.r.name, 60)), back: lastL.filter((x) => nowK.has(x.k)).map((x) => clean(x.r.name, 60)), notYet: lastL.filter((x) => !nowK.has(x.k)).map((x) => clean(x.r.name, 60)) } : null,
      sameTable: { asked: AG.filter((a) => a.channel !== "pending").length, tapped: AG.filter((a) => a.tappedAt).length },
      secondRsvp: { host: { came: M.came, again: M.again, rate: M.rate }, series: M.series.find((s) => s.id === root) || null } };
  }
  app.get("/api/host/table/:eventId", (req, res) => { const u = ownerOnly(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); const T = hostTable(u.ws, clean(req.params.eventId, 80)); return T ? res.json(T) : bad(res, "No such event.", 404, "not_found"); });
  app.post("/api/host/table/:eventId/tables", small, async (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.params.eventId, 80), S = scopeStore(store, u.ws), ev = S.get("events/" + id)?.data; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const going = new Set(latestReplies(S, id).filter((x) => x.id && x.r.response === "going").map((x) => x.id)), seen = new Set();
    const tables = (Array.isArray(req.body?.tables) ? req.body.tables : []).slice(0, 40).map((t) => (Array.isArray(t) ? t : []).map((r) => clean(r, 80)).filter((r) => going.has(r) && !seen.has(r) && seen.add(r))).filter((t) => t.length);
    if (!tables.length) return bad(res, "No tables to save yet.");
    const confirm = req.body?.confirm !== false, at = Date.now(); S.set("tables/" + id, { eventId: id, tables, ...(confirm ? { confirmedAt: at } : {}), at });
    let told = 0; const origin = publicOrigin(req), t = title(ev);
    if (confirm) for (const [i, T] of tables.entries()) for (const rid of T) { const r = S.get("rsvps/" + rid)?.data, em = lc(r?.email); if (!em) continue; const M = T.filter((x) => x !== rid).map((x) => S.get("rsvps/" + x)?.data).filter(Boolean), shown = M.filter((x) => x.showMe !== false).map((x) => first(x.name)).filter(Boolean), sig = hash(i + ":" + T.join(","));
      const line = M.length ? `You're at table ${i + 1} with ${withLine(shown, M.length - shown.length)}.` : `You're at table ${i + 1}.`; // only names people chose to show
      if (X.notify(em, { kind: "table", key: `table-${id}-${rid}-${sig}`, text: `${t}: ${line}`, link: `/g#rsvp-${id}`, eventId: id })) { told++; const log = "tablemail/" + id + "--" + rid;
        if (S.get(log)?.data?.sig !== sig) { S.set(log, { sig, at }); await mail(u.ws, ev, em, `${t}: your table`, `Hi ${first(r.name) || "there"},\n\n${line}\n\n${ev.date ? `${fmtDay(ev.date)}${ev.startTime ? `, ${ev.startTime}` : ""}. ` : ""}Your invite: ${origin}/e/${encodeURIComponent(id)}\n`, origin); } } }
    res.json({ ok: true, confirmed: confirm, told, ...hostTable(u.ws, id) }); });

  // ---------- second replies and the roster (the host's own) ----------
  app.get("/api/host/second-rsvp", (req, res) => { const u = ownerOnly(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(secondRsvp(scopeStore(store, u.ws), new Date().toISOString().slice(0, 10))); });
  app.get(["/api/host/roster.csv", "/api/host/roster.json", "/api/host/roster"], (req, res) => { const u = ownerOnly(req, res); if (!u) return; const S = scopeStore(store, u.ws), root = ID.test(String(req.query.series || "")) ? String(req.query.series) : "";
    const ev = root ? S.get("events/" + root)?.data : null, rootId = ev?.seriesId || root, rows = rosterOf(S, { root: rootId, followers: C.followersOf?.(u.ws) || [], canEmail: (e) => X.canEmail?.(e) });
    const name = clean(ev ? ev.pubTitle || ev.name : C.profileOf?.(u.ws)?.name || "guests", 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "guests";
    res.set("Cache-Control", "private, no-store");
    if (/\.csv$/.test(req.path)) return res.type("text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="${name}-roster.csv"`).send(rosterCsv(rows));
    res.set("Content-Disposition", `${/\.json$/.test(req.path) ? "attachment" : "inline"}; filename="${name}-roster.json"`).json({ group: ev ? title(ev) : "All your guests", series: rootId || null, exportedAt: new Date().toISOString(), hosts: ev ? hostOf(u.ws, ev) : [], consent: { emails_ok: "Has an email and hasn't unsubscribed or turned off emails", texts_ok: "Gave a phone, said yes to texts and didn't reply STOP", no_shows: "Times they replied I'm in and didn't come", shown_to_guests: "Chose to show their name to other guests", follows_you: "Follows your page" }, people: rows }); });

  // ---------- Same table next time? ----------
  const againLink = (origin, id, rid, code) => `${origin}/again/${encodeURIComponent(id)}?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(code)}`;
  /** The next date of this event's series that guests can reply to (made), or null. */
  const nextMade = (S, id, ev, today) => seriesSiblings(S, id, ev).filter((x) => x.data.date > ev.date && x.data.date >= today && !x.data.cancelled).sort((a, b) => a.data.date.localeCompare(b.data.date))[0] || null;
  /** Reply I'm in to `nid` for the person on reply `r` (or move their reply there to I'm in), through the same rules as
   *  their own I'm in (serverReply in server/app.js): "in", "requested" (ask to join), "waitlist", "order" (a pre-order:
   *  nothing is written, they pick what they want), or "already". */
  async function replyFor(ws, S, nid, nev, r, { gkey = "", origin = "", hostLine = null } = {}) {
    const k = replyKey(r), mine = latestReplies(S, nid).find((x) => x.k === k && k);
    if (mine?.r.response === "going") return { state: "already", rid: mine.id, code: mine.r.code };
    if (nev.preorder || !serverReply) return { state: nev.preorder ? "order" : "gone", rid: mine?.id || "", code: mine?.r.code || "" };
    const base = { name: clean(r.name, 80), ...(r.email ? { email: lc(r.email) } : {}), ...(r.phone ? { phone: clean(r.phone, 30) } : {}), source: "guest", via: "again", showMe: r.showMe !== false, ...(r.smsOk === false ? { smsOk: false } : r.smsOk === true ? { smsOk: true } : {}), ...(gkey ? { _k: gkey } : r._k ? { _k: r._k } : {}) };
    const R = await serverReply(ws, { eventId: nid, rid: mine?.id || null, base, patch: { via: "again" }, origin, hostLine });
    return { ...R, state: R.state === "going" ? "in" : R.state };
  }
  const againLine = (st, t, d) => st === "order" ? `The next ${t} is up (${d}). Open your invite to order.` : st === "requested" ? `The next ${t} is up (${d}). You asked to join; the host lets each guest in.` : st === "waitlist" ? `The next ${t} is up (${d}). It's full, so you're on the waitlist.` : `The next ${t} is up: ${d}. You're in, like you asked.`;
  async function runSameTable({ now = Date.now(), workspaces = null, origin = process.env.ENCORE_PUBLIC_URL || "" } = {}) {
    const out = { asked: 0, emailed: 0, inbox: 0, converted: 0, events: [] };
    for (const ws of workspaces || allWorkspaceIds()) { if (ws === DEFAULT_WS || isDemo(ws)) continue; const S = scopeStore(store, ws);
      for (const d of S.list("events")) { const ev = d.data || {}, id = d.id; if (ev.example || ev.sample || !ev.casual || ev.cancelled || ev.stage === "interest" || ev.autoRemind === false || ev.sameTable === false) continue;
        if (!sameTableWindow(ev, now)) continue; const t = title(ev), host = hostFirst(C, ws, ev), today = todayAt(ev, now), nx = nextMade(S, id, ev, today), row = { ws, eventId: id, asked: 0 };
        for (const x of cameTo(S, id, ev)) { if (!x.id) continue; const log = "sametable/" + id + "--" + x.id; if (S.get(log)) continue; const em = lc(x.r.email); if (!em) continue;
          let code = String(x.r.code || ""); if (!code) { code = crypto.randomBytes(5).toString("hex").toUpperCase(); try { S.update("rsvps/" + x.id, { code }); } catch { continue; } }
          S.set(log, { eventId: id, rid: x.id, at: now, channel: "pending" }); // logged first: one ask, ever
          const link = againLink(origin, id, x.id, code), when = nx ? `The next one is ${fmtDay(nx.data.date)}.` : `${host || "Your host"} hasn't set the next date yet. Tap now and you're in when it's up.`;
          const inbox = X.notify(em, { kind: "sametable", key: "sametable-" + id + "-" + x.id, text: `Same table next time? ${when}`, link: `/again/${encodeURIComponent(id)}?rid=${encodeURIComponent(x.id)}&code=${encodeURIComponent(code)}`, eventId: id }) !== false;
          const mailed = await mail(ws, ev, em, `Same table next time? ${t}`, `Hi ${first(x.r.name) || "there"},\n\nThanks for coming to ${t}${host ? ` with ${host}` : ""}.\n\nSame table next time? ${when}\nOne tap and you're in: ${link}\n\nNot this time? No need to reply. This is the only note about it.\n`, origin);
          S.set(log, { eventId: id, rid: x.id, at: now, channel: mailed ? "email" : inbox ? "inbox" : "none" }); row.asked++; out.asked++; if (mailed) out.emailed++; if (inbox) out.inbox++; }
        if (row.asked) out.events.push(row); }
      // spots held for a date that wasn't made yet: reply once it is
      for (const d of S.list("againpledge").filter((x) => x.data && !x.data.doneAt)) { const P = d.data, ev = S.get("events/" + P.eventId)?.data; if (!ev) continue; const nx = nextMade(S, P.eventId, ev, todayAt(ev, now)); if (!nx) continue;
        const r = S.get("rsvps/" + P.rid)?.data; if (!r) { S.update("againpledge/" + d.id, { doneAt: now, state: "gone" }); continue; }
        S.update("againpledge/" + d.id, { doneAt: now, nextId: nx.id }); const who = first(r.name) || "A guest", t = title(nx.data);
        const R = await replyFor(ws, S, nx.id, nx.data, r, { origin, hostLine: (st) => (st === "going" ? `${who} is in again for ${t} (Same table next time).` : "") }); S.update("againpledge/" + d.id, { state: R.state }); out.converted++;
        const em = lc(r.email), line = againLine(R.state, t, fmtDay(nx.data.date)), subj = { order: "Order now", requested: "Asked", waitlist: "Waitlist" }[R.state] || "You're in";
        if (em && R.state !== "gone" && R.state !== "already") { X.notify(em, { kind: "sametable", key: "againin-" + nx.id + "-" + P.rid, text: line, link: `/e/${encodeURIComponent(nx.id)}`, eventId: nx.id });
          // the "You're in" or "Asked" email (with how to pay) already went from the reply itself; otherwise this one says where they landed
          if (!R.confirmEmailed) await mail(ws, nx.data, em, `${subj}: ${t}`, `Hi ${first(r.name) || "there"},\n\n${line}\n\nYour invite: ${origin}/e/${encodeURIComponent(nx.id)}\n${R.state === "order" ? "" : "\nPlans changed? Open it and tap Can't go.\n"}`, origin); } }
    }
    return out;
  }
  app.locals.tables = { runSameTable, resolveIfWith, hostTable, publicTable: (id) => { const E = evOf(id); return E ? publicTable(E, null) : null; } };
  app.get(/^\/again\/([A-Za-z0-9_-]{2,80})$/, (req, res) => { res.set("Referrer-Policy", "no-referrer"); sendStatic(res, "again.html", "<p>Page missing.</p>"); });
  app.get("/playbook", (req, res) => sendStatic(res, "playbook.html", "<p>Playbook missing.</p>"));
  app.get("/api/public/again/:eventId", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); res.set("Cache-Control", "private, no-store"); const id = clean(req.params.eventId, 80), P = proof(id, req.query.rid, req.query.code);
    if (!P) return bad(res, "This link isn't working. Open the one from your email.", 403, "not_granted"); const today = todayAt(P.ev), nx = nextMade(P.S, id, P.ev, today), pl = P.S.get("againpledge/" + id + "--" + P.rid)?.data, ag = P.S.get("sametable/" + id + "--" + P.rid)?.data;
    const mineNext = nx ? latestReplies(P.S, nx.id).find((x) => x.k && x.k === replyKey(P.r)) : null, T = tableOf(P.ev);
    res.json({ title: title(P.ev), date: P.ev.date || "", hosts: hostOf(P.ws, P.ev), name: first(P.r.name), first30: T.first30, sizeText: sizeText(T.size),
      next: nx ? { id: nx.id, date: nx.data.date, startTime: nx.data.startTime || "", title: title(nx.data), response: mineNext?.r.response || "" } : null, pledged: !!pl && !pl.doneAt, tapped: !!ag?.tappedAt,
      repeats: !!P.ev.repeat || !!P.ev.seriesId }); });
  app.post("/api/public/again/:eventId", small, async (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, id = clean(req.params.eventId, 80), P = proof(id, b.rid, b.code);
    if (!P) return bad(res, "This link isn't working. Open the one from your email.", 403, "not_granted"); if (!["going"].includes(P.r.response)) return bad(res, "This is for guests who came.", 403, "not_granted");
    const now = Date.now(), today = todayAt(P.ev), nx = nextMade(P.S, id, P.ev, today), log = "sametable/" + id + "--" + P.rid, gk = clean(req.get("x-encore-key"), 64);
    try { if (P.S.get(log)) P.S.update(log, { tappedAt: now }); else P.S.set(log, { eventId: id, rid: P.rid, at: now, channel: "page", tappedAt: now }); } catch {}
    const owner = ownerEmail(P.ws), who = first(P.r.name) || "A guest", t = title(P.ev);
    if (nx) { const t2 = title(nx.data), R = await replyFor(P.ws, P.S, nx.id, nx.data, P.r, { gkey: gk, origin: publicOrigin(req), hostLine: (st) => (st === "going" ? `${who} is in again for ${t2} (Same table next time).` : "") }); try { P.S.update(log, { state: R.state, nextId: nx.id }); } catch {}
      // the host hears through the reply itself (their bell, and an email for an ask to join), like any guest's reply
      return res.json({ ok: true, state: R.state, next: { id: nx.id, date: nx.data.date, startTime: nx.data.startTime || "", title: title(nx.data) }, rid: R.rid, code: R.code, name: clean(P.r.name, 80) }); }
    P.S.set("againpledge/" + id + "--" + P.rid, { eventId: id, rid: P.rid, at: now }); try { P.S.update(log, { state: "pledged" }); } catch {}
    if (owner) X.notify(owner, { kind: "reply", key: `again-pledge-${id}-${P.rid}`, text: `${who} wants the same table next time (${t}). They're in once you set the next date.`, link: `/?app=1&open=${encodeURIComponent(id)}#studio`, eventId: id });
    res.json({ ok: true, state: "pledged" }); });

  // ---------- host roundtables: hosts who list an event as a roundtable for other hosts ----------
  app.get("/api/public/roundtables", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const out = [], today = new Date().toISOString().slice(0, 10);
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS || isDemo(ws)) continue; const h = C.profileOf?.(ws); for (const d of scopeStore(store, ws).list("events")) { const e = d.data; if (!e || e.hostRoundtable !== true || e.cancelled || e.example || !e.published || closed(e) || !ISO.test(e.date || "") || e.date < today) continue;
      out.push({ id: d.id, title: title(e), date: e.date, startTime: HHMM.test(e.startTime || "") ? e.startTime : "", place: clean(e.hood || e.city, 60), host: h?.handle ? { handle: h.handle, name: clean(h.name, 60) } : null, url: `/e/${encodeURIComponent(d.id)}`, first30: tableOf(e).first30 }); } }
    res.set("Cache-Control", "public, max-age=120").json({ roundtables: out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12) }); });

  if (jobs) { const tick = () => runSameTable().catch((e) => console.warn("[tables]", e?.message || e)); const t = setInterval(tick, 3600e3); t.unref?.(); const f = setTimeout(tick, 150e3); f.unref?.(); app.locals.tablesJob = { stop: () => { clearInterval(t); clearTimeout(f); }, run: tick }; }
  return app.locals.tables;
}
