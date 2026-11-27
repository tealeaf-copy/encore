// "Arrange your page" (public/arrange-core.js, public/arrange.js, public/arrange-editor.js, server/pagelayout.js):
// the host reorders their page by touch and drag, hides and brings back sections, picks styles, adds their own blocks,
// undoes and redoes; the draft saves as they go and Done puts it live. Visitors get the live order in the first paint.
// The API half runs everywhere; the browser half needs Playwright's Chromium and skips without it.
// ARRANGE_SHOTS=<dir> also saves the phone drag as a screenshot sequence.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedRoutes, PNG_1PX } from "./routes-seed.js";

let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "arrange-test-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_SIGNUP_PER_HOUR: "500" };
const J = { "content-type": "application/json" };
const call = (method, p, body, cookie) => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
const box = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL("../public/arrange-core.js", import.meta.url), "utf8"), box); const PLL = box.window.PLLayout;
const L0 = () => JSON.parse(JSON.stringify(PLL.defaults()));
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedRoutes(srv.base);
  await call("POST", "/api/host/profile", { bio: "Small dinners for new friends. Eight seats, one long table." }, S.host.cookie); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("only the page's host can read or write its layout: signed out 401, another account 403", async () => {
  const p = `/api/host/layout/${S.handle}`, body = { layout: L0() };
  assert.equal((await call("GET", p)).status, 401); assert.equal((await call("PUT", p, body)).status, 401); assert.equal((await call("POST", p + "/publish", body)).status, 401); assert.equal((await call("DELETE", p)).status, 401);
  assert.equal((await call("GET", p, null, S.guest.cookie)).status, 403); assert.equal((await call("PUT", p, body, S.guest.cookie)).status, 403);
  assert.equal((await call("POST", p + "/publish", body, S.guest.cookie)).status, 403); assert.equal((await call("POST", p + "/suggest", {}, S.guest.cookie)).status, 403);
  assert.equal((await call("PUT", "/api/host/layout/NOT a handle", body, S.host.cookie)).status, 404);
  const j = await (await call("GET", p, null, S.host.cookie)).json(); assert.equal(j.live, null); assert.ok(j.suggested.items.length >= 10); assert.ok(j.kind);
});

test("the allow-list refuses junk: unknown sections, styles and blocks, someone else's photo, http links, too many, twice", async () => {
  const p = `/api/host/layout/${S.handle}`, put = (layout) => call("PUT", p, { layout }, S.host.cookie);
  const other = (await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { "content-type": "image/png", cookie: S.guest.cookie }, body: PNG_1PX })).json()).url;
  const mine = (await (await fetch(srv.base + "/api/assets", { method: "POST", headers: { "content-type": "image/png", cookie: S.host.cookie }, body: PNG_1PX })).json()).url;
  const bad = [{ items: [{ id: "evil" }] }, { items: [{ id: "kudos", v: "marquee" }] }, { items: [{ id: "b-abcdef", type: "script", data: {} }] }, { items: [{ id: "b-abcdef", type: "photo", data: { urls: [other] } }] },
    { items: [{ id: "b-abcdef", type: "photo", data: { urls: ["https://evil.example/x.png"] } }] }, { items: [{ id: "b-abcdef", type: "links", data: { items: [{ label: "x", url: "http://x.example" }] } }] },
    { items: [{ id: "b-abcdef", type: "links", data: { items: [{ url: "javascript:alert(1)" }] } }] }, { items: [{ id: "kudos" }, { id: "kudos" }] }, { items: Array.from({ length: 41 }, (_, i) => ({ id: "b-x" + String(i).padStart(4, "0"), type: "divider" })) },
    { items: [{ id: "kudos", type: "text" }] }, { items: "kudos" }, null, { items: [], cover: "giant" }, { items: [{ id: "b-<img>", type: "text" }] }];
  for (const l of bad) { const r = await put(l); assert.equal(r.status, 400, JSON.stringify(l).slice(0, 80)); assert.equal((await r.json()).code, "bad_layout"); }
  const r = await put({ items: [{ id: "b-ok0001", type: "text", data: { title: "Hi\u0000 there‮", body: "a\n\n\n\nb" + "x".repeat(3000) } }, { id: "b-ok0002", type: "photo", data: { urls: [mine], caption: "Us" } }, { id: "kudos", v: "carousel" }] });
  assert.equal(r.status, 200); const d = (await r.json()).draft; assert.equal(d.items[0].data.title, "Hi there"); assert.equal(d.items[0].data.body.length, 1200); assert.ok(!/\n{3}/.test(d.items[0].data.body)); assert.deepEqual(d.items[1].data.urls, [mine]);
  assert.equal((await call("PUT", p, { layout: { items: [] } }, S.host.cookie)).status, 200, "an empty list is fine: every section comes back in today's order");
});

test("the draft stays private until Done; then visitors get the order in the page's HTML, and reset brings today's page back", async () => {
  const p = `/api/host/layout/${S.handle}`, L = { cover: "slim", items: [{ id: "kudos", v: "carousel" }, { id: "b-note001", type: "quote", v: "big", data: { text: "Best night of the month.", by: "Sam" } }, { id: "about", v: "photo" }, { id: "past", off: true }] };
  assert.equal((await call("PUT", p, { layout: L }, S.host.cookie)).status, 200);
  assert.equal((await (await fetch(srv.base + `/api/public/host/${S.handle}/layout`)).json()).layout, null, "a draft isn't public");
  let html = await (await fetch(srv.base + "/@" + S.handle)).text(); assert.ok(!html.includes("plLayoutCss"), "no layout in the page until it's live");
  const pub = await call("POST", p + "/publish", {}, S.host.cookie); assert.equal(pub.status, 200);
  const live = (await (await fetch(srv.base + `/api/public/host/${S.handle}/layout`)).json()).layout; assert.equal(live.items[0].id, "kudos"); assert.equal(live.cover, "slim");
  html = await (await fetch(srv.base + "/@" + S.handle)).text();
  assert.match(html, /<html lang="en" class="pl-lay plc-slim[^"]*plv-kudos-carousel/); assert.match(html, /<style id="plLayoutCss">/); assert.match(html, /<script type="application\/json" id="plLayout">/);
  assert.match(html, /#kudos\)\{--pl-o:1\}/); assert.match(html, /:is\(#scrapbook,\.s-past,#srChangelog\)\{display:none!important\}/);
  assert.ok(html.indexOf("plLayoutCss") < html.indexOf("</head>"), "the CSS is in <head>, before anything paints");
  assert.equal((await call("DELETE", p, null, S.host.cookie)).status, 200); assert.ok(!(await (await fetch(srv.base + "/@" + S.handle)).text()).includes("plLayoutCss"));
});

test("Potto's suggestion is plain rules from what the host has, and always passes the allow-list", async () => {
  const j = await (await call("POST", `/api/host/layout/${S.handle}/suggest`, {}, S.host.cookie)).json();
  assert.ok(j.layout.items.length >= 10); assert.ok(j.tips.length >= 1); assert.ok(!PLL.check(j.layout).error);
  const lots = PLL.suggest({ photos: 8, kudos: 7, upcoming: 2, activity: "run club", bio: true });
  assert.equal(lots.kind, "run"); const ids = lots.layout.items.map((x) => x.id); assert.equal(ids[0], "nextUp"); assert.equal(ids[1], "photos"); assert.ok(ids.indexOf("kudos") <= 3);
  assert.equal(lots.layout.items.find((x) => x.id === "photos").v, "mosaic"); assert.match(lots.tips[0], /best photo first/);
  const maker = PLL.suggest({ drops: 3, upcoming: 0, photos: 1 }); assert.equal(maker.kind, "maker"); assert.equal(maker.layout.items[0].id, "drops");
  for (const s of PLL.STARTERS) { const L = PLL.starter(s.id); assert.ok(!PLL.check(L).error, s.id); assert.equal(new Set(L.items.map((x) => x.id)).size, L.items.length); }
  for (const f of ["public/arrange-core.js", "public/arrange.js", "public/arrange-editor.js", "server/pagelayout.js"]) { const t = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8"); assert.ok(!t.includes("—"), f + ": no em dashes"); }
});

// ---------------- in a browser ----------------
let pw = null; try { pw = createRequire(import.meta.url)("playwright"); } catch {}
const shots = process.env.ARRANGE_SHOTS || "";
const asHost = async (ctx) => { const [k, ...v] = S.host.cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" })); };
const order = (p) => p.evaluate(() => window.PLArrangeEditor.state.L.items.filter((x) => !x.off).map((x) => x.id));
const said = (p) => p.evaluate(() => new Promise((ok) => setTimeout(() => ok(document.querySelector(".pla-sr")?.textContent || ""), 80)));

test("on a phone: long-press lifts a section, the page scrolls near the edge, the drop lands and is said out loud", { skip: !pw && "no playwright" }, async () => {
  await call("DELETE", `/api/host/layout/${S.handle}`, null, S.host.cookie);
  const browser = await pw.chromium.launch(); const errs = [];
  try { const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 } }); await asHost(ctx);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(srv.base + "/@" + S.handle + "?arrange=1"); await p.waitForSelector('[data-pl-sec="kudos"] .pla-chrome', { timeout: 15000 }); await p.waitForTimeout(800);
    const before0 = await order(p); assert.ok(before0.indexOf("kudos") > 1);
    const cdp = await ctx.newCDPSession(p), touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await p.evaluate(() => document.querySelector('[data-pl-sec="kudos"]').scrollIntoView({ block: "center" })); await p.waitForTimeout(200);
    const at = await p.evaluate(() => { const r = document.querySelector('[data-pl-sec="kudos"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60 }; });
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await p.screenshot({ path: path.join(shots, "drag-1-start.png") }); }
    // a quick swipe is a scroll, not a lift
    await touch("touchStart", at.x, at.y); await touch("touchMove", at.x, at.y - 40); await touch("touchEnd"); assert.ok(!(await p.evaluate(() => document.documentElement.classList.contains("pla-dragging"))));
    await p.waitForTimeout(900); // let the swipe's fling settle: a press during a fling is the browser's to keep scrolling
    await p.evaluate(() => document.querySelector('[data-pl-sec="kudos"]').scrollIntoView({ block: "center" })); await p.waitForTimeout(200);
    Object.assign(at, await p.evaluate(() => { const r = document.querySelector('[data-pl-sec="kudos"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60 }; }));
    await touch("touchStart", at.x, at.y); await p.waitForTimeout(150); assert.ok(!(await p.evaluate(() => document.documentElement.classList.contains("pla-dragging"))), "not lifted before 250ms");
    await p.waitForTimeout(250); assert.ok(await p.evaluate(() => document.documentElement.classList.contains("pla-dragging") && !!document.querySelector(".pla-lifted")), "lifted after a long-press");
    if (shots) await p.screenshot({ path: path.join(shots, "drag-2-lifted.png") });
    let y = at.y; for (let i = 0; i < 10; i++) { y -= 25; await touch("touchMove", at.x, y); await p.waitForTimeout(30); }
    if (shots) await p.screenshot({ path: path.join(shots, "drag-3-moving.png") });
    const s0 = await p.evaluate(() => scrollY); await touch("touchMove", at.x, 30); await p.waitForTimeout(700); const s1 = await p.evaluate(() => scrollY);
    assert.ok(s1 < s0, `auto-scrolls up near the top edge (${s0} -> ${s1}, lifted: ${await p.evaluate(() => document.querySelector(".pla-lifted")?.dataset.plSec)})`);
    if (shots) await p.screenshot({ path: path.join(shots, "drag-4-autoscroll.png") });
    await touch("touchMove", at.x, 250); await p.waitForTimeout(150); await touch("touchEnd"); await p.waitForTimeout(500);
    if (shots) await p.screenshot({ path: path.join(shots, "drag-5-dropped.png") });
    const after0 = await order(p); assert.ok(after0.indexOf("kudos") < before0.indexOf("kudos"), `kudos moved up: ${after0.join(",")}`);
    assert.match(await said(p), /^Kudos moved to position \d+ of \d+\.$/);
    assert.ok(!(await p.evaluate(() => document.documentElement.classList.contains("pla-dragging"))));
    // the draft saved itself
    await p.waitForFunction(() => /Saved/.test(document.querySelector(".pla-status")?.textContent || ""), null, { timeout: 5000 });
    const draft = (await (await call("GET", `/api/host/layout/${S.handle}`, null, S.host.cookie)).json()).draft; assert.deepEqual(draft.items.filter((x) => !x.off).map((x) => x.id), after0);
    // 44px taps on the toolbars
    const small = await p.evaluate(() => [...document.querySelectorAll(".pla-chrome button,.pla-bar button,.pla-dock button")].filter((b) => b.offsetParent && (b.offsetWidth < 44 || b.offsetHeight < 44)).length); assert.equal(small, 0);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, "no sideways scroll");
    assert.deepEqual(errs, []);
  } finally { await browser.close(); }
});

test("at 1280 with a mouse and a keyboard: drag, move up and down, hide and bring back, styles, a new block, undo and redo, autosave, Done; a visitor sees it with no layout shift", { skip: !pw && "no playwright" }, async () => {
  await call("DELETE", `/api/host/layout/${S.handle}`, null, S.host.cookie);
  const browser = await pw.chromium.launch(); const errs = [];
  try { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await asHost(ctx);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(srv.base + "/@" + S.handle); await p.waitForTimeout(1200);
    // the door is in Edit page
    await p.click(".store-fab:not(.shop-fab)"); await p.click(".store-pane .pla-door button"); await p.waitForSelector('[data-pl-sec="past"] .pla-chrome', { timeout: 15000 }); await p.waitForTimeout(600);
    // mouse drag by the grip: Past events above Kudos
    let o = await order(p); const pastAt = o.indexOf("past"), kudosAt = o.indexOf("kudos"); assert.ok(pastAt > kudosAt);
    await p.evaluate(() => document.querySelector('[data-pl-sec="past"]').scrollIntoView({ block: "center" })); await p.waitForTimeout(200);
    const g = await p.locator('[data-pl-sec="past"] .pla-grip').boundingBox(), k = await p.locator('[data-pl-sec="kudos"]').boundingBox();
    await p.mouse.move(g.x + 20, g.y + 20); await p.mouse.down(); await p.mouse.move(g.x + 20, g.y + 30, { steps: 3 });
    assert.ok(await p.evaluate(() => !!document.querySelector(".pla-lifted")));
    const k2 = await p.locator('[data-pl-sec="kudos"]').boundingBox(); await p.mouse.move(g.x + 20, k2.y + 5, { steps: 8 }); await p.waitForTimeout(150); await p.mouse.up(); await p.waitForTimeout(400);
    o = await order(p); assert.ok(o.indexOf("past") < o.indexOf("kudos"), "dragged above Kudos: " + o.join(",")); void k;
    // keyboard: arrows on the grip, and the Move down button, each said out loud
    await p.focus('[data-pl-sec="past"] .pla-grip'); const i0 = (await order(p)).indexOf("past"); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(250);
    assert.equal((await order(p)).indexOf("past"), i0 + 1); assert.match(await said(p), /^Past events moved to position \d+ of \d+\.$/);
    assert.equal(await p.evaluate(() => document.activeElement?.closest("[data-pl-sec]")?.dataset.plSec), "past", "focus stays on the section that moved");
    await p.focus('[data-pl-sec="past"] [data-act="up"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(250); assert.equal((await order(p)).indexOf("past"), i0);
    const pres = await p.evaluate(() => document.querySelectorAll("[data-pl-sec]").length); assert.match(await said(p), new RegExp(`of ${pres}\\.$`));
    // hide, then bring back from the Hidden tray
    await p.click('[data-pl-sec="kudos"] [data-act="hide"]'); await p.waitForTimeout(250); assert.equal(await p.locator("#kudos").isVisible(), false); assert.match(await said(p), /Kudos hidden/);
    await p.click(".pla-hid"); await p.click('.pla-sheet [data-back="kudos"]'); await p.waitForTimeout(250); assert.equal(await p.locator("#kudos").isVisible(), true);
    // styles: Kudos as a carousel, the offer list as cards
    await p.click('[data-pl-sec="kudos"] [data-act="style"]'); assert.ok(await p.evaluate(() => document.documentElement.classList.contains("plv-kudos-carousel")));
    await p.click('[data-pl-sec="offer"] [data-act="style"]'); assert.ok(await p.evaluate(() => document.documentElement.classList.contains("plv-offer-cards")));
    assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#offer .of-row")).gridTemplateColumns.split(" ").length), 1, "cards stack art over words");
    // a text block of their own
    await p.click(".pla-add"); await p.click('.pla-sheet [data-new="text"]'); await p.waitForSelector('.pla-sheet [name="title"]');
    await p.fill('.pla-sheet [name="title"]', "House rules"); await p.fill('.pla-sheet [name="body"]', "Bring a friend. Leave a plate clean."); await p.click(".pla-sheet [data-ok]"); await p.waitForTimeout(300);
    assert.equal(await p.locator('.plb-text h2:has-text("House rules")').count(), 1);
    // undo and redo, keys and buttons
    await p.keyboard.press("Control+z"); await p.waitForTimeout(200); assert.equal(await p.locator('.plb-text h2:has-text("House rules")').count(), 0, "undo");
    await p.keyboard.press("Control+Shift+z"); await p.waitForTimeout(200); assert.equal(await p.locator('.plb-text h2:has-text("House rules")').count(), 1, "redo");
    await p.click(".pla-undo"); await p.waitForTimeout(150); await p.click(".pla-redo"); await p.waitForTimeout(150); assert.equal(await p.locator('.plb-text h2:has-text("House rules")').count(), 1);
    // autosave, then a reload keeps the draft
    await p.waitForFunction(() => /Saved/.test(document.querySelector(".pla-status")?.textContent || ""), null, { timeout: 5000 }); const want = await order(p);
    assert.equal((await (await fetch(srv.base + `/api/public/host/${S.handle}/layout`)).json()).layout, null, "still a draft");
    await p.goto(srv.base + "/@" + S.handle + "?arrange=1"); await p.waitForSelector(".pla-chrome", { timeout: 15000 }); await p.waitForTimeout(500);
    assert.deepEqual(await order(p), want); assert.equal(await p.locator('.plb-text h2:has-text("House rules")').count(), 1);
    // preview as a guest: no chrome
    await p.click(".pla-prev"); assert.equal(await p.locator(".pla-chrome").first().isVisible(), false); await p.click(".pla-prev");
    // Done publishes
    await p.click(".pla-done"); await p.waitForFunction(() => !document.documentElement.classList.contains("pl-arranging"), null, { timeout: 5000 });
    assert.deepEqual((await (await fetch(srv.base + `/api/public/host/${S.handle}/layout`)).json()).layout.items.filter((x) => !x.off).map((x) => x.id), want);
    assert.deepEqual(errs, []);
    // a visitor: the saved order on screen, the block, and no layout shift from it
    for (const width of [390, 1280]) {
      const v = await browser.newContext({ viewport: { width, height: 900 } }); await v.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
      await v.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true }); });
      const q = await v.newPage(); await q.goto(srv.base + "/@" + S.handle); await q.waitForLoadState("networkidle").catch(() => {}); await q.waitForTimeout(1200);
      const seen = await q.evaluate((ids) => { const P = window.PLLayout; return ids.map((id) => { const s = P.BY[id] ? P.BY[id].sel : []; const el = s.flatMap((x) => [...document.querySelectorAll("#m " + x)]).find((e) => e.getClientRects().length); return el ? [id, el.getBoundingClientRect().top] : null; }).filter(Boolean); }, want.filter((id) => PLL.BY[id]));
      for (let i = 1; i < seen.length; i++) assert.ok(seen[i][1] >= seen[i - 1][1], `${width}: ${seen[i - 1][0]} above ${seen[i][0]}`);
      assert.equal(await q.locator('.plb-text h2:has-text("House rules")').count(), 1);
      const cls = await q.evaluate(() => window.__cls); assert.ok(cls < 0.1, `${width}: CLS ${cls.toFixed(3)}`);
      await v.close(); }
  } finally { await browser.close(); }
});
