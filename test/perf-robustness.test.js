// Speed and robustness at the HTTP layer (server/perf.js, public/sw.js, public/poller.js, public/netguard.js):
// compression and cache headers, versioned assets, local fonts, the service worker's strategies, idempotency keys on
// create, reply and pay, the error middleware, the shared poller's backoff, and the /g follow-box fix.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import vm from "node:vm";
import express from "express";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { seedRoutes } from "./routes-seed.js";
import { versionAssets, assetVersion, fontRequest, localFonts, idempotency, errorMiddleware, compressJson } from "../server/perf.js";

const ROOT = path.resolve(import.meta.dirname, ".."), PUB = path.join(ROOT, "public");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let srv, S;
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "perf-robust-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_SIGNUP_PER_HOUR: "500" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); S = await seedRoutes(srv.base); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

// a raw request, so the headers and the bytes on the wire are what the server sent (fetch would decompress)
function raw(p, headers = {}, method = "GET", body = null) {
  const u = new URL(srv.base + p);
  return new Promise((ok, no) => { const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }); r.on("error", no); if (body) r.write(body); r.end(); });
}
const J = { "content-type": "application/json" };

test("pages, scripts and API answers go out compressed, with Vary: Accept-Encoding", async () => {
  const page = await raw("/feed", { "accept-encoding": "br, gzip" });
  assert.equal(page.status, 200); assert.equal(page.headers["content-encoding"], "br"); assert.match(page.headers.vary, /Accept-Encoding/);
  assert.match(zlib.brotliDecompressSync(page.body).toString(), /<html/i);
  const js = await raw("/eventart.js", { "accept-encoding": "gzip" });
  assert.equal(js.headers["content-encoding"], "gzip"); assert.ok(zlib.gunzipSync(js.body).length > js.body.length);
  // JSON over 1.4 KB: brotli, else gzip, else plain; small answers stay plain
  const big = await raw("/api/public/discover", { "accept-encoding": "br" });
  assert.equal(big.status, 200); assert.equal(big.headers["content-encoding"], "br"); assert.match(big.headers.vary, /Accept-Encoding/);
  const data = JSON.parse(zlib.brotliDecompressSync(big.body)); assert.ok(data && typeof data === "object");
  assert.equal((await raw("/api/public/discover", { "accept-encoding": "gzip" })).headers["content-encoding"], "gzip");
  const plain = await raw("/api/public/discover", {}); assert.equal(plain.headers["content-encoding"], undefined); assert.deepEqual(JSON.parse(plain.body), data);
  assert.equal((await raw("/api/signup/config", { "accept-encoding": "br" })).headers["content-encoding"], undefined);
  // the ETag still answers a repeat with a 304 and no body
  const e = big.headers.etag; assert.ok(e); const again = await raw("/api/public/discover", { "accept-encoding": "br", "if-none-match": e });
  assert.equal(again.status, 304); assert.equal(again.body.length, 0);
});

test("versioned scripts and styles are cached for a year; pages revalidate with an ETag", async () => {
  const html = zlib.gunzipSync((await raw("/feed", { "accept-encoding": "gzip" })).body).toString();
  const m = html.match(/<script src="\/eventart\.js\?v=([A-Za-z0-9_-]{10})"/); assert.ok(m, "eventart.js carries ?v=");
  assert.equal(m[1], assetVersion(PUB, "eventart.js"));
  assert.doesNotMatch(html, /<script src="\/[a-z]+\.js"/, "no same-origin script is left unversioned");
  const v = await raw("/eventart.js?v=" + m[1]); assert.equal(v.headers["cache-control"], "public, max-age=31536000, immutable");
  // an old version number (a page from before a deploy) gets the current file with a short cache, never pinned for a year
  const old = await raw("/eventart.js?v=AAAAAAAAAA"); assert.equal(old.status, 200); assert.equal(old.headers["cache-control"], "public, max-age=300");
  assert.equal((await raw("/eventart.js")).headers["cache-control"], "public, max-age=300");
  // pages: no-cache plus an ETag (a repeat visit is a 304)
  const p = await raw("/discover"); assert.match(p.headers["cache-control"], /no-cache/); assert.ok(p.headers.etag);
  assert.equal((await raw("/discover", { "if-none-match": p.headers.etag })).status, 304);
  // the app page and its hashed bundles
  const app = await raw("/g"); assert.match(app.headers["cache-control"], /no-cache/);
  const bundle = app.body.toString().match(/\/_app\/[A-Za-z0-9_-]{16}\.js/)?.[0]; assert.ok(bundle);
  assert.match((await raw(bundle)).headers["cache-control"], /immutable/);
  // the service worker itself is never cached long
  assert.equal((await raw("/sw.js")).headers["cache-control"], "no-cache");
});

test("versionAssets: only files that exist, never the service worker, and selectors in our scripts still match", () => {
  const out = versionAssets(`<script src="/eventart.js"></script><script src="/sw.js"></script><script src="/nope-not-here.js"></script><link rel="stylesheet" href="/system.css"><script src="https://x.example/a.js"></script>`, PUB);
  assert.match(out, /src="\/eventart\.js\?v=/); assert.match(out, /href="\/system\.css\?v=/);
  assert.match(out, /src="\/sw\.js"/); assert.match(out, /src="\/nope-not-here\.js"/); assert.match(out, /src="https:\/\/x\.example\/a\.js"/);
  // scripts that look for a tag before loading a file look for the versioned one too (no double loads)
  for (const f of ["authguard.js", "shell.js", "slots.js", "feedvisual.js", "friendsgoing.js", "inspo.js", "scrapbook.js", "looks-app.js", "swipedeck.js", "tables.js", "planhook.js", "series.js"]) {
    const s = fs.readFileSync(path.join(PUB, f), "utf8");
    for (const m of s.matchAll(/(script|link)\[(src|href)="([^"\]]+)"\]/g)) if (!/fonts\.googleapis/.test(m[3])) assert.ok(s.includes(`${m[1]}[${m[2]}^="${m[3]}?"]`), `${f}: ${m[0]} also matches the versioned URL`);
  }
});

test("fonts are ours: Google Fonts links point at /fonts/css2, swap, the display face preloaded, files cached for a year", async () => {
  const html = zlib.gunzipSync((await raw("/feed", { "accept-encoding": "gzip" })).body).toString();
  assert.doesNotMatch(html, /fonts\.googleapis\.com\/css2\?family=(IBM|Caveat|Fraunces)/);
  assert.match(html, /<link href="\/fonts\/css2\?family=/);
  assert.match(html, /<link rel="preload" href="\/fonts\/ibm-plex-serif-latin-600-normal\.woff2" as="font" type="font\/woff2" crossorigin>/);
  const css = (await raw("/fonts/css2?family=IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500;600&display=swap")).body.toString();
  assert.match(css, /font-family:'IBM Plex Sans';font-style:normal;font-weight:500;font-display:swap;src:url\(\/fonts\/ibm-plex-sans-latin-500-normal\.woff2\)/);
  for (const f of css.matchAll(/url\((\/fonts\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(PUB, f[1])), f[1]);
  const woff = await raw("/fonts/ibm-plex-serif-latin-600-normal.woff2"); assert.equal(woff.status, 200); assert.match(woff.headers["cache-control"], /max-age=31536000.*immutable/);
  // a family we don't have stays on Google
  assert.equal(fontRequest(PUB, "family=Modak&display=swap"), null);
  assert.match(localFonts(`<link href="https://fonts.googleapis.com/css2?family=Modak&display=swap" rel="stylesheet">`, PUB), /fonts\.googleapis\.com/);
  assert.ok(fontRequest(PUB, "family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Sans:wght@400;500;600").length > 3);
  assert.ok(fontRequest(PUB, "family=Fraunces:ital,wght@1,600").every((f) => f.style === "italic"));
});

test("the service worker: network-first pages with a short timeout, cache-first versioned files, network-first APIs with a timeout, offline fallback", () => {
  const sw = read("public/sw.js");
  const warm = sw.match(/const WARM_PAGES = (\/.+\/);/)[1]; // pages a finger warms ahead of a tap (they are still network first)
  for (const p of ["feed", "discover", "plans", "chats", "people", "settings", "start"]) assert.ok(new RegExp(warm.slice(1, -1)).test("/" + p), p);
  assert.ok(!new RegExp(warm.slice(1, -1)).test("/e/abc") && !new RegExp(warm.slice(1, -1)).test("/g"), "invites are never warmed");
  assert.match(sw, /url\.pathname === "\/" && url\.searchParams\.get\("app"\) === "1"/, "the app shell too");
  assert.match(sw, /if \(req\.mode === "navigate"\) \{ if \(same\) e\.respondWith\(page\(e\)\); return; \}/, "every page is network first (test/start-safari.test.js runs it)");
  assert.match(sw, /PAGE_TIMEOUT = \d{4}/);
  assert.match(sw, /url\.pathname\.startsWith\("\/_app\/"\) \|\| url\.pathname\.startsWith\("\/fonts\/"\) \|\| url\.searchParams\.has\("v"\)/, "cache first for files that never change");
  assert.match(sw, /immutable/, "only responses the server marked immutable are pinned");
  assert.match(sw, /API_TIMEOUT = 4000/); assert.match(sw, /Promise\.race\(\[net\.catch\(\(\) => null\), late/); assert.match(sw, /x-pl-cache", "stale"/);
  assert.match(sw, /caches\.match\("\/offline\.html"\)/); assert.ok(fs.existsSync(path.join(PUB, "offline.html")));
  assert.match(sw, /\/\^\\\/api\\\/\(logout\|login\|signup\|auth[^\n]+forget\(\)/, "signing out or in drops cached pages and data");
  assert.match(sw, /!res\.redirected/, "a redirect is never cached as the page");
  assert.match(sw, /navigationPreload\.enable/);
  assert.doesNotMatch(sw, /DATA_APIS[^\n]*(db|host|admin)/, "only a few read-only APIs keep a last copy");
});

test("a page's first API read is preloaded with the exact URL its script asks for", async () => {
  const host = await (await fetch(srv.base + "/@" + S.handle)).text();
  assert.match(host, new RegExp(`<link rel="preload" href="/api/public/host/${S.handle}" as="fetch" crossorigin="anonymous">`));
  assert.match(read("public/host.html"), /fetch\("\/api\/public\/host\/" \+ encodeURIComponent\(handle\)\)/, "host.html asks for that URL");
  const inv = await (await fetch(srv.base + "/e/" + S.open)).text();
  assert.match(inv, new RegExp(`<link rel="preload" href="/api/public/event-host/${S.open}" as="fetch" crossorigin="anonymous">`));
  assert.match(read("public/invite.html"), /fetch\("\/api\/public\/event-host\/" \+ encodeURIComponent\(id\)\)/);
  assert.doesNotMatch(inv, /rel="preload" href="\/fonts\//, "the light invite holds its fonts back: no font preload");
  assert.ok(inv.length < 40000, "the served light invite stays under 40,000 characters: " + inv.length);
  assert.match(await (await fetch(srv.base + "/discover")).text(), /<link rel="preload" href="\/api\/public\/discover" as="fetch"/);
  assert.match(await (await fetch(srv.base + "/feed", { headers: { cookie: S.host.cookie + "; encore_in=1" } })).text(), /<link rel="preload" href="\/api\/me\/feed" as="fetch"/);
  assert.doesNotMatch(await (await fetch(srv.base + "/feed")).text(), /href="\/api\/me\/feed"/, "signed out: no signed-in read");
});

test("speculation rules and the network guard are on full pages, not the light invite", async () => {
  const feed = zlib.gunzipSync((await raw("/feed", { "accept-encoding": "gzip" })).body).toString();
  assert.match(feed, /<style>@view-transition\{navigation:auto\}::view-transition-old\(root\),::view-transition-new\(root\)\{animation-duration:\.15s\}/, "the fade's opt-in is in the head, before the first paint");
  assert.match(feed, /<script type="speculationrules">/); assert.match(feed, /<script src="\/netguard\.js\?v=/);
  const rules = JSON.parse(feed.match(/<script type="speculationrules">([^<]+)<\/script>/)[1]);
  assert.equal(rules.prefetch[0].eagerness, "moderate"); assert.ok(!rules.prerender, "prefetch only");
  assert.ok(JSON.stringify(rules).includes("/api/*") && JSON.stringify(rules).includes("/logout*"));
  const inv = (await (await fetch(srv.base + "/e/" + S.open)).text()); assert.doesNotMatch(inv, /speculationrules|netguard/);
});

test("idempotency keys: a reply sent twice with one key is made once; at the same time, the second waits for the first", async () => {
  const doc = await (await fetch(srv.base + "/api/db/doc?path=events/" + S.open, { headers: { "x-encore-guest": "1" } })).json();
  const send = (key, name) => fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "kidemtest0001", "x-encore-workspace": doc.workspace, "Idempotency-Key": key }, body: JSON.stringify({ eventId: S.open, response: "going", name, email: name.toLowerCase().replace(/\W/g, "") + "@example.com", code: "IDEM01", createdAt: Date.now() }) });
  const a = await send("rsvp-IDEM01-aaaa", "Ana Idem"), ja = await a.json(); assert.equal(a.status, 200, JSON.stringify(ja));
  const b = await send("rsvp-IDEM01-aaaa", "Ana Idem"), jb = await b.json(); assert.equal(b.headers.get("idempotent-replay"), "true"); assert.deepEqual(jb, ja);
  const [c, d] = await Promise.all([send("rsvp-IDEM01-bbbb", "Bo Idem"), send("rsvp-IDEM01-bbbb", "Bo Idem")]); const [jc, jd] = [await c.json(), await d.json()];
  assert.equal(jc.id, jd.id, "two at once make one reply");
  const e = await send("rsvp-IDEM01-cccc", "Cy Idem"), je = await e.json(); assert.notEqual(je.id, ja.id, "a new key is a new reply");
  const host = await (await fetch(srv.base + "/api/db/collection?path=rsvps", { headers: { cookie: S.host.cookie } })).json();
  const mine = (host.docs || host).filter((r) => /Idem$/.test(r.data?.name || ""));
  assert.equal(mine.length, 3, mine.map((r) => r.data.name).join());
  // a key that isn't one is refused plainly
  assert.equal((await send("bad key!", "Di Idem")).status, 400);
});

test("idempotency keys: creating an event and paying for an order run once per key", async () => {
  const mk = (key) => fetch(srv.base + "/api/db/collection?path=events", { method: "POST", headers: { ...J, cookie: S.host.cookie, "Idempotency-Key": key }, body: JSON.stringify({ name: "Idempotent supper", date: "2030-01-02", kind: "social", casual: true }) });
  const [x, y] = await Promise.all([mk("c-idem-event-1"), mk("c-idem-event-1")]); const [jx, jy] = [await x.json(), await y.json()];
  assert.equal(x.status, 200, JSON.stringify(jx)); assert.equal(jx.id, jy.id);
  const list = await (await fetch(srv.base + "/api/db/collection?path=events", { headers: { cookie: S.host.cookie } })).json();
  assert.equal((list.docs || list).filter((d) => d.data?.name === "Idempotent supper").length, 1);
  // a shop order (the pay link comes back with it)
  const order = (key) => fetch(srv.base + "/api/public/order/" + S.handle, { method: "POST", headers: { ...J, "Idempotency-Key": key }, body: JSON.stringify({ name: "Pat Payer", email: "pat.payer@example.com", items: [{ id: "crisp01", qty: 1 }] }) });
  const o1 = await order("order-idem-0001"), j1 = await o1.json(); assert.equal(o1.status, 200, JSON.stringify(j1));
  const o2 = await order("order-idem-0001"), j2 = await o2.json(); assert.equal(o2.headers.get("idempotent-replay"), "true"); assert.equal(j2.code, j1.code);
  const o3 = await order("order-idem-0002"), j3 = await o3.json(); assert.notEqual(j3.code, j1.code);
});

test("idempotency middleware: errors aren't remembered, keys are per person and per route", async () => {
  const app = express(); let n = 0, fail = true;
  const mw = idempotency({ who: (req) => req.get("x-who") || "" }); app.use(mw);
  app.post("/a", (req, res) => { n++; if (fail) { fail = false; return res.status(503).json({ code: "busy" }); } res.json({ n }); });
  app.post("/b", (req, res) => { n++; res.json({ n }); });
  const s = await new Promise((r) => { const x = app.listen(0, "127.0.0.1", () => r(x)); }), base = `http://127.0.0.1:${s.address().port}`;
  const post = (p, who) => fetch(base + p, { method: "POST", headers: { "Idempotency-Key": "same-key-123", "x-who": who } });
  assert.equal((await post("/a", "u1")).status, 503);
  assert.deepEqual(await (await post("/a", "u1")).json(), { n: 2 }, "a 5xx isn't replayed: the retry runs");
  assert.deepEqual(await (await post("/a", "u1")).json(), { n: 2 }, "then it is");
  assert.deepEqual(await (await post("/a", "u2")).json(), { n: 3 }, "another person's same key is theirs");
  assert.deepEqual(await (await post("/b", "u1")).json(), { n: 4 }, "another route is another request");
  assert.deepEqual(await (await fetch(base + "/b", { method: "POST" })).json(), { n: 5 }, "no key: untouched");
  s.close();
});

test("the clients send keys: the light invite's reply, the app's creates, orders and bookings", () => {
  const inv = read("public/invite.html");
  assert.match(inv, /"Idempotency-Key": "rsvp-" \+ code \+ "-"/); assert.match(inv, /const code = window\.__rc \|\|=/, "a retry keeps its code and key");
  assert.ok(inv.length < 40000, `the light invite stays under 40,000 characters (${inv.length})`);
  const shim = read("public/shim.js"); assert.match(shim, /IDEM_COLLECTIONS = \/\^\(events\|rsvps\|kudos\|orders\)\$\//); assert.match(shim, /"Idempotency-Key": idemKey\(path, body\)/);
  assert.match(read("public/invite-order.js"), /"Idempotency-Key": "order-"/);
  assert.match(read("public/storeshop.js"), /\(order\|book\).+"Idempotency-Key": idemOf/);
});

test("the error middleware: JSON for the API, a friendly page for pages, no internals, the server keeps going", async () => {
  const logs = [], app = express();
  app.get("/api/boom", () => { throw new Error("SQLITE_IOERR at /var/data/x.db"); });
  app.get("/page", () => { throw new Error("secret stack"); });
  app.get("/api/teapot", () => { throw Object.assign(new Error("No such plan."), { status: 404, code: "not_found" }); });
  app.post("/api/json", express.json(), (req, res) => res.json(req.body));
  app.get("/api/async", async () => { await null; throw new Error("late"); });
  app.use(errorMiddleware({ page: () => "<!doctype html><title>Page not found · X</title><h1>Gone</h1><p>Old link.</p>", log: (...a) => logs.push(a.join(" ")) }));
  const s = await new Promise((r) => { const x = app.listen(0, "127.0.0.1", () => r(x)); }), base = `http://127.0.0.1:${s.address().port}`;
  const a = await fetch(base + "/api/boom"); assert.equal(a.status, 500); const ja = await a.json();
  assert.equal(ja.code, "server_error"); assert.doesNotMatch(ja.message, /SQLITE|\/var/); assert.ok(logs.some((l) => /GET \/api\/boom/.test(l)));
  const p = await fetch(base + "/page", { headers: { accept: "text/html" } }); assert.equal(p.status, 500); const t = await p.text();
  assert.match(t, /Something went <em>wrong<\/em>/); assert.doesNotMatch(t, /secret|Gone/); assert.equal(p.headers.get("cache-control"), "no-store");
  const k = await fetch(base + "/api/teapot"); assert.equal(k.status, 404); assert.deepEqual(await k.json(), { code: "not_found", message: "No such plan." });
  const bj = await fetch(base + "/api/json", { method: "POST", headers: J, body: "{nope" }); assert.equal(bj.status, 400); assert.equal((await bj.json()).code, "bad_json");
  assert.equal((await fetch(base + "/api/async")).status, 500, "a rejected promise in a route is caught too");
  assert.equal((await fetch(base + "/api/teapot")).status, 404, "and the server is still answering");
  s.close();
  // the real app: a bad body and an unknown endpoint answer plainly
  const r = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1" }, body: "{" }); assert.equal(r.status, 400);
  assert.ok([401, 404].includes((await fetch(srv.base + "/api/nope-not-an-endpoint")).status));
});

test("compressJson leaves HEAD, small bodies and already-encoded answers alone", async () => {
  const app = express(); app.use(compressJson());
  app.get("/big", (req, res) => res.json({ x: "a".repeat(5000) })); app.get("/small", (req, res) => res.json({ ok: 1 }));
  const s = await new Promise((r) => { const x = app.listen(0, "127.0.0.1", () => r(x)); }), port = s.address().port;
  const get = (p, method = "GET") => new Promise((ok) => http.request({ host: "127.0.0.1", port, path: p, method, headers: { "accept-encoding": "br" } }, (res) => { res.resume(); res.on("end", () => ok(res)); }).end());
  assert.equal((await get("/big")).headers["content-encoding"], "br"); assert.equal((await get("/small")).headers["content-encoding"], undefined);
  assert.equal((await get("/big", "HEAD")).headers["content-encoding"], undefined);
  s.close();
});

// ---- the shared poller (public/poller.js), run with a fake clock and a fake document ----
function pollerSandbox() {
  let now = 0; const timers = []; const listeners = {};
  const doc = { hidden: false, addEventListener: (k, f) => ((listeners[k] ||= []).push(f)) };
  const sb = { Date: { now: () => now }, setTimeout: (f, ms) => { const t = { at: now + ms, f }; timers.push(t); return t; }, clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    document: doc, navigator: { onLine: true }, addEventListener: (k, f) => ((listeners[k] ||= []).push(f)), Math };
  sb.window = sb; vm.createContext(sb); vm.runInContext(read("public/poller.js"), sb);
  const flush = () => new Promise((r) => setImmediate(r));
  async function advance(ms) { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = t.at; t.f(); await flush(); await flush(); } now = end; }
  const fire = (k) => (listeners[k] || []).forEach((f) => f({}));
  return { P: sb.PLPoll, advance, doc, fire, nav: sb.navigator, flush, now: () => now };
}
test("the poller: one task per key, paused while the tab is hidden, caught up when it shows", async () => {
  const X = pollerSandbox(); let n = 0;
  X.P.every("badge", () => { n++; }, { ms: 1000 }); X.P.every("badge", () => { n += 100; }, { ms: 1000 }); // asking again replaces it
  await X.advance(3100); assert.equal(n, 300);
  X.doc.hidden = true; await X.advance(10000); assert.equal(n, 300, "nothing runs once the tab is hidden");
  const before = n; await X.advance(60000); assert.equal(n, before, "nothing while hidden");
  X.doc.hidden = false; X.fire("visibilitychange"); await X.flush(); await X.flush(); assert.equal(n, before + 100, "runs at once when the tab shows");
  X.nav.onLine = false; const off = n; await X.advance(5000); assert.equal(n, off, "nothing while offline");
  X.nav.onLine = true; X.fire("online"); await X.flush(); await X.flush(); assert.ok(n > off, "and catches up when back online");
});
test("the poller: failures back off (doubling, capped) and a success resets; a task never overlaps itself", async () => {
  const X = pollerSandbox(); const at = []; let fail = true;
  X.P.every("inbox", async () => { at.push(X.now()); if (fail) throw new Error("down"); }, { ms: 1000, max: 8000 });
  await X.advance(30000);
  const gaps = at.slice(1).map((t, i) => t - at[i]); assert.deepEqual(gaps.slice(0, 4), [2000, 4000, 8000, 8000], gaps.join());
  fail = false; const k = at.length; await X.advance(30000);
  const g2 = at.slice(k).map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x != null); assert.ok(g2.slice(1).every((g) => g === 1000), "back to every second: " + g2.join());
  // a slow run doesn't start a second copy
  const Y = pollerSandbox(); let running = 0, most = 0, release;
  Y.P.every("slow", () => { running++; most = Math.max(most, running); return new Promise((r) => { release = () => { running--; r(); }; }); }, { ms: 100, now: true });
  await Y.advance(1000); assert.equal(most, 1); release(); await Y.flush();
});
test("the chat badge and the chats inbox use the shared poller", () => {
  assert.match(read("public/chatnav.js"), /window\.PLPoll\.every\("unread", check, \{ ms: 45000, max: 5 \* 60000, now: true \}\)/);
  assert.match(read("public/chat.js"), /window\.PLPoll\.every\("chat-inbox"/); assert.match(read("public/chats.html"), /<script src="\/poller\.js"><\/script>/);
});

test("/g: the follow box under a guest's ticket stays put (two layout rules used to move it back and forth ~8 times a second)", () => {
  const html = read("index.html");
  const ev2 = html.match(/const fol=host\.querySelector\("\.gk-follow"\);[^\n]*/)[0];
  assert.match(ev2, /&&!fol\.dataset\.underTicket\)/, "ev2Layout leaves a box the ticket rule placed");
  assert.match(html, /if\(gfm&&gfm\.querySelector\("\.ticket"\)\)\{ f\.dataset\.underTicket="1"; if\(gfm\.compareDocumentPosition\(f\)&Node\.DOCUMENT_POSITION_PRECEDING\) gfm\.after\(f\) \}/);
  // and ev2Layout no longer rewrites attributes that are already right (each write woke every observer on the page)
  assert.match(html, /if\(!host\.classList\.contains\("ev2"\)\) host\.classList\.add\("ev2"\);/);
  assert.match(html, /if\(k&&s\.dataset\.k!==k\) s\.dataset\.k=k/);
});

test("the network guard shares identical reads in flight, never across a write", async () => {
  let calls = 0; const pending = [];
  const fakeFetch = (u, init) => { calls++; return new Promise((r) => pending.push(() => r(new Response(JSON.stringify({ u, n: calls }), { status: 200 })))); };
  const sb = { fetch: fakeFetch, location: { href: "https://pl.test/feed", origin: "https://pl.test", pathname: "/feed" }, document: { cookie: "encore_in=1", getElementById: () => null }, performance: { now: () => 0 }, addEventListener() {}, navigator: {}, console, URL, Response, Request, Promise, JSON, setTimeout, crypto: globalThis.crypto };
  sb.window = sb; vm.createContext(sb); vm.runInContext(read("public/netguard.js"), sb);
  const a = sb.fetch("/api/me"), b = sb.fetch("/api/me"); assert.equal(calls, 1, "two reads at once: one request");
  sb.fetch("/api/me/feed", { method: "POST", body: "{}" }); const c = sb.fetch("/api/me"); assert.equal(calls, 3, "a write ends the sharing");
  pending.forEach((f) => f()); const [ja, jb] = await Promise.all([(await a).json(), (await b).json()]); assert.deepEqual(ja, jb); await c;
  sb.fetch("/feed.html"); assert.equal(calls, 4, "only the API");
});

test("the store caches whole-collection reads until that collection changes", async () => {
  const { openStore } = await import("../server/db.js"); const st = openStore(":memory:");
  st.set("ws/a/rsvps/r1", { n: 1 }); st.set("ws/a/events/e1", { t: "x" });
  const a = st.listShared("ws/a/rsvps"); assert.equal(a.length, 1); assert.equal(st.listShared("ws/a/rsvps"), a, "the same parse while nothing changed");
  st.set("ws/a/events/e2", { t: "y" }); assert.equal(st.listShared("ws/a/rsvps"), a, "a write elsewhere keeps it");
  st.set("ws/a/rsvps/r2", { n: 2 }); assert.equal(st.listShared("ws/a/rsvps").length, 2, "a write to it refreshes it");
  st.update("ws/a/rsvps/r1", { n: 9 }); assert.equal(st.listShared("ws/a/rsvps").find((d) => d.id === "r1").data.n, 9);
  st.delete("ws/a/rsvps/r2"); assert.equal(st.listShared("ws/a/rsvps").length, 1);
  const l = st.list("ws/a/rsvps"); l[0].data.n = 100; assert.equal(st.list("ws/a/rsvps")[0].data.n, 9, "list() hands out fresh objects");
  st.deletePrefix("ws/a/"); assert.equal(st.list("ws/a/rsvps").length, 0); assert.equal(st.listShared("ws/a/rsvps").length, 0);
  st.close();
});

test("SQLite waits for a lock instead of failing (WAL and a busy timeout)", async () => {
  const { openStore } = await import("../server/db.js"); const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-wal-")), st = openStore(path.join(dir, "w.db"));
  assert.match(read("server/db.js"), /journal_mode = WAL/); assert.match(read("server/db.js"), /busy_timeout = 5000/);
  st.set("a/b", { ok: 1 }); assert.deepEqual(st.get("a/b").data, { ok: 1 }); st.close(); fs.rmSync(dir, { recursive: true, force: true });
});
