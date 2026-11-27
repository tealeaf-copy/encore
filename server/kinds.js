// Event kinds, from a booked table to a weekend away to a summit. One place for the parts each scale needs, on top of
// what every event already has (the invite, replies, the plan page, the itinerary, pay links, the invite planner).
//
// - planKind on the event: dinner, drinks, game night, brunch, table, class, potluck, picnic, hack night, book club, run,
//   hike, watch party, pop-up, drop, weekend, summit or other (the host names it). Only table, drop, weekend and summit
//   carry parts of their own here; the rest set defaults on the canvas. The create canvas sets it from "What are
//   you planning?" (public/canvas.js), /start sets it from its template (server/hostloop.js draftToEvent).
// - A table (reservation): the restaurant, the time, the party size, the booking link or confirmation, a reply-by day
//   ("Reply by Thursday so I can update the booking"), and how the bill is split (even, or each pays their own). The
//   host sees a party-size meter against the replies and an "Update the reservation" nudge when the count moves away
//   from what was booked. The link and confirmation are for guests who are in.
// - A weekend away: lodging (name, area, check-in and check-out; the address only for people who are in), beds guests
//   claim, cars with seats to claim, and a shared costs ledger. The host adds costs; each is split among the people who
//   are in (or the ones the host picks). Everyone sees only the costs they're part of, and "You owe Maya $84" lines
//   with pay links. No money moves in the app.
// - A summit: an agenda with tracks and rooms, sessions with a time, track, room, speakers and a capacity, "Save to my
//   agenda" with a warning when two saved sessions overlap, a speakers list (a speaker's page is public only when the
//   speaker opted in or the host marked it public), and an optional sponsors row the brand provides, labelled as such.
// Records: the event doc holds what the host typed; trip/<eventId> holds claims, cars and costs; agenda/<eventId>
// holds each guest's saved sessions. Guests act with their reply proof (rid + code) or their signed-in email.
import crypto from "node:crypto";
import { scopeStore, workspaceOfEvent, getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { seatsTaken } from "./social.js";
import { latestReplies } from "./tables.js";
import { payLink } from "./shop.js";
import { eventTz, todayIn } from "./tz.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/, SID = /^[a-z0-9]{1,16}$/;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const httpsOf = (u) => { u = String(u ?? "").trim(); if (!u) return ""; if (/^http:\/\//i.test(u)) u = "https://" + u.slice(7); if (!/^https:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) u = "https://" + u; return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u.slice(0, 500) : ""; };
const logoOf = (u) => { const s = String(u || "").trim(); return /^\/_blob\/[A-Za-z0-9]{20}$/.test(s) || /^\/presets\/[\w./-]{1,80}$/.test(s) ? s : httpsOf(s); };
const newId = () => crypto.randomBytes(5).toString("hex");
const dayMs = 864e5;
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * dayMs).toISOString().slice(0, 10);
const dayNo = (d) => Math.round(Date.parse(d + "T12:00:00Z") / dayMs);
const lastDayOf = (ev) => (ISO.test(ev?.endDate || "") && ISO.test(ev?.date || "") && ev.endDate > ev.date ? ev.endDate : ev?.date || "");
const short = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const weekday = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const mins = (t) => (HHMM.test(t || "") ? +t.slice(0, 2) * 60 + +t.slice(3) : null);
const hhmm = (m) => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, "0")}:${String(Math.min(m, 1439) % 60).padStart(2, "0")}`;
/** "7pm", "7:30pm". Pure. */
export const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
/** "4pm", "16:00", "4:30 pm" into "16:00"; "" for nothing; null when it can't be read. Pure. */
export function timeOf(v) { const s = String(v ?? "").trim().toLowerCase().replace(/\./g, ""); if (!s) return ""; const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s); if (!m) return null;
  let h = +m[1]; const mi = +(m[2] || 0); if (mi > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return null; if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0; return hhmm(h * 60 + mi); }
/** "$84", "$84.50". Pure. */
export const money = (cents) => { const c = Math.round(+cents || 0), a = Math.abs(c); return (c < 0 ? "-" : "") + "$" + (a % 100 ? (a / 100).toFixed(2) : String(a / 100)); };
/** Dollars as the host typed them ("84", "$84.50", "1,200") into cents; 0 when it isn't a sum. Pure. */
export const centsOf = (v) => { if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= 1e6 ? Math.round(v * 100) : 0; const m = String(v ?? "").replace(/[,\s$]/g, "").match(/^(\d{1,6})(\.\d{1,2})?$/); return m ? Math.round(+(m[1] + (m[2] || "")) * 100) : 0; };

// ================= the kinds =================
export const PLAN_KINDS = ["dinner", "drinks", "game", "brunch", "table", "class", "potluck", "picnic", "hack", "book", "run", "hike", "watch", "popup", "drop", "weekend", "summit", "other"];
/** What the host is planning: their own pick, else read from what the event has. Pure. */
export function planKindOf(ev) {
  if (PLAN_KINDS.includes(ev?.planKind)) return ev.planKind;
  if (ev?.drop || ev?.preorder) return "drop";
  if (clean(ev?.reservation?.restaurant, 80)) return "table";
  if (["summit", "conference"].includes(ev?.kind) || (ev?.agenda?.sessions || []).length) return "summit";
  if ((ev?.lodging && (ev.lodging.name || ev.lodging.address)) || (ev?.beds || []).length) return "weekend";
  return "";
}

// ================= a table for friends =================
/** The host's booking, cleaned. Pure. */
export function cleanReservation(raw = {}, ev = {}) {
  const r = raw && typeof raw === "object" ? raw : {}, t = timeOf(r.time), ht = timeOf(r.holdTime);
  const party = Math.max(0, Math.min(40, Math.round(+r.party || 0)));
  const out = { restaurant: clean(r.restaurant, 80), time: t || (HHMM.test(ev.startTime || "") ? ev.startTime : ""), party, link: httpsOf(r.link), confirmation: clean(r.confirmation, 40),
    holdUntil: ISO.test(r.holdUntil || "") ? r.holdUntil : "", holdTime: ht || "", split: ["even", "own"].includes(r.split) ? r.split : "", bill: centsOf(r.bill), phone: clean(r.phone, 30).replace(/[^\d+()\s-]/g, "") };
  if (Number.isInteger(r.confirmedFor) && r.confirmedFor >= 0) out.confirmedFor = Math.min(60, r.confirmedFor);
  if (Number.isInteger(r.lastCount) && r.lastCount >= 0) out.lastCount = Math.min(60, r.lastCount);
  if (ISO.test(ev.date || "") && out.holdUntil > ev.date) out.holdUntil = ev.date;
  return out;
}
/** How many are at the table: the host and everyone who is in (with their plus-ones). Pure apart from seatsTaken. */
export const tableCount = (ev, docs) => 1 + Math.round(seatsTaken(ev, docs));
const words = (n) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
/**
 * The party-size meter: where the count is against the booking, the line the host reads and, when the count moved
 * away from what was booked, a nudge to update the reservation. Pure.
 */
export function tableMeter(res, count, { today = "", date = "" } = {}) {
  const party = +res?.party || 0, booked = Number.isInteger(res?.confirmedFor) ? res.confirmedFor : party;
  if (!party) return { count, party: 0, state: "open", line: `${count} at the table so far. Add the party size you booked.`, nudge: "", pct: 0 };
  const over = Math.max(0, count - party), open = Math.max(0, party - count), passed = !!res.holdUntil && !!today && today > res.holdUntil, near = !!date && !!today && today >= addDays(date, -1);
  let state = "under", line = `You're at ${count} of ${party}. ${open === 1 ? "One seat" : words(open).replace(/^./, (c) => c.toUpperCase()) + " seats"} open.`, nudge = "";
  if (count === party) { state = "full"; line = `You're at ${count} of ${party}. The table is full.`; }
  if (over) { state = "over"; line = `You're at ${count} of ${party}. Call to add ${over === 1 ? "a seat" : words(over) + " seats"}?`; nudge = "Update the reservation"; }
  else if (open && (passed || near)) { line = `You're at ${count} of ${party}. ${passed ? "The reply-by day has passed." : "It's almost time."} Call to make it a table for ${count}?`; nudge = "Update the reservation"; }
  if (!nudge && booked !== party) nudge = "Update the reservation";
  return { count, party, over, open, state, line, nudge, pct: Math.min(100, Math.round((count / party) * 100)) };
}
/** "Reply by Thursday so I can update the booking." in the event's own days. Pure. */
export function holdLine(res, today = "") {
  const d = res?.holdUntil; if (!ISO.test(d || "")) return "";
  const t = res.holdTime ? ` at ${clock(res.holdTime)}` : "";
  if (today && today > d) return "The reply-by day has passed. Ask in the chat if there's still room.";
  const n = today ? dayNo(d) - dayNo(today) : 99, when = n === 0 ? "today" : n === 1 ? "tomorrow" : n > 1 && n < 7 ? weekday(d) : short(d);
  return `Reply by ${when}${t} so I can update the booking.`;
}
/** Even shares of a sum: n parts in cents that add up exactly; the first ones carry the odd cents. Pure. */
export function splitCents(cents, n) { cents = Math.max(0, Math.round(+cents || 0)); n = Math.max(0, Math.floor(+n || 0)); if (!n) return [];
  const base = Math.floor(cents / n), odd = cents - base * n; return Array.from({ length: n }, (_, i) => base + (i < odd ? 1 : 0)); }
/** After the dinner: an even split ("$42 each, split 6 ways") or each pays their own, with the host's pay link. Pure. */
export function billSplit(res, count, { payUrl = "", host = "the host", note = "", forHost = false } = {}) {
  if (!res?.split) return null;
  if (res.split === "own") return { mode: "own", line: "Each pays their own. Ask for separate checks when you sit down." };
  if (!res.bill) return { mode: "even", line: `We'll split it evenly. ${forHost ? "Add the total after the dinner and everyone sees their share." : `${host} adds the total after.`}` };
  const shares = splitCents(res.bill, Math.max(1, count)), each = shares[shares.length - 1], top = shares[0];
  const amount = top === each ? money(each) : `${money(each)} to ${money(top)}`;
  const link = !forHost && payUrl ? payLink(payUrl, top, note) : "";
  return { mode: "even", each: top, line: `${amount} each, split ${count} ${count === 1 ? "way" : "ways"} from ${money(res.bill)}.`, pay: link ? { href: link, label: `Pay ${host} ${money(top)}` } : null };
}

// ================= a weekend away =================
/** Where everyone sleeps: the name, the area, check-in and check-out, and the address (for people who are in). Pure. */
export function cleanLodging(raw = {}) { const r = raw && typeof raw === "object" ? raw : {};
  return { name: clean(r.name, 80), area: clean(r.area, 60), checkIn: timeOf(r.checkIn) || "", checkOut: timeOf(r.checkOut) || "", address: clean(r.address, 200), link: httpsOf(r.link), notes: clean(r.notes, 300) }; }
/** Beds: [{ id, room, label, sleeps }], at most 30. Ids stay put across edits. Pure. */
export function cleanBeds(raw) { const out = [], seen = new Set();
  for (const b of Array.isArray(raw) ? raw : []) { const room = clean(b?.room, 40), label = clean(b?.label, 40); if (!room && !label) continue;
    let id = SID.test(String(b?.id || "")) && !seen.has(b.id) ? b.id : newId(); seen.add(id); out.push({ id, room: room || "Room", label: label || "Bed", sleeps: Math.max(1, Math.min(4, Math.round(+b?.sleeps || 1))) }); if (out.length >= 30) break; }
  return out; }

/** Who is in on a trip, in a steady order: the host first, then guests in the order they said they're in. */
export function peopleIn(S, eventId, hostName = "") {
  const L = latestReplies(S, eventId).filter((x) => x.r.response === "going" && !x.r.pairOf).sort((a, b) => (a.r.createdAt || 0) - (b.r.createdAt || 0) || a.id.localeCompare(b.id));
  return [{ pid: "host", name: first(hostName) || "Host", host: true }, ...L.map((x) => ({ pid: x.id, name: first(x.r.name) || "A guest" }))];
}
/**
 * The shared costs, settled pair by pair: each person included in a cost owes the person who paid it their share, and
 * what two people owe each other nets out. Shares are even, in cents that add up exactly (the first people in the
 * list carry the odd cents). A cost's people default to everyone who is in; anyone no longer in drops out of it.
 * Returns { costs: [{ id, label, cents, paidBy, among, shares }], owe: [{ from, to, cents }], totals: { pid: { paid, share } } }. Pure.
 */
export function ledgerOf(costs, people) {
  const order = people.map((p) => p.pid), inSet = new Set(order), totals = {}, pair = new Map(), out = [];
  for (const p of order) totals[p] = { paid: 0, share: 0 };
  for (const c of Array.isArray(costs) ? costs : []) { const cents = Math.round(+c?.cents || 0); if (!(cents > 0) || !inSet.has(c.paidBy)) continue;
    const want = Array.isArray(c.among) && c.among.length ? new Set(c.among) : null, among = order.filter((p) => (want ? want.has(p) : true));
    const who = among.length ? among : [c.paidBy], parts = splitCents(cents, who.length), shares = {};
    who.forEach((p, i) => { shares[p] = parts[i]; totals[p].share += parts[i]; if (p !== c.paidBy) { const k = p + ">" + c.paidBy; pair.set(k, (pair.get(k) || 0) + parts[i]); } });
    totals[c.paidBy].paid += cents; out.push({ id: c.id, label: c.label, cents, paidBy: c.paidBy, among: who, shares, everyone: !want }); }
  const owe = [], done = new Set();
  for (const [k, v] of pair) { if (done.has(k)) continue; const [a, b] = k.split(">"), back = pair.get(b + ">" + a) || 0; done.add(k); done.add(b + ">" + a);
    const net = v - back; if (net > 0) owe.push({ from: a, to: b, cents: net }); else if (net < 0) owe.push({ from: b, to: a, cents: -net }); }
  owe.sort((x, y) => order.indexOf(x.from) - order.indexOf(y.from) || order.indexOf(x.to) - order.indexOf(y.to));
  return { costs: out, owe, totals };
}
/** The ledger one person may see: only the costs they're part of (paid or share), and only the lines that are theirs. The host sees all of it. Pure. */
export function ledgerFor(L, pid, { host = false } = {}) {
  if (host) return L;
  const costs = L.costs.filter((c) => c.paidBy === pid || c.among.includes(pid)).map((c) => ({ ...c, shares: { [pid]: c.shares[pid] || 0 }, among: c.among.includes(pid) ? [pid] : [], count: c.among.length }));
  return { costs, owe: L.owe.filter((o) => o.from === pid || o.to === pid), totals: { [pid]: L.totals[pid] || { paid: 0, share: 0 } } };
}
/** "You owe Maya $84", "Sam owes you $40". Pure. */
export function oweLine(o, pid, nameOf) { const n = (p) => nameOf(p) || "Someone"; return o.from === pid ? `You owe ${n(o.to)} ${money(o.cents)}` : o.to === pid ? `${n(o.from)} owes you ${money(o.cents)}` : `${n(o.from)} owes ${n(o.to)} ${money(o.cents)}`; }

/** A bed claim: one bed each, and no more people than the bed sleeps. Returns an error sentence, or "". Mutates rec. Pure. */
export function claimBed(rec, beds, pid, bedId, on = true) {
  rec.beds = rec.beds && typeof rec.beds === "object" ? rec.beds : {};
  for (const k of Object.keys(rec.beds)) rec.beds[k] = (rec.beds[k] || []).filter((p) => p !== pid || (on && k === bedId));
  if (!on) return "";
  const b = beds.find((x) => x.id === bedId); if (!b) return "That bed isn't on the list anymore.";
  const L = rec.beds[bedId] || []; if (L.includes(pid)) return "";
  if (L.length >= b.sleeps) return b.sleeps === 1 ? "Someone just took that bed. Pick another?" : "That bed is full now. Pick another?";
  rec.beds[bedId] = [...L, pid]; return "";
}
/** Cars: a driver offers seats, others take one each. Returns an error sentence, or "". Mutates rec. Pure. */
export function carAction(rec, pid, b = {}) {
  rec.cars = Array.isArray(rec.cars) ? rec.cars : [];
  const mine = rec.cars.find((c) => c.driver === pid), act = String(b.action || "");
  if (act === "drive") { const seats = Math.max(1, Math.min(8, Math.round(+b.seats || 3))), note = clean(b.note, 80);
    rec.cars.forEach((c) => (c.riders = (c.riders || []).filter((p) => p !== pid)));
    if (mine) { if ((mine.riders || []).length > seats) return `${mine.riders.length} people already have a seat. Keep at least ${mine.riders.length}.`; mine.seats = seats; mine.note = note; return ""; }
    if (rec.cars.length >= 12) return "That's a lot of cars. Twelve is the most."; rec.cars.push({ id: newId(), driver: pid, seats, note, riders: [] }); return ""; }
  if (act === "stop") { if (!mine) return "You're not driving."; rec.cars = rec.cars.filter((c) => c !== mine); return ""; }
  if (act === "leave") { rec.cars.forEach((c) => (c.riders = (c.riders || []).filter((p) => p !== pid))); return ""; }
  if (act === "ride") { const car = rec.cars.find((c) => c.id === String(b.car || "")); if (!car) return "That car isn't going anymore.";
    if (car.driver === pid) return "That's your car."; if (mine) return "You're driving. Stop driving first to ride with someone.";
    if ((car.riders || []).includes(pid)) return "";
    if ((car.riders || []).length >= car.seats) return "Someone just took the last seat. Try another car?";
    rec.cars.forEach((c) => (c.riders = (c.riders || []).filter((p) => p !== pid))); car.riders = [...(car.riders || []), pid]; return ""; }
  return "Pick drive, ride or leave.";
}
/** A cost the host adds: a label, a sum, who paid and who it's split among. Returns { cost } or { error }. Pure. */
export function cleanCost(b = {}, people) {
  const label = clean(b.label, 60), cents = centsOf(b.amount ?? (b.cents != null ? +b.cents / 100 : "")), ids = new Set(people.map((p) => p.pid));
  if (!label) return { error: "Say what it was for, like Groceries." }; if (!cents) return { error: "Add the amount, like 84 or 84.50." };
  const paidBy = ids.has(b.paidBy) ? b.paidBy : "host", among = Array.isArray(b.among) ? [...new Set(b.among.map(String))].filter((p) => ids.has(p)) : [];
  return { cost: { id: newId(), label, cents, paidBy, among, at: Date.now() } };
}

// ================= a summit =================
const SESSION_MIN = 45;
/** The agenda as the host typed it: tracks, rooms with a capacity, and sessions checked against the event's days. Returns { agenda } or { error }. Pure. */
export function cleanAgenda(raw = {}, ev = {}, speakers = []) {
  const r = raw && typeof raw === "object" ? raw : {}, uniq = (L) => L.filter((x, i, a) => x && a.findIndex((y) => lc(y) === lc(x)) === i);
  const tracks = uniq((Array.isArray(r.tracks) ? r.tracks : String(r.tracks || "").split(/\n|,/)).map((t) => clean(typeof t === "object" ? t?.name : t, 30))).slice(0, 8);
  const rooms = []; for (const x of Array.isArray(r.rooms) ? r.rooms : []) { const name = clean(x?.name ?? x, 40); if (!name || rooms.some((y) => lc(y.name) === lc(name))) continue; rooms.push({ name, capacity: Math.max(0, Math.min(5000, Math.round(+x?.capacity || 0))) }); if (rooms.length >= 16) break; }
  if (!ISO.test(ev.date || "")) return (Array.isArray(r.sessions) && r.sessions.length) ? { error: "Pick the date first, then lay out the agenda." } : { agenda: { tracks, rooms, sessions: [] } };
  const from = ev.date, to = lastDayOf(ev), n = dayNo(to) - dayNo(from) + 1, sp = new Set(speakers.map((s) => s.id)), sessions = [], seen = new Set();
  const list = Array.isArray(r.sessions) ? r.sessions : []; if (list.length > 120) return { error: "Keep it to 120 sessions or fewer." };
  for (const [i, x] of list.entries()) { const title = clean(x?.title, 90); if (!title && !String(x?.time ?? "").trim()) continue; if (!title) return { error: `Session ${i + 1} needs a title.` };
    let day = x?.day; if (typeof day === "number" || /^\d{1,2}$/.test(String(day ?? ""))) { const k = Math.floor(+day); if (k < 1 || k > n) return { error: `${title}: pick a day from 1 to ${n}.` }; day = addDays(from, k - 1); } else if (day == null || day === "") day = from;
    if (!ISO.test(String(day)) || day < from || day > to) return { error: `${title}: pick a day from ${short(from)} to ${short(to)}.` };
    const time = timeOf(x?.time); if (!time) return { error: `${title}: add a start time, like 10am.` };
    let end = timeOf(x?.end); if (end === null) return { error: `${title}: use an end time like 11am.` }; if (!end || mins(end) <= mins(time)) end = hhmm(mins(time) + SESSION_MIN);
    let track = clean(x?.track, 30); if (track) { const t = tracks.find((y) => lc(y) === lc(track)); if (t) track = t; else if (tracks.length < 8) tracks.push(track); else track = ""; }
    let room = clean(x?.room, 40); if (room) { const m = rooms.find((y) => lc(y.name) === lc(room)); if (m) room = m.name; else if (rooms.length < 16) rooms.push({ name: room, capacity: 0 }); else room = ""; }
    let id = SID.test(String(x?.id || "")) && !seen.has(x.id) ? x.id : newId(); seen.add(id);
    sessions.push({ id, day, time, end, title, sub: clean(x?.sub, 140), track, room, speakers: (Array.isArray(x?.speakers) ? x.speakers : []).map(String).filter((s) => sp.has(s)).slice(0, 6), capacity: Math.max(0, Math.min(5000, Math.round(+x?.capacity || 0))) }); }
  sessions.sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time) || tracks.indexOf(a.track) - tracks.indexOf(b.track));
  return { agenda: { tracks, rooms, sessions } };
}
/** Two sessions overlap when they're on the same day and their times cross. Pure. */
export const overlaps = (a, b) => a.day === b.day && mins(a.time) < mins(b.end) && mins(b.time) < mins(a.end);
/** Room clashes for the host: two sessions in the same room at the same time. Pure. */
export const roomClashes = (sessions) => { const out = []; for (let i = 0; i < sessions.length; i++) for (let j = i + 1; j < sessions.length; j++) { const a = sessions[i], b = sessions[j]; if (a.room && a.room === b.room && overlaps(a, b)) out.push(`${a.title} and ${b.title} are both in ${a.room} at ${clock(a.time)}.`); } return out; };
/** A session's capacity: its own, else its room's; 0 is no limit. Pure. */
export const capOf = (s, rooms) => { const r = rooms.find((x) => x.name === s.room)?.capacity || 0; return s.capacity && r ? Math.min(s.capacity, r) : s.capacity || r || 0; };
/** The sessions a saved one overlaps, from a person's saves. Pure. */
export const conflictsOf = (sessions, saved) => { const S = sessions.filter((s) => saved.includes(s.id)), out = {}; for (const a of S) for (const b of S) if (a !== b && overlaps(a, b)) (out[a.id] = out[a.id] || []).push(b.id); return out; };
/** Speakers: [{ id, name, title, org, link, bio, photo, public, optIn }]. Pure. */
export function cleanSpeakers(raw) { const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) { const name = clean(x?.name, 60); if (!name) continue; let id = SID.test(String(x?.id || "")) && !seen.has(x.id) ? x.id : newId(); seen.add(id);
    out.push({ id, name, title: clean(x?.title, 80), org: clean(x?.org, 60), link: httpsOf(x?.link), bio: clean(x?.bio, 400), photo: logoOf(x?.photo), public: !!x?.public, optIn: !!x?.optIn }); if (out.length >= 60) break; }
  return out; }
/** A speaker's page is public only when they opted in or the host marked them public. Pure. */
export const speakerPublic = (s) => !!(s && (s.public || s.optIn));
/** Sponsors the brand provides: a name, a logo and a link, at most 12. Pure. */
export function cleanSponsors(raw) { return (Array.isArray(raw) ? raw : []).map((x) => ({ name: clean(x?.name, 40), logo: logoOf(x?.logo), url: httpsOf(x?.url) })).filter((x) => x.name).slice(0, 12); }
/** What a speaker reads as on the agenda for this viewer: a public speaker everywhere, the others only to guests who are in and the host. Pure. */
export function speakerFor(s, { inn = false, host = false, eventId = "" } = {}) { if (!s) return null; const pub = speakerPublic(s); if (!pub && !inn && !host) return null;
  return { id: s.id, name: s.name, title: s.title, org: s.org, ...(pub ? { href: `/speakers/${encodeURIComponent(eventId)}/${encodeURIComponent(s.id)}`, link: s.link } : {}), ...(host ? { public: s.public, optIn: s.optIn, link: s.link, bio: s.bio } : {}) }; }

// ================= the store =================
export function makeKinds({ store, C = {}, X = {} } = {}) {
  const profile = (ws) => { try { return C.profileOf?.(ws) || null; } catch { return null; } };
  const hostNameOf = (ws, ev) => clean(profile(ws)?.name || ev?.hostName || getDbUser(getWorkspace(ws)?.ownerEmail || "")?.name || "", 60);
  const tripRec = (S, id) => ({ beds: {}, cars: [], costs: [], payUrls: {}, ...(S.get("trip/" + id)?.data || {}) });
  const agendaRec = (S, id) => ({ saves: {}, ...(S.get("agenda/" + id)?.data || {}) });
  const rsvpsOf = (S, id) => S.list("rsvps").filter((d) => d.data?.eventId === id);

  /** The table's meter for the host, from the replies as they are now. */
  function tableNow(S, id, ev) { const res = cleanReservation(ev.reservation, ev), count = tableCount(ev, rsvpsOf(S, id)), today = todayIn(eventTz(ev));
    return { res, count, meter: tableMeter(res, count, { today, date: ev.date }) }; }

  /**
   * Everything this viewer may see of the event's kind. V: { ws, S, ev, isHost, r, rid } (plans' viewerOf).
   * Guests who are in see the exact parts (the booking link, the address); everyone else sees the area and the
   * shape. Ledger lines only for the people in them.
   */
  function viewOf(id, V) {
    if (!V?.ev) return null; const { ws, S, ev, isHost } = V, kind = planKindOf(ev); if (!kind) return null;
    const inn = isHost || V.r?.response === "going", pid = isHost ? "host" : inn ? V.rid : "", hostName = hostNameOf(ws, ev), hostFirst = first(hostName) || "the host", today = todayIn(eventTz(ev));
    const out = { kind, you: { pid, in: inn, host: isHost } };
    if (kind === "table" && ev.reservation) { const { res, count, meter } = tableNow(S, id, ev);
      out.table = { restaurant: res.restaurant, time: res.time, party: res.party, hold: holdLine(res, today), split: billSplit(res, count, { payUrl: httpsOf(ev.payLink || ev.payUrl), host: hostFirst, note: clean(ev.pubTitle || ev.name, 60), forHost: isHost }),
        ...(inn ? { link: res.link, confirmation: res.confirmation, address: clean(ev.venueAddr, 200), phone: res.phone } : {}),
        ...(isHost ? { meter, payUrl: httpsOf(ev.payLink || ev.payUrl), holdUntil: res.holdUntil, holdTime: res.holdTime, bill: res.bill, splitMode: res.split, confirmedFor: Number.isInteger(res.confirmedFor) ? res.confirmedFor : null } : { count }) }; }
    if (kind === "weekend") { const L = cleanLodging(ev.lodging), people = peopleIn(S, id, hostName), nameOf = (p) => people.find((x) => x.pid === p)?.name || "", T = tripRec(S, id), live = new Set(people.map((p) => p.pid));
      out.stay = { name: L.name, area: L.area || clean(ev.hood, 60), checkIn: L.checkIn, checkOut: L.checkOut, ...(inn ? { address: L.address, link: L.link, notes: L.notes } : { locked: !!(L.address || L.link) }) };
      const beds = cleanBeds(ev.beds);
      if (beds.length) { let mine = ""; const list = beds.map((b) => { const who = (T.beds?.[b.id] || []).filter((p) => live.has(p)); if (pid && who.includes(pid)) mine = b.id;
        return { id: b.id, room: b.room, label: b.label, sleeps: b.sleeps, left: Math.max(0, b.sleeps - who.length), who: inn ? who.map((p) => (p === pid ? "You" : nameOf(p))) : [] }; });
        out.beds = { mine, list, canClaim: inn && !!pid, ...(isHost ? { people: people.map((p) => ({ pid: p.pid, name: p.name })) } : {}) }; }
      if (ev.carpool !== false) { const cars = (T.cars || []).filter((c) => live.has(c.driver));
        out.cars = { canAct: inn && !!pid, driving: cars.some((c) => c.driver === pid), list: cars.map((c) => { const riders = (c.riders || []).filter((p) => live.has(p));
          return { id: c.id, seats: c.seats, left: Math.max(0, c.seats - riders.length), note: inn ? c.note : "", driver: inn ? (c.driver === pid ? "You" : nameOf(c.driver)) : "", mine: c.driver === pid, riding: !!pid && riders.includes(pid), riders: inn ? riders.map((p) => (p === pid ? "You" : nameOf(p))) : [] }; }) }; }
      if (inn) { const full = ledgerOf((T.costs || []), people), mineL = ledgerFor(full, pid, { host: isHost }), payOf = (p) => (p === "host" ? httpsOf(ev.payLink || ev.payUrl) : httpsOf(T.payUrls?.[p]));
        out.ledger = { people: isHost ? people.map((p) => ({ pid: p.pid, name: p.name })) : [], payUrl: pid && pid !== "host" ? httpsOf(T.payUrls?.[pid]) : httpsOf(ev.payLink || ev.payUrl),
          costs: mineL.costs.map((c) => ({ id: c.id, label: c.label, total: money(c.cents), cents: c.cents, paidBy: c.paidBy === pid ? "You" : nameOf(c.paidBy), share: c.shares[pid] != null && c.among.includes(pid) ? money(c.shares[pid]) : "", split: c.count || c.among.length, everyone: c.everyone, ...(isHost ? { among: c.among.map(nameOf), shares: Object.fromEntries(Object.entries(c.shares).map(([k, v]) => [nameOf(k), money(v)])) } : {}) })),
          lines: mineL.owe.filter((o) => o.from === pid || o.to === pid) /* even the host only sees the lines they are in */.map((o) => { const url = o.from === pid ? payOf(o.to) : "", note = clean(ev.pubTitle || ev.name, 60);
            return { line: oweLine(o, pid, nameOf), cents: o.cents, youOwe: o.from === pid, ...(url ? { pay: { href: payLink(url, o.cents, note), label: `Pay ${nameOf(o.to)} ${money(o.cents)}` } } : o.from === pid ? { hint: `Pay ${nameOf(o.to)} back however you two like.` } : {}) }; }),
          yours: pid ? { paid: money(mineL.totals[pid]?.paid || 0), share: money(mineL.totals[pid]?.share || 0) } : null }; } }
    if (kind === "summit") { const speakers = cleanSpeakers(ev.speakers), A = cleanAgenda(ev.agenda, ev, speakers).agenda || { tracks: [], rooms: [], sessions: [] }, R = agendaRec(S, id), live = new Set(latestReplies(S, id).filter((x) => x.r.response === "going").map((x) => x.id));
      const count = (sid) => Object.entries(R.saves || {}).filter(([p, L]) => (p === "host" || live.has(p)) && (L || []).includes(sid)).length, saved = pid ? (R.saves?.[pid] || []) : [], clash = conflictsOf(A.sessions, saved);
      const may = inn || !!ev.itineraryPublic || !!(ev.discoverable && !ev.approvalRequired);
      out.agenda = may ? { tracks: A.tracks, rooms: A.rooms.map((r) => ({ name: r.name, capacity: r.capacity })), canSave: inn && !!pid && !isHost,
        sessions: A.sessions.map((s) => { const cap = capOf(s, A.rooms), n = count(s.id); return { id: s.id, day: s.day, time: s.time, end: s.end, title: s.title, sub: s.sub, track: s.track, room: s.room, cap, taken: n, full: !!cap && n >= cap && !saved.includes(s.id), saved: saved.includes(s.id),
          conflict: (clash[s.id] || []).map((x) => A.sessions.find((y) => y.id === x)?.title).filter(Boolean), speakers: s.speakers.map((k) => speakerFor(speakers.find((y) => y.id === k), { inn, host: isHost, eventId: id })).filter(Boolean) }; }),
        ...(isHost ? { clashes: roomClashes(A.sessions) } : {}) } : { locked: true, count: A.sessions.length };
      out.speakers = speakers.map((s) => speakerFor(s, { inn, host: isHost, eventId: id })).filter(Boolean);
      out.sponsors = cleanSponsors(ev.sponsors);
      if (isHost) out.door = { checkin: `/people/event/${encodeURIComponent(id)}`, tags: `/people/event/${encodeURIComponent(id)}#tags` }; }
    return out;
  }

  /** The host's bell when the table's count moves: "You're at 7 of 6 for Dinner at Lilia. Call to add a seat?" once per count. */
  function onRsvp(ws, eventId) { try { const S = scopeStore(store, ws), ev = S.get("events/" + eventId)?.data; if (!ev || planKindOf(ev) !== "table" || !ev.reservation) return null;
    const { res, count, meter } = tableNow(S, eventId, ev), was = Number.isInteger(res.lastCount) ? res.lastCount : Number.isInteger(res.confirmedFor) ? res.confirmedFor : null; if (was === count) return null;
    S.update("events/" + eventId, { reservation: { ...ev.reservation, lastCount: count } });
    const owner = getWorkspace(ws)?.ownerEmail || "", title = clean(ev.pubTitle || ev.name, 80) || "your dinner";
    if (owner && res.party && (meter.state === "over" || (was != null && was > res.party && count <= res.party) || meter.nudge)) X.notify?.(owner, { kind: "reply", key: `table-${eventId}-${count}`, text: `${meter.line.replace(/^You're at (\d+) of (\d+)\./, `You're at $1 of $2 for ${title}.`)}`, link: `/plans/${encodeURIComponent(eventId)}`, eventId });
    return meter; } catch { return null; } }

  /** A Plans to-do for the host when the table needs a call ("Update the reservation · 7 of 6"). */
  function hostTodo(ws, id, ev) { if (planKindOf(ev) !== "table" || !ev.reservation) return null; const S = scopeStore(store, ws), { meter } = tableNow(S, id, ev);
    return meter.nudge ? { title: meter.nudge, status: `${meter.count} of ${meter.party} at the table` } : null; }
  /** A guest's saved sessions as Plans rows (the personal agenda). */
  function savedSessions(ws, id, ev, rid) { if (planKindOf(ev) !== "summit" || !rid) return []; const S = scopeStore(store, ws), saved = agendaRec(S, id).saves?.[rid] || []; if (!saved.length) return [];
    const A = cleanAgenda(ev.agenda, ev, cleanSpeakers(ev.speakers)).agenda; if (!A) return []; const clash = conflictsOf(A.sessions, saved);
    return A.sessions.filter((s) => saved.includes(s.id)).map((s) => ({ ...s, conflict: !!clash[s.id] })); }

  return { viewOf, onRsvp, hostTodo, savedSessions, tripRec, agendaRec, tableNow, hostNameOf };
}

// ================= the routes =================
export function mountKinds(app, { store, small, big, currentUser, C, X, P, sendStatic }) {
  const K = makeKinds({ store, C, X }); app.locals.kinds = K;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const hits = new Map(), limited = (req, n = 120) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 6).join("/"), now = Date.now(); if (hits.size > 20000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req) => { try { return currentUser(req); } catch { return null; } };
  const viewer = (req, id, b = {}) => { const u = me(req); return P.viewerOf(id, { rid: String(b.rid || req.query.rid || "").slice(0, 80), code: String(b.code || req.query.code || "").slice(0, 40), email: u?.email || "", ws: u?.ws && u.ws !== DEFAULT_WS ? u.ws : "" }); };
  const fresh = (req, id, b) => K.viewOf(id, viewer(req, id, b));

  app.get("/api/public/kinds/:id", (req, res) => { const id = String(req.params.id || ""); if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found");
    const V = viewer(req, id); if (!V || (!V.isHost && !V.r && !(V.ev.published || V.ev.discoverable))) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, no-store").json({ kinds: K.viewOf(id, V) }); });

  // ---------- guests (who are in) ----------
  const guest = (fn) => (req, res) => { if (limited(req, 60)) return bad(res, "Slow down a little.", 429, "rate_limited"); const id = String(req.params.id || ""), b = req.body || {}; if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found");
    const V = viewer(req, id, b); if (!V) return bad(res, "No such event.", 404, "not_found");
    const pid = V.isHost ? "host" : V.r?.response === "going" ? V.rid : ""; if (!pid) return bad(res, V.r ? "This is for guests who are in." : "Reply first, then you can add yourself here.", 403, "not_granted");
    if (V.ev.cancelled) return bad(res, "This one was cancelled.", 409, "closed");
    const err = fn(V, pid, b, id); if (err) return bad(res, err, 409, "not_allowed");
    res.json({ ok: true, kinds: fresh(req, id, b) }); };
  app.post("/api/public/kinds/:id/bed", small, guest((V, pid, b, id) => { if (planKindOf(V.ev) !== "weekend") return "There are no beds on this one.";
    const T = K.tripRec(V.S, id), err = claimBed(T, cleanBeds(V.ev.beds), pid, String(b.bed || ""), b.on !== false); if (err) return err; V.S.set("trip/" + id, { ...T, eventId: id, at: Date.now() }); return ""; }));
  app.post("/api/public/kinds/:id/car", small, guest((V, pid, b, id) => { if (planKindOf(V.ev) !== "weekend" || V.ev.carpool === false) return "There are no rides on this one.";
    const T = K.tripRec(V.S, id), err = carAction(T, pid, b); if (err) return err; V.S.set("trip/" + id, { ...T, eventId: id, at: Date.now() }); return ""; }));
  app.post("/api/public/kinds/:id/payurl", small, guest((V, pid, b, id) => { if (pid === "host") return "Set your pay link in the event's settings."; const u = String(b.url || "").trim(), url = httpsOf(u); if (u && !url) return "That link doesn't look right. Paste your Venmo, PayPal or Cash App link.";
    const T = K.tripRec(V.S, id); T.payUrls = { ...(T.payUrls || {}) }; if (url) T.payUrls[pid] = url; else delete T.payUrls[pid]; V.S.set("trip/" + id, { ...T, eventId: id, at: Date.now() }); return ""; }));
  app.post("/api/public/kinds/:id/agenda", small, (req, res, next) => guest((V, pid, b, id) => { if (planKindOf(V.ev) !== "summit") return "There's no agenda on this one.";
    const A = cleanAgenda(V.ev.agenda, V.ev, cleanSpeakers(V.ev.speakers)).agenda, s = A?.sessions.find((x) => x.id === String(b.session || "")); if (!s) return "That session isn't on the agenda anymore.";
    const R = K.agendaRec(V.S, id), L = (R.saves?.[pid] || []).filter((x) => x !== s.id), live = new Set(latestReplies(V.S, id).filter((x) => x.r.response === "going").map((x) => x.id));
    if (b.on !== false) { const cap = capOf(s, A.rooms), n = Object.entries(R.saves || {}).filter(([p, S2]) => p !== pid && (p === "host" || live.has(p)) && (S2 || []).includes(s.id)).length;
      if (cap && n >= cap) return `${s.room || "That room"} is full for ${s.title}. Pick another session at that time?`; L.push(s.id); }
    R.saves = { ...(R.saves || {}), [pid]: L }; V.S.set("agenda/" + id, { ...R, eventId: id, at: Date.now() }); return ""; })(req, res, next));

  // ---------- the host ----------
  const hostEv = (req, res) => { const u = me(req); if (!u?.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; }
    const id = String(req.params.id || ""), S = scopeStore(store, u.ws), ev = ID.test(id) ? S.get("events/" + id)?.data : null; if (!ev) { bad(res, "No such event.", 404, "not_found"); return null; } return { u, id, S, ev }; };
  const hostView = (req, H) => K.viewOf(H.id, { ws: H.u.ws, S: H.S, ev: H.S.get("events/" + H.id).data, isHost: true, r: null, rid: "" });
  // what the host typed for the kind: the booking, the lodging and beds, the agenda, speakers and sponsors
  app.post("/api/host/events/:id/kinds", big || small, (req, res) => { const H = hostEv(req, res); if (!H) return; const b = req.body || {}, ev = H.ev, patch = {};
    if (b.planKind != null) patch.planKind = PLAN_KINDS.includes(b.planKind) ? b.planKind : "";
    if (b.reservation != null) { const cur = ev.reservation || {}; patch.reservation = cleanReservation({ ...b.reservation, confirmedFor: cur.confirmedFor, lastCount: cur.lastCount }, ev); if (patch.reservation.restaurant && !ev.venueName) patch.venueName = patch.reservation.restaurant; if (patch.reservation.party > 1 && patch.reservation.party !== cur.party) patch.headcount = patch.reservation.party - 1; }
    if (b.lodging != null) patch.lodging = cleanLodging(b.lodging);
    if (b.beds != null) patch.beds = cleanBeds(b.beds);
    if (b.carpool != null) patch.carpool = !!b.carpool;
    if (b.payUrl != null) { const u = httpsOf(b.payUrl); if (String(b.payUrl).trim() && !u) return bad(res, "That pay link doesn't look right."); patch.payLink = u; } // the host's pay link for kinds, beside the invite's own payUrl so the light invite stays light }
    if (b.speakers != null) patch.speakers = cleanSpeakers(b.speakers);
    if (b.sponsors != null) patch.sponsors = cleanSponsors(b.sponsors);
    if (b.agenda != null) { const r = cleanAgenda(b.agenda, ev, patch.speakers || cleanSpeakers(ev.speakers)); if (r.error) return bad(res, r.error); patch.agenda = r.agenda; }
    if (!Object.keys(patch).length) return bad(res, "Nothing to save.");
    H.S.update("events/" + H.id, { ...patch, updatedAt: Date.now() });
    res.json({ ok: true, kinds: hostView(req, H) }); });
  // "The booking matches": the host called the restaurant, so the meter counts from here
  app.post("/api/host/events/:id/table/confirm", small, (req, res) => { const H = hostEv(req, res); if (!H) return; if (!H.ev.reservation) return bad(res, "Add the booking first.");
    const { count } = K.tableNow(H.S, H.id, H.ev), party = Math.max(1, Math.min(40, Math.round(+req.body?.party || count)));
    H.S.update("events/" + H.id, { reservation: { ...H.ev.reservation, party, confirmedFor: party, lastCount: count }, ...(party > 1 ? { headcount: party - 1 } : {}), updatedAt: Date.now() }); /* the spots follow the booking: you and party - 1 */ res.json({ ok: true, kinds: hostView(req, H) }); });
  // the trip's costs: add one, remove one
  app.post("/api/host/events/:id/costs", small, (req, res) => { const H = hostEv(req, res); if (!H) return; if (planKindOf(H.ev) !== "weekend") return bad(res, "Costs are for a weekend away.");
    const b = req.body || {}, T = K.tripRec(H.S, H.id), people = peopleIn(H.S, H.id, K.hostNameOf(H.u.ws, H.ev));
    if (b.action === "remove") T.costs = (T.costs || []).filter((c) => c.id !== String(b.cost || ""));
    else { const c = cleanCost(b, people); if (c.error) return bad(res, c.error); if ((T.costs || []).length >= 60) return bad(res, "That's a lot of costs. Sixty is the most."); T.costs = [...(T.costs || []), c.cost]; }
    H.S.set("trip/" + H.id, { ...T, eventId: H.id, at: Date.now() }); res.json({ ok: true, kinds: hostView(req, H) }); });
  // the host puts someone in a bed (or themselves) or a car seat, or takes them out
  app.post("/api/host/events/:id/beds", small, (req, res) => { const H = hostEv(req, res); if (!H) return; const b = req.body || {}, people = peopleIn(H.S, H.id), pid = people.some((p) => p.pid === b.pid) ? b.pid : "";
    if (!pid) return bad(res, "Pick someone who is in."); const T = K.tripRec(H.S, H.id), err = claimBed(T, cleanBeds(H.ev.beds), pid, String(b.bed || ""), b.on !== false); if (err) return bad(res, err, 409, "not_allowed");
    H.S.set("trip/" + H.id, { ...T, eventId: H.id, at: Date.now() }); res.json({ ok: true, kinds: hostView(req, H) }); });

  // a speaker's own page, public only when they opted in or the host marked them public
  app.get("/api/public/speaker/:id/:sid", (req, res) => { const id = String(req.params.id || ""), sid = String(req.params.sid || ""); if (!ID.test(id) || !SID.test(sid)) return bad(res, "No such speaker.", 404, "not_found");
    const ws = workspaceOfEvent(id), S = ws && scopeStore(store, ws), ev = S?.get("events/" + id)?.data; if (!ev || ev.example || ev.cancelled || !(ev.published || ev.discoverable)) return bad(res, "No such speaker.", 404, "not_found");
    const sp = cleanSpeakers(ev.speakers), s = sp.find((x) => x.id === sid); if (!speakerPublic(s)) return bad(res, "No such speaker.", 404, "not_found");
    const A = cleanAgenda(ev.agenda, ev, sp).agenda || { sessions: [] };
    res.set("Cache-Control", "public, max-age=60").json({ speaker: { name: s.name, title: s.title, org: s.org, bio: s.bio, link: s.link, photo: s.photo }, event: { id, title: clean(ev.pubTitle || ev.name, 120), date: ev.date || "", endDate: lastDayOf(ev), area: clean(ev.hood || String(ev.city || "").split(",")[0], 60) },
      sessions: A.sessions.filter((x) => x.speakers.includes(sid)).map((x) => ({ day: x.day, time: x.time, end: x.end, title: x.title, track: x.track, room: x.room })) }); });
  app.get(/^\/speakers\/([A-Za-z0-9_-]{2,80})\/([a-z0-9]{1,16})$/, (req, res) => sendStatic(res, "speaker.html", "<p>Speaker page missing.</p>"));
  return K;
}
