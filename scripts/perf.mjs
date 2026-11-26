// A repeatable performance pass: loads the key pages in Chromium as an iPhone on a throttled 4G-ish link and prints
// (and with --md, writes) one row per page. Not part of npm test (it needs Chromium). Run:
//   node scripts/perf.mjs [--runs 3] [--only /feed] [--md docs/perf-latest.md] [--json out.json] [--no-throttle]
// It starts its own seeded server (scripts/perf-world.mjs: test/routes-seed.js plus a month of events), and measures:
//   TTFB, FCP, LCP, CLS, the first tap's latency (event timing, an INP stand-in), long tasks on load, JS and CSS bytes
//   on the wire, request count, DOM mutations a second while idle, and page-to-page navigation (tap to the next page's
//   FCP and LCP) with a warm cache, the way someone moving around the app sees it.
// Link: 9 Mbps down, 1.5 Mbps up, 150ms RTT (CDP), 4x CPU slowdown. Third-party requests (Google Fonts) cannot leave this
// sandbox, so they are answered locally after 3 round trips (DNS, TLS, request on a new origin), which is what a
// fresh third-party origin costs on this link.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startWorld } from "./perf-world.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = +arg("--runs", 3), ONLY = arg("--only", ""), MD = arg("--md", ""), JSON_OUT = arg("--json", ""), THROTTLE = !process.argv.includes("--no-throttle");
const RTT = 150, DOWN = 9e6 / 8, UP = 1.5e6 / 8, CPU = 4;
let pw; try { pw = await import("playwright"); } catch { pw = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); }

const W = await startWorld(), base = W.base, S = W.S;
const ok = async (p, cookie) => (await fetch(base + p, { redirect: "manual", headers: cookie ? { cookie } : {} })).status === 200;

// what each page is, as whom. `then` runs after load (the create canvas opens from the app).
const PAGES = [
  { name: "/ (signed out feed)", path: "/", as: "out" },
  { name: "/feed", path: "/feed", as: "host" },
  { name: "/discover", path: "/discover", as: "host" },
  ...((await ok("/map", S.host.cookie)) ? [{ name: "/map", path: "/map", as: "host" }] : []),
  { name: "/plans", path: "/plans", as: "host" },
  { name: "/people", path: "/people", as: "host" },
  { name: "/@host", path: `/@${S.handle}`, as: "out" },
  { name: "/e/<id> (invite)", path: `/e/${S.open}`, as: "out" },
  { name: "/chats", path: "/chats", as: "host" },
  { name: "/chats/<id>", path: `/chats/${S.open}`, as: "host" },
  { name: "/settings", path: "/settings", as: "host" },
  { name: "/about", path: "/about", as: "out" },
  { name: "/g#rsvp (full invite)", path: `/g#rsvp-${S.open}`, as: "out" },
  { name: "/g#rsvp (replied guest)", path: `/g#rsvp-${S.open}`, as: "guest" },
  { name: "/?app=1 (app)", path: "/?app=1", as: "host" },
  // the create canvas: tap to the title field on screen (public/canvas.js), reported as "open" ms
  { name: "create canvas", path: "/?app=1", as: "host", then: async (page) => { await page.waitForFunction(() => window.EventCanvas?.open, null, { timeout: 15000 }).catch(() => {}); return page.evaluate(() => new Promise((r) => { const t0 = performance.now(); try { window.EventCanvas.open({ mode: "new" }); } catch { return r(null); } const tick = () => { const el = document.getElementById("cvTitle"); if (el && el.getBoundingClientRect().height) requestAnimationFrame(() => r(performance.now() - t0)); else if (performance.now() - t0 > 15000) r(null); else setTimeout(tick, 16); }; tick(); })); } },
].filter((P) => !ONLY || P.path.startsWith(ONLY) || P.name.startsWith(ONLY));
// page-to-page moves with a warm cache (the shell pages were opened once before)
const NAVS = [["/feed", "/discover"], ["/discover", "/plans"], ["/plans", "/chats"], ["/chats", "/feed"], ["/feed", `/@${S.handle}`], [`/@${S.handle}`, `/e/${S.open}`], ["/feed", "/people"], ["/feed", "/settings"]];

// collects the page's own numbers; installed before any page script runs
const OBSERVE = () => {
  const M = (window.__perf = { lcp: 0, cls: 0, fcp: 0, longTasks: [], events: [], mutations: 0 });
  const po = (type, fn, extra = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch {} };
  po("largest-contentful-paint", (e) => { M.lcp = e.startTime; M.lcpEl = (e.element?.tagName || "") + (e.element?.className && typeof e.element.className === "string" ? "." + e.element.className.split(" ")[0] : ""); });
  po("layout-shift", (e) => { if (!e.hadRecentInput) M.cls += e.value; });
  po("paint", (e) => { if (e.name === "first-contentful-paint") M.fcp = e.startTime; });
  po("longtask", (e) => M.longTasks.push(Math.round(e.duration)));
  po("event", (e) => { if (e.interactionId) M.events.push({ name: e.name, d: e.duration }); }, { durationThreshold: 16 });
  po("first-input", (e) => M.events.push({ name: e.name, d: e.duration }));
  const start = () => new MutationObserver((l) => { M.mutations += l.length; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  if (document.documentElement) start(); else addEventListener("DOMContentLoaded", start);
};

const browser = await pw.chromium.launch();
async function context(as, { sw = "block" } = {}) {
  const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], serviceWorkers: sw });
  const cookie = as === "host" ? S.host.cookie : as === "guest" ? S.guest.cookie : null;
  if (cookie) { const [k, ...v] = cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }]); }
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => { // no internet here: third parties answer after the round trips a new origin costs
    await new Promise((r) => setTimeout(r, THROTTLE ? RTT * 3 : 0)); const u = route.request().url();
    route.fulfill({ status: 200, contentType: /fonts\.googleapis/.test(u) ? "text/css" : "application/octet-stream", body: "" }); });
  await ctx.addInitScript(OBSERVE);
  return ctx;
}
async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  if (THROTTLE) { await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: RTT, downloadThroughput: DOWN, uploadThroughput: UP }); await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU }); }
  const R = new Map(), bytes = { js: 0, css: 0, html: 0, img: 0, font: 0, other: 0 }; let requests = 0;
  cdp.on("Network.responseReceived", (e) => R.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => { requests++; const t = R.get(e.requestId) || "Other";
    const k = t === "Script" ? "js" : t === "Stylesheet" ? "css" : t === "Document" ? "html" : t === "Image" ? "img" : t === "Font" ? "font" : "other"; bytes[k] += e.encodedDataLength || 0; });
  return { cdp, bytes, reqs: () => requests, reset: () => { requests = 0; for (const k in bytes) bytes[k] = 0; } };
}
const settle = async (page, ms = 1500) => { await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {}); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(ms); };
// the first tap: a plain tap on the page's heading area 600ms after load, measured by the browser's event timing
async function tap(page) {
  const box = await page.evaluate(() => { const el = [...document.querySelectorAll("h1,h2,main p,.title,header")].find((e) => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 8 && r.top > 0 && r.bottom < innerHeight && !e.closest("a,button,[onclick],label"); }); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; }).catch(() => null);
  if (!box) return null; await page.touchscreen.tap(box.x, box.y); await page.waitForTimeout(400);
  return page.evaluate(() => Math.round(Math.max(0, ...window.__perf.events.map((e) => e.d)))).catch(() => null);
}
const median = (a) => { const v = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };

async function loadOnce(P) {
  const ctx = await context(P.as), page = await ctx.newPage(), T = await throttle(page), errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(base + P.path, { waitUntil: "commit", timeout: 30000 }).catch((e) => errors.push(e.message.split("\n")[0]));
  await settle(page);
  const extra = P.then ? await P.then(page).catch(() => null) : null; if (P.then) await page.waitForTimeout(800);
  const m0 = await page.evaluate(() => window.__perf.mutations).catch(() => 0); await page.waitForTimeout(2000); const m1 = await page.evaluate(() => window.__perf.mutations).catch(() => 0);
  const inp = await tap(page);
  const M = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const p = window.__perf; return { ttfb: n ? n.responseStart : 0, fcp: p.fcp, lcp: p.lcp, lcpEl: p.lcpEl, cls: p.cls, longTasks: p.longTasks }; }).catch(() => ({}));
  await ctx.close();
  return { ...M, inp, extra, mutPerSec: Math.round((m1 - m0) / 2), js: T.bytes.js, css: T.bytes.css, html: T.bytes.html, font: T.bytes.font, requests: T.reqs(), longMax: Math.max(0, ...(M.longTasks || [])), longCount: (M.longTasks || []).length, errors };
}
// warm navigation: one context (service worker on), every shell page opened once, then tap-like moves A -> B
async function navigations() {
  const ctx = await context("host", { sw: "allow" }), page = await ctx.newPage(), T = await throttle(page), out = {};
  for (const p of new Set(NAVS.flat())) { await page.goto(base + p, { waitUntil: "load", timeout: 30000 }).catch(() => {}); await settle(page, 300); }
  await page.waitForTimeout(1000);
  for (const [a, b] of NAVS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      await page.goto(base + a, { waitUntil: "load", timeout: 30000 }).catch(() => {}); await settle(page, 400); T.reset();
      const t0 = await page.evaluate(() => performance.timeOrigin + performance.now());
      await page.evaluate((href) => { location.href = href; }, b);
      await page.waitForURL((u) => u.pathname + u.search === new URL(base + b).pathname + new URL(base + b).search, { timeout: 20000 }).catch(() => {});
      await settle(page, 500);
      const r = await page.evaluate((t0) => ({ fcp: performance.timeOrigin + window.__perf.fcp - t0, lcp: performance.timeOrigin + window.__perf.lcp - t0, cls: window.__perf.cls }), t0).catch(() => ({}));
      runs.push({ ...r, requests: T.reqs(), bytes: T.bytes.js + T.bytes.css + T.bytes.html });
    }
    out[`${a} → ${b}`] = { fcp: Math.round(median(runs.map((r) => r.fcp))), lcp: Math.round(median(runs.map((r) => r.lcp))), cls: median(runs.map((r) => r.cls)), requests: median(runs.map((r) => r.requests)), bytes: median(runs.map((r) => r.bytes)) };
  }
  await ctx.close(); return out;
}

const results = {};
for (const P of PAGES) {
  const runs = []; for (let i = 0; i < RUNS; i++) runs.push(await loadOnce(P));
  const k = (f) => median(runs.map(f));
  results[P.name] = { ttfb: Math.round(k((r) => r.ttfb)), fcp: Math.round(k((r) => r.fcp)), lcp: Math.round(k((r) => r.lcp)), cls: +(k((r) => r.cls) || 0).toFixed(3), inp: k((r) => r.inp), longMax: k((r) => r.longMax), longCount: k((r) => r.longCount),
    js: Math.round(k((r) => r.js) / 1024), css: Math.round(k((r) => r.css) / 1024), html: Math.round(k((r) => r.html) / 1024), requests: k((r) => r.requests), mutPerSec: k((r) => r.mutPerSec), lcpEl: runs[0].lcpEl, extra: k((r) => r.extra), errors: [...new Set(runs.flatMap((r) => r.errors))] };
  const R = results[P.name]; console.log(`${P.name.padEnd(24)} ttfb ${R.ttfb} fcp ${R.fcp} lcp ${R.lcp} cls ${R.cls} tap ${R.inp} long ${R.longMax}/${R.longCount} js ${R.js}k css ${R.css}k html ${R.html}k req ${R.requests} mut/s ${R.mutPerSec}${R.extra != null ? " open " + Math.round(R.extra) + "ms" : ""}${R.errors.length ? " ERR " + R.errors.join(" | ") : ""}`);
}
const navs = ONLY ? {} : await navigations();
for (const [k, v] of Object.entries(navs)) console.log(`${k.padEnd(28)} fcp ${v.fcp} lcp ${v.lcp} cls ${(v.cls || 0).toFixed(3)} req ${v.requests} bytes ${Math.round(v.bytes / 1024)}k`);
await browser.close(); W.close();

const table = ["| Page | TTFB | FCP | LCP | CLS | First tap | Longest task (count) | JS KB | CSS KB | HTML KB | Requests | Idle DOM mutations/s |", "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...Object.entries(results).map(([n, r]) => `| ${n} | ${r.ttfb} | ${r.fcp} | ${r.lcp} | ${r.cls} | ${r.inp ?? "-"} | ${r.longMax} (${r.longCount}) | ${r.js} | ${r.css} | ${r.html} | ${r.requests} | ${r.mutPerSec} |`),
  "", "| Navigation (warm) | Tap to FCP | Tap to LCP | CLS | Requests | KB |", "|---|---|---|---|---|---|",
  ...Object.entries(navs).map(([n, r]) => `| ${n} | ${r.fcp} | ${r.lcp} | ${(r.cls || 0).toFixed(3)} | ${r.requests} | ${Math.round(r.bytes / 1024)} |`)].join("\n");
if (MD) fs.writeFileSync(MD, table + "\n");
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ results, navs }, null, 2));
console.log("\n" + table);
process.exit(0);
