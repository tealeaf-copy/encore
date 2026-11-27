// The brand panel, round 2: what the panel asked for after round 1 (docs/brand-panel-update-r2.md). Built on the round 1
// pieces (server/brandpanel.js), the team bookings (server/brandbook.js) and campaigns (server/campaigns.js).
//
//   Recovery ......... a host cancels close to the date: one owner is alerted, up to 3 comparable hosts (same city,
//                      date window, capacity and price band, with what differs), a one-tap rebook that keeps the brief,
//                      a drafted guest note, refund or credit, and a drill in pilot mode that times the whole thing
//   Company .......... a workspace's company: teams share the approval rule, brand rules and invoicing (system/bporg-)
//   Account dinners .. the marketer picks accounts and budget, account owners approve their customers, the host
//                      approves the mix, and each account owner sees only their own follow-ups
//   Pricing .......... the host's standard price, any custom-work fee and the prep hours as separate lines; prep hours
//                      logged; repeated unpaid revisions flagged
//   Report ........... follow-up speed per account owner, matched guests' threads and whether they met again, event
//                      tiers with a forwardable paragraph, RSVP preferences (aggregates only for the brand), feedback
//                      the host reads first, "two changes for next time", a rebooking rule set before invites
//   Formats .......... a library of formats with a run of show, size, what guests do and room rules; room rules are
//                      standard brief fields (server/brandpanel.js cleanRoom)
//   Lift ............. recommendations as lift against a comparison, with both denominators and each outcome's source
//   Durability ....... Book again brings the guest layer, repeat pairs pay half the platform fee, followers export to
//                      CSV on the host's consent basis, cross-host discovery with opt in, and the bars on
//                      /admin/brand-metrics; founding hosts, design-partner auto-rebook and a crossover test
//
// Privacy, kept here and tested (test/brand-panel-r2.test.js): pooled numbers need 10+ people and 3+ events (K);
// the brand sees RSVP preferences only in aggregate; follower export is only people who followed the host; cross-host
// invites only reach guests who ticked "tell me about similar hosts"; matched threads open only when both said yes.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scopeStore, getWorkspace, getDbUser, membersOf, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { availabilityFor, approxArea, statusOf, isBooked, priceFor, money, FEE_BPS } from "./brandbook.js";
import { campaignRole, can, themesOf } from "./campaigns.js";
import { K, prefsOf } from "./insights.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { isAdmin } from "./metrics.js";
import { MAX_TEXT, MSG_PER_MIN } from "./chat.js";
import { idOf, keyFor, csvCell } from "./people.js";
import { GOALS, TOGETHER, PHOTOS, ofN, briefLines, editBrief, cleanRoom, ROOM_DEFAULTS, roomLines, surveySummary } from "./brandpanel.js";

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
const short = (d) => (ISO.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
const money0 = (c) => "$" + Math.round((+c || 0) / 100).toLocaleString("en-US");
const normCo = (s) => lc(s).replace(/[^a-z0-9 ]/g, " ").replace(/\b(inc|llc|ltd|co|corp|corporation|the)\b/g, " ").replace(/\s+/g, " ").trim();
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const LIVE = ["accepted", "booked", "done"];
const paidOf = (r) => (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + (p.cents || 0), 0);

// ---------------------------------------------------------------------------------------------------------------
// 1. Recovery: comparable replacements when a host cancels. Hard rules: the same city, the group fits, open within the
// date window, inside the price band. Each option says what differs from the original. Thin results say so.
export const RECOVERY = { closeDays: 7, windowDays: 3, band: 0.3, max: 3 };
export function pickReplacements(cands = [], base = {}, { windowDays = RECOVERY.windowDays, band = RECOVERY.band, max = RECOVERY.max } = {}) {
  const city = lc(base.city), pp = base.perPersonCents || 0, out = [];
  const near = (x) => (x.dateState === "open" ? base.date : x.altDate && Math.abs(daysBetween(base.date, x.altDate)) <= windowDays ? x.altDate : "");
  const fits = cands.filter((x) => x.handle !== base.handle && (!city || lc(x.city) === city) && base.headcount >= x.minGuests && base.headcount <= x.maxGuests && near(x) && (!pp || Math.abs(x.perPersonCents - pp) <= pp * band));
  const scored = fits.map((x) => { const date = near(x), diff = x.totalCents - (base.totalCents || 0), differs = [];
    if (date !== base.date) differs.push(`${short(date)} instead of ${short(base.date)}`);
    if (diff) differs.push(`${money0(Math.abs(diff))} ${diff > 0 ? "more" : "less"} in total`);
    if (base.area && x.area && lc(x.area) !== lc(base.area)) differs.push(`In ${x.area}, not ${base.area}`);
    const shared = (x.moods || []).filter((m) => (base.moods || []).includes(m)).length; if (base.moods?.length && !shared) differs.push("A different kind of experience");
    if (x.maxGuests < (base.maxGuests || 0)) differs.push(`Room for ${x.maxGuests} at most`);
    return { ...x, date, priceDiffCents: diff, differs: differs.length ? differs : ["Nothing major: same city, date, size and price band"], score: (date === base.date ? 50 : 20) + shared * 10 - Math.round(Math.abs(diff) / 2000) + Math.round((x.quality || 0) * 0.2) }; });
  scored.sort((a, b) => b.score - a.score || Math.abs(a.priceDiffCents) - Math.abs(b.priceDiffCents));
  const seen = new Set(); for (const x of scored) { if (seen.has(x.handle)) continue; seen.add(x.handle); out.push(x); if (out.length === max) break; }
  const thin = out.length < max;
  return { options: out, thin, line: !out.length ? "No comparable host is open that week in this city. Your money comes back in full, and we'll tell you if one opens up." : thin ? `Only ${out.length === 1 ? "one comparable host is" : `${out.length} comparable hosts are`} open in that window. Choices are thin, so check what differs.` : "Three comparable hosts are open. Each one says what differs." };
}
/** The note to guests, drafted and ready to send. Plain, no blame, the same evening when we can. */
export function guestChangeNote({ company = "", oldName = "", newName = "", newHost = "", date = "", sameDate = true, from = "" } = {}) {
  const when = short(date);
  return { subject: sameDate ? `Change of plan, same evening: ${newName}` : `Change of plan: ${newName} on ${when}`,
    text: `${sameDate ? "Change of plan, same evening." : `Change of plan: we've moved to ${when}.`} ${oldName ? `${oldName} can't go ahead, so ` : ""}we're now at ${newName}${newHost ? ` with ${newHost}` : ""}${sameDate ? `, still on ${when}` : ""}. Your spot is kept, and nothing else changes for you.${from ? `\n\n${from}${company ? `, ${company}` : ""}` : company ? `\n\n${company}` : ""}` };
}
/** Money when the host cancels: everything paid comes back, as a refund or (the brand's pick) as credit on the rebook. */
export function recoveryMoney(r = {}, choice = "refund") {
  const paid = paidOf(r), cents = Math.max(paid, r.refund?.cents || 0), c = choice === "credit" ? "credit" : "refund";
  return { choice: c, cents, line: !cents ? "Nothing was paid yet, so nothing is owed." : c === "credit" ? `${money(cents)} kept as credit toward the new booking.` : `${money(cents)} back to you in full.`, policy: "If your host can't make it, we find a replacement or refund you." };
}
export function drillSummary(drills = []) {
  const D = drills.filter((d) => d.finishedAt), m = D.map((d) => Math.max(0, Math.round((d.finishedAt - d.startedAt) / 6e3) / 10));
  return { runs: D.length, minutes: m, last: m.length ? m[m.length - 1] : null, best: m.length ? Math.min(...m) : null, line: D.length ? `Last drill: recovered in ${m[m.length - 1]} minutes${D[D.length - 1].thin ? ", with thin choices" : ""}.` : "No drill yet." };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. A company with more than one team: shared defaults, and what each team inherits.
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "example.com"]);
export const domainOf = (email) => { const d = lc(String(email || "").split("@")[1]); return d && !FREE_MAIL.has(d) ? d : ""; };
export function cleanOrgDefaults(b = {}, cur = {}) {
  const R = b.rules || {}, cr = cur.rules || {}, B = b.brand || {}, cb = cur.brand || {}, I = b.invoicing || {}, ci = cur.invoicing || {};
  const approval = ["off", "over", "always"].includes(R.approval) ? R.approval : cr.approval || "off";
  return { rules: { approval, overCents: R.overCents != null ? int(R.overCents, 0, 1e9) : cr.overCents || 0, approvers: (R.approvers != null ? (Array.isArray(R.approvers) ? R.approvers : String(R.approvers).split(/[\s,]+/)) : cr.approvers || []).map(lc).filter((e) => EMAIL_RE.test(e)).slice(0, 10) },
    brand: { photos: Object.prototype.hasOwnProperty.call(PHOTOS, B.photos) ? B.photos : cb.photos || "consent", room: cleanRoom(B.room || {}, cb.room) },
    invoicing: { company: clean(I.company ?? ci.company, 120), taxId: clean(I.taxId ?? ci.taxId, 40), address: clean(I.address ?? ci.address, 300), po: clean(I.po ?? ci.po, 40) } };
}
/** What one team books under: its own approval rule if it set one, otherwise the company's; the company's brand rules and invoicing. */
export function inherited(org, own = {}) {
  if (!org) return null; const D = org.defaults || cleanOrgDefaults();
  return { rules: own.rules || D.rules, rulesFrom: own.rules ? "team" : "company", brand: D.brand, invoicing: D.invoicing, lines: [own.rules ? "Approval: this team's own rule" : `Approval: ${D.rules.approval === "off" ? "none needed" : D.rules.approval === "always" ? "every booking" : `over ${money0(D.rules.overCents)}`}, from ${org.name}`, `Photos: ${PHOTOS[D.brand.photos]}`, `Room rules: ${roomLines(D.brand.room).join(". ")}`, `Invoices to ${D.invoicing.company || org.name}${D.invoicing.po ? `, PO ${D.invoicing.po}` : ""}`] };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Account dinners: who approves what, in order. 14. Room rules decide who is kept out.
export function abmAccountOf(c, g) { const k = normCo(g?.company); return k ? (c.abm?.accounts || []).find((a) => normCo(a.account) === k) || null : null; }
export function competitorOf(brief, g) { const k = normCo(g?.company); return !!k && (brief?.room?.competitors || []).some((x) => normCo(x) === k); }
/** Why a guest's invite waits, or "" to send: competitors stay out; account guests wait for their owner, then the host's OK on the mix. */
export function inviteHoldFor(c, g, ev = null) {
  if (ev?.brief && competitorOf(ev.brief, g)) return "Kept out by the room rules (a competitor)";
  const A = abmAccountOf(c, g); if (!A) return "";
  const ap = c.abm?.approvals?.[g.id]; if (!ap) return `Waiting on ${A.ownerName || A.owner} to approve`; if (ap.state === "no") return `${A.ownerName || A.owner} said not this time`;
  if (ev && ev.mixApproval?.state !== "yes") return "Waiting on the host to approve the mix";
  return "";
}
export function abmState(c, { events = [], evOf = () => null } = {}) {
  const A = c.abm?.accounts || [], G = (c.guests || []).filter((g) => abmAccountOf(c, g)), ap = c.abm?.approvals || {};
  const accounts = A.map((a) => { const mine = G.filter((g) => normCo(g.company) === normCo(a.account)); return { account: a.account, owner: a.owner, ownerName: a.ownerName || "", guests: mine.length, approved: mine.filter((g) => ap[g.id]?.state === "yes").length, declined: mine.filter((g) => ap[g.id]?.state === "no").length, waiting: mine.filter((g) => !ap[g.id]).length }; });
  const mix = events.map((r) => { const ev = evOf(r) || {}; return { id: r.id, name: r.pkgName, state: ev.mixApproval?.state || "waiting", note: ev.mixApproval?.note || "" }; });
  const stage = !A.length ? "accounts" : accounts.some((a) => a.waiting) ? "owners" : mix.some((m) => m.state !== "yes") ? "host" : "ready";
  return { budgetCents: c.abm?.budgetCents || 0, accounts, mix, stage, line: { accounts: "Pick the target accounts and the budget.", owners: "Waiting on account owners to approve who's invited.", host: "Waiting on the host to approve the mix.", ready: "Approved. Invites can go out." }[stage] };
}
/** The proposed mix the host approves: companies and counts, no names or emails. */
export function mixFor(c, eventId) { const by = new Map(); for (const g of (c.guests || []).filter((x) => x.event === eventId && x.status !== "asked")) { const A = abmAccountOf(c, g); if (A && c.abm?.approvals?.[g.id]?.state !== "yes") continue; const k = clean(g.company, 80) || "Not given"; by.set(k, (by.get(k) || 0) + 1); }
  return [...by.entries()].map(([company, n]) => ({ company, n })).sort((a, b) => b.n - a.n); }
/** Each account owner sees only the follow-ups for their own accounts. */
export function tasksForOwner(c, email) {
  const mine = new Set((c.abm?.accounts || []).filter((a) => lc(a.owner) === lc(email)).map((a) => normCo(a.account)));
  const gid = new Map((c.guests || []).map((g) => [g.id, g]));
  return (c.tasks || []).filter((t) => { const g = gid.get(t.guest); return g && mine.has(normCo(g.company)); });
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Pricing on the approval page: standard price, custom work and prep hours as separate lines.
export function withCustomFee(price, customCents = 0) {
  const c = int(customCents, 0, 1e9); if (!price) return price; const base = (price.lines || []).filter((l) => l.k !== "custom");
  const before = base.reduce((a, l) => a + (l.cents || 0), 0), total = before + c, deposit = Math.round((total * (price.depositPct || 25)) / 100);
  const lines = c ? [...base.slice(0, 1), ...base.slice(1).filter((l) => l.k === "minimum"), { k: "custom", label: "Custom work", cents: c, note: "Agreed with the host" }, ...base.filter((l) => !["people", "minimum"].includes(l.k))] : base;
  return { ...price, lines, customCents: c, totalCents: total, depositCents: deposit, balanceCents: total - deposit, summary: price.headcount ? `${money0(total)} total for ${price.headcount}` : "", effectivePerPersonCents: price.headcount ? Math.round(total / price.headcount) : 0 };
}
export function cleanPrep(b = {}, cur = {}) {
  const P = { customFeeCents: cur.customFeeCents || 0, prepHours: cur.prepHours ?? null, customNote: cur.customNote || "", logged: cur.logged || [], revisions: cur.revisions || [] };
  if (b.customFee != null && b.customFee !== "") P.customFeeCents = int(+String(b.customFee).replace(/[^\d.]/g, "") * 100, 0, 1e8);
  if (b.prepHours != null && b.prepHours !== "") P.prepHours = Math.max(0, Math.min(400, Math.round(+b.prepHours * 2) / 2));
  if (b.customNote != null) P.customNote = clean(b.customNote, 200);
  if (b.log && +b.log.hours > 0) P.logged = [...P.logged, { hours: Math.min(48, Math.round(+b.log.hours * 4) / 4), note: clean(b.log.note, 140), at: Date.now() }].slice(-100);
  if (b.revision && clean(b.revision.note, 200)) P.revisions = [...P.revisions, { id: rid(3), note: clean(b.revision.note, 200), paid: b.revision.paid === true, at: Date.now() }].slice(-50);
  if (b.paid && typeof b.paid === "string") P.revisions = P.revisions.map((x) => (x.id === b.paid ? { ...x, paid: true } : x));
  return P;
}
/** Revisions: brand edits to the brief after the host agreed, change requests, and any the host logged. Two or more unpaid ones are flagged. */
export function revisionsOf(ev = {}) {
  const H = ev.brief?.history || [], firstHost = H.findIndex((h) => h.by === "host"), auto = firstHost < 0 ? 0 : H.slice(firstHost + 1).filter((h) => h.by === "brand" && /changed the brief/.test(h.what)).length;
  const asked = (ev.changes || []).length, logged = ev.prep?.revisions || [], paidLogged = logged.filter((x) => x.paid).length, covered = (ev.prep?.customFeeCents || 0) > 0;
  const total = auto + asked + logged.length, unpaid = covered ? logged.filter((x) => !x.paid).length : total - paidLogged;
  return { total, auto, asked, logged: logged.length, unpaid, flag: unpaid >= 2, line: unpaid >= 2 ? `${plural(unpaid, "revision")} so far without a custom-work fee. Agree a fee, or keep the brief as it is.` : total ? `${plural(total, "revision")} so far.` : "No revisions yet." };
}
export function pricingView(r, F, ev = {}) {
  const list = F ? priceFor(F.p, r.headcount, { feeBps: 0 }).subtotalCents : null, P = ev.prep || {}, hours = (P.logged || []).reduce((a, x) => a + x.hours, 0), std = r.price?.subtotalCents ?? list ?? 0;
  const lines = [{ k: "standard", label: `${F?.p?.name || r.pkgName}: the host's standard price for ${r.headcount}${list != null && list !== std ? ` (agreed with the host; the list price is ${money(list)})` : ""}`, cents: std },
    { k: "custom", label: P.customFeeCents ? `Custom work${P.customNote ? `: ${P.customNote}` : ""}` : "Custom work: none", cents: P.customFeeCents || 0 },
    { k: "fee", label: "Pottery Lab booking fee", cents: r.price?.feeCents || 0 }, { k: "tax", label: "Sales tax", cents: r.price?.taxCents || 0 }];
  return { lines, totalCents: lines.reduce((a, l) => a + l.cents, 0), prepHours: P.prepHours ?? null, prepLine: P.prepHours != null ? `About ${P.prepHours} hours of prep from the host` : "The host hasn't said how much prep this takes yet", loggedHours: hours, revisions: revisionsOf(ev) };
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Follow-up speed: target-account follow-ups done within 7 days, per account owner. Customer dinners and
// brand-invited seats only; host-sourced guests get a sales task only when they opted in, and never count here.
export function followUpSpeed(c, events = [], { today = isoDay(), names = {} } = {}) {
  const targets = new Set((c.targets || []).map(normCo).filter(Boolean)), G = new Map((c.guests || []).map((g) => [g.id, g]));
  const dates = new Map(events.filter((e) => e.goal === "customer" && e.date).map((e) => [e.id, e.date])), by = new Map();
  for (const t of c.tasks || []) { const g = G.get(t.guest), d = dates.get(t.event); if (!g || !d || t.team !== "sales" || !targets.has(normCo(g.company))) continue;
    const due = addDays(d, 7), done = t.status === "done" && t.doneAt && isoDay(t.doneAt) <= due; if (t.status !== "done" && due >= today) continue; // still inside its 7 days: not counted yet
    const k = lc(t.owner) || "unassigned", x = by.get(k) || { owner: k, name: names[k] || "", n: 0, of: 0 }; x.of++; if (done) x.n++; by.set(k, x); }
  const rows = [...by.values()].map((x) => ({ ...x, ...ofN(x.n, x.of, "done within 7 days") })).sort((a, b) => b.of - a.of);
  const n = rows.reduce((a, x) => a + x.n, 0), of = rows.reduce((a, x) => a + x.of, 0);
  return { rows, total: ofN(n, of, "target-account follow-ups done within 7 days"), scope: "Customer dinners, brand-invited seats at target accounts. Host-sourced guests are left out of sales tasks unless they opted in." };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Matched guests: a light thread, a nudge at a week to meet within two, and whether they did.
export const PAIR = { nudgeDays: 7, windowDays: 14 };
export function openPair(ev, a, b, now = Date.now()) { const L = (ev.pairs ||= []); let p = L.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)); if (!p) { p = { id: rid(4), a, b, openedAt: now, messages: [], met: {}, nudgedAt: 0 }; L.push(p); } return p; }
export function pairPost(p, from, text, now = Date.now()) {
  if (from !== p.a && from !== p.b) return { error: "Not your thread." }; const t = clean(text, MAX_TEXT); if (!t) return { error: "Write a message first." };
  if (p.messages.filter((m) => m.by === from && now - m.at < 60e3).length >= MSG_PER_MIN) return { error: "Slow down a little." };
  p.messages = [...p.messages, { by: from, text: t, at: now }].slice(-200); return { ok: true };
}
export function pairNudgeDue(p, now = Date.now()) { return !p.nudgedAt && !Object.values(p.met || {}).some(Boolean) && now - p.openedAt >= PAIR.nudgeDays * DAY && now - p.openedAt < PAIR.windowDays * DAY; }
export const NUDGE_TEXT = "A gentle nudge: two weeks is a good window to meet again. Coffee, a walk, or a call. Tap \"We met up\" when you do.";
export function pairStats(pairs = []) {
  const met = pairs.filter((p) => Object.values(p.met || {}).some(Boolean)), inWin = met.filter((p) => Object.values(p.met).some((t) => t && t - p.openedAt <= PAIR.windowDays * DAY));
  return { opened: pairs.length, talked: ofN(pairs.filter((p) => new Set(p.messages.map((m) => m.by)).size >= 2).length, pairs.length, "matched pairs wrote to each other"),
    met: ofN(met.length, pairs.length, "matched pairs met again"), metInWindow: ofN(inWin.length, pairs.length, "met again within 2 weeks") };
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Event tiers, and a paragraph a CMO can forward, from the event's own numbers.
export const TIERS = {
  1: { tier: 1, label: "Tier 1: a customer dinner", definition: "One event, about 12 people, one host.", depth: ["Quick book", "Agree the brief", "Invite", "Run", "Report"], teamHours: 6 },
  2: { tier: 2, label: "Tier 2: a series or an offsite", definition: "Two to five events, or one offsite for more than 20 people or more than a day.", depth: ["Campaign plan", "Shortlist and compare", "Brief per event", "Approvals", "Invites in waves", "Run", "Report per event and for the series"], teamHours: 20 },
  3: { tier: 3, label: "Tier 3: a city program", definition: "Six or more events, or events in more than one city.", depth: ["Program plan and budget", "Account owners approve", "Hosts in each city", "Briefs and room rules", "Invites by account", "Run in each city", "Program report and rebooking rule"], teamHours: 60 },
};
export function tierOf({ events = 1, cities = 1, headcount = 0, days = 1 } = {}) { return TIERS[cities > 1 || events >= 6 ? 3 : events >= 2 || headcount > 20 || days > 1 ? 2 : 1]; }
export const HYPE = /\b(amazing|incredible|unlock\w*|seamless\w*|effortless\w*|elevat\w*|curated|magical|game.?chang\w*|massive|huge|best.ever|unforgettable|world.class|revolution\w*)\b|!/i;
export function tierNarrative({ company = "", tier, events = [], totals = null, speed = null, pairs = null, hours = null } = {}) {
  const T = tier || TIERS[1], n = events.length, hosts = [...new Set(events.map((e) => e.hostName).filter(Boolean))], done = events.filter((e) => e.status === "done").length, S = [];
  S.push(`${company || "The team"} ran ${plural(n, "event")} as ${T.label.split(": ")[1]}${hosts.length ? `, with ${hosts.slice(0, 3).join(", ")}${hosts.length > 3 ? ` and ${hosts.length - 3} more` : ""}` : ""}${n !== done ? ` (${done} of ${n} have happened)` : ""}.`);
  if (totals && done) { const A = totals.attendance, Tg = totals.targets, Sv = totals.survey;
    if (A.brand.of) S.push(`${A.brand.text} brand-invited guests who said yes came${A.host.of ? `, and ${A.host.text} host-sourced guests` : ""}.`);
    if (Tg.accounts) S.push(`${Tg.invited.text} target accounts were invited and ${Tg.attended.n} came.`);
    if (Sv.useful.of) S.push(`${Sv.useful.text} guests who answered the survey made a useful connection.`);
    S.push(`The team logged ${plural(totals.meetings, "meeting")} and ${plural(totals.opportunities.n, "opportunity", "opportunities")}.`); }
  if (speed?.total.of) S.push(`${speed.total.text} target-account follow-ups were done within 7 days.`);
  if (pairs?.opened) S.push(`${pairs.met.text} matched pairs met again.`);
  S.push(`Suggested team time for this tier is ${T.teamHours} hours${hours != null ? `; the host logged ${hours} hours of prep` : ""}.`);
  return S.join(" ");
}

// ---------------------------------------------------------------------------------------------------------------
// 8. The optional RSVP question. The host sees each guest's answer to shape small groups; the brand only aggregates.
export const PARTS = { food: "The food", talk: "The conversation", activity: "The activity", people: "Meeting new people" };
export const INTROS = { yes: "Yes, introduce me", maybe: "Maybe, if it fits", no: "I'd rather not" };
export const PREF_QUESTION = { part: "Which part of the evening are you here for?", intros: "Do you welcome introductions?", note: "Optional. Only the host sees your answer, to shape small groups." };
export function cleanPrefs(b = {}, cur = null) { const part = Object.prototype.hasOwnProperty.call(PARTS, b.part) ? b.part : cur?.part || "", intros = Object.prototype.hasOwnProperty.call(INTROS, b.intros) ? b.intros : cur?.intros || ""; return part || intros ? { part, intros, at: Date.now() } : cur; }
/** Small groups for the host: people who welcome introductions spread across tables, the same part together where it fits. */
export function groupsFor(guests = [], size = 6) {
  const L = guests.filter((g) => g.prefs), k = Math.max(1, Math.ceil(guests.length / size)), groups = Array.from({ length: k }, (_, i) => ({ n: i + 1, people: [] }));
  const order = [...L].sort((a, b) => (a.prefs.intros === "yes" ? 0 : a.prefs.intros === "maybe" ? 1 : 2) - (b.prefs.intros === "yes" ? 0 : b.prefs.intros === "maybe" ? 1 : 2) || String(a.prefs.part).localeCompare(String(b.prefs.part)));
  order.forEach((g, i) => groups[i % k].people.push({ first: first(g.name), part: PARTS[g.prefs.part] || "", intros: INTROS[g.prefs.intros] || "" }));
  return { groups, answered: L.length, of: guests.length };
}
export function prefAggregate(guests = []) {
  const L = guests.filter((g) => g.prefs), events = new Set(L.map((g) => g.event)).size;
  if (L.length < K.people || events < K.events) return { shown: false, n: L.length, events, line: `Shown once ${K.people} guests across ${K.events} events have answered (${L.length} so far, ${plural(events, "event")}).` };
  const cell = (M, k) => Object.entries(M).map(([id, label]) => { const n = L.filter((g) => g.prefs[k] === id).length; return { id, label, n: n >= 3 ? n : null, pct: n >= 3 ? pct(n, L.length) : null }; });
  return { shown: true, n: L.length, events, parts: cell(PARTS, "part"), intros: cell(INTROS, "intros"), line: `${L.length} guests across ${events} events answered. Options with fewer than 3 answers are hidden.` };
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Feedback the host reads first; the brand's own customers' summary after. Two changes for next time, agreed by both.
export const BRAND_WAIT_DAYS = 3;
export function feedbackFor(ev, side, { date = "", now = Date.now() } = {}) {
  const T = ev.survey?.tokens || {}, R = ev.survey?.responses || {}, rows = Object.entries(R).map(([t, a]) => ({ t, side: T[t]?.side, first: T[t]?.first || "", a }));
  if (side === "host") return { comments: rows.filter((x) => x.a.said || x.a.takeaway).map((x) => ({ said: x.a.said || "", takeaway: x.a.takeaway || "", from: x.side === "host" ? "Your guest" : "A brand guest", name: x.a.quoteOk ? x.first : "" })), respondents: rows.length };
  const ready = !!ev.feedback?.hostSeenAt || (date && now - Date.parse(date + "T23:59:59Z") > BRAND_WAIT_DAYS * DAY), mine = rows.filter((x) => x.side === "brand");
  const S = surveySummary(Object.fromEntries(Object.entries(T).filter(([, x]) => x.side === "brand")), Object.fromEntries(mine.map((x) => [x.t, x.a])));
  return { ready, line: ready ? "Your customers' experience, in aggregate." : `The host reads the comments first. Your summary opens when they have, or ${BRAND_WAIT_DAYS} days after the event.`,
    respondents: ofN(mine.length, Object.values(T).filter((x) => x.side === "brand").length, "of your guests answered"), useful: S.useful, back: S.back,
    themes: ready ? themesOf(mine.map((x) => [x.a.said, x.a.takeaway].filter(Boolean).join(" "))) : { shown: false, n: mine.length, themes: [] }, quotes: ready ? mine.filter((x) => x.a.quoteOk && (x.a.said || x.a.takeaway).length > 12).slice(0, 3).map((x) => ({ text: x.a.takeaway || x.a.said, name: x.first })) : [] };
}
export function editNextTime(cur, b = {}, side = "brand", who = "") {
  const base = cur || { v: 0, items: [], brand: null, host: null };
  if (b.items) { const items = (Array.isArray(b.items) ? b.items : [b.items]).map((x) => clean(x, 140)).filter(Boolean).slice(0, 2); if (items.length !== 2) return { error: "Write two changes, one in each box." };
    if (JSON.stringify(items) !== JSON.stringify(base.items)) { const v = base.v + 1; return { next: { v, items, brand: side === "brand" ? { v, by: who, at: Date.now() } : null, host: side === "host" ? { v, by: who, at: Date.now() } : null } }; } }
  if (!base.items.length) return { error: "Write the two changes first." };
  return { next: { ...base, [side]: { v: base.v, by: who, at: Date.now() } } };
}
export const nextTimeAgreed = (n) => !!n && n.items?.length === 2 && n.brand?.v === n.v && n.host?.v === n.v;

// ---------------------------------------------------------------------------------------------------------------
// 10. The rebooking rule: set in the brief before invites go out, evaluated by the report.
export const RULE_METRICS = { targetsAttended: "named target accounts came", usefulPct: "% of guests who answered made a useful connection", meetings: "meetings logged", mutual: "connections both guests said yes to" };
export function cleanRule(b = {}) {
  const metric = Object.prototype.hasOwnProperty.call(RULE_METRICS, b.metric) ? b.metric : "targetsAttended", raw = Array.isArray(b.accounts) ? b.accounts : String(b.accounts || "").split(/[,\n]/);
  const accounts = [...new Set(raw.map((x) => clean(x, 100)).filter(Boolean))].slice(0, 50), atLeast = int(b.atLeast, 1, metric === "usefulPct" ? 100 : 500), useful = clean(b.useful, 240);
  if (!useful) return { error: "Say what a useful introduction means for you." }; if (metric === "targetsAttended" && !accounts.length) return { error: "Name the target accounts." };
  return { rule: { accounts, useful, metric, atLeast, at: Date.now() } };
}
export const ruleLine = (R) => (R ? `Book again if ${R.metric === "usefulPct" ? `${R.atLeast}% or more of guests who answered made a useful connection` : `${R.atLeast} or more ${RULE_METRICS[R.metric]}`}. A useful introduction means: ${R.useful}` : "");
/** E is one event from outcomesOf (server/brandpanel.js). */
export function evaluateRule(R, E) {
  if (!R) return { state: "none", line: "No rebooking rule yet." }; if (!E || E.status !== "done") return { state: "waiting", line: "Waiting on the event." };
  const acc = new Set(R.accounts.map(normCo)), v = R.metric === "targetsAttended" ? E.targets.attended.filter((a) => acc.has(normCo(a))).length : R.metric === "usefulPct" ? (E.survey.useful.of >= 5 ? pct(E.survey.useful.n, E.survey.useful.of) : null) : R.metric === "meetings" ? E.meetings : E.connections.mutual;
  if (v == null) return { state: "waiting", line: `Not enough survey answers yet (${E.survey.useful.of} of the 5 needed).`, value: null, target: R.atLeast };
  const met = v >= R.atLeast, unit = R.metric === "usefulPct" ? "%" : "", of = R.metric === "targetsAttended" ? ` of ${R.accounts.length} named` : R.metric === "usefulPct" ? ` of ${E.survey.useful.of} who answered` : "";
  return { state: met ? "met" : "missed", value: v, target: R.atLeast, line: `${met ? "Met" : "Not met"}: ${v}${unit}${of}, against ${R.atLeast}${unit}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// 11. The open-ended guest prompt. Fixed wording; a brand can't write survey lines.
export const TAKEAWAY_PROMPT = "What did you take away?";

// ---------------------------------------------------------------------------------------------------------------
// 12. Recommendations as lift against a comparison, with both denominators and each outcome's source.
export const SOURCES = { survey: "Guest survey", crm: "CRM record" };
export function liftRecs(cells = [], { minPeople = K.people, minEvents = K.events, audience = "", city = "" } = {}) {
  const ok = (x) => x.events >= minEvents && x.people >= minPeople, out = [], std = cells.find((x) => x.format === "standard" && ok(x));
  for (const x of cells.filter((c) => c.format !== "standard" && ok(c))) {
    const rest = std || cells.filter((c) => c !== x && c.format !== x.format).reduce((a, c) => ({ format: "other", label: "other formats", events: a.events + c.events, people: a.people + c.people, respondents: a.respondents + c.respondents, useful: a.useful + c.useful, meetings: a.meetings + c.meetings, attended: a.attended + c.attended }), { events: 0, people: 0, respondents: 0, useful: 0, meetings: 0, attended: 0 });
    if (!ok(rest)) continue; const label = std ? "standard dinners" : "other formats", who = `For ${audience || "guests"}${city ? ` in ${city}` : ""}, ${(TOGETHER[x.format]?.label || x.format).replace(/^an? /i, "").toLowerCase()}`;
    const rates = [];
    if (x.respondents >= minPeople && rest.respondents >= minPeople) { const a = x.useful / x.respondents, b = rest.useful / rest.respondents; if (b > 0) rates.push({ metric: "useful", source: SOURCES.survey, lift: Math.round((a / b) * 10) / 10, a: ofN(x.useful, x.respondents), b: ofN(rest.useful, rest.respondents), what: "useful-connection rate" }); }
    if (x.attended >= minPeople && rest.attended >= minPeople && rest.meetings > 0) { const a = x.meetings / x.events, b = rest.meetings / rest.events; rates.push({ metric: "meetings", source: SOURCES.crm, lift: Math.round((a / b) * 10) / 10, a: { n: x.meetings, of: x.events, text: `${x.meetings} meetings over ${x.events} events` }, b: { n: rest.meetings, of: rest.events, text: `${rest.meetings} meetings over ${rest.events} events` }, what: "meetings per event" }); }
    for (const R of rates) out.push({ format: x.format, against: label, ...R, events: x.events, againstEvents: rest.events, text: `${who}: ${R.lift.toFixed(1)}× the ${R.what} of ${label} (${x.events} events vs ${rest.events} events)`, sourceLine: `Source: ${R.source}` });
  }
  out.sort((a, b) => b.lift - a.lift);
  return { items: out, floor: { people: minPeople, events: minEvents }, note: out.length ? "Each line compares one format with a baseline, with both sample sizes. Lift under 1.0 means fewer than the baseline." : `Shown once a format and its comparison each have ${minPeople}+ people across ${minEvents}+ events.` };
}

// ---------------------------------------------------------------------------------------------------------------
// 13. The format library: each with a run of show, ideal size, what guests do together and the room rules.
const ros = (...L) => L.map(([at, what]) => ({ at, what }));
export const FORMATS = [
  { id: "roundtable", occasion: "customer", together: "roundtable", name: "Roundtable dinner", size: [10, 14], what: "Small tables of five to seven, one question for each course, and the host moves people at dessert.", ros: ros(["0:00", "Arrive, name tags, one drink"], ["0:20", "Seated, the host sets the first question"], ["1:15", "Second course, second question"], ["2:00", "Dessert, everyone moves tables"], ["2:30", "Close"]), rules: ["No slides", "The brand sits at the tables as guests", "Two brand staff at most"] },
  { id: "chefs-table", occasion: "customer", together: "introductions", name: "Chef's table", size: [8, 12], what: "The host cooks in front of the group and introduces people between courses.", ros: ros(["0:00", "Arrive at the counter"], ["0:15", "The host introduces everyone"], ["0:30", "Courses, with a story for each"], ["2:15", "Close"]), rules: ["No pitch", "Photos only with a yes"] },
  { id: "walk-and-talk", occasion: "customer", together: "introductions", name: "Walk and talk", size: [8, 16], what: "A planned walk in pairs that switch every 15 minutes, ending at a cafe.", ros: ros(["0:00", "Meet at the start, pairs drawn"], ["0:15", "Switch pairs"], ["0:30", "Switch pairs"], ["0:50", "Coffee together"], ["1:20", "Close"]), rules: ["Pairs switch on time", "No brand talk on the walk"] },
  { id: "tasting-flight", occasion: "customer", together: "roundtable", name: "Tasting flight", size: [8, 16], what: "Six tastes side by side, scored together, and a question at each pour.", ros: ros(["0:00", "Arrive, scoring cards out"], ["0:15", "First three pours"], ["0:50", "Break, swap seats"], ["1:05", "Last three pours"], ["1:40", "Scores and close"]), rules: ["The host leads, the brand pours nothing"] },
  { id: "cooking-competition", occasion: "team", together: "competition", name: "A cooking competition instead of a class", size: [10, 30], what: "Teams get a basket and an hour, the host judges, everyone eats the results.", ros: ros(["0:00", "Teams drawn, aprons on"], ["0:15", "Baskets open"], ["1:15", "Plates to the judge"], ["1:30", "Eat together, winners named"], ["2:00", "Close"]), rules: ["Mixed teams, not by department", "No speeches"] },
  { id: "craft-expert", occasion: "team", together: "class", name: "Craft night with an expert", size: [6, 16], what: "An expert maker teaches one piece start to finish; everyone leaves with it.", ros: ros(["0:00", "Arrive, materials out"], ["0:10", "The expert shows the piece"], ["0:25", "Make it, the expert goes table to table"], ["1:45", "Show and tell"], ["2:00", "Close"]), rules: ["Phones away while making"] },
  { id: "game-league", occasion: "team", together: "competition", name: "Game night league", size: [8, 40], what: "Short rounds of games picked for the group, teams reshuffled each round.", ros: ros(["0:00", "Arrive, teams drawn"], ["0:15", "Round one"], ["0:45", "Food break, reshuffle"], ["1:05", "Round two"], ["1:45", "Final and close"]), rules: ["Teams reshuffle every round"] },
  { id: "offsite-day", occasion: "team", together: "class", name: "Offsite day with a maker", size: [12, 40], what: "A morning making something, a long lunch, an afternoon session the team runs.", ros: ros(["9:30", "Arrive, coffee"], ["10:00", "Make something with the host"], ["12:30", "Long lunch"], ["14:00", "The team's own session"], ["16:00", "Close"]), rules: ["The host runs the morning, the team runs the afternoon"] },
  { id: "supper-series", occasion: "community", together: "introductions", name: "Supper club series", size: [10, 20], what: "The same table each month, half returning guests and half new, the host seats them.", ros: ros(["0:00", "Arrive, the host greets returning guests"], ["0:20", "Seated, introductions round"], ["2:00", "Close, next date shared"]), rules: ["Half the seats for returning guests", "The brand takes part as a guest"] },
  { id: "run-club", occasion: "community", together: "introductions", name: "Run and coffee", size: [8, 60], what: "A no-drop run in pace groups, then coffee where groups mix.", ros: ros(["0:00", "Meet, pace groups"], ["0:10", "Run"], ["0:50", "Coffee, groups mix"], ["1:20", "Close"]), rules: ["No-drop: nobody runs alone"] },
  { id: "skill-swap", occasion: "community", together: "roundtable", name: "Skill swap", size: [10, 24], what: "Guests teach each other one thing in ten minutes, in small rotating groups.", ros: ros(["0:00", "Arrive, sign up to teach"], ["0:20", "Rounds of ten minutes"], ["1:30", "Close"]), rules: ["No product demos"] },
  { id: "hands-on-class", occasion: "workshop", together: "class", name: "Hands-on class", size: [6, 16], what: "The host teaches a skill step by step; everyone makes their own.", ros: ros(["0:00", "Arrive, set up"], ["0:15", "Demo"], ["0:30", "Make"], ["1:45", "Share and close"]), rules: ["Photos only with a yes"] },
  { id: "makers-market", occasion: "workshop", together: "competition", name: "Make and trade", size: [8, 20], what: "Everyone makes two small pieces, then trades one with someone they just met.", ros: ros(["0:00", "Arrive, pick materials"], ["0:15", "Make"], ["1:30", "Trade and close"]), rules: ["Every guest trades with someone new"] },
];
export const formatOf = (id) => FORMATS.find((f) => f.id === id) || null;

// ---------------------------------------------------------------------------------------------------------------
// 15. Book again brings the guest layer. 16. Repeat pairs pay a smaller platform fee.
export function againPlan(prevEv = {}, prevGuests = []) {
  const T = prevEv.survey?.tokens || {}, R = prevEv.survey?.responses || {}, held = [], seen = new Set();
  for (const [t, a] of Object.entries(R)) if (a.nextOk && T[t]) { const k = T[t].email || t; if (seen.has(k)) continue; seen.add(k); held.push({ first: T[t].first || "", email: T[t].email || "", from: T[t].side === "host" ? "host" : "brand" }); }
  for (const g of prevGuests) if (g.checkedIn && g.again === true && !seen.has(g.email || g.id)) { seen.add(g.email || g.id); held.push({ first: first(g.name), email: g.email || "", from: "brand" }); }
  const pairs = (prevEv.connections || []).filter((c) => c.aYes && c.bYes).map((c) => [T[c.a]?.first || "A guest", T[c.b]?.first || "A guest"]);
  return { held, pairs };
}
export function keepList(plan, { repeat = false, firstFeeCents = 0, thisFeeCents = 0 } = {}) {
  return [{ k: "returning", label: "Returning guests", line: plan.held.length ? `${plural(plan.held.length, "seat")} held for guests who asked to come back` : "No one asked to come back yet" },
    { k: "pairs", label: "Matched pairs", line: plan.pairs.length ? `${plural(plan.pairs.length, "pair")} who both said yes, seated at the same table` : "No matched pairs from last time" },
    { k: "protection", label: "Protection", line: "Your deposit is held until the host accepts, and the money at risk shows by date." },
    { k: "replacement", label: "Replacement guarantee", line: "If your host can't make it, we find a replacement or refund you." },
    { k: "report", label: "The report", line: "Seats by source, the survey with denominators, follow-ups and your rebooking rule, in one place." },
    ...(repeat && firstFeeCents > thisFeeCents ? [{ k: "fee", label: "A smaller booking fee", line: `${money(thisFeeCents)} instead of ${money(firstFeeCents)}, because you've booked this host before.` }] : [])];
}
export const repeatPct = (env = process.env) => (env.ENCORE_REPEAT_FEE_PCT != null && env.ENCORE_REPEAT_FEE_PCT !== "" ? int(env.ENCORE_REPEAT_FEE_PCT, 0, 100) : 50);
export const repeatFeeBps = (baseBps, repeat, p = repeatPct()) => (repeat ? Math.round((baseBps * p) / 100) : baseBps);
export function feeLine({ repeat = false, firstCents = 0, thisCents = 0, p = repeatPct() } = {}) {
  if (!repeat) return { repeat: false, line: firstCents ? `Booking fee: ${money(firstCents)}. Book this host again and the fee on the next booking is ${p === 50 ? "half" : "smaller"}.` : "No booking fee on this one." };
  return { repeat: true, line: `Booking fee: ${money(thisCents)}${firstCents > thisCents ? `, ${p === 50 ? "half" : "less than"} the ${money(firstCents)} a first booking pays` : ""}. You've booked together before.` };
}

// ---------------------------------------------------------------------------------------------------------------
// 17. Followers: a CSV of people who followed the host (that consent is the basis), and crossover tracking.
export function followersCsv(list = []) {
  const head = ["Name", "Email", "Followed on", "How they found you", "Consent basis"];
  const rows = list.filter((f) => f.email && EMAIL_RE.test(lc(f.email))).map((f) => [f.name || "", lc(f.email), f.at ? isoDay(f.at) : "", String(f.via || "page").startsWith("crossover") ? "Met you through another host's event" : f.via || "Your page", "Followed you on Pottery Lab"]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function crossoverShare(list = [], { since = 0 } = {}) { const L = list.filter((f) => (f.at || 0) >= since); return ofN(L.filter((f) => String(f.via || "").startsWith("crossover")).length, L.length, "of your new followers first met you at another host's event"); }

// ---------------------------------------------------------------------------------------------------------------
// 18. Durability: the bars, by occasion and launch cohort, each with its value, denominator and a pass or fail.
export const BARS = { customer90: 40, team365: 50, teamLeading60: 30, community60: 25, secondSeats: 20, differentHost: 30, multiHost90: 15, firstCohort120: 60 };
const bar = (key, label, n, of, b, note = "") => { const v = of ? pct(n, of) : null; return { key, label, bar: b, n, of, value: v, pass: of ? v >= b : null, text: `${n} of ${of}`, note }; };
/** reqs: every team booking; evOf(id): its bpev doc; attendance: [{ email, hostWs, date, goal? , reqId? }]; signals: { [brandWs]: [{ what, at }] }. */
export function durability(reqs = [], { evOf = () => null, attendance = [], signals = {}, offPlatform = {}, designPartners = new Set(), today = isoDay() } = {}) {
  const live = reqs.filter((r) => LIVE.includes(statusOf(r, today)) || (statusOf(r, today) === "cancelled" && paidOf(r) > (r.refund?.cents || 0))).map((r) => ({ ...r, d: r.date || isoDay(r.createdAt), goal: evOf(r.id)?.brief?.goal || "" })).sort((a, b) => a.d.localeCompare(b.d));
  const byBrand = new Map(); for (const r of live) (byBrand.get(r.brandWs) || byBrand.set(r.brandWs, []).get(r.brandWs)).push(r);
  const groups = { all: [], partners: [] }; for (const [ws, L] of byBrand) (designPartners.has(ws) ? groups.partners : groups.all).push([ws, L]);
  const occasion = (B, goal, days, label, b) => { let n = 0, of = 0; for (const [, L] of B) { const f = L.find((r) => r.goal === goal || (goal === "team" && r.goal === "workshop")); if (!f) continue; const again = L.some((r) => r !== f && r.d > f.d && daysBetween(f.d, r.d) <= days); if (!again && daysBetween(f.d, today) < days) continue; of++; if (again) n++; } return bar(`${goal}${days}`, label, n, of, b, `Brands whose first ${goal === "customer" ? "customer dinner" : "team event"} was ${days}+ days ago, or that already rebooked`); };
  const leading = (B) => { let n = 0, of = 0; for (const [ws, L] of B) { const f = L.find((r) => ["team", "workshop"].includes(r.goal)); if (!f) continue; const t0 = Date.parse(f.d + "T12:00:00Z"), hit = (signals[ws] || []).some((s) => s.at >= t0 && s.at - t0 <= 60 * DAY) || L.some((r) => r !== f && r.d > f.d && daysBetween(f.d, r.d) <= 60); if (!hit && daysBetween(f.d, today) < 60) continue; of++; if (hit) n++; } return bar("teamLeading60", "Leading signal: saved a host or opened Book again within 60 days", n, of, BARS.teamLeading60); };
  const community = () => { const evIds = new Set(live.filter((r) => r.goal === "community").map((r) => r.id)), firsts = new Map(); for (const a of attendance.filter((x) => evIds.has(x.reqId)).sort((x, y) => x.date.localeCompare(y.date))) { const k = a.email + "|" + a.hostWs; if (!firsts.has(k)) firsts.set(k, a); }
    let n = 0, of = 0; for (const [k, f] of firsts) { const back = attendance.some((a) => a.email + "|" + a.hostWs === k && a.date > f.date && daysBetween(f.date, a.date) <= 60); if (!back && daysBetween(f.date, today) < 60) continue; of++; if (back) n++; } return bar("community60", "Community series: guests back with the same host within 60 days", n, of, BARS.community60); };
  const occasions = (B) => [occasion(B, "customer", 90, "Customer dinners: brands rebook within 90 days", BARS.customer90), occasion(B, "team", 365, "Team bonding and offsites: brands rebook within 12 months", BARS.team365), leading(B)];
  // cohorts: the month of each brand's first booking
  const cohorts = new Map(); for (const [ws, L] of byBrand) { const m = L[0].d.slice(0, 7), C = cohorts.get(m) || { cohort: m, brands: 0, rebooked90: 0, partners: 0 }; C.brands++; if (designPartners.has(ws)) C.partners++; if (L.some((r) => r !== L[0] && daysBetween(L[0].d, r.d) <= 90)) C.rebooked90++; cohorts.set(m, C); }
  // pairs: on-platform rate, second-booking seats from first-event guests
  const pairs = new Map(); for (const r of live) { const k = r.brandWs + "|" + r.hostWs; (pairs.get(k) || pairs.set(k, []).get(k)).push(r); }
  const repeatPairs = [...pairs.values()].filter((L) => L.length > 1), on = repeatPairs.reduce((a, L) => a + L.length - 1, 0), hostsInPairs = new Set(repeatPairs.map((L) => L[0].hostWs)), off = [...hostsInPairs].reduce((a, ws) => a + (offPlatform[ws] || 0), 0);
  const seatsOf = (r) => { const ev = evOf(r.id) || {}; return (ev.attendedEmails || []).map(lc); };
  let s2 = 0, s2of = 0; for (const L of repeatPairs) { const firstSet = new Set(seatsOf(L[0])); const S = seatsOf(L[1]); s2of += S.length; s2 += S.filter((e) => firstSet.has(e)).length; }
  const rebookers = [...byBrand.values()].filter((L) => L.length > 1), diff = rebookers.filter((L) => L.slice(1).some((r) => r.hostWs !== L[0].hostWs)).length;
  // guests at 2+ different hosts within 90 days
  const byGuest = new Map(); for (const a of attendance) (byGuest.get(a.email) || byGuest.set(a.email, []).get(a.email)).push(a);
  let multi = 0; for (const L of byGuest.values()) { L.sort((x, y) => x.date.localeCompare(y.date)); if (L.some((a, i) => L.slice(i + 1).some((b) => b.hostWs !== a.hostWs && daysBetween(a.date, b.date) <= 90))) multi++; }
  // the first host cohort: a second paid brand booking within 120 days
  const byHost = new Map(); for (const r of live) (byHost.get(r.hostWs) || byHost.set(r.hostWs, []).get(r.hostWs)).push(r);
  const firstM = [...byHost.values()].map((L) => L[0].d.slice(0, 7)).sort()[0] || "", fc = [...byHost.values()].filter((L) => L[0].d.slice(0, 7) === firstM), fcN = fc.filter((L) => L.slice(1).some((r) => daysBetween(L[0].d, r.d) <= 120)).length;
  return { occasions: [...occasions(groups.all), community()], partners: occasions(groups.partners), partnerBrands: groups.partners.length,
    cohorts: [...cohorts.values()].sort((a, b) => a.cohort.localeCompare(b.cohort)).map((c) => ({ ...c, rebooked90Pct: pct(c.rebooked90, c.brands) })),
    more: [bar("onPlatform", "Repeat brand-host pairs: bookings kept on Pottery Lab", on, on + off, 80, off ? `Includes ${off} off-platform bookings hosts told us about` : "Hosts can tell us about bookings made off the platform"),
      bar("secondSeats", "Second-booking seats filled by first-event guests", s2, s2of, BARS.secondSeats), bar("differentHost", "Rebooking brands that tried a different host", diff, rebookers.length, BARS.differentHost),
      bar("multiHost90", "Guests at 2+ different hosts within 90 days", multi, byGuest.size, BARS.multiHost90), bar("firstCohort120", `First host cohort (${firstM || "none yet"}): a second paid brand booking within 120 days`, fcN, fc.length, BARS.firstCohort120)] };
}

// ---------------------------------------------------------------------------------------------------------------
// 19. Founding hosts: what each one committed to and how it's going against their own public events.
export function cleanFounding(b = {}, cur = {}) {
  const dates = (Array.isArray(b.dates) ? b.dates : cur.dates || []).filter((d) => ISO.test(d)).slice(0, 12).sort();
  const sendNext = ["yes", "maybe", "no"].includes(b.sendNext) ? b.sendNext : cur.sendNext || "";
  return { dates, signedAt: dates.length ? cur.signedAt || Date.now() : 0, publicEarningsCents: b.publicEarnings != null ? int(+String(b.publicEarnings).replace(/[^\d.]/g, "") * 100, 0, 1e9) : cur.publicEarningsCents || 0, publicHours: b.publicHours != null ? Math.max(0, Math.min(2000, +b.publicHours || 0)) : cur.publicHours || 0, sendNext, offPlatform: b.offPlatform != null ? int(b.offPlatform, 0, 500) : cur.offPlatform || 0, at: Date.now() };
}
export function foundingRow({ name = "", handle = "", F = {}, paidPilot = false, teamNetCents = 0, teamHours = 0, followerSeats = null } = {}) {
  const teamRate = teamHours ? Math.round(teamNetCents / teamHours) : null, pubRate = F.publicHours ? Math.round(F.publicEarningsCents / F.publicHours) : null;
  return { name, handle, dates: F.dates || [], signedAt: F.signedAt || 0, paidPilot, teamPerHourCents: teamRate, publicPerHourCents: pubRate, ratio: teamRate != null && pubRate ? Math.round((teamRate / pubRate) * 10) / 10 : null, followerSeats, sendNext: F.sendNext || "", offPlatform: F.offPlatform || 0 };
}

// ---------------------------------------------------------------------------------------------------------------
export function mountBrandPanel2(app, { store, small, currentUser, C, X, P, PUBLIC_DIR = "", publicOrigin = () => "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const send = (res, o) => res.set("Cache-Control", "private, no-store").json(o);
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const BB = () => X.bb, S0 = (ws) => scopeStore(store, ws), sys = (k) => store.get("system/" + k)?.data || null, sysSet = (k, v) => { store.set("system/" + k, v); return v; };
  const owner = (ws) => BB().ownerEmailOf(ws);
  const mailCfg = (ws) => emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
  const mail = async (ws, to, subject, text, fromName = "") => { const cfg = mailCfg(ws); if (!cfg || !EMAIL_RE.test(lc(to))) return false; try { const o = await sendEmail(cfg, { to, subject, text, fromName, list: "guest" }); return o?.ok !== false; } catch { return false; } };
  const admin = (req, res) => { const u = P.me(req); if (!u || !isAdmin(u.email)) { bad(res, "Not found.", 404, "not_found"); return null; } return u; };
  const flags = () => sys("bpflags") || { designPartners: [], foundingHosts: [], paidPilot: [] };

  // ---- the company: org docs and what each team inherits ----
  const orgKey = (id) => "bporg-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 16);
  const orgOfWs = (ws) => { const id = sys("bporgws-" + ws)?.org; const o = id && sys(orgKey(id)); return o && (o.teams || []).includes(ws) ? o : null; };
  X.orgRulesOf = (ws) => { const o = orgOfWs(ws); return o ? o.defaults.rules : null; };

  // ---- 16. repeat pairs pay a smaller fee ----
  const repeatPair = (brandWs, hostWs, exceptId = "", before = Infinity) => !!brandWs && BB().reqs().some((r) => r.id !== exceptId && (r.createdAt || 0) < before && r.brandWs === brandWs && r.hostWs === hostWs && (LIVE.includes(statusOf(r)) || paidOf(r) > 0));
  X.feeBpsFor = (brandWs, hostWs) => (repeatPair(brandWs, hostWs) ? repeatFeeBps(FEE_BPS(), true) : null);
  const feeView = (r) => { const repeat = repeatPair(r.brandWs, r.hostWs, r.id, r.createdAt || Infinity), F = BB().findPkg(r.handle, r.pkgId), firstCents = F ? priceFor(F.p, r.headcount, { feeBps: FEE_BPS() }).feeCents : r.price?.feeCents || 0; return { ...feeLine({ repeat, firstCents, thisCents: r.price?.feeCents || 0 }), firstCents, thisCents: r.price?.feeCents || 0 }; };

  // ---- hooks on a new request: company defaults, a rebook from recovery, Book again's guest layer ----
  const baseOnRequest = X.onBbRequest;
  X.onBbRequest = (r, b, u) => { baseOnRequest?.(r, b, u); const ev = P.evOf(r); let changed = false; const o = orgOfWs(r.brandWs);
    if (o) { const D = o.defaults; if (ev.brief) { if (!b.brief?.photos) ev.brief.photos = D.brand.photos; if (!b.brief?.room) ev.brief.room = cleanRoom({}, D.brand.room); }
      r.billing = { ...(r.billing || {}), company: D.invoicing.company || r.billing?.company || r.company, taxId: D.invoicing.taxId, address: D.invoicing.address, po: D.invoicing.po }; r.orgId = o.id; BB().reqSet(r); P.note(ev, "brand", `booked under ${o.name}'s shared settings`); changed = true; }
    const prevId = b.recoveryOf || b.againOf, prev = prevId ? BB().reqGet(prevId) : null;
    if (prev && prev.brandWs === r.brandWs) { const pe = P.evGet(prev.id) || {};
      if (b.recoveryOf && pe.recovery) { if (pe.brief) { ev.brief = editBrief(null, { ...pe.brief }, { side: "brand", who: u.name || u.email, headcount: r.headcount }).brief || ev.brief; } ev.recoveryOf = prev.id;
        if (pe.recovery.money?.choice === "credit") r.credit = { cents: pe.recovery.money.cents, from: prev.id }; BB().reqSet(r);
        pe.recovery = { ...pe.recovery, state: "rebooked", rebookId: r.id, recoveredAt: Date.now(), minutes: Math.round((Date.now() - pe.recovery.at) / 6e3) / 10 }; P.note(pe, "brand", `rebooked with ${r.pkgName} in ${pe.recovery.minutes} minutes`); P.evSet(pe); changed = true; }
      if (b.againOf) { const pc = P.campOf(prev), plan = againPlan(pe, pc ? (pc.guests || []).filter((g) => g.event === prev.id) : []); ev.again = { from: prev.id, held: plan.held, pairs: plan.pairs, followers: b.followersInvite !== false, at: Date.now() };
        if (nextTimeAgreed(pe.nextTime) || pe.nextTime?.items?.length) ev.lastTime = { items: pe.nextTime.items, agreed: nextTimeAgreed(pe.nextTime), from: prev.id }; changed = true; } }
    if (b.autoRebookOf) { ev.autoFrom = clean(b.autoRebookOf, 24); changed = true; }
    if (changed) P.evSet(ev); };

  // ---- 1. recovery ----
  X.onBbCancel = (r, side) => { if (side !== "host" || !r.date || r.date < isoDay()) return; const ev = P.evOf(r), days = daysBetween(isoDay(), r.date), to = lc(ev.owner?.email || r.brandEmail);
    ev.recovery = { at: Date.now(), close: days <= RECOVERY.closeDays, daysBefore: days, owner: to, state: "open", money: recoveryMoney(r, "refund") }; P.note(ev, "host", "cancelled. Recovery started"); P.evSet(ev);
    BB().tell(to, `${P.hostName(r)} cancelled ${r.pkgName}${days <= RECOVERY.closeDays ? `, ${days === 0 ? "today" : `${plural(days, "day")} out`}` : ""}. We've found comparable hosts. Rebook in one tap.`, `/teams/bookings/${r.id}#recovery`); };
  function candidatesFor(r, { headcount = r.headcount, date = r.date, brandWs = r.brandWs } = {}) {
    const out = [], today = isoDay(); for (const x of BB().allSetups()) { if (x.ws === r.hostWs || x.ws === brandWs) continue; if (BB().example(x.ws) && process.env.ENCORE_HIDE_DEMO === "1") continue; const A = approxArea(x.s.area, x.s.city || x.h.city), st = BB().statsOf(x.ws);
      for (const p of x.s.packages.filter((p) => p.on && !p.remote)) { const taken = BB().takenFor(x.ws, p.id), months = [...new Set([addDays(date, -RECOVERY.windowDays).slice(0, 7), date.slice(0, 7), addDays(date, RECOVERY.windowDays).slice(0, 7)])], days = months.flatMap((m) => availabilityFor(p, m, { taken, today }).days);
        const dateState = days.find((d) => d.date === date)?.state || "closed", alt = dateState === "open" ? "" : days.filter((d) => d.state === "open").sort((a, b) => Math.abs(daysBetween(date, a.date)) - Math.abs(daysBetween(date, b.date)))[0]?.date || "";
        const pr = priceFor(p, headcount, { feeBps: X.feeBpsFor(brandWs, x.ws) ?? FEE_BPS() });
        out.push({ handle: x.h.handle, pkg: p.id, name: p.name, host: x.h.name || x.h.handle, city: A.city || x.s.city || "", area: A.area, minGuests: p.minGuests, maxGuests: p.maxGuests, perPersonCents: pr.effectivePerPersonCents, totalCents: pr.totalCents, dateState, altDate: alt, moods: p.moods || [], quality: st.quality, trusted: st.trusted, summary: pr.summary }); } }
    return out; }
  function recoveryView(r, ev, { drill = false } = {}) {
    const F = BB().findPkg(r.handle, r.pkgId), A = F ? approxArea(F.s.area, F.s.city || F.h.city) : { city: "", area: "" }, pp = r.headcount ? Math.round((r.price?.totalCents || 0) / r.headcount) : 0;
    const base = { handle: r.handle, city: A.city || F?.s?.city || "", area: A.area, date: r.date, headcount: r.headcount, perPersonCents: pp, totalCents: r.price?.totalCents || 0, moods: F?.p?.moods || [], maxGuests: F?.p?.maxGuests || 0 };
    const pick = pickReplacements(candidatesFor(r), base), c = P.campOf(r), G = c ? (c.guests || []).filter((g) => g.event === r.id && ["yes", "invited"].includes(g.status)) : [], from = c?.inviteFrom?.[r.id]?.name || c?.inviteFrom?.all?.name || ev.owner?.name || "";
    const top = pick.options[0];
    return { drill, base: { name: r.pkgName, host: P.hostName(r), date: r.date, headcount: r.headcount, totalCents: base.totalCents, city: base.city }, ...pick, options: pick.options.map((x) => ({ handle: x.handle, pkg: x.pkg, name: x.name, host: x.host, area: x.area, date: x.date, totalCents: x.totalCents, priceDiffCents: x.priceDiffCents, differs: x.differs, trusted: x.trusted, summary: x.summary,
        priceLine: x.priceDiffCents ? `${money(Math.abs(x.priceDiffCents))} ${x.priceDiffCents > 0 ? "more" : "less"} than before (${money0(x.totalCents)} vs ${money0(base.totalCents)})` : `The same total, ${money0(x.totalCents)}` })),
      note: guestChangeNote({ company: r.company, oldName: r.pkgName, newName: top?.name || "a new host", newHost: top?.host || "", date: top?.date || r.date, sameDate: !top || top.date === r.date, from }), guests: G.length,
      money: drill ? recoveryMoney({ payments: r.payments, refund: { cents: paidOf(r) } }, ev.drill?.money || "refund") : ev.recovery?.money || recoveryMoney(r), state: drill ? "drill" : ev.recovery?.state || "none", minutes: ev.recovery?.minutes ?? null, close: !!ev.recovery?.close, drills: drillSummary(ev.drills || []) }; }
  app.get("/api/teams/events/:id/recovery", (req, res) => { const E = P.brandEvent(req, res); if (!E) return; if (!E.ev.recovery) return bad(res, "Nothing to recover: the host hasn't cancelled.", 409, "conflict"); send(res, recoveryView(E.r, E.ev)); });
  app.post("/api/teams/events/:id/recovery/money", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; if (!E.ev.recovery) return bad(res, "Nothing to recover.", 409, "conflict");
    E.ev.recovery.money = recoveryMoney(E.r, req.body?.choice); P.note(E.ev, "brand", E.ev.recovery.money.choice === "credit" ? "kept the money as credit" : "took the refund"); P.evSet(E.ev); send(res, recoveryView(E.r, E.ev)); });
  app.post("/api/teams/events/:id/recovery/rebook", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; if (!E.ev.recovery || E.ev.recovery.state === "rebooked") return bad(res, E.ev.recovery ? "Already rebooked." : "Nothing to recover.", 409, "conflict");
    const V = recoveryView(E.r, E.ev), x = V.options.find((o) => o.handle === req.body?.handle && o.pkg === req.body?.pkg) || null; if (!x) return bad(res, "Pick one of the hosts shown.");
    const out = BB().createRequest(E.u, { handle: x.handle, pkg: x.pkg, headcount: E.r.headcount, date: x.date, company: E.r.company, recoveryOf: E.r.id, via: "again", single: !E.r.campaignId, ...(E.r.campaignId ? { campaign: E.r.campaignId } : {}) });
    if (out.error) return bad(res, out.error, out.status, out.code); send(res, { ok: true, id: out.r.id, url: `/teams/bookings/${out.r.id}`, minutes: P.evGet(E.r.id)?.recovery?.minutes ?? null, priceLine: x.priceLine }); });
  app.post("/api/teams/events/:id/recovery/message", small, async (req, res) => { const E = P.brandEvent(req, res); if (!E) return; if (!E.ev.recovery) return bad(res, "Nothing to recover.", 409, "conflict");
    const c = P.campOf(E.r), nr = E.ev.recovery.rebookId ? BB().reqGet(E.ev.recovery.rebookId) : null, G = c ? (c.guests || []).filter((g) => g.event === E.r.id && ["yes", "invited"].includes(g.status) && g.email) : [];
    const N = guestChangeNote({ company: E.r.company, oldName: E.r.pkgName, newName: nr?.pkgName || "a new host", newHost: nr ? P.hostName(nr) : "", date: nr?.date || E.r.date, sameDate: !nr || nr.date === E.r.date, from: c?.inviteFrom?.all?.name || E.ev.owner?.name || "" });
    const subject = clean(req.body?.subject, 140) || N.subject, text = String(req.body?.text || N.text).slice(0, 2000); let sent = 0;
    for (const g of G) if (await mail(E.r.brandWs, g.email, subject, `Hi ${first(g.name) || "there"},\n\n${text}`, E.r.company)) sent++;
    if (nr && c) { for (const g of c.guests || []) if (g.event === E.r.id) g.event = nr.id; if (!(c.bookings || []).includes(nr.id)) c.bookings = [...(c.bookings || []), nr.id]; P.cSet(c); }
    E.ev.recovery.messagedAt = Date.now(); P.note(E.ev, "brand", `told ${plural(G.length, "guest")} about the change`); P.evSet(E.ev); send(res, { ok: true, guests: G.length, emailed: sent }); });
  // the drill: pilot mode only, nothing is cancelled, booked or sent
  const pilotOn = (r) => !!P.campOf(r)?.pilot?.on;
  app.post("/api/teams/events/:id/drill", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; if (!pilotOn(E.r)) return bad(res, "Turn on pilot mode on the campaign to run the drill.", 409, "no_pilot"); if (!E.r.date) return bad(res, "Pick a date first.", 409, "no_date");
    const step = req.body?.step;
    if (step === "start") { E.ev.drill = { startedAt: Date.now(), money: "refund" }; P.note(E.ev, "brand", "started a cancellation drill"); P.evSet(E.ev); return send(res, recoveryView(E.r, E.ev, { drill: true })); }
    if (!E.ev.drill) return bad(res, "Start the drill first.", 409, "conflict");
    if (step === "money") { E.ev.drill.money = req.body?.choice === "credit" ? "credit" : "refund"; P.evSet(E.ev); return send(res, recoveryView(E.r, E.ev, { drill: true })); }
    if (step === "finish") { const V = recoveryView(E.r, E.ev, { drill: true }), x = V.options.find((o) => o.handle === req.body?.handle) || null; if (V.options.length && !x) return bad(res, "Pick a replacement to finish the drill.");
      const D = { startedAt: E.ev.drill.startedAt, finishedAt: Date.now(), picked: x ? `${x.host}: ${x.name}` : "", options: V.options.length, thin: V.thin, money: E.ev.drill.money, noteReady: true };
      E.ev.drills = [...(E.ev.drills || []), D].slice(-20); delete E.ev.drill; const S = drillSummary(E.ev.drills); P.note(E.ev, "brand", `ran the drill: ${S.last} minutes to recover`); P.evSet(E.ev); return send(res, { ok: true, drill: D, summary: S }); }
    bad(res, "Say which step."); });

  // ---- 2. the company ----
  app.get("/teams/company", page("teams-company.html"));
  const orgView = (o, u) => ({ id: o.id, name: o.name, domain: o.domain, code: lc(o.ownerEmail) === lc(u.email) ? o.code : "", owner: lc(o.ownerEmail) === lc(u.email), defaults: o.defaults, teams: (o.teams || []).map((ws) => ({ ws, company: getWorkspace(ws)?.company || "", mine: ws === u.ws, members: membersOf(ws).length, ownRules: !!S0(ws).get("teambook/rules")?.data })), mine: inherited(o, { rules: S0(u.ws).get("teambook/rules")?.data || null }) });
  app.get("/api/teams/company", (req, res) => { const u = P.brandMe(req, res); if (!u) return; const o = orgOfWs(u.ws), d = domainOf(u.email);
    const suggest = !o && d ? store.listPrefix("system", "bporg-").map((x) => x.data).find((x) => x?.domain === d) : null; send(res, { org: o ? orgView(o, u) : null, suggest: suggest ? { id: suggest.id, name: suggest.name, teams: suggest.teams.length } : null, canCreate: !o && u.wsOwner, photos: PHOTOS, room: ROOM_DEFAULTS }); });
  app.post("/api/teams/company", small, (req, res) => { const u = P.brandMe(req, res); if (!u) return; const b = req.body || {}; let o = orgOfWs(u.ws);
    if (o && lc(o.ownerEmail) !== lc(u.email)) return bad(res, "Only the person who set up the company changes its defaults.", 403, "not_granted"); if (!o && !u.wsOwner) return bad(res, "Only the workspace owner sets this up.", 403, "not_granted");
    if (!o) { o = { kind: "bporg", id: rid(6), name: clean(b.name, 100) || u.W.company || "Our company", domain: domainOf(u.email), ownerEmail: lc(u.email), code: rid(4), teams: [u.ws], createdAt: Date.now(), defaults: cleanOrgDefaults({ rules: BB().rulesOf(u.ws), invoicing: { company: u.W.company } }) }; sysSet("bporgws-" + u.ws, { org: o.id }); }
    if (b.name) o.name = clean(b.name, 100); o.defaults = cleanOrgDefaults(b.defaults || {}, o.defaults); sysSet(orgKey(o.id), o); send(res, { org: orgView(o, u) }); });
  app.post("/api/teams/company/join", small, (req, res) => { const u = P.brandMe(req, res); if (!u) return; if (!u.wsOwner) return bad(res, "Ask your workspace owner to join the company.", 403, "not_granted");
    const o = sys(orgKey(req.body?.id)); if (!o) return bad(res, "No company by that link.", 404, "not_found"); const codeOk = req.body?.code && String(req.body.code) === o.code;
    if (!codeOk && !(o.domain && domainOf(u.email) === o.domain)) return bad(res, "Use the join code from the person who set up the company.", 403, "not_granted");
    o.teams = [...new Set([...(o.teams || []), u.ws])]; sysSet(orgKey(o.id), o); sysSet("bporgws-" + u.ws, { org: o.id }); send(res, { org: orgView(o, u) }); });

  // ---- 3. account dinners ----
  const loadC = (req, res, what = "view") => { const u = P.brandMe(req, res); if (!u) return null; const c = P.cGet(req.params.id), role = c && campaignRole(c, { email: u.email, ws: u.ws, wsOwner: u.wsOwner }); if (!c || !role) { bad(res, "Not found.", 404, "not_found"); return null; } if (!can(role, what)) { bad(res, "Only editors and owners can change this.", 403, "not_granted"); return null; } return { u, c, role }; };
  const abmView = (c, u) => { const E = P.eventsOf(c), mineAcc = new Set((c.abm?.accounts || []).filter((a) => lc(a.owner) === lc(u.email)).map((a) => normCo(a.account))), ap = c.abm?.approvals || {};
    return { ...abmState(c, { events: E.map((x) => x.r), evOf: (r) => P.evGet(r.id) }), myGuests: (c.guests || []).filter((g) => mineAcc.has(normCo(g.company))).map((g) => ({ id: g.id, name: g.name, company: g.company, title: g.title || "", event: g.event, state: ap[g.id]?.state || "waiting" })),
      myTasks: tasksForOwner(c, u.email).map((t) => ({ id: t.id, title: t.title, due: t.due, status: t.status, result: t.result })), members: membersOf(c.ws).map((m) => ({ email: lc(m.email), name: m.name || "" })), amOwner: mineAcc.size > 0 }; };
  app.get("/api/campaigns/:id/abm", (req, res) => { const L = loadC(req, res); if (!L) return; send(res, abmView(L.c, L.u)); });
  app.post("/api/campaigns/:id/abm", small, (req, res) => { const L = loadC(req, res, "plan"); if (!L) return; const b = req.body || {}, team = new Map(membersOf(L.c.ws).map((m) => [lc(m.email), m.name || ""]));
    const accounts = (Array.isArray(b.accounts) ? b.accounts : []).map((a) => ({ account: clean(a.account, 100), owner: lc(a.owner) })).filter((a) => a.account).slice(0, 200);
    const off = accounts.find((a) => !team.has(a.owner)); if (off) return bad(res, `${off.account} needs an account owner on your team.`);
    L.c.abm = { ...(L.c.abm || {}), accounts: accounts.map((a) => ({ ...a, ownerName: team.get(a.owner) || "" })), budgetCents: b.budget != null ? int(+b.budget * 100, 0, 1e10) : L.c.abm?.budgetCents || 0, approvals: L.c.abm?.approvals || {} };
    L.c.targets = [...new Set([...(L.c.targets || []), ...accounts.map((a) => a.account)])].slice(0, 500); P.cSet(L.c); send(res, abmView(L.c, L.u)); });
  app.post("/api/campaigns/:id/abm/approve", small, (req, res) => { const L = loadC(req, res); if (!L) return; const ids = (Array.isArray(req.body?.guests) ? req.body.guests : []).map(String), yes = req.body?.yes !== false;
    const mine = new Set((L.c.abm?.accounts || []).filter((a) => lc(a.owner) === lc(L.u.email)).map((a) => normCo(a.account))); if (!mine.size) return bad(res, "You don't own any of these accounts.", 403, "not_granted");
    const G = (L.c.guests || []).filter((g) => ids.includes(g.id)); if (!G.length) return bad(res, "Pick guests first."); if (G.some((g) => !mine.has(normCo(g.company)))) return bad(res, "You can only approve guests at your own accounts.", 403, "not_granted");
    L.c.abm.approvals = { ...(L.c.abm.approvals || {}) }; for (const g of G) L.c.abm.approvals[g.id] = { state: yes ? "yes" : "no", by: lc(L.u.email), at: Date.now() }; P.cSet(L.c);
    for (const r of P.eventsOf(L.c).map((x) => x.r)) { const ev = P.evOf(r); if (ev.mixApproval?.state === "yes" && G.some((g) => g.event === r.id)) { ev.mixApproval = { state: "waiting", at: Date.now(), note: "The mix changed" }; P.evSet(ev); } }
    send(res, abmView(L.c, L.u)); });
  X.inviteHold = (c, g) => (c.abm?.accounts?.length || g.event ? inviteHoldFor(c, g, g.event ? P.evGet(g.event) : null) : "");
  app.post("/api/bb/host/events/:id/mix", small, (req, res) => { const E = P.hostEvent(req, res); if (!E) return; const c = P.campOf(E.r); if (!c) return bad(res, "No guest list yet.", 409, "not_yet");
    E.ev.mixApproval = { state: req.body?.yes === false ? "no" : "yes", note: clean(req.body?.note, 300), at: Date.now(), mix: mixFor(c, E.r.id) }; P.note(E.ev, "host", E.ev.mixApproval.state === "yes" ? "approved the guest mix" : "asked for a different mix"); P.evSet(E.ev);
    BB().tell(E.r.brandEmail, `${E.H.h.name} ${E.ev.mixApproval.state === "yes" ? "approved" : "asked to change"} the guest mix for ${E.r.pkgName}.`, `/teams/bookings/${E.r.id}`); send(res, { ok: true, mixApproval: E.ev.mixApproval }); });

  // ---- one call for the brand's event panel extras ----
  const isPast = (r) => !!(r.date && r.date <= isoDay());
  const invitesOut = (r) => { const c = P.campOf(r); return !!c && (c.guests || []).some((g) => g.event === r.id && g.invitedAt); };
  function brandExtras(r, ev, u) {
    const F = BB().findPkg(r.handle, r.pkgId), c = P.campOf(r), O = c ? P.outcomesFor(c) : null, E1 = O?.events.find((e) => e.id === r.id) || null, G = c ? (c.guests || []).filter((g) => g.event === r.id) : [];
    const tier = tierOf({ events: 1, cities: 1, headcount: r.headcount }), hours = (ev.prep?.logged || []).reduce((a, x) => a + x.hours, 0);
    const prefAll = c ? prefAggregate((c.guests || []).filter((g) => g.prefs)) : prefAggregate([]);
    maybeAutoRebook(r, ev, E1);
    return { status: statusOf(r), pricing: pricingView(r, F, ev), fee: feeView(r), credit: r.credit || null, recovery: ev.recovery ? { state: ev.recovery.state, close: ev.recovery.close, minutes: ev.recovery.minutes ?? null, money: ev.recovery.money } : null, pilot: pilotOn(r), drills: drillSummary(ev.drills || []),
      rule: ev.rule || null, ruleLine: ruleLine(ev.rule), ruleLocked: invitesOut(r), ruleResult: evaluateRule(ev.rule, E1), metrics: RULE_METRICS,
      format: ev.format ? { ...ev.format, def: formatOf(ev.format.id) } : null, room: ev.brief?.room || ROOM_DEFAULTS, roomLines: roomLines(ev.brief?.room), kept: G.filter((g) => competitorOf(ev.brief, g)).length,
      nextTime: ev.nextTime || null, nextAgreed: nextTimeAgreed(ev.nextTime), lastTime: ev.lastTime || null, again: ev.again ? { held: ev.again.held.length, pairs: ev.again.pairs, followers: ev.again.followers, firsts: ev.again.held.map((h) => h.first).filter(Boolean).slice(0, 12) } : null,
      autoRebook: ev.autoRebook || null, designPartner: flags().designPartners.includes(r.brandWs), tier, narrative: tierNarrative({ company: r.company, tier, events: E1 ? [{ ...E1, hostName: P.hostName(r) }] : [], totals: O && E1 ? O.totals : null, hours: hours || null }),
      prefs: prefAll, feedback: isPast(r) ? feedbackFor(ev, "brand", { date: r.date }) : null, pairs: pairStats(ev.pairs || []), mix: ev.mixApproval || null, prompt: TAKEAWAY_PROMPT, recoveryOf: ev.recoveryOf || "", autoFrom: ev.autoFrom || "" }; }
  app.get("/api/teams/events/:id/more", (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const o = brandExtras(E.r, E.ev, E.u); P.evSet(E.ev); send(res, o); });

  // ---- 10. the rebooking rule, set before invites go out ----
  app.post("/api/teams/events/:id/rule", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; if (invitesOut(E.r)) return bad(res, E.ev.rule ? "Invites have gone out, so the rebooking rule is fixed for this event." : "Invites have gone out. Set the rule before inviting next time.", 409, "locked");
    const R = cleanRule(req.body || {}); if (R.error) return bad(res, R.error); E.ev.rule = R.rule; P.note(E.ev, "brand", "set the rebooking rule"); P.evSet(E.ev); send(res, { rule: E.ev.rule, line: ruleLine(E.ev.rule) }); });
  // ---- 19. design-partner auto-rebook: pre-signed, it triggers when the rule is met ----
  app.post("/api/teams/events/:id/auto-rebook", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const b = req.body || {};
    if (b.off) { delete E.ev.autoRebook; P.evSet(E.ev); return send(res, { autoRebook: null }); } if (!E.ev.rule) return bad(res, "Set the rebooking rule first. The second booking triggers when it's met.", 409, "no_rule");
    const F = BB().findPkg(E.r.handle, E.r.pkgId), n = b.headcount ? int(b.headcount, F?.p.minGuests || 1, F?.p.maxGuests || 2000) : E.r.headcount, date = ISO.test(b.date || "") && b.date > (E.r.date || isoDay()) ? b.date : "";
    E.ev.autoRebook = { signedAt: Date.now(), by: lc(E.u.email), name: E.u.name || "", headcount: n, date, triggered: "" }; P.note(E.ev, "brand", "pre-signed a second booking if the rule is met"); P.evSet(E.ev); send(res, { autoRebook: E.ev.autoRebook }); });
  function maybeAutoRebook(r, ev, E1) { const A = ev.autoRebook; if (!A || A.triggered || !ev.rule || !E1) return null; if (evaluateRule(ev.rule, E1).state !== "met") return null;
    const today = isoDay(), date = A.date && A.date > today ? A.date : "", month = addDays(today, 30).slice(0, 7);
    const out = BB().createRequest({ ws: r.brandWs, email: A.by, name: A.name }, { handle: r.handle, pkg: r.pkgId, headcount: A.headcount, ...(date ? { date } : { flex: { month, days: "weekday", time: "evening" } }), company: r.company, againOf: r.id, via: "again", autoRebookOf: r.id, ...(r.campaignId ? { campaign: r.campaignId } : { single: true }) });
    if (out.error) { A.error = out.error; return null; } A.triggered = out.r.id; A.at = Date.now(); P.note(ev, "brand", "the rebooking rule was met, so the pre-signed booking went to the host"); BB().tell(A.by, `The rebooking rule for ${r.pkgName} was met. Your pre-signed booking went to ${P.hostName(r)}.`, `/teams/bookings/${out.r.id}`); return out.r; }

  // ---- 13. formats: the library, the brand's pick, the host's version ----
  app.get("/teams/formats", page("teams-formats.html"));
  app.get("/api/teams/formats", (req, res) => { const g = GOALS[req.query.goal] ? req.query.goal : ""; res.set("Cache-Control", "public, max-age=300").json({ formats: FORMATS.filter((f) => !g || f.occasion === g).map((f) => ({ ...f, occasionLabel: GOALS[f.occasion].label, togetherLabel: TOGETHER[f.together].label })), occasions: Object.values(GOALS).map(({ id, label }) => ({ id, label })) }); });
  app.post("/api/teams/events/:id/format", small, (req, res) => { const E = P.brandEvent(req, res); if (!E) return; const b = req.body || {};
    if (b.agree) { if (!E.ev.format?.hostVersion) return bad(res, "The host hasn't proposed their version yet.", 409, "conflict"); E.ev.format.agreedAt = Date.now(); P.note(E.ev, "brand", "agreed to the host's version of the format"); P.evSet(E.ev); return send(res, { format: E.ev.format }); }
    const f = formatOf(b.id); if (!f) return bad(res, "Pick a format from the library.");
    E.ev.format = { id: f.id, name: f.name, pickedAt: Date.now(), hostVersion: null, agreedAt: 0 };
    const R = editBrief(E.ev.brief, { together: f.together, plan: f.what }, { side: "brand", who: E.u.name || E.u.email, headcount: E.r.headcount }); if (!R.error) E.ev.brief = R.brief;
    P.note(E.ev, "brand", `picked a format: ${f.name}`); P.evSet(E.ev); if (E.r.status !== "approval") BB().tell(owner(E.r.hostWs), `${E.r.company} picked "${f.name}" for ${E.r.pkgName}. Propose your version.`, "/host/teams#confirm"); send(res, { format: E.ev.format }); });
  app.post("/api/bb/host/events/:id/format", small, (req, res) => { const E = P.hostEvent(req, res); if (!E) return; if (!E.ev.format) return bad(res, "The brand hasn't picked a format.", 409, "conflict"); const b = req.body || {};
    const items = (Array.isArray(b.ros) ? b.ros : []).map((x) => ({ at: clean(x?.at, 8), what: clean(x?.what, 140) })).filter((x) => x.what).slice(0, 12), plan = clean(b.plan, 500); if (!plan && !items.length) return bad(res, "Say how you'd run it.");
    E.ev.format.hostVersion = { plan, ros: items.length ? items : formatOf(E.ev.format.id)?.ros || [], at: Date.now() }; E.ev.format.agreedAt = 0; P.note(E.ev, "host", "proposed their version of the format"); P.evSet(E.ev); BB().tell(E.r.brandEmail, `${E.H.h.name} proposed their version of ${E.ev.format.name}.`, `/teams/bookings/${E.r.id}`); send(res, { format: E.ev.format }); });

  // ---- 9. two changes for next time ----
  const nextTimeRoute = (side) => (req, res) => { const E = side === "brand" ? P.brandEvent(req, res) : P.hostEvent(req, res); if (!E) return; if (!isPast(E.r)) return bad(res, "This opens after the event.", 409, "not_yet");
    const R = editNextTime(E.ev.nextTime, req.body || {}, side, side === "brand" ? E.u.name || E.u.email : E.H.h.name); if (R.error) return bad(res, R.error); E.ev.nextTime = R.next; P.note(E.ev, side, nextTimeAgreed(R.next) ? "agreed two changes for next time" : "suggested two changes for next time"); P.evSet(E.ev);
    if (!nextTimeAgreed(R.next)) BB().tell(side === "brand" ? owner(E.r.hostWs) : E.r.brandEmail, `Two changes for next time on ${E.r.pkgName}. Have a look and agree.`, side === "brand" ? "/host/teams#confirm" : `/teams/bookings/${E.r.id}`);
    send(res, { nextTime: E.ev.nextTime, agreed: nextTimeAgreed(E.ev.nextTime) }); };
  app.post("/api/teams/events/:id/next-time", small, nextTimeRoute("brand"));
  app.post("/api/bb/host/events/:id/next-time", small, nextTimeRoute("host"));

  // ---- the host's extras: pricing and prep, feedback first, groups, the mix, the format, held seats ----
  app.get("/api/bb/host/events/:id/more", (req, res) => { const E = P.hostEvent(req, res); if (!E) return; const r = E.r, ev = E.ev, c = P.campOf(r), F = BB().findPkg(r.handle, r.pkgId), G = c ? (c.guests || []).filter((g) => g.event === r.id && ["yes", "invited"].includes(g.status)) : [];
    let fb = null; if (isPast(r)) { fb = feedbackFor(ev, "host"); if (fb.comments.length && !ev.feedback?.hostSeenAt) { ev.feedback = { ...(ev.feedback || {}), hostSeenAt: Date.now() }; P.evSet(ev); } }
    send(res, { pricing: pricingView(r, F, ev), prep: ev.prep || null, fee: feeView(r), feedback: fb, groups: groupsFor(G), question: PREF_QUESTION, mix: c ? { proposed: mixFor(c, r.id), approval: ev.mixApproval || null, abm: !!c.abm?.accounts?.length } : null,
      format: ev.format ? { ...ev.format, def: formatOf(ev.format.id) } : null, nextTime: ev.nextTime || null, nextAgreed: nextTimeAgreed(ev.nextTime), lastTime: ev.lastTime || null, room: roomLines(ev.brief?.room),
      again: ev.again ? { held: ev.again.held.length, firsts: ev.again.held.map((h) => h.first).filter(Boolean), pairs: ev.again.pairs, followers: ev.again.followers, followersSentAt: ev.again.followersSentAt || 0 } : null, past: isPast(r), status: statusOf(r) }); });
  app.post("/api/bb/host/events/:id/prep", small, (req, res) => { const E = P.hostEvent(req, res); if (!E) return; const b = req.body || {}, before = E.ev.prep?.customFeeCents || 0;
    if (b.customFee != null && b.customFee !== "" && (isBooked(E.r) || paidOf(E.r) > 0)) { const want = int(+String(b.customFee).replace(/[^\d.]/g, "") * 100, 0, 1e8); if (want !== before) return bad(res, "The deposit is paid, so a new custom-work fee goes in as a change request with the brand.", 409, "booked"); }
    E.ev.prep = cleanPrep(b, E.ev.prep || {}); if (E.ev.prep.customFeeCents !== before && E.r.price) { E.r.price = withCustomFee(E.r.price, E.ev.prep.customFeeCents); E.r.deposit = { ...(E.r.deposit || {}), cents: E.r.price.depositCents }; BB().push(E.r, "host", E.ev.prep.customFeeCents ? `added a custom-work fee of ${money(E.ev.prep.customFeeCents)}` : "removed the custom-work fee"); BB().reqSet(E.r); }
    P.evSet(E.ev); send(res, { prep: E.ev.prep, pricing: pricingView(E.r, BB().findPkg(E.r.handle, E.r.pkgId), E.ev) }); });
  // ---- 15. Book again: the host sends their invite to followers ----
  app.post("/api/bb/host/events/:id/followers-invite", small, async (req, res) => { const E = P.hostEvent(req, res); if (!E) return; if (!E.ev.again?.followers) return bad(res, "This booking doesn't include your followers.", 409, "conflict"); if (E.ev.again.followersSentAt) return bad(res, "Sent already.", 409, "conflict");
    let L = []; try { L = C.followersOf(E.H.ws).filter((f) => f.email && f.notify !== false); } catch {} const seats = Math.max(0, (E.ev.brief?.mix?.host || 0) - (E.ev.hostSeats || []).length); let sent = 0;
    for (const f of L.slice(0, 300)) if (await mail(E.H.ws, f.email, `${E.H.h.name}: a few spots at ${E.r.pkgName}`, `Hi ${first(f.name) || "there"},\n\nI'm hosting ${E.r.pkgName} on ${short(E.r.date) || "a date soon"}, and I have ${seats || "a few"} spots for people who follow me. Reply to this email if you'd like one.\n\n${E.H.h.name}`, E.H.h.name)) sent++;
    E.ev.again.followersSentAt = Date.now(); P.note(E.ev, "host", `sent their invite to ${plural(L.length, "follower")}`); P.evSet(E.ev); send(res, { ok: true, followers: L.length, emailed: sent }); });

  // ---- 8. the RSVP preference question on the campaign invite ----
  X.cgPrefs = (g) => ({ ...PREF_QUESTION, parts: PARTS, intros: INTROS, mine: g.prefs || null });
  X.onCgReply = (c, g, b) => { if (b.part != null || b.intros != null) g.prefs = cleanPrefs(b, g.prefs); };

  // ---- 6. matched guests: the thread on the survey link ----
  X.onPairMutual = (ev, a, b) => openPair(ev, a, b);
  const svOf = (req) => { const t = String(req.params.token || "").replace(/[^a-f0-9]/g, "").slice(0, 24), idx = store.get("system/bpsv-" + t)?.data; if (!idx) return null; const r = BB().reqGet(idx.reqId), ev = r && P.evGet(r.id); if (!r || !ev?.survey?.tokens?.[t]) return null; return { t, r, ev }; };
  const pairsFor = (S) => { const T = S.ev.survey.tokens, R = S.ev.survey.responses || {}, now = Date.now(); let changed = false;
    const L = (S.ev.pairs || []).filter((p) => p.a === S.t || p.b === S.t).map((p) => { if (pairNudgeDue(p, now)) { p.nudgedAt = now; p.messages.push({ by: "", text: NUDGE_TEXT, at: now, system: true }); changed = true; } const o = p.a === S.t ? p.b : p.a;
      return { id: p.id, with: T[o]?.first || "A guest", contact: R[o]?.contact || T[o]?.email || "", messages: p.messages.map((m) => ({ mine: m.by === S.t, system: !!m.system, text: m.text, at: m.at })), met: !!p.met?.[S.t], theyMet: !!p.met?.[o], openedAt: p.openedAt, nudge: !!p.nudgedAt }; });
    if (changed) P.evSet(S.ev); return L; };
  app.get("/api/survey/:token/pairs", (req, res) => { const S = svOf(req); if (!S) return bad(res, "This link doesn't work anymore.", 404, "not_found"); send(res, { pairs: pairsFor(S), prompt: TAKEAWAY_PROMPT }); });
  app.post("/api/survey/:token/pairs/:pid", small, (req, res) => { if (limited("svp:" + req.ip, 300)) return bad(res, "Slow down.", 429, "rate_limited"); const S = svOf(req); if (!S) return bad(res, "This link doesn't work anymore.", 404, "not_found");
    const p = (S.ev.pairs || []).find((x) => x.id === req.params.pid && (x.a === S.t || x.b === S.t)); if (!p) return bad(res, "Not found.", 404, "not_found");
    if (req.body?.met != null) { p.met = { ...(p.met || {}), [S.t]: req.body.met === true ? Date.now() : 0 }; } else { const o = pairPost(p, S.t, req.body?.text); if (o.error) return bad(res, o.error); }
    P.evSet(S.ev); send(res, { pairs: pairsFor(S) }); });
  async function runPairNudges(now = Date.now()) { let n = 0; for (const d of store.listPrefix("system", "bpev-")) { const ev = d.data; if (!ev?.pairs?.some((p) => pairNudgeDue(p, now))) continue; const r = BB().reqGet(ev.reqId); if (!r) continue;
      for (const p of ev.pairs.filter((x) => pairNudgeDue(x, now))) { p.nudgedAt = now; p.messages.push({ by: "", text: NUDGE_TEXT, at: now, system: true }); n++; for (const t of [p.a, p.b]) { const em = ev.survey?.tokens?.[t]?.email; if (em) await mail(DEFAULT_WS, em, "Meet again within two weeks?", `${NUDGE_TEXT}\n\nYour thread is on the survey link from the event: /survey/${t}`, "Pottery Lab"); } }
      P.evSet(ev); } return n; }
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => runPairNudges().catch(() => {}), 6 * 3600e3); t.unref?.(); }

  // ---- campaign extras: follow-up speed, tier and narrative, pairs, preferences, lift ----
  app.get("/api/campaigns/:id/more", (req, res) => { const L = loadC(req, res); if (!L) return; const c = L.c, E = P.eventsOf(c), O = P.outcomesFor(c), names = Object.fromEntries(membersOf(c.ws).map((m) => [lc(m.email), m.name || ""]));
    const speed = followUpSpeed(c, O.events, { names }), cities = new Set(E.map(({ r }) => approxArea(BB().setupOf(r.hostWs)?.area, BB().setupOf(r.hostWs)?.city).city).filter(Boolean)), headcount = Math.max(0, ...E.map(({ r }) => r.headcount || 0));
    const tier = tierOf({ events: E.length || 1, cities: cities.size || 1, headcount }), allPairs = E.flatMap(({ ev }) => ev?.pairs || []), pairs = pairStats(allPairs), hours = E.reduce((a, { ev }) => a + (ev?.prep?.logged || []).reduce((s, x) => s + x.hours, 0), 0);
    const rules = E.filter(({ ev }) => ev?.rule).map(({ r, ev }) => ({ id: r.id, name: r.pkgName, line: ruleLine(ev.rule), result: evaluateRule(ev.rule, O.events.find((e) => e.id === r.id)) }));
    const drills = E.flatMap(({ ev }) => ev?.drills || []);
    send(res, { speed, tier, tiers: TIERS, narrative: tierNarrative({ company: L.u.W.company, tier, events: O.events.map((e) => ({ ...e, hostName: P.hostName({ hostWs: BB().reqGet(e.id)?.hostWs, handle: e.handle }) })), totals: O.totals, speed, pairs, hours: hours || null }), pairs, prefs: prefAggregate((c.guests || []).filter((g) => g.prefs)), rules, drills: drillSummary(drills), abm: abmState(c, { events: E.map((x) => x.r), evOf: (r) => P.evGet(r.id) }) }); });

  // ---- 12. lift ----
  const AUD = { engineers: ["engineering"], founders: ["founder"], designers: ["design"], product: ["product"], marketers: ["marketing"], leaders: ["leader"] };
  function liftCells({ city = "", audience = [] } = {}) {
    const cells = new Map(), meetings = new Map();
    for (const d of store.listPrefix("system", "camp-")) { const c = d.data; for (const o of c?.outcomes || []) if (o.kind === "meeting" && o.event) meetings.set(o.event, (meetings.get(o.event) || 0) + 1); }
    for (const r of BB().reqs()) { if (statusOf(r) !== "done") continue; const ev = P.evGet(r.id); if (!ev?.survey?.responses) continue; const s = BB().setupOf(r.hostWs) || {}, cty = approxArea(s.area, s.city).city || s.city || "";
      if (city && lc(cty) !== lc(city) && !(lc(city) === "new york" && ["brooklyn", "manhattan", "queens", "new york"].includes(lc(cty)))) continue;
      const f = ev.brief?.together || "standard", x = cells.get(f) || { format: f, events: 0, people: 0, respondents: 0, useful: 0, meetings: 0, attended: 0 }; let counted = 0;
      for (const [t, a] of Object.entries(ev.survey.responses)) { if (a.useful == null) continue; if (audience.length) { const em = ev.survey.tokens[t]?.email; const pr = em ? prefsOf(store, em) : null; if (!pr?.include || !pr.work.some((w) => audience.includes(w))) continue; } x.respondents++; counted++; if (a.useful) x.useful++; }
      if (!counted) continue; x.events++; x.people += counted; x.attended += Math.max(counted, Object.keys(ev.survey.tokens).length); x.meetings += meetings.get(r.id) || 0; cells.set(f, x); }
    return [...cells.values()]; }
  app.get("/api/teams/recommendations/lift", (req, res) => { const u = P.brandMe(req, res); if (!u) return; const city = clean(req.query.city, 60), aud = AUD[lc(req.query.audience)] ? lc(req.query.audience) : "";
    send(res, { ...liftRecs(liftCells({ city, audience: AUD[aud] || [] }), { audience: aud ? { engineers: "engineering leaders", founders: "founders", designers: "designers", product: "product people", marketers: "marketers", leaders: "leaders" }[aud] : "", city }), city, audience: aud, sources: SOURCES }); });

  // ---- 15. what you keep by booking again ----
  app.get("/api/teams/again/:id", (req, res) => { const u = P.brandMe(req, res); if (!u) return; const r = BB().reqGet(req.params.id); if (!r || r.brandWs !== u.ws) return bad(res, "Not found.", 404, "not_found");
    const ev = P.evGet(r.id) || {}, c = P.campOf(r), plan = againPlan(ev, c ? (c.guests || []).filter((g) => g.event === r.id) : []), F = BB().findPkg(r.handle, r.pkgId), firstCents = F ? priceFor(F.p, r.headcount, { feeBps: FEE_BPS() }).feeCents : 0, thisCents = F ? priceFor(F.p, r.headcount, { feeBps: X.feeBpsFor(u.ws, r.hostWs) ?? FEE_BPS() }).feeCents : 0;
    send(res, { host: P.hostName(r), name: r.pkgName, keep: keepList(plan, { repeat: true, firstFeeCents: firstCents, thisFeeCents: thisCents }), held: plan.held.length, pairs: plan.pairs.length, nextTime: ev.nextTime?.items || [], nextAgreed: nextTimeAgreed(ev.nextTime), rule: ruleLine(ev.rule) }); });
  app.post("/api/teams/signal", small, (req, res) => { const u = P.brandMe(req, res); if (!u) return; const what = ["book-again", "save-host"].includes(req.body?.what) ? req.body.what : ""; if (!what) return bad(res, "Unknown signal.");
    const S = S0(u.ws), cur = S.get("teambook/signals")?.data || { list: [] }; cur.list = [...cur.list, { what, at: Date.now(), ref: clean(req.body?.ref, 40) }].slice(-200); S.set("teambook/signals", cur); send(res, { ok: true }); });

  // ---- 17. followers, portable; cross-host discovery with opt in ----
  const forgotten = (ws, email) => { try { return !!S0(ws).get("contactsoff/" + idOf(keyFor(email, "")))?.data; } catch { return false; } };
  const followersFor = (ws) => { try { return C.followersOf(ws).filter((f) => f.email && !forgotten(ws, f.email)); } catch { return []; } };
  app.get("/api/bb/host/followers.csv", (req, res) => { const H = P.hostMe(req, res); if (!H) return; res.set("Cache-Control", "private, no-store").set("Content-Disposition", `attachment; filename="${H.h.handle}-followers.csv"`).type("text/csv").send(followersCsv(followersFor(H.ws))); });
  const formatsOfHost = (ws) => { const f = new Set(); for (const r of BB().reqs().filter((x) => x.hostWs === ws)) { const t = P.evGet(r.id)?.brief?.together; if (t) f.add(t); } return f; };
  const cityOf = (ws) => { const s = BB().setupOf(ws) || {}; return lc(approxArea(s.area, s.city || C.profileOf(ws)?.city).city || s.city || ""); };
  const similar = (a, b) => { if (a === b) return false; const ca = cityOf(a), cb = cityOf(b), ny = ["brooklyn", "manhattan", "queens", "new york"]; if (ca !== cb && !(ny.includes(ca) && ny.includes(cb))) return false; const A = formatsOfHost(a), B = formatsOfHost(b), mA = new Set((BB().setupOf(a)?.packages || []).flatMap((p) => p.moods || [])); return [...A].some((x) => B.has(x)) || (BB().setupOf(b)?.packages || []).some((p) => (p.moods || []).some((m) => mA.has(m))); };
  function discoveryPool(ws) { const mine = new Set(followersFor(ws).map((f) => lc(f.email))), out = new Map();
    for (const r of BB().reqs()) { if (r.hostWs === ws || statusOf(r) !== "done" || !similar(r.hostWs, ws)) continue; const ev = P.evGet(r.id); for (const [t, a] of Object.entries(ev?.survey?.responses || {})) { const em = lc(ev.survey.tokens[t]?.email); if (!em || !a.similarOk || !(a.useful || a.back) || mine.has(em) || out.has(em)) continue; out.set(em, { email: em, first: ev.survey.tokens[t].first || "", fromWs: r.hostWs, fromName: P.hostName(r), format: ev.brief?.together || "" }); } }
    return [...out.values()]; }
  app.get("/api/bb/host/discovery", (req, res) => { const H = P.hostMe(req, res); if (!H) return; const pool = discoveryPool(H.ws), since = Date.now() - 90 * DAY, sent = store.listPrefix("system", "bpxd-").map((d) => d.data).filter((x) => x?.hostWs === H.ws);
    send(res, { pool: pool.length, fromHosts: [...new Set(pool.map((p) => p.fromName))].length, invited: sent.reduce((a, x) => a + x.emails.length, 0), followedBack: sent.reduce((a, x) => a + (x.followed || []).length, 0), share: crossoverShare(followersFor(H.ws), { since }), basis: "Only guests who ticked \"tell me about similar hosts\" on another host's survey." }); });
  app.post("/api/bb/host/discovery/invite", small, async (req, res) => { const H = P.hostMe(req, res); if (!H) return; if (limited("xd:" + H.ws, 4, 24 * 3600e3)) return bad(res, "One send a day is plenty.", 429, "rate_limited");
    const pool = discoveryPool(H.ws).slice(0, 200), id = rid(6), note = clean(req.body?.note, 280), base = publicOrigin(req); if (!pool.length) return bad(res, "No one has opted in yet.", 409, "empty"); let sent = 0;
    const doc = { kind: "bpxd", id, hostWs: H.ws, handle: H.h.handle, emails: pool.map((p) => p.email), from: Object.fromEntries(pool.map((p) => [p.email, p.fromWs])), followed: [], at: Date.now() }; sysSet("bpxd-" + id, doc);
    for (const p of pool) if (await mail(H.ws, p.email, `${H.h.name} runs a series like ${p.fromName}'s`, `Hi ${p.first || "there"},\n\nYou asked to hear about hosts like ${p.fromName}. ${H.h.name} runs something similar.${note ? `\n\n"${note}"` : ""}\n\nFollow ${H.h.name} in one tap: ${base}/xo/${id}?e=${encodeURIComponent(crypto.createHmac("sha256", id).update(p.email).digest("hex").slice(0, 16))}\n\nYou'll only hear from them if you follow.`, H.h.name)) sent++;
    send(res, { ok: true, invited: pool.length, emailed: sent }); });
  app.get("/xo/:id", page("teams-xo.html"));
  app.get("/api/xo/:id", (req, res) => { const d = sys("bpxd-" + String(req.params.id).replace(/[^a-f0-9]/g, "")); if (!d) return bad(res, "This link doesn't work anymore.", 404, "not_found"); const h = C.profileOf(d.hostWs) || {}; send(res, { host: h.name || d.handle, handle: d.handle, city: h.city || "", tagline: h.tagline || "" }); });
  app.post("/api/xo/:id/follow", small, (req, res) => { if (limited("xo:" + req.ip, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const id = String(req.params.id).replace(/[^a-f0-9]/g, ""), d = sys("bpxd-" + id); if (!d) return bad(res, "This link doesn't work anymore.", 404, "not_found");
    const em = d.emails.find((e) => crypto.createHmac("sha256", id).update(e).digest("hex").slice(0, 16) === String(req.body?.e || "")); if (!em) return bad(res, "This link is for the person it was sent to.", 403, "not_granted");
    try { C.follow(d.hostWs, { email: em, name: clean(req.body?.name, 80), via: "crossover" }); } catch {} d.followed = [...new Set([...(d.followed || []), em])]; sysSet("bpxd-" + id, d); send(res, { ok: true, host: C.profileOf(d.hostWs)?.name || d.handle, handle: d.handle }); });

  // ---- 19. founding hosts, and the crossover test ----
  app.get("/founding-hosts", page("founding-hosts.html"));
  app.get("/admin/founding-hosts", (req, res, next) => { const u = P.me(req); if (!u || !isAdmin(u.email)) return res.status(404).type("text").send("Not found"); page("admin-founding-hosts.html")(req, res, next); });
  app.get("/api/bb/host/founding", (req, res) => { const H = P.hostMe(req, res); if (!H) return; send(res, { founding: S0(H.ws).get("teambook/founding")?.data || null, invited: flags().foundingHosts.includes(H.ws), paidPilot: flags().paidPilot.includes(H.ws), tests: store.listPrefix("system", "bpxo-").map((d) => d.data).filter((x) => x?.fromWs === H.ws).map((x) => ({ id: x.id, to: x.toName, invited: x.emails.length, crossed: crossedOf(x).length, at: x.at })) }); });
  app.post("/api/bb/host/founding", small, (req, res) => { const H = P.hostMe(req, res); if (!H) return; const F = cleanFounding(req.body || {}, S0(H.ws).get("teambook/founding")?.data || {}); S0(H.ws).set("teambook/founding", F); send(res, { founding: F }); });
  const crossedOf = (x) => { const S = S0(x.toWs), going = new Set(S.list("rsvps").map((d) => d.data).filter((r) => r && ["going", "attended"].includes(r.response) && (r.at || r.createdAt || r.updatedAt || Date.now()) >= x.at).map((r) => lc(r.email)));
    let fol = new Set(); try { fol = new Set(C.followersOf(x.toWs).filter((f) => (f.at || 0) >= x.at).map((f) => lc(f.email))); } catch {} return x.emails.filter((e) => going.has(e) || fol.has(e)); };
  app.post("/api/bb/host/crossover-test", small, async (req, res) => { const H = P.hostMe(req, res); if (!H) return; const toWs = C.wsOfHandle(lc(req.body?.to)); if (!toWs || toWs === H.ws) return bad(res, "Pick another founding host.");
    if (!flags().foundingHosts.includes(toWs)) return bad(res, "The crossover test runs between founding hosts.", 403, "not_founding"); if (limited("xt:" + H.ws, 3, 24 * 3600e3)) return bad(res, "One test a day is plenty.", 429, "rate_limited");
    const L = followersFor(H.ws).filter((f) => f.notify !== false).slice(0, 300), to = C.profileOf(toWs) || {}, id = rid(6), base = publicOrigin(req); if (!L.length) return bad(res, "You don't have followers to invite yet.", 409, "empty");
    const x = { kind: "bpxo", id, fromWs: H.ws, toWs, toName: to.name || to.handle, emails: L.map((f) => lc(f.email)), at: Date.now() }; sysSet("bpxo-" + id, x); let sent = 0;
    for (const f of L) if (await mail(H.ws, f.email, `${H.h.name} recommends ${x.toName}`, `Hi ${first(f.name) || "there"},\n\nI think you'd like ${x.toName}'s next event. Have a look: ${base}/@${to.handle}\n\n${H.h.name}`, H.h.name)) sent++;
    send(res, { ok: true, id, invited: L.length, emailed: sent }); });
  app.get("/api/admin/founding", (req, res) => { if (!admin(req, res)) return; const Fl = flags(), rows = [], today = isoDay();
    for (const x of BB().allSetups()) { const F = S0(x.ws).get("teambook/founding")?.data; if (!F && !Fl.foundingHosts.includes(x.ws)) continue; const L = BB().reqs().filter((r) => r.hostWs === x.ws && ["booked", "done"].includes(statusOf(r, today)));
      const net = L.reduce((a, r) => a + Math.max(0, (r.price?.totalCents || 0) - (r.price?.feeCents || 0) - (r.price?.taxCents || 0)), 0), hours = L.reduce((a, r) => a + (P.evGet(r.id)?.prep?.logged || []).reduce((s, l) => s + l.hours, 0) + 3, 0);
      let fol = new Set(); try { fol = new Set(C.followersOf(x.ws).map((f) => lc(f.email))); } catch {} const rs = S0(x.ws).list("rsvps").map((d) => d.data).filter((r) => r?.response === "going");
      rows.push({ ws: x.ws, ...foundingRow({ name: x.h.name, handle: x.h.handle, F: F || {}, paidPilot: Fl.paidPilot.includes(x.ws), teamNetCents: net, teamHours: L.length ? hours : 0, followerSeats: ofN(rs.filter((r) => fol.has(lc(r.email))).length, rs.length, "seats at public events filled by followers") }), invited: Fl.foundingHosts.includes(x.ws), bookings: L.length }); }
    const tests = store.listPrefix("system", "bpxo-").map((d) => d.data).filter(Boolean).map((x) => ({ id: x.id, from: C.profileOf(x.fromWs)?.name || "", to: x.toName, ...ofN(crossedOf(x).length, x.emails.length, "regulars crossed over"), at: x.at }));
    const brands = [...new Set(BB().reqs().map((r) => r.brandWs))].map((ws) => ({ ws, company: getWorkspace(ws)?.company || "", designPartner: Fl.designPartners.includes(ws) }));
    send(res, { hosts: rows, tests, brands, autoRebooks: store.listPrefix("system", "bpev-").map((d) => d.data).filter((e) => e?.autoRebook).map((e) => ({ id: e.reqId, triggered: !!e.autoRebook.triggered, signedAt: e.autoRebook.signedAt })) }); });
  app.post("/api/admin/brand-flags", small, (req, res) => { if (!admin(req, res)) return; const b = req.body || {}, F = flags(), ws = String(b.ws || (b.handle ? C.wsOfHandle(lc(b.handle)) : "") || ""); if (!ws || !getWorkspace(ws)) return bad(res, "No workspace by that name.", 404, "not_found");
    const key = { designPartner: "designPartners", foundingHost: "foundingHosts", paidPilot: "paidPilot" }[b.flag]; if (!key) return bad(res, "Pick a flag.");
    F[key] = b.on === false ? F[key].filter((x) => x !== ws) : [...new Set([...F[key], ws])]; sysSet("bpflags", F); send(res, { flags: F }); });
  app.post("/api/bb/host/self-report", small, (req, res) => { const H = P.hostMe(req, res); if (!H) return; const F = cleanFounding({ offPlatform: req.body?.offPlatform }, S0(H.ws).get("teambook/founding")?.data || {}); S0(H.ws).set("teambook/founding", F); send(res, { offPlatform: F.offPlatform }); });

  // ---- 18. durability, for us ----
  app.get("/api/admin/brand-durability", (req, res) => { if (!admin(req, res)) return; const L = BB().reqs(), evs = new Map(), attendance = [], signals = {}, offPlatform = {};
    for (const r of L) { const ev = P.evGet(r.id) || {}, c = P.campOf(r), d = r.date || isoDay(r.createdAt), em = new Set();
      for (const g of c ? (c.guests || []).filter((g) => g.event === r.id && g.checkedIn && g.email) : []) em.add(lc(g.email)); for (const s of (ev.hostSeats || []).filter((s) => s.checkedIn && s.email)) em.add(lc(s.email));
      for (const e of em) attendance.push({ email: e, hostWs: r.hostWs, date: d, reqId: r.id }); evs.set(r.id, { ...ev, attendedEmails: [...em] }); }
    for (const x of BB().allSetups()) { for (const d of S0(x.ws).list("events")) { const e = d.data || {}; if (!ISO.test(e.date || "")) continue; for (const g of e.guests || []) if (/attended/i.test(g.status || "") && g.email) attendance.push({ email: lc(g.email), hostWs: x.ws, date: e.date }); }
      offPlatform[x.ws] = S0(x.ws).get("teambook/founding")?.data?.offPlatform || 0; }
    for (const ws of new Set(L.map((r) => r.brandWs))) { signals[ws] = (S0(ws).get("teambook/signals")?.data?.list || []).concat(store.listPrefix("system", "bbsl-").map((d) => d.data).filter((s) => s?.ws === ws).map((s) => ({ what: "save-host", at: s.createdAt || s.updatedAt || 0 }))); }
    send(res, { ...durability(L, { evOf: (id) => evs.get(id), attendance, signals, offPlatform, designPartners: new Set(flags().designPartners) }), bars: BARS }); });

  return { runPairNudges, maybeAutoRebook: (id) => { const r = BB().reqGet(id), ev = r && P.evGet(r.id), c = r && P.campOf(r); if (!ev || !c) return null; const out = maybeAutoRebook(r, ev, P.outcomesFor(c).events.find((e) => e.id === r.id)); P.evSet(ev); return out; }, orgOfWs };
}
