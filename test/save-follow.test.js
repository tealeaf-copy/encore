// Save to list and Follow, in place. Server: the sheet (server/library.js), marks for filled buttons, the follow endpoint
// (server/fanclub.js) with "Notify me when they join" for preview pages (server/interest.js). Client: public/savelist.js,
// public/follow.js and the follow handlers on cards (never navigate). A browser pass (skipped without Playwright) taps
// through the real pages: no navigation, Undo, the menu, the bell, signed-out return, the sheet.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";

let srv, mai, lee;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const del = (p, cookie) => fetch(srv.base + p, { method: "DELETE", headers: { cookie } });
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const src = (f) => fs.readFileSync(new URL("../public/" + f, import.meta.url), "utf8");

before(async () => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "save-follow-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "100"; process.env.ENCORE_FAKE_EMAIL = "1";
  srv = await startServer(); mai = await join("Mai Pham", "mai.sf@example.com"); lee = await join("Lee Tran", "lee.sf@example.com");
  assert.equal((await post("/api/host/profile", { handle: "mai-sf", name: "Mai's Supper Club", city: "Brooklyn", tagline: "Small dinners for new friends.", emoji: "🍜" }, mai)).status, 200);
  await fetch(srv.base + "/api/db/doc?path=events/sfOpen", { method: "PUT", headers: { ...J, cookie: mai }, body: JSON.stringify({ kind: "social", casual: true, activity: "dinner", name: "Dumpling night", date: day(6), startTime: "19:00", city: "Brooklyn", meetPoint: "Bed-Stuy", headcount: 8, published: true, discoverable: true, unlisted: false }) }); });
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "save-follow-secret"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const sheet = (item, body, c = lee) => post("/api/me/library/sheet", { item, ...body }, c).then(async (r) => ({ status: r.status, j: await r.json() }));

test("Save to list: add with a new list, remove, the same name again reuses the list, and the Library and marks show it right away", async () => {
  const ev = { kind: "event", ref: "sfOpen", title: "Dumpling night" };
  let r = await sheet(ev, { lists: [], saved: true, newName: "Weekend ideas" }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const id = r.j.created.id; assert.equal(r.j.created.name, "Weekend ideas"); assert.ok(r.j.lists.find((l) => l.id === id).has); assert.equal(r.j.saved, true);
  let lib = await (await get("/api/me/library", lee)).json(); assert.equal(lib.lists.find((l) => l.id === id).count, 1, "the Library has it at once");
  assert.ok((await (await get("/api/me/library/marks", lee)).json()).keys.includes("event:sfOpen"), "the button shows filled");
  // the same name from the sheet adds to that list, it doesn't make a second one
  r = await sheet({ kind: "host", ref: "mai-sf", title: "Mai's Supper Club" }, { lists: [], newName: "weekend ideas" }); assert.equal(r.j.created.id, id);
  lib = await (await get("/api/me/library", lee)).json(); assert.equal(lib.lists.filter((l) => /weekend ideas/i.test(l.name)).length, 1); assert.equal(lib.lists[0].count, 2);
  // remove: lists without it, and not saved
  r = await sheet(ev, { lists: [], saved: false }); assert.equal(r.j.lists.find((l) => l.id === id).has, false); assert.deepEqual(r.j.removed, [id]);
  assert.ok(!(await (await get("/api/me/library/marks", lee)).json()).keys.includes("event:sfOpen"));
  // signed out: 401 with a plain message (the sheet sends them to sign in and back)
  assert.equal((await post("/api/me/library/sheet", { item: ev, lists: [] })).status, 401);
});

test("Save to list works for a preview (showcase) host, a collection and a drop", async () => {
  let r = await sheet({ kind: "host", ref: "atbo", title: "Atelier Bò" }, { lists: [], saved: true, newName: "Pottery" }); assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.saved, true);
  const lib = await (await get("/api/me/library", lee)).json(); assert.ok(lib.items.some((i) => i.kind === "host" && i.ref === "atbo"), "the preview host is in the Library");
  r = await sheet({ kind: "collection", ref: "weekend", title: "This weekend" }, { lists: [], newName: "Pottery" }); assert.equal(r.status, 200, JSON.stringify(r.j));
  const L = await (await get("/api/me/library/lists/" + r.j.created.id, lee)).json(); const c = L.items.find((i) => i.kind === "collection"); assert.equal(c.url, "/c/weekend"); assert.equal(c.title, "This weekend");
  r = await sheet({ kind: "drop", ref: "sfOpen", title: "Chili crisp" }, { lists: [r.j.created.id] }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal((await sheet({ kind: "collection", ref: "../x", title: "x" }, { lists: [] })).status, 400, "odd refs are refused");
});

test("Follow in place: follow, the bell off and on, unfollow; counts come back each time", async () => {
  let j = await (await post("/api/me/following/mai-sf", { on: true }, lee)).json(); assert.equal(j.following, true); assert.equal(j.notify, true); assert.equal(j.followers, 1); assert.equal(j.name, "Mai's Supper Club");
  j = await (await post("/api/me/following/mai-sf", { on: true, notify: false }, lee)).json(); assert.equal(j.following, true); assert.equal(j.notify, false);
  let F = await (await get("/api/me/following", lee)).json(); assert.equal(F.hosts.find((h) => h.handle === "mai-sf").notify, false);
  j = await (await post("/api/me/following/mai-sf", { on: true, notify: true }, lee)).json(); assert.equal(j.notify, true);
  j = await (await post("/api/me/following/mai-sf", { on: false }, lee)).json(); assert.equal(j.following, false); assert.equal(j.followers, 0);
  // Undo is the same call again: following twice is still one follow
  await post("/api/me/following/mai-sf", { on: true }, lee); j = await (await post("/api/me/following/mai-sf", { on: true }, lee)).json(); assert.equal(j.followers, 1);
  F = await (await get("/api/me/following", lee)).json(); assert.deepEqual(F.hosts.map((h) => h.handle), ["mai-sf"]);
  assert.equal((await post("/api/me/following/mai-sf", { on: true })).status, 401, "signed out: sign in first");
  assert.equal((await post("/api/me/following/mai-sf", { on: true }, mai)).status, 400, "not your own page");
});

test("A preview page: Follow is 'Notify me when they join', kept until the host claims it, then one email and a real follow", async () => {
  const out0 = fakeOutbox.length;
  let j = await (await post("/api/me/following/le-phin", { on: true }, lee)).json(); assert.equal(j.preview, true); assert.equal(j.waiting, true); assert.equal(j.following, false);
  assert.deepEqual((await (await get("/api/me/following", lee)).json()).waiting, ["le-phin"]);
  j = await (await post("/api/me/following/le-phin", { on: false }, lee)).json(); assert.equal(j.waiting, false); assert.deepEqual((await (await get("/api/me/following", lee)).json()).waiting, []);
  await post("/api/me/following/le-phin", { on: true }, lee); await post("/api/me/following/le-phin", { on: true }, lee);
  assert.equal((await post("/api/me/following/nobody-here-zz", { on: true }, lee)).status, 404);
  assert.equal(fakeOutbox.length, out0, "nobody is emailed before the claim");
  // the host claims the page: Lee hears once, and follows the real page now
  const ph = await join("Phin Le", "phin.sf@example.com"); assert.equal((await post("/api/host/profile", { handle: "le-phin", name: "Lê Phin", city: "Brooklyn" }, ph)).status, 200);
  let mail = null; for (let i = 0; i < 40 && !mail; i++) { await new Promise((r) => setTimeout(r, 50)); mail = fakeOutbox.slice(out0).find((m) => String(m.to).includes("lee.sf@example.com")); }
  assert.ok(mail, "Lee is told"); assert.match(mail.subject, /is on Pottery Lab now/); assert.match(mail.text, /you're following their page now/); assert.doesNotMatch(mail.text, /—/);
  assert.equal(fakeOutbox.slice(out0).filter((m) => String(m.to).includes("lee.sf@example.com")).length, 1, "once");
  let F; for (let i = 0; i < 20; i++) { F = await (await get("/api/me/following", lee)).json(); if (F.hosts.some((h) => h.handle === "le-phin")) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.ok(F.hosts.some((h) => h.handle === "le-phin"), "a follower of the real page"); assert.deepEqual(F.waiting, []);
});

test("Follow buttons never navigate: the feed handler has no location.href, cards use the shared button, and only the avatar and name link to the page", () => {
  const fv = src("feedvisual.js"), i = fv.indexOf('$$("[data-fb-follow]", root)'), block = fv.slice(i, fv.indexOf('$$("[data-fb-dismiss]"', i));
  assert.ok(i > 0); assert.doesNotMatch(block, /location\.href/, "the feed follow handler never navigates"); assert.match(block, /PLFollow\.tap\(b, e\)/); assert.match(block, /PLFollow\?\.tapPerson/);
  assert.doesNotMatch(fv, /data-url="\/@/, "no fallback page link on follow buttons");
  // the rail card: the avatar circle and name are the one link to the profile; Follow is a button beside it
  const fr = fv.slice(fv.indexOf("function followRow"), fv.indexOf("const ideasCard")), card = fr.slice(fr.indexOf("const card = (c) =>"), fr.indexOf("return `<section")); assert.match(card, /<a class="fb-fc-a" href="\$\{esc\(c\.url \|\| "#"\)\}">\$\{ringed\(c, 64\)\}<b>/); assert.equal((card.match(/<a /g) || []).length, 1);
  for (const f of ["hostdir.html", "discover.html", "leaderboard.html", "feed.html"]) { const s = src(f); assert.match(s, /<script src="\/follow\.js"/, f + " loads follow.js"); assert.match(s, /PLFollow\.button\(/, f + " draws the shared button"); assert.doesNotMatch(s, /#follow">Follow/, f + " has no Follow link"); }
  const fj = src("follow.js"); assert.doesNotMatch(fj, /—/); assert.match(fj, /aria-pressed/); assert.match(fj, /aria-live/); assert.match(fj, /min-height:44px/);
  assert.match(fj, /You'll hear when <b>\$\{esc\(name\)\}<\/b> posts something new\./); assert.match(fj, /Notify me when they join/);
  const sl = src("savelist.js"); assert.match(sl, /Saved to <b>/); assert.match(sl, /pl_save/); assert.doesNotMatch(sl, /—/);
  assert.match(src("collections.html"), /savelist\.js/, "the collection pages load the sheet");
});

test("In a browser: Save to list and Follow on real pages, signed in and out", async (t) => {
  let chromium, devices; try { ({ chromium, devices } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  const sam = await join("Sam Ortiz", "sam.sf@example.com"), base = srv.base;
  const ctxOf = async (cookie) => { const ctx = await br.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" }); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
    await ctx.addInitScript(() => { try { localStorage.setItem("pl.interestsSeen", "1"); localStorage.setItem("pl.deckDone", "1"); } catch {} });
    if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }, { name: "encore_in", value: "1", url: base }]); }
    ctx.setDefaultNavigationTimeout(90000); ctx.setDefaultTimeout(45000); return ctx; }; // a busy machine can take 20s for a first page
  const settle = async (p) => { await p.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); await p.waitForTimeout(400); };
  try {
    const ctx = await ctxOf(sam), p = await ctx.newPage(), errs = []; p.on("pageerror", (e) => errs.push(e.message));
    // the sheet: one tap opens it and saves to Saved; a new list adds it and says so with View; a second tap takes it off
    await p.goto(base + "/@atbo"); await settle(p); await p.click("#saveListBtn"); await p.waitForSelector(".psl");
    await p.waitForFunction(() => document.querySelector(".psl [data-saved]")?.getAttribute("aria-checked") === "true");
    await p.fill(".psl-new input", "Weekend ideas"); await p.click(".psl-new button"); await p.waitForSelector('.psl-row[data-name="Weekend ideas"][aria-checked=true]');
    assert.match(await p.locator(".plt").innerText(), /Saved to Weekend ideas/); assert.match(await p.locator(".plt a").getAttribute("href"), /^\/library#list-l[a-f0-9]{10}$/);
    await p.click('.psl-row[data-name="Weekend ideas"]'); await p.waitForSelector('.psl-row[data-name="Weekend ideas"][aria-checked=false]'); assert.match(await p.locator(".plt").innerText(), /Taken off Weekend ideas/);
    await p.click("[data-done]"); assert.equal(await p.locator("#saveListBtn").getAttribute("data-in"), "1", "filled: still in Saved");
    // follow on a card: no navigation, Following with Undo; Undo; the menu with the bell and Unfollow; focus comes back
    await p.goto(base + "/hosts"); await settle(p); for (let i = 0; i < 6 && !(await p.locator('[data-pl-follow="mai-sf"]').count()); i++) { await p.click("#more").catch(() => {}); await p.waitForTimeout(300); }
    const url = p.url(), b = p.locator('[data-pl-follow="mai-sf"]').first(); await b.click();
    await p.waitForFunction(() => document.querySelector('[data-pl-follow="mai-sf"]')?.getAttribute("aria-pressed") === "true"); assert.equal(p.url(), url, "stays put");
    assert.match(await p.locator(".plt").innerText(), /You'll hear when Mai's Supper Club posts something new/); assert.equal(await p.locator(".plt-live").getAttribute("aria-live"), "polite");
    await p.click(".plt-a"); await p.waitForFunction(() => document.querySelector('[data-pl-follow="mai-sf"]')?.getAttribute("aria-pressed") === "false");
    await b.click(); await p.waitForFunction(() => document.querySelector('[data-pl-follow="mai-sf"]')?.getAttribute("aria-pressed") === "true");
    await b.click(); await p.waitForSelector(".plf-menu"); assert.equal(await p.locator(".plf-menu [data-a=bell]").getAttribute("aria-checked"), "true");
    await p.click(".plf-menu [data-a=bell]"); await p.waitForFunction(() => /Notifications off/.test(document.querySelector(".plt")?.textContent || ""));
    assert.equal(await p.evaluate(() => document.activeElement?.dataset?.plFollow), "mai-sf", "focus returns to the button");
    assert.equal((await (await get("/api/me/following", sam)).json()).hosts[0].notify, false);
    await b.click(); await p.click(".plf-menu [data-a=off]"); await p.waitForFunction(() => document.querySelector('[data-pl-follow="mai-sf"]')?.getAttribute("aria-pressed") === "false");
    // a preview host on /hosts: Notify me when they join
    await p.goto(base + "/hosts"); await settle(p); const sc = p.locator('[data-pl-follow="atbo"]').first(); assert.match(await sc.innerText(), /Notify me when they join/); await sc.click();
    await p.waitForFunction(() => document.querySelector('[data-pl-follow="atbo"]')?.getAttribute("aria-pressed") === "true"); assert.match(await p.locator(".plt").innerText(), /We'll email you when Atelier Bò joins/);
    // the host page: arriving at #follow does not follow; it highlights the button with a line
    await p.goto(base + "/@mai-sf#follow"); await settle(p); await p.waitForSelector("#folHint"); assert.equal(await p.locator("#topFollow").getAttribute("aria-pressed"), "false");
    assert.equal((await (await get("/api/me/following", sam)).json()).hosts.length, 0, "no silent follow");
    const fc0 = await p.evaluate(() => +document.getElementById("fc").textContent); await p.click("#topFollow"); await p.waitForFunction((n) => +document.getElementById("fc")?.textContent === n + 1, fc0); assert.equal(await p.locator("#topFollow").getAttribute("aria-pressed"), "true");
    assert.deepEqual(errs, []); await ctx.close();
    // signed out: one tap goes to sign-up with ?next= back here; back signed in, the follow completes once and says so
    const out = await ctxOf(null), q = await out.newPage(); await q.goto(base + "/@mai-sf"); await settle(q); await q.locator("#topFollow").click(); await q.waitForURL(/\/signup/);
    const next = new URL(q.url()).searchParams.get("next"); assert.equal(next, "/@mai-sf?pl_follow=mai-sf"); await out.close();
    const back = await ctxOf(lee), r = await back.newPage(); await post("/api/me/following/mai-sf", { on: false }, lee);
    await r.goto(base + next); await settle(r); await r.waitForFunction(() => /You'll hear when/.test(document.querySelector(".plt")?.textContent || ""));
    assert.equal(new URL(r.url()).search, "", "the param is gone, so a reload doesn't do it again"); assert.ok((await (await get("/api/me/following", lee)).json()).hosts.some((h) => h.handle === "mai-sf"));
    // signed out Save to list: the sheet offers sign-in with ?next= and ?pl_save=, which reopens the sheet
    const o2 = await ctxOf(null), s2 = await o2.newPage(); await s2.goto(base + "/@atbo"); await settle(s2); await s2.click("#saveListBtn"); await s2.waitForSelector(".psl a");
    const nx = new URL(base + (await s2.locator(".psl a").first().getAttribute("href"))).searchParams.get("next"); assert.equal(nx, "/@atbo?pl_save=host%3Aatbo"); await o2.close();
    await r.goto(base + nx); await r.waitForSelector(".psl"); assert.match(await r.locator(".psl").innerText(), /Atelier Bò/); await back.close();
  } finally { await br.close(); }
});

test("Every host page has one control in its header: Follow or Following, Notify me when they join, or Edit page", async (t) => {
  let chromium, devices; try { ({ chromium, devices } = createRequire(import.meta.url)("playwright")); } catch { return t.skip("no playwright"); }
  let br; try { br = await chromium.launch(); } catch { return t.skip("no browser"); }
  const base = srv.base, viewer = await join("Vi Nguyen", "vi.sf@example.com");
  // one host of each kind: no events yet, a fan club, a brand kit, a drop, brand-bookable, and a claimed preview page
  const mk = async (name, email, handle, extra = {}) => { const c = await join(name, email); assert.equal((await post("/api/host/profile", { handle, name, city: "Brooklyn", ...extra }, c)).status, 200); return c; };
  const ev = (c, id) => fetch(base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, name: "Cooking night", date: day(5), startTime: "18:00", city: "Brooklyn", published: true, discoverable: true }) });
  await mk("Kevin Wu", "kevin.sf@example.com", "kevin-sf");
  const club = await mk("Cara Club", "cara.sf@example.com", "cara-sf"); await ev(club, "sfClub"); await post("/api/host/club", { on: true, name: "Cara's regulars" }, club);
  const kit = await mk("Kit Lam", "kit.sf@example.com", "kit-sf"); await post("/api/host/brandkit", { starter: "florist", fromStarter: true }, kit);
  const drop = await mk("Dee Bakes", "dee.sf@example.com", "dee-sf"); await post("/api/host/drops", { title: "Pandan this Saturday", items: [{ name: "Pandan cake", price: "18" }], slots: ["Sat 9 to 10am"], area: "Midtown", address: "1 Main St, Brooklyn", always: true, pay: "pickup" }, drop);
  await mk("Bea Books", "bea.sf@example.com", "bea-sf", { forHire: true, experiences: [{ name: "Dumpling class for your team", price: "$60", min: 8, max: 30 }] });
  await mk("Ken Bakes", "ken.sf@example.com", "ken"); // a claimed preview page
  const want = { "kevin-sf": /^Follow/, "mai-sf": /^Follow/, "cara-sf": /^Follow/, "kit-sf": /^Follow/, "dee-sf": /^Follow/, "bea-sf": /^Follow/, ken: /^Follow/, "le-phin": /^Follow/,
    atbo: /^Notify me when they join/, tram: /^Notify me when they join/, anhdraws: /^Notify me when they join/, "yan-drawing": /^Notify me when they join/, tuongvan: /^(Follow|Notify me when they join)/ };
  const control = (p) => p.evaluate(() => { const L = [...document.querySelectorAll("[data-head-act]")]; const el = L[0]?.firstElementChild; const r = el?.getBoundingClientRect();
    return { n: L.length, text: (el?.querySelector(".plf-t") || el)?.textContent.trim() || "", h: r ? Math.round(r.height) : 0, shown: !!r && r.width > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none" }; });
  const ready = (p) => p.waitForFunction(() => document.querySelector("[data-head-act]"), null, { timeout: 8000 }).catch(() => {});
  try {
    for (const width of [390, 1280]) {
      const ctx = await br.newContext({ ...(width === 390 ? devices["iPhone 13"] : { viewport: { width, height: 900 } }), serviceWorkers: "block" }); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
      const [k, ...v] = viewer.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }, { name: "encore_in", value: "1", url: base }]); ctx.setDefaultNavigationTimeout(90000); ctx.setDefaultTimeout(45000); const p = await ctx.newPage();
      for (const [handle, re] of Object.entries(want)) { await p.goto(base + "/@" + handle); await ready(p);
        const c = await control(p); assert.equal(c.n, 1, `${handle} at ${width}: one header control`); assert.match(c.text, re, `${handle} at ${width}: ${c.text}`); assert.ok(c.shown && c.h >= 44, `${handle} at ${width}: shown, 44px (${c.h})`); }
      // following shows it, and the count moves in place
      await p.goto(base + "/@kevin-sf"); await p.waitForSelector("#topFollow"); const n0 = await p.evaluate(() => +document.getElementById("fc").textContent);
      await p.click("#topFollow"); await p.waitForFunction(() => document.getElementById("topFollow").getAttribute("aria-pressed") === "true"); assert.equal(await p.evaluate(() => +document.getElementById("fc").textContent), n0 + 1);
      await p.reload(); await p.waitForSelector("#topFollow"); await p.waitForTimeout(400); assert.match((await control(p)).text, /^Following/, "following shows after a reload");
      await p.click("#topFollow"); await p.click(".plf-menu [data-a=off]"); await p.waitForFunction(() => document.getElementById("topFollow").getAttribute("aria-pressed") === "false"); assert.equal(await p.evaluate(() => +document.getElementById("fc").textContent), n0);
      await ctx.close();
      // the host on their own page: Edit page, no Follow; signed out: Follow
      const own = await br.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" }); own.setDefaultNavigationTimeout(90000); const [k2, ...v2] = club.split("="); await own.addCookies([{ name: k2, value: v2.join("="), url: base }, { name: "encore_in", value: "1", url: base }]);
      const o = await own.newPage(); await o.goto(base + "/@cara-sf"); await ready(o); let c = await control(o); assert.equal(c.n, 1); assert.equal(c.text, "Edit page"); assert.equal(await o.locator("[data-pl-follow='cara-sf']:visible").count(), 0); await own.close();
      const out = await br.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" }); out.setDefaultNavigationTimeout(90000); const q = await out.newPage(); await q.goto(base + "/@kevin-sf"); await q.waitForSelector("#topFollow"); c = await control(q); assert.equal(c.n, 1); assert.equal(c.text, "Follow"); await out.close();
    }
  } finally { await br.close(); }
});
