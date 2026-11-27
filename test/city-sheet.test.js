// The one city picker (public/place.js) on a phone: Discover's city button and the feed's "Showing ..." chip open the
// same sheet: Use my location, recent cities, cities with events, Anywhere, then search. A pick applies at once,
// closes the sheet, is remembered across pages and reloads, and the feed updates in place. Needs Chromium (skips without).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";

let srv, chromium, browser, host;
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "city-sheet-secret", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_FAKE_EMAIL: "1" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
before(async () => {
  try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { return; }
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Mai Pham", email: "mai.sheet@example.com", password: "long-password-1", mode: "friends" }) });
  host = { cookie: r.headers.get("set-cookie").split(";")[0] };
  for (const [id, city] of [["shA", "Brooklyn"], ["shB", "Brooklyn"], ["shC", "Austin"]]) await fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie: host.cookie }, body: JSON.stringify({ name: "Supper " + id, activity: "dinner", kind: "social", casual: true, discoverable: true, published: true, date: day(4), city }) });
  try { browser = await chromium.launch(); } catch { browser = null; }
});
after(async () => { await browser?.close(); if (srv) { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); } });

async function phone(cookie) {
  const pw = createRequire(import.meta.url)("playwright");
  const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], serviceWorkers: "block" });
  await ctx.addInitScript(() => { try { localStorage.setItem("pl.deckDone", "1"); localStorage.setItem("pl.interestsSeen", "1"); if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("encore.recentCities", JSON.stringify(["Lisbon", "Austin"])); } } catch {} });
  await ctx.grantPermissions(["geolocation"], { origin: srv.base }); await ctx.setGeolocation({ latitude: 37.78, longitude: -122.41 });
  ctx.setDefaultTimeout(90000); // the suite runs files in parallel; a busy machine is slow, not broken
  if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: srv.base }, { name: "encore_in", value: "1", url: srv.base }]); }
  return ctx;
}
const sheetInfo = (page) => page.evaluate(() => { const s = document.querySelector(".pls"); if (!s) return null; const t = (sel) => [...s.querySelectorAll(sel)].map((b) => b.textContent.trim());
  const small = [...s.querySelectorAll("button,input")].filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map((b) => b.className + ":" + b.textContent.trim());
  return { recent: t('[data-sec="recent"] [data-city]'), events: t('[data-sec="events"] [data-city]'), any: t('.pls-any [data-city]'), gps: !!s.querySelector(".pls-gps"), search: !!s.querySelector('.pls-search input[type="search"]'), selects: s.querySelectorAll("select,datalist").length, small, bottom: Math.round(innerHeight - s.getBoundingClientRect().bottom) }; });

test("Discover: one tap opens the sheet; chips apply at once; Anywhere and the choice are remembered", async (t) => {
  if (!browser) return t.skip("no playwright");
  const ctx = await phone(), page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(srv.base + "/discover", { waitUntil: "load", timeout: 120000 }); await page.waitForFunction(() => document.querySelector("#locBtn")?.onclick);
  await page.click("#locBtn"); await page.waitForSelector(".pls [data-sec=events] [data-city]");
  const s = await sheetInfo(page);
  assert.deepEqual(s.recent, ["Lisbon", "Austin"], "recent cities first");
  assert.ok(s.events.some((x) => /^Brooklyn/.test(x)), "cities with events: " + s.events.join());
  assert.ok(!s.events.some((x) => /^Austin/.test(x)), "a recent city isn't shown twice");
  assert.deepEqual(s.any, ["Anywhere"]); assert.ok(s.gps); assert.ok(s.search); assert.equal(s.selects, 0, "no select or datalist");
  assert.deepEqual(s.small, [], "every target is 44px or taller"); assert.ok(s.bottom <= 1, "a bottom sheet on a phone");
  // a chip applies at once and closes; focus goes back to the city button
  await page.click('.pls [data-sec="recent"] [data-city="Austin"]');
  assert.equal(await page.$(".pls"), null); assert.equal((await page.textContent("#locName")).trim(), "Austin");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "locBtn");
  // Anywhere sticks across a reload (it used to be overwritten by the workspace city)
  await page.click("#locBtn"); await page.click('.pls-any [data-city=""]');
  assert.equal((await page.textContent("#locName")).trim(), "Anywhere");
  await page.reload({ waitUntil: "load", timeout: 120000 }); await page.waitForFunction(() => document.querySelector("#locBtn")?.onclick); assert.equal((await page.textContent("#locName")).trim(), "Anywhere");
  // search is the last option: suggestions as you type, a tap applies
  await page.click("#locBtn"); await page.fill(".pls-search input", "lis"); await page.click('.pls-sugg [data-city="Lisbon"]');
  assert.equal((await page.textContent("#locName")).trim(), "Lisbon");
  // Escape and a tap outside close it without changing anything
  await page.click("#locBtn"); await page.keyboard.press("Escape"); assert.equal(await page.$(".pls"), null);
  await page.click("#locBtn"); await page.mouse.click(195, 40); assert.equal(await page.$(".pls"), null); assert.equal((await page.textContent("#locName")).trim(), "Lisbon");
  // Use my location: one tap
  await page.click("#locBtn"); await page.click(".pls-gps"); await page.waitForFunction(() => !document.querySelector(".pls"));
  assert.equal((await page.textContent("#locName")).trim(), "Near you · San Francisco");
  const recent = await page.evaluate(() => JSON.parse(localStorage.getItem("encore.recentCities")));
  assert.deepEqual(recent.slice(0, 3), ["San Francisco", "Lisbon", "Austin"]);
  assert.deepEqual(errs, []); await ctx.close();
});

test("Feed: the 'Showing' chip opens the same sheet and the feed updates in place", async (t) => {
  if (!browser) return t.skip("no playwright");
  const ctx = await phone(host.cookie), page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(srv.base + "/feed", { waitUntil: "load", timeout: 120000 }); await page.waitForSelector("#feedPlace .pc-btn");
  assert.match(await page.textContent("#feedPlace .pc-btn"), /Showing .*Change/);
  await page.evaluate(() => { window.__stay = 1; });
  await page.click("#feedPlace .pc-btn"); await page.waitForSelector(".pls"); await page.click('.pls [data-sec="recent"] [data-city="Lisbon"]');
  await page.waitForFunction(() => /Showing Lisbon/.test(document.querySelector("#feedPlace")?.textContent || ""));
  assert.equal(await page.evaluate(() => window.__stay), 1, "no page reload");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("encore.place")).city), "Lisbon");
  assert.deepEqual(errs, []); await ctx.close();
});
