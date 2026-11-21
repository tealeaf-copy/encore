import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv;
before(async () => {
  srv = await startServer();
  process.env.APP_PASSWORD = "team-pass";
  process.env.ENCORE_USERS = "Maya Chen|maya@acme.com|Event lead+Account execs;Sam Lee|sam@acme.com|Exec sponsor";
});
after(async () => { delete process.env.APP_PASSWORD; delete process.env.ENCORE_USERS; await srv.close(); });

const login = (body) => fetch(srv.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("named users sign in with their email and the team password", async () => {
  let r = await login({ password: "team-pass" });
  assert.equal(r.status, 401, "email is required once a team list exists");
  r = await login({ password: "team-pass", email: "stranger@x.com" });
  assert.equal(r.status, 401);
  r = await login({ password: "wrong", email: "maya@acme.com" });
  assert.equal(r.status, 401);
  r = await login({ password: "team-pass", email: "Maya@Acme.com" });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const me = await fetch(srv.base + "/api/me", { headers: { cookie } }).then((x) => x.json());
  assert.deepEqual(me, { name: "Maya Chen", email: "maya@acme.com", roles: ["Event lead", "Account execs"], verified: true });
  const forged = cookie.replace("maya%40acme.com", "sam%40acme.com");
  assert.equal((await fetch(srv.base + "/api/me", { headers: { cookie: forged } })).status, 401, "a cookie can't be re-pointed at someone else");
  await fetch(srv.base + "/api/audit", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ eventId: "e1", what: "approved the plan" }) });
  const log = await fetch(srv.base + "/api/audit?eventId=e1", { headers: { cookie } }).then((x) => x.json());
  assert.equal(log.entries[0].who, "Maya Chen");
  assert.equal(log.entries[0].verified, true);
  assert.equal((await fetch(srv.base + "/api/me")).status, 401, "signed out");
});

test("approvals are checked against roles and recorded by the server", async () => {
  const r = await login({ password: "team-pass", email: "maya@acme.com" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const post = (body, c = cookie) => fetch(srv.base + "/api/approve", { method: "POST", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let x = await post({ eventId: "ev9", eventName: "Kitchen", role: "Exec sponsor", cost: 18000 });
  assert.equal(x.status, 403, "Maya isn't an exec sponsor");
  x = await post({ eventId: "ev9", eventName: "Kitchen", role: "Event lead", cost: 18000, committed: 9800 });
  assert.equal(x.status, 200);
  const roles = await fetch(srv.base + "/api/approvals?eventId=ev9", { headers: { cookie } }).then((y) => y.json());
  assert.equal(roles.roles["Event lead"].by, "Maya Chen");
  assert.equal(roles.roles["Event lead"].cost, 18000);
  const put = await fetch(srv.base + "/api/db/doc?path=approvals/ev9", { method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ roles: { "Exec sponsor": { by: "forged" } } }) });
  assert.equal(put.status, 403, "approvals can't be written through the data API");
  const log = await fetch(srv.base + "/api/audit?eventId=ev9", { headers: { cookie } }).then((y) => y.json());
  assert.match(log.entries[0].what, /approved the plan at \$18,000 planned, \$9,800 committed as Event lead/);
  assert.equal((await post({ eventId: "ev9", role: "Event lead" }, "")).status, 401);
});
