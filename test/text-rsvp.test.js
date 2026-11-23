import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const reply = (from, Body) => fetch(srv.base + "/api/public/sms/inbound", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: from, Body }).toString() }).then((r) => r.text());

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "text-rsvp-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_SMS = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_SMS"]) delete process.env[k]; await srv.close(); });

test("Guests RSVP by replying to a texted invite (SMS or WhatsApp), and can give their name", async () => {
  const h = await post("/api/signup", { name: "Maya Ortiz", email: "maya.text@example.com", password: "long-password-1", mode: "friends" }); assert.equal(h.status, 200); const hc = cookieOf(h);
  const date = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const ev = await (await post("/api/db/collection?path=events", { name: "Taco night", pubTitle: "Taco night", date, startTime: "19:00", meetPoint: "My place", headcount: 8, casual: true, published: true }, hc)).json();
  assert.ok(ev.id, JSON.stringify(ev));
  const before = fakeTexts.length;
  const sent = await (await post("/api/host/text-invites", { eventId: ev.id, phones: "+1 415 555 0101\n+1 415 555 0102" }, hc)).json();
  assert.equal(sent.sent, 2, JSON.stringify(sent)); assert.ok(fakeTexts.slice(before).every((t) => /Reply YES, MAYBE or NO/.test(t.text)));
  // a plain SMS yes
  const r1 = await reply("+14155550101", "Yes!! 🌮"); assert.match(r1, /You're in for Taco night/); assert.match(r1, /Reply with your name/);
  const r2 = await reply("+14155550101", "Priya Shah"); assert.match(r2, /Thanks, Priya/);
  // WhatsApp numbers arrive with a prefix and still match
  const r3 = await reply("whatsapp:+14155550102", "maybe"); assert.match(r3, /maybe/i);
  const r4 = await reply("whatsapp:+14155550102", "no"); assert.match(r4, /No worries/);
  // the host sees them in Who's coming
  const who = await (await fetch(srv.base + "/api/public/attendees/" + ev.id)).json();
  assert.equal(who.count, 1); assert.ok(who.attendees.some((a) => a.name === "Priya S."));
  // unknown numbers get a helpful answer, and STOP is respected silently
  assert.match(await reply("+14155550999", "yes"), /couldn't find an invite/);
  assert.doesNotMatch(await reply("+14155550101", "STOP"), /<Message>/);
});
