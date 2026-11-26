// The App Store workstream (server/appstore.js, account.js, safety.js, push.js; public/native.js, safety.js, sw.js):
// universal links and App Links, the web manifest and icons, the service worker, account deletion (now and after a
// grace period), report / block / the moderation queue, the text filter, the push registry and send (fake mode),
// and native.js doing nothing on the web.
import { getDbUser, putDbUser } from "../server/workspaces.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { aasa, assetLinks, pwaHead, APP_PATHS } from "../server/appstore.js";
import { textProblem, scrub, textHash, keyOf } from "../server/safety.js";
import { fakeOutbox, clearFakeOutbox, groupOf } from "../server/push.js";
import { scopeStore } from "../server/workspaces.js";

let srv;
const J = { "content-type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "appstore-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_PUSH: "1", ENCORE_ADMIN_EMAILS: "mod.as@example.com" };
before(async () => { Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer(); });
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

const post = (p, body, cookie = "", method = "POST") => fetch(srv.base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie = "") => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
async function signup(name, email) {
  const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, await r.clone().text());
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const me = await (await get("/api/me", cookie)).json(); return { cookie, ws: me.workspace.id, email, key: keyOf(email) };
}
const login = async (email) => { const r = await post("/api/login", { email, password: "long-password-1" }); return { status: r.status, cookie: (r.headers.getSetCookie() || []).map((c) => c.split(";")[0]).join("; ") }; };
const waitFor = async (f, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

// ---------- links ----------
test("apple-app-site-association lists the app paths for the team and bundle ids from env, as JSON with no redirect", async () => {
  const r = await fetch(srv.base + "/.well-known/apple-app-site-association", { redirect: "manual" });
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^application\/json/);
  const j = await r.json(), d = j.applinks.details[0];
  assert.deepEqual(d.appIDs, ["TEAMID0000.com.potterylab.app"], "placeholder until ENCORE_APPLE_TEAM_ID is set");
  for (const p of ["/e/*", "/i/*", "/g", "/@*", "/x/*", "/feed"]) assert.ok(d.components.some((c) => c["/"] === p), p);
  assert.deepEqual(APP_PATHS, ["/e/*", "/i/*", "/g", "/@*", "/x/*", "/feed", "/auth/app", "/auth/email"]);
  const A = aasa({ ENCORE_APPLE_TEAM_ID: "ABCDE12345", ENCORE_IOS_BUNDLE_ID: "ai.potterylab.ios" });
  assert.deepEqual(A.applinks.details[0].appIDs, ["ABCDE12345.ai.potterylab.ios"]); assert.deepEqual(A.webcredentials.apps, ["ABCDE12345.ai.potterylab.ios"]); assert.deepEqual(A.appclips.apps, ["ABCDE12345.ai.potterylab.ios.Clip"]);
});
test("assetlinks.json names the Android package and the signing fingerprints from env", async () => {
  const r = await get("/.well-known/assetlinks.json"); assert.equal(r.status, 200); const j = await r.json();
  assert.equal(j[0].target.package_name, "com.potterylab.app"); assert.deepEqual(j[0].target.sha256_cert_fingerprints, []);
  const fp = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, "0")).join(":");
  const L = assetLinks({ ENCORE_ANDROID_PACKAGE: "ai.potterylab.android", ENCORE_ANDROID_SHA256: fp + ", not-a-fingerprint" });
  assert.equal(L[0].target.package_name, "ai.potterylab.android"); assert.deepEqual(L[0].target.sha256_cert_fingerprints, [fp]);
  assert.ok(L[0].relation.includes("delegate_permission/common.handle_all_urls"));
});

// ---------- PWA ----------
const pngSize = (f) => { const b = fs.readFileSync(f); assert.equal(b.toString("ascii", 1, 4), "PNG", f); return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]]; };
test("the web manifest is valid: name, standalone, brand colors, every icon exists at its size, maskable and 1024 icons", async () => {
  const r = await get("/manifest.webmanifest"); assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /manifest\+json/);
  const M = await r.json();
  assert.equal(M.name, "Pottery Lab"); assert.equal(M.display, "standalone"); assert.equal(M.scope, "/"); assert.match(M.start_url, /^\//);
  const paper = /--pl-page:(#[0-9A-F]{6})/i.exec(read("public/system.css"))[1]; assert.equal(M.theme_color.toLowerCase(), paper.toLowerCase()); assert.equal(M.background_color.toLowerCase(), paper.toLowerCase());
  for (const i of M.icons) { const [w, h] = pngSize(path.join("public", i.src)); assert.equal(`${w}x${h}`, i.sizes, i.src); }
  for (const s of ["192x192", "512x512"]) { assert.ok(M.icons.some((i) => i.sizes === s && i.purpose === "any"), s); assert.ok(M.icons.some((i) => i.sizes === s && i.purpose === "maskable"), "maskable " + s); }
  const [w, , colorType] = pngSize("public/icons/icon-1024.png"); assert.equal(w, 1024); assert.notEqual(colorType, 6, "the App Store icon has no alpha channel");
  assert.equal(pngSize("public/icons/apple-touch-icon.png")[0], 180);
  for (const f of ["icon-only.png", "icon-foreground.png", "icon-background.png", "splash.png", "splash-dark.png"]) assert.ok(fs.existsSync("mobile/resources/" + f), f);
  assert.ok(!/—/.test(M.description));
});
test("pages carry the manifest, touch icon, launch images and service worker; the light invite stays under 40,000 characters", async () => {
  const feed = await (await get("/feed")).text();
  for (const s of ['rel="manifest"', 'rel="apple-touch-icon"', "apple-touch-startup-image", 'apple-mobile-web-app-capable', "/native.js", "/safety.js", 'serviceWorker.register("/sw.js")']) assert.ok(feed.includes(s), s);
  assert.equal((feed.match(/rel="manifest"/g) || []).length, 1, "once");
  assert.ok(feed.indexOf('<meta charset') < 1024 || !feed.includes("<meta charset"), "charset stays in the first 1024 bytes");
  const h = await signup("Ivy Invite", "ivy.as@example.com");
  await fetch(srv.base + "/api/db/doc?path=events/asinv1", { method: "PUT", headers: { ...J, cookie: h.cookie }, body: JSON.stringify({ kind: "social", casual: true, name: "Clay night", date: "2026-12-12", startTime: "19:00", city: "Brooklyn", published: true }) });
  const inv = await (await get("/e/asinv1")).text(); assert.ok(inv.length < 40000, String(inv.length)); assert.match(inv, /rel="manifest"/); assert.match(inv, /\/native\.js/); assert.doesNotMatch(inv, /apple-touch-startup-image/);
  assert.ok(read("public/invite.html").length < 40000);
  const app = await (await get("/?app=1", h.cookie)).text(); assert.match(app, /rel="manifest"/);
  assert.equal(pwaHead(pwaHead("<html><head><title>x</title></head>")), pwaHead("<html><head><title>x</title></head>"), "idempotent");
});
test("/sw.js is served from the root with a content-hash version, an offline shell, and no caching of the API", async () => {
  const r = await get("/sw.js"); assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /javascript/); assert.equal(r.headers.get("cache-control"), "no-cache");
  const body = await r.text(); const v = /const VERSION = "([a-f0-9]{12})"/.exec(body); assert.ok(v, "stamped"); assert.doesNotMatch(body, /__SW_VERSION__/);
  assert.match(body, /\/offline\.html/); assert.match(body, /caches\.delete/); assert.match(body, /\(api\|_blob/);
  new vm.Script(body); // parses
  const off = await get("/offline.html"); assert.equal(off.status, 200); assert.match(await off.text(), /You're offline/);
});

// ---------- native.js ----------
function runNative(win) {
  const listeners = []; const doc = { readyState: "complete", documentElement: { classList: { add() { listeners.push("class"); } } }, addEventListener: (...a) => listeners.push(a[0]), head: { appendChild() {} }, querySelector: () => null, createElement: () => ({ style: {}, content: "" }), cookie: "" };
  const nav = {}; const w = { document: doc, navigator: nav, requestAnimationFrame() {}, getComputedStyle: () => ({ paddingTop: "0" }), matchMedia: () => ({ matches: false }), fetch: () => Promise.resolve({ ok: true }), localStorage: { getItem: () => null, setItem() {} }, console: { log() {} }, URL, location: { href: "https://potterylab.ai/feed", origin: "https://potterylab.ai", pathname: "/feed", search: "", hash: "" }, ...win };
  w.window = w; vm.runInNewContext(read("public/native.js"), w); return { w, listeners, nav };
}
test("native.js does nothing on the web: no listeners, no globals, navigator.share untouched", () => {
  for (const win of [{}, { Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }, { Capacitor: {} }]) {
    const { w, listeners, nav } = runNative(win);
    assert.deepEqual(listeners, []); assert.equal(w.__encoreNative, undefined); assert.equal(w.EncoreNative, undefined); assert.equal(nav.share, undefined);
  }
  // inside the app it takes over share and listens for links, photo pickers and calendar links
  const shared = []; const Plugins = { Share: { share: async (d) => shared.push(d) }, App: { addListener() {} } };
  const { w, listeners, nav } = runNative({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins, isPluginAvailable: (n) => !!Plugins[n] } });
  assert.equal(w.__encoreNative, 1); assert.equal(typeof nav.share, "function"); assert.ok(listeners.includes("click"));
  return nav.share({ title: "Clay night", url: "https://potterylab.ai/e/x" }).then(() => assert.equal(shared[0].title, "Clay night"));
});

// ---------- the text filter ----------
test("the text filter catches strong language (whole words, letter swaps) and contact details where asked, and leaves food alone", () => {
  for (const t of ["what the fuck", "F*CK this", "total sh1t", "you bitches"]) assert.equal(textProblem(t)?.code, "language", t);
  for (const t of ["Scunthorpe pottery", "spicy dumplings and cocktails", "a classic night", "Dickens reading club", "assessment day", ""]) assert.equal(textProblem(t), null, t);
  assert.equal(textProblem("text me 555 123 4567", { contact: true })?.code, "contact_info"); assert.equal(textProblem("ada@example.com", { contact: true })?.code, "contact_info");
  assert.equal(textProblem("text me 555 123 4567"), null, "contact only where asked");
});

// ---------- report, block, moderation ----------
test("report, block and the moderation queue: blocked people leave your feed, hidden posts leave everyone's, restore brings them back", async () => {
  const A = await signup("Ada Poster", "ada.as@example.com"), B = await signup("Bo Friend", "bo.as@example.com"), D = await signup("Di Friend", "di.as@example.com"), M = await signup("Mo Mod", "mod.as@example.com");
  for (const x of [B, D]) assert.equal((await post("/api/me/friends", { key: A.key }, x.cookie)).status, 200);
  const bad = await post("/api/me/posts", { text: "this is shit" }, A.cookie); assert.equal(bad.status, 400); assert.equal((await bad.json()).code, "language");
  const p = await (await post("/api/me/posts", { text: "Glaze day was the best" }, A.cookie)).json(); assert.ok(p.ok);
  const feedOf = async (x) => (await (await get("/api/me/feed", x.cookie)).json()).items.filter((i) => i.kind === "post" && i.id === p.post.id);
  assert.equal((await feedOf(B)).length, 1); assert.equal((await feedOf(D)).length, 1);
  // report (from B), then B blocks A
  const rep = await post("/api/report", { type: "post", target: `post:${A.key}:${p.post.id}`, reason: "hate", note: "mean", url: "/feed" }, B.cookie); assert.equal(rep.status, 200); const rid = (await rep.json()).id;
  assert.equal((await post("/api/report", { type: "post", target: "", reason: "hate" }, B.cookie)).status, 400);
  assert.equal((await post("/api/me/blocks", { kind: "person", key: A.key, name: "Ada" }, B.cookie)).status, 200);
  assert.equal((await post("/api/me/blocks", { kind: "person", key: B.key }, B.cookie)).status, 400, "not yourself");
  assert.equal((await feedOf(B)).length, 0, "gone for the blocker"); assert.equal((await feedOf(D)).length, 1, "still there for others");
  assert.equal((await (await get("/api/me/blocks", B.cookie)).json()).blocks[0].target, "person:" + A.key);
  // the queue: admins only
  assert.equal((await get("/api/admin/reports", B.cookie)).status, 404); assert.equal((await get("/moderation", B.cookie)).status, 404);
  assert.equal((await get("/moderation", M.cookie)).status, 200);
  const Q = await (await get("/api/admin/reports", M.cookie)).json(); assert.ok(Q.reports.some((r) => r.id === rid && r.reason === "hate"));
  assert.equal((await post(`/api/admin/reports/${rid}`, { action: "hide" }, M.cookie)).status, 200);
  assert.equal((await feedOf(D)).length, 0, "hidden for everyone");
  assert.equal((await (await get("/api/admin/reports?status=hidden", M.cookie)).json()).reports[0].hidden, true);
  assert.equal((await post(`/api/admin/reports/${rid}`, { action: "restore" }, M.cookie)).status, 200);
  assert.equal((await feedOf(D)).length, 1, "restored"); assert.equal((await feedOf(B)).length, 0, "still blocked for B");
  // unblock
  assert.equal((await fetch(srv.base + "/api/me/blocks?target=" + encodeURIComponent("person:" + A.key), { method: "DELETE", headers: { cookie: B.cookie } })).status, 200);
  assert.equal((await (await get("/api/me/blocks", B.cookie)).json()).blocks.length, 0);
  // a photo hidden by the team is marked hidden where it lives
  scopeStore(srv.store, A.ws).set("moments/asm1", { eventId: "x", url: "/_blob/AAAAAAAAAAAAAAAAAAAA", authorEmail: A.email, at: Date.now() });
  const r2 = await (await post("/api/report", { type: "moment", target: "moment:/_blob/AAAAAAAAAAAAAAAAAAAA", reason: "sexual" })).json();
  await post(`/api/admin/reports/${r2.id}`, { action: "hide" }, M.cookie); assert.equal(scopeStore(srv.store, A.ws).get("moments/asm1").data.hidden, true);
  await post(`/api/admin/reports/${r2.id}`, { action: "restore" }, M.cookie); assert.equal(scopeStore(srv.store, A.ws).get("moments/asm1").data.hidden, false);
  // three different people reporting one thing hide it at once, when they're confirmed accounts at least 7 days old
  // (launch review: new or unconfirmed accounts queue for a person instead)
  for (const x of [B, D, M]) { const u = getDbUser(x.email); if (u) putDbUser({ ...u, createdAt: Date.now() - 30 * 864e5 }); }
  const t = "text:" + textHash("You are all terrible");
  for (const x of [B, D, M]) await post("/api/report", { type: "kudos", text: "You are all terrible", reason: "hate" }, x.cookie);
  assert.ok((await (await get("/api/admin/reports", M.cookie)).json()).hidden.includes(t));
  assert.deepEqual(scrub({ list: [{ love: "You are all terrible" }, { love: "Lovely" }] }, new Set([t])), { list: [{ love: "Lovely" }] });
  // the pages
  assert.equal((await get("/community")).status, 200); assert.equal((await get("/settings")).status, 200);
  const S = await (await get("/api/public/safety")).json(); assert.equal(S.respondWithin, "24 hours");
});
test("blocking a host hides their page answer for you and their events from lists", async () => {
  const H = await signup("Hana Host", "hana.as@example.com"), G = await signup("Gus Guest", "gus.as@example.com");
  assert.equal((await post("/api/host/profile", { handle: "hana-as", name: "Hana Host" }, H.cookie)).status, 200);
  const before = await get("/api/public/host/hana-as", G.cookie); assert.equal(before.status, 200);
  assert.equal((await post("/api/me/blocks", { kind: "host", handle: "hana-as", name: "Hana" }, G.cookie)).status, 200);
  const j = await (await get("/api/public/host/hana-as", G.cookie)).json(); assert.equal(j.blockedByYou, true);
  assert.equal((await post("/api/host/profile", { handle: "hana-as", name: "Hana", tagline: "fuck yeah" }, H.cookie)).status, 400, "the filter covers host pages");
});

// ---------- push ----------
test("push: devices register per person with their platform, bell items push (fake mode), settings turn kinds off, bad input is refused", async () => {
  clearFakeOutbox(); const U = await signup("Pia Push", "pia.as@example.com");
  assert.equal((await post("/api/me/push/devices", { token: "x".repeat(64), platform: "windows" }, U.cookie)).status, 400);
  assert.equal((await post("/api/me/push/devices", { token: "short", platform: "ios" }, U.cookie)).status, 400);
  assert.equal((await post("/api/me/push/devices", { token: "a1".repeat(32), platform: "ios" }, U.cookie)).status, 200);
  assert.equal((await post("/api/me/push/devices", { token: "fcm:" + "b".repeat(60), platform: "android" }, U.cookie)).status, 200);
  const P = await (await get("/api/me/push", U.cookie)).json(); assert.deepEqual(P.devices.map((d) => d.platform).sort(), ["android", "ios"]); assert.equal(P.prefs.on, true);
  assert.equal((await post("/api/me/push/devices", { token: "a1".repeat(32), platform: "ios" })).status, 401);
  const X = srv.app.locals.social;
  X.notify(U.email, { kind: "waitlist", key: "in-as1", text: "🎉 A spot opened up. You're in for Clay night.", link: "/g#rsvp-asinv1" });
  assert.ok(await waitFor(() => fakeOutbox().filter((m) => m.to === U.email).length === 2), "one per device");
  const m = fakeOutbox().find((x) => x.platform === "ios"); assert.equal(m.title, "A spot opened up"); assert.equal(m.body, "A spot opened up. You're in for Clay night."); assert.equal(m.link, "/g#rsvp-asinv1");
  assert.equal(groupOf("waitlist"), "spots"); assert.equal(groupOf("photos"), "photos"); assert.equal(groupOf("letin"), "in"); assert.equal(groupOf("reply"), "replies");
  // turn photos off: a new photos item doesn't push, a reply does
  assert.equal((await post("/api/me/push/prefs", { photos: false }, U.cookie)).status, 200); clearFakeOutbox();
  await new Promise((r) => setTimeout(r, 5)); X.notify(U.email, { kind: "photos", key: "ph-as1", text: "New photos from Clay night", link: "/photos" });
  await new Promise((r) => setTimeout(r, 80)); assert.equal(fakeOutbox().length, 0, "photos are off");
  await new Promise((r) => setTimeout(r, 5)); X.notify(U.email, { kind: "reply", key: "rp-as1", text: "Bo replied I'm in", link: "/?app=1" });
  assert.ok(await waitFor(() => fakeOutbox().length === 2));
  // the same notification twice doesn't push twice
  clearFakeOutbox(); X.markRead(U.email); await new Promise((r) => setTimeout(r, 80)); assert.equal(fakeOutbox().length, 0);
  // remove a device
  assert.equal((await (await fetch(srv.base + "/api/me/push/devices/" + "a1".repeat(32), { method: "DELETE", headers: { cookie: U.cookie } })).json()).removed, 1);
  assert.equal((await (await get("/api/me/push", U.cookie)).json()).devices.length, 1);
});

// ---------- account deletion ----------
test("delete my account now: workspace, uploads, posts and sessions go; replies and kudos on other hosts' events are anonymized", async () => {
  const H = await signup("Rae Host", "rae.as@example.com"), A = await signup("Del Now", "del.now@example.com");
  // a photo upload, a post, a friend, a reply and kudos on Rae's event, a push device
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const up = await (await fetch(srv.base + "/api/me/posts/photo", { method: "POST", headers: { "content-type": "image/png", cookie: A.cookie }, body: png })).json(); const blobId = up.url.split("/").pop();
  assert.ok(fs.existsSync(path.join(srv.dir, "assets", blobId)));
  await post("/api/me/posts", { text: "Hello", photo: up.url }, A.cookie); await post("/api/me/friends", { key: H.key }, A.cookie); await post("/api/me/friends", { key: A.key }, H.cookie);
  const SH = scopeStore(srv.store, H.ws); SH.set("rsvps/asr1", { eventId: "asev", email: A.email, name: "Del Now", phone: "+1 555 0100", response: "going", answers: [{ q: "x", a: "y" }] });
  SH.set("kudos/ask1", { eventId: "asev", email: A.email, name: "Del Now", love: "Great night", at: Date.now() });
  SH.set("followers/asf1", { email: A.email, name: "Del Now" });
  await post("/api/me/push/devices", { token: "c3".repeat(32), platform: "ios" }, A.cookie);
  // the confirm step
  assert.equal((await post("/api/me/delete", { when: "now" }, A.cookie)).status, 400);
  const r = await post("/api/me/delete", { confirm: "DELETE", when: "now" }, A.cookie); assert.equal(r.status, 200, await r.clone().text()); const j = await r.json();
  assert.equal(j.workspace, true); assert.ok(j.files >= 1);
  assert.match(r.headers.getSetCookie().join(";"), /encore_auth=;/);
  // gone
  const meNow = await get("/api/me", A.cookie); assert.ok(meNow.status === 401 || (await meNow.json()).verified === false, "the old session no longer works");
  assert.equal((await login(A.email)).status, 401);
  assert.ok(!fs.existsSync(path.join(srv.dir, "assets", blobId)), "uploads deleted");
  assert.equal(srv.store.dumpPrefix(`ws/${A.ws}/`).length, 0); assert.equal(srv.store.get("system/ws-" + A.ws), null);
  assert.ok(!JSON.stringify(srv.store.dumpPrefix("")).toLowerCase().includes(A.email), "the email is nowhere in the store");
  const rsvp = SH.get("rsvps/asr1").data; assert.equal(rsvp.name, "Former guest"); assert.equal(rsvp.email, ""); assert.equal(rsvp.phone, ""); assert.equal(rsvp.response, "going", "the host keeps the count");
  assert.equal(SH.get("kudos/ask1").data.name, "Former guest"); assert.equal(SH.get("followers/asf1"), null);
  assert.equal((await (await get("/api/me/feed", H.cookie)).json()).friends.length, 0, "out of friends lists");
  // the same email can start over
  await signup("Del Again", "del.now@example.com");
});
test("delete my account later: signed out and hidden now, signing in before the date keeps it, the hourly job deletes after it", async () => {
  const A = await signup("Grace Later", "grace.as@example.com"), F = await signup("Fay Friend", "fay.as@example.com");
  await post("/api/me/friends", { key: A.key }, F.cookie); const p = await (await post("/api/me/posts", { text: "See you there" }, A.cookie)).json();
  const seen = async () => (await (await get("/api/me/feed", F.cookie)).json()).items.some((i) => i.id === p.post.id);
  assert.equal(await seen(), true);
  const r = await (await post("/api/me/delete", { confirm: "delete", when: "later" }, A.cookie)).json(); assert.equal(r.pending, true); assert.ok(r.deleteAt > Date.now() + 13 * 864e5);
  assert.equal(await seen(), false, "hidden during the grace period");
  const L = await login(A.email); assert.equal(L.status, 200, "can still sign in");
  const D = await (await get("/api/me/delete", L.cookie)).json(); assert.equal(D.pending, true); assert.equal(D.graceDays, 14);
  assert.equal((await (await post("/api/me/delete/cancel", {}, L.cookie)).json()).pending, false); assert.equal(await seen(), true, "back");
  // ask again, and let the clock run out
  await post("/api/me/delete", { confirm: "DELETE", when: "later" }, L.cookie);
  const acct = srv.app.locals.appstore.account; assert.equal(await acct.runDue(Date.now()), 0, "not yet");
  assert.equal(await acct.runDue(Date.now() + 15 * 864e5), 1); assert.equal((await login(A.email)).status, 401);
});
