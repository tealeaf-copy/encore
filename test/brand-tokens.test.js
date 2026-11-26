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
  assert.match(block, /@import url\("https:\/\/fonts\.googleapis\.com\/css2\?family=Instrument\+Serif/, "the fonts load in the token block");
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

test("brand tokens: the old house brand is gone from the tokens and the type", () => {
  assert.doesNotMatch(block, /#C94A30|#F7F1E8|#1F1A17|Fredoka/i);
  assert.match(css, /--sys-display:var\(--pl-font-display\)/); assert.match(css, /--sys-title:var\(--pl-font-text\)/);
  assert.match(css, /--ink:var\(--pl-ink\)/); assert.match(css, /--sys-ember:var\(--pl-accent\)/);
});

test("brand tokens: cards have a clear edge, and body text has a floor", () => {
  assert.ok(ratio(T["line"], T["surface"]) >= 1.4, "a card line you can see on its card");
  assert.ok(ratio(T["line-strong"], T["surface"]) >= 2, "field and outlined button lines");
  assert.match(block, /--pl-body-size:16px/); assert.match(block, /--pl-body-lh:1\.5/); assert.match(block, /--pl-display-min:24px/);
  assert.match(css, /body\{font-family:var\(--sys-sans\);font-size:var\(--pl-body-size\)\}/);
  assert.match(css, /\nh1,h2\{font-family:var\(--sys-display\)\}/); assert.match(css, /\nh3\{font-family:var\(--sys-title\);font-weight:600\}/);
});
