// Brand Insights (server/insights.js): k-anonymity, opt in (and out), no personal data in what brands get or in the
// summary prompt, fit ranking, and brand-only access. The world is invented (test/brand-intel-seed.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedBrandIntel } from "./brand-intel-seed.js";
import { K, breakdown, visible, band, trends, fit, parseAudience, matchesAudience, summaryPrompt, rulesSummary, kindOf, prefsOf, prefKey } from "../server/insights.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "insights-secret-0123456789", ENCORE_SIGNUP_PER_HOUR: "1000", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_INSIGHTS_CACHE_MS: "0" };
const J = { "content-type": "application/json" };
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const ok = async (r) => { const t = await r.text(); assert.ok(r.ok, `${r.status} ${t}`); return JSON.parse(t); };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedBrandIntel(srv.base, srv.store); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

// a fact with n people (ids) at one host
let seq = 0;
const fact = (o = {}) => ({ id: "e" + ++seq, hostWs: o.host || "h1", kind: o.kind || "supper", city: "New York", cityKey: "new york", hood: o.hood || "Greenpoint", days: o.days || "weekday", time: "evening", size: "medium", price: "p60", priceCents: o.price ?? 6000, season: "fall", capacity: 12, going: 10,
  people: o.people || [], yes: o.yes || [], ans: o.ans || [], kudos: (o.ans || []).length });
const ppl = (from, n) => Array.from({ length: n }, (_, i) => "g" + (from + i));

test("k-anonymity: a cell shows only with 10+ people and 3+ events, people come in bands", () => {
  assert.equal(K.people, 10); assert.equal(K.events, 3);
  assert.equal(visible({ people: 9, events: 5 }), false, "nine people is not enough");
  assert.equal(visible({ people: 40, events: 2 }), false, "two events is not enough, however many people");
  assert.equal(visible({ people: 10, events: 3 }), true);
  assert.equal(band(9), ""); assert.equal(band(10), "10+"); assert.equal(band(47), "40+"); assert.equal(band(130), "100+"); assert.equal(band(260), "250+");
  // three events with 4 people each = 12 people: shown. Two events with 20 each: hidden.
  const F = [fact({ kind: "games", people: ppl(0, 4) }), fact({ kind: "games", people: ppl(4, 4) }), fact({ kind: "games", people: ppl(8, 4) }),
    fact({ kind: "run", people: ppl(20, 20) }), fact({ kind: "run", people: ppl(40, 20) }),
    fact({ kind: "supper", people: ppl(60, 5) }), fact({ kind: "supper", people: ppl(60, 5) }), fact({ kind: "supper", people: ppl(60, 5) })];
  const rows = Object.fromEntries(breakdown(F, "kind").map((r) => [r.value, r]));
  assert.equal(rows.run.hidden, true, "2 events");
  assert.equal(rows.supper.hidden, true, "the same 5 people three times are 5 people, not 15");
  assert.ok(!rows.run.events && !rows.run.peopleBand && rows.run.againPct === undefined, "a hidden cell carries no numbers");
  assert.equal(rows.games.hidden, undefined, "12 people over 3 events shows (two other cells are hidden, so no subtraction can single one out)");
  assert.equal(rows.games.peopleBand, "10+");
});

test("k-anonymity: would go again needs 10+ answers, and one hidden cell hides its smallest neighbour", () => {
  const big = (k, from, ans, n = 10) => [0, 1, 2].map((i) => fact({ kind: k, people: ppl(from + i * n, n), ans: ppl(from + i * n, ans), yes: ppl(from + i * n, ans) }));
  const F = [...big("games", 0, 4, 14), ...big("supper", 100, 1), ...big("tasting", 200, 2), fact({ kind: "run", people: ppl(400, 3) })];
  const R = Object.fromEntries(breakdown(F, "kind").map((r) => [r.value, r]));
  assert.equal(R.games.againPct, 100, "12 answers: shown");
  assert.equal(R.run.hidden, true);
  // run is the one hidden cell: the smallest shown one (supper or tasting, 30 people, fewest answers) is hidden too
  const hidden = Object.values(R).filter((r) => r.hidden).map((r) => r.value);
  assert.equal(hidden.length, 2, JSON.stringify(R)); assert.ok(Object.values(R).some((r) => r.hidden && /stays private/.test(r.why)));
  // supper has 3 answers: would go again stays blank even though the cell shows
  const shownSupper = R.supper.hidden ? null : R.supper; if (shownSupper) assert.equal(shownSupper.againPct, null);
});

test("opt in: guests are left out by default, and turning it on or off changes the totals", async () => {
  // default for someone who never chose: not included
  assert.deepEqual(prefsOf(srv.store, "never-chose@example.com"), { include: false, work: [], at: null });
  const t0 = await ok(await get("/api/insights/trends?city=San%20Francisco", S.owner.c));
  // every San Francisco guest turns it off: nothing in San Francisco can show
  for (const p of S.people.filter((x) => x.city === "San Francisco")) srv.store.set(prefKey(p.email), { kind: "plinsight", include: false, work: p.work, at: Date.now() });
  const t1 = await ok(await get("/api/insights/trends?city=San%20Francisco", S.owner.c));
  assert.equal(t0.overall.shown, true); assert.equal(t1.overall.shown, false, "no one opted in, so nothing shows");
  assert.ok(t1.kinds.every((k) => k.hidden), JSON.stringify(t1.kinds));
  // a person turns it on and off through their own settings
  const me = (await (await post("/api/signup", { name: "Opal Reyes", email: "opal@guests.example", password: "long-password-1", mode: "friends" })).headers.get("set-cookie")).split(";")[0];
  assert.equal((await ok(await get("/api/me/insights", me))).include, false, "off until they choose");
  assert.equal((await ok(await post("/api/me/insights", { include: true, work: ["design", "leader", "nonsense"] }, me))).include, true);
  assert.deepEqual(prefsOf(srv.store, "opal@guests.example").work, ["design", "leader"]);
  assert.equal((await ok(await post("/api/me/insights", { include: false }, me))).include, false);
  // the settings page says it plainly
  const html = await (await get("/settings")).text(); assert.match(html, /Don't include my activity in brand insights/); assert.match(html, /How insights work/);
  for (const p of S.people.filter((x) => x.city === "San Francisco")) srv.store.set(prefKey(p.email), { kind: "plinsight", include: p.include, work: p.work, at: Date.now() });
});

test("opt out: an opted-out guest is not in the people, the answers or the attributes behind a total", async () => {
  const { collectFacts } = await import("../server/insights.js");
  const ws = S.hosts[0].ws, ems = Array.from({ length: 12 }, (_, i) => `opt${i}@guests.example`);
  ems.forEach((e, i) => srv.store.set(prefKey(e), { kind: "plinsight", include: i !== 0, work: ["design"], at: Date.now() }));
  const X = { index: () => ({ events: new Map([["ex1", { id: "ex1", ws, e: { date: "2026-01-10", name: "Supper club", activity: "supper club", headcount: 12, city: "New York" } }]]), att: new Map(ems.map((e) => [e, [{ eventId: "ex1" }]])), kudos: ems.map((e) => ({ eventId: "ex1", email: e, tags: ["again"] })) }) };
  const C = { profileOf: () => ({ handle: "long-table", city: "New York" }) };
  const { facts, guests } = collectFacts({ store: srv.store, X, C });
  assert.equal(facts.length, 1); const f = facts[0];
  assert.equal(f.people.length, 11, "the opted-out guest isn't counted"); assert.equal(f.ans.length, 11); assert.equal(f.yes.length, 11); assert.equal(guests.size, 11);
  assert.equal(f.going, 12, "fill rate uses the public headcount, which reads no one's reply");
  assert.ok(!JSON.stringify(facts).includes("@"), "facts hold salted keys, not emails");
});

test("no personal data: trends, fit, results and the summary carry no guest names, emails or keys", async () => {
  const bodies = [await (await get("/api/insights/trends", S.owner.c)).text(), await (await get("/api/insights/trends?city=New%20York&cut=hood", S.owner.c)).text(),
    await (await post("/api/insights/fit", { tags: ["Engineers", "Coffee lovers"], city: "New York", budget: 100 }, S.owner.c)).text(), await (await get("/api/campaigns/results", S.owner.c)).text()];
  const sum = await ok(await post("/api/insights/summary", { tags: ["Engineers"], city: "New York", budget: 120 }, S.owner.c)); bodies.push(JSON.stringify(sum));
  for (const b of bodies) { assert.doesNotMatch(b, /@/, "no emails"); assert.doesNotMatch(b, /guest\d+/); assert.doesNotMatch(b, /"people":\s*\[/, "no lists of people"); assert.doesNotMatch(b, /"(yes|ans)":\s*\[/);
    for (const p of S.people.slice(0, 60)) assert.ok(!b.includes(p.name), `no guest name (${p.name})`); }
  // the prompt the summary would send: totals only
  const prompt = (await import("../server/insights.js")).summaryPrompt((await ok(await post("/api/insights/fit", { tags: ["Engineers"], city: "New York", budget: 120 }, S.owner.c))));
  assert.doesNotMatch(prompt, /@|guest\d|g[0-9a-f]{16}/); for (const h of S.hosts) assert.ok(!prompt.includes(h.person) && !prompt.includes(h.handle), "no host names either");
  for (const p of S.people) assert.ok(!prompt.includes(p.name));
  assert.match(prompt, /aggregate numbers only/); assert.match(sum.text, /game nights|supper clubs|workshops|tastings/i); assert.doesNotMatch(sum.text, /\u2014/);
});

test("fit ranking: the kind your buyers go to most, and would go again to, comes first", () => {
  const guests = new Map(); for (let i = 0; i < 60; i++) guests.set("g" + i, { work: i < 30 ? ["engineering"] : ["marketing"], interests: i % 2 ? ["coffee"] : [] });
  const F = []; for (let e = 0; e < 4; e++) { F.push(fact({ kind: "games", host: "hg", people: ppl(0, 20), ans: ppl(0, 15), yes: ppl(0, 14), price: 3000 })); F.push(fact({ kind: "tasting", host: "ht", people: ppl(30, 20), ans: ppl(30, 15), yes: ppl(30, 10), price: 9000 })); F.push(fact({ kind: "supper", host: "hs", people: [...ppl(10, 10), ...ppl(40, 10)], ans: ppl(10, 12), yes: ppl(10, 10), price: 6500 })); }
  const eng = fit(F, { tags: ["Engineers"], guests, budgetCents: 8000 });
  assert.equal(eng.kinds[0].kind, "games", JSON.stringify(eng.kinds.map((k) => [k.kind, k.score])));
  assert.ok(eng.kinds[0].liftX > 1.3); assert.match(eng.kinds[0].why[0], /Engineers go to game nights \d\.\dx as often/);
  const mk = fit(F, { tags: ["Marketing leaders"], guests });
  assert.equal(mk.audience.enough, false, "no one said they lead a team, so not enough");
  const mk2 = fit(F, { tags: ["Marketers"], guests }); assert.equal(mk2.kinds[0].kind, "tasting");
  // a budget under the price pulls a kind down
  const cheap = fit(F, { tags: ["Marketers"], guests, budgetCents: 4000 }); assert.ok(cheap.kinds.find((k) => k.kind === "tasting").score < mk2.kinds.find((k) => k.kind === "tasting").score);
  assert.ok(cheap.kinds.find((k) => k.kind === "tasting").why.some((w) => /cost more than \$40/.test(w)));
  // "design leaders" needs both; "coffee lovers" is an interest
  const A = parseAudience(["Design leaders", "Coffee lovers", "Llama wranglers"]);
  assert.deepEqual(A.unknown, ["Llama wranglers"]);
  assert.equal(matchesAudience({ work: ["design"] }, parseAudience(["Design leaders"])), false);
  assert.equal(matchesAudience({ work: ["design", "leader"] }, parseAudience(["Design leaders"])), true);
  assert.equal(matchesAudience({ interests: ["coffee"] }, A), true);
  assert.equal(kindOf({ name: "Dice and Dumplings: Game night with dumplings", activity: "game night" }), "games");
  assert.equal(kindOf({ name: "Coffee cupping morning" }), "coffee");
  assert.match(rulesSummary(eng), /^Start with game nights/);
});

test("fit over HTTP: engineers in New York rank game nights first, with hosts who fit", async () => {
  const F = await ok(await post("/api/insights/fit", { tags: ["Engineers"], city: "New York", budget: 120 }, S.owner.c));
  assert.equal(F.kinds[0].kind, "games", JSON.stringify(F.kinds.map((k) => [k.kind, k.score])));
  assert.ok(F.hosts.length >= 3 && F.hosts.every((h) => h.city === "New York")); assert.equal(F.hosts[0].handle, "dice-and-dumplings");
  assert.ok(F.hosts.every((h) => !h.stats || /\+$/.test(h.stats.peopleBand)));
});

test("Insights are for brand teams only, and the explainer is public", async () => {
  assert.equal((await get("/api/insights/trends")).status, 401);
  assert.equal((await get("/api/insights/trends", S.hosts[0].c)).status, 403, "a host's personal workspace isn't a brand");
  assert.equal((await get("/teams/insights/how")).status, 200);
  const how = await (await get("/teams/insights/how")).text();
  assert.match(how, /at least 10 different people and 3 different events/); assert.match(how, /Nothing to download or sell/); assert.doesNotMatch(how, /\u2014/);
});

test("trends: cuts by weekday, time, size, price, season and neighbourhood all respect the thresholds", () => {
  const F = []; for (let i = 0; i < 6; i++) F.push(fact({ kind: "games", days: i < 4 ? "weekday" : "weekend", hood: i < 5 ? "Greenpoint" : "Astoria", people: ppl(i * 5, 5) }));
  const T = trends(F, { cut: "days" }); const by = Object.fromEntries(T.cut.rows.map((r) => [r.value, r]));
  assert.equal(by.weekday.hidden, true, "weekend is hidden (2 events) so weekday hides too: the total would give it away");
  assert.equal(by.weekend.hidden, true);
  const H = trends(F, { cut: "hood" }); assert.ok(H.cut.rows.every((r) => r.hidden));
  assert.equal(T.overall.shown, true, "30 people over 6 events");
});
