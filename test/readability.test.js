// Readability guardrails that hold for any brand: the display face (in public/ and the app's index.html) (--pl-font-display, --sys-display, --sys-accent or
// Instrument Serif by name) is never set at a size under 24px in any stylesheet or inline style block. The wordmark is
// the one exception: system.css draws it at 25px whatever the page asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!["og", "vendor", "fonts", "img", "icons"].includes(f)) walk(p); } else if (/\.(css|html|js)$/.test(f)) files.push(p); } })(PUB);
files.push(path.join(PUB, "..", "index.html")); // the app itself
const DISP = /(var\(--(pl-font-display|sys-display|sys-accent)[,)]|["']?Instrument Serif["']?)/;
// a size in px: 20px, var(--fs-20), clamp(22px, ...), 1.25rem
const px = (v) => { v = v.trim(); let m; if ((m = v.match(/^(\d+(?:\.\d+)?)px/))) return +m[1]; if ((m = v.match(/^var\(--fs-(\d+)/))) return +m[1]; if ((m = v.match(/^clamp\(\s*(\d+(?:\.\d+)?)px/))) return +m[1]; if ((m = v.match(/^(\d+(?:\.\d+)?)r?em/))) return m[1] * 16; return null; };

function displayRules() { const out = [];
  for (const f of files) { const s = fs.readFileSync(f, "utf8"), re = /([^{}]*)\{([^{}]*)\}/g; let m;
    while ((m = re.exec(s))) { const sel = m[1].split(/[;}]/).pop().trim(), body = m[2];
      const ff = body.match(/font-family\s*:[^;}]*/i), fo = body.match(/(?:^|;)\s*font\s*:([^;}]*)/i);
      if (!(ff && DISP.test(ff[0])) && !(fo && DISP.test(fo[1]))) continue;
      const fz = body.match(/font-size\s*:([^;}]*)/i), size = fz ? px(fz[1]) : fo ? +(fo[1].match(/(\d+(?:\.\d+)?)px/) || [])[1] || null : null;
      out.push({ file: path.relative(PUB, f), line: s.slice(0, m.index).split("\n").length + 1, sel: sel.replace(/\s+/g, " ").slice(-80), size }); } }
  return out; }

test("the display serif is never used under 24px in any stylesheet", () => {
  const rules = displayRules(); assert.ok(rules.length > 50, "the scan finds the display rules");
  const small = rules.filter((r) => r.size != null && r.size < 24 && !/brand\b/.test(r.sel)).map((r) => `${r.file}:${r.line} ${r.sel} at ${r.size}px`);
  assert.deepEqual(small, []);
});

test("the wordmark is the one small display use, and system.css pins it to 25px", () => {
  const css = fs.readFileSync(path.join(PUB, "system.css"), "utf8");
  assert.match(css, /:is\(a\.brand,a\.es-brand,\.es-rail \.es-logo span\)\{font-family:var\(--pl-font-display\)!important;font-weight:var\(--pl-display-weight\)!important;font-size:25px!important/);
});

test("feed cards: the title is the serif at 600, 22/28, date and place on their own lines in strong ink", () => {
  const fv = fs.readFileSync(path.join(PUB, "feedvisual.js"), "utf8");
  assert.match(fv, /\.fv-title\{margin:10px 0 4px;font:600 22px\/28px var\(--pl-font-serif\);color:var\(--fv-ink\)/);
  assert.match(fv, /\.fv-data span\{display:block\}\.fv-data\{margin:0;font:500 15px\/1\.45 var\(--pl-font-text\);color:var\(--fv-ink\)/);
  assert.match(fv, /<p class="fv-data">\$\{\[when\(e\), where\(e\)\]\.filter\(Boolean\)\.map\(\(x\) => `<span>\$\{esc\(x\)\}<\/span>`\)\.join\(""\)\}<\/p>/);
});
