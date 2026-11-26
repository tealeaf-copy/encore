// Round 11 design: the Night out look (readable on a dark page), the Card deck cover, cover stickers kept to an allow-list,
// Surprise me rolls that always save as they are, and host page layouts from a whitelisted field.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { cleanLook, cleanStickers, LOOK } from "../server/looks.js";
import { STORE, cleanTheme } from "../server/community.js";

function browser() { const window = { devicePixelRatio: 1 }; const ctx = { window, console };
  for (const f of ["color.js", "looks.js", "storefront.js"]) vm.runInNewContext(fs.readFileSync(new URL("../public/" + f, import.meta.url), "utf8"), Object.assign(ctx, { document: undefined, localStorage: {} }));
  return { C: window.EncoreColor, LK: window.EncoreLooks, S: window.EncoreStore }; }
const plain = (v) => JSON.parse(JSON.stringify(v));

test("stickers: only listed ids, positions clamped to the cover, sizes and tilts clamped, six at most", () => {
  const o = cleanLook({ stickers: [{ id: "star", x: 140, y: -20, s: 9, r: 300 }, { id: "<script>", x: 5, y: 5 }, { id: "heart", x: "50", y: null, s: 0.1, r: -99 }, "lantern", null,
    ...Array.from({ length: 10 }, (_, i) => ({ id: "dumpling", x: i * 7.123, y: 30, s: 1, r: 5, extra: "x" }))] });
  assert.equal(o.stickers.length, 6, "six at most");
  assert.deepEqual(o.stickers[0], { id: "star", x: 100, y: 0, s: 1.6, r: 40 }, "clamped to the cover, the biggest size and the steepest tilt");
  assert.deepEqual(o.stickers[1], { id: "heart", x: 50, y: 50, s: 0.6, r: -40 }, "a non-number lands in the middle");
  assert.ok(o.stickers.every((x) => LOOK.stickers.includes(x.id) && Object.keys(x).join() === "id,x,y,s,r"), "no unknown ids or extra keys");
  assert.equal(o.stickers[2].x, 0); assert.equal(o.stickers[3].x, 7.1, "one decimal");
  assert.deepEqual(cleanLook({ stickers: "star" }), {}, "not a list: dropped"); assert.deepEqual(cleanLook({ stickers: [{ id: "bomb" }] }), {}, "nothing left: no key");
  assert.deepEqual(cleanStickers(undefined), []);
  // the page draws the same set the server keeps
  const { LK } = browser(); assert.deepEqual(plain(Object.keys(LK.STICKERS)), LOOK.stickers); assert.equal(LK.MAX_STICKERS, LOOK.maxStickers);
  for (const k of LOOK.stickers) assert.match(LK.stickerSVG(k), /^<svg viewBox="-4 -4 72 72"[^>]*>.*<\/svg>$/s);
  assert.equal(LK.stickerSVG("nope"), "");
});

test("cover style, the Lanterns effect and the Card deck vibe are kept; anything else is dropped", () => {
  assert.deepEqual(cleanLook({ coverStyle: "deck", effect: "lanterns", vibe: "cards" }), { coverStyle: "deck", effect: "lanterns", vibe: "cards" });
  assert.deepEqual(cleanLook({ coverStyle: "tarot", effect: "fireworks" }), {});
  const { LK } = browser();
  assert.equal(LK.VIBES.night.look.effect, "lanterns"); assert.equal(LK.VIBES.cards.look.coverStyle, "deck");
  assert.ok(LK.has({ coverStyle: "deck" }) && LK.has({ stickers: [{ id: "star" }] }), "a deck cover or stickers alone is a look");
});

test("Night out: every text colour on the dark page passes AA, and so does the menu slip", () => {
  const { C, LK } = browser(); const [dom, ...acc] = LK.VIBES.night.look.palette, T = C.pageFrom(dom, acc);
  assert.ok(T.dark, "a dark page");
  for (const bg of [T.top, T.bot]) { assert.ok(C.contrast(T.ink, bg) >= 4.5, `ink on ${bg}`); assert.ok(C.contrast(T.soft, bg) >= 4.5, `soft text on ${bg}`); assert.ok(C.contrast("#FFFDF8", bg) >= 7, "the glowing title"); }
  assert.ok(C.contrast(T.btn, T.onBtn) >= 4.5, "button text"); assert.ok(C.contrast(T.card, T.cardInk) >= 4.5, "card text"); assert.ok(C.worst(T.btn, [T.top, T.bot]) >= 3, "the button stands out");
  // the handwritten menu: ink and grey on paper, the red heading, paper on the ink band
  assert.ok(C.contrast("#1F1A17", "#F4EAD3") >= 7); assert.ok(C.contrast("#5A4E45", "#F4EAD3") >= 4.5); assert.ok(C.contrast("#B3321F", "#F4EAD3") >= 4.5); assert.ok(C.contrast("#F4EAD3", "#1F1A17") >= 7);
  // every Night out palette Surprise me can roll is dark and readable too
  for (const p of LK.MOODS.night.pal) { const X = C.pageFrom(p[0], p.slice(1)); assert.ok(X.dark, p[0]); for (const bg of [X.top, X.bot]) assert.ok(C.contrast(X.soft, bg) >= 4.5 && C.contrast(X.ink, bg) >= 4.5); assert.ok(C.contrast(X.btn, X.onBtn) >= 4.5); }
  // the host page's Night out look: the name on the noren reads, and its accent carries white button text
  assert.ok(C.contrast("#FFF6E6", "#26346F") >= 7); assert.ok(C.contrast("#FFFFFF", "#26346F") >= 4.5);
});

test("Surprise me rolls a palette, effect and font from what suits the vibe, never a button emoji, and every roll saves as it is", () => {
  const { LK } = browser();
  for (const [k, m] of Object.entries(LK.MOODS)) { assert.ok(LK.VIBES[k], k); for (const fx of m.fx) assert.ok(LOOK.effects.includes(fx)); for (const f of m.font) assert.ok(LOOK.titleFonts.includes(f)); for (const e of m.em) assert.ok(LOOK.buttonEmoji.includes(e)); }
  const seen = { palette: new Set(), effect: new Set(), titleFont: new Set() };
  for (let i = 0; i < 300; i++) { const L = plain(LK.surprise({ name: i % 2 ? "Izakaya night" : "Birthday party" })); assert.deepEqual(cleanLook(L), L, "saves unchanged"); assert.equal(L.buttonEmoji, undefined, "the button stays plain");
    const M = LK.MOODS[L.vibe]; assert.ok([LK.VIBES[L.vibe].look.palette, ...M.pal].some((p) => p.join() === L.palette.join()), "a palette from the vibe's family");
    for (const k of Object.keys(seen)) seen[k].add(String(L[k])); }
  for (const k of Object.keys(seen)) assert.ok(seen[k].size >= 3, `${k} varies`);
});

test("host page layouts: a whitelisted field, classic by default, so pages saved before stay as they were", () => {
  const { S } = browser();
  assert.deepEqual(plain(Object.keys(S.LAYOUTS)), STORE.layouts); assert.equal(STORE.layouts[0], "classic");
  assert.equal(cleanTheme({}).layout, "classic", "a page without a layout is classic");
  assert.equal(cleanTheme({ layout: "zine" }).layout, "zine");
  assert.equal(cleanTheme({ layout: "<b>" }, { layout: "stall" }).layout, "stall", "a bad value keeps what was saved");
  assert.equal(cleanTheme({ layout: "javascript:" }).layout, "classic");
  // each layout is CSS under its own body class, and carries the host's accent
  for (const k of STORE.layouts.slice(1)) { assert.match(S.LAYOUT_CSS, new RegExp(`body\\.store\\.lay-${k} `), k); }
  assert.ok((S.LAYOUT_CSS.match(/var\(--accent\)/g) || []).length >= 8, "the accent runs through the layouts");
  // the Night out look for host pages only uses values the server keeps
  const N = S.LOOKS.night.set; assert.ok(STORE.accents.includes(N.accent) && STORE.covers.includes(N.cover) && STORE.layouts.includes(N.layout) && STORE.fonts.includes(N.font) && STORE.backgrounds.includes(N.bg) && STORE.buttons.includes(N.buttons));
  assert.deepEqual(plain(S.ACCENTS), STORE.accents); assert.deepEqual(plain(Object.keys(S.COVERS)), STORE.covers);
});

test("the swipe deck shows the kind of event only top-left, on drawn cards, never upside down", () => {
  const src = fs.readFileSync(new URL("../public/swipedeck.js", import.meta.url), "utf8");
  assert.ok(!/sd-corner b|\.sd-corner\.b|rotate\(180deg\)/.test(src), "no upside-down corner");
  assert.match(src, /ph \|\| c\.kind === "host" \? ""/, "no corner word on photo or host cards");
  const lk = fs.readFileSync(new URL("../public/looks.js", import.meta.url), "utf8"); assert.ok(!/(?<!hue-)rotate\(180deg\)/.test(lk), "the Card deck look has no upside-down label either");
});

test("Terminal and Pixel: readable text on their pages, and Surprise me offers them for game and tech nights", () => {
  const { C, LK } = browser();
  for (const v of ["terminal", "pixel"]) for (const p of [LK.VIBES[v].look.palette, ...LK.MOODS[v].pal]) { const T = C.pageFrom(p[0], p.slice(1));
    for (const bg of [T.top, T.bot]) { assert.ok(C.contrast(T.ink, bg) >= 4.5, `${v} ink ${p[0]}`); assert.ok(C.contrast(T.soft, bg) >= 4.5, `${v} soft ${p[0]}`); if (v === "terminal") assert.ok(C.contrast("#A6F5BA", bg) >= 7, "phosphor title"); }
    assert.ok(C.contrast(T.btn, T.onBtn) >= 4.5, `${v} button ${p[0]}`); }
  assert.ok(C.pageFrom(LK.VIBES.terminal.look.palette[0]).dark, "Terminal is a dark page"); assert.ok(!C.pageFrom(LK.VIBES.pixel.look.palette[0]).dark, "Pixel is a light one");
  for (let i = 0; i < 30; i++) for (const name of ["Hack night", "Retro arcade meetup"]) assert.ok(["terminal", "pixel"].includes(LK.surprise({ name }).vibe), name);
  // review round 12: a board game table gets Card deck or Pixel, never Terminal
  for (let i = 0; i < 30; i++) assert.ok(["cards", "pixel"].includes(LK.surprise({ name: "Board game night" }).vibe));
  assert.ok(LK.FONTS.mono && LK.FONTS.pixel); for (const k of ["d20", "controller", "key", "floppy", "heartbox", "cursor"]) assert.ok(LOOK.stickers.includes(k), k);
});
