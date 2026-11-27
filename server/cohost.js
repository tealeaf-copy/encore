// Potto as a co-host, before the event. Four moments, each one tap to use and easy to ignore (public/cohost.js and
// /cohost/<event>, public/cohost.html):
//
// 1. "Here's your night": POST /api/cohost/night { text } reads one sentence into a plan (the same reading as
//    public/cohost.js nightFromSentence, which also runs on /start for people without an account). With the model on,
//    it may tidy the title and the note only; every fact (day, time, spots, place) comes from the words or is marked
//    as a suggestion, and nothing says booked. Potto answers the same sentence in Ask Potto with a link that opens the
//    canvas with the card (pottoAnswer, hooked in server/potto.js).
// 2. A time that works, no poll: GET /api/cohost/:id/times. Up to three times that suit most of the people on this
//    event, each with who can't make it ("Sat, Dec 5, 7pm: everyone but Sam"), and "no info yet" for people with no
//    signal. Signals, all from the host's own workspace (what the host already sees): replies to the host's past events
//    (the weekday they came, the ones they declined), what a reply or the host's own contact note says about days
//    ("can't do weekends", "not Fridays"), dates they picked in the host's date polls, and being in for another of the
//    host's events that day. Another host's events, replies or notes are never read, and reasons are never shown, only
//    first names. With too little to go on it offers a three-date poll instead (the interest stage the app already has).
// 3. A line per friend: GET /api/cohost/:id/lines drafts a short, different line for each person on the invite list
//    who hasn't been sent it yet, from their own history with this host only (the last event they came to, what they
//    brought, kudos they sent). No history: the plain invite. Each line names only its own person. Nothing is sent
//    here: POST /api/cohost/:id/lines/send sends what the host saw and edited, through the invite plan's own send
//    (server/invites.js reads the line for each person in its email and bell).
// 4. The "nobody's replied" rescue: two days before an event with few replies (under half the spots filled, or under 2
//    in), Potto tells the host once: the bell, and a text when they turned on Potto by text (server/pottotext.js
//    enqueue keeps its own opt-in and quiet hours). It respects the host's nudge settings (the master switch and
//    "Before an event") and quiet hours (server/hostloop.js), and goes once per event. The page offers a better time
//    (from 2) or a friendlier reminder, each one tap, never automatic: POST /api/cohost/:id/rescue/remind sends the
//    reminder the host read to the people who haven't replied (the plan's own remind, with its limits).
//
// Measured with PostHog (server/posthog.js): cohost_* events with counts, a kind word and booleans only.
// Storage: system/cohost-<ws> { rescued: { <eventId>: ms } }.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { complete, isFake, aiMode, parseJsonLoose } from "./ai.js";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { seatsOf } from "./social.js";
import { keyFor, idOf } from "./people.js";
import { todayIn, eventTz, tzOk } from "./tz.js";
import { inQuiet, LOOP } from "./hostloop.js";
import { notify as inboxNotify } from "./inbox.js";
import { capture, EVENTS } from "./posthog.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const require = createRequire(import.meta.url);
// the same sentence reading the page uses, and the illustration set for the cover
let EA = null; try { const sb = { window: {}, document: { head: { appendChild() {} }, createElement: () => ({ style: {} }), getElementById: () => null, querySelector: () => null } }; sb.window.document = sb.document; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "eventart.js"), "utf8"), sb); EA = sb.window.EventArt || null; } catch {}
require("../public/cohost.js"); const PC = globalThis.PLCohost;

export const MARKS = ["cohost_night_shown", "cohost_night_applied", "cohost_night_dismissed", "cohost_times_shown", "cohost_time_applied", "cohost_poll_started", "cohost_lines_drafted", "cohost_lines_sent", "cohost_rescue_sent", "cohost_rescue_opened", "cohost_rescue_acted"];
for (const m of MARKS) EVENTS.add(m); // privacy-safe moments: the allow-list in server/posthog.js still cleans every property

const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const ID = /^[A-Za-z0-9_-]{1,80}$/, ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdOf = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
const WDN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const titleOf = (e) => clean(e?.pubTitle || e?.name, 80) || "your event";
export const slotLabel = (date, time) => [PC.dateLabel(date), PC.timeLabel(time)].filter(Boolean).join(", ");
const list = (names) => names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// ---------------------------------------------------------------- 1. the sentence
/** The plan for a sentence, or null. Pure apart from the illustration set. */
export function nightOf(text, now = new Date()) { return PC.nightFromSentence(text, now, { art: EA }); }
const TITLE_OK = (s) => typeof s === "string" && s.trim().length >= 3 && s.length <= 80 && !/https?:|@|\bbook(ed|ing)?\b|\breserv/i.test(s);
/** The model may tidy the title and the note; the facts stay the plan's. Fake mode runs the same checks on the rules' text. */
export async function polishNight(plan) {
  if (!plan || aiMode() === "missing_key") return plan;
  try { const raw = isFake() ? JSON.stringify({ title: plan.title, note: plan.note }) : (await complete({ prompt: `POTTO-COHOST-NIGHT
You are Potto, a smart, humble, fun friend who helps a host plan. Tidy this plan's title (a short name for the night, no date) and write a short note the host can send with the invite link (under 220 characters, warm and plain, first person as the host, no emoji, no em dashes).
Use only these facts. Never add a place, a booking, a dish, a price or anyone's name. Say "spots", not "seats".
<plan>${JSON.stringify({ title: plan.title, kind: plan.kindLabel, day: PC.dateLabel(plan.date), time: PC.timeLabel(plan.startTime), spots: plan.headcount, place: plan.place || null })}</plan>
Reply with only JSON: {"title": string, "note": string}`, effort: "low" })).text;
    const j = parseJsonLoose(raw), out = { ...plan };
    if (TITLE_OK(j?.title)) out.title = clean(j.title, 80);
    const n = clean(j?.note, 300).replace(/\u2014/g, ", ");
    // a note that names a different day, a booking or a number we didn't give is dropped for the plain one
    const nums = (n.match(/\d+/g) || []).filter((x) => ![String(plan.headcount), ...String(PC.dateLabel(plan.date)).match(/\d+/g) || [], ...String(PC.timeLabel(plan.startTime)).match(/\d+/g) || []].includes(x));
    if (n.length >= 20 && !nums.length && !/\bbook(ed|ing)?\b|\breserv|https?:/i.test(n)) out.note = n;
    return out; } catch { return plan; }
}

// ---------------------------------------------------------------- 2. signals and times
/** What a few words say about days. Pure. Returns { wd: { 0..6: true|false }, weekend, weekday, evening } (unset = no signal). */
export function readNote(text) {
  const t = lc(text), out = { wd: {} }; if (!t) return out;
  if (/\b(can'?t|cannot|can not|never|not|no)\b(?: do| make| on| doing)*\s*(?:the )?weekends?\b|\bweekends? (?:are|is) (?:hard|out|tough|busy|bad)\b|\bweekdays? only\b|\bbusy (?:on )?weekends\b/.test(t)) out.weekend = false;
  else if (/\bweekends? (?:only|are best|work best|are good|are easier)\b|\bfree (?:on )?weekends\b/.test(t)) out.weekend = true;
  if (/\b(can'?t|cannot|never|not|no)\b(?: do| make| on)*\s*weeknights?\b|\bweeknights? (?:are|is) (?:hard|out|tough|bad)\b|\bweekends? only\b/.test(t)) out.weekday = false;
  if (/\bmornings? only\b|\b(can'?t|cannot|no|not)\b(?: do| make)?\s*(?:in the )?evenings?\b|\bevenings? (?:are|is) (?:hard|out)\b/.test(t)) out.evening = false;
  for (let i = 0; i < 7; i++) { const d = WDN[i].slice(0, 3), day = `${d}[a-z]*`;
    if (new RegExp(`\\b(?:can'?t|cannot|never|not|no|busy|out)\\b(?: do| make| on| doing| every)*\\s*${day}s?\\b|\\b${day}s? (?:are|is) (?:hard|out|tough|bad|busy)\\b`).test(t)) out.wd[i] = false;
    else if (new RegExp(`\\b(?:free|good|best|works?|prefer|easiest)\\b(?: on| for me on)?\\s*${day}s?\\b|\\b${day}s? (?:are|is|work) (?:good|great|best|easy|free|fine)\\b`).test(t)) out.wd[i] = true; }
  return out;
}
/** One person's signals from the host's own workspace. book: P.build(ws) row (for the host's contact note). */
function signalsFor(S, events, R, person, eventId) {
  const key = person.key, mine = R.filter((r) => keyFor(r.email, r.phone) === key), sig = { yes: {}, no: {}, notes: [], busy: new Set(), poll: null, any: false };
  for (const r of mine) { const ev = events.get(r.eventId); if (!ev) continue;
    if (r.note) sig.notes.push(String(r.note));
    if (r.eventId === eventId) { if (Array.isArray(r.dates) && r.dates.length) sig.poll = new Set(r.dates.filter((x) => ISO.test(x))); if (["going", "no", "declined"].includes(r.response)) sig.cur = r.response; continue; }
    if (!ISO.test(ev.date || "")) continue; const wd = wdOf(ev.date);
    if (r.response === "going") { sig.yes[wd] = (sig.yes[wd] || 0) + 1; sig.busy.add(ev.date); }
    else if (r.response === "no" || r.response === "declined") sig.no[wd] = (sig.no[wd] || 0) + 1; }
  if (person.notes) sig.notes.push(String(person.notes)); // the host's own note on this contact
  const rules = sig.notes.map(readNote);
  sig.rule = (date, time) => { const wd = wdOf(date), wkend = wd === 0 || wd === 6, eve = +String(time || "19").slice(0, 2) >= 17; let v;
    for (const n of rules) { if (n.wd[wd] === false) return false; if (n.wd[wd] === true) v = true; if (wkend && n.weekend === false) return false; if (!wkend && n.weekday === false) return false; if (eve && n.evening === false) return false; if (wkend && n.weekend === true) v = v ?? true; }
    return v; };
  sig.any = !!(sig.cur || Object.keys(sig.yes).length || Object.keys(sig.no).length || sig.poll || rules.some((n) => Object.keys(n.wd).length || n.weekend != null || n.weekday != null || n.evening != null));
  return sig;
}
/** Can this person make this slot? true, false or null (no idea). */
function canMake(sig, date, time, ev) {
  if (sig.busy.has(date)) return false; // in for another of the host's events that day
  if (sig.cur && date === ev.date) return sig.cur === "going"; // their reply to this event, for its own date
  const r = sig.rule(date, time); if (r === false) return false;
  if (sig.poll && (ev.dateOptions || []).includes(date)) return sig.poll.has(date);
  if (r === true) return true; const wd = wdOf(date), wkend = wd === 0 || wd === 6;
  if (sig.yes[wd]) return true; if (sig.no[wd] && !sig.yes[wd]) return false;
  const same = [0, 1, 2, 3, 4, 5, 6].filter((d) => (d === 0 || d === 6) === wkend);
  if (same.some((d) => sig.yes[d])) return true;
  return null;
}

export function makeCohost({ store, C, X, I, P, L, T, origin = () => process.env.ENCORE_PUBLIC_URL || "", now: clock = () => Date.now() }) {
  const S0 = (ws) => scopeStore(store, ws);
  const eventOf = (ws, id) => (ID.test(String(id || "")) ? S0(ws).get("events/" + id)?.data || null : null);
  const hostTz = (ws, ev) => eventTz(ev || {}, (() => { try { return L?.facts?.(ws)?.tz || ""; } catch { return ""; } })()) || "UTC";
  const dayOf = (ws, ev, t = clock()) => todayIn(hostTz(ws, ev), t);

  /** The people on this event: the invite plan, and anyone who replied. Never the host. */
  function peopleOf(ws, id) {
    const own = lc(getWorkspace(ws)?.ownerEmail), out = new Map(); let X0 = null; try { X0 = I?.rowsOf?.(ws, id); } catch {}
    for (const x of X0?.rows || []) { if (!x.p?.key || x.p.key === own) continue; out.set(x.p.key, { key: x.p.key, id: x.p.id, name: x.p.fullName || x.p.name || "", first: first(x.p.name || x.p.fullName), notes: x.p.notes || "", status: x.status, planned: x.planned, entry: x.entry, r: x.r }); }
    const ev = eventOf(ws, id); for (const g of ev?.guests || []) { const k = keyFor(g.email, g.phone); if (!k || k === own || out.has(k) || /not invited/i.test(g.status || "")) continue; out.set(k, { key: k, id: idOf(k), name: g.name || "", first: first(g.name), notes: "", status: lc(g.status) || "invited", planned: false }); }
    return [...out.values()].filter((p) => p.first);
  }

  /** Up to three times that suit most people, who can't make each, and who we know nothing about. */
  function timesFor(ws, id, { now = clock() } = {}) {
    const ev = eventOf(ws, id); if (!ev) return null; const S = S0(ws), today = dayOf(ws, ev, now);
    const events = new Map(S.list("events").map((d) => [d.id, d.data || {}]).filter(([, e]) => !e.example && !e.sample && !e.cancelled));
    const R = S.list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId && events.has(r.eventId) && !r.deletedAccount);
    const ppl = peopleOf(ws, id).filter((p) => !/^(no|declined)$/.test(p.status || "") || p.r?.eventId === id).slice(0, 200);
    const sigs = ppl.map((p) => ({ p, s: signalsFor(S, events, R, p, id) })), known = sigs.filter((x) => x.s.any), noInfo = sigs.filter((x) => !x.s.any).map((x) => x.p.first);
    const time = HHMM.test(ev.startTime || "") ? ev.startTime : "19:00";
    const poll = (() => { const base = ev.date && ev.date > addDays(today, 2) ? ev.date : addDays(today, 7), sat = addDays(base, (6 - wdOf(base) + 7) % 7); return [sat, addDays(sat, 1), addDays(sat, 7)]; })();
    const enough = known.length >= 2 && known.length * 3 >= ppl.length;
    if (!enough) return { enough: false, people: ppl.length, known: known.length, noInfo, options: [], poll, pollLabels: poll.map((d) => PC.dateLabel(d)), time, current: ev.date || "" };
    const cand = []; for (let i = 3; i <= 24; i++) { const date = addDays(today, i); if (ev.endDate && ev.date && date === ev.date) continue; cand.push(date); }
    if (ISO.test(ev.date || "") && ev.date > today && !cand.includes(ev.date)) cand.unshift(ev.date);
    const scored = cand.map((date) => { const can = [], cant = [], unsure = [];
      for (const { p, s } of known) { const v = canMake(s, date, time, ev); (v === true ? can : v === false ? cant : unsure).push(p.first); }
      return { date, time, can: can.length, cant, unsure, current: date === ev.date, near: Math.abs(daysBetween(ev.date && ev.date > today ? ev.date : addDays(today, 7), date)) }; });
    scored.sort((a, b) => b.can - a.can || a.cant.length - b.cant.length || a.near - b.near || a.date.localeCompare(b.date)); // most people who can, then fewest who can't
    const out = [], perWd = {}; for (const x of scored) { const wd = wdOf(x.date); if ((perWd[wd] || 0) >= 2) continue; if (x.can === 0) continue; out.push(x); perWd[wd] = (perWd[wd] || 0) + 1; if (out.length >= 3) break; }
    const line = (x) => { const who = x.cant.length === 0 ? (x.unsure.length || noInfo.length ? "everyone, as far as I know" : "everyone") : x.cant.length <= 2 ? `everyone but ${list(x.cant)}` : `${list(x.cant.slice(0, 2))} and ${x.cant.length - 2} more can't`;
      return `${slotLabel(x.date, x.time)}: ${who}`; };
    const cur = scored.find((x) => x.current) || null;
    return { enough: true, people: ppl.length, known: known.length, noInfo, time, current: ev.date || "", currentCant: cur ? cur.cant.length : null,
      options: out.map((x) => ({ date: x.date, time: x.time, label: slotLabel(x.date, x.time), line: line(x), cant: x.cant, unsure: x.unsure, can: x.can, current: x.current })), poll, pollLabels: poll.map((d) => PC.dateLabel(d)) };
  }

  // ---------------------------------------------------------------- 3. a line per friend
  /** A short line for each person not yet sent the invite, from their own history with this host. Pure on the store. */
  function linesFor(ws, id, { now = clock() } = {}) {
    const ev = eventOf(ws, id); if (!ev) return null; const S = S0(ws), today = dayOf(ws, ev, now);
    const events = new Map(S.list("events").map((d) => [d.id, d.data || {}]).filter(([k, e]) => k !== id && !e.example && !e.sample && !e.cancelled && ISO.test(e.date || "") && e.date < today));
    const R = S.list("rsvps").map((d) => d.data || {}).filter((r) => events.has(r.eventId) && !r.deletedAccount), K = S.list("kudos").map((d) => d.data || {}).filter((k) => events.has(k.eventId));
    const ppl = peopleOf(ws, id).filter((p) => p.planned && p.status === "planned");
    const used = new Set();
    const items = ppl.map((p, i) => {
      const came = R.filter((r) => keyFor(r.email, r.phone) === p.key && r.response === "going" && r.noShow !== true).map((r) => ({ r, e: events.get(r.eventId) })).sort((a, b) => b.e.date.localeCompare(a.e.date));
      for (const [eid, e] of events) for (const g of e.guests || []) if (keyFor(g.email, g.phone) === p.key && /Attended/.test(g.status || "") && !came.some((c) => c.r.eventId === eid)) came.push({ r: { eventId: eid, slot: g.slot || "" }, e });
      came.sort((a, b) => b.e.date.localeCompare(a.e.date));
      const kudos = K.filter((k) => keyFor(k.email) === p.key && ((k.tags || []).length || k.love)).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      const last = came[0], lastT = last ? titleOf(last.e) : "", slot = clean(came.find((c) => c.r.slot)?.r.slot, 60), slotAt = slot ? titleOf(came.find((c) => c.r.slot).e) : "";
      const kT = kudos ? titleOf(events.get(kudos.eventId)) : "", F = p.first, here = titleOf(ev);
      // one fact from their own history, then an ending that changes from person to person
      const facts = [];
      if (slot) facts.push({ basis: "brought", says: `you brought the ${slot.toLowerCase()} to ${slotAt}` }, { basis: "brought", says: `you brought the ${slot.toLowerCase()} last time` });
      if (kudos) facts.push({ basis: "kudos", says: `thanks again for the kudos after ${kT}` });
      if (came.length >= 3) facts.push({ basis: "regular", says: `you've come to ${came.length} of mine` });
      if (last) facts.push({ basis: "last", says: `${lastT} was the last one you came to` }, { basis: "last", says: `it's been since ${lastT}` });
      const ends = [`Would love you at ${here}.`, `Come to ${here}?`, `Hope you can make ${here}.`, `${here} is next. Are you in?`];
      const opts = facts.flatMap((f, fi) => ends.map((e, k) => ({ basis: f.basis, end: (i + fi + k) % ends.length, line: `${F}, ${f.says}. ${ends[(i + fi + k) % ends.length]}` })));
      // a different line for each person: their first fact with an ending nobody else got
      let pick = opts.find((o) => !used.has(o.end)) || opts[0] || null; if (pick) { used.add(pick.end); if (used.size >= ends.length) used.clear(); }
      return { id: p.id, name: p.name, first: F, basis: pick ? pick.basis : "plain", line: pick ? pick.line : "", facts: pick ? { last: !!last, brought: !!slot, kudos: !!kudos } : {} }; });
    return { event: { id, title: titleOf(ev), date: ev.date || "" }, items };
  }
  /** Send what the host saw: each line rides on the plan's own invite send (server/invites.js). */
  async function sendLines(ws, id, rows = [], { origin: o = "" } = {}) {
    if (!I) return { error: "Invites aren't ready.", status: 503 }; const ok = new Map(); const allowed = new Set((linesFor(ws, id)?.items || []).map((x) => x.id));
    for (const r of Array.isArray(rows) ? rows.slice(0, 500) : []) { const pid = String(r?.id || ""); if (!/^[a-f0-9]{24}$/.test(pid) || !allowed.has(pid)) continue; ok.set(pid, clean(r.line, 280)); }
    if (!ok.size) return { sent: 0, skipped: 0, held: 0, personal: 0 };
    const pl = I.plan(ws, id); for (const [pid, line] of ok) { if (!pl.people[pid]) continue; if (line) pl.people[pid].line = line; else delete pl.people[pid].line; } I.save(ws, id, pl);
    const r = await I.send(ws, id, { ids: [...ok.keys()], origin: o }); return { ...r, personal: [...ok.values()].filter(Boolean).length };
  }

  // ---------------------------------------------------------------- 4. the rescue
  function goingOf(ws, id, ev) { const R = S0(ws).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id && r.response === "going" && !r.deletedAccount); return { yes: R.length, seats: R.reduce((n, r) => n + seatsOf(r, ev), 0) }; }
  const low = (ev, g) => { const spots = +ev.headcount || 0; return g.yes < 2 || (spots > 0 && g.seats * 2 < spots); };
  function draftReminder(ws, ev) { const when = [PC.dateLabel(ev.date), PC.timeLabel(ev.startTime)].filter(Boolean).join(" at ");
    return `Quick one: ${titleOf(ev)} is ${when} and I'd love to know if you can make it. No pressure either way, a reply just helps me plan.`.replace(/\s+/g, " "); }
  /** What the rescue page shows for one event. */
  function rescueFor(ws, id, { now = clock() } = {}) {
    const ev = eventOf(ws, id); if (!ev || ev.cancelled) return null; const today = dayOf(ws, ev, now), g = goingOf(ws, id, ev), spots = +ev.headcount || 0;
    let waiting = []; try { waiting = (I?.rowsOf?.(ws, id)?.rows || []).filter((x) => x.planned && ["invited", "seen"].includes(x.status)).map((x) => x.p.id); } catch {}
    const T2 = timesFor(ws, id, { now }); let better = null;
    if (T2?.enough && T2.options.length) { const curCant = T2.currentCant ?? Infinity; better = T2.options.find((o) => !o.current && o.cant.length < curCant && o.date > addDays(today, 1)) || null; }
    return { event: { id, title: titleOf(ev), date: ev.date || "", startTime: ev.startTime || "", spots, past: !!ev.date && ev.date < today }, going: g.seats, yes: g.yes, low: low(ev, g), days: ev.date ? daysBetween(today, ev.date) : null,
      better: better ? { date: better.date, time: better.time, label: better.label, line: better.line } : null, draft: draftReminder(ws, ev), waiting: waiting.length, sentAt: (store.get(rkey(ws))?.data?.rescued || {})[id] || 0 };
  }
  const rkey = (ws) => "system/cohost-" + ws;
  /** The reminder the host read, to the people who haven't replied, through the plan's remind (one a day, two an event). */
  async function remindWith(ws, id, text, { origin: o = "" } = {}) {
    if (!I) return { error: "Invites aren't ready.", status: 503 }; const msg = clean(text, 300); if (msg.length < 10) return { error: "Write a line first.", status: 400 };
    const X0 = I.rowsOf(ws, id); if (!X0) return { error: "No such event.", status: 404 }; const ids = X0.rows.filter((x) => x.planned && ["invited", "seen"].includes(x.status)).map((x) => x.p.id); if (!ids.length) return { reminded: 0, tooSoon: 0, held: 0, none: true };
    let pl = I.plan(ws, id); for (const pid of ids) if (pl.people[pid]) pl.people[pid].nudge = msg; I.save(ws, id, pl);
    try { return await I.remind(ws, id, { ids, origin: o }); } finally { pl = I.plan(ws, id); for (const pid of ids) if (pl.people[pid]) delete pl.people[pid].nudge; I.save(ws, id, pl); }
  }
  /** Which events need the rescue now, for one host. Pure on the store. */
  function rescueDue(ws, now = clock()) { const d = L?.get?.(ws), notif = d?.notif || {}, quiet = d?.quiet || LOOP.quiet; if (notif.on === false || notif.prep === false) return [];
    const done = store.get(rkey(ws))?.data?.rescued || {}, out = [];
    for (const x of S0(ws).list("events")) { const ev = x.data || {}; if (!ev || ev.example || ev.sample || ev.cancelled || ev.stage === "interest" || !ISO.test(ev.date || "") || done[x.id]) continue;
      let invited = 0; try { invited = (I?.rowsOf?.(ws, x.id)?.rows || []).filter((r) => r.planned && r.entry?.invitedAt).length; } catch {}
      if (!(ev.published || ev.discoverable || invited)) continue; const tz = hostTz(ws, ev); if (daysBetween(todayIn(tz, now), ev.date) !== 2) continue;
      if (inQuiet(now, tz, quiet)) continue; const g = goingOf(ws, x.id, ev); if (!low(ev, g)) continue; out.push({ id: x.id, ev, g, tz }); }
    return out; }
  async function runJobs(now = clock()) { let sent = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const W = getWorkspace(ws); if (!W?.ownerEmail || /@demo\.encore$/i.test(W.ownerEmail) || W.personal === false) continue;
      let due = []; try { due = rescueDue(ws, now); } catch { continue; }
      for (const r of due.slice(0, 3)) { const spots = +r.ev.headcount || 0, t = titleOf(r.ev), link = `/cohost/${encodeURIComponent(r.id)}?m=rescue`;
        const body = `${t} is in two days and ${spots ? `${r.g.seats} of ${spots} spots are filled` : `${r.g.yes === 1 ? "1 person is" : `${r.g.yes} people are`} in so far`}. I drafted a friendlier reminder${(() => { try { return rescueFor(ws, r.id, { now })?.better ? " and found a time that may suit more people" : ""; } catch { return ""; } })()}. Have a look?`;
        let ok = false; try { ok = inboxNotify(X, W.ownerEmail, { kind: "nudge", type: "note", key: "cohost-rescue-" + r.id, title: "Potto", text: body, link, eventId: r.id, actor: { name: "Potto" } }) !== false; } catch {}
        let texted = false; try { texted = !!T?.enqueue?.(W.ownerEmail, { key: "cohost-rescue-" + r.id, kind: "rescue", text: `Potto: ${body} ${(origin() || "") + link}`, eventId: r.id }, now); } catch {}
        const rec = store.get(rkey(ws))?.data || { kind: "cohost", ws, rescued: {} }; rec.rescued = { ...(rec.rescued || {}), [r.id]: now }; store.set(rkey(ws), rec); // once per event, sent or not
        if (ok || texted) { sent++; capture("cohost_rescue_sent", { ws, count: r.g.yes }); } } }
    return sent; }

  // ---------------------------------------------------------------- Potto (server/potto.js hook)
  /** A sentence that reads as a plan gets "Here's your night" with a link that opens the canvas with the card. */
  function pottoAnswer(u, message, ctx = {}) {
    const m = String(message || "").trim(); if (!ctx.me?.host && !u?.ws) return null;
    // a time for an event they already have
    if (/\b(find|pick|suggest)\b.*\b(time|date|day|night)\b|\bwhen should (?:i|we)\b|\bwhat (?:day|date|time) (?:works|suits)\b|\bwhich (?:day|date|night) (?:works|suits)\b/i.test(m)) {
      const e = (ctx.myEvents || []).find((x) => x.id === ctx.attached) || ((ctx.myEvents || []).filter((x) => x.date >= ctx.today).length === 1 ? ctx.myEvents.find((x) => x.date >= ctx.today) : null); if (!e) return null;
      const t = timesFor(u.ws, e.id); if (!t) return null; const href = `/cohost/${encodeURIComponent(e.id)}?m=time`;
      if (!t.enough) return { answer: `I don't know enough about when your people are free yet. I can set up a quick poll with three dates instead: ${list(t.pollLabels)}. Want to look?`, links: [{ label: "See the poll", href }] };
      return { answer: `For ${e.title}, ${t.options[0].line}.${t.options.length > 1 ? ` I found ${t.options.length - 1} more that could work.` : ""}${t.noInfo.length ? ` No info yet for ${list(t.noInfo.slice(0, 3))}${t.noInfo.length > 3 ? " and others" : ""}.` : ""}`, links: [{ label: "See the times", href }] }; }
    if (/\?\s*$/.test(m) && !/^(?:plan|host|make)\b/i.test(m)) return null;
    const n = nightOf(m); if (!n || n.signals < 2) return null;
    const bits = [`${n.title}`, `${slotLabel(n.date, n.startTime)}${n.dateSuggested || n.timeSuggested ? " (my suggestion)" : ""}`, `${n.headcount} spots`, n.place ? n.place : ""].filter(Boolean);
    return { answer: `Here's your night: ${bits.join(", ")}${n.cover ? `, with a ${(EA?.LABEL?.[n.cover] || n.cover).toLowerCase()} drawing for the cover` : ""}. Open it to check each part, then save. Nothing's sent or booked until you say so.`, links: [{ label: "Open your night", href: `/?app=1&new=1&night=${encodeURIComponent(m.slice(0, 200))}#studio` }], night: true };
  }
  return { nightOf, polishNight, timesFor, linesFor, sendLines, rescueFor, remindWith, rescueDue, runJobs, pottoAnswer, peopleOf };
}

export function mountCohost(app, { store, small, currentUser, C, X, sendStatic, publicOrigin = () => "" }) {
  const K = makeCohost({ store, C, X, I: app.locals.invites, P: app.locals.people, L: app.locals.hostloop, T: app.locals.pottoText });
  app.locals.cohost = K;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || !u.email || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  const mine = (req, res) => { const u = me(req, res); if (!u) return null; const id = String(req.params.id || ""); if (!ID.test(id) || !scopeStore(store, u.ws).get("events/" + id)?.data) { bad(res, "No such event.", 404, "not_found"); return null; } return { u, ws: u.ws, id }; };
  const og = (req) => { try { return publicOrigin(req) || ""; } catch { return ""; } };
  const hits = new Map(); const limited = (k, n) => { const t = Date.now(), h = (hits.get(k) || []).filter((x) => t - x < 3600e3); if (h.length >= n) return true; h.push(t); hits.set(k, h); if (hits.size > 20000) hits.clear(); return false; };

  app.get("/cohost/:id", (req, res) => { res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" }); sendStatic(res, "cohost.html", "<p>Page missing.</p>"); });
  app.post("/api/cohost/night", small, async (req, res) => { const u = me(req, res); if (!u) return; if (limited("n:" + u.ws, 120)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const today = ISO.test(String(req.body?.today || "")) ? new Date(req.body.today + "T12:00:00") : new Date();
    const plan = K.nightOf(clean(req.body?.text, 200), today); if (!plan) return res.json({ plan: null }); res.json({ plan: await K.polishNight(plan) }); });
  app.get("/api/cohost/:id/times", (req, res) => { const H = mine(req, res); if (!H) return; const t = K.timesFor(H.ws, H.id); capture("cohost_times_shown", { ws: H.ws, count: t.options.length, first: !t.enough }); res.json(t); });
  app.get("/api/cohost/:id/lines", (req, res) => { const H = mine(req, res); if (!H) return; const L0 = K.linesFor(H.ws, H.id); capture("cohost_lines_drafted", { ws: H.ws, count: L0.items.filter((x) => x.line).length, guests: L0.items.length }); res.json(L0); });
  app.post("/api/cohost/:id/lines/send", small, async (req, res) => { const H = mine(req, res); if (!H) return; if (limited("s:" + H.ws, 30)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const r = await K.sendLines(H.ws, H.id, req.body?.items, { origin: og(req) }); if (r.error) return bad(res, r.error, r.status); capture("cohost_lines_sent", { ws: H.ws, count: r.sent, guests: r.personal }); res.json({ ok: true, ...r }); });
  app.get("/api/cohost/:id/rescue", (req, res) => { const H = mine(req, res); if (!H) return; const r = K.rescueFor(H.ws, H.id); if (!r) return bad(res, "No such event.", 404, "not_found"); capture("cohost_rescue_opened", { ws: H.ws, count: r.yes }); res.json(r); });
  app.post("/api/cohost/:id/rescue/remind", small, async (req, res) => { const H = mine(req, res); if (!H) return; if (limited("r:" + H.ws, 20)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const r = await K.remindWith(H.ws, H.id, req.body?.text, { origin: og(req) }); if (r.error) return bad(res, r.error, r.status); capture("cohost_rescue_acted", { ws: H.ws, kind: "remind", count: r.reminded }); res.json({ ok: true, ...r }); });
  // what the pages measure: the moment's name, a kind word, a count and booleans (server/posthog.js cleans the rest)
  app.post("/api/cohost/mark", small, (req, res) => { const b = req.body || {}, ev = String(b.event || ""); if (!MARKS.includes(ev)) return bad(res, "Unknown moment.");
    let u = null; try { u = currentUser(req); } catch {} const ws = u?.ws && u.ws !== DEFAULT_WS ? u.ws : ""; if (limited("m:" + (ws || req.ip), 120)) return res.json({ ok: false });
    capture(ev, { ...(ws ? { ws } : {}), via: ["canvas", "start", "potto", "page"].includes(b.via) ? b.via : undefined, kind: typeof b.kind === "string" ? b.kind : undefined, count: Number.isFinite(+b.count) ? +b.count : undefined, first: typeof b.tweaked === "boolean" ? b.tweaked : undefined, signed_in: !!ws }); res.json({ ok: true }); });
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => K.runJobs().catch((e) => console.warn("[cohost]", e?.message)), 3600e3); t.unref?.(); }
  return K;
}
