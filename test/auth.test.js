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
  const { workspace, owner, ...me } = await fetch(srv.base + "/api/me", { headers: { cookie } }).then((x) => x.json());
  assert.equal(workspace.id, "default");
  assert.equal(owner, false);
  assert.deepEqual(me, { name: "Maya Chen", email: "maya@acme.com", roles: ["Event lead", "Account execs"], teamRoles: ["Event lead", "Account execs", "Exec sponsor"], approverRoles: ["Event lead", "Account execs", "Exec sponsor"], verified: true });
  const forged = cookie.replace("maya%40acme.com", "sam%40acme.com");
  assert.equal((await fetch(srv.base + "/api/me", { headers: { cookie: forged } })).status, 401, "a cookie can't be re-pointed at someone else");
  await fetch(srv.base + "/api/audit", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ eventId: "e1", what: "approved the plan" }) });
  const log = await fetch(srv.base + "/api/audit?eventId=e1", { headers: { cookie } }).then((x) => x.json());
  assert.equal(log.entries[0].who, "Maya Chen");
  assert.equal(log.entries[0].verified, true);
  assert.equal((await fetch(srv.base + "/api/me")).status, 401, "signed out");
});

test("approvals are checked against roles and recorded by the server", async () => {
  const { hashPassword } = await import("../server/auth.js");
  const usersBefore = process.env.ENCORE_USERS;
  process.env.ENCORE_USERS = `Maya Chen|maya@acme.com|Event lead+Account execs|${hashPassword("maya-pw")};Sam Lee|sam@acme.com|Exec sponsor`;
  try {
  const r = await login({ password: "maya-pw", email: "maya@acme.com" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const post = (body, c = cookie) => fetch(srv.base + "/api/approve", { method: "POST", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (path, body) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ eventId: "nope", role: "Event lead" })).status, 404, "unsaved events can't be approved");
  await put("events/ev9", { name: "Kitchen", produce: { budget: [{ line: "Venue", amount: 18000 }] }, commits: [{ vendor: "Venue", amount: 9800, status: "Signed" }, { vendor: "Photo", amount: 1400, status: "Quote" }] });
  let x = await post({ eventId: "ev9", eventName: "Kitchen", role: "Exec sponsor", cost: 18000 });
  assert.equal(x.status, 403, "Maya isn't an exec sponsor");
  x = await post({ eventId: "ev9", eventName: "Kitchen", role: "Event lead", cost: 5, committed: 0 });
  assert.equal(x.status, 200);
  const roles = await fetch(srv.base + "/api/approvals?eventId=ev9", { headers: { cookie } }).then((y) => y.json());
  assert.equal(roles.roles["Event lead"].by, "Maya Chen");
  assert.equal(roles.roles["Event lead"].cost, 18000);
  const forged = await put("approvals/ev9", { roles: { "Exec sponsor": { by: "forged" } } });
  assert.equal(forged.status, 403, "approvals can't be written through the data API");
  const log = await fetch(srv.base + "/api/audit?eventId=ev9", { headers: { cookie } }).then((y) => y.json());
  assert.match(log.entries[0].what, /approved the plan at USD 18,000 planned, USD 9,800 committed as Event lead/, "cost comes from the stored event, not the browser");
  assert.equal((await post({ eventId: "ev9", role: "Event lead" }, "")).status, 401);
  // raising the plan by more than 5% clears the approval on the server
  await put("events/ev9", { name: "Kitchen", produce: { budget: [{ line: "Venue", amount: 30000 }] }, commits: [] });
  const after = await fetch(srv.base + "/api/approvals?eventId=ev9", { headers: { cookie } }).then((y) => y.json());
  assert.deepEqual(after.roles, {});
  const log2 = await fetch(srv.base + "/api/audit?eventId=ev9", { headers: { cookie } }).then((y) => y.json());
  assert.match(log2.entries[0].what, /approvals reset \(Event lead\)/);
  assert.equal(log2.entries[0].who, "Encore server");
  } finally { process.env.ENCORE_USERS = usersBefore; }
});

test("guest links get a redacted event; AE links are signed and scoped to the AE's guests", async () => {
  const r = await login({ password: "team-pass", email: "maya@acme.com" });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  await fetch(srv.base + "/api/db/doc?path=events/ev7", { method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({
    name: "Kitchen", budget: 18000, pitch: { ask: "Approve $18k" }, opps: [{ amount: 1 }], commits: [{ amount: 9800 }],
    guests: [{ name: "Ana Diaz", title: "VP", company: "Acme", email: "ana@acme.com", note: "Budget is $2M", owner: "Sam Lee", status: "Attended", fuDraft: "Hi Ana", optIn: true },
             { name: "Bo Chan", title: "CMO", company: "Beta", email: "bo@beta.com", owner: "Kim Park", status: "Attended" }] }) });
  const g = await fetch(srv.base + "/api/db/doc?path=events/ev7", { headers: { "x-encore-guest": "1" } }).then((y) => y.json());
  assert.equal(g.data.guests[0].email, undefined);
  assert.equal(g.data.guests[0].note, undefined);
  assert.equal(g.data.budget, undefined);
  assert.equal(g.data.pitch, undefined);
  assert.equal(g.data.opps, undefined);
  assert.equal(g.data.guests[0].name, "Ana Diaz");
  assert.equal(g.data.guests[0].owner, undefined, "guests never see who owns a relationship");
  assert.deepEqual(g.data.guests.map((x) => x.name), ["Ana Diaz"], "only guests who opted in and are going are listed");
  const full = await fetch(srv.base + "/api/db/doc?path=events/ev7", { headers: { cookie } }).then((y) => y.json());
  assert.equal(full.data.guests[0].email, "ana@acme.com", "signed-in team members still see everything");
  const { token, slug } = await fetch(srv.base + "/api/aelink?eventId=ev7&ae=Sam%20Lee", { headers: { cookie } }).then((y) => y.json());
  assert.equal(slug, "sam-lee");
  const act = (body) => fetch(srv.base + "/api/aeaction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await act({ eventId: "ev7", ae: "sam-lee", t: "forged", guest: "Ana Diaz", action: "approve", draft: "x" })).status, 403);
  assert.equal((await act({ eventId: "ev7", ae: "sam-lee", t: token, guest: "Bo Chan", action: "approve", draft: "x" })).status, 403, "not Sam's guest");
  const ok = await act({ eventId: "ev7", ae: "sam-lee", t: token, guest: "Ana Diaz", action: "approve", draft: "Hi Ana, thanks", at: 9999999999999 });
  assert.equal(ok.status, 200);
  const rec = (await ok.json()).action;
  assert.ok(rec.at < 9999999999999, "server stamps the time");
  const page = await fetch(srv.base + `/api/aepage?eventId=ev7&ae=sam-lee&t=${token}`).then((y) => y.json());
  assert.deepEqual(page.event.guests.map((x) => x.name), ["Ana Diaz"]);
  assert.equal(page.actions.length, 1);
  assert.equal((await fetch(srv.base + "/api/db/collection?path=aeactions", { method: "POST", headers: { "x-encore-guest": "1", "Content-Type": "application/json" }, body: "{}" })).status, 401, "guests can't write AE actions directly");
});

test("personal passwords, signed plan links, scoped guest wall, save conflicts", async () => {
  const { hashPassword } = await import("../server/auth.js");
  const before = process.env.ENCORE_USERS;
  process.env.ENCORE_USERS = `Maya Chen|maya@acme.com|Event lead|${hashPassword("maya-only")};Sam Lee|sam@acme.com|Exec sponsor`;
  try {
    assert.equal((await login({ password: "team-pass", email: "maya@acme.com" })).status, 401, "a personal password replaces the team password");
    const r = await login({ password: "maya-only", email: "maya@acme.com" });
    assert.equal(r.status, 200);
    const cookie = r.headers.get("set-cookie").split(";")[0], H = { cookie, "Content-Type": "application/json" };
    await fetch(srv.base + "/api/db/doc?path=events/evP", { method: "PUT", headers: H, body: JSON.stringify({ name: "P", budget: 9000, notes: "secret", pitch: { ask: "x" }, updatedAt: 1, guests: [{ name: "A", email: "a@x.com", note: "n", optIn: true, status: "Going" }] }) });
    const plain = await fetch(srv.base + "/api/db/doc?path=events/evP", { headers: { "x-encore-guest": "1", "x-encore-view": "plan" } });
    assert.equal(plain.status, 403, "an unsigned plan view gets nothing");
    const forgedPlan = await fetch(srv.base + "/api/db/doc?path=events/evP", { headers: { "x-encore-guest": "1", "x-encore-view": "plan", "x-encore-token": "0".repeat(32) } });
    assert.equal(forgedPlan.status, 403, "a forged plan token gets nothing");
    const rsvpView = await fetch(srv.base + "/api/db/doc?path=events/evP", { headers: { "x-encore-guest": "1", "x-encore-view": "rsvp" } }).then((y) => y.json());
    assert.equal(rsvpView.data.notes, undefined, "unknown fields never reach guests");
    const { token } = await fetch(srv.base + "/api/plantoken?eventId=evP", { headers: H }).then((y) => y.json());
    const signed = await fetch(srv.base + "/api/db/doc?path=events/evP", { headers: { "x-encore-guest": "1", "x-encore-view": "plan", "x-encore-token": token } }).then((y) => y.json());
    assert.equal(signed.data.budget, 9000);
    assert.equal(signed.data.guests[0].email, undefined);
    assert.equal((await fetch(srv.base + "/api/db/collection?path=wall", { headers: { "x-encore-guest": "1" } })).status, 400, "guests must name the event");
    assert.equal((await fetch(srv.base + "/api/db/doc?path=system/secret", { headers: H })).status, 403);
    const stale = await fetch(srv.base + "/api/db/doc?path=events/evP", { method: "PUT", headers: H, body: JSON.stringify({ name: "P2", _base: 0, updatedAt: 2 }) });
    assert.equal(stale.status, 409, "a stale save is refused");
    const fresh = await fetch(srv.base + "/api/db/doc?path=events/evP", { method: "PUT", headers: H, body: JSON.stringify({ name: "P2", _base: 1, updatedAt: 2 }) });
    assert.equal(fresh.status, 200);
  } finally { process.env.ENCORE_USERS = before; }
});
