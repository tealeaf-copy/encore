// Feed and Discover audit: seeds the states a person can be in (signed out first visit and returning, a new account with
// no follows or friends, an account with friends and follows, a host, a brand team member; cities with lots of events,
// a few, none and Anywhere; long titles; events without covers; a drop) and drives /feed, /, /discover and /map at
// 390 (iPhone 13) and 1280. On every page it checks what a person would hit, then taps every control on every card kind
// once on a fresh page (never a destructive one) and checks what it did. Writes a surface x state x check table.
// Not part of npm test (it needs Chromium). Run: node scripts/crawl-pages.mjs's sibling:
//   node scripts/feed-discover-audit.mjs [--width 390] [--only feed|discover|map|home] [--state new] [--out docs/feed-discover-audit.md] [--shots dir] [--dump]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedRoutes, PNG_1PX } from "../test/routes-seed.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WIDTHS = arg("--width", "") ? [+arg("--width")] : [390, 1280], ONLY = arg("--only", ""), ONLY_STATE = arg("--state", ""), ONLY_TAP = arg("--tap", ""), NO_SCAN = process.argv.includes("--no-scan"), DUMP = process.argv.includes("--dump");
const OUT = arg("--out", "docs/feed-discover-audit.md"), SHOTS = arg("--shots", "");
let pw; try { pw = await import("playwright"); } catch { pw = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); }

Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "audit-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1",
  ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_VERIFY_EMAIL: "0", ENCORE_DIRECTORY_CACHE_MS: "0", ENCORE_FEED_PER_IP_HOUR: "100000" });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-fda-")), store = openStore(path.join(dir, "audit.db"));
const app = createApp({ store, dataDir: dir }), server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- the world ----------
const J = { "content-type": "application/json" };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const cookieOf = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
const keyOf = (em) => Buffer.from(em).toString("base64url");
const post = async (p, body, cookie) => { const r = await fetch(base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) console.warn(`seed: POST ${p} ${r.status} ${j.message || ""}`); return j; };
const put = (p, body, cookie) => fetch(base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const signup = async (name, email, extra = {}) => { const r = await fetch(base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name, email, password: "long-password-1", mode: "friends", ...extra }) }); const j = await r.json(); if (r.status !== 200) throw new Error("signup " + email + " " + JSON.stringify(j)); return { cookie: cookieOf(r), ws: j.workspace?.id, email, name }; };
const LONG = "A very long supper title about rye bread, slow braised greens and the long table by the window that never ends";
async function seedWorld() {
  const S = await seedRoutes(base);
  const ev = (o) => ({ kind: "social", casual: true, activity: "supper", city: "Brooklyn", startTime: "19:00", headcount: 10, published: true, discoverable: true, unlisted: false, ...o });
  // a busy Brooklyn host: many events, a long title, events without covers, a past one with photos
  const theo = await signup("Theo Marsh", "theo.fda@example.com");
  await post("/api/host/profile", { handle: "crumb-fda", name: "Crumb Theory", city: "Brooklyn", hood: "Fort Greene", tagline: "Bread suppers for twelve.", emoji: "🍞" }, theo.cookie);
  for (let i = 0; i < 9; i++) await put(`events/fdaCt${i}`, ev({ name: i === 0 ? LONG : ["Rye supper", "Soup night", "Bread class", "Winter braise", "Pie social", "Dumpling swap", "Board games", "Cookie night"][i - 1], date: day(2 + i * 2), hood: "Fort Greene", activity: i === 6 ? "games" : "supper", ...(i === 3 ? { coverPhoto: S.cover } : {}) }), theo.cookie);
  // ten past suppers make a milestone; the last one Fran went to, with a photo and kudos, makes a recap
  for (let i = 0; i < 9; i++) await put(`events/fdaOld${i}`, ev({ name: "Crumb supper", date: day(-20 - i * 14), hood: "Fort Greene" }), theo.cookie);
  await put("events/fdaCtPast", ev({ name: "Autumn supper", date: day(1), hood: "Fort Greene" }), theo.cookie);
  // a quiet Austin host: one event; a city with none is Denver
  const ivy = await signup("Ivy Chen", "ivy.fda@example.com");
  await post("/api/host/profile", { handle: "laps-fda", name: "Night Laps", city: "Austin", hood: "Zilker", tagline: "Easy evening runs.", emoji: "🏃" }, ivy.cookie);
  await put("events/fdaRun", ev({ name: "Evening 5k", activity: "run", city: "Austin", hood: "Zilker", date: day(4) }), ivy.cookie);
  // a drop by Mai (order ahead)
  const drop = await post("/api/host/drops", { title: "Chili crisp this Saturday", items: [{ name: "Chili crisp", price: "12" }, { name: "Dumpling kit", price: "24", stock: 3 }], slots: ["Sat 10 to 11am"], area: "Bed-Stuy", address: "12 Halsey St", always: true, pay: "pickup" }, S.host.cookie);
  // people: a new account, a social one with friends and follows
  const nina = await signup("Nina Lopez", "nina.fda@example.com");
  const fran = await signup("Fran Okafor", "fran.fda@example.com");
  for (const f of [S.guest.email, theo.email, S.host.email]) await post("/api/me/friends", { key: keyOf(f) }, fran.cookie);
  await post("/api/me/friends", { key: keyOf(fran.email) }, S.guest.cookie);
  for (const h of ["mai-routes", "crumb-fda"]) await post("/api/public/follow", { handle: h, email: fran.email, name: fran.name }, fran.cookie);
  await post("/api/me/posts", { text: "Made the dumplings from last week again. Still good." }, S.guest.cookie);
  await post("/api/me/posts", { text: "Who wants to try the new bakery on Halsey on Sunday?" }, theo.cookie);
  // Fran is going to Theo's long-title supper and the Dumpling night, so friends-going and Your plans fill
  const rsvp = async (eventId, who, key) => { const doc = await (await fetch(base + "/api/db/doc?path=events/" + eventId, { headers: { "x-encore-guest": "1" } })).json();
    await fetch(base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": doc.workspace, cookie: who.cookie }, body: JSON.stringify({ eventId, response: "going", name: who.name, email: who.email, code: "C" + key.slice(-5).toUpperCase(), createdAt: Date.now(), via: "invite-lite" }) }); };
  await rsvp("fdaCt0", fran, "kfdafran0001"); await rsvp("fdaCtPast", fran, "kfdafran0003"); await rsvp("fdaCtPast", S.guest, "kfdasam00002"); await rsvp("rtOpen", fran, "kfdafran0002"); await rsvp("fdaCt0", S.guest, "kfdasam00001");
  await fetch(base + "/api/db/doc?path=events/fdaCtPast", { method: "PATCH", headers: { ...J, cookie: theo.cookie }, body: JSON.stringify({ date: day(-3) }) });
  for (let i = 0; i < 3; i++) await fetch(`${base}/api/moments?eventId=fdaCtPast`, { method: "POST", headers: { "content-type": "image/png", cookie: theo.cookie }, body: PNG_1PX });
  // a brand team: an owner (work mode) and a member who joined by invite
  const brand = await signup("Bea Brand", "bea@fernwood-fda.example", { mode: "work", company: "Fernwood Labs", city: "New York" });
  const inv = await post("/api/invite", { email: "ben@fernwood-fda.example" }, brand.cookie);
  let member = null; if (inv.token) { const r = await fetch(base + "/api/join", { method: "POST", headers: J, body: JSON.stringify({ token: inv.token, name: "Ben Field", password: "long-password-1" }) }); member = { cookie: cookieOf(r), name: "Ben Field" }; }
  return { S, theo, ivy, nina, fran, brand, member, drop };
}
const W = await seedWorld();
// the states: who is signed in and which city the device has
const STATES = [
  { id: "out-first", label: "Signed out, first visit", cookie: null, city: null },
  { id: "out-back", label: "Signed out, returning (Brooklyn set)", cookie: null, city: "New York", returning: true },
  { id: "new", label: "New account, no follows or friends", cookie: W.nina.cookie, city: "New York" },
  { id: "social", label: "Friends and follows", cookie: W.fran.cookie, city: "New York" },
  { id: "host", label: "A host", cookie: W.S.host.cookie, city: "New York" },
  { id: "brand", label: "Brand team member", cookie: W.member?.cookie || W.brand.cookie, city: "New York" },
  { id: "few", label: "Signed in, city with few events (Austin)", cookie: W.nina.cookie, city: "Austin" },
  { id: "none", label: "Signed in, city with none (Denver)", cookie: W.nina.cookie, city: "Denver" },
  { id: "any", label: "Signed in, Anywhere", cookie: W.fran.cookie, city: "" },
].filter((s) => !ONLY_STATE || s.id === ONLY_STATE);

if (DUMP) {
  for (const s of STATES.filter((x) => x.cookie)) { const r = await fetch(base + "/api/me/feed", { headers: { cookie: s.cookie } }); const j = await r.json();
    console.log(s.id, r.status, (j.blend?.items || []).map((i) => i.kind + (i.kind === "event" ? ":" + (i.event?.title || i.title || "") : "")).join(" | ")); }
  const pub = await (await fetch(base + "/api/public/feed")).json(); console.log("public keys", Object.keys(pub), (pub.blend?.items || []).map((i) => i.kind).join(" "));
  const d = await (await fetch(base + "/api/public/discover")).json(); console.log("discover keys", Object.keys(d)); console.log(JSON.stringify(d.events.filter((e) => /Chili/.test(e.title)), null, 1).slice(0, 2500)); const sh = await (await fetch(base + "/api/public/shops")).json(); console.log("shops", JSON.stringify(sh).slice(0, 800));
  server.close(); store.close(); process.exit(0);
}

// ---------- the browser ----------
const WATCH = () => { const W = (window.__fda = { cls: 0, shifts: [], rejections: [], shared: [], booted: Date.now() });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) { W.cls += e.value; if (e.value > 0.02) W.shifts.push({ t: Math.round(e.startTime), r: (e.sources || []).slice(0, 1).map((s) => `${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}`).join(""), v: +e.value.toFixed(3), who: (e.sources || []).slice(0, 2).map((s) => (s.node ? (s.node.id ? "#" + s.node.id : s.node.className && typeof s.node.className === "string" ? "." + s.node.className.trim().split(/\s+/)[0] : s.node.nodeName) : "?")).join(",") }); } })).observe({ type: "layout-shift", buffered: true }); } catch {}
  addEventListener("unhandledrejection", (e) => W.rejections.push(String(e.reason?.message || e.reason).slice(0, 160)));
  try { Object.defineProperty(navigator, "share", { configurable: true, value: async (d) => { W.shared.push(d); } }); } catch {}
  try { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { W.copied = t; } } }); } catch {} };
const browser = await pw.chromium.launch();
const ROWS = []; // { surface, width, state, check, ok, detail }
const SEV = { errors: "high", overlay: "high", actions: "high", empty: "high", overflow: "high", cls: "medium", clip: "medium", targets: "medium", help: "medium", hostlink: "medium", kinds: "medium", orphans: "low", copy: "low" };
const sevOf = (check) => SEV[check] || (check.startsWith("tap:") ? "high" : "medium");
const rec = (c, check, ok, detail = "") => ROWS.push({ surface: c.surface, width: c.width, state: c.state, check, ok: !!ok, detail: String(detail || "").slice(0, 500) });
async function open(state, width, url, { warm = false } = {}) {
  const phone = width < 600, ctx = await browser.newContext({ ...(phone ? pw.devices["iPhone 13"] : {}), viewport: { width, height: phone ? 844 : 900 }, serviceWorkers: "block" });
  if (state.cookie) { const [k, ...v] = state.cookie.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }]); }
  await ctx.addInitScript(WATCH);
  if (process.env.FDA_PROBE) await ctx.addInitScript((sel) => { addEventListener("DOMContentLoaded", () => { const t0 = performance.now(); for (const s of sel.split(",")) { const el = document.querySelector(s); if (el) new MutationObserver(() => console.log("PROBE", Math.round(performance.now()), s, el.getBoundingClientRect().height | 0, (el.innerText || "").slice(0, 40).replace(/\s+/g, " "))).observe(el, { childList: true, subtree: true, characterData: true }); } }); }, process.env.FDA_PROBE);
  if (state.city !== null) await ctx.addInitScript((city) => { try { if (!sessionStorage.getItem("fda.city")) { sessionStorage.setItem("fda.city", "1"); localStorage.setItem("encore.place", JSON.stringify({ city, source: "manual", at: Date.now() })); localStorage.setItem("encore.city", city); sessionStorage.setItem("encore.feedCity", "1"); } } catch {} }, state.city);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
  const page = await ctx.newPage(), errs = [];
  // a cross-page fade Chromium drops while the machine is busy (the next page was not ready in time) is the browser's, not the page's
  if (process.env.FDA_TIME) page.on("pageerror", (e) => console.log("STACK", String(e.stack).slice(0, 600)));
  page.on("pageerror", (e) => /Transition was aborted because of invalid state/.test(String(e.message)) || errs.push(`pageerror on ${page.url().slice(base.length)}: ` + String(e.message || e).split("\n")[0].slice(0, 160)));
  // an outside script or style answers empty here (no internet), so its integrity check fails: that is this run, not the page
  if (process.env.FDA_PROBE) page.on("console", (m) => /^PROBE/.test(m.text()) && console.log(m.text()));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|integrity' attribute for resource 'https:\/\/(?!127)/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
  page.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(base) && !/net::ERR_ABORTED/.test(r.failure()?.errorText || "")) errs.push(`request failed: ${u.slice(base.length, base.length + 100)} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { const u = r.url(); if (!u.startsWith(base)) return; const p = u.slice(base.length); if (r.status() >= 400 && !(r.status() === 401 && !state.cookie && /^\/api\/(me|workspace|host)\b/.test(p))) errs.push(`${r.status()} ${r.request().method()} ${p.slice(0, 100)}`); });
  if (process.env.FDA_TIME) page.on("requestfinished", (r) => { const t = r.timing(); if (t.responseEnd > 800) console.log("slow", Math.round(t.responseEnd), r.url().slice(base.length, base.length + 90)); });
  const go = async () => { const t = Date.now(); await page.goto(base + url, { waitUntil: "load", timeout: 60000 }); if (process.env.FDA_TIME) console.log("load", url, Date.now() - t); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); await nap(page, 900); };
  await go().catch((e) => errs.push("load: " + e.message.split("\n")[0]));
  if (warm) { await page.evaluate(() => scrollTo(0, 900)).catch(() => {}); await nap(page, 300); await go().catch((e) => errs.push("reload: " + e.message.split("\n")[0])); }
  return { ctx, page, errs, reload: go };
}
// everything a person would see wrong on the page as it sits, read in one pass
const SCAN = () => { const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity !== 0 && !el.closest("[hidden]"); };
  const name = (el) => { const t = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40); return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : ""}${t ? ` "${t}"` : ""}`; };
  const root = document.querySelector("main#m") || document.querySelector("main") || document.body;
  const all = [...new Set(document.querySelectorAll(".wrap a[href], .wrap button, .wrap summary, .wrap [role=button], .wrap input:not([type=hidden]), .wrap select, main a[href], main button, main summary, #side a[href], #side button, .sheet a[href], .sheet button, #list a[href], #list button, header a[href], header button"))].filter((el) => vis(el) && !el.closest("[aria-hidden=true]"));
  const out = { clipped: [], small: [], underHelp: [], orphans: [], emdash: [], emoji: [], overlay: [], hostlink: [], kinds: {}, noPrimary: [], text: 0, scroll: document.documentElement.scrollWidth - innerWidth, wide: [], empty: "" };
  out.text = (root.innerText || "").replace(/\s+/g, " ").trim().length;
  if (out.scroll > 1) out.wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 3).map(name);
  // text clipped inside a control (cut off, or an ellipsis)
  for (const el of all) { if (!el.matches("button, a.btn, a[class*=btn], .ls-chip, [role=tab], .fb-act, .fb-cta, .fb-fbtn, .fb-follow-in, summary, .pc-edit, .cta, .go, .fb-ghost, .fb-link, .hcd-nx")) continue;
    for (const n of [el, ...el.querySelectorAll("span,b,small")]) { if (!vis(n) || n.closest(".fb-sr,.sr-only,.vh,.sr") || n.getBoundingClientRect().width <= 2) continue; const s = getComputedStyle(n);
      if ((n.scrollWidth > n.clientWidth + 1 && n.clientWidth > 0 && (s.overflow !== "visible" || s.textOverflow === "ellipsis")) || (n.scrollHeight > n.clientHeight + 2 && /hidden|clip/.test(s.overflow) && n.clientHeight > 0)) { out.clipped.push(name(el)); break; } } }
  // tap targets under 44px on a phone (a text link inside a sentence is exempt)
  // the real hit box: a ::after laid over the control (inset -6px grows it; inset 0 on a static link covers its card)
  const hit = (el) => { const r = el.getBoundingClientRect(), a = getComputedStyle(el, "::after"); if (a.content === "none" || a.position !== "absolute") return r;
    const box = getComputedStyle(el).position === "static" ? (el.parentElement?.closest("*:not([style*=static])") && (() => { let p = el.parentElement; while (p && getComputedStyle(p).position === "static") p = p.parentElement; return p ? p.getBoundingClientRect() : r; })()) : r;
    const n = (v) => (/px$/.test(v) ? parseFloat(v) : 0); return { width: box.width - n(a.left) - n(a.right), height: box.height - n(a.top) - n(a.bottom) }; };
  if (innerWidth < 600) for (const el of all) { const r = hit(el); if (el.matches("input[type=checkbox],input[type=radio]") || el.closest(".eh-panel,#encoreHelp")) continue;
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement && (el.parentElement.innerText || "").trim().length > (el.innerText || "").trim().length + 8) continue;
    if (el.getAttribute("tabindex") === "-1") continue;
    // a text link needs the height; a word as short as "Feed" is wide enough at 24px (WCAG 2.5.8), a button needs both
    if (r.height < 43.5 || r.width < (el.tagName === "A" && !/btn|cta|chip/.test(el.className) ? 24 : 43.5)) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`); }
  // anything you can tap under the floating help button (checked at the top and at the very end of the page)
  const help = [...document.querySelectorAll(".eh-btn")].find(vis);
  if (help) { const H = help.getBoundingClientRect(); for (const el of all) { if (help.contains(el) || el.closest(".eh-panel,#encoreHelp")) continue; const r = el.getBoundingClientRect(); if (r.right > H.left + 4 && r.left < H.right - 4 && r.bottom > H.top + 4 && r.top < H.bottom - 4) out.underHelp.push(name(el)); } }
  // a lone word on the last line of short copy on a card
  const words = (el) => { const W = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t; while ((t = tw.nextNode())) { if (t.parentElement.closest(".fb-sr,.sr-only,[hidden]")) continue; const re = /\S+/g; let m; while ((m = re.exec(t.data))) { const rg = document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length); const b = rg.getClientRects()[0]; if (b) W.push({ w: m[0], top: Math.round(b.top) }); } } return W; };
  for (const el of document.querySelectorAll(".fb-card :is(h2,h3,p,small,blockquote p), .fv-intro :is(h1,h2,p), .ls-card :is(.ls-title,.ls-sub,.ls-when), .hcd :is(.hcd-name,small), .endcards :is(h2,p,small), .note-box, .ls-empty :is(b,p), .fv-empty-line, .intro :is(h1,p), .sec-h h2, .fb-fc :is(b,small), .shop :is(b,small), .empty, .fside :is(h3,p,small)")) {
    if (!vis(el) || el.querySelector("p,h3,div") || el.scrollHeight > el.clientHeight + 2) continue; // a clamped line ends where the clamp is, not on its last word const t = (el.innerText || "").trim(); if (t.length > 160 || t.split(/\s+/).length < 4) continue;
    const W = words(el); if (W.length < 4) continue; const a = W[W.length - 1], b = W[W.length - 2]; if (a.top > b.top + 4 && !/^[·•|›→]$/.test(a.w)) out.orphans.push(`${name(el)} ends on "${a.w}" alone`); }
  // copy: no em dashes, no emoji in chrome (buttons, nav, headings, tabs)
  const txt = document.body.innerText || ""; if (/—/.test(txt)) out.emdash.push(...[...txt.matchAll(/.{0,30}—.{0,30}/g)].slice(0, 3).map((m) => m[0]));
  for (const el of document.querySelectorAll("button, nav a, h1, h2, .tabs button, .fb-act, .fb-cta, .ls-btn, .ls-chip, .fb-sec a")) { if (!vis(el) || el.closest(".eh-panel,.fv-react,.fv-ring,.rail")) continue; const t = (el.innerText || "").replace(/[©®™←-⇿›‹]/g, ""); if (/\p{Extended_Pictographic}/u.test(t)) out.emoji.push(name(el)); }
  // a sheet or overlay up by itself, covering the page
  for (const el of document.querySelectorAll("dialog[open], [role=dialog], [aria-modal=true], .sheet, .sk-sheet, .sd, [class*=deck]")) { if (!vis(el) || el.closest(".eh-panel,#encoreHelp")) continue; const s = getComputedStyle(el); if (s.position !== "fixed" && el.tagName !== "DIALOG") continue; const r = el.getBoundingClientRect(); if (r.width * r.height > innerWidth * innerHeight * 0.35) out.overlay.push(name(el)); }
  // cards: what kinds are here, each with its main action, and the host page reached only from the avatar or name
  for (const c of document.querySelectorAll("[data-kind]")) { if (!vis(c)) continue; const k = c.dataset.kind; out.kinds[k] = (out.kinds[k] || 0) + 1;
    const need = { event: ".fb-cta", recap: "[data-fb-kudos]", milestone: "[data-fb-kudos]", follow: "[data-fb-follow],[data-fb-friend]", ideas: "[data-fb-deck]", club: "[data-fb-kudos]", row: "a[href]", post: "[data-fb-kudos],[data-pl-like],button" }[k];
    if (need && !c.querySelector(need)) out.noPrimary.push(`${k} "${(c.querySelector("h3,h2,b")?.innerText || "").slice(0, 40)}": no ${need}`);
    for (const a of c.querySelectorAll("a[href^='/@']")) { if (a.matches(".fb-host,.fb-fc-a,.fv-host,.ls-mi,.hcd-name") || a.closest(".fb-lead,.fv-by,.fv-more,.fb-by")) continue; if (a.querySelector("h3,.fb-title,img.fv-img") || a.matches(".fb-cta,.fv-btn.primary,.fb-media")) out.hostlink.push(`${k}: ${name(a)} goes to ${a.getAttribute("href")}`); }
    const cta = c.querySelector(".fb-cta"); if (cta && /^\/@/.test(cta.getAttribute("href") || "")) out.hostlink.push(`${k}: the main button goes to the host page`); }
  for (const c of document.querySelectorAll("#events .ls-card, #fyList .ls-card")) { if (!vis(c)) continue; out.kinds["discover card"] = (out.kinds["discover card"] || 0) + 1; if (!c.querySelector(".ls-btn.primary")) out.noPrimary.push("discover card: no See the event"); }
  for (const c of document.querySelectorAll(".hcd")) { if (!vis(c)) continue; out.kinds["host card"] = (out.kinds["host card"] || 0) + 1; if (!c.querySelector("[data-fh]") && !/Following/.test(c.innerText)) out.noPrimary.push(`host card "${c.querySelector(".hcd-name")?.innerText}": no Follow`); }
  for (const c of document.querySelectorAll(".shop")) { if (vis(c)) out.kinds.shop = (out.kinds.shop || 0) + 1; }
  for (const c of document.querySelectorAll("#rows > li")) { if (vis(c)) out.kinds["map row"] = (out.kinds["map row"] || 0) + 1; }
  for (const c of document.querySelectorAll(".fv-ring, .rail button, .rail a")) { if (vis(c)) { out.kinds.story = (out.kinds.story || 0) + 1; } }
  return out; };

// close whatever opened by itself (the way a person would), so the taps can reach the page
async function dismiss(page) { for (let i = 0; i < 3; i++) { const up = await page.evaluate(() => [...document.querySelectorAll("[role=dialog][aria-modal=true],dialog[open]")].some((d) => d.getBoundingClientRect().height > 40 && !d.closest(".eh-panel"))).catch(() => false); if (!up) return;
  const x = page.locator('[role=dialog] [aria-label^="Close"], [role=dialog] button[aria-label*="close" i], .sd-x').filter({ visible: true }).first(); if (await x.count()) await x.click({ timeout: 2000 }).catch(() => {}); else await page.keyboard.press("Escape"); await nap(page, 350); } }

async function auditPage(c, state, url) {
  const { ctx, page, errs } = await open(state, c.width, url, { warm: !!state.returning });
  const top = await page.evaluate(SCAN).catch((e) => ({ err: e.message }));
  if (top.err) { rec(c, "errors", false, "scan: " + top.err); await ctx.close(); return null; }
  // the end of the page: the help button over the last controls, lazy cards in
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, document.body.scrollHeight); }).catch(() => {});
  await nap(page, 500); const end = await page.evaluate(SCAN).catch(() => top);
  const W = await page.evaluate(() => window.__fda).catch(() => ({ cls: 0, shifts: [], rejections: [] }));
  if (SHOTS && c.width < 600) { await page.evaluate(() => scrollTo(0, 0)).catch(() => {}); await nap(page, 150); await page.screenshot({ path: path.join(SHOTS, `${c.surface.replace(/\W+/g, "") || "home"}-${state.id}-${c.width}.png`), fullPage: true }).catch(() => {}); }
  const u = (a, b) => [...new Set([...(a || []), ...(b || [])])];
  rec(c, "errors", !errs.length && !W.rejections.length, [...new Set([...errs, ...W.rejections.map((r) => "rejection: " + r)])].join("; "));
  rec(c, "overlay", !top.overlay.length, top.overlay.length ? "up on load, covering the page: " + top.overlay.join(", ") : "");
  rec(c, "overflow", top.scroll <= 1 && end.scroll <= 1, top.scroll > 1 ? `${top.scroll}px sideways (${top.wide.join(", ")})` : "");
  rec(c, "cls", W.cls <= 0.1, W.cls > 0.1 ? `CLS ${W.cls.toFixed(3)}: ${W.shifts.slice(0, 4).map((s) => `${s.v} ${s.who} (${s.r} at ${s.t}ms)`).join(", ")}` : "");
  rec(c, "clip", !u(top.clipped, end.clipped).length, u(top.clipped, end.clipped).slice(0, 6).join("; "));
  if (c.width < 600) rec(c, "targets", !u(top.small, end.small).length, `${u(top.small, end.small).length} under 44px: ` + u(top.small, end.small).slice(0, 8).join("; "));
  rec(c, "help", !end.underHelp.length && !top.underHelp.length, u(top.underHelp, end.underHelp).slice(0, 4).join("; "));
  rec(c, "orphans", !u(top.orphans, end.orphans).length, u(top.orphans, end.orphans).slice(0, 5).join("; "));
  rec(c, "copy", !end.emdash.length && !end.emoji.length, [...end.emdash.map((x) => "em dash: " + x), ...end.emoji.map((x) => "emoji in chrome: " + x)].slice(0, 5).join("; "));
  rec(c, "hostlink", !end.hostlink.length, end.hostlink.slice(0, 4).join("; "));
  rec(c, "actions", !end.noPrimary.length, end.noPrimary.slice(0, 5).join("; "));
  rec(c, "empty", end.text > 120, end.text > 120 ? "" : `only ${end.text} characters of content`);
  rec(c, "kinds", true, Object.entries(end.kinds).map(([k, n]) => `${k} ${n}`).join(", ") || "no cards");
  await ctx.close(); return end;
}

// ---------- taps: every control on every card kind, once each, on a fresh page ----------
const nap = (page, ms) => page.waitForTimeout(ms * (+process.env.FDA_SLOW || 2));
const path0 = (page) => page.url().slice(base.length);
const vis1 = async (page, sel) => { const L = page.locator(sel).filter({ visible: true }); return (await L.count()) ? L.first() : null; };
const UP = () => [...document.querySelectorAll("[role=dialog],dialog[open],.sheet,.sk-sheet,.fv-sv")].some((d) => { const r = d.getBoundingClientRect(); return r.height > 40 && getComputedStyle(d).visibility !== "hidden" && !d.closest(".eh-panel,#encoreHelp,[hidden]"); });
const sheetUp = (page) => page.waitForFunction(UP, null, { timeout: 10000 }).then(() => true, () => false); // waits for a sheet to come up
const sheetGone = (page) => page.waitForFunction((f) => !new Function("return (" + f + ")()")(), String(UP), { timeout: 5000 }).then(() => true, () => false);
const signedOut = (s) => !s.cookie;
const leftFor = (p) => /^\/(login|signup)/.test(p);
const TAPS = [
  // ---- the feed ----
  { id: "follow (suggestion row)", on: "/feed", sel: ".fb-follow [data-fb-follow]", async run(page, b, st, again) { const h = await b.getAttribute("data-fb-follow"), p0 = path0(page); await b.click(); await nap(page, 1200);
    if (path0(page) !== p0) return signedOut(st) && /^\/(@|login|signup)/.test(path0(page)) ? [true, `signed out: went to ${path0(page)} to ask who you are`] : [false, `navigated to ${path0(page)}`];
    const t = await b.innerText().catch(() => ""); if (!/Following/.test(t)) return [false, `button says "${t}" after the tap`];
    await again(); const still = await page.locator(`[data-fb-follow="${h}"]`).filter({ visible: true }).count(); const fol = still ? await page.locator(`[data-fb-follow="${h}"]`).first().innerText() : "";
    return still && !/Following/.test(fol) ? [false, `after reload @${h} is offered again with "${fol}"`] : [true, `@${h} Following, kept after reload`]; } },
  { id: "follow (card header)", on: "/feed", sel: ".fb-lead [data-fb-follow]", async run(page, b, st, again) { const h = await b.getAttribute("data-fb-follow"), p0 = path0(page); await b.click(); await nap(page, 1200);
    if (path0(page) !== p0) return signedOut(st) && /^\/(@|login|signup)/.test(path0(page)) ? [true, `signed out: went to ${path0(page)}`] : [false, `navigated to ${path0(page)}`];
    const t = await b.innerText().catch(() => ""); if (!/Following/.test(t)) return [false, `button says "${t}"`];
    await again(); const n = await page.locator(`.fb-lead [data-fb-follow="${h}"]`).filter({ visible: true }).count(); return n ? [false, `after reload the header offers Follow @${h} again`] : [true, `@${h} followed in place, gone after reload`]; } },
  { id: "follow a person", on: "/feed", sel: "[data-fb-friend]", async run(page, b) { const p0 = path0(page); await b.click(); await nap(page, 1000); if (path0(page) !== p0) return [false, `navigated to ${path0(page)}`]; const t = await b.innerText(); return /Following/.test(t) ? [true, "Following"] : [false, `says "${t}"`]; } },
  { id: "not for me (dismiss)", on: "/feed", sel: "[data-fb-dismiss]", async run(page, b, st, again) { const t = await b.getAttribute("data-fb-dismiss"); await b.click(); await nap(page, 700); const n = await page.locator(`[data-fb-card="${t}"]`).count(); if (n) return [false, "the card stayed"];
    await again(); const back = await page.locator(`[data-fb-card="${t}"]`).count(); return back ? [false, "back after reload"] : [true, "gone, and stays gone"]; } },
  { id: "kudos", on: "/feed", sel: ".fb-acts [data-fb-kudos].fb-act", async run(page, b, st, again) { const t = await b.getAttribute("data-fb-kudos"), p0 = path0(page), was = await b.getAttribute("aria-pressed"), n0 = +(await b.locator("[data-fb-kn]").innerText().catch(() => "0")) || 0;
    await b.click(); await nap(page, 1300); if (path0(page) !== p0) return signedOut(st) && leftFor(path0(page)) ? [true, "signed out: asks you to sign in"] : [false, `navigated to ${path0(page)}`];
    const b1 = page.locator(`[data-fb-kudos="${t}"]`).first(), on = await b1.getAttribute("aria-pressed"), n1 = +(await b1.locator("[data-fb-kn]").innerText().catch(() => "0")) || 0, want = n0 + (was === "true" ? -1 : 1);
    if (on === was || n1 !== want) return [false, `pressed ${was}->${on}, count ${n0}->${n1} (wanted ${want})`];
    await again(); const b2 = page.locator(`[data-fb-kudos="${t}"]`).first(); if (!(await b2.count())) return [false, "the card is gone after reload"]; const on2 = await b2.getAttribute("aria-pressed"), n2 = +(await b2.locator("[data-fb-kn]").innerText().catch(() => "0")) || 0;
    return on2 === on && n2 === n1 ? [true, `${n0} -> ${n1}, same after reload`] : [false, `after reload pressed ${on2}, count ${n2} (was ${on}, ${n1})`]; } },
  { id: "send kudos (milestone)", on: "/feed", sel: ".fb-ms [data-fb-kudos]", async run(page, b, st, again) { const p0 = path0(page), t0 = await b.innerText(); await b.click(); await nap(page, 1200); if (path0(page) !== p0) return signedOut(st) && leftFor(path0(page)) ? [true, "signed out: asks you to sign in"] : [false, `navigated to ${path0(page)}`]; const t1 = await b.innerText(); if (t1 === t0) return [false, `still says "${t1}"`];
    await again(); const t2 = await page.locator(".fb-ms [data-fb-kudos]").first().innerText().catch(() => ""); return t2 === t1 ? [true, `"${t0.trim()}" -> "${t1.trim()}", kept`] : [false, `after reload "${t2}"`]; } },
  { id: "comment", on: "/feed", sel: ".fb-acts [data-fb-comment], .fb-acts a.fb-act[href^='/login']", async run(page, b, st, again) { const p0 = path0(page); if (signedOut(st)) { await b.click(); await nap(page, 900); return leftFor(path0(page)) ? [true, "signed out: asks you to sign in"] : [false, `went to ${path0(page)}`]; }
    const t = await b.getAttribute("data-fb-comment"), n0 = +(await page.locator(`[data-fb-cn="${t}"]`).first().innerText().catch(() => "0")) || 0; await b.click(); await nap(page, 900);
    if (path0(page) !== p0) return [false, `navigated to ${path0(page)}`]; const ta = await vis1(page, ".fcm textarea"); if (!ta) return [false, "the comments sheet didn't open with a box to type in"];
    await ta.fill("Looks lovely, see you there."); const send = await vis1(page, ".fcm-send"); await send?.click(); await nap(page, 1200);
    const x = await vis1(page, ".fcm-x"); if (!x) return [false, "no close button on the sheet"]; await x.click(); await nap(page, 600); if (!(await sheetGone(page))) return [false, "the sheet didn't close"];
    const n1 = +(await page.locator(`[data-fb-cn="${t}"]`).first().innerText().catch(() => "0")) || 0; if (n1 !== n0 + 1) return [false, `count ${n0} -> ${n1} after sending`];
    await again(); const n2 = +(await page.locator(`[data-fb-cn="${t}"]`).first().innerText().catch(() => "0")) || 0; return n2 === n1 ? [true, `sent, ${n0} -> ${n1}, same after reload`] : [false, `after reload count ${n2}`]; } },
  { id: "share", on: "/feed", sel: "[data-fb-share]", async run(page, b) { const p0 = path0(page); await b.click(); await nap(page, 600); const W = await page.evaluate(() => window.__fda); if (path0(page) !== p0) return [false, `navigated to ${path0(page)}`]; return W.shared.length || W.copied ? [true, "share sheet with " + (W.shared[0]?.url || W.copied).replace(base, "")] : [false, "nothing happened"]; } },
  { id: "host name", on: "/feed", sel: ".fb-lead .fb-host", async run(page, b) { const h = await b.getAttribute("href"); await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 600); return path0(page).startsWith(h) ? [true, h] : [false, `went to ${path0(page)}, wanted ${h}`]; } },
  { id: "event button", on: "/feed", sel: ".fb-ev .fb-cta", async run(page, b) { const h = await b.getAttribute("href"), label = (await b.innerText()).trim(); await b.click(); await page.waitForURL((u) => !u.pathname.startsWith("/feed"), { timeout: 5000 }).catch(() => {}); await page.waitForLoadState("load").catch(() => {}); const p = path0(page); return /^\/(e|i|g|x|plans|d)\b|^\/e\//.test(p) ? [true, `"${label}" -> ${p.slice(0, 50)}`] : [false, `"${label}" went to ${p} (href ${h})`]; } },
  { id: "event title", on: "/feed", sel: ".fb-ev .fb-title a", async run(page, b) { await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 500); const p = path0(page); return /^\/(e|i|g)\b/.test(p) ? [true, p.slice(0, 50)] : [false, `went to ${p}`]; } },
  { id: "story", on: "/feed", sel: "#rail [data-fv-story]", async run(page, b) { await b.click(); await nap(page, 900); if (!(await sheetUp(page))) return [false, "the story didn't open"]; await page.keyboard.press("Escape"); await nap(page, 600); const still = await page.evaluate(() => [...document.querySelectorAll(".fv-sv")].some((d) => d.getBoundingClientRect().height > 40)); return still ? [false, "Escape didn't close the story"] : [true, "opens, Escape closes"]; } },
  { id: "recap photo", on: "/feed", sel: ".fb-recap [data-fv-open]", async run(page, b) { await b.click(); await nap(page, 900); const up = await page.evaluate(() => [...document.querySelectorAll(".fv-sv")].some((d) => d.getBoundingClientRect().height > 40)); if (!up) return [false, "the photo didn't open"]; const x = await vis1(page, ".fv-sv-x"); if (x) await x.click(); else await page.keyboard.press("Escape"); await nap(page, 600); const still = await page.evaluate(() => [...document.querySelectorAll(".fv-sv")].some((d) => d.getBoundingClientRect().height > 40)); return still ? [false, "didn't close"] : [true, "opens and closes"]; } },
  { id: "ideas deck", on: "/feed", sel: "[data-fb-deck]", async run(page, b) { await b.click(); await nap(page, 1200); if (!(await sheetUp(page))) return [false, "the deck didn't open"]; await dismiss(page); await nap(page, 300); return !(await sheetGone(page)) ? [false, "the deck didn't close"] : [true, "opens, closes"]; } },
  { id: "+ create", on: "/feed", sel: '[aria-label="Create"]', when: (s) => !!s.cookie, async run(page, b) { await b.click(); await nap(page, 900); if (!(await sheetUp(page))) return [false, "the + sheet didn't open"]; await page.keyboard.press("Escape"); await nap(page, 500); return !(await sheetGone(page)) ? [false, "Escape didn't close the + sheet"] : [true, "opens, Escape closes"]; } },
  { id: "tabs", on: "/feed", sel: ".tabs [data-t=me]", when: (s) => !!s.cookie, async run(page) { const bad = [];
    for (const t of ["me", "alerts", "friends", "feed"]) { await page.locator(`.tabs [data-t=${t}]`).click(); await nap(page, 1300); const r = await page.evaluate((t) => ({ sel: document.querySelector(`.tabs [data-t=${t}]`)?.getAttribute("aria-selected"), n: (document.querySelector("#m")?.innerText || "").trim().length, stuck: !!document.querySelector("#m [data-calm-wait]") }), t); if (r.sel !== "true" || r.n < 40 || r.stuck) bad.push(`${t}: selected ${r.sel}, ${r.n} chars${r.stuck ? ", still loading" : ""}`); }
    return bad.length ? [false, bad.join("; ")] : [true, "Mine, Watching, Friends and Feed each draw"]; } },
  { id: "city chip", on: "/feed", sel: "#feedPlace .pc-edit", async run(page) { const p0 = page.url(); await page.evaluate(() => (window.__fdaMark = 1)); await page.locator("#feedPlace .pc-edit").first().click(); await nap(page, 300); const f = await vis1(page, "#feedPlace input"); if (!f) return [false, "no city field opened"]; await f.fill("Austin"); await f.press("Enter"); await nap(page, 1500);
    const r = await page.evaluate(() => ({ mark: window.__fdaMark, chip: document.querySelector("#feedPlace")?.innerText || "" })); if (page.url() !== p0 || !r.mark) return [false, "the page reloaded or moved"]; return /austin/i.test(r.chip) ? [true, "city changed in place"] : [false, `chip says "${r.chip.trim().slice(0, 40)}"`]; } },
  { id: "save to list", on: "/feed", sel: ".fb-stream .pls-btn, .fv-save .pls-btn", async run(page, b) { const was = await b.getAttribute("aria-pressed"); await b.click(); await nap(page, 900); await dismiss(page); const now = await b.getAttribute("aria-pressed").catch(() => was); return now !== was ? [true, `pressed ${was} -> ${now}`] : [false, "nothing changed"]; } },
  { id: "composer post", on: "/feed", sel: "#pText", when: (s) => s.id === "social", async run(page, b) { await b.fill("Audit post: dinner was lovely."); await page.locator("#pSend").click(); await nap(page, 1500); const ok = await page.evaluate(() => /Audit post: dinner was lovely/.test(document.querySelector("#m")?.innerText || "")); return ok ? [true, "the post shows in the feed"] : [false, "posted, but it doesn't show"]; } },
  { id: "see all (suggestions)", on: "/feed", sel: ".fb-follow .fb-sec a", async run(page, b) { await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 500); return /^\/(people|login)/.test(path0(page)) ? [true, path0(page)] : [false, `went to ${path0(page)}`]; } },
  { id: "row card", on: "/feed", sel: ".fb-rowc .fv-row a[href]", async run(page, b) { const h = await b.getAttribute("href"); await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 500); return path0(page) !== "/feed" ? [true, path0(page).slice(0, 50)] : [false, `stayed (href ${h})`]; } },
  // ---- Discover ----
  { id: "city picker", on: "/discover", sel: "#locBtn", async run(page, b) { const p0 = page.url(); await page.evaluate(() => (window.__fdaMark = 1)); await b.click(); await nap(page, 300); if (!(await vis1(page, "#locPanel"))) return [false, "the city panel didn't open"];
    await page.locator("#locIn").fill("Austin"); await page.locator("#locPanel button[type=submit]").click(); await nap(page, 800); const r = await page.evaluate(() => ({ mark: window.__fdaMark, name: document.querySelector("#locName")?.innerText, h: document.querySelector("#evH")?.innerText, note: document.querySelector("#evNote")?.innerText, n: document.querySelectorAll("#events .ls-card").length }));
    if (!r.mark || page.url() !== p0) return [false, "the page reloaded"]; return r.name === "Austin" && /Austin/.test(r.h + r.note) ? [true, `in place: "${r.h}", ${r.n} cards`] : [false, `chip "${r.name}", heading "${r.h}", note "${(r.note || "").slice(0, 60)}"`]; } },
  { id: "Anywhere", on: "/discover", sel: "#locBtn", async run(page, b) { await b.click(); await nap(page, 300); const a = await vis1(page, "#locAny"); if (!a) return [false, "no Anywhere button"]; await a.click(); await nap(page, 600); const r = await page.evaluate(() => ({ name: document.querySelector("#locName")?.innerText, n: document.querySelectorAll("#events .ls-card").length })); return r.name === "Anywhere" && r.n ? [true, `${r.n} cards`] : [false, `chip "${r.name}", ${r.n} cards`]; } },
  { id: "category chips", on: "/discover", sel: "#filters [data-f=move]", async run(page) { const bad = []; for (const f of ["move", "make", "gather", "discover", "all"]) { await page.locator(`#filters [data-f=${f}]`).click(); await nap(page, 400); const r = await page.evaluate((f) => ({ on: document.querySelector(`#filters [data-f=${f}]`)?.getAttribute("aria-pressed"), n: document.querySelectorAll("#events .ls-card").length, note: (document.querySelector("#evNote")?.innerText || "") + (document.querySelector("#events .ls-empty")?.innerText || "") }), f); if (r.on !== "true" || (!r.n && !r.note.trim())) bad.push(`${f}: pressed ${r.on}, ${r.n} cards, no note`); } return bad.length ? [false, bad.join("; ")] : [true, "each chip filters in place, an empty one says so"]; } },
  { id: "Show more", on: "/discover", sel: "#evMore", async run(page, b) { const n0 = await page.locator("#events .ls-card").count(); await b.click(); await nap(page, 500); const n1 = await page.locator("#events .ls-card").count(); return n1 > n0 ? [true, `${n0} -> ${n1}`] : [false, `${n0} -> ${n1}`]; } },
  { id: "map toggle", on: "/discover", sel: "#mapLink", async run(page, b) { await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 2500); if (!path0(page).startsWith("/map")) return [false, `went to ${path0(page)}`]; const n = await page.locator("#rows > li").count(); return n ? [true, `/map with ${n} in the list`] : [false, "/map with an empty list"]; } },
  { id: "host follow", on: "/discover", sel: "#hosts [data-fh]", async run(page, b, st, again) { const h = await b.getAttribute("data-fh"), p0 = path0(page); await b.click(); await nap(page, 1200); if (await page.locator(".fl-sheet, [role=dialog]").filter({ visible: true }).count()) return [true, "asks for an email in a sheet (signed out)"]; if (path0(page) !== p0) return [false, `navigated to ${path0(page)}`];
    const on = await b.getAttribute("aria-pressed"); if (on !== "true") return [false, `pressed ${on}`]; await again(); const on2 = await page.locator(`#hosts [data-fh="${h}"]`).first().getAttribute("aria-pressed").catch(() => "gone"); return on2 === "true" || on2 === "gone" ? [true, `Following @${h}, kept after reload`] : [false, `after reload @${h} shows Follow again`]; } },
  { id: "save (Discover card)", on: "/discover", sel: "#events .ls-more summary", async run(page, b) { await b.click(); await nap(page, 300); const s = await vis1(page, "#events .ls-more[open] .pls-btn"); if (!s) return [false, "the More menu has no Save"]; const was = await s.getAttribute("aria-pressed"); await s.click(); await nap(page, 900); await dismiss(page); const now = await s.getAttribute("aria-pressed").catch(() => was); return now !== was ? [true, `pressed ${was} -> ${now}`] : [false, "nothing changed"]; } },
  { id: "See the event", on: "/discover", sel: "#events .ls-btn.primary", async run(page, b) { const label = await b.getAttribute("aria-label"); await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 1200); const t = (label || "").replace(/^(See the event|Order): /, ""); const shows = await page.evaluate((t) => (document.body.innerText || "").includes(t), t); return shows ? [true, `${path0(page).slice(0, 40)} shows "${t.slice(0, 30)}"`] : [false, `${path0(page)} doesn't show "${t}"`]; } },
  { id: "order (shops)", on: "/discover", sel: "#shops .shop", async run(page, b) { await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 800); return /^\/(e|@|d)/.test(path0(page)) ? [true, path0(page).slice(0, 40)] : [false, `went to ${path0(page)}`]; } },
  { id: "quiz", on: "/discover", sel: "#quiz a", async run(page, b) { await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 500); return path0(page).startsWith("/quiz") ? [true, "/quiz"] : [false, path0(page)]; } },
  { id: "shelf", on: "/discover", sel: "#plShelves a[href]", async run(page, b) { const h = await b.getAttribute("href"); await Promise.all([page.waitForLoadState("load").catch(() => {}), b.click()]); await nap(page, 800); return path0(page) !== "/discover" ? [true, path0(page).slice(0, 50)] : [false, `stayed (href ${h})`]; } },
];
async function tap(c, state, T) {
  const { ctx, page, errs, reload } = await open(state, c.width, T.on); await dismiss(page);
  try { const b = await vis1(page, T.sel); if (!b) { await ctx.close(); return; } // not on the page in this state: the scan says what is
    await b.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    const again = async () => { await reload(); await dismiss(page); };
    const [ok, detail] = await Promise.race([T.run(page, b, state, again), new Promise((r) => setTimeout(() => r([false, "timed out"]), 30000))]);
    const e2 = errs.filter((e) => !/^401 /.test(e)); rec(c, "tap: " + T.id, ok && !e2.length, detail + (e2.length ? "; " + [...new Set(e2)].slice(0, 3).join("; ") : ""));
  } catch (e) { rec(c, "tap: " + T.id, false, e.message.split("\n")[0].slice(0, 200)); }
  await ctx.close();
}

// ---------- run ----------
const SURFACES = [{ path: "/feed", id: "feed" }, { path: "/", id: "home", only: (s) => !s.cookie }, { path: "/discover", id: "discover" }, { path: "/map", id: "map" }].filter((s) => !ONLY || s.id === ONLY);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const t0 = Date.now();
for (const width of WIDTHS) for (const state of STATES) for (const S of SURFACES) { if (S.only && !S.only(state)) continue;
  const c = { surface: S.path, width, state: state.id }; if (!NO_SCAN) await auditPage(c, state, S.path);
  // the taps run where they say something new: every state on a phone for the feed and Discover, two on a wide screen
  const tapHere = { "/feed": width < 600 ? ["out-first", "new", "social", "host", "brand"] : ["out-first", "social"], "/discover": width < 600 ? ["out-first", "social", "few", "none", "any"] : ["out-first", "social"] }[S.path] || [];
  if (tapHere.includes(state.id) || ONLY_STATE) for (const T of TAPS.filter((t) => t.on === S.path && (!t.when || t.when(state)) && (!ONLY_TAP || t.id.includes(ONLY_TAP)))) await tap(c, state, T);
  fs.writeFileSync(path.join(os.tmpdir(), "fda-rows.json"), JSON.stringify(ROWS)); process.stdout.write("."); }
await browser.close(); server.closeAllConnections?.(); server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true });

// ---------- the report ----------
const fails = ROWS.filter((r) => !r.ok), checks = [...new Set(ROWS.filter((r) => !r.check.startsWith("tap:") && r.check !== "kinds").map((r) => r.check))];
const bySev = { high: 0, medium: 0, low: 0 }; for (const f of fails) bySev[sevOf(f.check)]++;
const cell = (L) => (!L.length ? "" : L.every((r) => r.ok) ? "ok" : `**${L.filter((r) => !r.ok).length} fail**`);
let md = `# Feed and Discover audit\n\nWritten by \`node scripts/feed-discover-audit.mjs\` (${new Date().toISOString().slice(0, 10)}, ${Math.round((Date.now() - t0) / 1000)}s). It seeds a small world (test/routes-seed.js plus a busy Brooklyn host with a long title and events without covers, a quiet Austin host, a drop, a new account, an account with friends, follows and posts, a brand team member) and drives each surface at ${WIDTHS.join(" and ")}px in every state. Each tap runs once on a fresh page; nothing destructive is tapped.\n\n`;
md += `**${fails.length} failing checks** (${bySev.high} high, ${bySev.medium} medium, ${bySev.low} low) out of ${ROWS.filter((r) => r.check !== "kinds").length}.\n\n## States\n\n${STATES.map((s) => `- \`${s.id}\`: ${s.label}`).join("\n")}\n\n`;
md += `## Surface x state x check\n\nPage checks: errors (console, page errors, failed or 4xx/5xx requests), overlay (a sheet up by itself), overflow (sideways scroll), cls (layout shift over 0.1), clip (text cut off in a control), targets (under 44px at 390), help (a control under the help button), orphans (one word alone on the last line of short copy), copy (em dashes, emoji in chrome), hostlink (the host page reached from anything but the avatar or name), actions (a card without its main action), empty (a page with nothing on it), taps (every control once).\n\n`;
for (const width of WIDTHS) { md += `### ${width}px\n\n| surface | state | ${checks.join(" | ")} | taps |\n|${"---|".repeat(checks.length + 3)}\n`;
  for (const S of SURFACES) for (const st of STATES) { const L = ROWS.filter((r) => r.surface === S.path && r.state === st.id && r.width === width); if (!L.length) continue;
    md += `| ${S.path} | ${st.id} | ${checks.map((k) => cell(L.filter((r) => r.check === k))).join(" | ")} | ${cell(L.filter((r) => r.check.startsWith("tap:")))} |\n`; } md += "\n"; }
md += `## Failures\n\n${fails.length ? "| sev | surface | width | state | check | detail |\n|---|---|---|---|---|---|\n" + fails.sort((a, b) => ["high", "medium", "low"].indexOf(sevOf(a.check)) - ["high", "medium", "low"].indexOf(sevOf(b.check))).map((r) => `| ${sevOf(r.check)} | ${r.surface} | ${r.width} | ${r.state} | ${r.check} | ${r.detail.replace(/\|/g, "/").replace(/\n/g, " ")} |`).join("\n") : "None."}\n\n`;
md += `## Taps that passed\n\n| surface | width | state | tap | what happened |\n|---|---|---|---|---|\n${ROWS.filter((r) => r.ok && r.check.startsWith("tap:")).map((r) => `| ${r.surface} | ${r.width} | ${r.state} | ${r.check.slice(5)} | ${r.detail.replace(/\|/g, "/")} |`).join("\n")}\n\n`;
md += `## What each page showed\n\n| surface | width | state | cards |\n|---|---|---|---|\n${ROWS.filter((r) => r.check === "kinds").map((r) => `| ${r.surface} | ${r.width} | ${r.state} | ${r.detail} |`).join("\n")}\n`;
if (!ONLY && !ONLY_STATE) fs.writeFileSync(OUT, md); else fs.writeFileSync(path.join(os.tmpdir(), "feed-discover-audit.partial.md"), md);
console.log(`\n${fails.length} failing (${bySev.high} high, ${bySev.medium} medium, ${bySev.low} low)`);
for (const f of fails) console.log(`${sevOf(f.check).padEnd(6)} ${f.surface.padEnd(9)} ${String(f.width).padEnd(4)} ${f.state.padEnd(9)} ${f.check}: ${f.detail}`);
process.exit(0);
