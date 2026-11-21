import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { computeTaskStatuses } from "../server/pm.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

test("computeTaskStatuses with a fixed now", () => {
  const data = {
    date: "2026-12-10",
    produce: { tasks: [
      { task: "Book venue", owner: "Ana", days: -30 },   // due Nov 10 -> done
      { task: "Order swag", owner: "Ben", days: -25 },   // due Nov 15 -> overdue
      { task: "Print menus", owner: "Cy", days: -19 },   // due Nov 21 noon -> soon (0 days)
      { task: "Confirm AV", owner: "Di", days: -17 },    // due Nov 23 -> soon
      { task: "Guest list", owner: "Ed", days: -10 },    // due Nov 30 -> later
      { task: "Catering", owner: "Fa", days: -40 },      // blocked beats overdue
    ] },
    tasksDone: [0],
    blocked: { 5: "Waiting on budget" },
  };
  const now = new Date("2026-11-21T09:00:00").getTime();
  const st = computeTaskStatuses(data, now).map((t) => t.st);
  assert.deepEqual(st, ["done", "overdue", "soon", "soon", "later", "blocked"]);
  const t = computeTaskStatuses(data, now)[1];
  assert.equal(t.days, -5); // due Nov 15 noon, now Nov 21 9am: ceil(-5.875) = -5
  assert.equal(t.due, new Date(new Date("2026-12-10T12:00:00").getTime() - 25 * 864e5).toISOString().slice(0, 10));
});

test("pm run writes a report and skips done events", async () => {
  const { store } = srv;
  store.set("events/e1", { name: "Dinner", date: "2026-12-10", status: "planning", produce: { tasks: [{ task: "Order swag", owner: "Ben", days: -25 }] }, tasksDone: [] });
  store.set("events/e2", { name: "Old", date: "2026-01-10", status: "done", produce: { tasks: [{ task: "x", owner: "y", days: 0 }] } });
  const r = await fetch(srv.base + "/api/pm/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ now: new Date("2026-11-21T09:00:00").getTime() }) });
  const s = await r.json();
  assert.equal(s.events, 1);
  assert.equal(s.flaggedEvents, 1);
  const e1 = store.get("events/e1").data;
  assert.ok(e1.pmReport.nudges.length >= 1);
  assert.equal(e1.pmReport.nudges[0].posted, false);
  assert.ok(e1.pmRanAt > 0);
  assert.equal(store.get("events/e2").data.pmReport, undefined);
});

test("/api/mcp/tools lists only Parallel Search in fake mode", async () => {
  const r = await (await fetch(srv.base + "/api/mcp/tools")).json();
  assert.deepEqual(r.servers.map((s) => s.server), ["Parallel Search"]);
  assert.deepEqual(r.servers[0].tools.map((t) => t.name), ["web_search", "web_fetch"]);
  assert.equal(r.servers[0].authStatus, "connected");
});

test("mcp call works for Parallel Search and rejects unconfigured servers", async () => {
  const call = (server, tool, input) => fetch(srv.base + "/api/mcp/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server, tool, input }) });
  let r = await call("Parallel Search", "web_search", { query: "chicago supper clubs" });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.content[0].type, "text");
  assert.match(body.payload, /chicago supper clubs/);
  for (const sv of ["Slack", "Linear", "Gmail"]) {
    r = await call(sv, "x", {});
    assert.equal(r.status, 404);
    assert.equal((await r.json()).code, "server_not_connected");
  }
});

test("health reports fake mode", async () => {
  const r = await (await fetch(srv.base + "/api/health")).json();
  assert.equal(r.ok, true);
  assert.equal(r.ai, "fake");
  assert.deepEqual(r.integrations, ["Parallel Search"]);
});

test("password gate and guest exemptions", async () => {
  process.env.APP_PASSWORD = "s3cret";
  try {
    assert.equal((await fetch(srv.base + "/api/db/collection?path=events")).status, 401);
    const g = { "x-encore-guest": "1", "Content-Type": "application/json" };
    assert.equal((await fetch(srv.base + "/api/db/doc?path=events/e1", { headers: g })).status, 200);
    assert.equal((await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: g, body: "{}" })).status, 403, "guest RSVPs need a key");
    assert.equal((await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...g, "x-encore-key": "k0" }, body: "{}" })).status, 200);
    assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/e1--u1", { method: "PUT", headers: g, body: "{}" })).status, 403, "guest writes need a key");
    assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/e1--u1", { method: "PUT", headers: { ...g, "x-encore-key": "k1" }, body: "{}" })).status, 200);
    assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/e1--u1", { method: "PATCH", headers: { ...g, "x-encore-key": "k1" }, body: JSON.stringify({ response: "no" }) })).status, 200, "the same guest can change it");
    assert.equal((await fetch(srv.base + "/api/db/doc?path=rsvps/e1--u1", { method: "PUT", headers: { ...g, "x-encore-key": "other" }, body: "{}" })).status, 403, "another guest can't overwrite it");
    assert.equal((await fetch(srv.base + "/api/db/doc?path=events/e1", { method: "PUT", headers: g, body: "{}" })).status, 401);
    assert.equal((await fetch(srv.base + "/api/db/collection?path=events", { headers: g })).status, 401);
    const home = await (await fetch(srv.base + "/")).text();
    assert.match(home, /Team password/);
    const login = await fetch(srv.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "s3cret" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(srv.base + "/api/db/collection?path=events", { headers: { cookie } })).status, 200);
    const bad = await fetch(srv.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
    assert.equal(bad.status, 401);
  } finally { delete process.env.APP_PASSWORD; }
});

test("GET / wraps index.html with the shim", async () => {
  const html = await (await fetch(srv.base + "/")).text();
  assert.ok(html.startsWith('<!doctype html><html><head><meta charset="utf-8">'));
  assert.match(html, /<script src="\/shim.js"><\/script><\/head><body><title>/);
  assert.ok(html.endsWith("</body></html>"));
  const shim = await fetch(srv.base + "/shim.js");
  assert.equal(shim.status, 200);
});

test("assets upload, serve, list, delete", async () => {
  const up = await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from([1, 2, 3]) })).json();
  assert.equal(up.sizeBytes, 3);
  assert.equal(up.url, "/_blob/" + up.id);
  const blob = await fetch(srv.base + up.url);
  assert.equal(blob.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  const list = await (await fetch(srv.base + "/api/assets")).json();
  assert.ok(list.assets.some((a) => a.id === up.id));
  await fetch(srv.base + "/api/assets/" + up.id, { method: "DELETE" });
  assert.equal((await fetch(srv.base + up.url)).status, 404);
});
