import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { tally } from "../server/checks.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "checks-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { await new Promise((r) => setTimeout(r, 300)); for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("a would-you-come check: owner opens it, people answer through the link, the owner sees a tally and their words", async () => {
  const s = await req("POST", "/api/signup", { name: "Jordan Ellis", email: "jordan@example.com", password: "long-password-1", mode: "work", company: "Ramp" }); const cookie = cookieOf(s);
  assert.equal((await req("PUT", "/api/db/doc?path=events/ev1", { name: "Post-Close Supper", concept: "Dinner the week after month-end", city: "New York", kind: "dinner" }, cookie)).status, 200);
  assert.equal((await req("POST", "/api/check/nope", {}, cookie)).status, 404, "an event has to exist");
  const o = await (await req("POST", "/api/check/ev1", { dates: ["Thu Mar 12", "Tue Mar 17"] }, cookie)).json();
  assert.match(o.link, /^\/check\/ev1\?t=/); const t = new URL("http://x" + o.link).searchParams.get("t");
  // the public page needs the token
  assert.equal((await req("GET", "/api/public/check/ev1?t=wrong")).status, 404);
  const pub = await (await req("GET", "/api/public/check/ev1?t=" + t)).json();
  assert.equal(pub.check.title, "Post-Close Supper"); assert.equal(pub.check.brand, "Ramp"); assert.equal(pub.check.pitch, "Dinner the week after month-end"); assert.equal(pub.check.token, undefined, "the token isn't echoed");
  const ans = (b) => req("POST", "/api/public/check/ev1", { t, ...b });
  assert.equal((await ans({ answer: "yes", dates: ["Thu Mar 12", "Fri Mar 99"], must: "Other controllers from fintech", role: "Controller", company: "Acme", email: "a@acme.com" })).status, 200);
  assert.equal((await ans({ answer: "maybe", stop: "Month-end close", role: "CFO" })).status, 200);
  assert.equal((await ans({ answer: "no", why: "Too far from the office" })).status, 200);
  assert.equal((await ans({ answer: "yes", email: "a@acme.com", role: "Controller" })).status, 200, "same email replaces the first answer");
  assert.equal((await ans({ answer: "perhaps" })).status, 400);
  const own = await (await req("GET", "/api/check/ev1", null, cookie)).json();
  assert.equal(own.tally.n, 3); assert.equal(own.tally.yes, 1); assert.equal(own.tally.maybe, 1); assert.equal(own.tally.no, 1);
  assert.deepEqual(own.tally.stop.map((q) => q.text), ["Month-end close"]);
  assert.equal(own.tally.verdict.k, "early");
  // replies only come in through the public link
  assert.ok((await req("POST", "/api/db/collection?path=checkReplies", { eventId: "ev1", answer: "yes" }, cookie)).status >= 400, "replies can't be forged through the db API");
  assert.equal((await req("GET", "/api/check/ev1")).status, 401);
});

test("tally makes a go / tweak / rethink call only with enough answers", () => {
  const R = (y, m, n) => [...Array(y).fill({ answer: "yes" }), ...Array(m).fill({ answer: "maybe" }), ...Array(n).fill({ answer: "no" })];
  assert.equal(tally(R(2, 1, 0)).verdict.k, "early");
  assert.equal(tally(R(5, 2, 1)).verdict.k, "go");
  assert.equal(tally(R(2, 3, 3)).verdict.k, "tweak");
  assert.equal(tally(R(1, 1, 6)).verdict.k, "rethink");
});
