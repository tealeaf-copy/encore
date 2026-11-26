// New-user hooks on the feed: the swipe deck (GET /api/public/deck, public/swipedeck.js), photo drops after every event
// (server/photodrop.js, /p/<event>), recap stories on the host's ring (server/feedvisual.js recapOf), and the review
// fixes (the dance drawing, the city-only weekend strip, one title per flyer, the ideas carousel, the stray dot).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { fakeOutbox } from "../server/email.js";
import { momentsPublic } from "../server/feedvisual.js";
import { dropWindow, dropLine, droppable } from "../server/photodrop.js";
import { zonedMs } from "../server/tz.js";

let srv;
const J = { "content-type": "application/json" };
const post = (path, body, cookie) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { cookie } : {} });
const put = (path, body, cookie) => fetch(srv.base + "/api/db/doc?path=" + path, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(body) });
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return { cookie: cookieOf(r), ws: b.workspace.id }; };
const reply = (ws, id, data) => { srv.store.set(`ws/${ws}/rsvps/${id}`, { response: "going", createdAt: Date.now() - 5 * 864e5, ...data }); return id; };
const upload = (q, body = PNG) => fetch(`${srv.base}/api/moments?${new URLSearchParams(q)}`, { method: "POST", headers: { "content-type": "image/png" }, body });
// 10am local time on the day after `ago` days ago
const morningAfter = (eventDate) => { const d = new Date(eventDate + "T10:00:00"); d.setDate(d.getDate() + 1); return d.getTime(); };
const S = {};

before(async () => {
  srv = await startServer();
  Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "nu-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits();
  S.mai = await join("Mai Pham", "mai.nu@example.com");
  assert.ok((await post("/api/host/profile", { handle: "mai-nu", name: "Mai's dumpling club", tagline: "Dumplings and new friends.", city: "Brooklyn", emoji: "🥟" }, S.mai.cookie)).ok);
  const open = { kind: "social", casual: true, discoverable: true, published: true, city: "Brooklyn", activity: "dinner" };
  const ev = { nuPast: { ...open, name: "Dumpling night", date: day(-1) }, nuNext: { ...open, name: "Dumpling night", date: day(12), startTime: "19:00" }, nuSalsa: { ...open, name: "Salsa on the roof", activity: "dance", date: day(3) },
    nuQueens: { ...open, name: "Queens sunrise 5k", city: "Queens", activity: "run", date: day(2) }, nuFriends: { kind: "social", casual: true, friendsOnly: true, discoverable: true, name: "Birthday dinner", city: "Brooklyn", date: day(-1) },
    nuQuiet: { ...open, name: "Quiet supper", date: day(-1), autoRemind: false }, nuNoPh: { ...open, name: "Phone-free supper", date: day(-1), noPhotos: true } };
  for (const [id, e] of Object.entries(ev)) assert.equal((await put("events/" + id, e, S.mai.cookie)).status, 200, id);
  for (const [i, n] of ["Linh", "Sam", "Priya", "Jo"].entries()) reply(S.mai.ws, "nuR" + i, { eventId: "nuPast", name: n + " Guest", email: `${n.toLowerCase()}.nu@example.com`, code: "NC" + i });
  reply(S.mai.ws, "nuNoShow", { eventId: "nuPast", name: "No Show", email: "noshow.nu@example.com", code: "NCX", noShow: true });
  reply(S.mai.ws, "nuF0", { eventId: "nuFriends", name: "Linh Guest", email: "linh.nu@example.com", code: "NF0" });
  reply(S.mai.ws, "nuQ0", { eventId: "nuQuiet", name: "Quiet Guest", email: "quiet.nu@example.com", code: "NQ0" });
  reply(S.mai.ws, "nuP0", { eventId: "nuNoPh", name: "Phone Guest", email: "phone.nu@example.com", code: "NP0" });
  srv.app.locals.social.bust();
});
beforeEach(() => { process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "nu-secret"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits(); });
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

test("Private and friends-only events never count as open, whatever else is switched on", () => {
  const open = { discoverable: true };
  assert.equal(momentsPublic(open), true);
  for (const x of [{ friendsOnly: true }, { private: true }, { visibility: "friends" }, { visibility: "private" }, { approvalRequired: true }, { noPhotos: true }, { unlisted: true }]) assert.equal(momentsPublic({ ...open, ...x }), false, JSON.stringify(x));
});

test("Swipe deck: real events in the visitor's city first, then ideas and photos, each with the interests it trains", async () => {
  const j = await (await get("/api/public/deck?city=Brooklyn")).json();
  assert.ok(j.cards.length >= 5, "enough cards for 5 swipes");
  assert.equal(j.city, "Brooklyn"); assert.ok(j.local >= 2);
  const lead = j.cards.slice(0, j.local);
  assert.ok(lead.every((c) => c.kind === "event" && c.local), "Brooklyn events lead");
  assert.ok(lead.some((c) => c.ref === "nuSalsa") && lead.some((c) => c.ref === "nuNext"));
  assert.ok(!lead.some((c) => c.ref === "nuQueens"), "Queens waits until after the ideas");
  assert.ok(!j.cards.some((c) => ["nuFriends", "nuPast"].includes(c.ref)), "no friends-only or past events");
  assert.deepEqual(j.cards.find((c) => c.ref === "nuSalsa").tags, ["dance"], "salsa trains Dance");
  const idea = j.cards.find((c) => c.kind === "idea"); assert.ok(idea, "ideas follow"); assert.match(idea.ref, /^idea-/); assert.equal(idea.badge, "Idea");
  for (const c of j.cards) assert.ok(["event", "idea", "host"].includes(c.kind) && c.ref && c.title, "each card can be saved");
  // the deck's saves go through the same saves API and signup carry-over
  const u = await join("Deck Person", "deck.nu@example.com");
  const m = await post("/api/me/saves", { merge: j.cards.slice(0, 3).map((c) => ({ kind: c.kind, ref: c.ref, title: c.title })) }, u.cookie); assert.equal(m.status, 200);
  assert.equal((await m.json()).merged, 3);
});

test("Photo drops: the morning after, one email and one inbox item per guest who was in, never twice", async () => {
  const past = day(-1), now = morningAfter(past), PD = srv.app.locals.photoDrops;
  // review round 11: the drops run on the event's own time zone (these are in Brooklyn and Queens), so the job runs at 10am there
  const nowNY = zonedMs(new Date(Date.parse(past + "T12:00:00Z") + 864e5).toISOString().slice(0, 10), "10:00", "America/New_York");
  assert.equal(dropWindow({ date: past }, now), true);
  assert.equal(dropWindow({ date: past }, now - 5 * 3600e3), false, "not at 5am");
  assert.equal(dropWindow({ date: day(-6) }, now), false, "not a week later");
  assert.equal(droppable({ date: past, noPhotos: true }), false); assert.equal(droppable({ date: past, autoRemind: false }), false);
  const before = fakeOutbox.length, linh = await join("Linh Guest", "linh.nu@example.com");
  const r = await PD.run({ now: nowNY, origin: "https://pl.example", workspaces: [S.mai.ws] });
  const mine = fakeOutbox.slice(before).filter((m) => /Add your photos/.test(m.subject));
  const to = mine.map((m) => String(m.to)).sort();
  assert.ok(to.includes("linh.nu@example.com") && to.includes("jo.nu@example.com"));
  assert.ok(!to.includes("noshow.nu@example.com"), "no-shows aren't asked");
  assert.ok(!to.includes("quiet.nu@example.com"), "the host switched off messages to guests");
  assert.ok(!to.includes("phone.nu@example.com"), "no-photos events get no drop");
  const m = mine.find((x) => String(x.to) === "jo.nu@example.com"); assert.equal(m.subject, dropLine("Dumpling night"));
  assert.match(m.text, /https:\/\/pl\.example\/p\/nuPast\?rid=nuR3&code=NC3/); assert.match(m.text, /in the Pottery Lab feed/);
  assert.doesNotMatch(mine.find((x) => /Birthday/.test(x.subject)).text, /feed/, "friends-only: only people who were there");
  assert.ok(r.sent >= 5 && r.inbox >= 5);
  const inbox = await (await get("/api/me/inbox", linh.cookie)).json();
  const item = inbox.items.find((i) => i.kind === "photos" && /Add your photos from Dumpling night/.test(i.text)); assert.ok(item, "inbox item");
  assert.match(item.link, /^\/p\/nuPast\?rid=nuR0&code=NC0$/);
  const again = await PD.run({ now: nowNY + 3600e3, origin: "https://pl.example", workspaces: [S.mai.ws] }); assert.equal(again.sent, 0, "once per guest per event");
  // the hourly job runs drops after the kudos follow-ups (server/kudosask.js calls this object)
  assert.equal(typeof srv.app.locals.kudosNudge.runFollowUps, "function");
});

test("Photo drop page: the reply proof opens it, uploads scrub captions, rate limits hold, private photos stay private", async () => {
  const page = await get("/p/nuPast?rid=nuR0&code=NC0"); assert.equal(page.status, 200); assert.equal(page.headers.get("referrer-policy"), "no-referrer"); assert.match(await page.text(), /momentupload\.js/);
  assert.equal((await get("/api/public/photo-drop/nuPast?rid=nuR0&code=WRONG")).status, 403);
  assert.equal((await get("/api/public/photo-drop/nuPast?rid=nuNoShow&code=NCX")).status, 403, "no-shows can't");
  const d = await (await get("/api/public/photo-drop/nuPast?rid=nuR0&code=NC0")).json(); assert.equal(d.title, "Dumpling night"); assert.equal(d.public, true); assert.equal(d.open, true);
  assert.equal((await (await get("/api/public/photo-drop/nuFriends?rid=nuF0&code=NF0")).json()).public, false);
  const up = await upload({ eventId: "nuPast", rid: "nuR0", code: "NC0", caption: "call me 718 555 0199 or mai@example.com" }); assert.equal(up.status, 200, await up.clone().text());
  for (const [i, rid] of ["nuR1", "nuR2"].entries()) assert.equal((await upload({ eventId: "nuPast", rid, code: "NC" + (i + 1), caption: "round " + i })).status, 200);
  assert.equal((await upload({ eventId: "nuFriends", rid: "nuF0", code: "NF0", caption: "cake" })).status, 200);
  srv.app.locals.social.bust();
  const feed = await (await get("/api/public/feed")).json(), card = feed.past.find((e) => e.id === "nuPast");
  assert.equal(card.photos.length, 3); assert.equal(card.newPhotos, 3, "a fresh photo drop");
  assert.ok(card.photos.every((p) => !/555|@/.test(p.caption)), "emails and phones scrubbed");
  assert.ok(!feed.past.some((e) => e.id === "nuFriends"), "friends-only never in the public feed");
  assert.ok(!feed.moments.some((m) => m.event.id === "nuFriends"));
  // one guest can't flood an event (30 each), and the IP limit holds after that
  let last = 200; for (let i = 0; i < 45 && last === 200; i++) last = (await upload({ eventId: "nuPast", rid: "nuR3", code: "NC3" })).status;
  assert.equal(last, 429, "uploads are rate limited");
});

test("Recap stories: 3+ photos and kudos make one on the host's ring for 24 hours, ending on the next date", async () => {
  srv.app.locals.social.bust();
  const V = srv.app.locals.feedVisual, now = Date.now();
  const st = V.stories({ now }), ring = st.find((s) => s.host.handle === "mai-nu"); assert.ok(ring, "Mai's ring");
  assert.deepEqual(ring.recap, { eventId: "nuPast", title: "Dumpling night" });
  const types = ring.items.filter((i) => i.id.startsWith("r:nuPast")).map((i) => i.type);
  assert.equal(types[0], "recap"); assert.equal(types.at(-1), "end"); assert.ok(types.filter((t) => t === "image").length >= 3);
  const title = ring.items[0]; assert.equal(title.recap.came, 4, "4 came (the no-show doesn't count)"); assert.ok(ring.thumb.startsWith("/_blob/"), "a real photo on the ring");
  const end = ring.items.find((i) => i.type === "end"); assert.equal(end.end.next.id, "nuNext", "the same event's next date"); assert.equal(end.cta.label, "I'm in");
  assert.ok(!ring.items.some((i) => i.id.startsWith("m:") && i.ev === "nuPast"), "its photos aren't shown twice");
  // the friends-only dinner: never a recap for strangers
  assert.ok(!st.some((s) => s.recap?.eventId === "nuFriends"));
  // gone 24 hours after it was made
  assert.ok(!V.stories({ now: now + 25 * 3600e3 }).some((s) => s.recap), "24 hours");
  // the viewer knows the new card types
  const fv = fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8");
  for (const k of ['it.type === "recap"', 'it.type === "quote"', 'it.type === "end"', "data-fv-follow"]) assert.ok(fv.includes(k), k);
});

test("Feed review fixes: dance drawing, one title per flyer, city-only weekend strip, ideas carousel, no stray dot", () => {
  const src = fs.readFileSync(new URL("../public/eventart.js", import.meta.url), "utf8"), win = {};
  vm.runInNewContext(src, { window: win });
  assert.equal(win.EventArt.kindOf({ name: "Salsa on the roof" }), "dance"); assert.equal(win.EventArt.kindOf({ name: "Bachata social" }), "dance");
  assert.equal(win.EventArt.LABEL.dance, "Dance"); assert.match(win.EventArt.drawing("dance", "#E8452C"), /^<svg/);
  const fv = fs.readFileSync(new URL("../public/feedvisual.js", import.meta.url), "utf8");
  assert.match(fv, /: art\(e, \{ title: "" \}\); \/\* the heading below has the title/, "flyer art without a second title");
  assert.match(fv, /weekend = up\.filter\(\(e\) => e\.date <= wk && here\(e\)\)/, "weekend strip in the visitor's city");
  assert.match(fv, /\.fv-strip\.fv-inspo\{align-items:flex-start\}/);
  const inspo = fs.readFileSync(new URL("../public/inspo.js", import.meta.url), "utf8"), m = inspo.match(/const lineOf = [\s\S]*?return l\.replace\([^;]*; \};/);
  const lineOf = vm.runInNewContext(m[0].replace(/^const lineOf = /, "(").replace(/;\s*$/, "") + ")");
  assert.equal(lineOf({ title: "Natural wine", line: "Natural wine · $45 a person" }), "$45 a person");
  assert.equal(lineOf({ title: "X", line: "· $45 a person" }), "$45 a person");
});

test("New pages: copy rules (no em dashes, no 'per person' or 'attendees') and the deck wiring", () => {
  for (const f of ["../public/swipedeck.js", "../public/photos.html", "../server/photodrop.js"]) { const t = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(t, /—/, f + ": no em dashes"); if (!f.includes("server")) assert.doesNotMatch(t, /per person|attendees|seamless|unlock|curated|taped in/i, f); }
  const deck = fs.readFileSync(new URL("../public/swipedeck.js", import.meta.url), "utf8");
  for (const k of ["Pick topics instead", "I'm in", "Make a free account to keep them.", "pl.deckDone", "ArrowRight", "ArrowLeft", "pointerdown", "/api/public/deck", "PLSave?.add", "PLInterests.train"]) assert.ok(deck.includes(k), k);
  assert.match(deck, /Your \$\{n\} \$\{n === 1 \? "pick is" : "picks are"\} saved\./);
  const ints = fs.readFileSync(new URL("../public/interests.js", import.meta.url), "utf8"); assert.match(ints, /location\.pathname === "\/feed" && !localStorage\.getItem\("pl\.deckDone"\)/, "the old picker waits for the deck on /feed");
});
