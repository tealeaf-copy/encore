// Collab covers: "Brand × Coffee shop" event posters. A warm, painted café scene, the two names up top,
// a big blobby stacked title in the middle and one line in caps at the bottom. Drawn on a canvas so it
// can be downloaded or saved as an event's cover photo.
(function () {
  const W = 1080, H = 1350;
  const LOOKS = {
    lanterns: { name: "Paper lanterns", bg: ["#2A1A12", "#120B08"], wood: ["#9A5E2E", "#5E3518"], glow: "#FFD9A0" },
    counter: { name: "Espresso bar", bg: ["#1F3A30", "#0E1D18"], wood: ["#B07A45", "#6A4122"], glow: "#FFE2B0" },
    rooftop: { name: "Rooftop at dusk", bg: ["#F2A65A", "#5B3A6E"], wood: ["#3A2A3E", "#1C1420"], glow: "#FFE7B5" },
    window: { name: "Shop window at night", bg: ["#1B2238", "#0B0F1C"], wood: ["#2B2F45", "#151827"], glow: "#FFC97A" },
  };
  let fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    if (!document.querySelector("link[data-cc-fonts]")) { const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.ccFonts = "1"; l.href = "https://fonts.googleapis.com/css2?family=Modak&family=Archivo+Black&display=swap"; document.head.appendChild(l); }
    fontsReady = Promise.race([Promise.all([document.fonts.load('200px "Modak"', "Sip"), document.fonts.load('60px "Archivo Black"', "AB")]), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
    return fontsReady;
  }
  // a seeded random so the same cover always looks the same
  const rng = (seed) => { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; s = s || 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const hexA = (hex, a) => { const n = parseInt(String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const okHex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d);

  function vgrad(x, y0, y1, a, b) { const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
  function glow(x, cx, cy, r, col, a) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); }
  function lantern(x, cx, cy, r, L) {
    x.strokeStyle = "rgba(20,12,8,.7)"; x.lineWidth = 4; x.beginPath(); x.moveTo(cx, -10); x.lineTo(cx, cy - r); x.stroke();
    glow(x, cx, cy, r * 2.2, L.glow, 0.28);
    const g = x.createRadialGradient(cx - r * 0.25, cy - r * 0.2, r * 0.1, cx, cy, r); g.addColorStop(0, "#FFF3DD"); g.addColorStop(0.65, "#F4D9AE"); g.addColorStop(1, "#C99560");
    x.save(); x.beginPath(); x.ellipse(cx, cy, r, r * 0.94, 0, 0, Math.PI * 2); x.fillStyle = g; x.fill(); x.clip();
    x.strokeStyle = "rgba(150,100,55,.28)"; x.lineWidth = 2; for (let yy = cy - r; yy < cy + r; yy += r / 11) { x.beginPath(); x.ellipse(cx, yy, r * 1.05, r * 0.08, 0, 0, Math.PI); x.stroke(); }
    x.restore();
  }
  function grain(x, R, n) { for (let i = 0; i < n; i++) { x.fillStyle = R() < 0.5 ? "rgba(255,240,220,.05)" : "rgba(0,0,0,.08)"; x.fillRect(R() * W, R() * H, 2, 2); } }
  function vignette(x) { const g = x.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.5, H * 0.78); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.62)"); x.fillStyle = g; x.fillRect(0, 0, W, H); }

  const SCENES = {
    lanterns(x, L, R, acc) {
      x.fillStyle = vgrad(x, 0, H, L.bg[0], L.bg[1]); x.fillRect(0, 0, W, H);
      // back shelves with jars and bags
      for (let s = 0; s < 3; s++) { const y = 330 + s * 150; x.fillStyle = "rgba(255,220,180,.06)"; x.fillRect(0, y, 300, 10); x.fillRect(W - 280, y + 40, 280, 10);
        for (let i = 0; i < 6; i++) { x.fillStyle = i % 3 === 0 ? hexA(acc, 0.35) : "rgba(230,200,160,.14)"; const bx = 20 + i * 46 + R() * 8, bh = 40 + R() * 50; x.fillRect(bx, y - bh, 32, bh); const bx2 = W - 260 + i * 42, bh2 = 30 + R() * 60; x.fillRect(bx2, y + 40 - bh2, 30, bh2); } }
      // floor and the wooden table in perspective
      x.fillStyle = "#1A110C"; x.fillRect(0, H * 0.62, W, H);
      x.beginPath(); x.moveTo(260, 830); x.lineTo(880, 800); x.lineTo(1040, 1150); x.lineTo(120, 1200); x.closePath(); x.fillStyle = vgrad(x, 800, 1200, L.wood[0], L.wood[1]); x.fill();
      x.strokeStyle = "rgba(60,30,12,.35)"; x.lineWidth = 2; for (let i = 1; i < 9; i++) { x.beginPath(); x.moveTo(260 + i * 69, 830 - i * 3.3); x.lineTo(120 + i * 102, 1200 - i * 5.5); x.stroke(); }
      // cups, a kettle, a notebook on the table
      [[380, 900], [520, 960], [720, 905], [820, 1010]].forEach(([cx, cy], i) => { x.fillStyle = i === 2 ? acc : "#EDE3D3"; x.beginPath(); x.ellipse(cx, cy, 30, 12, 0, 0, Math.PI * 2); x.fill(); x.fillRect(cx - 30, cy, 60, 34); x.beginPath(); x.ellipse(cx, cy + 34, 30, 12, 0, 0, Math.PI); x.fill(); });
      x.fillStyle = "#26201C"; x.fillRect(600, 1040, 120, 70); x.fillStyle = "rgba(255,255,255,.08)"; x.fillRect(606, 1046, 108, 58);
      lantern(x, 330, 250, 230, L); lantern(x, 860, 560, 190, L); lantern(x, 620, 120, 90, L);
    },
    counter(x, L, R, acc) {
      x.fillStyle = vgrad(x, 0, H, L.bg[0], L.bg[1]); x.fillRect(0, 0, W, H);
      // subway tile
      x.strokeStyle = "rgba(255,255,255,.05)"; x.lineWidth = 2; for (let y = 0; y < 800; y += 46) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); for (let xx = (y / 46) % 2 ? 0 : 60; xx < W; xx += 120) { x.beginPath(); x.moveTo(xx, y); x.lineTo(xx, y + 46); x.stroke(); } }
      // pendant lights
      [200, 540, 880].forEach((cx) => { x.strokeStyle = "#0A0A0A"; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, 0); x.lineTo(cx, 150); x.stroke(); x.fillStyle = "#151515"; x.beginPath(); x.moveTo(cx - 70, 210); x.lineTo(cx - 30, 150); x.lineTo(cx + 30, 150); x.lineTo(cx + 70, 210); x.fill(); glow(x, cx, 240, 340, L.glow, 0.3); });
      // shelf of cups
      x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(60, 520, W - 120, 14); for (let i = 0; i < 14; i++) { x.fillStyle = i % 4 === 1 ? acc : "#EDE3D3"; const cx = 90 + i * 66; x.fillRect(cx, 470, 44, 50); x.beginPath(); x.arc(cx + 50, 492, 12, -1.4, 1.4); x.strokeStyle = x.fillStyle; x.lineWidth = 6; x.stroke(); }
      // espresso machine and the counter
      x.fillStyle = "#C9CDD1"; x.fillRect(300, 640, 480, 230); x.fillStyle = "#9CA2A8"; x.fillRect(300, 640, 480, 40); x.fillStyle = acc; x.fillRect(330, 700, 420, 50); [380, 540, 700].forEach((cx) => { x.fillStyle = "#2B2B2B"; x.fillRect(cx - 18, 760, 36, 60); });
      for (let i = 0; i < 3; i++) { x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 6; x.beginPath(); x.moveTo(420 + i * 120, 630); x.bezierCurveTo(400 + i * 120, 580, 450 + i * 120, 560, 425 + i * 120, 500); x.stroke(); }
      x.fillStyle = vgrad(x, 860, H, L.wood[0], L.wood[1]); x.fillRect(0, 860, W, H); x.fillStyle = "rgba(255,230,200,.25)"; x.fillRect(0, 860, W, 10);
      x.strokeStyle = "rgba(40,20,8,.35)"; x.lineWidth = 3; for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(i * 96, 960); x.lineTo(i * 96, H); x.stroke(); } x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(0, 950, W, 14);
      // a pastry case, cups and a plant on the counter
      x.fillStyle = "rgba(255,255,255,.18)"; x.beginPath(); x.ellipse(160, 860, 110, 90, 0, Math.PI, Math.PI * 2); x.fill(); x.fillStyle = "#D99A55"; [[110, 845], [160, 838], [210, 845]].forEach(([cx, cy]) => { x.beginPath(); x.ellipse(cx, cy, 28, 16, 0, 0, Math.PI * 2); x.fill(); });
      [[830, acc], [900, "#EDE3D3"], [965, "#EDE3D3"]].forEach(([cx, c]) => { x.fillStyle = c; x.fillRect(cx - 24, 816, 48, 44); x.beginPath(); x.ellipse(cx, 816, 24, 8, 0, 0, Math.PI * 2); x.fill(); });

    },
    rooftop(x, L, R, acc) {
      x.fillStyle = vgrad(x, 0, H * 0.75, L.bg[0], L.bg[1]); x.fillRect(0, 0, W, H);
      glow(x, W * 0.7, H * 0.55, 420, "#FFE0A0", 0.55);
      // skyline
      let xx = -20; while (xx < W) { const w = 60 + R() * 110, h = 180 + R() * 380; x.fillStyle = "#2A1D33"; x.fillRect(xx, H * 0.72 - h, w, h + 400); for (let wy = H * 0.72 - h + 20; wy < H * 0.72; wy += 34) for (let wx = xx + 12; wx < xx + w - 16; wx += 26) if (R() < 0.35) { x.fillStyle = "rgba(255,210,140,.75)"; x.fillRect(wx, wy, 10, 14); } xx += w + 8; }
      // the deck, planters and a table
      x.fillStyle = vgrad(x, H * 0.72, H, L.wood[0], L.wood[1]); x.fillRect(0, H * 0.72, W, H);
      x.strokeStyle = "rgba(255,220,180,.08)"; for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(i * 100, H * 0.72); x.lineTo(i * 140 - 220, H); x.stroke(); }
      [[90, 1020], [990, 1040]].forEach(([cx, cy]) => { x.fillStyle = "#3E5B3A"; for (let k = 0; k < 7; k++) { x.beginPath(); x.ellipse(cx + (R() - 0.5) * 120, cy - 60 - R() * 120, 40, 70, R() - 0.5, 0, Math.PI * 2); x.fill(); } x.fillStyle = "#6E4A2E"; x.fillRect(cx - 70, cy - 20, 140, 120); });
      x.fillStyle = acc; x.fillRect(400, 1080, 280, 26); x.fillRect(420, 1106, 14, 120); x.fillRect(646, 1106, 14, 120);
      // string lights
      for (const [y0, sag] of [[150, 140], [310, 110]]) { x.strokeStyle = "rgba(20,10,20,.8)"; x.lineWidth = 3; x.beginPath(); for (let i = 0; i <= 40; i++) { const t = i / 40, px = t * W, py = y0 + Math.sin(t * Math.PI) * sag; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); for (let i = 1; i < 14; i++) { const t = i / 14, px = t * W, py = y0 + Math.sin(t * Math.PI) * sag + 14; glow(x, px, py, 40, L.glow, 0.7); x.fillStyle = "#FFF4D8"; x.beginPath(); x.arc(px, py, 8, 0, Math.PI * 2); x.fill(); } }
    },
    window(x, L, R, acc) {
      x.fillStyle = vgrad(x, 0, H, L.bg[0], L.bg[1]); x.fillRect(0, 0, W, H);
      // brick facade
      x.fillStyle = "#3A2620"; x.fillRect(60, 120, W - 120, 1000); x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 2; for (let y = 120; y < 1120; y += 30) { x.beginPath(); x.moveTo(60, y); x.lineTo(W - 60, y); x.stroke(); }
      // awning stripes in the brand color
      for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? "#F3EBDD" : acc; x.beginPath(); const x0 = 80 + i * 77; x.moveTo(x0, 240); x.lineTo(x0 + 77, 240); x.lineTo(x0 + 77 + 8, 360); x.lineTo(x0 + 8, 360); x.fill(); x.beginPath(); x.arc(x0 + 46, 360, 38.5, 0, Math.PI); x.fill(); }
      // the window: warm glow, people inside
      x.fillStyle = vgrad(x, 420, 1000, "#FFD79A", "#E59A4B"); x.fillRect(130, 420, W - 260, 560); glow(x, W / 2, 700, 600, L.glow, 0.35);
      for (let i = 0; i < 7; i++) { const cx = 210 + i * 115 + R() * 30, cy = 760 + R() * 60; x.fillStyle = `rgba(70,35,20,${0.55 + R() * 0.3})`; x.beginPath(); x.arc(cx, cy - 110, 34, 0, Math.PI * 2); x.fill(); x.beginPath(); x.ellipse(cx, cy + 20, 58, 110, 0, Math.PI, Math.PI * 2); x.fill(); x.fillRect(cx - 58, cy + 20, 116, 220); }
      x.fillStyle = "#2B1B14"; x.fillRect(130, 960, W - 260, 30); x.strokeStyle = "#20130E"; x.lineWidth = 14; x.strokeRect(130, 420, W - 260, 560); x.beginPath(); x.moveTo(W / 2, 420); x.lineTo(W / 2, 980); x.stroke();
      // sidewalk and a street lamp
      x.fillStyle = "#14161F"; x.fillRect(0, 1120, W, H); glow(x, 1000, 160, 260, L.glow, 0.4);
    },
  };

  // the blobby title: letter by letter, each with a little tilt and bounce, stacked lines
  function blobTitle(x, text, cx, cy, maxW, maxH, ink, R) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean); if (!words.length) return;
    const opts = [[words.join(" ")]]; for (let i = 1; i < words.length; i++) opts.push([words.slice(0, i).join(" "), words.slice(i).join(" ")]);
    if (words.length >= 3) for (let i = 1; i < words.length - 1; i++) for (let j = i + 1; j < words.length; j++) opts.push([words.slice(0, i).join(" "), words.slice(i, j).join(" "), words.slice(j).join(" ")]);
    const ADV = 0.9, LH = 0.7, widthOf = (l, sz) => { x.font = `${sz}px Modak`; return [...l].reduce((w, c) => w + x.measureText(c).width * ADV, 0); };
    let best = null; for (const lines of opts) { let sz = Math.min(470, maxH / (lines.length * LH + 0.25)); const w = Math.max(...lines.map((l) => widthOf(l, sz))); if (w > maxW) sz *= maxW / w; const bal = Math.max(...lines.map((l) => l.length)) - Math.min(...lines.map((l) => l.length)); const score = sz - bal * 3; if (!best || score > best.score) best = { lines, sz, score }; }
    const { lines, sz: size } = best; x.font = `${size}px Modak`;
    const lh = size * LH, top = cy - (lh * (lines.length - 1)) / 2;
    lines.forEach((ln, li) => {
      const w = widthOf(ln, size), room = (maxW - w) / 2, off = lines.length > 1 ? (li % 2 ? 1 : -1) * Math.min(90, room) : 0; let px = cx - w / 2 + off; const py = top + li * lh; x.font = `${size}px Modak`;
      for (const ch of ln) { const cw = x.measureText(ch).width, rot = (R() - 0.5) * 0.24, dy = (R() - 0.5) * size * 0.14;
        x.save(); x.translate(px + cw / 2, py + dy); x.rotate(rot); x.textAlign = "center"; x.textBaseline = "middle";
        x.fillStyle = "rgba(0,0,0,.3)"; x.fillText(ch, 7, 11); x.fillStyle = ink; x.fillText(ch, 0, 0); x.restore(); px += cw * ADV; }
    });
  }
  function spaced(x, text, cx, y, size, color, track) { x.font = `${size}px "Archivo Black"`; x.textAlign = "left"; x.textBaseline = "alphabetic"; const chars = [...text]; const w = chars.reduce((s, c) => s + x.measureText(c).width + track, -track); let px = cx - w / 2; x.fillStyle = color; for (const c of chars) { x.fillText(c, px, y); px += x.measureText(c).width + track; } return w; }

  async function draw(canvas, o) {
    await loadFonts();
    const look = LOOKS[o.look] ? o.look : "lanterns", L = LOOKS[look], acc = okHex(o.accent, "#C94A30"), R = rng([o.brand, o.shop, o.title, look].join("|"));
    canvas.width = W; canvas.height = H; const x = canvas.getContext("2d");
    SCENES[look](x, L, R, acc); grain(x, R, 9000);
    // darken behind the type so it always reads
    x.fillStyle = "rgba(10,6,4,.32)"; x.fillRect(0, 0, W, H); vignette(x);
    const ink = okHex(o.ink, "#F4ECDD");
    // BRAND × SHOP
    const b = String(o.brand || "Your brand").toUpperCase().slice(0, 22), s = String(o.shop || "Coffee shop").toUpperCase().slice(0, 22);
    let size = 78; x.font = `${size}px "Archivo Black"`; while (x.measureText(`${b} × ${s}`).width > W - 160 && size > 34) { size -= 2; x.font = `${size}px "Archivo Black"`; }
    const bw = x.measureText(b).width, sw = x.measureText(s).width, gap = size * 0.9, total = bw + gap + sw, x0 = (W - total) / 2, y = 150;
    x.fillStyle = ink; x.textAlign = "left"; x.textBaseline = "alphabetic"; x.fillText(b, x0, y); x.fillText(s, x0 + bw + gap, y);
    x.lineWidth = size * 0.09; x.strokeStyle = ink; x.lineCap = "round"; const mx = x0 + bw + gap / 2, my = y - size * 0.36, d = size * 0.17; x.beginPath(); x.moveTo(mx - d, my - d); x.lineTo(mx + d, my + d); x.moveTo(mx + d, my - d); x.lineTo(mx - d, my + d); x.stroke();
    blobTitle(x, o.title || "Sip n' Meet", W / 2, H * 0.52, W - 150, H * 0.66, ink, R);
    // bottom line in caps
    const line = String(o.line || "").toUpperCase().slice(0, 48); if (line) { let ls = 44; x.font = `${ls}px "Archivo Black"`; while (x.measureText(line).width + line.length * 2 > W - 120 && ls > 22) { ls -= 2; x.font = `${ls}px "Archivo Black"`; } spaced(x, line, W / 2, H - 80, ls, ink, 1.5); }
    if (o.when) { x.font = '30px "Archivo Black"'; const t = String(o.when).toUpperCase().slice(0, 40); spaced(x, t, W / 2, H - 80 - 58, 28, hexA(ink.length === 7 ? ink : "#F4ECDD", 0.85), 3); }
    return canvas;
  }
  window.CollabCover = { draw, LOOKS, W, H, loadFonts };
})();
