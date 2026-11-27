// The brand panel round: what an operator needs to book one event fast, agree it with the host, and see what came of
// it, without learning event software. Built on the team bookings (server/brandbook.js) and campaigns
// (server/campaigns.js); none of their rules change.
//
//   Quick book ........ date, group size, budget a person, city and goal -> 3 hosts with the total, the money at risk
//                       by date, accessibility and the real availability; book one event with no campaign set up (a
//                       one-event campaign is made behind it, so invites, check-in and the report work the same)
//   Brief ............. co-written by brand and host: goal, the guest mix (brand seats and host seats), the host's
//                       creative control, the brand's role in invitations, photo and content rules, follow-up rules and
//                       what guests do together. Any edit asks the other side to agree again. Shows in the run of show.
//   One event view .... one owner, one timeline, one approval status, and a read-only summary link for finance and
//                       sales (/teams/e/<id>?k=...). Hosts confirm capacity and answer changes in one place.
//   Seats and survey .. who supplied each seat (brand or host); an opt-in survey after the event; connections between
//                       guests that only open when both sides say yes; following the host, separate from the brand
//   Outcomes .......... target accounts invited and attended, meetings and opportunities apart from attendance,
//                       follow-up tasks with an owner, due date and status, cost per target-account guest and per
//                       useful follow-up, metrics per goal, and the denominator next to every number
//   Recommendations ... pooled across brands, only at 10+ people and 3+ events, always with the sample and a
//                       confidence label ("Early signal: 3 events", "Strong: 24 events")
//   Pilot ............. a matched pilot against the brand's usual process, and setup time on repeats
//   Hosts ............. earnings and retention for each host, "Your hosts" and "Book again" for brands, and an
//                       admin-only page of the numbers behind the moat (/admin/brand-metrics)
//
// Docs: system/bpev-<booking id> holds one event's brief, owner, summary key, changes, the host's confirmation,
// host-sourced seats, survey tokens and answers, and connection requests. system/bpsv-<token> points a survey link
// at its event. ws/<host>/teambook/next keeps who asked for a spot at the host's next one (the host's, not the brand's).
//
// Privacy, kept here and tested (test/brand-panel.test.js):
//   - pooled numbers (recommendations, benchmarks) need 10+ people and 3+ events behind them (insights.K)
//   - a host-sourced guest counts toward a target account only if they allowed account matching; the brand sees a
//     host guest's name and email only if they agreed to hear from the brand
//   - connections: a guest is only shown to other guests if they chose to be; contact details pass only when both
//     said yes; the brand sees counts, never who
//   - following the host and asking for the next one are the guest's tie to the host, never brand consent
//   - no guest-level export without consent (CRM sync and CSV are consent only)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scopeStore, getWorkspace, getDbUser, membersOf, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { POLICIES, cancellationTerms, availabilityFor, approxArea, statusOf, isBooked, priceFor, ACCESS } from "./brandbook.js";
import { campaignRole, can, rollup } from "./campaigns.js";
import { K, prefsOf } from "./insights.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { isAdmin } from "./metrics.js";
import { capture } from "./posthog.js";
import * as CRM from "./crmsync.js";
import { EXAMPLE_LINE } from "./brandexamples.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const DAY = 864e5;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => isoDay(Date.parse(d + "T12:00:00Z") + n * DAY);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (d) => (ISO.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const money0 = (c) => "$" + Math.round((+c || 0) / 100).toLocaleString("en-US");
const normCo = (s) => lc(s).replace(/[^a-z0-9 ]/g, " ").replace(/\b(inc|llc|ltd|co|corp|corporation|the)\b/g, " ").replace(/\s+/g, " ").trim();
/** A small number shown with what it's out of: "3 of 12". A share only from 5 answers up, so tiny samples don't shine. */
export const ofN = (n, of, label = "") => ({ n, of, ...(label ? { label } : {}), pct: of >= 5 ? pct(n, of) : null, text: `${n} of ${of}` });

// ---------------------------------------------------------------------------------------------------------------
// Goals: one per event, each with its own report.
export const GOALS = {
  customer: { id: "customer", label: "Customer dinner", line: "Time with the accounts that matter, around one table.", moods: ["client"], together: "roundtable",
    metrics: ["targetsAttended", "meetings", "opportunities", "costPerTarget", "usefulFollowUps"] },
  team: { id: "team", label: "Team bonding", line: "Your own team, doing something side by side.", moods: ["bonding", "handson", "celebrate"], together: "competition",
    metrics: ["showRate", "useful", "back", "costPerGuest"] },
  community: { id: "community", label: "Community", line: "People who come back, and bring someone.", moods: ["bonding", "calm", "celebrate", "client"], together: "introductions",
    metrics: ["returning", "costPerReturning", "nextOptIns", "hostFollows", "useful"] },
  workshop: { id: "workshop", label: "Workshop", line: "Everyone makes or learns something, together.", moods: ["handson"], together: "class",
    metrics: ["showRate", "back", "useful", "costPerGuest"] },
  offsite: { id: "offsite", label: "Team offsite", line: "A day away to plan, think and slow down.", moods: ["calm", "bonding"], together: "roundtable",
    metrics: ["showRate", "useful", "back", "costPerGuest"] },
  wellness: { id: "wellness", label: "Wellness", line: "Yoga, a sound bath or a run: a calmer kind of team time.", moods: ["calm"], together: "class",
    metrics: ["showRate", "back", "costPerGuest"] },
  conference: { id: "conference", label: "Conference week", line: "The side event people remember: a morning run, coffee, a happy hour.", moods: ["celebrate", "bonding", "client"], together: "introductions",
    metrics: ["targetsAttended", "meetings", "useful", "costPerGuest"] },
  celebration: { id: "celebration", label: "Launch or party", line: "A launch, a pop-up or the holiday party.", moods: ["celebrate"], together: "introductions",
    metrics: ["showRate", "useful", "hostFollows", "costPerGuest"] },
  catering: { id: "catering", label: "Food for the office", line: "Office breakfast, a team lunch or a catered company event.", moods: ["services"], together: "standard", service: true,
    metrics: ["showRate", "costPerGuest"] },
  summit: { id: "summit", label: "Summit help", line: "Planning, staff, photos and flowers for your own summit.", moods: ["services"], together: "introductions", service: true,
    metrics: ["targetsAttended", "meetings", "opportunities", "costPerGuest"] },
};
// goals where Quick book also suggests services to add (flowers, photos, food, staff), never instead of the main three
const ADDON_GOALS = ["customer", "celebration", "conference", "community", "offsite", "summit", "catering", "team"];
export const goalOf = (g) => GOALS[g] || null;
export const TOGETHER = {
  introductions: { label: "An introductions plan", line: "The host seats people who should meet and starts each table off." },
  roundtable: { label: "Roundtables", line: "Small discussion groups, a question for each course." },
  competition: { label: "A friendly competition", line: "Teams compete instead of sitting through a class." },
  class: { label: "A hands-on class", line: "Everyone makes something, with the host teaching." },
  standard: { label: "A standard dinner", line: "A seated dinner with no set format." },
};
export const CREATIVE = { host: "The host leads the format and the menu", shared: "The host leads, the brand gives a theme", brand: "The brand sets the format, the host runs it" };
export const INVITES = { brand: "The brand invites all its guests", both: "Both: the brand fills its spots, the host fills theirs", host: "The host invites from their following" };
export const PHOTOS = { none: "No photos or video", host: "Only the host's recap photos, shared after", consent: "The brand may photograph guests who agree", open: "The brand may take photos and short video" };
export const FOLLOWUP = { none: "No follow-up from the brand", consented: "Only guests who agree, within 7 days", sales: "Sales may follow up with guests who agree" };
/** Room rules, standard on every brief: how many of the brand's own staff are in the room, companies kept out, the brand
 *  takes part as a guest (not a presenter), and no pitch. */
export const ROOM_DEFAULTS = { staffCap: 2, competitors: [], asGuest: true, noPitch: true };
export function cleanRoom(b = {}, cur = ROOM_DEFAULTS) {
  const c = { ...ROOM_DEFAULTS, ...(cur || {}) }, list = Array.isArray(b.competitors) ? b.competitors : b.competitors != null ? String(b.competitors).split(/[,\n]/) : c.competitors;
  return { staffCap: b.staffCap != null && b.staffCap !== "" ? int(b.staffCap, 0, 50) : c.staffCap, competitors: [...new Set(list.map((x) => clean(x, 80)).filter(Boolean))].slice(0, 40),
    asGuest: b.asGuest != null ? b.asGuest === true || b.asGuest === "yes" : c.asGuest !== false, noPitch: b.noPitch != null ? b.noPitch === true || b.noPitch === "yes" : c.noPitch !== false };
}
export function roomLines(r) { const R = { ...ROOM_DEFAULTS, ...(r || {}) };
  return [`Brand staff in the room: ${R.staffCap} at most`, R.competitors.length ? `Kept out: guests from ${R.competitors.join(", ")}` : "No companies kept out", R.asGuest ? "The brand takes part as a guest, not a presenter" : "The brand may say a few words", R.noPitch ? "No pitch" : "A short product mention is fine"]; }

// ---------------------------------------------------------------------------------------------------------------
// The money at risk by date: what the brand would lose by cancelling on each day, from the policy's own refund rule
// (brandbook refundFor). The deposit is paid at booking and the rest is due 7 days before.
export function exposureSchedule({ policy = "standard", totalCents = 0, depositCents = 0, date = "", today = isoDay() } = {}) {
  const P = POLICIES[policy] || POLICIES.standard;
  if (!ISO.test(date)) return { rows: [], maxAtRiskCents: depositCents, nowAtRiskCents: 0, freeUntil: "", line: "Pick a date to see what's at risk." };
  const risk = (d) => { const paid = d <= 7 ? totalCents : depositCents; if (d >= P.full) return 0; if (P.half && d >= P.half) return paid - Math.round(paid / 2); return Math.min(paid, depositCents); };
  const lead = daysBetween(today, date), top = Math.max(P.full, lead), groups = [];
  for (let d = top; d >= 0; d--) { const v = risk(d), g = groups[groups.length - 1]; if (g && g.atRiskCents === v) g.low = d; else groups.push({ high: d, low: d, atRiskCents: v }); }
  const rows = groups.map((g) => ({ from: addDays(date, -g.high), until: addDays(date, -g.low), daysBefore: g.low, atRiskCents: g.atRiskCents })).filter((r) => r.until >= today)
    .map((r) => { const from = r.from < today ? today : r.from; return { ...r, from, label: r.atRiskCents ? `${short(from)}${r.until !== from ? ` to ${short(r.until)}` : ""}: ${money0(r.atRiskCents)} at risk` : `Until ${short(r.until)}: nothing at risk, free to cancel` }; });
  const max = Math.max(0, ...groups.map((g) => g.atRiskCents)), free = groups.find((g) => !g.atRiskCents && g.high >= P.full), freeUntil = free && addDays(date, -free.low) >= today ? addDays(date, -free.low) : "";
  // one plain line for the day the number goes up and then comes down (Standard: the rest is due 7 days before, the same
  // day the half-back rule ends). The amounts are the policy's own; this only says why they move.
  const up = rows.findIndex((r, i) => rows[i + 1] && rows[i + 1].atRiskCents < r.atRiskCents && r.atRiskCents > 0), spike = up >= 0 ? rows[up] : null, before = up > 0 ? rows[up - 1] : null, after = up >= 0 ? rows[up + 1] : null;
  const why = spike && after ? `Why it goes up, then down: ${before && before.atRiskCents ? `until ${short(before.until)} only the deposit is paid, so half of it is at risk. ` : ""}On ${short(spike.from)} the rest is due, and half of everything paid is at risk${spike.until === spike.from ? " for that one day" : ""}. From ${short(after.from)} only the ${money0(depositCents)} deposit stays with the host, and the rest comes back.` : "";
  return { rows, why, maxAtRiskCents: max, nowAtRiskCents: lead >= 0 ? risk(lead) : 0, freeUntil, line: freeUntil ? `Free to cancel until ${short(freeUntil)}. After that, up to ${money0(max)} is at risk.` : `Up to ${money0(max)} is at risk if you cancel now.` };
}

/** Accessibility in plain words: what the host has said yes to, and what they haven't listed (never guessed). */
export function accessNotes(pkg = {}) {
  const have = (pkg.access || []).filter((a) => ACCESS.includes(a));
  return { listed: have, missing: ACCESS.filter((a) => !have.includes(a)), line: have.length ? `${have.map((a) => a[0].toUpperCase() + a.slice(1)).join(", ")}.` : "The host hasn't listed accessibility details yet. Ask before you book.", diets: pkg.diets || [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Quick book: rank what's bookable for one event and keep 3. Hard rules: the group fits, the city matches. Then the
// goal, the exact date being open, the budget and the host's track record.
export function quickRank(cands = [], { date = "", people = 0, budgetCents = 0, city = "", goal = "" } = {}) {
  const G = goalOf(goal), C = lc(city);
  const sizeOk = (x) => !people || (people >= x.minGuests && people <= x.maxGuests), cityOk = (x) => !C || [x.city, x.areaCity, x.area, ...(x.alsoIn || [])].map(lc).includes(C) || (C === "new york" && ["brooklyn", "manhattan", "queens"].includes(lc(x.areaCity)));
  let fits = cands.filter((x) => sizeOk(x) && cityOk(x) && !x.remote), near = false;
  // nothing fits every filter: show the closest hosts instead of an empty box, each with what doesn't match
  if (!fits.length) { near = true; fits = cands.filter((x) => !x.remote).map((x) => ({ ...x, miss: [!cityOk(x) ? `In ${x.areaCity || x.city || "another city"}` : "", !sizeOk(x) ? `Takes ${x.minGuests}${x.maxGuests > x.minGuests ? "–" + x.maxGuests : ""} guests` : ""].filter(Boolean) })); }
  const scored = fits.map((x) => { let s = near ? -25 * (x.miss || []).length : 0; const why = [];
    const moodHit = G ? (x.moods || []).filter((m) => G.moods.includes(m)).length : 0, goalHit = !!G && (x.goals || []).includes(G.id);
    if (G) { s += goalHit ? 50 + ((x.goals || [])[0] === G.id ? 8 : 0) : moodHit ? 30 + 5 * moodHit : 0; if (goalHit || moodHit) why.push(G.service ? `Fits ${G.label.toLowerCase()}` : `Suits a ${G.label.toLowerCase()}`); }
    if (x.dateState === "open") { s += 40; why.push("Open on your date"); } else if (x.altDate) s += 15;
    const pp = x.effectivePerPersonCents || x.perPersonCents; if (budgetCents) { if (pp <= budgetCents) { s += 20; why.push("Inside your budget"); } else s -= Math.min(40, Math.round(((pp - budgetCents) / budgetCents) * 100)); }
    s += Math.round((x.quality || 0) * 0.3) + (x.trusted ? 5 : 0);
    return { ...x, score: s, why, near, miss: x.miss || [], overBudgetCents: budgetCents && pp > budgetCents ? pp - budgetCents : 0 }; });
  scored.sort((a, b) => b.score - a.score || a.totalCents - b.totalCents);
  const seen = new Set(), out = []; for (const x of scored) { if (seen.has(x.handle)) continue; seen.add(x.handle); out.push(x); if (out.length === 3) break; } // three different hosts
  return out;
}

/** quickRank, real hosts first: up to 3 real hosts that fit; example hosts fill what's left; the closest of either
 *  only when nothing fits. An example never takes a real host's place. */
export function realFirst(cands = [], q = {}) {
  const R = quickRank(cands.filter((x) => !x.host?.example), q), E = quickRank(cands.filter((x) => x.host?.example), q);
  const fit = R.filter((x) => !x.near); if (fit.length >= 3) return fit.slice(0, 3);
  const out = [...fit], seen = new Set(fit.map((x) => x.handle)), add = (L) => { for (const x of L) { if (out.length >= 3) break; if (!seen.has(x.handle)) { seen.add(x.handle); out.push(x); } } };
  add(E.filter((x) => !x.near)); add(R.filter((x) => x.near)); add(E.filter((x) => x.near));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The brief: brand and host write it together. Any edit bumps the version; the one who edited agrees to their own
// version, the other side is asked again.
export function briefDefaults(goal = "customer", headcount = 12) {
  const G = goalOf(goal) || GOALS.customer, n = int(headcount, 0, 2000), host = G.id === "community" ? Math.floor(n / 2) : 0;
  return { v: 1, goal: G.id, goalNote: "", mix: { brand: n - host, host }, room: { ...ROOM_DEFAULTS }, creative: "host", creativeNote: "", invites: host ? "both" : "brand", photos: "consent", photoNote: "", followup: "consented", followupNote: "", together: G.together, plan: "", brandAgreed: null, hostAgreed: null, history: [] };
}
const pickKey = (v, M, d) => (Object.prototype.hasOwnProperty.call(M, v) ? v : d);
/** Clean an edit to the brief. Returns { brief } or { error }. */
export function editBrief(cur, b = {}, { side = "brand", who = "", headcount = 0, now = Date.now() } = {}) {
  const base = cur || briefDefaults(b.goal, headcount), next = { ...base, mix: { ...base.mix } };
  if (b.goal != null) next.goal = pickKey(b.goal, GOALS, base.goal);
  for (const [k, M] of [["creative", CREATIVE], ["invites", INVITES], ["photos", PHOTOS], ["followup", FOLLOWUP], ["together", TOGETHER]]) if (b[k] != null) next[k] = pickKey(b[k], M, base[k]);
  for (const k of ["goalNote", "creativeNote", "photoNote", "followupNote"]) if (b[k] != null) next[k] = clean(b[k], 300);
  if (b.plan != null) next.plan = clean(b.plan, 500);
  if (b.mix) { next.mix = { brand: int(b.mix.brand ?? base.mix.brand, 0, 2000), host: int(b.mix.host ?? base.mix.host, 0, 2000) }; }
  next.room = b.room && typeof b.room === "object" ? cleanRoom(b.room, base.room) : cleanRoom({}, base.room);
  if (headcount && next.mix.brand + next.mix.host > headcount) return { error: `The spots add up to ${next.mix.brand + next.mix.host}, more than the group of ${headcount}.` };
  if (next.invites === "brand" && next.mix.host > 0) next.invites = "both";
  const changed = ["goal", "goalNote", "creative", "creativeNote", "invites", "photos", "photoNote", "followup", "followupNote", "together", "plan"].some((k) => next[k] !== base[k]) || next.mix.brand !== base.mix.brand || next.mix.host !== base.mix.host || JSON.stringify(next.room) !== JSON.stringify(cleanRoom({}, base.room));
  if (cur && changed) next.v = (base.v || 1) + 1;
  const mark = { by: clean(who, 80), at: now, v: next.v };
  if (side === "brand") { next.brandAgreed = mark; if (changed && cur) next.hostAgreed = base.hostAgreed && base.hostAgreed.v === next.v ? base.hostAgreed : null; }
  else { next.hostAgreed = mark; if (changed && cur) next.brandAgreed = base.brandAgreed && base.brandAgreed.v === next.v ? base.brandAgreed : null; }
  next.history = [...(base.history || []), { at: now, by: side, what: !cur ? "wrote the brief" : changed ? `changed the brief (version ${next.v})` : "agreed to the brief" }].slice(-30);
  return { brief: next, changed };
}
export const agreeBrief = (cur, side, who, now = Date.now()) => editBrief(cur, {}, { side, who, now }).brief;
export function briefState(b) {
  if (!b) return { agreed: false, waitingOn: "brand", line: "No brief yet." };
  const brand = b.brandAgreed?.v === b.v, host = b.hostAgreed?.v === b.v;
  return { agreed: brand && host, brand, host, waitingOn: brand && host ? null : !brand ? "brand" : "host", line: brand && host ? `Agreed by both sides (version ${b.v})` : !host ? "Waiting on the host to agree" : "Waiting on your team to agree" };
}
/** The brief in plain lines, for the run of show, the summary and the host. */
export function briefLines(b) {
  if (!b) return [];
  const G = goalOf(b.goal), T = TOGETHER[b.together];
  return [`Goal: ${G?.label || "Event"}${b.goalNote ? `. ${b.goalNote}` : ""}`, `Guest mix: ${b.mix.brand} brand-invited ${b.mix.brand === 1 ? "spot" : "spots"}, ${b.mix.host} host-sourced ${b.mix.host === 1 ? "spot" : "spots"}`,
    `Creative control: ${CREATIVE[b.creative]}${b.creativeNote ? `. ${b.creativeNote}` : ""}`, `Invitations: ${INVITES[b.invites]}`, `Photos and content: ${PHOTOS[b.photos]}${b.photoNote ? `. ${b.photoNote}` : ""}`,
    `Follow-up: ${FOLLOWUP[b.followup]}${b.followupNote ? `. ${b.followupNote}` : ""}`, `Together: ${T?.label || ""}. ${b.plan || T?.line || ""}`.trim(), `Room rules: ${roomLines(b.room).join(". ")}`];
}
const ROS_TAG = "Brief: ";
/** The run of show with the brief in it: the main part says what guests do; doors carry the photo rule; the wrap the follow-up rule. */
export function rosWithBrief(items = [], b) {
  if (!b) return items; const T = TOGETHER[b.together], out = items.filter((x) => !String(x.what || "").startsWith(ROS_TAG)).map((x) => ({ ...x }));
  const main = out.find((x) => /^The main part$/i.test(x.what)); if (main && T) main.what = `${T.label}: ${clean(b.plan || T.line, 120)}`;
  const doors = out.findIndex((x) => /^Doors open/i.test(x.what)), wrap = out.findIndex((x) => /^Thanks/i.test(x.what));
  if (doors >= 0) out.splice(doors + 1, 0, { at: out[doors].at, what: `${ROS_TAG}${PHOTOS[b.photos]}` });
  const w2 = wrap >= 0 ? out.findIndex((x) => /^Thanks/i.test(x.what)) : -1;
  if (w2 >= 0) out.splice(w2 + 1, 0, { at: out[w2].at, what: `${ROS_TAG}follow-up ${FOLLOWUP[b.followup].toLowerCase()}` });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Seats: who supplied each one. Brand seats are the campaign's guests for the event; host seats are the host's own.
export function seatMix(brandGuests = [], hostSeats = [], plan = null) {
  const bg = brandGuests.filter((g) => g.status !== "asked");
  return { planned: plan ? { brand: plan.brand, host: plan.host } : null,
    brand: { invited: bg.filter((g) => g.invitedAt || ["invited", "yes", "no"].includes(g.status)).length, yes: bg.filter((g) => g.status === "yes").length, attended: bg.filter((g) => g.checkedIn).length },
    host: { added: hostSeats.length, attended: hostSeats.filter((s) => s.checkedIn).length, followers: hostSeats.filter((s) => s.follower).length, followersAttended: hostSeats.filter((s) => s.follower && s.checkedIn).length },
    attended: bg.filter((g) => g.checkedIn).length + hostSeats.filter((s) => s.checkedIn).length };
}

// ---------------------------------------------------------------------------------------------------------------
// The survey: short, opt in, every consent separate and off until ticked. Totals always come with what they're out of.
export function cleanAnswer(b = {}, cur = {}) {
  const yn = (v, d) => (v === true || v === "yes" ? true : v === false || v === "no" ? false : d ?? null), r15 = (v, d) => (v == null || v === "" ? d ?? null : int(v, 1, 5));
  return { useful: yn(b.useful, cur.useful), back: yn(b.back, cur.back), before: r15(b.before, cur.before), after: r15(b.after, cur.after), said: b.said != null ? clean(b.said, 600) : cur.said || "", quoteOk: b.quoteOk != null ? b.quoteOk === true : !!cur.quoteOk,
    matchOk: b.matchOk != null ? b.matchOk === true : !!cur.matchOk, company: b.company != null ? clean(b.company, 100) : cur.company || "", contactOk: b.contactOk != null ? b.contactOk === true : !!cur.contactOk,
    followHost: b.followHost != null ? b.followHost === true : !!cur.followHost, nextOk: b.nextOk != null ? b.nextOk === true : !!cur.nextOk, listed: b.listed != null ? b.listed === true : !!cur.listed,
    contact: b.contact != null ? clean(b.contact, 160) : cur.contact || "", takeaway: b.takeaway != null ? clean(b.takeaway, 600) : cur.takeaway || "",
    similarOk: b.similarOk != null ? b.similarOk === true : !!cur.similarOk, at: Date.now() };
}
/** The event's survey, counted. `tokens` say who could answer (and from which side); `responses` what they said. */
export function surveySummary(tokens = {}, responses = {}) {
  const T = Object.entries(tokens), R = T.map(([t, x]) => ({ ...x, r: responses[t] })).filter((x) => x.r), hostR = R.filter((x) => x.side === "host");
  const yes = (k) => R.filter((x) => x.r[k] === true).length, answered = (k) => R.filter((x) => x.r[k] != null).length;
  const perc = R.filter((x) => x.r.before != null && x.r.after != null);
  return { asked: T.length, respondents: R.length, useful: ofN(yes("useful"), answered("useful"), "made a useful connection"), back: ofN(yes("back"), answered("back"), "want to come back"),
    perception: perc.length >= 5 ? { n: perc.length, before: +(perc.reduce((a, x) => a + x.r.before, 0) / perc.length).toFixed(1), after: +(perc.reduce((a, x) => a + x.r.after, 0) / perc.length).toFixed(1) } : { n: perc.length, before: null, after: null },
    matchOk: ofN(hostR.filter((x) => x.r.matchOk).length, hostR.length, "host guests who allowed account matching"), contactOk: ofN(yes("contactOk"), R.length, "agreed to hear from you"),
    followHost: ofN(yes("followHost"), R.length, "followed the host"), nextOk: ofN(yes("nextOk"), R.length, "asked for a spot at the next one"), listed: ofN(yes("listed"), R.length, "open to staying in touch"),
    quotes: R.filter((x) => x.r.quoteOk && String(x.r.said || "").length > 12).slice(0, 4).map((x) => ({ text: x.r.said, name: x.first || "" })) };
}

// ---------------------------------------------------------------------------------------------------------------
// Connections between guests: asked for by one, opened only when the other says yes. Guests choose to be listed.
export function askConnection(ev, from, to) {
  const R = ev.survey?.responses || {}; if (from === to) return { error: "That's you." };
  if (!R[from]?.listed) return { error: "Choose to stay in touch first, then pick people." };
  if (!R[to]?.listed) return { error: "That guest hasn't chosen to be listed." };
  const L = (ev.connections ||= []); let c = L.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
  if (!c) { c = { id: rid(4), a: from, b: to, aYes: true, bYes: null, at: Date.now() }; L.push(c); }
  else if (c.b === from) c.bYes = true; else c.aYes = true;
  return { ok: true, mutual: c.aYes === true && c.bYes === true };
}
export function answerConnection(ev, me, other, yes) { const c = (ev.connections || []).find((x) => x.a === other && x.b === me); if (!c) return { error: "No request from that guest." }; c.bYes = !!yes; c.answeredAt = Date.now(); return { ok: true, mutual: c.aYes && c.bYes }; }
export function withdrawListing(ev, me) { for (const c of ev.connections || []) { if (c.a === me && !c.bYes) c.aYes = false; if (c.b === me && c.bYes == null) c.bYes = false; } }
/** What one guest sees: who asked them, who they asked, and contact details only for people who both said yes. */
export function connectionsFor(ev, me) {
  const T = ev.survey?.tokens || {}, R = ev.survey?.responses || {}, name = (t) => T[t]?.first || "A guest", contact = (t) => R[t]?.contact || T[t]?.email || "";
  const L = (ev.connections || []).filter((c) => c.a === me || c.b === me);
  return { incoming: L.filter((c) => c.b === me && c.aYes && c.bYes == null).map((c) => ({ from: c.a, first: name(c.a) })),
    asked: L.filter((c) => c.a === me && c.aYes && c.bYes !== true).map((c) => c.b),
    mutual: L.filter((c) => c.aYes && c.bYes).map((c) => { const o = c.a === me ? c.b : c.a; return { token: o, first: name(o), contact: contact(o) }; }) };
}
export function connectionCounts(ev) {
  const R = ev.survey?.responses || {}, L = (ev.connections || []).filter((c) => c.aYes), M = L.filter((c) => c.bYes === true), people = new Set(M.flatMap((c) => [c.a, c.b]));
  return { listed: ofN(Object.values(R).filter((r) => r.listed).length, Object.keys(R).length, "open to staying in touch"), asked: L.length, mutual: M.length, guestsConnected: ofN(people.size, Object.keys(R).length, "made a connection both agreed to") };
}

// ---------------------------------------------------------------------------------------------------------------
// Follow-up tasks for sales and content, and what came of them.
export const TASK_TEAMS = { sales: "Sales", content: "Content", marketing: "Marketing" };
export const TASK_STATUS = { open: "To do", doing: "In progress", done: "Done" };
export function cleanTask(b = {}, cur = {}, { members = [] } = {}) {
  const owner = lc(b.owner ?? cur.owner); if (b.owner != null && owner && !members.map(lc).includes(owner)) return { error: "The owner has to be on your team." };
  const title = clean(b.title ?? cur.title, 140); if (!title) return { error: "Say what needs doing." };
  return { task: { id: cur.id || rid(4), title, team: pickKey(b.team ?? cur.team, TASK_TEAMS, "sales"), owner, due: ISO.test(b.due || "") ? b.due : b.due === "" ? "" : cur.due || "", status: pickKey(b.status ?? cur.status, TASK_STATUS, "open"),
    result: b.result != null ? pickKey(b.result, { useful: 1, none: 1, "": 1 }, "") : cur.result || "", event: clean(b.event ?? cur.event, 24), guest: clean(b.guest ?? cur.guest, 24), auto: !!cur.auto, at: cur.at || Date.now(), doneAt: (b.status ?? cur.status) === "done" ? cur.doneAt || Date.now() : 0 } };
}
export function taskSummary(tasks = [], today = isoDay()) {
  const open = tasks.filter((t) => t.status !== "done");
  return { total: tasks.length, open: open.length, done: tasks.length - open.length, overdue: open.filter((t) => t.due && t.due < today).length, useful: tasks.filter((t) => t.status === "done" && t.result === "useful").length,
    byTeam: Object.fromEntries(Object.keys(TASK_TEAMS).map((k) => [k, { open: open.filter((t) => t.team === k).length, done: tasks.filter((t) => t.team === k && t.status === "done").length }])) };
}
export function cleanOutcome(b = {}) { const kind = b.kind === "opportunity" ? "opportunity" : b.kind === "meeting" ? "meeting" : ""; if (!kind) return { error: "Pick a meeting or an opportunity." };
  const account = clean(b.account, 100); if (!account) return { error: "Which account?" };
  return { outcome: { id: rid(4), kind, account, amountCents: kind === "opportunity" ? Math.max(0, Math.round(+String(b.amount ?? "").replace(/[^\d.]/g, "") * 100) || 0) : 0, event: clean(b.event, 24), note: clean(b.note, 200), date: ISO.test(b.date || "") ? b.date : isoDay(), at: Date.now() } }; }

// ---------------------------------------------------------------------------------------------------------------
// Outcomes for one campaign (or one-event booking): attendance, meetings and opportunities apart, target accounts,
// the survey, connections, cost per target-account guest and per useful follow-up, and metrics for each goal.
export function outcomesOf(c, events = [], { today = isoDay() } = {}) {
  const targets = [...new Set((c.targets || []).map(normCo).filter(Boolean))], isT = (co) => !!co && targets.includes(normCo(co));
  const R = rollup(c, events.map((e) => e.r), today), byId = new Map(R.events.map((e) => [e.id, e]));
  const tasks = c.tasks || [], outs = c.outcomes || [], legacyMeetings = (c.guests || []).filter((g) => g.followUp === "meeting").length;
  const per = events.map(({ r, ev }) => { const st = statusOf(r, today), E = byId.get(r.id) || {}, G = (c.guests || []).filter((g) => g.event === r.id), H = ev?.hostSeats || [], S = surveySummary(ev?.survey?.tokens, ev?.survey?.responses);
    const resp = ev?.survey?.responses || {}, tok = ev?.survey?.tokens || {};
    const hostMatched = H.filter((s) => s.checkedIn && Object.entries(tok).some(([t, x]) => x.side === "host" && x.sid === s.id && resp[t]?.matchOk && isT(resp[t]?.company)));
    const tInvited = new Set(G.filter((g) => (g.invitedAt || ["invited", "yes", "no"].includes(g.status)) && isT(g.company)).map((g) => normCo(g.company)));
    const tAttended = new Set([...G.filter((g) => g.checkedIn && isT(g.company)).map((g) => normCo(g.company)), ...hostMatched.map((s) => { const t = Object.entries(tok).find(([, x]) => x.side === "host" && x.sid === s.id)?.[0]; return normCo(resp[t]?.company); })]);
    const returning = H.filter((s) => s.checkedIn && s.returning).length;
    return { id: r.id, name: r.pkgName, handle: r.handle, date: r.date || "", status: st, goal: ev?.brief?.goal || "", format: ev?.brief?.together || "", costCents: E.costCents || 0,
      seats: seatMix(G, H, ev?.brief?.mix), targets: { invited: [...tInvited], attended: [...tAttended] }, survey: S, connections: connectionCounts(ev || {}), returning,
      meetings: outs.filter((o) => o.kind === "meeting" && o.event === r.id).length, opportunities: outs.filter((o) => o.kind === "opportunity" && o.event === r.id).length }; });
  const sum = (f) => per.reduce((a, e) => a + f(e), 0), done = per.filter((e) => e.status === "done");
  const attended = sum((e) => e.seats.attended), cost = R.budget.committedCents, doneCost = done.reduce((a, e) => a + e.costCents, 0), doneAtt = done.reduce((a, e) => a + e.seats.attended, 0);
  const tAtt = new Set(per.flatMap((e) => e.targets.attended)), tInv = new Set(per.flatMap((e) => e.targets.invited)), T = taskSummary(tasks, today);
  const S = { respondents: sum((e) => e.survey.respondents), asked: sum((e) => e.survey.asked) }, agg = (k) => ofN(sum((e) => e.survey[k].n), sum((e) => e.survey[k].of), per[0]?.survey[k].label || "");
  const opps = outs.filter((o) => o.kind === "opportunity"), meetings = outs.filter((o) => o.kind === "meeting").length + legacyMeetings;
  const hostSeats = sum((e) => e.seats.host.added), hostAtt = sum((e) => e.seats.host.attended), returning = sum((e) => e.returning) + returningAcross(c, events);
  const cohorts = { attended, brandAttended: sum((e) => e.seats.brand.attended), hostAttended: hostAtt };
  const totals = {
    attendance: { attended, brand: ofN(cohorts.brandAttended, sum((e) => e.seats.brand.yes), "brand guests who were in came"), host: ofN(hostAtt, hostSeats, "host-sourced guests came") },
    meetings, opportunities: { n: opps.length, amountCents: opps.reduce((a, o) => a + o.amountCents, 0) },
    targets: { accounts: targets.length, invited: ofN(tInv.size, targets.length, "target accounts invited"), attended: ofN(tAtt.size, targets.length, "target accounts came"), hostMatched: agg("matchOk") },
    survey: { respondents: ofN(S.respondents, S.asked, "guests answered the survey"), useful: agg("useful"), back: agg("back"), contactOk: agg("contactOk"), followHost: agg("followHost"), nextOk: agg("nextOk") },
    connections: { guestsConnected: ofN(sum((e) => e.connections.guestsConnected.n), S.respondents, "made a connection both agreed to"), mutual: sum((e) => e.connections.mutual) },
    tasks: T, returning: ofN(returning, attended, "guests came back"),
    costCents: cost, costPerTargetCents: tAtt.size ? Math.round(doneCost / tAtt.size) : null, costPerUsefulFollowUpCents: T.useful ? Math.round(doneCost / T.useful) : null,
    costPerGuestCents: doneAtt ? Math.round(doneCost / doneAtt) : null, costPerReturningCents: returning ? Math.round(doneCost / returning) : null };
  const goals = [...new Set(per.map((e) => e.goal).filter(Boolean))].map((g) => ({ goal: g, label: GOALS[g].label, events: per.filter((e) => e.goal === g).length, metrics: goalMetrics(g, per.filter((e) => e.goal === g), { tasks, outs, targets }) }));
  return { events: per, totals, goals, denominators: denominatorsOf(totals, hostSeats) };
}
/** Guests (by email) who came to more than one of this campaign's events: the community goal's repeat attendance. */
function returningAcross(c, events) { const seen = new Map(); for (const g of c.guests || []) if (g.checkedIn && g.email) seen.set(g.email, (seen.get(g.email) || 0) + 1); for (const { ev } of events) for (const s of ev?.hostSeats || []) if (s.checkedIn && s.email && !s.returning) seen.set(s.email, (seen.get(s.email) || 0) + 1); return [...seen.values()].filter((n) => n > 1).length; }
/** Each goal's own report: a customer dinner counts accounts and pipeline, a community counts people who come back. */
export function goalMetrics(goal, per = [], { tasks = [], outs = [], targets = [] } = {}) {
  const sum = (f) => per.reduce((a, e) => a + f(e), 0), ids = new Set(per.map((e) => e.id)), done = per.filter((e) => e.status === "done"), cost = done.reduce((a, e) => a + e.costCents, 0);
  const att = sum((e) => (e.status === "done" ? e.seats.attended : 0)), yes = sum((e) => (e.status === "done" ? e.seats.brand.yes + e.seats.host.added : 0)), agg = (k) => ofN(sum((e) => e.survey[k].n), sum((e) => e.survey[k].of));
  const tAtt = new Set(per.flatMap((e) => e.targets.attended)), useful = tasks.filter((t) => ids.has(t.event) && t.status === "done" && t.result === "useful").length, ret = sum((e) => e.returning);
  const M = {
    targetsAttended: { label: "Target accounts that came", ...ofN(tAtt.size, targets.length) },
    meetings: { label: "Meetings logged", n: outs.filter((o) => o.kind === "meeting" && ids.has(o.event)).length, text: String(outs.filter((o) => o.kind === "meeting" && ids.has(o.event)).length) },
    opportunities: { label: "Opportunities logged", n: outs.filter((o) => o.kind === "opportunity" && ids.has(o.event)).length, text: String(outs.filter((o) => o.kind === "opportunity" && ids.has(o.event)).length) },
    costPerTarget: { label: "Cost per target-account guest", cents: tAtt.size ? Math.round(cost / tAtt.size) : null, text: tAtt.size ? money0(cost / tAtt.size) : "Not yet" },
    usefulFollowUps: { label: "Useful follow-ups", n: useful, text: String(useful), costCents: useful ? Math.round(cost / useful) : null },
    showRate: { label: "Came, of the people expected", ...ofN(att, yes) }, useful: { label: "Made a useful connection", ...agg("useful") }, back: { label: "Want to come back", ...agg("back") },
    costPerGuest: { label: "Cost per guest who came", cents: att ? Math.round(cost / att) : null, text: att ? money0(cost / att) : "Not yet" },
    returning: { label: "Returning guests", ...ofN(ret, att) }, costPerReturning: { label: "Cost per returning guest", cents: ret ? Math.round(cost / ret) : null, text: ret ? money0(cost / ret) : "Not yet" },
    nextOptIns: { label: "Asked for a spot at the next one", ...agg("nextOk") }, hostFollows: { label: "Followed the host", ...agg("followHost") },
  };
  return (GOALS[goal]?.metrics || []).map((k) => ({ k, ...M[k] }));
}
function denominatorsOf(T, hostSeats) {
  return [{ label: "Host-sourced guests", n: T.attendance.host.n, of: hostSeats, text: `${T.attendance.host.n} came of ${hostSeats} added` },
    { ...T.survey.respondents, label: "Survey respondents" }, { ...T.targets.hostMatched, label: "Host guests who allowed account matching" }, { ...T.survey.contactOk, label: "Guests who agreed to be contacted" }];
}

// ---------------------------------------------------------------------------------------------------------------
// Recommendations from outcomes: pooled across brands, only past the privacy floor, always with the sample size and a
// confidence label. Ordered by a shrunk rate (pulled toward an even split until there are many events behind it) so
// a lucky run of a few events can't top the list.
export function confidenceOf(events) {
  if (!(events >= K.events)) return null;
  if (events < 10) return { level: "early", label: `Early signal: ${events} events`, note: "Early signals can change. Treat this as a lead, not a ranking." };
  if (events < 20) return { level: "building", label: `Building: ${events} events`, note: "A pattern is forming. Worth testing." };
  return { level: "strong", label: `Strong: ${events} events`, note: "Holds across many events." };
}
export function recommend(cells = [], { minPeople = K.people, minEvents = K.events } = {}) {
  const shown = cells.filter((x) => x.respondents >= minPeople && x.events >= minEvents && x.people >= minPeople).map((x) => {
    const rate = pct(x.useful, x.respondents), w = x.events / (x.events + 5), est = w * (x.useful / x.respondents) + (1 - w) * 0.5, C = confidenceOf(x.events);
    return { ...x, usefulPct: rate, estimate: Math.round(est * 100), confidence: C, sample: `${x.respondents} guests answered, across ${x.events} events` }; });
  shown.sort((a, b) => b.estimate - a.estimate || b.events - a.events);
  const ranked = shown.length > 1 && shown.slice(0, 2).every((x) => x.confidence.level !== "early");
  return { items: shown, ranked, hidden: cells.length - shown.length, note: ranked ? "Ordered by useful connections, adjusted for sample size." : shown.length ? "Not enough events yet to rank these. Each one is a lead to test." : "" };
}

// ---------------------------------------------------------------------------------------------------------------
// Pilot: a matched pilot against the brand's usual process.
export const PILOT_ROWS = [
  { k: "planningHours", label: "Marketer planning hours", better: "lower", unit: "h" },
  { k: "approvalSteps", label: "Approval steps", better: "lower", unit: "" },
  { k: "attendance", label: "Guests who came", better: "higher", unit: "" },
  { k: "daysToList", label: "Days to a usable follow-up list for sales", better: "lower", unit: "d" },
];
export function cleanPilot(b = {}, cur = {}) { const n = (v, d) => (v === "" || v == null ? d ?? null : Math.max(0, Math.min(100000, Math.round(+v * 10) / 10)));
  const base = b.baseline || {}, ours = b.ours || {}, cb = cur.baseline || {}, co = cur.ours || {};
  return { on: b.on != null ? !!b.on : cur.on !== false, label: clean(b.label ?? cur.label ?? "Our usual process", 80), baseline: Object.fromEntries(PILOT_ROWS.map((r) => [r.k, n(base[r.k], cb[r.k])])), ours: { planningHours: n(ours.planningHours, co.planningHours) }, at: cur.at || Date.now() }; }
export function pilotCompare(p = {}, auto = {}, setups = []) {
  const ours = { ...auto, ...Object.fromEntries(Object.entries(p.ours || {}).filter(([, v]) => v != null)) };
  const rows = PILOT_ROWS.map((r) => { const a = p.baseline?.[r.k], b = ours[r.k]; if (a == null || b == null) return { ...r, usual: a ?? null, ours: b ?? null, change: null, better: null, line: "" };
    const diff = b - a, better = r.better === "lower" ? diff < 0 : diff > 0, change = a ? Math.round((diff / a) * 100) : null;
    return { ...r, usual: a, ours: b, change, improved: diff === 0 ? null : better, line: diff === 0 ? "The same" : `${Math.abs(Math.round(diff * 10) / 10)}${r.unit} ${diff < 0 ? "fewer" : "more"}${change != null ? ` (${Math.abs(change)}%)` : ""}` }; });
  const S = setups.filter((x) => x.minutes != null).map((x, i) => ({ n: i + 1, minutes: x.minutes, name: x.name, date: x.date }));
  return { rows, setup: { times: S, falling: S.length >= 2 ? S[S.length - 1].minutes < S[0].minutes : null, line: S.length >= 2 ? `Setup took ${S[0].minutes} minutes the first time and ${S[S.length - 1].minutes} minutes on the latest.` : S.length ? `Setup took ${S[0].minutes} minutes. Book again to see it fall.` : "" },
    filled: rows.filter((r) => r.usual != null && r.ours != null).length };
}

// ---------------------------------------------------------------------------------------------------------------
// Hosts: earnings and retention for one host, and the same numbers across all of them for us.
const paidOf = (r) => Math.max(0, (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + (p.cents || 0), 0) - (r.refund?.cents || 0));
const revenueOf = (r, today) => { const st = statusOf(r, today); return ["accepted", "booked", "done"].includes(st) ? r.price?.totalCents || 0 : st === "cancelled" ? paidOf(r) : 0; };
export function hostEarnings(reqs = [], { hostSeats = {}, followerEmails = new Set(), today = isoDay() } = {}) {
  const live = reqs.filter((r) => revenueOf(r, today) > 0).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.createdAt - b.createdAt);
  const byBrand = new Map(); let repeat = 0, total = 0, audience = 0; const months = {};
  for (const r of live) { const k = r.brandWs || lc(r.company), n = (byBrand.get(k) || 0) + 1, v = revenueOf(r, today); byBrand.set(k, n); total += v; if (n > 1) repeat += v;
    if (r.via === "host-page" || r.via === "follower" || followerEmails.has(lc(r.brandEmail))) audience++; const m = (r.date || isoDay(r.createdAt)).slice(0, 7); months[m] = (months[m] || 0) + v; }
  const brands = byBrand.size, rebooked = [...byBrand.values()].filter((n) => n > 1).length, seats = live.flatMap((r) => hostSeats[r.id] || []), fromFollowers = seats.filter((s) => s.follower).length;
  return { revenueCents: total, repeatRevenueCents: repeat, repeatSharePct: pct(repeat, total), bookings: live.length,
    brandRebook: ofN(rebooked, brands, "brands booked again"), followerFill: ofN(fromFollowers, seats.length, "of your spots filled by your followers"), fromAudience: ofN(audience, live.length, "bookings came from your audience"),
    months: Object.entries(months).sort().map(([month, cents]) => ({ month, cents })) };
}
export function internalMetrics(reqs = [], { hostSeats = {}, followerShare = [], today = isoDay() } = {}) {
  const live = reqs.filter((r) => revenueOf(r, today) > 0), byHost = new Map(), byBrand = new Map();
  for (const r of live) { (byHost.get(r.hostWs) || byHost.set(r.hostWs, []).get(r.hostWs)).push(r); (byBrand.get(r.brandWs) || byBrand.set(r.brandWs, []).get(r.brandWs)).push(r); }
  const mOf = (r) => (r.date || isoDay(r.createdAt)).slice(0, 7), mIdx = (m) => +m.slice(0, 4) * 12 + +m.slice(5, 7);
  const cohorts = {}; for (const [ws, L] of byHost) { const ms = [...new Set(L.map(mOf))].sort(), c = ms[0]; const C = (cohorts[c] ||= { cohort: c, hosts: 0, again90: 0, againAny: 0 }); C.hosts++; if (ms.length > 1) C.againAny++; if (ms.some((m) => m !== c && mIdx(m) - mIdx(c) <= 3)) C.again90++; }
  const H = [...byHost.entries()].map(([ws, L]) => { const E = hostEarnings(L, { hostSeats, today }); return { ws, repeatRevenueCents: E.repeatRevenueCents, revenueCents: E.revenueCents }; });
  const brands = [...byBrand.values()], seats = live.flatMap((r) => hostSeats[r.id] || []);
  const fs = followerShare.reduce((a, x) => ({ n: a.n + x.fromFollowers, of: a.of + x.attended }), { n: 0, of: 0 });
  return { cohorts: Object.values(cohorts).sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => ({ ...c, again90Pct: pct(c.again90, c.hosts), againAnyPct: pct(c.againAny, c.hosts) })),
    brandRebook: ofN(brands.filter((L) => L.length > 1).length, brands.length, "brands booked again"), sameHostRebook: ofN(brands.filter((L) => new Set(L.map((r) => r.hostWs)).size < L.length).length, brands.length, "brands rebooked the same host"),
    repeatRevenuePerHostCents: H.length ? Math.round(H.reduce((a, x) => a + x.repeatRevenueCents, 0) / H.length) : 0, hosts: H.length, repeatHosts: ofN(H.filter((x) => x.repeatRevenueCents > 0).length, H.length, "hosts with repeat revenue"),
    teamSeatsFromFollowers: ofN(seats.filter((s) => s.follower).length, seats.length, "host-sourced team spots went to followers"), ownEventsFromFollowers: ofN(fs.n, fs.of, "guests at hosts' own events were followers") };
}

// ---------------------------------------------------------------------------------------------------------------
export function mountBrandPanel(app, { store, small, currentUser, C, X, PUBLIC_DIR = "", publicOrigin = () => "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const BB = () => X.bb;
  const me = (req) => { const u = currentUser(req); return u && u.ws && u.ws !== DEFAULT_WS ? u : null; };
  const brandMe = (req, res) => { const u = me(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const W = getWorkspace(u.ws); if (!W || W.plan === "friends") { bad(res, "This is for brand teams.", 403, "not_brand"); return null; } return { ...u, W, wsOwner: !!u.owner || lc(W.ownerEmail) === lc(u.email) }; };
  const hostMe = (req, res) => { const u = me(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const h = C.profileOf(u.ws); if (!h?.handle) { bad(res, "Set up your host page first.", 409, "no_page"); return null; } return { u, h, ws: u.ws }; };
  const evKey = (id) => "system/bpev-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 24);
  const evGet = (id) => store.get(evKey(id))?.data || null;
  const evOf = (r) => evGet(r.id) || { kind: "bpev", reqId: r.id, brief: null, owner: null, changes: [], confirm: null, hostSeats: [], survey: { tokens: {}, responses: {} }, connections: [], timeline: [] };
  const evSet = (ev) => { ev.updatedAt = Date.now(); store.set(evKey(ev.reqId), ev); return ev; };
  const note = (ev, by, what) => { ev.timeline = [...(ev.timeline || []), { at: Date.now(), by, what }].slice(-80); };
  const cGet = (id) => (id ? store.get("system/camp-" + String(id).replace(/[^a-f0-9]/g, "").slice(0, 24))?.data || null : null);
  const cSet = (c) => { c.updatedAt = Date.now(); store.set("system/camp-" + c.id, c); return c; };
  const cList = (ws) => store.listPrefix("system", "camp-").map((d) => d.data).filter((c) => c?.kind === "camp" && c.ws === ws);
  const campOf = (r) => cGet(r.campaignId) || cList(r.brandWs).find((c) => (c.bookings || []).includes(r.id)) || null;
  const hostName = (r) => C.profileOf(r.hostWs)?.name || r.handle || "";
  const company = (ws) => getWorkspace(ws)?.company || "";
  const nameOf = (email) => getDbUser(email)?.name || "";
  const brandEvent = (req, res) => { const u = brandMe(req, res); if (!u) return null; const r = BB().reqGet(req.params.id); if (!r || r.brandWs !== u.ws) { bad(res, "Not found.", 404, "not_found"); return null; } return { u, r, ev: evOf(r) }; };
  const hostEvent = (req, res) => { const H = hostMe(req, res); if (!H) return null; const r = BB().reqGet(req.params.id); if (!r || r.hostWs !== H.ws || r.status === "approval") { bad(res, "Not found.", 404, "not_found"); return null; } return { H, r, ev: evOf(r) }; };

  // ---- hooks the bookings call ----
  X.onBbRequest = (r, b, u) => { const ev = evOf(r); let changed = false;
    if (b.brief && typeof b.brief === "object") { const E = editBrief(null, { ...b.brief, goal: b.brief.goal || b.goal }, { side: "brand", who: u.name || u.email, headcount: r.headcount }); if (!E.error) { ev.brief = E.brief; changed = true; } }
    else if (goalOf(b.goal)) { ev.brief = editBrief(null, { goal: b.goal }, { side: "brand", who: u.name || u.email, headcount: r.headcount }).brief; changed = true; }
    if (b.setupSec != null) { ev.setupSec = int(b.setupSec, 0, 6 * 3600); changed = true; }
    if (["host-page", "follower", "quick", "again"].includes(b.via)) { r.via = b.via; BB().reqSet(r); }
    if (b.againOf) { const prev = BB().reqGet(b.againOf); if (prev && prev.brandWs === r.brandWs) { ev.againOf = prev.id; const pe = evGet(prev.id); if (pe?.brief && !b.brief) { const host = Math.min(pe.brief.mix?.host || 0, r.headcount); ev.brief = editBrief(null, { ...pe.brief, mix: { host, brand: Math.min(pe.brief.mix?.brand || 0, r.headcount - host) } }, { side: "brand", who: u.name || u.email, headcount: r.headcount }).brief || ev.brief; } changed = true; } }
    ev.owner = { email: lc(u.email), name: u.name || nameOf(u.email) }; note(ev, "brand", r.status === "approval" ? "asked the team to approve" : "sent the request"); changed = true;
    // one event, no campaign to set up: a one-event campaign sits behind it so invites, check-in and the report work
    if (b.single === true && !r.campaignId) { const c = { kind: "camp", id: rid(6), ws: r.brandWs, ownerEmail: lc(u.email), single: true, title: clean(r.pkgName, 100), goal: GOALS[ev.brief?.goal]?.line || "", audience: { tags: [], perPersonCents: r.price?.effectivePerPersonCents || 0 },
        cities: [approxArea(BB().setupOf(r.hostWs)?.area, BB().setupOf(r.hostWs)?.city).city].filter(Boolean), budgetCents: r.price?.totalCents || 0, start: r.date || "", end: r.date || "", kpis: { attendees: r.headcount, meetings: 0, againPct: 0 }, status: "active", memberRole: "editor",
        team: {}, bookings: [r.id], shortlists: [], costs: [], guests: [], createdAt: Date.now() };
      cSet(c); r.campaignId = c.id; BB().reqSet(r); }
    if (changed) evSet(ev); };
  X.onHostAccept = (r, H) => { const ev = evGet(r.id); if (!ev?.brief) return; if (!briefState(ev.brief).host) { ev.brief = agreeBrief(ev.brief, "host", H.h.name); note(ev, "host", "agreed to the brief and accepted"); evSet(ev); } };
  X.briefLines = (id) => briefLines(evGet(id)?.brief);
  X.rosWithBrief = (id, items) => rosWithBrief(items, evGet(id)?.brief);
  X.surveyLinkFor = (r, who) => { const ev = evOf(r), n = Object.keys(ev.survey?.tokens || {}).length, t = tokenFor(ev, who); if (Object.keys(ev.survey.tokens).length !== n) evSet(ev); return `/survey/${t}`; };
  function tokenFor(ev, who) { const T = (ev.survey ||= { tokens: {}, responses: {} }).tokens; const have = Object.entries(T).find(([, x]) => x.side === who.side && (who.side === "brand" ? x.gid === who.gid : x.sid === who.sid));
    if (have) return have[0]; const t = rid(12); T[t] = { side: who.side, gid: who.gid || "", sid: who.sid || "", cid: who.cid || "", first: clean(who.first, 40), email: lc(who.email || "") }; store.set("system/bpsv-" + t, { kind: "bpsv", reqId: ev.reqId }); return t; }

  // ---- pages ----
  app.get("/teams/hosts", page("teams-hosts.html"));
  app.get("/survey/:token", page("teams-survey.html"));
  app.get("/admin/brand-metrics", (req, res, next) => { const u = me(req); if (!u || !isAdmin(u.email)) return res.status(404).type("text").send("Not found"); page("admin-brand-metrics.html")(req, res, next); });

  // ---- quick book ----
  app.get("/api/teams/quick", (req, res) => { if (limited("qb:" + req.ip, 600)) return bad(res, "Slow down.", 429, "rate_limited");
    const q = req.query || {}, people = int(q.people, 0, 2000), date = ISO.test(q.date || "") ? q.date : "", budgetCents = int(q.budget, 0, 100000) * 100, city = clean(q.city, 60), goal = goalOf(q.goal) ? q.goal : "", today = isoDay(), only = clean(q.only, 120).toLowerCase();
    if (!people) return bad(res, "How many people?"); if (date && date < today) return bad(res, "That date has passed.");
    const u = me(req), W = u ? getWorkspace(u.ws) : null, rules = u && W?.plan !== "friends" ? BB().rulesOf(u.ws) : null, cands = [];
    for (const x of BB().allSetups({ examples: true })) { if (BB().example(x.ws) && process.env.ENCORE_HIDE_DEMO === "1") continue; if (u && x.ws === u.ws) continue; const st = BB().statsOf(x.ws), A = approxArea(x.s.area, x.s.city || x.h.city);
      for (const p of x.s.packages.filter((p) => p.on && (!only || only === `${x.h.handle}/${p.id}`))) { const card = BB().cardOf(x, p, people || p.minGuests, st), price = card.price, taken = BB().takenFor(x.ws, p.id);
        let dateState = "", altDate = ""; if (date) { const months = [date.slice(0, 7), addDays(date, 20).slice(0, 7)], days = months.flatMap((m) => availabilityFor(p, m, { taken, today }).days); dateState = days.find((d) => d.date === date)?.state || "closed";
          if (dateState !== "open") { const near = days.filter((d) => d.state === "open" && Math.abs(daysBetween(date, d.date)) <= 14).sort((a, b) => Math.abs(daysBetween(date, a.date)) - Math.abs(daysBetween(date, b.date)))[0]; altDate = near?.date || ""; } }
        const full = priceFor(p, people, u ? { feeBps: BB().feeFor(u.ws, x.ws) } : {}), terms = cancellationTerms(x.s.policy, p.depositPct);
        cands.push({ ...card, price, alsoIn: x.s.alsoIn || [], city: x.s.city || x.h.city || "", areaCity: A.city, area: A.area, access: p.access || [], diets: p.diets || [], moods: p.moods || [], quality: st.quality, trusted: st.trusted, totalCents: full.totalCents, effectivePerPersonCents: full.effectivePerPersonCents,
          dateState, altDate, policy: x.s.policy, depositCents: full.depositCents, terms: terms.short, priceLines: full.lines.filter((l) => l.cents || l.k === "people"), summary: full.summary }); } }
    // services (food, photos, flowers, staff, planning) lead only for a service goal; otherwise they're suggested as add-ons.
    // Real hosts always come first: examples fill the slots left when fewer than 3 real hosts fit, never displacing one.
    const G = goalOf(goal), isSvc = (x) => x.kind === "service", rq = { date, people, budgetCents, city: only ? "" : city, goal };
    const main = only ? cands : cands.filter((x) => (G?.service ? isSvc(x) && (x.goals || []).includes(goal) : !isSvc(x)));
    const ranked = realFirst(main, rq), seen = new Set(ranked.map((x) => x.handle));
    const extras = !only && ADDON_GOALS.includes(goal) ? realFirst(cands.filter((x) => isSvc(x) && (x.goals || []).includes(goal) && !seen.has(x.handle)), rq).filter((x) => !x.near).map((x) => ({ handle: x.handle, pkg: x.pkg, name: x.name, host: x.host, unitPrice: x.unitPrice, totalCents: x.totalCents, art: x.art, lead: x.lead, photo: x.photo, example: !!x.host?.example, why: x.why.slice(0, 1) })) : [];
    const top = ranked.map((x) => { const when = x.dateState === "open" ? date : x.altDate;
      return { near: !!x.near, example: !!x.host?.example, kind: x.kind, unitPrice: x.unitPrice, miss: x.miss || [], handle: x.handle, pkg: x.pkg, name: x.name, host: x.host, area: x.area, photo: x.photo, lead: x.lead, art: x.art, moods: x.moods, rating: x.rating, reviews: x.reviews, trusted: x.trusted, instant: x.instant, why: x.why,
        totalCents: x.totalCents, perPersonCents: x.effectivePerPersonCents, summary: x.summary, priceLines: x.priceLines, depositCents: x.depositCents, terms: x.terms, overBudgetCents: x.overBudgetCents,
        availability: { date, state: x.dateState, alt: x.altDate, line: !date ? "Pick a date to check it" : x.dateState === "open" ? `Open on ${short(date)}` : x.altDate ? `Not ${short(date)}. Open ${short(x.altDate)}` : `Not open near ${short(date)}` },
        exposure: exposureSchedule({ policy: x.policy, totalCents: x.totalCents, depositCents: x.depositCents, date: when, today }), access: accessNotes({ access: x.access, diets: x.diets }),
        approval: rules ? (BB().needsApproval(rules, x.totalCents, u.email) ? { needed: true, line: `Needs an OK from ${(rules.approvers || []).map((e) => first(nameOf(e)) || e).join(" or ")} first` } : { needed: false, line: "No approval needed" }) : null }; });
    capture("brand_quickbook_searched", { ws: u?.ws, guests: people, goal, results: top.length, signed_in: !!u }); // counts only (server/posthog.js)
    res.set("Cache-Control", "private, no-store").json({ results: top, extras, exampleLine: top.some((x) => x.example) ? EXAMPLE_LINE : "", demo: !!(u && BB().demoBrand?.(u.ws)), total: cands.length, query: { date, people, budget: budgetCents / 100, city, goal }, goals: Object.values(GOALS).map(({ id, label, line }) => ({ id, label, line })),
      brief: { goals: GOALS, together: TOGETHER, creative: CREATIVE, invites: INVITES, photos: PHOTOS, followup: FOLLOWUP, defaults: briefDefaults(goal || "customer", people) } }); });

  // ---- one event: owner, timeline, approval, brief, seats, survey, summary link ----
  function eventView(r, ev, side = "brand") {
    const st = statusOf(r), F = BB().findPkg(r.handle, r.pkgId), c = campOf(r), today = isoDay();
    const appr = r.approval ? (r.approval.state === "yes" ? `Approved by ${first(nameOf(r.approval.by)) || r.approval.by}${r.approval.at ? " on " + short(isoDay(r.approval.at)) : ""}` : r.approval.state === "no" ? `Not approved by ${first(nameOf(r.approval.by)) || r.approval.by}` : `Waiting on ${(r.approval.approvers || []).map((e) => first(nameOf(e)) || e).join(" or ")} (${r.approval.rule})`) : "No approval needed";
    const status = { approval: "Waiting on your team's OK", requested: "Sent to the host", countered: "The host suggested a change", accepted: r.deposit?.state === "held" ? "Accepted, deposit held" : "Accepted, deposit due", booked: "Booked, deposit paid", done: "Done", declined: "Declined", cancelled: "Cancelled", question: "A question for the host" }[st] || st;
    const avail = F && r.date ? availabilityFor(F.p, r.date.slice(0, 7), { taken: BB().takenFor(F.ws, F.p.id), today }).days.find((d) => d.date === r.date)?.state : "";
    const G = c ? (c.guests || []).filter((g) => g.event === r.id) : [], paid = paidOf(r);
    const timeline = [...(r.history || []).map((h) => ({ at: h.at, by: h.by, what: h.what })), ...(ev.timeline || []).filter((t) => !/sent the request|asked the team to approve/.test(t.what)), ...(ev.brief?.history || []).map((h) => ({ at: h.at, by: h.by, what: h.what }))].sort((a, b) => a.at - b.at);
    const o = { id: r.id, name: r.pkgName, host: { name: hostName(r), handle: r.handle }, pkg: r.pkgId, company: r.company, date: r.date || "", headcount: r.headcount, status: st, statusLine: status, approval: { state: r.approval?.state || "none", line: appr },
      owner: ev.owner || { email: r.brandEmail, name: r.contactName }, money: { totalCents: r.price?.totalCents || 0, paidCents: paid, dueCents: Math.max(0, (r.price?.totalCents || 0) - paid), depositCents: r.deposit?.cents || 0, summary: r.price?.summary || "" },
      exposure: ["declined", "cancelled", "done"].includes(st) ? null : exposureSchedule({ policy: r.terms?.policy, totalCents: r.price?.totalCents || 0, depositCents: r.deposit?.cents || 0, date: r.date, today }),
      availability: { state: avail || "", line: !r.date ? r.flex ? "Flexible date, the host picks one" : "" : isBooked(r) || st === "accepted" ? `Held for you on ${short(r.date)}` : avail === "open" ? `${short(r.date)} is open` : `${short(r.date)} is no longer open. Ask the host for another date.` },
      access: F ? accessNotes(F.p) : null, terms: r.terms?.short || "", brief: ev.brief, briefState: briefState(ev.brief), briefLines: briefLines(ev.brief), options: { goals: GOALS, together: TOGETHER, creative: CREATIVE, invites: INVITES, photos: PHOTOS, followup: FOLLOWUP },
      seats: seatMix(G, ev.hostSeats || [], ev.brief?.mix), confirm: ev.confirm || null, changes: ev.changes || [], timeline, campaign: c ? { id: c.id, title: c.title, single: !!c.single } : null, againOf: ev.againOf || "",
      survey: surveySummary(ev.survey?.tokens, ev.survey?.responses), connections: connectionCounts(ev) };
    if (side === "host") o.owner = { name: first(o.owner?.name || "") };
    if (side === "brand") { o.summaryUrl = ev.summaryKey ? `/teams/e/${r.id}?k=${ev.summaryKey}` : ""; o.contactOk = hostGuestsWhoShared(ev); }
    return o; }
  const hostGuestsWhoShared = (ev) => Object.entries(ev.survey?.tokens || {}).filter(([t, x]) => x.side === "host" && ev.survey.responses?.[t]?.contactOk).map(([t, x]) => { const s = (ev.hostSeats || []).find((y) => y.id === x.sid) || {}; return { name: s.name || x.first, email: s.email || x.email || ev.survey.responses[t].contact || "", company: ev.survey.responses[t].matchOk ? ev.survey.responses[t].company : "" }; });
  app.get("/api/teams/events/:id", (req, res) => { const E = brandEvent(req, res); if (!E) return; res.set("Cache-Control", "private, no-store").json({ event: eventView(E.r, E.ev), team: membersOf(E.u.ws).map((m) => ({ email: lc(m.email), name: m.name || "" })) }); });
  app.post("/api/teams/events/:id/owner", small, (req, res) => { const E = brandEvent(req, res); if (!E) return; const e = lc(req.body?.email); const m = membersOf(E.u.ws).find((x) => lc(x.email) === e); if (!m) return bad(res, "The owner has to be on your team.");
    E.ev.owner = { email: e, name: m.name || "" }; note(E.ev, "brand", `${first(m.name) || e} owns this event now`); evSet(E.ev); res.json({ event: eventView(E.r, E.ev) }); });
  app.post("/api/teams/events/:id/summary-link", small, (req, res) => { const E = brandEvent(req, res); if (!E) return; if (req.body?.off) delete E.ev.summaryKey; else E.ev.summaryKey ||= rid(10); evSet(E.ev); res.json({ url: E.ev.summaryKey ? `/teams/e/${E.r.id}?k=${E.ev.summaryKey}` : "" }); });
  app.post("/api/teams/events/:id/brief", small, (req, res) => { const E = brandEvent(req, res); if (!E) return; const R = editBrief(E.ev.brief, req.body || {}, { side: "brand", who: E.u.name || E.u.email, headcount: E.r.headcount }); if (R.error) return bad(res, R.error);
    E.ev.brief = R.brief; evSet(E.ev); if (R.changed && E.ev.brief.hostAgreed == null && E.r.status !== "approval") BB().tell(BB().ownerEmailOf(E.r.hostWs), `${E.r.company} changed the brief for ${E.r.pkgName}. Have a look and agree.`, "/host/teams#confirm"); res.json({ event: eventView(E.r, E.ev) }); });
  app.post("/api/teams/events/:id/changes", small, (req, res) => { const E = brandEvent(req, res); if (!E) return; const b = req.body || {}, F = BB().findPkg(E.r.handle, E.r.pkgId);
    const ch = { id: rid(4), headcount: b.headcount != null && b.headcount !== "" ? int(b.headcount, 1, 2000) : null, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time || "") ? b.time : "", note: clean(b.note, 400), at: Date.now(), state: "asked" };
    if (ch.headcount == null && !ch.time && !ch.note) return bad(res, "Say what you'd like to change."); if (ch.headcount != null && F && (ch.headcount < F.p.minGuests || ch.headcount > F.p.maxGuests)) return bad(res, `${F.p.name} is for ${F.p.minGuests} to ${F.p.maxGuests} people.`);
    E.ev.changes = [...(E.ev.changes || []), ch].slice(-30); note(E.ev, "brand", `asked for a change${ch.headcount != null ? `: ${ch.headcount} people` : ""}`); evSet(E.ev); BB().tell(BB().ownerEmailOf(E.r.hostWs), `${E.r.company} asked for a change to ${E.r.pkgName}.`, "/host/teams#confirm"); res.json({ event: eventView(E.r, E.ev) }); });
  app.post("/api/teams/events/:id/survey", small, async (req, res) => { const E = brandEvent(req, res); if (!E) return; if (statusOf(E.r) !== "done" && !(E.r.date && E.r.date <= isoDay())) return bad(res, "The survey opens once the event has happened.", 409, "not_yet");
    const c = campOf(E.r), G = c ? (c.guests || []).filter((g) => g.event === E.r.id && g.checkedIn) : [], links = [];
    for (const g of G) links.push({ side: "brand", first: first(g.name), url: `/survey/${tokenFor(E.ev, { side: "brand", gid: g.id, cid: c.id, first: first(g.name), email: g.email })}`, email: g.email });
    for (const s of (E.ev.hostSeats || []).filter((s) => s.checkedIn)) tokenFor(E.ev, { side: "host", sid: s.id, first: first(s.name), email: s.email });
    evSet(E.ev); const cfg = emailConfig(E.u.ws, false) || emailConfig(DEFAULT_WS, true), base = publicOrigin(req); let sent = 0;
    if (cfg) for (const l of links.filter((x) => x.email)) { try { const o = await sendEmail(cfg, { to: l.email, subject: `How was ${E.r.pkgName}?`, text: `Hi ${l.first || "there"},\n\nThanks for coming to ${E.r.pkgName}. Four quick questions, all optional: ${base}${l.url}\n\nYou choose what ${E.r.company} sees.`, fromName: E.r.company, list: "guest" }); if (o?.ok !== false) sent++; } catch {} }
    note(E.ev, "brand", `sent the survey to ${links.length} ${links.length === 1 ? "guest" : "guests"}`); evSet(E.ev); res.json({ ok: true, brand: links.length, host: (E.ev.hostSeats || []).filter((s) => s.checkedIn).length, emailed: sent }); });
  // turn one event into a city series: the format, guest segments, approvals and the brief come along
  app.post("/api/teams/events/:id/series", small, (req, res) => { const E = brandEvent(req, res); if (!E) return; const b = req.body || {}, c = campOf(E.r); if (!c) return bad(res, "This booking isn't on a guest list yet.", 409, "not_yet");
    const role = campaignRole(c, { email: E.u.email, ws: E.u.ws, wsOwner: E.u.wsOwner }); if (!can(role, "plan")) return bad(res, "Only editors and owners can do this.", 403, "not_granted");
    const cities = (Array.isArray(b.cities) ? b.cities : String(b.cities || "").split(",")).map((x) => clean(x, 60)).filter(Boolean).slice(0, 8), n = int(b.events || cities.length * 2 || 4, 1, 40);
    const tags = [...new Set([...(c.audience?.tags || []), ...(Array.isArray(b.segments) ? b.segments : String(b.segments || "").split(",")).map((x) => clean(x, 40)).filter(Boolean)])].slice(0, 8);
    c.single = false; c.title = clean(b.title, 100) || `${E.r.pkgName} series`; c.cities = [...new Set([...(c.cities || []), ...cities])]; c.audience = { ...(c.audience || {}), tags }; c.budgetCents = Math.max(c.budgetCents || 0, (E.r.price?.totalCents || 0) * n);
    c.kpis = { ...(c.kpis || {}), attendees: (E.r.headcount || 0) * n }; c.end = ""; c.status = "active";
    c.series = { from: E.r.id, format: { handle: E.r.handle, pkg: E.r.pkgId, name: E.r.pkgName, headcount: E.r.headcount }, brief: E.ev.brief || null, approvers: E.r.approval?.approvers || BB().rulesOf(E.u.ws).approvers || [], segments: tags, events: n, at: Date.now() };
    cSet(c); note(E.ev, "brand", `turned into a series: ${c.title}`); evSet(E.ev); res.json({ ok: true, id: c.id, url: `/teams/campaigns/${c.id}/plan` }); });

  // the read-only summary for finance and sales: one owner, one status, one timeline, the money, no guest names
  app.get("/teams/e/:id", (req, res) => { const r = BB().reqGet(req.params.id), ev = r ? evGet(r.id) : null, u = me(req); let ok = false;
    if (r && u && u.ws === r.brandWs) ok = true; else if (ev?.summaryKey && req.query.k && safeEq(String(req.query.k), ev.summaryKey)) ok = true;
    if (!ok) return res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:sans-serif;padding:24px">This summary is private. Ask the team for the link.</p>`);
    res.set("Cache-Control", "private, no-store").set("X-Robots-Tag", "noindex").type("html").send(summaryHtml(eventView(r, evOf(r)))); });

  // ---- the host's one place: capacity, changes, the brief, their own seats ----
  app.get("/api/bb/host/confirm", (req, res) => { const H = hostMe(req, res); if (!H) return; const today = isoDay();
    const L = BB().reqs().filter((r) => r.hostWs === H.ws && ["requested", "countered", "accepted", "booked", "done"].includes(statusOf(r))).sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
    const next = scopeStore(store, H.ws).get("teambook/next")?.data?.list || [];
    res.set("Cache-Control", "private, no-store").json({ events: L.filter((r) => statusOf(r) !== "done" || (r.date && daysBetween(r.date, today) <= 30)).map((r) => { const v = eventView(r, evOf(r), "host"); const ev = evOf(r);
      return { ...v, hostSeats: (ev.hostSeats || []).map((s) => ({ ...s, survey: Object.entries(ev.survey?.tokens || {}).find(([, x]) => x.side === "host" && x.sid === s.id)?.[0] ? `/survey/${Object.entries(ev.survey.tokens).find(([, x]) => x.side === "host" && x.sid === s.id)[0]}` : "" })), past: !!(r.date && r.date <= today) }; }),
      next: { n: next.length, first: next.slice(-12).map((x) => x.first).filter(Boolean) } }); });
  app.post("/api/bb/host/events/:id/confirm", small, (req, res) => { const E = hostEvent(req, res); if (!E) return; const b = req.body || {};
    E.ev.confirm = { capacity: int(b.capacity || E.r.headcount, 1, 2000), hostSeats: int(b.hostSeats ?? E.ev.brief?.mix?.host ?? 0, 0, 2000), note: clean(b.note, 400), at: Date.now() };
    if (E.ev.confirm.capacity < E.r.headcount) return bad(res, `The booking is for ${E.r.headcount}. Suggest a change in the request instead.`);
    note(E.ev, "host", `confirmed room for ${E.ev.confirm.capacity}${E.ev.confirm.hostSeats ? `, ${E.ev.confirm.hostSeats} of their own guests` : ""}`); evSet(E.ev); BB().tell(E.r.brandEmail, `${E.H.h.name} confirmed ${E.r.pkgName}.`, `/teams/bookings/${E.r.id}`); res.json({ ok: true, confirm: E.ev.confirm }); });
  app.post("/api/bb/host/events/:id/brief", small, (req, res) => { const E = hostEvent(req, res); if (!E) return; const R = editBrief(E.ev.brief, req.body || {}, { side: "host", who: E.H.h.name, headcount: E.r.headcount }); if (R.error) return bad(res, R.error);
    E.ev.brief = R.brief; evSet(E.ev); if (R.changed) BB().tell(E.r.brandEmail, `${E.H.h.name} changed the brief for ${E.r.pkgName}. Have a look and agree.`, `/teams/bookings/${E.r.id}`); res.json({ ok: true, brief: E.ev.brief, state: briefState(E.ev.brief) }); });
  app.post("/api/bb/host/events/:id/changes/:cid", small, (req, res) => { const E = hostEvent(req, res); if (!E) return; const ch = (E.ev.changes || []).find((x) => x.id === req.params.cid); if (!ch || ch.state !== "asked") return bad(res, "Nothing to answer.", 409, "conflict");
    ch.state = req.body?.yes === true ? "yes" : "no"; ch.answeredAt = Date.now(); ch.reply = clean(req.body?.note, 300);
    if (ch.state === "yes" && ch.headcount != null) { const F = BB().findPkg(E.r.handle, E.r.pkgId); E.r.headcount = ch.headcount; if (F && !isBooked(E.r)) { /* the price follows the new headcount until it's paid */ } BB().push(E.r, "host", `agreed to ${ch.headcount} people`); BB().reqSet(E.r); }
    if (ch.state === "yes" && ch.time) { E.r.time = ch.time; BB().reqSet(E.r); }
    note(E.ev, "host", ch.state === "yes" ? "agreed to the change" : "couldn't do the change"); evSet(E.ev); BB().tell(E.r.brandEmail, `${E.H.h.name} ${ch.state === "yes" ? "agreed to" : "couldn't do"} your change to ${E.r.pkgName}.`, `/teams/bookings/${E.r.id}`); res.json({ ok: true, change: ch }); });
  app.post("/api/bb/host/events/:id/seats", small, (req, res) => { const E = hostEvent(req, res); if (!E) return; const b = req.body || {};
    if (b.remove) { E.ev.hostSeats = (E.ev.hostSeats || []).filter((s) => s.id !== b.remove); evSet(E.ev); return res.json({ ok: true, hostSeats: E.ev.hostSeats }); }
    if (b.id) { const s = (E.ev.hostSeats || []).find((x) => x.id === b.id); if (!s) return bad(res, "Not found.", 404, "not_found"); if (b.checkedIn != null) { s.checkedIn = !!b.checkedIn; s.checkedAt = s.checkedIn ? Date.now() : 0; if (s.checkedIn && E.r.date && E.r.date <= isoDay()) tokenFor(E.ev, { side: "host", sid: s.id, first: first(s.name), email: s.email }); } evSet(E.ev); return res.json({ ok: true, hostSeats: E.ev.hostSeats }); }
    const name = clean(b.name, 80), email = lc(clean(b.email, 160)); if (!name) return bad(res, "Add their name."); if (email && !EMAIL_RE.test(email)) return bad(res, "That email doesn't look right.");
    const cap = E.ev.brief?.mix?.host ?? E.ev.confirm?.hostSeats ?? 0; if ((E.ev.hostSeats || []).length >= Math.max(cap, 1) + 4) return bad(res, `The brief has ${cap} host spots. Agree a change with the brand first.`);
    let follower = false; try { follower = !!email && C.followersOf(E.H.ws).some((f) => lc(f.email) === email); } catch {}
    const prior = !!email && BB().reqs().some((x) => x.hostWs === E.H.ws && x.id !== E.r.id && (evGet(x.id)?.hostSeats || []).some((s) => s.email === email && s.checkedIn));
    E.ev.hostSeats = [...(E.ev.hostSeats || []), { id: rid(4), name, email, follower: follower || b.follower === true, returning: prior, checkedIn: false, at: Date.now() }].slice(0, 500); evSet(E.ev); res.json({ ok: true, hostSeats: E.ev.hostSeats }); });

  // ---- the guest's survey, connections and the tie to the host ----
  const svOf = (req) => { const t = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 24), idx = store.get("system/bpsv-" + t)?.data; if (!idx) return null; const r = BB().reqGet(idx.reqId); const ev = r && evGet(r.id); if (!r || !ev?.survey?.tokens?.[t]) return null; return { t, r, ev, who: ev.survey.tokens[t] }; };
  const svView = (S) => { const { t, r, ev, who } = S, mine = ev.survey.responses?.[t] || null, R = ev.survey.responses || {}, T = ev.survey.tokens;
    return { company: r.company, host: hostName(r), hostHandle: r.handle, event: r.pkgName, date: r.date || "", first: who.first, side: who.side, hasEmail: !!who.email, past: !!(r.date && r.date <= isoDay()), answer: mine,
      others: mine?.listed ? Object.keys(R).filter((k) => k !== t && R[k].listed).map((k) => ({ token: k, first: T[k]?.first || "A guest", from: T[k]?.side === "host" ? `${hostName(r)}'s guest` : `${r.company}'s guest` })) : [],
      connections: connectionsFor(ev, t) }; };
  app.get("/api/survey/:token", (req, res) => { const S = svOf(req); if (!S) return bad(res, "This link doesn't work anymore.", 404, "not_found"); res.set("Cache-Control", "private, no-store").json(svView(S)); });
  app.post("/api/survey/:token", small, (req, res) => { if (limited("sv:" + req.ip, 120)) return bad(res, "Slow down.", 429, "rate_limited"); const S = svOf(req); if (!S) return bad(res, "This link doesn't work anymore.", 404, "not_found");
    if (!(S.r.date && S.r.date <= isoDay())) return bad(res, "The survey opens after the event.", 409, "not_yet");
    const b = req.body || {}, prev = S.ev.survey.responses[S.t] || {}, A = cleanAnswer(b, prev); if (A.followHost && !S.who.email && !EMAIL_RE.test(lc(b.email || ""))) return bad(res, "Add your email so the host can tell you about the next one.");
    const email = S.who.email || (EMAIL_RE.test(lc(b.email || "")) ? lc(b.email) : ""); if (email && !S.who.email) S.who.email = email;
    S.ev.survey.responses[S.t] = A; if (prev.listed && !A.listed) withdrawListing(S.ev, S.t);
    // the guest's tie to the host: following and a spot at the next one. Never the brand's consent.
    if (A.followHost && !prev.followHost && email) { try { const F = app.locals.fanclub; if (F?.setFollow) F.setFollow(S.r.hostWs, email, { on: true, name: S.who.first }); else C.follow(S.r.hostWs, { email, name: S.who.first, via: "team-event" }); } catch {} }
    if (A.nextOk && !prev.nextOk) { const HS = scopeStore(store, S.r.hostWs), cur = HS.get("teambook/next")?.data || { list: [] }; if (!cur.list.some((x) => x.email && x.email === email)) cur.list = [...cur.list, { first: S.who.first, email, format: S.ev.brief?.together || "", from: S.r.id, at: Date.now() }].slice(-500); HS.set("teambook/next", cur); }
    // agreeing to hear from the brand: the campaign guest's consent, and a follow-up task for sales
    if (A.contactOk && !prev.contactOk) { const c = campOf(S.r); if (c) { if (S.who.side === "brand") { const g = (c.guests || []).find((x) => x.id === S.who.gid); if (g && !g.consent?.share) g.consent = { share: true, at: Date.now(), via: "survey" }; }
      const seat = (S.ev.hostSeats || []).find((x) => x.id === S.who.sid), nm = S.who.side === "brand" ? (c.guests || []).find((x) => x.id === S.who.gid)?.name : seat?.name || S.who.first;
      c.tasks = [...(c.tasks || []), { id: rid(4), title: `Follow up with ${nm || "a guest"}`, team: "sales", owner: lc(S.ev.owner?.email || c.ownerEmail), due: addDays(isoDay(), 7), status: "open", result: "", event: S.r.id, guest: S.who.gid || S.who.sid, auto: true, at: Date.now(), doneAt: 0 }].slice(-500); cSet(c); } }
    evSet(S.ev); res.json(svView(S)); });
  app.post("/api/survey/:token/connect", small, (req, res) => { if (limited("svc:" + req.ip, 200)) return bad(res, "Slow down.", 429, "rate_limited"); const S = svOf(req); if (!S) return bad(res, "This link doesn't work anymore.", 404, "not_found");
    const to = String(req.body?.to || ""), out = req.body?.answer != null ? answerConnection(S.ev, S.t, to, req.body.answer === true) : askConnection(S.ev, S.t, to); if (out.error) return bad(res, out.error);
    if (out.mutual) { try { X.onPairMutual?.(S.ev, S.t, to); } catch {} } evSet(S.ev); res.json({ ...svView(S), mutual: out.mutual }); }); // both said yes: a light thread opens (server/brandpanel2.js)

  // ---- outcomes, tasks, targets, pilot and CRM on a campaign ----
  const loadC = (req, res, what) => { const u = brandMe(req, res); if (!u) return null; const c = cGet(req.params.id), role = c && campaignRole(c, { email: u.email, ws: u.ws, wsOwner: u.wsOwner }); if (!c || !role) { bad(res, "Not found.", 404, "not_found"); return null; } if (!can(role, what)) { bad(res, "Only editors and owners can change this.", 403, "not_granted"); return null; } return { u, c, role }; };
  const eventsOf = (c) => (c.bookings || []).map((id) => BB().reqGet(id)).filter((r) => r && r.brandWs === c.ws).map((r) => ({ r, ev: evGet(r.id) }));
  const autoPilot = (c) => { const E = eventsOf(c), T = outcomesOf(c, E).totals, firstDone = E.map(({ r }) => r).filter((r) => statusOf(r) === "done" && r.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    const firstList = [c.firstListAt, ...(c.tasks || []).filter((t) => t.team === "sales").map((t) => t.at)].filter(Boolean).sort((a, b) => a - b)[0];
    return { approvalSteps: E.reduce((a, { r, ev }) => a + (r.approval ? 1 : 0) + (ev?.brief ? 1 : 0), 0), attendance: T.attendance.attended, daysToList: firstDone && firstList ? Math.max(0, daysBetween(firstDone.date, isoDay(firstList))) : null }; };
  const setupsOf = (c) => eventsOf(c).filter(({ ev }) => ev?.setupSec != null).sort((a, b) => a.r.createdAt - b.r.createdAt).map(({ r, ev }) => ({ minutes: Math.max(1, Math.round(ev.setupSec / 60)), name: r.pkgName, date: r.date }));
  const outView = (c, role) => { const E = eventsOf(c), O = outcomesOf(c, E), members = membersOf(c.ws).map((m) => ({ email: lc(m.email), name: m.name || "" }));
    return { ...O, tasks: (c.tasks || []).map((t) => ({ ...t, ownerName: members.find((m) => m.email === t.owner)?.name || "" })), outcomes: c.outcomes || [], targets: c.targets || [], members, can: { edit: can(role, "guests") },
      pilot: c.pilot ? { ...c.pilot, compare: pilotCompare(c.pilot, autoPilot(c), setupsOf(c)) } : null, setups: setupsOf(c),
      crm: Object.fromEntries(Object.keys(CRM.PROVIDERS).map((k) => { const cf = CRM.configFor(k); const tok = scopeStore(store, c.ws).get("crm/" + k)?.data; return [k, { label: cf.label, beta: true, configured: cf.configured || cf.fake, missing: cf.missing, connected: !!tok?.token, fields: CRM.PROVIDERS[k].fields, mapping: CRM.cleanMapping(k, c.crm?.[k]?.mapping || {}), last: c.crm?.[k]?.last || null }]; })), sourceFields: CRM.SOURCE_FIELDS }; };
  app.get("/api/campaigns/:id/outcomes", (req, res) => { const L = loadC(req, res, "view"); if (!L) return; res.set("Cache-Control", "private, no-store").json(outView(L.c, L.role)); });
  app.post("/api/campaigns/:id/targets", small, (req, res) => { const L = loadC(req, res, "plan"); if (!L) return; const raw = Array.isArray(req.body?.targets) ? req.body.targets : String(req.body?.targets || "").split(/[,\n]/);
    L.c.targets = [...new Set(raw.map((x) => clean(x, 100)).filter(Boolean))].slice(0, 500); cSet(L.c); res.json(outView(L.c, L.role)); });
  app.post("/api/campaigns/:id/tasks", small, (req, res) => { const L = loadC(req, res, "guests"); if (!L) return; const b = req.body || {}, members = membersOf(L.c.ws).map((m) => lc(m.email));
    if (b.remove) L.c.tasks = (L.c.tasks || []).filter((t) => t.id !== b.remove);
    else { const cur = b.id ? (L.c.tasks || []).find((t) => t.id === b.id) : null; if (b.id && !cur) return bad(res, "Not found.", 404, "not_found"); const T = cleanTask(b, cur || { owner: lc(L.u.email) }, { members }); if (T.error) return bad(res, T.error);
      if (T.task.event && !(L.c.bookings || []).includes(T.task.event)) T.task.event = ""; L.c.tasks = cur ? L.c.tasks.map((t) => (t.id === cur.id ? T.task : t)) : [...(L.c.tasks || []), T.task].slice(-500); }
    cSet(L.c); res.json(outView(L.c, L.role)); });
  app.post("/api/campaigns/:id/outcomes", small, (req, res) => { const L = loadC(req, res, "guests"); if (!L) return; const b = req.body || {};
    if (b.remove) L.c.outcomes = (L.c.outcomes || []).filter((o) => o.id !== b.remove); else { const O = cleanOutcome(b); if (O.error) return bad(res, O.error); if (O.outcome.event && !(L.c.bookings || []).includes(O.outcome.event)) O.outcome.event = ""; L.c.outcomes = [...(L.c.outcomes || []), O.outcome].slice(-500); }
    cSet(L.c); res.json(outView(L.c, L.role)); });
  app.post("/api/campaigns/:id/pilot", small, (req, res) => { const L = loadC(req, res, "plan"); if (!L) return; L.c.pilot = req.body?.off ? null : cleanPilot(req.body || {}, L.c.pilot || {}); cSet(L.c); res.json(outView(L.c, L.role)); });
  app.post("/api/campaigns/:id/invite-from", small, (req, res) => { const L = loadC(req, res, "guests"); if (!L) return; const b = req.body || {}, key = b.event && (L.c.bookings || []).includes(b.event) ? b.event : "all";
    const from = { name: clean(b.name, 80), title: clean(b.title, 80), note: clean(b.note, 280) }; if (!from.name) return bad(res, "Add the name of the person the invite is from.");
    L.c.inviteFrom = { ...(L.c.inviteFrom || {}), [key]: from }; cSet(L.c); res.json({ ok: true, inviteFrom: L.c.inviteFrom }); });
  const eventsMap = (c) => Object.fromEntries(eventsOf(c).map(({ r }) => [r.id, { name: r.pkgName, date: r.date || "", host: hostName(r) }]));
  app.post("/api/campaigns/:id/crm/:provider/mapping", small, (req, res) => { const L = loadC(req, res, "export"); if (!L) return; const k = req.params.provider; if (!CRM.PROVIDERS[k]) return bad(res, "Pick HubSpot or Salesforce.", 404, "not_found");
    L.c.crm = { ...(L.c.crm || {}), [k]: { ...(L.c.crm?.[k] || {}), mapping: CRM.cleanMapping(k, req.body?.mapping || {}) } }; cSet(L.c); res.json(outView(L.c, L.role)); });
  app.post("/api/campaigns/:id/crm/:provider/preview", small, (req, res) => { const L = loadC(req, res, "export"); if (!L) return; const k = req.params.provider; if (!CRM.PROVIDERS[k]) return bad(res, "Pick HubSpot or Salesforce.", 404, "not_found");
    res.json(CRM.dryRun(k, L.c, eventsMap(L.c), req.body?.mapping || L.c.crm?.[k]?.mapping || {})); });
  app.post("/api/campaigns/:id/crm/:provider/sync", small, async (req, res) => { const L = loadC(req, res, "export"); if (!L) return; const k = req.params.provider; if (!CRM.PROVIDERS[k]) return bad(res, "Pick HubSpot or Salesforce.", 404, "not_found");
    const cf = CRM.configFor(k), tok = scopeStore(store, L.c.ws).get("crm/" + k)?.data; if (!cf.fake && (!cf.configured || !tok?.token)) return bad(res, `Connect ${cf.label} first.`, 409, "not_connected");
    const transport = cf.fake ? CRM.fakeTransport().fn : CRM.fetchTransport(k, tok?.instance || ""); const out = await CRM.sync(k, L.c, eventsMap(L.c), L.c.crm?.[k]?.mapping || {}, { transport, token: tok?.token || "fake" });
    L.c.crm = { ...(L.c.crm || {}), [k]: { ...(L.c.crm?.[k] || {}), last: { ...out, fake: cf.fake } } }; if (!L.c.firstListAt && out.sent) L.c.firstListAt = Date.now(); cSet(L.c); res.json(out); });
  app.get("/api/crm/:provider/connect", (req, res) => { const u = brandMe(req, res); if (!u) return; const cf = CRM.configFor(req.params.provider); if (!cf) return bad(res, "Not found.", 404, "not_found");
    const state = CRM.stateToken(); scopeStore(store, u.ws).set("crm/state-" + req.params.provider, { state, at: Date.now(), back: clean(req.query.back, 200) }); const url = cf.authorizeUrl(state);
    if (!url) return bad(res, `${cf.label} isn't set up on this server yet. Missing: ${cf.missing.join(", ")}.`, 409, "not_configured");
    if (cf.fake) return res.redirect(302, `/api/crm/${req.params.provider}/callback?code=fake&state=${state}`); res.redirect(302, url); });
  app.get("/api/crm/:provider/callback", async (req, res) => { const u = brandMe(req, res); if (!u) return; const k = req.params.provider, cf = CRM.configFor(k); if (!cf) return bad(res, "Not found.", 404, "not_found");
    const S = scopeStore(store, u.ws), st = S.get("crm/state-" + k)?.data; if (!st || !safeEq(String(req.query.state || ""), st.state) || Date.now() - st.at > 15 * 60e3) return bad(res, "That sign-in link expired. Try connecting again.", 400, "bad_state");
    let token = "", instance = ""; if (cf.fake) token = "fake-" + rid(6); else { try { const r = await fetch(cf.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: String(req.query.code || ""), client_id: cf.clientId, client_secret: cf.clientSecret, redirect_uri: cf.redirect }) }); const j = await r.json(); token = j.access_token || ""; instance = j.instance_url || ""; } catch {} }
    if (!token) return bad(res, `${cf.label} didn't connect. Try again.`, 502, "crm_failed"); S.set("crm/" + k, { token, instance, at: Date.now(), fake: cf.fake }); S.delete("crm/state-" + k); res.redirect(302, st.back && st.back.startsWith("/teams/") ? st.back : "/teams/campaigns"); });

  // ---- recommendations from outcomes ----
  function outcomeCells({ city = "", audience = [] } = {}) {
    const cells = new Map(), A = audience.map(lc).filter(Boolean);
    for (const r of BB().reqs()) { if (statusOf(r) !== "done") continue; const ev = evGet(r.id); if (!ev?.survey?.responses) continue; const s = BB().setupOf(r.hostWs) || {}, cty = approxArea(s.area, s.city).city || s.city || "";
      if (city && lc(cty) !== lc(city) && !(lc(city) === "new york" && ["brooklyn", "manhattan", "queens", "new york"].includes(lc(cty)))) continue;
      const key = `${r.hostWs}|${ev.brief?.together || "any"}`, x = cells.get(key) || { hostWs: r.hostWs, host: hostName(r), handle: r.handle, pkg: r.pkgId, format: ev.brief?.together || "", formatLabel: TOGETHER[ev.brief?.together]?.label || "Any format", city: cty, events: 0, respondents: 0, useful: 0, people: 0, brands: new Set() };
      let counted = 0; for (const [t, a] of Object.entries(ev.survey.responses)) { if (a.useful == null) continue; if (A.length) { const em = ev.survey.tokens[t]?.email; const P = em ? prefsOf(store, em) : null; if (!P?.include || !P.work.some((w) => A.includes(w))) continue; } x.respondents++; counted++; if (a.useful) x.useful++; }
      if (!counted) continue; x.events++; x.people += counted; x.brands.add(r.brandWs); cells.set(key, x); }
    return [...cells.values()].map(({ brands, hostWs, ...x }) => ({ ...x, brands: brands.size })); }
  const AUD = { engineers: ["engineering"], founders: ["founder"], designers: ["design"], product: ["product"], marketers: ["marketing"], leaders: ["leader"] };
  app.get("/api/teams/recommendations", (req, res) => { const u = brandMe(req, res); if (!u) return; const city = clean(req.query.city, 60), aud = AUD[lc(req.query.audience)] ? lc(req.query.audience) : "";
    const out = recommend(outcomeCells({ city, audience: AUD[aud] || [] }));
    res.set("Cache-Control", "private, no-store").json({ ...out, city, audience: aud, audiences: Object.keys(AUD), headline: out.items.length ? `For ${aud || "guests"}${city ? ` in ${city}` : ""}, ${out.items[0].formatLabel.toLowerCase()} with ${out.items[0].host} led to the most useful connections` : "", floor: K }); });

  // ---- "Your hosts" and book again ----
  app.get("/api/teams/hosts", (req, res) => { const u = brandMe(req, res); if (!u) return; const mine = BB().reqs().filter((r) => r.brandWs === u.ws && ["accepted", "booked", "done"].includes(statusOf(r))), by = new Map();
    for (const r of mine) (by.get(r.hostWs) || by.set(r.hostWs, []).get(r.hostWs)).push(r);
    const hosts = [...by.entries()].map(([ws, L]) => { L.sort((a, b) => (b.date || "").localeCompare(a.date || "")); const last = L[0], done = L.filter((r) => statusOf(r) === "done"), h = C.profileOf(ws) || {};
      let came = 0, useful = { n: 0, of: 0 }, back = { n: 0, of: 0 }, returning = 0; for (const r of done) { const c = campOf(r), ev = evGet(r.id), S = surveySummary(ev?.survey?.tokens, ev?.survey?.responses); came += seatMix((c?.guests || []).filter((g) => g.event === r.id), ev?.hostSeats || []).attended; useful.n += S.useful.n; useful.of += S.useful.of; back.n += S.back.n; back.of += S.back.of; returning += (ev?.hostSeats || []).filter((s) => s.checkedIn && s.returning).length; }
      const rated = done.filter((r) => r.reviews?.brand?.rating); return { handle: h.handle || last.handle, name: h.name || last.handle, person: first(nameOf(BB().ownerEmailOf(ws))), events: L.length, done: done.length, lastDate: last.date || "", lastId: last.id, lastPkg: last.pkgName, pkg: last.pkgId,
        came, useful: ofN(useful.n, useful.of), back: ofN(back.n, back.of), returning, rating: rated.length ? +(rated.reduce((a, r) => a + r.reviews.brand.rating, 0) / rated.length).toFixed(1) : null, spentCents: L.reduce((a, r) => a + (r.price?.totalCents || 0), 0), brief: briefLines(evGet(last.id)?.brief) }; }).sort((a, b) => b.events - a.events || b.lastDate.localeCompare(a.lastDate));
    res.set("Cache-Control", "private, no-store").json({ hosts, company: u.W.company || "" }); });

  // ---- the host's earnings and retention ----
  const seatsBy = (L) => Object.fromEntries(L.map((r) => [r.id, evGet(r.id)?.hostSeats || []]));
  app.get("/api/bb/host/earnings", (req, res) => { const H = hostMe(req, res); if (!H) return; const L = BB().reqs().filter((r) => r.hostWs === H.ws); let fol = new Set(); try { fol = new Set(C.followersOf(H.ws).map((f) => lc(f.email))); } catch {}
    const E = hostEarnings(L, { hostSeats: seatsBy(L), followerEmails: fol }), next = scopeStore(store, H.ws).get("teambook/next")?.data?.list || [];
    res.set("Cache-Control", "private, no-store").json({ ...E, followers: fol.size, nextOptIns: next.length }); });

  // ---- what it's like: recap photos the host chose and quotes guests agreed to, on the experience page ----
  app.get("/api/bb/x/:handle/:pkg/like", (req, res) => { const ws = C.wsOfHandle(lc(req.params.handle)); if (!ws) return bad(res, "Not found.", 404, "not_found");
    const recap = (scopeStore(store, ws).get("teambook/recap")?.data?.photos || []).filter((p) => p.consent === true && /^\/_blob\/[A-Za-z0-9]{20}$/.test(p.url)).slice(0, 6), quotes = [], rules = new Map();
    for (const r of BB().reqs().filter((x) => x.hostWs === ws && statusOf(x) === "done")) { const ev = evGet(r.id); if (!ev) continue; for (const q of surveySummary(ev.survey?.tokens, ev.survey?.responses).quotes) quotes.push({ ...q, event: r.pkgName }); if (ev.brief) rules.set(ev.brief.photos, (rules.get(ev.brief.photos) || 0) + 1); }
    const photosRule = [...rules.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "consent";
    res.set("Cache-Control", "public, max-age=60").json({ photos: recap, quotes: quotes.slice(0, 4), capture: { rule: photosRule, line: PHOTOS[photosRule], always: "Guests choose whether to be photographed and quoted. Nothing goes out with a name unless they agree." } }); });
  app.post("/api/bb/host/recap", small, (req, res) => { const H = hostMe(req, res); if (!H) return; const L = (Array.isArray(req.body?.photos) ? req.body.photos : []).filter((p) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(p?.url || "")).slice(0, 12).map((p) => ({ url: p.url, caption: clean(p.caption, 120), consent: p.consent === true }));
    scopeStore(store, H.ws).set("teambook/recap", { photos: L, at: Date.now() }); res.json({ ok: true, photos: L }); });

  // ---- internal metrics, for us ----
  app.get("/api/admin/brand-metrics", (req, res) => { const u = me(req); if (!u || !isAdmin(u.email)) return bad(res, "Not found.", 404, "not_found"); const L = BB().reqs(), share = [];
    for (const x of BB().allSetups()) { let fol = new Set(); try { fol = new Set(C.followersOf(x.ws).map((f) => lc(f.email))); } catch {} let attended = 0, from = 0;
      for (const d of scopeStore(store, x.ws).list("events")) { const e = d.data || {}; for (const g of e.guests || []) { if (!/attended|going|yes/i.test(g.status || "")) continue; attended++; if (fol.has(lc(g.email))) from++; } }
      for (const d of scopeStore(store, x.ws).list("rsvps")) { const r = d.data || {}; if (r.response !== "going") continue; attended++; if (fol.has(lc(r.email))) from++; }
      share.push({ ws: x.ws, attended, fromFollowers: from }); }
    res.set("Cache-Control", "private, no-store").json(internalMetrics(L, { hostSeats: seatsBy(L), followerShare: share })); });

  return { evGet, evOf, evSet, note, cGet, cSet, cList, campOf, eventsOf, eventView, tokenFor, hostName, nameOf, brandMe, hostMe, brandEvent, hostEvent, me, outcomesOf: (id) => { const c = cGet(id); return c ? outcomesOf(c, eventsOf(c)) : null; }, outcomesFor: (c) => outcomesOf(c, eventsOf(c)) };
}

// ---------------------------------------------------------------------------------------------------------------
// The one-page summary finance and sales read without learning event software. No guest names or emails.
export function summaryHtml(E) {
  const d = (x) => (x ? new Date(x + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
  const T = (E.timeline || []).map((t) => `<li><time>${esc(new Date(t.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</time><span>${esc(t.by === "host" ? E.host.name : t.by === "brand" ? E.company : "")}</span> ${esc(t.what)}</li>`).join("");
  const X = E.exposure ? E.exposure.rows.map((r) => `<li>${esc(r.label)}</li>`).join("") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(E.name)} · Event summary</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/teams-intel.css"><link rel="stylesheet" href="/teams-panel.css"></head>
<body class="rp tp-sum"><main class="rp-page">
<div class="rp-mast"><span class="rp-mname">Event summary</span><span class="rp-mdate">Read only</span></div>
<header class="rp-head"><p class="rp-kicker">${esc(E.company)} · with ${esc(E.host.name)}</p><h1>${esc(E.name)}</h1><p class="rp-stand">${esc(d(E.date) || "Date to agree")} · ${E.headcount} people · ${esc(E.money.summary || "")}</p>
<button class="rp-print" onclick="window.print()">Print or save as PDF</button></header>
<section class="tp-sum-grid">
<div><p class="ti-k">Owner</p><p class="tp-big">${esc(E.owner?.name || E.owner?.email || "")}</p></div>
<div><p class="ti-k">Status</p><p class="tp-big">${esc(E.statusLine)}</p></div>
<div><p class="ti-k">Approval</p><p class="tp-big">${esc(E.approval.line)}</p></div>
<div><p class="ti-k">Brief</p><p class="tp-big">${esc(E.briefState.line)}</p></div>
</section>
<section class="rp-sec"><h2><span class="rp-no">01</span>Money</h2><ul class="rp-money"><li><span>Total</span><b>${esc(money0(E.money.totalCents))}</b></li><li><span>Paid so far</span><b>${esc(money0(E.money.paidCents))}</b></li><li><span>Still due</span><b>${esc(money0(E.money.dueCents))}</b></li></ul>
${X ? `<p class="ti-k" style="margin-top:16px">If plans change</p><ul class="tp-list">${X}</ul><p class="tp-note">${esc(E.exposure.line)}</p>` : ""}</section>
${E.briefLines.length ? `<section class="rp-sec"><h2><span class="rp-no">02</span>The brief</h2><ul class="tp-list">${E.briefLines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>` : ""}
<section class="rp-sec"><h2><span class="rp-no">03</span>Spots</h2><ul class="rp-money"><li><span>Brand invited</span><b>${E.seats.brand.invited}</b></li><li><span>Host-sourced</span><b>${E.seats.host.added}</b></li><li><span>Came</span><b>${E.seats.attended}</b></li></ul></section>
<section class="rp-sec"><h2><span class="rp-no">04</span>Timeline</h2><ol class="tp-tl">${T || "<li>Nothing yet.</li>"}</ol></section>
<footer class="rp-foot"><p>From Pottery Lab. This page has no guest names or emails. Anyone with the link can read it; the team can turn the link off.</p></footer>
</main></body></html>`;
}
