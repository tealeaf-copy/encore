// The Pantry look's drawings, shared by the event page (looks.js "Jar wall" effect) and the host page (storefront.js
// "Pantry shelf" cover): a wall of wooden cubbies with backlit jars, and a faint hex-tile floor for backgrounds.
// Original artwork, drawn here as SVG. Works in the browser (window.EncorePantry) and under node for tests.
(function (root) {
  // a small seeded random, so the same event always gets the same shelf
  const rng = (seed) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const hash = (s) => { let h = 7; for (const c of String(s ?? "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  // what's in the jars: pickles and herbs (greens), honey and preserved lemons (golds), apricots and chili (oranges)
  const JARS = [["#6E8B2E", "#9DB548"], ["#8A9A34", "#B9C25A"], ["#4F7A3A", "#86A65A"], ["#D9A21F", "#F2C64E"], ["#E2B23A", "#F6D774"], ["#D46A1F", "#F09A45"], ["#C2521C", "#E9813E"], ["#B8781E", "#E0A548"]];
  let gid = 0;
  /** A wall of wooden cubbies packed with jars, lit warm from behind. w and h in px; seed picks the jars. */
  function jarWall(w = 960, h = 300, seed = 1) { const R = rng(seed), id = "jw" + ++gid, W = Math.max(240, Math.round(w)), H = Math.max(120, Math.round(h));
    const beam = 16, cw = W < 560 ? 84 : 104, cols = Math.max(3, Math.round(W / cw)), cx = W / cols, rows = Math.max(1, Math.round((H - beam) / 96)), cy = (H - beam) / rows;
    let cells = "", jars = "";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = c * cx, y = beam + r * cy, ix = x + 7, iy = y + 6, iw = cx - 14, ih = cy - 16;
      cells += `<rect x="${f1(ix)}" y="${f1(iy)}" width="${f1(iw)}" height="${f1(ih)}" fill="url(#${id}g)"/>`;
      // two or three jars a cubby, standing on the shelf, each its own height
      const n = iw > 74 ? 3 : 2, gap = 4, jw = (iw - gap * (n + 1)) / n;
      for (let k = 0; k < n; k++) { const [body, light] = JARS[Math.floor(R() * JARS.length)], jh = ih * (0.62 + R() * 0.28), wj = jw * (0.86 + R() * 0.14), jx = ix + gap + k * (jw + gap) + (jw - wj) / 2, jy = iy + ih - jh, rx = Math.min(10, wj * 0.24), lid = 7, neck = wj * 0.78;
        const fill = jy + lid + 3 + (jh - lid) * (0.08 + R() * 0.14), bits = [];
        // what floats inside: pickle rounds or a few fruit halves, a shade lighter
        for (let q = 0, m = 2 + Math.floor(R() * 3); q < m; q++) bits.push(`<ellipse cx="${f1(jx + wj * (0.25 + R() * 0.5))}" cy="${f1(fill + 6 + R() * (jy + jh - fill - 12))}" rx="${f1(wj * (0.12 + R() * 0.08))}" ry="${f1(wj * (0.09 + R() * 0.06))}" fill="${light}" opacity=".75"/>`);
        jars += `<g><rect x="${f1(jx)}" y="${f1(jy + lid)}" width="${f1(wj)}" height="${f1(jh - lid)}" rx="${f1(rx)}" fill="#FFF3D6" opacity=".35"/>`
          + `<path d="M${f1(jx)} ${f1(fill + rx)}q0-${f1(rx)} ${f1(rx)}-${f1(rx)}h${f1(wj - rx * 2)}q${f1(rx)} 0 ${f1(rx)} ${f1(rx)}V${f1(jy + jh - rx)}q0 ${f1(rx)}-${f1(rx)} ${f1(rx)}H${f1(jx + rx)}q-${f1(rx)} 0-${f1(rx)}-${f1(rx)}z" fill="${body}" opacity=".9"/>${bits.join("")}`
          + `<rect x="${f1(jx + wj * 0.16)}" y="${f1(jy + lid + 6)}" width="${f1(Math.max(2, wj * 0.1))}" height="${f1(Math.max(4, jh * 0.5))}" rx="2" fill="#FFFFFF" opacity=".42"/>`
          + `<rect x="${f1(jx + (wj - neck) / 2)}" y="${f1(jy)}" width="${f1(neck)}" height="${lid}" rx="2" fill="#FBF8F1" stroke="#D9CDB6" stroke-width="1"/><path d="M${f1(jx + (wj - neck) / 2 + 2)} ${f1(jy + 3.5)}h${f1(neck - 4)}" stroke="#E4DACB" stroke-width="1"/></g>`; } }
    // the wood: a frame around every cubby, a lip on each shelf, and a ceiling beam
    let wood = `<rect width="${W}" height="${H}" fill="#6B3E1C"/>`;
    for (let c = 0; c <= cols; c++) wood += `<rect x="${f1(c * cx - 7)}" y="${beam}" width="14" height="${H - beam}" fill="#7D4A22"/><rect x="${f1(c * cx - 7)}" y="${beam}" width="3" height="${H - beam}" fill="#9A6234"/>`;
    let lips = ""; for (let r = 1; r <= rows; r++) { const y = beam + r * cy - 10; lips += `<rect x="0" y="${f1(y)}" width="${W}" height="10" fill="#8A5428"/><rect x="0" y="${f1(y)}" width="${W}" height="2.5" fill="#B37A45"/>`; }
    return `<svg class="pt-wall" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false"><defs><radialGradient id="${id}g" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="#FFE1A0"/><stop offset=".45" stop-color="#F2B455"/><stop offset="1" stop-color="#A9601F"/></radialGradient></defs>`
      + wood + `<g class="pt-glow">${cells}</g>${jars}${lips}<rect x="0" y="0" width="${W}" height="${beam}" fill="#4A2A12"/><rect x="0" y="${beam - 3}" width="${W}" height="3" fill="#2E1A0B" opacity=".6"/></svg>`; }

  // ---- the hex-tile floor: light grey hexes, a few white ones, very low contrast so text always reads ----
  function hexTile(s = 13) { const H = Math.sqrt(3) * s, W = 3 * s, hex = (x, y, fill, a) => { let d = ""; for (let i = 0; i < 6; i++) { const t = (Math.PI / 3) * i; d += (i ? "L" : "M") + f1(x + s * Math.cos(t)) + " " + f1(y + s * Math.sin(t)); } return `<path d="${d}Z" fill="${fill}" fill-opacity="${a}" stroke="#5A4A3A" stroke-opacity=".07" stroke-width="1"/>`; };
    // a 2 x 2 block of the basic tile, so one hex in eight can be the white one
    let g = ""; const pts = []; for (let bx = 0; bx < 2; bx++) for (let by = 0; by < 2; by++) { const ox = bx * W, oy = by * H; pts.push([ox, oy], [ox + W, oy], [ox, oy + H], [ox + W, oy + H], [ox + 1.5 * s, oy + H / 2]); }
    const seen = new Set(); pts.forEach(([x, y], i) => { const k = f1(x) + "," + f1(y); if (seen.has(k)) return; seen.add(k); g += hex(x, y, "#FFFFFF", i === 9 || i === 19 ? 0.2 : 0.05); });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f1(W * 2)}" height="${f1(H * 2)}" viewBox="0 0 ${f1(W * 2)} ${f1(H * 2)}">${g}</svg>`;
    return { url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: `${f1(W * 2)}px ${f1(H * 2)}px` }; }

  root.EncorePantry = { jarWall, hexTile, hash, rng, JARS };
})(typeof window !== "undefined" ? window : globalThis);
