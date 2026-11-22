import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { buildEstimateScript } from "../server/estimate.js";

test("the homepage planner is the app's own planner, and it runs on its own", () => {
  const js = buildEstimateScript(path.resolve("index.html"));
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(js, ctx);
  const P = (t) => ctx.window.EncorePlan.planFromText(t);
  const dinner = P("A dinner for 14 CFOs in New York, about $28k");
  assert.equal(dinner.d.kind, "dinner"); assert.equal(dinner.d.headcount, 14); assert.ok(dinner.total > 5000 && dinner.total < 28000);
  const cab = P("Customer advisory board for 12 CMOs in San Francisco, about $40k");
  assert.ok(cab.rows.some((r) => /member travel/i.test(r.line)), "advisory boards include member travel");
  const eur = P("A hack night for 40 platform engineers in Berlin, about €8k");
  assert.equal(eur.d.currency, "EUR"); assert.ok(eur.total <= 8000);
  const tight = P("A dinner for 20 CFOs in Chicago, about $10k");
  assert.ok(tight.total <= 10200 && tight.trims.length > 0, "over-budget plans are trimmed and say so");
  const road = P("A breakfast roadshow for VPs of Finance in New York, Chicago and Boston, about $60k");
  assert.equal(road.cities.length, 3);
});
