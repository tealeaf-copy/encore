// The brand panel, round 3: what the panel asked for after round 2 (docs/brand-panel-update-r3.md). Built on the round 2
// recovery (server/brandpanel2.js), the bookings (server/brandbook.js) and the event docs (server/brandpanel.js).
//
//   Hold ............ a replacement host is held for a set time, with a clock both sides see. It ends on its own if the
//                     brand doesn't commit by then, or if too few guests can make the new plan (a threshold the owner
//                     sets). A server timer and every read run the same check, on `clock` (tests swap it)
//   Fresh RSVP ...... when the date, the time or access changes, each guest gets a link to reconfirm; the owner sees
//                     the count, target accounts on their own line, and the price and deposit change, before committing
//   Cancel .......... "Cancel the event" when no replacement works: the refund or credit, and a drafted note
//   Pilot ........... a drill is an operations test; a recovery counts as a success only once the original target
//                     guests attend the replacement. Time to find a host, and the share of target guests who came
//   Match ........... the rebooking rule's planned invite list gives each event a match profile before outcomes are
//                     known, stored with the event; "lift" needs both groups to match (MATCH in server/brandpanel2.js)
//   Durability ...... "Did you book each other again outside Pottery Lab?" to both sides after each event, so the
//                     on-platform rate counts direct repeats; host earnings per prep hour on first and second bookings;
//                     our contribution margin after replacement costs, on assumptions an admin sets; and the first two
//                     ordinary host cohorts, hosts whose followers find another host against those whose don't
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scopeStore } from "./workspaces.js";
import { statusOf, priceFor, money, FEE_BPS } from "./brandbook.js";
import { ofN } from "./brandpanel.js";
import { isAdmin } from "./metrics.js";
import { timeLabel, recoveryMoney, cancelNote, drillSummary, durability } from "./brandpanel2.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const short = (d) => (ISO.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const normCo = (s) => lc(s).replace(/[^a-z0-9 ]/g, " ").replace(/\b(inc|llc|ltd|co|corp|corporation|the)\b/g, " ").replace(/\s+/g, " ").trim();
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const paidOf = (r) => (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + (p.cents || 0), 0);
const LIVE = ["accepted", "booked", "done"];
const median = (L) => { if (!L.length) return null; const s = [...L].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; };

/** The one clock the hold reads. Tests replace now() to move time. */
export const clock = { now: () => Date.now() };

// ---------------------------------------------------------------------------------------------------------------
// A. The hold, the fresh RSVP and the commit.
export const HOLD = { hours: 24, choices: [12, 24, 48], minHours: 1, maxHours: 72, defaultPct: 60, sweepMs: 5 * 60e3 };
export const RELEASED = { time: "The hold ended: there was no commit by the deadline.", short: "The hold ended: fewer guests can make the new plan than the number you set.", host: "The hold ended: the host can't take it after all.", brand: "You let the hold go.", cancelled: "The hold ended when the event was cancelled." };
/** "23h 10m left", "45m left", "Ended". */
export function leftText(ms) { if (!(ms > 0)) return "Ended"; const m = Math.ceil(ms / 60e3), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m left` : `${m}m left`; }
/** When the hold ends: `hours` from now, but never after the morning of the new date, and at least an hour. */
export function holdWindow(now, date, hours = HOLD.hours) {
  const h = Math.max(HOLD.minHours, Math.min(HOLD.maxHours, +hours || HOLD.hours)), cap = ISO.test(date || "") ? Date.parse(date + "T09:00:00Z") : Infinity;
  return Math.max(now + HOLD.minHours * 3600e3, Math.min(now + h * 3600e3, cap));
}
export const defaultThreshold = (guests) => (guests ? Math.max(1, Math.ceil((guests * HOLD.defaultPct) / 100)) : 0);
/** Reconfirmations: everyone the note went to, and target accounts on their own line. */
export function rsvpCounts(hold = {}, targets = []) {
  const L = hold.rsvp?.list || [], A = hold.rsvp?.answers || {}, T = new Set((targets || []).map(normCo).filter(Boolean));
  const yes = L.filter((g) => A[g.id] === "yes").length, no = L.filter((g) => A[g.id] === "no").length, waiting = L.length - yes - no;
  const acc = new Map(); for (const g of L) { const k = normCo(g.company); if (!k || !T.has(k)) continue; const a = acc.get(k) || { yes: false }; if (A[g.id] === "yes") a.yes = true; acc.set(k, a); }
  const tYes = [...acc.values()].filter((a) => a.yes).length;
  return { yes, no, waiting, of: L.length, text: `${yes} of ${L.length} guests reconfirmed`, targets: { yes: tYes, of: acc.size, text: `${tYes} of ${acc.size} target ${acc.size === 1 ? "account" : "accounts"} reconfirmed` } };
}
/** Where a hold stands at `now`: still held, or released and why. A pure check; the caller writes the result. */
export function holdState(hold, now = clock.now()) {
  if (!hold) return { state: "none" }; if (hold.state !== "held") return { state: hold.state, why: hold.why || "" };
  if (now >= hold.expiresAt) return { state: "released", why: "time" };
  if (hold.rsvp?.needed && hold.rsvp.sentAt) { const C = rsvpCounts(hold); if (C.yes + C.waiting < (hold.threshold || 0)) return { state: "released", why: "short" }; }
  return { state: "held", msLeft: hold.expiresAt - now };
}
/** Can the brand commit now? Only on a live hold, and when guests had to reconfirm, once enough have. */
export function canCommit(hold, now = clock.now()) {
  const S = holdState(hold, now); if (S.state !== "held") return { ok: false, why: RELEASED[S.why] || "There's no hold to commit." };
  if (!hold.rsvp?.needed) return { ok: true };
  if (!hold.rsvp.sentAt && (hold.threshold || 0) > 0) return { ok: false, why: "Send the note first, so guests can reconfirm the new plan." };
  const C = rsvpCounts(hold); if (C.yes < (hold.threshold || 0)) return { ok: false, why: `${C.text} so far. You set ${hold.threshold} before committing.` };
  return { ok: true };
}
/** What the hold looks like to the brand or to the replacement host. The host sees counts, never names. */
export function holdView(hold, { now = clock.now(), targets = [], side = "brand" } = {}) {
  if (!hold) return null; const S = holdState(hold, now), C = rsvpCounts(hold, targets), live = S.state === "held";
  const ch = hold.changes || {}, lines = [ch.date ? `New date: ${short(hold.date)} (was ${short(ch.oldDate)})` : `Same date: ${short(hold.date)}`, ch.time ? `New time: ${timeLabel(ch.newTime)} (was ${timeLabel(ch.oldTime)})` : `Same time: ${timeLabel(ch.newTime || ch.oldTime) || "as booked"}`, ...(ch.format ? [`Format: ${ch.format}`] : []), ...(ch.access || []).map((a) => `Access: ${a}`)];
  const P = hold.price || {}, oldT = hold.was?.totalCents || 0, diff = (P.totalCents || 0) - oldT, paid = hold.was?.paidCents || 0;
  return { id: hold.id, state: S.state, why: S.why ? RELEASED[S.why] : "", live, startedAt: hold.startedAt, expiresAt: hold.expiresAt, msLeft: live ? S.msLeft : 0, left: live ? leftText(S.msLeft) : "Ended", hours: hold.hours,
    name: hold.name, host: hold.host, handle: hold.handle, pkg: hold.pkg, date: hold.date, dateLabel: short(hold.date), time: ch.newTime || "", timeLabel: timeLabel(ch.newTime || ch.oldTime), changes: lines, rsvpNeeded: !!hold.rsvp?.needed, sameEvening: !!ch.sameEvening,
    threshold: hold.threshold || 0, sent: !!hold.rsvp?.sentAt, counts: C, commit: canCommit(hold, now), hostOk: hold.hostOk ?? null, committedAt: hold.committedAt || 0, company: hold.company, headcount: hold.headcount,
    price: side === "brand" ? { totalCents: P.totalCents || 0, depositCents: P.depositCents || 0, wasTotalCents: oldT, wasDepositCents: hold.was?.depositCents || 0, paidCents: paid, waivedFeeCents: P.waivedFeeCents || 0, diffCents: diff,
      lines: [`New total: ${money(P.totalCents || 0)} (was ${money(oldT)}, ${diff ? `${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"}` : "the same"})`, `Deposit to confirm: ${money(P.depositCents || 0)} (was ${money(hold.was?.depositCents || 0)})`, ...(P.waivedFeeCents ? [`No booking fee on a replacement: ${money(P.waivedFeeCents)} waived`] : []), paid ? `You paid ${money(paid)} on the cancelled booking: ${hold.money === "credit" ? "kept as credit toward this one" : "refunded in full"}` : "Nothing was paid on the cancelled booking"] }
      : { totalCents: P.hostCents || 0 },
    deadline: live ? (hold.rsvp?.needed ? `The hold ends at the time shown, or sooner if fewer than ${hold.threshold} guests can make it.` : "The hold ends at the time shown unless the brand commits.") : "" };
}

// ---------------------------------------------------------------------------------------------------------------
// A5. Pilot metrics. Drills are operations tests. A recovery is a success only once the original target guests come.
export const PILOT = { successShare: 0.5 };
/** recs: [{ foundMinutes, state, targets, attended, replacementDone }], drills: [{ startedAt, finishedAt }] */
export function pilotMetrics(recs = [], drills = [], P = PILOT) {
  const D = drillSummary(drills), found = recs.map((x) => x.foundMinutes).filter((m) => m != null), done = recs.filter((x) => x.replacementDone);
  const tg = done.reduce((a, x) => a + (x.targets || 0), 0), at = done.reduce((a, x) => a + Math.min(x.attended || 0, x.targets || 0), 0);
  const ok = done.filter((x) => x.targets > 0 && x.attended / x.targets >= P.successShare).length;
  return { tests: D.runs, testLine: D.runs ? `${plural(D.runs, "drill")} run as operations tests. They aren't counted as recoveries.` : "No drill yet. Drills count as operations tests, not recoveries.", drillMinutes: D.best,
    recoveries: recs.length, found: { n: found.length, medianMinutes: median(found), text: found.length ? `${median(found)} minutes to hold a replacement (median of ${found.length})` : "No replacement held yet" },
    targetsAttended: ofN(at, tg, "original target guests attended the replacement"), successes: ofN(ok, done.length, "recoveries where the original target guests came"),
    rule: `A recovery counts as a success once at least ${Math.round(P.successShare * 100)}% of the original target guests attend the replacement.`, cancelled: recs.filter((x) => x.state === "cancelled").length };
}

// ---------------------------------------------------------------------------------------------------------------
// B. The match profile, from the rebooking rule's planned invite list, stored with the event before it happens.
export function matchProfile({ r = {}, ev = {}, guests = [], targets = [], city = "", now = clock.now() } = {}) {
  const planned = guests.filter((g) => g.event === r.id && !["asked", "no"].includes(g.status)), T = new Set([...(targets || []), ...(ev.rule?.accounts || [])].map(normCo).filter(Boolean));
  const mix = ev.brief?.mix || {}, seats = (+mix.brand || 0) + (+mix.host || 0);
  return { brandShare: seats ? (+mix.brand || 0) / seats : planned.length ? 1 : null, targetShare: planned.length ? planned.filter((g) => T.has(normCo(g.company))).length / planned.length : null, effort: planned.length,
    spendPerGuestCents: r.headcount ? Math.round((r.price?.totalCents || 0) / r.headcount) : null, city, goal: ev.brief?.goal || "", planned: planned.length, at: now };
}

// ---------------------------------------------------------------------------------------------------------------
// C1. "Did you book each other again outside Pottery Lab?", to each side, after the event.
export const OFF_QUESTION = "Did you book each other again outside Pottery Lab?";
export function cleanOffAnswer(b = {}) { if (b.count == null || b.count === "") return { error: "Pick an answer." }; return { answer: { count: int(b.count, 0, 50), at: clock.now() } }; }
export function followupsOf(items = []) {
  const F = {}; let asked = 0, answered = 0;
  for (const { brandWs, hostWs, offAsk } of items) { if (!offAsk?.sentAt) continue; asked += 2; const k = brandWs + "|" + hostWs, f = (F[k] ||= { brand: null, host: null });
    for (const side of ["brand", "host"]) if (offAsk[side]) { answered++; f[side] = Math.max(f[side] ?? 0, offAsk[side].count || 0); } }
  return { followups: F, asks: { asked, answered } };
}

// ---------------------------------------------------------------------------------------------------------------
// C2. Host net earnings per prep hour, first bookings against second bookings with the same brand.
const netOf = (r) => Math.max(0, (r.price?.totalCents || 0) - (r.price?.feeCents || 0) - (r.price?.taxCents || 0));
export function hoursOf(ev = {}) { const L = (ev.prep?.logged || []).reduce((a, x) => a + (+x.hours || 0), 0); return L > 0 ? L : ev.prep?.prepHours > 0 ? ev.prep.prepHours : null; }
const rate = (L) => { const H = L.filter((x) => x.hours), net = H.reduce((a, x) => a + x.net, 0), hours = H.reduce((a, x) => a + x.hours, 0); return { n: L.length, withHours: H.length, netCents: net, hours, perHourCents: hours ? Math.round(net / hours) : null }; };
/** bookings: [{ hostWs, brandWs, date, net, hours }] (live ones). First = a pair's first booking, second = any after. */
export function repeatEarnings(bookings = []) {
  const byPair = new Map(); for (const b of [...bookings].sort((x, y) => String(x.date).localeCompare(String(y.date)))) { const k = b.brandWs + "|" + b.hostWs; (byPair.get(k) || byPair.set(k, []).get(k)).push(b); }
  const F = [], S = []; for (const L of byPair.values()) L.forEach((b, i) => (i ? S : F).push(b));
  const hosts = [...new Set(bookings.map((b) => b.hostWs))].map((ws) => ({ hostWs: ws, first: rate(F.filter((b) => b.hostWs === ws)), second: rate(S.filter((b) => b.hostWs === ws)) }));
  const all = { first: rate(F), second: rate(S) };
  return { hosts, all, line: all.first.perHourCents != null && all.second.perHourCents != null ? `Second bookings earn hosts ${money(all.second.perHourCents)} a prep hour, against ${money(all.first.perHourCents)} on first bookings.` : "Shown once first and second bookings both have prep hours logged." };
}

// ---------------------------------------------------------------------------------------------------------------
// C3. Pottery Lab's contribution margin per booking, before and after replacement costs. Assumptions are an admin's.
export const MARGIN = { processingBps: 290, processingFixedCents: 30, supportCentsPerBooking: 1500, recoveryHandlingCents: 4000, creditCostPct: 10, waiveReplacementFee: true };
export const MARGIN_LABELS = { processingBps: "Card processing, in basis points of the total", processingFixedCents: "Card processing, fixed per booking (cents)", supportCentsPerBooking: "Support time per booking (cents)", recoveryHandlingCents: "Our time per recovery (cents)", creditCostPct: "Share of each credit we end up funding (%)", waiveReplacementFee: "Waive the booking fee on a replacement" };
export function cleanMargin(b = {}, cur = MARGIN) { const o = { ...MARGIN, ...cur };
  for (const [k, hi] of [["processingBps", 2000], ["processingFixedCents", 10000], ["supportCentsPerBooking", 1e6], ["recoveryHandlingCents", 1e6], ["creditCostPct", 100]]) if (b[k] != null && b[k] !== "") o[k] = int(b[k], 0, hi);
  if (b.waiveReplacementFee != null) o.waiveReplacementFee = b.waiveReplacementFee === true || b.waiveReplacementFee === "true" || b.waiveReplacementFee === "on"; return o; }
/** bookings: [{ totalCents, subtotalCents, feeCents, feeWaivedCents, creditCents, replacement }], cancelledRecoveries: n */
export function marginReport(bookings = [], { A = MARGIN, baseBps = FEE_BPS(), cancelledRecoveries = 0 } = {}) {
  let list = 0, repeat = 0, waived = 0, credit = 0, handling = 0, proc = 0, support = 0;
  for (const b of bookings) { const full = Math.round(((b.subtotalCents || 0) * baseBps) / 10000); list += full; waived += b.feeWaivedCents || 0; if (!b.feeWaivedCents) repeat += Math.max(0, full - (b.feeCents || 0));
    credit += Math.round(((b.creditCents || 0) * A.creditCostPct) / 100); if (b.replacement) handling += A.recoveryHandlingCents; proc += Math.round(((b.totalCents || 0) * A.processingBps) / 10000) + A.processingFixedCents; support += A.supportCentsPerBooking; }
  handling += cancelledRecoveries * A.recoveryHandlingCents; const n = bookings.length, before = list - proc - support, after = before - repeat - waived - credit - handling;
  return { bookings: n, assumptions: A, lines: [{ k: "list", label: "Booking fees at the list rate", cents: list }, { k: "processing", label: "Card processing", cents: -proc }, { k: "support", label: "Support time", cents: -support }, { k: "before", label: "Margin before replacement costs", cents: before, total: true },
      { k: "repeat", label: "The repeat-fee discount", cents: -repeat }, { k: "waived", label: "Fees waived on replacements", cents: -waived }, { k: "credit", label: "Credits we fund", cents: -credit }, { k: "handling", label: `Our time on recoveries (${cancelledRecoveries ? `incl. ${plural(cancelledRecoveries, "cancelled event")}` : "replacements"})`, cents: -handling }, { k: "after", label: "Margin after replacement costs", cents: after, total: true }],
    beforeCents: before, afterCents: after, perBookingBeforeCents: n ? Math.round(before / n) : null, perBookingAfterCents: n ? Math.round(after / n) : null };
}

// ---------------------------------------------------------------------------------------------------------------
// C4. The first two ordinary (non-founding) host cohorts: followers who discover another host, or stay with one.
/** hosts: [{ ws, founding, bookings: [{ date, net, hours }], discovered }] */
export function cohortDiscovery(hosts = [], { cohorts = 2 } = {}) {
  const H = hosts.filter((h) => !h.founding && h.bookings?.length).map((h) => ({ ...h, bookings: [...h.bookings].sort((a, b) => String(a.date).localeCompare(String(b.date))) })).map((h) => ({ ...h, cohort: String(h.bookings[0].date).slice(0, 7) }));
  const months = [...new Set(H.map((h) => h.cohort))].sort().slice(0, cohorts);
  const group = (L) => { const r = rate(L.flatMap((h) => h.bookings)), second = L.filter((h) => h.bookings.length >= 2).length; return { hosts: L.length, perHourCents: r.perHourCents, withHours: r.withHours, secondEvent: ofN(second, L.length, "hosts with a second-event booking"), secondBookings: L.reduce((a, h) => a + Math.max(0, h.bookings.length - 1), 0) }; };
  return { cohorts: months.map((m) => { const L = H.filter((h) => h.cohort === m); return { cohort: m, discover: group(L.filter((h) => h.discovered)), stay: group(L.filter((h) => !h.discovered)) }; }),
    note: "Ordinary hosts only (founding hosts are left out), by the month of their first brand booking. \"Discover\" means at least one of their followers followed or went to another host's event." };
}

// ---------------------------------------------------------------------------------------------------------------
export function mountBrandPanel3(app, { store, small, C, X, P, PUBLIC_DIR = "", publicOrigin = () => "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const send = (res, o) => res.set("Cache-Control", "private, no-store").json(o);
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const BB = () => X.bb, RV = () => X.recovery, S0 = (ws) => scopeStore(store, ws), sys = (k) => store.get("system/" + k)?.data || null, sysSet = (k, v) => { store.set("system/" + k, v); return v; };
  const admin = (req, res) => { const u = P.me(req); if (!u || !isAdmin(u.email)) { bad(res, "Not found.", 404, "not_found"); return null; } return u; };
  const margin = () => cleanMargin({}, sys("bpmargin") || MARGIN);
  const allEvs = () => store.listPrefix("system", "bpev-").map((d) => d.data).filter(Boolean);
  const targetsOf = (r, ev) => { const c = P.campOf(r); return [...new Set([...(c?.targets || []), ...(ev?.rule?.accounts || [])])]; };
  const guestsOf = (r) => { const c = P.campOf(r); return c ? (c.guests || []).filter((g) => g.event === r.id && ["yes", "invited"].includes(g.status)) : []; };

  // ---- the fee on a replacement booking: waived when the assumptions say so ----
  let waiving = false; const baseFee = X.feeBpsFor; X.feeBpsFor = (b, h) => (waiving ? 0 : baseFee ? baseFee(b, h) : null);

  // ---- holds: an index doc per hold for the host's view and for held dates ----
  const idx = (H, reqId) => sysSet("bphold-" + H.id, { id: H.id, reqId, hostWs: H.hostWs, pkg: H.pkg, date: H.date, state: H.state, expiresAt: H.expiresAt });
  X.heldDates = (ws, pkgId) => { const now = clock.now(); return store.listPrefix("system", "bphold-").map((d) => d.data).filter((h) => h && h.hostWs === ws && h.pkg === pkgId && h.state === "held" && h.expiresAt > now).map((h) => h.date); };
  /** Apply the hold's own rules at `now`: write a release, tell both sides. Returns true when something changed. */
  function sweep(r, ev, now = clock.now()) {
    const H = ev?.recovery?.hold; if (!H || H.state !== "held") return false; const S = holdState(H, now); if (S.state === "held") return false;
    release(r, ev, S.why, now); return true; }
  function release(r, ev, why, now = clock.now()) { const H = ev.recovery.hold; H.state = "released"; H.why = why; H.releasedAt = now; ev.recovery.state = ["rebooked", "cancelled"].includes(ev.recovery.state) ? ev.recovery.state : "open";
    ev.recovery.past = [...(ev.recovery.past || []), { id: H.id, host: H.host, why, at: now }].slice(-10); idx(H, r.id); P.note(ev, "brand", `the hold on ${H.host} ended: ${RELEASED[why] || why}`);
    if (why !== "host") BB().tell(BB().ownerEmailOf(H.hostWs), `The hold on ${short(H.date)} for ${r.company} has ended. Your date is open again.`, "/host/teams#inbox");
    if (why !== "brand" && why !== "cancelled") BB().tell(ev.recovery.owner || r.brandEmail, `${RELEASED[why]} ${H.host} is no longer held for ${r.pkgName}.`, `/teams/bookings/${r.id}#recovery`); }
  const evFresh = (r) => P.evGet(r.id) || P.evOf(r);
  function sweepAll(now = clock.now()) { let n = 0; for (const h of store.listPrefix("system", "bphold-").map((d) => d.data)) { if (!h || h.state !== "held") continue; const r = BB().reqGet(h.reqId), ev = r && P.evGet(r.id); if (!ev?.recovery?.hold || ev.recovery.hold.id !== h.id) { h.state = "released"; sysSet("bphold-" + h.id, h); continue; } if (sweep(r, ev, now)) { P.evSet(ev); n++; } } return n; }

  // ---- the recovery view gets the hold, the counts, the cancel path and the pilot line ----
  X.recoveryMore = (r, ev, V) => { if (sweep(r, ev)) P.evSet(ev); const H = ev.recovery?.hold, T = targetsOf(r, ev), live = H?.state === "held";
    const opt = live ? { name: H.name, host: H.host, date: H.date, changes: H.changes } : V.options[0];
    return { ...V, state: ev.recovery?.state || V.state, hold: H ? holdView(H, { targets: T }) : null, past: (ev.recovery?.past || []).map((x) => ({ host: x.host, why: RELEASED[x.why] || x.why, at: x.at })), holdHours: HOLD.choices, defaultThreshold: defaultThreshold(V.guests),
      note: RV().noteFor(r, ev, opt, live && H.rsvp?.needed ? "(each guest gets their own link)" : ""), options: V.options.map((o) => ({ ...o, rsvp: !!o.changes?.rsvp })),
      cancelled: ev.recovery?.state === "cancelled" ? { at: ev.recovery.cancelledAt, money: ev.recovery.money, told: ev.recovery.cancelTold || 0 } : null, rebookId: ev.recovery?.rebookId || "", targets: T.length,
      outcome: ev.recovery?.rebookId ? recoveryOutcome(r, ev) : null }; };
  function recoveryOutcome(r, ev) { const nr = BB().reqGet(ev.recovery.rebookId), c = P.campOf(r), ids = new Set(ev.recovery.targetGuests || []), att = c ? (c.guests || []).filter((g) => ids.has(g.id) && g.event === nr?.id && g.checkedIn).length : 0, done = !!nr && statusOf(nr) === "done";
    return { foundMinutes: ev.recovery.foundMinutes ?? null, targets: ids.size, attended: att, replacementDone: done, success: done && ids.size > 0 && att / ids.size >= PILOT.successShare, line: !done ? `Counted as a success once the replacement happens and ${Math.round(PILOT.successShare * 100)}% or more of the ${plural(ids.size, "original target guest")} come.` : `${att} of ${plural(ids.size, "original target guest")} came to the replacement.` }; }

  // hold a replacement: one at a time; a new hold lets the last one go
  app.post("/api/teams/events/:id/recovery/hold", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const rec = E.ev.recovery, b = req.body || {}, now = clock.now();
    if (!rec || ["rebooked", "cancelled"].includes(rec.state)) return bad(res, rec ? "This recovery is closed." : "Nothing to recover.", 409, "conflict"); sweep(E.r, E.ev, now);
    if (!b.handle && rec.hold?.state === "held") { if (b.threshold != null) rec.hold.threshold = int(b.threshold, 0, rec.hold.rsvp?.list?.length || guestsOf(E.r).length || 0); sweep(E.r, E.ev, now); P.evSet(E.ev); return send(res, RV().recoveryView(E.r, E.ev)); }
    const V = RV().recoveryView(E.r, E.ev), x = V.options.find((o) => o.handle === b.handle && o.pkg === b.pkg); if (!x) return bad(res, "Pick one of the hosts shown.");
    placeHold(E, x, b, now); send(res, RV().recoveryView(E.r, E.ev)); });
  function placeHold(E, x, b = {}, now = clock.now()) { const rec = E.ev.recovery; if (rec.hold?.state === "held") release(E.r, E.ev, "brand", now);
    const F = BB().findPkg(x.handle, x.pkg), A = margin(), normal = X.feeBpsFor(E.r.brandWs, x.ws) ?? FEE_BPS(), pr = F ? priceFor(F.p, E.r.headcount, { feeBps: A.waiveReplacementFee ? 0 : normal }) : null, full = F ? priceFor(F.p, E.r.headcount, { feeBps: normal }) : null, G = guestsOf(E.r), base = RV().recoveryBase(E.r);
    const H = { id: rid(6), handle: x.handle, pkg: x.pkg, hostWs: x.ws, name: x.name, host: x.host, date: x.date, company: E.r.company, headcount: E.r.headcount, changes: x.changes, startedAt: now, hours: HOLD.choices.includes(+b.hours) ? +b.hours : HOLD.hours, state: "held", hostOk: null, money: rec.money?.choice || "refund",
      price: pr ? { totalCents: pr.totalCents, depositCents: pr.depositCents, hostCents: pr.subtotalCents, waivedFeeCents: A.waiveReplacementFee ? full.feeCents : 0 } : { totalCents: x.totalCents, depositCents: x.depositCents }, was: { totalCents: base.totalCents, depositCents: base.depositCents, paidCents: paidOf(E.r) },
      rsvp: { needed: !!x.changes?.rsvp, sentAt: 0, list: [], answers: {} }, threshold: b.threshold != null && b.threshold !== "" ? int(b.threshold, 0, G.length) : x.changes?.rsvp ? defaultThreshold(G.length) : 0 };
    H.expiresAt = holdWindow(now, x.date, H.hours); rec.hold = H; rec.state = "held"; if (rec.foundAt == null) { rec.foundAt = now; rec.foundMinutes = Math.round((now - rec.at) / 6e3) / 10; } idx(H, E.r.id);
    P.note(E.ev, "brand", `held ${x.host} for ${short(x.date)} until ${new Date(H.expiresAt).toISOString().slice(0, 16).replace("T", " ")} UTC`); P.evSet(E.ev);
    BB().tell(BB().ownerEmailOf(x.ws), `${E.r.company} is holding ${short(x.date)} with you for ${E.r.headcount} people${H.rsvp.needed ? " while their guests reconfirm" : ""}. The hold ends in ${leftText(H.expiresAt - now).replace(" left", "")} unless they commit.`, "/host/teams#inbox");
    return H; }
  app.post("/api/teams/events/:id/recovery/release", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const H = E.ev.recovery?.hold; if (!H || H.state !== "held") return bad(res, "There's no hold to let go.", 409, "conflict");
    release(E.r, E.ev, "brand"); P.evSet(E.ev); send(res, RV().recoveryView(E.r, E.ev)); });

  // the note to guests: during a hold that changes the plan, each guest gets a link to reconfirm
  app.post("/api/teams/events/:id/recovery/message", small, async (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const rec = E.ev.recovery; if (!rec) return bad(res, "Nothing to recover.", 409, "conflict");
    sweep(E.r, E.ev); const H = rec.hold?.state === "held" ? rec.hold : null, c = P.campOf(E.r), nr = rec.rebookId ? BB().reqGet(rec.rebookId) : null, origin = publicOrigin(req);
    const G = c ? (c.guests || []).filter((g) => g.event === (nr && !H ? nr.id : E.r.id) && ["yes", "invited"].includes(g.status) && g.email) : [];
    if (!H && !nr) return bad(res, "Hold a replacement first, or cancel the event.", 409, "no_replacement");
    const opt = H ? { name: H.name, host: H.host, date: H.date, changes: H.changes } : nr ? { name: nr.pkgName, host: P.hostName(nr), date: nr.date, changes: rec.committedChanges || {} } : null;
    const needLinks = !!H?.rsvp?.needed, N = RV().noteFor(E.r, E.ev, opt, needLinks ? "{link}" : ""), subject = clean(req.body?.subject, 140) || N.subject; let text = String(req.body?.text || N.text).slice(0, 2000), sent = 0;
    if (needLinks && !text.includes("{link}")) text += "\n\nCan you still come? Tell us here: {link}";
    if (H) { H.rsvp.list = G.map((g) => ({ id: g.id, company: g.company || "" })); H.rsvp.sentAt = clock.now(); H.rsvp.tokens ||= {}; }
    for (const g of G) { let link = ""; if (needLinks) { const t = H.rsvp.tokens[g.id] || rid(12); H.rsvp.tokens[g.id] = t; sysSet("bprc-" + t, { t, reqId: E.r.id, gid: g.id, hold: H.id }); link = `${origin}/reconfirm/${t}`; }
      if (await RV().mail(E.r.brandWs, g.email, subject, `Hi ${first(g.name) || "there"},\n\n${text.replaceAll("{link}", link)}`, E.r.company)) sent++; }
    if (nr && !H && c) { moveGuests(c, E.r.id, nr.id, {}); }
    rec.messagedAt = clock.now(); P.note(E.ev, "brand", `told ${plural(G.length, "guest")} about the change${needLinks ? ", with a link to reconfirm" : ""}`); P.evSet(E.ev); send(res, { ok: true, guests: G.length, emailed: sent, links: needLinks }); });
  function moveGuests(c, fromId, toId, answers = {}) { for (const g of c.guests || []) if (g.event === fromId) { g.event = toId; if (answers[g.id] === "no") g.status = "no"; else if (answers[g.id] === "yes") g.status = "yes"; } if (!(c.bookings || []).includes(toId)) c.bookings = [...(c.bookings || []), toId]; P.cSet(c); }

  // commit: the held host becomes the booking; the brief, credit and guests carry over
  function commit(E, { force = false } = {}) { const rec = E.ev.recovery, H = rec?.hold; sweep(E.r, E.ev); if (!H || H.state !== "held") return { error: RELEASED[H?.why] || "There's no hold to commit.", status: 409 };
    const ok = canCommit(H); if (!ok.ok && !force) return { error: ok.why, status: 409, code: "short" };
    const G = guestsOf(E.r), T = new Set(targetsOf(E.r, E.ev).map(normCo).filter(Boolean)), targetGuests = G.filter((g) => g.status === "yes" && T.has(normCo(g.company))).map((g) => g.id), answers = { ...(H.rsvp?.answers || {}) };
    P.evSet(E.ev); let out; waiving = margin().waiveReplacementFee; try { out = BB().createRequest(E.u, { handle: H.handle, pkg: H.pkg, headcount: E.r.headcount, date: H.date, company: E.r.company, recoveryOf: E.r.id, via: "again", single: !E.r.campaignId, ...(E.r.campaignId ? { campaign: E.r.campaignId } : {}) }); } finally { waiving = false; }
    if (out.error) return { error: out.error, status: out.status || 400, code: out.code };
    const nr = out.r, ev = evFresh(E.r), Hn = ev.recovery.hold, now = clock.now();
    if (/^\d{2}:\d{2}$/.test(H.changes?.newTime || "")) nr.time = H.changes.newTime; if (H.price?.waivedFeeCents) nr.feeWaivedCents = H.price.waivedFeeCents;
    if (Hn.hostOk && ["requested"].includes(nr.status)) { nr.status = "accepted"; nr.respondedAt = now; BB().push(nr, "host", "accepted: agreed during the recovery hold"); }
    BB().reqSet(nr); Hn.state = "committed"; Hn.committedAt = now; idx(Hn, E.r.id); ev.recovery.targetGuests = targetGuests; ev.recovery.committedChanges = H.changes; ev.recovery.state = "rebooked";
    const c = P.campOf(E.r); if (c && (H.rsvp?.sentAt || !H.rsvp?.needed)) moveGuests(c, E.r.id, nr.id, answers);
    P.note(ev, "brand", `committed to ${H.host}${H.rsvp?.needed ? ` with ${rsvpCounts(H).text}` : ""}`); P.evSet(ev);
    BB().tell(BB().ownerEmailOf(H.hostWs), `${E.r.company} committed to ${short(H.date)} for ${E.r.headcount}.${Hn.hostOk ? " It's booked." : " Accept the request to confirm."}`, "/host/teams#inbox");
    return { ok: true, id: nr.id, url: `/teams/bookings/${nr.id}`, minutes: ev.recovery.minutes ?? null, status: nr.status }; }
  app.post("/api/teams/events/:id/recovery/commit", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const o = commit(E); if (o.error) return bad(res, o.error, o.status, o.code || "conflict"); send(res, o); });
  // one tap when nothing changes for guests: hold and commit together
  app.post("/api/teams/events/:id/recovery/rebook", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const rec = E.ev.recovery; if (!rec || rec.state === "rebooked") return bad(res, rec ? "Already rebooked." : "Nothing to recover.", 409, "conflict");
    const V = RV().recoveryView(E.r, E.ev), x = V.options.find((o) => o.handle === req.body?.handle && o.pkg === req.body?.pkg); if (!x) return bad(res, "Pick one of the hosts shown.");
    if (x.changes?.rsvp) return bad(res, "The date, time or access changes, so hold this host and let guests reconfirm first.", 409, "reconfirm");
    if (!(rec.hold?.state === "held" && rec.hold.handle === x.handle && rec.hold.pkg === x.pkg)) placeHold(E, x);
    const o = commit(E); if (o.error) return bad(res, o.error, o.status, o.code || "conflict"); send(res, { ...o, priceLine: x.priceLine }); });

  // Cancel the event: no replacement works. The money by the guarantee, and a note to guests.
  app.post("/api/teams/events/:id/recovery/cancel", small, async (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const rec = E.ev.recovery, b = req.body || {};
    if (!rec || ["rebooked", "cancelled"].includes(rec.state)) return bad(res, rec ? "This recovery is closed." : "Nothing to recover.", 409, "conflict");
    if (rec.hold?.state === "held") release(E.r, E.ev, "cancelled"); rec.money = recoveryMoney(E.r, b.choice); rec.state = "cancelled"; rec.cancelledAt = clock.now();
    const G = guestsOf(E.r).filter((g) => g.email), N = cancelNote({ company: E.r.company, name: E.r.pkgName, date: E.r.date, from: RV().fromOf(E.r, E.ev) }), subject = clean(b.subject, 140) || N.subject, text = String(b.text || N.text).slice(0, 2000); let sent = 0;
    if (b.tell !== false) for (const g of G) if (await RV().mail(E.r.brandWs, g.email, subject, `Hi ${first(g.name) || "there"},\n\n${text}`, E.r.company)) sent++;
    rec.cancelTold = b.tell !== false ? G.length : 0;
    if (rec.money.choice === "credit" && rec.money.cents) { const S = S0(E.r.brandWs), cur = S.get("teambook/credits")?.data || { list: [] }; cur.list = [...cur.list.filter((x) => x.from !== E.r.id), { cents: rec.money.cents, from: E.r.id, name: E.r.pkgName, at: clock.now() }].slice(-100); S.set("teambook/credits", cur); }
    P.note(E.ev, "brand", `cancelled the event: ${rec.money.line}${rec.cancelTold ? ` Told ${plural(rec.cancelTold, "guest")}.` : ""}`); P.evSet(E.ev); send(res, { ok: true, money: rec.money, guests: G.length, emailed: sent }); });

  // the replacement host's view of the hold, and their answer
  const hostHoldsFor = (ws) => store.listPrefix("system", "bphold-").map((d) => d.data).filter((h) => h?.hostWs === ws).map((h) => { const r = BB().reqGet(h.reqId), ev = r && P.evGet(r.id); if (!ev?.recovery?.hold || ev.recovery.hold.id !== h.id) return null; if (sweep(r, ev)) P.evSet(ev); return { r, ev, H: ev.recovery.hold }; }).filter(Boolean);
  app.get("/api/bb/host/holds", (req, res) => { const Hm = P.hostMe(req, res); if (!Hm) return; const now = clock.now();
    const L = hostHoldsFor(Hm.ws).filter(({ H }) => H.state === "held" || now - (H.releasedAt || H.committedAt || 0) < 3 * 864e5).map(({ r, ev, H }) => ({ ...holdView(H, { side: "host", targets: targetsOf(r, ev) }), reqName: r.pkgName }));
    send(res, { holds: L.sort((a, b) => Number(b.live) - Number(a.live) || a.expiresAt - b.expiresAt), now }); });
  app.post("/api/bb/host/holds/:hid", small, (req, res) => { const Hm = P.hostMe(req, res); if (!Hm) return; const x = hostHoldsFor(Hm.ws).find(({ H }) => H.id === String(req.params.hid)); if (!x || x.H.state !== "held") return bad(res, "This hold has ended.", 409, "conflict");
    if (req.body?.yes === false) { release(x.r, x.ev, "host"); BB().tell(x.ev.recovery.owner || x.r.brandEmail, `${x.H.host} can't take ${short(x.H.date)} after all. Pick another host or cancel the event.`, `/teams/bookings/${x.r.id}#recovery`); }
    else { x.H.hostOk = true; x.H.hostOkAt = clock.now(); P.note(x.ev, "host", `${x.H.host} said yes to the held date`); BB().tell(x.ev.recovery.owner || x.r.brandEmail, `${x.H.host} can do ${short(x.H.date)}. Commit before the hold ends.`, `/teams/bookings/${x.r.id}#recovery`); }
    P.evSet(x.ev); send(res, holdView(x.H, { side: "host" })); });

  // the guest's reconfirm link
  app.get("/reconfirm/:token", page("teams-reconfirm.html"));
  const rcOf = (req) => { const t = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 32), d = t && sys("bprc-" + t); if (!d) return null; const r = BB().reqGet(d.reqId), ev = r && P.evGet(r.id), H = ev?.recovery?.hold; if (!H || H.id !== d.hold) return null; return { d, r, ev, H }; };
  const rcView = (x) => { const live = holdState(x.H).state === "held" || x.H.state === "committed", ch = x.H.changes || {};
    return { company: x.r.company, name: x.H.name, host: x.H.host, date: x.H.date, dateLabel: short(x.H.date), timeLabel: timeLabel(ch.newTime || ch.oldTime), was: { name: x.r.pkgName, dateLabel: short(x.r.date), timeLabel: timeLabel(ch.oldTime) }, changes: holdView(x.H).changes, open: live, state: x.H.state, answer: x.H.rsvp?.answers?.[x.d.gid] || "" }; };
  app.get("/api/reconfirm/:token", (req, res) => { const x = rcOf(req); if (!x) return bad(res, "This link doesn't work anymore.", 404, "not_found"); if (sweep(x.r, x.ev)) P.evSet(x.ev); send(res, rcView(x)); });
  app.post("/api/reconfirm/:token", small, (req, res) => { if (limited("rc:" + req.ip, 60)) return bad(res, "Slow down.", 429, "rate_limited"); const x = rcOf(req); if (!x) return bad(res, "This link doesn't work anymore.", 404, "not_found");
    if (sweep(x.r, x.ev)) P.evSet(x.ev); if (!["held", "committed"].includes(x.H.state)) return bad(res, `This plan didn't go ahead. ${x.r.company} will be in touch.`, 409, "closed");
    const a = req.body?.answer === "yes" ? "yes" : req.body?.answer === "no" ? "no" : ""; if (!a) return bad(res, "Pick I'm in or Can't go.");
    x.H.rsvp.answers = { ...(x.H.rsvp.answers || {}), [x.d.gid]: a }; if (x.H.state === "committed") { const c = P.campOf(x.r), g = c?.guests?.find((y) => y.id === x.d.gid); if (g) { g.status = a; P.cSet(c); } }
    sweep(x.r, x.ev); P.evSet(x.ev); send(res, rcView(x)); });

  // the drill and real recoveries, for the campaign and for us
  function recoveryRecs(evs) { return evs.filter((ev) => ev.recovery).map((ev) => { const r = BB().reqGet(ev.reqId); if (!r) return null; const o = ev.recovery.rebookId ? recoveryOutcome(r, ev) : null; return { foundMinutes: ev.recovery.foundMinutes ?? null, state: ev.recovery.state, targets: o?.targets || 0, attended: o?.attended || 0, replacementDone: !!o?.replacementDone }; }).filter(Boolean); }
  X.pilotFor = (E) => { const evs = E.map(({ ev }) => ev).filter(Boolean); return pilotMetrics(recoveryRecs(evs), evs.flatMap((ev) => ev.drills || [])); };

  // ---- B. the match check, stored with the event before outcomes are known ----
  const cityOf = (ws) => { const s = BB().setupOf(ws) || {}; return s.city || C.profileOf?.(ws)?.city || ""; };
  X.matchSnap = (r, ev) => { if (!ev?.rule || !r.date) return false; const past = r.date < isoDay(clock.now()) || ["done", "cancelled", "declined"].includes(statusOf(r)); if (past) return false;
    const c = P.campOf(r), out = !!c && (c.guests || []).some((g) => g.event === r.id && g.invitedAt), cur = ev.matchCheck; if (cur?.locked) return false; if (cur && !out) return false;
    ev.matchCheck = { profile: matchProfile({ r, ev, guests: c?.guests || [], targets: c?.targets || [], city: cityOf(r.hostWs) }), at: clock.now(), before: true, locked: out, source: out ? "The planned invite list when invites went out" : "The planned invite list when the rule was set" }; return true; };
  X.matchSweep = () => { for (const r of BB().reqs()) { const ev = P.evGet(r.id); if (ev?.rule && X.matchSnap(r, ev)) P.evSet(ev); } };

  // ---- C1. the off-platform follow-up, to each side ----
  X.offAskFor = (r, ev) => { if (ev.offAsk || statusOf(r) !== "done") return false; ev.offAsk = { sentAt: clock.now(), brand: null, host: null };
    BB().tell(ev.owner?.email || r.brandEmail, `${OFF_QUESTION} One tap on ${r.pkgName} answers it.`, `/teams/bookings/${r.id}#offplatform`); BB().tell(BB().ownerEmailOf(r.hostWs), `${OFF_QUESTION} One tap answers it.`, "/host/teams#confirm"); return true; };
  X.offAskView = (ev, side) => (ev.offAsk ? { question: OFF_QUESTION, mine: ev.offAsk[side] || null, note: side === "brand" ? "Only Pottery Lab sees this. The host answers separately." : "Only Pottery Lab sees this. The brand answers separately." } : null);
  const offRoute = (side) => (req, res) => { const E = side === "brand" ? P.brandEvent(req, res) : P.hostEvent(req, res); if (!E) return; if (statusOf(E.r) !== "done") return bad(res, "This opens after the event.", 409, "not_yet");
    const A = cleanOffAnswer(req.body || {}); if (A.error) return bad(res, A.error); X.offAskFor(E.r, E.ev); E.ev.offAsk[side] = A.answer; P.evSet(E.ev); send(res, X.offAskView(E.ev, side)); };
  app.post("/api/teams/events/:id/off-platform", small, offRoute("brand"));
  app.post("/api/bb/host/events/:id/off-platform", small, offRoute("host"));
  X.followupData = () => { const items = []; for (const ev of allEvs()) { if (!ev.offAsk) continue; const r = BB().reqGet(ev.reqId); if (r) items.push({ brandWs: r.brandWs, hostWs: r.hostWs, offAsk: ev.offAsk }); } return followupsOf(items); };
  function sweepAsks() { let n = 0; for (const r of BB().reqs()) { if (statusOf(r) !== "done") continue; const ev = P.evGet(r.id); if (!ev || ev.offAsk) continue; if (X.offAskFor(r, ev)) { P.evSet(ev); n++; } } return n; }

  // ---- the admin measures: on-platform rate, earnings per prep hour, margin, cohorts, the pilot ----
  app.get("/api/admin/brand-measures", (req, res) => { if (!admin(req, res)) return; sweepAsks(); const L = BB().reqs(), today = isoDay(clock.now()), Fl = sys("bpflags") || { foundingHosts: [] };
    const live = L.filter((r) => ["booked", "done"].includes(statusOf(r, today))), evOf = (id) => P.evGet(id) || {}, FU = X.followupData(), offPlatform = {};
    for (const x of BB().allSetups()) offPlatform[x.ws] = S0(x.ws).get("teambook/founding")?.data?.offPlatform || 0;
    const D = durability(L, { evOf, followups: FU.followups, asks: FU.asks, offPlatform, today });
    const bookings = live.map((r) => ({ hostWs: r.hostWs, brandWs: r.brandWs, date: r.date || isoDay(r.createdAt), net: netOf(r), hours: hoursOf(evOf(r.id)) }));
    const E = repeatEarnings(bookings), names = (ws) => C.profileOf?.(ws)?.name || BB().setupOf(ws)?.name || "A host";
    const evs = allEvs(), M = marginReport(live.map((r) => ({ totalCents: r.price?.totalCents || 0, subtotalCents: r.price?.subtotalCents ?? Math.max(0, (r.price?.totalCents || 0) - (r.price?.feeCents || 0) - (r.price?.taxCents || 0)), feeCents: r.price?.feeCents || 0, feeWaivedCents: r.feeWaivedCents || 0, creditCents: r.credit?.cents || 0, replacement: !!evOf(r.id).recoveryOf })), { A: margin(), cancelledRecoveries: evs.filter((ev) => ev.recovery?.state === "cancelled").length });
    // who follows or went to which host, for "followers discover another host"
    const seen = new Map(), add = (e, ws) => { if (!e) return; const k = lc(e); (seen.get(k) || seen.set(k, new Set()).get(k)).add(ws); }, hostWs = [...new Set(live.map((r) => r.hostWs))], fol = new Map();
    for (const ws of hostWs) { let F = []; try { F = C.followersOf(ws) || []; } catch {} fol.set(ws, F.map((f) => lc(f.email)).filter(Boolean)); for (const e of fol.get(ws)) add(e, ws); }
    for (const r of live) { const c = P.campOf(r), ev = evOf(r.id); for (const g of c ? (c.guests || []).filter((g) => g.event === r.id && g.checkedIn) : []) add(g.email, r.hostWs); for (const s of (ev.hostSeats || []).filter((s) => s.checkedIn)) add(s.email, r.hostWs); }
    const CD = cohortDiscovery(hostWs.map((ws) => ({ ws, founding: (Fl.foundingHosts || []).includes(ws), discovered: (fol.get(ws) || []).some((e) => [...(seen.get(e) || [])].some((w) => w !== ws)), bookings: bookings.filter((b) => b.hostWs === ws) })));
    send(res, { onPlatform: D.onPlatform, question: OFF_QUESTION, earnings: { ...E, hosts: E.hosts.map((h) => ({ ...h, name: names(h.hostWs) })) }, margin: M, labels: MARGIN_LABELS, cohorts: CD, pilot: pilotMetrics(recoveryRecs(evs), evs.flatMap((ev) => ev.drills || [])) }); });
  app.post("/api/admin/margin", small, (req, res) => { if (!admin(req, res)) return; const A = cleanMargin(req.body || {}, margin()); sysSet("bpmargin", A); send(res, { assumptions: A }); });

  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => { try { sweepAll(); sweepAsks(); X.matchSweep(); } catch {} }, HOLD.sweepMs); t.unref?.(); }
  return { sweepAll, sweepAsks, margin };
}
