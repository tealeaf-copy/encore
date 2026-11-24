import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { cleanPlan, samplePlan, prompt } from "../server/giftplan.js";

test("A plan keeps only the shape we use, with safe links", () => {
  const p = cleanPlan({ company: "Exa", moment: { title: "Snapshot", sources: [{ title: "x", url: "javascript:alert(1)" }, { title: "Launch post", url: "https://exa.ai/blog/snapshot" }] }, gifts: [{ name: "Polaroid <b>kit</b>", perPerson: "$110", extra: "drop me" }], evil: 1 });
  assert.deepEqual(p.moment.sources.map((s) => s.url), ["https://exa.ai/blog/snapshot"]); assert.equal(p.gifts[0].name, "Polaroid kit"); assert.ok(!("evil" in p)); assert.ok(!("extra" in p.gifts[0]));
});
test("The brief asks Potto to tie gifts to the story and to research the launch", () => {
  const t = prompt({ company: "Exa", moment: "launched Snapshot", website: "exa.ai" });
  assert.match(t, /web search/i); assert.match(t, /Snapshot/); assert.match(t, /Polaroid/);
  assert.match(samplePlan({ company: "Exa", moment: "launched Snapshot" }).gifts[0].name, /camera/i, "the offline example follows the theme");
});

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });
test("Anyone can ask for a plan; it comes back with gifts, makers and a playbook at a shareable link", async () => {
  const bad = await fetch(srv.base + "/api/public/giftplan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: "E" }) }); assert.equal(bad.status, 400);
  const r = await (await fetch(srv.base + "/api/public/giftplan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: "Exa", moment: "We just launched Snapshot", people: "150" }) })).json();
  let d; for (let i = 0; i < 30; i++) { d = await (await fetch(srv.base + "/api/public/giftplan/" + r.id)).json(); if (d.status !== "working") break; await new Promise((x) => setTimeout(x, 200)); }
  assert.equal(d.status, "ready"); assert.ok(d.plan.gifts.length >= 3); assert.ok(d.plan.playbook.timeline.length >= 3); assert.ok(Array.isArray(d.plan.gifts[0].makers));
  assert.equal((await fetch(srv.base + "/api/public/giftplan/ffffffffffffffff")).status, 404);
  assert.equal((await fetch(srv.base + "/gifts/plan/" + r.id)).status, 200);
});
