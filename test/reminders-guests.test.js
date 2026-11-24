import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const put = (path, body, cookie) => fetch(srv.base + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "remind-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_SMS = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS"]) delete process.env[k]; await srv.close(); });

test("Guests who said yes get one reminder the day before, by text; switched-off events and maybes don't", async () => {
  const c = cookieOf(await post("/api/signup", { name: "Rae Host", email: "rae.rm@example.com", password: "long-password-1", mode: "friends" }));
  const start = new Date(Date.now() + 24 * 3600e3), date = start.toISOString().slice(0, 10), time = start.toISOString().slice(11, 16);
  const base = { kind: "social", casual: true, date, startTime: time, published: true, meetPoint: "Dolores Park" };
  await put("/api/db/doc?path=events/remA", { ...base, name: "Picnic A" }, c);
  await put("/api/db/doc?path=events/remB", { ...base, name: "Picnic B", autoRemind: false }, c);
  const rsvp = (eventId, name, phone, response) => post("/api/db/collection?path=rsvps", { eventId, name, phone, response, code: "c" + Math.random().toString(36).slice(2, 7) }, c);
  await rsvp("remA", "Ana", "+14155550111", "going"); await rsvp("remA", "Bo", "+14155550112", "maybe"); await rsvp("remB", "Cy", "+14155550113", "going");
  const n0 = fakeTexts.length; const j = await srv.app.locals.social.runJobs(Date.now(), "https://encore.example");
  const sent = fakeTexts.slice(n0); assert.equal(j.reminders, 1, JSON.stringify(j));
  assert.ok(sent.some((t) => t.to === "+14155550111" && /Tomorrow: Picnic A/.test(t.text) && /Dolores Park/.test(t.text) && /STOP/.test(t.text)));
  assert.ok(!sent.some((t) => t.to === "+14155550112"), "maybe isn't reminded"); assert.ok(!sent.some((t) => t.to === "+14155550113"), "switched off");
  assert.equal((await srv.app.locals.social.runJobs(Date.now(), "https://encore.example")).reminders || 0, 0, "only once");
});
