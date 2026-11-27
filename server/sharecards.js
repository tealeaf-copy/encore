// Share cards as PNGs, drawn on the server with no browser and no native module: a 1080x1920 story and a 1200x630 link
// card, in the Field Notes line-art style. The year in review (server/places.js) uses it now; anything else that wants
// a post-ready card (the January hosting wishlist) passes its own card spec.
//
// A card spec is plain data, the same one public/sharecards.js draws in the page, so what you see is what you save:
//   { tone, kicker, title, sub, body, quote: { text, by }, stats: [{ n, label }], list: [{ k, v }], art, potto,
//     map: { areas: [{ x, y, r, n, label }], lines: [[x, y, x, y, ...]] }, foot, accent }
// Coordinates in map are 0..1 of the map box. Every string on the card is in the spec (textOf lists them), so a test can
// check exactly what words a PNG carries. Photos never go on a share card: only drawings, so no face is ever in one.
//
// The pieces come from public/og/kit/ (scripts/make-sharekit.cjs renders them once, like scripts/make-og.cjs): glyph
// atlases for Plex Sans 400/600, Plex Serif 600 and Plex Mono 500, the event drawings and Potto's poses.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const KIT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "og", "kit");
export const SIZES = { story: { w: 1080, h: 1920 }, link: { w: 1200, h: 630 } };
export const TONES = { linen: "#EFEBE2", butter: "#ECE3C2", blush: "#EBDDD2", sky: "#DCE1EC", mint: "#DFE3D3", lilac: "#E2E0E8", peach: "#EDE2D0", sand: "#D9D2C2" };
const INK = [27, 29, 28], SOFT = [68, 72, 69], PAPER = [250, 248, 243], LINE = [207, 200, 185], BLUE = [41, 72, 154], WATER = [205, 214, 214];
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

// ---------------------------------------------------------------- PNG in and out
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
/** RGBA bytes to a PNG (8-bit, colour type 6). */
export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { const o = y * (w * 4 + 1); raw[o] = 1; // Sub filter: flat paper compresses to almost nothing
    for (let x = 0; x < w * 4; x++) raw[o + 1 + x] = (rgba[y * w * 4 + x] - (x >= 4 ? rgba[y * w * 4 + x - 4] : 0)) & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]); }
/** A PNG's size from its header, without decoding it. */
export function pngSize(buf) { if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null; return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }
/** An 8-bit, non-interlaced PNG (grey, RGB, grey+alpha or RGBA) to premultiplied RGBA. */
export function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12] !== 0) throw new Error("png: 8-bit non-interlaced only"); }
    else if (type === "IDAT") idat.push(d); else if (type === "IEND") break; p += 12 + len; }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; if (!bpp) throw new Error("png: colour type " + ct);
  const data = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, cur = Buffer.alloc(stride), prev = Buffer.alloc(stride), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, q = 0; y < h; y++) { const f = data[q++];
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = data[q++];
      cur[x] = f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : (() => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); })(); }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = x * bpp; let r, g, bl, al;
      if (ct === 6) { r = cur[s]; g = cur[s + 1]; bl = cur[s + 2]; al = cur[s + 3]; } else if (ct === 2) { r = cur[s]; g = cur[s + 1]; bl = cur[s + 2]; al = 255; } else if (ct === 4) { r = g = bl = cur[s]; al = cur[s + 1]; } else { r = g = bl = cur[s]; al = 255; }
      out[o] = (r * al) / 255; out[o + 1] = (g * al) / 255; out[o + 2] = (bl * al) / 255; out[o + 3] = al; }
    prev.set(cur); }
  return { w, h, d: out }; }
// halves, for sampling an image smaller than it was drawn without shimmer
function mips(img, levels = 4) { const L = [img]; for (let k = 1; k < levels; k++) { const s = L[k - 1]; if (s.w < 4 || s.h < 4) break; const w = s.w >> 1, h = s.h >> 1, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { const i = (y * 2 * s.w + x * 2) * 4 + c; d[(y * w + x) * 4 + c] = (s.d[i] + s.d[i + 4] + s.d[i + s.w * 4] + s.d[i + s.w * 4 + 4]) / 4; }
    L.push({ w, h, d }); } return L; }

// ---------------------------------------------------------------- the kit (atlases, drawings, Potto), read once
let KIT = null;
export function kit() { if (KIT) return KIT; const meta = JSON.parse(fs.readFileSync(path.join(KIT_DIR, "kit.json"), "utf8")), img = new Map();
  const load = (f) => { if (!img.has(f)) { try { img.set(f, mips(decodePng(fs.readFileSync(path.join(KIT_DIR, f))))); } catch { img.set(f, null); } } return img.get(f); };
  KIT = { meta, load, fonts: meta.fonts, art: (k) => (meta.art[k] ? load(meta.art[k].file) : null), potto: (p) => (meta.potto[p] ? load(meta.potto[p].file) : null), hasArt: (k) => !!meta.art[k] }; return KIT; }

// ---------------------------------------------------------------- drawing
class Paper {
  constructor(w, h, bg) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { this.d[i * 4] = bg[0]; this.d[i * 4 + 1] = bg[1]; this.d[i * 4 + 2] = bg[2]; this.d[i * 4 + 3] = 255; } }
  px(x, y, c, a) { if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4, d = this.d; if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; return; }
    d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a; }
  /** A filled rounded rect (r corner), anti-aliased. */
  rect(x, y, w, h, c, r = 0) { const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.ceil(x + w), y1 = Math.ceil(y + h);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) { const cx = px + 0.5, cy = py + 0.5, dx = Math.max(x + r - cx, cx - (x + w - r), 0), dy = Math.max(y + r - cy, cy - (y + h - r), 0);
      const cov = r ? Math.min(1, Math.max(0, r - Math.hypot(dx, dy) + 0.5)) : Math.min(1, Math.max(0, Math.min(cx - x + 0.5, x + w - cx + 0.5, cy - y + 0.5, y + h - cy + 0.5))); this.px(px, py, c, cov); } }
  /** A rounded rect outline of line width lw. */
  frame(x, y, w, h, c, lw, r = 0) { const sd = (cx, cy, x, y, w, h, r) => { const qx = Math.abs(cx - (x + w / 2)) - (w / 2 - r), qy = Math.abs(cy - (y + h / 2)) - (h / 2 - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
    const x0 = Math.floor(x - lw), y0 = Math.floor(y - lw), x1 = Math.ceil(x + w + lw), y1 = Math.ceil(y + h + lw);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) { const isEdge = px < x + lw + r + 2 || px > x + w - lw - r - 2 || py < y + lw + r + 2 || py > y + h - lw - r - 2; if (!isEdge) continue;
      const d = Math.abs(sd(px + 0.5, py + 0.5, x, y, w, h, r)); this.px(px, py, c, Math.min(1, Math.max(0, lw / 2 - d + 0.5))); } }
  circle(cx, cy, rad, c, { fill = true, lw = 0 } = {}) { const R = rad + lw + 1, x0 = Math.floor(cx - R), y0 = Math.floor(cy - R), x1 = Math.ceil(cx + R), y1 = Math.ceil(cy + R);
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) { const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy); this.px(px, py, c, fill ? Math.min(1, Math.max(0, rad - d + 0.5)) : Math.min(1, Math.max(0, lw / 2 - Math.abs(d - rad) + 0.5))); } }
  /** A stroked segment with round caps. */
  seg(ax, ay, bx, by, c, lw, a = 1) { const R = lw / 2 + 1, x0 = Math.floor(Math.min(ax, bx) - R), y0 = Math.floor(Math.min(ay, by) - R), x1 = Math.ceil(Math.max(ax, bx) + R), y1 = Math.ceil(Math.max(ay, by) + R), vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) { const qx = px + 0.5 - ax, qy = py + 0.5 - ay, t = Math.max(0, Math.min(1, (qx * vx + qy * vy) / L)), d = Math.hypot(qx - t * vx, qy - t * vy);
      this.px(px, py, c, a * Math.min(1, Math.max(0, lw / 2 - d + 0.5))); } }
  line(pts, c, lw, { dash = 0, a = 1 } = {}) { for (let i = 0; i + 3 < pts.length; i += 2) { if (dash && Math.floor(i / 2) % 2) continue; this.seg(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], c, lw, a); } }
  /** An image (premultiplied RGBA with mips) into a box, keeping its shape, centred; `tint` paints it one colour. */
  image(L, x, y, w, h, { fit = "contain", tint = null, alpha = 1 } = {}) { if (!L) return; const src = L[0], s = fit === "contain" ? Math.min(w / src.w, h / src.h) : Math.max(w / src.w, h / src.h), dw = src.w * s, dh = src.h * s, ox = x + (w - dw) / 2, oy = y + (h - dh) / 2;
    this.blit(L, ox, oy, s, 0, 0, src.w, src.h, tint, alpha, x, y, x + w, y + h); }
  // draw the source rect (sx, sy, sw, sh) of level 0 at (ox, oy) scaled by s; clip to the box
  blit(L, ox, oy, s, sx, sy, sw, sh, tint, alpha = 1, cx0 = -1e9, cy0 = -1e9, cx1 = 1e9, cy1 = 1e9) {
    let k = 0; while (k + 1 < L.length && s * 2 ** (k + 1) <= 1.0001) k++; const M = L[k], f = 2 ** k, sl = s * f; // sample from the level where the scale is in (0.5, 1]
    const x0 = Math.max(Math.floor(ox), Math.floor(cx0), 0), y0 = Math.max(Math.floor(oy), Math.floor(cy0), 0), x1 = Math.min(Math.ceil(ox + sw * s), Math.ceil(cx1), this.w), y1 = Math.min(Math.ceil(oy + sh * s), Math.ceil(cy1), this.h);
    const d = this.d, m = M.d, mw = M.w, mh = M.h;
    for (let py = y0; py < y1; py++) { const fy = (py + 0.5 - oy) / sl + sy / f - 0.5; if (fy < sy / f - 0.5 || fy > (sy + sh) / f - 0.5) continue; const iy = Math.floor(fy), ty = fy - iy;
      for (let px = x0; px < x1; px++) { const fx = (px + 0.5 - ox) / sl + sx / f - 0.5; if (fx < sx / f - 0.5 || fx > (sx + sw) / f - 0.5) continue; const ix = Math.floor(fx), tx = fx - ix;
        let r = 0, g = 0, b = 0, a = 0;
        for (const [jx, jy, wt] of [[ix, iy, (1 - tx) * (1 - ty)], [ix + 1, iy, tx * (1 - ty)], [ix, iy + 1, (1 - tx) * ty], [ix + 1, iy + 1, tx * ty]]) { if (jx < 0 || jy < 0 || jx >= mw || jy >= mh || !wt) continue; const i = (jy * mw + jx) * 4; r += m[i] * wt; g += m[i + 1] * wt; b += m[i + 2] * wt; a += m[i + 3] * wt; }
        if (a < 1) continue; const A = (a / 255) * alpha, i = (py * this.w + px) * 4;
        if (tint) { d[i] += (tint[0] - d[i]) * A; d[i + 1] += (tint[1] - d[i + 1]) * A; d[i + 2] += (tint[2] - d[i + 2]) * A; }
        else { d[i] = r * alpha + d[i] * (1 - A); d[i + 1] = g * alpha + d[i + 1] * (1 - A); d[i + 2] = b * alpha + d[i + 2] * (1 - A); } } } }
}

// ---------------------------------------------------------------- text
const FALLBACK = { "\u2014": "-", "–": "–", " ": " ", "’": "’", "‘": "‘", "“": "“", "”": "”" };
const glyphOf = (F, ch) => F.glyphs[ch] || F.glyphs[FALLBACK[ch]] || F.glyphs[String(ch).normalize("NFKD").replace(/[̀-ͯ]/g, "")[0]] || null;
/** Only what a card can draw: no emoji, no control characters, no em dashes. */
export const cardText = (s, n = 400) => String(s ?? "").replace(/\u2014/g, ", ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim().slice(0, n);
function measure(str, face, px, track = 0) { const F = kit().fonts[face], s = px / kit().meta.size; let w = 0; for (const ch of str) { const g = glyphOf(F, ch); w += (g ? g[2] : F.glyphs[" "][2]) * s + track; } return w; }
function wrap(str, face, px, maxW, maxLines = 99, track = 0) { const words = cardText(str).split(" ").filter(Boolean), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (measure(t, face, px, track) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } } if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); let last = keep[maxLines - 1]; while (last && measure(last + "…", face, px, track) > maxW) last = last.replace(/\s*\S+$/, ""); keep[maxLines - 1] = (last || keep[maxLines - 1]) + "…"; return keep; }
  return lines; }
function drawText(P, str, x, y, face, px, color, { track = 0, align = "left", maxW = 0 } = {}) { const K = kit(), F = K.fonts[face], atlas = K.load(F.file), s = px / K.meta.size; if (!atlas) return 0;
  let pen = align === "center" ? x - measure(str, face, px, track) / 2 : align === "right" ? x - measure(str, face, px, track) : x;
  for (const ch of str) { const g = glyphOf(F, ch); if (!g) { pen += F.glyphs[" "][2] * s + track; continue; } if (ch !== " ") P.blit(atlas, pen - F.pad * s, y - F.base * s, s, g[0], g[1], Math.ceil(g[2]) + F.pad * 2, F.cellH, color); pen += g[2] * s + track; }
  return pen - x; }
/** Wrapped lines at a baseline-to-baseline height; returns the y after the block. */
function block(P, str, x, y, maxW, face, px, color, { lh = 1.2, maxLines = 4, track = 0, align = "left" } = {}) { const L = wrap(str, face, px, maxW, maxLines, track);
  L.forEach((l, i) => drawText(P, l, align === "center" ? x + maxW / 2 : x, y + px * 0.8 + i * px * lh, face, px, color, { track, align })); return y + L.length * px * lh; }
// the biggest size (down to min) at which the text fits in maxLines lines
function fitSize(str, face, max, min, maxW, maxLines, track = 0) { for (let px = max; px > min; px -= 4) if (wrap(str, face, px, maxW, 99, track).length <= maxLines) return px; return min; }

// ---------------------------------------------------------------- the mark, the map
function mark(P, x, y, size, c) { const k = size / 48, L = (pts) => P.line(pts.map((v, i) => (i % 2 ? y : x) + v * k), c, 2.5 * k);
  P.frame(x + 1.5 * k, y + 1.5 * k, 45 * k, 45 * k, c, 2.5 * k, 6 * k);
  L([17, 11, 31, 11]); L([19, 11, 19, 15, 13, 21, 13, 30]); L([29, 11, 29, 15, 35, 21, 35, 30]); // the straight-line Potto
  const arc = []; for (let t = 0; t <= 12; t++) { const a = Math.PI - (t / 12) * Math.PI; arc.push(24 + Math.cos(a) * 11, 30 + Math.sin(a) * 7); } L(arc);
  P.circle(x + 20.5 * k, y + 26 * k, 1.9 * k, BLUE); P.circle(x + 27.5 * k, y + 26 * k, 1.9 * k, BLUE); }
function drawMap(P, M, x, y, w, h, accent) { P.rect(x, y, w, h, PAPER, 10); P.frame(x, y, w, h, INK, 4, 10);
  const X = (v) => x + 18 + v * (w - 36), Y = (v) => y + 18 + v * (h - 36);
  for (const [i, l] of (M.lines || []).entries()) { const pts = l.map((v, j) => (j % 2 ? Y(v) : X(v))); if (i === 0 && M.river) P.line(pts, WATER, 22); else P.line(pts, LINE, i < 3 ? 6 : 4); }
  for (const A of M.areas || []) { const cx = X(A.x), cy = Y(A.y), r = Math.max(26, A.r * w); const ring = []; for (let t = 0; t <= 48; t++) { const a = (t / 48) * Math.PI * 2; ring.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    P.circle(cx, cy, r, accent, { fill: true }); P.circle(cx, cy, r - 3, PAPER); P.circle(cx, cy, r - 3, [227, 232, 244]); P.line(ring, INK, 3, { dash: 1 });
    P.circle(cx, cy, 18, accent); P.circle(cx, cy, 18, INK, { fill: false, lw: 3 }); if (A.n > 1) drawText(P, String(A.n), cx, cy + 8, "sansBold", 24, PAPER, { align: "center" }); }
  for (const A of (M.areas || []).filter((a) => a.label).slice(0, 5)) { const cx = X(A.x), cy = Y(A.y), r = Math.max(26, A.r * w), t = cardText(A.label, 28), tw = measure(t, "sansBold", 26) + 20, lx = Math.min(Math.max(x + 12, cx - tw / 2), x + w - 12 - tw), ly = Math.min(cy + r + 10, y + h - 50);
    P.rect(lx, ly, tw, 38, PAPER, 6); P.frame(lx, ly, tw, 38, INK, 2.5, 6); drawText(P, t, lx + 10, ly + 28, "sansBold", 26, INK); } }

// a polaroid (delight after, server/delightafter.js): the event's drawing in a white frame, the date stamped on its wide
// bottom edge. Still no photos on a card.
function polaroid(P, spec, x, y, w, h) { const pad = Math.round(w * 0.06), bottom = Math.max(70, Math.round(h * 0.16)), side = Math.min(w - pad * 2, h - pad - bottom);
  const fw = side + pad * 2, fx = x + (w - fw) / 2; P.rect(fx + 6, y + 8, fw, side + pad + bottom, LINE, 8); P.rect(fx, y, fw, side + pad + bottom, [255, 254, 250], 8); P.frame(fx, y, fw, side + pad + bottom, INK, 3, 8);
  P.rect(fx + pad, y + pad, side, side, PAPER, 2); P.image(kit().art(spec.art) || kit().art("party"), fx + pad + side * 0.08, y + pad + side * 0.08, side * 0.84, side * 0.84);
  if (spec.stamp) drawText(P, cardText(spec.stamp, 24), fx + pad, y + pad + side + bottom * 0.62, "mono", Math.round(Math.min(40, bottom * 0.38)), SOFT, { track: 1.5 }); }

// ---------------------------------------------------------------- the two layouts
/** Every word a card will carry, in order. */
export function textOf(spec = {}) { return [spec.kicker, spec.title, spec.sub, spec.body, spec.quote?.text, spec.quote?.by, ...(spec.stats || []).flatMap((s) => [s.n, s.label]), ...(spec.list || []).flatMap((l) => [l.k, l.v]),
  ...(spec.map?.areas || []).map((a) => a.label), spec.frame === "polaroid" ? spec.stamp : "", spec.foot, "pottery lab"].filter((s) => s != null && s !== "").map((s) => cardText(s)); }

function story(spec, P, accent) { const W = P.w, H = P.h, m = 84, cw = W - m * 2, footY = H - 150;
  P.frame(36, 36, W - 72, H - 72, INK, 5, 14);
  mark(P, m, 92, 64, INK); drawText(P, "pottery lab", m + 84, 142, "sansBold", 46, INK, { track: -1.2 });
  let y = 232; if (spec.kicker) { y = block(P, cardText(spec.kicker, 60).toUpperCase(), m, y, cw, "mono", 34, accent, { maxLines: 2, track: 1.4 }) + 26; }
  if (spec.title) { const px = fitSize(spec.title, "sansBold", spec.big ? 196 : 124, 64, cw, 2, -2); y = block(P, spec.title, m, y, cw, "sansBold", px, INK, { lh: 1.04, maxLines: 2, track: -px * 0.02 }) + 22; }
  if (spec.sub) y = block(P, spec.sub, m, y, cw, "serif", 58, INK, { lh: 1.22, maxLines: 3 }) + 26;
  // the stats grid sits under the words; the picture (a map, a drawing, or Potto) takes the room left above the quote, body and list
  if (spec.stats?.length) { const S = spec.stats.slice(0, 6), rows = Math.ceil(S.length / 2), ch = 190, cwid = (cw - 18) / 2;
    S.forEach((s, i) => { const cx = m + (i % 2) * (cwid + 18), cy = y + Math.floor(i / 2) * (ch + 18); P.rect(cx, cy, cwid, ch, PAPER, 10); P.frame(cx, cy, cwid, ch, INK, 4, 10);
      const n = cardText(s.n, 14), npx = fitSize(n, "sansBold", 84, 40, cwid - 48, 1); drawText(P, n, cx + 24, cy + 24 + npx * 0.86, "sansBold", npx, INK, { track: -1.5 }); block(P, s.label, cx + 24, cy + 30 + npx, cwid - 48, "sans", 34, SOFT, { maxLines: 2, lh: 1.15 }); });
    y += rows * (ch + 18) + 16; }
  const qL = spec.quote ? wrap("“" + cardText(spec.quote.text, 280) + "”", "serif", 52, cw - 60, 5) : [], bL = spec.body ? wrap(spec.body, "sans", 44, cw - (spec.potto ? 200 : 0), 4) : [], LI = (spec.list || []).slice(0, 5);
  const afterH = (qL.length ? qL.length * 52 * 1.3 + (spec.quote.by ? 76 : 30) : 0) + (bL.length ? bL.length * 44 * 1.32 + 24 : 0) + LI.length * 104 + (spec.potto && !spec.map && !spec.art ? 0 : spec.potto ? 120 : 0);
  const room = footY - 40 - y - afterH;
  if ((spec.map || spec.art) && room > 200) { const vh = Math.min(spec.map ? 820 : 700, room - 30);
    if (spec.map) drawMap(P, spec.map, m, y, cw, vh, accent); else if (spec.frame === "polaroid") polaroid(P, spec, m + 60, y, cw - 120, vh); else P.image(kit().art(spec.art) || kit().art("party"), m + 40, y, cw - 80, vh); y += vh + 34; }
  if (qL.length) { const top = y; qL.forEach((l, i) => drawText(P, l, m + 40, y + 52 * 0.8 + i * 52 * 1.3, "serif", 52, INK)); y += qL.length * 52 * 1.3 + 10;
    if (spec.quote.by) y = block(P, spec.quote.by, m + 40, y, cw - 60, "sans", 36, SOFT, { maxLines: 1 }) + 10; P.rect(m, top, 8, y - top, accent, 3); y += 30; }
  if (bL.length) { bL.forEach((l, i) => drawText(P, l, m, y + 44 * 0.8 + i * 44 * 1.32, "sans", 44, INK)); y += bL.length * 44 * 1.32 + 24; }
  for (const it of LI) { P.line([m, y, m + cw, y], LINE, 3); drawText(P, cardText(it.k, 24).toUpperCase(), m, y + 46, "mono", 28, accent, { track: 1 }); block(P, it.v, m, y + 52, cw, "serif", 40, INK, { maxLines: 1 }); y += 104; }
  if (spec.potto) { const Pt = kit().potto(spec.potto), left = footY - 30 - y, s = Math.max(200, Math.min(320, left)); P.image(Pt, left > 330 ? m + (cw - s) / 2 : W - m - s, footY - 20 - s, s, s); }
  P.line([m, footY, m + cw, footY], INK, 3);
  drawText(P, cardText(spec.foot || "pottery lab", 48).toUpperCase(), m, footY + 70, "mono", 30, SOFT, { track: 1.2 }); const ft = cardText(spec.foot || "pottery lab", 48).toUpperCase(); if (measure(ft, "mono", 30, 1.2) + measure("FREE, ON WEB AND PHONE", "mono", 26, 1) + 40 < cw) drawText(P, "FREE, ON WEB AND PHONE", m + cw, footY + 70, "mono", 26, SOFT, { track: 1, align: "right" }); }

function link(spec, P, accent) { const W = P.w, H = P.h, m = 56; P.frame(18, 18, W - 36, H - 36, INK, 4, 10);
  const vis = spec.map || spec.art ? 470 : 0, cw = W - m * 2 - (vis ? vis + 40 : 0);
  mark(P, m, 50, 46, INK); drawText(P, "pottery lab", m + 60, 86, "sansBold", 34, INK, { track: -0.9 });
  let y = 140; if (spec.kicker) y = block(P, cardText(spec.kicker, 60).toUpperCase(), m, y, cw, "mono", 24, accent, { maxLines: 1, track: 1 }) + 16;
  if (spec.title) { const px = fitSize(spec.title, "sansBold", 92, 44, cw, 2); y = block(P, spec.title, m, y, cw, "sansBold", px, INK, { lh: 1.04, maxLines: 2, track: -px * 0.02 }) + 14; }
  if (spec.sub) y = block(P, spec.sub, m, y, cw, "serif", 38, INK, { lh: 1.22, maxLines: 2 }) + 14;
  const line = spec.body || (spec.stats || []).slice(0, 3).map((s) => `${s.n} ${s.label}`).join(" · "); if (line && y < H - 140) block(P, line, m, y, cw, "sans", 30, SOFT, { lh: 1.3, maxLines: Math.max(1, Math.floor((H - 110 - y) / 39)) });
  if (spec.map) drawMap(P, spec.map, W - m - vis, 50, vis, H - 100, accent); else if (spec.frame === "polaroid") polaroid(P, spec, W - m - vis + 40, 50, vis - 80, H - 100); else if (spec.art) P.image(kit().art(spec.art) || kit().art("party"), W - m - vis, 80, vis, H - 160);
  drawText(P, cardText(spec.foot || "pottery lab", 48).toUpperCase(), m, H - 54, "mono", 22, SOFT, { track: 1 }); }

const cache = new Map();
/** The card as a PNG: size "story" (1080x1920) or "link" (1200x630). Same spec, same bytes (kept for a while). */
export function renderCard(spec = {}, size = "story") { const S = SIZES[size] || SIZES.story, key = size + JSON.stringify(spec);
  if (cache.has(key)) return cache.get(key);
  const bg = hex(TONES[spec.tone] || TONES.linen), accent = hex(spec.accent) || BLUE, P = new Paper(S.w, S.h, bg);
  (size === "link" ? link : story)(spec, P, accent);
  const png = encodePng(S.w, S.h, P.d); if (cache.size > 60) cache.delete(cache.keys().next().value); cache.set(key, png); return png; }

// ---------------------------------------------------------------- off the main thread
// Drawing a story card takes a moment of CPU, so the server asks a worker for it and keeps answering requests meanwhile.
// One worker, made when first needed; if it can't start or fails, the card is drawn here instead.
let worker = null, seq = 0, idleT = null; const waits = new Map();
// the worker holds the process open only while a card is being drawn; with nothing to do it is ended after a quiet while
function idle() { clearTimeout(idleT); idleT = setTimeout(() => { if (worker && !waits.size) { const w = worker; worker = null; w.terminate().catch(() => {}); } }, 30_000); idleT.unref?.(); }
function startWorker() { if (worker !== null) return worker; try { worker = new Worker(new URL(import.meta.url), { workerData: { plShareCards: true } });
    worker.on("message", ({ id, png, err }) => { const w = waits.get(id); if (!w) return; waits.delete(id); if (err || !png) w.fail(); else w.ok(Buffer.from(png)); if (!waits.size) { worker?.unref?.(); idle(); } });
    worker.on("error", () => { for (const w of waits.values()) w.fail(); waits.clear(); worker = false; }); worker.on("exit", () => { for (const w of waits.values()) w.fail(); waits.clear(); worker = null; }); worker.unref(); }
  catch { worker = false; } return worker; }
/** The same PNG as renderCard, drawn in a worker thread. */
export function renderCardAsync(spec = {}, size = "story") { const key = (SIZES[size] ? size : "story") + JSON.stringify(spec); if (cache.has(key)) return Promise.resolve(cache.get(key));
  const W = startWorker(); if (!W) return Promise.resolve(renderCard(spec, size));
  return new Promise((resolve) => { const id = ++seq; waits.set(id, { ok: (png) => { if (cache.size > 60) cache.delete(cache.keys().next().value); cache.set(key, png); resolve(png); }, fail: () => resolve(renderCard(spec, size)) }); W.ref(); W.postMessage({ id, spec, size }); }); }
if (!isMainThread && workerData?.plShareCards) parentPort.on("message", ({ id, spec, size }) => { try { const png = renderCard(spec, size), out = new Uint8Array(png); parentPort.postMessage({ id, png: out }, [out.buffer]); } catch (e) { parentPort.postMessage({ id, err: String(e?.message || e) }); } });
