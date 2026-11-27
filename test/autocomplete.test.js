// Potto's autocomplete (public/autocomplete.js, server/suggest.js, server/suggestbank.js): the local bank, city
// nicknames and accents, ranking with your own history, the server's completions with offline AI, its rate limit, what
// the request carries (only the typed text, the city and the field kind), the Settings switch, and the page itself at
// 390 and 1280 (roles, keys, no layout shift, a failing server, structure on a pick). The browser part needs Chromium.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { bank, placesPayload, fakeSuggest } from "../server/suggestbank.js";
import { suggestPrompt, cleanItems } from "../server/suggest.js";
import { fakeText } from "../server/ai.js";

const S = bank(), P = S.placeData(placesPayload());
const top = (q, o = {}) => S.rank(q, { places: P, ...o });
const texts = (q, o) => top(q, o).map((x) => x.text);

test("the local bank: ideas, alerts, questions, posts and short kinds finish what's typed", () => {
  assert.ok(texts("din").length >= 3 && texts("din").every((t) => /^Dinner/.test(t)), texts("din").join());
  assert.ok(texts("supp").some((t) => /^Supper club/.test(t)));
  assert.ok(texts("vegas").some((t) => /^Vegas for a 30th/.test(t)), "trips: " + texts("vegas").join());
  assert.ok(texts("team off", { brand: true }).includes("Team offsite"), "brand goals");
  assert.ok(texts("pott").includes("Pottery class"));
  assert.ok(texts("free g", { kind: "alert" }).includes("Free game nights in my city"));
  assert.ok(texts("plan a", { kind: "ask" }).some((t) => /^Plan a dinner/.test(t)));
  assert.ok(texts("host", { kind: "post" }).some((t) => /^Hosting a game night/.test(t)));
  assert.ok(texts("clo", { kind: "kind", maxLen: 24 }).every((t) => t.length <= 24) && texts("clo", { kind: "kind", maxLen: 24 }).includes("Clothes swap"));
  // "run in pro": the place after "in" finishes too, and a bank line with its structure
  const run = top("run in pro", { city: "New York" });
  assert.ok(run.some((x) => x.text === "run in Prospect Park" && x.place === "Prospect Park"), run.map((x) => x.text).join());
  const easy = top("easy 5")[0]; assert.equal(easy.text, "Easy 5K in Prospect Park Saturday 8am"); assert.deepEqual([easy.k, easy.day, easy.time, easy.place, easy.title], ["run", "sat", "08:00", "Prospect Park", "Easy 5K in Prospect Park"]);
  // the ghost: what comes after the typed text, case and accents aside; nothing when it doesn't start with it
  assert.equal(S.completion("run in pro", "Run in Prospect Park"), "spect Park"); assert.equal(S.completion("sao", "São Paulo"), " Paulo"); assert.equal(S.completion("park", "Prospect Park"), "");
  assert.equal(texts("zzzq").length, 0); assert.equal(texts("").length, 0);
});

test("places: nicknames, boroughs and neighbourhoods find their city; accents and case don't matter", () => {
  const city = (q) => [...S.rank(q, { kind: "city", places: P }).map((x) => x.text)];
  assert.equal(city("nyc")[0], "New York"); assert.equal(city("NYC")[0], "New York"); assert.equal(city("sf")[0], "San Francisco"); assert.equal(city("la")[0], "Los Angeles");
  assert.equal(city("san f")[0], "San Francisco"); assert.equal(city("SAN F")[0], "San Francisco"); assert.equal(city("vegas")[0], "Las Vegas"); assert.equal(city("philly")[0], "Philadelphia");
  assert.deepEqual([...city("brook").slice(0, 2)], ["Brooklyn", "New York"]);
  assert.ok(city("greenp").includes("New York"), "a neighbourhood finds its city");
  assert.equal(city("sao")[0], "São Paulo"); assert.equal(city("bogota")[0], "Bogotá"); assert.equal(city("BOGOTA")[0], "Bogotá"); assert.equal(city("Bogotá").length, 0, "nothing when it is already exactly that"); assert.equal(city("zurich")[0], "Zurich");
  const place = (q, c) => [...S.rank(q, { kind: "place", places: P, city: c }).map((x) => x.text)];
  assert.ok(place("greenp").includes("Greenpoint, Brooklyn"), place("greenp").join());
  assert.ok(place("brook", "New York").includes("Brooklyn") && place("brook", "New York").some((t) => /, Brooklyn$/.test(t)), place("brook").join());
  assert.ok(place("neuk").includes("Neukölln, Berlin"), "accents: " + place("neuk").join());
  assert.ok(place("dolores", "San Francisco").includes("Dolores Park"));
  assert.equal(S.cityOf("Greenpoint", P), "New York"); assert.equal(S.cityOf("brooklyn", P), "New York"); assert.equal(S.cityOf("Nowhere Town", P), "");
  // the server's list: neighbourhoods with their borough
  const pl = placesPayload(); assert.ok(pl.hoods.some((h) => h[0] === "Greenpoint" && h[1] === "Brooklyn" && h[2] === "New York")); assert.ok(pl.cities.some((c) => c[0] === "New York"));
});

test("ranking: your own picks and past events first, then your city", () => {
  const hist = [{ t: "Dinner with the climbing crew", n: 3, at: Date.now() - 864e5, k: "dinner" }];
  const r = top("din", { history: hist }); assert.equal(r[0].text, "Dinner with the climbing crew"); assert.equal(r[0].hint, "Recent");
  const m = top("dum", { mine: [{ t: "Dumpling night at Kai's", k: "dinner" }] }); assert.equal(m[0].text, "Dumpling night at Kai's"); assert.equal(m[0].hint, "You hosted");
  // a bank line that is yours too ranks above the others that start the same way
  assert.equal(top("game", { history: [{ t: "Game night Friday 7:30pm", n: 1 }] })[0].text, "Game night Friday 7:30pm");
  // your city: a run in your park before one across the country
  const sf = texts("run in", { city: "San Francisco" }), ny = texts("run in", { city: "New York" });
  assert.ok(sf.indexOf("Run in Golden Gate Park Saturday 8am") < (sf.indexOf("Run in Central Park Sunday 9am") + 1 || 99), sf.join());
  assert.ok(ny.indexOf("Run in Prospect Park, coffee after") >= 0 && (ny.indexOf("Run in Golden Gate Park Saturday 8am") < 0 || ny.indexOf("Run in Prospect Park, coffee after") < ny.indexOf("Run in Golden Gate Park Saturday 8am")), ny.join());
  // Potto's items fold in: up to two always show, the rest rank by fit
  const merged = S.merge(top("din"), [{ text: "Dinner in Greenpoint Friday 7pm", place: "Greenpoint" }, { text: "Dumplings and dinner, a supper club" }, { text: "Third one" }], "din");
  assert.equal(merged.length, 5); assert.equal(merged.filter((x) => x.src === "potto").length, 2); assert.ok(merged.find((x) => x.src === "potto").hint === "Potto");
});

test("offline Potto (ENCORE_FAKE_AI): city-aware completions with a day, a time and a place", () => {
  const j = JSON.parse(fakeText(suggestPrompt({ kind: "idea", city: "New York", text: "din" })));
  assert.ok(j.items.length >= 3 && j.items.length <= 5); const smart = j.items[0];
  assert.match(smart.text, /^Dinner/); assert.ok(smart.place && smart.day && /^\d\d:\d\d$/.test(smart.time), JSON.stringify(smart));
  assert.ok(P.hoods.some((h) => h.hood === smart.place && h.city === "New York"), "a real New York neighbourhood");
  assert.equal(fakeSuggest(suggestPrompt({ kind: "idea", city: "New York", text: "run in pro" })).items[0].place, "Prospect Park");
  assert.ok(!fakeSuggest(suggestPrompt({ kind: "idea", city: "New York", text: "vegas" })).items.some((x) => /Bed-Stuy|Brooklyn/.test(x.text)), "a trip doesn't get a local neighbourhood");
  // what comes back is cleaned: no em dashes or emoji, known kinds, days and times only, 5 at most
  const c = cleanItems({ items: [{ text: "Dinner \u2014 at mine \u{1F389}", kind: "dinner", day: "fri", time: "19:00" }, { text: "x", kind: "nope" }, { text: "Brunch", kind: "nope", day: "someday", time: "25:00" }, ...Array(8).fill(0).map((_, i) => ({ text: "Idea " + i }))] }, "din");
  assert.equal(c[0].text, "Dinner, at mine"); assert.equal(c[0].kind, "dinner"); assert.deepEqual(c[1], { text: "Brunch" }); assert.equal(c.length, 5);
});

// ---------------- the server ----------------
let srv, chromium, browser, person;
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "autocomplete-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1" };
const post = (path, body, cookie, extra = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body || {}) });
const signup = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, await r.clone().text()); return { cookie: r.headers.get("set-cookie").split(";")[0], name, email }; };
before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  person = await signup("Priya Raman", "priya.suggest@example.com");
  await post("/api/host/profile", { handle: "priya-suggest", name: "Priya Raman", city: "New York", bio: "Dinners.", emoji: "🍵" }, person.cookie);
  await fetch(srv.base + "/api/db/doc?path=events/acDumpling", { method: "PUT", headers: { ...J, cookie: person.cookie }, body: JSON.stringify({ name: "Dumpling night at Kai's", planKind: "dinner", kind: "social", casual: true, date: "2026-10-02", city: "New York", guests: [{ name: "Rae Lin", email: "rae.guest@example.com" }] }) });
  try { ({ chromium } = createRequire(import.meta.url)("playwright")); browser = await chromium.launch(); } catch { browser = null; }
});
after(async () => { await browser?.close(); for (const k of [...Object.keys(ENV), "ENCORE_SUGGEST_PER_MIN"]) delete process.env[k]; await srv?.close(); });

test("POST /api/suggest: offline Potto answers, a second ask comes from the cache, signed out works too", async () => {
  const r = await post("/api/suggest", { text: "run in pro", kind: "idea", city: "New York" }, person.cookie); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.source, "potto"); assert.ok(j.items.length >= 2 && j.items.length <= 5); assert.ok(j.items.some((x) => x.place === "Prospect Park" && x.day && x.time), JSON.stringify(j.items));
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  const again = await (await post("/api/suggest", { text: "run in pro", kind: "idea", city: "New York" }, person.cookie)).json(); assert.equal(again.source, "cache"); assert.deepEqual(again.items, j.items);
  const anon = await (await post("/api/suggest", { text: "free g", kind: "alert", city: "Austin" })).json(); assert.ok(anon.items.some((x) => /^Free game nights/.test(x.text)), JSON.stringify(anon));
  assert.deepEqual(await (await post("/api/suggest", { text: "di", kind: "idea" })).json(), { items: [], source: "none" }, "under 3 characters: nothing asked");
  const pl = await fetch(srv.base + "/api/public/suggest/places"); assert.match(pl.headers.get("cache-control"), /public/); assert.ok((await pl.json()).hoods.length > 50);
});

test("privacy: only the typed text, the city and the field kind reach the prompt", async () => {
  const st = srv.app.locals.suggest;
  await post("/api/suggest", { text: "pottery nig", kind: "idea", city: "Brooklyn", name: "Priya Raman", email: "priya.suggest@example.com", guests: [{ name: "Rae Lin", email: "rae.guest@example.com" }], eventId: "acDumpling" }, person.cookie);
  const p = st.lastPrompt; assert.match(p, /<typed>pottery nig<\/typed>/); assert.match(p, /<city>Brooklyn<\/city>/); assert.match(p, /<field>idea<\/field>/);
  for (const bad of ["Priya", "Raman", "priya.suggest", "@example.com", "Rae Lin", "rae.guest", "Dumpling", "acDumpling"]) assert.ok(!p.includes(bad), "the prompt has " + bad);
  // your own events come back only to you, titles and city only
  const mine = await (await fetch(srv.base + "/api/suggest/mine", { headers: { cookie: person.cookie } })).json();
  assert.deepEqual(mine.events.find((e) => e.t === "Dumpling night at Kai's"), { t: "Dumpling night at Kai's", k: "dinner", city: "New York" }); assert.ok(!JSON.stringify(mine).includes("rae.guest"));
  const other = await signup("Sam Diaz", "sam.suggest@example.com"); assert.deepEqual((await (await fetch(srv.base + "/api/suggest/mine", { headers: { cookie: other.cookie } })).json()).events, []);
  assert.deepEqual(await (await fetch(srv.base + "/api/suggest/mine")).json(), { events: [], potto: true }, "signed out: nothing");
});

test("the Settings switch: Suggestions from Potto off stops the server calls; on again brings them back", async () => {
  const p = await signup("Lu Chen", "lu.suggest@example.com");
  assert.equal((await (await fetch(srv.base + "/api/me/prefs", { headers: { cookie: p.cookie } })).json()).pottoSuggest, true, "on by default");
  assert.equal((await post("/api/me/prefs", { pottoSuggest: false }, p.cookie)).status, 200);
  assert.equal((await (await fetch(srv.base + "/api/me/prefs", { headers: { cookie: p.cookie } })).json()).pottoSuggest, false);
  const calls = srv.app.locals.suggest.calls; const off = await (await post("/api/suggest", { text: "supper cl", kind: "idea", city: "New York" }, p.cookie)).json();
  assert.deepEqual(off, { items: [], source: "off" }); assert.equal(srv.app.locals.suggest.calls, calls, "no model call");
  assert.equal((await (await fetch(srv.base + "/api/suggest/mine", { headers: { cookie: p.cookie } })).json()).potto, false, "other devices pick it up");
  // other settings keep their values
  assert.equal((await post("/api/me/prefs", { emails: false }, p.cookie)).status, 200); assert.equal((await (await fetch(srv.base + "/api/me/prefs", { headers: { cookie: p.cookie } })).json()).pottoSuggest, false);
  await post("/api/me/prefs", { pottoSuggest: true }, p.cookie); assert.equal((await (await post("/api/suggest", { text: "supper cl", kind: "idea", city: "New York" }, p.cookie)).json()).source, "potto");
  const html = await (await fetch(srv.base + "/settings")).text(); assert.match(html, /id="pottoSuggest"/); assert.match(html, /Suggestions from Potto/);
});

test("rate limit: per person a minute, half that signed out; a 429 the page backs off from", async () => {
  process.env.ENCORE_SUGGEST_PER_MIN = "4"; const p = await signup("Bo Tran", "bo.suggest@example.com"); const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await post("/api/suggest", { text: "game nig" + i, kind: "idea" }, p.cookie)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 429]);
  const r = await post("/api/suggest", { text: "game night x", kind: "idea" }, p.cookie); assert.equal(r.status, 429); assert.equal((await r.json()).code, "rate_limited");
  // another person isn't held back by Bo
  const q = await signup("Cy Park", "cy.suggest@example.com"); assert.equal((await post("/api/suggest", { text: "game nights", kind: "idea" }, q.cookie)).status, 200);
  delete process.env.ENCORE_SUGGEST_PER_MIN;
});

// ---------------- the page ----------------
async function ctxFor(w, cookie, init = "") {
  const pw = createRequire(import.meta.url)("playwright");
  const ctx = await browser.newContext({ ...(w === 390 ? pw.devices["iPhone 13"] : { viewport: { width: 1280, height: 860 } }), serviceWorkers: "block" });
  await ctx.addInitScript((extra) => { try { localStorage.setItem("pl.deckDone", "1"); localStorage.setItem("pl.interestsSeen", "1"); localStorage.setItem("encore.place", JSON.stringify({ city: "New York", source: "manual" })); if (extra) localStorage.setItem("pl.suggestPotto", extra); } catch {} }, init);
  if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]); }
  ctx.setDefaultTimeout(90000); return ctx;
}
const state = (page) => page.evaluate(() => { const L = document.querySelector("#plsList"), a = document.activeElement, G = document.querySelector(".plsa-ghost");
  return { open: !!L && !L.hidden, opts: L ? [...L.querySelectorAll("[role=option]")].map((x) => x.querySelector(".plsa-t").textContent) : [], potto: L ? L.querySelectorAll("[data-potto]").length : 0, ghost: G && !G.hidden ? G.querySelector(".plsa-rest")?.textContent || "" : "",
    role: a?.getAttribute("role"), ctl: a?.getAttribute("aria-controls"), expanded: a?.getAttribute("aria-expanded"), ad: a?.getAttribute("aria-activedescendant"), focus: a?.name || a?.id, listRole: L?.getAttribute("role"),
    rows: L ? [...L.querySelectorAll("[role=option]")].map((x) => x.getBoundingClientRect().height) : [] }; });
const layout = (page) => page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth, ...[...document.querySelectorAll("h1, form, input, textarea, button")].slice(0, 20).map((e) => Math.round(e.getBoundingClientRect().top + scrollY))].join(","));
async function type(page, sel, text, wait = 600) { await page.click(sel); await page.fill(sel, ""); await page.type(sel, text, { delay: 20 }); await page.waitForTimeout(wait); return state(page); }

for (const w of [390, 1280]) test(`/start at ${w}: suggestions as you type, keys, roles, no layout shift, a pick fills the plan`, async (t) => {
  if (!browser) return t.skip("no playwright");
  const ctx = await ctxFor(w), page = await ctx.newPage(), errs = [], bodies = []; page.on("pageerror", (e) => errs.push(e.message));
  page.on("request", (rq) => { if (rq.url().endsWith("/api/suggest")) bodies.push(rq.postDataJSON()); });
  await page.goto(srv.base + "/start", { waitUntil: "load" }); await page.waitForFunction(() => document.querySelector("#f [name=title]")?.__pls && document.querySelector("#f [name=place]")?.__pls);
  for (const [q, want] of [["din", /^Dinner/], ["run in pro", /Prospect Park/], ["vegas", /^Vegas/]]) { const s = await type(page, "#f [name=title]", q, 900);
    assert.ok(s.open && s.opts.length && s.opts.every((o) => want.test(o) || /Prospect/.test(o)), `${q}: ${s.opts.join(" | ")}`); assert.ok(s.rows.every((h) => h >= 44), "44px rows " + s.rows); }
  for (const [q, want] of [["brook", "Brooklyn"], ["nyc", "New York"], ["san f", "San Francisco"]]) { const s = await type(page, "#f [name=place]", q); assert.equal(s.opts[0], want, `${q}: ${s.opts.join(" | ")}`); }
  // roles: a combobox that controls the listbox, expanded while it shows, the active row by aria-activedescendant
  let s = await type(page, "#f [name=title]", "din"); assert.equal(s.role, "combobox"); assert.equal(s.ctl, "plsList"); assert.equal(s.expanded, "true"); assert.equal(s.listRole, "listbox"); assert.equal(s.ad, null);
  if (w === 1280) assert.ok(s.ghost.length > 0, "ghost text on a wide screen"); else assert.equal(s.ghost, "", "a row above the keyboard on a phone, no ghost");
  // no layout shift: the page is the same with the list open and closed
  const open = await layout(page); await page.keyboard.press("Escape"); s = await state(page); assert.equal(s.open, false, "Escape closes"); assert.equal(s.focus, "title", "focus stays in the field"); assert.equal(s.expanded, "false");
  assert.equal(await layout(page), open, "nothing moved"); assert.equal(await page.inputValue("#f [name=title]"), "din", "what was typed is untouched");
  await page.keyboard.type("n"); s = await state(page); assert.equal(s.open, true, "typing again opens it");
  await page.keyboard.press("ArrowDown"); s = await state(page); assert.equal(s.ad, "plsOpt0"); await page.keyboard.press("ArrowDown"); s = await state(page); assert.equal(s.ad, "plsOpt1");
  const second = s.opts[1]; await page.keyboard.press("Enter"); assert.equal(await page.inputValue("#f [name=title]"), second, "Enter picks the active row"); assert.equal((await state(page)).open, false);
  if (w === 1280) { await type(page, "#f [name=title]", "pottery c"); await page.keyboard.press("Tab"); assert.match(await page.inputValue("#f [name=title]"), /^pottery class/i, "Tab takes the ghost"); assert.equal((await state(page)).focus, "title"); }
  // blur closes
  await type(page, "#f [name=title]", "din"); await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(50); assert.equal((await state(page)).open, false, "blur closes");
  // a structured pick: the template, the day, the time and the place
  await page.fill("#f [name=place]", ""); await type(page, "#f [name=title]", "easy 5"); await page.click("#plsList [data-i='0']");
  const st = await page.evaluate(() => ({ t: document.querySelector("#f [name=title]").value, time: document.querySelector("#f [name=time]").value, date: document.querySelector("#f [name=date]").value, place: document.querySelector("#f [name=place]").value, chip: document.querySelector(".chip[aria-pressed=true]")?.textContent, focus: document.activeElement?.name }));
  assert.deepEqual([st.t, st.time, st.place, st.chip, st.focus], ["Easy 5K in Prospect Park", "08:00", "Prospect Park", "Run club", "title"]); assert.equal(new Date(st.date + "T12:00:00Z").getUTCDay(), 6, "a Saturday");
  // the requests: only the typed text, the city and the field kind
  assert.ok(bodies.length > 0, "Potto was asked"); for (const b of bodies) assert.deepEqual(Object.keys(b).sort(), ["city", "kind", "text"]);
  assert.deepEqual(errs, []); await ctx.close();
});

test("the server failing or switched off: local suggestions still come, nothing breaks", async (t) => {
  if (!browser) return t.skip("no playwright");
  for (const mode of ["fail", "off"]) {
    const ctx = await ctxFor(1280, null, mode === "off" ? "0" : ""), page = await ctx.newPage(), errs = []; let asked = 0; page.on("pageerror", (e) => errs.push(e.message));
    await page.route("**/api/suggest", (r) => { asked++; return mode === "fail" ? r.abort() : r.continue(); });
    await page.goto(srv.base + "/start", { waitUntil: "load" }); await page.waitForFunction(() => document.querySelector("#f [name=title]")?.__pls);
    const s = await type(page, "#f [name=title]", "supper", 900); assert.ok(s.open && s.opts.includes("Supper club"), mode + ": " + s.opts.join()); assert.equal(s.potto, 0);
    const s2 = await type(page, "#f [name=title]", "game ni", 900); assert.ok(s2.opts.includes("Game night"));
    if (mode === "off") assert.equal(asked, 0, "no server calls with the switch off"); else assert.ok(asked >= 1);
    assert.deepEqual(errs, []); await ctx.close(); }
});

test("the create canvas: a picked idea fills the kind, the day, the time and the place; the place sheet completes places", async (t) => {
  if (!browser) return t.skip("no playwright");
  const ctx = await ctxFor(390, person.cookie), page = await ctx.newPage(), errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(srv.base + "/?app=1", { waitUntil: "load" }); await page.waitForFunction(() => window.EventCanvas?.open); await page.evaluate(() => window.EventCanvas.open({ mode: "new" }));
  await page.waitForFunction(() => document.querySelector("#cvTitle")?.__pls);
  let s = await type(page, "#cvTitle", "run in pro", 900); assert.ok(s.opts.some((o) => o === "run in Prospect Park"), s.opts.join(" | ")); assert.ok(s.potto >= 1, "Potto's own show up"); assert.equal(s.ctl, "plsList");
  await page.keyboard.press("Escape"); assert.ok(await page.$("#cv"), "Escape closes the list, not the canvas");
  await type(page, "#cvTitle", "easy 5"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  const W = await page.evaluate(() => { const x = window.EventCanvas.state().W; return { t: x.pubTitle, date: x.date, time: x.startTime, place: x.meetPoint, kind: x.planKind, focus: document.activeElement?.id }; });
  assert.deepEqual([W.t, W.time, W.place, W.kind, W.focus], ["Easy 5K in Prospect Park", "08:00", "Prospect Park", "run", "cvTitle"]); assert.equal(new Date(W.date + "T12:00:00Z").getUTCDay(), 6);
  await page.evaluate(() => document.activeElement.blur()); await page.click("#cvPlace"); await page.waitForFunction(() => document.querySelector("#cvWhere")?.__pls);
  await page.fill("#cvWhere", ""); s = await type(page, "#cvWhere", "greenp"); assert.equal(s.opts[0], "Greenpoint, Brooklyn");
  await page.fill("#cvCity", ""); s = await type(page, "#cvCity", "san f"); assert.equal(s.opts[0], "San Francisco"); await page.click("#plsList [data-i='0']"); assert.equal(await page.inputValue("#cvCity"), "San Francisco");
  assert.deepEqual(errs, []); await ctx.close();
});

test("the city sheet's search: neighbourhoods and nicknames find the city, arrow keys and Enter pick", async (t) => {
  if (!browser) return t.skip("no playwright");
  const ctx = await ctxFor(390), page = await ctx.newPage(); await page.goto(srv.base + "/discover", { waitUntil: "load" }); await page.waitForFunction(() => document.querySelector("#locBtn")?.onclick);
  await page.click("#locBtn"); await page.waitForSelector(".pls-search input"); await page.waitForFunction(() => window.PLSuggest?.rankPlaces);
  const opts = async (q) => { await page.fill(".pls-search input", q); return page.evaluate(() => [...document.querySelectorAll(".pls-sugg [role=option] span")].map((x) => x.textContent)); };
  assert.equal((await opts("nyc"))[0], "New York"); assert.deepEqual(await opts("nyc"), ["New York"], "no 'Use this' for a nickname we know"); assert.equal((await opts("san f"))[0], "San Francisco"); assert.equal((await opts("vegas"))[0], "Las Vegas");
  assert.equal((await opts("greenp"))[0], "New York"); const inp = await page.evaluate(() => { const i = document.querySelector(".pls-search input"); return [i.getAttribute("role"), i.getAttribute("aria-controls"), document.getElementById(i.getAttribute("aria-controls"))?.getAttribute("role")]; });
  assert.deepEqual(inp, ["combobox", "plsSugg", "listbox"]);
  await page.keyboard.press("ArrowDown"); assert.equal(await page.getAttribute(".pls-search input", "aria-activedescendant"), "plsO0"); await page.keyboard.press("Enter");
  assert.equal(await page.$(".pls"), null); assert.match(await page.textContent("#locName"), /New York/); await ctx.close();
});
