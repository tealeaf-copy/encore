// Booking experience hosts for teams ("brandbook"): the brand side and the host side of a team booking, designed so a
// high-cost choice feels safe. Everything here is new and lives in its own docs, next to the older request flow
// (server/market.js, /hosts/book, /teams) without changing it.
//
// Brand side: Discover by mood (/teams/discover), the experience page (/teams/x/<handle>/<package>), shortlists a team
// votes and comments on (/teams/list/<id>), compare (/teams/list/<id>/compare), a 3-step request to book
// (/teams/book/<handle>/<package>), the team's bookings with approvals and invoices (/teams/bookings).
// Host side: "Bookable for teams" setup, the request inbox (accept, counter, decline), verification, insurance,
// payouts and reviews of brands (/host/teams).
//
// Docs:
//   ws/<host>/teambook/setup ....... the host's packages, pricing, capacity, lead time, availability, policy, area
//   ws/<host>/teambook/verify ...... phone check, ID check (manual admin review for now), insurance certificate
//   ws/<brand>/teambook/rules ...... the brand's approval rule (off, over an amount, always) and who approves
//   system/bbreq-<id> .............. one booking request: both sides, price snapshot, deposit, thread, reviews, invoice
//   system/bbsl-<id> ............... a shortlist: items, votes, comments, two share links (vote, view)
//
// Privacy rules kept here and tested (test/brandbook.test.js):
//   - contact details (email, phone, exact address) are shared only once a booking is booked (deposit paid);
//     messages before that have emails and numbers hidden (scrubContact, the chat rule)
//   - the map shows an approximate area (a neighbourhood centre, rounded), never an address
//   - reviews are double blind: neither side sees the other's until both are in or 14 days have passed; the host's
//     review of a brand is never public
// Money is integer cents. Payments go through a provider: Stripe in test mode when STRIPE_SECRET_KEY is a test key,
// otherwise a fake that marks deposits held (development and tests). Never in the App Store app (web only).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scopeStore, getWorkspace, getDbUser, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { scrubContact } from "./chat.js";
import { isAdmin } from "./metrics.js";
import { isNativeReq } from "./fanclub.js";
import { smsConfig, sendSms } from "./sms.js";
import { isExampleEmail } from "./recognition.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const cleanText = (v, n = 1500) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const DAY = 864e5;
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const BLOB = /^\/_blob\/[A-Za-z0-9]{20}$/;

// ---------------------------------------------------------------------------------------------------------------
// Moods: Discover browses by feeling and occasion. "Under $50 a person" is a price, worked out, never self-tagged.
export const MOODS = [
  { id: "bonding", label: "Team bonding", line: "Do something together, side by side." },
  { id: "client", label: "Client dinners", line: "A table that makes people feel looked after." },
  { id: "handson", label: "Hands-on workshops", line: "Everyone leaves with something they made." },
  { id: "calm", label: "Calm offsites", line: "Slow mornings, quiet rooms, good food." },
  { id: "celebrate", label: "Celebrations", line: "Launches, wins, birthdays, a year done." },
  { id: "remote", label: "Remote-friendly", line: "Kits in the mail, a host on the call." },
  { id: "under50", label: "Under $50 a person", line: "Good times that fit a small budget." },
];
const MOOD_IDS = MOODS.map((m) => m.id).filter((m) => m !== "under50");
export const DIETS = ["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free", "halal", "kosher"];
export const ACCESS = ["step-free", "accessible restroom", "seating for everyone", "quiet space", "ASL on request"];

// ---------------------------------------------------------------------------------------------------------------
// Cancellation: three policies, each in plain words, and the refund the words promise.
export const POLICIES = {
  flexible: { label: "Flexible", full: 7, half: 0 },
  standard: { label: "Standard", full: 14, half: 7 },
  firm: { label: "Firm", full: 30, half: 14 },
};
const money0 = (c) => "$" + Math.round((+c || 0) / 100).toLocaleString("en-US");
export const money = (c) => { const v = Math.round(+c || 0); return "$" + (v % 100 ? (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (v / 100).toLocaleString("en-US")); };

/** The cancellation terms a brand reads on the experience page and at checkout. */
export function cancellationTerms(policy = "standard", depositPct = 25) {
  const P = POLICIES[policy] || POLICIES.standard, key = POLICIES[policy] ? policy : "standard";
  const lines = [`Cancel ${P.full} or more days before: everything back, deposit included.`];
  if (P.half) lines.push(`Cancel ${P.half} to ${P.full - 1} days before: half of what you paid back.`);
  lines.push(`Cancel under ${P.half || P.full} days before: the ${depositPct}% deposit stays with the host, anything more comes back.`);
  lines.push("If the host cancels, you get everything back, and we help you find another host.");
  return { policy: key, label: P.label, depositPct, short: `${P.label}: free to cancel up to ${P.full} days before`, lines,
    deposit: `A ${depositPct}% deposit holds the date. The rest is due 7 days before.` };
}

/** What comes back if the brand cancels `daysBefore` days ahead, having paid `paidCents` of which `depositCents` is the deposit. */
export function refundFor(policy, daysBefore, paidCents, depositCents) {
  const P = POLICIES[policy] || POLICIES.standard; paidCents = Math.max(0, Math.round(paidCents)); depositCents = Math.min(paidCents, Math.max(0, Math.round(depositCents)));
  if (daysBefore >= P.full) return paidCents;
  if (P.half && daysBefore >= P.half) return Math.round(paidCents / 2);
  return paidCents - depositCents;
}

// ---------------------------------------------------------------------------------------------------------------
// The full price, always: the total for the group, with every line, before anyone pays.
export const FEE_BPS = () => int(process.env.ENCORE_TEAM_FEE_BPS || 0, 0, 3000); // Pottery Lab's booking fee, paid by the brand

/** priceFor(pkg, headcount) -> lines, total, deposit and the summary line ("$1,440 total for 12"). */
export function priceFor(pkg = {}, headcount = 0, { feeBps = FEE_BPS(), override = null } = {}) {
  const n = int(headcount, 0, 5000), pp = int(override?.perPersonCents ?? pkg.perPersonCents, 0, 1e8), min = int(pkg.minimumCents, 0, 1e9);
  const taxBps = int(pkg.taxBps, 0, 2500), depositPct = int(pkg.depositPct || 25, 10, 100);
  const lines = [], base = pp * n;
  lines.push({ k: "people", label: `${money(pp)} a person × ${n}`, cents: base });
  const topUp = min > base ? min - base : 0;
  if (topUp) lines.push({ k: "minimum", label: `Group minimum is ${money(min)}`, cents: topUp, note: "Small groups pay the minimum" });
  const subtotal = base + topUp;
  const fee = Math.round((subtotal * feeBps) / 10000);
  lines.push({ k: "fee", label: "Pottery Lab booking fee", cents: fee, note: fee ? "Shown before you pay, never added later" : "None" });
  const tax = Math.round((subtotal * taxBps) / 10000);
  lines.push({ k: "tax", label: "Sales tax", cents: tax, note: taxBps ? "" : "Included in the price" });
  const total = subtotal + fee + tax, deposit = Math.round((total * depositPct) / 100);
  const includes = (pkg.includes || []).slice(0, 4).map((s) => lc(s));
  const incl = includes.length ? `includes ${includes.length > 1 ? includes.slice(0, -1).join(", ") + " and " + includes.slice(-1) : includes[0]}` : "";
  return { headcount: n, perPersonCents: pp, minimumCents: min, subtotalCents: subtotal, feeCents: fee, taxCents: tax, totalCents: total, depositPct, depositCents: deposit, balanceCents: total - deposit,
    effectivePerPersonCents: n ? Math.round(total / n) : 0, lines, includes: incl,
    summary: n ? `${money0(total)} total for ${n}` : "", line: n ? `${money0(total)} total for ${n}${incl ? " · " + incl : ""}` : "" };
}

// ---------------------------------------------------------------------------------------------------------------
// The Trusted host badge: earned, never bought, with criteria anyone can read (/teams/trusted).
export const TRUSTED = { events: 10, rating: 4.8, minReviews: 3, respondHours: 24, responseRate: 0.9, noCancelDays: 90 };
export function trustedCheck(s = {}) {
  const checks = [
    { k: "events", label: `${TRUSTED.events}+ events hosted`, met: (s.events || 0) >= TRUSTED.events, have: `${s.events || 0} so far` },
    { k: "rating", label: `${TRUSTED.rating}+ average from ${TRUSTED.minReviews}+ team reviews`, met: (s.reviews || 0) >= TRUSTED.minReviews && (s.rating || 0) >= TRUSTED.rating, have: s.reviews ? `${(s.rating || 0).toFixed(1)} from ${s.reviews}` : "No team reviews yet" },
    { k: "responds", label: "Replies within a day", met: s.responseHours != null && s.responseHours <= TRUSTED.respondHours && (s.responseRate ?? 0) >= TRUSTED.responseRate, have: s.responseHours != null ? `About ${hoursText(s.responseHours)}, ${Math.round((s.responseRate || 0) * 100)}% of requests` : "No requests yet" },
    { k: "cancels", label: `No cancellations in ${TRUSTED.noCancelDays} days`, met: !(s.hostCancels90 > 0), have: s.hostCancels90 ? `${s.hostCancels90} in the last ${TRUSTED.noCancelDays} days` : "None" },
  ];
  return { trusted: checks.every((c) => c.met), checks };
}
export const hoursText = (h) => (h == null ? "" : h < 1 ? "an hour" : h < 1.5 ? "1 hour" : h < 24 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? "day" : "days"}`);

/** A 0-100 score that shapes ranking: reviews, replies, repeat bookings, photos, verification, track record. */
export function qualityScore(s = {}) {
  let q = 0;
  q += s.reviews ? Math.max(0, Math.min(30, ((s.rating || 0) - 3) * 15)) * Math.min(1, s.reviews / 3) : 8; // new hosts get a fair start
  q += s.responseHours == null ? 10 : s.responseHours <= 4 ? 20 : s.responseHours <= 24 ? 15 : s.responseHours <= 72 ? 6 : 0;
  q += Math.round(10 * (s.repeatRate || 0));
  q += Math.min(15, (s.goodPhotos || 0) * 5);
  q += (s.emailVerified ? 4 : 0) + (s.phoneVerified ? 4 : 0) + (s.idChecked ? 7 : 0);
  q += Math.min(10, s.events || 0);
  q -= (s.hostCancels90 || 0) * 15;
  return Math.max(0, Math.min(100, Math.round(q)));
}

/** Instant book: only Trusted hosts who opt in, on an open date, inside capacity and lead time, with no approval pending. */
export function instantEligible({ trusted, pkg = {}, date, headcount, today = isoDay(), approvalPending = false, open = true } = {}) {
  if (!trusted) return { ok: false, why: "Instant book is for Trusted hosts." };
  if (!pkg.instant) return { ok: false, why: "This host reviews each request." };
  if (approvalPending) return { ok: false, why: "Your team approves this first." };
  if (!ISO.test(String(date || ""))) return { ok: false, why: "Pick an exact date to book instantly." };
  const lead = (Date.parse(date + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / DAY;
  if (lead < (pkg.leadDays || 0)) return { ok: false, why: `Needs ${pkg.leadDays} days' notice.` };
  if (headcount < (pkg.minGuests || 1) || headcount > (pkg.maxGuests || 1e6)) return { ok: false, why: "That group size needs a word with the host." };
  if (!open) return { ok: false, why: "That date isn't open." };
  return { ok: true, why: "" };
}

// ---------------------------------------------------------------------------------------------------------------
// Availability: weekdays the host runs it, day or evening, dates they've closed, lead time and dates already booked.
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function availabilityFor(pkg = {}, month, { taken = new Set(), today = isoDay() } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
  const wd = Array.isArray(pkg.weekdays) && pkg.weekdays.length ? pkg.weekdays : [1, 2, 3, 4, 5], closed = new Set(pkg.closed || []);
  const earliest = isoDay(Date.parse(today + "T12:00:00Z") + (pkg.leadDays || 0) * DAY);
  for (let d = 1; d <= days; d++) { const date = `${month}-${String(d).padStart(2, "0")}`, w = new Date(date + "T12:00:00Z").getUTCDay();
    const state = date < today ? "past" : date < earliest ? "notice" : !wd.includes(w) || closed.has(date) ? "closed" : taken.has(date) ? "booked" : "open";
    out.push({ date, w, state }); }
  return { month, days: out, time: pkg.time || "evening", weekdays: wd.map((i) => WD[i]) };
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Any weekday evening in March" */
export function flexLabel(f = {}) {
  const m = /^\d{4}-(\d{2})$/.exec(String(f.month || "")); if (!m) return "";
  const days = f.days === "weekend" ? "weekend" : f.days === "any" ? "" : "weekday", time = f.time === "daytime" ? "daytime" : f.time === "any" ? "" : "evening";
  const what = [days, time].filter(Boolean).join(" ") || "day";
  return `Any ${what} in ${MONTHS[+m[1] - 1]}`;
}
export function fitsFlex(date, f = {}) { if (!ISO.test(date) || !/^\d{4}-\d{2}$/.test(String(f.month || "")) || !date.startsWith(f.month)) return false; const w = new Date(date + "T12:00:00Z").getUTCDay(); return f.days === "weekend" ? w === 0 || w === 6 : f.days === "any" ? true : w >= 1 && w <= 5; }

// ---------------------------------------------------------------------------------------------------------------
// The map: an approximate area only. A neighbourhood's centre, rounded to two decimals (about a kilometre), never
// the host's address or their own coordinates.
const AREAS = {
  "greenpoint": [40.7299, -73.9543, "Brooklyn"], "williamsburg": [40.7144, -73.9566, "Brooklyn"], "bushwick": [40.6943, -73.9213, "Brooklyn"], "park slope": [40.6710, -73.9814, "Brooklyn"],
  "fort greene": [40.6905, -73.9746, "Brooklyn"], "carroll gardens": [40.6795, -73.9991, "Brooklyn"], "dumbo": [40.7033, -73.9881, "Brooklyn"], "prospect heights": [40.6775, -73.9692, "Brooklyn"],
  "bed-stuy": [40.6872, -73.9418, "Brooklyn"], "crown heights": [40.6694, -73.9422, "Brooklyn"], "red hook": [40.6734, -74.0083, "Brooklyn"], "cobble hill": [40.6862, -73.9962, "Brooklyn"],
  "west village": [40.7358, -74.0036, "Manhattan"], "east village": [40.7265, -73.9815, "Manhattan"], "lower east side": [40.7150, -73.9843, "Manhattan"], "chelsea": [40.7465, -74.0014, "Manhattan"],
  "soho": [40.7233, -74.0030, "Manhattan"], "tribeca": [40.7163, -74.0086, "Manhattan"], "harlem": [40.8116, -73.9465, "Manhattan"], "midtown": [40.7549, -73.9840, "Manhattan"],
  "astoria": [40.7644, -73.9235, "Queens"], "long island city": [40.7447, -73.9485, "Queens"], "flushing": [40.7675, -73.8331, "Queens"], "jackson heights": [40.7557, -73.8831, "Queens"],
  "mission": [37.7599, -122.4148, "San Francisco"], "hayes valley": [37.7759, -122.4245, "San Francisco"], "silver lake": [34.0869, -118.2702, "Los Angeles"], "logan square": [41.9235, -87.7083, "Chicago"],
};
const CITIES = { "new york": [40.7128, -74.006], "brooklyn": [40.6782, -73.9442], "manhattan": [40.7831, -73.9712], "queens": [40.7282, -73.7949], "san francisco": [37.7749, -122.4194], "los angeles": [34.0522, -118.2437], "chicago": [41.8781, -87.6298] };
export function approxArea(area = "", city = "") {
  const a = AREAS[lc(area)], c = CITIES[lc(city)] || CITIES[lc(a?.[2])];
  const at = a || c; if (!at) return { area: clean(area, 60) || clean(city, 60), city: clean(city, 60), lat: null, lng: null, radiusM: 0, approximate: true };
  const r2 = (x) => Math.round(x * 100) / 100;
  return { area: a ? titleCase(area) : clean(city, 60), city: clean(city, 60) || a?.[2] || "", lat: r2(at[0]), lng: r2(at[1]), radiusM: a ? 900 : 4000, approximate: true };
}
const titleCase = (s) => String(s || "").replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bSoho\b/, "SoHo").replace(/\bDumbo\b/, "DUMBO");
export const AREA_NAMES = Object.keys(AREAS).map(titleCase);

// ---------------------------------------------------------------------------------------------------------------
// Shortlists: who may do what. Members of the brand's workspace can add and remove; anyone with the vote link can
// vote and comment (with their name); anyone with the view link can read; nobody else sees it.
export function shortlistRole(sl, { email = "", ws = "", key = "" } = {}) {
  if (!sl) return null;
  if (email && lc(email) === lc(sl.ownerEmail)) return "owner";
  if (ws && ws !== DEFAULT_WS && ws === sl.ws) return "member";
  const k = String(key || "");
  if (k && sl.links?.vote && safeEq(k, sl.links.vote)) return "voter";
  if (k && sl.links?.view && safeEq(k, sl.links.view)) return "viewer";
  return null;
}
export const SL_CAN = { view: ["owner", "member", "voter", "viewer"], vote: ["owner", "member", "voter"], comment: ["owner", "member", "voter"], add: ["owner", "member"], share: ["owner", "member"], delete: ["owner"] };
export const slCan = (role, what) => !!role && (SL_CAN[what] || []).includes(role);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------------------------------------------------------------------------------------------------------------
// Requests: the life of one booking. Contact details are shared only once it's booked.
export const STATUS = { question: "A question for the host", approval: "Waiting on your team", requested: "Sent to the host", countered: "The host suggested a change", accepted: "Accepted, deposit due", booked: "Booked", declined: "Declined", cancelled: "Cancelled", done: "Done" };
export const HOST_STATUS = { question: "A question", requested: "New request", countered: "You suggested a change", accepted: "Accepted, deposit due", booked: "Booked", declined: "Declined", cancelled: "Cancelled", done: "Done" };
export const isBooked = (r) => ["booked", "done"].includes(r?.status);
export const statusOf = (r, today = isoDay()) => (r?.status === "booked" && r.date && r.date < today ? "done" : r?.status);

/** The other side's contact details, or null before the booking is booked. */
export function contactFor(r, side, people = {}) {
  if (!isBooked(r)) return null;
  return side === "brand" ? { name: people.hostName || "", email: people.hostEmail || "", phone: people.hostPhone || "", address: r.venue?.address || "" }
    : { name: r.contactName || "", email: r.brandEmail || "", phone: r.brandPhone || "", company: r.company || "" };
}

/** Double-blind reviews: what a viewer may read. side is "brand", "host" or "public". */
export const REVIEW_WINDOW_DAYS = 14;
export function reviewsFor(r, side, now = Date.now()) {
  const R = r?.reviews || {}, both = !!(R.brand && R.host), ended = r?.date && now - Date.parse(r.date + "T23:59:59Z") > REVIEW_WINDOW_DAYS * DAY, open = both || ended;
  const out = {};
  if (side === "brand") { if (R.brand) out.mine = R.brand; if (R.host && open) out.theirs = R.host; out.waiting = !!R.brand && !open; }
  else if (side === "host") { if (R.host) out.mine = R.host; if (R.brand && open) out.theirs = R.brand; out.waiting = !!R.host && !open; }
  else if (R.brand && open) out.public = { rating: R.brand.rating, text: R.brand.text, at: R.brand.at, company: r.listCompany ? r.company : "", role: R.brand.role || "" };
  return out;
}

/** Invoice numbers and lines for a booking. */
export function invoiceOf(r, { hostName = "", hostTaxId = "" } = {}) {
  const P = r.price || {}, paid = (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + p.cents, 0);
  return { number: "PL-" + String(r.createdAt ? new Date(r.createdAt).getUTCFullYear() : new Date().getUTCFullYear()) + "-" + String(r.id || "").slice(0, 6).toUpperCase(), issued: isoDay(r.bookedAt || Date.now()),
    seller: { name: hostName, taxId: hostTaxId }, buyer: { company: r.billing?.company || r.company || "", taxId: r.billing?.taxId || "", address: r.billing?.address || "", po: r.billing?.po || "", contact: r.contactName || "" },
    lines: (P.lines || []).filter((l) => l.cents || l.k === "people"), totalCents: P.totalCents || 0, paidCents: paid, dueCents: Math.max(0, (P.totalCents || 0) - paid),
    dueDate: r.date ? isoDay(Date.parse(r.date + "T12:00:00Z") - 7 * DAY) : "", what: r.pkgName || "", date: r.date || "", headcount: r.headcount || 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Payments: Stripe in test mode, or a fake. The provider holds a deposit, charges it on acceptance, releases it on a
// decline. Stripe Connect payouts to hosts aren't set up yet: hosts see a clear placeholder (/host/teams, Payouts).
export function payProvider(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || "");
  if (key && (/^sk_test_/.test(key) || env.ENCORE_STRIPE_LIVE === "1")) return { name: "stripe", test: /^sk_test_/.test(key), key };
  return { name: "fake", test: true };
}
async function stripeCheckout(P, { cents, name, successUrl, cancelUrl, ref }) {
  const body = new URLSearchParams({ mode: "payment", success_url: successUrl, cancel_url: cancelUrl, client_reference_id: ref, "payment_intent_data[capture_method]": "manual",
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(cents), "line_items[0][price_data][product_data][name]": name });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: "Bearer " + P.key, "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message || "Stripe said no."); return { url: j.url, session: j.id };
}

// ---------------------------------------------------------------------------------------------------------------
// Setup cleaning: a host's "Bookable for teams" settings.
export function cleanSetup(b = {}, cur = {}, { ownsPhoto = () => false } = {}) {
  const pk = (Array.isArray(b.packages) ? b.packages : cur.packages || []).slice(0, 8).map((p) => {
    const prev = (cur.packages || []).find((x) => x.id === p.id) || {};
    const minG = int(p.minGuests || 1, 1, 2000), maxG = Math.max(minG, int(p.maxGuests || minG, 1, 2000));
    return { id: /^[a-z0-9]{6,16}$/.test(String(p.id || "")) ? p.id : rid(5), name: clean(p.name, 80), story: cleanText(p.story, 1200), moods: (Array.isArray(p.moods) ? p.moods : []).filter((m) => MOOD_IDS.includes(m)).slice(0, 4),
      perPersonCents: int(p.perPersonCents, 0, 1e7), minimumCents: int(p.minimumCents, 0, 1e8), minGuests: minG, maxGuests: maxG, leadDays: int(p.leadDays ?? 14, 0, 365), length: clean(p.length, 40),
      includes: (Array.isArray(p.includes) ? p.includes : String(p.includes || "").split(",")).map((s) => clean(s, 40)).filter(Boolean).slice(0, 8),
      diets: (Array.isArray(p.diets) ? p.diets : []).filter((d) => DIETS.includes(d)), access: (Array.isArray(p.access) ? p.access : []).filter((d) => ACCESS.includes(d)),
      remote: !!p.remote, instant: !!p.instant, weekdays: (Array.isArray(p.weekdays) ? p.weekdays : [1, 2, 3, 4, 5]).map(Number).filter((d) => d >= 0 && d <= 6).slice(0, 7),
      time: ["evening", "daytime", "any"].includes(p.time) ? p.time : "evening", closed: (Array.isArray(p.closed) ? p.closed : []).filter((d) => ISO.test(d)).slice(0, 120),
      taxBps: int(p.taxBps, 0, 2500), depositPct: [25, 50, 100].includes(+p.depositPct) ? +p.depositPct : 25,
      photos: (Array.isArray(p.photos) ? p.photos : []).filter((x) => x && BLOB.test(String(x.url || "")) && (ownsPhoto(x.url) || (prev.photos || []).some((y) => y.url === x.url))).slice(0, 12).map((x) => ({ url: x.url, w: int(x.w, 0, 20000), h: int(x.h, 0, 20000), caption: clean(x.caption, 120) })),
      venue: ["host", "brand", "venue"].includes(p.venue) ? p.venue : "host", art: clean(p.art, 20), on: p.on !== false };
  }).filter((p) => p.name);
  return { on: b.on != null ? !!b.on : !!cur.on, packages: pk, policy: POLICIES[b.policy] ? b.policy : cur.policy || "standard", area: clean(b.area ?? cur.area, 60), city: clean(b.city ?? cur.city, 60),
    address: clean(b.address ?? cur.address, 200), story: cleanText(b.story ?? cur.story, 2000), since: int(b.since ?? cur.since, 0, new Date().getUTCFullYear()) || 0, taxId: clean(b.taxId ?? cur.taxId, 40),
    phone: clean(b.phone ?? cur.phone, 30), updatedAt: Date.now() };
}

/** A photo counts as good when it's big enough for an edge-to-edge hero. Fewer than two good ones: our drawn cover leads. */
export const goodPhoto = (p) => (p?.w || 0) >= 1200 && (p?.h || 0) >= 700;
export const photoLead = (pkg) => ((pkg?.photos || []).filter(goodPhoto).length >= 2 ? "photos" : "drawn");

// ---------------------------------------------------------------------------------------------------------------
export function mountBrandbook(app, { store, small, currentUser, C, X = {}, publicOrigin = () => "", assetsDir = "", PUBLIC_DIR = "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const S0 = (ws) => scopeStore(store, ws);
  const me = (req) => { const u = currentUser(req); return u && u.ws && u.ws !== DEFAULT_WS ? u : null; };
  const need = (req, res) => { const u = me(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } return u; };
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };

  // ---- pages ----
  app.get("/teams/discover", page("brand-discover.html"));
  app.get("/teams/trusted", page("trusted.html"));
  app.get("/teams/x/:handle/:pkg", page("experience.html"));
  app.get("/teams/book/:handle/:pkg", page("checkout.html"));
  app.get(["/teams/list", "/teams/list/:id"], page("team-shortlist.html"));
  app.get("/teams/list/:id/compare", page("compare.html"));
  app.get(["/teams/bookings", "/teams/bookings/:id"], page("team-bookings.html"));
  app.get("/host/teams", page("host-teams.html"));
  app.get("/admin/hosts", (req, res, next) => { const u = me(req); if (!u || !isAdmin(u.email)) return res.status(404).type("text").send("Not found"); page("host-review.html")(req, res, next); });

  // ---- reading hosts ----
  const setupOf = (ws) => S0(ws).get("teambook/setup")?.data || null;
  const verifyOf = (ws) => S0(ws).get("teambook/verify")?.data || {};
  const reqs = () => store.listPrefix("system", "bbreq-").map((d) => d.data).filter((r) => r && r.kind === "bbreq");
  const reqGet = (id) => store.get("system/bbreq-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 24))?.data || null;
  const reqSet = (r) => { r.updatedAt = Date.now(); store.set("system/bbreq-" + r.id, r); return r; };
  const ownerEmailOf = (ws) => getWorkspace(ws)?.ownerEmail || "";
  const example = (ws) => isExampleEmail(ownerEmailOf(ws));
  const ownsPhotoFor = (ws) => (url) => { try { const id = String(url).split("/").pop(); return JSON.parse(fs.readFileSync(path.join(assetsDir, id + ".json"), "utf8")).ws === ws; } catch { return false; } };

  /** Every number on a host's trust row, worked out from what happened on Pottery Lab. */
  function statsOf(ws, now = Date.now()) {
    const today = isoDay(now), mine = reqs().filter((r) => r.hostWs === ws);
    let T = {}; try { T = X.trustOf ? X.trustOf(ws) : {}; } catch {}
    const doneTeam = mine.filter((r) => statusOf(r, today) === "done" && !r.linkedEvent).length;
    const revealed = mine.map((r) => reviewsFor(r, "public", now).public).filter(Boolean);
    const rating = revealed.length ? revealed.reduce((a, x) => a + x.rating, 0) / revealed.length : 0;
    const answerable = mine.filter((r) => r.status !== "approval" && (r.respondedAt || now - (r.sentAt || r.createdAt) > TRUSTED.respondHours * 3600e3));
    const answered = answerable.filter((r) => r.respondedAt);
    const hrs = answered.map((r) => (r.respondedAt - (r.sentAt || r.createdAt)) / 3600e3).sort((a, b) => a - b);
    const median = hrs.length ? hrs[Math.floor((hrs.length - 1) / 2)] : null;
    const onTime = answered.filter((r) => (r.respondedAt - (r.sentAt || r.createdAt)) / 3600e3 <= TRUSTED.respondHours).length;
    const brands = new Map(); for (const r of mine.filter(isBooked)) { const k = r.brandWs || lc(r.company); brands.set(k, (brands.get(k) || 0) + 1); }
    const repeatRate = brands.size ? [...brands.values()].filter((n) => n > 1).length / brands.size : 0;
    const hostCancels90 = mine.filter((r) => r.status === "cancelled" && r.cancelledBy === "host" && now - (r.cancelledAt || 0) < TRUSTED.noCancelDays * DAY).length;
    const setup = setupOf(ws) || {}, V = verifyOf(ws), owner = getDbUser(ownerEmailOf(ws));
    const goodPhotos = Math.max(0, ...(setup.packages || []).map((p) => (p.photos || []).filter(goodPhoto).length), 0);
    const firstYear = setup.since || (owner?.createdAt ? new Date(owner.createdAt).getUTCFullYear() : 0);
    const s = { events: (T.events || 0) + doneTeam, teamEvents: mine.filter(isBooked).length, guests: T.guests || 0, again: T.again || null, kudos: T.kudos || 0,
      reviews: revealed.length, rating: Math.round(rating * 100) / 100, responseHours: median == null ? null : Math.round(median * 10) / 10, responseRate: answerable.length ? onTime / answerable.length : null,
      repeatRate, repeatBrands: [...brands.values()].filter((n) => n > 1).length, brands: brands.size, hostCancels90, goodPhotos,
      emailVerified: !!owner && owner.emailVerified !== false, phoneVerified: !!V.phone?.verifiedAt, idChecked: V.id?.state === "approved", coi: coiPublic(V.coi, today),
      years: firstYear ? Math.max(0, new Date(now).getUTCFullYear() - firstYear) : 0, since: firstYear || 0 };
    const t = trustedCheck(s); s.trusted = t.trusted && !example(ws); s.checks = t.checks; s.quality = qualityScore(s);
    return s;
  }
  const coiPublic = (c, today) => (c?.file && (!c.expires || c.expires >= today) ? { onFile: true, insurer: c.insurer || "", expires: c.expires || "" } : { onFile: false });
  X.teamStatsOf = statsOf;

  const hostCard = (ws, h) => ({ handle: h.handle, name: h.name || h.handle, person: first(getDbUser(ownerEmailOf(ws))?.name || ""), avatar: h.theme?.avatarUrl || "", emoji: h.emoji || "", tagline: h.tagline || "", example: example(ws) });
  const pkgPublic = (p) => ({ id: p.id, name: p.name, story: p.story, moods: p.moods, perPersonCents: p.perPersonCents, minimumCents: p.minimumCents, minGuests: p.minGuests, maxGuests: p.maxGuests, leadDays: p.leadDays, length: p.length, includes: p.includes, diets: p.diets, access: p.access, remote: p.remote, instant: p.instant, weekdays: p.weekdays, time: p.time, taxBps: p.taxBps, depositPct: p.depositPct, photos: p.photos, lead: photoLead(p), venue: p.venue, art: p.art || "" });
  // every workspace with a setup that's on: found through the handle index C keeps (only hosts with pages can be listed)
  function allSetups() { const out = [];
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const h = C.profileOf(ws); if (!h?.handle) continue; const s = setupOf(ws); if (!s?.on) continue; out.push({ ws, h, s }); }
    return out; }
  const cardOf = ({ ws, h, s }, p, people, stats) => { const pr = priceFor(p, people || p.minGuests); return { handle: h.handle, pkg: p.id, name: p.name, story: p.story.slice(0, 180), moods: p.moods, remote: p.remote, lead: photoLead(p), photo: (p.photos || [])[0] || null, photos: (p.photos || []).slice(0, 4), art: p.art || "",
    host: { ...hostCard(ws, h), trusted: stats.trusted, verified: { email: stats.emailVerified, phone: stats.phoneVerified, id: stats.idChecked } }, area: approxArea(s.area, s.city || h.city),
    perPersonCents: p.perPersonCents, minGuests: p.minGuests, maxGuests: p.maxGuests, price: { summary: pr.summary, totalCents: pr.totalCents, headcount: pr.headcount, effectivePerPersonCents: pr.effectivePerPersonCents }, rating: stats.rating, reviews: stats.reviews, quality: stats.quality, instant: p.instant && stats.trusted, policy: cancellationTerms(s.policy, p.depositPct).short, includes: pr.includes }; };

  // ---- Discover ----
  app.get("/api/bb/moods", (req, res) => res.json({ moods: MOODS, diets: DIETS, access: ACCESS, areas: AREA_NAMES, trusted: TRUSTED }));
  app.get("/api/bb/discover", (req, res) => { if (limited("d:" + req.ip, 600)) return bad(res, "Slow down.", 429, "rate_limited");
    const q = req.query || {}, mood = MOODS.some((m) => m.id === q.mood) ? q.mood : "", people = int(q.people, 0, 2000), budget = int(q.budget, 0, 100000) * 100, hood = lc(q.hood), diets = String(q.diet || "").split(",").filter((d) => DIETS.includes(d)), access = String(q.access || "").split(",").filter((d) => ACCESS.includes(d));
    const from = ISO.test(q.from || "") ? q.from : "", to = ISO.test(q.to || "") ? q.to : "", out = [];
    for (const x of allSetups()) { if (example(x.ws) && process.env.ENCORE_HIDE_DEMO === "1") continue; const st = statsOf(x.ws);
      for (const p of x.s.packages.filter((p) => p.on)) {
        if (mood === "under50" ? !(p.perPersonCents && p.perPersonCents <= 5000) : mood === "remote" ? !p.remote : mood && !p.moods.includes(mood)) continue;
        if (people && (people < p.minGuests || people > p.maxGuests)) continue;
        if (budget && p.perPersonCents > budget) continue;
        if (hood && !p.remote && lc(x.s.area) !== hood && lc(x.s.city || x.h.city) !== hood && lc(approxArea(x.s.area, x.s.city).city) !== hood) continue;
        if (diets.some((d) => !p.diets.includes(d)) || access.some((a) => !p.access.includes(a))) continue;
        if (from) { const months = new Set([from.slice(0, 7), (to || from).slice(0, 7)]); let any = false; for (const m of months) { const A = availabilityFor(p, m, { taken: takenFor(x.ws, p.id) }); if (A.days.some((d) => d.state === "open" && d.date >= from && (!to || d.date <= to))) any = true; } if (!any) continue; }
        out.push(cardOf(x, p, people, st)); } }
    out.sort((a, b) => (b.host.example ? -1 : 0) - (a.host.example ? -1 : 0) || b.quality - a.quality || (a.perPersonCents - b.perPersonCents));
    res.set("Cache-Control", "private, no-store").json({ results: out, total: out.length, mood: MOODS.find((m) => m.id === mood) || null }); });

  const takenFor = (ws, pkgId) => new Set(reqs().filter((r) => r.hostWs === ws && r.pkgId === pkgId && ["booked", "accepted"].includes(r.status) && r.date).map((r) => r.date));
  const findPkg = (handle, pkgId) => { const ws = C.wsOfHandle(lc(handle)); const h = ws && C.profileOf(ws); const s = ws && setupOf(ws); const p = s?.packages?.find((x) => x.id === String(pkgId || "")); return ws && h && s && p ? { ws, h, s, p } : null; };

  // ---- the experience page ----
  app.get("/api/bb/x/:handle/:pkg", (req, res) => { const F = findPkg(req.params.handle, req.params.pkg); if (!F || (!F.s.on && me(req)?.ws !== F.ws) || (!F.p.on && me(req)?.ws !== F.ws)) return bad(res, "This experience isn't bookable right now.", 404, "not_found");
    const { ws, h, s, p } = F, st = statsOf(ws), people = int(req.query.people || p.minGuests, 1, 2000), today = isoDay();
    const mine = reqs().filter((r) => r.hostWs === ws);
    const brandReviews = mine.map((r) => ({ r, v: reviewsFor(r, "public").public })).filter((x) => x.v).sort((a, b) => b.v.at - a.v.at).slice(0, 12).map(({ r, v }) => ({ ...v, pkg: r.pkgName, headcount: r.headcount, month: r.date ? r.date.slice(0, 7) : "" }));
    let T = {}; try { T = X.trustOf ? X.trustOf(ws) : {}; } catch {}
    const guestReviews = (T.testimonials || []).filter((t) => t.source === "guest").slice(0, 6).map((t) => ({ text: t.quote, name: first(t.name), event: t.event || "" }));
    const others = s.packages.filter((x) => x.on && x.id !== p.id).map((x) => ({ id: x.id, name: x.name, perPersonCents: x.perPersonCents, photo: (x.photos || [])[0] || null, lead: photoLead(x), art: x.art || "" }));
    const months = [today.slice(0, 7), isoDay(Date.parse(today.slice(0, 7) + "-15T12:00:00Z") + 31 * DAY).slice(0, 7)];
    res.set("Cache-Control", "private, no-store").json({ host: { ...hostCard(ws, h), story: s.story || h.bio || "", city: s.city || h.city || "", gallery: (h.gallery || []).slice(0, 8) }, pkg: pkgPublic(p), stats: { ...st, checks: st.checks },
      area: approxArea(s.area, s.city || h.city), price: priceFor(p, people), terms: cancellationTerms(s.policy, p.depositPct), reviews: { brands: brandReviews, guests: guestReviews },
      availability: months.map((m) => availabilityFor(p, m, { taken: takenFor(ws, p.id), today })), others, criteria: TRUSTED, venue: p.venue === "host" ? "At the host's space" : p.venue === "brand" ? "At your office or venue" : "At a venue the host books",
      contact: "Message the host here. Emails and numbers are shared once you're booked." }); });
  app.get("/api/bb/x/:handle/:pkg/availability", (req, res) => { const F = findPkg(req.params.handle, req.params.pkg); if (!F) return bad(res, "Not found.", 404, "not_found"); res.json(availabilityFor(F.p, String(req.query.month || ""), { taken: takenFor(F.ws, F.p.id) })); });
  app.get("/api/bb/price/:handle/:pkg", (req, res) => { const F = findPkg(req.params.handle, req.params.pkg); if (!F) return bad(res, "Not found.", 404, "not_found"); res.json({ price: priceFor(F.p, int(req.query.people, 1, 2000)), terms: cancellationTerms(F.s.policy, F.p.depositPct) }); });
  app.get("/api/bb/hostpkgs/:handle", (req, res) => { const ws = C.wsOfHandle(lc(req.params.handle)), h = ws && C.profileOf(ws), s = ws && setupOf(ws); if (!h || !s?.on) return res.json({ packages: [] });
    res.set("Cache-Control", "public, max-age=60").json({ name: h.name, packages: s.packages.filter((p) => p.on).map((p) => ({ id: p.id, name: p.name, perPersonCents: p.perPersonCents, minGuests: p.minGuests, maxGuests: p.maxGuests })) }); });
  app.get("/api/bb/map", (req, res) => { const out = []; for (const x of allSetups()) { if (example(x.ws) && process.env.ENCORE_HIDE_DEMO === "1") continue; for (const p of x.s.packages.filter((p) => p.on && !p.remote)) out.push({ handle: x.h.handle, pkg: p.id, name: p.name, ...approxArea(x.s.area, x.s.city || x.h.city) }); } res.json({ places: out, note: "Areas are approximate. The exact address is shared once you're booked." }); });

  // ---- shortlists ----
  const slGet = (id) => store.get("system/bbsl-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 20))?.data || null;
  const slSet = (sl) => { sl.updatedAt = Date.now(); store.set("system/bbsl-" + sl.id, sl); return sl; };
  const roleOf = (req, sl) => { const u = me(req); return shortlistRole(sl, { email: u?.email, ws: u?.ws, key: String(req.query.k || req.body?.k || "") }); };
  const slView = (sl, role, req, voterIn = "") => { const items = sl.items.map((it) => { const F = findPkg(it.handle, it.pkg); if (!F) return { ...it, gone: true }; const st = statsOf(F.ws); return { ...it, card: cardOf(F, F.p, sl.people || F.p.minGuests, st), price: priceFor(F.p, sl.people || F.p.minGuests), terms: cancellationTerms(F.s.policy, F.p.depositPct), stats: { rating: st.rating, reviews: st.reviews, events: st.events, responseHours: st.responseHours, trusted: st.trusted, coi: st.coi, idChecked: st.idChecked }, pkgInfo: pkgPublic(F.p) }; });
    const voter = voterIn || me(req)?.email || req.query.voter || req.body?.voter || "";
    return { id: sl.id, title: sl.title, people: sl.people, when: sl.when, role, by: sl.byName, items, votes: Object.fromEntries(Object.entries(sl.votes || {}).map(([k, v]) => [k, { n: Object.keys(v).length, names: Object.values(v), mine: !!v[voterKey(voter)] }])), comments: sl.comments || [],
      links: slCan(role, "share") ? { vote: `/teams/list/${sl.id}?k=${sl.links.vote}`, view: `/teams/list/${sl.id}?k=${sl.links.view}` } : null }; };
  const voterKey = (v) => crypto.createHash("sha256").update(lc(v)).digest("hex").slice(0, 16);
  app.get("/api/bb/shortlists", (req, res) => { const u = need(req, res); if (!u) return; const L = store.listPrefix("system", "bbsl-").map((d) => d.data).filter((s) => s?.ws === u.ws).sort((a, b) => b.updatedAt - a.updatedAt);
    res.set("Cache-Control", "private, no-store").json({ shortlists: L.map((s) => ({ id: s.id, title: s.title, n: s.items.length, people: s.people, updatedAt: s.updatedAt, keys: s.items.map((i) => i.handle + "/" + i.pkg) })) }); });
  app.post("/api/bb/shortlists", small, (req, res) => { const u = need(req, res); if (!u) return; const b = req.body || {}, id = rid(5);
    const sl = { kind: "bbsl", id, ws: u.ws, ownerEmail: lc(u.email), byName: first(u.name || getDbUser(u.email)?.name || ""), title: clean(b.title, 80) || "Team event ideas", people: int(b.people, 0, 2000), when: clean(b.when, 60), items: [], votes: {}, comments: [], links: { vote: rid(9), view: rid(9) }, createdAt: Date.now() };
    if (b.handle && b.pkg && findPkg(b.handle, b.pkg)) sl.items.push({ handle: lc(b.handle), pkg: String(b.pkg), addedBy: sl.byName, at: Date.now() });
    slSet(sl); res.json({ ok: true, id, url: `/teams/list/${id}` }); });
  app.get("/api/bb/shortlists/:id", (req, res) => { const sl = slGet(req.params.id), role = roleOf(req, sl); if (!sl || !slCan(role, "view")) return bad(res, "This shortlist is private. Ask whoever made it for the link.", 404, "not_found");
    res.set("Cache-Control", "private, no-store").json(slView(sl, role, req)); });
  app.post("/api/bb/shortlists/:id/items", small, (req, res) => { const sl = slGet(req.params.id), role = roleOf(req, sl); if (!sl || !slCan(role, "view")) return bad(res, "Not found.", 404, "not_found"); if (!slCan(role, "add")) return bad(res, "Only your team can add or remove options. You can vote and comment.", 403, "not_granted");
    const b = req.body || {}, key = lc(b.handle) + "/" + String(b.pkg || "");
    if (b.remove) { sl.items = sl.items.filter((i) => i.handle + "/" + i.pkg !== key); delete sl.votes[key]; }
    else { if (!findPkg(b.handle, b.pkg)) return bad(res, "That experience isn't bookable right now.", 404, "not_found"); if (!sl.items.some((i) => i.handle + "/" + i.pkg === key)) { if (sl.items.length >= 12) return bad(res, "A shortlist holds 12. Remove one first."); sl.items.push({ handle: lc(b.handle), pkg: String(b.pkg), addedBy: first(me(req)?.name || ""), at: Date.now() }); } }
    if (b.people != null) sl.people = int(b.people, 0, 2000); if (b.title) sl.title = clean(b.title, 80);
    slSet(sl); res.json(slView(sl, role, req)); });
  app.post("/api/bb/shortlists/:id/vote", small, (req, res) => { if (limited("v:" + req.ip, 200)) return bad(res, "Slow down.", 429, "rate_limited"); const sl = slGet(req.params.id), role = roleOf(req, sl); if (!sl || !slCan(role, "view")) return bad(res, "Not found.", 404, "not_found"); if (!slCan(role, "vote")) return bad(res, "This link is view only. Ask for the team link to vote.", 403, "not_granted");
    const b = req.body || {}, u = me(req), name = clean(u ? first(u.name || getDbUser(u.email)?.name || u.email) : b.name, 40), voter = u?.email || clean(b.voter, 40); if (!name || !voter) return bad(res, "Add your name first.");
    const key = lc(b.handle) + "/" + String(b.pkg || ""); if (!sl.items.some((i) => i.handle + "/" + i.pkg === key)) return bad(res, "That option isn't on this list.");
    const v = (sl.votes[key] ||= {}), vk = voterKey(voter); if (v[vk] && b.on !== true) delete v[vk]; else v[vk] = name;
    slSet(sl); res.json(slView(sl, role, req, voter)); });
  app.post("/api/bb/shortlists/:id/comments", small, (req, res) => { if (limited("c:" + req.ip, 120)) return bad(res, "Slow down.", 429, "rate_limited"); const sl = slGet(req.params.id), role = roleOf(req, sl); if (!sl || !slCan(role, "view")) return bad(res, "Not found.", 404, "not_found"); if (!slCan(role, "comment")) return bad(res, "This link is view only. Ask for the team link to comment.", 403, "not_granted");
    const b = req.body || {}, u = me(req), name = clean(u ? first(u.name || getDbUser(u.email)?.name || u.email) : b.name, 40), text = scrubContact(cleanText(b.text, 600)); if (!name) return bad(res, "Add your name first."); if (text.length < 2) return bad(res, "Say a little more.");
    sl.comments = [...(sl.comments || []), { id: rid(4), key: clean(b.key, 60), by: name, text, at: Date.now() }].slice(-200); slSet(sl); res.json(slView(sl, role, req)); });
  app.delete("/api/bb/shortlists/:id", (req, res) => { const sl = slGet(req.params.id), role = roleOf(req, sl); if (!sl || !slCan(role, "delete")) return bad(res, "Only the person who made it can delete it.", 403, "not_granted"); store.delete("system/bbsl-" + sl.id); res.json({ ok: true }); });

  // ---- brand approval rule ----
  const rulesOf = (ws) => ({ approval: "off", overCents: 0, approvers: [], ...(S0(ws).get("teambook/rules")?.data || {}) });
  const needsApproval = (rules, totalCents, email) => rules.approval !== "off" && !(rules.approvers || []).map(lc).includes(lc(email)) && (rules.approval === "always" || totalCents > (rules.overCents || 0));
  app.get("/api/bb/brand/rules", (req, res) => { const u = need(req, res); if (!u) return; const W = getWorkspace(u.ws); res.json({ rules: rulesOf(u.ws), company: W?.company || "", brand: W?.plan !== "friends", canEdit: !!u.owner, me: lc(u.email), name: u.name || "", pay: { provider: payProvider().name, test: payProvider().test } }); });
  app.post("/api/bb/brand/rules", small, (req, res) => { const u = need(req, res); if (!u) return; if (!u.owner) return bad(res, "Only the workspace owner sets the approval rule.", 403, "not_granted"); const b = req.body || {};
    const rules = { approval: ["off", "over", "always"].includes(b.approval) ? b.approval : "off", overCents: int(b.overCents, 0, 1e9), approvers: (Array.isArray(b.approvers) ? b.approvers : String(b.approvers || "").split(/[\s,]+/)).map(lc).filter((e) => /@/.test(e)).slice(0, 10) };
    if (rules.approval !== "off" && !rules.approvers.length) rules.approvers = [lc(u.email)];
    S0(u.ws).set("teambook/rules", rules); res.json({ rules }); });

  // ---- request to book ----
  const brandSide = (u, r) => !!u && u.ws === r.brandWs;
  const hostSide = (u, r) => !!u && u.ws === r.hostWs;
  const hostPeople = (r) => { const h = C.profileOf(r.hostWs) || {}, s = setupOf(r.hostWs) || {}; return { hostName: h.name || "", hostEmail: ownerEmailOf(r.hostWs), hostPhone: s.phone || verifyOf(r.hostWs).phone?.number || "" }; };
  function view(r, side) {
    const st = statusOf(r), h = C.profileOf(r.hostWs) || {};
    const o = { id: r.id, status: st, statusText: (side === "host" ? HOST_STATUS[st] : STATUS[st]) || st, handle: r.handle, pkg: r.pkgId, pkgName: r.pkgName, host: { name: h.name || "", handle: h.handle, avatar: h.theme?.avatarUrl || "" }, company: r.company, contactName: side === "host" ? first(r.contactName) : r.contactName,
      date: r.date, flex: r.flex, flexText: r.flex ? flexLabel(r.flex) : "", headcount: r.headcount, diets: r.diets || [], access: r.access || [], notes: r.notes || "", occasion: r.occasion || "", price: r.price, terms: r.terms, counter: r.counter || null, instant: !!r.instant,
      deposit: r.deposit, approval: r.approval || null, createdAt: r.createdAt, respondedAt: r.respondedAt || 0, history: r.history || [],
      messages: (r.messages || []).map((m) => ({ ...m, text: isBooked(r) ? m.text : scrubContact(m.text) })), contact: contactFor(r, side, hostPeople(r)), reviews: reviewsFor(r, side), billing: side === "brand" ? r.billing || {} : undefined,
      invoice: isBooked(r) ? `/teams/invoice/${r.id}` : "", coi: isBooked(r) && side === "brand" && coiPublic(verifyOf(r.hostWs).coi, isoDay()).onFile ? `/api/bb/requests/${r.id}/coi` : "" };
    if (side === "host") { delete o.approval; o.brandRating = null; }
    return o;
  }
  const push = (r, by, what) => { r.history = [...(r.history || []), { at: Date.now(), by, what }].slice(-60); };
  const tell = (email, text, link) => { try { X.notify?.(email, { kind: "teambook", text, link, eventId: "" }); } catch {} };
  const pay = payProvider();

  app.post("/api/bb/requests", small, async (req, res) => { const u = need(req, res); if (!u) return; if (limited("r:" + u.ws, 40)) return bad(res, "That's a lot of requests at once. Try again in a while.", 429, "rate_limited");
    const b = req.body || {}, F = findPkg(b.handle, b.pkg); if (!F || !F.s.on || !F.p.on) return bad(res, "This experience isn't bookable right now.", 404, "not_found");
    if (F.ws === u.ws) return bad(res, "That's your own experience.");
    if (example(F.ws) && process.env.ENCORE_ALLOW_DEMO_WRITES !== "1") return bad(res, "This is an example host, so it can't take requests.", 403, "example");
    const { ws, h, s, p } = F, n = int(b.headcount, 0, 2000);
    if (n < p.minGuests || n > p.maxGuests) return bad(res, `${p.name} is for ${p.minGuests} to ${p.maxGuests} people.`);
    const date = ISO.test(b.date || "") ? b.date : "", flex = !date && b.flex && /^\d{4}-\d{2}$/.test(b.flex.month || "") ? { month: b.flex.month, days: ["weekday", "weekend", "any"].includes(b.flex.days) ? b.flex.days : "weekday", time: ["evening", "daytime", "any"].includes(b.flex.time) ? b.flex.time : "evening" } : null;
    if (!date && !flex) return bad(res, "Pick a date, or a month that works.");
    const today = isoDay(); if (date && date < today) return bad(res, "That date has passed.");
    const W = getWorkspace(u.ws), company = clean(b.company || (W?.plan !== "friends" ? W?.company : ""), 120); if (!company) return bad(res, "Add your company name.");
    const price = priceFor(p, n), terms = cancellationTerms(s.policy, p.depositPct), st = statsOf(ws), rules = rulesOf(u.ws);
    const cg = b.campaign && X.campaignGate ? X.campaignGate(u, String(b.campaign), price.totalCents) : null; if (cg && !cg.ok) return bad(res, cg.message, 403, "not_granted"); // a campaign's roles and budget (server/campaigns.js)
    const approvalPending = needsApproval(rules, price.totalCents, u.email) || !!cg?.approval;
    const open = !date || availabilityFor(p, date.slice(0, 7), { taken: takenFor(ws, p.id), today }).days.find((d) => d.date === date)?.state === "open";
    const I = instantEligible({ trusted: st.trusted, pkg: p, date, headcount: n, today, approvalPending, open });
    const r = { kind: "bbreq", id: rid(8), hostWs: ws, handle: h.handle, pkgId: p.id, pkgName: p.name, brandWs: u.ws, brandEmail: lc(u.email), brandPhone: clean(b.phone, 30), contactName: clean(u.name || getDbUser(u.email)?.name || "", 80), company,
      date, flex, headcount: n, diets: (Array.isArray(b.diets) ? b.diets : []).filter((d) => DIETS.includes(d)), dietNotes: clean(b.dietNotes, 300), access: (Array.isArray(b.access) ? b.access : []).filter((d) => ACCESS.includes(d)), occasion: clean(b.occasion, 120), notes: scrubContact(cleanText(b.notes, 1200)),
      price, terms, venue: { kind: p.venue, address: p.venue === "host" ? s.address || "" : "" }, deposit: { state: "none", cents: price.depositCents, provider: pay.name },
      status: approvalPending ? "approval" : "requested", approval: approvalPending ? (cg?.approval && !needsApproval(rules, price.totalCents, u.email) ? { state: "pending", approvers: cg.approval.approvers, rule: cg.approval.rule } : { state: "pending", approvers: [...new Set([...(rules.approvers || []), ...(cg?.approval?.approvers || [])])], rule: rules.approval === "always" ? "Every booking" : `Over ${money0(rules.overCents)}` }) : null, ...(cg ? { campaignId: cg.id } : {}),
      instantWanted: I.ok || (!!p.instant && st.trusted && approvalPending && I.why === "Your team approves this first."), messages: [], history: [], reviews: {}, billing: { company }, createdAt: Date.now(), sentAt: approvalPending ? 0 : Date.now() };
    push(r, "brand", approvalPending ? "asked the team to approve" : "sent the request");
    if (I.ok) instantBook(r);
    reqSet(r); if (cg) X.campaignAttach?.(cg.id, r.id);
    if (approvalPending) for (const a of r.approval.approvers) tell(a, `${first(r.contactName) || "A teammate"} wants to book ${p.name} for ${n} (${money0(price.totalCents)}). It needs your OK.`, `/teams/bookings/${r.id}`);
    else tell(ownerEmailOf(ws), r.instant ? `${company} booked ${p.name} for ${n} with Instant book.` : `${company} asked to book ${p.name} for ${n}. Reply within a day.`, `/host/teams#inbox`);
    res.json({ ok: true, id: r.id, status: r.status, instant: !!r.instant, instantWhy: I.why, url: `/teams/bookings/${r.id}`, request: view(r, "brand") }); });
  function instantBook(r) { r.status = "accepted"; r.instant = true; r.respondedAt = Date.now(); r.sentAt ||= Date.now(); push(r, "host", "Instant book: accepted"); }

  // a question before booking: a thread with the host, nothing held or charged
  app.post("/api/bb/questions", small, (req, res) => { const u = need(req, res); if (!u) return; if (limited("q:" + u.ws, 30)) return bad(res, "That's a lot of questions at once. Try again later.", 429, "rate_limited");
    const b = req.body || {}, F = findPkg(b.handle, b.pkg); if (!F || !F.s.on || !F.p.on) return bad(res, "This experience isn't bookable right now.", 404, "not_found"); if (F.ws === u.ws) return bad(res, "That's your own experience.");
    const raw = cleanText(b.text, 1000); if (raw.length < 5) return bad(res, "Write your question first.");
    const W = getWorkspace(u.ws), n = int(b.headcount || F.p.minGuests, F.p.minGuests, F.p.maxGuests), price = priceFor(F.p, n);
    const r = { kind: "bbreq", id: rid(8), hostWs: F.ws, handle: F.h.handle, pkgId: F.p.id, pkgName: F.p.name, brandWs: u.ws, brandEmail: lc(u.email), contactName: clean(u.name || getDbUser(u.email)?.name || "", 80), company: clean(W?.plan !== "friends" ? W?.company : b.company, 120) || first(u.name || ""),
      date: "", flex: null, headcount: n, diets: [], access: [], notes: "", price, terms: cancellationTerms(F.s.policy, F.p.depositPct), venue: { kind: F.p.venue, address: "" }, deposit: { state: "none", cents: price.depositCents, provider: pay.name },
      status: "question", messages: [{ id: rid(4), from: "brand", name: first(u.name || ""), text: scrubContact(raw), at: Date.now(), hidden: scrubContact(raw) !== raw }], history: [], reviews: {}, billing: {}, createdAt: Date.now(), sentAt: Date.now() };
    push(r, "brand", "asked a question"); reqSet(r); tell(ownerEmailOf(F.ws), `${r.company} has a question about ${F.p.name}.`, "/host/teams#inbox");
    res.json({ ok: true, id: r.id, url: `/teams/bookings/${r.id}` }); });
  app.get("/api/bb/requests", (req, res) => { const u = need(req, res); if (!u) return; const L = reqs().filter((r) => r.brandWs === u.ws).sort((a, b) => b.updatedAt - a.updatedAt);
    res.set("Cache-Control", "private, no-store").json({ requests: L.map((r) => view(r, "brand")), rules: rulesOf(u.ws), approver: (rulesOf(u.ws).approvers || []).includes(lc(u.email)) || L.some((r) => r.status === "approval" && (r.approval?.approvers || []).includes(lc(u.email))) }); });
  app.get("/api/bb/requests/:id", (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !(brandSide(u, r) || hostSide(u, r))) return bad(res, "Not found.", 404, "not_found");
    res.set("Cache-Control", "private, no-store").json({ request: view(r, brandSide(u, r) ? "brand" : "host"), side: brandSide(u, r) ? "brand" : "host", approver: brandSide(u, r) && [...(rulesOf(u.ws).approvers || []), ...(r.approval?.approvers || [])].includes(lc(u.email)) }); });

  // a brand approver lets it through (or not)
  app.post("/api/bb/requests/:id/approve", small, (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !brandSide(u, r)) return bad(res, "Not found.", 404, "not_found");
    if (r.status !== "approval") return bad(res, "This one doesn't need approval now.", 409, "conflict");
    if (![...(rulesOf(u.ws).approvers || []), ...(r.approval?.approvers || [])].includes(lc(u.email))) return bad(res, "Only an approver on your team can approve this.", 403, "not_granted");
    if (req.body?.ok === false) { r.status = "cancelled"; r.cancelledBy = "brand"; r.cancelledAt = Date.now(); r.approval = { ...r.approval, state: "no", by: lc(u.email), at: Date.now() }; push(r, "brand", "team said not this time"); releaseDeposit(r); reqSet(r); return res.json({ request: view(r, "brand") }); }
    r.approval = { ...r.approval, state: "yes", by: lc(u.email), at: Date.now() }; r.status = "requested"; r.sentAt = Date.now(); push(r, "brand", "approved by the team");
    const F = findPkg(r.handle, r.pkgId); if (F && r.instantWanted) { const I = instantEligible({ trusted: statsOf(F.ws).trusted, pkg: F.p, date: r.date, headcount: r.headcount, open: availabilityFor(F.p, (r.date || "").slice(0, 7), { taken: takenFor(F.ws, F.p.id) }).days.find((d) => d.date === r.date)?.state === "open" }); if (I.ok) { instantBook(r); if (r.deposit.state === "held") chargeDeposit(r); } }
    reqSet(r); tell(ownerEmailOf(r.hostWs), `${r.company} asked to book ${r.pkgName} for ${r.headcount}.`, "/host/teams#inbox"); res.json({ request: view(r, "brand") }); });

  // the deposit: held at checkout, charged when the host accepts, released on a decline
  function chargeDeposit(r) { r.deposit = { ...r.deposit, state: "charged", chargedAt: Date.now() }; r.payments = [...(r.payments || []), { state: "charged", cents: r.deposit.cents, at: Date.now(), provider: r.deposit.provider, ref: r.deposit.ref || "" }]; r.status = "booked"; r.bookedAt = Date.now(); push(r, "brand", "deposit paid: booked"); }
  function releaseDeposit(r) { if (r.deposit?.state === "held") { r.deposit = { ...r.deposit, state: "released", releasedAt: Date.now() }; } }
  app.post("/api/bb/requests/:id/pay", small, async (req, res) => { if (isNativeReq(req)) return bad(res, "Booking for teams happens on the web, at potterylab.com.", 403, "web_only");
    const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !brandSide(u, r)) return bad(res, "Not found.", 404, "not_found");
    if (!["approval", "requested", "accepted", "countered"].includes(r.status) || ["held", "charged"].includes(r.deposit?.state)) return bad(res, "Nothing to pay right now.", 409, "conflict");
    if (pay.name === "stripe") { try { const o = publicOrigin(req); const S = await stripeCheckout(pay, { cents: r.deposit.cents, name: `Deposit: ${r.pkgName} for ${r.headcount}`, successUrl: `${o}/teams/bookings/${r.id}?paid=1`, cancelUrl: `${o}/teams/bookings/${r.id}`, ref: r.id }); r.deposit = { ...r.deposit, session: S.session }; reqSet(r); return res.json({ redirect: S.url }); } catch (e) { return bad(res, "Payment didn't start. Try again in a minute.", 502, "payment_failed"); } }
    r.deposit = { ...r.deposit, state: "held", heldAt: Date.now(), ref: "test_" + rid(6), provider: "fake" }; push(r, "brand", `deposit of ${money(r.deposit.cents)} held`);
    if (r.status === "accepted") chargeDeposit(r);
    reqSet(r); res.json({ ok: true, test: true, request: view(r, "brand") }); });

  // messages: in the app, contact details hidden until booked (the chat rule)
  app.post("/api/bb/requests/:id/messages", small, (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !(brandSide(u, r) || hostSide(u, r))) return bad(res, "Not found.", 404, "not_found");
    if (limited("m:" + u.email, 120)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const side = brandSide(u, r) ? "brand" : "host", raw = cleanText(req.body?.text, 1000); if (raw.length < 1) return bad(res, "Write a message first.");
    const text = isBooked(r) ? raw : scrubContact(raw);
    r.messages = [...(r.messages || []), { id: rid(4), from: side, name: side === "host" ? first(C.profileOf(r.hostWs)?.name || "") : first(u.name || r.contactName), text, at: Date.now(), hidden: text !== raw }].slice(-300);
    if (side === "host" && !r.respondedAt && r.status !== "approval") { r.respondedAt = Date.now(); if (r.status === "question") r.answeredAt = Date.now(); }
    reqSet(r); tell(side === "brand" ? ownerEmailOf(r.hostWs) : r.brandEmail, `New message about ${r.pkgName}`, side === "brand" ? "/host/teams#inbox" : `/teams/bookings/${r.id}`);
    res.json({ request: view(r, side), hidden: text !== raw }); });

  // the brand answers a counter, cancels, or saves billing details for the invoice
  app.post("/api/bb/requests/:id/respond", small, (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !brandSide(u, r)) return bad(res, "Not found.", 404, "not_found");
    if (r.status !== "countered" || !r.counter) return bad(res, "There's no change to answer.", 409, "conflict");
    if (req.body?.accept) { const F = findPkg(r.handle, r.pkgId); if (r.counter.date) { r.date = r.counter.date; } if (r.counter.perPersonCents != null && F) { r.price = priceFor(F.p, r.headcount, { override: { perPersonCents: r.counter.perPersonCents } }); r.deposit = { ...r.deposit, cents: r.price.depositCents }; }
      r.status = "accepted"; r.counter = { ...r.counter, answer: "yes" }; push(r, "brand", "took the host's suggestion"); if (r.deposit.state === "held") chargeDeposit(r); }
    else { r.status = "declined"; r.counter = { ...r.counter, answer: "no" }; push(r, "brand", "said no to the change"); releaseDeposit(r); }
    reqSet(r); tell(ownerEmailOf(r.hostWs), `${r.company} ${req.body?.accept ? "took" : "passed on"} your suggestion for ${r.pkgName}.`, "/host/teams#inbox"); res.json({ request: view(r, "brand") }); });
  app.post("/api/bb/requests/:id/cancel", small, (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !(brandSide(u, r) || hostSide(u, r))) return bad(res, "Not found.", 404, "not_found");
    if (["declined", "cancelled", "done"].includes(statusOf(r))) return bad(res, "This booking is already closed.", 409, "conflict");
    const side = brandSide(u, r) ? "brand" : "host", paid = (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + p.cents, 0), days = r.date ? Math.floor((Date.parse(r.date + "T12:00:00Z") - Date.now()) / DAY) : 999;
    const refund = side === "host" ? paid : refundFor(r.terms?.policy, days, paid, r.deposit?.cents || 0);
    r.status = "cancelled"; r.cancelledBy = side; r.cancelledAt = Date.now(); r.refund = { cents: refund, at: Date.now() }; releaseDeposit(r); push(r, side, `cancelled${refund ? `, ${money(refund)} back to the brand` : ""}`);
    reqSet(r); tell(side === "brand" ? ownerEmailOf(r.hostWs) : r.brandEmail, `${side === "brand" ? r.company : C.profileOf(r.hostWs)?.name || "The host"} cancelled ${r.pkgName}.`, side === "brand" ? "/host/teams#inbox" : `/teams/bookings/${r.id}`);
    res.json({ request: view(r, side), refundCents: refund }); });
  app.post("/api/bb/requests/:id/billing", small, (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !brandSide(u, r)) return bad(res, "Not found.", 404, "not_found");
    const b = req.body || {}; r.billing = { company: clean(b.company, 120) || r.company, taxId: clean(b.taxId, 40), address: cleanText(b.address, 300), po: clean(b.po, 40) }; reqSet(r); res.json({ request: view(r, "brand") }); });

  // two-way reviews after the event
  app.post("/api/bb/requests/:id/review", small, (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !(brandSide(u, r) || hostSide(u, r))) return bad(res, "Not found.", 404, "not_found");
    if (statusOf(r) !== "done") return bad(res, "Reviews open after the event.", 409, "conflict");
    const side = brandSide(u, r) ? "brand" : "host"; if (r.reviews?.[side]) return bad(res, "You've reviewed this one.", 409, "conflict");
    const rating = int(req.body?.rating, 1, 5), text = scrubContact(cleanText(req.body?.text, 1200)); if (!rating) return bad(res, "Pick a rating."); if (text.length < 10) return bad(res, "Say a little more, a sentence or two.");
    r.reviews = { ...(r.reviews || {}), [side]: { rating, text, at: Date.now(), role: side === "brand" ? clean(req.body?.role, 60) : "" } }; if (side === "brand" && req.body?.listCompany === true) r.listCompany = true;
    reqSet(r); res.json({ request: view(r, side) }); });

  // the host's insurance certificate, for the brand that booked
  app.get("/api/bb/requests/:id/coi", (req, res) => { const u = need(req, res); if (!u) return; const r = reqGet(req.params.id); if (!r || !(brandSide(u, r) && isBooked(r)) && !hostSide(u, r)) return bad(res, "Not found.", 404, "not_found");
    const c = verifyOf(r.hostWs).coi; if (!c?.file) return bad(res, "No certificate on file.", 404, "not_found"); res.set("Cache-Control", "private, no-store").type(c.type || "application/pdf").sendFile(path.join(assetsDir, c.file)); });

  // the invoice: HTML, printable to PDF, with company name and VAT or tax ID
  app.get("/teams/invoice/:id", (req, res) => { const u = me(req); const r = reqGet(req.params.id); if (!u || !r || !(brandSide(u, r) || hostSide(u, r)) || !isBooked(r)) return res.status(404).type("text").send("Not found");
    const h = C.profileOf(r.hostWs) || {}, I = invoiceOf(r, { hostName: h.name || "", hostTaxId: setupOf(r.hostWs)?.taxId || "" });
    res.set("Cache-Control", "private, no-store").type("html").send(invoiceHtml(I)); });

  // ---- the host side ----
  const hostMe = (req, res) => { const u = need(req, res); if (!u) return null; const h = C.profileOf(u.ws); if (!h?.handle) { bad(res, "Set up your host page first.", 409, "no_page"); return null; } return { u, h, ws: u.ws }; };
  app.get("/api/bb/host/setup", (req, res) => { const H = hostMe(req, res); if (!H) return; const s = setupOf(H.ws), st = statsOf(H.ws), V = verifyOf(H.ws);
    const suggest = s ? [] : (H.h.experiences || []).slice(0, 4).map((e) => ({ name: e.name, story: e.desc || "", minGuests: e.min || 6, maxGuests: e.max || 14, includes: e.includes || [] }));
    res.set("Cache-Control", "private, no-store").json({ setup: s || cleanSetup({ on: false, packages: [], city: H.h.city, area: H.h.hood }), suggest, stats: st, verify: { phone: V.phone ? { number: V.phone.number, verified: !!V.phone.verifiedAt } : null, id: V.id || { state: "none" }, coi: V.coi ? { insurer: V.coi.insurer, expires: V.coi.expires, onFile: !!V.coi.file, name: V.coi.name } : null },
      host: { handle: H.h.handle, name: H.h.name }, policies: Object.fromEntries(Object.keys(POLICIES).map((k) => [k, cancellationTerms(k, 25)])), moods: MOODS, diets: DIETS, access: ACCESS, areas: AREA_NAMES, criteria: TRUSTED, feeBps: FEE_BPS() }); });
  app.post("/api/bb/host/setup", small, (req, res) => { const H = hostMe(req, res); if (!H) return; const next = cleanSetup(req.body || {}, setupOf(H.ws) || {}, { ownsPhoto: ownsPhotoFor(H.ws) });
    for (const p of next.packages) if (p.on && !p.perPersonCents && !p.minimumCents) return bad(res, `Add a price to ${p.name}.`);
    S0(H.ws).set("teambook/setup", next); res.json({ setup: next, stats: statsOf(H.ws) }); });
  app.get("/api/bb/host/requests", (req, res) => { const H = hostMe(req, res); if (!H) return; const L = reqs().filter((r) => r.hostWs === H.ws && r.status !== "approval").sort((a, b) => b.updatedAt - a.updatedAt);
    res.set("Cache-Control", "private, no-store").json({ requests: L.map((r) => view(r, "host")) }); });
  app.post("/api/bb/host/requests/:id", small, (req, res) => { const H = hostMe(req, res); if (!H) return; const r = reqGet(req.params.id); if (!r || r.hostWs !== H.ws || r.status === "approval") return bad(res, "Not found.", 404, "not_found");
    const b = req.body || {}, act = b.action; if (!["requested", "countered"].includes(r.status)) return bad(res, "This request is already answered.", 409, "conflict");
    const F = findPkg(r.handle, r.pkgId);
    if (act === "accept") { if (!r.date) { if (!ISO.test(b.date || "")) return bad(res, `Pick a date in ${flexLabel(r.flex).replace(/^Any /, "")} to accept.`); if (!fitsFlex(b.date, r.flex) && !b.anyDate) return bad(res, "That date is outside what they asked for. Suggest it as a change instead."); r.date = b.date; }
      r.status = "accepted"; push(r, "host", "accepted"); if (r.deposit?.state === "held") chargeDeposit(r); }
    else if (act === "counter") { const date = ISO.test(b.date || "") ? b.date : "", pp = b.perPersonCents != null && b.perPersonCents !== "" ? int(b.perPersonCents, 0, 1e7) : null; if (!date && pp == null) return bad(res, "Suggest a new date or a new price.");
      r.counter = { date, perPersonCents: pp, note: scrubContact(cleanText(b.note, 600)), at: Date.now(), totalCents: F ? priceFor(F.p, r.headcount, { override: pp != null ? { perPersonCents: pp } : null }).totalCents : 0 }; r.status = "countered"; push(r, "host", "suggested a change"); }
    else if (act === "decline") { r.status = "declined"; r.declineNote = scrubContact(cleanText(b.note, 600)); releaseDeposit(r); push(r, "host", "declined"); }
    else return bad(res, "Accept, suggest a change, or decline.");
    if (!r.respondedAt) r.respondedAt = Date.now();
    reqSet(r); tell(r.brandEmail, act === "accept" ? `${H.h.name} accepted ${r.pkgName}${r.deposit?.state === "charged" ? ". You're booked." : ". Pay the deposit to hold the date."}` : act === "counter" ? `${H.h.name} suggested a change to ${r.pkgName}.` : `${H.h.name} can't do ${r.pkgName} this time.`, `/teams/bookings/${r.id}`);
    res.json({ request: view(r, "host") }); });
  app.post("/api/bb/host/requests/:id/done", small, (req, res) => { const H = hostMe(req, res); if (!H) return; const r = reqGet(req.params.id); if (!r || r.hostWs !== H.ws || r.status !== "booked") return bad(res, "Not found.", 404, "not_found"); if (r.date && r.date > isoDay()) return bad(res, "Mark it done after the event."); r.status = "done"; push(r, "host", "marked done"); reqSet(r); res.json({ request: view(r, "host") }); });
  app.get("/api/bb/host/payouts", (req, res) => { const H = hostMe(req, res); if (!H) return; const L = reqs().filter((r) => r.hostWs === H.ws && ["accepted", "booked", "done", "cancelled"].includes(statusOf(r)) && (r.payments || []).length);
    res.set("Cache-Control", "private, no-store").json({ connected: false, provider: pay.name, test: pay.test, note: "Payouts by Stripe Connect are coming. For now we send what you've earned by bank transfer within 5 working days of the event.",
      lines: L.map((r) => { const paid = (r.payments || []).filter((p) => p.state === "charged").reduce((a, p) => a + p.cents, 0), fee = r.price?.feeCents || 0, st = statusOf(r); return { id: r.id, pkgName: r.pkgName, company: r.company, date: r.date, paidCents: paid, totalCents: r.price?.totalCents || 0, feeCents: fee, state: st === "done" ? "Payout on its way" : st === "cancelled" ? "Cancelled" : "Held until the event" }; }) }); });

  // verification: email (from sign-up), phone (a code by text), ID (manual review now, a provider later), insurance
  app.post("/api/bb/host/verify/phone", small, async (req, res) => { const H = hostMe(req, res); if (!H) return; if (limited("ph:" + H.ws, 6)) return bad(res, "Too many codes. Try again in an hour.", 429, "rate_limited");
    const number = clean(req.body?.phone, 30); if (!/^\+?[\d\s().-]{7,20}$/.test(number)) return bad(res, "That doesn't look like a phone number.");
    const code = String(crypto.randomInt(100000, 999999)), V = verifyOf(H.ws); V.phone = { number, hash: crypto.createHash("sha256").update(code + H.ws).digest("hex"), sentAt: Date.now(), tries: 0 };
    S0(H.ws).set("teambook/verify", V); const r = await sendSms(smsConfig(), { to: number, text: `Your Pottery Lab code is ${code}` });
    res.json({ ok: r.ok, message: r.ok ? "We texted you a code." : "Texting isn't set up here yet, so we'll check your number by hand." }); });
  app.post("/api/bb/host/verify/phone/confirm", small, (req, res) => { const H = hostMe(req, res); if (!H) return; const V = verifyOf(H.ws); if (!V.phone?.hash) return bad(res, "Ask for a code first.");
    if ((V.phone.tries || 0) >= 5 || Date.now() - V.phone.sentAt > 15 * 60e3) return bad(res, "That code has expired. Ask for a new one.", 410, "expired");
    V.phone.tries = (V.phone.tries || 0) + 1; const ok = V.phone.hash === crypto.createHash("sha256").update(String(req.body?.code || "").trim() + H.ws).digest("hex");
    if (ok) { V.phone.verifiedAt = Date.now(); delete V.phone.hash; } S0(H.ws).set("teambook/verify", V); return ok ? res.json({ ok: true }) : bad(res, "That code didn't match."); });
  // TODO(id-provider): send the host to an ID check provider (document + selfie) and take its webhook as the decision.
  // Until then a person on the Pottery Lab team reviews each request at /admin/hosts and approves or declines it.
  app.post("/api/bb/host/verify/id", small, (req, res) => { const H = hostMe(req, res); if (!H) return; const V = verifyOf(H.ws), legal = clean(req.body?.legalName, 120); if (legal.length < 3) return bad(res, "Add your full legal name, as it is on your ID.");
    if (V.id?.state === "approved") return bad(res, "You're already ID checked.", 409, "conflict");
    V.id = { state: "pending", legalName: legal, submittedAt: Date.now(), method: "manual" }; S0(H.ws).set("teambook/verify", V); res.json({ id: { state: "pending" }, message: "Thanks. Someone on our team will check it within 2 working days and email you." }); });
  app.post("/api/bb/host/coi", (req, res) => { const H = hostMe(req, res); if (!H) return; const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size <= 6 * 1048576) chunks.push(c); }); req.on("end", () => { if (size > 6 * 1048576) return bad(res, "Certificates can be up to 6 MB.", 413, "too_large");
      const buf = Buffer.concat(chunks), type = buf.slice(0, 4).toString() === "%PDF" ? "application/pdf" : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf.slice(1, 4).toString() === "PNG" ? "image/png" : "";
      if (!type) return bad(res, "Upload a PDF, JPEG or PNG.", 415, "unsupported_type");
      const expires = ISO.test(String(req.query.expires || "")) ? req.query.expires : ""; if (expires && expires < isoDay()) return bad(res, "That certificate has expired. Upload the current one.");
      const file = "coi-" + rid(10); try { fs.mkdirSync(assetsDir, { recursive: true }); fs.writeFileSync(path.join(assetsDir, file), buf); } catch { return bad(res, "Couldn't save it. Try again.", 500, "error"); }
      const V = verifyOf(H.ws); V.coi = { file, type, insurer: clean(req.query.insurer, 80), expires, name: clean(req.query.name, 80) || "certificate", uploadedAt: Date.now() }; S0(H.ws).set("teambook/verify", V);
      res.json({ coi: { insurer: V.coi.insurer, expires, onFile: true, name: V.coi.name } }); }); });

  // the team's manual ID review
  const admin = (req, res) => { const u = me(req); if (!u || !isAdmin(u.email)) { res.status(404).json({ code: "not_found", message: "Not found." }); return null; } return u; };
  app.get("/api/bb/admin/verifications", (req, res) => { if (!admin(req, res)) return; const out = [];
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const V = verifyOf(ws); if (!V.id || V.id.state === "none") continue; const h = C.profileOf(ws) || {};
      out.push({ handle: h.handle, name: h.name, email: ownerEmailOf(ws), legalName: V.id.legalName, state: V.id.state, submittedAt: V.id.submittedAt, reviewedAt: V.id.reviewedAt || 0 }); }
    res.set("Cache-Control", "private, no-store").json({ verifications: out.sort((a, b) => (a.state === "pending" ? -1 : 1) - (b.state === "pending" ? -1 : 1) || b.submittedAt - a.submittedAt) }); });
  app.post("/api/bb/admin/verifications/:handle", small, (req, res) => { const a = admin(req, res); if (!a) return; const ws = C.wsOfHandle(lc(req.params.handle)); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    const V = verifyOf(ws); if (!V.id) return bad(res, "Nothing to review.", 409, "conflict"); V.id = { ...V.id, state: req.body?.approve ? "approved" : "declined", reviewedAt: Date.now(), reviewedBy: lc(a.email), note: clean(req.body?.note, 300) };
    S0(ws).set("teambook/verify", V); tell(ownerEmailOf(ws), req.body?.approve ? "You're ID checked. The badge is on your team listings now." : "We couldn't confirm your ID. Reply to our email and we'll sort it out.", "/host/teams#trust"); res.json({ ok: true, state: V.id.state }); });

  return { statsOf, reqGet, reqSet };
}

const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function invoiceHtml(I) {
  const row = (l, c) => `<tr><td>${escH(l)}</td><td class="n">${money(c)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${escH(I.number)} · Pottery Lab</title>
<link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/brandbook.css"></head><body class="bb bb-invoice"><main class="bb-wrap bb-narrow">
<div class="bb-inv-head"><div><p class="bb-kicker">Invoice</p><h1>${escH(I.number)}</h1><p class="bb-meta">Issued ${escH(I.issued)}${I.dueDate ? ` · Balance due ${escH(I.dueDate)}` : ""}</p></div><button class="bb-btn" onclick="print()">Save as PDF</button></div>
<div class="bb-inv-parties"><section><h2>From</h2><p><b>${escH(I.seller.name)}</b><br>Booked through Pottery Lab${I.seller.taxId ? `<br>Tax ID ${escH(I.seller.taxId)}` : ""}</p></section>
<section><h2>Bill to</h2><p><b>${escH(I.buyer.company)}</b>${I.buyer.contact ? `<br>${escH(I.buyer.contact)}` : ""}${I.buyer.address ? `<br>${escH(I.buyer.address).replace(/\n/g, "<br>")}` : ""}${I.buyer.taxId ? `<br>VAT / Tax ID ${escH(I.buyer.taxId)}` : ""}${I.buyer.po ? `<br>PO ${escH(I.buyer.po)}` : ""}</p></section></div>
<p class="bb-meta">${escH(I.what)} · ${escH(I.date)} · ${I.headcount} people</p>
<table class="bb-lines"><tbody>${I.lines.map((l) => row(l.label, l.cents)).join("")}</tbody><tfoot><tr><th>Total</th><th class="n">${money(I.totalCents)}</th></tr><tr><td>Paid</td><td class="n">${money(I.paidCents)}</td></tr><tr><th>Balance due</th><th class="n">${money(I.dueCents)}</th></tr></tfoot></table>
<p class="bb-meta">Questions about this invoice? Message the host from your booking on Pottery Lab.</p></main></body></html>`;
}
