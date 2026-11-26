// Loads every user-facing page in a real browser, signed out, as a host and as a guest, and fails on what a person
// would hit: a script error, a console error, a same-origin request that failed, sideways scroll on a phone, or an empty
// page. Not part of npm test (it needs Chromium). Run: node scripts/crawl-pages.mjs [--width 390] [--only /feed]
// It starts its own server on a scratch data dir, seeds it with test/routes-seed.js, and prints one line per problem.
// With --apis it also prints every /api GET the pages made, so test/routes-smoke.test.js can list them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedRoutes, pagesFor } from "../test/routes-seed.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WIDTH = +arg("--width", 390), ONLY = arg("--only", ""), SHOW_APIS = process.argv.includes("--apis");
let pw; try { pw = await import("playwright"); } catch { const g = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); pw = g; }

Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "crawl-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1", ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "500" });
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
    await page.close();
  }
  await ctx.close();
}
await browser.close(); server.closeAllConnections?.(); server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true });
if (SHOW_APIS) console.log([...apis].sort().join("\n"));
console.log(problems.length ? problems.join("\n") : "");
console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"} at ${WIDTH}px`);
process.exit(problems.length ? 1 : 0);
