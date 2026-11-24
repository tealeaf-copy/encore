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

test("Check-in at the door: a door link for staff, ticket codes, walk-ins, and results that count who actually came", async () => {
  const h = await post("/api/signup", { name: "Theo Door", email: "theo.d@example.com", password: "long-password-1", mode: "friends" }); const hc = cookieOf(h);
  const pr = await (await post("/api/host/profile", { handle: "theo-door", name: "Door Test Loft", experiences: [{ name: "Demo night", min: 5, max: 100, price: "$95 a person", category: "drinks" }] }, hc)).json();
  const day = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  const bk = await (await post("/api/public/book/theo-door", { name: "Sam", company: "Northwind", email: "sam.d@northwind.example", experienceId: pr.host.experiences[0].id, people: 10, date: day, time: "18:00", when: "soon", where: "The loft", message: "Launch night for our API." })).json();
  const id = bk.id, t = new URL(bk.status).searchParams.get("t");
  const ev = await (await post(`/api/public/booking/${id}/event`, { t, title: "Northwind launch night" })).json(); const eid = ev.link.split("rsvp-")[1];
  const rids = []; for (const [i, nm] of ["Rita", "Omar", "Lena"].entries()) rids.push((await (await post("/api/db/collection?path=rsvps", { eventId: eid, name: nm, email: `${nm.toLowerCase()}.d@example.com`, response: "going", code: "k" + i }, hc)).json()).id);
  const r0 = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json(); assert.ok(r0.doorLink.startsWith(`/door/${id}?t=`)); const dt = new URL(srv.base + r0.doorLink).searchParams.get("t");
  assert.notEqual(dt, t, "the door link isn't the booking link");
  assert.equal((await fetch(`${srv.base}/api/public/booking/${id}/door?t=wrong`)).status, 403);
  let door = await (await fetch(`${srv.base}/api/public/booking/${id}/door?t=${dt}`)).json(); assert.equal(door.guests.length, 3); assert.equal(door.checkedIn, 0); assert.equal(door.title, "Northwind launch night");
  const tk = await (await fetch(`${srv.base}/api/public/ticket/${eid}?rid=${rids[0]}&code=k0`)).json(); assert.match(tk.code, /^[A-Z2-9]{6}$/);
  assert.equal((await fetch(`${srv.base}/api/public/ticket/${eid}?rid=${rids[0]}&code=wrong`)).status, 403, "only the guest sees their code");
  door = await (await post(`/api/public/booking/${id}/door`, { t: dt, code: tk.code.toLowerCase() })).json(); assert.equal(door.name, "Rita"); assert.equal(door.checkedIn, 1);
  assert.equal((await post(`/api/public/booking/${id}/door`, { t: dt, code: "ZZZZZZ" })).status, 404);
  door = await (await post(`/api/public/booking/${id}/door`, { t: dt, rid: rids[1] })).json(); assert.equal(door.checkedIn, 2);
  door = await (await post(`/api/public/booking/${id}/door/walkin`, { t: dt, name: "Walk In", company: "Acme" })).json(); assert.equal(door.checkedIn, 3); assert.equal(door.guests.length, 4);
  door = await (await post(`/api/public/booking/${id}/door`, { t: dt, rid: rids[1], undo: true })).json(); assert.equal(door.checkedIn, 2, "undo works");
  const r = await (await fetch(`${srv.base}/api/public/booking/${id}/results?t=${t}`)).json(); assert.equal(r.came, 2); assert.equal(r.checkedIn, 2); assert.equal(r.walkIns, 1); assert.equal(r.going, 4);
  const csv = await (await fetch(`${srv.base}/api/public/booking/${id}/guests.csv?t=${t}`)).text(); assert.match(csv, /checked_in,walk_in/); assert.match(csv, /"Walk In"/);
});
