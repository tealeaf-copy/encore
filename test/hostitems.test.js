// One item at a time on the host's page (server/pageitems.js, public/hostitems.js): Hide from my page and Pin to top
// for an event, a drop, an experience or a past event; hidden things stay live by their link. The page organised for a
// busy host: Coming up (3 cards, a compact list of up to 8, See all with a month calendar and type filters), a weekly
// event as one card, Order ahead and Book me. The owner (and a co-host) sees Manage, never Ask to join, on every
// surface, and the server refuses a host replying to their own event. Browser parts skip without Playwright.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { seedAudit } from "./routes-seed.js";

let srv, S;
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const post = (p, body, cookie, h = {}) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body) });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const item = (key, patch, cookie) => post("/api/host/page-items", { key, ...patch }, cookie);
const page = async (cookie) => (await get("/api/public/host/mai-routes", cookie)).json();

before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "hostitems-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1" });
  srv = await startServer(); S = await seedAudit(srv.base);
  // a weekly run: three Sundays, one series
  for (const [i, n] of [[1, 3], [2, 10], [3, 17]]) assert.equal((await put("events/hiRun" + i, { kind: "social", casual: true, activity: "run", name: "Sunday run", date: day(n), startTime: "08:00", city: "Brooklyn", meetPoint: "Grand Army Plaza", headcount: 20, published: true, discoverable: true, unlisted: false, repeat: "weekly" }, S.host.cookie)).status, 200); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS"]) delete process.env[k]; await srv?.close(); });

test("Hide from my page: off the public page and the portfolio, still live by its link; the owner sees it marked and can bring it back", async () => {
  assert.equal((await item("e:auAsk", { hidden: true })).status, 401, "signed out");
  assert.equal((await item("e:auAsk", { hidden: true }, S.guest.cookie)).status, 404, "not on their page");
  assert.equal((await item("e:nothere", { hidden: true }, S.host.cookie)).status, 404);
  let r = await item("e:auAsk", { hidden: true }, S.host.cookie), j = await r.json(); assert.equal(r.status, 200); assert.deepEqual(j.hidden.map((x) => x.key), ["e:auAsk"]); assert.equal(j.hidden[0].title, "Chef's counter");
  assert.ok(!(await page()).upcoming.some((e) => e.id === "auAsk"), "a visitor doesn't see it");
  const own = (await page(S.host.cookie)).upcoming.find((e) => e.id === "auAsk"); assert.ok(own?.pageHidden, "the owner sees it, marked");
  assert.equal((await get("/e/auAsk")).status, 200, "the link still opens");
  const doc = await (await fetch(srv.base + "/api/db/doc?path=events/auAsk", { headers: { "x-encore-guest": "1" } })).json(); assert.equal(doc.data?.name, "Chef's counter", "invited guests still get the event");
  // an experience and a drop
  assert.equal((await item("x:" + S.exp, { hidden: true }, S.host.cookie)).status, 200);
  assert.ok(!(await page()).host.experiences.some((x) => x.id === S.exp)); assert.ok((await page(S.host.cookie)).host.experiences.find((x) => x.id === S.exp).pageHidden);
  if (S.drop) { assert.equal((await item("e:" + S.drop, { hidden: true }, S.host.cookie)).status, 200); assert.ok(!((await (await get("/api/public/drops/mai-routes")).json()).drops || []).some((x) => x.id === S.drop));
    assert.ok(((await (await get("/api/public/drops/mai-routes", S.host.cookie)).json()).drops || []).find((x) => x.id === S.drop)?.pageHidden); assert.equal((await item("e:" + S.drop, { hidden: false }, S.host.cookie)).status, 200); }
  // a past event leaves the page's past list
  assert.equal((await item("e:" + S.past, { hidden: true }, S.host.cookie)).status, 200); assert.ok(!(await page()).past.some((e) => e.id === S.past));
  j = await (await get("/api/host/page-items", S.host.cookie)).json(); assert.deepEqual(j.hidden.map((x) => x.key).sort(), ["e:auAsk", "e:" + S.past, "x:" + S.exp].sort());
  for (const k of ["e:auAsk", "x:" + S.exp, "e:" + S.past]) assert.equal((await item(k, { hidden: false }, S.host.cookie)).status, 200);
  assert.ok((await page()).upcoming.some((e) => e.id === "auAsk"), "back on the page"); assert.equal((await (await get("/api/host/page-items", S.host.cookie)).json()).hidden.length, 0);
});

test("Pin to top: two at most, first in their section; hiding a pinned item unpins it", async () => {
  assert.equal((await item("e:auPaid", { pinned: true }, S.host.cookie)).status, 200); assert.equal((await item("e:auPlace", { pinned: true }, S.host.cookie)).status, 200);
  const r = await item("e:auLong", { pinned: true }, S.host.cookie); assert.equal(r.status, 409); assert.equal((await r.json()).code, "pin_limit");
  const up = (await page()).upcoming; assert.equal(up.find((e) => e.id === "auPlace").pinned, 1, "the newest pin first"); assert.equal(up.find((e) => e.id === "auPaid").pinned, 2);
  const j = await (await item("e:auPlace", { hidden: true }, S.host.cookie)).json(); assert.deepEqual(j.pinned, ["e:auPaid"]);
  await item("e:auPlace", { hidden: false }, S.host.cookie); await item("e:auPaid", { pinned: false }, S.host.cookie);
});

test("the host never replies to their own event, a co-host neither; the light invite shows them Manage", async () => {
  const ws = (await (await fetch(srv.base + "/api/db/doc?path=events/rtOpen", { headers: { "x-encore-guest": "1" } })).json()).workspace;
  const reply = (id, cookie) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "h".repeat(32), "x-encore-workspace": ws, cookie }, body: JSON.stringify({ eventId: id, response: "going", name: "Me", email: "me@example.com", code: "CHOST1", createdAt: Date.now() }) });
  let r = await reply("rtOpen", S.host.cookie); assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.code, "own_event"); assert.match(j.manage, /open=rtOpen/);
  r = await reply("auCohost", S.bo.cookie); assert.equal(r.status, 409, "a co-host"); assert.equal((await reply("auCohost", S.nia.cookie)).status, 200, "anyone else replies");
  // the host adding a guest by hand (no guest header) still works
  assert.equal((await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, cookie: S.host.cookie }, body: JSON.stringify({ eventId: "rtOpen", response: "going", name: "Added by hand", createdAt: Date.now() }) })).status, 200);
  // the light invite: Manage for the host, the co-host's own line for Bo, the form for everyone else
  const as = async (id, cookie) => (await get("/e/" + id, cookie)).text();
  let h = await as("auAsk", S.host.cookie); assert.match(h, /<style>#f,\.stick\{display:none!important\}<\/style><script src="\/ownbar\.js(\?v=[\w-]+)?" data-r="host" data-i="auAsk" defer>/);
  h = await as("auCohost", S.bo.cookie); assert.match(h, /data-r="cohost"/); h = await as("auAsk"); assert.doesNotMatch(h, /ownbar\.js|display:none!important\}<\/style>/); assert.ok(h.length < 40000, String(h.length));
  h = await as("auAsk", S.host.cookie); assert.ok(h.length < 40000, "the host's light invite stays small too: " + h.length);
  // the host page tells a co-host which events they co-host
  assert.equal((await page(S.bo.cookie)).upcoming.find((e) => e.id === "auCohost")?.you, "cohost"); assert.ok(!(await page(S.nia.cookie)).upcoming.some((e) => e.you));
  assert.ok((await page(S.host.cookie)).upcoming.every((e) => e.you === "host"));
});

test("browser: the owner sees Manage everywhere, hides, brings back and pins from a card; a guest sees one action each; a hidden event opens by link", { timeout: 300000 }, async (t) => {
  let chromium, devices; try { ({ chromium, devices } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  const as = async (cookie, w) => { const ctx = await br.newContext(w === 390 ? { ...devices["iPhone 13"], serviceWorkers: "block" } : { viewport: { width: 1280, height: 900 }, serviceWorkers: "block" }); ctx.setDefaultTimeout(30000);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
    if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]); }
    const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) p.errs.push(m.text()); }); return p; };
  const visible = (p, sel, re) => p.evaluate(([s, r]) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().height && new RegExp(r).test(e.textContent.trim())).length, [sel, re.source]);
  try { for (const W of [390, 1280]) {
    // ---- the owner ----
    const o = await as(S.host.cookie, W); await o.goto(srv.base + "/@mai-routes"); await o.waitForSelector('#offer .hi-g[data-g="events"] .of-row');
    assert.equal(await visible(o, "#offer a, #offer button", /^Ask to join$/), 0, "never Ask to join on your own events"); assert.ok(await visible(o, "#offer a, #offer button", /^Manage$/) >= 3);
    assert.equal(await o.locator('#offer .hi-g[data-g="events"] > .of-list > .of-row').count(), 3, "3 cards"); const rows = await o.locator("#offer .hi-list > .hi-row").count(); assert.ok(rows > 0 && rows <= 8, "a compact list of up to 8: " + rows);
    assert.match(await o.locator('#offer .hi-g[data-g="events"] .hi-all').innerText(), /^See all \d+$/);
    // the weekly run is one card with its dates
    const run = o.locator('#offer [data-k="e:hiRun1"]'); assert.equal(await run.count(), 1); assert.match(await run.innerText(), /every [A-Z][a-z]+day 8am · next/); assert.equal(await o.locator('#offer [data-k="e:hiRun2"]').count(), 0);
    await run.locator("[data-hi-dates]").click(); assert.equal(await run.locator(".hi-dates a").count(), 3);
    // hide the first card from its More options; it waits in the tray; bring it back
    const first = o.locator('#offer .hi-g[data-g="events"] > .of-list > .of-row').first(), key = await first.getAttribute("data-k"), title = await first.locator(".of-b > b").innerText();
    await first.locator("[data-hi-more]").click(); await o.waitForSelector(".hi-sh"); assert.match(await o.locator(".hi-sh").innerText(), /Pin to top[\s\S]*Hide from my page/);
    for (const b of await o.locator(".hi-sh button, .hi-sh a").all()) assert.ok((await b.boundingBox()).height >= 44);
    await o.locator(".hi-sh [data-o=hide]").click(); await o.waitForSelector(".hi-sh", { state: "detached" }); assert.equal(await o.locator(`#offer [data-k="${key}"]`).count(), 0, "hidden: off the list");
    assert.match(await o.locator("[data-hi-tray]").innerText(), /^Hidden from your page \(1\)$/);
    // a visitor doesn't see it, but its link still opens
    const g = await as("", W); await g.goto(srv.base + "/@mai-routes"); await g.waitForSelector('#offer .hi-g[data-g="events"] .of-row');
    assert.equal(await g.locator(`#offer [data-k="${key}"]`).count(), 0); assert.equal(await g.locator("[data-hi-more], [data-hi-tray], .of-own").count(), 0, "no owner tools for a guest");
    assert.equal(await visible(g, "#offer a, #offer button", /^Manage$/), 0); assert.ok(await visible(g, "#offer a, #offer button", /^I'm in$/) >= 1);
    const evId = key.slice(2), r = await g.goto(srv.base + "/e/" + evId); assert.equal(r.status(), 200); await g.waitForSelector("#f"); assert.ok((await g.locator("body").innerText()).includes(title.slice(0, 20)), "the hidden event opens by its link");
    // the tray brings it back
    await o.click("[data-hi-tray]"); await o.waitForSelector(".hi-sh .hi-tr"); await o.locator('.hi-sh [data-o="show"]').first().click(); await o.waitForFunction(() => !document.querySelector(".hi-sh [data-o=show]"));
    await o.locator(".hi-sh .hi-x").click(); assert.equal(await o.locator(`#offer [data-k="${key}"]`).count(), 1, "back on the page"); assert.equal(await o.locator("[data-hi-tray]").count(), 0);
    // pin one from the compact list: it moves to the top with a Pinned mark
    const last = o.locator("#offer .hi-list > .hi-row").last(), lk = await last.getAttribute("data-k"); await last.locator("[data-hi-more]").click(); await o.locator(".hi-sh [data-o=pin]").click(); await o.waitForSelector(".hi-sh", { state: "detached" });
    assert.equal(await o.locator('#offer .hi-g[data-g="events"] > .of-list > .of-row').first().getAttribute("data-k"), lk); assert.match(await o.locator(`#offer [data-k="${lk}"]`).innerText(), /Pinned/);
    assert.equal((await (await get("/api/public/host/mai-routes")).json()).upcoming.find((e) => e.id === lk.slice(2))?.pinned, 1, "the pin is saved for visitors");
    await item(lk, { pinned: false }, S.host.cookie);
    // See all: a month calendar and type filters
    await o.click('#offer .hi-g[data-g="events"] .hi-all'); await o.waitForSelector(".hi-sh .hi-grid button"); const n0 = await o.locator(".hi-sh .hi-res .hi-row").count(); assert.ok(n0 > 8, String(n0));
    await o.locator(".hi-sh .hi-grid button").first().click(); const n1 = await o.locator(".hi-sh .hi-res .hi-row").count(); assert.ok(n1 >= 1 && n1 < n0, `${n1} of ${n0} on that day`); await o.locator(".hi-sh .hi-x").click();
    // the light invite of your own event: Manage, no reply form, no Ask to join bar
    // your own event's page (the light invite hands a signed-in host to the full invite): Manage, no reply form, no Ask to join bar, no Report
    await o.goto(srv.base + "/e/auAsk"); await o.waitForSelector(".pl-own, body.g-own #geBar"); await o.waitForTimeout(600);
    assert.ok(await visible(o, "a, button", /^Manage$/) >= 1, "Manage on your own event"); assert.equal(await visible(o, "a, button", /^Ask to join$/), 0); assert.equal(await visible(o, "a, button", /^Report$/), 0);
    // a guest's light invite of the same event: Ask to join
    await g.goto(srv.base + "/e/auAsk"); await g.waitForSelector("#f"); assert.equal(await g.locator(".pl-own").count(), 0);
    // Arrange mode: Hidden, then Events and items: hide one, it leaves the page and the tray counts it; bring it back
    await o.goto(srv.base + "/@mai-routes?arrange=1"); await o.waitForSelector(".pla-dock .pla-hid"); await o.waitForSelector('#offer .hi-g[data-g="events"] .of-row');
    await o.click(".pla-dock .pla-hid"); await o.click(".pla-sheet [data-items]"); await o.waitForSelector(".hi-sh .hi-tr"); assert.match(await o.locator(".hi-sh").innerText(), /Coming up[\s\S]*Order ahead[\s\S]*Book me[\s\S]*Past/i);
    const tr = o.locator('.hi-sh .hi-tr[data-key="e:auLong"]'); await tr.locator("[data-o=hide]").click(); await o.waitForSelector('.hi-sh .hi-tr[data-key="e:auLong"] [data-o=show]');
    assert.equal(await o.locator('#offer [data-k="e:auLong"]').count(), 0); await o.locator('.hi-sh .hi-tr[data-key="e:auLong"] [data-o=show]').click(); await o.waitForSelector('.hi-sh .hi-tr[data-key="e:auLong"] [data-o=hide]');
    await o.locator(".hi-sh .hi-x").click(); assert.equal(await o.locator('#offer [data-k="e:auLong"]').count(), 1);
    assert.deepEqual(o.errs, []); assert.deepEqual(g.errs, []); await o.context().close(); await g.context().close(); } }
  finally { await br.close(); }
});
