// Paid Insights (server/paidinsights.js, public/teams-market.html, public/host-insights.html, public/demographics.js):
// cuts and filters, the minimum sample, k-anonymity with complementary suppression, consent and removal, no individual
// data in any answer or CSV, the paywall with and without Stripe, admin grants and seats, the labelled demo dataset,
// host comparison rules, the monthly digest and its unsubscribe, and a browser check at 390 and 1280.
// (test/insights.test.js is the older "What resonates" feature, server/insights.js; this file is the paid one.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { getDbUser } from "../server/workspaces.js";
import { fakeOutbox, setUnsubscribed, useUnsubStore } from "../server/email.js";
import { setStripeFetch, signStripe } from "../server/memberships.js";
import { cellStats, breakdown, explore, movers, hostsFor, demoCut, cleanProfile, toCsv, demoWorld, makePaidInsights, demoKey, todOf, priceBandOf, SETTINGS, billingConfig, EXAMPLE_LABEL } from "../server/paidinsights.js";

const SHOTS = process.env.INSIGHTS_SHOTS || path.join(os.tmpdir(), "insights-shots");
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "paid-insights-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_ADMIN_EMAILS: "boss.pi@example.com", ENCORE_DEMOGRAPHICS_MIN_OPTINS: "10" };
const STRIPE = { STRIPE_SECRET_KEY: "sk_test_paidinsights123", STRIPE_INSIGHTS_WEBHOOK_SECRET: "whsec_paidinsights123" };
let srv; const U = {};
const J = { "content-type": "application/json" };
const post = (p, body, cookie, method = "POST") => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const cookies = (r, prev = "") => { const M = new Map(prev.split("; ").filter(Boolean).map((x) => [x.split("=")[0], x])); for (const c of r.headers.getSetCookie()) { const kv = c.split(";")[0]; M.set(kv.split("=")[0], kv); } return [...M.values()].join("; "); };
const join = async (who, name, mode = "friends", extra = {}) => { const email = `${who}.pi@example.com`, r = await post("/api/signup", { name, email, password: "long-password-1", mode, ...extra }), b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); U[who] = { cookie: cookies(r), ws: b.workspace.id, email }; };
const ev = (w, id, d) => put("events/" + id, { kind: "social", casual: true, city: "Brooklyn", hood: "Greenpoint", discoverable: true, published: true, headcount: 8, startTime: "19:00", price: "$45", ...d }, U[w].cookie);
const guestEmail = (i) => `pig${i}@guest.test`;
function guests(w, eventId, from, n, k = 0) { for (let i = 0; i < n; i++) { const em = guestEmail(from + i);
  srv.store.set(`ws/${U[w].ws}/rsvps/${eventId}r${i}`, { eventId, email: em, name: "Guestname " + (from + i), response: "going", createdAt: Date.now() - 9 * 864e5 + i * 3600e3, code: "C" + i });
  if (i < k) srv.store.set(`ws/${U[w].ws}/kudos/${eventId}k${i}`, { eventId, email: em, name: "Guestname " + (from + i), tags: ["again"], at: Date.now() - 864e5 }); } }
// what must never be in an answer or a CSV: emails, guest names, event ids, workspace ids
const PRIVATE = () => new RegExp(["@", "guest\\.test", "Guestname", "piSup", "piPriv", "piRun", ...Object.values(U).map((u) => u.ws).filter(Boolean)].join("|"));

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); useUnsubStore(srv.store);
  for (const [w, n] of [["ana", "Ana Pi"], ["ben", "Ben Pi"], ["cai", "Cai Pi"], ["dee", "Dee Pi"], ["eli", "Eli Pi"], ["hob", "Hob Pi"], ["boss", "Boss Pi"], ["gia", "Gia Guest"]]) await join(w, n);
  await join("brand", "Bree Brand", "work", { company: "Fernhill Tools", city: "Brooklyn" });
  for (const w of ["ana", "ben", "cai", "dee", "eli"]) assert.ok((await post("/api/host/profile", { handle: w + "-pi", name: w.toUpperCase() + " Suppers", city: "Brooklyn", hood: "Greenpoint", tagline: "Small." }, U[w].cookie)).ok);
  // supper clubs in Brooklyn: 5 hosts with a page and one without (hob), 6 guests each, Saturdays at 7
  let g = 0; for (const [i, w] of ["ana", "ben", "cai", "dee", "eli", "hob"].entries()) { const d = day(-5 - i); await ev(w, "piSup" + i, { name: "Greenpoint Supper Club", activity: "supper", date: d }); guests(w, "piSup" + i, g, 6, 5); g += 6; }
  // ana and ben ran a second supper club (so they show as hosts who run it), and a private one that never counts
  await ev("ana", "piSup9", { name: "Greenpoint Supper Club", activity: "supper", date: day(-40) }); guests("ana", "piSup9", 100, 6, 3);
  await ev("ben", "piSup8", { name: "Greenpoint Supper Club", activity: "supper", date: day(-41) }); guests("ben", "piSup8", 110, 6, 3);
  await ev("ana", "piPriv0", { name: "Secret supper", activity: "supper", date: day(-3), private: true, discoverable: false }); guests("ana", "piPriv0", 200, 8, 8);
  // one run by ana only: too small to compare
  await ev("ana", "piRun0", { name: "Saturday 5k, coffee after", activity: "run", date: day(-6), headcount: 12, startTime: "08:00", price: "" }); guests("ana", "piRun0", 300, 6, 0);
  // opted-in answers for the supper guests: 30 people, ages mostly 25 to 34
  for (let i = 0; i < 36; i++) srv.store.set(demoKey(guestEmail(i)), { kind: "pldemo", email: guestEmail(i), on: true, age: i < 26 ? "25-34" : i < 33 ? "35-44" : "65+", heard: "friend", into: ["supper", "wine"], hood: "Greenpoint" });
  srv.app.locals.social.bust(); srv.app.locals.trends.bust(); srv.app.locals.paidInsights.bust();
});
after(async () => { setStripeFetch(null); for (const k of [...Object.keys(ENV), ...Object.keys(STRIPE)]) delete process.env[k]; await srv.close(); });

// ---------- the maths, pure ----------
const rec = (o = {}) => ({ ws: "w1", format: "supper-club", city: "Austin", hood: "East Austin", age: 10, past: true, dow: 6, season: "autumn", guests: 6, fill: 0.75, waitlist: 0, againYes: 3, againOf: 4, repeat: 1, priceCents: 4500, hour: 19, fillDays: 4, gk: [], ...o });
test("cells: the minimum sample, every number with what it's based on, and Not enough yet with no numbers", () => {
  const two = [rec({ ws: "a", guests: 20 }), rec({ ws: "b", guests: 20 })], ok = [rec({ ws: "a", guests: 5 }), rec({ ws: "b", guests: 5 }), rec({ ws: "c", guests: 5, waitlist: 2 })];
  const no = cellStats(two); assert.equal(no.enough, false); assert.equal(no.label, "Not enough yet"); assert.equal(no.fillPct, undefined, "no numbers on a hidden cell"); assert.equal(no.events, undefined);
  const s = cellStats(ok); assert.equal(s.enough, true); assert.equal(s.hosts, 3); assert.equal(s.guests, 15); assert.equal(s.fillPct, 75); assert.equal(s.waitlistPct, 33); assert.equal(s.priceCents, 4500); assert.equal(s.basis, "from 3 events, last 90 days");
  assert.equal(s.againPct, 75, "12 answers, 9 again"); assert.equal(cellStats([rec({ ws: "a", guests: 5, againOf: 1 }), rec({ ws: "b", guests: 5, againOf: 1 }), rec({ ws: "c", guests: 5, againOf: 1 })]).againPct, null, "under 5 answers: no would-go-again");
  assert.equal(todOf(8), "morning"); assert.equal(todOf(19), "evening"); assert.equal(todOf(22), "late"); assert.equal(priceBandOf(0), "free"); assert.equal(priceBandOf(4500), "p25"); assert.equal(priceBandOf(15000), "p120");
});
test("cuts and filters: city, neighbourhood, format, season, day, time, price and the window", () => {
  const R = [...["a", "b", "c"].map((w) => rec({ ws: w })), ...["a", "b", "c"].map((w) => rec({ ws: w, dow: 2, hour: 9, priceCents: 0, hood: "Hyde Park", format: "run-coffee" })), rec({ ws: "d", age: 200 }), rec({ ws: "e", city: "Chicago" })];
  const x = explore(R, { city: "austin", by: "dow" }); assert.equal(x.overall.events, 6, "the 200-day-old one is outside 90 days; Chicago is filtered out");
  assert.deepEqual(x.rows.map((r) => [r.label, r.enough]), [["Tuesdays", true], ["Saturdays", true]]);
  assert.equal(explore(R, { city: "austin", window: 365 }).overall.events, 7);
  assert.equal(explore(R, { city: "austin", hood: "hyde park", tod: "morning", price: "free", format: "run-coffee" }).overall.events, 3);
  assert.equal(explore(R, { city: "austin", tod: "evening", by: "price" }).rows[0].label, "$25 to $60");
  assert.equal(explore(R, { dow: "9", by: "nonsense" }).by, "format", "unknown values are dropped");
  assert.equal(explore(R, { season: "autumn" }).filters.season, "autumn");
});
test("complementary suppression: hidden cells that together would still be under the minimum hide the smallest shown one", () => {
  // Saturdays: 3 hosts, 30 guests. Sundays: 3 hosts, 18 guests. Mondays: one host, 6 guests (hidden).
  // Without the rule, total minus Saturdays minus Sundays would give Monday's host away.
  const R = [...["a", "b", "c"].map((w) => rec({ ws: w, guests: 10 })), ...["a", "b", "c"].map((w) => rec({ ws: w, dow: 0, guests: 6 })), rec({ ws: "z", dow: 1, guests: 6, fill: 0.1 })];
  const rows = Object.fromEntries(breakdown(R, "dow").map((r) => [r.label, r]));
  assert.equal(rows.Mondays.enough, false); assert.equal(rows.Sundays.enough, false, "the smallest shown day is hidden too"); assert.match(rows.Sundays.basis, /stay private/); assert.equal(rows.Sundays.fillPct, undefined);
  assert.equal(rows.Saturdays.enough, true);
  // when the hidden cells together meet the minimum, nothing more is hidden
  const R2 = [...["a", "b", "c"].map((w) => rec({ ws: w, guests: 10 })), ...["d", "e"].map((w) => rec({ ws: w, dow: 0, guests: 5 })), ...["f", "g"].map((w) => rec({ ws: w, dow: 1, guests: 5 }))];
  const r2 = Object.fromEntries(breakdown(R2, "dow").map((r) => [r.label, r])); assert.equal(r2.Saturdays.enough, true, "Sundays and Mondays together are 4 hosts and 20 guests"); assert.equal(r2.Mondays.enough, false); assert.equal(r2.Sundays.enough, false);
});
test("movers: rising and falling month over month, only when both months meet the minimum", () => {
  const R = [...["a", "b", "c"].map((w) => rec({ ws: w, age: 5, guests: 10 })), ...["a", "b", "c"].map((w) => rec({ ws: w, age: 40, guests: 6 })),
    ...["a", "b", "c"].map((w) => rec({ ws: w, format: "picnic", age: 5, guests: 5 })), ...["a", "b", "c"].map((w) => rec({ ws: w, format: "picnic", age: 40, guests: 10 })),
    ...["a", "b"].map((w) => rec({ ws: w, format: "mahjong", age: 5, guests: 30 })), ...["a", "b", "c"].map((w) => rec({ ws: w, format: "mahjong", age: 40, guests: 6 }))];
  const M = movers(R, { city: "Austin" }); assert.deepEqual(M.rising.map((x) => [x.format, x.change]), [["supper-club", 67]]); assert.deepEqual(M.falling.map((x) => [x.format, x.change]), [["picnic", -50]]);
  assert.ok(!JSON.stringify(M).includes("mahjong"), "two hosts this month: not enough"); assert.match(M.rising[0].basis, /^from 3 events this month and 3 the month before/);
});
test("hosts who run it: only with the minimum, only hosts with a public page, only public facts", () => {
  const R = [...["a", "b", "c", "x"].flatMap((w) => [rec({ ws: w, fill: 1 }), rec({ ws: w, fill: 1, age: 50 })]), ...["p", "q", "r"].map((w) => rec({ ws: w, format: "potluck", fill: 0.5 }))];
  const info = (ws) => (ws === "x" ? null : { handle: ws + "-h", name: "Host " + ws, area: "East Austin", link: "/@" + ws + "-h", quickBook: "/teams/home?city=Austin#quick" });
  const H = hostsFor(R, { format: "supper-club", city: "austin" }, info);
  assert.equal(H.enough, true); assert.match(H.headline, /^Supper clubs in Austin fill \d+% above average; 4 hosts run them$/); assert.equal(H.hosts.length, 3, "the host without a public page isn't listed");
  assert.deepEqual(Object.keys(H.hosts[0]).sort(), ["area", "events", "example", "handle", "line", "link", "name", "quickBook"], "public facts only, no rates per host");
  assert.equal(hostsFor(R.slice(0, 4), { format: "supper-club", city: "austin" }, info).enough, false, "two hosts: not enough");
});

// ---------- k-anonymity ----------
const people = (n, from, ans) => Array.from({ length: n }, (_, i) => ["p" + (from + i), ans]);
test("k-anonymity: 25 people per part, small parts roll into Other, Other under 25 pulls in the smallest part, multi-picks have no Other", () => {
  assert.equal(SETTINGS.k(), 25);
  const mk = (L) => { const P = new Map(L), R = [{ gk: L.map(([g]) => g), past: true }]; return { P, R }; };
  let { P, R } = mk([...people(24, 0, { age: "25-34" })]); assert.equal(demoCut(R, P, "age").shown, false, "24 people: Not enough yet");
  ({ P, R } = mk([...people(25, 0, { age: "25-34" })])); assert.deepEqual(demoCut(R, P, "age").cells.map((c) => [c.label, c.pct]), [["25 to 34", 100]]);
  // 40 aged 25-34, 30 aged 35-44, 10 aged 65+: the 10 can't show alone, and Other with 10 can't either, so 35-44 joins them
  ({ P, R } = mk([...people(40, 0, { age: "25-34" }), ...people(30, 100, { age: "35-44" }), ...people(10, 200, { age: "65+" })]));
  const c = demoCut(R, P, "age"); assert.deepEqual(c.cells.map((x) => [x.label, x.pct]), [["25 to 34", 50], ["Other", 50]]); assert.ok(!JSON.stringify(c).includes("65"), "the small group never shows");
  // Prefer not to say never counts
  ({ P, R } = mk([...people(25, 0, { age: "na" })])); assert.equal(demoCut(R, P, "age").shown, false);
  // multi-picks: no Other (parts don't add up to a total), small picks hidden
  ({ P, R } = mk([...people(30, 0, { into: ["supper", "wine"] }), ...people(5, 100, { into: ["run"] })]));
  const m = demoCut(R, P, "into"); assert.deepEqual(m.cells.map((x) => x.value).sort(), ["supper", "wine"]); assert.ok(!m.cells.some((x) => x.value === "other" || x.value === "run"));
  // a view that differs from its city by 1 to 24 people is hidden: the two can't be subtracted
  const all = [{ gk: [...people(30, 0).map(([g]) => g), "p999"], past: true }], one = [{ gk: people(30, 0).map(([g]) => g), past: true }], P2 = new Map([...people(30, 0, { age: "25-34" }), ["p999", { age: "65+" }]]);
  assert.equal(demoCut(one, P2, "age", { parent: all }).shown, false, "city minus this view would be one person");
  assert.equal(demoCut(one, P2, "age").shown, true, "on its own it would show");
});
test("demographics on the server: off until enough opt-ins, then k-anonymous, rolled up to the city when a view is thin", async () => {
  const PI = srv.app.locals.paidInsights;
  process.env.ENCORE_DEMOGRAPHICS_MIN_OPTINS = "500"; PI.bust(); assert.equal(PI.demographics({ city: "brooklyn" }).state, "collecting");
  process.env.ENCORE_DEMOGRAPHICS_MIN_OPTINS = "10"; process.env.ENCORE_INSIGHTS_K = "10"; PI.bust(); const W = PI.demographics({ city: "brooklyn", window: 365 }); assert.equal(W.state, "on");
  const age = W.cuts.find((c) => c.field === "age"); assert.equal(age.shown, true); assert.deepEqual(age.cells.map((x) => x.label), ["25 to 34", "Other"], "26 of them are 25 to 34; the 7 and the 3 roll into Other (K set to 10 here)");
  const thin = PI.demographics({ city: "brooklyn", format: "supper-club", dow: String(new Date(day(-5) + "T12:00:00Z").getUTCDay()), window: 365 });
  assert.ok(thin.cuts.every((c) => !c.shown || c.rolledUp), "a one-day view is too thin: hidden or rolled up to the city");
  process.env.ENCORE_DEMOGRAPHICS = "0"; assert.equal(PI.demographics({ city: "brooklyn" }).state, "off"); delete process.env.ENCORE_DEMOGRAPHICS;
  // at the default of 25, the same city has too few people outside "25 to 34" for an Other, so the whole cut hides
  delete process.env.ENCORE_INSIGHTS_K; assert.equal(PI.demographics({ city: "brooklyn", window: 365 }).cuts.find((c) => c.field === "age").shown, false);
});

// ---------- consent and removal ----------
test("consent: off by default, each answer can be removed, turning it off or deleting the account deletes the record", async () => {
  const c = U.gia.cookie; let j = await (await get("/api/me/demographics", c)).json();
  assert.equal(j.on, false); assert.deepEqual(j.answers, {}); assert.deepEqual(j.fields.map((f) => f.key), ["age", "heard", "into", "hood"]); assert.ok(j.fields.every((f) => f.why.length > 20), "each says why it's asked");
  assert.ok(!JSON.stringify(j.fields).match(/gender|ethnic|income|race/i), "no gender, ethnicity or income");
  assert.ok(j.fields.find((f) => f.key === "age").options.some(([k, l]) => k === "na" && l === "Prefer not to say"));
  j = await (await post("/api/me/demographics", { answers: { age: "25-34", heard: "instagram", into: ["supper", "nope", "wine"], hood: "Greenpoint!!" } }, c)).json();
  assert.equal(j.on, true); assert.deepEqual(j.answers, { age: "25-34", heard: "instagram", into: ["supper", "wine"], hood: "Greenpoint" });
  j = await (await post("/api/me/demographics", { answers: { heard: null } }, c)).json(); assert.equal(j.answers.heard, undefined, "one answer removed"); assert.equal(j.answers.age, "25-34");
  j = await (await post("/api/me/demographics", { on: false }, c)).json(); assert.equal(j.on, false); assert.equal(srv.store.get(demoKey(U.gia.email)), null, "off deletes the record");
  await post("/api/me/demographics", { answers: { age: "35-44" } }, c); assert.ok(srv.store.get(demoKey(U.gia.email)));
  j = await (await post("/api/me/demographics", {}, c, "DELETE")).json(); assert.equal(srv.store.get(demoKey(U.gia.email)), null, "remove all");
  await post("/api/me/demographics", { answers: { age: "35-44" } }, c);
  const d = await post("/api/me/delete", { confirm: "DELETE" }, c); assert.equal(d.status, 200); assert.equal(srv.store.get(demoKey(U.gia.email)), null, "account deletion removes it too");
  assert.equal(cleanProfile({ age: "40" }).age, undefined); assert.equal(cleanProfile({ hood: "x" }).hood, undefined);
  const set = fs.readFileSync(new URL("../public/settings.html", import.meta.url), "utf8"), dj = fs.readFileSync(new URL("../public/demographics.js", import.meta.url), "utf8");
  assert.match(set, /id="plDemoSet"/); assert.match(dj, /Help hosts and brands understand who comes/); assert.match(dj, /Remove all my answers/); assert.match(dj, /Why we ask/);
  const priv = fs.readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8"), terms = fs.readFileSync(new URL("../public/terms.html", import.meta.url), "utf8");
  assert.match(priv, /id="insights"/); assert.match(priv, /25 or more people/); assert.match(priv, /Removing it/); assert.match(terms, /Market and Host insights/);
});

// ---------- the paywall, seats, grants, Stripe ----------
test("paywall without Stripe: locked, Request access, an admin grants seats, seats are taken on first open", async () => {
  const b = U.brand.cookie; let me = await (await get("/api/paid-insights/me", b)).json();
  assert.equal(me.product, "market"); assert.equal(me.state, "locked"); assert.equal(me.billing, false); assert.equal(me.prices.seatCents, 4900);
  assert.equal((await get("/api/paid-insights/market", b)).status, 402); assert.equal((await get("/api/paid-insights/market.csv", b)).status, 402);
  assert.equal((await post("/api/paid-insights/checkout", { seats: 2 }, b)).status, 409, "no Stripe: no checkout");
  assert.equal((await post("/api/paid-insights/request", { seats: 1 }, b)).status, 200); me = await (await get("/api/paid-insights/me", b)).json(); assert.equal(me.requested.status, "open");
  assert.equal((await get("/api/admin/paid-insights", b)).status, 404, "admins only");
  const L = await (await get("/api/admin/paid-insights", U.boss.cookie)).json(); assert.equal(L.requests[0].ws, U.brand.ws); assert.equal(L.billing, false);
  assert.equal((await get("/admin/paid-insights", U.brand.cookie)).status, 404); assert.equal((await get("/admin/paid-insights", U.boss.cookie)).status, 200);
  const g = await (await post("/api/admin/paid-insights/grant", { ws: U.brand.ws, seats: 1 }, U.boss.cookie)).json(); assert.deepEqual(g.plan, { product: "market", on: true, seats: 1, source: "admin" });
  me = await (await get("/api/paid-insights/me", b)).json(); assert.equal(me.state, "open"); assert.equal(me.seatsUsed, 1);
  // a teammate: the one seat is taken
  const inv = await (await post("/api/invite", { email: "tess.pi@example.com" }, b)).json(); const jr = await post("/api/join", { token: inv.token, name: "Tess Team", password: "long-password-1" }); U.tess = { cookie: cookies(jr), email: "tess.pi@example.com" };
  assert.equal((await (await get("/api/paid-insights/me", U.tess.cookie)).json()).state, "no_seat");
  await post("/api/admin/paid-insights/grant", { ws: U.brand.ws, seats: 2 }, U.boss.cookie); assert.equal((await (await get("/api/paid-insights/me", U.tess.cookie)).json()).state, "open");
  // hosts get Host insights, brands can't open them and hosts can't open Market insights
  assert.equal((await (await get("/api/paid-insights/me", U.ana.cookie)).json()).product, "host"); assert.equal((await get("/api/paid-insights/market", U.ana.cookie)).status, 403);
  assert.equal((await get("/api/paid-insights/host", b)).status, 403);
  const L2 = await (await get("/api/admin/paid-insights", U.boss.cookie)).json(); assert.equal(L2.requests.find((r) => r.ws === U.brand.ws).status, "granted");
});
test("paywall with Stripe: Checkout per seat, a signed webhook turns it on once, a bad signature is refused, cancel turns it off", async () => {
  Object.assign(process.env, STRIPE); assert.equal(billingConfig().on, true); const calls = [];
  setStripeFetch(async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }) }; });
  try {
    const c = U.cai.cookie; let me = await (await get("/api/paid-insights/me", c)).json(); assert.equal(me.billing, true); assert.equal(me.state, "locked");
    const j = await (await post("/api/paid-insights/checkout", {}, c)).json(); assert.equal(j.url, "https://checkout.stripe.test/cs_1");
    const body = new URLSearchParams(calls[0].init.body); assert.match(calls[0].url, /checkout\/sessions$/); assert.equal(body.get("mode"), "subscription"); assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1000");
    assert.equal(body.get("line_items[0][price_data][recurring][interval]"), "month"); assert.equal(body.get("metadata[pl_ins]"), "host"); assert.ok(calls[0].init.headers["Idempotency-Key"], "idempotent");
    process.env.ENCORE_HOST_INSIGHTS_CENTS = "1500"; await post("/api/paid-insights/checkout", {}, c); assert.equal(new URLSearchParams(calls[1].init.body).get("line_items[0][price_data][unit_amount]"), "1500", "the price is a setting"); delete process.env.ENCORE_HOST_INSIGHTS_CENTS;
    await post("/api/paid-insights/checkout", { seats: 3 }, U.brand.cookie); assert.equal(new URLSearchParams(calls[2].init.body).get("line_items[0][quantity]"), "3");
    const hook = (evt, sig) => { const s = JSON.stringify(evt); return fetch(srv.base + "/api/paid-insights/stripe/webhook", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig || signStripe(s, STRIPE.STRIPE_INSIGHTS_WEBHOOK_SECRET) }, body: s }).then(async (r) => ({ status: r.status, j: await r.json() })); };
    const done = { id: "evt_pi_1", type: "checkout.session.completed", data: { object: { subscription: "sub_pi_1", customer: "cus_pi_1", metadata: { pl_ins: "host", pl_ws: U.cai.ws, pl_seats: "1" } } } };
    assert.equal((await hook(done, "t=1,v1=bad")).status, 400, "bad signature");
    assert.equal((await (await get("/api/paid-insights/me", c)).json()).state, "locked");
    assert.equal((await hook(done)).j.ok, "activated"); assert.equal((await hook(done)).j.duplicate, true, "each event once");
    me = await (await get("/api/paid-insights/me", c)).json(); assert.equal(me.state, "open"); assert.equal(me.manage, true);
    assert.equal((await hook({ id: "evt_pi_2", type: "customer.subscription.deleted", data: { object: { id: "sub_pi_1", status: "canceled" } } })).j.ok, "canceled");
    assert.equal((await (await get("/api/paid-insights/me", c)).json()).state, "locked", "canceled: locked again (found by the subscription id)");
    assert.equal((await hook({ id: "evt_other", type: "checkout.session.completed", data: { object: { metadata: {} } } })).j.ignored, "not_ours");
  } finally { setStripeFetch(null); for (const k of Object.keys(STRIPE)) delete process.env[k]; }
  assert.equal((await fetch(srv.base + "/api/paid-insights/stripe/webhook", { method: "POST", body: "{}" })).status, 404, "no Stripe: no webhook");
});
test("membership tier on: Host insights are included, at no price", () => {
  const PI = makePaidInsights({ store: srv.store, C: { profileOf: () => null }, T: srv.app.locals.trends, locals: { memberships: { config: () => ({ on: true, tiers: [{ id: "t1" }] }) } } });
  const a = PI.access({ email: U.dee.email, ws: U.dee.ws }); assert.equal(a.state, "open"); assert.equal(a.via, "membership");
});

// ---------- what brands see, with no individual data ----------
test("Market insights: aggregates only, private events never counted, no individual data in the answer or the CSV", async () => {
  const b = U.brand.cookie, m = await (await get("/api/paid-insights/market?city=brooklyn&format=supper-club&by=dow&window=365", b)).json();
  assert.equal(m.overall.enough, true); assert.equal(m.overall.events, 8, "6 plus 2 earlier ones; the private one never counts"); assert.equal(m.overall.hosts, 6); assert.equal(m.overall.guests, 48);
  assert.match(m.overall.basis, /^from 8 events, last 12 months$/); assert.equal(m.example, undefined);
  assert.equal(m.hostsRun.enough, true); assert.match(m.hostsRun.headline, /^Supper clubs in Brooklyn fill/); assert.deepEqual(m.hostsRun.hosts.map((h) => h.handle).sort(), ["ana-pi", "ben-pi"], "two or more public supper clubs, with a page");
  assert.ok(m.hostsRun.hosts.every((h) => h.link.startsWith("/@") && h.quickBook.startsWith("/teams/home?city=")));
  assert.ok(m.editorial.every((n) => n.label === "Trending on social" && /Not measured/.test(n.about)), "editorial notes labelled");
  const s = JSON.stringify(m); assert.doesNotMatch(s.replace(/"ana-pi"|"ben-pi"|\/@ana-pi|\/@ben-pi/g, ""), PRIVATE());
  const csv = await (await get("/api/paid-insights/market.csv?city=brooklyn&format=supper-club&by=dow&window=365", b)).text();
  assert.match(csv, /^"Market Insights, last 12 months, Format: Supper clubs; City: Brooklyn"/); assert.match(csv, /\r\nAll,8,6,48,/); assert.doesNotMatch(csv, PRIVATE()); assert.doesNotMatch(csv, /ana-pi|ben-pi/, "no hosts in the CSV either");
  assert.ok(csv.split("\r\n")[2].startsWith("Day of week,Events,Hosts,Guests,"));
});
test("the demo sandbox sees the example dataset, labelled Example everywhere; real views never include it", async () => {
  const r = await fetch(srv.base + "/teams/demo", { redirect: "manual" }), c = cookies(r);
  const me = await (await get("/api/paid-insights/me", c)).json(); assert.equal(me.state, "open"); assert.equal(me.example, true);
  const m = await (await get("/api/paid-insights/market?city=new%20york", c)).json(); assert.equal(m.example, true); assert.equal(m.exampleLabel, EXAMPLE_LABEL); assert.match(m.about, /Example data/);
  assert.ok(m.overall.enough && m.overall.events > 20); assert.equal(m.who.state, "on");
  const H = (await (await get("/api/paid-insights/market?city=austin&format=supper-club", c)).json()).hostsRun; assert.ok(H.hosts.every((h) => / \(example\)$/.test(h.name) && h.example));
  const csv = await (await get("/api/paid-insights/market.csv", c)).text(); assert.match(csv.split("\r\n")[1], /^"?Example data/);
  assert.equal((await post("/api/paid-insights/request", {}, c)).status, 403); assert.ok(demoWorld().recs.every((x) => x.example));
  const real = await (await get("/api/paid-insights/market?window=365", U.brand.cookie)).json(); assert.ok(!real.cities.some((x) => ["austin", "chicago"].includes(x.value)), "the made-up cities never reach a real team");
  const html = fs.readFileSync(new URL("../public/teams-market.html", import.meta.url), "utf8"); assert.match(html, /pli-ex">Example/);
});

// ---------- hosts ----------
test("Host insights: deeper cuts for their city, compared only when the group meets the minimum, never naming anyone", async () => {
  await post("/api/admin/paid-insights/grant", { ws: U.ana.ws }, U.boss.cookie);
  const h = await (await get("/api/paid-insights/host", U.ana.cookie)).json(); assert.equal(h.city, "Brooklyn");
  const sup = h.formats.find((f) => f.format === "supper-club"), run = h.formats.find((f) => f.format === "run-coffee");
  assert.equal(sup.peers.enough, true); assert.equal(sup.peers.hosts, 5, "the other five hosts, not Ana"); assert.match(sup.peers.basis, /5 other hosts in Brooklyn/);
  assert.equal(sup.you.events, 2, "her private one isn't in her numbers either"); assert.ok(sup.compare.length >= 1 && sup.compare.every((l) => /similar supper clubs in Brooklyn/.test(l)));
  assert.match(sup.best.day.label, /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days$|^Not enough yet$/); assert.ok(["Mornings, before noon", "Afternoons, noon to 5", "Evenings, 5 to 9", "Late, after 9"].includes(sup.best.time.label));
  assert.equal(sup.best.price.label, "$25 to $60");
  assert.equal(run.peers.enough, false); assert.deepEqual(run.compare, ["Not enough similar events yet to compare fairly."]); assert.equal(run.best, null);
  const s = JSON.stringify(h); for (const w of ["ben", "cai", "dee", "eli", "hob"]) assert.ok(!s.includes(w + "-pi") && !s.includes(w.toUpperCase() + " Suppers"), "no other host named");
  assert.doesNotMatch(s, PRIVATE());
  assert.equal((await get("/api/paid-insights/host", U.eli.cookie)).status, 402, "not granted: locked");
});

// ---------- the digest ----------
test("monthly digest: one per seat per month, aggregates only, its own off link, and global unsubscribes respected", async () => {
  const PI = srv.app.locals.paidInsights, n0 = fakeOutbox.length;
  setUnsubscribed(U.tess.email, true);
  let r = await PI.runDigest("http://pi.test"); assert.equal(r.sent, 1); assert.equal(r.skipped, 1, "the teammate who unsubscribed from everything");
  const m = fakeOutbox.slice(n0).find((x) => x.to.includes(U.brand.email)); assert.ok(m); assert.match(m.subject, /^Market Insights for /);
  assert.match(m.text, /Trending on social \(editorial notes from the Pottery Lab team, not measured\)/); assert.doesNotMatch(m.text.replace(/\/paid-insights\/digest\/off\?t=\S+/, ""), PRIVATE());
  assert.equal((await PI.runDigest("http://pi.test")).sent, 0, "once a month");
  const t = /digest\/off\?t=(\S+)/.exec(m.text)[1]; assert.equal((await get("/paid-insights/digest/off?t=" + t)).status, 200, "a scanner opening the link changes nothing"); assert.equal(PI.digestOn(U.brand.email), true);
  const off = await fetch(srv.base + "/paid-insights/digest/off", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "t=" + encodeURIComponent(t) }); assert.equal(off.status, 200); assert.equal(PI.digestOn(U.brand.email), false);
  assert.equal((await get("/paid-insights/digest/off?t=bogus.token")).status, 400);
  assert.equal((await (await post("/api/paid-insights/digest", { on: true }, U.brand.cookie)).json()).on, true, "back on from the page");
});

// ---------- the pages and the rules for copy ----------
test("pages: Field Notes copy rules, no em dashes, no emoji in chrome, labelled sources, settings in the launch checklist", () => {
  const files = ["public/teams-market.html", "public/host-insights.html", "public/admin-paid-insights.html", "public/insightsui.js", "public/demographics.js", "server/paidinsights.js", "docs/launch-checklist.md"];
  for (const f of files) { const s = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8"); assert.ok(!/—/.test(s), f + ": no em dashes"); assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(s), f + ": no emoji"); }
  const doc = fs.readFileSync(new URL("../docs/launch-checklist.md", import.meta.url), "utf8");
  for (const k of ["STRIPE_INSIGHTS_WEBHOOK_SECRET", "ENCORE_MARKET_INSIGHTS_SEAT_CENTS", "ENCORE_HOST_INSIGHTS_CENTS", "ENCORE_INSIGHTS_K", "ENCORE_DEMOGRAPHICS_MIN_OPTINS", "ENCORE_DEMOGRAPHICS", "ENCORE_INSIGHTS_DIGEST"]) assert.match(doc, new RegExp("`" + k + "`"));
  const ui = fs.readFileSync(new URL("../public/insightsui.js", import.meta.url), "utf8"); assert.match(ui, /#3D5DB3/); assert.match(ui, /data-pli-v="table"/, "a table view");
});

// ---------- the browser ----------
test("browser at 390 and 1280: Market insights (demo), locked, Host insights and Settings, with no sideways scroll", async () => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return; }
  fs.mkdirSync(SHOTS, { recursive: true }); const browser = await pw.chromium.launch(); const errors = [];
  const demo = cookies(await fetch(srv.base + "/teams/demo", { redirect: "manual" }));
  const shots = [["market-demo", demo, "/teams/market?city=austin&format=supper-club&by=dow", "#miH"], ["market-locked", await joinBrand(), "/teams/market", "#miL"], ["host-insights", U.ana.cookie, "/host/insights", ".card"], ["settings-who-comes", U.ben.cookie, "/settings#plDemoSet", "#plDemoSet:not([hidden])"]];
  try {
    for (const w of [390, 1280]) for (const [name, cookie, url, sel] of shots) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: "block" }); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
      await ctx.addCookies(cookie.split("; ").map((kv) => { const [k, ...v] = kv.split("="); return { name: k, value: v.join("="), url: srv.base }; }));
      const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${name} ${w}: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${name} ${w}: ${m.text()}`); });
      if (name === "settings-who-comes") await post("/api/me/demographics", {}, cookie, "DELETE");
      await p.goto(srv.base + url, { waitUntil: "load" }); await p.waitForSelector(sel, { timeout: 8000 });
      if (name === "settings-who-comes") { await p.click("#dmOn"); await p.waitForSelector("#plDemoSet select[data-dm=age]"); await p.selectOption("#plDemoSet select[data-dm=age]", "25-34"); await p.waitForSelector('#plDemoSet [data-rm="age"]'); await p.locator("#plDemoSet").scrollIntoViewIfNeeded(); }
      if (name === "market-demo") { const small = await p.evaluate(() => [...document.querySelectorAll("main button, main a.bb-btn, main select")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim().slice(0, 30)));
        assert.deepEqual(small, [], `taps under 44px at ${w}`); assert.match(await p.textContent("main"), /Example/); }
      const scroll = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(scroll <= 1, `${name} at ${w}: no sideways scroll (${scroll})`);
      await p.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: name !== "settings-who-comes" }); await ctx.close(); }
  } finally { await browser.close(); }
  assert.deepEqual(errors, []);
  async function joinBrand() { await join("brand2", "Bo Brand", "work", { company: "Quillon", city: "Austin" }); return U.brand2.cookie; }
});
