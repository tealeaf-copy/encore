import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "first-yes-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("Invite these first: early yeses from past events rank first, people already invited are left out", async () => {
  const h = await post("/api/signup", { name: "Maya Ortiz", email: "maya.fy@example.com", password: "long-password-1", mode: "friends" }); assert.equal(h.status, 200); const hc = cookieOf(h);
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const mk = async (name, date) => (await (await post("/api/db/collection?path=events", { name, pubTitle: name, date, startTime: "19:00", casual: true, published: true }, hc)).json()).id;
  const past1 = await mk("Taco night", day(-20)), past2 = await mk("Dumpling night", day(-6)), next = await mk("Game night", day(6));
  const rsvp = async (eventId, name, email, response) => { await post("/api/db/collection?path=rsvps", { eventId, name, email, response, createdAt: Date.now() }, hc); await sleep(5); };
  // Priya says yes first both times; Dev comes later; Sam declines; Lena is already invited to the next one
  await rsvp(past1, "Priya Shah", "priya@example.com", "going"); await rsvp(past1, "Lena Park", "lena@example.com", "going"); await rsvp(past1, "Ana Ruiz", "ana@example.com", "going"); await rsvp(past1, "Dev Rao", "dev@example.com", "going"); await rsvp(past1, "Sam Diaz", "sam@example.com", "no");
  await rsvp(past2, "Priya Shah", "priya@example.com", "going"); await rsvp(past2, "Ana Ruiz", "ana@example.com", "going"); await rsvp(past2, "Sam Diaz", "sam@example.com", "no");
  await rsvp(next, "Lena Park", "lena@example.com", "going");
  const j = await (await fetch(srv.base + "/api/host/first-yes?eventId=" + next, { headers: { cookie: hc } })).json();
  const names = j.people.map((p) => p.name);
  assert.equal(names[0], "Priya Shah", JSON.stringify(j.people));
  assert.ok(!names.includes("Lena Park"), "already invited to this one");
  assert.ok(!names.includes("Sam Diaz"), "always says no");
  assert.match(j.people[0].why, /among the first in at 2 events/);
});
