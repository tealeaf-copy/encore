import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let srv;
before(async () => { process.env.ENCORE_MCP_TOKEN = "mcp-test-token"; srv = await startServer(); });
after(async () => { delete process.env.ENCORE_MCP_TOKEN; await srv.close(); });

let n = 0;
const rpc = (method, params, token = "mcp-test-token") => fetch(srv.base + "/mcp", {
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
