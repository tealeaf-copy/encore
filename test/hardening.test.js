import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { hashPassword, resetLoginLimits, useAuthStore } from "../server/auth.js";
import { mcpTokenProblems } from "../server/mcp.js";

// ENCORE_TRUST_PROXY is read when the app is created: this file runs with it on, so tests can pick an IP.
let srv;
const MAYA = hashPassword("maya-pw"), SAM = hashPassword("sam-pw");
const TOKEN = "hardening-token-0123456789abcdef0123";
before(async () => { process.env.ENCORE_TRUST_PROXY = "1"; srv = await startServer(); });
beforeEach(() => {
  process.env.APP_PASSWORD = "team-pass"; process.env.SESSION_SECRET = "s";
  process.env.ENCORE_USERS = `Maya Chen|maya@acme.com|Event lead+Exec sponsor|${MAYA};Sam Lee|sam@acme.com|Exec sponsor|${SAM}`;
  process.env.ENCORE_MCP_TOKEN = TOKEN;
  for (const k of ["ENCORE_APPROVER_ROLES", "ENCORE_ONE_APPROVAL_PER_PERSON", "ENCORE_MCP_TOKENS", "ENCORE_MCP_RATE_PER_MIN"]) delete process.env[k];
  resetLoginLimits();
});
after(async () => { for (const k of ["APP_PASSWORD", "SESSION_SECRET", "ENCORE_USERS", "ENCORE_MCP_TOKEN", "ENCORE_TRUST_PROXY", "ENCORE_ONE_APPROVAL_PER_PERSON"]) delete process.env[k]; await srv.close(); });

const J = { "Content-Type": "application/json" };
const G = { "x-encore-guest": "1", "x-encore-key": "gk", ...J };
const login = (body, ip) => fetch(srv.base + "/api/login", { method: "POST", headers: { ...J, ...(ip ? { "x-forwarded-for": ip } : {}) }, body: JSON.stringify(body) });
const signIn = async (email = "maya@acme.com", password = "maya-pw") => (await login({ email, password }, "10.9.9.9")).headers.get("set-cookie").split(";")[0];
let n = 0;
const rpc = (body, token = TOKEN) => fetch(srv.base + "/mcp", { method: "POST", headers: { ...J, Authorization: "Bearer " + token }, body: JSON.stringify(body) });
const call = async (name, args) => { const r = await (await rpc({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } })).json(); return JSON.parse(r.result.content[0].text); };

test("guests only get public roadmap items, without budgets", async () => {
  srv.store.set("canvas/main", { company: "Acme", territory: { regions: [{ region: "West", target: "$4M" }] }, budget: 900000, items: [
    { name: "Summit", audience: "customers", quarter: 1, format: "Summit", city: "NYC", budget: 250000, owner: "Kim", notes: "x" },
    { name: "Offsite", audience: "employees", quarter: 2, budget: 50000 },
    { name: "Hidden dinner", audience: "prospects", quarter: 0, public: false },
    { name: "Board thing", audience: "prospects", visibility: "private" },
    { name: "Private flag", audience: "partners", private: true } ] });
  const g = (await (await fetch(srv.base + "/api/db/doc?path=canvas/main", { headers: G })).json()).data;
  assert.deepEqual(g, { company: "Acme", items: [{ name: "Summit", audience: "customers", quarter: 1, format: "Summit", city: "NYC" }] });
  const cookie = await signIn();
  const full = (await (await fetch(srv.base + "/api/db/doc?path=canvas/main", { headers: { cookie } })).json()).data;
  assert.equal(full.items.length, 5, "the team still gets the whole canvas");
});

test("guests never get nomination targets, whatever view they claim", async () => {
  srv.store.set("events/evS", { name: "S", scout: { contacts: [{ name: "Ana", company: "Acme", owner: "Sam Lee", why: "renewal", email: "a@acme.com" }] }, guests: [{ name: "Bo", owner: "Kim", optIn: true, status: "Going" }], accounts: ["Acme"] });
  for (const view of ["nominate", "rsvp", "plan-ish", ""]) {
    const r = await fetch(srv.base + "/api/db/doc?path=events/evS", { headers: { ...G, "x-encore-view": view } });
    const d = (await r.json()).data;
    assert.equal(d.scout, undefined, view);
    assert.equal(d.accounts, undefined, view);
    assert.equal(d.guests[0].owner, undefined, view);
  }
  const cookie = await signIn();
  const team = (await (await fetch(srv.base + "/api/db/doc?path=events/evS", { headers: { cookie, "x-encore-guest": "1", "x-encore-view": "nominate" } })).json()).data;
  assert.equal(team.scout.contacts[0].owner, "Sam Lee", "a signed-in AE on a nominate link sees the targets");
});

test("guest links keep their ?utm_ query through the login redirect", async () => {
  for (const path of ["/", "/login"]) {
    const html = await (await fetch(srv.base + path + "?utm_source=li")).text();
    assert.match(html, /location\.replace\("\/g" \+ location\.search \+ location\.hash\)/);
  }
  assert.equal((await fetch(srv.base + "/g?utm_source=li&utm_campaign=q1")).status, 200, "/g serves the page with the query intact");
});

test("login limits: per IP+email, and per email whatever the IP", async () => {
  for (let i = 0; i < 10; i++) await login({ email: "sam@acme.com", password: "x" }, "1.1.1.1");
  assert.equal((await login({ email: "sam@acme.com", password: "sam-pw" }, "1.1.1.1")).status, 429);
  assert.equal((await login({ email: "sam@acme.com", password: "sam-pw" }, "1.1.1.2")).status, 200, "another IP may still try (trusted proxy)");
  resetLoginLimits();
  for (let i = 0; i < 20; i++) assert.equal((await login({ email: "sam@acme.com", password: "x" }, `2.0.0.${i}`)).status, 401);
  const r = await login({ email: "sam@acme.com", password: "sam-pw" }, "3.3.3.3");
  assert.equal(r.status, 429, "20 failures for one email in an hour lock it, from any IP");
  assert.ok(+r.headers.get("retry-after") > 15 * 60, "for the hour window");
  assert.equal((await login({ email: "maya@acme.com", password: "maya-pw" }, "3.3.3.3")).status, 200);
});

test("trust proxy is off by default, so X-Forwarded-For can't dodge the limit", async () => {
  delete process.env.ENCORE_TRUST_PROXY;
  const s2 = await startServer();
  try {
    process.env.APP_PASSWORD = "team-pass"; process.env.SESSION_SECRET = "s";
    process.env.ENCORE_USERS = `Sam Lee|sam@acme.com|Exec sponsor|${SAM}`;
    const l = (ip) => fetch(s2.base + "/api/login", { method: "POST", headers: { ...J, "x-forwarded-for": ip }, body: JSON.stringify({ email: "sam@acme.com", password: "x" }) });
    for (let i = 0; i < 10; i++) await l(`9.9.9.${i}`);
    assert.equal((await l("8.8.8.8")).status, 429);
  } finally { await s2.close(); useAuthStore(srv.store); process.env.ENCORE_TRUST_PROXY = "1"; } // the auth store is per process
});

test("MCP tokens must be 32+ characters; /mcp is rate limited per token", async () => {
  process.env.ENCORE_MCP_TOKEN = "abc";
  assert.match(mcpTokenProblems()[0], /at least 32/);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "abc")).status, 404, "a short shared token is ignored, so MCP stays off");
  process.env.ENCORE_MCP_TOKENS = "Maya|maya@acme.com|short-token-1234567,Sam|sam@acme.com|" + "s".repeat(32);
  assert.match(mcpTokenProblems().join(" "), /Maya/);
  assert.doesNotMatch(mcpTokenProblems().join(" "), /Sam/);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "short-token-1234567")).status, 401);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "s".repeat(32))).status, 200);
  process.env.ENCORE_MCP_TOKEN = TOKEN; delete process.env.ENCORE_MCP_TOKENS;
  assert.deepEqual(mcpTokenProblems(), []);
  process.env.ENCORE_MCP_RATE_PER_MIN = "5";
  const tok = "rate-token-0123456789abcdef0123456789";
  process.env.ENCORE_MCP_TOKENS = `Rate|r@x.com|${tok}`;
  const batch = (k) => Array.from({ length: k }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
  assert.equal((await rpc(batch(4), tok)).status, 200);
  assert.equal((await rpc(batch(2), tok)).status, 429, "batch messages count toward the limit");
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, tok);
  assert.equal(r.status, 200, "one more fits");
  const over = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, tok);
  assert.equal(over.status, 429);
  assert.ok(+over.headers.get("retry-after") > 0);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" })).status, 200, "other tokens have their own budget");
});

test("MCP reads are audited as kind read, but kept out of the decision log by default", async () => {
  const ev = await call("create_event", { name: "Audit reads" });
  await call("get_event", { id: ev.id });
  await call("guest_list", { id: ev.id });
  const cookie = await signIn();
  const log = await (await fetch(srv.base + `/api/audit?eventId=${ev.id}`, { headers: { cookie } })).json();
  assert.deepEqual(log.entries.map((e) => e.kind), ["mcp"]);
  const all = await (await fetch(srv.base + `/api/audit?eventId=${ev.id}&reads=1`, { headers: { cookie } })).json();
  assert.deepEqual(all.entries.map((e) => e.what).sort(), ["Audit reads: created from Claude", "read get_event", "read guest_list"]);
});

test("ENCORE_ONE_APPROVAL_PER_PERSON: one approver role per person per event", async () => {
  const maya = await signIn(), sam = await signIn("sam@acme.com", "sam-pw");
  srv.store.set("events/evD", { name: "D", budget: 100 });
  const approve = (cookie, role, extra = {}) => fetch(srv.base + "/api/approve", { method: "POST", headers: { cookie, ...J }, body: JSON.stringify({ eventId: "evD", role, ...extra }) });
  process.env.ENCORE_ONE_APPROVAL_PER_PERSON = "1";
  assert.equal((await approve(maya, "Event lead")).status, 200);
  const twice = await approve(maya, "Exec sponsor");
  assert.equal(twice.status, 409);
  assert.match((await twice.json()).message, /already approved this plan as Event lead/);
  assert.equal((await approve(maya, "Event lead")).status, 200, "re-approving the same role is fine");
  assert.equal((await approve(sam, "Exec sponsor")).status, 200);
  const st = await (await fetch(srv.base + "/api/approvals?eventId=evD", { headers: { cookie: maya } })).json();
  assert.equal(st.fullyApproved, true);
  assert.equal((await approve(maya, "Event lead", { withdraw: true })).status, 200, "withdrawing is always allowed");
  delete process.env.ENCORE_ONE_APPROVAL_PER_PERSON;
  srv.store.delete("approvals/evD");
  assert.equal((await approve(maya, "Event lead")).status, 200);
  assert.equal((await approve(maya, "Exec sponsor")).status, 200, "off by default");
});

test("MCP totals: confirmed deals only, converted to USD; registered like the page; series masters not double counted", async () => {
  for (const d of srv.store.list("events")) srv.store.delete("events/" + d.id);
  srv.store.set("events/evM", { name: "Master", isSeries: true, budget: 30000, currency: "USD", status: "planning" });
  srv.store.set("events/evC1", { name: "Master: London", parentId: "evM", budget: 10000, currency: "GBP", status: "done", actualSpend: 10000,
    guests: [{ name: "A", status: "Going" }, { name: "B", status: "Attended" }, { name: "C", status: "Invited" }],
    opps: [
      { bucket: "created", amount: 100000, currency: "EUR", match: "contact" },
      { bucket: "created", amount: 50000, confirmedBy: "Maya" },
      { bucket: "created", amount: 999999, match: "company" },
      { bucket: "existing", amount: 20000, currency: "GBP", match: "contact" },
      { bucket: "existing", amount: 77777, match: "company" } ] });
  srv.store.set("events/evLone", { name: "Lone series", isSeries: true, budget: 5000, status: "planning" });
  srv.store.set("rsvps/r1", { eventId: "evC1", response: "going" });
  srv.store.set("rsvps/r2", { eventId: "evC1", response: "maybe" });
  srv.store.set("rsvps/r3", { eventId: "evM", response: "going" });

  const rep = await call("pipeline_report", { id: "evC1" });
  assert.equal(rep.createdAfterEvent, 108000 + 50000, "EUR 100k = USD 108k, plus the confirmed USD deal; the company-only match isn't counted");
  assert.equal(rep.existingDealsWithAttendees, 25400);
  assert.equal(rep.currency, "USD");
  assert.deepEqual(rep.lowerConfidenceCompanyOnly.map((o) => o.amount), [999999, 77777]);

  const sum = await call("program_summary", {});
  assert.equal(sum.plannedUSD, 12700 + 5000, "the London city in USD plus the lone master; the series master with cities isn't added again");
  assert.equal(sum.spentUSD, 12700);
  assert.equal(sum.newPipelineFinishedUSD, 158000);
  assert.equal(sum.pipelinePerDollarFinished, +(158000 / 12700).toFixed(2), "per-dollar uses USD spend");

  const ev = await call("get_event", { id: "evC1" });
  assert.equal(ev.registered, 3, "Going + Attended guests + RSVPs saying going");
  const list = await call("list_events", {});
  assert.equal(list.find((e) => e.id === "evM").registered, 1);
});
