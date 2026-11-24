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

test("A gift plan gives each segment a job, an owner and a send decision, and shows how to prove it", async () => {
  const { samplePlan, cleanPlan } = await import("../server/giftplan.js");
  const p = samplePlan({ company: "Exa", moment: "We just launched Snapshot" });
  const champ = p.audience.segments.find((s) => /champion/i.test(s.who));
  assert.ok(champ.job && champ.kpi && /AE/.test(champ.owner) && champ.followUpBy && champ.send === "fewer" && champ.sendNote);
  assert.equal(p.playbook.prove.lines.length, 3); assert.ok(/holdout|hold back/i.test(p.playbook.prove.holdout)); assert.ok(p.playbook.prove.caveat);
  assert.ok(p.playbook.approvals.some((x) => /meeting is booked/i.test(x.gate))); assert.ok(p.playbook.sends.length === 2 && p.playbook.triggers.length >= 2);
  assert.ok(p.gifts.every((g) => g.delivery.shipBy && g.delivery.backup)); assert.ok(p.theme.searchFor && p.theme.doesForThem);
  // the budget table adds up to the total it states
  const n = (v) => +String(v).replace(/[^\d.]/g, ""); const sum = p.playbook.budgetLines.reduce((a, x) => a + n(x.total), 0);
  assert.ok(Math.abs(sum - n(p.playbook.budget.total.split(" for ")[0])) < 100, `${sum} vs ${p.playbook.budget.total}`);
  assert.ok(/\n\n/.test(p.playbook.message.email), "the email keeps its line breaks");
  // unknown send values fall back, and tags are stripped
  const c = cleanPlan({ audience: { segments: [{ who: "<b>Press</b>", send: "everyone!" }] } }); assert.equal(c.audience.segments[0].send, "all"); assert.equal(c.audience.segments[0].who, "Press");
});
