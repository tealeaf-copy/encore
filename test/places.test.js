// "Your places" and the year in nights (server/places.js, server/sharecards.js, public/places.js, public/yearreview.js,
// public/sharecards.js): what counts as a place, where it may go on a map, who may see it, the story's cards, the PNGs
// and what words they carry, the friends layer, the public link, and calm motion.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { makeSafety, keyOf } from "../server/safety.js";
import { hoodCentre } from "../server/geo.js";
import { attendedVia, hostedCounts, privateLabel, scrubQuote, mapOf, isPublicEvent } from "../server/places.js";
import { renderCard, textOf, pngSize, decodePng, SIZES } from "../server/sharecards.js";

let srv;
const J = { "Content-Type": "application/json" };
const req = (method, path, body, cookie) => fetch(srv.base + path, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const post = (path, body, cookie) => req("POST", path, body, cookie);
const get = async (path, cookie) => { const r = await fetch(srv.base + path, { headers: cookie ? { cookie } : {} }); assert.equal(r.status, 200, path); return r.json(); };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const Y = +day(0).slice(0, 4);
const wsOf = (handle) => srv.store.get("system/handle-" + handle).data.ws;
const P = () => srv.app.locals.places, X = () => srv.app.locals.social;
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
let n = 0;
async function account(name, email) { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200, "signup " + email); return r.headers.get("set-cookie").split(";")[0]; }
async function host(email, handle, name, extra = {}) { const c = await account(name, email); const p = await post("/api/host/profile", { handle, name, tagline: "Small dinners.", emoji: "🍜", city: "New York", hood: "Greenpoint", ...extra }, c); assert.ok(p.ok, "profile " + handle); return c; }
const ev = (handle, id, e) => scopeStore(srv.store, wsOf(handle)).set("events/" + id, { kind: "social", casual: true, activity: "dinner", city: "New York", hood: "Greenpoint", startTime: "19:00", published: true, discoverable: true, ...e });
const rsvp = (handle, eventId, r) => scopeStore(srv.store, wsOf(handle)).set("rsvps/pr" + ++n, { eventId, response: "going", createdAt: Date.now(), ...r });
const GIA = "gia.places@example.com", FAY = "fay.places@example.com", STAN = "stan.places@example.com", BO = "bo.places@example.com";
let mai, gia, fay, stan, bo;
// a past date this year, n days back (kept inside this year so the year's counts hold in early January too)
const back = (k) => { const d = day(-k); return d.slice(0, 4) === String(Y) ? d : `${Y}-01-0${Math.min(9, 1 + (k % 8))}`; };

before(async () => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "places-secret"; process.env.ENCORE_SIGNUP_PER_HOUR = "200"; process.env.ENCORE_FAKE_EMAIL = "1"; resetLoginLimits();
  srv = await startServer();
  mai = await host("mai.places@example.com", "mai-places", "Mai's Supper Club");
  gia = await host(GIA, "gia-places", "Gia Tran", { hood: "Williamsburg" });
  fay = await account("Fay Fern", FAY); stan = await account("Stan Stranger", STAN); bo = await account("Bo Blocked", BO);
  // Mai's events, and Gia's replies to them
  ev("mai-places", "plPub", { name: "Dumpling night", date: back(20), coverPhoto: "/presets/atelier-bo-apt-cafe-club.jpg" });
  ev("mai-places", "plPriv", { name: "SECRET birthday supper", date: back(10), discoverable: false, hood: "Bushwick", meetPoint: "My apartment", venueAddr: "214 Milton St, Apt 3", placePublic: true });
  ev("mai-places", "plCheck", { name: "Board game night", activity: "board games", date: day(0) });
  ev("mai-places", "plFuture", { name: "Next month supper", date: day(9) });
  ev("mai-places", "plNoShow", { name: "No-show supper", date: back(30) });
  ev("mai-places", "plMaybe", { name: "Maybe supper", date: back(31) });
  ev("mai-places", "plCancel", { name: "Cancelled supper", date: back(32), cancelled: true });
  ev("mai-places", "plDrop", { name: "Chili crisp drop", date: back(5), drop: true, preorder: true });
  ev("mai-places", "plDrop2", { name: "Bread drop", date: back(6), drop: true, preorder: true });
  rsvp("mai-places", "plPub", { email: GIA, name: "Gia Tran" }); rsvp("mai-places", "plPriv", { email: GIA, name: "Gia Tran" });
  rsvp("mai-places", "plCheck", { email: GIA, name: "Gia Tran", checkedInAt: Date.now() }); rsvp("mai-places", "plFuture", { email: GIA, name: "Gia Tran" });
  rsvp("mai-places", "plNoShow", { email: GIA, name: "Gia Tran", noShow: true }); rsvp("mai-places", "plMaybe", { email: GIA, name: "Gia Tran", response: "maybe" });
  rsvp("mai-places", "plCancel", { email: GIA, name: "Gia Tran" });
  rsvp("mai-places", "plDrop", { email: GIA, name: "Gia Tran", orderStatus: "picked", paid: true }); rsvp("mai-places", "plDrop2", { email: GIA, name: "Gia Tran", paid: true, orderStatus: "paid" });
  // Gia hosts a tea; Fay came and wrote kudos naming someone else
  ev("gia-places", "gTea", { name: "Slow tea morning", activity: "tea", date: back(15), hood: "Williamsburg" });
  rsvp("gia-places", "gTea", { email: FAY, name: "Fay Fern" }); rsvp("gia-places", "gTea", { email: STAN, name: "Stan Stranger" });
  scopeStore(srv.store, wsOf("gia-places")).set("kudos/k1", { eventId: "gTea", email: FAY, name: "Fay Fern", love: "Gia made it easy, and Stan's scones were great. Call me on 555 123 4567.", tags: ["welcome"], at: Date.now() });
  // a brand booking Gia was checked in at
  srv.store.set("system/bbreq-abc123", { kind: "bbreq", id: "abc123", status: "done", hostWs: wsOf("mai-places"), handle: "mai-places", pkgName: "Team pottery night", date: back(3) });
  srv.store.set("system/bpev-abc123", { kind: "bpev", reqId: "abc123", hostSeats: [{ id: "s1", name: "Gia", email: GIA, checkedIn: true }, { id: "s2", name: "Ned", email: "ned.places@example.com", checkedIn: false }] });
  P().bust();
});
after(async () => { for (const k of ["ENCORE_SIGNUP", "SESSION_SECRET", "ENCORE_SIGNUP_PER_HOUR", "ENCORE_FAKE_EMAIL"]) delete process.env[k]; await srv.close(); });

// ---------------------------------------------------------------- what counts
test("only nights that happened and that you were at (or hosted) count", async () => {
  const M = await get(`/api/me/places?year=${Y}`, gia), ids = M.places.map((p) => p.id).sort();
  const mustHave = ["plPub", "plPriv", "plCheck", "plDrop", "gTea", "bb-abc123"]; for (const id of mustHave) assert.ok(ids.includes(id), "counts " + id);
  for (const id of ["plFuture", "plNoShow", "plMaybe", "plCancel", "plDrop2"]) assert.ok(!ids.includes(id), "never counts " + id);
  assert.equal(M.counts.nights, mustHave.length); assert.equal(M.places.find((p) => p.id === "gTea").role, "hosted");
  assert.equal(M.places.find((p) => p.id === "plCheck").via, "checkin"); assert.equal(M.places.find((p) => p.id === "plDrop").via, "drop"); assert.equal(M.places.find((p) => p.id === "bb-abc123").via, "brand");
  assert.equal(M.counts.hoods, new Set(M.places.map((p) => p.area?.key)).size, "neighbourhoods are distinct areas");
  assert.match(M.line, new RegExp(`^${mustHave.length} nights in ${M.counts.hoods} neighbourhoods this year$`));
  // the unit rules behind it
  const today = day(0);
  assert.equal(attendedVia({ response: "going" }, { date: day(-1) }, today), "went"); assert.equal(attendedVia({ response: "going" }, { date: day(2) }, today), "");
  assert.equal(attendedVia({ response: "going", noShow: true }, { date: day(-1) }, today), ""); assert.equal(attendedVia({ response: "maybe" }, { date: day(-1) }, today), "");
  assert.equal(attendedVia({ response: "going" }, { date: day(-1), cancelled: true }, today), ""); assert.equal(attendedVia({ response: "going", paid: true }, { date: day(-1), drop: true }, today), "");
  assert.equal(attendedVia({ orderStatus: "picked" }, { date: day(-1), drop: true }, today), "drop");
  assert.equal(hostedCounts({ date: day(-1), published: true }, 0, today), true); assert.equal(hostedCounts({ date: day(-1) }, 0, today), false, "a draft nobody came to");
  assert.equal(hostedCounts({ date: day(-1), published: true, cancelled: true }, 3, today), false); assert.equal(hostedCounts({ date: day(3), published: true }, 0, today), false);
  // Mai sees her hosted nights (the ones that happened and were shared)
  const MM = await get(`/api/me/places?year=${Y}`, mai); assert.ok(MM.places.every((p) => p.role === "hosted")); assert.ok(!MM.places.some((p) => ["plFuture", "plCancel"].includes(p.id)));
  assert.equal((await req("GET", "/api/me/places")).status, 401);
});

// ---------------------------------------------------------------- privacy
test("a private event is only a neighbourhood, by label, to anyone but you; never a point or its title", async () => {
  const mineP = (await get(`/api/me/places?year=${Y}`, gia)).places.find((p) => p.id === "plPriv");
  assert.equal(mineP.public, false); assert.equal(mineP.point, null, "no point even for you"); assert.equal(mineP.label, "A dinner in Bushwick");
  const c = hoodCentre("Bushwick", "New York"); assert.equal(mineP.area.lat, +c.lat.toFixed(3)); assert.equal(mineP.area.lng, +c.lng.toFixed(3)); assert.equal(mineP.area.hood, "Bushwick");
  assert.equal(privateLabel({ activity: "dinner", hood: "Greenpoint" }), "A dinner in Greenpoint"); assert.equal(privateLabel({ activity: "dinner" }, {}, { brand: true }), "A team dinner with friends");
  assert.equal(isPublicEvent({ discoverable: true, visibility: "members" }), false); assert.equal(isPublicEvent({ discoverable: true }, { only: true }), false);
  // shown on her page: the private one by label, the brand booking as a team night, no guest photos
  await req("PUT", "/api/me/places/settings", { showOnProfile: true }, gia); P().bust();
  const V = await get(`/api/public/places/gia-places?year=${Y}`, stan), raw = JSON.stringify(V);
  assert.equal(V.on, true); for (const bad of ["SECRET", "Milton", "apartment", "Apt", "plPriv", "abc123", "Team pottery night"]) assert.ok(!raw.includes(bad), "never shows " + bad);
  const priv = V.places.find((p) => p.title === "A dinner in Bushwick"); assert.ok(priv); assert.equal(priv.point, null); assert.equal(priv.host, null); assert.equal(priv.photo, null); assert.equal(priv.url, "");
  assert.ok(V.places.some((p) => p.title === "A team workshop in Greenpoint"), "a brand booking is a private team night");
  assert.ok(V.places.some((p) => p.title === "Dumpling night" && p.url === "/e/plPub"), "a public event keeps its title and link");
  assert.ok(!V.places.some((p) => p.photo && p.photo.from === "mine"), "no photos people took");
});

test("visibility: off for others by default, always on for you; hide one event; blocks both ways", async () => {
  await req("PUT", "/api/me/places/settings", { showOnProfile: false }, gia); P().bust();
  const S0 = await get("/api/me/places/settings", fay); assert.equal(S0.showOnProfile, false); assert.equal(S0.friendsSee, false, "both off by default");
  assert.equal((await get(`/api/public/places/gia-places?year=${Y}`, stan)).on, false, "off for others until turned on");
  assert.equal((await get(`/api/public/places/gia-places?year=${Y}`)).on, false, "signed out too");
  const own = await get(`/api/public/places/gia-places?year=${Y}`, gia); assert.equal(own.on, true); assert.equal(own.own, true, "you always see yours");
  await req("PUT", "/api/me/places/settings", { showOnProfile: true }, gia);
  assert.equal((await req("PUT", "/api/me/places/hide", { eventId: "plPub", hidden: true }, gia)).status, 200); P().bust();
  const V = await get(`/api/public/places/gia-places?year=${Y}`, stan); assert.ok(!V.places.some((p) => p.title === "Dumpling night"), "a hidden event leaves the page");
  assert.ok((await get(`/api/me/places?year=${Y}`, gia)).places.find((p) => p.id === "plPub").hidden, "and stays in your own list, marked");
  assert.equal((await req("PUT", "/api/me/places/hide", { eventId: "plNotMine" }, gia)).status, 404);
  await req("PUT", "/api/me/places/hide", { eventId: "plPub", hidden: false }, gia);
  makeSafety(srv.store).block(GIA, { kind: "person", key: keyOf(BO) }); P().bust();
  assert.equal((await get(`/api/public/places/gia-places?year=${Y}`, bo)).on, false, "someone she blocked sees nothing");
  makeSafety(srv.store).block(STAN, { kind: "host", handle: "gia-places" });
  assert.equal((await get(`/api/public/places/gia-places?year=${Y}`, stan)).on, false, "nor someone who blocked her");
  makeSafety(srv.store).unblock(STAN, "host:gia-places");
});

test("places from people you know: friends both ways who opted in, public or neighbourhood only, and blocks", async () => {
  X().addFriend(FAY, GIA); P().bust();
  assert.equal((await get("/api/me/places/friends", fay)).places.length, 0, "one-way friends see nothing");
  X().addFriend(GIA, FAY); P().bust();
  assert.equal((await get("/api/me/places/friends", fay)).places.length, 0, "not until Gia lets friends see");
  await req("PUT", "/api/me/places/settings", { friendsSee: true }, gia); P().bust();
  const F = await get("/api/me/places/friends", fay), raw = JSON.stringify(F);
  assert.ok(F.places.length >= 5); assert.deepEqual(F.friends.map((f) => f.first), ["Gia"]);
  for (const bad of ["SECRET", "Milton", "apartment", "plPriv", "Team pottery night", GIA]) assert.ok(!raw.includes(bad), "never shows " + bad);
  const pub = F.places.find((p) => p.title === "Dumpling night"); assert.match(pub.line, /^Gia went here in [A-Z][a-z]+$/); assert.equal(pub.url, "/e/plPub");
  assert.ok(F.places.filter((p) => !p.public).every((p) => p.point === null && p.url === "" && /^A (team )?[a-z ]+ (in|with) /.test(p.title)));
  assert.equal((await get("/api/me/places/friends", stan)).places.length, 0, "not a friend: nothing");
  await req("PUT", "/api/me/places/hide", { eventId: "plPub", hidden: true }, gia); P().bust();
  assert.ok(!(await get("/api/me/places/friends", fay)).places.some((p) => p.title === "Dumpling night"), "a hidden event leaves friends' layer");
  await req("PUT", "/api/me/places/hide", { eventId: "plPub", hidden: false }, gia);
  makeSafety(srv.store).block(FAY, { kind: "person", key: keyOf(GIA) }); P().bust();
  assert.equal((await get("/api/me/places/friends", fay)).places.length, 0, "a block ends it");
  makeSafety(srv.store).unblock(FAY, "person:" + keyOf(GIA)); P().bust();
});

// ---------------------------------------------------------------- the story and its cards
test("the year in nights: the cards, true counts, and only allowed words on every card", async () => {
  const S = await get(`/api/me/year/${Y}`, gia), ids = S.cards.map((c) => c.id);
  assert.equal(ids[0], "intro"); assert.equal(ids[ids.length - 1], "summary"); assert.ok(ids.length >= 6 && ids.length <= 10, "about eight cards: " + ids);
  for (const id of ["hoods", "kind", "photo", "firsts", "quote"]) assert.ok(ids.includes(id), id);
  const nights = (await get(`/api/me/places?year=${Y}`, gia)).counts.nights; assert.equal(S.numbers.nights, nights); assert.equal(S.cards[0].spec.title, `${nights} nights`);
  assert.deepEqual(S.editions, ["guest", "host"], "she hosted, so there's a host edition");
  const words = S.cards.flatMap((c) => textOf(c.spec)).join(" | ");
  for (const bad of ["SECRET", "Milton", "apartment", "Apt 3", "Stan", "Fay", "555", "Ned", "Team pottery night", "@"]) assert.ok(!words.includes(bad), "no " + bad + " on a card: " + words);
  for (const c of S.cards) { assert.ok(!JSON.stringify(c.spec).includes("/_blob/"), "no photos on a share card"); assert.ok(!/\u2014/.test(textOf(c.spec).join(" ")), "no em dashes"); }
  // the quote: Fay's words about Gia's tea, scrubbed; Fay isn't named (she hasn't opted in)
  const q = S.cards.find((c) => c.id === "quote").spec.quote; assert.match(q.text, /made it easy/); assert.match(q.by, /^A guest at Slow tea morning$/);
  assert.equal(scrubQuote("Thanks Stan! Mail me at a@b.co", ["Stan Stranger"]), "Thanks …! Mail me at …");
  // Customize: one kind of night
  const T = await get(`/api/me/year/${Y}?type=supper`, gia); assert.ok(T.cards.find((c) => c.id === "summary").spec.kicker.includes("supper clubs")); assert.ok(T.numbers.nights < nights && T.numbers.nights >= 1);
  // the host edition: counts only
  const H = await get(`/api/me/year/${Y}?edition=host`, gia); assert.equal(H.numbers.hosted, 1); assert.equal(H.numbers.guests, 2); assert.equal(H.numbers.kudos, 1);
  const hw = H.cards.flatMap((c) => textOf(c.spec)).join(" | "); for (const bad of ["Stan", "Fay", "555"]) assert.ok(!hw.includes(bad), bad);
  // once Fay is a friend both ways and opts in, her first name may sign the quote
  await req("PUT", "/api/me/places/settings", { friendsSee: true }, fay); P().bust();
  assert.match((await get(`/api/me/year/${Y}`, gia)).cards.find((c) => c.id === "quote").spec.quote.by, /^Fay, after Slow tea morning$/);
  await req("PUT", "/api/me/places/settings", { friendsSee: false }, fay); P().bust();
  // a guest with no nights: one kind card, no zeros
  const E = await get(`/api/me/year/${Y}`, stan); assert.ok(E.cards.length >= 1);
});

test("the PNGs: the right sizes, from the same spec, private to you unless you share a link", async () => {
  const r = await fetch(srv.base + `/api/me/year/${Y}/card/summary.png`, { headers: { cookie: gia } }); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
  assert.deepEqual(pngSize(Buffer.from(await r.arrayBuffer())), { w: 1080, h: 1920 });
  const l = await fetch(srv.base + `/api/me/year/${Y}/card/intro.png?size=link`, { headers: { cookie: gia } }); assert.deepEqual(pngSize(Buffer.from(await l.arrayBuffer())), { w: 1200, h: 630 });
  assert.equal((await fetch(srv.base + `/api/me/year/${Y}/card/intro.png`)).status, 401); assert.equal((await fetch(srv.base + `/api/me/year/${Y}/card/nope.png`, { headers: { cookie: gia } })).status, 404);
  // the public link: off until turned on; the page has a preview; its cards say the same allowed words
  const sh = await (await req("PUT", `/api/me/year/${Y}/share`, { on: true }, gia)).json(); assert.match(sh.url, /^\/y\/[A-Za-z0-9_-]{16,40}$/);
  const page = await fetch(srv.base + sh.url); assert.equal(page.status, 200); const html = await page.text();
  assert.match(html, /property="og:image" content="\/y\/[^"]+\/summary\.png\?size=link"/); assert.match(html, /\/yearreview\.js/); assert.match(read("public/yearreview.js"), /Make your own/);
  const pub = await get("/api/public/year/" + sh.url.slice(3)), words = pub.cards.flatMap((c) => textOf(c.spec)).join(" ");
  for (const bad of ["SECRET", "Milton", "Stan", "Fay", GIA]) assert.ok(!words.includes(bad), bad); assert.ok(!JSON.stringify(pub).includes("/_blob/"));
  const og = await fetch(srv.base + sh.url + "/summary.png?size=link"); assert.deepEqual(pngSize(Buffer.from(await og.arrayBuffer())), { w: 1200, h: 630 });
  await req("PUT", `/api/me/year/${Y}/share`, { on: false }, gia);
  assert.equal((await fetch(srv.base + sh.url)).status, 404, "turned off: the link is gone"); assert.equal((await fetch(srv.base + "/api/public/year/" + sh.url.slice(3))).status, 404);
  assert.equal((await fetch(srv.base + `/year/${Y}`)).status, 200); assert.equal((await fetch(srv.base + "/year/abcd")).status, 404);
});

test("prompts: a calm card in December and at a milestone, nothing otherwise", async () => {
  const p = await get("/api/me/places/prompt", gia); const dec = day(0).slice(5, 7) === "12";
  if (dec) { assert.equal(p.kind, "december"); assert.match(p.title, /^Your \d{4} in nights is ready$/); } else assert.ok(!p.show || p.kind === "milestone");
  assert.equal((await get("/api/me/places/prompt")).show, false, "signed out: nothing");
  const D = (await import("../server/places.js")).makePlaces({ store: srv.store, C: { profileOf: () => null, wsOfHandle: () => null }, X: X(), now: () => Date.parse(`${Y}-12-03T12:00:00Z`) });
  const q = D.prompt(GIA); assert.equal(q.kind, "december"); assert.equal(q.link, `/year/${Y}`); assert.ok(!/\u2014|!/.test(q.title + q.line));
});

test("calm motion and keyboard: the story respects reduced motion, and taps, swipes and keys all work", () => {
  const js = read("public/yearreview.js"), cards = read("public/sharecards.js"), places = read("public/places.js");
  assert.match(js, /prefers-reduced-motion: reduce/); assert.match(js, /ArrowRight/); assert.match(js, /ArrowLeft/); assert.match(js, /Escape/); assert.match(js, /touchstart|pointerdown/);
  assert.match(js + cards, /@media \(prefers-reduced-motion: reduce\)/);
  for (const [f, src] of [["yearreview", js], ["sharecards", cards], ["places", places], ["server/places", read("server/places.js")], ["year.html", read("public/year.html")]]) assert.ok(!/\u2014/.test(src), "no em dashes in " + f);
  // the story's cards come from the spec, so the page shows what the PNG carries
  const box = { window: {}, document: undefined }; box.window = box; new Function("window", cards)(box); const H = box.PLShareCards.html({ kicker: "K", title: "23 nights", sub: "in 6 neighbourhoods", body: "<b>x</b>" });
  assert.match(H, /23 nights/); assert.ok(!H.includes("<b>x</b>"), "escaped");
});

test("the renderer: sizes, a reusable spec for other content, and the words it draws are the spec's", () => {
  const wish = { kicker: "Your 2027 hosting wishlist", title: "Three nights to host", list: [{ k: "1", v: "A dumpling night" }, { k: "2", v: "A slow tea morning" }], art: "tea", potto: "think", tone: "mint" };
  const a = renderCard(wish, "story"), b = renderCard(wish, "link"); assert.deepEqual(pngSize(a), SIZES.story); assert.deepEqual(pngSize(b), SIZES.link);
  const img = decodePng(b); assert.equal(img.w, 1200); assert.equal(img.d.length, 1200 * 630 * 4);
  assert.deepEqual(textOf(wish), ["Your 2027 hosting wishlist", "Three nights to host", "1", "A dumpling night", "2", "A slow tea morning", "pottery lab"]);
  const m = mapOf([{ key: "a", lat: 40.72, lng: -73.95, n: 3, label: "Greenpoint" }, { key: "b", lat: 40.69, lng: -73.92, n: 1, label: "Bushwick" }], "New York");
  assert.ok(m.areas.every((x) => x.x >= 0 && x.x <= 1 && x.y >= 0 && x.y <= 1)); assert.deepEqual(m, mapOf([{ key: "a", lat: 40.72, lng: -73.95, n: 3, label: "Greenpoint" }, { key: "b", lat: 40.69, lng: -73.92, n: 1, label: "Bushwick" }], "New York"), "the same drawing every time");
});
