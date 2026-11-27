// Example hosts for brands (server/brandexamples.js): Quick book shows 3 sensible examples for every goal, city and
// common group size when no real host fits; real hosts always rank first; an example can't be booked (a friendly
// "example" code and the "find a real host" path); ENCORE_HIDE_DEMO=1 hides them; they never reach metrics,
// leaderboards or the public Discover. Also the service package model (per table, staffer a day, hour, package).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { priceFor, unitsFor, unitPrice } from "../server/brandbook.js";
import { realFirst } from "../server/brandpanel.js";
import { exampleByHandle, exampleSetups, EXAMPLE_LINE } from "../server/brandexamples.js";

let srv;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t}`); return JSON.parse(t); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekdayAfter = (n) => { for (let i = n; i < n + 10; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 2 && w <= 4) return d; } };
async function signup(name, email, extra = {}) { const r = await post("/api/signup", { name, email, password: "long-password-1", ...extra }); assert.ok(r.ok, await r.clone().text()); return cookieOf(r); }
const quick = async (q, c) => ok(await get("/api/teams/quick?" + new URLSearchParams(q), c));
const goalsOf = (x) => exampleByHandle(x.handle)?.s.packages.find((p) => p.id === x.pkg)?.goals || [];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "bx-secret-0123456789"; process.env.ENCORE_SIGNUP_PER_HOUR = "500"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_ADMIN_EMAILS = "admin.bx@example.com"; delete process.env.ENCORE_HIDE_DEMO; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_ADMIN_EMAILS", "ENCORE_HIDE_DEMO"]) delete process.env[k]; await srv.close(); });

test("Services are priced per unit: tables from the guest count, staff-days from attendees, hours with a minimum, one package", () => {
  const table = { name: "Centrepieces", perPersonCents: 14000, unit: "table", perUnitGuests: 8, minUnits: 2, depositPct: 50 };
  assert.equal(unitsFor(table, 30), 4); assert.equal(unitsFor(table, 6), 2, "never under the minimum order");
  const P = priceFor(table, 30, { feeBps: 0 }); assert.equal(P.totalCents, 56000); assert.equal(P.headcount, 30, "the headcount stays the guests"); assert.match(P.lines[0].label, /\$140 a table × 4/); assert.match(P.lines[0].note, /8 guests a table/);
  const staff = { name: "Staff", perPersonCents: 52000, unit: "staff-day", perUnitGuests: 50, minUnits: 4 };
  assert.equal(unitsFor(staff, 400), 8); assert.equal(unitsFor(staff, 120), 4); assert.match(priceFor(staff, 400, { feeBps: 0 }).lines[0].label, /a staffer a day × 8/);
  const booth = { name: "Booth", perPersonCents: 45000, unit: "hour", minUnits: 2 }; assert.equal(priceFor(booth, 150, { feeBps: 0 }).totalCents, 90000); assert.equal(unitsFor(booth, 150, 4), 4, "more hours when asked");
  const plan = { name: "Summit plan", perPersonCents: 1800000, unit: "package", maxGuests: 150, depositPct: 25 }; const PP = priceFor(plan, 120, { feeBps: 0 });
  assert.equal(PP.totalCents, 1800000); assert.equal(PP.depositCents, 450000); assert.match(PP.lines[0].label, /for up to 150 attendees/); assert.equal(unitPrice(plan), "$18,000 for the package");
  assert.equal(priceFor({ perPersonCents: 5000 }, 10, { feeBps: 0 }).totalCents, 50000, "people-priced packages are unchanged");
});

test("Every example host is clearly fictional and complete: packages with prices, sizes, terms, availability and example reviews", () => {
  const L = exampleSetups(); assert.ok(L.length >= 60, `${L.length} example hosts`);
  for (const x of L) { assert.ok(x.ws.startsWith("x_"), "examples are not workspaces"); assert.ok(x.h.theme.avatarArt, `${x.h.handle} has avatar art`); assert.ok(x.s.packages.length >= 1 && x.s.packages.length <= 6, x.h.handle);
    const E = exampleByHandle(x.h.handle); assert.ok(E.reviews.length >= 1, `${x.h.handle} has example reviews`); assert.equal(E.stats.trusted, undefined); assert.ok(E.stats.events < 10, "an example history never earns the Trusted badge");
    for (const p of x.s.packages) { assert.ok(p.perPersonCents > 0 && p.minGuests >= 1 && p.maxGuests >= p.minGuests, `${x.h.handle}/${p.id}`); assert.ok(/^[a-z0-9]{6,16}$/.test(p.id), p.id); assert.ok(p.openUntil >= day(90), "open for the next 3 months");
      assert.ok(!/—/.test(p.story + p.name + (p.details || []).join(" ")), "no em dashes"); } }
  const kinds = { "private chef": ["marlow-table", "ember-and-fig"], matcha: ["still-water-matcha", "fog-leaf-matcha"], coffee: ["second-pull", "phin-and-night"], bakery: ["rise-and-crumb", "crumb-theory"], florist: ["petal-and-stem", "wild-fennel"],
    yoga: ["move-with-ava", "golden-hour-movement"], "sound bath": ["low-tide-sound", "hum-and-hollow"], staff: ["floor-crew", "crewline"], planner: ["north-star-summits", "bayline-summits"], caterer: ["corner-plate", "phin-and-night"] };
  for (const [k, [ny, sf]] of Object.entries(kinds)) { assert.equal(exampleByHandle(ny).s.city, "New York", k); assert.equal(exampleByHandle(sf).s.city, "San Francisco", k); }
  for (const h of ["brightframe", "fieldnote"]) assert.ok(exampleByHandle(h).s.alsoIn.includes(h === "brightframe" ? "San Francisco" : "New York"), "photo and video in both cities");
});

const CITIES = ["New York", "San Francisco", "Los Angeles", "Austin", "Chicago", "Seattle", "Boston", "London"];
const SIZES = { customer: [8, 12, 24], team: [10, 25, 50], offsite: [10, 25, 50], workshop: [8, 15, 30], wellness: [10, 20, 40], community: [40, 80, 150], conference: [25, 60, 120], celebration: [30, 60, 120], catering: [15, 40, 100], summit: [100, 250] };
test("Quick book with no real hosts: 3 sensible examples for every goal, in every city, at every common size", async () => {
  const date = weekdayAfter(30), bad = [];
  for (const [goal, sizes] of Object.entries(SIZES)) for (const city of CITIES) for (const people of sizes) {
    const r = await quick({ date, people, city, goal }), L = r.results, tag = `${goal} / ${city} / ${people}`;
    if (L.length !== 3) { bad.push(`${tag}: ${L.length} results`); continue; }
    if (L.some((x) => x.near)) bad.push(`${tag}: not a full match (${L.filter((x) => x.near).map((x) => x.handle)})`);
    if (!L.every((x) => x.example && x.host.example)) bad.push(`${tag}: untagged`);
    if (new Set(L.map((x) => x.handle)).size !== 3) bad.push(`${tag}: a host twice`);
    if (L.filter((x) => goalsOf(x).includes(goal)).length < 2) bad.push(`${tag}: ${L.map((x) => x.handle + "/" + x.pkg).join(", ")} don't suit it`);
    if (r.exampleLine !== EXAMPLE_LINE) bad.push(`${tag}: no example line`);
    if (["summit", "catering"].includes(goal) ? L.some((x) => x.kind !== "service") : L.some((x) => x.kind === "service")) bad.push(`${tag}: services mixed in`);
  }
  assert.deepEqual(bad, []);
  // the story the demo tells: a customer dinner for 12 in New York has the private chef in the top 3, and suggests flowers or photos to add
  const D = await quick({ date, people: 12, city: "New York", goal: "customer" });
  assert.ok(D.results.some((x) => x.handle === "marlow-table"), D.results.map((x) => x.handle).join(", "));
  assert.ok(D.extras.length >= 1 && D.extras.every((x) => x.example), "services suggested as add-ons");
  const S = await quick({ date, people: 25, city: "San Francisco", goal: "offsite" }); assert.equal(S.results.length, 3);
});

test("Real hosts always rank first; examples only fill the slots left, and never displace a real host", async () => {
  const c = await signup("Rea Lhost", "rea.lhost@example.com", { mode: "friends" });
  await ok(await post("/api/host/profile", { handle: "rea-supper", name: "Rea's Supper Room", city: "New York", hood: "Greenpoint", forHire: true }, c));
  const pkg = { name: "Supper for your team", story: "Six courses at a long table.", moods: ["client"], perPersonCents: 9000, minimumCents: 0, minGuests: 6, maxGuests: 20, leadDays: 3, weekdays: [0, 1, 2, 3, 4, 5, 6] };
  await ok(await post("/api/bb/host/setup", { on: true, policy: "standard", area: "Greenpoint", city: "New York", packages: [pkg] }, c));
  const date = weekdayAfter(20);
  let r = await quick({ date, people: 12, city: "New York", goal: "customer" });
  assert.equal(r.results.length, 3); assert.equal(r.results[0].handle, "rea-supper", "the real host is first"); assert.equal(r.results[0].example, false);
  assert.ok(r.results.slice(1).every((x) => x.example), "examples fill the other two");
  // pure: three real fits leave no room for examples, however good the examples look
  const real = (h, q) => ({ handle: h, pkg: "p", minGuests: 2, maxGuests: 50, city: "New York", moods: [], quality: q, host: { example: false } });
  const ex = (h) => ({ handle: h, pkg: "p", minGuests: 2, maxGuests: 50, city: "New York", moods: ["client"], goals: ["customer"], quality: 100, dateState: "open", host: { example: true } });
  const top = realFirst([ex("e1"), ex("e2"), real("r1", 0), real("r2", 0), ex("e3"), real("r3", 0)], { people: 10, city: "New York", goal: "customer" });
  assert.deepEqual(top.map((x) => x.handle).sort(), ["r1", "r2", "r3"]);
  const two = realFirst([ex("e1"), real("r1", 0), real("r2", 0)], { people: 10, city: "New York", goal: "customer" }); assert.deepEqual(two.map((x) => x.handle), ["r1", "r2", "e1"]);
});

test("An example can't be booked: the API refuses with a friendly code, the brand can ask us to find a real host, nothing is charged", async () => {
  const c = await signup("Bri Brand", "bri.brand@example.com", { mode: "work", company: "Larkfield" });
  const date = weekdayAfter(25);
  // the whole walk works: the page, the price, availability, a shortlist and compare
  const X = await ok(await get("/api/bb/x/marlow-table/mtasting?people=12", c));
  assert.equal(X.host.example, true); assert.equal(X.example.line, EXAMPLE_LINE); assert.equal(X.stats.trusted, false); assert.ok(X.reviews.brands.length && X.reviews.brands.every((r) => r.example));
  assert.ok(X.availability.some((a) => a.days.some((d) => d.state === "open")), "dates open in the months shown");
  assert.equal(X.price.totalCents, 165 * 12 * 100); assert.ok(X.pkg.addOns.some((a) => /Wine pairing/.test(a.name)));
  const sl = await ok(await post("/api/bb/shortlists", { title: "Q1 dinners", people: 12, handle: "marlow-table", pkg: "mtasting" }, c));
  await ok(await post(`/api/bb/shortlists/${sl.id}/items`, { handle: "koji-counter", pkg: "komakase" }, c));
  const V = await ok(await get(`/api/bb/shortlists/${sl.id}`, c)); assert.equal(V.items.length, 2); assert.ok(V.items.every((i) => i.card.host.example));
  // the last step refuses, kindly
  const R = await post("/api/bb/requests", { handle: "marlow-table", pkg: "mtasting", headcount: 12, date }, c); assert.equal(R.status, 403);
  const E = await R.json(); assert.equal(E.code, "example"); assert.match(E.message, /example host/); assert.match(E.message, /find a real host/);
  const Q = await post("/api/bb/questions", { handle: "marlow-table", pkg: "mtasting", text: "Can you do nut-free?" }, c); assert.equal(Q.status, 403); assert.equal((await Q.json()).code, "example");
  const mine = await ok(await get("/api/bb/requests", c)); assert.equal(mine.requests.length, 0, "no request was made");
  // "Ask us to find a real host for this": kept for the team, nothing booked
  const F = await ok(await post("/api/bb/find-real-host", { handle: "marlow-table", pkg: "mtasting", headcount: 12, date, city: "New York" }, c)); assert.ok(F.id); assert.match(F.message, /Nothing is booked or charged/);
  const anon = await post("/api/bb/find-real-host", { handle: "marlow-table", pkg: "mtasting" }); assert.equal(anon.status, 400, "signed out needs an email");
  await ok(await post("/api/bb/find-real-host", { handle: "marlow-table", pkg: "mtasting", email: "planner@example.com", company: "Brightside" }));
});

test("ENCORE_HIDE_DEMO=1 hides every example from the brand side", async () => {
  process.env.ENCORE_HIDE_DEMO = "1";
  const r = await quick({ date: weekdayAfter(20), people: 12, city: "San Francisco", goal: "customer" }); assert.ok(r.results.every((x) => !x.example)); assert.equal(r.exampleLine, "");
  const d = await ok(await get("/api/bb/discover?people=12")); assert.ok(d.results.every((x) => !x.host.example));
  assert.equal((await get("/api/bb/x/marlow-table/mtasting")).status, 404);
  const m = await ok(await get("/api/bb/map")); assert.ok(m.places.every((p) => !exampleByHandle(p.handle)));
  delete process.env.ENCORE_HIDE_DEMO;
  const d2 = await ok(await get("/api/bb/discover?people=12")); assert.ok(d2.results.some((x) => x.host.example), "and shows them again without it");
});

test("Examples never reach metrics, leaderboards or the public Discover", async () => {
  const handles = new Set(exampleSetups().map((x) => x.h.handle));
  const pub = await ok(await get("/api/public/discover")); assert.ok((pub.hosts || []).every((h) => !handles.has(h.handle)), "public Discover");
  const sl = await ok(await get("/api/public/teams/shortlist?city=New%20York&people=12")); assert.ok(JSON.stringify(sl).match(/marlow-table|still-water-matcha|second-pull/) === null, "public team shortlist");
  const rank = await get("/api/public/host/marlow-table/rank"); const rk = rank.ok ? await rank.json() : {}; assert.ok(!JSON.stringify(rk).includes("Marlow"), "leaderboard ranks");
  const card = await get("/api/public/leaderboard/card?city=New%20York"); if (card.ok) assert.ok(!/Marlow|Still Water|Second Pull/.test(await card.text()), "leaderboard card");
  const a = await signup("Ad Min", "admin.bx@example.com", { mode: "work", company: "Pottery Lab" });
  const M = await ok(await get("/api/admin/brand-metrics", a)); assert.ok(!JSON.stringify(M).includes('"x_'), "admin brand metrics");
});
