// "Plan a dinner" on a phone (the owner, on an iPhone: "nothing showed up and everything is broken after that"):
// /start has the app's nav, a signed-in host goes straight to the create canvas, "Open it in Pottery Lab" opens that
// event in the canvas, the "Would you go?" deck never covers a page by itself, the service worker never keeps a broken
// page, and the scripts on this path parse and run on iOS Safari 15 and 16.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { startRedirect } from "../server/hostloop.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const J = { "content-type": "application/json" };
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "start-safari-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1" };
let srv, host;
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Lan Vo", email: "lan.start@example.com", password: "long-password-1", mode: "friends" }) });
  assert.equal(r.status, 200); host = r.headers.get("set-cookie").split(";")[0] + "; encore_in=1"; });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });
const get = (p, cookie) => fetch(srv.base + p, { redirect: "manual", headers: cookie ? { cookie } : {} });

// ---------- /start has a way back ----------
test("/start carries the app's nav: the shell loads there and draws the tab bar and rail for it", async () => {
  const r = await get("/start"); assert.equal(r.status, 200); const html = await r.text();
  assert.match(html, /<script src="\/shell\.js(\?v=[^"]+)?" defer><\/script>/, "the shell (tab bar on phones, rail on wide screens)");
  const shell = read("public/shell.js"), list = shell.match(/if \(!\(isG \|\| TABS_ONLY \|\| (\/\^\\\/\(discover[^/]+\)\$\/)\.test\(P\)/);
  assert.ok(list, "the shell's page list"); assert.ok(new RegExp(list[1].slice(1, -1)).test("/start"), "the shell draws its nav on /start");
  assert.match(read("public/authguard.js"), /\|inbox\|start\)\$\/\.test\(P\)/, "the rail's room is held before the first paint");
  const start = read("public/start.html");
  assert.match(start, /body\.es-has-tabs \.go\{bottom:var\(--st-tabs,64px\)/, "the Save bar sits above the tab bar, not under it");
});

// ---------- a signed-in host goes to the canvas ----------
test("startRedirect: a signed-in host's Plan a dinner opens the create canvas with the kind set; everyone else stays", () => {
  const H = { ws: "w1" };
  assert.equal(startRedirect({}, H), "/?app=1&new=1&kind=dinner#studio");
  assert.equal(startRedirect({ t: "dinner4" }, H), "/?app=1&new=1&kind=dinner#studio");
  assert.equal(startRedirect({ t: "table" }, H), "/?app=1&new=1&kind=table#studio");
  assert.equal(startRedirect({ t: "weekend" }, H), "/?app=1&new=1&kind=weekend#studio");
  assert.equal(startRedirect({ t: "summit" }, H), "/?app=1&new=1&kind=summit#studio");
  assert.equal(startRedirect({}, null), null, "signed out: the first-timer page");
  assert.equal(startRedirect({ save: "1" }, H), null, "back from sign-up with a draft to save");
  assert.equal(startRedirect({ saved: "abc" }, H), null);
  assert.equal(startRedirect({ t: "again", from: "ev1" }, H), null, "same crew from a past event keeps its name");
  assert.equal(startRedirect({ t: "coffee" }, H), null, "a small move the canvas has no kind for");
  assert.equal(startRedirect({ t: "constructor" }, H), null); assert.equal(startRedirect({ t: ["table"] }, H), "/?app=1&new=1&kind=dinner#studio");
});
test("GET /start: signed in it redirects into the canvas (never cached), signed out it is the page", async () => {
  const r = await get("/start", host); assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/?app=1&new=1&kind=dinner#studio");
  assert.match(r.headers.get("cache-control"), /no-store/); assert.match(r.headers.get("vary") || "", /Cookie/i);
  assert.equal((await get("/start?t=table", host)).headers.get("location"), "/?app=1&new=1&kind=table#studio");
  for (const p of ["/start?save=1", "/start?t=coffee", "/start?saved=stAbc"]) assert.equal((await get(p, host)).status, 200, p);
  assert.equal((await get("/start")).status, 200); assert.equal((await get("/start", "encore_in=1")).status, 200, "a stale hint without a session");
  // the canvas takes ?kind= and the chooser skips straight to it
  assert.match(read("public/canvas.js"), /want = u\.searchParams\.get\("kind"\)/); assert.match(read("public/drop.js"), /get\("kind"\); if \(k && k !== "drop" && o\.event\) return o\.event\(\)/);
  assert.match(read("index.html"), /q\.get\("new"\)==="1"\|\|fromPage/, "the app starts a new event on ?new=1");
});
test("on /start, Open it in Pottery Lab opens that event in the canvas, and the done screen only says first when it is", () => {
  const start = read("public/start.html"), app = read("index.html");
  assert.match(start, /\$\("#openApp"\)\.href = "\/\?app=1&open=" \+ encodeURIComponent\(id\) \+ "&canvas=1#studio"/);
  assert.doesNotMatch(start.match(/<div id="done"[\s\S]*?<\/div>\n  <p class="msg"/)[0], /first/i, "the page itself never claims a first");
  assert.match(start, /if \(cel && cel\.id === "first"\) \{ \$\("#doneH"\)\.textContent = cel\.title;/, "only the server's first-event milestone says first");
  // ?open= wins over "start a new event when you arrive from another page" (that one used to open the chooser instead)
  assert.match(app, /window\.__plOpenId=id;/); assert.match(app, /!q\.get\("open"\)&&!window\.__plOpenId&&\(q\.get\("new"\)==="1"\|\|fromPage\)/);
  assert.match(app, /cv=u\.searchParams\.get\("canvas"\)==="1"/); assert.match(app, /if\(cv\)\{[^}]*window\.EventCanvas\.open\(\{mode:"edit"\}\)/);
});

// ---------- the deck never covers a page by itself ----------
function runDeck() {
  const L = {}, timers = [], fetches = [], body = { style: { overflow: "" }, appendChild() {} };
  const doc = { body, head: { appendChild() {} }, cookie: "", hidden: false, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {} }), addEventListener() {}, removeEventListener() {}, contains: () => false };
  const w = { document: doc, addEventListener: (k, f) => (L[k] = L[k] || []).push(f), dispatchEvent() {}, matchMedia: () => ({ matches: false }), setTimeout: (f, ms) => timers.push(ms), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: (u) => { fetches.push(u); return Promise.resolve({ ok: true, json: async () => ({}) }); }, localStorage: { getItem: () => null, setItem() {} }, location: { pathname: "/feed" }, URLSearchParams, CustomEvent: class {}, performance: { now: () => 0 } };
  w.window = w; vm.runInNewContext(read("public/swipedeck.js"), w); return { w, L, timers, fetches, body };
}
test("the Would you go? deck opens only from a tap and always lets go of the page", async () => {
  const { w, L, timers, fetches } = runDeck();
  assert.equal(w.PLDeck.maybeAuto(), false); await new Promise((r) => setImmediate(r));
  assert.equal(timers.length, 0, "no timer to open it later"); assert.equal(fetches.length, 0, "no deck fetched on a first visit");
  assert.ok(L.pagehide?.length && L.pageshow?.length, "pagehide and the back-forward cache take it down");
  const deck = read("public/swipedeck.js");
  assert.match(deck, /const letGo = \(\) => \{[^\n]*document\.querySelectorAll\("\.sd"\)\.forEach\(\(x\) => x\.remove\(\)\)/, "letting go removes every deck");
  assert.match(deck, /release = \(\) => \{ el\.remove\(\); document\.body\.style\.overflow = prevOverflow;/, "and gives the page its scroll back");
  assert.match(deck, /const close = \(\) => \{ letGo\(\);/, "closing lets go too");
  assert.match(deck, /if \(openNow \|\| leaving \|\| document\.querySelector\("\.sd"\)\) return;/, "never while the page is going away");
  assert.doesNotMatch(read("public/feedvisual.js"), /maybeAuto\(/, "the feed no longer asks the deck to open itself");
  assert.match(read("public/feedvisual.js"), /\[data-fb-deck\][^\n]*PLDeck\?\.open\(\{\}\)/, "Swipe ideas still opens it");
});

// ---------- the service worker never keeps a broken page ----------
function runSW() {
  const caches = new Map(), H = {}, timers = [];
  const store = (n) => { if (!caches.has(n)) caches.set(n, new Map()); const m = caches.get(n); return { put: async (k, v) => m.set(typeof k === "string" ? k : k.url, v), match: async (k) => m.get(typeof k === "string" ? k : k.url)?.clone(), keys: async () => [...m.keys()].map((url) => ({ url })), delete: async (k) => m.delete(typeof k === "string" ? k : k.url), addAll: async () => {} }; };
  const C = { open: async (n) => store(n), keys: async () => [...caches.keys()], delete: async (n) => caches.delete(n),
    match: async (k, o = {}) => { const key = typeof k === "string" ? k : k.url; for (const [n, m] of caches) if ((!o.cacheName || o.cacheName === n) && m.has(key)) return m.get(key).clone?.() || m.get(key); return undefined; } };
  const ctx = { self: { location: { origin: "https://pl.test" }, addEventListener: (k, f) => (H[k] = f), registration: {}, clients: { claim: async () => {} } }, caches: C, URL, Headers, Response, Promise,
    setTimeout: (f, ms) => { timers.push(ms); return setTimeout(f, Math.min(ms, 30)); }, fetch: null, console };
  vm.runInNewContext(read("public/sw.js").replace("__SW_VERSION__", "test12345678"), ctx);
  const nav = async (url, reply) => { ctx.fetch = reply; let res; const waits = []; await H.fetch({ request: { url, method: "GET", mode: "navigate" }, preloadResponse: Promise.resolve(undefined), respondWith: (p) => (res = p), waitUntil: (p) => waits.push(p) });
    const out = await res; await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 100))]); return out; }; // a hung network never settles its wait
  const pages = () => [...caches].filter(([n]) => n.startsWith("pl-pages-")).flatMap(([, m]) => [...m.keys()]);
  return { nav, pages, timers, ctx };
}
// a same-origin answer as the browser hands it to a worker (type "basic"), clones included
class Basic extends Response { get type() { return "basic"; } get redirected() { return !!this.r; } clone() { const c = super.clone(); Object.setPrototypeOf(c, Basic.prototype); c.r = this.r; return c; } }
const html = (status, body = "<!doctype html><p>hi</p>", h = {}) => new Basic(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...h } });
test("the service worker: network first for every page, and only a plain 200 HTML page is ever kept", async () => {
  const S = runSW();
  assert.equal((await S.nav("https://pl.test/start", async () => html(500, "<p>Something went wrong</p>"))).status, 500, "the error reaches the page");
  assert.equal((await S.nav("https://pl.test/feed", async () => html(404))).status, 404);
  await S.nav("https://pl.test/about", async () => new Basic("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  await S.nav("https://pl.test/plans", async () => html(200, "x", { "Cache-Control": "private, no-store" }));
  const redirected = html(200); redirected.r = true; await S.nav("https://pl.test/discover", async () => redirected);
  assert.deepEqual(S.pages(), [], "no error page, JSON, no-store page or redirect was kept");
  await S.nav("https://pl.test/feed#top", async () => html(200, "<p>fresh feed</p>"));
  assert.deepEqual(S.pages(), ["https://pl.test/feed"], "a good page is kept, once, without its #hash");
  // the network answers first even when a copy is kept (it used to be the old copy first, the fresh one next time)
  assert.equal(await (await S.nav("https://pl.test/feed", async () => html(200, "<p>newer feed</p>"))).text(), "<p>newer feed</p>");
  // a network that hangs: the last good copy after the timeout; a dropped one: the copy, else the offline page
  const slow = await S.nav("https://pl.test/feed", () => new Promise(() => {})); assert.equal(await slow.text(), "<p>newer feed</p>");
  assert.ok(S.timers.some((ms) => ms > 1000 && ms <= 4000), "the page timeout is short");
  const down = await S.nav("https://pl.test/feed", async () => { throw new TypeError("Load failed"); }); assert.equal(await down.text(), "<p>newer feed</p>");
  const none = await S.nav("https://pl.test/never", async () => { throw new TypeError("Load failed"); }); assert.equal(none.status, 503);
  const sw = read("public/sw.js");
  assert.doesNotMatch(sw, /SWR_PAGES|swrPage/, "no stale-while-revalidate for pages any more");
  assert.match(sw, /const REV = \d+;/); assert.match(sw, /PAGES = "pl-pages-" \+ VERSION \+ "-r" \+ REV, DATA = "pl-data-r" \+ REV/, "the bump drops every page and data copy");
  assert.match(sw, /!\[SHELL, STATIC, PAGES, DATA\]\.includes\(k\)\) await caches\.delete\(k\)/, "old caches, the old data cache too, are deleted");
});

// ---------- iOS Safari 15 and 16 ----------
// Every script /start loads (its own, the ones the server adds to every page, and the ones those load), the shell's,
// the deck's and the app's: no syntax or API older iPhones lack, unless guarded.
const ON_PATH = ["public/start.html", "public/authguard.js", "public/mascot.js", "public/fx.js", "public/hostloop.js", "public/shell.js", "public/netguard.js", "public/native.js", "public/calm.js",
  "public/help.js", "public/chatnav.js", "public/potto.js", "public/save.js", "public/interests.js", "public/nudges.js", "public/swipedeck.js", "public/feedvisual.js", "public/feed.html", "public/home.html", "public/canvas.js"];
const UNSAFE = [
  [/\(\?<[=!]/, "regex lookbehind (Safari 16.4)"], [/\bstructuredClone\(/, "structuredClone (15.4)"], [/\.(findLast|findLastIndex|toSorted|toReversed|toSpliced)\(/, "ES2023 array methods (16.0 to 16.4)"],
  [/\]\.with\(|\)\.with\(\d/, "Array.prototype.with (16)"], [/\bObject\.hasOwn\(/, "Object.hasOwn (15.4)"], [/\bstatic\s*\{/, "class static blocks (16.4)"], [/\.at\(-?\d/, "Array.prototype.at (15.4)"],
  [/\bObject\.groupBy\(|\bMap\.groupBy\(/, "groupBy (17.4)"], [/\bPromise\.withResolvers\(/, "Promise.withResolvers (17.4)"], [/\bAbortSignal\.timeout\(/, "AbortSignal.timeout (16)"], [/\bArray\.fromAsync\(/, "Array.fromAsync (16.4)"],
  [/\.showPopover\(|\spopover=/, "the Popover API (17)"], [/\bnew CloseWatcher\b/, "CloseWatcher"],
];
const scripts = (f) => { const s = read(f); return f.endsWith(".html") ? [...s.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:speculationrules|application\/ld\+json)")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n") : s; };
test("the scripts on the Plan a dinner path have nothing iOS Safari 15 or 16 can't run", () => {
  for (const f of ON_PATH) { const src = scripts(f);
    for (const [re, what] of UNSAFE) assert.doesNotMatch(src, re, `${f}: ${what}`);
    // APIs some iPhones lack are only used behind a check
    for (const m of src.matchAll(/requestIdleCallback\(/g)) assert.match(src.slice(Math.max(0, m.index - 80), m.index), /requestIdleCallback\s*\?|typeof\s+requestIdleCallback|"requestIdleCallback" in/, `${f}: requestIdleCallback is guarded`);
    for (const m of src.matchAll(/startViewTransition\(/g)) assert.match(src.slice(Math.max(0, m.index - 80), m.index), /startViewTransition\s*&&|startViewTransition\?\./, `${f}: startViewTransition is guarded`);
    for (const m of src.matchAll(/crypto\.randomUUID\(/g)) assert.match(src.slice(Math.max(0, m.index - 60), m.index), /try\s*\{|randomUUID\s*\?/, `${f}: randomUUID is guarded`);
    // storage can throw (Safari with all cookies blocked, some private windows): every read and write sits in a try
    for (const m of src.matchAll(/\b(localStorage|sessionStorage)\.(getItem|setItem|removeItem|key|clear)\(/g)) { const back = src.slice(Math.max(0, m.index - 1500), m.index);
      assert.ok(/try\s*\{/.test(back), `${f}: ${m[0]} at ${m.index} is inside a try`); }
    // dvh and friends (15.4) always come after a vh fallback in the same rule
    for (const m of src.matchAll(/(?<=[;{]\s*)([a-z-]+):([^;}"`]*\d+[dsl]vh[^;}"`]*)/g)) { const before = src.slice(Math.max(0, m.index - 200), m.index); assert.ok(new RegExp(`${m[1]}:[^;}]*\\d+vh[^;}]*;\\s*$`).test(before) || /--[a-z-]+$/.test(m[1]), `${f}: ${m[0].slice(0, 60)} has a vh fallback`); }
  }
});
test("the app's lookbehind patterns are built at run time with a fallback, so an older iPhone parses every script block", () => {
  const app = read("index.html"), lines = app.split("\n").filter((l) => /\(\?<[=!]/.test(l) && !/^\s*\/\//.test(l) && !l.includes("src.startsWith(\"(?<"));
  assert.ok(lines.length > 0); for (const l of lines) assert.match(l, /\(globalThis\.plRx\|\|RegExp\)\(/, "lookbehind only inside plRx(): " + l.trim().slice(0, 100));
  const blocks = [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // no regex literal with a lookbehind left anywhere: parse each block with lookbehind literals made illegal
  for (const [i, b] of blocks.entries()) assert.doesNotMatch(b, /\/\(\?<[=!]/, `block ${i}: a lookbehind literal`);
  const def = blocks.find((b) => b.includes("window.plRx=")); assert.ok(def, "plRx is defined in an early block");
  assert.ok(blocks.indexOf(def) <= blocks.findIndex((b) => b.includes("plRx||RegExp")), "before any block uses it");
  // run plRx with a RegExp that refuses lookbehind, like Safari 16.3
  const Old = function (src, flags) { if (/\(\?<[=!]/.test(src)) throw new SyntaxError("Invalid regular expression: invalid group specifier name"); return new RegExp(src, flags); };
  const w = {}; vm.runInNewContext(def.slice(def.indexOf("window.plRx="), def.indexOf("// local calendar dates")), { window: w, RegExp: Old });
  const r1 = w.plRx(String.raw`(?<![$\d.:])\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b`, "i"); assert.equal("dinner at 7pm".match(r1)[1], "7");
  const r2 = w.plRx(String.raw`(?<!\$\s?\d{1,5}(?:\.\d{2})?\s*(?:for|gets you)\s+(?:a\s+)?)\b(\d+)\s+seats`, "i"); assert.equal("about 8 seats".match(r2)[1], "8");
  const r3 = w.plRx(String.raw`x(?<=[(\]])y`, ""); assert.ok(r3.test("xy"), "a bracket or paren inside the lookbehind is skipped with it");
  assert.equal(w.plRx("a(?<!b)c", "").source, "ac");
  assert.equal(w.plRx("abc", "g").flags, "g", "a pattern without lookbehind is untouched");
});
