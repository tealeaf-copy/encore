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
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "pw-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Password reset: same answer for unknown emails, one-time link, old sessions signed out, new password works", async () => {
  const s = await post("/api/signup", { name: "Rae Reset", email: "rae.reset@example.com", password: "first-password-1", mode: "friends" }); assert.equal(s.status, 200); const oldCookie = cookieOf(s);
  assert.equal((await fetch(srv.base + "/api/workspace", { headers: { cookie: oldCookie } })).status, 200);
  const unknown = await (await post("/api/password/forgot", { email: "nobody@example.com" })).json(), known = await (await post("/api/password/forgot", { email: "rae.reset@example.com" })).json();
  assert.equal(unknown.message, known.message, "same answer either way");
  const mail = fakeOutbox.filter((m) => [].concat(m.to).includes("rae.reset@example.com") && /Reset your Pottery Lab password/.test(m.subject)).pop(); assert.ok(mail, "a reset email was sent");
  const token = mail.text.match(/token=([a-f0-9]{48})/)[1];
  assert.equal((await post("/api/password/reset", { token, password: "short" })).status, 400);
  const r = await post("/api/password/reset", { token, password: "second-password-2" }); assert.equal(r.status, 200); const newCookie = cookieOf(r);
  assert.equal((await post("/api/password/reset", { token, password: "third-password-3" })).status, 400, "the link works once");
  assert.equal((await fetch(srv.base + "/api/workspace", { headers: { cookie: oldCookie } })).status, 401, "old sessions are signed out");
  assert.equal((await fetch(srv.base + "/api/workspace", { headers: { cookie: newCookie } })).status, 200);
  assert.equal((await post("/api/login", { email: "rae.reset@example.com", password: "first-password-1" })).status, 401);
  assert.equal((await post("/api/login", { email: "rae.reset@example.com", password: "second-password-2" })).status, 200);
});
