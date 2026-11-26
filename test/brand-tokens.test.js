// The brand tokens at the top of public/system.css: every text colour reads at WCAG AA (4.5:1) on every surface it
// sits on, buttons stand out from the page (3:1), and the old house colours and Fredoka are gone from the brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../public/system.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("BRAND TOKENS"), css.indexOf("end of brand tokens"));
const T = Object.fromEntries([...block.matchAll(/--pl-([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("brand tokens: the block defines every role", () => {
  for (const k of ["page", "surface", "raised", "ink", "soft", "muted", "line", "line-strong", "accent", "accent-press", "accent-text", "accent-soft", "on-accent", "sand", "sand-soft", "sage", "success", "success-soft", "warning", "warning-soft", "danger", "danger-soft"]) assert.ok(T[k], "--pl-" + k);
  assert.match(block, /--pl-font-display:/); assert.match(block, /--pl-font-text:/); assert.match(block, /--pl-font-mono:/); assert.match(block, /--pl-focus:/);
  assert.match(block, /@import url\("https:\/\/fonts\.googleapis\.com\/css2\?family=IBM\+Plex\+Sans:wght@400;500;600&family=IBM\+Plex\+Serif:wght@600&family=IBM\+Plex\+Mono:wght@500&display=swap"\)/, "the fonts load in the token block, only the weights used, font-display swap");
});

test("brand tokens: every text and background pair passes AA", () => {
  const pairs = [];
  const text = (fg, bgs, need = 4.5) => { for (const bg of bgs) pairs.push([fg, bg, need]); };
  text("ink", ["page", "surface", "raised", "sand", "sand-soft", "accent-soft", "success-soft", "warning-soft", "danger-soft"]);
  text("soft", ["page", "surface", "raised", "sand", "sand-soft", "accent-soft"]);
  text("soft", ["page", "surface"], 7); // secondary text reads like body text: about 7:1 on the page and cards
  text("muted", ["page", "surface", "raised", "sand", "sand-soft", "accent-soft"]);
  text("accent-text", ["page", "surface", "accent-soft", "sand-soft"]);
  text("on-accent", ["accent", "accent-press"]);
  text("surface", ["ink"]); // a selected chip: light text on ink
  text("success", ["page", "surface", "success-soft"]); text("warning", ["page", "surface", "warning-soft"]); text("danger", ["page", "surface", "danger-soft"]);
  text("sage", ["page", "surface"]);
  // non-text: a primary button and the focus edge stand out from the page and cards
  text("accent", ["page", "surface"], 3);
  const bad = pairs.map(([f, b, n]) => [f, b, n, ratio(T[f], T[b])]).filter(([, , n, r]) => r < n).map(([f, b, n, r]) => `${f} on ${b}: ${r.toFixed(2)} (needs ${n})`);
  assert.deepEqual(bad, []);
});

test("brand tokens: the old house brands are gone from the tokens and the type", () => {
  assert.doesNotMatch(block, /#C94A30|#F7F1E8|#1F1A17|Fredoka|#F4F0E8|#9A4128|Instrument/i, "neither the 2025 house brand nor Bone and clay");
  assert.match(css, /--sys-display:var\(--pl-font-display\)/); assert.match(css, /--sys-title:var\(--pl-font-text\)/);
  assert.match(css, /--ink:var\(--pl-ink\)/); assert.match(css, /--sys-ember:var\(--pl-accent\)/);
});

test("brand tokens: cards have a clear edge, and body text has a floor", () => {
  assert.ok(ratio(T["line"], T["surface"]) >= 1.4, "a card line you can see on its card");
  assert.ok(ratio(T["line-strong"], T["surface"]) >= 2, "field and outlined button lines");
  assert.match(block, /--pl-body-size:17px/); assert.match(block, /--pl-body-lh:1\.6/); assert.match(block, /--pl-display-min:24px/);
  assert.match(css, /body\{font-family:var\(--sys-sans\);font-size:var\(--pl-body-size\)\}/);
  assert.match(css, /\nh1,h2\{font-family:var\(--sys-display\)\}/); assert.match(css, /\nh3\{font-family:var\(--sys-title\);font-weight:600\}/);
});

test("Field Notes: the faces, the palette and the frame", () => {
  const want = { page: "#EFEBE2", surface: "#FAF8F3", ink: "#1B1D1C", soft: "#444845", line: "#CFC8B9", accent: "#29489A", "accent-text": "#29489A", "on-accent": "#FFFFFF", sand: "#F3E7A8", highlight: "#F2DD6B", tomato: "#C2431F", moss: "#56683F" };
  for (const [k, v] of Object.entries(want)) assert.equal(T[k], v, "--pl-" + k);
  assert.match(block, /--pl-font-display:"IBM Plex Sans"/); assert.match(block, /--pl-font-serif:"IBM Plex Serif"/); assert.match(block, /--pl-font-text:"IBM Plex Sans"/); assert.match(block, /--pl-font-mono:"IBM Plex Mono"/);
  assert.match(block, /--pl-r-btn:6px;--pl-r-sm:6px;--pl-r-md:6px;--pl-r-lg:6px/); assert.match(block, /--pl-bw:1\.5px/); assert.match(block, /--pl-shadow:none/);
  assert.match(css, /--sys-serif:var\(--pl-font-serif\)/);
  // the shared magazine classes the feed and pages adopt
  for (const c of [".pl-card__perk", ".pl-card__place", ".pl-card__title", ".pl-card__rule", ".pl-chip", ".pl-frame", ".pl-masthead", ".pl-quote", ".pl-search__field", ".pl-tab-plus"]) assert.ok(css.includes(c), c);
  // the highlighter and the tint carry ink text; white reads on ink blue
  assert.ok(ratio(T.ink, T.highlight) >= 4.5); assert.ok(ratio(T.ink, T.sand) >= 4.5); assert.ok(ratio("#FFFFFF", T.accent) >= 4.5);
  // one light look everywhere: no stylesheet flips the page dark
  for (const f of fs.readdirSync(new URL("../public/", import.meta.url))) if (/\.(css|js|html)$/.test(f)) assert.doesNotMatch(fs.readFileSync(new URL("../public/" + f, import.meta.url), "utf8"), /prefers-color-scheme:\s*dark/, f);
});
