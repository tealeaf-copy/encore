import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { getWorkspace, updateWorkspace, scopeChange } from "../server/workspaces.js";

let srv, A, B;
const J = { "Content-Type": "application/json" };
before(async () => { srv = await startServer(); });
beforeEach(() => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "ws-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100";
  delete process.env.APP_PASSWORD; delete process.env.ENCORE_USERS; resetLoginLimits();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "APP_PASSWORD", "SLACK_WEBHOOK_URL"]) delete process.env[k]; await srv.close(); });

const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie, h = {}) => fetch(srv.base + path, { headers: { ...(cookie ? { cookie } : {}), ...h } });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
async function signup(company, email, password = "long-password-1") {
  const r = await post("/api/signup", { name: company + " Owner", email, company, password });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  return { cookie: cookieOf(r), ws: j.workspace.id, email };
}
const rpc = (token, name, args) => fetch(srv.base + "/mcp", { method: "POST", headers: { ...J, Authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.json()).then((j) => ({ isError: !!j.result?.isError, data: (() => { try { return JSON.parse(j.result.content[0].text); } catch { return j.result?.content?.[0]?.text; } })() }));

test("sign-up is off unless ENCORE_SIGNUP=1, and validates what it gets", async () => {
  delete process.env.ENCORE_SIGNUP;
  assert.equal((await post("/api/signup", { name: "X", email: "x@x.com", company: "X", password: "long-password-1" })).status, 404);
  process.env.ENCORE_SIGNUP = "1";
  assert.equal((await post("/api/signup", { name: "X", email: "x@x.com", company: "X", password: "short" })).status, 400);
  assert.equal((await post("/api/signup", { name: "X", email: "not-an-email", company: "X", password: "long-password-1" })).status, 400);
  assert.equal((await post("/api/signup", { name: "", email: "x@x.com", company: "X", password: "long-password-1" })).status, 400);
  A = await signup("Acme", "owner@acme.com");
  B = await signup("Beta", "owner@beta.com");
  assert.match(A.ws, /^[A-Za-z0-9]{20}$/);
  assert.notEqual(A.ws, B.ws);
  assert.equal((await post("/api/signup", { name: "Again", email: "OWNER@acme.com", company: "Other", password: "long-password-1" })).status, 409);
  const me = await (await get("/api/me", A.cookie)).json();
  assert.equal(me.verified, true);
  assert.equal(me.owner, true);
  assert.equal(me.workspace.id, A.ws);
  const w = await (await get("/api/workspace", A.cookie)).json();
  assert.equal(w.company, "Acme");
  assert.equal(w.plan, "trial");
  assert.equal(w.trial, true);
  assert.equal(w.daysLeft, 14);
  assert.ok(Math.abs(w.trialEndsAt - (Date.now() + 14 * 864e5)) < 60_000);
  assert.deepEqual(w.members, [{ name: "Acme Owner", email: "owner@acme.com", roles: ["Event lead"], owner: true }]);
  assert.equal(w.limits.features, "all");
  // the account is stored hashed in system/, never readable through the data API
  const raw = srv.store.list("system").map((d) => d.data).find((u) => u.kind === "user" && u.email === "owner@acme.com");
  assert.match(raw.pw, /^scrypt\$/);
  assert.equal((await get("/api/db/collection?path=system", A.cookie)).status, 403);
  // sign in again with the password
  assert.equal((await post("/api/login", { email: "owner@acme.com", password: "wrong-password" })).status, 401);
  const again = await post("/api/login", { email: "owner@acme.com", password: "long-password-1" });
  assert.equal(again.status, 200);
  assert.equal((await (await get("/api/me", cookieOf(again))).json()).workspace.id, A.ws);
});

test("workspaces can't see each other: data, audit, assets, tokens", async () => {
  assert.equal((await put("events/evA1", { name: "Acme dinner", budget: 9000, guests: [{ name: "Ana", email: "ana@x.com", optIn: true, status: "Going" }] }, A.cookie)).status, 200);
  await put("brands/main", { company: "Acme", colors: ["#111111"], program: { annual: 1 } }, A.cookie);
  await post("/api/audit", { eventId: "evA1", what: "Acme secret note" }, A.cookie);
  const asset = await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { cookie: A.cookie, "Content-Type": "image/png" }, body: "PNG" })).json();

  assert.equal((await (await get("/api/db/doc?path=events/evA1", B.cookie)).json()).exists, false);
  assert.deepEqual((await (await get("/api/db/collection?path=events", B.cookie)).json()).docs, []);
  assert.equal((await (await get("/api/db/doc?path=brands/main", B.cookie)).json()).exists, false);
  assert.equal((await put("events/evA1", { name: "hijack" }, B.cookie)).status, 409, "an event id belongs to one workspace");
  assert.equal(srv.store.get(`ws/${A.ws}/events/evA1`).data.name, "Acme dinner");
  assert.equal((await get(`/api/db/doc?path=ws/${A.ws}/events/evA1`, B.cookie)).status, 403, "no path reaches another workspace");
  assert.equal((await get(`/api/db/collection?path=ws`, B.cookie)).status, 403);
  const audit = await (await get("/api/audit", B.cookie)).json();
  assert.equal(audit.entries.some((e) => /Acme/.test(e.what)), false);
  assert.equal((await (await get("/api/audit?eventId=evA1", A.cookie)).json()).entries[0].what, "Acme secret note");
  assert.deepEqual((await (await get("/api/assets", B.cookie)).json()).assets, []);
  assert.equal((await (await get("/api/assets", A.cookie)).json()).assets.length, 1);
  assert.equal((await fetch(srv.base + "/api/assets/" + asset.id, { method: "DELETE", headers: { cookie: B.cookie } })).status, 404);
  assert.equal((await get("/api/approvals?eventId=evA1", B.cookie).then((r) => r.json())).fullyApproved, false);
  assert.equal((await post("/api/approve", { eventId: "evA1", role: "Event lead" }, B.cookie)).status, 404, "B can't approve A's event");
  for (const p of ["/api/plantoken?eventId=evA1", "/api/aelink?eventId=evA1&ae=Sam"]) assert.equal((await get(p, B.cookie)).status, 404, p);
  assert.equal((await post("/api/invitetoken", { eventId: "evA1", guestKey: "ana@x.com" }, B.cookie)).status, 404);
  // the default workspace (shared password) doesn't see sign-up workspaces either
  process.env.APP_PASSWORD = "team-pass";
  const d = cookieOf(await post("/api/login", { password: "team-pass" }));
  assert.deepEqual((await (await get("/api/db/collection?path=events", d)).json()).docs.filter((x) => x.id === "evA1"), []);
  assert.equal((await put("events/evA1", { name: "hijack" }, d)).status, 409);
  // live updates only carry your own workspace's changes
  assert.equal(scopeChange({ path: `ws/${A.ws}/events/evA1`, parent: `ws/${A.ws}/events` }, B.ws), null);
  assert.deepEqual(scopeChange({ path: `ws/${A.ws}/events/evA1`, parent: `ws/${A.ws}/events` }, A.ws), { path: "events/evA1", parent: "events" });
  assert.equal(scopeChange({ path: `ws/${A.ws}/events/evA1`, parent: `ws/${A.ws}/events` }, "default"), null);
  assert.equal(scopeChange({ path: "system/u-1", parent: "system" }, "default"), null);
});

test("guest links find the event's workspace and only see its public parts", async () => {
  const G = { "x-encore-guest": "1", "x-encore-key": "gk1", "Content-Type": "application/json" };
  const g = await (await get("/api/db/doc?path=events/evA1", null, G)).json();
  assert.equal(g.exists, true);
  assert.equal(g.workspace, A.ws, "the guest page learns the workspace for brand/roadmap reads");
  assert.equal(g.data.budget, undefined);
  assert.equal(g.data.guests[0].email, undefined);
  const brand = await (await get("/api/db/doc?path=brands/main", null, { ...G, "x-encore-workspace": A.ws })).json();
  assert.deepEqual(brand.data, { company: "Acme", colors: ["#111111"] });
  assert.equal((await (await get("/api/db/doc?path=brands/main", null, G)).json()).exists, false, "without the header: the default workspace");
  // guest RSVPs land in the event's workspace
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: G, body: JSON.stringify({ eventId: "evA1", name: "Guest G", response: "going" }) });
  assert.equal(r.status, 200);
  assert.equal((await (await get("/api/db/collection?path=rsvps", A.cookie)).json()).docs.length, 1);
  assert.equal((await (await get("/api/db/collection?path=rsvps", B.cookie)).json()).docs.length, 0);
  // plan links are signed per workspace
  const { token } = await (await get("/api/plantoken?eventId=evA1", A.cookie)).json();
  const plan = (t) => get("/api/db/doc?path=events/evA1", null, { ...G, "x-encore-view": "plan", "x-encore-token": t });
  assert.equal((await plan(token)).status, 200);
  await put("events/evB1", { name: "Beta" }, B.cookie);
  const other = (await (await get("/api/plantoken?eventId=evB1", B.cookie)).json()).token;
  assert.equal((await plan(other)).status, 403);
  // signed AE pages resolve the workspace from the event too
  const ae = await (await get("/api/aelink?eventId=evA1&ae=Sam%20Lee", A.cookie)).json();
  assert.equal((await get(`/api/aepage?eventId=evA1&ae=sam-lee&t=${ae.token}`)).status, 200);
});

test("MCP tokens are per workspace", async () => {
  const mk = await post("/api/mcptoken", { name: "Acme Owner" }, A.cookie);
  assert.equal(mk.status, 200);
  const { token } = await mk.json();
  assert.equal(token.length, 40);
  assert.equal(JSON.stringify(srv.store.list("system")).includes(token), false, "stored hashed");
  const tB = (await (await post("/api/mcptoken", {}, B.cookie)).json()).token;
  const listA = await rpc(token, "list_events", {});
  assert.deepEqual(listA.data.map((e) => e.id), ["evA1"]);
  assert.deepEqual((await rpc(tB, "list_events", {})).data.map((e) => e.id), ["evB1"]);
  assert.equal((await rpc(tB, "get_event", { id: "evA1" })).isError, true);
  const made = await rpc(token, "create_event", { name: "From Claude" });
  assert.ok(srv.store.get(`ws/${A.ws}/events/${made.data.id}`));
  assert.equal((await (await get(`/api/db/doc?path=events/${made.data.id}`, B.cookie)).json()).exists, false);
  const log = (await (await get(`/api/audit?eventId=${made.data.id}`, A.cookie)).json()).entries;
  assert.equal(log[0].who, "Acme Owner");
  assert.equal((await fetch(srv.base + "/mcp", { method: "POST", headers: { ...J, Authorization: "Bearer " + "x".repeat(40) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) })).status, 401);
});

test("team invites: one-time, 7-day links; owner only", async () => {
  const inv = await post("/api/invite", { email: "sam@acme.com", role: "Exec sponsor" }, A.cookie);
  assert.equal(inv.status, 200);
  const { link, token, expiresAt } = await inv.json();
  assert.equal(link, "/join#" + token);
  assert.ok(Math.abs(expiresAt - (Date.now() + 7 * 864e5)) < 60_000);
  assert.equal((await post("/api/invite", { email: "owner@beta.com", role: "x" }, A.cookie)).status, 409, "already has an account");
  assert.equal((await post("/api/join", { token, name: "Sam", password: "short" })).status, 400);
  const j = await post("/api/join", { token, name: "Sam Lee", password: "sam-password-1" });
  assert.equal(j.status, 200);
  const sam = cookieOf(j);
  const me = await (await get("/api/me", sam)).json();
  assert.equal(me.workspace.id, A.ws);
  assert.deepEqual(me.roles, ["Exec sponsor"]);
  assert.equal(me.owner, false);
  assert.equal((await post("/api/join", { token, name: "Again", password: "sam-password-1" })).status, 410, "single use");
  assert.equal((await (await get("/api/db/doc?path=events/evA1", sam)).json()).exists, true, "the new member sees the workspace's data");
  assert.deepEqual((await (await get("/api/workspace", A.cookie)).json()).members.map((m) => m.email), ["owner@acme.com", "sam@acme.com"]);
  assert.equal((await post("/api/invite", { email: "x@acme.com", role: "x" }, sam)).status, 403, "members can't invite");
  assert.equal((await post("/api/mcptoken", {}, sam)).status, 403);
  // approvals use the workspace's own roles
  assert.deepEqual((await (await get("/api/approvals?eventId=evA1", A.cookie)).json()).required, ["Event lead", "Exec sponsor"]);
  assert.equal((await post("/api/approve", { eventId: "evA1", role: "Exec sponsor" }, sam)).status, 200);
  // expired invites don't work
  const t2 = (await (await post("/api/invite", { email: "kim@acme.com", role: "AE" }, A.cookie)).json()).token;
  const p2 = "system/inv-" + createHash("sha256").update(t2).digest("hex").slice(0, 40);
  srv.store.update(p2, { expiresAt: Date.now() - 1 });
  assert.equal((await post("/api/join", { token: t2, name: "Kim", password: "kim-password-1" })).status, 410);
  assert.equal((await post("/api/join", { token: "f".repeat(48), name: "Kim", password: "kim-password-1" })).status, 410);
  // sign in as the invited member
  assert.equal((await post("/api/login", { email: "sam@acme.com", password: "sam-password-1" })).status, 200);
});

test("after the trial, writes get 402 and reads still work; upgrade records a request", async () => {
  updateWorkspace(B.ws, { trialEndsAt: Date.now() - 1000 });
  const w = await (await get("/api/workspace", B.cookie)).json();
  assert.equal(w.trialEnded, true);
  assert.equal(w.daysLeft, 0);
  const r = await put("events/evB2", { name: "Late" }, B.cookie);
  assert.equal(r.status, 402);
  assert.equal((await r.json()).code, "trial_ended");
  assert.equal((await post("/api/audit", { what: "x" }, B.cookie)).status, 402);
  assert.equal((await get("/api/db/doc?path=events/evB1", B.cookie)).status, 200, "reads still work");
  const tB = (await (await post("/api/mcptoken", {}, A.cookie)).json()).token; // A is still in trial
  assert.equal((await rpc(tB, "create_event", { name: "fine" })).isError, false);
  assert.equal((await post("/api/upgrade", { plan: "enterprise" }, B.cookie)).status, 400);
  const up = await post("/api/upgrade", { plan: "team" }, B.cookie);
  assert.equal(up.status, 200);
  assert.equal((await up.json()).plan, "pending_team");
  assert.equal(getWorkspace(B.ws).upgradeRequest.plan, "team");
  assert.equal((await put("events/evB2", { name: "Late" }, B.cookie)).status, 402, "a pending upgrade doesn't unlock writes (billing isn't wired)");
  updateWorkspace(B.ws, { plan: "team" }); // what an operator does once paid
  assert.equal((await put("events/evB2", { name: "Late" }, B.cookie)).status, 200);
  const w2 = await (await get("/api/workspace", B.cookie)).json();
  assert.equal(w2.trial, false);
  assert.equal(w2.writable, true);
});

test("signed-out visitors get the landing page; /signup and /login; guest links still redirect", async () => {
  const home = await (await get("/")).text();
  assert.match(home, /location\.replace\("\/g" \+ location\.search \+ location\.hash\)/, "guest-link redirect added");
  const su = await (await get("/signup")).text();
  assert.match(su, /\/api\/signup/);
  assert.match(su, /location\.replace\("\/g"/);
  assert.match(await (await get("/login")).text(), /href="\/signup"/);
  assert.match(await (await get("/join")).text(), /\/api\/join/);
  assert.match(await (await get("/", A.cookie)).text(), /shim\.js/, "signed in: the app");
  delete process.env.ENCORE_SIGNUP; process.env.APP_PASSWORD = "team-pass";
  assert.match(await (await get("/")).text(), /<form method="post" action="\/api\/login">/);
  assert.equal((await fetch(srv.base + "/signup", { redirect: "manual" })).status, 302);
});

test("sign-up workspaces don't get this server's own integrations", async () => {
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/x";
  try {
    const mine = (await (await get("/api/mcp/tools", A.cookie)).json()).servers.map((s) => s.server);
    assert.equal(mine.includes("Slack"), false);
    assert.equal((await post("/api/mcp/call", { server: "Slack", tool: "slack_send_message", input: { text: "x" } }, A.cookie)).status, 404);
  } finally { delete process.env.SLACK_WEBHOOK_URL; }
});

test("sign-up is rate limited per IP", async () => {
  process.env.ENCORE_SIGNUP_PER_HOUR = "1";
  let last;
  for (let i = 0; i < 3; i++) last = await post("/api/signup", { name: "R", email: `r${i}@r.com`, company: "R", password: "long-password-1" });
  assert.equal(last.status, 429);
});

test("/demo runs the page without the shim, no login; sign-up passes template and plan through", async () => {
  process.env.APP_PASSWORD = "team-pass";
  const demo = await get("/demo");
  assert.equal(demo.status, 200);
  const html = await demo.text();
  assert.doesNotMatch(html, /shim\.js/, "no shim: built-in sample data, nothing saved");
  assert.match(html, /<body>/);
  process.env.ENCORE_SIGNUP_PER_HOUR = "100";
  const r = await post("/api/signup", { name: "T", email: "t@tmpl.com", company: "T", password: "long-password-1", template: "exec-dinner", plan: "team" });
  const j = await r.json();
  assert.equal(j.redirect, "/?welcome=1&template=exec-dinner&plan=team");
  assert.equal(getWorkspace(j.workspace.id).plan, "trial", "a plan picked on the landing page is only noted");
  assert.equal(getWorkspace(j.workspace.id).interestedIn, "team");
  const bad = await (await post("/api/signup", { name: "U", email: "u@tmpl.com", company: "U", password: "long-password-1", template: "<script>" })).json();
  assert.equal(bad.redirect, "/?welcome=1");
  assert.match(await (await get("/signup?template=x")).text(), /location\.search/);
});

test("AE nomination links work without a login, with the signed AE token", async () => {
  await put("events/evN1", { name: "Nom", updatedAt: undefined, guests: [
    { name: "Ana", title: "VP", company: "Acme", email: "ana@acme.com", owner: "Sam Lee", note: "secret" },
    { name: "Bo", company: "Beta", owner: "Kim Park" }],
    scout: { contacts: [{ name: "Cy", title: "CMO", company: "Gamma", owner: "Sam Lee", why: "renewal", email: "cy@g.com" }, { name: "Ana", company: "Acme", owner: "Sam Lee" }] } }, A.cookie);
  const { token, slug } = await (await get("/api/aelink?eventId=evN1&ae=Sam%20Lee", A.cookie)).json();
  const G = { "x-encore-guest": "1", "x-encore-key": "k", "x-encore-view": "nominate", "Content-Type": "application/json" };
  const ev = (await (await get("/api/db/doc?path=events/evN1", null, { ...G, "x-encore-token": token })).json()).data;
  assert.equal(ev.nomFor, "sam-lee");
  assert.deepEqual(ev.nomSuggest, [{ name: "Ana", title: "VP", company: "Acme" }, { name: "Cy", title: "CMO", company: "Gamma" }], "only Sam's people, deduped, name/title/company");
  assert.equal(ev.scout, undefined);
  for (const bad of [null, "0".repeat(32)]) {
    const d = (await (await get("/api/db/doc?path=events/evN1", null, { ...G, ...(bad ? { "x-encore-token": bad } : {}) })).json()).data;
    assert.equal(d.nomSuggest, undefined);
  }
  const nom = (headers, id = `evN1--${slug}`) => fetch(srv.base + "/api/db/doc?path=nominations/" + id, { method: "PUT", headers, body: JSON.stringify({ eventId: "other", ae: "kim-park", picks: [{ name: "Cy" }] }) });
  assert.equal((await nom(G)).status, 401, "no token");
  assert.equal((await nom({ ...G, "x-encore-token": "0".repeat(32) })).status, 401, "forged token");
  assert.equal((await nom({ ...G, "x-encore-token": token }, "evN1--kim-park")).status, 401, "Sam's token can't write Kim's nominations");
  assert.equal((await nom({ ...G, "x-encore-token": token })).status, 200);
  const saved = (await (await get(`/api/db/doc?path=nominations/evN1--${slug}`, A.cookie)).json()).data;
  assert.equal(saved.eventId, "evN1");
  assert.equal(saved.ae, "sam-lee", "the link decides whose nominations these are");
  assert.equal(saved.source, "ae-link");
  assert.equal((await (await get(`/api/db/doc?path=nominations/evN1--${slug}`, B.cookie)).json()).exists, false, "stored in the event's workspace");
  const tokB = (await (await get("/api/aelink?eventId=evB1&ae=Sam%20Lee", B.cookie)).json()).token;
  assert.equal((await nom({ ...G, "x-encore-token": tokB })).status, 401, "another workspace's AE token doesn't work");
});

test("an invite with no role never becomes a required approver", async () => {
  const W = await signup("Gamma", "owner@gamma.com");
  srv.store.set(`ws/${W.ws}/events/evG1`, { name: "G", produce: { team: [{ role: "Event lead" }, { role: "VP Marketing" }, { role: "Designer" }] } });
  const required = async () => (await (await get("/api/approvals?eventId=evG1", W.cookie)).json()).required;
  assert.deepEqual(await required(), ["Event lead"], "the owner's lead role");
  const i1 = await (await post("/api/invite", { email: "plain@gamma.com" }, W.cookie)).json();
  assert.equal(i1.role, "Team member");
  assert.equal(i1.approverRole, false);
  await post("/api/join", { token: i1.token, name: "Plain", password: "plain-password" });
  const i2 = await (await post("/api/invite", { email: "ae@gamma.com", role: "AE" }, W.cookie)).json();
  await post("/api/join", { token: i2.token, name: "Ae", password: "ae-password-1" });
  assert.deepEqual(await required(), ["Event lead"], "generic roles never count");
  const i3 = await (await post("/api/invite", { email: "cfo@gamma.com", role: "Finance approver" }, W.cookie)).json();
  assert.equal(i3.approverRole, true);
  await post("/api/join", { token: i3.token, name: "Cf", password: "cfo-password-1" });
  assert.deepEqual(await required(), ["Event lead", "Finance approver"]);
  // a role literally named "Team member" by default stays out even if approver roles are later read from members
  assert.equal((await (await get("/api/workspace", W.cookie)).json()).members.find((m) => m.email === "plain@gamma.com").roles[0], "Team member");
  process.env.ENCORE_APPROVER_ROLES = "Exec sponsor";
  try { assert.deepEqual(await required(), ["Exec sponsor"], "ENCORE_APPROVER_ROLES wins"); } finally { delete process.env.ENCORE_APPROVER_ROLES; }
  // with no approver-like member roles at all, the plan's own team leads are required (the old fallback)
  srv.store.list("system").filter((d) => d.data.kind === "user" && d.data.ws === W.ws).forEach((d) => srv.store.update("system/" + d.id, { roles: ["Designer"] }));
  assert.deepEqual(await required(), ["Event lead", "VP Marketing"]);
});
