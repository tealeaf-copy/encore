// Your stories (server/storyapprove.js, public/yourstories.html): a guest's photo and a recap wait for the host,
// captions, order, covers and highlights persist, nothing private widens, and a browser walk at 390 and 1280.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { cleanText, waitingLine, STORY_LIMITS } from "../server/storyapprove.js";

const SHOTS = process.env.STORY_SHOTS || "";
let srv, X;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const del = (p, cookie) => fetch(srv.base + p, { method: "DELETE", headers: cookie ? { cookie } : {} });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const getJ = async (p, cookie) => (await get(p, cookie)).json();
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const went = (host, eventId, who) => srv.store.set(`ws/${host.ws}/rsvps/r-${eventId}-${who.email.split("@")[0].replace(/\W/g, "")}`, { response: "going", createdAt: Date.now() - 5 * 864e5, eventId, name: who.name, email: who.email, code: "C" + eventId });
const upload = async (eventId, who, q = {}) => { const r = await fetch(`${srv.base}/api/moments?${new URLSearchParams({ eventId, ...q })}`, { method: "POST", headers: { "content-type": "image/png", cookie: who.cookie }, body: PNG }); const j = await r.json(); assert.equal(r.status, 200, JSON.stringify(j)); X.bust(); return j.id; };
const ev = (id, extra, host) => put("events/" + id, { kind: "social", casual: true, activity: "dinner", published: true, discoverable: true, date: day(-2), ...extra }, host.cookie).then((r) => assert.equal(r.status, 200, id));
// a host's ring as someone sees it: the ids of its photo items ("m:<id>")
const ring = async (handle, cookie) => { const S = cookie ? (await getJ("/api/feed/stories", cookie)).stories : (await getJ("/api/public/feed?x=" + Math.random())).stories; return S.find((s) => s.host?.handle === handle && !s.showcase) || null; };
const ringIds = async (handle, cookie) => ((await ring(handle, cookie))?.items || []).map((i) => i.id);
const U = {};

before(async () => {
  srv = await startServer(); X = srv.app.locals.social;
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "sa-secret", ENCORE_SIGNUP_PER_HOUR: "400", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  U.mai = await join("Mai Pham", "mai.sa@example.com"); U.linh = await join("Linh Tran", "linh.sa@example.com"); U.jun = await join("Jun Park", "jun.sa@example.com"); U.zed = await join("Zed New", "zed.sa@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mai-sa", name: "Mai's supper club", tagline: "Small dinners.", emoji: "🍜" }, U.mai.cookie)).ok);
  // the first two are a week old: on the ring for 14 days, but past the 3 days in which a recap is made
  await ev("saOpen", { name: "Board game night", date: day(-7) }, U.mai); await ev("saPriv", { name: "Quiet supper", discoverable: false, date: day(-7) }, U.mai); await ev("saRecap", { name: "Dumpling Night", date: day(-1) }, U.mai);
  for (const id of ["saOpen", "saPriv", "saRecap"]) for (const who of [U.linh, U.jun]) went(U.mai, id, who);
  X.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "sa-secret"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

const P = {};
test("a guest's photo waits: not on the ring until the host approves, one bell note per event, the host's own go out", async () => {
  assert.equal(cleanText("  call me <b>now</b> at 212 555 0142 or a@b.co — ok  "), "call me now at … or …, ok"); assert.equal(waitingLine(1, "X"), "1 new photo from X is waiting"); assert.equal(waitingLine(3, "Board game night"), "3 new photos from Board game night are waiting");
  assert.equal((await get("/api/me/stories")).status, 401);
  P.own = await upload("saOpen", U.mai); P.g1 = await upload("saOpen", U.linh, { caption: "the long table" });
  assert.deepEqual(await ringIds("mai-sa"), ["m:" + P.own], "strangers: the host's own photo only"); assert.ok(!(await ringIds("mai-sa", U.linh.cookie)).includes("m:" + P.g1), "not even its author sees it on the host's ring yet"); assert.ok(!(await ringIds("mai-sa", U.mai.cookie)).includes("m:" + P.g1));
  let S = await getJ("/api/me/stories", U.mai.cookie); assert.equal(S.guestsAuto, false, "off for a new host"); assert.equal(S.legacy, false); assert.deepEqual(S.waiting.map((e) => [e.eventId, e.photos.map((p) => p.id)]), [["saOpen", [P.g1]]]); assert.equal(S.waiting[0].photos[0].by, "Linh");
  assert.deepEqual(S.live.find((e) => e.eventId === "saOpen").photos.map((p) => p.id), [P.own]);
  await new Promise((r) => setTimeout(r, 60)); const bell = () => X.inbox(U.mai.email).filter((n) => n.key === "sa-wait-saOpen"); assert.equal(bell().length, 1); assert.equal(bell()[0].text, "1 new photo from Board game night is waiting"); assert.equal(bell()[0].link, "/your-stories");
  P.g2 = await upload("saOpen", U.jun); P.g3 = await upload("saOpen", U.jun); await new Promise((r) => setTimeout(r, 60));
  assert.equal(bell().length, 1, "one note per event, not per photo"); assert.equal(bell()[0].text, "3 new photos from Board game night are waiting");
  // someone who isn't the host can't approve
  assert.equal((await post("/api/me/stories/approve", { ids: [P.g1] }, U.linh.cookie)).status, 404); assert.ok(!(await ringIds("mai-sa")).includes("m:" + P.g1));
});

test("Approve puts it on the ring; Not this one never shows, anywhere; the switch lets guests' photos through", async () => {
  assert.equal((await post("/api/me/stories/approve", { ids: [P.g1] }, U.mai.cookie)).status, 200); X.bust(); assert.deepEqual(await ringIds("mai-sa"), ["m:" + P.own, "m:" + P.g1]);
  assert.equal((await post("/api/me/stories/decline", { ids: [P.g2] }, U.mai.cookie)).status, 200); X.bust();
  const url = srv.store.get(`ws/${U.mai.ws}/moments/${P.g2}`).data.url, pub = await getJ("/api/public/feed?y=1"); assert.ok(!(await ringIds("mai-sa")).includes("m:" + P.g2)); assert.ok(!JSON.stringify(pub.moments).includes(`"id":"${P.g2}"`), "off the public feed too");
  assert.ok(!(await ringIds("mai-sa", U.jun.cookie)).includes("m:" + P.g2)); assert.ok(url);
  let S = await getJ("/api/me/stories", U.mai.cookie); assert.deepEqual(S.waiting[0].photos.map((p) => p.id), [P.g3]);
  assert.equal((await post("/api/me/stories/settings", { guestsAuto: "yes" }, U.mai.cookie)).status, 400); assert.equal((await post("/api/me/stories/settings", { guestsAuto: true }, U.mai.cookie)).status, 200);
  assert.ok((await ringIds("mai-sa")).includes("m:" + P.g3), "with the switch on, a guest's photo shows without asking"); S = await getJ("/api/me/stories", U.mai.cookie); assert.equal(S.waiting.length, 0); assert.equal(S.guestsAuto, true);
  assert.ok(!(await ringIds("mai-sa")).includes("m:" + P.g2), "a declined one stays out");
  assert.equal((await post("/api/me/stories/settings", { guestsAuto: false }, U.mai.cookie)).status, 200); assert.equal((await post("/api/me/stories/approve", { ids: [P.g3] }, U.mai.cookie)).status, 200); X.bust();
});

test("captions, order and the ring's cover persist and show everywhere", async () => {
  const c = await post("/api/me/stories/photo/" + P.g1, { caption: "Linh's table, text me 212-555-0142 <script>" }, U.mai.cookie); assert.equal(c.status, 200); assert.equal((await c.json()).caption, "Linh's table, text me …");
  assert.equal((await post("/api/me/stories/photo/" + P.g1, { caption: "nope" }, U.zed.cookie)).status, 404, "only the host or whoever added it");
  assert.equal((await post("/api/me/stories/order", { eventId: "saOpen", ids: [P.g3, P.g1, P.own] }, U.mai.cookie)).status, 200); assert.equal((await post("/api/me/stories/order", { eventId: "saOpen", ids: [P.own] }, U.linh.cookie)).status, 404);
  assert.equal((await post("/api/me/stories/ring", { id: P.g1 }, U.mai.cookie)).status, 200); assert.equal((await post("/api/me/stories/ring", { id: P.g2 }, U.mai.cookie)).status, 404, "not a removed photo");
  const R = await ring("mai-sa"); assert.deepEqual(R.items.map((i) => i.id), ["m:" + P.g3, "m:" + P.g1, "m:" + P.own]); assert.equal(R.items[1].note, "Linh's table, text me …"); assert.equal(R.thumb, srv.store.get(`ws/${U.mai.ws}/moments/${P.g1}`).data.url, "the chosen cover is the ring");
  const S = await getJ("/api/me/stories", U.mai.cookie); assert.deepEqual(S.live.find((e) => e.eventId === "saOpen").photos.map((p) => p.id), [P.g3, P.g1, P.own]); assert.equal(S.ringCover, P.g1);
  assert.deepEqual((await ring("mai-sa", U.linh.cookie)).items.map((i) => i.id), R.items.map((i) => i.id), "the same order signed in");
});

test("a recap waits too; its title line, its quote (a real one or none) and its cover are the host's", async () => {
  const ids = []; for (let i = 0; i < 3; i++) ids.push(await upload("saRecap", U.mai));
  srv.store.set(`ws/${U.mai.ws}/kudos/r-saRecap-linhsa`, { eventId: "saRecap", name: "Linh Tran", email: U.linh.email, love: "Best dumplings I've had all year", tags: ["food"], at: Date.now() }); X.bust();
  let R = await ring("mai-sa"); assert.equal(R.recap, undefined, "made, but waiting"); assert.ok(R.items.some((i) => i.id === "m:" + ids[0]), "the host's own photos still show as photos");
  let S = await getJ("/api/me/stories", U.mai.cookie); const w = S.waiting.find((e) => e.eventId === "saRecap"); assert.ok(w?.recap, "the recap is under Waiting for you"); assert.ok(X.inbox(U.mai.email).some((n) => n.key === "sa-wait-saRecap" && /A recap of Dumpling Night is waiting/.test(n.text)));
  assert.equal((await post("/api/me/stories/approve", { recap: "saRecap" }, U.linh.cookie)).status, 404); assert.equal((await post("/api/me/stories/approve", { recap: "saRecap" }, U.mai.cookie)).status, 200);
  R = await ring("mai-sa"); assert.equal(R.recap?.eventId, "saRecap"); assert.equal(R.items[0].recap.title, "Dumpling Night");
  S = await getJ("/api/me/stories", U.mai.cookie); const q = S.live.find((e) => e.eventId === "saRecap").recap.quotes;
  assert.equal((await post("/api/me/stories/recap/saRecap", { quote: "made-up" }, U.mai.cookie)).status, 400, "never an invented quote");
  assert.equal((await post("/api/me/stories/recap/saRecap", { title: "The night of 200 dumplings", quote: "none", cover: ids[1] }, U.mai.cookie)).status, 200);
  R = await ring("mai-sa"); assert.equal(R.items[0].recap.title, "The night of 200 dumplings"); assert.ok(!R.items.some((i) => i.type === "quote"), "no quote when the host says none"); assert.equal(R.items[0].recap.cover, srv.store.get(`ws/${U.mai.ws}/moments/${ids[1]}`).data.url);
  if (q.length) { assert.equal((await post("/api/me/stories/recap/saRecap", { quote: q[0].id }, U.mai.cookie)).status, 200); R = await ring("mai-sa"); assert.equal(R.items.find((i) => i.type === "quote").quote.text, "Best dumplings I've had all year"); }
  assert.equal((await post("/api/me/stories/decline", { recap: "saRecap" }, U.mai.cookie)).status, 200); assert.equal((await ring("mai-sa")).recap, undefined, "a declined recap is off the ring");
  assert.equal((await post("/api/me/stories/approve", { recap: "saRecap" }, U.mai.cookie)).status, 200);
});

test("a highlight outlives the 14 days and the 24 hours; up to 8; reorder and delete", async () => {
  const mk = await post("/api/me/stories/highlights", { name: "  Game nights <i> ", items: ["m:" + P.g1, "m:" + P.g2, "m:nope", "r:saRecap"] }, U.mai.cookie); assert.equal(mk.status, 200); const hl = (await mk.json()).highlight;
  assert.equal(hl.name, "Game nights"); assert.deepEqual(hl.items, ["m:" + P.g1, "r:saRecap"], "only this host's own, never a removed photo");
  assert.equal((await post("/api/me/stories/highlights", { id: hl.id, add: "m:" + P.own, cover: P.g1 }, U.mai.cookie)).status, 200); assert.equal((await post("/api/me/stories/highlights", { id: hl.id, cover: P.g2 }, U.mai.cookie)).status, 400);
  assert.equal((await post("/api/me/stories/highlights", { name: "x", items: ["m:" + P.g1] }, U.linh.cookie)).status, 200, "anyone can keep highlights of their own events"); assert.deepEqual((await getJ("/api/me/stories", U.linh.cookie)).highlights[0].items, [], "but not of someone else's photos");
  // three weeks on: the photos have left the ring and the recap's day is long over
  for (const id of [P.g1, P.own, P.g3]) srv.store.update(`ws/${U.mai.ws}/moments/${id}`, { at: Date.now() - 21 * 864e5 });
  const { recapPath } = await import("../server/storyapprove.js"); const rd = srv.store.get(recapPath("saRecap")).data; srv.store.set(recapPath("saRecap"), { ...rd, madeAt: rd.madeAt - 5 * 864e5, okAt: rd.okAt - 5 * 864e5 }); X.bust();
  const ids = await ringIds("mai-sa"); assert.ok(!ids.includes("m:" + P.g1) && !ids.some((i) => /^r:saRecap/.test(i)), "gone from the ring");
  const H = (await getJ("/api/public/highlights/mai-sa")).highlights; assert.equal(H.length, 1); assert.equal(H[0].name, "Game nights"); assert.ok(H[0].items.some((i) => i.url === srv.store.get(`ws/${U.mai.ws}/moments/${P.g1}`).data.url)); assert.ok(H[0].items.some((i) => i.type === "recap"), "the recap is kept too");
  assert.equal(H[0].thumb, srv.store.get(`ws/${U.mai.ws}/moments/${P.g1}`).data.url); assert.equal(H[0].highlight, true);
  for (let i = 2; i <= STORY_LIMITS.highlights; i++) assert.equal((await post("/api/me/stories/highlights", { name: "Set " + i, items: ["m:" + P.own] }, U.mai.cookie)).status, 200);
  const over = await post("/api/me/stories/highlights", { name: "One too many", items: ["m:" + P.own] }, U.mai.cookie); assert.equal(over.status, 400); assert.equal((await over.json()).code, "too_many");
  let L = (await getJ("/api/me/stories", U.mai.cookie)).highlights; assert.equal(L.length, 8);
  assert.equal((await post("/api/me/stories/highlights", { order: [L[7].id, L[0].id] }, U.mai.cookie)).status, 200); L = (await getJ("/api/me/stories", U.mai.cookie)).highlights; assert.equal(L[0].name, "Set 8"); assert.equal(L[1].name, "Game nights");
  assert.equal((await del("/api/me/stories/highlights/" + L[0].id, U.mai.cookie)).status, 200); assert.equal((await del("/api/me/stories/highlights/" + L[0].id, U.mai.cookie)).status, 404); assert.equal((await getJ("/api/public/highlights/mai-sa")).highlights.length, 7);
  const pv = await getJ("/api/me/stories/preview", U.mai.cookie); assert.equal(pv.highlights.length, 7, "the preview is what a visitor gets");
});

test("approval never widens the audience: a private event's photos stay with the people who were there", async () => {
  const pid = await upload("saPriv", U.linh); assert.equal((await post("/api/me/stories/approve", { ids: [pid] }, U.mai.cookie)).status, 200); X.bust();
  const hl = (await getJ("/api/me/stories", U.mai.cookie)).highlights.find((h) => h.name === "Game nights"); assert.equal((await post("/api/me/stories/highlights", { id: hl.id, add: "m:" + pid }, U.mai.cookie)).status, 200);
  const url = srv.store.get(`ws/${U.mai.ws}/moments/${pid}`).data.url;
  assert.ok(!(await ringIds("mai-sa")).includes("m:" + pid), "strangers"); assert.ok(!(await ringIds("mai-sa", U.zed.cookie)).includes("m:" + pid), "a signed-in stranger"); assert.ok((await ringIds("mai-sa", U.jun.cookie)).includes("m:" + pid), "someone who was there");
  const seen = async (cookie) => JSON.stringify((await getJ("/api/public/highlights/mai-sa", cookie)).highlights).includes(url); assert.equal(await seen(), false); assert.equal(await seen(U.zed.cookie), false); assert.equal(await seen(U.jun.cookie), true);
  assert.ok(!JSON.stringify(await getJ("/api/me/stories/preview", U.mai.cookie)).includes(url), "and the visitor preview leaves it out");
  assert.ok(!JSON.stringify(await getJ("/api/public/feed?z=2")).includes(url));
});

test("a guest's photo is theirs: they remove it anywhere, and choose whether it shows under their name", async () => {
  const pid = await upload("saOpen", U.jun); assert.equal((await post("/api/me/stories/approve", { ids: [pid] }, U.mai.cookie)).status, 200); X.bust();
  let S = await getJ("/api/me/stories", U.jun.cookie); assert.ok(S.mine.some((p) => p.id === pid && p.profile === true)); assert.equal(S.hosts, false);
  assert.equal((await post("/api/me/stories/photo/" + pid, { profile: false, caption: "mine" }, U.jun.cookie)).status, 200); X.bust(); assert.equal(srv.store.get(`ws/${U.mai.ws}/moments/${pid}`).data.offProfile, true);
  assert.equal((await getJ("/api/me/stories", U.jun.cookie)).mine.find((p) => p.id === pid).profile, false); assert.ok((await ringIds("mai-sa")).includes("m:" + pid), "it stays with the event");
  assert.equal((await del("/api/me/stories/photo/" + pid, U.linh.cookie)).status, 404, "not someone else's"); const r = await del("/api/me/stories/photo/" + pid, U.jun.cookie); assert.equal(r.status, 200); assert.equal((await r.json()).deleted, true); X.bust();
  assert.equal(srv.store.get(`ws/${U.mai.ws}/moments/${pid}`), null); assert.ok(!(await ringIds("mai-sa")).includes("m:" + pid));
});

test("hosts who were here before keep today's behaviour: guests' photos show without asking, nothing disappears", async () => {
  // everyone so far joined after approvals began; move the start past them, the way a deploy meets an existing host
  srv.store.set("system/storyapprove-start", { kind: "storyapprove", at: Date.now() + 60e3 }); const old = await join("Old Host", "old.sa@example.com");
  srv.store.set("system/storyapprove-start", { kind: "storyapprove", at: Date.now() + 120e3 });
  assert.ok((await post("/api/host/profile", { handle: "old-sa", name: "Old's table", tagline: "Since forever.", emoji: "🍲" }, old.cookie)).ok); await ev("saOld", { name: "Sunday roast", date: day(-7) }, old); went(old, "saOld", U.linh); X.bust();
  const pid = await upload("saOld", U.linh); assert.deepEqual(await ringIds("old-sa"), ["m:" + pid], "on the ring without an approval step");
  const S = await getJ("/api/me/stories", old.cookie); assert.equal(S.legacy, true); assert.equal(S.guestsAuto, true); assert.equal(S.waiting.length, 0);
  assert.equal((await post("/api/me/stories/settings", { guestsAuto: false }, old.cookie)).status, 200); assert.deepEqual(await ringIds("old-sa"), [], "and they can turn asking on");
  assert.equal((await getJ("/api/me/stories", U.mai.cookie)).guestsAuto, false, "a choice already made stays as it was");
});

// ---------------------------------------------------------------- the browser
for (const W of [390, 1280]) test(`browser at ${W}: approve, edit a caption, reorder with the buttons, save to a highlight, the visitor's view`, { timeout: 240000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true }); const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${W}.png`), fullPage: true }); };
  srv.store.set("system/storyapprove-start", { kind: "storyapprove", at: Date.now() - 1000 });
  const host = await join("Bea Lund", `bea${W}.sa@example.com`), g = await join("Gus Guest", `gus${W}.sa@example.com`), handle = `bea-${W}`, E = `bw${W}`;
  assert.ok((await post("/api/host/profile", { handle, name: "Bea's long table", tagline: "Suppers for neighbours.", emoji: "🍞" }, host.cookie)).ok); await ev(E, { name: "Harvest supper with the whole street", date: day(-7) }, host); went(host, E, g); X.bust();
  const own1 = await upload(E, host, { caption: "the first course" }), own2 = await upload(E, host), g1 = await upload(E, g, { caption: "what a night" }), g2 = await upload(E, g);
  const ctxFor = async (who) => { const ctx = await browser.newContext(W === 390 ? { ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" } : { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (who) await ctx.addCookies(who.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }).concat([{ name: "encore_in", value: "1", url: srv.base }]));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
    await ctx.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {} }); return ctx; };
  const errs = []; const watch = (page) => { page.on("pageerror", (e) => errs.push("pageerror " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console " + m.text()); });
    page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(srv.base) && !/favicon/.test(r.url())) errs.push(r.status() + " " + r.url()); }); };
  const msg = (page, re) => page.waitForFunction((s) => [...document.querySelectorAll(".ys-msg")].some((m) => new RegExp(s).test(m.textContent)), re, { timeout: 10000 });
  try {
    let ctx = await ctxFor(host), page = await ctx.newPage(); watch(page);
    await page.goto(srv.base + "/your-stories", { waitUntil: "domcontentloaded" }); await page.waitForSelector("[data-all]", { timeout: 20000 });
    const first = await page.evaluate(() => ({ h1: document.querySelector("h1").textContent, waiting: document.querySelectorAll("#ysW ~ .ys-ev .ys-ph").length, all: document.querySelector("[data-all]").textContent, pri: document.querySelectorAll("#ys .ys-b.go").length, sw: document.querySelector("[data-sw]").getAttribute("aria-checked"),
      small: [...document.querySelectorAll("#ys .ys-b, #ys .ys-sw, #ys .ys-in")].filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length, over: document.documentElement.scrollWidth - innerWidth,
      clipped: [...document.querySelectorAll("#ys h3")].filter((x) => x.scrollWidth > x.clientWidth + 1).length, fonts: [...new Set([...document.querySelectorAll("#ys *")].map((x) => getComputedStyle(x).fontFamily.split(",")[0].replace(/"/g, "").trim()))] }));
    assert.ok((await page.evaluate(() => window.__cls)) < 0.05, "Your stories doesn't jump as it loads: " + (await page.evaluate(() => window.__cls)));
    assert.equal(first.h1, "Your stories"); assert.equal(first.waiting, 2); assert.equal(first.all, "Approve all 2"); assert.equal(first.pri, 1, "one primary"); assert.equal(first.sw, "false"); assert.equal(first.small, 0, "44px targets"); assert.ok(first.over <= 1); assert.equal(first.clipped, 0);
    assert.ok(first.fonts.every((f) => /IBM Plex/.test(f)), first.fonts.join()); await shot(page, "stories-waiting");
    // approve one, leave one out
    await page.click(`[data-ok="${g1}"]`); await msg(page, "Approved\\. It's on your story\\."); await page.waitForSelector(`#cap-${g1}`);
    page.once("dialog", (d) => d.accept()); await page.click(`[data-no="${g2}"]`); await msg(page, "Left out"); assert.equal(await page.$("#ysW"), null, "nothing left waiting");
    assert.deepEqual(await ringIds(handle), ["m:" + own1, "m:" + own2, "m:" + g1]);
    // a caption
    await page.fill(`#cap-${own2}`, "Bea's sourdough, still warm"); await page.locator(`#cap-${own2}`).blur(); await msg(page, "Caption saved\\.");
    // reorder with the buttons: the guest's photo goes first
    const order = () => page.$$eval(`[data-ev="${E}"] > .ys-ph`, (L) => L.map((li) => li.dataset.id)); assert.deepEqual(await order(), [own1, own2, g1]);
    await page.click(`[data-k="${g1}:up"]`); await msg(page, "Order saved\\."); await page.click(`[data-k="${g1}:up"]`); await page.waitForFunction((id) => document.querySelector(`[data-k="${id}:up"]`)?.disabled === true, g1, { timeout: 10000 });
    assert.deepEqual(await order(), [g1, own1, own2]); assert.equal(await page.evaluate(() => document.activeElement?.dataset.k), `${g1}:down`, "focus stays with the photo that moved");
    // and by drag (a mouse here; a long press does the same on a phone): the first photo is pulled under the second, then put back
    if (W === 1280) { const box = async (id) => page.$eval(`[data-id="${id}"] [data-drag]`, (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.$eval(`[data-id="${own1}"]`, (el) => el.scrollIntoView({ block: "center" })); const a = await box(g1), b = await page.$eval(`[data-id="${own1}"]`, (li) => { const r = li.getBoundingClientRect(); return { x: r.x + 44, y: r.bottom - 42 }; }); /* the lower half of the next row */ await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x, a.y + 20, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector(".ys-ph.drag"), null, { timeout: 10000 }); await page.waitForTimeout(600); assert.deepEqual(await order(), [own1, g1, own2], "dragged under the next photo"); await msg(page, "Order saved\\.");
      assert.deepEqual((await ring(handle)).items.map((i) => i.id), ["m:" + own1, "m:" + g1, "m:" + own2], "the dragged order is what visitors get");
      await page.click(`[data-k="${g1}:up"]`); await page.waitForFunction((id) => document.querySelector(`[data-k="${id}:up"]`)?.disabled === true, g1, { timeout: 10000 }); }
    // save to a highlight
    await page.click(`[data-k="${g1}:hl"]`); await page.waitForSelector("#ysSheet #ysNew"); assert.equal(await page.evaluate(() => document.activeElement?.id), "ysNew");
    await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#ysSheet")); assert.equal(await page.evaluate(() => document.activeElement?.dataset.k), `${g1}:hl`, "Esc closes; focus returns");
    await page.click(`[data-k="${g1}:hl"]`); await page.fill("#ysNew", "Supper clubs"); await shot(page, "stories-highlight-sheet"); await page.click("[data-create]"); await msg(page, "Saved to Supper clubs\\.");
    await page.click(`[data-k="${own2}:hl"]`); await page.click("#ysSheet [data-into]"); await msg(page, "Saved to Supper clubs\\.");
    assert.equal(await page.$eval("[data-hlid] [data-hname]", (i) => i.value), "Supper clubs"); await shot(page, "stories-edited");
    // it all persists
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(`#cap-${own2}`); assert.equal(await page.$eval(`#cap-${own2}`, (i) => i.value), "Bea's sourdough, still warm"); assert.deepEqual(await order(), [g1, own1, own2]);
    // preview as a visitor: the story viewer, with what a stranger gets
    await page.click("#ysPrev"); await page.waitForSelector(".fv-sv", { timeout: 15000 }); await shot(page, "stories-preview"); await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector(".fv-sv"));
    // the owner's page: a way in, next to Edit page
    await page.goto(srv.base + "/@" + handle, { waitUntil: "domcontentloaded" }); await page.waitForSelector("#topStories", { timeout: 20000 }); assert.equal(await page.$eval("#topStories", (a) => a.getAttribute("href")), "/your-stories"); await page.waitForSelector(".hl-row .hl-ring"); await page.waitForTimeout(600); await shot(page, "page-owner");
    assert.ok(await page.$eval("#topStories", (a) => a.getBoundingClientRect().height >= 44)); await ctx.close();
    // /me has the entry too
    ctx = await ctxFor(g); page = await ctx.newPage(); watch(page); await page.goto(srv.base + "/me", { waitUntil: "domcontentloaded" }); await page.waitForSelector('a[href="/your-stories"]', { timeout: 20000 });
    await page.goto(srv.base + "/your-stories", { waitUntil: "domcontentloaded" }); await page.waitForSelector("#ysM", { timeout: 20000 }); assert.equal(await page.$("#ysPrev"), null, "a guest has no host tools"); assert.equal(await page.$("[data-sw]"), null);
    assert.equal(await page.$$eval("[data-prof]", (L) => L.length), 1, "their approved photo; the declined one is gone for them too"); await shot(page, "stories-guest"); await ctx.close();
    // a visitor: the highlight ring under the header, the viewer, and no owner tools
    ctx = await ctxFor(null); page = await ctx.newPage(); watch(page); await page.goto(srv.base + "/@" + handle, { waitUntil: "domcontentloaded" }); await page.waitForSelector(".hl-row .hl-ring", { timeout: 20000 }); await page.waitForTimeout(800);
    const v = await page.evaluate(() => ({ rings: [...document.querySelectorAll(".hl-ring")].map((b) => [b.querySelector("small").textContent, b.getBoundingClientRect().height >= 44, !!b.querySelector("img")]), tools: !!document.querySelector("#topStories, #topEdit, .ys-b"), text: document.body.innerText, over: document.documentElement.scrollWidth - innerWidth }));
    if (SHOTS) console.log(`# host page CLS with a highlight row at ${W}: ${await page.evaluate(() => window.__cls.toFixed(4))}`);
    assert.deepEqual(v.rings, [["Supper clubs", true, true]]); assert.equal(v.tools, false, "no editor for visitors"); assert.doesNotMatch(v.text, /Waiting for you|Your stories/); assert.ok(v.over <= 1); await shot(page, "page-visitor");
    await page.click(".hl-ring"); await page.waitForSelector(".fv-sv", { timeout: 15000 }); await page.waitForTimeout(400); assert.equal(await page.$eval(".fv-sv .fv-sv-top b", (b) => getComputedStyle(b).color), "rgb(255, 255, 255)", "the viewer reads on the host page"); await shot(page, "page-visitor-viewer"); await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector(".fv-sv")); await ctx.close();
    assert.deepEqual(errs, [], "console clean, no failed requests");
  } finally { await browser.close(); }
});
