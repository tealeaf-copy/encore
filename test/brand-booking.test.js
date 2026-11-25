// Brand booking round 1: any host can answer requests, only opted-in hosts can be requested, both brand
// front doors (/hosts/book and /teams) agree on place, and quotes keep the deposit honest.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { depositOf, parseBrief, goalOfBrief } from "../server/market.js";
import { placeIn, placeFit } from "../server/search.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const host = async (name, email, profile) => { const c = cookieOf(await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" })); const r = await post("/api/host/profile", profile, c); const t = await r.text(); assert.ok(r.ok, t); return { c, h: JSON.parse(t).host }; };

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "brand-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("Briefs: per-person budgets, places named without 'in', and the goal", () => {
  const B = parseBrief("Dinner for 12 VP-level prospects in Manhattan, $250 a head");
  assert.equal(B.perPerson, 250); assert.equal(B.budget, 3000); assert.equal(B.city, "Manhattan"); assert.equal(goalOfBrief("Dinner for 12 VP-level prospects in Manhattan"), "exec");
  assert.equal(parseBrief("$40pp for 20 people").perPerson, 40); assert.equal(parseBrief("about $2,000 for 60 people").budget, 2000); assert.equal(parseBrief("about $2,000 for 60 people").perPerson, 0);
  assert.equal(parseBrief("Flushing food tour led by a foodie creator for 15 fans").city, "Flushing");
  assert.equal(placeIn("a run near Prospect Park"), "Prospect Park");
  assert.equal(placeFit("Prospect Park", { city: "San Francisco" }), "away"); assert.equal(placeFit("Flushing", { city: "New York", hood: "Flushing" }), "here");
});

test("A deposit typed as '50%' is half the total; a deposit over the total is refused", () => {
  assert.deepEqual(depositOf("$5,225", "50%"), { deposit: "$2,613" });
  assert.deepEqual(depositOf("$1,860", "50 %"), { deposit: "$930" });
  assert.deepEqual(depositOf("$1,000", "300"), { deposit: "$300" });
  assert.match(depositOf("$1,000", "$1,500").error, /can't be more than the total/);
  assert.match(depositOf("", "50%").error, /total first/);
  assert.deepEqual(depositOf("$900", ""), { deposit: "" });
});

test("Only hosts open to paid work can be requested; flipping the switch puts them in both brand searches", async () => {
  const { c } = await host("Mina Park", "mina.walks@example.com", { handle: "mina-walks", name: "Mina's Food Walks", city: "New York", hood: "Flushing", experiences: [{ name: "Flushing food tour", desc: "Six stops in Flushing, from hand-pulled noodles to egg tarts. I film the day for my channel.", category: "food", min: 6, max: 20, price: "$95 a person", contentPrices: { reel: 1200 } }] });
  const pub = (await (await get("/api/public/host/mina-walks")).json()).host, x = pub.experiences[0];
  // not opted in: refused with a clear message, and in no search
  const r0 = await post("/api/public/book/mina-walks", { name: "Jess", company: "Crunch Snacks", email: "jess@crunch.example", experienceId: x.id, people: 15, message: "Chili crisp launch tour." });
  assert.equal(r0.status, 403); const j0 = await r0.json(); assert.equal(j0.code, "not_for_hire"); assert.match(j0.message, /isn't taking brand requests right now/);
  assert.ok(!(await (await get("/api/public/hosts/book")).json()).hosts.some((h) => h.handle === "mina-walks"));
  // opted in: in /hosts/book, /teams and the plan box at once
  assert.ok((await post("/api/host/profile", { forHire: true }, c)).ok);
  assert.ok((await (await get("/api/public/hosts/book?city=Queens")).json()).hosts.some((h) => h.handle === "mina-walks"), "a brand-new host shows up right away");
  const T = await (await get("/api/public/teams/match?city=Flushing&people=15&goal=activation")).json(); assert.equal(T.results[0]?.host.handle, "mina-walks", JSON.stringify(T.results.map((r) => r.host.handle)));
  const M = await (await post("/api/public/match", { brief: "Flushing food tour led by a foodie creator who films it, for 15 fans" })).json();
  assert.equal(M.matches[0]?.host.handle, "mina-walks", JSON.stringify(M.matches.map((m) => m.host.handle))); assert.equal(M.brief.city, "Flushing"); assert.ok(M.brief.allHere);
  // the request goes through, and the host's bell points at that request
  const r1 = await (await post("/api/public/book/mina-walks", { name: "Jess", company: "Crunch Snacks", email: "jess@crunch.example", experienceId: x.id, people: 15, message: "Chili crisp launch tour.", scope: { deliverables: ["reel"], usage: "paid" } })).json();
  assert.ok(r1.ok && r1.id);
  const B = (await (await get("/api/host/bookings", c)).json()).bookings.find((b) => b.id === r1.id);
  assert.equal(B.estimate.total, 95 * 15 + 1200, "the host's suggested total includes the reel the brand picked");
  // a quote with "50%" stores dollars; over the total is refused
  assert.equal((await post("/api/host/bookings/" + r1.id, { status: "quoted", quote: { total: "$2,625", deposit: "120%" } }, c)).status, 400);
  assert.ok((await post("/api/host/bookings/" + r1.id, { status: "quoted", quote: { total: "$2,625", deposit: "50%" } }, c)).ok);
  const t = new URL(r1.link).searchParams.get("t"), bk = (await (await get(`/api/public/booking/${r1.id}?t=${t}`)).json()).booking;
  assert.equal(bk.quote.deposit, "$1,313");
});

test("Brand searches stay in the place asked: no San Francisco host for a Brooklyn brief", async () => {
  await host("Sam Ortiz", "sam.sf@example.com", { forHire: true, handle: "mission-brew", name: "Mission Brew Walks", city: "San Francisco", hood: "Mission", experiences: [{ name: "Coffee walk and run", desc: "A slow 5k run between three coffee roasters.", category: "movement", min: 8, max: 40, price: "$30 a person" }] });
  await host("Ada Lin", "ada.pp@example.com", { forHire: true, handle: "prospect-runs", name: "Prospect Park Runs", city: "Brooklyn", hood: "Prospect Heights", experiences: [{ name: "Team run and coffee", desc: "A no-drop 5k loop of the park, then coffee.", category: "movement", min: 8, max: 60, price: "$25 a person" }] });
  const M = await (await post("/api/public/match", { brief: "A morning run near Prospect Park for 30 people, then coffee" })).json();
  assert.ok(!M.matches.some((m) => m.host.handle === "mission-brew"), JSON.stringify(M.matches.map((m) => m.host.handle))); assert.equal(M.matches[0]?.host.handle, "prospect-runs");
  const T = await (await get("/api/public/teams/match?city=Prospect%20Park&people=30&goal=wellbeing")).json(); assert.ok(!T.results.some((r) => r.host.handle === "mission-brew"));
});
