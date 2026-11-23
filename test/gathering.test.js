import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "gathering-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("One question at the door: answers stay sealed until the day, then open to going guests and the host", async () => {
  const h = await post("/api/signup", { name: "Mina Host", email: "mina.g@example.com", password: "long-password-1", mode: "friends" }); assert.equal(h.status, 200); const hc = cookieOf(h);
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const id = (await (await post("/api/db/collection?path=events", { name: "Taco night", date: day(4), startTime: "19:00", casual: true, published: true, askQ: "What made your week?", why: "so the neighbours meet", houseRules: ["📵 Phones in the basket"], meetPoint: "My place" }, hc)).json()).id;
  const ev = await (await fetch(srv.base + "/api/db/doc?path=events/" + id)).json().catch(() => ({}));
  const rid = (await (await post("/api/db/collection?path=rsvps", { eventId: id, name: "Rita Ray", email: "rita@example.com", response: "going", code: "c0de1" }, hc)).json()).id;
  assert.equal((await post("/api/public/rsvp-extra/" + id, { rid, code: "c0de1", answer: "My sourdough rose" })).status, 200);
  const sealed = await (await fetch(`${srv.base}/api/public/answers/${id}?rid=${rid}&code=c0de1`)).json();
  assert.equal(sealed.open, false); assert.equal(sealed.count, 1); assert.equal(sealed.answers.length, 0);
  const hs = await (await fetch(srv.base + "/api/host/answers?eventId=" + id, { headers: { cookie: hc } })).json();
  assert.equal(hs.count, 1); assert.equal(hs.open, false);
  assert.equal((await fetch(`${srv.base}/api/public/answers/${id}?rid=${rid}&code=wrong`)).status, 403);
  await fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PATCH", headers: { ...J, cookie: hc }, body: JSON.stringify({ date: day(0) }) });
  const open = await (await fetch(`${srv.base}/api/public/answers/${id}?rid=${rid}&code=c0de1`)).json();
  assert.equal(open.open, true); assert.deepEqual(open.answers, [{ name: "Rita", answer: "My sourdough rose" }]);
  void ev;
});
