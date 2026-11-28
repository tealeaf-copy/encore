// Event effects: a little weather in the invite's cover (petals, snow, candlelight, string lights), or one quick moment
// when the page opens (confetti). One file draws them on the guest invite (/e), the full invite (/g), the create canvas,
// its live preview and the tiles of its Effect tray. public/looks.js loads it the first time a page has an effect.
// server/looks.js keeps the same ids and the same map from removed ids to the ones that replaced them.
// The rules: an effect is drawn inside the cover, on one small canvas, never over words, buttons or fields. Confetti is
// the one that crosses the page, once, gone in under 2.5 seconds. Candlelight and paper grain also tint the page's
// background layer, behind everything. Something shows in the first frame, the motion settles after 8 seconds, nothing
// is drawn while the tab is hidden or the cover is off screen, and less motion gets a still frame (confetti and rain: nothing).
(function (root) {
  "use strict";
  if (root.EncoreEffects) return;
  const IDS = ["none", "paper", "twinkle", "bulbs", "sparkles", "confetti", "dice", "petals", "snow", "leaves", "rain", "steam", "bubbles"];
  // cut in the effects review: an event that still carries one draws the nearest one that stayed
  const ALIAS = { stars: "sparkles", streamers: "confetti", balloons: "confetti" };
  const idOf = (v) => ALIAS[v] || String(v || "none");
  // the older vibe effects are still drawn by looks.js effect()
  const LEGACY = ["velvet", "lanterns", "scanlines", "pixels", "jarwall"];
  const LEVELS = ["subtle", "lively"];
  const levelOf = (L) => (L && L.effectLevel === "lively" ? "lively" : "subtle");
  const ONCE = { confetti: 1 }, NO_STILL = { confetti: 1, rain: 1 }, SHEER = { twinkle: 1, paper: 1 };

  // ---------- colours: the event's own (its look, else its cover tone) ----------
  const norm = (h) => (/^#[0-9a-f]{6}$/i.test(h || "") ? h.toUpperCase() : "");
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { a = norm(a) || "#888888"; b = norm(b) || "#888888"; const A = rgb(a), B = rgb(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase(); };
  const INK = "#1B1D1C", PAPER = "#FAF8F3", GOLD = "#E2A73F";
  /** The colours an effect draws with: the event's accent, a deeper ink accent and a pastel, from its look or its cover tone. */
  function colorsFor(look, event, theme) { const p = ((look && look.palette) || []).map(norm).filter(Boolean), A = root.EventArt; let tone = "";
    try { if (A) { const pk = event && event.coverArt; const kind = (A.valid && pk && A.valid(pk.kind) && pk.kind) || A.kindOf(event || {}); tone = (pk && A.PASTELS[pk.tone] && pk.tone) || A.toneOf(event || {}, kind); } } catch { tone = ""; }
    const T = theme || {}, spot = A && A.SPOT && A.SPOT[tone], pastelTone = A && A.PASTELS && A.PASTELS[tone];
    const accent = norm(T.spot) || p[2] || spot || "#9A4128", deep = norm(T.link) || p[1] || "#29489A", pastel = p[0] || pastelTone || "#E9DFC9";
    return { accent, deep, pastel, ink: INK, warm: mix(GOLD, accent, 0.2), soft: mix(accent, PAPER, 0.55) }; }

  // ---------- small tools ----------
  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a), pick = (L) => L[(Math.random() * L.length) | 0];
  const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  const rgba = (h, a) => { const [r, g, b] = rgb(norm(h) || "#888888"); return `rgba(${r},${g},${b},${a})`; };
  /** A soft round sprite, drawn once and stamped: stops are [offset, colour] from the middle out. */
  function soft(I, key, stops) { I.sp = I.sp || {}; if (I.sp[key]) return I.sp[key]; const s = document.createElement("canvas"); s.width = s.height = 96; const x = s.getContext("2d"), gr = x.createRadialGradient(48, 48, 0, 48, 48, 48);
    for (const [o, c] of stops) gr.addColorStop(o, c); x.fillStyle = gr; x.fillRect(0, 0, 96, 96); return (I.sp[key] = s); }
  const stamp = (g, s, x, y, r, a) => { if (a <= 0.004) return; g.globalAlpha = Math.min(1, a); g.drawImage(s, x - r, y - r, r * 2, r * 2); };
  const star4 = (g, x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r * 0.8, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r * 0.8, y); g.quadraticCurveTo(x, y, x, y - r); g.fill(); };
  const petal = (g, r) => { g.beginPath(); g.moveTo(0, -r); g.bezierCurveTo(r * 0.95, -r * 0.55, r * 0.7, r * 0.8, 0, r); g.bezierCurveTo(-r * 0.7, r * 0.8, -r * 0.95, -r * 0.55, 0, -r); };
  const leaf = (g, r) => { g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.9, -r * 0.1, 0, r); g.quadraticCurveTo(-r * 0.9, -r * 0.1, 0, -r); };
  /** A piece of paper turning in the air: one colour on the front, another on the back, and a shadow that is barely there. */
  function paper(g, p, shape, vein) { const sy = Math.cos(p.fl), k = Math.max(0.12, Math.abs(sy)), a = g.globalAlpha;
    for (let pass = 0; pass < 2; pass++) { g.save(); g.translate(p.x + (pass ? 0 : 1.5), p.y + (pass ? 0 : 2.5)); g.rotate(p.a); g.scale(1, k); g.globalAlpha = pass ? a : a * 0.08; g.fillStyle = pass ? (sy < 0 ? p.c2 : p.c) : INK; shape(g, p.r); g.fill();
      if (pass && vein) { g.globalAlpha = a * 0.35; g.strokeStyle = sy < 0 ? p.c : p.c2; g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, -p.r * 0.75); g.lineTo(0, p.r * (vein > 1 ? 1.3 : 0.6)); g.stroke(); } g.restore(); } g.globalAlpha = a; }

  // ---------- things that fall or rise through the cover: depth (z) sets size, speed and strength; a shared breeze sways them together ----------
  function drift(I, mk) { I.P = []; for (let i = 0; i < I.n; i++) { const p = { i, x: rnd(0, I.W), y: rnd(-0.05, 1) * I.H, z: rnd(0.45, 1), ph: rnd(0, TAU), a: rnd(0, TAU), fl: rnd(0, TAU) }; mk(p); I.P.push(p); } }
  // one step down (dir 1) or up (dir -1); a shape past the edge comes back at the other one, unless the effect has settled and it is one of the extras
  function move(I, p, dt, sway, dir) { const v = p.v * p.z * I.boost * dt; p.y += v * dir; p.ph += dt * (0.9 + p.z); p.x += (I.wind * sway * 0.6 + Math.sin(p.ph) * sway) * p.z * dt; p.a += p.sp * dt; p.fl += p.fv * dt;
    if (dir > 0 ? p.y > I.H + 16 : p.y < -16) { if (p.i >= I.live) { p.off = 1; return; } p.y = dir > 0 ? -14 : I.H + 14; p.x = rnd(0, I.W); }
    if (p.x < -18) p.x = I.W + 16; else if (p.x > I.W + 18) p.x = -16; }
  const turning = (shape, vein, sway, mk) => ({ init: (I) => drift(I, (p) => { mk(p, I.c); p.r *= 0.6 + 0.4 * p.z; p.sp = rnd(-1.4, 1.4); p.fv = rnd(1.4, 3) * (Math.random() < 0.5 ? -1 : 1); }),
    draw: (I, g, dt) => { for (const p of I.P) { if (p.off) continue; if (dt) move(I, p, dt, sway, 1); g.globalAlpha = 0.55 + 0.4 * p.z; paper(g, p, shape, vein); } } });

  const KINDS = {
    petals: Object.assign(turning(petal, 1, 20, (p, c) => { p.r = rnd(8, 13); p.v = rnd(30, 52); p.c = mix(pick(["#F2A7B5", "#F7CDD4", "#E98FA2", "#FADDE1"]), c.accent, 0.1); p.c2 = mix(p.c, "#B8506A", 0.4); }), { n: 18 }),
    leaves: Object.assign(turning(leaf, 2, 30, (p, c) => { p.r = rnd(9, 14); p.v = rnd(36, 62); p.c = pick(["#C2792B", "#A94A2A", "#D2A23C", mix(c.accent, "#C2792B", 0.45)]); p.c2 = mix(p.c, "#6B4A22", 0.45); }), { n: 16 }),
    snow: { n: 32, init: (I) => drift(I, (p) => { p.r = 1.6 + p.z * p.z * 2.8; p.v = rnd(24, 42); p.sp = rnd(-0.5, 0.5); p.fv = 0; p.k = p.z > 0.7 && p.i % 4 === 0; }),
      draw: (I, g, dt) => { const s = soft(I, "snow", I.photo ? [[0, "#FFFFFF"], [0.4, "rgba(255,255,255,.9)"], [1, "rgba(255,255,255,0)"]] : [[0, "rgba(184,200,234,.95)"], [0.42, "rgba(184,200,234,.85)"], [1, "rgba(170,188,226,0)"]]), col = I.photo ? "#FFFFFF" : mix(I.c.deep, "#8FA3C4", 0.6);
        for (const p of I.P) { if (p.off) continue; if (dt) move(I, p, dt, 12, 1); const al = 0.5 + 0.5 * p.z;
          if (p.k) { g.globalAlpha = al * 0.85; g.strokeStyle = col; g.lineWidth = 1.2; g.lineCap = "round"; g.beginPath(); for (let i = 0; i < 3; i++) { const a = p.a + (i * Math.PI) / 3, dx = Math.cos(a) * p.r * 1.9, dy = Math.sin(a) * p.r * 1.9; g.moveTo(p.x - dx, p.y - dy); g.lineTo(p.x + dx, p.y + dy); } g.stroke(); }
          else stamp(g, s, p.x, p.y, p.r * 1.7, al); } } },
    bubbles: { n: 14, init: (I) => drift(I, (p) => { p.r = rnd(3.5, 9) * (0.6 + 0.4 * p.z); p.v = rnd(26, 50); p.sp = p.fv = 0; p.top = rnd(0.04, 0.42) * I.H; p.y = rnd(p.top, I.H); }),
      draw: (I, g, dt) => { const col = mix(I.c.accent, I.c.deep, 0.35);
        for (const p of I.P) { if (p.off) continue; let r = p.r, al = 0.35 + 0.4 * p.z;
          if (p.pop) { p.pop -= dt; const u = 1 - Math.max(0, p.pop) / 0.2; r *= 1 + u * 0.9; al *= 1 - u; if (p.pop <= 0) { p.pop = 0; p.top = rnd(0.04, 0.42) * I.H; if (p.i >= I.live) { p.off = 1; continue; } p.y = I.H + 12; p.x = rnd(0, I.W); } }
          else if (dt) { move(I, p, dt, 9, -1); if (p.y < p.top) p.pop = 0.2; }
          g.globalAlpha = al; g.strokeStyle = col; g.lineWidth = 1.1; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke(); g.globalAlpha = al * 0.16; g.fillStyle = col; g.fill();
          if (!p.pop) { g.globalAlpha = al; g.strokeStyle = "#FFFFFF"; g.beginPath(); g.arc(p.x, p.y, r * 0.58, Math.PI * 1.1, Math.PI * 1.5); g.stroke(); } } } },
    rain: { n: 30, init: (I) => { drift(I, (p) => { p.len = 8 + p.z * 13; p.v = 360 + p.z * 240; }); I.S = []; },
      draw: (I, g, dt) => { const col = mix(I.c.deep, "#5B7391", 0.5); g.strokeStyle = col; g.lineCap = "round";
        for (const p of I.P) { if (p.off) continue; if (dt) { const v = p.v * dt; p.y += v; p.x -= v * 0.16; if (p.y > I.H - 3) { if (p.z > 0.7 && I.S.length < 10) I.S.push({ x: p.x, t: 0 }); if (p.i >= I.live) { p.off = 1; continue; } p.y = -rnd(10, 60); p.x = rnd(0, I.W * 1.15); } }
          g.globalAlpha = 0.16 + 0.34 * p.z; g.lineWidth = 0.7 + p.z * 0.7; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.len * 0.16, p.y - p.len); g.stroke(); }
        // a small splash where a near drop lands
        g.lineWidth = 1; I.S = I.S.filter((s) => (s.t += dt) < 0.28); for (const s of I.S) { const u = s.t / 0.28; g.globalAlpha = 0.5 * (1 - u); g.beginPath(); g.ellipse(s.x, I.H - 2, 2 + u * 6, 1 + u * 2, 0, Math.PI, TAU); g.stroke(); } } },
    // steam: three short curls side by side that draw themselves upward and fade, like the mark for "hot" in a line drawing
    steam: { n: 0, init: (I) => { const cl = I.lively && I.W > 260 ? [0.3, 0.68] : [0.5]; I.P = []; cl.forEach((cx, c) => { for (let i = 0; i < 3; i++) I.P.push({ x: I.W * cx + (i - 1) * 17, u: (i * 0.37 + c * 0.2) % 1, d: rnd(1.9, 2.5), ph: i * 2.1 + c, wait: 0 }); }); },
      draw: (I, g, dt) => { const { H } = I, len = Math.min(H * 0.36, 90), y0 = H * 0.5; g.strokeStyle = I.photo ? "#FFFFFF" : mix(I.c.ink, I.c.deep, 0.3); g.lineWidth = 2; g.lineCap = g.lineJoin = "round";
        for (const w of I.P) { if (dt) { if (w.wait > 0) w.wait -= dt * I.q; else if ((w.u += dt / w.d) >= 1) { w.u = 0; w.wait = rnd(0, 0.5) + (1 - I.q) * 2; } } if (w.wait > 0 && !I.still) continue;
          const u = I.still ? 0.55 : w.u, head = ease(u * 1.4), tail = Math.max(0, u * 1.6 - 0.6), lift = u * H * 0.12; if (head <= tail) continue; g.globalAlpha = 0.5 * Math.min(1, (1 - u) * 2.2); g.beginPath();
          for (let k = 0; k <= 14; k++) { const f = tail + ((head - tail) * k) / 14, y = y0 - lift - f * len, x = w.x + Math.sin(f * 5.6 + w.ph + u * 1.5) * 6.5 + I.wind * 4 * f; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } } },
    // sparkles: a run of crisp glints across the cover when it opens, then one now and then
    sparkles: { n: 10, init: (I) => { I.P = []; I.next = 0; for (let i = 0; i < I.n; i++) KINDS.sparkles.add(I, i * 0.07); },
      add: (I, wait) => { let x, y, k = 0; do { x = rnd(0.06, 0.94) * I.W; y = rnd(0.1, 0.9) * I.H; } while (k++ < 6 && I.P.some((p) => Math.hypot(p.x - x, p.y - y) < 34)); I.P.push({ x, y, r: rnd(8, 17), t: -wait, d: rnd(1, 1.5), rot: rnd(-0.3, 0.3), c: pick([I.c.warm, I.c.warm, I.c.accent, mix(I.c.deep, PAPER, 0.25)]) }); },
      draw: (I, g, dt) => { I.next -= dt; if (I.t > 0.9 && I.next <= 0 && !I.still) { I.next = rnd(0.25, 0.6) / (I.lively ? 1.7 : 1) / I.q ** 3; KINDS.sparkles.add(I, 0); }
        I.P = I.P.filter((p) => (p.t += dt) < p.d || I.still); for (const p of I.P) { if (p.t < 0 && !I.still) continue; const u = I.still ? 0.3 : p.t / p.d, s = u < 0.2 ? ease(u / 0.2) * 1.15 : u < 0.6 ? 1 + 0.15 * (1 - (u - 0.2) / 0.4) : 1 - ((u - 0.6) / 0.4) ** 2;
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot + u * 0.9); g.globalAlpha = Math.min(1, s * 1.4); g.fillStyle = p.c; star4(g, 0, 0, p.r * s); g.fillStyle = "#FFFFFF"; g.globalAlpha *= 0.85; star4(g, 0, 0, p.r * s * 0.34); g.restore(); } } },
    // string lights: a wire that dips between pins along the top of the cover; the bulbs come on one after another, then each breathes on its own
    bulbs: { n: 0, init: (I) => { const { W } = I, n = Math.max(4, Math.round(W / (I.thumb ? 30 : 44))), span = W / (W < 420 ? 2 : 3), col = [I.c.warm, mix(I.c.accent, "#F2D27A", 0.3), mix(I.c.deep, "#FFFFFF", 0.4), "#F2D27A"]; I.yAt = (x) => 5 + 13 * Math.sin((((x + span) % span) / span) * Math.PI); I.B = [];
        for (let i = 0; i < n; i++) I.B.push({ x: (i + 0.5) * (W / n), on: 0.1 + i * (0.55 / n), a: rnd(0, TAU), va: rnd(0.9, 1.7), ph: rnd(0, TAU), c: col[i % col.length] }); },
      draw: (I, g, dt) => { const { W } = I, sway = (x) => Math.sin(I.t * 1.1 + x * 0.02) * 1.1; g.globalAlpha = 0.6; g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); for (let x = -4; x <= W + 4; x += 4) { const y = I.yAt(x) + sway(x); x > -4 ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
        for (const b of I.B) { b.a += b.va * dt; const u = (I.t - b.on) / 0.22, lit = I.still ? 1 : u <= 0 ? 0 : u < 1 ? ease(u) * 1.3 : 1 + 0.3 * Math.max(0, 1 - (u - 1)), amp = 0.16 * (I.lively ? 1.4 : 1) * (0.5 + 0.5 * I.q), on = lit * (1 - amp + amp * 0.5 * (Math.sin(b.a) + Math.sin(b.a * 1.7 + b.ph))), y = I.yAt(b.x) + sway(b.x);
          if (!I.flat) stamp(g, soft(I, "h" + b.c, [[0, rgba(b.c, 0.75)], [0.3, rgba(b.c, 0.4)], [1, rgba(b.c, 0)]]), b.x, y + 8, 17, 0.75 * on);
          g.globalAlpha = 1; g.fillStyle = INK; g.fillRect(b.x - 2, y, 4, 4); g.fillStyle = mix(mix(b.c, INK, 0.45), mix(b.c, "#FFFFFF", 0.15), Math.min(1, on)); g.beginPath(); g.ellipse(b.x, y + 8.5, 3.6, 5, 0, 0, TAU); g.fill(); g.globalAlpha = 0.55; g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
          g.globalAlpha = 0.8 * Math.min(1, on); g.fillStyle = "#FFFFFF"; g.beginPath(); g.ellipse(b.x - 1.2, y + 7, 0.9, 1.6, 0.3, 0, TAU); g.fill(); } } },
    // candlelight: the cover dims a little, like a room in the evening, and two to four flames out of focus along its
    // lower edge lift it back to a warm glow. The light is cut out of the dimming, so drawn lines under it stay crisp.
    twinkle: { n: 0, res: 0.75 /* all soft light: a small canvas, scaled up, looks the same and costs a fraction */, init: (I) => { const { W, H } = I, n = W < 300 ? 2 : W < 520 ? 3 : 4; I.F = [];
        for (let i = 0; i < n; i++) { const z = (i * 0.37 + rnd(0.1, 0.35)) % 1; I.F.push({ x: W * ((i + 0.5) / n + rnd(-0.1, 0.1)), y: H * rnd(0.84, 1.02), r: Math.max(8, Math.min(48, H * (0.11 + 0.15 * (1 - z)))), z, p1: rnd(0, TAU), p2: rnd(0, TAU), dip: 0, next: rnd(0.4, 2) }); } },
      draw: (I, g, dt) => { const { W, H } = I, up = I.still ? 1 : ease(I.t / 0.6), A = (I.lively ? 0.3 : 0.24) * up, dim = g.createLinearGradient(0, 0, 0, H); dim.addColorStop(0, `rgba(92,50,18,${A})`); dim.addColorStop(1, `rgba(92,50,18,${A * 0.55})`); g.fillStyle = dim; g.fillRect(0, 0, W, H);
        const hole = soft(I, "hole", [[0, "rgba(0,0,0,1)"], [0.35, "rgba(0,0,0,.8)"], [0.7, "rgba(0,0,0,.25)"], [1, "rgba(0,0,0,0)"]]), pool = soft(I, "pool", [[0, "rgba(255,176,82,.5)"], [0.5, "rgba(255,186,98,.2)"], [1, "rgba(255,190,110,0)"]]),
          disc = soft(I, "disc", [[0, "rgba(255,246,220,.95)"], [0.55, "rgba(255,228,164,.92)"], [0.8, "rgba(255,200,112,.88)"], [0.9, "rgba(255,172,74,.6)"], [1, "rgba(255,160,60,0)"]]), calm = 0.4 + 0.6 * I.q;
        for (const f of I.F) { if (dt) { f.next -= dt; if (f.next <= 0) { f.dip = rnd(0.14, 0.34) * calm; f.next = rnd(0.7, 3.2) / calm; } f.dip *= Math.exp(-dt * 7); }
          f.v = I.still ? 1 : 0.9 + 0.07 * Math.sin(I.t * 1.3 + f.p1) + 0.04 * Math.sin(I.t * 3.3 + f.p2) - f.dip; }
        g.globalCompositeOperation = "destination-out"; for (const f of I.F) stamp(g, hole, f.x, f.y - f.r * 0.3, H * 1.05 * (0.85 + 0.15 * f.v), 0.9 * f.v * up);
        g.globalCompositeOperation = "source-over"; for (const f of I.F) { const x = f.x + Math.sin(I.t * 0.9 + f.p2) * 1.5; stamp(g, pool, x, f.y, H * 0.62 * f.v, 0.8 * f.v * up); stamp(g, disc, x, f.y, f.r * (0.95 + 0.07 * f.v), (0.35 + 0.5 * f.z) * f.v * up); } } },
    // dice: two (three when lively) tumble in along the bottom of the cover, bounce and come to rest there
    dice: { n: 0, init: (I) => { const n = I.lively ? 3 : 2, s = Math.max(16, Math.min(30, I.H * 0.15)); I.D = [];
        for (let i = 0; i < n; i++) I.D.push({ x: I.W * 0.82 - i * s * 1.7, y: s * (0.2 - i * 0.9), vx: -rnd(1.6, 2.6) * (I.W / 360), vy: rnd(1, 2), r: rnd(0, TAU), vr: rnd(0.2, 0.3), face: 1 + ((Math.random() * 6) | 0), s, rest: false }); },
      draw: (I, g, dt) => { const k = dt * 30, floor = I.H - 7; let moving = false;
        for (const d of I.D) { const h = d.s / 2; if (!d.rest && k) { moving = true; d.vy += 0.42 * k; d.y += d.vy * k; d.x += d.vx * k; d.r -= d.vr * k; if (d.x < h + 4) { d.x = h + 4; d.vx *= -0.5; }
            if (d.y > floor - h) { d.y = floor - h; d.vy *= -0.45; d.vx *= 0.72; d.vr *= 0.6; d.face = 1 + ((Math.random() * 6) | 0); if (Math.abs(d.vy) < 1.1) { d.rest = true; d.r = Math.round(d.r / (Math.PI / 2)) * (Math.PI / 2) + (d.face % 2 ? -0.1 : 0.08); } } }
          g.globalAlpha = 0.1; g.fillStyle = INK; g.beginPath(); g.ellipse(d.x, floor + 1, h * 1.1, 2.2, 0, 0, TAU); g.fill();
          g.save(); g.translate(d.x, d.y); g.rotate(d.r); g.globalAlpha = 1; g.fillStyle = mix(I.c.pastel, PAPER, 0.55); g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); if (g.roundRect) g.roundRect(-h, -h, d.s, d.s, d.s * 0.2); else g.rect(-h, -h, d.s, d.s); g.fill(); g.stroke();
          g.fillStyle = d.face === 1 ? I.c.accent : INK; for (const [a, b] of PIPS[d.face]) { g.beginPath(); g.arc(a * h * 0.5, b * h * 0.5, d.s * (d.face === 1 ? 0.11 : 0.08), 0, TAU); g.fill(); } g.restore(); }
        return moving || !dt; } },
    // confetti: one pop from the two top corners, paper turning as it falls, gone in under 2.5 seconds
    confetti: { n: 46, init: (I) => { const { W, H } = I, S = Math.max(0.55, Math.min(1.5, Math.sqrt(W * H) / 520)), cols = [I.c.accent, I.c.deep, I.c.soft, mix(I.c.pastel, I.c.accent, 0.35), "#E2C25A"]; I.P = [];
        for (let i = 0; i < I.n; i++) { const left = i % 2 === 0, th = rnd(0.35, 1.25), v = rnd(380, 900) * S, c = pick(cols), kind = Math.random();
          I.P.push({ x: left ? -6 : W + 6, y: H * rnd(0.16, 0.34), vx: Math.cos(th) * v * (left ? 1 : -1), vy: -Math.sin(th) * v, r: rnd(4, 6.5) * Math.max(0.8, S), a: rnd(0, TAU), sp: rnd(-7, 7), fl: rnd(0, TAU), fv: rnd(5, 11), ph: rnd(0, TAU), c, c2: mix(c, kind < 0.5 ? "#FFFFFF" : INK, 0.3), kind, S }); } },
      draw: (I, g, dt) => { const T = 2.3, fade = I.t < 1.5 ? 1 : Math.max(0, 1 - (I.t - 1.5) / (T - 1.5));
        for (const p of I.P) { if (dt) { const dr = Math.exp(-dt * 2.6); p.vx *= dr; p.vy = p.vy * dr + 900 * p.S * dt; p.ph += dt * 5; p.x += (p.vx + Math.sin(p.ph) * 34) * dt; p.y += p.vy * dt; p.a += p.sp * dt; p.fl += p.fv * dt; }
          g.globalAlpha = fade;
          if (p.kind > 0.82) { g.save(); g.translate(p.x, p.y); g.rotate(p.a * 0.3); g.strokeStyle = p.c; g.lineWidth = 2.4; g.lineCap = "round"; g.beginPath(); for (let i = 0; i <= 8; i++) { const y = (i - 4) * p.r * 0.8, x = Math.sin(i * 1.1 + p.fl) * p.r * 0.8; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.restore(); }
          else paper(g, p, p.kind < 0.2 ? (c, r) => { c.beginPath(); c.arc(0, 0, r * 0.8, 0, TAU); } : (c, r) => { c.beginPath(); c.rect(-r * 0.7, -r, r * 1.4, r * 2); }); }
        return I.t < T; } },
  };
  const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };

  /** How many shapes for an effect on a w x h stage (the cover; the screen for confetti): the full count at 640x400, fewer on a smaller one (by the square root of the area), more when lively, never over 56. */
  function countFor(id, w, h, level) { const K = KINDS[idOf(id)]; if (!K || !K.n) return 0; const base = Math.round(K.n * Math.min(1, Math.sqrt((w * h) / (640 * 400))));
    return Math.min(56, Math.max(5, Math.round(base * (level === "lively" ? 1.6 : 1)))); }

  // ---------- one shared clock for every effect and thumbnail on the page ----------
  const LIVE = new Set(), ST = { n: 0, sum: 0, max: 0 }; let raf = 0, last = 0;
  const mq = (q) => { try { return matchMedia(q).matches; } catch { return false; } }, reduced = () => mq("(prefers-reduced-motion: reduce)");
  const busy = () => { for (const I of LIVE) if (I.seen && !I.done) return true; return false; };
  function tick(now) { raf = 0; if (document.hidden) return; const ms = last ? now - last : 33;
    if (ms >= 1000 / 30 - 3) { last = now; const dt = Math.min(0.05, ms / 1000), t0 = performance.now(); for (const I of LIVE) if (I.seen && !I.done) frame(I, dt); const d = performance.now() - t0; ST.n++; ST.sum += d; if (d > ST.max) ST.max = d; }
    if (busy()) raf = requestAnimationFrame(tick); }
  const wake = () => { if (!raf && !document.hidden && busy()) { last = 0; raf = requestAnimationFrame(tick); } };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else wake(); });

  function frame(I, dt) { const g = I.g, s = I.dpr * I.zoom, a = (I.t += dt); g.setTransform(s, 0, 0, s, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, I.W, I.H);
    // a quick start that eases to cruising speed, a breeze, and a quieter state after 8 seconds (a thumbnail stays as it is)
    I.boost = I.thumb || I.still ? 1 : 1 + 1.6 * (1 - ease(a / 1.2)); I.q = I.thumb || a < 8 ? 1 : Math.max(I.lively ? 0.65 : 0.42, 1 - (a - 8) * 0.15); I.live = Math.ceil(I.n * I.q); I.wind = Math.sin(a * 0.7) * 0.6 + Math.sin(a * 1.9 + 1.3) * 0.4;
    const more = KINDS[I.id].draw(I, g, dt); g.globalAlpha = 1;
    if (more === false) { if (I.thumb) { if ((I.rest = (I.rest || 0) + dt) > (ONCE[I.id] ? 0.5 : 1.6)) { I.rest = 0; I.t = 0; KINDS[I.id].init(I); } } else { I.done = true; I.end && I.end(); } } }
  // a still frame for people who prefer less motion: the scene at rest (dice settled, lights on, a steady glow)
  function still(I) { if (I.id === "dice") for (let i = 0; i < 400 && I.D.some((d) => !d.rest); i++) KINDS.dice.draw(I, I.g, 0.033);
    if (NO_STILL[I.id]) { I.t = 0; for (let i = 0; i < 15; i++) frame(I, 0.033); } else { I.t = 20; frame(I, 0); } I.done = true; }

  function instance(cv, id, o) { const g = cv.getContext && cv.getContext("2d"); if (!g) return null;
    const I = { id, cv, g, thumb: !!o.thumb, lively: o.level === "lively", c: o.colors, zoom: o.thumb ? 0.6 : 1, t: 0, seen: true, still: o.still ?? reduced(), flat: mq("(prefers-reduced-transparency: reduce)"), photo: !!o.photo, W: 1, H: 1, dpr: 1, q: 1, boost: 1, wind: 0 };
    I.size = () => { const r = cv.getBoundingClientRect(), z = I.zoom; I.W = Math.max(1, r.width / z); I.H = Math.max(1, r.height / z); I.dpr = KINDS[id].res || Math.min(2, root.devicePixelRatio || 1); cv.width = Math.round(r.width * I.dpr); cv.height = Math.round(r.height * I.dpr);
      I.n = I.live = I.thumb ? Math.min(9, KINDS[id].n) : countFor(id, I.W, I.H, o.level); I.sp = null; KINDS[id].init(I); };
    I.size(); if (I.still) still(I); else { LIVE.add(I); frame(I, 0); wake(); } return I; }

  // ---------- the layers: one in the cover, and for candlelight and paper grain one behind the page ----------
  const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .3 0 0 0 0 .25 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")`;
  const CSS = `body.fxe-bk,.fxe-cover{isolation:isolate}.fxe-layer{pointer-events:none;overflow:hidden;contain:strict}.fxe-cov{position:absolute;inset:0;z-index:1;border-radius:inherit}.fxe-cover>.fxe-cov:not(#_):not(#_):not(#_){display:block!important}.fxe-vp{position:fixed;inset:0;z-index:40}.fxe-back{position:fixed;inset:0;z-index:-1}
.fxe-layer canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;visibility:visible!important;border-radius:0}.fxe-k-paper{background-image:${GRAIN};opacity:.5;mix-blend-mode:multiply}.fxe-k-paper.lively{opacity:.85}
.fxe-back.fxe-k-twinkle{background:radial-gradient(130% 62% at 50% 104%,rgba(255,166,70,.34),rgba(255,188,108,.15) 44%,rgba(255,200,130,0) 76%);opacity:.8;animation:fxeUp .7s ease-out}.fxe-back.fxe-k-twinkle.lively{opacity:1}
@keyframes fxeUp{from{opacity:0}}@media (prefers-reduced-motion:reduce){.fxe-back.fxe-k-twinkle{animation:none}}`;
  function css() { if (document.getElementById("fxe-css")) return; const s = document.createElement("style"); s.id = "fxe-css"; s.textContent = CSS; document.head.appendChild(s); }
  const COVER = "#m .cov, .gxcover, #cvCover, .mk-cov", WORDS = ".ea-txt, .lk-corner, .type-cover";
  const div = (cls, id, level) => { const d = document.createElement("div"); d.className = "fxe-layer " + cls + " fxe-k-" + id + (level === "lively" ? " lively" : ""); d.setAttribute("aria-hidden", "true"); d.dataset.effect = id; d.dataset.level = level; return d; };

  /** Draw `look.effect` for `host` (the body on an invite, the canvas's scroll area, a preview frame): in its cover, and for confetti on a page across the screen, once. Returns stop(). */
  function mount(host, look, { event = null, theme = null, still } = {}) { const id = idOf(look && look.effect); if (typeof document === "undefined" || !host || id === "none") return () => {};
    const level = levelOf(look), sig = JSON.stringify([id, level, look && look.palette, event && event.coverArt && event.coverArt.tone]);
    // the same effect again (a redraw of the page): keep it going, in the new cover if the old one was replaced, and never replay a moment
    const was = host.__fxe; if (was && was.sig === sig) { clearTimeout(was.bye); was.bye = 0; was.place(); return was.stop; } was && was.kill();
    if (LEGACY.includes(id)) { const LK = root.EncoreLooks; let off = () => {}; try { off = LK.effect(host, id, { fixed: host === document.body }); } catch {} return off; }
    const st = still ?? reduced(); if (!IDS.includes(id) || (st && NO_STILL[id]) || (SHEER[id] && mq("(prefers-reduced-transparency: reduce)"))) return () => {};
    css(); const page = host === document.body, scope = page ? document : host, vp = page && ONCE[id], layer = div(vp ? "fxe-vp" : "fxe-cov", id, level), cv = id === "paper" ? null : layer.appendChild(document.createElement("canvas"));
    const back = page && (id === "twinkle" || id === "paper") ? div("fxe-back", id, level) : null; if (back) { host.prepend(back); host.classList.add("fxe-bk"); } host.classList.add("fxe-host");
    let I = null, over = false, rt = 0, cover = null; const colors = colorsFor(look, event, theme);
    const io = "IntersectionObserver" in root ? new IntersectionObserver(([x]) => { if (I) { I.seen = x.isIntersecting; if (I.seen) wake(); } }) : null;
    // words on the cover itself (a title on the art, the card deck's corner word): the layer is cut away around them
    const clip = () => { if (vp || !cover || !layer.isConnected) return; const b = layer.getBoundingClientRect(); let d = "";
      for (const el of cover.querySelectorAll(WORDS)) { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue; const x1 = r.left - b.left - 4, y1 = r.top - b.top - 4, x2 = r.right - b.left + 4, y2 = r.bottom - b.top + 4; d += `,${x1}px ${y1}px,${x1}px ${y2}px,${x2}px ${y2}px,${x2}px ${y1}px,${x1}px ${y1}px,0 0`; }
      layer.style.clipPath = d ? `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0${d})` : ""; };
    const words = () => { if (ro && cover && !vp) { ro.disconnect(); ro.observe(layer); for (const el of cover.querySelectorAll(WORDS)) ro.observe(el); } clip(); };
    const ro = "ResizeObserver" in root ? new ResizeObserver(() => { clip(); if (!I || !layer.offsetWidth) return place(); clearTimeout(rt); rt = setTimeout(() => { if (!I || !layer.isConnected) return; const r = layer.getBoundingClientRect(); if (Math.abs(r.width - I.W) < 2 && Math.abs(r.height - I.H) < 2) return; I.size(); if (I.still || I.done) still(I); else frame(I, 0); }, 150); }) : null;
    // put the layer in the cover (again, when the page redrew it); no cover yet: wait for one
    const place = () => { if (over) return; if (vp) { if (!layer.isConnected) host.appendChild(layer); } else { const all = [...scope.querySelectorAll(COVER)], c = all.find((x) => x.offsetWidth > 1); if (!c) { if (ro) for (const x of all) ro.observe(x); /* hidden for now (the canvas keeps its guest preview folded away): come back when one has a size */ return; } if (layer.parentNode !== c) { cover && cover.classList.remove("fxe-cover"); cover = c; c.classList.add("fxe-cover"); c.appendChild(layer); words(); } }
      if (!rec.seen) { rec.seen = 1; io && io.observe(layer); ro && ro.observe(layer); }
      if (cv && !I && layer.getBoundingClientRect().width > 1) { I = instance(cv, id, { level, colors, still: st, photo: !!(cover && cover.querySelector("img")) }); if (I) { I.end = () => { if (ONCE[id]) { over = true; layer.remove(); LIVE.delete(I); mo && mo.disconnect(); } }; } } };
    const mo = "MutationObserver" in root ? new MutationObserver((M) => { if (!layer.isConnected || !I) place(); if (cover && M.some((m) => m.target !== layer && cover.contains(m.target))) words(); }) : null; const kill = () => { over = true; if (I) LIVE.delete(I); I = null; mo && mo.disconnect(); ro && ro.disconnect(); io && io.disconnect(); clearTimeout(rt); layer.remove(); back && back.remove(); cover && cover.classList.remove("fxe-cover"); if (host.__fxe === rec) { host.__fxe = null; host.classList.remove("fxe-host", "fxe-bk"); } };
    const rec = { sig, layer, kill, place, bye: 0, stop: () => { if (!rec.bye) rec.bye = setTimeout(kill, 0); } }; host.__fxe = rec; mo && mo.observe(host, { childList: true, subtree: true }); place(); return rec.stop; }
  /** Forget what is playing on `host`, so the next mount starts from the top (a tap on a tile in the tray plays it again). */
  const again = (host) => { host && host.__fxe && host.__fxe.kill(); };

  /** A small moving picture of an effect on `cv` (a tile in the Effect tray). Returns stop(). */
  function thumb(cv, id, { look = null, event = null, level = "subtle", still } = {}) { id = idOf(id); if (typeof document === "undefined" || !cv || !IDS.includes(id) || id === "none") return () => {};
    if (id === "paper") { const g = cv.getContext && cv.getContext("2d"); if (g) { const r = cv.getBoundingClientRect(); cv.width = r.width * 2; cv.height = r.height * 2; g.fillStyle = "#5A4A3A"; for (let i = 0; i < (level === "lively" ? 900 : 500); i++) { g.globalAlpha = rnd(0.05, 0.22); g.fillRect(rnd(0, cv.width), rnd(0, cv.height), 1.5, 1.5); } } return () => {}; }
    const I = instance(cv, id, { thumb: true, level, colors: colorsFor(look, event, null), still }); if (!I) return () => {};
    let io = null; if (!I.still && "IntersectionObserver" in root) { io = new IntersectionObserver(([x]) => { I.seen = x.isIntersecting; if (I.seen) wake(); }); io.observe(cv); }
    return () => { LIVE.delete(I); io && io.disconnect(); }; }

  root.EncoreEffects = { IDS, ALIAS, idOf, LEGACY, LEVELS, levelOf, colorsFor, countFor, mix, mount, again, thumb, running: () => [...LIVE].filter((I) => !I.done && !I.still).length,
    /** For tests: what is playing, and the time spent drawing (frames, the average and the longest, in milliseconds). */
    peek: () => [...LIVE].map((I) => ({ id: I.id, t: I.t, q: I.q, boost: I.boost, seen: I.seen })),
    stats: (reset) => { const o = { frames: ST.n, avg: ST.n ? ST.sum / ST.n : 0, max: ST.max }; if (reset) ST.n = ST.sum = ST.max = 0; return o; } };
})(typeof window !== "undefined" ? window : globalThis);
