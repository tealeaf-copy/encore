// Feed and Discover render checks that need no browser (scripts/feed-discover-audit.mjs drives the real pages): the
// feed's card renderer run in a sandbox on one card of each kind, a drop on the feed, Discover and the map, and the
// source rules that once broke a tap (two functions with one name; a script loaded twice that never called back).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { startServer } from "./helpers.js";
import { resetLoginLimits } from "../server/auth.js";
import { tierOf } from "../server/map.js";

const read = (p) => fs.readFileSync(new URL("../public/" + p, import.meta.url), "utf8");
function feedVisual() {
  const win = { addEventListener() {}, matchMedia: () => ({ matches: false }) }, doc = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { classList: { contains: () => false } }, cookie: "" };
  const ctx = vm.createContext({ window: win, document: doc, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, matchMedia: win.matchMedia, location: { pathname: "/feed", search: "", origin: "" }, navigator: {}, console, setTimeout, clearTimeout, URLSearchParams, CSS: { escape: (s) => s } });
  vm.runInContext(read("feedvisual.js"), ctx); return ctx.window.FeedVisual;
}
const host = { handle: "crumb", name: "Crumb Theory", color: "#E26D8E" };
const K = (t, n = 0) => ({ target: t, count: n, mine: false, names: [] });

test("Feed source: no function is declared twice in one scope (a recap story drew the feed's recap card and crashed)", () => {
  for (const f of ["feedvisual.js", "swipedeck.js", "feedcomments.js", "save.js", "composer.js", "place.js"]) {
    const names = [...read(f).matchAll(/^ {2}(?:async )?function ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]), dup = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dup, [], `${f} declares ${dup.join(", ")} twice`);
  }
  // Swipe ideas works after the first-visit deck already loaded swipedeck.js
  assert.match(read("feedvisual.js"), /need\("\/swipedeck\.js", \(\) => window\.PLDeck\?\.open\(\{\}\), "PLDeck"\)/);
});

test("Feed cards: each kind has its one main action, and only the avatar or name opens the host page", () => {
  const FV = feedVisual();
  const items = [
    { kind: "event", key: "e:a", id: "a", host, title: "Rye supper", line: "Bread for twelve.", date: "2030-01-05", startTime: "19:00", where: "Fort Greene", free: true, cta: { label: "I'm in", url: "/e/a" }, share: { url: "/e/a", title: "Rye supper" }, kudos: K("e:a", 2), comments: { count: 0 } },
    { kind: "event", key: "e:d", id: "d", host, title: "Chili crisp", drop: true, price: "From $12", free: false, date: "", cta: { label: "Order", url: "/e/d" }, kudos: K("e:d") },
    { kind: "recap", key: "r:p", id: "p", host, title: "Autumn supper", date: "2030-01-01", where: "Fort Greene", stats: ["8 went"], photos: [{ url: "/_blob/aaaaaaaaaaaaaaaaaaaa" }, { url: "/_blob/bbbbbbbbbbbbbbbbbbbb" }], share: { url: "/e/p", title: "Autumn supper" }, kudos: K("r:p", 1) },
    { kind: "milestone", key: "m:1", host, n: 10, type: "hosted", text: "Crumb Theory hosted their 10th supper", kudos: K("m:1") },
    { kind: "follow", title: "Hosts and people to follow", cards: [{ type: "host", handle: "crumb", name: "Crumb Theory", reason: "Hosts in Fort Greene", url: "/@crumb" }, { type: "person", key: "a2V5", name: "Maya", reason: "2 friends follow", url: "/h/maya" }] },
    { kind: "ideas", titles: ["Hack night", "Soup swap", "Board games"], count: 5 },
  ];
  const html = FV.blendHtml({ items }, { signedIn: true });
  const cards = html.split(/(?=<(?:article|section) class="fb-card)/).slice(1), of = (k) => cards.filter((c) => c.includes(`data-kind="${k}"`));
  // event: one full-width button to the event's own page; the drop's says Order and its price, never Free
  for (const c of of("event")) { assert.match(c, /<a class="fb-cta" data-fv-in href="\/e\/[ad]">/); assert.match(c, /class="fb-host" href="\/@crumb"/); }
  assert.match(of("event")[1], />Order<\/a>/); assert.match(of("event")[1], /From \$12/); assert.ok(!/Free/.test(of("event")[1]), "a drop is never Free");
  // the host page only from the avatar or the name: no other link on any card goes to /@
  for (const c of cards) for (const m of c.matchAll(/<a ([^>]*)href="\/@[^"]*"/g)) assert.match(m[1], /class="(fb-host|fb-fc-a)"/, "a host link outside the avatar or name: " + m[0]);
  assert.match(of("recap")[0], /data-fb-kudos="r:p"/); assert.match(of("recap")[0], /data-fv-open="fb:p"/);
  assert.match(of("milestone")[0], /data-fb-kudos="m:1"[^>]*>[\s\S]*?Send kudos/);
  // follow in place: real buttons (not links), with a Not for me on each
  const f = of("follow")[0]; assert.match(f, /<button type="button" class="fb-fbtn" data-fb-follow="crumb"/); assert.match(f, /<button type="button" class="fb-fbtn" data-fb-friend="a2V5"/); assert.equal((f.match(/data-fb-dismiss=/g) || []).length, 2);
  assert.match(of("ideas")[0], /data-fb-deck/);
  // chrome: no emoji in any button label
  for (const m of html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) assert.ok(!/\p{Extended_Pictographic}/u.test(m[1].replace(/<svg[\s\S]*?<\/svg>/g, "")), "emoji in a button: " + m[1].slice(0, 60));
});

test("Copy on the feed and Discover: no em dashes", () => {
  for (const f of ["feed.html", "feedvisual.js", "discover.html", "swipedeck.js", "map.html"]) assert.ok(!/—/.test(read(f)), `${f} has an em dash`);
});

test("Discover: a drop card says Order ahead, its price and Order, and opens the drop", () => {
  const d = read("discover.html");
  assert.match(d, /drop \? "Order ahead"/); assert.match(d, /drop \? "Order any time" : "Date coming soon"/); assert.match(d, /\$\{drop \? "Order" : "See the event"\}<\/a>/);
  assert.match(d, /url = drop \? `\/e\/\$\{encodeURIComponent\(e\.id\)\}`/);
});

test("Map: a drop's price tier comes from its items", () => {
  assert.equal(tierOf({ preorder: true, drop: true, price: "", orderItems: [{ price: 12 }, { price: 24 }] }), "$");
  assert.equal(tierOf({ preorder: true, orderItems: [{ price: 45 }] }), "$$");
  assert.equal(tierOf({ price: "" }), "free");
});

let srv;
before(async () => { Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: "fdr-secret", ENCORE_SIGNUP_PER_HOUR: "200", ENCORE_FAKE_EMAIL: "1" }); resetLoginLimits(); srv = await startServer(); });
after(async () => { await srv?.close(); });

test("Feed: an always-open drop is on the feed with Order and its price", async () => {
  const J = { "content-type": "application/json" }, post = (p, b, cookie) => fetch(srv.base + p, { method: "POST", headers: { ...J, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b) });
  const join = async (name, email) => { const r = await post("/api/signup", { name, email, password: "long-password-1", mode: "friends" }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };
  const h = await join("Bo Tran", "bo.fdr@example.com"), g = await join("Lan Vo", "lan.fdr@example.com");
  assert.ok((await post("/api/host/profile", { handle: "bo-fdr", name: "Bo's Bakes", city: "New York", hood: "Midtown", tagline: "Pandan everything", emoji: "🍰" }, h)).ok);
  const d = await (await post("/api/host/drops", { title: "Pandan any day", items: [{ name: "Pandan cake", price: "18" }, { name: "Kaya toast", price: "9.50" }], slots: ["Sat 9 to 10am"], area: "Midtown", address: "777 6th Ave", always: true, pay: "pickup" }, h)).json();
  assert.ok(d.id, JSON.stringify(d));
  srv.app.locals.social?.bust?.();
  const F = await (await fetch(srv.base + "/api/me/feed", { headers: { cookie: g } })).json(), card = (F.blend?.items || []).find((i) => i.kind === "event" && i.id === d.id);
  assert.ok(card, "the drop is on the feed"); assert.equal(card.cta.label, "Order"); assert.equal(card.price, "From $9.50"); assert.equal(card.free, false); assert.equal(card.drop, true);
});
