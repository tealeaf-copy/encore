// The event type tags (public/eventtypes.js, server/eventtypes.js): every kind the code knows maps to one type, drops
// are Pickup, unknown kinds fall back to a neutral "Event", every tag's colours pass AA for small text, colour is never
// the only signal (an icon and the word too), and the tag is on the feed, Discover, the map, Plans, host pages and the
// invite.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { typeOf, typeLabel, TYPES } from "../server/eventtypes.js";
import { PLAN_KINDS } from "../server/kinds.js";
import { CATS } from "../server/map.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const box = {}; vm.runInNewContext(read("public/eventtypes.js"), box); const T = box.EventTypes;
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("event types: about ten, each with a word, a plural, a line and an icon, and a neutral fallback", () => {
  assert.deepEqual([...TYPES], ["popup", "pickup", "party", "dinner", "class", "active", "games", "trip", "talk", "booking", "event"]);
  for (const k of TYPES) { assert.ok(T.LABEL[k] && T.PLURAL[k] && T.LINE[k], k); assert.match(T.ICON[k], /^M[\d.\s,a-zA-Z-]+$/, k + " has a line icon"); }
  const words = Object.values(T.LABEL).concat(Object.values(T.PLURAL), Object.values(T.LINE)).join(" ");
  assert.doesNotMatch(words, /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u, "no emoji"); assert.doesNotMatch(words, /\u2014/, "no em dashes");
  assert.equal(T.LABEL.popup, "Pop-up"); assert.equal(T.LABEL.pickup, "Pickup"); assert.equal(T.LABEL.party, "House party"); assert.equal(T.LABEL.event, "Event");
});

test("event types: every kind the code knows maps to exactly one type", () => {
  for (const [k, v] of Object.entries(T.KIND)) assert.ok(TYPES.includes(v), `${k} -> ${v}`);
  // "What are you planning?" on the server and on the canvas: each one is a real type, never the neutral one
  for (const k of PLAN_KINDS) { assert.ok(T.KIND[k], "server kind " + k); if (k !== "other") assert.notEqual(typeOf({ planKind: k }), "event", k); } // "Something else" stays the neutral Event
  const cv = read("public/canvas.js"), block = cv.slice(cv.indexOf("const PLAN_KINDS = ["), cv.indexOf("];", cv.indexOf("const PLAN_KINDS = [")));
  const canvasKinds = [...block.matchAll(/\{\s*k:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(canvasKinds.length >= 7, "found the canvas kinds");
  for (const k of canvasKinds) assert.ok(T.KIND[k] || T.KIND[k.replace(/[-_]/g, "")], `the canvas kind "${k}" is in EventTypes.KIND (public/eventtypes.js)`);
  // the drawings (public/eventart.js): every theme is known (some stay neutral on purpose)
  const ea = { document: { head: { appendChild() {} }, createElement: () => ({ style: {} }), getElementById: () => null, querySelector: () => null } }; ea.window = ea; vm.runInNewContext(read("public/eventart.js"), ea);
  for (const k of [...ea.window.EventArt.KINDS, ...Object.keys(ea.window.EventArt.LABEL)]) assert.ok(T.KIND[k], `the drawing "${k}" is in EventTypes.KIND`);
  // the map's old categories
  for (const c of CATS) assert.ok(TYPES.includes(T.CAT[c]) && T.CAT[c] !== "event", c);
  assert.equal(typeOf({ cat: "drop" }), "pickup"); assert.equal(typeOf({ cat: "market" }), "popup"); assert.equal(typeOf({ cat: "run" }), "active");
});

test("event types: drops are Pickup, a pop-up is not a pickup is not a house party", () => {
  assert.equal(typeOf({ drop: true, preorder: true, title: "Pandan cake" }), "pickup"); // a drop as server/drops.js saves it
  assert.equal(typeOf({ preorder: true, title: "Holiday cookie boxes" }), "pickup");
  assert.equal(typeOf({ planKind: "drop", title: "A tasting" }), "pickup", "what the host picked wins over words");
  assert.equal(typeOf({ title: "Pandan drop pickup" }), "pickup");
  assert.equal(typeOf({ title: "Matcha pop-up at the park" }), "popup"); assert.equal(typeOf({ title: "Saturday makers market" }), "popup"); assert.equal(typeOf({ title: "Natural wine tasting" }), "popup");
  assert.equal(typeOf({ title: "House party at Mia's" }), "party"); assert.equal(typeOf({ planKind: "party" }), "party");
  assert.equal(typeOf({ title: "Thursday supper club" }), "dinner"); assert.equal(typeOf({ reservation: { restaurant: "Lilia" } }), "dinner"); assert.equal(typeOf({ planKind: "table" }), "dinner");
  assert.equal(typeOf({ title: "Wheel throwing class" }), "class"); assert.equal(typeOf({ title: "Dumpling folding workshop" }), "class", "a class before a dinner");
  assert.equal(typeOf({ title: "Sunday run club" }), "active"); assert.equal(typeOf({ title: "Drop-in yoga" }), "active", "drop-in isn't a drop");
  assert.equal(typeOf({ title: "Hack night #14" }), "games"); assert.equal(typeOf({ planKind: "game" }), "games");
  assert.equal(typeOf({ planKind: "weekend" }), "trip"); assert.equal(typeOf({ lodging: { name: "The lake house" } }), "trip");
  assert.equal(typeOf({ kind: "summit" }), "talk"); assert.equal(typeOf({ agenda: { sessions: [{ id: "a" }] } }), "talk");
  assert.equal(typeOf({ bookingId: "b1", title: "Team pasta night" }), "booking"); assert.equal(typeOf({ forCompany: "Acme" }), "booking");
  assert.equal(typeOf({ etype: "popup", title: "Run club" }), "popup", "a key the server worked out is taken as is");
});

test("event types: unknown kinds fall back to a neutral Event", () => {
  for (const x of [{}, null, undefined, { planKind: "zeppelin" }, { title: "Coffee and chat" }, { etype: "nope" }, { coverArt: { kind: "zzz" } }]) assert.equal(typeOf(x), "event", JSON.stringify(x));
  assert.equal(typeLabel({}), "Event"); assert.equal(T.tag("nope").includes("pl-type--event"), true);
});

test("event types: every tag colour pair passes AA for small text, and the CSS and JS agree", () => {
  const css = read("public/system.css"), block = css.slice(css.indexOf("EVENT TYPE TAGS"), css.indexOf("end of event type tags"));
  const tok = Object.fromEntries([...block.matchAll(/--pl-type-([a-z]+)-(bg|fg):(#[0-9A-Fa-f]{6})/g)].map((m) => [`${m[1]}-${m[2]}`, m[3].toUpperCase()]));
  const bad = [];
  for (const k of TYPES) { const bg = tok[k + "-bg"], fg = tok[k + "-fg"]; assert.ok(bg && fg, "tokens for " + k);
    assert.deepEqual([bg, fg], Array.from(T.COLOR[k], (c) => c.toUpperCase()), k + ": eventtypes.js COLOR matches system.css");
    const r = ratio(fg, bg); if (r < 4.5) bad.push(`${k}: ${fg} on ${bg} is ${r.toFixed(2)}`);
    // the type colour as a chip's icon on the card surface, and the tint stays light (a quiet tint, not a block of colour)
    if (ratio(fg, "#FAF8F3") < 4.5) bad.push(`${k}: ${fg} on the card surface`); if (lum(bg) < 0.6) bad.push(`${k}: ${bg} is not a quiet tint`);
    assert.ok(css.includes(`.pl-type--${k}{--t-bg:var(--pl-type-${k}-bg);--t-fg:var(--pl-type-${k}-fg)}`), k + " class"); }
  assert.deepEqual(bad, []);
  // the text colours differ from each other, so two types never read as one
  const fgs = TYPES.map((k) => tok[k + "-fg"]); assert.equal(new Set(fgs).size, fgs.length);
  assert.match(block, /border-radius:6px/); assert.match(block, /var\(--pl-font-mono\)/);
});

test("event types: the tag carries an icon and the word, not only a colour", () => {
  const h = T.tag({ drop: true, title: "Pandan cake" });
  assert.match(h, /^<span class="pl-type pl-type--pickup" data-type="pickup"><svg class="pl-type__i"[^>]*aria-hidden="true"[^>]*><path d="[^"]+"\/><\/svg><span>Pickup<\/span><\/span>$/);
  assert.match(T.tag("popup", { cls: "pl-type--b" }), /class="pl-type pl-type--popup pl-type--b"/);
  assert.match(T.chip("party", true), /<button type="button" class="pl-type-chip pl-type--party" data-type="party" aria-pressed="true"><svg[^>]*>.*<span>House parties<\/span><\/button>/);
  assert.deepEqual([...T.present([{ drop: true }, { title: "Pop-up" }, { title: "Run club" }, {}])], ["popup", "pickup", "active", "event"]);
  assert.equal(T.tag({ title: "<b>party</b>" }).includes("<b>"), false);
});

test("event types: the tag is on the feed, Discover, the map, Plans, host pages, lists, chats and the invite", () => {
  const fv = read("public/feedvisual.js");
  assert.ok((fv.match(/window\.EventTypes\?\.tag\(e/g) || []).length >= 3, "feed: the flyer, the tile and the blended event card");
  assert.doesNotMatch(fv, /e\.drop \? "Drop"/, "the feed's ad-hoc Drop label is the tag now");
  const disc = read("public/discover.html"); assert.match(disc, /ET\.tag\(e/); assert.match(disc, /ET\.chip\(k, filter === k, "data-f"\)/, "Discover's filter chips are the types"); assert.match(disc, /ET\.typeOf\(e\) === filter/);
  const map = read("public/map.html"); assert.match(map, /ET\.chip\(k, S\.f\.cat === k, "data-cat"\)/, "the map's chips are the types"); assert.equal((map.match(/window\.EventTypes\.tag\(e/g) || []).length, 2, "the list row and the picked card");
  assert.match(read("public/mapcore.js"), /\(e\.etype \|\| e\.cat\) !== F\.cat/);
  assert.match(read("public/timeline.js"), /window\.EventTypes\.tag\(it\.etype/, "Plans");
  assert.match(read("public/community.js"), /window\.EventTypes\.tag\(e/, "the shared event card (host pages, Discover's host rows, Plans suggestions)");
  assert.match(read("public/storefront.js"), /window\.EventTypes\.tag\(e/, "the host page's Next up");
  assert.match(read("public/storeshop.js"), /window\.EventTypes\.tag\("booking"/, "a host's bookable experiences");
  assert.match(read("public/hostdir.html"), /window\.EventTypes\.tag\(n/, "the hosts list's next event");
  assert.match(read("public/collections.js"), /window\.EventTypes\.tag\(/); assert.match(read("public/library.html"), /window\.EventTypes\.tag\(/); assert.match(read("public/chat.js"), /window\.EventTypes\.tag\(c\.etype\)/);
  const inv = read("public/invite.html"); assert.match(inv, /EventTypes\.tag\(e, \{ cls: "pl-type--b" \}\)/, "the light invite's header"); assert.ok(inv.length < 40000, `invite.html stays small (${inv.length})`);
  assert.match(read("index.html"), /window\.EventTypes\.tag\(e, \{ cls: "pl-type--b gk-type" \}\)/, "the full invite at /g");
  for (const f of ["public/feed.html", "public/discover.html", "public/map.html", "public/hostdir.html", "public/host.html", "public/plans.html", "public/library.html", "public/collections.html", "public/chats.html", "public/invite.html", "index.html"])
    assert.match(read(f), /<script src="\/eventtypes\.js"><\/script>/, f + " loads the tag");
  // the server sends the key on its cards, worked out from the whole doc
  assert.match(read("server/community.js"), /etype: typeOf\(e\)/); assert.match(read("server/feedvisual.js"), /etype: typeOf\(e\)/); assert.match(read("server/map.js"), /etype: typeOf\(e\)/); assert.match(read("server/plans.js"), /etype: typeOf\(ev\)/); assert.match(read("server/app.js"), /e\.etype = typeOf\(data\)/);
});
