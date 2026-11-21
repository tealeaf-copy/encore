import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, readSse } from "./helpers.js";
import { parseJsonLoose } from "../server/ai.js";

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

const ai = (body) => fetch(srv.base + "/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("/api/ai streams text and completes with done", async () => {
  const res = await ai({ input: "Plan a dinner. Reply with only JSON: {\"ok\":boolean}", modelTier: "quick" });
  assert.equal(res.status, 200);
  let text = "", done = null;
  await readSse(res, (e) => {
    if (e.type === "text") text += e.delta;
    if (e.type === "done") { done = e; return true; }
    if (e.type === "error") throw new Error(e.message);
  });
  assert.ok(done);
  assert.equal(done.text, text);
  assert.deepEqual(JSON.parse(done.text), { ok: true });
});

test("/api/ai tool_call round trip", async () => {
  const res = await ai({
    input: [{ role: "user", content: "Look something up" }],
    tools: [{ name: "search_web", description: "search", inputSchema: { type: "object", properties: { q: { type: "string" } } } }],
  });
  let runId, call, done;
  await readSse(res, async (e) => {
    if (e.type === "run") runId = e.runId;
    if (e.type === "tool_call") {
      call = e;
      const r = await fetch(`${srv.base}/api/ai/${runId}/tool-result`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, content: "result text", is_error: false }),
      });
      assert.equal(r.status, 200);
    }
    if (e.type === "done") { done = e; return true; }
  });
  assert.equal(call.name, "search_web");
  assert.deepEqual(call.input, {});
  assert.ok(done.text.length > 0);
});

test("/api/ai rejects bad input with an error event", async () => {
  const res = await ai({ input: [{ role: "assistant", content: "hi" }] });
  let err;
  await readSse(res, (e) => { if (e.type === "error") { err = e; return true; } });
  assert.equal(err.code, "invalid_input");
});

test("unknown tool-result id is a 404", async () => {
  const r = await fetch(`${srv.base}/api/ai/nope/tool-result`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "x", content: "" }) });
  assert.equal(r.status, 404);
});

test("parseJsonLoose tolerates fences and prose", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseJsonLoose('Here you go {"a":[3]} thanks'), { a: [3] });
  assert.throws(() => parseJsonLoose("nope"), (e) => e.code === "invalid_json");
});
