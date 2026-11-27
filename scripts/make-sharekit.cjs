// Renders the pieces the server-side share cards (server/sharecards.js) are drawn from, the same way make-og.cjs makes
// the og cards: a headless browser draws them once, and the PNGs are committed under public/og/kit/.
//   - glyph atlases for the four Field Notes faces (Plex Sans 400 and 600, Plex Serif 600, Plex Mono 500) at 96px,
//     white on transparent, with each glyph's advance and box in kit.json
//   - the line-art drawings from public/eventart.js (transparent, 2x) and Potto's poses from public/mascot.js
// Re-run after changing eventart.js, mascot.js or the fonts:
//   node scripts/make-sharekit.cjs
const fs = require("fs"), path = require("path");
let pw; try { pw = require("playwright"); } catch { pw = require(path.join(process.execPath, "../../lib/node_modules/playwright")); }
const root = path.join(__dirname, ".."), out = path.join(root, "public/og/kit");
const font = (f) => "data:font/woff2;base64," + fs.readFileSync(path.join(root, "public/fonts", f)).toString("base64");
const FACES = { sans: ["ibm-plex-sans-latin-400-normal.woff2", 400, "PLSans"], sansBold: ["ibm-plex-sans-latin-600-normal.woff2", 600, "PLSans"], serif: ["ibm-plex-serif-latin-600-normal.woff2", 600, "PLSerif"], mono: ["ibm-plex-mono-latin-500-normal.woff2", 500, "PLMono"] };
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + "‘’“”·…éèêáàâíóôúüñöäçÉ×–→";
const SIZE = 96;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await pw.chromium.launch(), p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  const css = Object.values(FACES).map(([f, w, fam]) => `@font-face{font-family:${fam};font-weight:${w};src:url(${font(f)}) format("woff2")}`).join("");
  await p.setContent(`<!doctype html><html><head><style>${css}</style></head><body><span style="font-family:PLSans;font-weight:400">a</span><span style="font-family:PLSans;font-weight:600">a</span><span style="font-family:PLSerif;font-weight:600">a</span><span style="font-family:PLMono;font-weight:500">a</span>
<script>${fs.readFileSync(path.join(root, "public/eventart.js"), "utf8")}</script><script>${fs.readFileSync(path.join(root, "public/mascot.js"), "utf8")}</script></body></html>`);
  await p.evaluate(() => document.fonts.ready);
  const kit = { size: SIZE, fonts: {}, art: {}, potto: {} };
  for (const [key, [, weight, fam]] of Object.entries(FACES)) {
    const r = await p.evaluate(([fam, weight, chars, size]) => {
      const c = document.createElement("canvas"), x = c.getContext("2d"), f = `${weight} ${size}px ${fam}`; x.font = f;
      const pad = 4, cellH = Math.ceil(size * 1.45), base = Math.ceil(size * 1.08), cols = 16, glyphs = {};
      const widths = [...chars].map((ch) => Math.ceil(x.measureText(ch).width) + pad * 2), cellW = Math.max(...widths);
      c.width = cols * cellW; c.height = Math.ceil(chars.length / cols) * cellH; x.font = f; x.fillStyle = "#fff"; x.textBaseline = "alphabetic";
      [...chars].forEach((ch, i) => { const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH; x.fillText(ch, cx + pad, cy + base); glyphs[ch] = [cx, cy, x.measureText(ch).width]; });
      const m = x.measureText("Hxgy"); return { png: c.toDataURL("image/png").split(",")[1], glyphs, cellW, cellH, base, pad, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent, cap: x.measureText("H").actualBoundingBoxAscent };
    }, [fam, weight, CHARS, SIZE]);
    fs.writeFileSync(path.join(out, `font-${key}.png`), Buffer.from(r.png, "base64"));
    kit.fonts[key] = { file: `font-${key}.png`, cellW: r.cellW, cellH: r.cellH, base: r.base, pad: r.pad, ascent: r.ascent, descent: r.descent, cap: r.cap, glyphs: Object.fromEntries(Object.entries(r.glyphs).map(([k, v]) => [k, [v[0], v[1], Math.round(v[2] * 100) / 100]])) };
  }
  // drawings: each in its 200 x 150 box at 2x, transparent, in the colour of its usual tone
  const drawnKinds = await p.evaluate(() => window.EventArt.KINDS);
  const raster = (svg, w, h) => p.evaluate(([svg, w, h]) => new Promise((res, rej) => { const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); res(c.toDataURL("image/png").split(",")[1]); }; img.onerror = rej; img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); }), [svg, w, h]);
  for (const k of drawnKinds) {
    const svg = await p.evaluate((k) => { const E = window.EventArt, tone = E.toneOf({}, k); return E.drawing(k, E.SPOT[tone]).replace("<svg ", '<svg width="400" height="300" '); }, k);
    fs.writeFileSync(path.join(out, `art-${k}.png`), Buffer.from(await raster(svg, 400, 300), "base64")); kit.art[k] = { file: `art-${k}.png`, w: 400, h: 300 };
  }
  for (const pose of ["wave", "cheer", "think", "carry"]) {
    const svg = await p.evaluate((pose) => window.Potto.svg(pose, 320, "Potto").replace('class="potto', 'xmlns="http://www.w3.org/2000/svg" class="potto'), pose);
    fs.writeFileSync(path.join(out, `potto-${pose}.png`), Buffer.from(await raster(svg, 320, 320), "base64")); kit.potto[pose] = { file: `potto-${pose}.png`, w: 320, h: 320 };
  }
  fs.writeFileSync(path.join(out, "kit.json"), JSON.stringify(kit));
  console.log(`wrote ${Object.keys(kit.fonts).length} fonts, ${Object.keys(kit.art).length} drawings and ${Object.keys(kit.potto).length} Pottos to public/og/kit/`);
  await b.close();
})();
