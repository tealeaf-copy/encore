// The 2026 colour audit of every event look (public/looks.js): each curated palette (vibes, their Surprise me cousins and
// the swatches) reads at AA on a flat page, the line art's one spot colour comes from the look, and buttons are plain.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
function browser() { const window = { devicePixelRatio: 1 }; const ctx = { window, console };
  for (const f of ["color.js", "looks.js", "eventart.js"]) vm.runInNewContext(read("public/" + f), Object.assign(ctx, { document: undefined, localStorage: {} }));
  return { C: window.EncoreColor, LK: window.EncoreLooks, EA: window.EventArt }; }
const { C, LK, EA } = browser();
const palettes = () => [
  ...Object.entries(LK.VIBES).map(([k, v]) => [k, v.look.palette]),
  ...Object.entries(LK.MOODS).flatMap(([k, m]) => m.pal.map((p, i) => [`${k} cousin ${i + 1}`, p])),
  ...LK.SWATCHES.map((s) => [`swatch ${s[3]}`, s.slice(0, 3)]),
];

test("every look palette: each token pair passes AA on a flat page", () => {
  const bad = [];
  const need = (what, fg, bg, n = 4.5) => { const r = C.contrast(fg, bg); if (r < n) bad.push(`${what}: ${fg} on ${bg} is ${r.toFixed(2)} (needs ${n})`); };
  for (const [k, p] of palettes()) { const T = C.pageFrom(p[0], p.slice(1));
    assert.equal(T.top, T.bot, `${k}: one flat page colour, no gradient`);
    need(`${k} ink`, T.ink, T.top); need(`${k} soft`, T.soft, T.top); need(`${k} button text`, T.onBtn, T.btn); need(`${k} button edge`, T.btn, T.top, 3);
    need(`${k} card text`, T.cardInk, T.card); need(`${k} quiet text on raised`, T.raisedSoft, T.raised); need(`${k} ink on raised`, T.ink, T.raised); }
  assert.deepEqual(bad, []);
});

test("every look palette: dark looks are deep with warm light text, light looks sit on calm neutrals", () => {
  for (const [k, p] of palettes()) { const T = C.pageFrom(p[0], p.slice(1));
    if (T.dark) { assert.ok(C.lum(T.top) < 0.03, `${k}: a deep page`); assert.ok(C.lum(T.ink) > 0.75, `${k}: light text`); }
    else assert.ok(chroma(T.top) <= 0.3, `${k}: a calm light page, not candy (${T.top})`); }
});
// colourfulness as max minus min channel (0 grey, 1 pure hue): HSL saturation overstates pale colours
const chroma = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return Math.max(...v) - Math.min(...v); };
function hslOf(h) { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn); return [0, s, l]; }

test("line art: the drawing's spot colour comes from the look's own palette, never a hue of its own", () => {
  const looks = read("public/looks.js");
  for (const c of Object.values(EA.SPOT)) assert.match(looks, new RegExp(`\\[fill="${c}"\\][^{]*\\{fill:var\\(--lk-spot\\)\\}`.replace("[^{]*", "[^{]*")), `the look recolours spot ${c}`);
  assert.match(looks, /setProperty\("--lk-spot", T\.spot \|\| T\.btn\)/);
  for (const [k, p] of palettes()) { const T = C.pageFrom(p[0], p.slice(1)); assert.ok(p.map((x) => x.toUpperCase()).includes(T.spot) || T.spot === T.btn, `${k}: spot ${T.spot} is the look's own`); }
  // the house art: muted grounds, spots from the Field Notes palette
  for (const c of Object.values(EA.PASTELS)) assert.ok(chroma(c) <= 0.18, `muted ground ${c}`);
  // Field Notes spots: ink blue, moss and tomato (the one warm note on covers), never neon
  for (const c of Object.values(EA.SPOT)) assert.ok(["#29489A", "#56683F", "#C2431F"].includes(c), `brand spot ${c}`);
});

test("buttons: every look's default label is plain I'm in, with no emoji; Surprise me never adds one", () => {
  for (const [k, v] of Object.entries(LK.VIBES)) { assert.equal(v.look.buttonEmoji, undefined, k); assert.equal(LK.buttonText({ look: v.look }), "I'm in", k); }
  for (let i = 0; i < 100; i++) assert.equal(LK.surprise({ name: ["Supper club", "Hack night", "Board game night", "Garden party"][i % 4] }).buttonEmoji, undefined);
  // a host can still choose one
  assert.equal(LK.buttonText({ look: { buttonEmoji: "🎷", buttonLabel: "I'm in" } }), "🎷 I'm in");
});

// The full audit: every look a guest can see (each vibe, each Surprise me cousin, each swatch) is checked for the title,
// the body text, the quiet text, the button label on the button and the link or accent text, at WCAG AA (4.5:1).
const TITLE = { night: "#FFFDF8", terminal: "#A6F5BA", pantry: "#3B2414" }; // the vibes that colour their title (looks.js)
const allLooks = () => [
  ...Object.entries(LK.VIBES).map(([k, v]) => [k, k, v.look.palette]),
  ...Object.entries(LK.MOODS).flatMap(([k, m]) => m.pal.map((p, i) => [`${k} cousin ${i + 1}`, k, p])),
  ...LK.SWATCHES.map((s) => [`swatch ${s[3]}`, "", s.slice(0, 3)]),
];

test("audit: every look passes AA for title, body, button label on button and link text", () => {
  const bad = [], need = (what, fg, bg) => { const r = C.contrast(fg, bg); if (r < 4.5) bad.push(`${what}: ${fg} on ${bg} is ${r.toFixed(2)}`); };
  const looks = allLooks(); assert.ok(looks.length >= 40, `enumerates every look (${looks.length})`);
  for (const [name, vibe, p] of looks) { const T = C.pageFrom(p[0], p.slice(1));
    need(`${name} title`, TITLE[vibe] || T.ink, T.top); need(`${name} body`, T.ink, T.top); need(`${name} quiet text`, T.soft, T.top);
    need(`${name} button label`, T.onBtn, T.btn); need(`${name} link`, T.link, T.top); need(`${name} link on a card`, T.link, T.raised);
    need(`${name} form text`, T.cardInk, T.card); }
  assert.deepEqual(bad, []);
});

test("audit: a host's own flyer colours and Surprise me's contrasting page stay legible, muted and grown-up", () => {
  const bad = [], need = (what, fg, bg, n = 4.5) => { if (C.contrast(fg, bg) < n) bad.push(`${what}: ${fg} on ${bg}`); };
  // a sweep of flyer colours: every hue at deep, mid and light values, plus the loud ones hosts upload most
  const flyers = ["#6E0F1F", "#5A0F1E", "#8A2BE2", "#FF5500", "#00AA88", "#FFE08A", "#F2B84B", "#7CF29A", "#FF00FF", "#777777", "#000000", "#FFFFFF"];
  for (let h = 0; h < 360; h += 30) for (const [s, l] of [[0.7, 0.18], [0.8, 0.45], [0.6, 0.75]]) flyers.push(C.fromHsl(h, s, l));
  for (const f of flyers) for (const page of [f, C.contrastPage(f)]) for (const acc of [[], ["#F2C46D"], ["#E26D8E", "#1F1A17"], ["#7CF29A"]]) {
    const T = C.pageFrom(page, acc), w = `${f} (${page}) with ${acc.join(" ") || "no accent"}`;
    need(`${w} body`, T.ink, T.top); need(`${w} quiet`, T.soft, T.top); need(`${w} button label`, T.onBtn, T.btn); need(`${w} button edge`, T.btn, T.top, 3);
    need(`${w} link`, T.link, T.top); need(`${w} form`, T.cardInk, T.card);
    // rich but calm: a deep page is near-black with a hint of its colour, a light page a soft tint, the button never neon
    if (T.dark) { if (C.lum(T.top) > 0.045 || C.chroma(T.top) > 0.18) bad.push(`${w}: dark page ${T.top} too loud`); }
    else if (C.chroma(T.top) > 0.2) bad.push(`${w}: light page ${T.top} is candy`);
    if (C.chroma(T.btn) > 0.52) bad.push(`${w}: button ${T.btn} is neon`); }
  assert.deepEqual(bad, []);
  // the contrasting page Surprise me offers is a muted colour, never a saturated wine or a candy pastel
  for (const f of flyers) assert.ok(C.chroma(C.contrastPage(f)) <= 0.2, `contrastPage(${f}) = ${C.contrastPage(f)}`);
});
