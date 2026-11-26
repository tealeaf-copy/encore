// Review round 11: a pre-order's cap counts what's ordered and closes on its order-by date; pairs and groups read as
// such for guests ("6 pairs", "3 pairs left") and book whole; the directory's price line for groups and pre-orders;
// /api/v1 checks its filters; picks carried per account; pickup sheets by window; copy fixes; and the host review's
// follow-ups (an order shown again after a reload, the order-by day from the pickup date, price lines on cards).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { scopeStore } from "../server/workspaces.js";
import { publicEvent } from "../server/app.js";
import { priceOf, mcpArgsError } from "../server/directory.js";
import { heldOf, seatsOf, partyMax } from "../server/social.js";
import { ordersClosed, todayIn } from "../server/tz.js";
import { cleanLook, LOOK } from "../server/looks.js";

let srv, host, ws;
const J = { "Content-Type": "application/json" };
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = (path, body, h = {}) => fetch(srv.base + path, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const put = (id, d, cookie = host) => fetch(srv.base + "/api/db/doc?path=events/" + id, { method: "PUT", headers: { ...J, cookie }, body: JSON.stringify(d) });
const guestHdr = (key) => ({ "x-encore-guest": "1", "x-encore-key": key, "x-encore-workspace": ws });
const reply = (body, key = "r11-key-" + Math.random().toString(36).slice(2)) => post("/api/db/collection?path=rsvps", { response: "going", createdAt: Date.now(), ...body }, guestHdr(key));
const ENV = { ENCORE_SIGNUP: "1", SESSION_SECRET: "r11-secret", ENCORE_FAKE_EMAIL: "1", ENCORE_SIGNUP_PER_HOUR: "100", ENCORE_DIRECTORY_CACHE_MS: "0" };
// public/spots.js, as the pages run it
const S = (() => { const box = { window: {} }; vm.runInNewContext(read("public/spots.js"), box); return box.window.EncoreSpots; })();

before(async () => {
  Object.assign(process.env, ENV); resetLoginLimits(); srv = await startServer();
  const r = await post("/api/signup", { name: "Ana Ruiz", email: "ana.r11@example.com", password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200);
  host = r.headers.get("set-cookie").split(";")[0];
  assert.ok((await post("/api/host/profile", { name: "Ana Ruiz", city: "Brooklyn", hood: "Park Slope", handle: "loaves-r11", emoji: "🍞", tagline: "Bread for the block." }, { cookie: host })).ok);
  ws = srv.store.get("system/handle-loaves-r11").data.ws;
});
after(async () => { for (const k of Object.keys(ENV)) delete process.env[k]; await srv.close(); });

test("1. a pre-order's cap counts items, not replies; a reply past it hears how many are left", async () => {
  assert.ok((await put("r11Loaves", { kind: "social", casual: true, name: "Sourdough pre-orders", date: day(10), startTime: "10:00", city: "Brooklyn", published: true, preorder: true, headcount: 20, orderItems: [{ name: "Country loaf", price: 12 }, { name: "Focaccia", price: 9 }] })).ok);
  let r = await reply({ eventId: "r11Loaves", name: "L1", email: "l1.r11@example.com", orderQty: [{ i: 0, qty: 10 }, { i: 1, qty: 5 }] }); assert.equal(r.status, 200);
  r = await reply({ eventId: "r11Loaves", name: "L2", email: "l2.r11@example.com", orderQty: [{ i: 0, qty: 6 }] }); assert.equal(r.status, 409);
  const j = await r.json(); assert.equal(j.code, "sold_out"); assert.equal(j.message, "Only 5 left. Pick fewer."); assert.equal(j.left, 5);
  r = await reply({ eventId: "r11Loaves", name: "L3", email: "l3.r11@example.com", orderQty: [{ i: 1, qty: 5 }] }); assert.equal(r.status, 200, "exactly the 5 left fits");
  r = await reply({ eventId: "r11Loaves", name: "L4", email: "l4.r11@example.com", orderQty: [{ i: 0, qty: 1 }] }); assert.equal(r.status, 409); assert.match((await r.json()).message, /Sold out/);
  const going = scopeStore(srv.store, ws).list("rsvps").filter((d) => d.data.eventId === "r11Loaves" && d.data.response === "going"); assert.equal(going.length, 2, "never on a waitlist");
  assert.equal(heldOf({ orderLines: [{ qty: 2 }, { qty: 3 }] }, { preorder: true }), 5); assert.equal(heldOf({ party: 2 }, {}), 2);
});

test("2. order-by: public on the invite, Order by Thu shown, and 409 Orders closed once the day has passed where it is", async () => {
  const pe = publicEvent({ name: "x", preorder: true, orderBy: "Thursday", orderByDate: "2026-12-10", orderDeadline: "by Thursday", headUnit: "pairs", unitCount: 6, groupCount: 3, stockUnit: "loaves" });
  for (const k of ["orderBy", "orderByDate", "orderDeadline", "headUnit", "unitCount", "groupCount", "stockUnit"]) assert.ok(k in pe, k);
  assert.equal(S.orderByText({ preorder: true, orderBy: "Thursday", orderByDate: "2026-12-10" }), "Order by Thu, Dec 10");
  assert.equal(S.orderByText({ preorder: true, orderBy: "Thursday" }), "Order by Thu");
  assert.equal(S.orderByText({ orderBy: "Thursday" }), "", "only pre-orders");
  assert.match(read("index.html"), /gx-orderby"><small>Orders<\/small><b>\$\{esc\(orderByText\(e\)\)\}/);
  assert.match(read("public/invite.html"), /id="orderBy">\$\{G\.cal\}\$\{esc\(orderBy\)\}/); assert.match(read("public/invite-order.js"), /id="ordBy"/);
  // 11:30pm Dec 10 in New York is still Dec 10 there (Dec 11 in UTC)
  const late = Date.parse("2026-12-11T04:30:00Z");
  assert.equal(todayIn("America/New_York", late), "2026-12-10"); assert.equal(ordersClosed({ preorder: true, orderByDate: "2026-12-10", tz: "America/New_York" }, late), false);
  assert.equal(ordersClosed({ preorder: true, orderByDate: "2026-12-10", city: "Brooklyn" }, Date.parse("2026-12-11T15:00:00Z")), true);
  assert.ok((await put("r11Closed", { kind: "social", casual: true, name: "Pie pre-orders", date: day(3), city: "Brooklyn", tz: "America/New_York", published: true, preorder: true, orderBy: "Monday", orderByDate: day(-2), orderItems: [{ name: "Apple", price: 28 }] })).ok);
  const r = await reply({ eventId: "r11Closed", name: "Late", email: "late.r11@example.com", orderQty: [{ i: 0, qty: 1 }] });
  assert.equal(r.status, 409); const j = await r.json(); assert.equal(j.code, "orders_closed"); assert.match(j.message, /^Orders closed\./);
});

test("3. pairs and groups: one helper says 6 pairs / 3 pairs left everywhere, and the card carries the unit", async () => {
  const pairs = { headcount: 12, headUnit: "pairs", unitCount: 6, groupSize: 2 }, groups = { headcount: 12, headUnit: "groups", groupCount: 3, unitCount: 3, groupSize: 4 };
  assert.equal(S.spotsText(pairs), "6 pairs"); assert.equal(S.spotsText(pairs, 7), "3 pairs left"); assert.equal(S.spotsText(pairs, 2), "1 pair left");
  assert.equal(S.spotsText(groups), "3 groups"); assert.equal(S.spotsText(groups, 8), "2 groups left"); assert.equal(S.spotsText(groups, 3), "0 groups left");
  assert.equal(S.spotsText({ headcount: 12 }), "12 spots"); assert.equal(S.spotsText({ headcount: 12 }, 1), "1 spot left");
  assert.equal(S.spotsText({ preorder: true, headcount: 20, stockUnit: "loaves" }), "20 loaves"); assert.equal(S.spotsText({ preorder: true, headcount: 20, stockUnit: "loaves" }, 1), "1 loaf left");
  const app = read("index.html");
  assert.match(app, /<b>\$\{esc\(spotsText\(e\)\)\}<\/b><\/span>/, "/g Size fact"); assert.match(app, /gb\.textContent=left\?spotsText\(e,left\)/); assert.match(app, /` · \$\{esc\(spotsText\(e,left\)\)\}`/);
  assert.match(app, /<small>\$\{R\?esc\(spotsText\(e,R\)\)/, "the phone booking bar");
  assert.match(read("public/invite.html"), /SP\.spotsText\(e, n\)/); assert.match(read("public/storefront.js"), /EncoreSpots\.spotsText\(e\)/);
  for (const f of ["index.html", "public/invite.html", "public/host.html"]) assert.match(read(f), /<script src="\/spots\.js"><\/script>/, f);
  assert.ok((await put("r11Matcha", { kind: "social", casual: true, name: "Couples matcha", date: day(8), city: "Brooklyn", published: true, discoverable: true, price: "$60", groupPrice: 60, groupSize: 2, headcount: 12, headUnit: "pairs", unitCount: 6 })).ok);
  const pg = await (await fetch(srv.base + "/api/public/host/loaves-r11")).json(), c = pg.upcoming.find((x) => x.id === "r11Matcha");
  assert.ok(c, "on the page"); assert.equal(c.headUnit, "pairs"); assert.equal(c.unitCount, 6); assert.equal(c.priceLine, "$60 for 2");
});

test("4 and 7. the directory: $60 for 2, from $3 each, a pre-order record, no per-person offer for a group", async () => {
  assert.equal(priceOf({ price: "$60", groupPrice: 60, groupSize: 2 }), "$60 for 2"); assert.equal(priceOf({ price: "$120", groupPrice: 120, groupSize: 4 }), "$120 for 4");
  assert.equal(priceOf({ price: "$3", preorder: true, orderItems: [{ name: "Plain", price: 3 }, { name: "Dozen", price: 30 }] }), "from $3 each");
  assert.equal(priceOf({ price: "$4.50", preorder: true, orderItems: [{ name: "Plain", price: 4.5 }] }), "$4.50 each");
  assert.equal(priceOf({ price: "$40" }), "$40 a person");
  assert.ok((await put("r11Bagels", { kind: "social", casual: true, name: "Bagel drop", date: day(9), city: "Brooklyn", published: true, discoverable: true, preorder: true, price: "$3", headcount: 40, orderBy: "Thursday", orderItems: [{ name: "Everything bagel", price: 3 }, { name: "Dozen", price: 30 }] })).ok);
  assert.equal((await reply({ eventId: "r11Bagels", name: "B1", email: "b1.r11@example.com", orderQty: [{ i: 0, qty: 4 }, { i: 1, qty: 1 }] })).status, 200);
  const e = (await (await fetch(srv.base + "/api/v1/events/r11Bagels")).json()).data;
  assert.equal(e.preorder, true); assert.deepEqual(e.items, [{ name: "Everything bagel", price: 3 }, { name: "Dozen", price: 30 }]); assert.equal(e.order_by, "Thursday");
  assert.equal(e.price, "from $3 each"); assert.equal(e.spots_left, 35, "40 minus the 5 items ordered");
  const m = (await (await fetch(srv.base + "/api/v1/events/r11Matcha")).json()).data; assert.equal(m.price, "$60 for 2"); assert.equal(m.preorder, undefined);
  const html = await (await fetch(srv.base + "/events")).text().catch(() => "");
  if (/application\/ld\+json/.test(html)) assert.doesNotMatch(html, /"price":60,"priceCurrency"/, "no per-person offer for a pair");
  const llms = await (await fetch(srv.base + "/llms.txt")).text();
  assert.match(llms, /"\$60 for 2" \(a pair or a group books together/); assert.match(llms, /"from \$3 each"/); assert.match(llms, /preorder: true, items \[\{ name, price \}\]/);
});

test("5. a group booking: the reply holds the whole group (up to 50), no +1 picker, 1 pair · $60", async () => {
  assert.equal(partyMax({}), 2); assert.equal(partyMax({ plusOnes: 9 }), 6); assert.equal(partyMax({ groupSize: 8 }), 8); assert.equal(partyMax({ groupSize: 80 }), 50);
  assert.equal(seatsOf({ party: 8 }, { groupSize: 8 }), 8); assert.equal(seatsOf({ party: 8 }, {}), 2);
  assert.ok((await put("r11Tea", { kind: "social", casual: true, name: "Tea ceremony", date: day(7), city: "Brooklyn", published: true, price: "$120", groupPrice: 120, groupSize: 8, headcount: 24, headUnit: "groups", groupCount: 3, unitCount: 3 })).ok);
  const r = await reply({ eventId: "r11Tea", name: "T1", email: "t1.r11@example.com", party: 8, plusOne: true }); assert.equal(r.status, 200);
  const d = scopeStore(srv.store, ws).get("rsvps/" + String((await r.json()).id).split("/").pop()).data; assert.equal(d.party, 8);
  assert.equal(S.groupLine({ groupSize: 2, groupPrice: 60 }), "1 pair · $60"); assert.equal(S.groupLine({ groupSize: 4, groupPrice: 120, headUnit: "groups" }), "1 group of 4 · $120"); assert.equal(S.groupLine({}), "");
  const app = read("index.html");
  assert.match(app, /const GRP=Math\.min\(50,Math\.floor\(\+e\.groupSize\)\|\|0\);/); assert.match(app, /\$\{GRP>1\?`<p class="note g-group" id="g-group">/); assert.match(app, /party:GRP>1\?GRP:/);
  assert.match(read("public/invite.html"), /party: Math\.min\(50, Math\.floor\(\+e\.groupSize\)\)/);
});

test("6. /api/v1 checks its filters like the MCP tools: 400 invalid with a message", async () => {
  for (const q of ["/api/v1/events?from=tomorrow", "/api/v1/events?limit=-3", "/api/v1/events?status=soon", "/api/v1/events?include_examples=yes", "/api/v1/events.csv?to=2026-02-30", "/api/v1/hosts?limit=abc",
    "/api/v1/formats?status=soon", "/api/v1/reviews?limit=2.5", "/api/v1/leaderboard?period=week", "/api/v1/leaderboard?category=__proto__", "/api/v1/hosts/find?date=2026-02-31", "/api/v1/events?city=a&city=b"]) {
    const r = await fetch(srv.base + q); assert.equal(r.status, 400, q); const j = await r.json(); assert.equal(j.code, "invalid", q); assert.ok(j.message, q); }
  for (const q of ["/api/v1/events?include_examples=1", "/api/v1/events?limit=100&status=all", "/api/v1/hosts/find?budget=%245%2C000", "/api/v1/formats?status=upcoming"]) assert.equal((await fetch(srv.base + q)).status, 200, q);
  assert.equal(mcpArgsError({ budget: { type: "number" } }, { budget: "$5,000" }), "");
  assert.match(await (await fetch(srv.base + "/llms.txt")).text(), /A bad one is a 400 with \{ "code": "invalid", "message" \}/);
});

test("8 and 9. signup: the typed city wins and the carry is marked only once it saved; save.js marks it per account and clears the picks", () => {
  const su = read("public/signup.html"), sv = read("public/save.js");
  assert.match(su, /city: String\(body\.city \|\| pk\.city \|\| ""\)/); assert.match(su, /if \(ri\.ok\) \{ localStorage\.setItem\("pl\.interestsCarried:" \+/);
  assert.doesNotMatch(su, /localStorage\.setItem\("pl\.interestsCarried", "1"\)/);
  assert.match(sv, /fetch\("\/api\/me", \{ credentials: "same-origin" \}\)/); assert.match(sv, /const mark = "pl\.interestsCarried:" \+ em;/); assert.match(sv, /localStorage\.setItem\(mark, "1"\); localStorage\.removeItem\("pl\.interests"\);/);
  assert.doesNotMatch(sv, /getItem\("pl\.interestsCarried"\)/);
});

test("10. the pickup sheet groups orders by window however it was typed", () => {
  assert.equal(S.slotLabel("10:00–11:00"), "10am to 11am"); assert.equal(S.slotLabel("10am to 11am"), "10am to 11am"); assert.equal(S.slotLabel("10-11"), "10am to 11am");
  const js = read("public/storeshop.js"); assert.match(js, /const slots = \[\.\.\.new Set\(cur\.map\(slotOf\)\.filter\(Boolean\)\)\]/); assert.match(js, /cur\.filter\(\(o\) => slotOf\(o\) === sl\)/);
});

test("12. copy: link only, the pairs comment, no RSVP or Save my spot labels, the Discover note for a page that isn't ready", () => {
  assert.match(read("public/host.html"), /"It's link only"/); assert.doesNotMatch(read("public/host.html"), /: "Link only"\}/);
  const app = read("index.html"); assert.match(app, /"6 pairs" is 12 people \(headcount/); assert.doesNotMatch(app, /"6 pairs" is 6 pairs/);
  assert.deepEqual(LOOK.buttonLabels, ["I'm in", "Join", "Count me in", "Ask to join"]);
  const box = { window: { EncoreColor: {} } }; vm.runInNewContext(read("public/looks.js"), box); const L = box.window.EncoreLooks;
  assert.ok(!L.LABELS.includes("RSVP") && !L.LABELS.includes("Save my spot"));
  // events saved with them still render: the server reads them as I'm in, and the button falls back to I'm in
  assert.equal(cleanLook({ buttonLabel: "Save my spot" }).buttonLabel, "I'm in"); assert.equal(cleanLook({ buttonLabel: "RSVP" }).buttonLabel, "I'm in");
  assert.equal(L.buttonText({ look: { buttonLabel: "RSVP" } }), "I'm in");
  assert.match(read("public/nudges.js"), /It's on your page now\. Add \$\{esc\(p1And\(gaps\)\)\} so it shows on Discover too\./);
});

test("A. a pre-order guest who comes back sees their order and Pay, never a door code", () => {
  const inv = read("public/invite.html"), ord = read("public/invite-order.js");
  assert.match(inv, /else if \(e\.preorder && mine\?\.order && st && st\.response === "going"\) more\("\/invite-order\.js", \(\) => window\.InviteOrder\?\.ticket\?\./);
  assert.match(inv, /const doorCode = yes && !paid && !e\.preorder &&/); assert.match(inv, /e\.preorder && \(data\.order \|\| S\.order\) \? "Ordered"/);
  assert.match(ord, /window\.InviteOrder\.ticket = function \(e, ws, H, U, M, el\)/); assert.match(ord, /order: text, total, slot, wall: false/);
  assert.match(read("index.html"), /function doorCodeOn\(e\)\{ return !e\?\.preorder&&/);
  // the ticket draws from what this browser kept: items, total and the Pay button
  const doc = { el: null, querySelector: () => null, querySelectorAll: () => [] }, box = { window: {}, document: doc, location: { pathname: "/e/abc" } };
  vm.runInNewContext(ord, box); const el = { outerHTML: "" };
  box.window.InviteOrder.ticket({ id: "abc", ticketUrl: "https://venmo.com/u/ana", hostName: "Ana" }, "ws", {}, { esc: (s) => String(s), ls: { get: () => null }, payLinkOf: (u, amt) => `${u}?amount=${amt}` }, { rid: "r1", order: "2 × Country loaf · pickup 10am to 11am · $24", name: "Ben" }, el);
  assert.match(el.outerHTML, /<h2>Ordered<\/h2>/); assert.match(el.outerHTML, /2 × Country loaf/); assert.match(el.outerHTML, /Pay \$24/); assert.match(el.outerHTML, /id="oPaid" hidden>I paid/);
  assert.doesNotMatch(el.outerHTML, /door/i);
});

test("C, D, F, G. price lines on cards, the wizard and Potto's Done line, the plan check, Draft and asks first on Home", () => {
  const sf = read("public/storefront.js"); assert.doesNotMatch(sf, /\$\{esc\(e\.price\)\}<small> a person<\/small>/); assert.match(sf, /e\.priceLine && \(e\.priceLine !== "Free" \|\| !e\.costNote\)/);
  const app = read("index.html");
  assert.match(app, /<span>\$\{\+d\.headcount\?esc\(spotsText\(d\)\):"No limit on spots"\}/);
  assert.match(app, /\[d\.date\?fmtDate\(d\.date\):"",d\.startTime\?clock12\(d\.startTime\):"",\+d\.headcount\?spotsText\(d\):""/);
  assert.match(app, /t:`Add a way to pay the \$\{d\.price\}`/); assert.doesNotMatch(app, /Add how people pay \$\{/);
  assert.match(app, /\|orders\?\|pre-\?orders\?\|pickup\|pick-up\|cakes\?\|course\|lessons\?\|improv\|team\|crawl\)\\b/); assert.match(app, /\(jan\|feb\|mar\|apr\|may/);
  assert.match(app, /t\.length>60\?t\.slice\(0,60\)\.replace\(\/\\s\+\\S\*\$\/,""\)\+"…":t/); assert.doesNotMatch(app, /Want me to plan "\$\{t\.slice\(0,60\)\}"/);
  assert.match(app, /<span class="fc-draft">Draft<\/span>/); assert.match(app, /\/asked to join\|asking to join\|new repl\|replied\/i/); assert.match(app, /if\(pl\) pl\.before\(box\)/);
});

test("no literal em dashes in the round 11 files", () => {
  for (const f of ["public/spots.js", "public/invite-order.js", "public/storeshop.js", "public/nudges.js", "public/save.js", "public/signup.html", "server/tz.js"]) assert.doesNotMatch(read(f), /—/, f);
});
