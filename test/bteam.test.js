import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "team-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("Team space: requests join the team, bookings over the cap wait for an approver, only approvers decide", async () => {
  const h = await post("/api/signup", { name: "Sofia Host", email: "sofia.t@example.com", password: "long-password-1", mode: "friends" }); const hc = cookieOf(h);
  const pr = await (await post("/api/host/profile", { handle: "sofia-team", name: "Supper Test", experiences: [{ name: "Dinner", min: 10, max: 30, price: "$185 a person", category: "dining" }, { name: "Breakfast", min: 6, max: 16, price: "$60 a person", category: "dining" }] }, hc)).json();
  const [dinner, breakfast] = pr.host.experiences;
  const T = await (await post("/api/public/bteam", { name: "Northwind field", you: "Sam", email: "sam@northwind.example", approvers: "cfo@northwind.example", cap: "2000" })).json(); assert.ok(T.id && T.key);
  assert.equal((await fetch(`${srv.base}/api/public/bteam/${T.id}?k=wrong`)).status, 403);
  const day = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), base = { name: "Sam", company: "Northwind", email: "sam@northwind.example", date: day, when: "soon", where: "Sofia's room", message: "Customer dinner for design partners.", team: { id: T.id, k: T.key } };
  const big = await (await post("/api/public/book/sofia-team", { ...base, experienceId: dinner.id, people: 20 })).json(); assert.equal(big.approval.state, "pending", "$3,700 is over the $2,000 cap");
  const small = await (await post("/api/public/book/sofia-team", { ...base, experienceId: breakfast.id, people: 10, message: "Breakfast with two customers." })).json(); assert.equal(small.approval.state, "not_needed");
  let team = await (await fetch(`${srv.base}/api/public/bteam/${T.id}?k=${T.key}`)).json(); assert.equal(team.rows.length, 2); assert.equal(team.rows.find((r) => r.id === big.id).cost, 3700);
  assert.equal((await post(`/api/public/bteam/${T.id}/decide`, { k: T.key, bookingId: big.id, decision: "approve", approver: "cfo@northwind.example" })).status, 403, "typing the approver's email isn't enough");
  assert.equal((await post(`/api/public/bteam/${T.id}/settings`, { k: T.key, cap: "999999" })).status, 403, "the team link alone can't change limits");
  const owner = new URL(srv.base + T.ownerLink).searchParams.get("a");
  assert.equal((await post(`/api/public/bteam/${T.id}/join`, { k: T.key, email: "cfo@northwind.example", name: "Fake" })).status, 403, "nobody joins under the approver's email");
  const mail = fakeOutbox.filter((m) => [].concat(m.to).includes("cfo@northwind.example")).pop(); assert.ok(mail, "the approver got their link");
  const appr = mail.text.match(/&a=([a-f0-9]{32})/)[1];
  assert.equal((await post(`/api/public/bteam/${T.id}/decide`, { k: T.key, a: appr, bookingId: big.id, decision: "approve" })).status, 200);
  assert.equal((await post(`/api/public/bteam/${T.id}/settings`, { k: T.key, a: owner, cap: "3000" })).status, 200, "the owner can change limits");
  team = await (await fetch(`${srv.base}/api/public/bteam/${T.id}?k=${T.key}`)).json(); assert.equal(team.rows.find((r) => r.id === big.id).approval.state, "approved");
  const t = new URL(big.status).searchParams.get("t"), bk = await (await fetch(`${srv.base}/api/public/booking/${big.id}?t=${t}`)).json(); assert.equal(bk.booking.approval.state, "approved"); assert.equal(bk.booking.team.name, "Northwind field");
});

test("Add-ons: catering that travels and event services in the same city, flat fees stay flat", async () => {
  const h = await post("/api/signup", { name: "June Photo", email: "june.t@example.com", password: "long-password-1", mode: "friends", city: "Oakland" }); const hc = cookieOf(h);
  await post("/api/host/profile", { handle: "june-addon", name: "Fieldnote Test", city: "Oakland", experiences: [{ name: "Event photographer", min: 1, max: 500, price: "$850 flat", category: "culture", travels: true, service: true }, { name: "Coffee cart", min: 20, max: 200, price: "$12 a person", category: "drinks", travels: true }] }, hc);
  const r = await (await fetch(`${srv.base}/api/public/addons?city=Oakland&people=50`)).json();
  const photo = r.results.find((a) => a.experience.name === "Event photographer"), cart = r.results.find((a) => a.experience.name === "Coffee cart");
  assert.equal(photo.total, 850); assert.equal(photo.kind, "service"); assert.equal(cart.total, 600); assert.equal(cart.kind, "catering");
  const none = await (await fetch(`${srv.base}/api/public/addons?city=Denver&people=50`)).json(); assert.ok(!none.results.some((a) => a.host.handle === "june-addon"));
});
