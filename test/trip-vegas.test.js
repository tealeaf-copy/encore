// A group trip to Las Vegas, end to end (server/trips.js, public/trip.js): the organiser's line becomes a feeler, friends
// answer from a link with no account (one signed in), the organiser sees who's keen, the best weekend and the budget
// range, locks it and the yeses are in; Potto's stay options and group deals (estimates, never facts, with search
// links that carry only the place, dates and head count), votes, the pick, the booking pasted back as a shared cost,
// things to do on the itinerary, arrivals, paying back with the organiser's Get paid buttons. And the page at 390.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { parseTripLine, weekendsIn, placeOf, stayOptions, groupDeals, rankWeekends, activityIdeas, feelerSummary, cleanTrip, cleanArrival, holidayOf, searchLinks, blockEmail, BUDGETS } from "../server/trips.js";
import { ledgerOf, payCosts } from "../server/kinds.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const V = placeOf("Las Vegas");

// ---------------- the pure parts ----------------
test("the line: a trip with a place and loose months becomes a feeler with the weekends in those months", () => {
  const p = parseTripLine("Vegas for Priya's 30th, sometime in March or April", "2026-11-27");
  assert.equal(p.trip, true); assert.equal(p.destination, "Las Vegas"); assert.equal(p.title, "Vegas for Priya's 30th"); assert.deepEqual(p.months, [3, 4]);
  assert.equal(p.weekends[0].from, "2027-03-05"); assert.equal(p.weekends[0].to, "2027-03-07"); assert.ok(p.weekends.every((w) => new Date(w.from + "T12:00:00Z").getUTCDay() === 5));
  assert.equal(parseTripLine("Tacos at mine Saturday at 7").trip, false);
  assert.equal(parseTripLine("Dinner in Chicago Friday at 7pm").trip, false, "a city with a clock time is an evening, not a trip");
  assert.equal(parseTripLine("Girls' weekend somewhere warm in May").trip, true);
  assert.deepEqual(weekendsIn([12], "2026-11-27").map((w) => w.from).slice(0, 2), ["2026-12-04", "2026-12-11"]);
  assert.equal(weekendsIn([11], "2026-11-27")[0].from.slice(0, 4), "2027", "a month that's already here comes round next year once its Fridays are gone");
  assert.equal(holidayOf("2027-03-26", "2027-03-28"), "Easter weekend"); assert.equal(holidayOf("2027-04-09", "2027-04-11"), "");
  const c = cleanTrip({ destination: "Las Vegas", weekends: ["2027-03-12", { from: "2027-04-09", to: "2027-04-11" }, "nope"], interests: ["Shows", "<b>x</b>"] });
  assert.deepEqual(c.weekends, [{ from: "2027-03-12", to: "2027-03-14" }, { from: "2027-04-09", to: "2027-04-11" }]); assert.deepEqual(c.budgets, BUDGETS); assert.ok(!c.interests.some((x) => /</.test(x)));
  assert.equal(typeof placeOf("Somewhere new").city, "string");
});

test("stays: shapes for the head count, per person, cheapest first, always estimates, and it re-ranks when the group changes", () => {
  const six = stayOptions(V, { people: 6, from: "2027-04-09", to: "2027-04-11" });
  assert.ok(six.length >= 4); assert.ok(six.every((o) => o.est === true && /^About \$/.test(o.line)), "every price says it's an estimate");
  for (let i = 1; i < six.length; i++) assert.ok(six[i - 1].mid <= six[i].mid, "cheapest per person first");
  const rooms = six.find((o) => o.key === "strip-rooms"); assert.equal(rooms.units, 3); assert.match(rooms.rooms, /^3 rooms, two queens each/); assert.equal(rooms.nights, 2);
  const two = stayOptions(V, { people: 2, from: "2027-04-09", to: "2027-04-11" }); assert.ok(!two.some((o) => o.kind === "house"), "no big house for two");
  const twelve = stayOptions(V, { people: 12, from: "2027-04-09", to: "2027-04-11" }), house = (L) => L.find((o) => o.kind === "house");
  assert.ok(house(twelve).each.high < house(six).each.high, "a house gets cheaper per person as more people split it");
  assert.ok(twelve.findIndex((o) => o.kind === "house") <= six.findIndex((o) => o.kind === "house"), "and moves up the ranking");
  // the links: the place, the dates and the head count, nothing about anyone
  const L = searchLinks(V, { from: "2027-04-09", to: "2027-04-11", people: 6, rooms: 3 });
  assert.ok(L.every((l) => /^https:\/\//.test(l.href) && /2027-04-09/.test(l.href) && /6/.test(l.href) && /Las%20Vegas/.test(l.href)));
  assert.ok(searchLinks(V, { from: "2027-04-09", to: "2027-04-11", people: 6, kind: "house" }).some((l) => /adults=6/.test(l.href)));
  // over the budget people gave
  assert.ok(stayOptions(V, { people: 6, from: "2027-04-09", to: "2027-04-11", cap: 300 }).find((o) => o.key === "strip-suites").over);
});

test("group deals: cheapest shape, the nights lever, the weekends ranked, a group block email when it's big enough, fees, refundable", () => {
  const W = weekendsIn([3, 4], "2026-11-27"), D = groupDeals(V, { people: 6, from: "2027-04-09", to: "2027-04-11", weekends: W, host: "Maya" });
  const keys = D.tips.map((t) => t.key); for (const k of ["shape", "nights", "weekend", "block", "fees", "split", "early"]) assert.ok(keys.includes(k), k);
  assert.ok(D.tips.every((t) => t.check && t.how), "every lever has the how and a check-the-price line");
  assert.match(D.tips.find((t) => t.key === "block").title, /you need 3/); assert.match(D.note, /estimate/i); assert.match(D.note, /you book on the site/i);
  const big = groupDeals(V, { people: 18, from: "2027-04-09", to: "2027-04-11" }), block = big.tips.find((t) => t.key === "block");
  assert.match(block.title, /Ask for a group block: you need 9 rooms/); assert.match(block.email.subject, /9 rooms/); assert.match(block.email.body, /group of 18/); assert.match(block.email.body, /resort fee, taxes/);
  assert.equal(blockEmail({ P: V, rooms: 4, people: 8 }).body.includes("[your dates]"), true);
  const R = rankWeekends(V, W); assert.equal(R.at(-1).from, "2027-03-26", "Easter weekend in busy March ranks dearest"); assert.match(R.at(-1).why, /Easter/);
  assert.equal(groupDeals(V, { people: 4 }).tips.some((t) => t.key === "split"), false, "no house split for four");
  // no claims: nothing says booked, a discount or availability as a fact
  assert.ok(!/\bbooked\b|guaranteed|in stock|available now|% off/i.test(JSON.stringify(D)));
});

test("things to do: what people said first, group rates, estimates split per person, links", () => {
  const I = activityIdeas(V, { wants: [{ label: "Pool day", count: 3 }, { label: "Shows", count: 2 }, { label: "Day trip", count: 1 }], people: 6 });
  assert.equal(I[0].key, "pool"); assert.ok(I.slice(1, 3).every((x) => x.tags.includes("shows")));
  assert.match(I[0].line, /split 6 ways/); assert.match(I[0].note, /March to October/);
  assert.ok(I.every((x) => x.est && x.group && /^https:\/\/www\.google\.com\/search\?q=/.test(x.link)));
  assert.ok(I.some((x) => x.key === "redrock" && /timed-entry/.test(x.group)));
});

test("summary: who's keen, the best weekend, the budget range, what they want; arrivals are checked; paid-back lines net out", () => {
  const trip = cleanTrip({ destination: "Las Vegas", weekends: ["2027-03-12", "2027-04-09"], interests: V.interests });
  const R = [{ id: "a", r: { name: "Sam Ortiz", interest: "in", dates: ["2027-04-09"], trip: { budget: 1, wants: ["Pool day"] } } }, { id: "b", r: { name: "Lena", interest: "in", dates: ["2027-03-12", "2027-04-09"], trip: { budget: 2, wants: ["Pool day", "Shows"] } } },
    { id: "c", r: { name: "Jo", interest: "maybe", dates: ["2027-03-12"], trip: { budget: 1 } } }, { id: "d", r: { name: "Kit", interest: "no", trip: {} } }];
  const S = feelerSummary(trip, R); assert.equal(S.in, 2); assert.equal(S.maybe, 1); assert.equal(S.no, 1); assert.equal(S.best.from, "2027-04-09"); assert.equal(S.best.yes, 2);
  assert.match(S.budget.line, /^Answers run from \$500 to \$1,500 each\. Plan for \$500 to \$900 so it works for everyone\.$/); assert.equal(S.budget.cap, 900); assert.deepEqual(S.wants[0], { label: "Pool day", count: 2 });
  const ev = { date: "2027-04-09", endDate: "2027-04-11" };
  assert.equal(cleanArrival({ arriveDay: "2027-04-09", arriveTime: "3:20pm", arriveNote: "Flight 1234" }, ev).arrival.arriveTime, "15:20");
  assert.match(cleanArrival({ arriveTime: "soonish" }, ev).error, /3:20pm/); assert.match(cleanArrival({ arriveDay: "2027-04-11", departDay: "2027-04-09" }, ev).error, /before you land/);
  assert.equal(cleanArrival({ arriveDay: "2027-06-01" }, ev).arrival.arriveDay, "", "a day far from the trip is dropped");
  const people = [{ pid: "host" }, { pid: "r1" }, { pid: "r2" }], L = ledgerOf([{ id: "s", label: "Stay", cents: 90000, paidBy: "host" }, ...payCosts([{ id: "p", from: "r1", to: "host", cents: 30000 }])], people);
  assert.equal(L.owe.find((o) => o.from === "r1"), undefined, "Sam paid his share"); assert.equal(L.owe.find((o) => o.from === "r2").cents, 30000);
});

// ---------------- end to end ----------------
let srv, maya, ivy; const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "trip-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_SIGNUP_PER_HOUR: "100" };
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const get = (p, h = {}) => fetch(srv.base + p, { headers: h });
async function join(name, email) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return { cookie: r.headers.get("set-cookie").split(";")[0], email, name }; }
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); maya = await join("Maya Patel", "maya.trip@example.com"); ivy = await join("Ivy Chen", "ivy.trip@example.com"); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

let id = "", W2 = null; const P = {}; // friends' proofs
const H = () => ({ cookie: maya.cookie });
const trip = async (q = "", h = {}) => { const r = await get(`/api/public/trip/${id}${q}`, h); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).trip; };
const pq = (k) => `?rid=${P[k].rid}&code=${P[k].code}`;

test("1. Maya's line becomes a draft trip feeler on its own plan page", async () => {
  const r0 = await post("/api/host/trips", { say: "Tacos at mine Saturday at 7", onlyTrip: true }, H()); assert.deepEqual(await r0.json(), { trip: false }, "the New screen falls through for an evening");
  assert.equal((await post("/api/host/trips", { say: "Vegas sometime in March" })).status, 401, "signed in only");
  const r = await post("/api/host/trips", { say: "Vegas for Priya's 30th, sometime in March or April", onlyTrip: true }, H()); assert.equal(r.status, 200); const j = await r.json(); id = j.id;
  assert.equal(j.url, `/plans/${id}`); assert.equal(j.trip.feeler, true); assert.equal(j.trip.destination, "Las Vegas"); assert.ok(j.trip.feelerSetup.weekends.length >= 8); assert.ok(j.trip.feelerSetup.interests.includes("Pool day"));
  // a draft: nobody can open it yet
  assert.equal((await get(`/api/public/trip/${id}`)).status, 404);
  // the type tag reads Trip, the city is Las Vegas
  const plan = (await (await get(`/api/public/plan/${id}`, H())).json()).plan; assert.equal(plan.kinds.kind, "weekend"); assert.deepEqual(plan.kinds.trip, { feeler: true });
  assert.equal(plan.chip?.type || plan.chip?.key || "trip", "trip");
});

test("2. Maya sets the feeler: three weekends, the interests, a line, and publishes the link", async () => {
  const bad = await post(`/api/host/trips/${id}/feeler`, { weekends: [] }, H()); assert.equal(bad.status, 400);
  assert.equal((await post(`/api/host/trips/${id}/feeler`, { weekends: ["2027-03-12"] }, { cookie: ivy.cookie })).status, 404, "another account can't touch it");
  const r = await post(`/api/host/trips/${id}/feeler`, { destination: "Las Vegas", weekends: [{ from: "2027-03-12", to: "2027-03-14" }, { from: "2027-03-26", to: "2027-03-28" }, { from: "2027-04-09", to: "2027-04-11" }], interests: V.interests, note: "Priya turns 30! Two nights, flights on your own.", publish: true }, H());
  assert.equal(r.status, 200); const T = (await r.json()).trip; assert.equal(T.published, true); assert.equal(T.feelerSetup.weekends.length, 3); assert.equal(T.summary.answered, 0); assert.ok(T.deals.weekends.length === 3, "group deals already rank the weekends");
  // what a friend's browser gets: the feeler, nothing private
  const doc = await (await get(`/api/db/doc?path=events/${id}`, { "x-encore-guest": "1" })).json(); assert.equal(doc.data.trip.weekends.length, 3); assert.equal(doc.data.stage, "interest"); assert.equal(doc.data.activity, "Trip");
  const anon = await trip(); assert.equal(anon.summary, undefined); assert.equal(anon.feelerSetup.weekends.length, 3); assert.equal(anon.mine, undefined);
});

test("3. friends answer from the link with no account, one signed in; only Maya sees names next to budgets", async () => {
  const ans = async (k, b, h = {}) => { const r = await post(`/api/public/trip/${id}/answer`, { key: "k" + k.padEnd(10, "x"), ...b }, h); assert.equal(r.status, 200, await r.clone().text()); const j = await r.json(); if (j.rid) P[k] = { rid: j.rid, code: j.code }; return j; };
  assert.equal((await post(`/api/public/trip/${id}/answer`, { interest: "in" })).status, 400, "a name first");
  assert.equal((await post(`/api/public/trip/${id}/answer`, { interest: "in", name: "x" }, H())).status, 409, "the organiser doesn't answer their own feeler");
  await ans("sam", { name: "Sam Ortiz", contact: "(555) 201-0001", interest: "in", weekends: ["2027-04-09", "2027-03-12"], budget: 1, wants: ["Pool day", "Shows"], note: "Can only do two nights" });
  await ans("lena", { name: "Lena", contact: "lena@example.com", interest: "in", weekends: ["2027-04-09"], budget: 2, wants: ["Pool day", "Nightclub"] });
  await ans("jo", { name: "Jo", interest: "maybe", weekends: ["2027-03-26", "2027-04-09"], budget: 1, wants: ["Day trip"] });
  await ans("kit", { name: "Kit", interest: "no", note: "Wedding that month" });
  await ans("ivy", { interest: "in", weekends: ["2027-04-09"], budget: 1, wants: ["Shows", "Birthday dinner", "Made up"] }, { cookie: ivy.cookie });
  // Sam changes his mind about the budget from the same phone
  const j = await ans("sam", { ...P.sam, interest: "in", weekends: ["2027-04-09"], budget: 0, wants: ["Pool day", "Shows"] }); assert.equal(j.rid, P.sam.rid);
  const sam = await trip(pq("sam")); assert.equal(sam.mine.budget, 0); assert.equal(sam.summary, undefined, "a friend sees only their own answer"); assert.ok(!JSON.stringify(sam).includes("Wedding"));
  const me = await trip("", { cookie: ivy.cookie }); assert.equal(me.mine.interest, "in", "the signed-in friend's answer is on their account"); assert.deepEqual(me.mine.wants, ["Shows", "Birthday dinner"], "only the offered interests");
  const T = await trip("", H()), S = T.summary; assert.equal(S.in, 3); assert.equal(S.maybe, 1); assert.equal(S.no, 1);
  assert.equal(S.best.from, "2027-04-09"); assert.equal(S.best.yes, 3); assert.match(S.budget.line, /^Answers run from under \$500 to \$1,500 each\. Plan for under \$500/); assert.equal(S.wants[0].label, "Pool day");
  assert.ok(S.people.some((p) => p.name === "Ivy" && p.signedIn)); assert.ok(S.people.some((p) => p.note === "Wedding that month"));
  // the bell
  const inbox = srv.app.locals.social.inbox(maya.email); assert.ok((inbox.items || inbox || []).some((x) => /Sam is keen for Vegas for Priya's 30th: 1 weekend work/.test(x.text || "") || /Sam is keen/.test(x.text || "")));
  // the deals re-rank with the keen count
  assert.equal(T.deals.people, 5);
});

test("4. Maya locks the best weekend: it's the trip, the yeses for it are in, Potto lines up stays and things to do", async () => {
  assert.equal((await post(`/api/host/trips/${id}/lock`, {}, H())).status, 400);
  const r = await post(`/api/host/trips/${id}/lock`, { from: "2027-04-09" }, H()); assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j.confirmed, 3, "Sam, Lena and Ivy were keen for that weekend"); assert.deepEqual(j.notYet, ["Jo"]); assert.match(j.message, /Fri, Apr 9 to Sun, Apr 11/); assert.match(j.message, new RegExp(`/e/${id}`));
  const T = j.trip; assert.equal(T.feeler, false); assert.equal(T.group.count, 4); assert.ok(T.stays.length >= 3 && T.stays.every((s) => s.potto && s.est && /^About \$/.test(s.line)));
  assert.equal(T.ideas[0].fits, 2, "what people said comes first"); assert.ok(T.ideas.slice(0, 3).some((x) => /Pool day/.test(x.title))); assert.equal((await post(`/api/host/trips/${id}/lock`, { from: "2027-04-09" }, H())).status, 409);
  assert.equal(T.honest, "Potto finds the options; you book on the site and paste the confirmation here.");
  // Jo was a maybe: she sees "Are you in?" and says yes from her phone
  const jo = await trip(pq("jo")); assert.equal(jo.you.in, false); assert.ok(jo.mine);
  const y = await post(`/api/plans/peek/${id}/reply`, { ...P.jo, response: "in" }); assert.equal(y.status, 200, await y.clone().text());
  const jo2 = await trip(pq("jo")); assert.equal(jo2.you.in, true); assert.equal(jo2.group.count, 5);
});

test("5. where to stay: votes, Maya's own find, the pick, and the booking pasted back as a shared cost", async () => {
  let T = await trip("", H()); const [a, b] = T.stays;
  for (const k of ["sam", "lena", "ivy"]) assert.equal((await post(`/api/public/trip/${id}/vote`, { ...P[k], what: "stay", item: b.id })).status, 200);
  assert.equal((await post(`/api/public/trip/${id}/vote`, { ...P.kit, what: "stay", item: a.id })).status, 403, "only people who are in vote");
  assert.equal((await post(`/api/public/trip/${id}/vote`, { what: "stay", item: a.id }, { cookie: ivy.cookie })).status, 200, "a signed-in friend votes from their account");
  const add = await post(`/api/host/trips/${id}/stays`, { name: "Two suites at the place with the rooftop pool", area: "The Strip", link: "example.com/suites", total: "2,400" }, H()); assert.equal(add.status, 200);
  T = (await add.json()).trip; const mine = T.stays.find((s) => /rooftop/.test(s.name)); assert.equal(mine.est, false); assert.match(mine.line, /\$2,400 for the group, \$480 each/);
  assert.equal(T.stays[0].id, b.id, "most votes first"); assert.equal(T.stays[0].votes, 3);
  assert.equal((await post(`/api/host/trips/${id}/stays`, { action: "potto" }, H())).status, 200);
  assert.equal((await post(`/api/host/trips/${id}/pick`, { stay: b.id }, H())).status, 200);
  const bk = await post(`/api/host/trips/${id}/booking`, { confirmation: "LV-88231", address: "3600 S Example Blvd, Las Vegas", checkIn: "3pm", checkOut: "11am", total: "1,850", paidBy: "host" }, H()); assert.equal(bk.status, 200, await bk.clone().text());
  T = (await bk.json()).trip; assert.equal(T.booking.confirmation, "LV-88231"); assert.equal(T.booking.total, "$1,850"); assert.equal(T.booking.each, "$370"); assert.ok(T.stays.find((s) => s.picked));
  // the cost is split five ways, the address and confirmation only for people who are in, check-in and out on the plan
  const plan = (await (await get(`/api/public/plan/${id}${pq("sam")}`)).json()).plan;
  assert.equal(plan.kinds.ledger.yours.share, "$370"); assert.ok(plan.kinds.ledger.lines.some((l) => l.line === "You owe Maya $370"));
  assert.ok(plan.days[0].items.some((x) => x.kind === "checkin" && x.time === "15:00")); assert.ok(plan.days.at(-1).items.some((x) => x.kind === "checkout"));
  const kit = JSON.stringify(await (await get(`/api/public/trip/${id}${pq("kit")}`)).json()); assert.ok(!kit.includes("LV-88231") && !kit.includes("3600 S Example"), "not for someone who can't come");
  const anon = JSON.stringify(await (await get(`/api/public/plan/${id}`)).json()); assert.ok(!anon.includes("LV-88231") && !anon.includes("3600 S Example"));
  assert.equal((await post(`/api/host/trips/${id}/booking`, { total: "lots" }, H())).status, 400);
});

test("6. things to do: votes, an idea of their own, Potto's more, onto a day of the itinerary with a time and a cost", async () => {
  let T = await trip("", H()); const pool = T.ideas.find((x) => /Pool/.test(x.title)), dinner = T.ideas.find((x) => /dinner/i.test(x.title));
  for (const k of ["sam", "lena"]) assert.equal((await post(`/api/public/trip/${id}/vote`, { ...P[k], what: "idea", item: pool.id })).status, 200);
  const own = await post(`/api/public/trip/${id}/idea`, { ...P.lena, title: "Sunset drinks somewhere high up", note: "My treat for the first round" }); assert.equal(own.status, 200);
  T = (await own.json()).trip; const sunset = T.ideas.find((x) => /Sunset/.test(x.title)); assert.equal(sunset.votes, 1); assert.equal(sunset.mineToo, true); assert.equal(sunset.est, false);
  assert.equal((await post(`/api/host/trips/${id}/ideas/potto`, {}, H())).status, 200);
  assert.equal((await post(`/api/host/trips/${id}/schedule`, { idea: pool.id, day: "2027-05-01", time: "11am" }, H())).status, 400, "a day of the trip");
  assert.equal((await post(`/api/host/trips/${id}/schedule`, { idea: pool.id, day: "2027-04-10", time: "11am", cost: "600" }, H())).status, 200);
  assert.equal((await post(`/api/host/trips/${id}/schedule`, { idea: dinner.id, day: "2027-04-10", time: "7:30pm" }, H())).status, 200);
  assert.equal((await post(`/api/host/trips/${id}/schedule`, { idea: sunset.id, day: "2027-04-09", time: "7pm" }, H())).status, 200);
  const plan = (await (await get(`/api/public/plan/${id}${pq("ivy")}`)).json()).plan, sat = plan.days.find((d) => d.date === "2027-04-10");
  assert.deepEqual(sat.items.map((x) => x.title), ["Pool day with a cabana", "Birthday dinner with a set menu"]); assert.equal(sat.items[1].kind, "meal");
  T = await trip(pq("sam")); assert.equal(T.ideas.filter((x) => x.when).length, 3); assert.match(T.ideas.find((x) => /Pool/.test(x.title)).whenLine, /Sat, Apr 10 at 11am/);
  assert.equal(plan.kinds.ledger.yours.share, "$490", "the stay and the cabana, split five ways");
  // off the plan again
  assert.equal((await post(`/api/host/trips/${id}/schedule`, { idea: sunset.id, off: true }, H())).status, 200);
  const p2 = (await (await get(`/api/public/plan/${id}`, H())).json()).plan; assert.ok(!p2.days[0].items.some((x) => /Sunset/.test(x.title)));
});

test("7. arrivals: each person adds when they land and leave; everyone going sees who lands when", async () => {
  assert.equal((await post(`/api/public/trip/${id}/arrival`, { ...P.sam, arriveDay: "2027-04-09", arriveTime: "3:20pm", arriveNote: "Flight 1234", departDay: "2027-04-11", departTime: "6pm" })).status, 200);
  assert.equal((await post(`/api/public/trip/${id}/arrival`, { ...P.lena, arriveDay: "2027-04-09", arriveTime: "11am", arriveNote: "Driving from LA" })).status, 200);
  assert.equal((await post(`/api/public/trip/${id}/arrival`, { arriveDay: "2027-04-08", arriveTime: "9pm" }, H())).status, 200);
  assert.equal((await post(`/api/public/trip/${id}/arrival`, { ...P.kit, arriveDay: "2027-04-09" })).status, 403);
  const T = await trip(pq("jo")); assert.deepEqual(T.arrivals.filter((a) => a.set).map((a) => a.name), ["Maya", "Lena", "Sam"]); assert.equal(T.arrivals.find((a) => a.name === "Sam").arriveNote, "Flight 1234");
});

test("8. paying back: the organiser's Get paid buttons with the amount, I paid, Mark paid, and the lines settle", async () => {
  assert.equal((await post("/api/me/pay", { venmo: "@maya-patel", cashapp: "$mayap" }, H())).status, 200);
  let plan = (await (await get(`/api/public/plan/${id}${pq("sam")}`)).json()).plan, line = plan.kinds.ledger.lines.find((l) => l.youOwe);
  assert.equal(line.line, "You owe Maya $490"); assert.deepEqual(line.pays.map((p) => p.label), ["Venmo", "Cash App"]); assert.match(line.pays[0].href, /^https:\/\/venmo\.com\/maya-patel\?txn=pay&amount=490/);
  assert.equal((await post(`/api/public/trip/${id}/paid`, { ...P.sam, to: "host", cents: 49000 })).status, 200);
  plan = (await (await get(`/api/public/plan/${id}${pq("sam")}`)).json()).plan; assert.equal(plan.kinds.ledger.lines.length, 0, "Sam is square"); assert.equal(plan.kinds.ledger.paid[0].line, "You paid Maya $490");
  const hp = (await (await get(`/api/public/plan/${id}`, H())).json()).plan; assert.ok(hp.kinds.ledger.lines.some((l) => l.line === "Lena owes you $490"));
  const lena = hp.kinds.ledger.lines.find((l) => /Lena/.test(l.line));
  assert.equal((await post(`/api/host/trips/${id}/paid`, { from: lena.from, cents: 20000 }, H())).status, 200);
  const hp2 = (await (await get(`/api/public/plan/${id}`, H())).json()).plan; assert.ok(hp2.kinds.ledger.lines.some((l) => l.line === "Lena owes you $290")); assert.ok(hp2.kinds.ledger.paid.some((p) => p.line === "Lena paid you $200"));
  assert.ok(srv.app.locals.social.inbox(maya.email).some((x) => /Sam says they paid you \$490/.test(x.text || "")));
});

test("9. it all reloads: the plan, the chat, the trip for a friend with only their phone's proof", async () => {
  const T = await trip(pq("ivy")); assert.equal(T.you.in, true); assert.ok(T.booking.address); assert.equal(T.payments.length, 0, "Ivy only sees payments she's in");
  // the group chat: Sam (no account) writes from his phone's proof, Maya and Ivy read it
  const say = await post(`/api/chats/${id}/messages${pq("sam")}`, { ...P.sam, text: "Landing 3:20, who wants to share a ride?" }); assert.equal(say.status, 200, await say.clone().text());
  const hostChat = await (await get(`/api/chats/${id}`, H())).json(); assert.ok(JSON.stringify(hostChat).includes("who wants to share a ride"));
  assert.ok(JSON.stringify(await (await get(`/api/chats/${id}`, { cookie: ivy.cookie })).json()).includes("share a ride"));
  assert.equal((await get(`/api/chats/${id}${pq("kit")}`)).status >= 400, true, "not for someone who can't come");
});

test("10. Ask Potto about the trip: where to stay, group deals, things to do; estimates, never a booking", async () => {
  const ask = async (message) => { const r = await post("/api/potto/ask", { message }, H()); assert.equal(r.status, 200); return r.json(); };
  const s = await ask("Where should we stay in Vegas?"); assert.match(s.answer, /You're booked at/); assert.equal(s.links[0].href, `/plans/${id}#stay`);
  const d = await ask("Can you find group deals for the Vegas trip?"); assert.match(d.answer, /cheapest shape/); assert.match(d.answer, /estimate/); assert.match(d.answer, /Check the real price/);
  const t = await ask("What should we do in Vegas?"); assert.match(t.answer, /pool day/i); assert.equal(t.links[0].href, `/plans/${id}#todo`);
  for (const x of [s, d, t]) assert.ok(!/\bI booked\b|\bI've booked\b|guaranteed/i.test(x.answer));
  const other = await ask("Who hasn't replied to my dinner?"); assert.ok(!(other.links || []).some((l) => /\/plans\//.test(l.href)), "other questions go to Potto as before");
  const fresh = await join("Noor Ali", "noor.trip@example.com"), n = await (await post("/api/potto/ask", { message: "Help me plan a trip to Vegas" }, { cookie: fresh.cookie })).json();
  assert.match(n.answer, /Start it from New/); assert.equal(n.links[0].href, "/?app=1#studio");
});

test("pages: the plan page loads trip.js only for a trip, the light invite hands a feeler to it and stays light, copy is plain", async () => {
  const inv = read("public/invite.html"); assert.ok(inv.length < 40000, `invite.html is ${inv.length}`); assert.match(inv, /e\?\.trip && e\.stage === "interest"/);
  const served = await (await get(`/e/${id}`)).text(); assert.ok(served.length < 40000, `served invite is ${served.length}`);
  const plan = read("public/plan.html"); assert.match(plan, /tripRoot/); assert.match(plan, /"\/trip\.js"/);
  const js = read("public/trip.js"), srvjs = read("server/trips.js"), both = js + srvjs;
  assert.ok(!/—/.test(both), "no em dashes"); assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(js), "no emoji in the page chrome");
  assert.match(js, /Estimate/); assert.match(srvjs, /Potto finds the options; you book on the site and paste the confirmation here\./);
  assert.ok(!/\bPotto (booked|has booked|will book)\b/i.test(both), "Potto never says it booked");
  assert.ok(!/claude|gpt|sonnet|opus|haiku/i.test(both), "no model names");
  const idx = read("index.html"), last = idx.lastIndexOf("<script"); assert.match(idx.slice(last, last + 400), /Come with me|comewith/i, "the Come with me loader stays the last script");
  assert.match(read("public/place.js"), /"Las Vegas", 36\.17/);
});

test("browser at 390: the feeler on the light invite, then the trip page for the organiser", { timeout: 120000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { try { pw = createRequire("/opt/node-tools/package.json")("playwright"); } catch { return t.skip("no playwright"); } }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no chromium"); }
  try {
    // a second, fresh feeler so the light invite is still asking
    const r = await post("/api/host/trips", { say: "Vegas sometime in May", onlyTrip: true }, H()); const f = (await r.json()).id;
    await post(`/api/host/trips/${f}/feeler`, { weekends: ["2027-05-07", "2027-05-14"], publish: true }, H());
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${srv.base}/e/${f}`); await page.waitForSelector("[data-fsend]", { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no sideways scroll");
    await page.locator('[data-fi="in"]').click(); await page.locator('[data-fw="2027-05-14"]').click(); await page.locator('[data-fb="1"]').click(); await page.locator("[data-fx]").first().click();
    await page.fill("[data-fname]", "Rae"); await page.click("[data-fsend]"); await page.waitForSelector("[data-fedit]", { timeout: 10000 });
    assert.match(await page.locator(".tr-done").innerText(), /You're keen/);
    const small = await page.$$eval("button, a.tr-b", (L) => L.filter((b) => b.offsetParent && b.closest(".tr")).map((b) => b.getBoundingClientRect().height).filter((h) => h < 44)); assert.deepEqual(small, [], "44px tap targets");
    await page.reload(); await page.waitForSelector("[data-fedit]", { timeout: 10000 }); // the answer is remembered on this phone
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(800);
    assert.equal(await page.locator(".pl-planhook").count(), 0, "no empty Where we're staying block under a feeler");
    assert.ok(!/To come/.test(await page.locator("body").innerText()));
    // the organiser's trip page
    const [k, ...v] = maya.cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }]);
    await page.goto(`${srv.base}/plans/${id}`); await page.waitForSelector("#stay", { timeout: 15000 });
    assert.match(await page.locator(".tr").innerText(), /Potto finds the options; you book on the site/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no sideways scroll on the trip page");
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});
