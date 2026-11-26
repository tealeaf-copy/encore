// A tiny QR code encoder for the share sheet's "QR code" card (public/sharekit.js). Byte mode, any error correction
// level, versions 1 to 40, the best of the 8 masks. No network, no dependencies.
// PLQR.encode("https://…", "H") -> { size, version, mask, get(x, y) } ; PLQR.toCanvas(text, { px, margin, ecl, dark, light })
//
// Ported from Project Nayuki's QR Code generator library (https://www.nayuki.io/page/qr-code-generator-library).
// Copyright (c) Project Nayuki. MIT License:
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions:
// - The above copyright notice and this permission notice shall be included in all copies or substantial portions of
//   the Software.
// - The Software is provided "as is", without warranty of any kind, express or implied, including but not limited to
//   the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the
//   authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract,
//   tort or otherwise, arising from, out of or in connection with the Software or the use or other dealings in the
//   Software.
(function () {
  if (window.PLQR) return;
  const ECC = { L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30] };
  const BLOCKS = { L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81] };
  const FMT = { L: 1, M: 0, Q: 3, H: 2 };
  const bit = (x, i) => ((x >>> i) & 1) !== 0;
  const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC[e][v] * BLOCKS[e][v];
  const gmul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; };
  function rsDivisor(deg) { const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
    for (let i = 0; i < deg; i++) { for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gmul(root, 2); } return r; }
  function rsRemainder(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); } return r; }

  function encode(text, ecl = "M") {
    const bytes = [...new TextEncoder().encode(String(text))];
    let ver = 1, cc = 8;
    for (; ver <= 40; ver++) { cc = ver < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(ver, ecl) * 8) break; }
    if (ver > 40) throw new Error("Too long for a QR code");
    // data bits: byte mode, count, bytes, terminator, padding
    const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, cc); bytes.forEach((b) => put(b, 8));
    const cap = dataCodewords(ver, ecl) * 8; put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    // error correction, interleaved
    const nb = BLOCKS[ecl][ver], el = ECC[ecl][ver], raw = Math.floor(rawModules(ver) / 8), nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDivisor(el), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += d.length; const e = rsRemainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e)); }
    const all = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) all.push(b[i]); });
    // the grid
    const size = ver * 4 + 17, M = Array.from({ length: size }, () => new Array(size).fill(false)), F = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < size; i++) { fn(6, i, i % 2 === 0); fn(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) fn(x, y, d !== 2 && d !== 4); }
    const al = []; if (ver > 1) { const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2; al.push(6); for (let p = size - 7; al.length < n; p -= step) al.splice(1, 0, p); }
    al.forEach((a, i) => al.forEach((b, j) => { if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fn(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
    const format = (mask) => { const d = (FMT[ecl] << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412;
      for (let i = 0; i <= 5; i++) fn(8, i, bit(b, i)); fn(8, 7, bit(b, 6)); fn(8, 8, bit(b, 7)); fn(7, 8, bit(b, 8)); for (let i = 9; i < 15; i++) fn(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) fn(size - 1 - i, 8, bit(b, i)); for (let i = 8; i < 15; i++) fn(8, size - 15 + i, bit(b, i)); fn(8, size - 8, true); };
    format(0);
    if (ver >= 7) { let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const b = (ver << 12) | r; for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); fn(a, c, bit(b, i)); fn(c, a, bit(b, i)); } }
    let i = 0; for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v; if (!F[y][x] && i < all.length * 8) { M[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; } } }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
    // penalty: runs of 5+, 2x2 blocks, finder-like patterns, and the dark/light balance
    const penalty = () => { let p = 0, dark = 0; const line = (get) => { let run = 1, s = 0; for (let k = 1; k < size; k++) { if (get(k) === get(k - 1)) run++; else { if (run >= 5) s += run - 2; run = 1; } } if (run >= 5) s += run - 2; return s; };
      for (let k = 0; k < size; k++) { p += line((t) => M[k][t]) + line((t) => M[t][k]); }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      for (let y = 0; y < size; y++) for (let x = 0; x + 11 <= size; x++) { let a = true, b = true, c = true, d = true; for (let k = 0; k < 11; k++) { if (+M[y][x + k] !== pat[k]) a = false; if (+M[y][x + k] !== pat2[k]) b = false; if (+M[x + k][y] !== pat[k]) c = false; if (+M[x + k][y] !== pat2[k]) d = false; } p += 40 * (a + b + c + d); }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (M[y][x]) dark++;
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10; };
    let best = 0, bestP = Infinity; for (let m = 0; m < 8; m++) { apply(m); format(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } apply(m); }
    apply(best); format(best);
    return { size, version: ver, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && M[y][x] };
  }
  /** Draws the code on a canvas: rounded-off dots are not used, so every phone camera reads it. */
  function toCanvas(text, o = {}) { const q = encode(text, o.ecl || "H"), m = o.margin ?? 4, px = o.px || 8, n = q.size + m * 2, c = o.canvas || document.createElement("canvas"); c.width = c.height = n * px;
    const g = c.getContext("2d"); g.fillStyle = o.light || "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = o.dark || "#000";
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) g.fillRect((x + m) * px, (y + m) * px, px, px);
    return { canvas: c, qr: q }; }
  window.PLQR = { encode, toCanvas };
})();
