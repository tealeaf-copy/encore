// Event effects: the quiet motion behind an invite (confetti, petals, steam over a dinner, string lights along the top).
// One file draws them everywhere: the guest invite (/e), the full invite (/g), the create canvas and its live preview, and
// the little moving thumbnails in the canvas's Effect tray. public/looks.js loads this file the first time a page has an
// effect (window.EncoreEffects), so pages without one never fetch it. server/looks.js keeps the same list of ids.
// Calm by design: line art in the event's own colours, a capped number of shapes, 30 frames a second from one shared
// requestAnimationFrame, nothing drawn while the tab is hidden or the effect is off screen, a layer that never takes
// space (no layout shift) or a tap, and a still frame for anyone who prefers less motion.
(function (root) {
  "use strict";
  if (root.EncoreEffects) return;
  // drawn here; the older vibe effects (velvet, lanterns, scanlines, pixels, jar wall) are still drawn by looks.js effect()
  const IDS = ["none", "paper", "stars", "twinkle", "confetti", "streamers", "balloons", "bulbs", "sparkles", "dice", "petals", "snow", "leaves", "rain", "steam", "bubbles"];
  const LEGACY = ["velvet", "lanterns", "scanlines", "pixels", "jarwall"];
  const LEVELS = ["subtle", "lively"];
  const levelOf = (L) => (L && L.effectLevel === "lively" ? "lively" : "subtle");

  // ---------- colours: the event's own (its look, else its cover tone), mixed toward paper so nothing shouts ----------
  const norm = (h) => (/^#[0-9a-f]{6}$/i.test(h || "") ? h.toUpperCase() : "");
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { a = norm(a) || "#888888"; b = norm(b) || "#888888"; const A = rgb(a), B = rgb(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase(); };
  const INK = "#1B1D1C", PAPER = "#FAF8F3";
  /** The colours an effect draws with: the event's accent, a deeper ink accent and a pastel, from its look or its cover tone. */
  function colorsFor(look, event, theme) { const p = ((look && look.palette) || []).map(norm).filter(Boolean), A = root.EventArt; let tone = "";
    try { if (A) { const pick = event && event.coverArt; const kind = (A.valid && pick && A.valid(pick.kind) && pick.kind) || A.kindOf(event || {}); tone = (pick && A.PASTELS[pick.tone] && pick.tone) || A.toneOf(event || {}, kind); } } catch { tone = ""; }
    const T = theme || {}, spot = A && A.SPOT && A.SPOT[tone], pastelTone = A && A.PASTELS && A.PASTELS[tone];
    const accent = norm(T.spot) || p[2] || spot || "#9A4128", deep = norm(T.link) || p[1] || "#29489A", pastel = p[0] || pastelTone || "#E9DFC9";
    return { accent, deep, pastel, ink: INK, warm: mix("#E2A73F", accent, 0.2), soft: mix(accent, PAPER, 0.55) }; }

  // ---------- the kinds: how many (at 1280x800; fewer on a small screen), how each shape is born, moves and is drawn ----------
  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a), pick = (L) => L[(Math.random() * L.length) | 0];
  const star4 = (g, x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill(); };
  const fall = (p, W, H, k, wob) => { p.y += p.vy * k; p.x += Math.sin(p.a) * wob * k; p.a += p.va * k; if (p.y > H + 30) { p.y = -rnd(12, Math.min(60, H * 0.4)); p.x = rnd(0, W); } if (p.x < -30) p.x = W + 20; if (p.x > W + 30) p.x = -20; };
  const rise = (p, W, H, k, wob) => { p.y -= p.vy * k; p.x += Math.sin(p.a) * wob * k; p.a += p.va * k; if (p.y < -40) { p.y = H + rnd(16, Math.min(60, H * 0.4)); p.x = rnd(0, W); } };
  const KINDS = {
    confetti: { n: 22, make: (p, W, H, c) => Object.assign(p, { w: rnd(5, 8), h: rnd(8, 12), vy: rnd(0.6, 1.2), va: rnd(0.02, 0.05), r: rnd(0, TAU), vr: rnd(-0.05, 0.05), c: pick([c.accent, c.deep, c.soft, mix(c.pastel, c.accent, 0.35), "#E2C25A"]), round: Math.random() < 0.25 }),
      step: (p, W, H, k) => { fall(p, W, H, k, 0.5); p.r += p.vr * k; },
      draw: (g, p) => { g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.a * 3)); g.globalAlpha = 0.85; g.fillStyle = p.c; if (p.round) { g.beginPath(); g.arc(0, 0, p.w / 2, 0, TAU); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); } },
    streamers: { n: 9, make: (p, W, H, c) => Object.assign(p, { len: rnd(44, 76), vy: rnd(0.45, 0.85), va: rnd(0.01, 0.025), r: rnd(-0.6, 0.6), vr: rnd(-0.01, 0.01), c: pick([c.accent, c.deep, mix(c.pastel, c.accent, 0.4)]) }),
      step: (p, W, H, k) => { fall(p, W, H, k, 0.35); p.r += p.vr * k; },
      draw: (g, p, t) => { g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = 0.8; g.strokeStyle = p.c; g.lineWidth = 3; g.lineCap = "round"; g.beginPath();
        for (let i = 0; i <= 12; i++) { const y = (i / 12) * p.len - p.len / 2, x = Math.sin(i * 0.9 + t * 0.06 + p.a) * 5; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.restore(); } },
    balloons: { n: 6, min: 4, make: (p, W, H, c, any) => Object.assign(p, { y: any ? rnd(0, H) : H + rnd(20, 80), r: rnd(12, 18), vy: rnd(0.22, 0.4), va: rnd(0.008, 0.016), c: pick([mix(c.accent, PAPER, 0.35), mix(c.deep, PAPER, 0.45), mix(c.pastel, c.accent, 0.25)]) }),
      step: (p, W, H, k) => rise(p, W, H, k, 0.25),
      draw: (g, p) => { const r = p.r; g.save(); g.translate(p.x, p.y); g.globalAlpha = 0.9; g.strokeStyle = INK; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(0, r * 1.2); g.bezierCurveTo(6, r * 1.2 + 14, -6, r * 1.2 + 26, 2, r * 1.2 + 40); g.globalAlpha = 0.45; g.stroke(); g.globalAlpha = 0.9;
        g.fillStyle = p.c; g.beginPath(); g.ellipse(0, 0, r, r * 1.2, 0, 0, TAU); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(-3, r * 1.2 + 4); g.lineTo(3, r * 1.2 + 4); g.lineTo(0, r * 1.2 - 1); g.closePath(); g.fillStyle = INK; g.fill();
        g.globalAlpha = 0.5; g.strokeStyle = PAPER; g.lineWidth = 2; g.beginPath(); g.arc(-r * 0.35, -r * 0.4, r * 0.45, Math.PI * 1.1, Math.PI * 1.45); g.stroke(); g.restore(); } },
    petals: { n: 14, make: (p, W, H, c) => Object.assign(p, { r: rnd(6, 10), vy: rnd(0.4, 0.8), va: rnd(0.01, 0.03), c: pick([mix("#E8A6B2", c.accent, 0.2), mix("#F2C4CC", c.pastel, 0.3), mix(c.accent, PAPER, 0.5)]) }),
      step: (p, W, H, k) => fall(p, W, H, k, 0.6),
      draw: (g, p, t) => { g.save(); g.translate(p.x, p.y); g.rotate(p.a * 4 + Math.sin(t * 0.02 + p.s * 9) * 0.6); g.globalAlpha = 0.85; g.fillStyle = p.c; g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, TAU); g.fill();
        g.globalAlpha = 0.3; g.fillStyle = mix(p.c, INK, 0.35); g.beginPath(); g.ellipse(-p.r * 0.35, 0, p.r * 0.35, p.r * 0.12, 0, 0, TAU); g.fill(); g.restore(); } },
    snow: { n: 26, make: (p, W, H, c) => Object.assign(p, { r: rnd(1.8, 4), vy: rnd(0.3, 0.8), va: rnd(0.01, 0.02), c: mix(c.deep, "#FFFFFF", 0.6) }),
      step: (p, W, H, k) => fall(p, W, H, k, 0.3),
      draw: (g, p) => { g.globalAlpha = 0.95; g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); g.globalAlpha = 0.25; g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke(); } },
    leaves: { n: 10, make: (p, W, H, c) => Object.assign(p, { r: rnd(7, 11), vy: rnd(0.45, 0.85), va: rnd(0.012, 0.025), c: pick(["#B8742A", "#9A4128", "#C99A3B", mix(c.accent, "#B8742A", 0.4)]) }),
      step: (p, W, H, k) => fall(p, W, H, k, 0.8),
      draw: (g, p, t) => { const r = p.r; g.save(); g.translate(p.x, p.y); g.rotate(Math.sin(p.a * 2 + p.s * 7) * 1.2 + t * 0.004); g.scale(1, 0.6 + 0.4 * Math.abs(Math.cos(p.a * 1.5))); g.globalAlpha = 0.85; g.fillStyle = p.c;
        g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.85, -r * 0.2, 0, r); g.quadraticCurveTo(-r * 0.85, -r * 0.2, 0, -r); g.fill();
        g.globalAlpha = 0.5; g.strokeStyle = mix(p.c, INK, 0.45); g.lineWidth = 1; g.beginPath(); g.moveTo(0, -r * 0.8); g.lineTo(0, r * 1.25); g.stroke(); g.restore(); } },
    rain: { n: 26, make: (p, W, H, c, any) => Object.assign(p, { len: rnd(10, 18), vy: rnd(3.2, 4.6), va: 0, drop: Math.random() < 0.22, r: rnd(2, 3.6), slide: rnd(0.05, 0.3), y: any ? rnd(0, H) : rnd(-60, -10), c: c.deep }),
      step: (p, W, H, k) => { if (p.drop) { p.y += p.slide * k * (Math.sin(p.s * 50 + p.y * 0.05) > 0.2 ? 1 : 0.1); if (p.y > H + 10) { p.y = rnd(-10, H * 0.5); p.x = rnd(0, W); } } else { p.y += p.vy * k; p.x -= 0.5 * k; if (p.y > H + 20) { p.y = rnd(-40, -10); p.x = rnd(0, W + 40); } } },
      draw: (g, p) => { if (p.drop) { g.globalAlpha = 0.28; g.fillStyle = p.c; g.beginPath(); g.ellipse(p.x, p.y, p.r * 0.8, p.r, 0, 0, TAU); g.fill(); g.globalAlpha = 0.7; g.fillStyle = "#FFFFFF"; g.beginPath(); g.arc(p.x - p.r * 0.25, p.y - p.r * 0.35, p.r * 0.28, 0, TAU); g.fill(); return; }
        g.globalAlpha = 0.22; g.strokeStyle = p.c; g.lineWidth = 1.2; g.lineCap = "round"; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.len * 0.12, p.y + p.len); g.stroke(); } },
    bubbles: { n: 16, make: (p, W, H, c, any) => Object.assign(p, { y: any ? rnd(0, H) : H + rnd(5, 40), r: rnd(3, 8), vy: rnd(0.35, 0.8), va: rnd(0.02, 0.05), c: mix(c.accent, c.deep, 0.3) }),
      step: (p, W, H, k) => rise(p, W, H, k, 0.4),
      draw: (g, p) => { g.globalAlpha = 0.5; g.strokeStyle = p.c; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke(); g.globalAlpha = 0.12; g.fillStyle = p.c; g.fill();
        g.globalAlpha = 0.8; g.strokeStyle = "#FFFFFF"; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x, p.y, p.r * 0.62, Math.PI * 1.1, Math.PI * 1.45); g.stroke(); } },
    stars: { n: 24, make: (p, W, H, c) => Object.assign(p, { y: rnd(0, H * 0.75), r: rnd(2.6, 4.8), vy: 0, va: rnd(0.01, 0.03), c: Math.random() < 0.7 ? c.deep : c.warm }),
      step: (p, W, H, k) => { p.a += p.va * k; },
      draw: (g, p) => { g.globalAlpha = 0.35 + 0.6 * Math.abs(Math.sin(p.a)); g.fillStyle = p.c; star4(g, p.x, p.y, p.r * (0.8 + 0.4 * Math.abs(Math.sin(p.a)))); } },
    twinkle: { n: 16, make: (p, W, H, c) => Object.assign(p, { y: rnd(0, H), r: rnd(9, 15), vy: rnd(0.02, 0.08), va: rnd(0.004, 0.012), c: c.warm }),
      step: (p, W, H, k) => { p.y -= p.vy * k; p.a += p.va * k; if (p.y < -20) { p.y = H + 10; p.x = rnd(0, W); } },
      draw: (g, p, t, I) => { const s = glow(I, p.c); g.globalAlpha = 0.3 + 0.6 * Math.max(0, Math.sin(p.a)) ** 2; g.drawImage(s, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); } },
    sparkles: { n: 12, flat: true, make: (p, W, H, c) => { const R = p.box || { x: 0, y: 0, w: W, h: H * 0.3 }; return Object.assign(p, { x: R.x + rnd(-14, R.w + 14), y: R.y + rnd(-12, R.h + 10), r: rnd(5, 11), va: rnd(0.02, 0.04), c: Math.random() < 0.5 ? c.warm : c.accent }); },
      step: (p, W, H, k, I) => { p.a += p.va * k; if (p.a > Math.PI) { p.a = 0; p.box = I.box; KINDS.sparkles.make(p, W, H, I.c); } },
      draw: (g, p) => { const v = Math.sin(p.a); g.globalAlpha = 0.95 * Math.min(1, v * 1.6); g.fillStyle = p.c; star4(g, p.x, p.y, p.r * (0.5 + 0.5 * v)); } },
    bulbs: { n: 0, flat: true, make: () => {}, step: () => {},
      draw: () => {} },
    steam: { n: 0, flat: true, make: () => {}, step: () => {}, draw: () => {} },
    dice: { n: 0, flat: true, make: () => {}, step: () => {}, draw: () => {} },
  };
  // a soft warm dot, drawn once per colour and stamped (no blur filter per frame)
  function glow(I, c) { I.sp = I.sp || {}; if (I.sp[c]) return I.sp[c]; const s = document.createElement("canvas"); s.width = s.height = 48; const x = s.getContext("2d"), gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, "#FFF6DC"); gr.addColorStop(0.25, c); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 48, 48); return (I.sp[c] = s); }

  // the three that are a scene rather than a scatter
  /** String lights: one wire that dips between pins along the top, a bulb every 56px or so, each breathing on its own. */
  function bulbsScene(I) { const { W } = I, n = Math.max(4, Math.round(W / (I.thumb ? 34 : 56))), sag = 16, top = 8, span = W / 3, B = [];
    const yAt = (x) => top + sag * Math.sin(((x % span) / span) * Math.PI);
    for (let i = 0; i < n; i++) { const x = (i + 0.5) * (W / n); B.push({ x, y: yAt(x), a: Math.random() * TAU, va: rnd(0.02, 0.04) * (I.lively ? 1.6 : 1), c: i % 3 === 0 ? I.c.warm : i % 3 === 1 ? mix(I.c.accent, "#F2D27A", 0.4) : mix(I.c.pastel, "#F2D27A", 0.5) }); }
    I.bulbs = B; I.yAt = yAt; }
  // the cover on this page, relative to the layer: string lights hang along its top edge
  function coverBox(I) { const scope = I.host === document.body ? document : I.host, c = scope.querySelector("#m .cov, .gxcover, #cvCover, .mk-cov"); if (!c) return null;
    const a = c.getBoundingClientRect(), b = I.layer.getBoundingClientRect(); return a.width ? { x: a.left - b.left, y: a.top - b.top, w: a.width } : null; }
  function bulbsDraw(g, I, k) { const { W } = I, s = 1; if (!I.thumb && I.anchor !== undefined) { const B = I.anchor; g.save(); if (B) { g.translate(B.x - 6, Math.max(-40, B.y - 14)); g.scale((B.w + 12) / W, 1); } bulbsDraw0(g, I, k, B ? (B.w + 12) / W : 1); g.restore(); return; } bulbsDraw0(g, I, k, 1); }
  function bulbsDraw0(g, I, k, sx) { const { W } = I, s = 1; g.globalAlpha = 0.55; g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= W; x += 4) { const y = I.yAt(x); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    for (const b of I.bulbs) { b.a += b.va * k; const on = 0.55 + 0.45 * Math.sin(b.a), y = b.y + 7 * s; g.globalAlpha = (I.lively ? 0.55 : 0.35) * on; const sp = glow(I, b.c), R = 15 * s; g.drawImage(sp, b.x - R / sx, y - R, (R * 2) / sx, R * 2);
      g.globalAlpha = 0.95; g.fillStyle = INK; g.fillRect(b.x - 2 / sx, b.y, 4 / sx, 4 * s); g.fillStyle = b.c; g.beginPath(); g.ellipse(b.x, y + 1 * s, 3.6 / sx, 5 * s, 0, 0, TAU); g.fill(); g.globalAlpha = 0.5; g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke(); } }
  /** Rising steam: a few soft wisps from the bottom of the page, as over a pot or a cup. */
  function steamScene(I) { const n = I.thumb ? 3 : I.lively ? 5 : 3; I.wisps = []; for (let i = 0; i < n; i++) I.wisps.push({ x: I.W * (0.5 + (i - (n - 1) / 2) * (I.thumb ? 0.24 : 0.14)), ph: rnd(0, TAU), sp: rnd(0.02, 0.035) * (I.lively ? 1.4 : 1) }); }
  function steamDraw(g, I, k) { const { H } = I, len = Math.min(I.thumb ? H : H * 0.7, 520), base = H + 4, seg = 22, col = mix(I.c.deep, "#8C8C8C", 0.6); g.lineCap = "round"; g.lineJoin = "round";
    for (const w of I.wisps) { w.ph += w.sp * k; const gr = g.createLinearGradient(0, base, 0, base - len); gr.addColorStop(0, col + "00"); gr.addColorStop(0.3, col + "26"); gr.addColorStop(0.65, col + "18"); gr.addColorStop(1, col + "00");
      g.strokeStyle = gr; g.beginPath(); for (let i = 0; i <= seg; i++) { const f = i / seg, y = base - f * len, x = w.x + Math.sin(f * 5 - w.ph) * (I.thumb ? 10 : 22) * f; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.globalAlpha = 1; g.lineWidth = I.thumb ? 10 : 16; g.stroke(); g.globalAlpha = 0.8; g.lineWidth = I.thumb ? 4 : 6; g.stroke(); } }
  /** Dice: two (three when lively) tumble in from the top, bounce and settle by the bottom corner, once. */
  function diceScene(I) { const n = I.lively ? 3 : 2, s = 26, floor = I.H - (I.thumb ? 14 : 64); I.dice = [];
    for (let i = 0; i < n; i++) I.dice.push({ x: I.W * (I.thumb ? 0.62 : 1) - 60 - i * s * 1.6, y: -s * (1.5 + i), vx: -rnd(0.3, 0.9), vy: rnd(0, 1), r: rnd(0, TAU), vr: rnd(0.08, 0.16), face: 1 + ((Math.random() * 6) | 0), s, floor, rest: false });
    I.t0 = 0; I.rest0 = 0; }
  const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  function diceDraw(g, I, k) { let moving = false; const fade = I.rest0 ? Math.max(0, 1 - (I.t - I.rest0 - 90) / 45) : 1;
    for (const d of I.dice) { if (!d.rest) { moving = true; d.vy += 0.35 * k; d.y += d.vy * k; d.x += d.vx * k; d.r += d.vr * k;
        if (d.y > d.floor - d.s / 2) { d.y = d.floor - d.s / 2; d.vy *= -0.42; d.vx *= 0.7; d.vr *= 0.6; d.face = 1 + ((Math.random() * 6) | 0); if (Math.abs(d.vy) < 0.9) { d.rest = true; d.r = Math.round(d.r / (Math.PI / 2)) * (Math.PI / 2) + (d.s % 3 ? -0.12 : 0.1); } } }
      const h = d.s / 2; g.save(); g.translate(d.x, d.y); g.rotate(d.r); g.globalAlpha = 0.95 * (I.still ? 1 : fade); g.fillStyle = mix(I.c.pastel, PAPER, 0.3); g.strokeStyle = INK; g.lineWidth = 1.6;
      g.beginPath(); if (g.roundRect) g.roundRect(-h, -h, d.s, d.s, d.s * 0.2); else g.rect(-h, -h, d.s, d.s); g.fill(); g.stroke(); g.fillStyle = INK;
      for (const [a, b] of PIPS[d.face]) { g.beginPath(); g.arc(a * h * 0.5, b * h * 0.5, d.s * 0.08, 0, TAU); g.fill(); } g.restore(); }
    if (!moving && !I.rest0) I.rest0 = I.t; return moving || (!I.still && fade > 0); }
  const SCENES = { bulbs: [bulbsScene, bulbsDraw], steam: [steamScene, steamDraw], dice: [diceScene, diceDraw] };

  /** How many shapes for an effect on a w x h layer: the full count at 1280x800, fewer on a smaller screen (by the square root of the area), more when lively, never over 40. */
  function countFor(id, w, h, level) { const K = KINDS[id]; if (!K || !K.n) return 0; const lively = level === "lively", base = K.flat ? K.n : Math.round(K.n * Math.min(1, Math.sqrt((w * h) / (1280 * 800))));
    return Math.min(40, Math.max(K.min || 6, Math.round(base * (lively ? 1.7 : 1)))); }

  // ---------- one shared clock for every effect and thumbnail on the page ----------
  const LIVE = new Set(); let raf = 0, last = 0;
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  function tick(now) { raf = 0; if (document.hidden) return; const dt = last ? now - last : 33; if (dt >= 1000 / 30 - 3) { last = now; const k = Math.min(3, dt / 33.3); for (const I of LIVE) if (I.seen && !I.done) frame(I, k); } else { /* not yet: wait for the next frame */ }
    if ([...LIVE].some((I) => I.seen && !I.done)) raf = requestAnimationFrame(tick); }
  const wake = () => { if (!raf && !document.hidden && LIVE.size) { last = 0; raf = requestAnimationFrame(tick); } };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });

  function frame(I, k) { const g = I.g; I.t += k; g.setTransform(I.dpr * I.zoom, 0, 0, I.dpr * I.zoom, 0, 0); g.clearRect(0, 0, I.W, I.H);
    if (I.id === "sparkles" && !I.thumb && (I.t | 0) % 15 === 0) I.box = titleBox(I);
    if (I.id === "bulbs" && !I.thumb) I.anchor = coverBox(I);
    const S = SCENES[I.id]; if (S) { const moving = S[1](g, I, k); if (I.id === "dice" && !moving) { if (I.thumb && !I.still) { I.t0 += k; if (I.t0 > 20) S[0](I); } else I.done = true; } }
    else { const K = KINDS[I.id]; for (const p of I.P) { if (k) K.step(p, I.W, I.H, k, I); K.draw(g, p, I.t, I); } }
    g.globalAlpha = 1; }
  // where the title is, relative to the layer: sparkles gather around it
  function titleBox(I) { const scope = I.host === document.body ? document : I.host, t = scope.querySelector("h1.lk-title, #m h1, #cvTitle, .gxtitle, #view-guest .invite h3, h1");
    if (!t) return null; const a = t.getBoundingClientRect(), b = I.layer.getBoundingClientRect(); return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }; }
  function seed(I) { const S = SCENES[I.id]; I.done = false; if (S) { S[0](I); return; } const K = KINDS[I.id], n = I.thumb ? (K.flat ? 6 : Math.min(10, K.n)) : countFor(I.id, I.W, I.H, I.level);
    if (I.id === "sparkles") I.box = I.thumb ? { x: I.W * 0.2, y: I.H * 0.3, w: I.W * 0.6, h: I.H * 0.4 } : titleBox(I);
    I.P = []; for (let i = 0; i < n; i++) { const p = { x: rnd(0, I.W), y: rnd(0, I.H), a: rnd(0, TAU), s: Math.random(), box: I.box }; K.make(p, I.W, I.H, I.c, true); if (I.id === "sparkles") p.a = rnd(0, Math.PI); I.P.push(p); } }
  // a still frame: the scene at rest (dice settled, steam and lights drawn once), for people who prefer less motion
  function still(I) { if (I.id === "dice") { for (let i = 0; i < 200 && diceDraw(I.g, I, 1); i++) I.g.clearRect(0, 0, I.W, I.H); } I.g.clearRect(0, 0, I.W, I.H); frame(I, 0); I.done = true; }

  function instance(cv, id, o) { const g = cv.getContext && cv.getContext("2d"); if (!g) return null;
    const I = { id, cv, g, host: o.host, layer: o.layer || cv, thumb: !!o.thumb, level: o.level || "subtle", lively: o.level === "lively", c: o.colors, zoom: o.thumb ? 0.6 : 1, t: 0, seen: true, still: o.still ?? reduced(), W: 1, H: 1, dpr: 1 };
    I.size = () => { const r = o.rect ? o.rect() : cv.getBoundingClientRect(), z = I.zoom; I.W = Math.max(1, r.width / z); I.H = Math.max(1, r.height / z); I.dpr = Math.min(I.thumb ? 2 : innerWidth < 700 ? 1.5 : 2, root.devicePixelRatio || 1); cv.width = Math.round(r.width * I.dpr); cv.height = Math.round(r.height * I.dpr); };
    I.size(); seed(I); if (I.still) still(I); else { LIVE.add(I); frame(I, 0); wake(); } return I; }

  // ---------- the layer behind the page ----------
  const CSS = `.fxe-host:not(body){isolation:isolate}.fxe-layer{pointer-events:none;z-index:2;overflow:hidden;contain:strict}.fxe-layer.vp{position:fixed;inset:0}.fxe-layer.box{position:absolute;inset:0}
.fxe-layer.stk{position:sticky;top:0;left:0;display:block;width:100%}.fxe-layer canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.fxe-layer.paper{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .3 0 0 0 0 .25 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");opacity:.55}
.fxe-layer.paper.lively{opacity:.9}`;
  function css() { if (document.getElementById("fxe-css")) return; const s = document.createElement("style"); s.id = "fxe-css"; s.textContent = CSS; document.head.appendChild(s); }
  const scrolls = (el) => { try { return /(auto|scroll)/.test(getComputedStyle(el).overflowY); } catch { return false; } };

  /** Draw `look.effect` behind `host` (the body on an invite, the canvas's scroll area, a preview frame). Returns stop(). */
  function mount(host, look, { event = null, theme = null, still } = {}) { const id = String((look && look.effect) || "none"); if (typeof document === "undefined" || !host || id === "none") return () => {};
    const level = levelOf(look), sig = JSON.stringify([id, level, look && look.palette, event && (event.coverArt && event.coverArt.tone)]);
    // the same effect again (a redraw of the page): keep it running instead of starting over
    const was = host.__fxe; if (was && was.sig === sig && was.layer.isConnected) { clearTimeout(was.bye); was.bye = 0; return was.stop; } was && was.kill();
    if (LEGACY.includes(id)) { const LK = root.EncoreLooks; let off = () => {}; try { off = LK.effect(host, id, { fixed: host === document.body }); } catch {} return off; }
    if (!IDS.includes(id)) return () => {};
    css(); const mode = host === document.body ? "vp" : scrolls(host) ? "stk" : "box", layer = document.createElement("div"); layer.className = "fxe-layer " + mode + " fxe-k-" + id + (level === "lively" ? " lively" : ""); layer.setAttribute("aria-hidden", "true"); layer.dataset.effect = id; layer.dataset.level = level;
    host.classList.add("fxe-host"); if (mode === "box" && getComputedStyle(host).position === "static") host.style.position = "relative";
    const fit = () => { if (mode === "stk") { const h = host.clientHeight; layer.style.height = h + "px"; layer.style.marginBottom = -h + "px"; } };
    fit(); host.prepend(layer); let I = null, ro = null, io = null, rt = 0, again = null;
    if (id === "paper") layer.classList.add("paper");
    else { const cv = document.createElement("canvas"); layer.appendChild(cv);
      I = instance(cv, id, { host, layer, level, colors: colorsFor(look, event, theme), still, rect: () => (mode === "vp" ? { width: innerWidth, height: innerHeight } : layer.getBoundingClientRect()) });
      again = () => { clearTimeout(rt); rt = setTimeout(() => { if (!I) return; fit(); I.size(); seed(I); if (I.still) still(I); else frame(I, 0); }, 150); };
      if (mode === "vp") addEventListener("resize", again); else if ("ResizeObserver" in root) { ro = new ResizeObserver(again); ro.observe(host); }
      // off screen: stop drawing until it's back
      if (mode !== "vp" && "IntersectionObserver" in root) { io = new IntersectionObserver(([x]) => { if (I) { I.seen = x.isIntersecting; if (I.seen) wake(); } }); io.observe(layer); } }
    const kill = () => { if (I) LIVE.delete(I); I = null; if (again) removeEventListener("resize", again); ro && ro.disconnect(); io && io.disconnect(); clearTimeout(rt); layer.remove(); if (host.__fxe === rec) { host.__fxe = null; host.classList.remove("fxe-host"); } };
    const rec = { sig, layer, kill, bye: 0, stop: () => { if (!rec.bye) rec.bye = setTimeout(kill, 0); } }; host.__fxe = rec; return rec.stop; }

  /** A small moving picture of an effect on `cv` (a tile in the Effect tray). Returns stop(). */
  function thumb(cv, id, { look = null, event = null, level = "subtle", still } = {}) { if (typeof document === "undefined" || !cv || !IDS.includes(id) || id === "none" || id === "paper") return () => {};
    const I = instance(cv, id, { thumb: true, level, colors: colorsFor(look, event, null), still }); if (!I) return () => {};
    let io = null; if (!I.still && "IntersectionObserver" in root) { io = new IntersectionObserver(([x]) => { I.seen = x.isIntersecting; if (I.seen) wake(); }); io.observe(cv); }
    return () => { LIVE.delete(I); io && io.disconnect(); }; }

  root.EncoreEffects = { IDS, LEGACY, LEVELS, levelOf, colorsFor, countFor, mix, mount, thumb, running: () => [...LIVE].filter((I) => !I.done && !I.still).length };
})(typeof window !== "undefined" ? window : globalThis);
