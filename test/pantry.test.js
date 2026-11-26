// Round 12 design: the Pantry look (a jar wall, a hex-tile floor, a slab title, AA text everywhere), the Harvest menu card,
// price tiers (cleaned on save, said on cards and in the agent API, picked by guests and summed for the pay amount),
// the sentence reader filling them, the Pantry stickers and host page cover.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cleanLook, LOOK, cleanTiers, tierLine, tierTotal, cleanPicks, withCleanLook } from "../server/looks.js";
import { priceOf } from "../server/directory.js";
import { STORE } from "../server/community.js";
import { resetLoginLimits } from "../server/auth.js";
import { startServer } from "./helpers.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
function browser() { const window = { devicePixelRatio: 1 }; const ctx = { window, console };
  for (const f of ["color.js", "looks.js", "storefront.js", "pantry.js", "tiers.js", "menucard.js"]) vm.runInNewContext(read("public/" + f), Object.assign(ctx, { document: undefined, localStorage: {} }));
  return { C: window.EncoreColor, LK: window.EncoreLooks, S: window.EncoreStore, P: window.EncorePantry, T: window.EncoreTiers, M: window.MenuCard }; }
const plain = (v) => JSON.parse(JSON.stringify(v));

test("cleanLook keeps the Pantry values (jar wall, slab title, harvest menu, pantry vibe, new emoji) and drops look-alikes", () => {
  assert.deepEqual(cleanLook({ effect: "jarwall", titleFont: "slab", menuStyle: "harvest", vibe: "pantry", buttonEmoji: "🍂" }), { effect: "jarwall", titleFont: "slab", buttonEmoji: "🍂", vibe: "pantry", menuStyle: "harvest" });
  assert.deepEqual(cleanLook({ effect: "jars", titleFont: "slabby", menuStyle: "<b>harvest</b>", vibe: "Pantry" }), {});
  const { LK } = browser();
  assert.deepEqual(plain(LK.EFFECTS.map(([k]) => k)), LOOK.effects); assert.deepEqual(plain(Object.keys(LK.FONTS)), LOOK.titleFonts.filter((k) => LK.FONTS[k]));
  assert.ok(LOOK.titleFonts.every((k) => LK.FONTS[k]), "the page has every font the server keeps"); assert.deepEqual(plain(LK.EMOJI), LOOK.buttonEmoji);
  assert.deepEqual(cleanLook(plain(LK.VIBES.pantry.look)), plain(LK.VIBES.pantry.look), "the Pantry vibe saves as it is");
  assert.ok(LK.has({ menuStyle: "harvest" }), "a harvest menu alone is a look");
});

test("Pantry: every text colour passes AA on its pages, the title on the page, the harvest card and the host page cover", () => {
  const { C, LK } = browser();
  for (const p of [LK.VIBES.pantry.look.palette, ...LK.MOODS.pantry.pal]) { const T = C.pageFrom(p[0], p.slice(1)); assert.ok(!T.dark, "a warm light page " + p[0]);
    for (const bg of [T.top, T.bot]) { assert.ok(C.contrast(T.ink, bg) >= 4.5, `ink on ${bg}`); assert.ok(C.contrast(T.soft, bg) >= 4.5, `soft on ${bg}`); assert.ok(C.contrast("#3B2414", bg) >= 4.5, `the slab title on ${bg}`);
      // the hex floor only ever lightens the page (white at 5% to 20%): dark text gets more contrast, never less
      assert.ok(C.contrast(T.soft, C.mix(bg, "#FFFFFF", 0.34)) >= C.contrast(T.soft, bg)); }
    assert.ok(C.contrast(T.btn, T.onBtn) >= 4.5, "button text " + p[0]); assert.ok(C.contrast(T.card, T.cardInk) >= 4.5, "card text"); }
  // the harvest card: title, dishes, labels, price line and note, on cream and on the tinted panel
  for (const [fg, bg] of [["#3B2414", "#FBF4E4"], ["#6B4E36", "#FBF4E4"], ["#2B1D12", "#F3E3C4"], ["#6B4E36", "#F3E3C4"], ["#8A3414", "#FBF4E4"]]) assert.ok(C.contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
  // the host page: the name on its cream label, white on the amber accent, the accent as text on cream
  assert.ok(C.contrast("#3B2414", "#FBF4E4") >= 7); assert.ok(C.contrast("#FFFFFF", "#8A4B0F") >= 4.5); assert.ok(C.contrast("#8A4B0F", "#FBF6EF") >= 4.5);
  // reduced motion: the glow is still, and the lights flicker at most gently
  const lk = read("public/looks.js"); assert.match(lk, /prefers-reduced-motion:reduce\)\{\.lk-jw::after,\.lk-jw \.pt-glow\{animation:none\}/); assert.match(read("public/storefront.js"), /prefers-reduced-motion:reduce\)\{\.cv-pt::after\{animation:none\}/);
});

test("the jar wall and hex floor are drawn here: jars with white lids in cubbies, the same shelf for the same seed", () => {
  const { P } = browser(); const a = P.jarWall(390, 200, 7), b = P.jarWall(390, 200, 7), c = P.jarWall(1280, 260, 8);
  assert.equal(a.replace(/jw\d+/g, ""), b.replace(/jw\d+/g, ""), "seeded"); assert.notEqual(a.replace(/jw\d+/g, ""), P.jarWall(390, 200, 9).replace(/jw\d+/g, ""));
  assert.match(a, /^<svg class="pt-wall" viewBox="0 0 390 200"/); assert.ok((c.match(/fill="#FBF8F1"/g) || []).length >= 30, "white lids, lots of jars on a wide wall");
  assert.ok(P.JARS.some(([x]) => /^#[4-8]/.test(x)) && P.JARS.length >= 6, "greens, golds and oranges"); assert.ok(!/<script|on\w+=/i.test(c));
  const H = P.hexTile(); assert.match(H.url, /^url\("data:image\/svg\+xml,/); assert.match(decodeURIComponent(H.url), /fill-opacity="0\.2"/, "a few white hexes"); assert.match(decodeURIComponent(H.url), /stroke-opacity="\.07"/, "faint grout");
});

test("price tiers are cleaned on save: four at most, labels up to 20 characters, a price above zero, no repeats or markup", () => {
  const T = cleanTiers([{ label: "Adults", price: "$55" }, { label: "Kids", price: 35 }, { label: "<b>VIP</b> guests and their plus ones", price: "120.505" }, { label: "kids", price: 10 }, { label: "Free", price: 0 }, { label: "", price: 9 }, "x", null, { label: "Seniors", price: "$40.5" }, { label: "Students", price: 20 }]);
  assert.deepEqual(T, [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }, { label: "b VIP /b guests and", price: 120.5 }, { label: "Seniors", price: 40.5 }]);
  assert.ok(T.every((t) => t.label.length <= 20 && !/[<>$]/.test(t.label)));
  assert.deepEqual(cleanTiers("Adults $55"), []); assert.deepEqual(cleanTiers([{ label: "A", price: 1e9 }]), [], "an absurd price is dropped");
  // on an event write, only the cleaned list is kept
  assert.deepEqual(withCleanLook({ name: "Supper", priceTiers: [{ label: "Adults", price: "$55", x: 1 }, { label: "Kids", price: "35" }] }).priceTiers, [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }]);
  assert.deepEqual(withCleanLook({ priceTiers: "nope" }).priceTiers, []);
  // the page cleans the same way the server does
  const { T: TT } = browser(); const raw = [{ label: " Members ", price: "$10" }, { label: "Guests", price: 15.999 }, { label: "members", price: 3 }, { label: "Kids<script>", price: 5 }];
  assert.deepEqual(plain(TT.clean(raw)), cleanTiers(raw));
});

test("the tiers say themselves on cards, in the directory API and in its docs", () => {
  const ev = { price: "$55", priceTiers: [{ label: "Adults", price: 54.95 }, { label: "Kids", price: 34.95 }] };
  assert.equal(tierLine(ev), "Adults $54.95 · Kids $34.95"); assert.equal(priceOf(ev), "Adults $54.95 · Kids $34.95", "the directory's price (and the card's priceLine)");
  assert.equal(priceOf({ price: "$10", priceTiers: [{ label: "Members", price: 10 }, { label: "Guests", price: 15 }] }), "Members $10 · Guests $15");
  assert.equal(priceOf({ price: "$20" }), "$20 a person", "one price reads as before"); assert.equal(priceOf({ free: true, priceTiers: [{ label: "Adults", price: 5 }] }), "Free");
  const dir = read("server/directory.js"); assert.match(dir, /price_tiers: cleanTiers\(c\.priceTiers\)/); assert.match(dir, /price_tiers: \{ type: "array", maxItems: 4/); assert.match(dir, /price_tiers \(\[\{ label, price \}\]/);
  const com = read("server/community.js"); assert.match(com, /"priceTiers"\];/, "cards carry the tiers"); assert.match(com, /"groupPrice", "priceTiers", "orderItems"/, "and private cards drop them");
  assert.match(read("server/app.js"), /PUBLIC_FIELDS\.push\("priceTiers"\)/, "guest links get them");
});

test("a guest picks how many of each tier; the server keeps the picks, the party follows them, and the pay amount is the sum", () => {
  assert.deepEqual(cleanPicks([{ label: "Huge", n: 999 }, { label: "<x>", n: 1 }, null, "x"]), [{ label: "Huge", n: 50 }, { label: "x", n: 1 }], "at most 50 a tier, no markup");
  assert.deepEqual(cleanPicks([{ label: "Adults", n: 2.7 }, { label: "Kids", n: "1" }, { label: "kids", n: 4 }, { label: "Teens", n: 0 }]), [{ label: "Adults", n: 2 }, { label: "Kids", n: 1 }]);
  const ev = { price: "$55", priceTiers: [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }] };
  assert.equal(tierTotal(ev, { tiers: [{ label: "adults", n: 2 }, { label: "Kids", n: 1 }] }), 145, "2 × $55 + 1 × $35");
  assert.equal(tierTotal(ev, { tiers: [{ label: "Grown-ups", n: 3 }] }), 0, "a label the event doesn't have costs nothing (the plain price applies)");
  assert.equal(tierTotal({ price: "$55" }, { tiers: [{ label: "Adults", n: 2 }] }), 0, "no tiers on the event: nothing changes");
  assert.equal(tierTotal({ priceTiers: [{ label: "Adults", price: 54.95 }, { label: "Kids", price: 34.95 }] }, { tiers: [{ label: "Adults", n: 2 }, { label: "Kids", n: 2 }] }), 179.8, "cents add up");
  // the reply: tiers are a guest field, the party is everyone picked; the pay line uses the sum
  const app = read("server/app.js"); assert.match(app, /"utm", "source", "tiers"\]\)/); assert.match(app, /o\.tiers = cleanPicks\(b\.tiers\); const n = o\.tiers\.reduce\(\(a, p\) => a \+ p\.n, 0\); if \(b\.party == null && n\) o\.party = Math\.min\(50, n\);/);
  assert.match(app, /const n = tierTotal\(ev, r\) \|\| parseFloat\(p\.replace/);
  // the page sums the same way
  const { T } = browser(); assert.equal(T.total(ev, [{ label: "Adults", n: 2 }, { label: "Kids", n: 1 }]), 145); assert.equal(T.money(145), "$145"); assert.equal(T.money(179.8), "$179.80"); assert.equal(T.people([{ n: 2 }, { n: 1 }]), 3);
  // the light invite: the picker in the form, the picks and party on the reply, Pay says the sum
  const inv = read("public/invite.html"); assert.ok(inv.length < 40000, "the light invite stays small"); assert.match(inv, /\/tiers\.js/); assert.match(inv, /TI\.pickerHTML\(e\)/); assert.match(inv, /tiers: TI\.picked\(\$\("#ptTiers"\)\), party:/); assert.match(inv, /Pay \$\{esc\(amtP\)\}<\/a>/);
});

test("the sentence reader fills the tiers: \"adults $55, kids $35\" and \"$55 adults, $35 kids\"", () => {
  const { T } = browser();
  for (const [s, want] of [["Friendsgiving potluck sat 6pm, adults $55, kids $35", [["Adults", 55], ["Kids", 35]]], ["winter supper fri 7pm $55 adults, $35 kids", [["Adults", 55], ["Kids", 35]]],
    ["adults $55 kids $35", [["Adults", 55], ["Kids", 35]]], ["pottery night, Members $10 · Guests $15", [["Members", 10], ["Guests", 15]]], ["$10 for members and $15 for non-members", [["Members", 10], ["Non-members", 15]]],
    ["Adults $54.95 · Kids $34.95", [["Adults", 54.95], ["Kids", 34.95]]], ["students $8, seniors $8, general $12", [["Students", 8], ["Seniors", 8], ["General", 12]]]])
    assert.deepEqual(plain(T.read(s)), want.map(([label, price]) => ({ label, price })), s);
  for (const s of ["dinner at mine sat 7pm $55", "$20 a person", "kids welcome, $30", "adults only $40"]) assert.deepEqual(plain(T.read(s)), [], s);
  // in the app: quickStart's draft gets the tiers and the first price; the page loads tiers.js from one appended block
  const ctx = { window: null, console, document: undefined }; ctx.window = ctx; ctx.draft = null;
  ctx.quickStart = function () { ctx.draft = { name: "Supper", price: "$55" }; return 1; }; ctx.priceTxt = (d) => (d?.price ? d.price + " a person" : "");
  vm.createContext(ctx); vm.runInContext(read("public/tiers.js").replace('typeof document !== "undefined" && document.getElementById("view-guest")', "true").replace(/new MutationObserver\([\s\S]*?\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\);/g, "").replace(/document\.addEventListener\("click"[\s\S]*?\}, true\);/, ""), ctx);
  vm.runInContext("var draft = null;", ctx); // the app's draft
  ctx.quickStart("Winter supper sat 7pm, adults $55, kids $35"); assert.deepEqual(plain(ctx.draft.priceTiers), [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }]); assert.equal(ctx.draft.price, "$55");
  assert.equal(ctx.priceTxt({ price: "$55", priceTiers: [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }] }), "Adults $55 · Kids $35"); assert.equal(ctx.priceTxt({ price: "$20" }), "$20 a person");
  // the app loads tiers.js from looks-app.js (index.html is unchanged)
  assert.match(read("public/looks-app.js"), /t\.src = "\/tiers\.js"/); assert.match(read("index.html"), /<script src="\/looks-app\.js" defer><\/script>/);
});

test("the Harvest menu card: cream, a band of leaves top and bottom, the dishes stacked and centred, a price line with tiers", () => {
  const { M, LK } = browser();
  const h = M.html({ style: "harvest", theme: "Winter supper", courses: ["To start: Squash soup", "Main: Braised short rib", "Pie"], price: "Adults $55 · Kids $35" });
  assert.match(h, /^<figure class="mc-hv">/); assert.match(h, /class="mh-band t"/); assert.match(h, /class="mh-band b"/); assert.match(h, /<b class="mh-title">Winter supper<\/b>/);
  assert.match(h, /<small>To start<\/small><b>Squash soup<\/b>/); assert.match(h, /<b>Pie<\/b>/); assert.match(h, /<p class="mh-price">Adults \$55 · Kids \$35<\/p>/);
  assert.equal(M.html({ style: "harvest", courses: [] }), ""); assert.match(M.html({ style: "harvest", items: [{ name: "Fig jam", price: 9 }] }), /<b>Fig jam<\/b><span>\$9<\/span>/, "items with their prices");
  assert.match(M.html({ style: "harvest", theme: "<img src=x>", courses: ["<b>x</b>"] }), /&lt;img src=x&gt;.*&lt;b&gt;x&lt;\/b&gt;/s, "escaped");
  const band = M.band(); assert.match(band, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="260" height="72"/); assert.ok((band.match(/<ellipse rx="8.5"/g) || []).length >= 2, "pinecones"); assert.ok((band.match(/fill="#A3242A"/g) || []).length >= 10, "berries");
  assert.match(M.html({ theme: "x", courses: ["A"] }), /^<figure class="mc"/, "the house card is unchanged");
  // the menu's price line says the tiers, else the price a person
  assert.equal(LK.priceLine({ price: "$55", priceTiers: [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }] }), "Adults $55 · Kids $35"); assert.equal(LK.priceLine({ price: "55" }), "$55 a person"); assert.equal(LK.priceLine({ price: "chip" }), "");
});

test("Pantry stickers, Surprise me for dinners, potlucks, holiday and winter events, and the host page's Pantry shelf", () => {
  const { LK, S } = browser();
  for (const k of ["jar", "pinecone", "maple", "cocoa", "candle", "hextile"]) { assert.ok(LOOK.stickers.includes(k), k); assert.match(LK.stickerSVG(k), /^<svg viewBox="-4 -4 72 72"[^>]*>.*<\/svg>$/s); }
  assert.deepEqual(plain(Object.keys(LK.STICKERS)), LOOK.stickers);
  for (const fx of LK.MOODS.pantry.fx) assert.ok(LOOK.effects.includes(fx)); for (const f of LK.MOODS.pantry.font) assert.ok(LOOK.titleFonts.includes(f)); for (const e of LK.MOODS.pantry.em) assert.ok(LOOK.buttonEmoji.includes(e));
  for (let i = 0; i < 30; i++) for (const name of ["Friendsgiving potluck", "Soup swap", "Harvest supper"]) assert.equal(LK.surprise({ name }).vibe, "pantry", name);
  const seen = (name) => { const v = new Set(); for (let i = 0; i < 200; i++) v.add(LK.surprise({ name }).vibe); return v; };
  for (const name of ["Holiday dinner party", "Winter supper", "Christmas cookie swap"]) assert.ok(seen(name).has("pantry"), name);
  for (let i = 0; i < 100; i++) { const L = plain(LK.surprise({ name: "Potluck" })); assert.deepEqual(cleanLook(L), L, "saves as it is"); assert.equal(L.menuStyle, "harvest"); }
  // the host page
  assert.ok(STORE.covers.includes("pantry") && STORE.accents.includes("#8A4B0F")); assert.equal(S.COVERS.pantry, "Pantry shelf"); assert.deepEqual(plain(S.ACCENTS), STORE.accents); assert.deepEqual(plain(Object.keys(S.COVERS)), STORE.covers);
  const L = S.LOOKS.pantry.set; assert.ok(STORE.accents.includes(L.accent) && STORE.covers.includes(L.cover) && STORE.layouts.includes(L.layout) && STORE.fonts.includes(L.font) && STORE.backgrounds.includes(L.bg) && STORE.buttons.includes(L.buttons));
  // brand words: no em dashes in anything new
  for (const f of ["public/pantry.js", "public/tiers.js", "test/pantry.test.js"]) assert.ok(!read(f).includes(String.fromCharCode(8212)), f);
});

test("end to end: a host saves tiers, guests see them, a guest's picks set the party and stay on the reply", async () => {
  process.env.ENCORE_SIGNUP = "1"; process.env.SESSION_SECRET = "pantry-tiers-secret-0123456789abcdef"; resetLoginLimits(); const srv = await startServer();
  try { const J = { "content-type": "application/json" }, day = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
    const r = await fetch(srv.base + "/api/signup", { method: "POST", headers: J, body: JSON.stringify({ name: "Mara Lind", email: "mara.tiers@example.com", password: "long-password-1", mode: "friends" }) });
    const c = r.headers.get("set-cookie").split(";")[0], ws = (await (await fetch(srv.base + "/api/workspace", { headers: { cookie: c } })).json()).id;
    const put = await fetch(srv.base + "/api/db/doc?path=events/tier1", { method: "PUT", headers: { ...J, cookie: c }, body: JSON.stringify({ kind: "social", casual: true, name: "Winter supper", date: day, published: true, headcount: 20, price: "$55",
      priceTiers: [{ label: "Adults", price: "$55" }, { label: "Kids", price: 35 }, { label: "<i>", price: 0 }], look: { menuStyle: "harvest", effect: "jarwall" } }) });
    assert.equal(put.status, 200);
    const pub = await (await fetch(srv.base + "/api/db/doc?path=events/tier1", { headers: { "x-encore-guest": "1" } })).json();
    assert.deepEqual(pub.data.priceTiers, [{ label: "Adults", price: 55 }, { label: "Kids", price: 35 }]); assert.equal(pub.data.look.menuStyle, "harvest");
    const g = await fetch(srv.base + "/api/db/collection?path=rsvps", { method: "POST", headers: { ...J, "x-encore-guest": "1", "x-encore-key": "k-ivy", "x-encore-workspace": ws }, body: JSON.stringify({ eventId: "tier1", response: "going", name: "Ivy", email: "ivy@example.com", tiers: [{ label: "Adults", n: 2 }, { label: "Kids", n: 1 }] }) });
    assert.equal(g.status, 200); const id = String((await g.json()).id || "").split("/").pop();
    const mine = await (await fetch(srv.base + "/api/db/doc?path=rsvps/" + id, { headers: { cookie: c } })).json();
    assert.deepEqual(mine.data.tiers, [{ label: "Adults", n: 2 }, { label: "Kids", n: 1 }]); assert.equal(mine.data.party, 3, "the party is everyone picked");
    assert.equal(tierTotal(pub.data, mine.data), 145, "what the pay line asks for");
  } finally { await srv.close(); delete process.env.ENCORE_SIGNUP; delete process.env.SESSION_SECRET; }
});
