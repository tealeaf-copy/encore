// The brand panel round (server/brandpanel.js, server/crmsync.js): quick book, the money at risk by date, briefs both
// sides agree to, seat sources, the opt-in survey and its denominators, guest connections that need both yeses,
// follow-up tasks, metrics per goal, recommendations with confidence labels, pilots, host earnings and rebooking,
// the read-only summary link and the CRM adapters with fakes. The world is invented (test/brand-panel-seed.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedBrandPanel } from "./brand-panel-seed.js";
import { priceFor } from "../server/brandbook.js";
import { exposureSchedule, quickRank, editBrief, agreeBrief, briefState, briefDefaults, rosWithBrief, seatMix, surveySummary, askConnection, answerConnection, connectionsFor, connectionCounts, withdrawListing,
  cleanTask, taskSummary, goalMetrics, confidenceOf, recommend, pilotCompare, cleanPilot, hostEarnings, internalMetrics, ofN, accessNotes, summaryHtml } from "../server/brandpanel.js";
import * as CRM from "../server/crmsync.js";
import { defaultRunOfShow } from "../server/campaigns.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "brand-panel-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_INSIGHTS_CACHE_MS: "0", ENCORE_ADMIN_EMAILS: "ada@pl-admin.example" };
const J = { "content-type": "application/json" };
const req = (method, p, body, cookie) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
const get = (p, c) => req("GET", p, null, c), post = (p, b, c) => req("POST", p, b, c);
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t.slice(0, 400)}`); return JSON.parse(t); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekday = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) return d; } };
const today = day(0);
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedBrandPanel(srv.base, srv.store); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; delete process.env.ENCORE_FAKE_CRM; await srv.close(); });

// ---------------------------------------------------------------------------------------------------------------
test("money at risk by date follows the policy: free, then half the deposit, then the deposit, with the balance due 7 days out", () => {
  const date = day(30), X = exposureSchedule({ policy: "standard", totalCents: 176000, depositCents: 44000, date, today });
  assert.equal(X.freeUntil, day(16), "standard: free 14 or more days before");
  assert.equal(X.rows[0].atRiskCents, 0); assert.match(X.rows[0].label, /nothing at risk/);
  const at = (d) => X.rows.find((r) => r.from <= day(d) && r.until >= day(d))?.atRiskCents;
  assert.equal(at(20), 22000, "8 to 13 days before: half the deposit");
  assert.equal(at(23), 88000, "7 days before the balance is paid and half comes back");
  assert.equal(at(28), 44000, "under 7 days: the deposit stays with the host");
  assert.equal(X.maxAtRiskCents, 88000); assert.equal(X.nowAtRiskCents, 0);
  assert.match(X.line, /^Free to cancel until .+ After that, up to \$880 is at risk\.$/);
  assert.match(X.why, /^Why it goes up, then down: .+ the rest is due, and half of everything paid is at risk for that one day\. From .+ only the \$440 deposit stays with the host/, "one plain line says why the number rises and falls; the amounts are untouched");
  // inside the window already, the past rows are gone and today's risk shows
  const Y = exposureSchedule({ policy: "firm", totalCents: 100000, depositCents: 25000, date: day(10), today });
  assert.equal(Y.freeUntil, ""); assert.equal(Y.nowAtRiskCents, 25000, "firm, 10 days out: the deposit stays"); assert.ok(Y.rows.every((r) => r.until >= today)); assert.match(Y.line, /if you cancel now/); assert.equal(Y.why, "", "no line when the number only goes one way");
  assert.equal(exposureSchedule({ date: "" }).rows.length, 0);
});

test("quick rank: three different hosts, the group fits, the city matches, goal and open dates first", () => {
  const C = (h, extra = {}) => ({ handle: h, pkg: "p", name: h, minGuests: 6, maxGuests: 20, city: "New York", areaCity: "Brooklyn", area: "Greenpoint", moods: ["client"], perPersonCents: 9000, effectivePerPersonCents: 9000, totalCents: 108000, quality: 50, dateState: "open", ...extra });
  const L = quickRank([C("a"), C("a", { pkg: "q" }), C("b", { dateState: "closed", altDate: day(20) }), C("c", { moods: ["handson"] }), C("d", { maxGuests: 8 }), C("e", { city: "San Francisco", areaCity: "San Francisco", area: "Mission" }), C("f", { perPersonCents: 20000, effectivePerPersonCents: 20000 })], { people: 12, city: "New York", goal: "customer", budgetCents: 12000, date: day(20) });
  assert.equal(L.length, 3); assert.equal(new Set(L.map((x) => x.handle)).size, 3, "one card per host");
  assert.ok(!L.some((x) => ["d", "e"].includes(x.handle)), "too small and the wrong city are out");
  assert.equal(L[0].handle, "a"); assert.ok(L[0].why.includes("Open on your date") && L[0].why.includes("Suits a customer dinner"));
  assert.deepEqual(accessNotes({ access: ["step-free"] }).listed, ["step-free"]); assert.match(accessNotes({}).line, /hasn't listed/);
});

test("quick book over HTTP: 3 hosts with the full total, money at risk, accessibility and real availability", async () => {
  const date = weekday(21), d = await ok(await get(`/api/teams/quick?date=${date}&people=12&budget=130&city=New%20York&goal=customer`, S.owner.c));
  assert.equal(d.results.length, 3); assert.equal(new Set(d.results.map((x) => x.handle)).size, 3);
  for (const x of d.results) {
    const H = S.hosts.find((h) => h.handle === x.handle); assert.equal(H.city, "New York");
    assert.equal(x.totalCents, priceFor({ ...H.pkg, depositPct: 25, taxBps: 0 }, 12).totalCents, "the same total checkout shows");
    assert.match(x.summary, /total for 12$/); assert.ok(x.exposure.rows.length >= 2); assert.ok(x.exposure.maxAtRiskCents > 0 && x.exposure.maxAtRiskCents <= x.totalCents);
    assert.ok(x.access.line); assert.ok(["open", "closed", "booked", "notice"].includes(x.availability.state)); assert.ok(x.availability.line);
    assert.equal(x.approval.needed, false, "Fernwood has no approval rule"); }
  assert.ok(d.results.some((x) => x.availability.state === "open"));
  assert.equal(d.results[0].handle === "long-table" || d.results.some((x) => ["long-table", "corner-cellar"].includes(x.handle)), true, "customer dinners lead");
  // signed out works too (no approval line); a bad query says so
  assert.equal((await ok(await get(`/api/teams/quick?date=${date}&people=12&city=San%20Francisco&goal=team`))).results.every((x) => x.approval === null), true);
  assert.equal((await get(`/api/teams/quick?date=${date}&people=0`)).status, 400);
  assert.equal((await get(`/api/teams/quick?date=${day(-3)}&people=10`)).status, 400);
});

test("book one event with no campaign: a one-event guest list sits behind it, the brief is agreed by both before it's booked", async () => {
  const H = S.hosts.find((h) => h.handle === "wheel-and-kiln"), date = weekday(40);
  const j = await ok(await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 10, date, company: "Fernwood Labs", single: true, goal: "workshop", setupSec: 420, via: "quick",
    brief: { goal: "workshop", together: "class", mix: { brand: 8, host: 2 }, photos: "host", followup: "consented", plan: "Mugs on the wheel, then a glaze table." } }, S.owner.c));
  const r = srv.store.get("system/bbreq-" + j.id).data; assert.ok(r.campaignId); assert.equal(r.via, "quick");
  const c = srv.store.get("system/camp-" + r.campaignId).data; assert.equal(c.single, true); assert.deepEqual(c.bookings, [j.id]);
  let E = (await ok(await get(`/api/teams/events/${j.id}`, S.owner.c))).event;
  assert.equal(E.briefState.brand, true); assert.equal(E.briefState.host, false); assert.equal(E.briefState.waitingOn, "host");
  assert.ok(E.briefLines.some((l) => /8 brand-invited spots, 2 host-sourced spots/.test(l))); assert.equal(E.owner.email, S.owner.email);
  assert.ok(E.exposure.rows.length); assert.match(E.availability.line, /open/); assert.ok(E.access);
  // the campaign list says it's one event
  assert.equal((await ok(await get("/api/campaigns", S.owner.c))).campaigns.find((x) => x.id === c.id).single, true);
  // the host accepts: that is agreeing to the brief they read in their one place
  const hc = await ok(await get("/api/bb/host/confirm", H.c)); assert.ok(hc.events.some((e) => e.id === j.id && e.briefLines.length));
  assert.equal(hc.events.find((e) => e.id === j.id).owner.email, undefined, "the host sees a first name, not the brand's email");
  await ok(await post(`/api/bb/host/requests/${j.id}`, { action: "accept" }, H.c));
  E = (await ok(await get(`/api/teams/events/${j.id}`, S.owner.c))).event; assert.equal(E.briefState.agreed, true);
  // the host edits the brief: the brand is asked again; a mix bigger than the group is refused
  await ok(await post(`/api/bb/host/events/${j.id}/brief`, { creative: "shared", creativeNote: "Pick a glaze colour for your team." }, H.c));
  E = (await ok(await get(`/api/teams/events/${j.id}`, S.owner.c))).event; assert.equal(E.briefState.agreed, false); assert.equal(E.briefState.waitingOn, "brand"); assert.equal(E.brief.v, 2);
  assert.equal((await post(`/api/teams/events/${j.id}/brief`, { mix: { brand: 10, host: 4 } }, S.owner.c)).status, 400);
  await ok(await post(`/api/teams/events/${j.id}/brief`, {}, S.owner.c));
  E = (await ok(await get(`/api/teams/events/${j.id}`, S.owner.c))).event; assert.equal(E.briefState.agreed, true);
  // it shows in the run of show
  const ros = (await ok(await get(`/api/campaigns/${c.id}`, S.owner.c))).campaign.ros[j.id];
  assert.ok(ros.some((x) => /^A hands-on class: Mugs on the wheel/.test(x.what))); assert.ok(ros.some((x) => /^Brief: Only the host's recap photos/.test(x.what)));
  // another brand can't read it
  assert.equal((await get(`/api/teams/events/${j.id}`, S.juniper.c)).status, 404);
  // turn it into a series: format, segments, approvals and the brief come along
  const sr = await ok(await post(`/api/teams/events/${j.id}/series`, { title: "Clay nights for platform teams", cities: "New York, San Francisco", events: 4, segments: "Engineers" }, S.owner.c));
  const c2 = srv.store.get("system/camp-" + sr.id).data; assert.equal(c2.single, false); assert.deepEqual(c2.cities.sort(), ["New York", "San Francisco"].sort()); assert.equal(c2.series.events, 4); assert.equal(c2.series.brief.together, "class"); assert.deepEqual(c2.audience.tags, ["Engineers"]);
  assert.equal(c2.budgetCents, r.price.totalCents * 4);
});

test("briefs: a fresh brief, agreeing, any edit asks the other side again, the run of show picks it up once", () => {
  const D = briefDefaults("community", 20); assert.deepEqual(D.mix, { brand: 10, host: 10 }); assert.equal(D.together, "introductions"); assert.equal(D.invites, "both");
  let { brief: b } = editBrief(null, { goal: "customer" }, { side: "brand", who: "Maya", headcount: 12 }); assert.equal(b.v, 1); assert.deepEqual(briefState(b), { agreed: false, brand: true, host: false, waitingOn: "host", line: "Waiting on the host to agree" });
  b = agreeBrief(b, "host", "Ines"); assert.equal(briefState(b).agreed, true); assert.equal(b.v, 1, "agreeing doesn't make a new version");
  const e = editBrief(b, { photos: "none" }, { side: "brand", who: "Maya", headcount: 12 }); assert.equal(e.changed, true); assert.equal(e.brief.v, 2); assert.equal(briefState(e.brief).waitingOn, "host");
  assert.equal(editBrief(b, { photos: "anything" }, { side: "brand", headcount: 12 }).brief.photos, b.photos, "unknown options are ignored");
  assert.match(editBrief(b, { mix: { brand: 10, host: 5 } }, { headcount: 12 }).error, /more than the group of 12/);
  assert.equal(editBrief(b, { mix: { brand: 8, host: 4 } }, { headcount: 12 }).brief.invites, "both", "host seats mean the host invites too");
  const items = rosWithBrief(defaultRunOfShow("19:00"), b), again = rosWithBrief(items, b);
  assert.ok(items.some((x) => x.what.startsWith("Roundtables: "))); assert.equal(items.filter((x) => x.what.startsWith("Brief: ")).length, 2); assert.equal(again.filter((x) => x.what.startsWith("Brief: ")).length, 2, "no doubles");
});

test("seat sources: brand-invited and host-sourced seats counted apart, host seats need the brief's room", async () => {
  const M = seatMix([{ status: "yes", checkedIn: true, invitedAt: 1 }, { status: "no", invitedAt: 1 }, { status: "asked" }, { status: "yes", invitedAt: 1 }], [{ checkedIn: true, follower: true }, { checkedIn: false, follower: true }, { checkedIn: true }], { brand: 8, host: 3 });
  assert.deepEqual(M.brand, { invited: 3, yes: 2, attended: 1 }); assert.deepEqual(M.host, { added: 3, attended: 2, followers: 2, followersAttended: 1 }); assert.equal(M.attended, 3); assert.deepEqual(M.planned, { brand: 8, host: 3 });
  // over HTTP on an upcoming Fernwood event with 8 host seats in the brief
  const id = S.bookings.b3, H = S.hosts.find((h) => h.handle === "dice-and-dumplings");
  await ok(await post(`/api/bb/host/events/${id}/confirm`, { capacity: 24, hostSeats: 8 }, H.c));
  assert.equal((await post(`/api/bb/host/events/${id}/confirm`, { capacity: 10 }, H.c)).status, 400, "less room than booked is a change request, not a confirmation");
  const p = S.people.find((x) => x.city === "New York");
  let L = (await ok(await post(`/api/bb/host/events/${id}/seats`, { name: p.name, email: p.email, follower: true }, H.c))).hostSeats; assert.equal(L.length, 1); assert.equal(L[0].follower, true);
  assert.equal((await post(`/api/bb/host/events/${id}/seats`, { name: "No Email", email: "not-an-email" }, H.c)).status, 400);
  assert.equal((await post(`/api/bb/host/events/${id}/seats`, { name: "Someone" }, S.owner.c)).status, 409, "a brand can't add host seats");
  const E = (await ok(await get(`/api/teams/events/${id}`, S.owner.c))).event; assert.equal(E.seats.host.added, 1); assert.equal(E.seats.planned.host, 8); assert.ok(E.seats.brand.invited > 0); assert.ok(E.timeline.some((t) => /confirmed room for 24/.test(t.what)));
  // a change the brand asks for, answered by the host in the same place
  const ch = (await ok(await post(`/api/teams/events/${id}/changes`, { headcount: 26, note: "Two more from our team." }, S.owner.c))).event.changes.pop();
  assert.equal((await post(`/api/teams/events/${id}/changes`, { headcount: 400 }, S.owner.c)).status, 400);
  await ok(await post(`/api/bb/host/events/${id}/changes/${ch.id}`, { yes: true }, H.c)); assert.equal(srv.store.get("system/bbreq-" + id).data.headcount, 26);
  assert.equal((await post(`/api/bb/host/events/${id}/changes/${ch.id}`, { yes: true }, H.c)).status, 409, "answered once");
});

test("the survey: opt in, every consent separate, shares only from 5 answers, denominators alongside", () => {
  const T = { a: { side: "brand", first: "Ana" }, b: { side: "host", first: "Bo" }, c: { side: "host", first: "Cy" }, d: { side: "brand", first: "Di" } };
  const R = { a: { useful: true, back: true, contactOk: true, listed: true }, b: { useful: false, matchOk: true, company: "Larkspur", followHost: true, nextOk: true }, c: { useful: true, quoteOk: true, said: "Met two people I'll call next week." } };
  const s = surveySummary(T, R);
  assert.equal(s.asked, 4); assert.equal(s.respondents, 3); assert.deepEqual([s.useful.n, s.useful.of, s.useful.pct], [2, 3, null], "3 answers: no percentage");
  assert.deepEqual([s.matchOk.n, s.matchOk.of], [1, 2], "account matching is out of host-sourced respondents only");
  assert.deepEqual([s.contactOk.n, s.followHost.n, s.nextOk.n], [1, 1, 1], "brand contact, following the host and the next one are separate");
  assert.equal(s.quotes.length, 1); assert.equal(s.quotes[0].name, "Cy"); assert.equal(s.perception.before, null);
  assert.equal(ofN(4, 5).pct, 80); assert.equal(ofN(4, 4).pct, null); assert.equal(ofN(1, 12).text, "1 of 12");
});

test("survey over HTTP: closed before the event, follow the host needs an email, agreeing to contact makes a sales task", async () => {
  // upcoming: no link yet
  assert.equal((await post(`/api/teams/events/${S.bookings.b3}/survey`, {}, S.owner.c)).status, 409);
  const id = S.bookings.b2, out = await ok(await post(`/api/teams/events/${id}/survey`, {}, S.owner.c)); assert.ok(out.brand > 5); assert.ok(out.host >= 3);
  const ev = srv.store.get("system/bpev-" + id).data, [t] = Object.entries(ev.survey.tokens).find(([k, x]) => x.side === "brand" && !ev.survey.responses[k]) || [];
  assert.ok(t, "a guest who hasn't answered");
  const v = await ok(await get(`/api/survey/${t}`)); assert.equal(v.company, "Fernwood Labs"); assert.equal(v.answer, null); assert.deepEqual(v.others, [], "nobody listed until you choose to be");
  const c0 = srv.store.get("system/camp-" + S.campaigns.C1).data, gid = ev.survey.tokens[t].gid, tasks0 = (c0.tasks || []).length;
  await ok(await post(`/api/survey/${t}`, { useful: true, back: true, contactOk: true, followHost: true, nextOk: true }));
  const c1 = srv.store.get("system/camp-" + S.campaigns.C1).data; assert.equal(c1.tasks.length, tasks0 + 1); assert.equal(c1.tasks.at(-1).team, "sales"); assert.equal(c1.guests.find((g) => g.id === gid).consent.share, true);
  const H = S.hosts.find((h) => h.handle === "mission-table"); assert.ok(srv.store.get(`ws/${H.ws}/teambook/next`).data.list.length >= 1, "the next one is the host's list");
  // a host guest without an email has to give one to follow the host
  const hs = srv.store.get("system/bpev-" + id).data; hs.hostSeats.push({ id: "noemail1", name: "Wren Quill", email: "", follower: false, checkedIn: true }); srv.store.set("system/bpev-" + id, hs);
  await ok(await post(`/api/teams/events/${id}/survey`, {}, S.owner.c));
  const [ht] = Object.entries(srv.store.get("system/bpev-" + id).data.survey.tokens).find(([, x]) => x.sid === "noemail1");
  assert.equal((await post(`/api/survey/${ht}`, { followHost: true })).status, 400); await ok(await post(`/api/survey/${ht}`, { followHost: true, email: "wren@guest.example", matchOk: true, company: "Kestrel Labs" }));
  assert.equal((await get("/api/survey/" + "0".repeat(24))).status, 404);
  // the outcome counts carry their denominators
  const O = await ok(await get(`/api/campaigns/${S.campaigns.C1}/outcomes`, S.owner.c));
  assert.ok(O.denominators.find((d) => d.label === "Survey respondents").of >= O.denominators.find((d) => d.label === "Survey respondents").n);
  assert.ok(O.totals.targets.hostMatched.of >= O.totals.targets.hostMatched.n && O.totals.targets.hostMatched.n >= 1);
  assert.ok(O.denominators.some((d) => d.label === "Host-sourced guests" && /came of/.test(d.text)));
});

test("connections: only between listed guests, contact passes only when both said yes, the brand sees counts", () => {
  const ev = { survey: { tokens: { a: { first: "Ana", email: "ana@x.example" }, b: { first: "Bo", email: "bo@x.example" }, c: { first: "Cy" } }, responses: { a: { listed: true }, b: { listed: true, contact: "linkedin.com/in/bo" }, c: { listed: false } } }, connections: [] };
  assert.match(askConnection(ev, "a", "c").error, /hasn't chosen/); assert.match(askConnection(ev, "c", "a").error, /first/); assert.match(askConnection(ev, "a", "a").error, /you/);
  assert.equal(askConnection(ev, "a", "b").mutual, false);
  assert.deepEqual(connectionsFor(ev, "a").mutual, [], "one way: no details"); assert.deepEqual(connectionsFor(ev, "b").incoming, [{ from: "a", first: "Ana" }]);
  assert.equal(answerConnection(ev, "b", "a", true).mutual, true);
  assert.deepEqual(connectionsFor(ev, "a").mutual, [{ token: "b", first: "Bo", contact: "linkedin.com/in/bo" }]); assert.equal(connectionsFor(ev, "b").mutual[0].contact, "ana@x.example");
  const n = connectionCounts(ev); assert.equal(n.mutual, 1); assert.deepEqual([n.guestsConnected.n, n.guestsConnected.of], [2, 3]); assert.equal(JSON.stringify(n).includes("ana@"), false);
  // saying no, and leaving the list, close pending requests
  const ev2 = { survey: { tokens: { a: {}, b: {} }, responses: { a: { listed: true }, b: { listed: true } } }, connections: [] }; askConnection(ev2, "a", "b"); answerConnection(ev2, "b", "a", false); assert.deepEqual(connectionsFor(ev2, "a").mutual, []);
  const ev3 = { survey: { tokens: { a: {}, b: {} }, responses: { a: { listed: true }, b: { listed: true } } }, connections: [] }; askConnection(ev3, "a", "b"); withdrawListing(ev3, "b"); assert.equal(connectionsFor(ev3, "b").incoming.length, 0);
});

test("connections over HTTP: both guests must opt in; the other guest sees the request, not the email, until they say yes", async () => {
  const id = S.bookings.b1, ev = srv.store.get("system/bpev-" + id).data, T = Object.keys(ev.survey.tokens).filter((t) => ev.survey.tokens[t].side === "brand" && !ev.survey.responses[t]);
  if (T.length < 2) { await ok(await post(`/api/teams/events/${id}/survey`, {}, S.owner.c)); }
  const ev2 = srv.store.get("system/bpev-" + id).data, [a, b] = Object.keys(ev2.survey.tokens).filter((t) => ev2.survey.tokens[t].side === "brand" && !ev2.survey.responses[t]);
  await ok(await post(`/api/survey/${a}`, { useful: true, listed: true, contact: "a-person@guest.example" }));
  assert.equal((await post(`/api/survey/${a}/connect`, { to: b })).status, 400, "b hasn't chosen to be listed");
  const vb = await ok(await post(`/api/survey/${b}`, { useful: true, listed: true }));
  assert.ok(vb.others.some((o) => o.token === a)); assert.equal(JSON.stringify(vb.others).includes("@"), false, "no emails in the list");
  await ok(await post(`/api/survey/${a}/connect`, { to: b }));
  let B = await ok(await get(`/api/survey/${b}`)); assert.deepEqual(B.connections.incoming.map((x) => x.from), [a]); assert.equal(B.connections.mutual.length, 0);
  B = await ok(await post(`/api/survey/${b}/connect`, { to: a, answer: true })); assert.equal(B.mutual, true); assert.equal(B.connections.mutual[0].contact, "a-person@guest.example");
  const O = await ok(await get(`/api/campaigns/${S.campaigns.C1}/outcomes`, S.owner.c)); assert.ok(O.totals.connections.mutual >= 1); assert.equal(JSON.stringify(O.totals.connections).includes("a-person@"), false);
});

test("follow-up tasks: an owner on the team, a due date and a status; viewers read only; done and useful counts", async () => {
  assert.match(cleanTask({ title: "x", owner: "nobody@x.example" }, {}, { members: ["a@x.example"] }).error, /on your team/); assert.match(cleanTask({ title: "" }).error, /needs doing/);
  const T = cleanTask({ title: "Send the deck", team: "content", owner: "a@x.example", due: day(2) }, {}, { members: ["a@x.example"] }).task; assert.equal(T.status, "open"); assert.equal(T.team, "content");
  const s = taskSummary([T, { ...T, id: "2", status: "done", result: "useful" }, { ...T, id: "3", due: day(-1) }], today); assert.deepEqual([s.open, s.done, s.overdue, s.useful], [2, 1, 1, 1]);
  const id = S.campaigns.C1, n0 = (await ok(await get(`/api/campaigns/${id}/outcomes`, S.owner.c))).tasks.length;
  let O = await ok(await post(`/api/campaigns/${id}/tasks`, { title: "Intro Tidewater to our solutions engineer", team: "sales", owner: S.editor.email, due: day(5) }, S.owner.c)); assert.equal(O.tasks.length, n0 + 1);
  const t = O.tasks.at(-1); assert.equal(t.ownerName, S.editor.name);
  assert.equal((await post(`/api/campaigns/${id}/tasks`, { title: "Nope", owner: "rui@otherbrand.example" }, S.owner.c)).status, 400);
  assert.equal((await post(`/api/campaigns/${id}/tasks`, { id: t.id, status: "done" }, S.viewer.c)).status, 403, "viewers can't change tasks");
  O = await ok(await post(`/api/campaigns/${id}/tasks`, { id: t.id, status: "done", result: "useful" }, S.editor.c)); assert.equal(O.tasks.find((x) => x.id === t.id).status, "done");
  assert.ok(O.totals.tasks.useful >= 2); assert.ok(O.totals.costPerUsefulFollowUpCents > 0);
  // meetings and opportunities are logged apart from attendance
  assert.ok(O.totals.meetings >= 1); assert.equal(O.totals.opportunities.n, 1); assert.equal(O.totals.opportunities.amountCents, 4800000); assert.ok(O.totals.attendance.attended > 0);
  assert.equal((await post(`/api/campaigns/${id}/outcomes`, { kind: "lunch", account: "x" }, S.owner.c)).status, 400);
  // target accounts: invited vs came, and the cost per target-account guest
  assert.equal(O.totals.targets.accounts, 12); assert.ok(O.totals.targets.invited.n >= O.totals.targets.attended.n && O.totals.targets.attended.n > 0); assert.ok(O.totals.costPerTargetCents > 0);
});

test("each goal has its own report: a customer dinner counts accounts and pipeline, a community counts who comes back", async () => {
  const ev = (o) => ({ id: o.id, status: "done", costCents: 100000, seats: { attended: 10, brand: { yes: 10 }, host: { added: 2 } }, targets: { attended: o.t || [] }, survey: { useful: { n: 3, of: 8 }, back: { n: 6, of: 8 }, nextOk: { n: 4, of: 8 }, followHost: { n: 2, of: 8 } }, returning: o.r || 0 });
  const cust = goalMetrics("customer", [ev({ id: "e1", t: ["larkspur", "tidewater"] })], { tasks: [{ event: "e1", status: "done", result: "useful" }], outs: [{ kind: "meeting", event: "e1" }, { kind: "opportunity", event: "e1" }], targets: ["larkspur", "tidewater", "quarry"] });
  assert.deepEqual(cust.map((m) => m.k), ["targetsAttended", "meetings", "opportunities", "costPerTarget", "usefulFollowUps"]);
  assert.equal(cust[0].text, "2 of 3"); assert.equal(cust[3].cents, 50000); assert.equal(cust[4].costCents, 100000);
  const com = goalMetrics("community", [ev({ id: "e2", r: 4 })]);
  assert.deepEqual(com.map((m) => m.k), ["returning", "costPerReturning", "nextOptIns", "hostFollows", "useful"]); assert.equal(com[0].text, "4 of 10"); assert.equal(com[1].cents, 25000);
  assert.deepEqual(goalMetrics("team", []).map((m) => m.k), ["showRate", "useful", "back", "costPerGuest"]);
  // over HTTP the campaign groups its events by goal
  const O = await ok(await get(`/api/campaigns/${S.campaigns.C1}/outcomes`, S.owner.c));
  assert.ok(O.goals.some((g) => g.goal === "customer" && g.metrics[0].k === "targetsAttended")); assert.ok(O.goals.some((g) => g.goal === "community"));
});

test("recommendations: hidden below 10 people and 3 events, every one with its sample and a confidence label, no ranking from early signals", async () => {
  assert.equal(confidenceOf(2), null); assert.equal(confidenceOf(3).label, "Early signal: 3 events"); assert.equal(confidenceOf(12).level, "building"); assert.equal(confidenceOf(24).label, "Strong: 24 events");
  const cells = [{ host: "Tiny", events: 2, respondents: 40, people: 40, useful: 40 }, { host: "Few", events: 4, respondents: 9, people: 9, useful: 9 }, { host: "A", events: 3, respondents: 12, people: 12, useful: 12 }, { host: "B", events: 24, respondents: 200, people: 200, useful: 150 }];
  const R = recommend(cells); assert.deepEqual(R.items.map((x) => x.host), ["B", "A"], "shrunk toward even: 12 of 12 from 3 events doesn't beat 150 of 200 from 24"); assert.equal(R.hidden, 2);
  assert.equal(R.ranked, false, "an early signal in the top two means no ranking"); assert.match(R.note, /lead to test/); assert.equal(R.items[1].confidence.label, "Early signal: 3 events"); assert.match(R.items[0].sample, /200 guests answered, across 24 events/);
  assert.equal(recommend([{ host: "X", events: 12, respondents: 30, people: 30, useful: 20 }, { host: "Y", events: 25, respondents: 90, people: 90, useful: 40 }]).ranked, true);
  // over HTTP, from Juniper's and Fernwood's past events, pooled
  const d = await ok(await get("/api/teams/recommendations?city=New%20York", S.owner.c));
  assert.ok(d.items.length >= 1); for (const x of d.items) { assert.ok(x.events >= 3 && x.respondents >= 10); assert.ok(x.confidence.label); assert.ok(x.sample); }
  assert.ok(d.items.some((x) => x.host === "Long Table Supper Club" && x.format === "roundtable")); assert.match(d.headline, /led to the most useful connections$/);
  assert.equal(JSON.stringify(d).includes("@"), false, "no emails");
  const e = await ok(await get("/api/teams/recommendations?city=New%20York&audience=engineers", S.owner.c)); assert.ok(e.items.every((x) => x.respondents >= 10));
  assert.equal((await get("/api/teams/recommendations", S.hosts[0].c)).status, 403, "brands only");
});

test("pilot: the usual process against ours, and setup time falling on repeats", async () => {
  const P = cleanPilot({ baseline: { planningHours: 20, approvalSteps: 4, attendance: 30, daysToList: 10 }, ours: { planningHours: 5 } });
  const Cmp = pilotCompare(P, { approvalSteps: 2, attendance: 34, daysToList: 2 }, [{ minutes: 20 }, { minutes: 9 }, { minutes: 4 }]);
  const row = (k) => Cmp.rows.find((r) => r.k === k);
  assert.deepEqual([row("planningHours").usual, row("planningHours").ours, row("planningHours").improved, row("planningHours").change], [20, 5, true, -75]);
  assert.equal(row("attendance").improved, true); assert.equal(row("daysToList").line, "8d fewer (80%)"); assert.equal(Cmp.filled, 4);
  assert.equal(Cmp.setup.falling, true); assert.equal(Cmp.setup.line, "Setup took 20 minutes the first time and 4 minutes on the latest.");
  assert.equal(pilotCompare(cleanPilot({}), {}).filled, 0);
  const O = await ok(await get(`/api/campaigns/${S.campaigns.C1}/outcomes`, S.owner.c)); const C = O.pilot.compare;
  assert.equal(C.rows.find((r) => r.k === "planningHours").ours, 6); assert.equal(C.rows.find((r) => r.k === "attendance").ours, O.totals.attendance.attended);
  assert.ok(C.rows.find((r) => r.k === "approvalSteps").ours >= 1); assert.equal(C.setup.falling, true); assert.equal(C.setup.times[0].minutes, 21);
  assert.equal((await post(`/api/campaigns/${S.campaigns.C1}/pilot`, { baseline: { planningHours: 1 } }, S.viewer.c)).status, 403);
});

test("host earnings: repeat revenue, brands that rebook, seats from followers, bookings from the host's audience", async () => {
  const R = (id, brand, cents, extra = {}) => ({ id, brandWs: brand, status: "booked", date: day(-10), price: { totalCents: cents }, createdAt: 1, ...extra });
  const E = hostEarnings([R("a", "w1", 100000), R("b", "w1", 80000, { date: day(-5) }), R("c", "w2", 50000, { via: "host-page" }), R("d", "w3", 70000, { status: "declined" }), R("e", "w3", 40000, { status: "cancelled", payments: [{ state: "charged", cents: 10000 }] })],
    { hostSeats: { a: [{ follower: true }, { follower: false }], c: [{ follower: true }] }, followerEmails: new Set() });
  assert.equal(E.revenueCents, 240000); assert.equal(E.repeatRevenueCents, 80000); assert.equal(E.repeatSharePct, 33);
  assert.deepEqual([E.brandRebook.n, E.brandRebook.of], [1, 3]); assert.deepEqual([E.followerFill.n, E.followerFill.of], [2, 3]); assert.deepEqual([E.fromAudience.n, E.fromAudience.of], [1, 4]);
  const M = internalMetrics([R("a", "w1", 100000, { hostWs: "h1", date: "2026-01-10" }), R("b", "w1", 80000, { hostWs: "h1", date: "2026-03-10" }), R("c", "w2", 50000, { hostWs: "h2", date: "2026-01-20" })], { followerShare: [{ attended: 10, fromFollowers: 4 }] });
  assert.deepEqual(M.cohorts, [{ cohort: "2026-01", hosts: 2, again90: 1, againAny: 1, again90Pct: 50, againAnyPct: 50 }]); assert.equal(M.brandRebook.text, "1 of 2"); assert.equal(M.sameHostRebook.n, 1); assert.equal(M.repeatRevenuePerHostCents, 40000); assert.equal(M.ownEventsFromFollowers.text, "4 of 10");
  // over HTTP, for Long Table (booked by Fernwood twice and by Juniper six times)
  const H = S.hosts.find((h) => h.handle === "long-table"), d = await ok(await get("/api/bb/host/earnings", H.c));
  assert.ok(d.revenueCents > 0 && d.repeatRevenueCents > 0); assert.equal(d.brandRebook.text, "2 of 2"); assert.ok(d.months.length >= 1);
  assert.equal((await get("/api/bb/host/earnings", S.owner.c)).status, 409, "brands have no host page");
  // admin only
  assert.equal((await get("/api/admin/brand-metrics", S.owner.c)).status, 404); assert.equal((await get("/admin/brand-metrics", S.owner.c)).status, 404);
});

test("rebooking: Book again copies the brief; Your hosts lists past outcomes", async () => {
  const H = S.hosts.find((h) => h.handle === "long-table"), j = await ok(await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 14, date: weekday(50), company: "Fernwood Labs", againOf: S.bookings.b1, via: "again", single: true }, S.owner.c));
  const E = (await ok(await get(`/api/teams/events/${j.id}`, S.owner.c))).event; assert.equal(E.againOf, S.bookings.b1); assert.equal(E.brief.together, "roundtable"); assert.equal(E.brief.plan, "Three tables of six, one question for each course."); assert.equal(E.briefState.brand, true); assert.equal(E.briefState.host, false);
  assert.equal((await post("/api/bb/requests", { handle: H.handle, pkg: H.pkgId, headcount: 14, date: weekday(52), company: "Juniper Health", againOf: S.bookings.b1 }, S.juniper.c)).ok, true);
  const L = await ok(await get("/api/teams/hosts", S.owner.c)), lt = L.hosts.find((h) => h.handle === "long-table");
  assert.ok(lt.events >= 2); assert.ok(lt.done >= 2); assert.ok(lt.came > 0); assert.ok(lt.useful.of > 0); assert.equal(lt.rating, 5); assert.ok(lt.brief.length);
  assert.equal(L.hosts.some((h) => h.handle === "slow-pour"), false, "only hosts who accepted");
});

test("the summary link: private, read only for anyone with the key, no guest names or emails, and it can be turned off", async () => {
  const id = S.bookings.b1;
  assert.equal((await get(`/teams/e/${id}`)).status, 404); assert.equal((await get(`/teams/e/${id}?k=nope`)).status, 404);
  const { url } = await ok(await post(`/api/teams/events/${id}/summary-link`, {}, S.owner.c)); assert.match(url, /^\/teams\/e\/[a-f0-9]+\?k=[a-f0-9]{20}$/);
  const html = await (await get(url)).text(); assert.match(html, /Event summary/); assert.match(html, /Owner/); assert.match(html, /Approval/); assert.match(html, /Timeline/); assert.match(html, /Supper club for your team/);
  const c = srv.store.get("system/camp-" + S.campaigns.C1).data; for (const g of c.guests.filter((g) => g.event === id).slice(0, 10)) { assert.equal(html.includes(g.email), false); assert.equal(html.includes(g.name), false); }
  assert.equal(/—/.test(html), false, "no em dashes");
  const E = (await ok(await get(`/api/teams/events/${id}`, S.owner.c))).event; assert.equal(E.summaryUrl, url);
  assert.equal((await post(`/api/teams/events/${id}/owner`, { email: "rui@otherbrand.example" }, S.owner.c)).status, 400);
  assert.equal((await ok(await post(`/api/teams/events/${id}/owner`, { email: S.editor.email }, S.owner.c))).event.owner.name, S.editor.name);
  await ok(await post(`/api/teams/events/${id}/summary-link`, { off: true }, S.owner.c)); assert.equal((await get(url)).status, 404);
  assert.match(summaryHtml({ ...E, timeline: [] }), /Nothing yet/);
});

test("personal invites: a short note from a named person and a one-tap I'm in on the guest's own link", async () => {
  const c = srv.store.get("system/camp-" + S.campaigns.C1).data, g = c.guests.find((x) => x.event === S.bookings.b3 && x.token);
  const d = await ok(await get(`/api/cg/${c.id}/r/${g.token}`)); assert.equal(d.from.name, "Maya Lindqvist"); assert.match(d.from.note, /twelve engineers/);
  assert.equal((await post(`/api/campaigns/${c.id}/invite-from`, { name: "" }, S.owner.c)).status, 400); assert.equal((await post(`/api/campaigns/${c.id}/invite-from`, { name: "Sam" }, S.viewer.c)).status, 403);
  const past = c.guests.find((x) => x.event === S.bookings.b2 && x.checkedIn), p = await ok(await get(`/api/cg/${c.id}/r/${past.token}`)); assert.match(p.survey, /^\/survey\/[a-f0-9]{24}$/);
});

test("CRM adapters (beta): a dry run is consent only and never feedback, a fake transport syncs, live needs a connection", async () => {
  const c = { title: "Q1 dinners", guests: [{ name: "Ana Abbott", email: "ANA@x.example", company: "Larkspur", title: "Staff engineer", event: "e1", status: "yes", checkedIn: true, consent: { share: true, at: Date.parse("2026-10-01") }, said: "Loved it", again: true, quoteOk: true },
    { name: "Bo Bram", email: "bo@x.example", event: "e1", status: "yes", checkedIn: true, consent: { share: false } }, { name: "Cy", email: "", consent: { share: true } }, { name: "Di Dunn", email: "di@x.example", status: "asked", consent: { share: true } }] };
  const ev = { e1: { name: "Supper", date: "2026-10-10", host: "Long Table" } };
  for (const k of ["hubspot", "salesforce"]) { const D = CRM.dryRun(k, c, ev, {}); assert.equal(D.wouldSend, 1); assert.equal(D.skipped.noConsent, 1); assert.equal(D.skipped.noEmail, 1); assert.equal(D.beta, true);
    const body = JSON.stringify(D.requests); assert.equal(body.includes("Loved it"), false); assert.equal(body.includes("bo@x.example"), false); assert.ok(body.includes("ana@x.example")); }
  assert.deepEqual(CRM.dryRun("hubspot", c, ev, {}).requests[0].body.inputs[0].properties, { email: "ana@x.example", firstname: "Ana", lastname: "Abbott", company: "Larkspur", jobtitle: "Staff engineer", pottery_lab_campaign: "Q1 dinners", pottery_lab_event: "Supper", pottery_lab_event_date: "2026-10-10", pottery_lab_attended: "Yes" });
  assert.equal(CRM.dryRun("salesforce", c, ev, {}).requests[0].body.records[0].attributes.type, "Lead");
  // a mapping can drop fields but never the required ones, and never map feedback
  const M = CRM.cleanMapping("hubspot", { title: "", said: "notes", email: "" }); assert.equal(M.email, "email"); assert.equal(M.title, "", "left blank on purpose"); assert.equal(M.said, undefined);
  const F = CRM.fakeTransport(), out = await CRM.sync("hubspot", c, ev, {}, { transport: F.fn, token: "t" }); assert.equal(out.sent, 1); assert.equal(F.calls.length, 1); assert.equal(F.calls[0].path, "/crm/v3/objects/contacts/batch/upsert"); assert.equal(F.calls[0].headers.Authorization, "Bearer t");
  const F2 = CRM.fakeTransport({ fail: 1 }); assert.equal((await CRM.sync("salesforce", c, ev, {}, { transport: F2.fn })).errors.length, 1);
  assert.deepEqual(CRM.configFor("hubspot", {}).missing, ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", "HUBSPOT_REDIRECT_URI"]); assert.equal(CRM.configFor("hubspot", {}).authorizeUrl("s"), "");
  assert.match(CRM.configFor("salesforce", { SF_CLIENT_ID: "id", SF_CLIENT_SECRET: "s", SF_REDIRECT_URI: "https://x.example/cb" }).authorizeUrl("st"), /^https:\/\/login\.salesforce\.com\/services\/oauth2\/authorize\?client_id=id/);
  // over HTTP: preview works unconnected, sync needs a connection, the fake connect flow then syncs
  const id = S.campaigns.C1, P = await ok(await post(`/api/campaigns/${id}/crm/hubspot/preview`, {}, S.owner.c)); assert.ok(P.wouldSend > 0); assert.ok(P.skipped.noConsent > 0);
  assert.equal((await post(`/api/campaigns/${id}/crm/hubspot/preview`, {}, S.viewer.c)).status, 403);
  assert.equal((await post(`/api/campaigns/${id}/crm/hubspot/sync`, {}, S.owner.c)).status, 409);
  assert.equal((await get(`/api/crm/hubspot/connect`, S.owner.c)).status, 409, "not set up on this server");
  process.env.ENCORE_FAKE_CRM = "1";
  const r1 = await get(`/api/crm/hubspot/connect?back=/teams/campaigns/${id}/measure`, S.owner.c); assert.equal(r1.status, 302); const r2 = await get(r1.headers.get("location"), S.owner.c); assert.equal(r2.status, 302); assert.equal(r2.headers.get("location"), `/teams/campaigns/${id}/measure`);
  await ok(await post(`/api/campaigns/${id}/crm/hubspot/mapping`, { mapping: { title: "" } }, S.owner.c));
  const s = await ok(await post(`/api/campaigns/${id}/crm/hubspot/sync`, {}, S.owner.c)); assert.equal(s.sent, P.wouldSend); assert.equal(s.errors.length, 0);
  const O = await ok(await get(`/api/campaigns/${id}/outcomes`, S.owner.c)); assert.equal(O.crm.hubspot.connected, true); assert.equal(O.crm.hubspot.last.fake, true); assert.equal(O.crm.hubspot.mapping.title, "");
  delete process.env.ENCORE_FAKE_CRM;
});

test("what it's like: recap photos only with consent, quotes only from guests who said yes, the content rule in plain words", async () => {
  const H = S.hosts.find((h) => h.handle === "long-table");
  await ok(await post("/api/bb/host/recap", { photos: [{ url: "/_blob/abcdefghijklmnopqrst", caption: "The long table", consent: true }, { url: "/_blob/bbbbbbbbbbbbbbbbbbbb", consent: false }, { url: "https://elsewhere.example/x.jpg", consent: true }] }, H.c));
  const d = await ok(await get(`/api/bb/x/long-table/${H.pkgId}/like`)); assert.deepEqual(d.photos.map((p) => p.url), ["/_blob/abcdefghijklmnopqrst"]);
  assert.ok(d.quotes.length >= 1 && d.quotes.every((q) => q.name && !q.name.includes(" "))); assert.equal(d.capture.rule, "consent"); assert.match(d.capture.line, /photograph guests who agree/);
});

test("pages: the new brand pages load, the admin page is admin only, and the hero says who it's for", async () => {
  for (const p of ["/teams/hosts", "/teams/discover", "/teams/home", "/survey/abc"]) assert.equal((await get(p)).status, 200, p);
  const html = await (await get("/teams/discover")).text(); assert.match(html, /field, community and brand marketers/i); assert.equal(/—/.test(html), false);
  for (const w of ["seamless", "effortless", "unlock", "elevate", "curated", "magical"]) assert.equal(new RegExp(w, "i").test(html), false, w);
});
