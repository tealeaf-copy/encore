import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv, A, B;
const J = { "Content-Type": "application/json" };
const realFetch = globalThis.fetch;
let calls = [];
// Provider calls are mocked; requests to the test server go through.
const mock = (handler) => { globalThis.fetch = async (url, init = {}) => { const u = String(url); if (u.startsWith(srv.base)) return realFetch(url, init); calls.push({ url: u, auth: init.headers?.Authorization || init.headers?.authorization, method: init.method || "GET", body: init.body }); return handler(u, init); }; };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

before(async () => { srv = await startServer(); });
beforeEach(() => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "conn-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_CONTACT_PER_HOUR = "100";
  delete process.env.APP_PASSWORD; delete process.env.ENCORE_USERS; delete process.env.HUBSPOT_TOKEN; resetLoginLimits(); calls = [];
});
afterEach(() => { globalThis.fetch = realFetch; });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_CONTACT_PER_HOUR", "APP_PASSWORD", "ENCORE_USERS", "HUBSPOT_TOKEN"]) delete process.env[k]; await srv.close(); });

const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const del = (path, cookie) => fetch(srv.base + path, { method: "DELETE", headers: { cookie } });
async function signup(company, email) {
  const r = await post("/api/signup", { name: company + " Owner", email, company, password: "long-password-1" });
  return { cookie: r.headers.get("set-cookie").split(";")[0], ws: (await r.json()).workspace.id };
}

test("workspaces connect their own HubSpot token; it's checked, encrypted, and used for their tool calls", async () => {
  A = await signup("Acme", "owner@acme.com"); B = await signup("Beta", "owner@beta.com");
  mock((u, init) => (init.headers.Authorization === "Bearer good-token" ? reply(200, { results: [] }) : reply(401, { message: "bad" })));
  assert.deepEqual((await (await get("/api/connections", A.cookie)).json()).connections.map((c) => [c.provider, c.connected]), [["hubspot", false], ["attio", false]]);
  assert.equal((await post("/api/connections", { provider: "salesforce", token: "x" }, A.cookie)).status, 400);
  const bad = await post("/api/connections", { provider: "hubspot", token: "wrong" }, A.cookie);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "invalid_token");
  assert.equal(calls[0].url, "https://api.hubapi.com/crm/v3/objects/companies?limit=1");
  const ok = await post("/api/connections", { provider: "hubspot", token: "good-token" }, A.cookie);
  assert.equal(ok.status, 200);
  const c = (await ok.json()).connection;
  assert.equal(c.connected, true);
  assert.equal(c.by, "owner@acme.com");
  // encrypted at rest, never served
  const rawDoc = srv.store.get(`system/conn-${A.ws}-hubspot`).data;
  assert.equal(JSON.stringify(rawDoc).includes("good-token"), false);
  assert.ok(rawDoc.secret.iv && rawDoc.secret.tag && rawDoc.secret.ct);
  assert.equal((await get(`/api/db/doc?path=system/conn-${A.ws}-hubspot`, A.cookie)).status, 403);
  assert.equal(JSON.stringify(await (await get("/api/connections", A.cookie)).json()).includes("good-token"), false);
  // A gets the HubSpot tools, running on A's token; B doesn't
  assert.ok((await (await get("/api/mcp/tools", A.cookie)).json()).servers.some((x) => x.server === "HubSpot"));
  assert.equal((await (await get("/api/mcp/tools", B.cookie)).json()).servers.some((x) => x.server === "HubSpot"), false);
  calls = [];
  mock(() => reply(200, { total: 1, results: [{ id: "1", properties: { name: "Acme Corp" } }] }));
  const r = await post("/api/mcp/call", { server: "HubSpot", tool: "search_crm_objects", input: { objectType: "companies", query: "acme" } }, A.cookie);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).payload.results[0].name, "Acme Corp");
  assert.equal(calls[0].auth, "Bearer good-token");
  assert.equal((await post("/api/mcp/call", { server: "HubSpot", tool: "search_crm_objects", input: { objectType: "companies" } }, B.cookie)).status, 404);
  // the env token is never used for another workspace
  process.env.HUBSPOT_TOKEN = "server-env-token";
  assert.equal((await (await get("/api/mcp/tools", B.cookie)).json()).servers.some((x) => x.server === "HubSpot"), false);
  calls = [];
  await post("/api/mcp/call", { server: "HubSpot", tool: "search_crm_objects", input: { objectType: "companies" } }, A.cookie);
  assert.equal(calls[0].auth, "Bearer good-token", "the workspace's own token wins");
  // Attio: checked and stored only
  mock((u) => (u === "https://api.attio.com/v2/self" ? reply(200, { active: true }) : reply(404, {})));
  assert.equal((await post("/api/connections", { provider: "attio", token: "attio-tok" }, A.cookie)).status, 200);
  assert.equal((await (await get("/api/connections", A.cookie)).json()).connections.find((x) => x.provider === "attio").connected, true);
  // disconnect
  assert.equal((await (await del("/api/connections/hubspot", A.cookie)).json()).removed, true);
  delete process.env.HUBSPOT_TOKEN;
  assert.equal((await (await get("/api/mcp/tools", A.cookie)).json()).servers.some((x) => x.server === "HubSpot"), false);
  // network failure while checking
  mock(() => { throw new Error("blocked"); });
  assert.equal((await post("/api/connections", { provider: "hubspot", token: "t" }, A.cookie)).status, 502);
});

test("only the owner manages connections", async () => {
  const inv = await (await post("/api/invite", { email: "m@acme.com", role: "AE" }, A.cookie)).json();
  const j = await post("/api/join", { token: inv.token, name: "M", password: "member-password" });
  const m = j.headers.get("set-cookie").split(";")[0];
  assert.equal((await get("/api/connections", m)).status, 403);
  assert.equal((await post("/api/connections", { provider: "hubspot", token: "x" }, m)).status, 403);
  assert.equal((await del("/api/connections/hubspot", m)).status, 403);
});

test("the default workspace may connect HubSpot too, else it uses HUBSPOT_TOKEN", async () => {
  delete process.env.ENCORE_SIGNUP; // auth off: the default workspace
  process.env.HUBSPOT_TOKEN = "server-env-token";
  mock(() => reply(200, { total: 0, results: [] }));
  await post("/api/mcp/call", { server: "HubSpot", tool: "search_crm_objects", input: { objectType: "contacts" } });
  assert.equal(calls.at(-1).auth, "Bearer server-env-token");
  assert.equal((await post("/api/connections", { provider: "hubspot", token: "default-own" })).status, 200);
  await post("/api/mcp/call", { server: "HubSpot", tool: "search_crm_objects", input: { objectType: "contacts" } });
  assert.equal(calls.at(-1).auth, "Bearer default-own");
  await del("/api/connections/hubspot");
});

test("contact inbox: open to visitors, validated, rate limited; read by the server's own team only", async () => {
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(" ")); };
  try {
    let r = await post("/api/contact", { kind: "security", name: "Rita", email: "rita@bank.com", company: "Bank", message: "Can we get your SOC 2 report?" });
    assert.equal(r.status, 200);
    assert.ok((await r.json()).id);
    assert.ok(logs.some((l) => /\[contact\] security from Rita <rita@bank.com> \(Bank\)/.test(l)));
    r = await post("/api/contact", { kind: "talk", name: "Ada", email: "ada@acme.com", message: "Pricing?" }, A.cookie);
    assert.equal(r.status, 200);
  } finally { console.log = orig; }
  assert.equal((await post("/api/contact", { kind: "spam", email: "a@b.com", message: "x" })).status, 400);
  assert.equal((await post("/api/contact", { kind: "talk", email: "nope", message: "x" })).status, 400);
  assert.equal((await post("/api/contact", { kind: "talk", email: "a@b.com", message: "" })).status, 400);
  const long = await post("/api/contact", { kind: "billing", email: "a@b.com", name: "n".repeat(500), message: "m".repeat(9000) });
  assert.equal(long.status, 200);
  assert.equal((await get("/api/contact", A.cookie)).status, 403, "a sign-up workspace can't read the operator's inbox");
  assert.equal((await get("/api/db/collection?path=system", A.cookie)).status, 403);
  process.env.APP_PASSWORD = "team-pass";
  process.env.ENCORE_USERS = "Op|op@encore.dev|Admin";
  const op = (await post("/api/login", { email: "op@encore.dev", password: "team-pass" })).headers.get("set-cookie").split(";")[0];
  const inbox = (await (await get("/api/contact", op)).json()).messages;
  assert.equal(inbox.length, 3);
  const sec = inbox.find((x) => x.kind === "security");
  assert.equal(sec.email, "rita@bank.com");
  assert.equal(sec.ws, undefined);
  const talk = inbox.find((x) => x.kind === "talk");
  assert.equal(talk.ws, A.ws, "signed-in senders carry their workspace");
  const b = inbox.find((x) => x.kind === "billing");
  assert.equal(b.name.length, 120);
  assert.equal(b.message.length, 5000);
  process.env.ENCORE_CONTACT_PER_HOUR = "3";
  assert.equal((await post("/api/contact", { kind: "talk", email: "a@b.com", message: "x" })).status, 429);
});

test("MCP tokens: listed without the secret, revocable", async () => {
  const t1 = (await (await post("/api/mcptoken", { name: "Laptop" }, A.cookie)).json()).token;
  await post("/api/mcptoken", { name: "CI" }, A.cookie);
  let list = (await (await get("/api/mcptoken", A.cookie)).json()).tokens;
  assert.deepEqual(list.map((x) => x.name), ["Laptop", "CI"]);
  assert.equal(JSON.stringify(list).includes(t1), false);
  assert.equal(list[0].lastUsedAt, null);
  const ping = () => fetch(srv.base + "/mcp", { method: "POST", headers: { ...J, Authorization: "Bearer " + t1 }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal((await ping()).status, 200);
  list = (await (await get("/api/mcptoken", A.cookie)).json()).tokens;
  assert.ok(list[0].lastUsedAt > 0);
  assert.equal((await del("/api/mcptoken/" + list[0].id, B.cookie)).status, 404, "another workspace can't revoke it");
  assert.equal((await del("/api/mcptoken/" + list[0].id, A.cookie)).status, 200);
  assert.equal((await ping()).status, 401, "revoked");
  assert.deepEqual((await (await get("/api/mcptoken", A.cookie)).json()).tokens.map((x) => x.name), ["CI"]);
});
