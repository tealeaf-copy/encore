import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readSse } from "./helpers.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

const j = (method, url, body) => fetch(srv.base + url, {
  method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test("doc CRUD", async () => {
  let r = await j("GET", "/api/db/doc?path=brands/main");
  assert.equal(r.body.exists, false);
  r = await j("PUT", "/api/db/doc?path=brands/main", { name: "Acme", colors: ["#fff"] });
  assert.equal(r.status, 200);
  r = await j("GET", "/api/db/doc?path=brands/main");
  assert.deepEqual(r.body.data, { name: "Acme", colors: ["#fff"] });
  r = await j("PATCH", "/api/db/doc?path=brands/main", { tagline: "hi" });
  assert.deepEqual(r.body.data, { name: "Acme", colors: ["#fff"], tagline: "hi" });
  r = await j("DELETE", "/api/db/doc?path=brands/main");
  assert.equal(r.body.deleted, true);
  r = await j("GET", "/api/db/doc?path=brands/main");
  assert.equal(r.body.exists, false);
  r = await j("PATCH", "/api/db/doc?path=brands/missing", { a: 1 });
  assert.equal(r.status, 404);
});

test("path validation", async () => {
  for (const bad of ["events", "a/b/c", "events/../x", "events/a b", "events/" + "x".repeat(201), ""]) {
    const r = await j("GET", "/api/db/doc?path=" + encodeURIComponent(bad));
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await j("GET", "/api/db/collection?path=events/x")).status, 400);
  assert.equal((await j("PUT", "/api/db/doc?path=events/x", [1, 2])).status, 400);
});

test("collection add and list", async () => {
  const a = await j("POST", "/api/db/collection?path=events", { name: "One" });
  const b = await j("POST", "/api/db/collection?path=events", { name: "Two" });
  assert.match(a.body.id, /^[A-Za-z0-9]{20}$/);
  const r = await j("GET", "/api/db/collection?path=events");
  const names = r.body.docs.map((d) => d.data.name).sort();
  assert.deepEqual(names, ["One", "Two"]);
  assert.ok(r.body.docs.some((d) => d.id === b.body.id));
});

test("events SSE fires on write", async () => {
  const ac = new AbortController();
  const res = await fetch(srv.base + "/api/db/events", { signal: ac.signal });
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const got = [];
  const reading = readSse(res, async (e) => {
    if (e.type === "ready") { await j("PUT", "/api/db/doc?path=canvas/main", { x: 1 }); return false; }
    got.push(e);
    return true;
  });
  await Promise.race([reading, new Promise((_, rej) => setTimeout(() => rej(new Error("no SSE event")), 3000))]);
  ac.abort();
  assert.deepEqual(got[0], { path: "canvas/main", parent: "canvas" });
});
