// Story prompts (server/storyprompt.js, public/storyprompt.js): the after-event card, the one bell note, the host's
// "Ask guests for photos", the limits, and a browser walk of the feed at 390 and 1280.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { promptable, ended, cardWindow, bellWindow, addedLine, bellText, bellLink, TEXT_TAIL } from "../server/storyprompt.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHOTS = process.env.STORY_SHOTS || "";
let srv, SP, X;
const J = { "content-type": "application/json" };
const post = (p, body, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {}) });
const get = (p, cookie) => fetch(srv.base + p, { headers: cookie ? { cookie } : {} });
const put = (p, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + p, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
// dates where the server is (events here have no city, so their time zone is the server's)
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const atHour = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id, email, name }; };
const reply = (ws, id, data) => { srv.store.set(`ws/${ws}/rsvps/${id}`, { response: "going", createdAt: Date.now() - 5 * 864e5, ...data }); return id; };
const went = (host, eventId, who, extra = {}) => reply(host.ws, `r-${eventId}-${who.email.split("@")[0].replace(/\W/g, "")}`, { eventId, name: who.name, email: who.email, code: "C" + eventId, ...extra });
const upload = (q, cookie) => fetch(`${srv.base}/api/moments?${new URLSearchParams(q)}`, { method: "POST", headers: { "content-type": "image/png", ...(cookie ? { cookie } : {}) }, body: PNG });
const prompt = async (who, q = "") => (await get("/api/me/story-prompt" + q, who?.cookie)).json();
const bells = (who, id) => X.inbox(who.email).filter((n) => n.key === "pd-" + id);
const U = {};

before(async () => {
  srv = await startServer(); SP = srv.app.locals.storyPrompt; X = srv.app.locals.social;
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "sp-secret", ENCORE_SIGNUP_PER_HOUR: "400", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  U.mai = await join("Mai Pham", "mai.sp@example.com"); U.linh = await join("Linh Tran", "linh.sp@example.com"); U.jun = await join("Jun Park", "jun.sp@example.com"); U.noa = await join("Noa Levi", "noa.sp@example.com"); U.zed = await join("Zed New", "zed.sp@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mai-sp", name: "Mai's supper club", tagline: "Small dinners.", emoji: "🍜" }, U.mai.cookie)).ok);
  const base = { kind: "social", casual: true, activity: "dinner", published: true };
  for (const [id, extra] of [["spOpen", { name: "Dumpling Night", discoverable: true, date: day(-1) }], ["spPriv", { name: "Quiet supper for old friends", discoverable: false, date: day(-2) }], ["spCancel", { name: "Rained out picnic", discoverable: true, date: day(-1), cancelled: true }],
    ["spNoPh", { name: "Phones down dinner", discoverable: true, date: day(-1), noPhotos: true }], ["spOld", { name: "Noodle pull", discoverable: true, date: day(-6) }], ["spSoon", { name: "Winter supper", discoverable: true, date: day(4) }], ["spAsk", { name: "Hot pot Sunday", discoverable: true, date: day(-5) }]])
    assert.equal((await put("events/" + id, { ...base, ...extra }, U.mai.cookie)).status, 200, id);
  for (const id of ["spOpen", "spPriv", "spCancel", "spNoPh", "spOld", "spSoon", "spAsk"]) went(U.mai, id, U.linh);
  went(U.mai, "spOpen", U.jun); went(U.mai, "spAsk", U.jun); went(U.mai, "spOpen", U.noa, { noShow: true });
  reply(U.mai.ws, "r-spAsk-guest", { eventId: "spAsk", name: "Guest NoAccount", email: "noaccount.sp@example.com", code: "CspAsk" });
  X.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "sp-secret"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("when a prompt is open: from the end of the event through the next 3 days, the bell the morning after", () => {
  const ev = { name: "Dumpling Night", date: "2026-03-14", startTime: "19:00", endTime: "22:00", tz: "America/New_York" }, ny = (d, t) => Date.parse(`${d}T${t}:00-04:00`);
  assert.equal(ended(ev, ny("2026-03-14", "21:30")), false); assert.equal(cardWindow(ev, ny("2026-03-14", "21:30")), false, "not while it's on");
  assert.equal(cardWindow(ev, ny("2026-03-14", "22:05")), true, "the same evening"); assert.equal(cardWindow(ev, ny("2026-03-17", "23:00")), true, "day 3"); assert.equal(cardWindow(ev, ny("2026-03-18", "08:00")), false, "day 4");
  assert.equal(bellWindow(ev, ny("2026-03-14", "22:30")), false, "never the same night"); assert.equal(bellWindow(ev, ny("2026-03-15", "08:30")), false, "not before 9am");
  assert.equal(bellWindow(ev, ny("2026-03-15", "09:05")), true); assert.equal(bellWindow(ev, ny("2026-03-15", "21:10")), false, "not at night"); assert.equal(bellWindow(ev, ny("2026-03-18", "10:00")), false);
  const untimed = { name: "Picnic", date: "2026-03-14", tz: "America/New_York" }; assert.equal(cardWindow(untimed, ny("2026-03-14", "18:00")), false); assert.equal(cardWindow(untimed, ny("2026-03-14", "20:10")), true, "no time: from 8pm");
  const late = { ...ev, startTime: "22:00", endTime: "01:00" }; assert.equal(cardWindow(late, ny("2026-03-15", "00:30")), false, "still on after midnight"); assert.equal(cardWindow(late, ny("2026-03-15", "01:10")), true);
  for (const off of [{ cancelled: true }, { noPhotos: true }, { example: true }, { sample: true }, { stage: "interest" }, { drop: true }]) { assert.equal(promptable({ ...ev, ...off }), false, JSON.stringify(off)); assert.equal(cardWindow({ ...ev, ...off }, ny("2026-03-15", "10:00")), false); assert.equal(bellWindow({ ...ev, ...off }, ny("2026-03-15", "10:00")), false); }
  assert.equal(promptable({ ...ev, discoverable: false, unlisted: true, friendsOnly: true }), true, "private and friends-only events still prompt");
  // who added, never invented
  assert.equal(addedLine([], 0), ""); assert.equal(addedLine(["Maya Chen"]), "Maya added photos"); assert.equal(addedLine(["Maya", "Jun"]), "Maya and Jun added photos"); assert.equal(addedLine(["Maya", "Jun", "Noa"]), "Maya and 2 others added photos");
  assert.equal(addedLine([], 2), "2 guests added photos"); assert.equal(addedLine(["Maya"], 2), "Maya and 1 other added photos");
  for (const t of [bellText("Dumpling Night"), TEXT_TAIL, addedLine(["Maya", "Jun", "Noa"])]) assert.doesNotMatch(t, /—|attendee|unlock|seamless|curated/i);
  assert.equal(bellText("Dumpling Night"), "Photos from Dumpling Night? Add yours to the story."); assert.equal(bellLink("spOpen"), "/feed?story=spOpen");
});

test("the card: people who went and the host, the newest event, and none of the events that never prompt", async () => {
  const out = await prompt(null); assert.deepEqual(out, { signedIn: false, card: null, dot: false, events: [] }, "signed out: nothing, and never a 401");
  const L = await prompt(U.linh); assert.equal(L.signedIn, true); assert.equal(L.card.id, "spOpen"); assert.equal(L.card.title, "Dumpling Night"); assert.equal(L.card.added, "", "nobody has added yet, so no line"); assert.equal(L.dot, true);
  assert.ok(L.card.cover.coverSpec, "the event's one cover"); assert.equal(L.card.host, false); assert.equal(L.card.open, true);
  assert.deepEqual(L.events.map((e) => e.id), ["spOpen", "spPriv", "spAsk", "spOld"], "the sheet: recent events, newest first; no cancelled, no-photos or upcoming ones");
  assert.equal(L.events.find((e) => e.id === "spPriv").open, false);
  const M = await prompt(U.mai); assert.equal(M.card.id, "spOpen"); assert.equal(M.card.host, true); assert.equal(M.host, true);
  const N = await prompt(U.noa); assert.equal(N.card, null, "a no-show isn't asked"); assert.deepEqual(N.events, []);
  const Z = await prompt(U.zed); assert.equal(Z.card, null); assert.deepEqual(Z.events, []); assert.equal(Z.host, false);
  // Home's card comes with the page (a small cookie), so it is there from the first paint; signed out there is none
  const home = await get("/?app=1", U.linh.cookie), sc = decodeURIComponent(/pl_sp=([^;]*)/.exec(home.headers.get("set-cookie") || "")?.[1] || ""); assert.equal(JSON.parse(sc).id, "spOpen"); assert.equal(JSON.parse(sc).title, "Dumpling Night");
  assert.doesNotMatch((await get("/?app=1")).headers.get("set-cookie") || "", /pl_sp=/); assert.match((await get("/?app=1", U.noa.cookie + "; pl_sp=stale")).headers.get("set-cookie") || "", /pl_sp=;/, "a stale one is cleared");
  // who already added: only once it's true
  assert.equal((await upload({ eventId: "spOpen" }, U.jun.cookie)).status, 200); X.bust();
  assert.equal((await prompt(U.linh)).card.added, "Jun added photos"); assert.equal((await prompt(U.jun)).card, null, "no prompt once you've added a photo to that event");
  assert.equal((await prompt(U.jun)).events.find((e) => e.id === "spOpen").mine, 1);
});

test("Not now hides that event's card for good (kept with the account); private events still prompt; adding ends it", async () => {
  assert.equal((await post("/api/me/story-prompt/dismiss", { eventId: "spOpen" })).status, 401);
  assert.equal((await post("/api/me/story-prompt/dismiss", { eventId: "../x" }, U.linh.cookie)).status, 400);
  assert.equal((await post("/api/me/story-prompt/dismiss", { eventId: "spOpen" }, U.linh.cookie)).status, 200);
  let L = await prompt(U.linh); assert.equal(L.card.id, "spPriv", "one card at a time: the next open one"); assert.equal(L.card.open, false, "a private event prompts the people who were there");
  // a new sign-in (another device) still has it dismissed
  const again = await post("/api/login", { email: U.linh.email, password: "long-password-1" }); assert.equal(again.status, 200); assert.equal((await prompt({ cookie: cookieOf(again) })).card.id, "spPriv");
  // the bell note's link shows that event's card even after Not now (they asked for it), but not once they've added
  assert.equal((await prompt(U.linh, "?for=spOpen")).card.id, "spOpen"); assert.equal((await prompt(U.linh, "?for=spCancel")).card.id, "spPriv");
  assert.equal((await upload({ eventId: "spPriv" }, U.linh.cookie)).status, 200); X.bust();
  L = await prompt(U.linh); assert.equal(L.card, null); assert.equal(L.dot, false);
  // their private photo stays with the people who were there
  const pub = await (await get("/api/public/feed")).json(); assert.ok(!JSON.stringify(pub).includes("Quiet supper for old friends"), "nothing from the private event reaches the public feed");
});

test("one bell note the morning after, once, to people who went and the host; the photo drop never adds a second", async () => {
  assert.equal(SP.run({ now: atHour(7) }).sent, 0, "not before 9am"); assert.equal(SP.run({ now: atHour(22) }).sent, 0, "not at night");
  const r = SP.run({ now: atHour(12) }); const ev = Object.fromEntries(r.events.map((e) => [e.eventId, e.sent]));
  assert.ok(!ev.spCancel && !ev.spNoPh && !ev.spSoon && !ev.spOld && !ev.spAsk, "only events in their 3 days, never cancelled or no-photos ones: " + JSON.stringify(ev));
  // spOpen: the host. Jun added, Linh said Not now, Noa was a no-show: none of them is asked
  assert.equal(bells(U.mai, "spOpen").length, 1); assert.equal(bells(U.jun, "spOpen").length, 0); assert.equal(bells(U.linh, "spOpen").length, 0); assert.equal(bells(U.noa, "spOpen").length, 0);
  const n = bells(U.mai, "spOpen")[0]; assert.equal(n.text, "Photos from Dumpling Night? Add yours to the story."); assert.equal(n.link, "/feed?story=spOpen"); assert.equal(n.kind, "photos", "the photos push group");
  assert.equal(bells(U.mai, "spPriv").length, 1, "the host of the private event too"); assert.equal(bells(U.linh, "spPriv").length, 0, "Linh already added there");
  assert.equal(SP.run({ now: atHour(13) }).sent, 0, "once");
  // the photo drop (the email and inbox nudge that already existed) shares the key: still one bell note per event
  await srv.app.locals.photoDrops.run({ now: atHour(14), origin: srv.base }); assert.equal(bells(U.mai, "spOpen").length, 1); assert.equal(bells(U.jun, "spOpen").length <= 1, true);
  for (const who of [U.linh, U.jun, U.mai]) for (const id of ["spOpen", "spPriv"]) assert.ok(bells(who, id).length <= 1, `${who.name} ${id}`);
  // and when the photo drop goes first, a guest with an account gets the story prompt's words and link
  assert.equal((await put("events/spDrop", { kind: "social", casual: true, published: true, discoverable: true, name: "Drop first", date: day(-1) }, U.mai.cookie)).status, 200); went(U.mai, "spDrop", U.zed); X.bust();
  await srv.app.locals.photoDrops.run({ now: atHour(14), origin: srv.base }); const z = bells(U.zed, "spDrop"); assert.equal(z.length, 1); assert.equal(z[0].link, "/feed?story=spDrop"); assert.match(z[0].text, /^Photos from Drop first\?/);
  assert.equal(SP.run({ now: atHour(15) }).events.find((e) => e.eventId === "spDrop")?.sent, 1, "only the host is left to tell"); assert.equal(bells(U.zed, "spDrop").length, 1);
});

test("the host asks guests for photos: one tap, once per event, and sees how many are in", async () => {
  assert.equal((await get("/api/host/story-ask/spAsk")).status, 401); assert.equal((await get("/api/host/story-ask/spAsk", U.linh.cookie)).status, 404, "only the host");
  let s = await (await get("/api/host/story-ask/spAsk", U.mai.cookie)).json(); assert.deepEqual({ photos: s.photos, went: s.went, asked: s.asked, can: s.can }, { photos: 0, went: 3, asked: false, can: true });
  assert.equal((await upload({ eventId: "spAsk" }, U.jun.cookie)).status, 200); X.bust();
  const a = await (await post("/api/host/story-ask/spAsk", {}, U.mai.cookie)).json(); assert.equal(a.ok, true); assert.equal(a.already, false); assert.equal(a.sent, 1, "Linh; Jun already added, and one guest has no account"); assert.equal(a.photos, 1); assert.equal(a.asked, true);
  assert.equal(bells(U.linh, "spAsk").length, 1); assert.equal(bells(U.linh, "spAsk")[0].link, "/feed?story=spAsk"); assert.equal(bells(U.jun, "spAsk").length, 0); assert.equal(bells(U.mai, "spAsk").length, 0, "the host isn't asked by their own tap");
  const b = await (await post("/api/host/story-ask/spAsk", {}, U.mai.cookie)).json(); assert.equal(b.already, true); assert.equal(bells(U.linh, "spAsk").length, 1, "once per event");
  s = await (await get("/api/host/story-ask/spAsk", U.mai.cookie)).json(); assert.equal(s.asked, true); assert.equal(s.can, true); assert.equal(s.photos, 1); assert.equal(s.people, 1);
  assert.equal((await post("/api/host/story-ask/spCancel", {}, U.mai.cookie)).status, 400); assert.equal((await post("/api/host/story-ask/spNoPh", {}, U.mai.cookie)).status, 400);
  const soon = await post("/api/host/story-ask/spSoon", {}, U.mai.cookie); assert.equal(soon.status, 400); assert.equal((await soon.json()).code, "not_yet");
  assert.equal(SP.run({ now: atHour(12) }).events.some((e) => e.eventId === "spAsk"), false);
});

test("\"Add a photo from the night\" on a past invite: only for someone who went", async () => {
  const line = async (id, q = "", cookie) => (await get(`/api/public/story-line/${id}${q}`, cookie)).json();
  assert.deepEqual(await line("spOld"), { can: false }); assert.deepEqual(await line("spOld", "?rid=r-spOld-linhsp&code=WRONG"), { can: false });
  const ok = await line("spOld", "?rid=r-spOld-linhsp&code=CspOld"); assert.equal(ok.can, true); assert.equal(ok.title, "Noodle pull"); assert.equal(ok.proof, true);
  assert.equal((await line("spOld", "", U.linh.cookie)).can, true, "or their account"); assert.equal((await line("spOld", "", U.zed.cookie)).can, false);
  assert.equal((await line("spOld", "", U.mai.cookie)).can, true, "the host");
  for (const id of ["spCancel", "spNoPh", "spSoon"]) assert.equal((await line(id, `?rid=r-${id}-linhsp&code=C${id}`)).can, false, id);
  assert.equal((await line("spOpen", "?rid=r-spOpen-noasp&code=CspOpen")).can, false, "a no-show");
});

test("the files: a separate deferred file, the light invite stays small, the Come with me? loader stays last", () => {
  assert.ok(read("public/invite.html").length < 40000); assert.doesNotMatch(read("public/invite.html"), /storyprompt/);
  assert.match(read("public/event-extras.js"), /storyprompt\.js/); assert.doesNotMatch(read("public/feed.html"), /\bprompt\(/, "no typed prompt() left in the feed");
  const idx = read("index.html"), scripts = [...idx.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]); assert.match(scripts[scripts.length - 1], /Come with me\?/); assert.match(idx, /<script src="\/storyprompt\.js"><\/script>/);
  const js = read("public/storyprompt.js"); assert.doesNotMatch(js, /—|attendee/i); assert.doesNotMatch(js, /[\u{1F300}-\u{1FAFF}]/u, "no emoji in the prompts");
});

// ---------------------------------------------------------------- the browser
for (const W of [390, 1280]) test(`browser at ${W}: the card after an event, Add photos, Not now, the event sheet, the new-user sheet`, { timeout: 240000 }, async (t) => {
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch { return t.skip("playwright is not installed"); }
  let browser; try { browser = await pw.chromium.launch(); } catch { return t.skip("no Chromium here"); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true }); const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${W}.png`) }); };
  // this width's own people: Ana adds, Ben says Not now and uses the sheet, Cy is new
  const ana = await join("Ana Ruiz", `ana${W}.sp@example.com`), ben = await join("Ben Okafor", `ben${W}.sp@example.com`), cy = await join("Cy Novak", `cy${W}.sp@example.com`), A = `bwA${W}`, B = `bwB${W}`;
  assert.equal((await put("events/" + A, { kind: "social", casual: true, published: true, discoverable: true, activity: "dinner", name: "Hand-pulled noodle night with the Saturday supper crew", date: day(-1) }, U.mai.cookie)).status, 200);
  assert.equal((await put("events/" + B, { kind: "social", casual: true, published: true, discoverable: true, activity: "hike", name: "Morning ridge walk", date: day(-5) }, U.mai.cookie)).status, 200);
  for (const who of [ana, ben]) for (const id of [A, B]) went(U.mai, id, who);
  srv.store.set(`ws/${U.mai.ws}/moments/m${W}`, { eventId: A, authorEmail: "maya.other@example.com", authorName: "Maya Chen", authorKey: "rid:x", url: "/_blob/abcdef123456", type: "image", at: Date.now() - 3600e3 }); X.bust();
  const ctxFor = async (who) => { const ctx = await browser.newContext(W === 390 ? { ...pw.devices["iPhone 13"], viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" } : { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" });
    if (who) await ctx.addCookies(who.cookie.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: srv.base }; }).concat([{ name: "encore_in", value: "1", url: srv.base }]));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
    await ctx.addInitScript(() => { window.__cls = 0; window.__dialogs = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {} const p = window.prompt; window.prompt = function () { window.__dialogs++; return p.apply(this, arguments); }; });
    return ctx; };
  const errs = []; const watch = (page) => { page.on("pageerror", (e) => errs.push("pageerror " + e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console " + m.text()); /* a failed load is caught by its URL just below */ }); page.on("requestfailed", (r) => { if (!/_blob\/abcdef123456/.test(r.url())) errs.push("failed " + r.url()); });
    page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(srv.base) && !/_blob\/abcdef123456|favicon/.test(r.url())) errs.push(r.status() + " " + r.url()); }); page.on("dialog", (d) => { errs.push("a native dialog opened: " + d.message()); d.dismiss().catch(() => {}); }); };
  const feed = async (page, q = "") => { await page.goto(srv.base + "/feed" + q, { waitUntil: "domcontentloaded" }); await page.waitForSelector("#fvAdd", { timeout: 20000 }); await page.waitForTimeout(700); };
  try {
    // ---- Ana: the card for the newest event, who already added, and Add photos opens the picker for that event
    let ctx = await ctxFor(ana), page = await ctx.newPage(); watch(page); await feed(page);
    const card = await page.$eval("#spCard", (el) => ({ text: el.innerText, ev: el.dataset.ev, n: document.querySelectorAll(".sp-card").length, top: el.getBoundingClientRect().top, inMain: !!el.closest("#m"), first: el === document.querySelector("#m").firstElementChild,
      btns: [...el.querySelectorAll(".sp-b")].map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height, w: getComputedStyle(b).fontWeight, bg: getComputedStyle(b).backgroundColor, r: getComputedStyle(b).borderRadius })),
      h: (() => { const x = el.querySelector(".sp-h"); return { clip: x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1, font: getComputedStyle(x).fontFamily, size: parseFloat(getComputedStyle(x).fontSize) }; })(), cover: !!el.querySelector(".sp-cov .ea-cover, .sp-cov img"), open: !!document.querySelector("#spSheet") }));
    assert.equal(card.ev, A); assert.equal(card.n, 1, "one card"); assert.ok(card.first && card.inMain, "at the top of the feed"); assert.match(card.text, /How was Hand-pulled noodle night with the Saturday supper crew\?/); assert.match(card.text, /Add a photo to your story\./); assert.match(card.text, /Maya added photos\./);
    assert.deepEqual(card.btns.map((b) => b.t), ["Add photos", "Not now"]); assert.ok(card.btns.every((b) => b.h >= 44 && b.h === card.btns[0].h && b.w === card.btns[0].w && b.r === "6px"), "two buttons, one height and weight: " + JSON.stringify(card.btns));
    assert.notEqual(card.btns[0].bg, card.btns[1].bg, "one primary"); assert.equal(card.h.clip, false, "the title isn't cut"); assert.match(card.h.font, /Plex Sans/); assert.ok(card.h.size < 24); assert.ok(card.cover, "the event's cover, not an emoji"); assert.equal(card.open, false, "nothing opens by itself");
    const ring = await page.$eval("#fvAdd", (b) => ({ label: b.querySelector("small").textContent, dot: !!b.querySelector(".sp-dot"), h: b.getBoundingClientRect().height })); assert.deepEqual({ label: ring.label, dot: ring.dot }, { label: "Add photos", dot: true }); assert.ok(ring.h >= 44);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), "no sideways scroll"); assert.ok((await page.evaluate(() => window.__cls)) < 0.05, "no layout jump: " + (await page.evaluate(() => window.__cls)));
    await shot(page, "feed-card");
    const up = page.waitForResponse((r) => /\/api\/moments\?/.test(r.url()) && r.request().method() === "POST"), [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#spCard [data-sp-add]")]);
    await fc.setFiles({ name: "night.png", mimeType: "image/png", buffer: PNG }); const res = await up; assert.equal(res.status(), 200, await res.text()); assert.equal(new URL(res.url()).searchParams.get("eventId"), A, "the picker was set to that event");
    await page.waitForFunction(() => /Added\. Friends see it in their feed\./.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 10000 }); await page.waitForFunction(() => !document.querySelector("#spCard"), null, { timeout: 10000 });
    await shot(page, "feed-added"); assert.equal((await prompt(ana)).events.find((e) => e.id === A).mine, 1);
    await page.waitForFunction(() => document.querySelector("#fvAdd small")?.textContent === "Your story", null, { timeout: 10000 }); // B is past its 3 days, so no prompt is left
    await ctx.close();

    // ---- Ben: Not now sticks; the sheet replaced prompt()
    ctx = await ctxFor(ben); page = await ctx.newPage(); watch(page); await feed(page); assert.equal(await page.$eval("#spCard", (el) => el.dataset.ev), A);
    await page.click("#spCard [data-sp-not]"); await page.waitForFunction(() => !document.querySelector("#spCard") && document.querySelector("#fvAdd small")?.textContent === "Your story", null, { timeout: 10000 });
    await feed(page); assert.equal(await page.$("#spCard"), null, "Not now sticks after a reload"); assert.equal((await prompt(ben)).card, null);
    await page.click("#fvAdd"); await page.waitForSelector("#spSheet [data-sp-ev]", { timeout: 10000 });
    const sh = await page.evaluate(() => { const s = document.querySelector("#spSheet .sp-sheet"), rows = [...s.querySelectorAll("[data-sp-ev]")]; return { role: s.getAttribute("role"), modal: s.getAttribute("aria-modal"), title: s.querySelector("h2").textContent, rows: rows.map((b) => ({ t: b.querySelector(".sp-rt b").textContent, d: b.querySelector(".sp-rt small").textContent, h: b.getBoundingClientRect().height, cover: !!b.querySelector(".sp-cov .ea-cover, .sp-cov img"), clip: b.querySelector(".sp-rt b").scrollWidth > b.querySelector(".sp-rt b").clientWidth + 1 })),
      close: (() => { const c = s.querySelector("[data-sp-close]"), r = c.getBoundingClientRect(); return { t: c.textContent, h: r.height, w: r.width }; })(), focusIn: s.contains(document.activeElement), fits: s.getBoundingClientRect().right <= innerWidth + 1 && s.getBoundingClientRect().bottom <= innerHeight + 1, dialogs: window.__dialogs }; });
    assert.equal(sh.role, "dialog"); assert.equal(sh.modal, "true"); assert.equal(sh.title, "Add photos to your story"); assert.equal(sh.dialogs, 0, "no prompt()");
    assert.deepEqual(sh.rows.map((r) => r.t), ["Hand-pulled noodle night with the Saturday supper crew", "Morning ridge walk"], "most recent first"); assert.ok(sh.rows.every((r) => r.h >= 44 && r.cover && !r.clip && /\w{3}, \w{3} \d+/.test(r.d)), JSON.stringify(sh.rows));
    assert.equal(sh.close.t, "Close"); assert.ok(sh.close.h >= 44 && sh.close.w >= 44); assert.ok(sh.focusIn, "focus moves into the sheet"); assert.ok(sh.fits);
    await shot(page, "sheet-events");
    await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#spSheet")); assert.equal(await page.evaluate(() => document.activeElement?.id), "fvAdd", "Esc closes and focus goes back to the button");
    await page.click("#fvAdd"); await page.waitForSelector("#spSheet"); await page.click("#spSheet [data-sp-close]"); await page.waitForFunction(() => !document.querySelector("#spSheet")); assert.equal(await page.evaluate(() => document.activeElement?.id), "fvAdd");
    await page.click("#fvAdd"); await page.waitForSelector("#spSheet [data-sp-ev]");
    const up2 = page.waitForResponse((r) => /\/api\/moments\?/.test(r.url()) && r.request().method() === "POST"), [fc2] = await Promise.all([page.waitForEvent("filechooser"), page.click('#spSheet [data-sp-ev="1"]')]);
    assert.equal(await page.$("#spSheet"), null, "one tap, one screen: the sheet closes as the file picker opens");
    await fc2.setFiles({ name: "walk.png", mimeType: "image/png", buffer: PNG }); assert.equal(new URL((await up2).url()).searchParams.get("eventId"), B);
    await page.waitForFunction(() => /Added\./.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 10000 });
    // the bell note's link: the card for that event, inline, even after Not now
    await feed(page, "?story=" + A); assert.equal(await page.$eval("#spCard", (el) => el.dataset.ev), A); assert.equal(await page.$("#spSheet"), null, "the deep link never opens a sheet by itself");
    await ctx.close();

    // ---- Cy: no events yet. One line of why and one next step, not a dead end
    ctx = await ctxFor(cy); page = await ctx.newPage(); watch(page); await feed(page); assert.equal(await page.$("#spCard"), null); assert.equal(await page.$eval("#fvAdd small", (s) => s.textContent), "Your story");
    await page.click("#fvAdd"); await page.waitForSelector("#spSheet .sp-b.go", { timeout: 10000 });
    const nu = await page.$eval("#spSheet .sp-sheet", (s) => ({ text: s.innerText, links: [...s.querySelectorAll("a.sp-b")].map((a) => [a.textContent, a.getAttribute("href"), a.getBoundingClientRect().height]), rows: s.querySelectorAll("[data-sp-ev]").length }));
    assert.match(nu.text, /Photos go with an event you went to or hosted\./); assert.deepEqual(nu.links.map((l) => l.slice(0, 2)), [["Find something to go to", "/discover"]], "one next step"); assert.ok(nu.links[0][2] >= 44); assert.equal(nu.rows, 0);
    await shot(page, "sheet-new"); await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#spSheet")); assert.equal(await page.evaluate(() => document.activeElement?.id), "fvAdd");
    await ctx.close();

    // ---- signed out: no card, no ring to add, no request for prompts
    ctx = await ctxFor(null); page = await ctx.newPage(); watch(page); const asked = []; page.on("request", (r) => { if (/story-prompt/.test(r.url())) asked.push(r.url()); });
    await page.goto(srv.base + "/feed", { waitUntil: "domcontentloaded" }); await page.waitForSelector("#m *", { timeout: 20000 }); await page.waitForTimeout(1200);
    assert.equal(await page.$("#spCard"), null); assert.equal(await page.$("#fvAdd"), null); assert.deepEqual(asked, []); await shot(page, "feed-signed-out"); await ctx.close();
    assert.deepEqual(errs, [], "console clean, no failed requests");
  } finally { await browser.close(); }
});
