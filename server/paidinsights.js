// Paid Insights: "what events are popular in what cities, what formats, and who comes", for brands and hosts.
// Built on the trends engine (server/trends.js): the same records (public events only, real accounts only, hourly
// cache), the same minimum sample (MIN_HOSTS hosts and MIN_GUESTS guests), the same formats and the same smoothing.
// Nothing here reads events, replies or kudos directly.
//
//   Market Insights (brands, per seat, /teams/market)
//     explore ....... city, neighbourhood, format, season, day of week, time of day, price band, and a window of 30,
//                     90 or 365 days. Each cell: fill rate, waitlists, would go again, repeat guests, typical price,
//                     hosts and events, with what it's based on ("from 18 events, last 90 days").
//     movers ........ formats rising and falling month over month (this 30 days against the 30 before), only when
//                     both months meet the minimum. Trend notes (server/trendnotes.js) sit beside them, labelled
//                     "Trending on social", never mixed in.
//     hosts ......... "Supper clubs in Austin fill 40% above average; 6 hosts run them", then the hosts who run the
//                     format, only hosts with a public page, linking to their page and to Quick book. No guest data.
//     export ........ a CSV of the current view: the same aggregate rows, nothing else.
//     digest ........ a monthly email per seat, with its own one-click off link; global unsubscribes are respected.
//     demo .......... a brand demo sandbox (/teams/demo, server/branddemo.js) sees a made-up dataset, every number
//                     labelled Example, so a field marketer sees it working before there's real volume.
//   Host Insights (hosts, /host/insights): their city, their formats. Best day, time and price band, fill speed,
//     waitlist and repeat-guest rates, and how their events compare with similar ones, only when the comparison group
//     meets the minimum. Other hosts are never named or singled out. Free teaser stays on Home (public/trendideas.js).
//   Demographics (phase two): opt-in fields in Settings (age band, how you heard, what you're into, neighbourhood).
//     Off for viewers until ENCORE_DEMOGRAPHICS_MIN_OPTINS people have opted in.
//
// Privacy rules, kept here and tested (test/paid-insights.test.js):
//   1. Aggregates only. No event id, guest, email or name is in any answer or CSV. Hosts are named only in the hosts
//      list, only with a public page, and only with public facts (their page, area, how many public events).
//   2. Never counted: private, friends-only, members-only, unlisted, examples, samples, previews (trends countsPublicly).
//   3. Minimum sample for event cells: MIN_HOSTS hosts and MIN_GUESTS guests, else "Not enough yet" with no numbers.
//      Complementary suppression: when the cells hidden in a breakdown would together still fall under the minimum
//      (so the total minus the shown ones would give them away), the smallest shown cells are hidden too.
//   4. k-anonymity for demographics: a cell shows only with at least K people (ENCORE_INSIGHTS_K, 25). Smaller cells
//      roll up into "Other"; when "Other" itself is under K the smallest shown cells join it; when the whole cut is
//      under K it rolls up to the city, else "Not enough yet". A filtered cut is also checked against its city-level
//      parent: a value whose parent count minus this count is between 1 and K-1 is folded into Other, and a cut whose
//      parent total minus this total is between 1 and K-1 is hidden, so two views can't be subtracted.
//   5. Consent: demographics count only for people who turned them on, each field can be removed any time, and
//      removing deletes the record. Brands never see guest lists here; per-event guest-list consent is unchanged
//      (server/campaigns.js, server/brandpanel.js).
//   6. Editorial notes are labelled "Trending on social" and never counted as measured.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { scopeStore, getWorkspace, membersOf, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { FORMATS, FORMAT_BY, MIN_HOSTS, MIN_GUESTS, smooth } from "./trends.js";
import { fits, seasonOf } from "./trendnotes.js";
import { stripeApi, verifyStripe } from "./memberships.js";
import { emailConfig, sendEmail, isUnsubscribed, EMAIL_RE } from "./email.js";
import { isAdmin } from "./metrics.js";
import { exampleSetups } from "./brandexamples.js";

// the webhook needs the raw body for its signature; the email off-link form posts url-encoded
const rawBody = express.raw({ type: () => true, limit: "1mb" });
const urlencoded = express.urlencoded({ extended: false, limit: "4kb" });

const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 80) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const h24 = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const pct = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100));
const median = (L) => { const s = L.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
export const money = (c) => (c == null ? "" : c === 0 ? "Free" : "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)));

// ---------- settings ----------
export const SETTINGS = {
  k: () => Math.max(5, Math.floor(+process.env.ENCORE_INSIGHTS_K) || 25),
  hostCents: () => Math.max(0, Math.floor(+process.env.ENCORE_HOST_INSIGHTS_CENTS) || 1000),
  seatCents: () => Math.max(0, Math.floor(+process.env.ENCORE_MARKET_INSIGHTS_SEAT_CENTS) || 4900),
  demoMin: () => Math.max(1, Math.floor(+process.env.ENCORE_DEMOGRAPHICS_MIN_OPTINS) || 250),
  demographics: () => process.env.ENCORE_DEMOGRAPHICS !== "0",
  digest: () => process.env.ENCORE_INSIGHTS_DIGEST !== "0",
};
/** Stripe for Paid Insights: on with a secret key and a webhook secret (its own, or the shared one). */
export function billingConfig(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || "").trim(), whsec = String(env.STRIPE_INSIGHTS_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET || "").trim();
  const keyOk = /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(key), hookOk = /^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(whsec);
  return { on: keyOk && hookOk, key, whsec, test: /_test_/.test(key) };
}

// ---------- the cuts ----------
const WD = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
export const todOf = (h) => (h == null ? null : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "late");
export const priceBandOf = (c) => (c == null ? null : c === 0 ? "free" : c < 2500 ? "u25" : c < 6000 ? "p25" : c < 12000 ? "p60" : "p120");
export const DIMS = {
  format: { label: "Format", of: (r) => r.format || null, values: () => FORMATS.map((f) => [f.key, f.label]) },
  city: { label: "City", of: (r) => (r.city ? lc(r.city) : null), values: null },
  hood: { label: "Neighbourhood", of: (r) => (r.hood ? lc(r.hood) : null), values: null },
  season: { label: "Season", of: (r) => r.season || null, values: () => [["winter", "Winter"], ["spring", "Spring"], ["summer", "Summer"], ["autumn", "Autumn"]] },
  dow: { label: "Day of week", of: (r) => (r.dow == null ? null : String(r.dow)), values: () => [1, 2, 3, 4, 5, 6, 0].map((d) => [String(d), WD[d]]) },
  tod: { label: "Time of day", of: (r) => todOf(r.hour), values: () => [["morning", "Mornings, before noon"], ["afternoon", "Afternoons, noon to 5"], ["evening", "Evenings, 5 to 9"], ["late", "Late, after 9"]] },
  price: { label: "Price a person", of: (r) => priceBandOf(r.priceCents), values: () => [["free", "Free"], ["u25", "Under $25"], ["p25", "$25 to $60"], ["p60", "$60 to $120"], ["p120", "$120 and up"]] },
};
export const WINDOWS = { 30: "last 30 days", 90: "last 90 days", 365: "last 12 months" };
const winOf = (w) => (WINDOWS[+w] ? +w : 90);
const titleCase = (s) => String(s || "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Clean a query into filters. Unknown values are dropped. */
export function cleanQuery(q = {}) {
  const f = {}; for (const k of Object.keys(DIMS)) { const v = lc(clean(q[k], 60)); if (!v) continue; if (k === "city" || k === "hood") f[k] = v; else if (DIMS[k].values().some(([x]) => x === v)) f[k] = v; }
  return { filters: f, window: winOf(q.window), by: DIMS[q.by] ? q.by : "format", metric: METRICS.some(([m]) => m === q.metric) ? q.metric : "fillPct" };
}
export const METRICS = [["fillPct", "Fill rate"], ["waitlistPct", "Events with a waitlist"], ["againPct", "Would go again"], ["repeatPct", "Repeat guests"], ["priceCents", "Typical price"], ["hosts", "Hosts"], ["events", "Events"]];
const inWindow = (r, w) => r.past && r.age >= 0 && r.age <= w;
export function filterRecs(recs, filters = {}, window = 90) {
  return recs.filter((r) => inWindow(r, window) && Object.entries(filters).every(([k, v]) => DIMS[k].of(r) === v));
}

/** One cell: aggregate numbers when the minimum sample is met, else "Not enough yet" with no numbers at all. */
export function cellStats(R, window = 90) {
  const hosts = new Set(R.map((r) => r.ws)).size, guests = R.reduce((n, r) => n + (r.guests || 0), 0), events = R.length;
  const enough = hosts >= MIN_HOSTS() && guests >= MIN_GUESTS();
  if (!enough) return { enough: false, label: "Not enough yet", basis: `Needs ${MIN_HOSTS()} hosts and ${MIN_GUESTS()} guests, ${WINDOWS[window]}` };
  const F = R.filter((r) => r.fill != null), aOf = R.reduce((n, r) => n + (r.againOf || 0), 0), aYes = R.reduce((n, r) => n + (r.againYes || 0), 0), rep = R.reduce((n, r) => n + (r.repeat || 0), 0);
  const fd = R.map((r) => r.fillDays).filter((v) => v != null);
  return { enough: true, events, hosts, guests, fillPct: F.length ? pct(F.reduce((n, r) => n + r.fill, 0) / F.length) : null, waitlistPct: pct(R.filter((r) => r.waitlist > 0).length / events),
    againPct: aOf >= 5 ? pct(aYes / aOf) : null, repeatPct: guests ? pct(rep / guests) : null, priceCents: median(R.map((r) => r.priceCents)), fillDays: fd.length >= 3 ? median(fd) : null,
    basis: `from ${events} ${events === 1 ? "event" : "events"}, ${WINDOWS[window]}` };
}
const labelFor = (by, v, R) => { const L = DIMS[by].values?.(); const hit = L?.find(([x]) => x === v); if (hit) return hit[1]; const r = R.find((y) => DIMS[by].of(y) === v); return clean(by === "city" ? r?.city : by === "hood" ? r?.hood : v, 60) || titleCase(v); };

/**
 * A breakdown of the filtered records by one dimension. Rows that miss the minimum say "Not enough yet". When the
 * hidden rows together would still miss it (total minus the shown rows would point at them), the smallest shown
 * rows are hidden too, until the hidden part meets the minimum or nothing is shown.
 */
export function breakdown(R, by, window = 90) {
  const G = new Map(); for (const r of R) { const v = DIMS[by].of(r); if (v == null) continue; if (!G.has(v)) G.set(v, []); G.get(v).push(r); }
  let rows = [...G.entries()].map(([v, L]) => ({ value: v, label: labelFor(by, v, L), recs: L, s: cellStats(L, window) }));
  const gate = (L) => new Set(L.map((r) => r.ws)).size >= MIN_HOSTS() && L.reduce((n, r) => n + (r.guests || 0), 0) >= MIN_GUESTS();
  const hiddenRecs = () => rows.filter((x) => !x.s.enough || x.secondary).flatMap((x) => x.recs);
  for (let guard = 0; guard < rows.length; guard++) { const H = hiddenRecs(); if (!H.length || gate(H)) break;
    const next = rows.filter((x) => x.s.enough && !x.secondary).sort((a, b) => a.s.guests - b.s.guests || a.s.events - b.s.events)[0]; if (!next) break; next.secondary = true; }
  const order = DIMS[by].values?.()?.map(([x]) => x);
  rows.sort((a, b) => (order ? order.indexOf(a.value) - order.indexOf(b.value) : (b.s.enough ? b.s.guests : 0) - (a.s.enough ? a.s.guests : 0) || a.label.localeCompare(b.label)));
  return rows.map((x) => (x.s.enough && !x.secondary ? { value: x.value, label: x.label, ...x.s } : { value: x.value, label: x.label, enough: false, label2: "Not enough yet", basis: x.secondary ? "Hidden so the smaller ones next to it stay private" : x.s.basis }));
}

/** The explore view: an overall cell and a breakdown, for one set of filters and a window. */
export function explore(recs, q = {}) {
  const { filters, window, by, metric } = cleanQuery(q), R = filterRecs(recs, filters, window);
  const cities = [...new Map(recs.filter((r) => r.city && inWindow(r, 365)).map((r) => [lc(r.city), clean(r.city, 60)])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  const hoods = filters.city ? [...new Map(recs.filter((r) => r.hood && lc(r.city) === filters.city && inWindow(r, 365)).map((r) => [lc(r.hood), clean(r.hood, 60)])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })) : [];
  return { filters, window, windowLabel: WINDOWS[window], by, byLabel: DIMS[by].label, metric, overall: cellStats(R, window), rows: breakdown(R, by, window), cities, hoods,
    formats: FORMATS.map((f) => ({ value: f.key, label: f.label })), min: { hosts: MIN_HOSTS(), guests: MIN_GUESTS() } };
}

/** Formats rising and falling: this 30 days against the 30 before, both months at the minimum. */
export function movers(recs, { city = "" } = {}) {
  const C = lc(city), R = recs.filter((r) => r.past && r.format && (!C || lc(r.city) === C)), out = [];
  for (const f of FORMATS) { const L = R.filter((r) => r.format === f.key), cur = L.filter((r) => r.age >= 0 && r.age < 30), prev = L.filter((r) => r.age >= 30 && r.age < 60);
    const a = cellStats(cur, 30), b = cellStats(prev, 30); if (!a.enough || !b.enough) continue;
    const change = Math.round(((a.guests - b.guests) / b.guests) * 100);
    out.push({ format: f.key, label: f.label, change, dir: change >= 15 ? "rising" : change <= -15 ? "falling" : "steady", guestsNow: a.guests, guestsBefore: b.guests, basis: `from ${a.events} events this month and ${b.events} the month before${C ? ", " + clean(R.find((r) => lc(r.city) === C)?.city, 60) : ""}` }); }
  out.sort((x, y) => y.change - x.change);
  return { rising: out.filter((x) => x.dir === "rising"), falling: out.filter((x) => x.dir === "falling").reverse(), steady: out.filter((x) => x.dir === "steady"),
    note: "Month over month: guests in the last 30 days against the 30 before. A format shows only when both months meet the minimum." };
}

/** How much better a group fills than everything in the same place: smoothed, so a few events can't claim much. */
function fillLift(R, all) { const F = R.filter((r) => r.fill != null), A = all.filter((r) => r.fill != null); if (F.length < 3 || A.length < 3) return null;
  const avg = A.reduce((n, r) => n + r.fill, 0) / A.length, g = smooth(F.reduce((n, r) => n + r.fill, 0), F.length, avg, 3); return avg > 0 ? Math.round((g / avg - 1) * 100) : null; }

/**
 * Hosts who run a format well in a city. Only when the format there meets the minimum. Only hosts with a public page;
 * what shows about each is public already: name, page, area, how many public events of this kind.
 * hostInfo(ws) -> { handle, name, area, link, example } or null.
 */
export function hostsFor(recs, { format, city, window = 365 }, hostInfo) {
  const f = FORMAT_BY.get(format), C = lc(city); if (!f || !C) return { enough: false, label: "Pick a format and a city to see who runs it", hosts: [] };
  const all = recs.filter((r) => inWindow(r, window) && lc(r.city) === C), R = all.filter((r) => r.format === format), s = cellStats(R, window);
  const cityName = clean(R[0]?.city || all[0]?.city || titleCase(C), 60);
  if (!s.enough) return { enough: false, label: "Not enough yet", basis: s.basis, hosts: [] };
  const lift = fillLift(R, all), by = new Map(); for (const r of R) { if (!by.has(r.ws)) by.set(r.ws, []); by.get(r.ws).push(r); }
  const P = { again: 0.6, fill: 0.6 }, hosts = [];
  for (const [ws, L] of by) { const h = hostInfo(ws); if (!h || !h.handle) continue; if (L.length < 2) continue;
    const yes = L.reduce((n, r) => n + r.againYes, 0), of = L.reduce((n, r) => n + r.againOf, 0), F = L.filter((r) => r.fill != null);
    const rank = smooth(yes, of, P.again, 10) * 0.5 + smooth(F.reduce((n, r) => n + r.fill, 0), F.length, P.fill, 3) * 0.5; // ranking only, never shown
    hosts.push({ name: clean(h.name, 60), handle: h.handle, area: clean(h.area, 60), link: h.link, quickBook: h.quickBook, example: !!h.example, events: L.length, line: `${L.length} public ${L.length === 1 ? f.one : f.many} ${WINDOWS[window]}`, _r: rank }); }
  hosts.sort((a, b) => b._r - a._r || b.events - a.events); hosts.forEach((h) => delete h._r);
  const head = lift != null && lift >= 5 ? `${f.label} in ${cityName} fill ${lift}% above average; ${s.hosts} hosts run them` : lift != null && lift <= -5 ? `${f.label} in ${cityName} fill ${-lift}% below average; ${s.hosts} hosts run them` : `${f.label} in ${cityName} fill about as well as average; ${s.hosts} hosts run them`;
  return { enough: true, headline: head, basis: s.basis + `, against every format in ${cityName}`, liftPct: lift, hostsTotal: s.hosts, hosts: hosts.slice(0, 8) };
}

// ---------- demographics ----------
let INTERESTS = null;
function interestOptions() { if (INTERESTS) return INTERESTS; try { const j = JSON.parse(fs.readFileSync(new URL("../public/interests.json", import.meta.url), "utf8")); INTERESTS = (j.interests || []).map((i) => [i.id, i.label]).slice(0, 30); } catch { INTERESTS = []; } return INTERESTS; }
export const FIELDS = {
  age: { label: "Age band", why: "So hosts can plan for who comes, and brands can see which ages a kind of event suits. A band, never your birthday.", options: () => [["18-24", "18 to 24"], ["25-34", "25 to 34"], ["35-44", "35 to 44"], ["45-54", "45 to 54"], ["55-64", "55 to 64"], ["65+", "65 and over"], ["na", "Prefer not to say"]] },
  heard: { label: "How you heard about Pottery Lab", why: "So hosts know which ways of spreading the word bring people in.", options: () => [["friend", "A friend"], ["host", "A host's page or invite"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["search", "Search"], ["work", "Work or a brand event"], ["poster", "A poster or flyer"], ["other", "Somewhere else"], ["na", "Prefer not to say"]] },
  into: { label: "What you're into", why: "So hosts and brands can see which interests come to which kinds of events. Pick up to 5.", multi: 5, options: interestOptions },
  hood: { label: "Your neighbourhood", why: "So hosts can see how far people travel to their events. A neighbourhood, never a street or an address.", text: 40 },
};
export const demoKey = (email) => "system/pldemo-" + h24(email);
/** One person's answers, cleaned. Prefer not to say is kept as an answer and never counted. */
export function cleanProfile(b = {}, cur = {}) {
  const out = { ...cur };
  for (const [k, F] of Object.entries(FIELDS)) { if (!(k in b)) continue; const v = b[k];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) { delete out[k]; continue; }
    if (F.text) { const t = clean(v, F.text).replace(/[^\p{L}\p{N} '&.-]/gu, "").trim(); if (t.length >= 2) out[k] = t; else delete out[k]; continue; }
    const ok = new Set(F.options().map(([x]) => x));
    if (F.multi) { const L = [...new Set((Array.isArray(v) ? v : String(v).split(",")).map(lc).filter((x) => ok.has(x)))].slice(0, F.multi); if (L.length) out[k] = L; else delete out[k]; }
    else if (ok.has(lc(v))) out[k] = lc(v); else delete out[k]; }
  return out;
}
const answers = (p, field) => { const v = p?.[field]; if (v == null) return []; const L = Array.isArray(v) ? v : [v]; return L.map((x) => (field === "hood" ? lc(x) : x)).filter((x) => x && x !== "na"); };
const band = (n, K) => (n >= 1000 ? "1,000+" : n >= 100 ? `${Math.floor(n / 50) * 50}+` : `${Math.max(K, Math.floor(n / 25) * 25)}+`);

/** Count distinct opted-in people in records by one field's answers. */
function countBy(R, profiles, field) { const people = new Set(); for (const r of R) for (const g of r.gk || []) people.add(g);
  const C = new Map(); let total = 0; for (const g of people) { const A = answers(profiles.get(g), field); if (!A.length) continue; total++; for (const a of A) C.set(a, (C.get(a) || 0) + 1); }
  return { C, total }; }
/**
 * One demographic cut with k-anonymity: values under K roll up into Other; Other under K pulls the smallest shown
 * values in; with a parent (the same cut for the whole city), values and totals that could be subtracted are folded.
 * Returns { shown, total band, cells: [{ value, label, pct }] } or { shown: false, label: "Not enough yet" }.
 */
export function demoCut(R, profiles, field, { K = SETTINGS.k(), parent = null } = {}) {
  const F = FIELDS[field], { C, total } = countBy(R, profiles, field);
  const no = { shown: false, field, label: F.label, why: `Not enough yet. A cut shows once ${K} people who chose to share are behind each part.` };
  if (total < K) return no;
  let P = null; if (parent) { P = countBy(parent, profiles, field); const d = P.total - total; if (d > 0 && d < K) return { ...no, why: "Hidden so this view can't be compared with the city to single anyone out." }; }
  const opts = new Map((F.options?.() || []).map(([v, l]) => [v, l]));
  let shown = [...C.entries()].filter(([v, n]) => n >= K && !(P && (P.C.get(v) || 0) - n > 0 && (P.C.get(v) || 0) - n < K)).map(([v, n]) => ({ v, n }));
  const keep = new Set(shown.map((x) => x.v)); let other = [...C.entries()].filter(([v]) => !keep.has(v)).reduce((s, [, n]) => s + n, 0);
  shown.sort((a, b) => a.n - b.n);
  // complementary suppression: "Other" is the total minus the shown cells, so it must hold K people too. A multi-pick
  // field (a person can pick several) has no "Other": its parts don't add up to the total, so nothing can be subtracted.
  if (!F.multi) while (other > 0 && other < K && shown.length) other += shown.shift().n;
  if (!shown.length) return no;
  const denom = total, cells = shown.sort((a, b) => b.n - a.n).map(({ v, n }) => ({ value: v, label: opts.get(v) || titleCase(v), pct: Math.round((n / denom) * 100) }));
  if (!F.multi && other >= K) cells.push({ value: "other", label: "Other", pct: Math.round((other / denom) * 100) });
  return { shown: true, field, label: F.label, multi: !!F.multi, people: band(total, K), basis: `from ${band(total, K)} people who chose to share`, cells };
}

// ---------- the example dataset for the marketer demo ----------
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const EXAMPLE_LABEL = "Example data, made up so you can see how Market Insights works. None of these are real events or people.";
const DEMO_CITIES = [["New York", ["Greenpoint", "Williamsburg", "Chelsea", "SoHo", "Fort Greene"]], ["Austin", ["East Austin", "South Congress", "Hyde Park"]], ["Chicago", ["Logan Square", "Pilsen", "Wicker Park"]], ["San Francisco", ["Mission", "Hayes Valley", "Inner Sunset"]]];
const DEMO_FORMATS = [["supper-club", 1.4, 7500, 19], ["run-coffee", 1.2, 0, 8], ["pottery-class", 1.1, 6500, 18], ["game-night", 1, 1500, 19], ["coffee-popup", 1, 1200, 10], ["book-club", 0.8, 0, 19], ["wine", 0.9, 4500, 19], ["sound-bath", 0.7, 3500, 10], ["mahjong", 0.8, 2000, 19], ["picnic", 0.6, 0, 13], ["craft-night", 0.9, 4000, 19], ["dinner-party", 0.8, 6000, 19]];
let DEMO = null;
const NAME_A = ["Juniper", "Marigold", "Quarry", "Hollow", "Fernway", "Lantern", "Saltbox", "Wren", "Copper", "Elm", "Tallow", "Birch", "Ember", "Driftwood", "Clover", "Harbor", "Meadow"];
const NAME_B = ["Table", "House", "Studio", "Club", "Kitchen", "Room", "Social", "Supper", "Circle", "Workshop", "Collective"];
/** The made-up world: records shaped like the trends engine's, made-up people with made-up answers, example hosts. */
export function demoWorld() {
  if (DEMO) return DEMO; const r = rng(20261127), pick = (L) => L[Math.floor(r() * L.length)], recs = [], profiles = new Map(), hosts = new Map();
  const ex = (() => { try { return exampleSetups(); } catch { return []; } })();
  const people = Array.from({ length: 1400 }, (_, i) => "demo-p" + i), ages = FIELDS.age.options().map(([v]) => v).filter((v) => v !== "na"), heard = FIELDS.heard.options().map(([v]) => v), into = interestOptions().map(([v]) => v);
  for (const [i, g] of people.entries()) { const [city, hoods] = DEMO_CITIES[i % DEMO_CITIES.length], a = r();
    profiles.set(g, { age: a < 0.06 ? "18-24" : a < 0.48 ? "25-34" : a < 0.78 ? "35-44" : a < 0.9 ? "45-54" : a < 0.96 ? "55-64" : a < 0.98 ? "65+" : "na", heard: r() < 0.4 ? "friend" : pick(heard), into: [...new Set([pick(into), pick(into), pick(into)])], hood: pick(hoods), _city: city }); }
  let hid = 0;
  for (const [city, hoods] of DEMO_CITIES) for (const [fmt, pop, price, hour] of DEMO_FORMATS) {
    const n = Math.round((city === "New York" ? 5 : 3) + pop * 2), cityPeople = people.filter((g) => profiles.get(g)._city === city);
    for (let h = 0; h < n; h++) { const ws = "demo-h" + ++hid, hood = pick(hoods), f = FORMAT_BY.get(fmt), real = city === "New York" ? ex[hid % Math.max(1, ex.length)] : null;
      hosts.set(ws, { handle: real?.h?.handle || "", pkg: real?.s?.packages?.find((p) => p.on)?.id || "", name: real?.h?.name ? `${real.h.name} (example)` : `${NAME_A[hid % NAME_A.length]} ${NAME_B[(hid * 7) % NAME_B.length]} (example)`, area: hood, city, example: true });
      const k = 3 + Math.floor(r() * 6);
      for (let e = 0; e < k; e++) { const trend = fmt === "mahjong" || fmt === "sound-bath" ? 2.2 : fmt === "picnic" ? 0.5 : 1; let age = Math.floor(r() ** trend * 200); if (fmt === "picnic" && age < 40) age += 30; // rising, falling and steady formats
        const cap = 8 + Math.floor(r() * 16), fillBase = Math.min(1, 0.55 + pop * 0.25 + (r() - 0.5) * 0.3), guests = Math.max(3, Math.round(cap * fillBase)), dow = r() < 0.55 ? pick([5, 6]) : pick([0, 1, 2, 3, 4]);
        const gk = Array.from({ length: guests }, () => pick(cityPeople)), repeat = Math.floor(guests * (0.1 + r() * 0.25)), againOf = Math.floor(guests * 0.6);
        recs.push({ ws, format: fmt, type: f.type, city, hood, age, past: true, dow, season: seasonOf(Date.now() - age * DAY), guests, fill: Math.min(1, guests / cap), waitlist: fillBase > 0.92 ? Math.floor(r() * 6) : 0,
          againYes: Math.round(againOf * (0.6 + pop * 0.2)), againOf, saves: 0, vouches: 0, buzz: 0, follows: 0, repeat, priceCents: price ? price + Math.round((r() - 0.5) * 2000 / 500) * 500 : 0, hour: hour + (r() < 0.3 ? 1 : 0), cap, fillDays: Math.round(r() * 12 * 10) / 10, gk: [...new Set(gk)], example: true }); } } }
  DEMO = { recs, profiles, hosts }; return DEMO;
}

// ---------- the engine around it ----------
export function makePaidInsights({ store, C, T, locals = {}, clock = () => Date.now() }) {
  const recsOf = (demo) => (demo ? demoWorld().recs : T.compute(clock()).recs);
  // opted-in people: hashed key -> answers. Rebuilt at most once a minute, and after every change.
  let prof = null;
  function profiles() { if (prof && clock() - prof.at < 60e3) return prof; const M = new Map(); let n = 0;
    try { for (const d of store.listPrefix("system", "pldemo-")) { const v = d.data; if (v?.kind !== "pldemo" || v.on !== true || !v.email) continue; n++; M.set(h24(v.email), v); } } catch {}
    prof = { at: clock(), map: M, n }; return prof; }
  const bust = () => { prof = null; };
  /** Are demographic cuts switched on for viewers? Off until enough people opted in. The demo world always has them. */
  const demoState = (demo) => (!SETTINGS.demographics() ? "off" : demo || profiles().n >= SETTINGS.demoMin() ? "on" : "collecting");

  function demographics(q = {}, demo = false) {
    const st = demoState(demo); if (st !== "on") return { state: st, note: st === "off" ? "Who comes is off on this site." : `Who comes switches on once ${SETTINGS.demoMin()} people have chosen to share in Settings. Until then, nothing shows.` };
    const { filters, window } = cleanQuery(q), all = recsOf(demo), R = filterRecs(all, filters, window), P = demo ? demoWorld().profiles : profiles().map, K = SETTINGS.k();
    const narrowed = Object.keys(filters).some((k) => k !== "city"), parent = filters.city && narrowed ? filterRecs(all, { city: filters.city }, window) : null;
    const cuts = Object.keys(FIELDS).map((field) => { let c = demoCut(R, P, field, { K, parent });
      if (!c.shown && parent) { const up = demoCut(parent, P, field, { K }); if (up.shown) c = { ...up, rolledUp: true, note: `Showing ${clean(parent[0]?.city, 60)} as a whole: not enough in this view yet.` }; }
      return c; });
    return { state: "on", k: K, cuts, note: `Opt-in answers only. Each part shows only with ${K} or more people behind it.` };
  }

  // hosts with a public page: name, page, area. Examples only in the demo.
  function hostInfo(ws, demo) {
    if (demo) { const h = demoWorld().hosts.get(ws); if (!h) return null; return { handle: h.handle || "example", name: h.name, area: h.area, example: true, link: h.handle && h.pkg ? `/teams/x/${h.handle}/${h.pkg}` : "", quickBook: `/teams/home?city=${encodeURIComponent(h.city)}#quick` }; }
    let p = null; try { p = C.profileOf(ws); } catch {} const W = getWorkspace(ws); if (!p?.handle || p.directory === false || !W || W.plan !== "friends") return null;
    return { handle: p.handle, name: p.name || p.handle, area: p.hood || p.city || "", link: "/@" + p.handle, quickBook: `/teams/home?city=${encodeURIComponent(p.city || "")}#quick` };
  }
  const notesFor = (city) => { try { return T.notes.active(clock()).filter((n) => fits(n, { season: seasonOf(clock()), city })).slice(0, 6).map((n) => ({ name: n.name, line: n.line, where: n.where, label: "Trending on social", about: "An editorial note from the Pottery Lab team. Not measured." })); } catch { return []; } };

  function market(q = {}, { demo = false } = {}) {
    const all = recsOf(demo), x = explore(all, q), city = x.filters.city ? x.cities.find((c) => c.value === x.filters.city)?.label || x.filters.city : "";
    return { ...x, movers: movers(all, { city: x.filters.city }), editorial: notesFor(city), hostsRun: x.filters.format && x.filters.city ? hostsFor(all, { format: x.filters.format, city: x.filters.city }, (ws) => hostInfo(ws, demo)) : null,
      who: demographics(q, demo), ...(demo ? { example: true, exampleLabel: EXAMPLE_LABEL, about: "Example data for the demo, made up. Real numbers come from public events only." } : { about: "Counts from public events on Pottery Lab. Private, members-only, example and sample events are never counted." }) };
  }

  // ---- Host Insights ----
  function host(u) {
    const p = T.personOf(u, clock()), all = recsOf(false), mine = all.filter((r) => r.ws === u.ws && r.past && r.age <= 365), city = p.city || clean(mine[0]?.city, 60);
    const fmts = [...new Set([...mine.map((r) => r.format), ...(p.recent || [])].filter(Boolean))].slice(0, 3);
    const C0 = lc(city), W = 365, peersOf = (fk) => all.filter((r) => r.ws !== u.ws && r.format === fk && lc(r.city) === C0 && inWindow(r, W));
    const best = (R, dim) => { const rows = breakdown(R, dim, W).filter((x) => x.enough && x.fillPct != null); if (!rows.length) return { label: "Not enough yet" };
      const b = rows.sort((a, c) => (c.fillPct + (c.againPct ?? c.fillPct)) - (a.fillPct + (a.againPct ?? a.fillPct)))[0]; return { value: b.value, label: b.label, fillPct: b.fillPct, basis: b.basis }; };
    const formats = fmts.map((fk) => { const f = FORMAT_BY.get(fk); if (!f) return null; const peers = peersOf(fk), s = cellStats(peers, W), own = mine.filter((r) => r.format === fk);
      const ownS = (() => { if (!own.length) return null; const g = own.reduce((n, r) => n + r.guests, 0), F = own.filter((r) => r.fill != null), fd = own.map((r) => r.fillDays).filter((v) => v != null);
        return { events: own.length, fillPct: F.length ? pct(F.reduce((n, r) => n + r.fill, 0) / F.length) : null, waitlistPct: pct(own.filter((r) => r.waitlist > 0).length / own.length), repeatPct: g ? pct(own.reduce((n, r) => n + r.repeat, 0) / g) : null, fillDays: median(fd), basis: `from your ${own.length} public ${own.length === 1 ? f.one : f.many}, ${WINDOWS[W]}` }; })();
      const cmp = !ownS ? [] : !s.enough ? ["Not enough similar events yet to compare fairly."] : [["fillPct", "filled", "of their spots"], ["repeatPct", "had", "repeat guests"], ["waitlistPct", "had a waitlist", ""]].map(([k, verb, tail]) => {
        if (ownS[k] == null || s[k] == null) return ""; const d = ownS[k] - s[k], w = Math.abs(d) < 5 ? "about the same as" : d > 0 ? `${Math.abs(d)} points more than` : `${Math.abs(d)} points less than`;
        return k === "waitlistPct" ? `${ownS[k]}% of yours had a waitlist, ${w} similar ${f.many} in ${city} (${s[k]}%)` : `Yours ${verb} ${ownS[k]}% ${tail}, ${w} similar ${f.many} in ${city} (${s[k]}%)`; }).filter(Boolean);
      return { format: fk, label: f.label, city, peers: s.enough ? { ...s, basis: `${s.basis}, ${s.hosts} other hosts in ${city}` } : { enough: false, label: "Not enough yet", basis: s.basis },
        best: s.enough ? { day: best(peers, "dow"), time: best(peers, "tod"), price: best(peers, "price") } : null, you: ownS, compare: cmp }; }).filter(Boolean);
    return { city, formats, cityTop: city ? breakdown(filterRecs(all, { city: C0 }, 90), "format", 90).filter((x) => x.enough).slice(0, 5) : [], who: city ? demographics({ city: C0, window: 365 }) : { state: demoState(false) },
      about: "From public events on Pottery Lab only. Other hosts are never named, and a comparison shows only when enough similar events are behind it." };
  }

  // ---- access ----
  const S0 = (ws) => scopeStore(store, ws);
  const planOf = (ws, product) => S0(ws).get("paidinsights/" + product)?.data || null;
  const setPlan = (ws, product, patch) => { const cur = planOf(ws, product) || { product, seats: 0, seatsUsed: [] }; const v = { ...cur, ...patch, product, at: clock() }; S0(ws).set("paidinsights/" + product, v); return v; };
  const included = (ws) => { try { const c = locals.memberships?.config?.(ws); return !!(c?.on && (c.tiers || []).length); } catch { return false; } };
  /** What this person can see. Brands: a seat on an active team plan (taken on first open, while seats last). */
  function access(u) {
    const W = u && getWorkspace(u.ws); if (!W || u.ws === DEFAULT_WS) return { state: "signin" };
    if (W.plan === "friends") { const p = planOf(u.ws, "host"); return { product: "host", state: p?.on || included(u.ws) ? "open" : "locked", via: p?.on ? p.source : included(u.ws) ? "membership" : "", priceCents: SETTINGS.hostCents() }; }
    if (W.demo === true) return { product: "market", state: "open", via: "demo", example: true };
    const p = planOf(u.ws, "market"), em = lc(u.email); if (!p?.on) return { product: "market", state: "locked", priceCents: SETTINGS.seatCents() };
    let used = (p.seatsUsed || []).filter((e) => membersOf(u.ws).some((m) => lc(m.email) === e));
    if (!used.includes(em)) { if (used.length >= (p.seats || 0)) return { product: "market", state: "no_seat", seats: p.seats, priceCents: SETTINGS.seatCents() }; used = [...used, em]; setPlan(u.ws, "market", { seatsUsed: used }); }
    return { product: "market", state: "open", via: p.source, seats: p.seats, seatsUsed: used.length };
  }

  // ---- requests and manual grants (no Stripe) ----
  function request(u, b = {}) { const a = access(u); if (!a.product) return { error: "Sign in first." }; const product = a.product, W = getWorkspace(u.ws);
    const seats = product === "market" ? Math.max(1, Math.min(50, Math.floor(+b.seats) || 1)) : 1, id = `system/insreq-${u.ws}-${product}`;
    const v = { kind: "insreq", product, ws: u.ws, email: lc(u.email), team: clean(W?.name || W?.brand?.profile?.name || "", 80), seats, note: clean(b.note, 300), status: "open", at: clock() };
    store.set(id, v); return { ok: true, request: { product, seats, status: "open" } }; }
  const requestOf = (ws, product) => store.get(`system/insreq-${ws}-${product}`)?.data || null;
  function grant({ ws, product, seats = 1, on = true }, by = "") { const W = getWorkspace(ws); if (!W || ws === DEFAULT_WS) return { error: "No such team." };
    const want = W.plan === "friends" ? "host" : "market"; if (product && product !== want) return { error: `That's a ${W.plan === "friends" ? "host" : "brand team"}: ${want} insights.` };
    const v = setPlan(ws, want, { on: !!on, status: on ? "active" : "off", source: "admin", seats: want === "market" ? (on ? Math.max(1, Math.min(200, Math.floor(+seats) || 1)) : planOf(ws, want)?.seats || 1) : 1, grantedBy: by ? "admin" : "" });
    const r = requestOf(ws, want); if (r) store.set(`system/insreq-${ws}-${want}`, { ...r, status: on ? "granted" : "closed", doneAt: clock() });
    return { ok: true, plan: { product: want, on: v.on, seats: v.seats, source: v.source } }; }
  function adminList() {
    const reqs = store.listPrefix("system", "insreq-").map((d) => d.data).filter((x) => x?.kind === "insreq").sort((a, b) => b.at - a.at).slice(0, 200);
    const plans = []; for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; for (const product of ["market", "host"]) { const p = planOf(ws, product); if (p) plans.push({ ws, product, on: !!p.on, seats: p.seats || 0, seatsUsed: (p.seatsUsed || []).length, source: p.source || "", status: p.status || "", team: clean(getWorkspace(ws)?.name, 80) }); } }
    return { requests: reqs, plans }; }

  // ---- Stripe: Checkout for a monthly subscription, webhooks keep the plan current ----
  async function checkout(u, b = {}, origin = "") {
    const s = billingConfig(); if (!s.on) return { error: "Payments aren't set up here. Ask for access instead.", status: 409, code: "payments_off" };
    const a = access(u); if (!a.product) return { error: "Sign in first.", status: 401 }; if (a.example) return { error: "This is the demo. Nothing is charged here.", status: 403, code: "example" };
    const product = a.product, seats = product === "market" ? Math.max(1, Math.min(50, Math.floor(+b.seats) || 1)) : 1, cents = product === "market" ? SETTINGS.seatCents() : SETTINGS.hostCents();
    const back = product === "market" ? "/teams/market" : "/host/insights", md = { pl_ins: product, pl_ws: u.ws, pl_seats: String(seats) };
    const sess = await stripeApi(s, "POST", "checkout/sessions", { mode: "subscription", success_url: `${origin}${back}?paid=1`, cancel_url: `${origin}${back}`, client_reference_id: u.ws, customer_email: lc(u.email), metadata: md, subscription_data: { metadata: md },
      line_items: [{ quantity: seats, price_data: { currency: "usd", unit_amount: cents, recurring: { interval: "month" }, product_data: { name: product === "market" ? "Market Insights, one seat" : "Host Insights" } } }] },
      { idem: `pl-ins-${u.ws}-${product}-${seats}-${Math.floor(clock() / 600e3)}` });
    return { url: sess.url };
  }
  async function portal(u, origin = "") { const s = billingConfig(); const a = access(u), p = a.product && planOf(u.ws, a.product); if (!s.on || !p?.customer) return { error: "There's no subscription to manage.", status: 409 };
    return { url: (await stripeApi(s, "POST", "billing_portal/sessions", { customer: p.customer, return_url: origin + (a.product === "market" ? "/teams/market" : "/host/insights") })).url }; }
  const LIVE = new Set(["active", "trialing", "past_due"]);
  function handleEvent(evt) {
    const id = String(evt?.id || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 80); if (!id) return { ignored: "no_id" };
    const seen = "system/insevt-" + id; if (store.get(seen)) return { duplicate: true };
    const o = evt.data?.object || {}, subId = String(o.subscription || (evt.type?.startsWith("customer.subscription") ? o.id : "") || "").replace(/[^A-Za-z0-9_]/g, "");
    let md = o.metadata || {}; if (!md.pl_ins && subId) md = store.get("system/insub-" + subId)?.data || md;
    const ws = String(md.pl_ws || ""), product = ["market", "host"].includes(md.pl_ins) ? md.pl_ins : ""; let r = { ignored: "not_ours" };
    if (ws && product && getWorkspace(ws)) {
      if (evt.type === "checkout.session.completed") { setPlan(ws, product, { on: true, status: "active", source: "stripe", seats: Math.max(1, +md.pl_seats || 1), sub: subId, customer: String(o.customer || "") }); if (subId) store.set("system/insub-" + subId, { pl_ws: ws, pl_ins: product }); r = { ok: "activated" };
        const q = requestOf(ws, product); if (q) store.set(`system/insreq-${ws}-${product}`, { ...q, status: "granted", doneAt: clock() }); }
      else if (evt.type === "customer.subscription.created" || evt.type === "customer.subscription.updated") { const qty = +o.items?.data?.[0]?.quantity || 0; setPlan(ws, product, { on: LIVE.has(o.status), status: o.status, source: "stripe", sub: subId, ...(qty ? { seats: qty } : {}), ...(o.customer ? { customer: String(o.customer) } : {}) }); if (subId) store.set("system/insub-" + subId, { pl_ws: ws, pl_ins: product }); r = { ok: "updated" }; }
      else if (evt.type === "customer.subscription.deleted") { setPlan(ws, product, { on: false, status: "canceled" }); r = { ok: "canceled" }; }
      else if (evt.type === "invoice.payment_failed") { setPlan(ws, product, { status: "past_due" }); r = { ok: "past_due" }; }
      else r = { ignored: evt.type }; }
    store.set(seen, { at: clock(), type: String(evt.type || "").slice(0, 60) }); return r;
  }

  // ---- the monthly digest, one per seat ----
  const secret = () => process.env.SESSION_SECRET || "paid-insights-local";
  const digestToken = (email) => Buffer.from(lc(email)).toString("base64url") + "." + crypto.createHmac("sha256", secret()).update("insdigest|" + lc(email)).digest("base64url").slice(0, 32);
  function readDigestToken(t) { const [a, s] = String(t || "").split("."); if (!a || !s) return null; let em = ""; try { em = Buffer.from(a, "base64url").toString("utf8"); } catch { return null; }
    if (!EMAIL_RE.test(em)) return null; const want = Buffer.from(digestToken(em).split(".")[1]), got = Buffer.from(s); return want.length === got.length && crypto.timingSafeEqual(want, got) ? lc(em) : null; }
  const digestKey = (email) => "system/insdigest-" + h24(email);
  const digestOn = (email) => store.get(digestKey(email))?.data?.off !== true;
  const setDigest = (email, on) => { store.set(digestKey(email), { kind: "insdigest", email: lc(email), off: !on, at: clock() }); return { on: !!on }; };
  function digestText(ws, origin, email) {
    const W = getWorkspace(ws), city = clean(W?.city || W?.brand?.profile?.city || "", 60), M = movers(recsOf(false), { city }), N = notesFor(city), month = new Date(clock()).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const L = (x) => `- ${x.label}: ${x.change > 0 ? "up" : "down"} ${Math.abs(x.change)}% in guests (${x.basis})`;
    return { subject: `Market Insights for ${month}`, text: [`Market Insights for ${month}${city ? `, ${city}` : ""}`, "", "Rising, measured on Pottery Lab:", ...(M.rising.length ? M.rising.slice(0, 5).map(L) : ["- Not enough yet"]), "", "Falling:", ...(M.falling.length ? M.falling.slice(0, 3).map(L) : ["- Not enough yet"]), "",
      "Trending on social (editorial notes from the Pottery Lab team, not measured):", ...(N.length ? N.slice(0, 3).map((n) => `- ${n.name}: ${n.line}`) : ["- None this month"]), "",
      `Explore by city, format, day and price: ${origin}/teams/market`, "", "Totals from public events only. No guest names or details.", "", `Stop this monthly email: ${origin}/paid-insights/digest/off?t=${digestToken(email)}`].join("\n") };
  }
  async function runDigest(origin = process.env.ENCORE_PUBLIC_URL || "") { if (!SETTINGS.digest()) return { sent: 0 };
    const month = new Date(clock()).toISOString().slice(0, 7), cfg = emailConfig(DEFAULT_WS, true); if (!cfg) return { sent: 0, reason: "no_email" }; let sent = 0, skipped = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const p = planOf(ws, "market"); if (!p?.on || getWorkspace(ws)?.demo) continue; const D = S0(ws).get("paidinsights/digest")?.data || { sent: {} };
      for (const em of p.seatsUsed || []) { const k = h24(em); if (D.sent[k] === month) continue; if (!digestOn(em) || isUnsubscribed(em)) { skipped++; continue; }
        const t = digestText(ws, origin, em), r = await sendEmail(cfg, { to: em, subject: t.subject, text: t.text, origin }); if (r?.ok) { D.sent[k] = month; sent++; } }
      S0(ws).set("paidinsights/digest", D); }
    return { sent, skipped, month }; }

  return { market, host, access, request, grant, adminList, checkout, portal, handleEvent, runDigest, digestText, digestToken, readDigestToken, digestOn, setDigest, profiles, bust, demoState, demographics, planOf, setPlan, hostInfo, recsOf };
}

// ---------- CSV ----------
const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The current view as CSV: the same aggregate rows the page shows, nothing else. */
export function toCsv(M) {
  const head = [M.byLabel, "Events", "Hosts", "Guests", "Fill rate %", "Events with a waitlist %", "Would go again %", "Repeat guests %", "Typical price", "Days to fill", "Based on"];
  const lab = (k, v) => (k === "city" ? M.cities?.find((x) => x.value === v)?.label : k === "hood" ? M.hoods?.find((x) => x.value === v)?.label : DIMS[k]?.values?.()?.find(([x]) => x === v)?.[1]) || titleCase(v);
  const f = Object.entries(M.filters || {}).map(([k, v]) => `${DIMS[k]?.label || k}: ${lab(k, v)}`).join("; ");
  const row = (label, s) => (s.enough ? [label, s.events, s.hosts, s.guests, s.fillPct, s.waitlistPct, s.againPct, s.repeatPct, s.priceCents == null ? "" : money(s.priceCents), s.fillDays, s.basis] : [label, "", "", "", "", "", "", "", "", "", "Not enough yet"]);
  const L = [[`Market Insights, ${M.windowLabel}${f ? ", " + f : ""}`], [M.example ? "Example data, made up for the demo. None of these are real events or people." : "Totals from public events on Pottery Lab only. Private, members-only and example events are never counted."], head, row("All", M.overall), ...M.rows.map((r) => row(r.label, r))];
  return L.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---------- routes ----------
export function mountPaidInsights(app, { store, small, currentUser, C, X, PUBLIC_DIR, publicOrigin = () => "" }) {
  const T = app.locals.trends; if (!T) throw new Error("mountPaidInsights needs the trends engine (mountTrends) first");
  const PI = makePaidInsights({ store, C, T, locals: app.locals }); app.locals.paidInsights = PI;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req) => { try { const u = currentUser(req); return u && u.email && u.ws && u.ws !== DEFAULT_WS ? u : null; } catch { return null; } };
  const origin = (req) => process.env.ENCORE_PUBLIC_URL || publicOrigin(req) || "";
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  const priv = (res) => res.set("Cache-Control", "private, no-store");
  const hits = new Map(), over = (k, n) => { const t = Date.now(); let h = hits.get(k); if (!h || t - h.start > 3600e3) { h = { n: 0, start: t }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const open = (req, res, product) => { const u = me(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const a = PI.access(u);
    if (a.product !== product) { bad(res, product === "market" ? "Market Insights are for brand teams." : "Host Insights are for hosts.", 403, "wrong_side"); return null; }
    if (a.state !== "open") { res.status(402).json({ code: "locked", message: "This is a paid feature.", access: a }); return null; } priv(res); return { u, a }; };

  app.get("/teams/market", page("teams-market.html"));
  app.get("/host/insights", page("host-insights.html"));
  app.get("/admin/paid-insights", (req, res, next) => { const u = me(req); if (!u || !isAdmin(u.email)) return res.status(404).type("text").send("Not found"); page("admin-paid-insights.html")(req, res, next); });

  // where this person stands: always 200, so a page never shows a failed request
  app.get("/api/paid-insights/me", (req, res) => { priv(res); const u = me(req), a = u ? PI.access(u) : { state: "signin" }, b = billingConfig();
    const req0 = u && a.product ? store.get(`system/insreq-${u.ws}-${a.product}`)?.data : null, p = u && a.product ? PI.planOf(u.ws, a.product) : null;
    res.json({ ...a, billing: b.on, requested: req0 ? { status: req0.status, seats: req0.seats } : null, manage: !!(b.on && p?.customer), digest: u && a.product === "market" ? PI.digestOn(u.email) : false,
      prices: { seatCents: SETTINGS.seatCents(), hostCents: SETTINGS.hostCents() }, min: { hosts: MIN_HOSTS(), guests: MIN_GUESTS(), people: SETTINGS.k() } }); });

  app.get("/api/paid-insights/market", (req, res) => { if (over("pim:" + req.ip, 1200)) return bad(res, "Slow down.", 429, "rate_limited"); const A = open(req, res, "market"); if (!A) return; res.json(PI.market(req.query || {}, { demo: !!A.a.example })); });
  app.get("/api/paid-insights/market.csv", (req, res) => { const A = open(req, res, "market"); if (!A) return; const M = PI.market(req.query || {}, { demo: !!A.a.example });
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="market-insights${M.example ? "-example" : ""}.csv"` }).send(toCsv(M)); });
  app.get("/api/paid-insights/host", (req, res) => { const A = open(req, res, "host"); if (!A) return; res.json(PI.host(A.u)); });

  app.post("/api/paid-insights/request", small, (req, res) => { const u = me(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); if (over("pir:" + u.email, 20)) return bad(res, "Slow down.", 429, "rate_limited");
    if (getWorkspace(u.ws)?.demo) return bad(res, "This is the demo, so there's nothing to request.", 403, "example"); const r = PI.request(u, req.body || {}); if (r.error) return bad(res, r.error); priv(res).json(r); });
  app.post("/api/paid-insights/checkout", small, async (req, res) => { const u = me(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated");
    try { const r = await PI.checkout(u, req.body || {}, origin(req)); if (r.error) return bad(res, r.error, r.status || 400, r.code || "invalid"); priv(res).json(r); } catch (e) { bad(res, e.message || "That didn't work. Try again.", e.status || 502, e.code || "stripe_error"); } });
  app.post("/api/paid-insights/portal", small, async (req, res) => { const u = me(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated");
    try { const r = await PI.portal(u, origin(req)); if (r.error) return bad(res, r.error, r.status || 400); priv(res).json(r); } catch (e) { bad(res, e.message, e.status || 502, e.code || "stripe_error"); } });
  app.post("/api/paid-insights/stripe/webhook", rawBody, (req, res) => {
    const s = billingConfig(); if (!s.on) return bad(res, "No such endpoint.", 404, "not_found");
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(""), v = verifyStripe(body, req.get("stripe-signature"), s.whsec); if (!v.ok) return bad(res, "Signature check failed.", 400, "bad_signature");
    let evt; try { evt = JSON.parse(body.toString("utf8")); } catch { return bad(res, "Not JSON.", 400); }
    try { res.json({ received: true, ...PI.handleEvent(evt) }); } catch (e) { console.warn("[paidinsights] webhook", e?.message); bad(res, "Try again.", 500, "error"); } });

  // the seat's monthly email
  app.post("/api/paid-insights/digest", small, (req, res) => { const A = open(req, res, "market"); if (!A) return; res.json(PI.setDigest(A.u.email, req.body?.on !== false)); });
  const offPage = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Pottery Lab</title><link rel="stylesheet" href="/system.css"><style>body{margin:0;background:var(--pl-page);color:var(--pl-ink);font:16px/1.5 var(--pl-font-text)}main{max-width:520px;margin:0 auto;padding:40px 16px}h1{font:600 28px/1.15 var(--pl-font-display);margin:0 0 12px}button{min-height:44px;padding:0 18px;border-radius:6px;border:1px solid var(--pl-accent);background:var(--pl-accent);color:var(--pl-on-accent);font:600 16px var(--pl-font-text);cursor:pointer}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
  app.get("/paid-insights/digest/off", (req, res) => { const t = String(req.query.t || "").slice(0, 400), em = PI.readDigestToken(t); if (!em) return res.status(400).type("html").send(offPage("This link isn't working", "<p>Open the link from your email again.</p>"));
    res.type("html").send(offPage("Stop the monthly email?", `<p>Market Insights won't email you each month. You can turn it back on from Market Insights.</p><form method="post"><input type="hidden" name="t" value="${t.replace(/[^A-Za-z0-9._-]/g, "")}"><button type="submit">Stop the monthly email</button></form>`)); });
  app.post("/paid-insights/digest/off", urlencoded, (req, res) => { const em = PI.readDigestToken(String(req.body?.t || req.query.t || "").slice(0, 400)); if (!em) return res.status(400).type("html").send(offPage("This link isn't working", "<p>Open the link from your email again.</p>"));
    PI.setDigest(em, false); res.type("html").send(offPage("The monthly email is off", "<p>You won't get Market Insights by email. Turn it back on from Market Insights any time.</p>")); });

  // admins: requests and manual grants (ENCORE_ADMIN_EMAILS; 404 for everyone else)
  const admin = (req, res) => { const u = me(req); if (!u || !isAdmin(u.email)) { bad(res, "Not found.", 404, "not_found"); return null; } priv(res); return u; };
  app.get("/api/admin/paid-insights", (req, res) => { if (!admin(req, res)) return; res.json({ ...PI.adminList(), billing: billingConfig().on }); });
  app.post("/api/admin/paid-insights/grant", small, (req, res) => { const u = admin(req, res); if (!u) return; const b = req.body || {}; const r = PI.grant({ ws: String(b.ws || "").slice(0, 80), product: b.product, seats: b.seats, on: b.on !== false }, u.email); if (r.error) return bad(res, r.error); res.json(r); });

  // a person's own demographic answers: opt in, change, remove one, or remove all
  const mine = (req, res) => { const u = me(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } priv(res); return u; };
  const view = (u) => { const d = store.get(demoKey(u.email))?.data; return { enabled: SETTINGS.demographics(), on: d?.on === true, answers: d?.on ? Object.fromEntries(Object.keys(FIELDS).filter((k) => d[k] != null).map((k) => [k, d[k]])) : {},
    fields: Object.entries(FIELDS).map(([k, F]) => ({ key: k, label: F.label, why: F.why, multi: F.multi || 0, text: F.text || 0, options: F.options ? F.options() : [] })), k: SETTINGS.k() }; };
  app.get("/api/me/demographics", (req, res) => { const u = me(req); priv(res); if (!u) return res.json({ signedIn: false, enabled: SETTINGS.demographics() }); res.json({ signedIn: true, ...view(u) }); });
  app.post("/api/me/demographics", small, (req, res) => { const u = mine(req, res); if (!u) return; if (!SETTINGS.demographics()) return bad(res, "This is off here.", 409, "off"); const b = req.body || {}, key = demoKey(u.email);
    if (b.on === false || b.remove === "all") { store.delete(key); PI.bust(); return res.json(view(u)); }
    const cur = store.get(key)?.data || {}, P = cleanProfile(b.answers || {}, cur.on ? cur : {});
    store.set(key, { kind: "pldemo", email: lc(u.email), on: true, ...Object.fromEntries(Object.keys(FIELDS).filter((k) => P[k] != null).map((k) => [k, P[k]])), at: Date.now() }); PI.bust(); res.json(view(u)); });
  app.delete("/api/me/demographics", (req, res) => { const u = mine(req, res); if (!u) return; store.delete(demoKey(u.email)); PI.bust(); res.json(view(u)); });

  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => PI.runDigest().catch((e) => console.warn("[paidinsights] digest", e?.message)), 6 * 3600e3); t.unref?.(); }
  return PI;
}
