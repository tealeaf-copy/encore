import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv;
const J = { "content-type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const host = async (name, email, handle) => { const r = await req("POST", "/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); const c = cookieOf(r); if (handle) assert.equal((await req("POST", "/api/host/profile", { handle, name }, c)).status, 200); return c; };

before(async () => { srv = await startServer(); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "collab-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR"]) delete process.env[k]; await srv.close(); });

test("collabs: one host asks another, they talk, say yes, and both pages show it", async () => {
  const eric = await host("Eric Tan", "eric@example.com", "eric-cooks"), hoa = await host("Hoa Tran", "hoa@example.com", "hoa-flowers"), fan = await host("Fan", "fan@example.com");
  assert.equal((await req("POST", "/api/collab/hoa-flowers", { idea: "Supper and bouquets" })).status, 401, "needs an account");
  assert.equal((await req("POST", "/api/collab/eric-cooks", { idea: "Talking to myself" }, eric)).status, 400, "not yourself");
  assert.equal((await req("POST", "/api/collab/hoa-flowers", { idea: "hi" }, eric)).status, 400, "needs an idea");
  const r = await (await req("POST", "/api/collab/hoa-flowers", { kind: "cohost", idea: "Seven courses, then everyone makes a bouquet for the table", when: "a Saturday in March", city: "New York" }, eric)).json();
  assert.ok(r.id);
  assert.equal((await req("POST", "/api/collab/hoa-flowers", { idea: "Asking again before she answers" }, eric)).status, 409);
  const inbox = await (await req("GET", "/api/collabs", null, hoa)).json();
  assert.equal(inbox.incoming.length, 1); assert.equal(inbox.incoming[0].other.handle, "eric-cooks"); assert.equal(inbox.incoming[0].kindLabel, "Co-host an event"); assert.equal(inbox.incoming[0].otherEmail, undefined, "no email before a yes");
  assert.equal((await req("POST", `/api/collabs/${r.id}`, { action: "accept" }, eric)).status, 403, "only the asked host answers");
  assert.equal((await req("POST", `/api/collabs/${r.id}`, { action: "message", text: "Love it. Which Saturday?" }, hoa)).status, 200);
  const yes = await (await req("POST", `/api/collabs/${r.id}`, { action: "accept" }, hoa)).json();
  assert.equal(yes.collab.status, "accepted"); assert.equal(yes.collab.otherEmail, "eric@example.com");
  const sent = await (await req("GET", "/api/collabs", null, eric)).json();
  assert.equal(sent.sent[0].otherEmail, "hoa@example.com"); assert.equal(sent.sent[0].thread[0].text, "Love it. Which Saturday?");
  assert.deepEqual((await (await req("GET", "/api/public/collabs/eric-cooks")).json()).collabs.map((c) => c.handle), ["hoa-flowers"]);
  assert.deepEqual((await (await req("GET", "/api/public/collabs/hoa-flowers")).json()).collabs.map((c) => c.handle), ["eric-cooks"]);
  // nobody else can read or change it
  assert.equal((await req("POST", `/api/collabs/${r.id}`, { action: "message", text: "hello" }, fan)).status, 404);
});
