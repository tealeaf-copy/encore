import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "measure-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("A booking gets a guest page, and its results count who came and what they thought, without names", async () => {
  const h = await post("/api/signup", { name: "Ava Host", email: "ava.m@example.com", password: "long-password-1", mode: "friends" }); assert.equal(h.status, 200); const hc = cookieOf(h);
  const pr = await post("/api/host/profile", { handle: "ava-measure", name: "Move with Ava", experiences: [{ name: "Desk-to-mat yoga", min: 4, max: 40, price: "$30 a person", category: "movement" }] }, hc); assert.equal(pr.status, 200);
  const expId = (await pr.json()).host.experiences[0].id, day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const bk = await (await post("/api/public/book/ava-measure", { name: "Sam", company: "Northwind", email: "sam@northwind.example", experienceId: expId, people: 10, date: day(5), when: "soon", where: "Our office", message: "Team yoga for our wellness week." })).json();
  const id = bk.id, t = new URL(bk.status).searchParams.get("t"); assert.ok(id && t);
  assert.equal((await post(`/api/public/booking/${id}/event`, { t: "wrong" })).status, 403);
  const ev = await (await post(`/api/public/booking/${id}/event`, { t })).json(); assert.ok(ev.link.startsWith("/g#rsvp-")); const eid = ev.link.split("rsvp-")[1];
  let r = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json(); assert.equal(r.going, 0); assert.equal(r.past, false); assert.equal(r.cost, 300);
  for (const [i, nm] of ["Rita", "Omar", "Lena"].entries()) { const rid = (await (await post("/api/db/collection?path=rsvps", { eventId: eid, name: nm, email: `${nm.toLowerCase()}@example.com`, response: "going", code: "c" + i, noShow: i === 2 }, hc)).json()).id; assert.ok(rid); }
  await fetch(srv.base + "/api/db/doc?path=events/" + eid, { method: "PATCH", headers: { ...J, cookie: hc }, body: JSON.stringify({ date: day(-1) }) });
  r = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json();
  assert.equal(r.past, true); assert.equal(r.going, 3); assert.equal(r.came, 2); assert.equal(r.showRate, 67); assert.equal(r.costPer, 150);
  assert.ok(!JSON.stringify(r).includes("Rita"), "results never name guests");
  assert.equal((await post(`/api/public/booking/${id}/campaign`, { t, campaign: { name: "Wellness week", goal: "morale", target: 10, meetings: "2", pipeline: "$12,000" } })).status, 200);
  r = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json(); assert.equal(r.campaign.name, "Wellness week"); assert.equal(r.campaign.pipeline, 12000); assert.equal(r.campaign.goal, "morale");
});
