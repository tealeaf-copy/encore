// New York run templates (public/runtemplates.js, server/runtemplates.js): ready-to-use runs for a host in New York.
// Pure: every template fills an event the canvas can take (spot, approximate distance, route, pace groups, time, after,
// what to bring, a season note, the cover), the words a host types read into a template, weekly repeats, the run
// sign-up questions (no food question). Server: Potto offers the templates to a New York run host and not to a host
// elsewhere, and fills one from "easy 5K in Prospect Park Saturday 8"; a guest replies with a pace group and follows
// with the reply as proof; the host messages followers by email and text. Browser (skipped without Playwright): the
// Home never shows the run card; Routes near you show in the canvas once a run is planned (filters, map links, a route
// fills the canvas with weekly on), Chicago gets Add your route, Message your followers is on the host page, and a guest
// signs up from the light invite with a pace group, no food question, then follows in one tap.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { fakeOutbox } from "../server/email.js";
import { fakeTexts } from "../server/sms.js";
import { runTemplates, runPottoReply, RUN_LINK } from "../server/runtemplates.js";
import { hoodCentre, placeOf } from "../server/geo.js";

const R = runTemplates(), TODAY = "2026-11-27"; // a Friday
const plain = (x) => JSON.parse(JSON.stringify(x)); // values made inside the vm compare as plain data
const src = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
let srv, ny, chi;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, await r.clone().text()); return r.headers.get("set-cookie").split(";")[0]; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const putEvent = (id, ev, cookie) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(ev) });

before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "nyc-runs-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1"; process.env.ENCORE_FAKE_SMS = "1"; process.env.ENCORE_FAKE_GEO = "1";
  srv = await startServer(); ny = await join("Jess Rivera", "jess.nyc@example.com"); chi = await join("Cal Moore", "cal.chi@example.com");
  assert.equal((await post("/api/host/profile", { handle: "jess-runs", name: "Jess Rivera", city: "" }, ny)).status, 200);
  assert.equal((await post("/api/host/profile", { handle: "cal-runs", name: "Cal Moore", city: "Chicago" }, chi)).status, 200); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS", "ENCORE_FAKE_GEO"]) delete process.env[k]; await srv?.close(); });

test("at least eight New York templates, across the boroughs, each one a complete run the canvas can take", () => {
  assert.ok(R.LIST.length >= 8, String(R.LIST.length)); assert.deepEqual(new Set(R.LIST.map((t) => t.borough)), new Set(["Manhattan", "Brooklyn", "Queens", "Bronx"]));
  const ids = R.LIST.map((t) => t.id); for (const id of ["reservoir", "cp-loop", "hudson", "bridge", "prospect", "mccarren", "east-river", "astoria"]) assert.ok(ids.includes(id), id);
  assert.match(R.byId("reservoir").dist, /1\.58 mi/); assert.match(R.byId("cp-loop").dist, /6\.1 mi/); assert.match(R.byId("prospect").dist, /3\.35 mi/); assert.match(R.byId("reservoir").spot, /Engineers' Gate, Fifth Ave at East 90th St/);
  for (const T of R.LIST) { const e = R.toEvent(T.id, { today: TODAY });
    assert.equal(e.planKind, "run"); assert.equal(e.activity, "run"); assert.equal(e.city, "New York"); assert.equal(e.placePublic, true); assert.equal(e.askDiet, false, T.id + ": no food question");
    assert.ok(e.pubTitle && e.meetPoint && e.venueName && e.hood, T.id); assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(e.date > TODAY, T.id + " is in the future"); assert.match(e.startTime, /^\d{2}:\d{2}$/); assert.ok(e.endTime > e.startTime || e.endTime < "06:00");
    assert.equal(new Date(e.date + "T12:00:00Z").getUTCDay(), T.d, T.id + " lands on its weekday");
    const S = Object.fromEntries(e.sections.map((s) => [s.title, s.body])); assert.deepEqual(Object.keys(S), ["The route", "Pace groups", "After", "Good to know"]);
    assert.match(S["The route"], /^About [\d.]+ mi/); assert.match(S["The route"], /Distances are approximate/); assert.match(S["Good to know"], /How to find us:/); assert.match(S["Good to know"], /dark|Cold|layer|hot|Sunrise|Mild/i);
    assert.ok(S["Pace groups"].split("\n").length >= 3); assert.ok(e.bring.length >= 2); assert.match(e.getThere[0].x, /\b(stop|stops)\b/); assert.deepEqual(e.coverArt.kind, "run");
    assert.equal(e.questions[0].id, "runpace"); assert.equal(e.questions[0].type, "choice"); assert.ok(e.questions[0].options.length >= 3); assert.equal(e.questions[1].id, "runfirst");
    assert.ok(e.headcount < 20, "no door code for a park run");
    for (const s of [e.pubTitle, e.why, e.meetPoint, ...e.sections.map((x) => x.body), ...e.bring, e.getThere[0].x]) { assert.doesNotMatch(s, /\u2014/, "no em dashes"); assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, "no emoji"); }
    // the neighbourhood is on the map: a centroid we know, in New York
    const c = hoodCentre(e.hood, "New York"); assert.ok(c, e.hood); assert.ok(Math.abs(c.lat - 40.75) < 0.2 && Math.abs(c.lng + 73.95) < 0.1, e.hood);
    const pl = placeOf({ ...e, id: "x", published: true, discoverable: true }, {}); assert.equal(pl.city, "New York"); }
  // winter mornings say it's dark; summer says heat
  assert.match(R.toEvent("bridge", { today: "2026-12-01" }).sections[3].body, /dark/); assert.match(R.toEvent("prospect", { today: "2026-07-01" }).sections[3].body, /hot/);
});

test("New York or not, the weekly repeat, and the words a host types", () => {
  for (const c of ["New York", "Brooklyn", "Astoria, Queens", "nyc", "Park Slope"]) assert.ok(R.isNYC(c), c);
  for (const c of ["Chicago", "London", "", "Newark"]) assert.ok(!R.isNYC(c), c);
  assert.equal(R.toEvent("hudson", { today: TODAY }).repeat, "weekly", "the Tuesday tempo repeats weekly"); assert.equal(R.toEvent("hudson", { today: TODAY, repeat: "" }).repeat, undefined);
  assert.equal(R.toEvent("prospect", { today: TODAY }).repeat, undefined); assert.equal(R.toEvent("prospect", { today: TODAY, repeat: "weekly" }).repeat, "weekly");
  let P = R.parse("easy 5K in Prospect Park Saturday 8", TODAY); assert.deepEqual({ ...P }, { id: "prospect", run: true, date: "2026-11-28", time: "08:00", title: "Easy 5K in Prospect Park" });
  P = R.parse("weekly Tuesday tempo on the Hudson at 6:30pm", TODAY); assert.equal(P.id, "hudson"); assert.equal(P.date, "2026-12-01"); assert.equal(P.time, "18:30"); assert.equal(P.repeat, "weekly");
  P = R.parse("Saturday 8am easy 5K, then coffee", TODAY); assert.equal(P.id, ""); assert.equal(P.time, "08:00"); assert.equal(P.title, "Easy 5K");
  assert.equal(R.parse("dinner in Williamsburg Friday 7pm", TODAY), null, "a dinner is not a run"); assert.equal(R.parse("reservoir loop sat 9am", TODAY).id, "reservoir");
  assert.equal(R.parse("track night 6 x 400, 12 runners, Wednesday 7pm", TODAY).time, "19:00");
  // the link Potto and Home use, and the canvas reads back
  const u = R.urlOf("prospect", { date: "2026-11-28", time: "08:00", title: "Easy 5K in Prospect Park" }); assert.match(u, RUN_LINK); assert.match(u, /^\/\?app=1&new=1&kind=run&tpl=prospect&date=2026-11-28&time=08%3A00/);
  const e = R.fromQuery(new URL("http://x" + u).searchParams, TODAY); assert.equal(e.pubTitle, "Easy 5K in Prospect Park"); assert.equal(e.date, "2026-11-28"); assert.equal(e.startTime, "08:00");
  // the canvas's own line reading: a day first keeps what it is, and the time typed beats the kind's 8am
  const box = { window: {} }; vm.runInNewContext(src("public/canvas.js"), box); const C = box.window.EventCanvas;
  const L = C.planFromLine("Saturday 8am easy 5K, then coffee", new Date(2026, 10, 27)); assert.equal(L.title, "Easy 5K"); assert.equal(L.startTime, "08:00");
  const W = C.planFromLine("Tuesday tempo run at 6:30pm, every week", new Date(2026, 10, 27)); assert.equal(W.title, "Tuesday tempo run"); assert.equal(W.startTime, "18:30"); assert.equal(W.repeat, "weekly"); assert.match(C.planLineLabel(W), /every week/);
  assert.match(src("public/canvas.js"), /if \(P.startTime && kt && W.startTime === kt\) W.startTime = P.startTime/, "the Fill in button replaces the kind's default time");
});

test("Routes near you: every route has a meeting spot, about how far, a surface and a map link; filters and nearest first", () => {
  for (const T of R.LIST) { assert.ok(T.spot && T.km > 0 && T.surface.length, T.id); assert.ok(T.surface.every((s) => ["park", "waterfront", "bridge", "trail"].includes(s)), T.id);
    assert.match(R.howFar(T), /^About [\d.]+ mi \([\d.]+ km\)$/); assert.match(R.mapUrl(T), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=4\d\.\d+%2C-7\d\.\d+$/); }
  assert.equal(R.routes().length, R.LIST.length); assert.deepEqual(plain(R.routes({ surface: "bridge" }).map((x) => x.T.id)), ["bridge"]); assert.deepEqual(plain(R.routes({ surface: "trail" }).map((x) => x.T.id)), ["van-cortlandt"]);
  assert.deepEqual(plain(R.routes({ dist: "short" }).map((x) => x.T.id)), ["bridge"]); assert.ok(R.routes({ dist: "mid" }).every((x) => x.T.km >= 5 && x.T.km < 10)); assert.equal(R.routes({ dist: "long" }).length, 0);
  // from Grand Army Plaza, Prospect Park is nearest and the Bronx is furthest
  const near = R.routes({ near: { lat: 40.6745, lng: -73.9701 } }); assert.equal(near[0].T.id, "prospect"); assert.ok(near[0].away < 0.2); assert.equal(near.at(-1).T.id, "van-cortlandt");
  assert.equal(R.howFar(R.byId("prospect")), "About 3.4 mi (5.4 km)");
});
test("run sign-up: pace groups, first time, emergency contact and waiver on the host's say, never a food question", () => {
  const ev = { questions: [{ id: "own1", q: "Your Instagram?", type: "instagram" }] };
  R.signupSet(ev, "paces", "Easy\nSteady\n\nQuick"); R.signupSet(ev, "first", true);
  assert.deepEqual(plain(ev.questions.map((q) => q.id)), ["runpace", "runfirst", "own1"], "the host's own question stays, after the run ones"); assert.deepEqual(plain(ev.questions[0].options), ["Easy", "Steady", "Quick"]); assert.equal(ev.questions[0].required, false);
  assert.equal(ev.askDiet, false); assert.deepEqual(plain(R.signup(ev)), { paces: ["Easy", "Steady", "Quick"], first: true, ice: false, waiver: false, waiverText: R.WAIVER });
  R.signupSet(ev, "ice", true); R.signupSet(ev, "waiver", true); R.signupSet(ev, "waiverText", "I run at my own risk.");
  const Q = Object.fromEntries(ev.questions.map((q) => [q.id, q])); assert.equal(Q.runice.required, true); assert.equal(Q.runwaiver.required, true); assert.equal(Q.runwaiver.q, "I run at my own risk."); assert.deepEqual(plain(Q.runwaiver.options), ["I agree"]);
  for (const id of Object.keys(Q)) assert.match(id, /^[a-z0-9]{1,12}$/i, "answer keys the server keeps");
  R.signupSet(ev, "ice", false); R.signupSet(ev, "waiver", false); R.signupSet(ev, "paces", ""); assert.deepEqual(plain(ev.questions.map((q) => q.id)), ["runfirst", "own1"]);
  // the reply form's food question (public/questions.js) stays off for every template, even with "then coffee"
  const box = { window: {} }; vm.runInNewContext(src("public/questions.js"), box); const Qs = box.window.Questions;
  for (const T of R.LIST) assert.equal(Qs.askDiet({ ...R.toEvent(T.id, { today: TODAY }), pubTitle: "Easy 5K, then coffee and bagels" }), false, T.id);
});

test("Potto: a New York run host gets the templates, a host elsewhere doesn't, and a run in words is filled in", async () => {
  // the rules, pure
  const ctx = (city) => ({ today: TODAY, me: { host: true, city, handle: "x" } });
  let r = runPottoReply("I'm in NYC and I host runs", ctx("")); assert.equal(r.intent, "run-templates"); assert.ok(r.links.every((l) => RUN_LINK.test(l.href))); assert.equal(r.action?.type, "city");
  assert.equal(runPottoReply("I'm in Chicago and I host runs", ctx("Chicago")), null, "not in New York: no templates");
  assert.equal(runPottoReply("I host runs", ctx("Chicago")), null); assert.equal(runPottoReply("I host runs", ctx("Brooklyn")).intent, "run-templates", "the page city counts");
  assert.equal(runPottoReply("I'm in NYC and I host runs", { ...ctx(""), me: { host: false } }), null, "only hosts");
  r = runPottoReply("easy 5K in Prospect Park Saturday 8", ctx("New York")); assert.equal(r.intent, "run-template"); assert.equal(r.action, null, "the city is already New York");
  assert.match(r.links[0].href, /tpl=prospect&date=2026-11-28&time=08%3A00/); assert.match(r.answer, /Easy 5K in Prospect Park, Sat, Nov 28 at 8am/); assert.match(r.answer, /Grand Army Plaza/); assert.doesNotMatch(r.answer, /\u2014/);
  r = runPottoReply("Saturday 8am easy 5K, then coffee", ctx("New York")); assert.equal(r.intent, "run-pick"); assert.match(r.links[0].href, /tpl=pick&date=2026-11-28&time=08%3A00/);
  assert.equal(runPottoReply("who hasn't replied to my dinner?", ctx("New York")), null, "everything else is Potto as before");
  // through the endpoint (ENCORE_FAKE_AI): links survive Potto's link filter, the city action sets the page city
  let j = await (await post("/api/potto/ask", { message: "I'm in New York and I host runs" }, ny)).json();
  assert.match(j.answer, /New York runs ready to go/); assert.equal(j.links.length, 3); assert.ok(j.links.every((l) => /^\/\?app=1&new=1&kind=run&tpl=/.test(l.href)), JSON.stringify(j.links));
  const a = j.actions.find((x) => x.type === "city"); assert.ok(a, "Make New York my city"); assert.equal((await post(a.url, a.body, ny)).status, 200);
  assert.equal((await (await get("/api/host/profile", ny)).json()).host.city, "New York"); assert.equal((await (await get("/api/host/profile", ny)).json()).host.handle, "jess-runs", "the rest of the page stays");
  j = await (await post("/api/potto/ask", { message: "easy 5K in Prospect Park Saturday 8" }, ny)).json(); assert.match(j.links[0].href, /tpl=prospect/); assert.match(j.links[0].href, /time=08%3A00/); assert.equal(j.actions.length, 0);
  j = await (await post("/api/potto/ask", { message: "I'm in Chicago and I host runs" }, chi)).json(); assert.ok(!(j.links || []).some((l) => /tpl=/.test(l.href)), "Chicago gets no New York templates");
});

test("a guest replies with a pace group and no food question, follows with the reply as proof, and the host messages followers", async () => {
  const ev = { ...R.toEvent("prospect", { today: day(0) }), date: day(3), kind: "social", published: true, discoverable: true, unlisted: true, hostName: "Jess Rivera" };
  assert.equal((await putEvent("nycRun1", ev, ny)).status, 200);
  // the light invite serves under 40,000 characters, with the run hook
  const page = await (await get("/e/nycRun1")).text(); assert.ok(page.length < 40000, String(page.length)); assert.ok(src("public/invite.html").length < 40000);
  assert.match(src("public/invite.html"), /runfollow\.js/);
  // the reply: answers by question id, no dietary field asked
  const H = { ...J, "x-encore-guest": "1", "x-encore-key": "k".repeat(32) }, wsOf = async () => (await (await get("/api/db/doc?path=events/nycRun1")).json()).workspace;
  const ws = await wsOf(); const reply = async (name, contact, pace) => { const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...H, "x-encore-workspace": ws }, body: JSON.stringify({ eventId: "nycRun1", response: "going", name, ...contact, code: "C" + name.toUpperCase().slice(0, 5), answers: { runpace: pace, runfirst: "Yes, first time" }, via: "invite-lite", createdAt: Date.now() }) }); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); return { rid: String(j.id || j.doc?.id).split("/").pop(), code: "C" + name.toUpperCase().slice(0, 5) }; };
  const ana = await reply("Ana", { email: "ana.run@example.com" }, "Easy, 11:00 a mile or slower"), ben = await reply("Ben", { phone: "+19175550142", contactVia: "sms" }, "Run-walk, no rush");
  // Follow for the next run: Ana's reply is her proof (no email typed); Ben adds an email and a number
  let f = await (await post("/api/public/follow", { handle: "jess-runs", eventId: "nycRun1", rid: ana.rid, code: ana.code, via: "run" })).json(); assert.equal(f.ok, true, JSON.stringify(f));
  f = await (await post("/api/public/follow", { handle: "jess-runs", eventId: "nycRun1", rid: ben.rid, code: ben.code, name: "Ben", email: "ben.run@example.com", phone: "+1 917 555 0142", via: "run" })).json(); assert.equal(f.ok, true);
  const F = await (await get("/api/host/followers", ny)).json(); assert.equal(F.count, 2); assert.deepEqual(F.followers.map((x) => x.name).sort(), ["Ana", "Ben"]); assert.ok(F.followers.every((x) => x.via === "run"));
  // the host messages everyone about the next run: email with the note, a text to the follower with a number
  const o0 = fakeOutbox.length, t0 = fakeTexts.length;
  const A = await (await post("/api/host/announce", { eventId: "nycRun1", note: "Next run: Easy loop of Prospect Park. Are you in?" }, ny)).json();
  assert.equal(A.ok, true); assert.equal(A.emailed, 2); assert.equal(A.texted, 1);
  const mails = fakeOutbox.slice(o0); assert.ok(mails.every((m) => /Next run: Easy loop of Prospect Park/.test(m.text))); assert.ok(fakeTexts.slice(t0).some((t) => /Next run: Easy loop of Prospect Park/.test(t.text) && /STOP/.test(t.text)));
  assert.ok([401, 403].includes((await post("/api/host/announce", { eventId: "nycRun1", note: "x" })).status), "hosts only");
});

test("browser: no run card on Home, Routes near you once a run is planned, a route into the canvas with weekly on, a guest reply with a pace group and a one-tap follow", { timeout: 240000 }, async (t) => {
  let chromium; try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  const base = srv.base, as = async (cookie) => { const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" }); ctx.setDefaultTimeout(45000); ctx.setDefaultNavigationTimeout(90000);
    if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }, { name: "encore_in", value: "1", url: base }]); } const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.errs = errs; return p; };
  try {
    // New York host: nothing about runs on Home until they plan one (owner request, Nov 2026)
    const p = await as(ny); await p.goto(base + "/?app=1"); await p.waitForSelector("#view-programs", { timeout: 30000 }); await p.waitForTimeout(2500);
    { const th = p.getByRole("button", { name: "Thanks, Potto" }); if (await th.isVisible().catch(() => false)) await th.click(); } // the first-event celebration
    assert.equal(await p.locator("#rtHome").count(), 0, "no run card on Home"); assert.doesNotMatch(await p.locator("#view-programs").innerText(), /New York runs|See all \d+ New York runs/);
    // they pick Run in the canvas: Routes near you, with distance and surface filters, the spot, about how far and a map link
    await p.evaluate(() => window.EventCanvas.open({ mode: "new" })); await p.waitForSelector("#cv #cvTitle"); assert.equal(await p.locator("#cvRoutes").count(), 0, "no routes before a run is being planned");
    { const m = p.locator("#cv [data-kmore]"); if (await m.isVisible().catch(() => false) && !(await p.locator("#cv [data-kind=run]").isVisible())) await m.click(); } await p.click("#cv [data-kind=run]"); await p.waitForSelector("#cvRoutes .rt-r"); assert.match(await p.locator("#cvRoutes").innerText(), /Routes near you[\s\S]*Use my location/);
    assert.equal(await p.locator("#cvRoutes .rt-r").count(), 3); assert.match(await p.locator("#cvRoutes .rt-r").first().innerText(), /Meet at Engineers' Gate[\s\S]*About 3\.2 mi \(5\.1 km\) · Park loop/);
    assert.match(await p.locator("#cvRoutes .rt-map").first().getAttribute("href"), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=40\.7835%2C-73\.959$/);
    await p.click('#cvRoutes [data-rt-surf="waterfront"]'); assert.deepEqual(await p.locator("#cvRoutes .rt-r b").allInnerTexts(), ["Tuesday tempo on the Hudson", "East River Esplanade easy run", "Astoria Park and Hell Gate loops"]);
    await p.click('#cvRoutes [data-rt-dist="short"]'); assert.equal(await p.locator("#cvRoutes .rt-r").count(), 0); await p.click('#cvRoutes [data-rt-dist=""]');
    for (const b of await p.locator("#cvRoutes button, #cvRoutes a").all()) { const bb = await b.boundingBox(); if (bb) assert.ok(bb.height >= 44, "44px tap targets"); }
    // one tap: the Tuesday tempo, filled in, with Every week on
    await p.click('#cvRoutes [data-rt-route="hudson"]'); await p.waitForFunction(() => document.querySelector("#cvTitle")?.value === "Tuesday tempo on the Hudson");
    assert.match(await p.locator("#cvPlace").innerText(), /Chelsea Piers/); assert.equal(await p.getAttribute("[data-run=repeat]", "aria-checked"), "true"); assert.equal(await p.getAttribute('#cvRoutes [data-rt-route="hudson"]', "aria-pressed"), "true");
    assert.match(await p.locator("#cvPage").innerText(), /Pace groups[\s\S]*Tempo, 8:00 to 9:00 a mile/); assert.equal(await p.locator("#cvBlocks [data-addon=bring]").count(), 1);
    const st = await p.evaluate(() => window.EventCanvas.state().W); assert.equal(st.repeat, "weekly"); assert.equal(st.planKind, "run"); assert.equal(st.askDiet, false); assert.deepEqual(st.questions.map((q) => q.id), ["runpace", "runfirst"]);
    // the waiver and emergency contact are the host's call
    await p.click("[data-run=waiver]"); await p.waitForSelector("[data-runwaiver]"); await p.click("[data-run=ice]");
    assert.deepEqual((await p.evaluate(() => window.EventCanvas.state().W.questions.map((q) => q.id))), ["runpace", "runfirst", "runice", "runwaiver"]);
    await p.click("[data-run=repeat]"); assert.equal(await p.evaluate(() => window.EventCanvas.state().W.repeat), "");
    // another route: the spot and route change with it
    await p.click('#cvRoutes [data-rt-surf=""]'); await p.click("#cvRoutes [data-rt-more]"); await p.click('#cvRoutes [data-rt-route="astoria"]'); await p.waitForFunction(() => /Hell Gate/.test(document.querySelector("#cvPlace")?.innerText || ""));
    assert.equal(await p.inputValue("#cvTitle"), "Astoria Park and Hell Gate loops");
    // a Potto link opens the canvas straight from the address, with the routes
    await p.goto(base + R.urlOf("prospect", { date: day(5), time: "08:00", title: "Easy 5K in Prospect Park" })); await p.waitForSelector("#cv #cvTitle"); assert.equal(await p.inputValue("#cvTitle"), "Easy 5K in Prospect Park"); assert.match(await p.locator("#cvWhen").innerText(), /8:00am/);
    assert.doesNotMatch(p.url(), /tpl=/, "the address is cleaned"); await p.waitForSelector('#cvRoutes [data-rt-route="prospect"][aria-pressed="true"]');
    // the Home create line: a run in words opens the run canvas with the routes (not the Home card)
    await p.goto(base + "/?app=1"); await p.waitForSelector("#qsText"); await p.fill("#qsText", "tempo run club Tuesday 6:30pm"); await p.click("#qsGo");
    await p.waitForSelector("#cvRoutes .rt-r"); assert.equal(await p.evaluate(() => window.EventCanvas.state().W.planKind), "run"); assert.equal(await p.locator("#rtHome").count(), 0);
    // Message your followers lives on the host's own page now
    await p.goto(base + "/@jess-runs"); await p.waitForSelector("#offer [data-own=msg]"); await p.click("#offer [data-own=msg]"); await p.waitForSelector(".rt-sh"); assert.match(await p.locator(".rt-sh").innerText(), /2 people follow you/);
    assert.deepEqual(p.errs, []);
    // Chicago: no card, and a run there gets Add your route (a start spot, about how far, a link) instead of New York's list
    const c = await as(chi); await c.goto(base + "/?app=1"); await c.waitForTimeout(3500); assert.equal(await c.locator("#rtHome").count(), 0, "not in New York, no New York card");
    await c.evaluate(() => window.EventCanvas.open({ mode: "new" })); await c.waitForSelector("#cv #cvTitle"); { const m = c.locator("#cv [data-kmore]"); if (await m.isVisible().catch(() => false) && !(await c.locator("#cv [data-kind=run]").isVisible())) await m.click(); } await c.click("#cv [data-kind=run]"); await c.waitForSelector("#cvRoutes [data-rt-save]");
    assert.match(await c.locator("#cvRoutes").innerText(), /Add your route/); assert.equal(await c.locator("#cvRoutes .rt-r").count(), 0);
    await c.fill('#cvRoutes [data-rt-o="spot"]', "Montrose Harbor, by the bait shop"); await c.fill('#cvRoutes [data-rt-o="dist"]', "5K"); await c.fill('#cvRoutes [data-rt-o="link"]', "http://example.com/route");
    await c.click("#cvRoutes [data-rt-save]"); assert.match(await c.locator("#cvRoutes .rt-err").innerText(), /https/); await c.fill('#cvRoutes [data-rt-o="link"]', "https://example.com/route"); await c.click("#cvRoutes [data-rt-save]");
    await c.waitForFunction(() => window.EventCanvas.state().W.meetPoint === "Montrose Harbor, by the bait shop");
    const S2 = await c.evaluate(() => window.EventCanvas.state().W.sections.find((s) => s.title === "The route")?.body); assert.match(S2, /About 5K\.[\s\S]*https:\/\/example\.com\/route/);
    // a guest from the shared link: pace group, no food question, then Follow for the next run in one tap
    const g = await as(""); await g.goto(base + "/e/nycRun1"); await g.waitForSelector("#f");
    assert.equal(await g.locator("#dt").count(), 0, "no food question"); await g.waitForSelector("#qs .tf-opts button"); assert.match(await g.locator("#qs").innerText(), /Which pace group\?/);
    await g.fill("#nm", "Chloe"); await g.fill("#ct", "chloe.run@example.com"); await g.locator("#qs .tf-opts button").nth(2).click(); await g.click("#send");
    await g.waitForSelector("#tk .rf button"); assert.match(await g.locator("#tk .rf").innerText(), /Follow Jess/); await g.click("#tk .rf button"); await g.waitForSelector(".rf-ok");
    const F = await (await get("/api/host/followers", ny)).json(); assert.ok(F.followers.some((x) => x.name === "Chloe" && x.email === "chloe.run@example.com"));
    assert.deepEqual(g.errs, []);
  } finally { await br.close(); }
});
