// Event kinds (server/kinds.js): a booked table for friends (the party-size meter and "Update the reservation"), a
// weekend away (lodging, beds and car seats to claim, a shared costs ledger with even splits and pay links), and a
// summit (an agenda with tracks and rooms, room capacity, a personal agenda, a warning when saved sessions overlap,
// speakers whose pages are public only when they opted in or the host marked them). Addresses only for people who
// are in; ledger amounts only for the people in them. The create canvas and /start preload each kind.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore, claimEvent } from "../server/workspaces.js";
import { PLAN_KINDS as SERVER_KINDS, cleanReservation, tableMeter, holdLine, billSplit, splitCents, ledgerOf, ledgerFor, oweLine, claimBed, carAction, cleanCost, cleanAgenda, overlaps, conflictsOf, capOf, roomClashes, cleanSpeakers, speakerPublic, speakerFor, planKindOf, centsOf, money, cleanBeds } from "../server/kinds.js";
import { draftToEvent, PATH, guideHrefOf } from "../server/hostloop.js";
import { GUIDES } from "../server/guides.js";

const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
require("../public/sections.js"); require("../public/canvas.js");
const CV = globalThis.EventCanvas;

// ---------------- a table for friends ----------------
test("reservation: the party-size meter against the replies, and when to nudge", () => {
  const res = cleanReservation({ restaurant: "Lilia", time: "7:30pm", party: 6, link: "resy.com/lilia", confirmation: "ABC123", holdUntil: "2026-12-03", split: "even", bill: "252" }, { date: "2026-12-05", startTime: "19:30" });
  assert.equal(res.time, "19:30"); assert.equal(res.link, "https://resy.com/lilia"); assert.equal(res.bill, 25200); assert.equal(res.party, 6);
  const at = (n, o = {}) => tableMeter(res, n, { today: "2026-12-01", date: "2026-12-05", ...o });
  assert.equal(at(4).line, "You're at 4 of 6. Two seats open."); assert.equal(at(4).nudge, ""); assert.equal(at(4).state, "under");
  assert.equal(at(5).line, "You're at 5 of 6. One seat open.");
  assert.equal(at(6).line, "You're at 6 of 6. The table is full."); assert.equal(at(6).nudge, "");
  assert.equal(at(7).line, "You're at 7 of 6. Call to add a seat?"); assert.equal(at(7).nudge, "Update the reservation"); assert.equal(at(7).state, "over");
  assert.equal(at(9).line, "You're at 9 of 6. Call to add three seats?");
  // under, after the reply-by day: make it smaller
  assert.equal(at(4, { today: "2026-12-04" }).line, "You're at 4 of 6. The reply-by day has passed. Call to make it a table for 4?"); assert.equal(at(4, { today: "2026-12-04" }).nudge, "Update the reservation");
  // the host updated the booking to 8 but the doc still says they booked for 6: nudge until it matches
  assert.equal(tableMeter({ ...res, confirmedFor: 5 }, 5, { today: "2026-12-01", date: "2026-12-05" }).nudge, "Update the reservation");
  assert.equal(tableMeter({ ...res, party: 0 }, 3).line, "3 at the table so far. Add the party size you booked.");
  assert.equal(at(7).pct, 100); assert.equal(at(3).pct, 50);
});

test("reservation: the reply-by line, the split after, and a hold that can't be after the dinner", () => {
  const res = cleanReservation({ restaurant: "Lilia", party: 6, holdUntil: "2026-12-03" }, { date: "2026-12-05" });
  assert.equal(holdLine(res, "2026-11-30"), "Reply by Thursday so I can update the booking.");
  assert.equal(holdLine(res, "2026-12-02"), "Reply by tomorrow so I can update the booking.");
  assert.equal(holdLine(res, "2026-12-03"), "Reply by today so I can update the booking.");
  assert.equal(holdLine(res, "2026-11-20"), "Reply by Thu, Dec 3 so I can update the booking.");
  assert.match(holdLine(res, "2026-12-04"), /reply-by day has passed/);
  assert.equal(holdLine({ ...res, holdTime: "18:00" }, "2026-11-30"), "Reply by Thursday at 6pm so I can update the booking.");
  assert.equal(cleanReservation({ holdUntil: "2026-12-09" }, { date: "2026-12-05" }).holdUntil, "2026-12-05");
  const even = billSplit({ split: "even", bill: 25000 }, 6, { payUrl: "https://venmo.com/u/mina", host: "Mina", note: "Dinner at Lilia" });
  assert.equal(even.line, "$41.66 to $41.67 each, split 6 ways from $250."); assert.match(even.pay.href, /^https:\/\/venmo\.com\/mina\?txn=pay&amount=41\.67&note=Dinner/); assert.equal(even.pay.label, "Pay Mina $41.67");
  assert.equal(billSplit({ split: "even", bill: 24000 }, 6, {}).line, "$40 each, split 6 ways from $240.");
  assert.equal(billSplit({ split: "own" }, 6).line, "Each pays their own. Ask for separate checks when you sit down.");
  assert.match(billSplit({ split: "even" }, 6, { host: "Mina" }).line, /Mina adds the total after/);
  assert.equal(billSplit({ split: "" }, 6), null);
  assert.equal(billSplit({ split: "even", bill: 24000 }, 6, { payUrl: "https://venmo.com/u/mina", forHost: true }).pay, null, "the host doesn't pay themselves");
});

// ---------------- a weekend away ----------------
test("ledger: even splits in exact cents, who's included, pairwise lines that net out", () => {
  assert.deepEqual(splitCents(10000, 3), [3334, 3333, 3333]); assert.equal(splitCents(10001, 7).reduce((a, b) => a + b, 0), 10001); assert.deepEqual(splitCents(5, 0), []);
  for (let c = 1; c < 400; c += 37) for (let n = 1; n < 9; n++) { const L = splitCents(c, n); assert.equal(L.reduce((a, b) => a + b, 0), c); assert.ok(Math.max(...L) - Math.min(...L) <= 1); }
  const people = [{ pid: "host", name: "Maya" }, { pid: "r1", name: "Sam" }, { pid: "r2", name: "Ivy" }, { pid: "r3", name: "Bo" }];
  const costs = [{ id: "c1", label: "The house", cents: 33600, paidBy: "host" }, { id: "c2", label: "Groceries", cents: 9000, paidBy: "r1", among: ["host", "r1", "r2"] }, { id: "c3", label: "Car", cents: 4001, paidBy: "r3", among: ["r3", "r2"] }];
  const L = ledgerOf(costs, people);
  assert.deepEqual(L.costs[0].shares, { host: 8400, r1: 8400, r2: 8400, r3: 8400 });
  assert.deepEqual(L.costs[2].shares, { r2: 2001, r3: 2000 }, "people order decides who carries the odd cent");
  // Sam owes Maya 84 for the house, Maya owes Sam 30 for groceries: Sam owes Maya 54
  const line = (from, to) => L.owe.find((o) => o.from === from && o.to === to)?.cents;
  assert.equal(line("r1", "host"), 5400); assert.equal(line("host", "r1"), undefined);
  assert.equal(line("r2", "host"), 8400); assert.equal(line("r2", "r1"), 3000); assert.equal(line("r2", "r3"), 2001); assert.equal(line("r3", "host"), 8400);
  // every cent is accounted for
  const T = L.totals; assert.equal(Object.values(T).reduce((a, t) => a + t.paid, 0), 33600 + 9000 + 4001); assert.equal(Object.values(T).reduce((a, t) => a + t.share, 0), 33600 + 9000 + 4001);
  const name = (p) => people.find((x) => x.pid === p)?.name;
  assert.equal(oweLine({ from: "r2", to: "host", cents: 8400 }, "r2", name), "You owe Maya $84"); assert.equal(oweLine({ from: "r1", to: "host", cents: 5400 }, "host", name), "Sam owes you $54");
  // someone drops out: their share goes to the rest, never lost
  const L2 = ledgerOf(costs, people.filter((p) => p.pid !== "r3")); assert.deepEqual(L2.costs[0].shares, { host: 11200, r1: 11200, r2: 11200 }); assert.equal(L2.costs.length, 2, "a cost paid by someone who left drops out of the split");
  // a cost only the payer is left in is theirs alone, and owes nothing
  const L3 = ledgerOf([{ id: "x", label: "Wine", cents: 3000, paidBy: "r1", among: ["r9"] }], people); assert.deepEqual(L3.costs[0].shares, { r1: 3000 }); assert.equal(L3.owe.length, 0);
});

test("ledger: each person sees only the costs and lines they're in", () => {
  const people = [{ pid: "host", name: "Maya" }, { pid: "r1", name: "Sam" }, { pid: "r2", name: "Ivy" }];
  const L = ledgerOf([{ id: "c1", label: "House", cents: 30000, paidBy: "host" }, { id: "c2", label: "Sam and Ivy's car", cents: 6000, paidBy: "r1", among: ["r1", "r2"] }], people);
  const host = ledgerFor(L, "host"); assert.equal(host.costs.length, 1, "the host isn't in the car cost"); assert.ok(!host.owe.some((o) => o.from === "r2" && o.to === "r1"), "and doesn't see what Ivy owes Sam");
  assert.equal(ledgerFor(L, "host", { host: true }).costs.length, 2, "the host's own view of the whole trip");
  const ivy = ledgerFor(L, "r2"); assert.equal(ivy.costs.length, 2); assert.deepEqual(Object.keys(ivy.costs[0].shares), ["r2"], "only her own share, not Sam's"); assert.equal(ivy.owe.length, 2);
  const c = cleanCost({ label: "Groceries", amount: "84.50", paidBy: "r1", among: ["r1", "nobody", "r2"] }, people); assert.equal(c.cost.cents, 8450); assert.deepEqual(c.cost.among, ["r1", "r2"]);
  assert.match(cleanCost({ label: "", amount: 4 }, people).error, /what it was for/); assert.match(cleanCost({ label: "Gas", amount: "lots" }, people).error, /amount/);
  assert.equal(centsOf("$1,200"), 120000); assert.equal(money(8400), "$84"); assert.equal(money(4167), "$41.67");
});

test("beds and car seats: one each, never more than fit", () => {
  const beds = cleanBeds([{ room: "Loft", label: "Queen", sleeps: 2 }, { room: "Den", label: "Sofa bed" }, { room: "", label: "" }]); assert.equal(beds.length, 2); assert.equal(beds[1].sleeps, 1);
  const rec = {}; assert.equal(claimBed(rec, beds, "a", beds[1].id), ""); assert.match(claimBed(rec, beds, "b", beds[1].id), /Someone just took that bed/);
  assert.equal(claimBed(rec, beds, "b", beds[0].id), ""); assert.equal(claimBed(rec, beds, "c", beds[0].id), ""); assert.match(claimBed(rec, beds, "d", beds[0].id), /full/);
  // moving beds frees the old one
  assert.match(claimBed({}, beds, "z", "nope"), /isn't on the list/);
  const r2 = {}; claimBed(r2, beds, "a", beds[1].id); claimBed(r2, beds, "a", beds[0].id); assert.deepEqual(r2.beds[beds[1].id], []); assert.deepEqual(r2.beds[beds[0].id], ["a"]);
  claimBed(r2, beds, "a", beds[0].id, false); assert.deepEqual(r2.beds[beds[0].id], []);
  const cars = {}; assert.equal(carAction(cars, "d1", { action: "drive", seats: 2, note: "Leaving 4pm" }), ""); const id = cars.cars[0].id;
  assert.equal(carAction(cars, "a", { action: "ride", car: id }), ""); assert.equal(carAction(cars, "b", { action: "ride", car: id }), ""); assert.match(carAction(cars, "c", { action: "ride", car: id }), /last seat/);
  assert.match(carAction(cars, "d1", { action: "ride", car: id }), /your car/); assert.match(carAction(cars, "d1", { action: "drive", seats: 1 }), /Keep at least 2/);
  assert.equal(carAction(cars, "a", { action: "leave" }), ""); assert.equal(carAction(cars, "c", { action: "ride", car: id }), "");
  assert.equal(carAction(cars, "d1", { action: "stop" }), ""); assert.equal(cars.cars.length, 0);
});

// ---------------- a summit ----------------
const SUMMIT = { date: "2026-12-10", endDate: "2026-12-11" };
const SPEAKERS = cleanSpeakers([{ id: "s1", name: "Ana Ruiz", title: "Head of Design", public: true }, { id: "s2", name: "Bo Lee", title: "Engineer", optIn: true }, { id: "s3", name: "Cy Park", title: "Founder" }]);
const AG = { tracks: ["Design", "Build"], rooms: [{ name: "Main hall", capacity: 200 }, { name: "Room B", capacity: 2 }], sessions: [
  { id: "k1", day: 1, time: "9:30am", end: "10:15am", title: "Keynote", track: "", room: "Main hall", speakers: ["s1"] },
  { id: "d1", day: 1, time: "10:30am", end: "11:15am", title: "Design systems", track: "Design", room: "Room B", speakers: ["s2", "s3"] },
  { id: "b1", day: 1, time: "10:45am", title: "Shipping weekly", track: "Build", room: "Main hall", capacity: 50 },
  { id: "w2", day: 2, time: "2pm", title: "Workshop", track: "Workshops", room: "Studio" }] };

test("agenda: tracks, rooms, times and days are checked; capacity; overlaps; room clashes", () => {
  const A = cleanAgenda(AG, SUMMIT, SPEAKERS).agenda;
  assert.deepEqual(A.tracks, ["Design", "Build", "Workshops"], "a track typed on a session joins the list"); assert.ok(A.rooms.some((r) => r.name === "Studio" && r.capacity === 0));
  assert.equal(A.sessions[0].day, "2026-12-10"); assert.equal(A.sessions[2].end, "11:30", "no end: 45 minutes"); assert.equal(A.sessions[3].day, "2026-12-11");
  assert.deepEqual(A.sessions.find((s) => s.id === "d1").speakers, ["s2", "s3"]);
  assert.equal(capOf(A.sessions.find((s) => s.id === "d1"), A.rooms), 2); assert.equal(capOf(A.sessions.find((s) => s.id === "b1"), A.rooms), 50, "the smaller of the session's and the room's"); assert.equal(capOf(A.sessions[3], A.rooms), 0);
  const [, d1, b1] = A.sessions; assert.ok(overlaps(d1, b1)); assert.ok(!overlaps(A.sessions[0], d1));
  assert.deepEqual(conflictsOf(A.sessions, ["d1", "b1", "k1"]), { d1: ["b1"], b1: ["d1"] });
  assert.deepEqual(roomClashes([...A.sessions, { ...b1, id: "x", title: "Panel", time: "11:00", end: "11:40" }]), ["Shipping weekly and Panel are both in Main hall at 10:45am."]);
  assert.match(cleanAgenda({ sessions: [{ title: "Late", day: 3, time: "9am" }] }, SUMMIT).error, /pick a day from 1 to 2/);
  assert.match(cleanAgenda({ sessions: [{ title: "No time", day: 1 }] }, SUMMIT).error, /start time/);
  assert.match(cleanAgenda({ sessions: [{ title: "X", time: "9am" }] }, {}).error, /date first/);
});

test("speakers: a public page only when the speaker opted in or the host marked it public", () => {
  assert.equal(speakerPublic(SPEAKERS[0]), true); assert.equal(speakerPublic(SPEAKERS[1]), true); assert.equal(speakerPublic(SPEAKERS[2]), false);
  assert.equal(speakerFor(SPEAKERS[2], { eventId: "e" }), null, "a private speaker isn't named to the public");
  const inn = speakerFor(SPEAKERS[2], { inn: true, eventId: "e" }); assert.equal(inn.name, "Cy Park"); assert.equal(inn.href, undefined, "named to guests who are in, with no page");
  assert.equal(speakerFor(SPEAKERS[0], { eventId: "e" }).href, "/speakers/e/s1");
});

// ---------------- templates ----------------
test("templates: What are you planning? preloads the add-ons and sections, and /start carries the kind", () => {
  assert.deepEqual(CV.PLAN_KINDS.map((k) => k.label), ["Dinner", "Drinks", "Game night", "Coffee or brunch", "Book a table", "Class", "Potluck", "Picnic", "Hack night", "Book club", "Run or walk", "Hike", "Watch party", "Pop-up", "Drop", "Weekend away", "Summit", "Something else"]);
  // every kind the canvas offers is one the server keeps, and each sets an activity the cover art can draw
  assert.deepEqual(CV.PLAN_KINDS.map((k) => k.k).sort(), [...SERVER_KINDS].sort());
  for (const K of CV.PLAN_KINDS) { assert.ok(K.label.length <= 16, K.label); if (!K.handoff && !K.own) assert.ok(K.set?.activity, K.k); }
  const oth = CV.applyKind({ date: "2026-12-05", startTime: "", headcount: 0, typeLabel: "Old", activity: "old" }, "other", new Set()); assert.equal(oth.d.planKind, "other"); assert.equal(oth.d.headcount, 8);
  const back = CV.applyKind({ ...oth.d, typeLabel: "Clothes swap", activity: "clothes swap" }, "picnic", new Set()); assert.equal(back.d.typeLabel, "", "a named kind's own name goes when you pick another"); assert.equal(back.d.activity, "picnic");
  const hk = CV.applyKind({ date: "2026-12-05", startTime: "", headcount: 0 }, "hike", new Set()); assert.equal(hk.d.carpool, true); assert.equal(hk.d.startTime, "08:30"); assert.ok(hk.d.bring.length);
  const at = (k) => CV.applyKind({ date: "2026-12-05", startTime: "", headcount: 0 }, k, new Set());
  const t = at("table"); assert.equal(t.d.planKind, "table"); assert.equal(t.d.reservation.party, 6); assert.equal(t.d.reservation.holdUntil, "2026-12-03"); assert.ok(t.open.has("table")); assert.equal(t.d.noMaybe, true); assert.equal(t.d.startTime, "19:30");
  const w = at("weekend"); assert.equal(w.d.endDate, "2026-12-07"); assert.ok(w.open.has("stay")); assert.ok(w.open.has("bring")); assert.equal(w.d.carpool, true); assert.ok(w.d.bring.length >= 3, "a packing list to start from");
  const s = at("summit"); assert.equal(s.d.kind, "summit"); assert.equal(s.d.itineraryPublic, true); assert.ok(s.open.has("agenda")); assert.deepEqual(s.d.agenda.tracks, ["Main stage", "Workshops"]); assert.ok(s.d.headcount >= 60);
  const g = at("game"); assert.ok(g.d.sections.some((x) => /games/i.test(x.title))); assert.ok(g.open.has("bring"));
  const c = at("class"); assert.ok(c.open.has("included")); const dn = at("dinner"); assert.ok(dn.open.has("food"));
  assert.equal(at("drop").handoff, "drop", "a drop opens the drop setup");
  // what the host already typed stays
  const keep = CV.applyKind({ date: "2026-12-05", startTime: "20:00", headcount: 4, bring: ["Wine"] }, "table", new Set()); assert.equal(keep.d.startTime, "20:00"); assert.equal(keep.d.reservation.party, 4); assert.deepEqual(keep.d.bring, ["Wine"]);
  // /start
  const tb = draftToEvent({ t: "table", title: "Dinner at Lilia", seats: 6, place: "Lilia", date: "2026-12-05", time: "19:30" }, { now: "2026-11-27" });
  assert.equal(tb.planKind, "table"); assert.equal(tb.reservation.restaurant, "Lilia"); assert.equal(tb.reservation.party, 6); assert.equal(tb.reservation.holdUntil, "2026-12-03"); assert.equal(tb.noMaybe, true);
  const wk = draftToEvent({ t: "weekend", title: "Upstate", seats: 8, date: "2026-12-05", endDate: "2026-12-07" }, { now: "2026-11-27" }); assert.equal(wk.planKind, "weekend"); assert.equal(wk.carpool, true);
  const su = draftToEvent({ t: "summit", title: "Small summit", seats: 80, date: "2026-12-05" }, { now: "2026-11-27" }); assert.equal(su.planKind, "summit"); assert.equal(su.kind, "summit"); assert.equal(su.itineraryPublic, true);
  assert.equal(planKindOf({ reservation: { restaurant: "Lilia" } }), "table"); assert.equal(planKindOf({ kind: "summit" }), "summit"); assert.equal(planKindOf({ drop: true }), "drop"); assert.equal(planKindOf({}), "");
  // the start page offers a table, and the host path and guides lead to each kind
  assert.match(read("public/start.html"), /table: \{ chip: "Book a table"/);
  for (const g of ["book-a-table", "weekend-away", "small-summit", "teach-a-class"]) assert.ok(GUIDES.some((x) => x.id === g), g);
  assert.ok(PATH.some((n) => n.id === "booked")); assert.equal(guideHrefOf("booked"), "/guides/book-a-table"); assert.equal(guideHrefOf("weekend"), "/guides/weekend-away"); assert.equal(guideHrefOf("summit"), "/guides/small-summit");
});

// ---------------- end to end ----------------
let srv, mina, ivy; const J = { "Content-Type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "kinds-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100" };
const post = (p, b, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(b) });
const get = (p, h = {}) => fetch(srv.base + p, { headers: h });
async function join(name, email, handle) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = r.headers.get("set-cookie").split(";")[0];
  await post("/api/host/profile", { name, handle, city: "Brooklyn", hood: "Greenpoint" }, { cookie: c }); return { cookie: c, ws: srv.store.get("system/handle-" + handle).data.ws, email }; }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ev = (w, id, e) => { claimEvent(id, w); scopeStore(srv.store, w).set("events/" + id, { id, published: true, discoverable: false, casual: true, city: "Brooklyn", tz: "America/New_York", createdAt: Date.now(), ...e }); };
const rs = (w, rid, r) => scopeStore(srv.store, w).set("rsvps/" + rid, { code: "K" + rid, createdAt: Date.now(), ...r });
const proof = (rid) => `?rid=${rid}&code=K${rid}`;
const body = (rid, b = {}) => ({ rid, code: "K" + rid, ...b });
const LODGE = "41 Creek Rd, Phoenicia";

before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  mina = await join("Mina Cho", "mina.kinds@example.com", "mina-kinds"); ivy = await join("Ivy Lane", "ivy.kinds@example.com", "ivy-kinds");
  ev(mina.ws, "kTable", { name: "Dinner at Lilia", planKind: "table", date: day(6), startTime: "19:30", venueName: "Lilia", venueAddr: "567 Union Ave", headcount: 6,
    reservation: { restaurant: "Lilia", time: "19:30", party: 4, link: "https://resy.com/lilia", confirmation: "RESY-998", holdUntil: day(4), split: "even" } });
  for (const [i, n] of ["Ivy", "Sam"].entries()) rs(mina.ws, "t" + i, { eventId: "kTable", name: n, email: `${n.toLowerCase()}@x.com`, response: "going" });
  rs(mina.ws, "tMaybe", { eventId: "kTable", name: "Zed", email: "zed@x.com", response: "maybe" });
  ev(mina.ws, "kTrip", { name: "Cabin weekend", planKind: "weekend", date: day(10), endDate: day(12), startTime: "16:00", hood: "Phoenicia", carpool: true, payUrl: "https://venmo.com/u/mina-cho",
    lodging: { name: "Esopus Cabin", area: "Phoenicia", checkIn: "16:00", checkOut: "11:00", address: LODGE, link: "https://airbnb.com/rooms/1" },
    beds: [{ id: "b1", room: "Loft", label: "Queen", sleeps: 2 }, { id: "b2", room: "Den", label: "Sofa bed", sleeps: 1 }],
    itinerary: [{ day: day(10), time: "16:00", kind: "checkin", title: "Check in", sub: `Keys at ${LODGE}` }] });
  rs(mina.ws, "w1", { eventId: "kTrip", name: "Ivy Lane", email: ivy.email, response: "going", createdAt: 1 });
  rs(mina.ws, "w2", { eventId: "kTrip", name: "Sam", email: "sam@x.com", response: "going", createdAt: 2 });
  rs(mina.ws, "w3", { eventId: "kTrip", name: "Bo", email: "bo@x.com", response: "going", createdAt: 3 });
  rs(mina.ws, "wOut", { eventId: "kTrip", name: "Zed", email: "zed@x.com", response: "maybe", createdAt: 4 });
  ev(mina.ws, "kSummit", { name: "Small summit", planKind: "summit", kind: "summit", date: day(14), endDate: day(15), startTime: "09:30", itineraryPublic: true, discoverable: true, venueName: "Pioneer Works", venueAddr: "159 Pioneer St",
    speakers: [{ id: "s1", name: "Ana Ruiz", title: "Head of Design", public: true }, { id: "s2", name: "Bo Lee", title: "Engineer", optIn: true }, { id: "s3", name: "Cy Park", title: "Founder" }],
    agenda: AG, sponsors: [{ name: "Fernwood Labs", logo: "https://fernwood.example/logo.png", url: "https://fernwood.example" }],
    itinerary: [{ day: day(14), time: "09:00", kind: "arrive", title: "Doors, coffee and name tags" }] });
  for (const i of [1, 2, 3]) rs(mina.ws, "a" + i, { eventId: "kSummit", name: "Guest " + i, email: `g${i}@x.com`, response: "going" });
  rs(mina.ws, "aAsk", { eventId: "kSummit", name: "Asker", email: "ask@x.com", response: "maybe" });
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });
const kinds = async (id, q = "", h = {}) => { const r = await get(`/api/public/plan/${id}${q}`, h); assert.equal(r.status, 200); return (await r.json()).plan.kinds; };

test("a table: the host's meter and nudge, the booking link only for guests who are in, the bell when the count moves", async () => {
  const H = await kinds("kTable", "", { cookie: mina.cookie });
  assert.equal(H.kind, "table"); assert.equal(H.table.meter.line, "You're at 3 of 4. One seat open."); assert.equal(H.table.link, "https://resy.com/lilia");
  const G = await kinds("kTable", proof("t0")); assert.equal(G.table.confirmation, "RESY-998"); assert.equal(G.table.address, "567 Union Ave"); assert.equal(G.table.meter, undefined, "guests don't see the host's meter");
  assert.match(G.table.hold, /^Reply by .+ so I can update the booking\.$/);
  const M = await kinds("kTable", proof("tMaybe")); assert.equal(M.table.link, undefined); assert.equal(M.table.confirmation, undefined); assert.equal(M.table.address, undefined); assert.equal(M.table.restaurant, "Lilia");
  // two more say I'm in through the invite: 5 of 4, the host's bell says so and Plans has a to-do
  rs(mina.ws, "tMaybe", { eventId: "kTable", name: "Zed", email: "zed@x.com", response: "going" });
  rs(mina.ws, "t9", { eventId: "kTable", name: "Lu", email: "lu@x.com", response: "going" }); srv.app.locals.kinds.onRsvp(mina.ws, "kTable");
  const H2 = await kinds("kTable", "", { cookie: mina.cookie }); assert.equal(H2.table.meter.line, "You're at 5 of 4. Call to add a seat?"); assert.equal(H2.table.meter.nudge, "Update the reservation");
  const inbox = srv.app.locals.social.inbox(mina.email); const L = (inbox.items || inbox || []).map((x) => x.text || ""); assert.ok(L.some((t) => /You're at 5 of 4 for Dinner at Lilia\. Call to add a seat\?/.test(t)), "the bell: " + L.join(" | "));
  const T = await (await post("/api/plans/timeline", {}, { cookie: mina.cookie })).json(); assert.ok(T.items.some((i) => i.key === "todo:table:kTable" && i.title === "Update the reservation"));
  // the host called: the booking matches now
  const c = await post("/api/host/events/kTable/table/confirm", { party: 5 }, { cookie: mina.cookie }); assert.equal(c.status, 200); const K2 = (await c.json()).kinds; assert.equal(K2.table.meter.line, "You're at 5 of 5. The table is full."); assert.equal(K2.table.meter.nudge, "");
  const T2 = await (await post("/api/plans/timeline", {}, { cookie: mina.cookie })).json(); assert.ok(!T2.items.some((i) => i.key === "todo:table:kTable"));
  // the public doc never carries the booking
  const doc = await (await get("/api/db/doc?path=events/kTable", { "x-encore-guest": "1" })).json(); assert.equal(JSON.stringify(doc).includes("RESY-998"), false); assert.equal(doc.data.planKind, "table");
});

test("a weekend away: the lodging address only for people who are in, everywhere it could show", async () => {
  const out = await kinds("kTrip", proof("wOut")); assert.equal(out.stay.name, "Esopus Cabin"); assert.equal(out.stay.address, undefined); assert.equal(out.stay.locked, true); assert.equal(out.ledger, undefined, "no costs for someone who isn't in");
  assert.deepEqual(out.beds.list[0].who, [], "no names on the beds either");
  const inn = await kinds("kTrip", proof("w1")); assert.equal(inn.stay.address, LODGE); assert.equal(inn.stay.link, "https://airbnb.com/rooms/1");
  const anon = await (await get("/api/public/plan/kTrip")).json(); assert.equal(JSON.stringify(anon).includes("41 Creek"), false, "nothing in the plan payload for someone who hasn't replied");
  const doc = await (await get("/api/db/doc?path=events/kTrip", { "x-encore-guest": "1" })).json(); assert.equal(JSON.stringify(doc).includes("41 Creek"), false, "the public doc has no lodging");
  const ics = await (await get("/plans/ics/kTrip.ics?itinerary=1" + proof("wOut").replace("?", "&"))).text(); assert.equal(ics.includes("41 Creek"), false);
});

test("a weekend away: beds and car seats, claimed at the same moment", async () => {
  // two people race for the one sofa bed: exactly one gets it
  const [a, b] = await Promise.all([post("/api/public/kinds/kTrip/bed", body("w2", { bed: "b2" })), post("/api/public/kinds/kTrip/bed", body("w3", { bed: "b2" }))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]); const lost = a.status === 409 ? a : b; assert.match((await lost.json()).message, /Someone just took that bed/);
  // the queen sleeps two
  assert.equal((await post("/api/public/kinds/kTrip/bed", body("w1", { bed: "b1" }))).status, 200);
  const loser = a.status === 409 ? "w2" : "w3"; const q = await post("/api/public/kinds/kTrip/bed", body(loser, { bed: "b1" })); assert.equal(q.status, 200); const K = (await q.json()).kinds;
  assert.equal(K.beds.list.find((x) => x.id === "b1").left, 0); assert.equal(K.beds.mine, "b1"); assert.ok(K.beds.list.find((x) => x.id === "b1").who.includes("You"));
  assert.equal((await post("/api/public/kinds/kTrip/bed", body("wOut", { bed: "b1" }))).status, 403, "only people who are in");
  assert.equal((await post("/api/public/kinds/kTrip/bed", { rid: "w1", code: "nope", bed: "b2" })).status, 403, "a wrong code is nobody");
  // a car with one seat; two riders race
  const d = await post("/api/public/kinds/kTrip/car", body("w1", { action: "drive", seats: 1, note: "Leaving Bushwick at 2" })); assert.equal(d.status, 200); const car = (await d.json()).kinds.cars.list[0];
  assert.equal(car.driver, "You"); assert.equal(car.left, 1);
  const [r1, r2] = await Promise.all([post("/api/public/kinds/kTrip/car", body("w2", { action: "ride", car: car.id })), post("/api/public/kinds/kTrip/car", body("w3", { action: "ride", car: car.id }))]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]); assert.match((await (r1.status === 409 ? r1 : r2).json()).message, /last seat/);
  const seen = await kinds("kTrip", proof("wOut")); assert.equal(seen.cars.list[0].driver, "", "no driver names for someone who isn't in"); assert.equal(seen.cars.list[0].note, "");
});

test("a weekend away: the costs ledger, its pay links, and who sees which amounts", async () => {
  const add = (b) => post("/api/host/events/kTrip/costs", b, { cookie: mina.cookie });
  assert.equal((await add({ label: "The cabin", amount: "672" })).status, 200);
  assert.equal((await add({ label: "Groceries", amount: "90", paidBy: "w2", among: ["host", "w2", "w3"] })).status, 200);
  const r = await add({ label: "Gas", amount: "40.01", paidBy: "w1", among: ["w1", "w3"] }); assert.equal(r.status, 200); const H = (await r.json()).kinds;
  assert.equal(H.ledger.costs.length, 3, "the host sees every cost they added"); assert.ok(H.ledger.lines.every((l) => /\byou\b/i.test(l.line)), "but only the money lines they are in"); assert.equal(H.ledger.costs[0].share, "$168", "672 split four ways");
  assert.equal((await post("/api/host/events/kTrip/costs", { label: "x", amount: 5 }, { cookie: ivy.cookie })).status, 404, "another host can't add to it");
  // Ivy (w1): her share of the cabin, her gas, nothing about groceries
  const ivyK = await kinds("kTrip", proof("w1")); const labels = ivyK.ledger.costs.map((c) => c.label); assert.deepEqual(labels, ["The cabin", "Gas"]);
  const lines = ivyK.ledger.lines.map((l) => l.line); assert.ok(lines.includes("You owe Mina $168"), lines.join(" | ")); assert.ok(lines.includes("Bo owes you $20"), lines.join(" | "));
  const pay = ivyK.ledger.lines.find((l) => l.youOwe).pay; assert.match(pay.href, /^https:\/\/venmo\.com\/mina-cho\?txn=pay&amount=168&note=/); assert.equal(pay.label, "Pay Mina $168");
  assert.ok(!JSON.stringify(ivyK.ledger).includes("Groceries"), "a cost she's not in never reaches her");
  assert.ok(!ivyK.ledger.lines.some((l) => /Sam/.test(l.line) && !/you/i.test(l.line)), "no lines between two other people");
  // Bo (w3): owes Mina for the cabin less nothing, owes Sam for groceries, owes Ivy for gas (her cent rounding)
  const bo = await kinds("kTrip", proof("w3")); const bl = bo.ledger.lines.map((l) => l.line).sort(); assert.deepEqual(bl, ["You owe Ivy $20", "You owe Mina $168", "You owe Sam $30"]);
  const toSam = bo.ledger.lines.find((l) => /Sam/.test(l.line)); assert.equal(toSam.pay, undefined); assert.match(toSam.hint, /Pay Sam back/);
  // Sam adds his own pay link: Bo gets a link to pay him
  assert.equal((await post("/api/public/kinds/kTrip/payurl", body("w2", { url: "venmo.com/u/sam" }))).status, 200);
  const bo2 = await kinds("kTrip", proof("w3")); assert.match(bo2.ledger.lines.find((l) => /Sam/.test(l.line)).pay.href, /^https:\/\/venmo\.com\/sam\?txn=pay&amount=30/);
  // the maybe sees nothing; nobody's money moves
  assert.equal((await kinds("kTrip", proof("wOut"))).ledger, undefined);
  assert.doesNotMatch(read("server/kinds.js"), /stripe|paymentIntent|\bcharge\(/i, "no payment processing for trips");
});

test("a summit: the agenda by track and room, saving sessions up to the room's capacity, conflicts, the personal agenda in Plans", async () => {
  const pub = await kinds("kSummit"); assert.equal(pub.kind, "summit"); assert.equal(pub.agenda.sessions.length, 4); assert.deepEqual(pub.agenda.tracks, ["Design", "Build", "Workshops"]);
  assert.equal(pub.agenda.canSave, false); assert.equal(pub.sponsors[0].name, "Fernwood Labs");
  const d1 = pub.agenda.sessions.find((s) => s.id === "d1"); assert.deepEqual(d1.speakers.map((s) => s.name), ["Bo Lee"], "the private speaker isn't named publicly"); assert.equal(d1.cap, 2);
  assert.deepEqual(pub.speakers.map((s) => s.name), ["Ana Ruiz", "Bo Lee"]);
  const save = (rid, session, on = true) => post("/api/public/kinds/kSummit/agenda", body(rid, { session, on }));
  // room B holds two: the third person in is told it's full
  const [x, y] = await Promise.all([save("a1", "d1"), save("a2", "d1")]); assert.equal(x.status, 200); assert.equal(y.status, 200);
  const z = await save("a3", "d1"); assert.equal(z.status, 409); assert.match((await z.json()).message, /Room B is full for Design systems/);
  assert.equal((await save("aAsk", "k1")).status, 403, "a Maybe can't save sessions yet");
  // a1 saves an overlapping session: saved, with the warning
  const o = await save("a1", "b1"); assert.equal(o.status, 200); const K = (await o.json()).kinds, b1 = K.agenda.sessions.find((s) => s.id === "b1");
  assert.equal(b1.saved, true); assert.deepEqual(b1.conflict, ["Design systems"]); assert.equal(K.agenda.sessions.find((s) => s.id === "d1").full, false, "full doesn't apply to a session you already have");
  const inn = await kinds("kSummit", proof("a1")); assert.deepEqual(inn.agenda.sessions.find((s) => s.id === "d1").speakers.map((s) => s.name), ["Bo Lee", "Cy Park"], "guests who are in see every speaker");
  assert.equal(inn.agenda.sessions.find((s) => s.id === "d1").taken, 2);
  // the personal agenda in Plans: each saved session is a row, the overlap said plainly
  const T = await (await post("/api/plans/timeline", { proofs: [{ id: "kSummit", rid: "a1", code: "Ka1" }] })).json();
  const rows = T.items.filter((i) => i.kind === "session"); assert.deepEqual(rows.map((r) => r.title).sort(), ["Design systems", "Shipping weekly"]); assert.match(rows[0].status, /Overlaps another saved session/); assert.equal(rows[0].href, "/plans/kSummit#agenda");
  // unsave frees the seat
  assert.equal((await save("a1", "d1", false)).status, 200); assert.equal((await save("a3", "d1")).status, 200);
  // the host's view: room clashes, the door tools, every speaker with their flags; guests get the agenda instead of the run of show
  const H = await kinds("kSummit", "", { cookie: mina.cookie }); assert.deepEqual(H.agenda.clashes, []); assert.equal(H.door.checkin, "/people/event/kSummit"); assert.equal(H.speakers.length, 3); assert.equal(H.speakers[2].public, false);
  const plan = (await (await get("/api/public/plan/kSummit" + proof("a1"))).json()).plan; assert.equal(plan.runOfShow, true); assert.ok(plan.days.every((d) => !d.items.length), "the run of show stays with the host");
  const hp = (await (await get("/api/public/plan/kSummit", { cookie: mina.cookie })).json()).plan; assert.ok(hp.days[0].items.length, "the host keeps the run of show");
});

test("speaker pages: public only when the speaker opted in or the host marked them public", async () => {
  const ok = await get("/api/public/speaker/kSummit/s1"); assert.equal(ok.status, 200); const j = await ok.json(); assert.equal(j.speaker.name, "Ana Ruiz"); assert.deepEqual(j.sessions.map((s) => s.title), ["Keynote"]);
  assert.equal((await get("/api/public/speaker/kSummit/s2")).status, 200, "opted in");
  assert.equal((await get("/api/public/speaker/kSummit/s3")).status, 404, "neither: no page");
  assert.equal((await get("/speakers/kSummit/s1")).status, 200);
  // the host marks Cy public: the page exists
  const r = await post("/api/host/events/kSummit/kinds", { speakers: [...cleanSpeakers([{ id: "s1", name: "Ana Ruiz", public: true }, { id: "s2", name: "Bo Lee", optIn: true }, { id: "s3", name: "Cy Park", public: true }])] }, { cookie: mina.cookie });
  assert.equal(r.status, 200); assert.equal((await get("/api/public/speaker/kSummit/s3")).status, 200);
  // a bad agenda from the host is a plain sentence
  const bad = await post("/api/host/events/kSummit/kinds", { agenda: { sessions: [{ title: "Late", day: 9, time: "9am" }] } }, { cookie: mina.cookie }); assert.equal(bad.status, 400); assert.match((await bad.json()).message, /pick a day from 1 to 2/);
});

test("every script on the pages this touches parses", () => {
  for (const f of ["public/start.html", "public/plan.html", "public/speaker.html"]) for (const [, src] of read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function("return async () => {" + src + "\n}"), f);
  for (const f of ["public/kinds.js", "public/planhook.js", "public/canvas.js", "public/timeline.js", "public/drop.js"]) assert.doesNotThrow(() => new Function(read(f)), f);
});

test("pages: the plan page draws each kind, the invite links to it, the canvas asks first, copy stays plain", () => {
  const plan = read("public/plan.html"), K = read("public/kinds.js");
  assert.match(plan, /<script src="\/kinds\.js"><\/script>/); assert.match(K, /window\.PLKinds = /);
  for (const t of ["Update the reservation", "Save to my agenda", "Who sleeps where", "Rides", "Shared costs", "Speakers", "Supported by"]) assert.ok(K.includes(t), t);
  assert.ok(read("public/invite.html").length < 40000, "the invite stays small"); assert.match(read("public/planhook.js"), /kinds/);
  const idx = read("index.html"), scripts = [...idx.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]); assert.match(scripts[scripts.length - 1], /Come with me\?/, "the Come with me? loader stays last");
  assert.match(read("public/canvas.js"), /What are you planning\?/); assert.match(read("server/app.js"), /app\.locals\.kinds\?\.onRsvp\(ws, eventId\)/, "every reply moves the table's count");
  for (const f of ["public/kinds.js", "server/kinds.js", "public/speaker.html"]) assert.doesNotMatch(read(f), /—/, f + " has no em dashes");
});
