// Campaigns for brand teams: the work behind one goal ("Q1 developer dinners in NYC and SF"), end to end.
// Plan (goal, audience, cities, budget, dates, KPIs) -> Source (fit from Insights, the team's shortlists) -> Book
// (several team bookings through the existing request to book, with a budget tracker) -> Invite (a guest list per
// event with consent, CSV in and out, an opt-in sign-up page, invites by email and the share sheet) -> Run (one
// timeline, day-of check-in, messages with each host) -> Measure (per-event and campaign rollups, a CSV for the CRM,
// a one-page report for leadership).
//
// Docs: system/camp-<id> holds one campaign (its team roles, linked bookings and shortlists, other costs and guests).
// Bookings stay system/bbreq-<id> (server/brandbook.js): a campaign only points at them.
//
// Rules kept here and tested (test/campaigns.test.js):
//   - roles: owner (the person who made it and the workspace owner), editor, viewer. Viewers read; editors plan,
//     book, invite and check in; only owners change roles, delete, and approve spend over the budget.
//   - spend: a booking that would take the campaign past its budget waits for an owner's OK, on top of the team's
//     own approval rule (the brandbook rule, unchanged).
//   - consent: guests are the brand's own invitees. The CRM export has only guests who said yes to sharing their
//     details with this brand, and never anyone's feedback. Feedback is counted, never attributed: would go again
//     shows once 10 or more people answered, themes once 3 or more said the same, and a quote only when that guest
//     ticked "OK to quote me" (first name only). A guest who signed up without sharing shows by first name only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getWorkspace, getDbUser, membersOf, scopeStore, DEFAULT_WS, claimEvent } from "./workspaces.js";
import { eventTz } from "./tz.js";
import { idOf as personId, keyFor } from "./people.js";
import { statusOf, approxArea, money } from "./brandbook.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { K } from "./insights.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 864e5;
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const dollars = (v) => Math.max(0, Math.min(1e10, Math.round(+String(v ?? "").replace(/[^\d.]/g, "") * 100) || 0));

// ---------------------------------------------------------------------------------------------------------------
// Roles and what each may do.
export const ROLES = ["owner", "editor", "viewer"];
export const CAN = {
  view: ["owner", "editor", "viewer"], plan: ["owner", "editor"], book: ["owner", "editor"], guests: ["owner", "editor"], checkin: ["owner", "editor"],
  export: ["owner", "editor"], share: ["owner", "editor"], roles: ["owner"], delete: ["owner"], approve: ["owner"],
};
export const can = (role, what) => !!role && (CAN[what] || []).includes(role);
/** Someone's role on a campaign: null when they aren't on the brand's team. */
export function campaignRole(c, { email = "", ws = "", wsOwner = false } = {}) {
  if (!c || !ws || ws === DEFAULT_WS || ws !== c.ws) return null;
  const e = lc(email); if (!e) return null;
  if (wsOwner || e === lc(c.ownerEmail)) return "owner";
  const r = c.team?.[e]; if (ROLES.includes(r)) return r;
  return ROLES.includes(c.memberRole) ? c.memberRole : "viewer";
}

// ---------------------------------------------------------------------------------------------------------------
// Money: committed vs spent vs remaining, from the bookings the campaign points at and its other costs.
const PENDING = ["approval", "requested", "countered"], COMMITTED = ["accepted", "booked", "done"];
export const paidOf = (r) => Math.max(0, (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + (p.cents || 0), 0) - (r.refund?.cents || 0));
export function budgetOf(c, requests = [], today = isoDay()) {
  let committed = 0, pending = 0, spent = 0; const lines = [];
  for (const r of requests) { const st = statusOf(r, today), total = r.price?.totalCents || 0, paid = paidOf(r);
    if (COMMITTED.includes(st)) { committed += total; spent += paid; lines.push({ id: r.id, label: r.pkgName, state: "committed", cents: total, paidCents: paid }); }
    else if (PENDING.includes(st)) { pending += total; lines.push({ id: r.id, label: r.pkgName, state: "pending", cents: total, paidCents: 0 }); }
    else if (paid) { committed += paid; spent += paid; lines.push({ id: r.id, label: r.pkgName + " (cancelled, kept by the host)", state: "committed", cents: paid, paidCents: paid }); } }
  for (const x of c.costs || []) { committed += x.cents || 0; if (x.paid) spent += x.cents || 0; lines.push({ id: x.id, label: x.label, state: "committed", cents: x.cents || 0, paidCents: x.paid ? x.cents || 0 : 0, other: true }); }
  const budget = c.budgetCents || 0, remaining = budget - committed;
  return { budgetCents: budget, committedCents: committed, spentCents: spent, pendingCents: pending, remainingCents: remaining, afterPendingCents: remaining - pending,
    over: budget > 0 && remaining < 0, usedPct: budget ? Math.min(999, Math.round((committed / budget) * 100)) : null, lines };
}
/** Would a new booking of `cents` need an owner's OK? Only when the campaign has a budget and this goes past it. */
export function overBudget(c, requests, cents, today = isoDay()) {
  const B = budgetOf(c, requests, today); if (!B.budgetCents) return null;
  const after = B.committedCents + B.pendingCents + Math.max(0, cents || 0);
  return after > B.budgetCents ? { overByCents: after - B.budgetCents, rule: `Over the campaign budget by ${money(after - B.budgetCents)}` } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Guests: cleaned on the way in, consent kept with where and when it was given.
export function cleanGuest(g = {}, { source = "manual", now = Date.now() } = {}) {
  const email = lc(clean(g.email, 160)); const yes = (v) => v === true || /^(y|yes|true|1|opted in|opt-in|ok)$/i.test(String(v ?? "").trim());
  const consent = yes(g.consent) ? { share: true, at: now, via: source } : { share: false, at: 0, via: "" };
  return { id: rid(5), token: rid(12), event: clean(g.event, 24), name: clean(g.name, 100), email: EMAIL_RE.test(email) ? email : "", company: clean(g.company, 100), title: clean(g.title || g.role, 100),
    source, consent, status: "added", invitedAt: 0, repliedAt: 0, checkedIn: false, checkedAt: 0, again: null, said: "", quoteOk: false, followUp: "none", addedAt: now };
}
// ---- run of show (review 16): the team's own plan for the night, in the event's local time ----
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const addMin = (hm, m) => { const [h, mi] = hm.split(":").map(Number), t = (((h * 60 + mi + m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
/** A first draft from the start time: arrive, welcome, the main part, wrap. */
export function defaultRunOfShow(start = "19:00") { const s = HM.test(start) ? start : "19:00";
  return [{ at: addMin(s, -60), what: "Team arrives, checks the room and the guest list" }, { at: addMin(s, -15), what: "Doors open, name tags out" }, { at: s, what: "Welcome from the team, then over to the host" },
    { at: addMin(s, 30), what: "The main part" }, { at: addMin(s, 150), what: "Thanks and a quick word on what's next" }, { at: addMin(s, 180), what: "Wrap" }]; }
export function cleanRunOfShow(items) { return (Array.isArray(items) ? items : []).map((x) => ({ at: HM.test(String(x?.at || "")) ? x.at : "", what: clean(x?.what, 140) })).filter((x) => x.what).slice(0, 30)
  .sort((a, b) => (a.at || "99").localeCompare(b.at || "99")); }
/** A reply on the event's own invite page, read back onto the campaign's guest (the campaign keeps its own words). */
export function statusFromRsvp(r) { if (!r) return ""; return r.response === "going" ? "yes" : ["no", "declined"].includes(r.response) ? "no" : r.response === "waitlist" ? "waitlist" : r.response === "requested" ? "asked" : ""; }

/** A small CSV reader: quoted fields, commas and new lines inside quotes, a header row naming the columns. */
export function parseCsv(text) {
  const rows = [], s = String(text || "").replace(/^﻿/, ""); let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) { const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; } else cur += ch; }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const H = rows[0].map((h) => lc(h).replace(/[^a-z]/g, "")), col = (names) => H.findIndex((h) => names.includes(h));
  const at = { name: col(["name", "fullname", "guest"]), first: col(["firstname", "first"]), last: col(["lastname", "last", "surname"]), email: col(["email", "emailaddress", "workemail"]), company: col(["company", "organization", "organisation", "account"]), title: col(["title", "role", "jobtitle"]), consent: col(["consent", "optin", "optedin", "marketingconsent", "share"]) };
  const hasHeader = at.email >= 0 || at.name >= 0 || at.first >= 0;
  return (hasHeader ? rows.slice(1) : rows).map((r) => { const g = (i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    if (!hasHeader) return { name: r[0] || "", email: r[1] || "", company: r[2] || "", title: r[3] || "", consent: r[4] || "" };
    return { name: g(at.name) || [g(at.first), g(at.last)].filter(Boolean).join(" "), email: g(at.email), company: g(at.company), title: g(at.title), consent: g(at.consent) }; }).filter((g) => g.name || g.email);
}
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
/** The CRM export: only guests who agreed to share their details with this brand, and no one's feedback. */
export function exportCsv(c, events = {}) {
  const head = ["Name", "Email", "Company", "Title", "Campaign", "Event", "Event date", "Host", "Invited", "Reply", "Attended", "Follow-up", "Consent given", "Consent source"];
  const rows = (c.guests || []).filter((g) => g.consent?.share === true && g.email).map((g) => { const E = events[g.event] || {};
    return [g.name, g.email, g.company, g.title, c.title, E.name || "", E.date || "", E.host || "", g.invitedAt ? isoDay(g.invitedAt) : "", { yes: "Yes", no: "No" }[g.status] || "", g.checkedIn ? "Yes" : "No",
      { sent: "Followed up", meeting: "Meeting booked" }[g.followUp] || "", g.consent.at ? isoDay(g.consent.at) : "", { csv: "Imported with consent", form: "Sign-up page", rsvp: "Invite reply", manual: "Added by the team" }[g.consent.via] || g.consent.via]; });
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// What people said, counted into themes. A theme shows once 3 or more people said it, and only with 10+ answers.
export const THEMES = [
  ["people", "Meeting people", /\b(met|meet|people|peers|connect|connections|conversation|conversations|network|crowd|folks|table)\b/],
  ["host", "The host", /\b(host|chef|teacher|guide|instructor|led)\b/],
  ["food", "The food and drink", /\b(food|dinner|meal|menu|delicious|wine|coffee|ate|courses?|dish)\b/],
  ["made", "Making something", /\b(made|make|making|hands|built|craft|clay|bowl|mug)\b/],
  ["learned", "Learning something", /\b(learn|learned|learnt|taught|insight|useful|new skill|ideas?)\b/],
  ["calm", "The pace and the room", /\b(relaxed|calm|cozy|cosy|intimate|small|quiet|space|room|venue|setting)\b/],
  ["long", "Ran a bit long", /\b(long|late|overran|rushed|too much)\b/],
  ["loud", "Too loud to talk", /\b(loud|noisy|hard to hear)\b/],
];
export function themesOf(answers = []) {
  const said = answers.filter((s) => String(s || "").trim().length > 2); if (said.length < K.people) return { shown: false, n: said.length, themes: [] };
  const out = THEMES.map(([k, label, re]) => ({ k, label, n: said.filter((s) => re.test(lc(s))).length })).filter((t) => t.n >= 3).sort((a, b) => b.n - a.n);
  return { shown: true, n: said.length, themes: out.map((t) => ({ k: t.k, label: t.label, sharePct: pct(t.n, said.length) })) };
}

// ---------------------------------------------------------------------------------------------------------------
// Rollups: per event and for the campaign. Counts are the brand's own operations (who it invited, who checked in);
// feedback only shows in aggregate, with the same 10-person floor as Insights.
export function rollup(c, requests = [], today = isoDay()) {
  const G = c.guests || [], R = new Map(requests.map((r) => [r.id, r])), B = budgetOf(c, requests, today);
  const one = (L) => { const invited = L.filter((g) => g.status !== "asked" && (g.invitedAt || ["yes", "no", "invited"].includes(g.status))).length, yes = L.filter((g) => g.status === "yes").length, no = L.filter((g) => g.status === "no").length, att = L.filter((g) => g.checkedIn).length;
    const ans = L.filter((g) => g.checkedIn && g.again != null), againYes = ans.filter((g) => g.again === true).length;
    return { onList: L.length, invited, replied: yes + no, yes, no, attended: att, showPct: pct(att, yes), replyPct: pct(yes + no, invited), againAnswered: ans.length, againPct: ans.length >= K.people ? pct(againYes, ans.length) : null,
      followUps: L.filter((g) => g.followUp === "sent" || g.followUp === "meeting").length, meetings: L.filter((g) => g.followUp === "meeting").length, consented: L.filter((g) => g.consent?.share).length }; };
  const events = (c.bookings || []).map((id) => R.get(id)).filter(Boolean).map((r) => { const L = G.filter((g) => g.event === r.id), m = one(L), st = statusOf(r, today);
    const cost = (["accepted", "booked", "done"].includes(st) ? r.price?.totalCents || 0 : paidOf(r)) + (c.costs || []).filter((x) => x.event === r.id).reduce((a, x) => a + (x.cents || 0), 0);
    return { id: r.id, name: r.pkgName, handle: r.handle, date: r.date || "", flex: r.flex || null, status: st, headcount: r.headcount, ...m, showPct: st === "done" ? m.showPct : null, costCents: cost, costPerAttendeeCents: st === "done" && m.attended ? Math.round(cost / m.attended) : null,
      themes: themesOf(L.filter((g) => g.checkedIn).map((g) => g.said)) }; });
  const all = one(G), attended = all.attended, live = events.filter((e) => !["cancelled", "declined"].includes(e.status)), done = live.filter((e) => e.status === "done");
  const seen = new Set(), quotes = G.filter((g) => g.quoteOk && g.checkedIn && String(g.said || "").trim().length > 12).filter((g) => { const k = lc(g.said); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4).map((g) => ({ text: clean(g.said, 240), name: first(g.name) }));
  // show rate and cost per attendee count only events that have happened
  const doneYes = done.reduce((a, e) => a + e.yes, 0), doneAtt = done.reduce((a, e) => a + e.attended, 0), doneCost = done.reduce((a, e) => a + e.costCents, 0);
  const totals = { ...all, showPct: pct(doneAtt, doneYes), events: live.length, eventsDone: done.length, costCents: B.committedCents, costPerAttendeeCents: doneAtt ? Math.round(doneCost / doneAtt) : null, themes: themesOf(G.filter((g) => g.checkedIn).map((g) => g.said)), quotes };
  const k = c.kpis || {}, kpis = [
    k.attendees ? { k: "attendees", label: "Guests who came", goal: k.attendees, have: attended, pct: pct(attended, k.attendees) } : null,
    k.meetings ? { k: "meetings", label: "Pipeline meetings", goal: k.meetings, have: totals.meetings, pct: pct(totals.meetings, k.meetings) } : null,
    k.againPct ? { k: "again", label: "Would go again", goal: k.againPct, have: totals.againPct, unit: "%", pct: totals.againPct == null ? null : pct(totals.againPct, k.againPct), note: totals.againPct == null ? `Shows once ${K.people} people have answered` : "" } : null,
  ].filter(Boolean);
  return { events, totals, kpis, budget: B };
}

// ---------------------------------------------------------------------------------------------------------------
export function mountCampaigns(app, { store, small, currentUser, C, X, PUBLIC_DIR = "", publicOrigin = () => "", insights = null }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const brandMe = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const W = getWorkspace(u.ws); if (!W || W.plan === "friends") { bad(res, "Campaigns are for brand teams.", 403, "not_brand"); return null; } return { ...u, W, wsOwner: !!u.owner || lc(W.ownerEmail) === lc(u.email) }; };
  const cGet = (id) => store.get("system/camp-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 24))?.data || null;
  const cSet = (c) => { c.updatedAt = Date.now(); store.set("system/camp-" + c.id, c); return c; };
  const cList = (ws) => store.listPrefix("system", "camp-").map((d) => d.data).filter((c) => c?.kind === "camp" && c.ws === ws);
  const reqGet = (id) => store.get("system/bbreq-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 24))?.data || null;
  const reqsOf = (c) => (c.bookings || []).map(reqGet).filter((r) => r && r.brandWs === c.ws);
  const roleIn = (u, c) => campaignRole(c, { email: u.email, ws: u.ws, wsOwner: u.wsOwner });
  /** Load a campaign for someone who may do `what`, or answer the error. */
  const load = (req, res, what) => { const u = brandMe(req, res); if (!u) return null; const c = cGet(req.params.id), role = roleIn(u, c);
    if (!c || !role) { bad(res, "Not found.", 404, "not_found"); return null; }
    if (!can(role, what)) { bad(res, { plan: "Viewers can see this campaign but not change it. Ask an owner to make you an editor.", book: "Only editors and owners can book for this campaign.", guests: "Only editors and owners can change the guest list.", checkin: "Only editors and owners can check people in.", export: "Only editors and owners can export.", share: "Only editors and owners can share the report.", roles: "Only an owner can change who does what.", delete: "Only an owner can delete a campaign.", approve: "Only an owner can approve spend over the budget." }[what] || "Not allowed.", 403, "not_granted"); return null; }
    return { u, c, role }; };
  const hostName = (r) => C.profileOf(r.hostWs)?.name || r.handle || "";
  const eventsMap = (c) => Object.fromEntries(reqsOf(c).map((r) => [r.id, { name: r.pkgName, date: r.date || "", host: hostName(r) }]));
  const teamList = (c) => { const W = getWorkspace(c.ws); return membersOf(c.ws).map((m) => ({ name: m.name || "", email: lc(m.email), role: campaignRole(c, { email: m.email, ws: c.ws, wsOwner: lc(W?.ownerEmail) === lc(m.email) || !!m.owner }) })); };
  const maskEmail = (e) => { const [a, d] = String(e || "").split("@"); return a && d ? `${a[0]}•••@${d}` : ""; };
  // what a team member sees of a guest: everything the brand gave us, or first name only for a sign-up who didn't share
  const guestView = (g) => { const own = g.source === "csv" || g.source === "manual", show = own || g.consent?.share;
    return { id: g.id, event: g.event, name: show ? g.name : first(g.name), email: show ? g.email : maskEmail(g.email), company: show ? g.company : "", title: show ? g.title : "", source: g.source, consent: { share: !!g.consent?.share, via: g.consent?.via || "", at: g.consent?.at || 0 },
      status: g.status, invitedAt: g.invitedAt, repliedAt: g.repliedAt, checkedIn: g.checkedIn, followUp: g.followUp, limited: !show }; };
  // review 16: the start time where the event is, with that city's time zone, so a team in one city reads another's right
  const localOf = (r) => { try { const st = scopeStore(store, r.hostWs).get("teambook/setup")?.data || {}, h = C.profileOf?.(r.hostWs) || {}, pkg = (st.packages || []).find((x) => x.id === r.pkgId) || {};
    const city = st.city || h.city || "", tz = eventTz({ city, hood: st.area }) || ""; return { time: HMOK(r.time) ? r.time : pkg.time === "daytime" ? "12:00" : "19:00", tz, zone: tzShort(tz, r.date) }; } catch { return { time: "", tz: "", zone: "" }; } };
  const reqCard = (r) => { const st = statusOf(r); return { local: localOf(r), id: r.id, status: st, name: r.pkgName, handle: r.handle, pkg: r.pkgId, host: hostName(r), date: r.date || "", flex: r.flex || null, headcount: r.headcount, totalCents: r.price?.totalCents || 0, paidCents: paidOf(r), approval: r.approval || null, url: `/teams/bookings/${r.id}`, area: areaOf(r) }; };
  const areaOf = (r) => { const s = scopeStore(store, r.hostWs).get("teambook/setup")?.data || {}, A = approxArea(s.area, s.city); return A.area || A.city || ""; };
  function full(c, role) { const R = reqsOf(c);
    return { id: c.id, title: c.title, goal: c.goal, audience: c.audience, cities: c.cities, budgetCents: c.budgetCents, start: c.start, end: c.end, kpis: c.kpis, status: c.status, role, memberRole: c.memberRole, owner: c.ownerEmail, single: !!c.single, series: c.series || null, inviteFrom: c.inviteFrom || {},
      briefs: Object.fromEntries(R.map((r) => [r.id, X.briefLines?.(r.id) || []])),
      can: Object.fromEntries(Object.keys(CAN).map((k) => [k, can(role, k)])), bookings: R.map(reqCard), shortlists: (c.shortlists || []).map((id) => { const sl = store.get("system/bbsl-" + id)?.data; return sl && sl.ws === c.ws ? { id: sl.id, title: sl.title, n: (sl.items || []).length, votes: Object.values(sl.votes || {}).reduce((a, v) => a + Object.keys(v).length, 0) } : null; }).filter(Boolean),
      costs: c.costs || [], guests: can(role, "view") ? (c.guests || []).map(guestView) : [], team: teamList(c), joinUrl: `/cg/${c.id}/join`, reportUrl: c.reportKey && can(role, "share") ? `/teams/campaigns/${c.id}/report?k=${c.reportKey}` : "", joinOpen: c.joinOpen !== false,
      ...rollup(c, R), goals: c.kpis || {}, createdAt: c.createdAt, updatedAt: c.updatedAt,
      guestEvents: Object.fromEntries(Object.entries(c.guestEvents || {}).map(([k, eid]) => { const e = scopeStore(store, c.ws).get("events/" + eid)?.data || {}; return [k, { id: eid, board: `/contacts/event/${eid}`, invite: `/e/${eid}`, tz: e.tz || "", startTime: e.startTime || "" }]; })),
      ros: Object.fromEntries(R.map((r) => { const items = c.ros?.[r.id]?.length ? c.ros[r.id] : defaultRunOfShow((c.guestEvents?.[r.id] && scopeStore(store, c.ws).get("events/" + c.guestEvents[r.id])?.data?.startTime) || "19:00"); return [r.id, X.rosWithBrief?.(r.id, items) || items]; })) }; }
  const brief = (c, role) => { const R = reqsOf(c), B = budgetOf(c, R), today = isoDay(), next = R.filter((r) => r.date && r.date >= today && !["cancelled", "declined"].includes(statusOf(r))).sort((a, b) => a.date.localeCompare(b.date))[0];
    return { id: c.id, title: c.title, goal: c.goal, cities: c.cities, start: c.start, end: c.end, status: c.status, role, single: !!c.single, series: !!c.series, events: R.filter((r) => !["cancelled", "declined"].includes(statusOf(r))).length, confirmed: R.filter((r) => ["booked", "done"].includes(statusOf(r))).length, eventsDone: R.filter((r) => statusOf(r) === "done").length, budget: { budgetCents: B.budgetCents, committedCents: B.committedCents, spentCents: B.spentCents, remainingCents: B.remainingCents, pendingCents: B.pendingCents, over: B.over, usedPct: B.usedPct },
      next: next ? { name: next.pkgName, date: next.date, host: hostName(next) } : null, guests: (c.guests || []).length, attended: (c.guests || []).filter((g) => g.checkedIn).length, updatedAt: c.updatedAt }; };
  const cleanPlan = (b = {}, cur = {}) => { const k = b.kpis || cur.kpis || {};
    return { title: clean(b.title ?? cur.title, 100) || "New campaign", goal: clean(b.goal ?? cur.goal, 400), audience: { tags: (Array.isArray(b.audience?.tags) ? b.audience.tags : b.audience?.tags != null ? String(b.audience.tags).split(",") : cur.audience?.tags || []).map((t) => clean(t, 40)).filter(Boolean).slice(0, 8), perPersonCents: b.audience?.perPerson != null ? dollars(b.audience.perPerson) : cur.audience?.perPersonCents || 0 },
      cities: (Array.isArray(b.cities) ? b.cities : b.cities != null ? String(b.cities).split(",") : cur.cities || []).map((t) => clean(t, 60)).filter(Boolean).slice(0, 8), budgetCents: b.budget != null ? dollars(b.budget) : cur.budgetCents || 0,
      start: ISO.test(b.start || "") ? b.start : b.start === "" ? "" : cur.start || "", end: ISO.test(b.end || "") ? b.end : b.end === "" ? "" : cur.end || "",
      kpis: { attendees: int(k.attendees, 0, 100000), meetings: int(k.meetings, 0, 100000), againPct: int(k.againPct, 0, 100) }, status: ["planning", "active", "done"].includes(b.status) ? b.status : cur.status || "planning",
      memberRole: ["editor", "viewer"].includes(b.memberRole) ? b.memberRole : cur.memberRole || "editor" }; };

  // ---- the gate on booking: called from POST /api/bb/requests when a request names a campaign ----
  X.campaignGate = (u, id, cents) => { const c = cGet(id); if (!c) return { ok: false, message: "That campaign isn't there anymore." }; const W = getWorkspace(u.ws), role = campaignRole(c, { email: u.email, ws: u.ws, wsOwner: !!u.owner || lc(W?.ownerEmail) === lc(u.email) });
    if (!role) return { ok: false, message: "That campaign isn't there anymore." }; if (!can(role, "book")) return { ok: false, message: "Only editors and owners can book for this campaign." };
    const o = overBudget(c, reqsOf(c), cents), owners = [lc(c.ownerEmail), lc(W?.ownerEmail)].filter(Boolean);
    return { ok: true, id: c.id, approval: o && !(role === "owner") ? { rule: o.rule, approvers: [...new Set(owners)] } : null }; };
  X.campaignAttach = (id, reqId) => { const c = cGet(id); if (!c) return; c.bookings = [...new Set([...(c.bookings || []), reqId])].slice(0, 60); if (c.status === "planning") c.status = "active"; cSet(c); };

  // ---- pages ----
  app.get("/teams/home", page("teams-home.html"));
  app.get(["/teams/campaigns", "/teams/campaigns/:id", "/teams/campaigns/:id/:tab"], (req, res, next) => (req.params.tab === "report" ? next() : page("teams-campaigns.html")(req, res)));
  app.get(["/cg/:id/join", "/cg/:id/r/:token"], page("campaign-guest.html"));

  // ---- list, create, read, change ----
  app.get("/api/campaigns/results", (req, res) => { const u = brandMe(req, res); if (!u) return; res.set("Cache-Control", "private, no-store").json(results(u.ws)); });
  app.get("/api/campaigns", (req, res) => { const u = brandMe(req, res); if (!u) return; const L = cList(u.ws).map((c) => brief(c, roleIn(u, c))).sort((a, b) => (a.status === "done") - (b.status === "done") || b.updatedAt - a.updatedAt);
    res.set("Cache-Control", "private, no-store").json({ campaigns: L, company: u.W.company || "" }); });
  app.post("/api/campaigns", small, (req, res) => { const u = brandMe(req, res); if (!u) return; if (limited("cc:" + u.ws, 60)) return bad(res, "That's a lot of campaigns at once. Try again later.", 429, "rate_limited");
    const c = { kind: "camp", id: rid(6), ws: u.ws, ownerEmail: lc(u.email), ...cleanPlan(req.body || {}), team: {}, bookings: [], shortlists: [], costs: [], guests: [], createdAt: Date.now() };
    cSet(c); res.json({ ok: true, id: c.id, url: `/teams/campaigns/${c.id}`, campaign: full(c, roleIn(u, c)) }); });
  app.get("/api/campaigns/:id", (req, res) => { const L = load(req, res, "view"); if (!L) return; try { syncBack(L.c); } catch (e) { console.warn("[campaigns] sync", e.message); } res.set("Cache-Control", "private, no-store").json({ campaign: full(L.c, L.role) }); });
  app.patch("/api/campaigns/:id", small, (req, res) => { const L = load(req, res, "plan"); if (!L) return; const b = req.body || {}; if (b.memberRole && !can(L.role, "roles")) return bad(res, "Only an owner can change who does what.", 403, "not_granted");
    Object.assign(L.c, cleanPlan(b, L.c)); cSet(L.c); res.json({ campaign: full(L.c, L.role) }); });
  app.delete("/api/campaigns/:id", (req, res) => { const L = load(req, res, "delete"); if (!L) return; store.delete("system/camp-" + L.c.id); res.json({ ok: true }); });
  app.post("/api/campaigns/:id/team", small, (req, res) => { const L = load(req, res, "roles"); if (!L) return; const b = req.body || {}, e = lc(b.email);
    if (!membersOf(L.c.ws).some((m) => lc(m.email) === e)) return bad(res, "Invite them to your team first, then give them a role here.");
    if (!ROLES.includes(b.role)) return bad(res, "Pick owner, editor or viewer.");
    L.c.team = { ...(L.c.team || {}), [e]: b.role }; cSet(L.c); res.json({ campaign: full(L.c, L.role) }); });

  // ---- source ----
  app.get("/api/campaigns/:id/source", (req, res) => { const L = load(req, res, "view"); if (!L) return; const c = L.c;
    const per = c.audience?.perPersonCents || 0, out = [];
    for (const city of c.cities?.length ? c.cities : [""]) { let F = null; try { F = insights?.fitFor({ tags: c.audience?.tags || [], city, budget: per ? per / 100 : 0 }, c.ws); } catch {} if (F) out.push({ city, kinds: F.kinds.filter((k) => !k.hidden).slice(0, 4), hosts: F.hosts.slice(0, 6) }); }
    const lists = store.listPrefix("system", "bbsl-").map((d) => d.data).filter((s) => s?.ws === c.ws).map((s) => ({ id: s.id, title: s.title, n: (s.items || []).length, linked: (c.shortlists || []).includes(s.id),
      items: (s.items || []).map((it) => ({ handle: it.handle, pkg: it.pkg, votes: Object.keys(s.votes?.[it.handle + "/" + it.pkg] || {}).length })).sort((a, b) => b.votes - a.votes) }));
    res.set("Cache-Control", "private, no-store").json({ byCity: out, shortlists: lists }); });
  app.post("/api/campaigns/:id/shortlists", small, (req, res) => { const L = load(req, res, "plan"); if (!L) return; const sid = String(req.body?.id || "").replace(/[^a-f0-9]/g, ""), sl = store.get("system/bbsl-" + sid)?.data;
    if (!sl || sl.ws !== L.c.ws) return bad(res, "That shortlist isn't your team's.", 404, "not_found");
    L.c.shortlists = req.body?.remove ? (L.c.shortlists || []).filter((x) => x !== sid) : [...new Set([...(L.c.shortlists || []), sid])].slice(0, 20); cSet(L.c); res.json({ campaign: full(L.c, L.role) }); });

  // ---- book: attach bookings made through request to book, and other costs ----
  app.post("/api/campaigns/:id/bookings", small, (req, res) => { const L = load(req, res, "book"); if (!L) return; const r = reqGet(req.body?.id);
    if (!r || r.brandWs !== L.c.ws) return bad(res, "That booking isn't your team's.", 404, "not_found");
    if (req.body?.remove) L.c.bookings = (L.c.bookings || []).filter((x) => x !== r.id);
    else { if ((L.c.bookings || []).includes(r.id)) return res.json({ campaign: full(L.c, L.role) }); const o = overBudget(L.c, reqsOf(L.c), r.price?.totalCents || 0);
      if (o && L.role !== "owner" && !req.body?.approved) return bad(res, `${o.rule}. An owner of this campaign has to add it.`, 403, "over_budget");
      L.c.bookings = [...new Set([...(L.c.bookings || []), r.id])]; for (const c2 of cList(L.c.ws)) if (c2.id !== L.c.id && (c2.bookings || []).includes(r.id)) { c2.bookings = c2.bookings.filter((x) => x !== r.id); cSet(c2); } }
    cSet(L.c); res.json({ campaign: full(L.c, L.role) }); });
  app.get("/api/campaigns/:id/bookable", (req, res) => { const L = load(req, res, "view"); if (!L) return; const mine = new Set(L.c.bookings || []);
    const elsewhere = new Set(cList(L.c.ws).flatMap((c) => c.bookings || [])); // only bookings that aren't in any campaign yet
    const all = store.listPrefix("system", "bbreq-").map((d) => d.data).filter((r) => r?.kind === "bbreq" && r.brandWs === L.c.ws && !mine.has(r.id) && !elsewhere.has(r.id) && !["cancelled", "declined", "question"].includes(statusOf(r))).map(reqCard);
    res.json({ bookings: all }); });
  app.post("/api/campaigns/:id/costs", small, (req, res) => { const L = load(req, res, "book"); if (!L) return; const b = req.body || {};
    if (b.remove) L.c.costs = (L.c.costs || []).filter((x) => x.id !== b.remove);
    else { const label = clean(b.label, 80), cents = dollars(b.amount); if (!label || !cents) return bad(res, "Add what it's for and how much.");
      const o = overBudget(L.c, reqsOf(L.c), cents); if (o && L.role !== "owner") return bad(res, `${o.rule}. An owner of this campaign has to add it.`, 403, "over_budget");
      L.c.costs = [...(L.c.costs || []), { id: rid(4), label, cents, paid: !!b.paid, event: clean(b.event, 24) }].slice(0, 60); }
    cSet(L.c); res.json({ campaign: full(L.c, L.role) }); });

  // ---- one guest list (review 16) ----
  // A booking the host accepted gets a brand-side invite page, events/cg<booking id> in the brand's workspace, so
  // campaign guests live in People and in that event's invite plan: smart lists, waves, the status board, reminders
  // for people who haven't replied, add to calendar, the waitlist and the door. c.guests stays exactly as it was and is
  // kept in step both ways, so the campaign's own reply links, Measure, the report and the CRM export read the same.
  // Consent: People only gets "in" for a guest who agreed to hear from this brand; the plan never emails anyone else.
  const P0 = () => app.locals.people || null, I0 = () => app.locals.invites || null;
  const geId = (r) => "cg" + String(r.id).slice(0, 24);
  function guestEvent(c, r, { make = false } = {}) {
    if (!r || r.brandWs !== c.ws) return ""; const S = scopeStore(store, c.ws), id = c.guestEvents?.[r.id] || geId(r);
    if (S.get("events/" + id)?.data) return id; if (!make || !["accepted", "booked", "done"].includes(statusOf(r))) return "";
    const st = scopeStore(store, r.hostWs).get("teambook/setup")?.data || {}, h = C.profileOf?.(r.hostWs) || {}, pkg = (st.packages || []).find((x) => x.id === r.pkgId) || {};
    const city = st.city || h.city || "", A = approxArea(st.area, city), W = getWorkspace(c.ws) || {}, company = W.company || "Our team";
    if (!claimEvent(id, c.ws)) return "";
    S.set("events/" + id, { id, kind: "social", casual: true, name: r.pkgName, pubTitle: r.pkgName, date: r.date || "", startTime: HMOK(r.time) ? r.time : pkg.time === "daytime" ? "12:00" : "19:00",
      city: A.city || city, hood: A.area || "", tz: eventTz({ city: A.city || city, hood: st.area }) || "", headcount: +r.headcount || 0, autoRemind: true, approvalRequired: false, published: true, discoverable: false, unlisted: true, lastVis: "link",
      forCompany: company, hostName: company, why: `${company} is hosting ${r.pkgName} with ${h.name || "a local host"}, for about ${r.headcount || "a small group of"} people.`, bookingId: r.id, campaignId: c.id, createdAt: Date.now() });
    c.guestEvents = { ...(c.guestEvents || {}), [r.id]: id }; return id; }
  const HMOK = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ""));
  const tzShort = (tz, date) => { if (!tz) return ""; try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date((ISO.test(date || "") ? date : isoDay()) + "T12:00:00Z")).find((p) => p.type === "timeZoneName")?.value || ""; } catch { return ""; } };
  /** Campaign guests into People (with their consent) and onto the event's plan. */
  function toPlan(c, eventId, guests) { const P = P0(), I = I0(); if (!P || !I || !eventId) return 0; const rows = guests.filter((g) => g.email).map((g) => ({ email: g.email, name: g.name, company: g.company, title: g.title, optin: g.consent?.share ? "in" : "", tags: [campTag(c)] }));
    if (!rows.length) return 0; try { P.importRows(c.ws, rows, { source: "Campaign: " + clean(c.title, 40) }); const ids = rows.map((x) => idOfKey(x.email)); return I.add(c.ws, eventId, { ids }).added || 0; } catch (e) { console.warn("[campaigns] plan", e.message); return 0; } }
  const idOfKey = (email) => personId(keyFor(email));
  // a People tag that fits (30 characters), cut at a word
  const campTag = (c) => { const t = clean(c.title, 200); return t.length <= 30 ? t : t.slice(0, 30).replace(/\s+\S*$/, "").trim() || t.slice(0, 30); };
  /** The campaign's own record (sent, replied through its link, checked in by the team) onto the event's plan and
   * replies, so the status board, the seat count and reminders see what the campaign already knows. A guest's own
   * reply on the invite page is never overwritten. */
  function mirror(c, reqId) { const eid = c.guestEvents?.[reqId]; if (!eid) return; const S = scopeStore(store, c.ws), plDoc = S.get("invplans/" + eid)?.data; if (!plDoc) return;
    const R = new Map(S.list("rsvps").filter((d) => d.data?.eventId === eid && d.data?.email).map((d) => [lc(d.data.email), d])); let planChanged = false;
    for (const g of (c.guests || []).filter((x) => x.event === reqId && x.email)) { const pid = idOfKey(g.email), e = plDoc.people?.[pid];
      if (e && !e.invitedAt && ["invited", "yes", "no", "waitlist"].includes(g.status)) { e.invitedAt = g.invitedAt || Date.now(); e.ch = e.ch || "campaign"; planChanged = true; }
      const want = g.status === "yes" || g.checkedIn ? "going" : g.status === "no" ? "no" : "", d = R.get(g.email);
      if (!want) continue;
      if (!d) S.add("rsvps", { eventId: eid, name: g.name, email: g.email, response: want, via: "campaign", code: "C" + rid(4).toUpperCase(), createdAt: g.repliedAt || Date.now(), ...(g.checkedIn ? { checkedInAt: g.checkedAt || Date.now() } : {}) });
      else if (d.data.via === "campaign" && (d.data.response !== want || (!!g.checkedIn !== !!d.data.checkedInAt))) { const nx = { ...d.data, response: want }; if (g.checkedIn) nx.checkedInAt = d.data.checkedInAt || g.checkedAt || Date.now(); else delete nx.checkedInAt; S.set("rsvps/" + d.id, nx); }
      else if (g.checkedIn && !d.data.checkedInAt) S.set("rsvps/" + d.id, { ...d.data, checkedInAt: g.checkedAt || Date.now() }); }
    if (planChanged) S.set("invplans/" + eid, { ...plDoc, updatedAt: Date.now() }); }
  /** Replies, the waitlist and check-ins on the event's own page, read back onto the campaign's guests. */
  function syncBack(c) { let changed = false; const S = scopeStore(store, c.ws);
    for (const [reqId, eid] of Object.entries(c.guestEvents || {})) { const R = S.list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === eid && r.email), by = new Map(R.map((r) => [lc(r.email), r]));
      const pl = S.get("invplans/" + eid)?.data?.people || {};
      for (const g of (c.guests || []).filter((x) => x.event === reqId && x.email)) { const r = by.get(g.email), st = statusFromRsvp(r);
        if (st && st !== g.status && !(g.status === "yes" && st === "asked")) { g.status = st; g.repliedAt = g.repliedAt || r.createdAt || Date.now(); changed = true; }
        if (r?.checkedInAt && !g.checkedIn) { g.checkedIn = true; g.checkedAt = r.checkedInAt; changed = true; }
        if (!st && g.status === "added" && pl[idOfKey(g.email)]?.invitedAt) { g.status = "invited"; g.invitedAt = pl[idOfKey(g.email)].invitedAt; changed = true; } } }
    if (changed) cSet(c); return changed; }
  app.post("/api/campaigns/:id/events/:rid/plan", small, (req, res) => { const L = load(req, res, "guests"); if (!L) return; const r = reqGet(req.params.rid);
    if (!r || !(L.c.bookings || []).includes(r.id)) return bad(res, "That booking isn't on this campaign.", 404, "not_found");
    const eid = guestEvent(L.c, r, { make: true }); if (!eid) return bad(res, "Once the host accepts, this event gets its own guest list and invite page.", 409, "not_yet");
    const added = toPlan(L.c, eid, (L.c.guests || []).filter((g) => g.event === r.id && g.status !== "asked")); try { mirror(L.c, r.id); } catch (e) { console.warn("[campaigns] mirror", e.message); } cSet(L.c);
    res.json({ ok: true, eventId: eid, added, board: `/contacts/event/${eid}`, invite: `/e/${eid}`, campaign: full(L.c, L.role) }); });
  // nudge the people who were invited and haven't replied (the plan's own reminder: one a day, two per person)
  app.post("/api/campaigns/:id/events/:rid/remind", small, async (req, res) => { const L = load(req, res, "guests"); if (!L) return; const eid = L.c.guestEvents?.[String(req.params.rid)];
    if (!eid || !I0()) return bad(res, "Open this event's guest list first.", 409, "not_yet"); const out = await I0().remind(L.c.ws, eid, { origin: publicOrigin(req) }); if (out.error) return bad(res, out.error, out.status || 400);
    res.json({ ok: true, ...out }); });
  app.post("/api/campaigns/:id/ros", small, (req, res) => { const L = load(req, res, "plan"); if (!L) return; const ev = clean(req.body?.event, 24); if (!(L.c.bookings || []).includes(ev)) return bad(res, "That booking isn't on this campaign.", 404, "not_found");
    L.c.ros = { ...(L.c.ros || {}), [ev]: cleanRunOfShow(req.body?.items) }; cSet(L.c); res.json({ ok: true, campaign: full(L.c, L.role) }); });

  // ---- invite: guests per event, CSV in, invites out ----
  const addGuests = (c, list, source, event) => { const have = new Set((c.guests || []).filter((g) => g.email).map((g) => g.event + "|" + g.email)); let added = 0, skipped = 0; const fresh = [];
    for (const raw of list) { const g = cleanGuest({ ...raw, event: raw.event || event || "" }, { source }); if (!g.name && !g.email) { skipped++; continue; } if (g.event && !(c.bookings || []).includes(g.event)) g.event = "";
      if (g.email && have.has(g.event + "|" + g.email)) { skipped++; continue; } if ((c.guests || []).length >= 3000) { skipped++; continue; } have.add(g.event + "|" + g.email); c.guests = [...(c.guests || []), g]; added++; fresh.push(g); }
    for (const [reqId, eid] of Object.entries(c.guestEvents || {})) toPlan(c, eid, fresh.filter((g) => g.event === reqId));
    return { added, skipped }; };
  app.post("/api/campaigns/:id/guests", small, (req, res) => { const L = load(req, res, "guests"); if (!L) return; const b = req.body || {};
    const r = addGuests(L.c, Array.isArray(b.guests) ? b.guests.slice(0, 500) : [b], "manual", clean(b.event, 24)); cSet(L.c); res.json({ ...r, campaign: full(L.c, L.role) }); });
  app.post("/api/campaigns/:id/guests/import", small, (req, res) => { const L = load(req, res, "guests"); if (!L) return; const rows = parseCsv(String(req.body?.csv || "").slice(0, 400000));
    if (!rows.length) return bad(res, "That file has no rows we can read. Use columns like name, email, company, title, consent.");
    const r = addGuests(L.c, rows, "csv", clean(req.body?.event, 24)); cSet(L.c); res.json({ ...r, campaign: full(L.c, L.role) }); });
  app.patch("/api/campaigns/:id/guests/:gid", small, (req, res) => { const b = req.body || {}, what = Object.keys(b).every((k) => k === "checkedIn") ? "checkin" : "guests"; const L = load(req, res, what); if (!L) return;
    const g = (L.c.guests || []).find((x) => x.id === req.params.gid); if (!g) return bad(res, "Not found.", 404, "not_found");
    if (b.checkedIn != null) { g.checkedIn = !!b.checkedIn; g.checkedAt = g.checkedIn ? Date.now() : 0; if (g.checkedIn && g.status !== "yes") g.status = "yes"; }
    if (b.followUp && ["none", "sent", "meeting"].includes(b.followUp)) g.followUp = b.followUp;
    if (b.event != null) g.event = (L.c.bookings || []).includes(b.event) ? b.event : "";
    if (b.status && ["added", "invited", "yes", "no"].includes(b.status)) { g.status = b.status; if (b.status === "invited" && !g.invitedAt) g.invitedAt = Date.now(); }
    try { if (g.event) mirror(L.c, g.event); } catch {} cSet(L.c); res.json({ guest: guestView(g), campaign: full(L.c, L.role) }); });
  app.delete("/api/campaigns/:id/guests/:gid", (req, res) => { const L = load(req, res, "guests"); if (!L) return; L.c.guests = (L.c.guests || []).filter((x) => x.id !== req.params.gid); cSet(L.c); res.json({ campaign: full(L.c, L.role) }); });
  app.post("/api/campaigns/:id/invites", small, async (req, res) => { const L = load(req, res, "guests"); if (!L) return; if (limited("ci:" + L.c.id, 30)) return bad(res, "That's a lot of sends. Try again in an hour.", 429, "rate_limited");
    const ev = clean(req.body?.event, 24), base = publicOrigin(req), company = L.u.W.company || "Our team";
    let to = (L.c.guests || []).filter((g) => (!ev || g.event === ev) && g.event && g.status === "added"), planned = 0; const held = [];
    to = to.filter((g) => { let why = ""; try { why = X.inviteHold?.(L.c, g) || ""; } catch {} if (why) held.push({ id: g.id, name: first(g.name), why }); return !why; }); // account owners approve, competitors stay out (server/brandpanel2.js)
    // review 16: guests who agreed to hear from the brand get the event's own invite through its plan (People, waves,
    // reminders, add to calendar); everyone else still gets the campaign's reply link, which asks for that consent
    for (const reqId of [...new Set(to.map((g) => g.event))]) { const eid = guestEvent(L.c, reqGet(reqId), { make: true }); if (!eid || !I0()) continue; const mine = to.filter((g) => g.event === reqId && g.consent?.share && g.email);
      if (!mine.length) continue; toPlan(L.c, eid, mine); const out = await I0().send(L.c.ws, eid, { ids: mine.map((g) => idOfKey(g.email)), origin: base }).catch(() => ({}));
      const pl = scopeStore(store, L.c.ws).get("invplans/" + eid)?.data?.people || {}; for (const g of mine) if (pl[idOfKey(g.email)]?.invitedAt) { g.status = "invited"; g.invitedAt = pl[idOfKey(g.email)].invitedAt; planned++; } }
    to = to.filter((g) => g.status === "added");
    const cfg = emailConfig(L.c.ws, false) || emailConfig(DEFAULT_WS, true); let sent = 0; const links = [];
    for (const g of to) { const R = reqGet(g.event), link = `${base}/cg/${L.c.id}/r/${g.token}`; links.push({ id: g.id, name: first(g.name), link });
      if (cfg && g.email) { const when = R?.date ? new Date(R.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "soon";
        try { const out = await sendEmail(cfg, { to: g.email, subject: `${company} would love you at ${R?.pkgName || "a small event"}`, text: `Hi ${first(g.name) || "there"},\n\n${company} is hosting ${R?.pkgName || "a small event"} with ${R ? hostName(R) : "a local host"} on ${when}, for about ${R?.headcount || "a small group of"} people. We'd love you there.\n\n${(() => { const F = L.c.inviteFrom?.[g.event] || L.c.inviteFrom?.all; return F?.name ? `${F.note ? F.note + "\n\n" : ""}${F.name}${F.title ? ", " + F.title : ""}, ${company}\n\n` : ""; })()}I'm in (one tap): ${link}?r=yes\nCan't go: ${link}?r=no\n\nYou choose whether to share your details with ${company}.`, fromName: (L.c.inviteFrom?.[g.event] || L.c.inviteFrom?.all)?.name ? `${(L.c.inviteFrom?.[g.event] || L.c.inviteFrom?.all).name} at ${company}` : company, list: "guest" }); if (out?.ok !== false) sent++; } catch {} }
      g.status = "invited"; g.invitedAt = Date.now(); }
    try { for (const k of new Set(to.map((g) => g.event))) mirror(L.c, k); } catch {} cSet(L.c); res.json({ invited: to.length + planned, emailed: sent + planned, viaPlan: planned, links, held, campaign: full(L.c, L.role) }); });

  // ---- measure ----
  app.get("/api/campaigns/:id/export.csv", (req, res) => { const L = load(req, res, "export"); if (!L) return; if (!L.c.firstListAt && (L.c.guests || []).some((g) => g.checkedIn && g.consent?.share)) { L.c.firstListAt = Date.now(); cSet(L.c); }
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="${(L.c.title || "campaign").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40)}-guests.csv"`).set("Cache-Control", "private, no-store").send(exportCsv(L.c, eventsMap(L.c))); });
  app.post("/api/campaigns/:id/report-link", small, (req, res) => { const L = load(req, res, "share"); if (!L) return; if (req.body?.off) delete L.c.reportKey; else L.c.reportKey ||= rid(10); cSet(L.c); res.json({ url: L.c.reportKey ? `/teams/campaigns/${L.c.id}/report?k=${L.c.reportKey}` : "" }); });
  app.get("/teams/campaigns/:id/report", (req, res) => { const c = cGet(req.params.id); let ok = false;
    if (c) { const u = currentUser(req), W = u ? getWorkspace(u.ws) : null; if (u && campaignRole(c, { email: u.email, ws: u.ws, wsOwner: !!u.owner || lc(W?.ownerEmail) === lc(u.email) })) ok = true; else if (c.reportKey && req.query.k && safeEq(String(req.query.k), c.reportKey)) ok = true; }
    if (!ok) return res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:sans-serif;padding:24px">This report is private. Ask the team for the link.</p>`);
    const W = getWorkspace(c.ws); res.set("Cache-Control", "private, no-store").set("X-Robots-Tag", "noindex").type("html").send(reportHtml(c, rollup(c, reqsOf(c)), { company: W?.company || "", hostOf: (id) => { const r = reqGet(id); return r ? hostName(r) : ""; } })); });

  // ---- the brand's results across every campaign (Insights, Your results) and the Home dashboard ----
  function results(ws) { const L = cList(ws), sum = { invited: 0, yes: 0, attended: 0, replied: 0, followUps: 0, meetings: 0, costCents: 0, againYes: 0, againAnswered: 0, events: 0 }, said = [];
    for (const c of L) { const R = rollup(c, reqsOf(c)); sum.invited += R.totals.invited; sum.yes += R.totals.yes; sum.attended += R.totals.attended; sum.replied += R.totals.replied; sum.followUps += R.totals.followUps; sum.meetings += R.totals.meetings; sum.costCents += R.budget.committedCents; sum.events += R.totals.events;
      for (const g of c.guests || []) { if (g.checkedIn && g.again != null) { sum.againAnswered++; if (g.again) sum.againYes++; } if (g.checkedIn) said.push(g.said); } }
    return { campaigns: L.length, events: sum.events, invited: sum.invited, replied: sum.replied, yes: sum.yes, attended: sum.attended, showPct: pct(sum.attended, sum.yes), replyPct: pct(sum.replied, sum.invited), followUps: sum.followUps, meetings: sum.meetings,
      againPct: sum.againAnswered >= K.people ? pct(sum.againYes, sum.againAnswered) : null, againAnswered: sum.againAnswered, costCents: sum.costCents, costPerAttendeeCents: sum.attended ? Math.round(sum.costCents / sum.attended) : null, themes: themesOf(said), thresholds: K }; }
  app.get("/api/teams/home", (req, res) => { const u = brandMe(req, res); if (!u) return; const today = isoDay(), L = cList(u.ws);
    const active = L.filter((c) => c.status !== "done").map((c) => brief(c, roleIn(u, c))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
    const byReq = new Map(); for (const c of L) for (const id of c.bookings || []) byReq.set(id, c);
    const reqs = store.listPrefix("system", "bbreq-").map((d) => d.data).filter((r) => r?.kind === "bbreq" && r.brandWs === u.ws);
    const upcoming = reqs.filter((r) => r.date && r.date >= today && !["cancelled", "declined", "question"].includes(statusOf(r))).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6).map((r) => { const c = byReq.get(r.id), G = (c?.guests || []).filter((g) => g.event === r.id);
      return { ...reqCard(r), campaign: c ? { id: c.id, title: c.title } : null, yes: G.filter((g) => g.status === "yes").length, invited: G.filter((g) => g.status !== "added" && g.status !== "asked").length }; });
    const waiting = reqs.filter((r) => ["approval", "countered", "accepted"].includes(statusOf(r))).map((r) => ({ id: r.id, name: r.pkgName, status: statusOf(r), url: `/teams/bookings/${r.id}` })).slice(0, 5);
    const money0 = { budgetCents: 0, committedCents: 0, spentCents: 0, remainingCents: 0 }; for (const c of L.filter((c) => c.status !== "done")) { const B = budgetOf(c, reqsOf(c)); money0.budgetCents += B.budgetCents; money0.committedCents += B.committedCents; money0.spentCents += B.spentCents; money0.remainingCents += B.remainingCents; }
    let resonates = null; try { const F = insights?.fitFor({}, u.ws); if (F) resonates = { audience: F.audience, city: F.city, kinds: F.kinds.filter((k) => !k.hidden).slice(0, 3), hosts: F.hosts.slice(0, 3) }; } catch {}
    res.set("Cache-Control", "private, no-store").json({ company: u.W.company || "", name: first(u.name), active, upcoming, waiting, money: money0, resonates, results: results(u.ws), campaigns: L.length }); });

  // ---- guests: the public sign-up page and each guest's own reply link ----
  const pubEvent = (r) => ({ id: r.id, name: r.pkgName, host: hostName(r), date: r.date || "", area: areaOf(r), headcount: r.headcount, status: statusOf(r) });
  app.get("/api/cg/:id", (req, res) => { const c = cGet(req.params.id); if (!c || c.joinOpen === false) return bad(res, "This sign-up page is closed.", 404, "not_found"); const W = getWorkspace(c.ws);
    res.set("Cache-Control", "private, no-store").json({ company: W?.company || "", title: c.title, goal: "", events: reqsOf(c).filter((r) => ["requested", "accepted", "booked", "countered", "approval"].includes(statusOf(r)) && (!r.date || r.date >= isoDay())).map(pubEvent) }); });
  app.post("/api/cg/:id/join", small, (req, res) => { if (limited("cj:" + req.ip, 30)) return bad(res, "Too many sign-ups from here. Try again later.", 429, "rate_limited"); const c = cGet(req.params.id); if (!c || c.joinOpen === false) return bad(res, "This sign-up page is closed.", 404, "not_found");
    const b = req.body || {}, email = lc(clean(b.email, 160)); if (!clean(b.name, 100)) return bad(res, "Add your name."); if (!EMAIL_RE.test(email)) return bad(res, "That email doesn't look right.");
    if ((c.guests || []).some((g) => g.email === email && (!b.event || g.event === b.event))) return res.json({ ok: true, already: true });
    const g = cleanGuest({ name: b.name, email, company: b.company, title: b.title, event: b.event, consent: b.consent === true }, { source: "form" }); g.status = "asked"; if (g.event && !(c.bookings || []).includes(g.event)) g.event = "";
    c.guests = [...(c.guests || []), g].slice(0, 3000); cSet(c); res.json({ ok: true }); });
  const byToken = (req) => { const c = cGet(req.params.id); if (!c) return {}; const t = String(req.params.token || ""); const g = (c.guests || []).find((x) => x.token && safeEq(x.token, t)); return { c, g }; };
  app.get("/api/cg/:id/r/:token", (req, res) => { const { c, g } = byToken(req); if (!c || !g) return bad(res, "This link doesn't work anymore. Ask whoever invited you for a new one.", 404, "not_found"); const r = reqGet(g.event), W = getWorkspace(c.ws);
    res.set("Cache-Control", "private, no-store").json({ company: W?.company || "", name: first(g.name), event: r ? pubEvent(r) : null, status: g.status, consent: !!g.consent?.share, checkedIn: g.checkedIn, again: g.again, said: g.said ? true : false, quoteOk: g.quoteOk, past: !!(r?.date && r.date < isoDay()), from: (() => { const F = c.inviteFrom?.[g.event] || c.inviteFrom?.all; return F?.name ? { name: F.name, title: F.title || "", note: F.note || "" } : null; })(),
      survey: r && r.date && r.date < isoDay() && g.checkedIn ? X.surveyLinkFor?.(r, { side: "brand", gid: g.id, cid: c.id, first: first(g.name), email: g.email }) || "" : "", prefs: X.cgPrefs?.(g) || null }); });
  app.post("/api/cg/:id/r/:token", small, (req, res) => { if (limited("cr:" + req.ip, 120)) return bad(res, "Slow down.", 429, "rate_limited"); const { c, g } = byToken(req); if (!c || !g) return bad(res, "This link doesn't work anymore.", 404, "not_found"); const b = req.body || {};
    if (b.reply === "yes" || b.reply === "no") { g.status = b.reply; g.repliedAt = Date.now(); }
    if (b.consent != null) g.consent = b.consent === true ? { share: true, at: Date.now(), via: "rsvp" } : { share: false, at: 0, via: "" };
    if (b.again != null) g.again = b.again === true ? true : b.again === false ? false : null;
    if (b.said != null) g.said = clean(b.said, 600);
    if (b.quoteOk != null) g.quoteOk = b.quoteOk === true;
    try { X.onCgReply?.(c, g, b); } catch {} // the optional "what are you here for" question (server/brandpanel2.js)
    try { if (g.event) mirror(c, g.event); } catch {} cSet(c); res.json({ ok: true, status: g.status, consent: !!g.consent?.share }); });

  return { results, rollupOf: (id) => { const c = cGet(id); return c ? rollup(c, reqsOf(c)) : null; } };
}

// ---------------------------------------------------------------------------------------------------------------
// The one-page report for leadership: totals, KPIs against goals, each event, what people said (themes and quotes
// they agreed to), and the money. No guest names or emails, ever.
export function reportHtml(c, R, { company = "", hostOf = () => "" } = {}) {
  const T = R.totals, B = R.budget, money = (c) => "$" + Math.round((+c || 0) / 100).toLocaleString("en-US"), d = (x) => (x ? new Date(x + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
  const n = (v, unit = "") => (v == null ? "<span class=\"rp-na\">Not yet</span>" : esc(String(v)) + unit), plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const tile = (label, v, sub = "") => `<div class="rp-tile"><span>${esc(label)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  // the three numbers leadership asks about first, set large like a magazine's pull numbers
  const pull = (v, label, sub) => `<div class="rp-pn"><b>${v}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  const kpi = R.kpis.map((k) => { const met = k.have != null && k.goal && (k.pct || 0) >= 100; return `<li${met ? ' class="met"' : ""}><span>${esc(k.label)}</span><span class="rp-bar" aria-hidden="true"><i style="width:${Math.min(100, k.pct || 0)}%"></i></span><b>${k.have == null ? "Not yet" : esc(String(k.have)) + (k.unit || "")} of ${esc(String(k.goal))}${k.unit || ""}</b>${met ? `<span class="rp-met">Goal met</span>` : ""}</li>`; }).join("");
  const rows = R.events.map((e) => `<tr><td><b>${esc(e.name)}</b><br><small>${esc(hostOf(e.id))}${e.date ? " · " + esc(d(e.date)) : ""}</small></td><td>${e.invited}</td><td>${e.yes}</td><td>${e.status === "done" ? e.attended : `<small>${e.status === "booked" ? "Coming up" : ""}</small>`}</td><td>${e.showPct == null ? "" : e.showPct + "%"}</td><td>${e.againPct == null ? `<small>${e.againAnswered ? "Under 10 answers" : ""}</small>` : e.againPct + "%"}</td><td>${e.meetings}</td><td>${e.costPerAttendeeCents == null ? "" : esc(money(e.costPerAttendeeCents))}</td></tr>`).join("");
  const themes = T.themes.shown ? (T.themes.themes.length ? `<ul class="rp-themes">${T.themes.themes.map((t) => `<li><span>${esc(t.label)}</span><b>${t.sharePct}%</b></li>`).join("")}</ul>` : "<p>No one theme stood out yet.</p>") : `<p class="rp-na">Themes show once 10 or more guests have said something.</p>`;
  // one quote leads, set large; the rest sit under the themes. Only from guests who said yes to being quoted.
  const [lead, ...rest] = T.quotes;
  const leadQuote = lead ? `<figure class="rp-quote"><blockquote>${esc(lead.text)}</blockquote><figcaption>${esc(lead.name)}, a guest, who said we could quote them by first name</figcaption></figure>` : "";
  const quotes = rest.map((q) => `<blockquote>${esc(q.text)}<cite>${esc(q.name)}, who said we could quote them by first name</cite></blockquote>`).join("");
  // the standfirst: one plain sentence from the totals, nothing added
  const stand = T.attended ? `${plural(T.attended, "guest", "guests")} came to ${plural(T.eventsDone, "event", "events")}${T.againPct != null ? `, and ${T.againPct}% would go again` : ""}.${T.meetings ? ` ${plural(T.meetings, "pipeline meeting", "pipeline meetings")} so far.` : ""}`
    : T.yes ? `${plural(T.yes, "guest is", "guests are")} in for ${plural(T.events, "event", "events")} so far.` : "";
  const prepared = d(new Date().toISOString().slice(0, 10)), sec = (k, title) => `<h2><span class="rp-no">${k}</span>${esc(title)}</h2>`;
  let no = 0; const nx = () => String(++no).padStart(2, "0");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(c.title)} · Campaign report</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/teams-intel.css"></head>
<body class="rp"><main class="rp-page">
<div class="rp-mast"><span class="rp-mname">Field report</span><span class="rp-mdate">${esc(prepared)}</span></div>
<header class="rp-head"><p class="rp-kicker">${esc(company)} · Campaign report${(c.cities || []).length ? " · " + esc(c.cities.join(", ")) : ""}</p><h1>${esc(c.title)}</h1>${c.goal ? `<p class="rp-goal">${esc(c.goal)}</p>` : ""}${stand ? `<p class="rp-stand">${esc(stand)}</p>` : ""}<p class="rp-meta">${c.start || c.end ? `${esc(d(c.start))}${c.end ? " to " + esc(d(c.end)) : ""}` : ""}</p>
<button class="rp-print" onclick="window.print()">Print or save as PDF</button></header>
<section class="rp-pulls" aria-label="The numbers">${pull(String(T.attended), "came", T.showPct == null ? "" : `${T.showPct}% of the people who were in`)}${pull(n(T.againPct, "%"), "would go again", T.againPct == null ? "Shows at 10+ answers" : `${T.againAnswered} answered`)}${pull(String(T.meetings), T.meetings === 1 ? "pipeline meeting" : "pipeline meetings", `${T.followUps} followed up`)}</section>
<section class="rp-tiles">${tile("Events", String(T.events), T.eventsDone ? `${T.eventsDone} done` : "")}${tile("Invited", String(T.invited))}${tile("Cost per guest", T.costPerAttendeeCents == null ? "<span class=\"rp-na\">Not yet</span>" : esc(money(T.costPerAttendeeCents)))}</section>
${kpi ? `<section class="rp-sec">${sec(nx(), "Goals")}<ul class="rp-kpis">${kpi}</ul></section>` : ""}
${leadQuote}
<section class="rp-sec">${sec(nx(), "Each event")}<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Event</th><th>Invited</th><th>Yes</th><th>Came</th><th>Show rate</th><th>Would go again</th><th>Meetings</th><th>Cost per guest</th></tr></thead><tbody>${rows || `<tr><td colspan="8">No events yet.</td></tr>`}</tbody></table></div></section>
<section class="rp-sec rp-two"><div>${sec(nx(), "What guests said")}${themes}${quotes}</div><div>${sec(nx(), "Money")}<ul class="rp-money"><li><span>Budget</span><b>${esc(money(B.budgetCents))}</b></li><li><span>Committed</span><b>${esc(money(B.committedCents))}</b></li><li><span>Spent so far</span><b>${esc(money(B.spentCents))}</b></li><li><span>Remaining</span><b>${esc(money(B.remainingCents))}</b></li></ul></div></section>
<footer class="rp-foot"><p>From Pottery Lab. Feedback is shown in totals only: would go again at 10+ answers, themes when 3+ people said the same, quotes only from people who said yes to being quoted, by first name. No other guest names and no emails are in this report. Prepared ${esc(prepared)}.</p></footer>
</main></body></html>`;
}
