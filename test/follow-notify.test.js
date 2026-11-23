import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeTexts } from "../server/sms.js";
import { fakeOutbox } from "../server/email.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "follow-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS"]) delete process.env[k]; await srv.close(); });

test("Following a host sends the new regular an email and a text, and tells the host", async () => {
  const h = await post("/api/signup", { name: "Claire Kim", email: "claire.f@example.com", password: "long-password-1", mode: "friends" }); assert.equal(h.status, 200);
  const hc = cookieOf(h);
  assert.equal((await post("/api/host/profile", { handle: "claire-follow", name: "Claire's Run Crew", city: "New York" }, hc)).status, 200);
  const g = await post("/api/signup", { name: "Sam Diaz", email: "sam.f@example.com", password: "long-password-1", mode: "friends", regularOf: "claire-follow" }); assert.equal(g.status, 200);
  const gc = cookieOf(g);
  const before = fakeOutbox.length, texts = fakeTexts.length;
  const r = await post("/api/public/follow", { handle: "claire-follow", phone: "+1 415 555 0199" }, gc); const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.equal(j.emailed, true); assert.equal(j.texted, true);
  const mails = fakeOutbox.slice(before);
  assert.ok(mails.some((m) => String(m.to).includes("sam.f@example.com") && /following Claire's Run Crew/.test(m.subject)), "the follower gets a confirmation email");
  assert.ok(mails.some((m) => String(m.to).includes("claire.f@example.com") && /followed you/.test(m.subject)), "the host hears about it");
  assert.ok(fakeTexts.slice(texts).some((t) => t.to === "+14155550199" && /following Claire's Run Crew/.test(t.text)), "the follower gets a text");
  // following again doesn't send it all again
  const again = fakeOutbox.length; await post("/api/public/follow", { handle: "claire-follow", phone: "+1 415 555 0199" }, gc);
  assert.equal(fakeOutbox.length, again, "no second confirmation");
  await post("/api/public/follow", { handle: "claire-follow" }, gc); assert.equal(fakeOutbox.length, again, "nor a third");
});
