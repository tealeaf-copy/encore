import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv;
before(async () => { process.env.ENCORE_MCP_TOKEN = "mcp-test-token-0123456789abcdef0123456789"; srv = await startServer(); });
after(async () => { delete process.env.ENCORE_MCP_TOKEN; await srv.close(); });

let n = 0;
const rpc = (method, params, token = "mcp-test-token-0123456789abcdef0123456789") => fetch(srv.base + "/mcp", {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); const t = r.body.result.content[0].text; let data = t; try { data = JSON.parse(t); } catch {} return { ...r.body.result, data }; };

test("Encore works as an MCP server from Claude", async () => {
  assert.equal((await rpc("tools/list", {}, "")).status, 401);
  assert.equal((await rpc("tools/list", {}, "wrong-token")).status, 401);
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.body.result.serverInfo.name, "encore");
  const tools = (await rpc("tools/list", {})).body.result.tools.map((t) => t.name);
  assert.deepEqual(tools, ["list_events", "get_event", "create_event", "update_event", "add_guests", "guest_list", "followups_due", "pipeline_report", "launch_kit", "program_summary"]);

  const made = await call("create_event", { name: "Creator Kitchen", kind: "dinner", city: "Chicago", date: "2027-02-18", headcount: 20, budget: 18000 });
  const id = made.data.id;
  assert.ok(id);
  assert.equal((await call("add_guests", { id, guests: [{ name: "Ana Diaz", company: "Acme", owner: "Sam" }, { name: "Ana Diaz", company: "Acme" }, { name: "Bo Chan", company: "Beta", owner: "Kim" }] })).data.added, 2);
  const list = await call("list_events", {});
  assert.equal(list.data[0].plannedCostUSD, 18000);
  const ev = await call("get_event", { id });
  assert.equal(ev.data.guests["Not invited"], 2);
  assert.ok(ev.data.missing.includes("venue"));
  assert.equal((await call("update_event", { id, date: "tomorrow" })).isError, true);
  assert.equal((await call("update_event", { id, headcount: 24, status: "live" })).data.seats, 24);
  assert.equal((await call("pipeline_report", { id })).data.deals, 0);
  assert.equal((await call("launch_kit", { id })).data.title, "Creator Kitchen");
  assert.equal((await call("program_summary", {})).data.plannedUSD, 18000);
  assert.equal((await call("get_event", { id: "../../etc" })).isError, true);
  const stored = srv.store.get("events/" + id).data;
  assert.equal(stored.createdVia, "Claude");
  assert.equal(stored.guests[0].source, "Added from Claude");
});

test("MCP is off without a token", async () => {
  const t = process.env.ENCORE_MCP_TOKEN; delete process.env.ENCORE_MCP_TOKEN;
  try { assert.equal((await rpc("tools/list", {})).status, 404); } finally { process.env.ENCORE_MCP_TOKEN = t; }
});

test("per-person MCP tokens, audited writes", async () => {
  process.env.ENCORE_MCP_TOKENS = "Maya Chen|maya@acme.com|maya-token-0123456789abcdef0123456789,Sam Lee|sam@acme.com|sam-token-0123456789abcdef0123456789";
  try {
    const asMaya = (name, args) => rpc("tools/call", { name, arguments: args }, "maya-token-0123456789abcdef0123456789").then((r) => JSON.parse(r.body.result.content[0].text));
    assert.equal((await rpc("tools/list", {}, "maya-token-0123456789abcdef0123456789")).status, 200);
    assert.equal((await rpc("tools/list", {}, "nobody-token-0123456789abcdef0123456789")).status, 401);
    const made = await asMaya("create_event", { name: "Audited", date: "2027-03-01" });
    assert.match(made.id, /^[A-Za-z0-9]{20}$/, "event ids are random");
    await asMaya("update_event", { id: made.id, city: "Austin" });
    await asMaya("add_guests", { id: made.id, guests: [{ name: "Ana" }] });
    await call("update_event", { id: made.id, city: "Dallas" }); // shared token
    const log = srv.store.list("audit").map((d) => d.data).filter((e) => e.eventId === made.id).sort((a, b) => a.at - b.at);
    assert.equal(log.length, 4);
    assert.deepEqual(log.slice(0, 3).map((e) => [e.who, e.email, e.verified, e.via]), Array(3).fill(["Maya Chen", "maya@acme.com", true, "MCP"]));
    assert.match(log[0].what, /created from Claude/);
    assert.match(log[1].what, /updated from Claude \(city\)/);
    assert.match(log[2].what, /added 1 guest from Claude/);
    assert.equal(log[3].who, "Claude (shared MCP token)");
    assert.equal(log[3].verified, false);
    await asMaya("get_event", { id: made.id });
    const reads = srv.store.list("audit").map((d) => d.data).filter((e) => e.kind === "read" && e.eventId === made.id);
    assert.deepEqual(reads.map((e) => [e.what, e.who, e.via]), [["read get_event", "Maya Chen", "MCP"]], "reads are logged, lightly");
  } finally { delete process.env.ENCORE_MCP_TOKENS; }
});

test("MCP validates input instead of guessing", async () => {
  const bad = async (name, args, re) => { const r = await call(name, args); assert.equal(r.isError, true, JSON.stringify(args)); assert.match(r.data, re); };
  await bad("create_event", { name: "X", date: "2027-02-30" }, /real date/);
  await bad("create_event", { name: "X", date: "2027-13-01" }, /real date/);
  await bad("create_event", { name: "X", currency: "XYZ" }, /currency must be one of USD, EUR/);
  await bad("create_event", { name: "X", headcount: -5 }, /headcount/);
  await bad("create_event", { name: "X", budget: "lots" }, /budget/);
  await bad("create_event", {}, /name is required/);
  const { data: ev } = await call("create_event", { name: "Valid", date: "2028-02-29", currency: "eur", budget: 1000 });
  assert.equal(ev.currency, "EUR");
  await bad("update_event", { id: ev.id, date: "2027-02-29" }, /real date/);
  await bad("update_event", { id: ev.id, headcount: -1 }, /headcount/);
  await bad("update_event", { id: ev.id, currency: "BTC" }, /currency/);
  await bad("update_event", { id: ev.id, status: "cancelled" }, /status/);
  assert.equal(srv.store.get("events/" + ev.id).data.date, "2028-02-29", "a refused update changes nothing");
});

test("update_event budget scales the plan's budget lines", async () => {
  const { data: ev } = await call("create_event", { name: "Lines", budget: 0 });
  const e = srv.store.get("events/" + ev.id).data;
  srv.store.set("events/" + ev.id, { ...e, produce: { budget: [{ line: "Venue", amount: 6000 }, { line: "Food", amount: 3000 }, { line: "Photo", amount: 1000 }] } });
  const r = await call("update_event", { id: ev.id, budget: 15001 });
  assert.equal(r.data.plannedCost, 15001, "the planned cost really changes");
  assert.match(r.data.notes[0], /Scaled 3 budget lines from 10,000 to 15,001/);
  const lines = srv.store.get("events/" + ev.id).data.produce.budget;
  assert.equal(lines.reduce((a, b) => a + b.amount, 0), 15001);
  assert.deepEqual(lines.map((b) => b.line), ["Venue", "Food", "Photo"]);
  assert.equal(lines[1].amount, 4500);
  srv.store.set("events/" + ev.id, { ...srv.store.get("events/" + ev.id).data, produce: { budget: [{ line: "TBD", amount: 0 }] } });
  const z = await call("update_event", { id: ev.id, budget: 500 });
  assert.equal(z.isError, true, "can't scale all-zero lines: say so instead of a silent success");
});

test("add_guests reads CRM-style fields", async () => {
  const { data: ev } = await call("create_event", { name: "Guests" });
  const r = await call("add_guests", { id: ev.id, guests: [
    { firstName: "Ana", lastName: "Diaz", company: "Acme", arr: "120k", renewalDate: "2027-06-30", health: "Green", tier: "Enterprise" },
    { name: "Bo Chan", company: "Beta", arr: "$1.2M", tier: "Mid-market" },
    { name: "Cy Ng", arr: 5000, tier: "SMB" },
    { name: "Di Ho", tier: "a" },
    { name: "Ed Fox", arr: "a lot" },
    { name: "Fa Li", renewalDate: "June" },
  ] });
  assert.equal(r.data.added, 4);
  assert.equal(r.data.skipped.length, 2);
  const g = srv.store.get("events/" + ev.id).data.guests;
  assert.deepEqual(g.map((x) => [x.name, x.tier, x.arr ?? null]), [["Ana Diaz", "A", 120000], ["Bo Chan", "B", 1200000], ["Cy Ng", "C", 5000], ["Di Ho", "A", null]]);
  assert.equal(g[0].renewalDate, "2027-06-30");
  assert.equal(g[0].health, "Green");
});

test("MCP accepts JSON-RPC batches", async () => {
  const r = await fetch(srv.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer mcp-test-token-0123456789abcdef0123456789" },
    body: JSON.stringify([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "tools/list" }, { jsonrpc: "2.0", id: "c", method: "nope" }]) });
  const out = await r.json();
  assert.deepEqual(out.map((x) => x.id), ["a", "b", "c"]);
  assert.ok(out[1].result.tools.length);
  assert.equal(out[2].error.code, -32601);
  const n = await fetch(srv.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer mcp-test-token-0123456789abcdef0123456789" }, body: JSON.stringify([{ jsonrpc: "2.0", method: "notifications/initialized" }]) });
  assert.equal(n.status, 202);
});
