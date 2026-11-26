// Experiments (server/experiments.js): deterministic assignment, exposures and conversions logged once, no personal
// info in any row, one track() for a future PostHog sink, and an admin-only report.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { assign, cleanProps, track, expose, convert, report, addSink, clearSinks, useExperimentStore, experiments, unitHash } from "../server/experiments.js";
import { startServer } from "./helpers.js";

let srv;
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "xp-secret", ENCORE_SIGNUP_PER_HOUR: "100" }); srv = await startServer(); useExperimentStore(srv.store); });
after(async () => { clearSinks(); for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_ADMIN_EMAILS"]) delete process.env[k]; await srv.close(); });

test("The three real experiments are defined in the JSON file", () => {
  assert.deepEqual(Object.keys(experiments()).sort(), ["first-win-copy", "small-move-order", "streak-headsup-timing"]);
});

test("Assignment is deterministic by unit and key, and splits by weight", () => {
  for (const u of ["ws-abc", "anon-xyz123", "ws-9"]) assert.equal(assign("small-move-order", u), assign("small-move-order", u));
  const D = { t: { variants: { a: 50, b: 50 } }, w: { variants: { a: 90, b: 10 } }, off: { variants: { a: 0, b: 100 } } };
  const n = (k) => { let a = 0; for (let i = 0; i < 2000; i++) if (assign(k, "u" + i, D) === "a") a++; return a; };
  const half = n("t"); assert.ok(half > 880 && half < 1120, `about half: ${half}`);
  const ninety = n("w"); assert.ok(ninety > 1700 && ninety < 1900, `about 90%: ${ninety}`);
  assert.equal(n("off"), 0, "a zero weight is never picked");
  assert.equal(assign("nope", "u1", D), null);
  // the same unit can land differently in different experiments (keys are part of the hash)
  let differ = 0; for (let i = 0; i < 200; i++) if (assign("t", "u" + i, D) !== assign("w", "u" + i, D)) differ++; assert.ok(differ > 0);
});

test("No personal info in event rows: unknown keys, emails and free text are dropped; the unit is a salted hash", () => {
  const rows = []; addSink((r) => rows.push(r));
  const r = track("xp", { exp: "first-win-copy", variant: "plan", kind: "exposure", unit: "ws-123", email: "ana@example.com", name: "Ana Diaz", phone: "+14155550100", goal: "ana@example.com", step: "hello world" });
  assert.deepEqual(Object.keys(r).sort(), ["at", "exp", "kind", "name", "u", "variant"]);
  assert.equal(r.name, "xp"); assert.equal(r.u, unitHash("ws-123")); assert.notEqual(r.u, "ws-123");
  const text = JSON.stringify(rows); for (const bad of ["ana@example.com", "Ana", "4155550100", "ws-123", "hello"]) assert.ok(!text.includes(bad), bad);
  assert.equal(track("bad name!", {}), null);
  assert.deepEqual(cleanProps({ exp: "a b", variant: "x@y" }), {}, "spaces and @ never pass");
  clearSinks();
});

test("Exposure and conversion are logged once per unit, and conversion needs an exposure", () => {
  const before0 = report().find((e) => e.key === "small-move-order").variants.reduce((a, v) => a + v.exposures, 0);
  const v = expose("small-move-order", "ws-once"); expose("small-move-order", "ws-once"); expose("small-move-order", "ws-once");
  assert.ok(["context", "quickest"].includes(v));
  assert.equal(convert("small-move-order", "ws-never-seen"), false, "no exposure, no conversion");
  assert.equal(convert("small-move-order", "ws-once"), true); assert.equal(convert("small-move-order", "ws-once"), false, "once");
  const R = report().find((e) => e.key === "small-move-order"), mine = R.variants.find((x) => x.variant === v);
  assert.equal(R.variants.reduce((a, x) => a + x.exposures, 0) - before0, 1); assert.ok(mine.conversions >= 1); assert.ok(mine.rate > 0);
  const raw = srv.store.list("system/xp/events").map((d) => JSON.stringify(d.data)).join("\n"); assert.ok(!raw.includes("ws-once"), "rows carry the hash, not the id");
});

test("The public assignment endpoint is stable for a visitor id; /admin/experiments is admins only", async () => {
  const a = await (await fetch(srv.base + "/api/public/xp/first-win-copy?u=visitor123abc")).json(), b = await (await fetch(srv.base + "/api/public/xp/first-win-copy?u=visitor123abc")).json();
  assert.equal(a.variant, b.variant); assert.ok(["plan", "start"].includes(a.variant));
  assert.equal((await fetch(srv.base + "/api/public/xp/nope?u=visitor123abc")).status, 404);
  assert.equal((await fetch(srv.base + "/admin/experiments")).status, 404, "signed out: not found");
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ada Admin", email: "ada.xp@example.com", password: "long-password-1", mode: "friends" }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(srv.base + "/admin/experiments", { headers: { cookie } })).status, 404, "not an admin: not found");
  process.env.ENCORE_ADMIN_EMAILS = "ada.xp@example.com";
  const page = await fetch(srv.base + "/admin/experiments", { headers: { cookie } }); assert.equal(page.status, 200);
  const html = await page.text(); assert.match(html, /first-win-copy/); assert.match(html, /streak-headsup-timing/); assert.doesNotMatch(html, /visitor123abc/);
  const j = await (await fetch(srv.base + "/api/admin/experiments", { headers: { cookie } })).json(); assert.ok(j.experiments.find((e) => e.key === "first-win-copy").variants.some((v) => v.exposures >= 1));
});
