// Loads every user-facing page in a real browser, signed out, as a host and as a guest, and fails on what a person
// would hit: a script error, a console error, a same-origin request that failed, sideways scroll on a phone, or an empty
// page. Not part of npm test (it needs Chromium). Run: node scripts/crawl-pages.mjs [--width 390] [--only /feed] [--no-flows]
// It starts its own server on a scratch data dir, seeds it with test/routes-seed.js, and prints one line per problem.
// With --apis it also prints every /api GET the pages made, so test/routes-smoke.test.js can list them.
// Each page also fails on: an unhandled promise rejection, a layout shift spike (CLS over 0.25), a calm loader still
// up 4 seconds after the page went quiet (a stuck spinner), and a page that keeps rewriting itself while idle (over
// 40 DOM changes a second, the /g bug). Then the flows: tap through the primary nav and back (the page must come back
// where it was), open the + sheet, the share sheet and the reply form.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedRoutes, pagesFor } from "../test/routes-seed.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WIDTH = +arg("--width", 390), ONLY = arg("--only", ""), SHOW_APIS = process.argv.includes("--apis"), FLOWS = !process.argv.includes("--no-flows"), SHOW_CLS = process.argv.includes("--cls"), shifts = []; // --cls also lists every page over 0.1 (the target), without failing on it
const CLS_SPIKE = 0.25, STUCK_MS = 4000, CHURN_PER_S = 40;
// installed before any page script: layout shifts, unhandled rejections and DOM changes, read back after load
const WATCH = () => { const W = (window.__crawl = { cls: 0, rejections: [], mut: 0 });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) W.cls += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch {}
  addEventListener("unhandledrejection", (e) => W.rejections.push(String(e.reason?.message || e.reason).slice(0, 160)));
  const go = () => new MutationObserver((l) => { W.mut += l.length; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  if (document.documentElement) go(); else addEventListener("DOMContentLoaded", go); };
let pw; try { pw = await import("playwright"); } catch { const g = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); pw = g; }

Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "crawl-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1", ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_VERIFY_EMAIL: "0" });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-crawl-")), store = openStore(path.join(dir, "crawl.db"));
const app = createApp({ store, dataDir: dir }), server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const S = await seedRoutes(base);
const roles = { out: null, host: S.host.cookie, guest: S.guest.cookie, admin: S.admin.cookie };
const browser = await pw.chromium.launch();
const problems = [], apis = new Set();
for (const [role, cookie] of Object.entries(roles)) {
  const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], viewport: { width: WIDTH, height: 844 }, serviceWorkers: "block" });
  if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }]); }
  await ctx.addInitScript(WATCH);
  // no internet here: third-party requests (Google Fonts a page may still ask for) answer empty, so they never count
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
  for (const P of pagesFor(S)) {
    if (ONLY && !P.path.startsWith(ONLY)) continue;
    if (P.as && P.as !== role) continue;
    if (role === "admin" && !P.as) continue; // the admin only adds the admin pages
    const page = await ctx.newPage(), bad = (what) => problems.push(`${role.padEnd(5)} ${P.path}  ${what}`);
    page.on("pageerror", (e) => bad("pageerror: " + String(e.message || e).split("\n")[0].slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) bad("console: " + m.text().slice(0, 160)); });
    page.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(base) && !/net::ERR_ABORTED/.test(r.failure()?.errorText || "")) bad(`request failed: ${u.slice(base.length)} ${r.failure()?.errorText}`); });
    page.on("response", (r) => { const u = r.url(); if (!u.startsWith(base)) return; const p = u.slice(base.length); if (r.request().method() === "GET" && p.startsWith("/api/") && !/\/api\/db\/events|\/api\/track/.test(p)) apis.add(`${role === "out" ? "out " : role} ${p}`);
      if (r.status() >= 400 && !(u === base + P.path && P.status === r.status())) bad(`${r.status()} ${r.request().method()} ${p.slice(0, 120)}`); });
    let resp; try { resp = await page.goto(base + P.path, { waitUntil: "load", timeout: 20000 }); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(400); }
    catch (e) { bad("load: " + e.message.split("\n")[0]); await page.close(); continue; }
    const want = P.status || 200;
    if (resp && resp.status() !== want && !(resp.status() === 404 && P.as)) bad(`status ${resp.status()} (wanted ${want})`);
    const m = await page.evaluate(() => { const de = document.documentElement, main = document.querySelector("main,[role=main],#app,.app,body");
      const text = (main?.innerText || "").replace(/\s+/g, " ").trim();
      const wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""));
      return { scroll: de.scrollWidth - innerWidth, text: text.length, wide }; }).catch((e) => ({ err: e.message }));
    if (m.err) bad("eval: " + m.err);
    else { if (m.scroll > 1) bad(`sideways scroll ${m.scroll}px at ${WIDTH} (${m.wide.join(", ")})`); if (m.text < 20 && !P.status) bad(`empty main (${m.text} chars)`); }
    await health(page, bad);
    await page.close();
  }
  await ctx.close();
}
// after a page settles: layout shifts, rejections, a loader still up, and a page that keeps rewriting itself
async function health(page, bad) {
  const a = await page.evaluate(() => ({ ...window.__crawl })).catch(() => null); if (!a) return;
  if (a.cls > CLS_SPIKE) bad(`layout shift spike: CLS ${a.cls.toFixed(3)}`);
  if (SHOW_CLS && a.cls > 0.1) shifts.push(`${page.url().replace(/^https?:\/\/[^/]+/, "")}  CLS ${a.cls.toFixed(3)}`);
  for (const r of new Set(a.rejections)) bad("unhandled rejection: " + r);
  const m0 = a.mut; await page.waitForTimeout(2000); const m1 = await page.evaluate(() => window.__crawl.mut).catch(() => m0);
  if ((m1 - m0) / 2 > CHURN_PER_S) bad(`the page keeps rewriting itself while idle: ${Math.round((m1 - m0) / 2)} DOM changes a second`);
  const stuck = async () => page.evaluate(() => [...document.querySelectorAll(".plc,[data-calm-loader]")].some((n) => n.getBoundingClientRect().height > 0)).catch(() => false);
  if (await stuck()) { await page.waitForTimeout(STUCK_MS); if (await stuck()) bad(`a loader is still up ${STUCK_MS / 1000}s after the page went quiet`); }
}
// ---- flows: the nav and back, the main sheets ----
async function flows() {
  const out = [], role = (r) => (r === "host" ? S.host.cookie : r === "guest" ? S.guest.cookie : null);
  const open = async (r, p) => { const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], viewport: { width: WIDTH, height: 844 }, serviceWorkers: "block" }); const c = role(r); if (c) { const [k, ...v] = c.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }]); }
    await ctx.addInitScript(WATCH); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: "" })); const page = await ctx.newPage(), bad = (w) => out.push(`${r.padEnd(5)} ${p}  ${w}`);
    page.on("pageerror", (e) => bad("pageerror: " + String(e.message || e).split("\n")[0].slice(0, 160))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) bad("console: " + m.text().slice(0, 160)); });
    page.on("requestfailed", (q) => { const u = q.url(); if (u.startsWith(base) && !/net::ERR_ABORTED/.test(q.failure()?.errorText || "")) bad(`request failed: ${u.slice(base.length)}`); });
    page.on("response", (x) => { if (x.url().startsWith(base) && x.status() >= 500) bad(`${x.status()} ${x.request().method()} ${x.url().slice(base.length, base.length + 120)}`); });
    await page.goto(base + p, { waitUntil: "load", timeout: 20000 }).catch((e) => bad("load: " + e.message.split("\n")[0])); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(400);
    return { ctx, page, bad }; };
  // a sheet the page opens by itself (the feed's "Would you go?" deck for a new account) is closed first, the way a person would
  const dismiss = async (page) => { for (let i = 0; i < 3; i++) { const open = await page.evaluate(() => [...document.querySelectorAll('[role=dialog][aria-modal=true],dialog[open]')].some((d) => d.getBoundingClientRect().height > 40)).catch(() => false); if (!open) return;
    const x = page.locator('[role=dialog] [aria-label^="Close"], [role=dialog] button[aria-label*="close" i]').filter({ visible: true }).first(); if (await x.count()) await x.click({ timeout: 2000 }).catch(() => {}); else await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
  const sheet = async (page) => page.waitForFunction(() => [...document.querySelectorAll('[role=dialog],dialog[open],.sheet,.sk-sheet')].some((d) => d.getBoundingClientRect().height > 40), null, { timeout: 5000 }).then(() => true, () => false);
  // the primary nav, tapped in turn, then back: the first page returns at the scroll it was left at
  for (const r of ["out", "host"]) {
    const { ctx, page, bad } = await open(r, "/feed"); await dismiss(page);
    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll(".es-tabs a[href], nav.es-tabs a[href], .es-rail a[href], header.top nav.tabs a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !/^\/(api|logout)|#/.test(h)))].slice(0, 7)).catch(() => []);
    if (!links.length) bad("no primary nav links found");
    for (const h of links) {
      await page.evaluate(() => scrollTo(0, 600)); await page.waitForTimeout(150); const y0 = await page.evaluate(() => scrollY), from = page.url();
      const a = page.locator(`.es-tabs a[href="${h}"], .es-rail a[href="${h}"], header.top nav.tabs a[href="${h}"]`).filter({ visible: true }).first();
      if (!(await a.count())) continue; await dismiss(page);
      await Promise.all([page.waitForLoadState("load", { timeout: 20000 }).catch(() => {}), a.click({ timeout: 5000 }).catch((e) => bad(`tap ${h}: ${e.message.split("\n")[0]}`))]); await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(300);
      await health(page, (w) => bad(`after tapping ${h}: ${w}`));
      if (page.url() !== from) { await page.goBack({ waitUntil: "load", timeout: 20000 }).catch((e) => bad(`back from ${h}: ${e.message.split("\n")[0]}`)); await page.waitForTimeout(900);
        await dismiss(page); if (page.url() !== from) bad(`back from ${h} landed on ${page.url().slice(base.length)}`);
        else { const y1 = await page.evaluate(() => scrollY); if (y0 > 100 && Math.abs(y1 - y0) > 200) bad(`back from ${h}: scroll ${y0} came back as ${y1}`); } }
    }
    await ctx.close();
  }
  // the + sheet on the feed, signed in
  { const { ctx, page, bad } = await open("host", "/feed"); await dismiss(page); const b = page.locator('[aria-label="Create"]').filter({ visible: true }).first();
    if (!(await b.count())) bad("no + (Create) button"); else { await b.click().catch((e) => bad("tap +: " + e.message.split("\n")[0])); if (!(await sheet(page))) bad("the + sheet didn't open"); else await health(page, (w) => bad("+ sheet: " + w)); } await ctx.close(); }
  // the share sheet on an invite (?share=1 opens it). As a guest: the host's own /e/ link hands off to the full invite
  { const { ctx, page, bad } = await open("out", `/e/${S.open}?share=1`); if (!(await sheet(page))) bad("the share sheet didn't open"); else await health(page, (w) => bad("share sheet: " + w)); await ctx.close(); }
  // the reply form on the light invite: I'm in, then the form shows its Send button
  { const { ctx, page, bad } = await open("out", `/e/${S.open}`); const going = page.locator('input[name="r"][value="going"]').first();
    if (!(await going.count())) bad("no I'm in choice on the invite"); else { await going.check({ force: true }).catch((e) => bad("I'm in: " + e.message.split("\n")[0])); const send = page.locator("#send"); if (!(await send.isVisible().catch(() => false))) { await send.scrollIntoViewIfNeeded().catch(() => {}); } if (!(await send.count())) bad("the reply form has no Send button"); }
    await health(page, (w) => bad("reply form: " + w)); await ctx.close(); }
  return out;
}
if (FLOWS && !ONLY) problems.push(...(await flows()));
await browser.close(); server.closeAllConnections?.(); server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true });
if (SHOW_APIS) console.log([...apis].sort().join("\n"));
if (SHOW_CLS) console.log(shifts.length ? "over 0.1 (the target), not counted as problems:\n" + shifts.join("\n") : "no page over CLS 0.1");
console.log(problems.length ? problems.join("\n") : "");
console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"} at ${WIDTH}px`);
process.exit(problems.length ? 1 : 0);
