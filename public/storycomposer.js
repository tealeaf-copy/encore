// ---- the story composer (server/storymake.js): pick or shoot, edit each slide on a 9:16 page, share ----
// One full-screen place to make a story. Start from photos and videos, the camera, or a blank page. On each slide:
// move, pinch and turn the photo; add words in eight type styles; draw; add stickers (an event, I'm in, a countdown,
// a host mention, a question, a poll, a slider, a place, the date, and drawings from the app's own art); pick a look.
// Several slides can be reordered, copied and removed. Then choose who sees it and share.
//
// How a slide is kept: everything is laid out on a page 1080 by 1920 units. The photo, words, drawing and drawn
// stickers are painted with the same code on screen and at export, so the picture that is shared is the one that was
// on screen. Stickers people can tap are not painted in: they go to the server as data and public/storykit.js draws
// them, here and in the viewer. A video is sent as it was filmed, with the words and drawing as a see-through picture
// over it. The draft lives in this browser (IndexedDB), one per person.
// Loaded only when someone opens it (the loader is in public/storyprompt.js).
(function () {
  if (window.PLStoryComposer) return;
  const U = 1080, UH = 1920, SAFE_T = 0.12, SAFE_B = 0.86, SAFE_L = 0.05, SAFE_R = 0.95;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const K = () => window.PLStoryKit;
  const G = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const svg = (d, n = 22) => `<svg ${G} width="${n}" height="${n}">${d}</svg>`;
  const I = {
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'), undo: svg('<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -4)"/>'), redo: svg('<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12h2" transform="translate(0 -4)"/>'),
    text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'), draw: svg('<path d="M4 20c2-6 5-2 7-6s3-8 9-10"/><path d="m15 5 4 4"/>'), sticker: svg('<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7l-7 7H6a2 2 0 0 1-2-2z"/><path d="M20 13h-5a2 2 0 0 0-2 2v5"/>'),
    look: svg('<circle cx="9" cy="10" r="5.5"/><circle cx="15" cy="10" r="5.5"/><circle cx="12" cy="15" r="5.5"/>'), photo: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-5-5-8 8"/>'), time: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'), left: svg('<path d="m14 6-6 6 6 6"/>', 18), right: svg('<path d="m10 6 6 6-6 6"/>', 18), copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', 18), bin: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', 18),
    cam: svg('<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>', 26), lib: svg('<rect x="6.5" y="3.5" width="14" height="13" rx="2"/><path d="M3.5 7.5v11a2 2 0 0 0 2 2h11"/><path d="m20.5 13.5-4-4-6 6"/>', 26), page: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>', 26),
    al: svg('<path d="M4 6h16M4 12h10M4 18h13"/>', 20), ac: svg('<path d="M4 6h16M7 12h10M5.5 18h13"/>', 20), ar: svg('<path d="M4 6h16M10 12h10M7 18h13"/>', 20), drop: svg('<path d="m14 4 6 6-3 1-7 7H6v-4l7-7z"/><path d="M4 20h4"/>', 20),
    pen: svg('<path d="m5 19 1-4L16 5l3 3L9 18z"/>', 20), marker: svg('<path d="m4 20 3-1 11-11-2-2L5 17z"/><path d="M13 7l4 4M4 20h6"/>', 20), hi: svg('<path d="M8 14 16 6l3 3-8 8H8z"/><path d="M4 20h16"/>', 20), erase: svg('<path d="m4 15 9-9 6 6-7 7H8z"/><path d="M9 10l6 6M12 19h8"/>', 20),
    minus: svg('<path d="M5 12h14"/>', 18), tl: svg('<path d="M4 9a8 8 0 1 1 2 9"/><path d="M4 4v5h5"/>', 18), tr: svg('<path d="M20 9a8 8 0 1 0-2 9"/><path d="M20 4v5h-5"/>', 18), edit: svg('<path d="m5 19 1-4L16 5l3 3L9 18z"/>', 18), flip: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'), play: svg('<path d="M8 5v14l11-7z"/>', 18), go: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 18),
  };
  const COLORS = [["#FFFFFF", "White"], ["#1B1D1C", "Ink"], ["#29489A", "Ink blue"], ["#C2431F", "Tomato"], ["#56683F", "Moss"], ["#F2DD6B", "Highlight yellow"], ["#F3E7A8", "Sand"], ["#86294F", "Plum"], ["#1C5A4E", "Teal"], ["#D6E6EE", "Sky"], ["#F2DCE5", "Blush"], ["#EFEBE2", "Paper"]];
  const GRADS = [["dusk", "Dusk", "#29489A", "#C2431F"], ["meadow", "Meadow", "#56683F", "#F3E7A8"], ["clay", "Clay", "#C2431F", "#F2DD6B"], ["sea", "Sea", "#1C5A4E", "#D6E6EE"], ["plum", "Plum", "#86294F", "#F2DCE5"], ["night", "Night", "#1B1D1C", "#29489A"]];
  const PAPERS = [["grid", "Grid paper"], ["dots", "Dot grid"], ["ruled", "Ruled paper"], ["kraft", "Kraft paper"], ["linen", "Linen"]];
  // type styles: only faces the app already ships (IBM Plex Sans, Serif and Mono, Caveat, Fraunces) and system stacks
  const FONTS = [
    { id: "clean", name: "Clean", f: (p) => `600 ${p}px "IBM Plex Sans",system-ui,sans-serif`, lh: 1.22 },
    { id: "serif", name: "Serif", f: (p) => `600 ${p}px "IBM Plex Serif",Georgia,serif`, lh: 1.22 },
    { id: "mono", name: "Mono", f: (p) => `500 ${Math.round(p * 0.9)}px "IBM Plex Mono",ui-monospace,monospace`, lh: 1.3 },
    { id: "hand", name: "Hand", f: (p) => `600 ${Math.round(p * 1.25)}px Caveat,"Bradley Hand",cursive`, lh: 1.08 },
    { id: "poster", name: "Poster", f: (p) => `800 ${p}px Fraunces,Georgia,serif`, lh: 1.14 },
    { id: "loud", name: "Loud", f: (p) => `900 ${p}px Impact,"Arial Black","Helvetica Neue",sans-serif`, lh: 1.12, upper: true },
    { id: "round", name: "Round", f: (p) => `700 ${p}px ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold","Trebuchet MS",sans-serif`, lh: 1.2 },
    { id: "type", name: "Typewriter", f: (p) => `700 ${Math.round(p * 0.92)}px "American Typewriter","Courier New",Courier,monospace`, lh: 1.25 },
  ];
  const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  // looks: one colour sum per pixel (saturation, contrast, lift, tint), the same on screen and at export
  const mat = (sat, con, lift, tint) => { const L = [0.299, 0.587, 0.114]; return [0, 1, 2].map((i) => [...[0, 1, 2].map((j) => con * ((i === j ? sat : 0) + (1 - sat) * L[j])), 128 * (1 - con) + lift + tint[i]]); };
  const LOOKS = [["none", "None", null], ["warm", "Warm", mat(1.05, 1, 0, [12, 3, -12])], ["cool", "Cool", mat(1, 1, 0, [-10, 0, 14])], ["mono", "Mono", mat(0, 1.06, 0, [0, 0, 0])], ["fade", "Fade", mat(0.78, 0.8, 16, [0, 0, 4])], ["film", "Film", mat(0.88, 1.12, 0, [8, 2, -8])], ["vivid", "Vivid", mat(1.4, 1.08, 0, [0, 0, 0])], ["soft", "Soft", mat(0.92, 0.9, 12, [6, 0, 4])]];
  const WIDTHS = [8, 16, 30], PEN = { pen: 1, marker: 2.2, hi: 3.6, erase: 3.2 };
  const LIVE = ["event", "imin", "count", "mention", "question", "poll", "slider"]; // stickers the viewer draws live

  // ---------- media ----------
  const MEDIA = new Map();
  const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  function imageOf(blob) { return new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(blob); i.onload = () => { const k = Math.min(1, 1920 / Math.max(i.naturalWidth, i.naturalHeight, 1)), c = canvasOf(i.naturalWidth * k, i.naturalHeight * k); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("That file isn't a photo we can open.")); }; i.src = u; }); }
  function videoOf(blob) { return new Promise((res, rej) => { const v = document.createElement("video"), url = URL.createObjectURL(blob); v.muted = true; v.playsInline = true; v.loop = true; v.preload = "auto"; let done = false;
    const fail = () => { if (done) return; done = true; URL.revokeObjectURL(url); rej(new Error("That video won't play here. Try an MP4 from your camera.")); }, t = setTimeout(fail, 9000);
    v.onerror = fail; v.onloadeddata = () => { if (done) return; const grab = () => { if (done) return; done = true; clearTimeout(t); const k = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight, 1)), c = canvasOf(v.videoWidth * k || 540, v.videoHeight * k || 960); try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); } catch {} res({ video: v, url, poster: c, seconds: isFinite(v.duration) ? v.duration : 0, w: v.videoWidth, h: v.videoHeight }); };
      v.onseeked = grab; try { v.currentTime = Math.min(0.3, (v.duration || 1) / 3); } catch { grab(); } setTimeout(grab, 1500); };
    v.src = url; }); }
  const kindOfFile = (f) => { const t = String(f.type || "").toLowerCase(); return /^image\/(jpeg|png|webp)$/.test(t) ? "image" : /^video\/(mp4|webm|quicktime)$/.test(t) || /\.(mov|mp4)$/i.test(f.name || "") ? "video" : /^image\//.test(t) ? "image" : ""; };
  async function addMedia(blob, key = uid()) { const kind = kindOfFile(blob); if (!kind) throw new Error("Stories take photos (JPEG, PNG, WebP) and videos (MP4, MOV, WebM).");
    const m = { key, kind, blob, type: blob.type || (kind === "video" ? "video/mp4" : "image/jpeg"), looks: {} };
    if (kind === "image") { m.bmp = await imageOf(blob); m.w = m.bmp.width; m.h = m.bmp.height; } else Object.assign(m, await videoOf(blob));
    MEDIA.set(key, m); return m; }
  function lookOf(m, look) { const L = LOOKS.find((l) => l[0] === look); if (!L || !L[2]) return m.bmp; if (m.looks[look]) return m.looks[look];
    const c = canvasOf(m.bmp.width, m.bmp.height), x = c.getContext("2d"); x.drawImage(m.bmp, 0, 0); tint(x, c.width, c.height, L[2]); return (m.looks[look] = c); }
  function tint(x, w, h, M) { let d; try { d = x.getImageData(0, 0, w, h); } catch { return; } const p = d.data, [R, Gr, B] = M;
    for (let i = 0; i < p.length; i += 4) { const r = p[i], g = p[i + 1], b = p[i + 2]; p[i] = R[0] * r + R[1] * g + R[2] * b + R[3]; p[i + 1] = Gr[0] * r + Gr[1] * g + Gr[2] * b + Gr[3]; p[i + 2] = B[0] * r + B[1] * g + B[2] * b + B[3]; }
    x.putImageData(d, 0, 0); }
  function blurOf(m) { if (m.blur) return m.blur; const src = m.bmp || m.poster, a = canvasOf(18, 32), b = canvasOf(72, 128), k = Math.max(18 / src.width, 32 / src.height), ax = a.getContext("2d"), bx = b.getContext("2d");
    ax.imageSmoothingQuality = "high"; ax.drawImage(src, (18 - src.width * k) / 2, (32 - src.height * k) / 2, src.width * k, src.height * k); bx.imageSmoothingQuality = "high"; bx.drawImage(a, 0, 0, 72, 128); return (m.blur = b); }

  // ---------- painting: the same code for the screen, the thumbnails and the shared picture ----------
  const MC = canvasOf(4, 4).getContext("2d");
  const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  function paper(x, id, k) { const W = U * k, H = UH * k, line = (x0, y0, x1, y1) => { x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); };
    x.fillStyle = id === "kraft" ? "#C9A77C" : id === "dots" || id === "linen" ? "#EFEBE2" : "#FAF8F3"; x.fillRect(0, 0, W, H);
    if (id === "grid") { x.strokeStyle = "rgba(41,72,154,.2)"; x.lineWidth = Math.max(1, 2 * k); for (let a = 54; a < U; a += 54) line(a * k, 0, a * k, H); for (let a = 54; a < UH; a += 54) line(0, a * k, W, a * k); }
    else if (id === "dots") { x.fillStyle = "rgba(27,29,28,.3)"; for (let a = 54; a < U; a += 54) for (let b = 54; b < UH; b += 54) { x.beginPath(); x.arc(a * k, b * k, Math.max(0.8, 4 * k), 0, 7); x.fill(); } }
    else if (id === "ruled") { x.strokeStyle = "rgba(41,72,154,.28)"; x.lineWidth = Math.max(1, 2 * k); for (let a = 240; a < UH; a += 78) line(0, a * k, W, a * k); x.strokeStyle = "rgba(194,67,31,.5)"; line(132 * k, 0, 132 * k, H); }
    else { const r = rnd(id === "kraft" ? 7 : 11); x.fillStyle = id === "kraft" ? "rgba(90,59,43,.16)" : "rgba(27,29,28,.06)"; for (let i = 0; i < 2600; i++) { const a = r() * W, b = r() * H, w = (id === "kraft" ? 3 + r() * 9 : 30 + r() * 70) * k; x.fillRect(a, b, id === "kraft" ? w : w, Math.max(1, (id === "kraft" ? 2 : 1.5) * k)); if (id === "linen") x.fillRect(b * (W / H), a * (H / W), Math.max(1, 1.5 * k), w); } } }
  function paintBg(x, sl, k) { const W = U * k, H = UH * k, bg = sl.bg || { t: "color", v: "#1B1D1C" }, m = MEDIA.get(sl.m);
    if (bg.t === "blur" && m) { x.imageSmoothingQuality = "high"; x.drawImage(blurOf(m), -W * 0.06, -H * 0.06, W * 1.12, H * 1.12); x.fillStyle = "rgba(21,23,22,.22)"; x.fillRect(0, 0, W, H); }
    else if (bg.t === "grad") { const g = GRADS.find((y) => y[0] === bg.v) || GRADS[0], gr = x.createLinearGradient(0, 0, W, H); gr.addColorStop(0, g[2]); gr.addColorStop(1, g[3]); x.fillStyle = gr; x.fillRect(0, 0, W, H); }
    else if (bg.t === "paper") paper(x, bg.v, k);
    else { x.fillStyle = /^#[0-9a-f]{6}$/i.test(bg.v || "") ? bg.v : "#1B1D1C"; x.fillRect(0, 0, W, H); } }
  function paintPhoto(x, sl, k) { const m = MEDIA.get(sl.m); if (!m) return; const W = U * k, H = UH * k;
    if (m.kind === "video") { const p = m.poster, s = Math.min(W / p.width, H / p.height); x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.drawImage(p, (W - p.width * s) / 2, (H - p.height * s) / 2, p.width * s, p.height * s); return; }
    const src = lookOf(m, sl.look), ph = sl.ph, base = (ph.fit === "fit" ? Math.min : Math.max)(W / src.width, H / src.height);
    x.save(); x.translate((0.5 + ph.x) * W, (0.5 + ph.y) * H); x.rotate((ph.r * Math.PI) / 180); x.scale(base * ph.s, base * ph.s); x.imageSmoothingQuality = "high"; x.drawImage(src, -src.width / 2, -src.height / 2); x.restore(); }
  function paintStrokes(x, strokes, k) { for (const s of strokes || []) { const p = s.p; if (!p || p.length < 2) continue; x.save(); x.lineJoin = "round"; x.lineCap = s.tool === "hi" ? "butt" : "round"; x.lineWidth = Math.max(1, s.w * k);
      if (s.tool === "erase") { x.globalCompositeOperation = "destination-out"; x.strokeStyle = "#000"; } else { x.strokeStyle = s.c; x.globalAlpha = s.tool === "marker" ? 0.55 : s.tool === "hi" ? 0.4 : 1; }
      x.beginPath(); x.moveTo(p[0] * k, p[1] * k); if (p.length === 2) x.lineTo(p[0] * k + 0.01, p[1] * k); for (let i = 2; i < p.length; i += 2) x.lineTo(p[i] * k, p[i + 1] * k); x.stroke(); x.restore(); } }
  const lum = (hex) => { const n = parseInt(String(hex).slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  /** Words, wrapped: { lines, w, h, ... } in page units. */
  function layText(it) { const F = fontOf(it.font), px = 64 * (it.fs || 1), lh = px * F.lh, pill = it.pill && it.pill !== "none", padX = pill ? px * 0.42 : px * 0.12, padY = pill ? px * 0.26 : px * 0.08, maxW = 960 - padX * 2, font = F.f(px);
    MC.font = font; const src = (F.upper ? String(it.txt || "").toUpperCase() : String(it.txt || "")) || "Type something", lines = [];
    for (const para of src.split("\n")) { let line = ""; for (const word of para.split(/(\s+)/)) { if (!word) continue; let w = word; const t = line + w;
        if (MC.measureText(t).width <= maxW) { line = t; continue; } if (line.trim()) { lines.push(line.trimEnd()); line = ""; w = w.trimStart(); }
        while (MC.measureText(w).width > maxW && w.length > 1) { let n = w.length - 1; while (n > 1 && MC.measureText(w.slice(0, n)).width > maxW) n--; lines.push(w.slice(0, n)); w = w.slice(n); } line = w; }
      lines.push(line.trimEnd()); }
    const w = Math.max(px * 0.6, ...lines.map((l) => MC.measureText(l).width)); return { lines, w: Math.ceil(w + padX * 2), h: Math.ceil(lines.length * lh + padY * 2), px, lh, padX, padY, font, pill }; }
  function layLabel(it) { const font = it.t === "when" ? `500 40px "IBM Plex Mono",ui-monospace,monospace` : `600 44px "IBM Plex Sans",system-ui,sans-serif`; MC.font = font; const txt = it.t === "when" ? String(it.txt || "").toUpperCase() : String(it.txt || "Somewhere"), ic = it.t === "place" ? 52 : 0;
    return { font, txt, ic, w: Math.ceil(MC.measureText(txt).width + 56 + ic), h: 88 }; }
  const ART = new Map();
  function artSrc(src) { const [a, b, c] = String(src).split(":"), A = window.EventArt; let s = "";
    if (a === "potto" && window.Potto) s = window.Potto.svg(b, 300, "").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/role="img" aria-label=""/, "");
    else if (A) s = A.drawing(b, A.SPOT[c] || A.SPOT.butter, 400);
    return s ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s) : ""; }
  function artOf(src, done) { let a = ART.get(src); if (!a) { a = { img: new Image(), ok: false, wait: [] }; ART.set(src, a); a.img.onload = () => { a.ok = true; a.wait.splice(0).forEach((f) => f()); }; a.img.onerror = () => a.wait.splice(0).forEach((f) => f()); a.img.src = artSrc(src); }
    if (!a.ok && done) a.wait.push(done); return a; }
  /** A painted item's size in page units, before its own scale. */
  function boxOf(it) { if (it.t === "text") { const L = layText(it); return { w: L.w, h: L.h, L }; } if (it.t === "art") return /^potto:/.test(it.src) ? { w: 330, h: 312 } : { w: 400, h: 300 }; const L = layLabel(it); return { w: L.w, h: L.h, L }; }
  function paintItem(x, it, B) {
    if (it.t === "text") { const L = B.L, light = lum(it.color || "#FFFFFF") > 0.6;
      if (it.pill === "solid") { x.fillStyle = it.color; rr(x, 0, 0, B.w, B.h, 18); x.fill(); } else if (it.pill === "soft") { x.fillStyle = light ? "rgba(21,23,22,.6)" : "rgba(255,255,255,.78)"; rr(x, 0, 0, B.w, B.h, 18); x.fill(); }
      x.font = L.font; x.textBaseline = "middle"; x.textAlign = it.align || "center"; x.fillStyle = it.pill === "solid" ? (light ? "#1B1D1C" : "#FFFFFF") : it.color || "#FFFFFF";
      if (!L.pill) { x.shadowColor = light ? "rgba(0,0,0,.45)" : "rgba(255,255,255,.5)"; x.shadowBlur = L.px * 0.12; x.shadowOffsetY = L.px * 0.03; }
      const ax = it.align === "left" ? L.padX : it.align === "right" ? B.w - L.padX : B.w / 2; L.lines.forEach((l, i) => x.fillText(l, ax, L.padY + (i + 0.5) * L.lh + L.px * 0.04)); if (!String(it.txt || "").length) { x.globalAlpha = 0.01; } return; }
    if (it.t === "art") { const a = artOf(it.src); if (a.ok) x.drawImage(a.img, 0, 0, B.w, B.h); return; }
    const L = B.L; x.fillStyle = "#FAF8F3"; x.strokeStyle = "#1B1D1C"; x.lineWidth = 4; rr(x, 2, 2, B.w - 4, B.h - 4, 18); x.fill(); x.stroke(); x.fillStyle = "#1B1D1C"; x.font = L.font; x.textBaseline = "middle"; x.textAlign = "left";
    if (L.ic) { x.save(); x.translate(26, 20); x.strokeStyle = "#C2431F"; x.lineWidth = 4.5; x.lineJoin = "round"; x.beginPath(); x.moveTo(20, 46); x.bezierCurveTo(6, 30, 2, 24, 2, 17); x.arc(20, 17, 18, Math.PI, 0); x.bezierCurveTo(38, 24, 34, 30, 20, 46); x.closePath(); x.stroke(); x.beginPath(); x.arc(20, 17, 6, 0, 7); x.stroke(); x.restore(); }
    x.fillText(L.txt, 28 + L.ic, B.h / 2 + 2); }
  const isLive = (it) => LIVE.includes(it.t);
  /** A slide as one picture k pixels per unit. transparent: only the words, drawing and drawn stickers (a video's overlay). */
  function flat(sl, k, { transparent = false } = {}) { const c = canvasOf(U * k, UH * k), x = c.getContext("2d");
    if (!transparent) { paintBg(x, sl, k); if (sl.kind !== "blank") paintPhoto(x, sl, k); }
    if ((sl.strokes || []).length) { const ink = canvasOf(U * k, UH * k); paintStrokes(ink.getContext("2d"), sl.strokes, k); x.drawImage(ink, 0, 0); }
    for (const it of sl.items) { if (isLive(it)) continue; const B = boxOf(it); x.save(); x.translate(it.x * U * k, it.y * UH * k); x.rotate((it.r * Math.PI) / 180); x.scale(it.s * k, it.s * k); x.translate(-B.w / 2, -B.h / 2); paintItem(x, it, B); x.restore(); }
    return c; }

  // ---------- the draft: this browser's IndexedDB, one per person ----------
  const DB = () => new Promise((res, rej) => { try { const r = indexedDB.open("pl-story", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
  const idb = async (mode, f) => { const db = await DB(); return new Promise((res, rej) => { const t = db.transaction("kv", mode), s = t.objectStore("kv"); let out; try { out = f(s); } catch (e) { rej(e); } t.oncomplete = () => { db.close(); res(out?.result !== undefined ? out.result : out); }; t.onerror = t.onabort = () => { db.close(); rej(t.error); }; }); };
  const Draft = {
    key: "draft:anon",
    async load() { try { return (await idb("readonly", (s) => s.get(this.key))) || null; } catch { return null; } },
    async blob(k) { try { return (await idb("readonly", (s) => s.get(this.key + ":m:" + k))) || null; } catch { return null; } },
    async putBlob(k, blob) { try { await idb("readwrite", (s) => s.put(blob, this.key + ":m:" + k)); } catch {} },
    async save(d) { try { await idb("readwrite", (s) => s.put(d, this.key)); return true; } catch { return false; } },
    async clear() { try { const p = this.key; await idb("readwrite", (s) => { const r = s.openCursor(); r.onsuccess = () => { const c = r.result; if (!c) return; if (String(c.key) === p || String(c.key).startsWith(p + ":m:")) c.delete(); c.continue(); }; }); } catch {} },
  };

  // ---------- one composer at a time ----------
  let S = null;
  function open(opts = {}) { if (S) return S.api; K().css();
    S = { opts, slides: [], cur: 0, tool: "", sel: "", hist: [], hi: -1, D: null, pen: { tool: "pen", c: "#FFFFFF", w: 1 }, share: { audience: "everyone", eventId: opts.eventId || "", eventPhoto: true, highlight: "", hlName: "", scrapbook: false }, els: new Map(), thumbs: new Map(), P: new Map(), g: null, lastTap: null, dirty: false, opener: opts.from || document.activeElement };
    const el = (S.el = document.createElement("div")); el.className = "stc"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Make a story");
    el.innerHTML = `<header class="stc-top"><button type="button" class="stc-ib" data-a="close" aria-label="Close">${I.x}</button><h2 data-title>New story</h2><button type="button" class="stc-ib" data-a="undo" aria-label="Undo" disabled>${I.undo}</button><button type="button" class="stc-ib" data-a="redo" aria-label="Redo" disabled>${I.redo}</button><button type="button" class="stc-btn pri" data-a="next" disabled>Next</button></header>
      <div class="stc-room" data-room></div><div class="stc-dock" data-dock hidden></div><p class="stc-sr" aria-live="polite" data-live></p>`;
    document.body.appendChild(el); S.prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    for (const [k, v] of Object.entries({ "/fonts/css2?family=IBM+Plex+Sans:wght@600&family=IBM+Plex+Serif:wght@600&family=IBM+Plex+Mono:wght@500&family=Caveat:wght@600&family=Fraunces:wght@800&display=swap": "stc-fonts" })) if (!document.getElementById(v)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = k; l.id = v; document.head.appendChild(l); }
    $('[data-a="close"]', el).onclick = () => leave(); $('[data-a="undo"]', el).onclick = () => undo(); $('[data-a="redo"]', el).onclick = () => redo(); $('[data-a="next"]', el).onclick = () => shareSheet();
    document.addEventListener("keydown", onKey, true); addEventListener("resize", size);
    start(); $('[data-a="close"]', el).focus({ preventScroll: true });
    S.ready = fetch("/api/story/compose", { credentials: "same-origin" }).then(async (r) => { if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search); return null; } const d = await r.json(); if (!S) return null; S.D = d; Draft.key = "draft:" + (d.me?.handle || d.me?.name || "me");
      if (S.share.eventId && !d.events.some((e) => e.ev === S.share.eventId)) S.share.eventId = ""; if (!S.slides.length) await restore(); return d; }).catch(() => null);
    S.api = { close: () => close(true), get state() { return S; } }; return S.api; }
  function close(silent) { if (!S) return; const s = S; S = null; document.removeEventListener("keydown", onKey, true); removeEventListener("resize", size); stopCam(s); s.ro?.disconnect(); for (const m of MEDIA.values()) { try { m.video?.pause(); if (m.url) URL.revokeObjectURL(m.url); } catch {} } MEDIA.clear();
    s.el.remove(); document.body.style.overflow = s.prevOverflow; if (!silent) s.opts.onClose?.(); try { (s.opener && document.contains(s.opener) ? s.opener : null)?.focus({ preventScroll: true }); } catch {} }
  const say = (t) => { const n = S && $("[data-live]", S.el); if (n) { n.textContent = ""; setTimeout(() => S && (n.textContent = t), 30); } };
  function toast(t, ms = 2600) { if (!S) return; $$(".stc-toast", S.el).forEach((n) => n.remove()); const n = document.createElement("div"); n.className = "stc-toast"; n.setAttribute("role", "status"); n.textContent = t; S.el.appendChild(n); setTimeout(() => n.remove(), ms); }
  const cur = () => S.slides[S.cur];
  const selItem = () => (S.sel ? cur()?.items.find((i) => i.id === S.sel) : null) || null;
  const photoOf = () => (cur()?.kind === "photo" ? cur().ph : null);

  // ---------- history and the draft ----------
  const snap = () => JSON.stringify({ slides: S.slides, cur: S.cur });
  function commit(why) { if (!S) return; S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(snap()); if (S.hist.length > 60) S.hist.shift(); S.hi = S.hist.length - 1; S.dirty = true; S.thumbs.delete(cur()?.id); bar(); saveSoon(); if (why) say(why); }
  function goto(i) { const d = JSON.parse(S.hist[i]); S.slides = d.slides; S.cur = clamp(d.cur, 0, Math.max(0, S.slides.length - 1)); S.hi = i; S.sel = ""; S.thumbs.clear(); S.dirty = true; saveSoon(); if (!S.slides.length) return start(); editor(); }
  const undo = () => { if (S.hi > 0) { goto(S.hi - 1); say("Undone"); } };
  const redo = () => { if (S.hi < S.hist.length - 1) { goto(S.hi + 1); say("Redone"); } };
  function bar() { const el = S.el, n = S.slides.length; $('[data-a="undo"]', el).disabled = S.hi <= 0; $('[data-a="redo"]', el).disabled = S.hi >= S.hist.length - 1; $('[data-a="next"]', el).disabled = !n; $("[data-title]", el).textContent = n > 1 ? `Slide ${S.cur + 1} of ${n}` : "New story"; }
  let saveT = 0; function saveSoon() { clearTimeout(saveT); saveT = setTimeout(() => { if (S && S.slides.length) Draft.save({ slides: S.slides, cur: S.cur, share: S.share, at: Date.now() }); }, 500); }
  async function restore() { const d = await Draft.load(); if (!S || !d?.slides?.length) return; const keep = [];
    for (const sl of d.slides) { if (sl.m && !MEDIA.has(sl.m)) { const b = await Draft.blob(sl.m); if (!b) continue; try { await addMedia(b, sl.m); } catch { continue; } } keep.push(sl); }
    if (!S || !keep.length || S.slides.length) return; S.slides = keep; S.cur = clamp(d.cur || 0, 0, keep.length - 1); S.share = { ...S.share, ...(d.share || {}), ...(S.opts.eventId ? { eventId: S.opts.eventId } : {}) }; S.hist = [snap()]; S.hi = 0; editor(); toast("Your draft is back."); }

  // ---------- start: photos and videos, the camera, a blank page ----------
  function start() { const room = $("[data-room]", S.el); $("[data-dock]", S.el).hidden = true; S.stage = null; bar();
    room.innerHTML = `<div class="stc-start"><div class="stc-potto"><span aria-hidden="true">${window.Potto ? window.Potto.svg("wave", 64, "") : ""}</span><p>What happened today?</p></div><h3>Make a story</h3><p>It stays up for 24 hours. Pick who sees it before you share.</p>
      <div class="stc-opts"><button type="button" class="stc-opt pri" data-s="lib">${I.lib}<span><b>Photos and videos</b><small>Pick one or a few. Each becomes a slide.</small></span></button>
      <button type="button" class="stc-opt" data-s="cam">${I.cam}<span><b>Camera</b><small>Take a photo now.</small></span></button>
      <button type="button" class="stc-opt" data-s="blank">${I.page}<span><b>Blank page</b><small>Just words, on a colour or paper.</small></span></button></div></div>`;
    $('[data-s="lib"]', room).onclick = () => pick(); $('[data-s="cam"]', room).onclick = () => camera(); $('[data-s="blank"]', room).onclick = () => { addSlide(blank()); S.tool = "page"; editor(); commit("Blank page added"); }; }
  const newPhoto = (m) => ({ id: uid(), kind: m.kind === "video" ? "video" : "photo", m: m.key, bg: { t: "blur" }, ph: { x: 0, y: 0, s: 1, r: 0, fit: m.kind === "video" ? "fit" : m.w / m.h > 0.7 ? "fit" : "fill" }, look: "none", items: [], strokes: [], dur: 5, trim: m.kind === "video" ? [0, Math.min(m.seconds || 30, S.D?.limits?.seconds || 30)] : null });
  const blank = () => ({ id: uid(), kind: "blank", m: "", bg: { t: "grad", v: GRADS[S.slides.length % GRADS.length][0] }, ph: { x: 0, y: 0, s: 1, r: 0, fit: "fill" }, look: "none", items: [], strokes: [], dur: 5, trim: null });
  function addSlide(sl) { S.slides.splice(S.slides.length ? S.cur + 1 : 0, 0, sl); S.cur = S.slides.indexOf(sl); S.sel = ""; }
  const maxSlides = () => S.D?.limits?.slides || 10;
  function pick({ capture = false } = {}) { const f = document.createElement("input"); f.type = "file"; f.multiple = !capture; f.accept = capture ? "image/*" : "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov"; if (capture) f.setAttribute("capture", "environment"); f.className = "stc-sr"; f.setAttribute("aria-hidden", "true"); f.tabIndex = -1; f.dataset.scFile = capture ? "cam" : "lib"; S.el.appendChild(f);
    f.onchange = () => { const files = [...(f.files || [])]; f.remove(); if (files.length) addFiles(files); }; f.click(); return f; }
  async function addFiles(files) { const room = maxSlides() - S.slides.length; if (room <= 0) return toast(`A story can have up to ${maxSlides()} slides.`); let n = 0, why = ""; const L = S.D?.limits || { imageMB: 15, videoMB: 15, seconds: 30 };
    for (const f of files.slice(0, room)) { try { const kind = kindOfFile(f); if (!kind) throw new Error("Stories take photos and short videos."); if (f.size > (kind === "video" ? L.videoMB : L.imageMB) * 1048576) throw new Error(`${kind === "video" ? "Videos" : "Photos"} can be up to ${kind === "video" ? L.videoMB : L.imageMB} MB.`);
        const m = await addMedia(f); if (!S) return; if (m.kind === "video" && m.seconds > L.seconds * 2 + 0.6) { MEDIA.delete(m.key); throw new Error(`Videos can be up to ${L.seconds * 2} seconds long.`); } Draft.putBlob(m.key, f); addSlide(newPhoto(m)); n++; } catch (e) { why = e.message; } }
    if (!S) return; if (!n) return toast(why || "That didn't open. Try another photo."); if (files.length > room) toast(`A story can have up to ${maxSlides()} slides, so the first ${room} were added.`); else if (why) toast(why);
    S.tool = ""; editor(); commit(n === 1 ? "Slide added" : `${n} slides added`); }
  // the camera, where the browser lets a page use it; otherwise the phone's own camera through the file picker
  async function camera() { if (!navigator.mediaDevices?.getUserMedia) return pick({ capture: true }); let facing = "environment";
    const begin = async () => { stopCam(S); S.cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); };
    try { await begin(); } catch { return pick({ capture: true }); } if (!S) return;
    const v = document.createElement("div"); v.className = "stc-cam"; v.innerHTML = `<video autoplay playsinline muted aria-label="Camera"></video><div class="stc-cam-bar"><button type="button" class="stc-btn" data-c="x">Cancel</button><button type="button" class="stc-btn pri" data-c="shoot">${I.cam} Take photo</button><button type="button" class="stc-btn" data-c="flip" aria-label="Switch camera">${I.flip}</button></div>`;
    S.el.appendChild(v); const vid = $("video", v); vid.srcObject = S.cam; const done = () => { stopCam(S); v.remove(); };
    $('[data-c="x"]', v).onclick = done; $('[data-c="flip"]', v).onclick = async () => { facing = facing === "user" ? "environment" : "user"; try { await begin(); vid.srcObject = S.cam; } catch { toast("This device has one camera."); } };
    $('[data-c="shoot"]', v).onclick = () => { const c = canvasOf(vid.videoWidth || 1080, vid.videoHeight || 1920); c.getContext("2d").drawImage(vid, 0, 0, c.width, c.height); c.toBlob((b) => { done(); if (b) addFiles([new File([b], "camera.jpg", { type: "image/jpeg" })]); }, "image/jpeg", 0.92); };
    $('[data-c="shoot"]', v).focus(); }
  function stopCam(s) { try { s?.cam?.getTracks().forEach((t) => t.stop()); } catch {} if (s) s.cam = null; }

  // ---------- the editor: the slide, the tools, the panel ----------
  function editor() { const room = $("[data-room]", S.el), dock = $("[data-dock]", S.el); dock.hidden = false; S.els.clear();
    room.innerHTML = `<div class="stc-stage" data-stage tabindex="0" role="application" aria-label="Slide. Tap something to select it. Arrow keys move it, plus and minus resize it, the bracket keys turn it."><canvas class="stc-base"></canvas><video class="stc-vid" playsinline muted loop hidden></video><canvas class="stc-ink"></canvas><div class="stc-items" data-items></div>
      <div class="stc-safe t" aria-hidden="true"><span>Top bar covers this</span></div><div class="stc-safe b" aria-hidden="true"><span>Reply bar covers this</span></div><i class="stc-guide v" data-gv></i><i class="stc-guide h" data-gh></i><div class="stc-bin" data-bin aria-hidden="true">${I.bin}</div></div>`;
    const st = (S.stage = $("[data-stage]", room)); st.addEventListener("pointerdown", onDown); st.addEventListener("pointermove", onMove); st.addEventListener("pointerup", onUp); st.addEventListener("pointercancel", onUp); st.addEventListener("wheel", onWheel, { passive: false });
    S.ro?.disconnect(); S.ro = new ResizeObserver(size); S.ro.observe(room);
    dock.innerHTML = `<div class="stc-tools" role="toolbar" aria-label="Tools">${[["text", "Text", I.text], ["draw", "Draw", I.draw], ["sticker", "Stickers", I.sticker], ["look", "Looks", I.look], ["page", "Photo", I.photo], ["time", "Time", I.time]].map(([k, l, ic]) => `<button type="button" class="stc-tool" data-tool="${k}" aria-pressed="false">${ic}<span>${l}</span></button>`).join("")}</div><div class="stc-panel" data-panel></div>
      <p class="stc-keys"><kbd>Arrows</kbd> move, <kbd>+</kbd> <kbd>-</kbd> resize, <kbd>[</kbd> <kbd>]</kbd> turn, <kbd>Del</kbd> removes, <kbd>Enter</kbd> edits. The mouse wheel resizes; with Shift it turns.</p>`;
    $$("[data-tool]", dock).forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    size(); panel(); bar(); }
  function size() { if (!S?.stage) return; const room = $("[data-room]", S.el), cs = getComputedStyle(room), aw = room.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = room.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), W = Math.max(120, Math.floor(Math.min(aw, (ah * 9) / 16)));
    if (S.W === W && S.stage.style.width) return paint(); S.W = W; S.H = Math.round((W * 16) / 9); S.stage.style.width = W + "px"; S.stage.style.height = S.H + "px"; const dpr = Math.min(3, devicePixelRatio || 1);
    for (const c of $$("canvas.stc-base,canvas.stc-ink", S.stage)) { c.width = Math.round(W * dpr); c.height = Math.round(S.H * dpr); } S.k = (W * dpr) / U; paint(); }
  function paint() { if (!S?.stage || !cur()) return; drawBase(); drawInk(); items(); }
  function drawBase() { const sl = cur(), c = $("canvas.stc-base", S.stage), x = c.getContext("2d"), v = $("video.stc-vid", S.stage), m = MEDIA.get(sl.m); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    if (sl.kind === "video" && m) { if (v.dataset.k !== m.key) { v.dataset.k = m.key; v.src = m.url; v.currentTime = sl.trim?.[0] || 0; v.ontimeupdate = () => { const t = cur()?.trim; if (t && (v.currentTime > t[1] || v.currentTime < t[0] - 0.3)) v.currentTime = t[0]; }; if (!RM()) v.play().catch(() => {}); } v.hidden = false; return; }
    if (!v.hidden) { v.pause(); v.hidden = true; v.removeAttribute("src"); v.dataset.k = ""; } paintBg(x, sl, S.k); if (sl.kind === "photo") paintPhoto(x, sl, S.k); }
  function drawInk(live) { const c = $("canvas.stc-ink", S.stage), x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height); paintStrokes(x, live ? [...cur().strokes, live] : cur().strokes, S.k); }
  let rafB = 0; const baseSoon = () => { if (!rafB) rafB = requestAnimationFrame(() => { rafB = 0; if (S?.stage) drawBase(); }); };
  const labelOf = (it) => (it.t === "text" ? `Text: ${String(it.txt || "empty").slice(0, 60)}` : it.t === "art" ? "Drawing" : it.t === "place" ? `Place: ${it.txt}` : it.t === "when" ? `Date: ${it.txt}` : `${K().LABEL[it.t] || "Sticker"} sticker${it.title ? ": " + it.title : it.q ? ": " + it.q : it.handle ? ": @" + it.handle : ""}`);
  /** Bring the slide's items on screen: painted ones as canvases, the ones people can tap as the kit draws them (always on top). */
  function items() { const host = $("[data-items]", S.stage), sl = cur(), keep = new Set();
    for (const it of [...sl.items.filter((i) => !isLive(i)), ...sl.items.filter(isLive)]) { keep.add(it.id); let el = S.els.get(it.id); const want = isLive(it) ? "DIV" : "CANVAS";
      if (!el || el.tagName !== want || !host.contains(el)) { el = document.createElement(want.toLowerCase()); el.className = "stc-it" + (isLive(it) ? " sk" : ""); el.dataset.id = it.id; el.tabIndex = 0; el.setAttribute("role", "button"); el.onfocus = () => { if (S && S.sel !== it.id && !S.g) select(it.id); }; S.els.set(it.id, el); el._sig = ""; }
      host.appendChild(el); draw1(it, el); el.classList.toggle("sel", S.sel === it.id); el.setAttribute("aria-label", labelOf(it) + (S.sel === it.id ? ", selected" : "")); }
    for (const [id, el] of S.els) if (!keep.has(id)) { el.remove(); S.els.delete(id); } }
  function draw1(it, el) { const W = S.W, H = S.H;
    if (isLive(it)) { const sig = JSON.stringify({ ...it, x: 0, y: 0, s: 0, r: 0 }); if (el._sig !== sig) { el._sig = sig; el.innerHTML = K().html(it, {}); } K().place(el, it, W, H); return; }
    const B = boxOf(it), q = Math.min(1.5, 2400 / Math.max(B.w * it.s, B.h * it.s, 1)), sig = JSON.stringify({ ...it, x: 0, y: 0, r: 0 }) + "|" + (it.t === "art" ? artOf(it.src).ok : document.fonts?.status);
    if (el._sig !== sig) { el._sig = sig; el.width = Math.max(2, Math.round(B.w * it.s * q)); el.height = Math.max(2, Math.round(B.h * it.s * q)); const x = el.getContext("2d"); x.scale(it.s * q, it.s * q); if (it.t === "art" && !artOf(it.src).ok) artOf(it.src, () => { el._sig = ""; if (S?.stage) items(); }); paintItem(x, it, B); }
    el.style.width = ((B.w * it.s * W) / U).toFixed(1) + "px"; el.style.height = ((B.h * it.s * W) / U).toFixed(1) + "px"; el.style.transform = `translate(${(it.x * W).toFixed(1)}px,${(it.y * H).toFixed(1)}px) translate(-50%,-50%) rotate(${it.r}deg)`; }
  /** An item's size as a share of the slide (for snapping to the margins). */
  function spanOf(it) { if (isLive(it)) { const el = S.els.get(it.id), k = (S.W / K().REF) * it.s; return { w: ((el?.offsetWidth || 200) * k) / S.W, h: ((el?.offsetHeight || 100) * k) / S.H }; } const B = boxOf(it); return { w: (B.w * it.s) / U, h: (B.h * it.s) / UH }; }
  function select(id, { front = false } = {}) { const sl = cur(); if (front && id) { const i = sl.items.findIndex((y) => y.id === id); if (i >= 0 && i < sl.items.length - 1) sl.items.push(sl.items.splice(i, 1)[0]); }
    const was = S.sel; S.sel = id || ""; if (S.sel && S.tool && !(S.tool === "text" && selItem()?.t === "text")) S.tool = ""; items(); if (was !== S.sel || front) panel(); }
  function setTool(t) { if (S.editing) endEdit(); if (t === "sticker") return stickerSheet(); S.tool = S.tool === t && !S.sel ? "" : t; if (S.tool) { const it = selItem(); if (!(t === "text" && it?.t === "text")) S.sel = ""; }
    if (S.tool === "text" && !selItem()) { const sl = cur(); if (!sl.items.some((i) => i.t === "text")) { addText(0.5, 0.42); return; } }
    items(); panel(); }

  // ---------- gestures: drag, pinch, turn; the wheel and the keyboard do the same ----------
  const posOf = (e) => { const r = S.stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const grab = (t) => (t ? { x: t.x, y: t.y, s: t.s, r: t.r } : null);
  function onDown(e) { if (e.button > 0 || !cur()) return; if (S.editing) endEdit(); try { S.stage.setPointerCapture(e.pointerId); } catch {} S.P.set(e.pointerId, { x: e.clientX, y: e.clientY }); const sl = cur();
    if (S.P.size === 1) { if (S.dropper) { e.preventDefault(); return dropAt(posOf(e)); }
      if (S.tool === "draw") { const p = posOf(e); S.g = { stroke: { tool: S.pen.tool, c: S.pen.c, w: WIDTHS[S.pen.w] * PEN[S.pen.tool], p: [Math.round(p.x * U), Math.round(p.y * UH)] } }; drawInk(S.g.stroke); return; }
      const itEl = e.target.closest?.(".stc-it"), it = itEl ? sl.items.find((i) => i.id === itEl.dataset.id) : null; if (it && S.sel !== it.id) select(it.id, { front: true }); else if (it) select(it.id, { front: true });
      const target = it || (S.sel ? null : photoOf()); S.g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), it, target, from: grab(target), tap: true, at: posOf(e) }; }
    else if (S.P.size === 2) { if (S.g?.stroke) { S.g = null; drawInk(); } const target = selItem() || photoOf(), [a, b] = [...S.P.values()]; if (!target) { S.g = null; return; }
      S.g = { pinch: true, target, it: selItem(), from: grab(target), d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, moved: true }; } }
  function onMove(e) { if (!S.P.has(e.pointerId) || !S.g) return; S.P.set(e.pointerId, { x: e.clientX, y: e.clientY }); const g = S.g;
    if (g.stroke) { const p = posOf(e), L = g.stroke.p, x = Math.round(p.x * U), y = Math.round(p.y * UH); if (Math.hypot(x - L[L.length - 2], y - L[L.length - 1]) > 3) { L.push(x, y); drawInk(g.stroke); } return; }
    if (!g.target) { if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8) g.tap = false; return; }
    if (g.pinch) { const [a, b] = [...S.P.values()]; if (!b) return; const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, an = Math.atan2(b.y - a.y, b.x - a.x); g.target.s = clamp(g.from.s * (d / g.d0), 0.25, 6); let r = g.from.r + ((an - g.a0) * 180) / Math.PI; r = ((((r + 180) % 360) + 360) % 360) - 180; g.target.r = Math.abs(r) < 3 ? 0 : Math.round(r * 10) / 10;
      g.target.x = g.from.x + ((a.x + b.x) / 2 - g.cx) / S.W; g.target.y = g.from.y + ((a.y + b.y) / 2 - g.cy) / S.H; if (g.it) draw1(g.it, S.els.get(g.it.id)); else baseSoon(); return; }
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (g.tap && Math.hypot(dx, dy) < 6) return; g.tap = false; g.moved = true; g.target.x = g.from.x + dx / S.W; g.target.y = g.from.y + dy / S.H;
    if (g.it) { g.target.x = clamp(g.target.x, -0.1, 1.1); g.target.y = clamp(g.target.y, -0.05, 1.05); S.stage.classList.add("moving"); snapTo(g.it); const bin = $("[data-bin]", S.stage).getBoundingClientRect(), hot = Math.hypot(e.clientX - (bin.left + bin.width / 2), e.clientY - (bin.top + bin.height / 2)) < 44; g.hot = hot; $("[data-bin]", S.stage).classList.toggle("hot", hot); draw1(g.it, S.els.get(g.it.id)); }
    else { g.target.x = clamp(g.target.x, -1.5, 1.5); g.target.y = clamp(g.target.y, -1.5, 1.5); if (Math.abs(g.target.x) < 0.015) g.target.x = 0; if (Math.abs(g.target.y) < 0.01) g.target.y = 0; baseSoon(); } }
  function guides(vx, hy) { const v = $("[data-gv]", S.stage), h = $("[data-gh]", S.stage); v.classList.toggle("on", vx != null); h.classList.toggle("on", hy != null); if (vx != null) v.style.left = vx * 100 + "%"; if (hy != null) h.style.top = hy * 100 + "%"; }
  /** Snap to the centre lines and the safe margins while dragging; show the line it caught. */
  function snapTo(it) { const b = spanOf(it); let vx = null, hy = null;
    if (Math.abs(it.x - 0.5) < 0.02) { it.x = 0.5; vx = 0.5; } else if (Math.abs(it.x - b.w / 2 - SAFE_L) < 0.014) { it.x = SAFE_L + b.w / 2; vx = SAFE_L; } else if (Math.abs(it.x + b.w / 2 - SAFE_R) < 0.014) { it.x = SAFE_R - b.w / 2; vx = SAFE_R; }
    if (Math.abs(it.y - 0.5) < 0.012) { it.y = 0.5; hy = 0.5; } else if (Math.abs(it.y - b.h / 2 - SAFE_T) < 0.009) { it.y = SAFE_T + b.h / 2; hy = SAFE_T; } else if (Math.abs(it.y + b.h / 2 - SAFE_B) < 0.009) { it.y = SAFE_B - b.h / 2; hy = SAFE_B; }
    guides(vx, hy); }
  function onUp(e) { if (!S.P.has(e.pointerId)) return; S.P.delete(e.pointerId); const g = S.g; if (!g) return;
    if (g.stroke) { S.g = null; cur().strokes.push(g.stroke); drawInk(); return commit(); }
    if (S.P.size) { const [id, p] = [...S.P.entries()][0]; S.g = { id, x0: p.x, y0: p.y, t0: 0, it: g.it, target: g.target, from: grab(g.target), tap: false, moved: true }; return; } // one finger left after a pinch: carry on dragging from here
    S.g = null; S.stage.classList.remove("moving"); guides(null, null); $("[data-bin]", S.stage).classList.remove("hot");
    if (g.tap && e.type !== "pointercancel") return tap(g);
    if (g.it && g.hot) return removeItem(g.it.id);
    if (g.moved) { if (g.it) items(); else drawBase(); commit(); } }
  function tap(g) { const now = performance.now(), it = g.it;
    if (it) { const dbl = S.lastTap && S.lastTap.id === it.id && now - S.lastTap.t < 380; S.lastTap = { id: it.id, t: now }; if (dbl) editItem(it); return; }
    S.lastTap = null; if (S.tool === "text") return addText(g.at.x, g.at.y); if (S.sel) return select(""); }
  let wheelT = 0; function onWheel(e) { const t = selItem() || photoOf(); if (!t) return; e.preventDefault(); if (e.shiftKey) t.r = clamp(Math.round(t.r + Math.sign(e.deltaY || e.deltaX) * 3), -180, 180); else t.s = clamp(t.s * Math.exp(-e.deltaY * 0.0015), 0.25, 6);
    if (selItem()) draw1(selItem(), S.els.get(S.sel)); else baseSoon(); clearTimeout(wheelT); wheelT = setTimeout(() => S && commit(), 350); }
  function nudge(t, k, big) { const d = big ? 0.05 : 0.01; if (k === "ArrowLeft") t.x -= d; else if (k === "ArrowRight") t.x += d; else if (k === "ArrowUp") t.y -= d * 0.5625; else if (k === "ArrowDown") t.y += d * 0.5625; else if (k === "+" || k === "=") t.s = clamp(t.s * 1.1, 0.25, 6); else if (k === "-" || k === "_") t.s = clamp(t.s / 1.1, 0.25, 6); else if (k === "[") t.r = clamp(t.r - 5, -180, 180); else if (k === "]") t.r = clamp(t.r + 5, -180, 180); else return false;
    t.x = Math.round(t.x * 1e4) / 1e4; t.y = Math.round(t.y * 1e4) / 1e4; return true; }
  function onKey(e) { if (!S || !document.contains(S.el)) return; const tag = e.target?.tagName || "", typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag), sheet = $(".stc-scrim", S.el);
    if (e.key === "Tab") { const F = $$("button:not(:disabled),a[href],input,select,textarea,[tabindex='0']", sheet || S.el).filter((x) => x.offsetParent !== null && !x.closest("[hidden]") && x.tabIndex >= 0); if (!F.length) return; const i = F.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); F[F.length - 1].focus(); } else if (!e.shiftKey && (i === F.length - 1 || i < 0)) { e.preventDefault(); F[0].focus(); } return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if ($(".stc-cam", S.el)) return $('[data-c="x"]', S.el).click(); if (sheet) return sheet._close?.(); if (S.editing) return endEdit(); if (S.dropper) { S.dropper = null; return panel(); } if (S.sel) return select(""); if (S.tool) { S.tool = ""; return panel(); } return leave(); }
    if (typing || sheet || !S.stage) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); return redo(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return; const onStage = S.stage.contains(document.activeElement) || document.activeElement === document.body, it = selItem();
    if (!onStage && !/^(\+|=|-|_|\[|\])$/.test(e.key)) return; if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return; if (!onStage && tag === "BUTTON" && !it) return;
    if (it && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); return removeItem(it.id); } if (it && e.key === "Enter") { e.preventDefault(); return editItem(it); }
    const t = it || photoOf(); if (t && nudge(t, e.key, e.shiftKey)) { e.preventDefault(); if (it) { items(); say(`${Math.round(it.x * 100)} across, ${Math.round(it.y * 100)} down`); } else drawBase(); clearTimeout(wheelT); wheelT = setTimeout(() => S && commit(), 350); } }

  // ---------- words ----------
  const useFont = (F) => { try { document.fonts.load(F.f(40), "Aa").then(() => { if (S?.stage) { for (const el of S.els.values()) el._sig = ""; items(); } }); } catch {} };
  function addText(x, y) { const last = cur().items.filter((i) => i.t === "text").slice(-1)[0], it = { id: uid(), t: "text", txt: "", font: last?.font || "clean", color: last?.color || (cur().kind === "blank" && cur().bg.t === "paper" ? "#1B1D1C" : "#FFFFFF"), align: "center", pill: last?.pill || "none", fs: 1, x: clamp(x, 0.1, 0.9), y: clamp(y, 0.14, 0.84), s: 1, r: 0 };
    cur().items.push(it); S.sel = it.id; S.tool = "text"; items(); panel(); editItem(it); }
  function editItem(it) { if (it.t === "text") return editText(it); if (it.t === "art") return; stickerForm(it.t, it); }
  function editText(it) { if (S.editing) endEdit(); S.editing = it.id; S.sel = it.id; items(); const box = document.createElement("div"); box.className = "stc-edit";
    box.innerHTML = `<label class="stc-sr" for="scTxt">Your words</label><textarea id="scTxt" rows="2" maxlength="280" placeholder="Type something" enterkeyhint="done"></textarea><button type="button" class="stc-btn pri" data-done>Done</button>`;
    $("[data-room]", S.el).appendChild(box); const ta = $("textarea", box); ta.value = it.txt; ta.oninput = () => { it.txt = ta.value.replace(/\n{3,}/g, "\n\n"); const el = S.els.get(it.id); if (el) draw1(it, el); };
    for (const ev of ["pointerdown", "pointerup"]) box.addEventListener(ev, (e) => e.stopPropagation()); $("[data-done]", box).onclick = () => endEdit(); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
  function endEdit() { const id = S.editing; if (!id) return; S.editing = ""; $(".stc-edit", S.el)?.remove(); const it = cur().items.find((i) => i.id === id); if (!it) return;
    it.txt = String(it.txt || "").trim(); if (!it.txt) { cur().items = cur().items.filter((i) => i.id !== id); if (S.sel === id) S.sel = ""; items(); panel(); return; } items(); panel(); commit("Text added"); S.els.get(id)?.focus({ preventScroll: true }); }
  function removeItem(id) { const sl = cur(); sl.items = sl.items.filter((i) => i.id !== id); if (S.sel === id) S.sel = ""; items(); panel(); commit("Removed"); S.stage.focus({ preventScroll: true }); }

  // ---------- the panel under the tools ----------
  const sw = (c, name, on, attr) => `<button type="button" class="stc-sw" style="--c:${c}" ${attr} aria-label="${esc(name)}" aria-pressed="${on}"></button>`;
  const colours = (curC, attr, drop = true) => `<div class="stc-row"><span class="stc-lab" aria-hidden="true">Colour</span><div class="stc-scroll" role="group" aria-label="Colour">${drop && cur().kind !== "video" ? `<button type="button" class="stc-chip ic" data-drop aria-label="Pick a colour from the slide" aria-pressed="${!!S.dropper}">${I.drop}</button>` : ""}${COLORS.map(([c, n]) => sw(c, n, String(curC).toUpperCase() === c, `${attr}="${c}"`)).join("")}${curC && !COLORS.some(([c]) => c === String(curC).toUpperCase()) ? sw(curC, "Picked colour", true, `${attr}="${curC}"`) : ""}</div></div>`;
  function panel() { if (!S?.stage) return; const p = $("[data-panel]", S.el), sl = cur(), it = selItem(), f = document.activeElement?.closest?.("[data-k]")?.dataset.k; let mode = S.tool;
    if (it?.t === "text") mode = "text"; else if (it) mode = "item";
    $$("[data-tool]", S.el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === mode || (b.dataset.tool === "page" && mode === "page")))); const pg = $('[data-tool="page"] span', S.el); if (pg) pg.textContent = sl.kind === "blank" ? "Page" : sl.kind === "video" ? "Video" : "Photo";
    S.stage.classList.toggle("drawing", mode === "draw"); S.stage.classList.toggle("guides", mode === "text" || mode === "item");
    if (mode === "text") { const t = it?.t === "text" ? it : null; FONTS.forEach(useFontOnce);
      p.innerHTML = t ? `<div class="stc-row"><span class="stc-lab" aria-hidden="true">Style</span><div class="stc-scroll" role="group" aria-label="Type style">${FONTS.map((F) => `<button type="button" class="stc-chip" data-k="f-${F.id}" data-font="${F.id}" aria-pressed="${t.font === F.id}" style="font:${F.f(15).replace(/"/g, "'")}">${F.upper ? F.name.toUpperCase() : F.name}</button>`).join("")}</div></div>${colours(t.color, "data-col")}
        <div class="stc-row"><button type="button" class="stc-chip ic" data-k="al" data-align aria-label="Align: ${t.align === "left" ? "left" : t.align === "right" ? "right" : "centre"}. Tap to change">${t.align === "left" ? I.al : t.align === "right" ? I.ar : I.ac}</button><button type="button" class="stc-chip" data-k="pill" data-pill aria-label="Background: ${t.pill === "solid" ? "solid" : t.pill === "soft" ? "see-through" : "none"}. Tap to change">${t.pill === "solid" ? "Solid" : t.pill === "soft" ? "Soft" : "No fill"}</button><label class="stc-sr" for="scFs">Size</label><input class="stc-range" id="scFs" data-k="fs" type="range" min="0.5" max="2.6" step="0.05" value="${t.fs}"><button type="button" class="stc-chip ic" data-k="ed" data-edit aria-label="Edit the words">${I.edit}</button><button type="button" class="stc-chip ic" data-k="rm" data-rm aria-label="Delete this text">${I.bin}</button></div>`
        : `<p class="stc-note">Tap the slide where the words should go. Tap words to restyle them, twice to change them.</p><div class="stc-row"><button type="button" class="stc-btn" data-k="nt" data-newtext>${I.plus} Add text</button></div>`;
      $$("[data-font]", p).forEach((b) => (b.onclick = () => { t.font = b.dataset.font; useFont(fontOf(t.font)); items(); panel(); commit(); })); $$("[data-col]", p).forEach((b) => (b.onclick = () => { t.color = b.dataset.col; items(); panel(); commit(); }));
      if (t) { $("[data-align]", p).onclick = () => { t.align = t.align === "center" ? "left" : t.align === "left" ? "right" : "center"; items(); panel(); commit(); }; $("[data-pill]", p).onclick = () => { t.pill = t.pill === "none" ? "solid" : t.pill === "solid" ? "soft" : "none"; items(); panel(); commit(); };
        const fs = $("#scFs", p); fs.oninput = () => { t.fs = +fs.value; draw1(t, S.els.get(t.id)); }; fs.onchange = () => commit(); $("[data-edit]", p).onclick = () => editText(t); $("[data-rm]", p).onclick = () => removeItem(t.id); }
      else $("[data-newtext]", p).onclick = () => addText(0.5, 0.42); }
    else if (mode === "item") { const canEdit = it.t !== "art";
      p.innerHTML = `<p class="stc-note">${esc(labelOf(it))}. Drag it, pinch it, or use these.</p><div class="stc-acts three">${[["sm", "Smaller", I.minus], ["bg", "Bigger", I.plus], ["tl", "Turn left", I.tl], ["tr", "Turn right", I.tr], ...(canEdit ? [["ed", "Edit", I.edit]] : []), ["rm", "Delete", I.bin]].map(([k, l, ic]) => `<button type="button" class="stc-act" data-k="i-${k}" data-i="${k}">${ic}<span>${l}</span></button>`).join("")}</div>`;
      $$("[data-i]", p).forEach((b) => (b.onclick = () => { const k = b.dataset.i; if (k === "rm") return removeItem(it.id); if (k === "ed") return editItem(it); nudge(it, { sm: "-", bg: "+", tl: "[", tr: "]" }[k]); items(); commit(); })); }
    else if (mode === "draw") { const P = S.pen;
      p.innerHTML = `<div class="stc-row"><span class="stc-lab" aria-hidden="true">Tool</span><div class="stc-scroll" role="group" aria-label="Drawing tool">${[["pen", "Pen", I.pen], ["marker", "Marker", I.marker], ["hi", "Highlighter", I.hi], ["erase", "Eraser", I.erase]].map(([k, l, ic]) => `<button type="button" class="stc-chip" data-k="p-${k}" data-pen="${k}" aria-pressed="${P.tool === k}">${ic}${l}</button>`).join("")}</div></div>${colours(P.c, "data-col")}
        <div class="stc-row"><span class="stc-lab" aria-hidden="true">Width</span><div class="stc-scroll" role="group" aria-label="Line width">${["Thin", "Medium", "Thick"].map((l, i) => `<button type="button" class="stc-chip" data-k="w-${i}" data-w="${i}" aria-pressed="${P.w === i}">${l}</button>`).join("")}<button type="button" class="stc-chip" data-k="clr" data-clear ${sl.strokes.length ? "" : "disabled"}>Clear drawing</button></div></div>`;
      $$("[data-pen]", p).forEach((b) => (b.onclick = () => { P.tool = b.dataset.pen; panel(); })); $$("[data-w]", p).forEach((b) => (b.onclick = () => { P.w = +b.dataset.w; panel(); })); $$("[data-col]", p).forEach((b) => (b.onclick = () => { P.c = b.dataset.col; if (P.tool === "erase") P.tool = "pen"; panel(); }));
      $("[data-clear]", p).onclick = () => { sl.strokes = []; drawInk(); panel(); commit("Drawing cleared"); }; }
    else if (mode === "look") { if (sl.kind !== "photo") p.innerHTML = `<p class="stc-note">${sl.kind === "video" ? "Looks are for photos. A video is shared as it was filmed." : "Looks are for photos. This page has none."}</p>`;
      else { p.innerHTML = `<div class="stc-scroll" role="group" aria-label="Looks">${LOOKS.map(([k, l]) => `<button type="button" class="stc-look" data-k="l-${k}" data-look="${k}" aria-pressed="${sl.look === k}"><canvas width="96" height="170"></canvas><span>${l}</span></button>`).join("")}</div>`;
        const m = MEDIA.get(sl.m), tiny = canvasOf(96, 170), s = Math.max(96 / m.bmp.width, 170 / m.bmp.height); tiny.getContext("2d").drawImage(m.bmp, (96 - m.bmp.width * s) / 2, (170 - m.bmp.height * s) / 2, m.bmp.width * s, m.bmp.height * s);
        $$("[data-look]", p).forEach((b) => { const L = LOOKS.find((y) => y[0] === b.dataset.look), x = $("canvas", b).getContext("2d"); x.drawImage(tiny, 0, 0); if (L[2]) tint(x, 96, 170, L[2]); b.onclick = () => { sl.look = L[0]; drawBase(); panel(); commit(`${L[1]} look`); }; }); } }
    else if (mode === "page") { const bg = sl.bg, sws = (L) => L.join("");
      const cols = COLORS.map(([c, n]) => sw(c, n, bg.t === "color" && bg.v === c, `data-k="b-${c}" data-bg="color:${c}"`)), grads = GRADS.map((g) => `<button type="button" class="stc-sw" data-k="b-${g[0]}" data-bg="grad:${g[0]}" style="background:linear-gradient(135deg,${g[2]},${g[3]})" aria-label="${g[1]} gradient" aria-pressed="${bg.t === "grad" && bg.v === g[0]}"></button>`), papers = PAPERS.map((q) => `<button type="button" class="stc-sw" data-k="b-${q[0]}" data-bg="paper:${q[0]}" aria-label="${q[1]}" aria-pressed="${bg.t === "paper" && bg.v === q[0]}"><canvas width="88" height="88" data-paper="${q[0]}"></canvas></button>`);
      if (sl.kind === "video") p.innerHTML = `<p class="stc-note">A video is shared whole, as it was filmed, with your words and drawing on top. Use Time to trim where it starts and ends.</p>`;
      else if (sl.kind === "photo") p.innerHTML = `<div class="stc-row"><span class="stc-lab" aria-hidden="true">Photo</span><div class="stc-scroll" role="group" aria-label="Photo size"><button type="button" class="stc-chip" data-k="fit" data-fit="fit" aria-pressed="${sl.ph.fit === "fit"}">Fit</button><button type="button" class="stc-chip" data-k="fill" data-fit="fill" aria-pressed="${sl.ph.fit !== "fit"}">Fill</button><button type="button" class="stc-chip ic" data-k="ptl" data-turn="-90" aria-label="Turn the photo left">${I.tl}</button><button type="button" class="stc-chip ic" data-k="ptr" data-turn="90" aria-label="Turn the photo right">${I.tr}</button><button type="button" class="stc-chip" data-k="rs" data-reset>Reset</button></div></div>
        <div class="stc-row"><span class="stc-lab" aria-hidden="true">Behind</span><div class="stc-scroll" role="group" aria-label="Behind the photo"><button type="button" class="stc-chip" data-k="b-blur" data-bg="blur:" aria-pressed="${bg.t === "blur"}">Blur</button>${sws(cols)}</div></div><p class="stc-note">Drag the photo to move it. Pinch or use the wheel to zoom, two fingers to turn.</p>`;
      else p.innerHTML = `<div class="stc-row"><span class="stc-lab" aria-hidden="true">Colour</span><div class="stc-scroll" role="group" aria-label="Page colour">${sws(cols)}</div></div><div class="stc-row"><span class="stc-lab" aria-hidden="true">Blend</span><div class="stc-scroll" role="group" aria-label="Gradients">${sws(grads)}</div></div><div class="stc-row"><span class="stc-lab" aria-hidden="true">Paper</span><div class="stc-scroll" role="group" aria-label="Paper">${sws(papers)}</div></div>`;
      $$("[data-paper]", p).forEach((c) => paper(c.getContext("2d"), c.dataset.paper, 88 / 400)); $$("[data-bg]", p).forEach((b) => (b.onclick = () => { const [t, v] = b.dataset.bg.split(":"); sl.bg = { t, v }; drawBase(); panel(); commit(); }));
      $$("[data-fit]", p).forEach((b) => (b.onclick = () => { Object.assign(sl.ph, { fit: b.dataset.fit, x: 0, y: 0, s: 1 }); drawBase(); panel(); commit(b.dataset.fit === "fit" ? "The whole photo fits" : "The photo fills the slide"); }));
      $$("[data-turn]", p).forEach((b) => (b.onclick = () => { let r = sl.ph.r + +b.dataset.turn; r = ((((r + 180) % 360) + 360) % 360) - 180; sl.ph.r = r; drawBase(); commit(); })); const rs = $("[data-reset]", p); if (rs) rs.onclick = () => { Object.assign(sl.ph, { x: 0, y: 0, s: 1, r: 0 }); drawBase(); commit("Photo reset"); }; }
    else if (mode === "time") { const m = MEDIA.get(sl.m);
      if (sl.kind === "video") { const len = Math.round((m?.seconds || 0) * 10) / 10, cap = S.D?.limits?.seconds || 30, t = sl.trim || [0, Math.min(len, cap)];
        p.innerHTML = `<p class="stc-note" data-tl>Plays ${fmt(t[1] - t[0])} of ${fmt(len)}. A story video can run up to ${cap} seconds.</p><div class="stc-row"><label class="stc-lab" for="scT0">Start</label><input class="stc-range" id="scT0" data-k="t0" type="range" min="0" max="${len}" step="0.1" value="${t[0]}"></div><div class="stc-row"><label class="stc-lab" for="scT1">End</label><input class="stc-range" id="scT1" data-k="t1" type="range" min="0" max="${len}" step="0.1" value="${t[1]}"></div>`;
        const a = $("#scT0", p), z = $("#scT1", p), v = $("video.stc-vid", S.stage), up = (who) => { let s = +a.value, e = +z.value; if (who === "a") { s = Math.min(s, len - 1); if (e - s < 1) e = Math.min(len, s + 1); if (e - s > cap) e = s + cap; } else { e = Math.max(e, 1); if (e - s < 1) s = Math.max(0, e - 1); if (e - s > cap) s = e - cap; } a.value = s; z.value = e; sl.trim = [Math.round(s * 10) / 10, Math.round(e * 10) / 10]; $("[data-tl]", p).textContent = `Plays ${fmt(e - s)} of ${fmt(len)}. A story video can run up to ${cap} seconds.`; try { v.currentTime = who === "a" ? s : Math.max(s, e - 1); } catch {} };
        a.oninput = () => up("a"); z.oninput = () => up("z"); a.onchange = z.onchange = () => commit("Trim changed"); }
      else { p.innerHTML = `<p class="stc-note" data-dl>Shows for ${sl.dur} seconds.</p><div class="stc-row"><label class="stc-lab" for="scDur">Time</label><input class="stc-range" id="scDur" data-k="dur" type="range" min="2" max="15" step="1" value="${sl.dur}"></div>`;
        const d = $("#scDur", p); d.oninput = () => { sl.dur = +d.value; $("[data-dl]", p).textContent = `Shows for ${sl.dur} seconds.`; }; d.onchange = () => commit(); } }
    else strip(p);
    const dr = $("[data-drop]", p); if (dr) dr.onclick = () => { S.dropper = S.dropper ? null : mode; panel(); if (S.dropper) hint("Tap the slide to take a colour from it."); else hint(""); };
    if (!S.dropper) hint(""); if (f) $(`[data-k="${CSS.escape(f)}"]`, p)?.focus({ preventScroll: true }); }
  const seenFont = new Set(); const useFontOnce = (F) => { if (seenFont.has(F.id)) return; seenFont.add(F.id); useFont(F); };
  const fmt = (s) => `${Math.round(s * 10) / 10} ${Math.round(s * 10) / 10 === 1 ? "second" : "seconds"}`;
  function hint(t) { $(".stc-hint", S.el)?.remove(); if (!t) return; const h = document.createElement("div"); h.className = "stc-hint"; h.textContent = t; S.stage.appendChild(h); }
  function dropAt(p) { const mode = S.dropper; S.dropper = null; S.P.clear(); const k = 0.25, c = flat(cur(), k), d = c.getContext("2d").getImageData(clamp(Math.round(p.x * c.width), 0, c.width - 1), clamp(Math.round(p.y * c.height), 0, c.height - 1), 1, 1).data, hex = "#" + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    if (mode === "draw") S.pen.c = hex; else { const t = selItem(); if (t?.t === "text") { t.color = hex; items(); commit(); } } panel(); say("Colour picked"); }
  /** The slides: tap one to go to it, drag to reorder, and Move left, Move right, Copy and Delete for the one in view. */
  function strip(p) { const n = S.slides.length, i = S.cur;
    p.innerHTML = `<div class="stc-row"><div class="stc-scroll" role="list" aria-label="Slides">${S.slides.map((sl, j) => `<button type="button" role="listitem" class="stc-thumb" data-k="th-${sl.id}" data-th="${j}" aria-current="${j === i}" aria-label="Slide ${j + 1} of ${n}${j === i ? ", showing" : ""}"><canvas width="100" height="176"></canvas><i>${j + 1}</i></button>`).join("")}<button type="button" class="stc-add" data-k="add" data-addslide aria-label="Add a slide" ${n >= maxSlides() ? "disabled" : ""}>${I.plus}</button></div></div>
      <div class="stc-acts"><button type="button" class="stc-act" data-k="ml" data-mv="-1" ${i === 0 ? "disabled" : ""}><span>Move left</span></button><button type="button" class="stc-act" data-k="mr" data-mv="1" ${i >= n - 1 ? "disabled" : ""}><span>Move right</span></button><button type="button" class="stc-act" data-k="cp" data-copy ${n >= maxSlides() ? "disabled" : ""}>${I.copy}<span>Copy</span></button><button type="button" class="stc-act" data-k="del" data-del>${I.bin}<span>Delete</span></button></div>`;
    $$("[data-th]", p).forEach((b) => { const sl = S.slides[+b.dataset.th], c = $("canvas", b); let t = S.thumbs.get(sl.id); if (!t) { t = flat(sl, 100 / U); S.thumbs.set(sl.id, t); } c.getContext("2d").drawImage(t, 0, 0);
      b.onclick = () => { if (b._dragged) { b._dragged = false; return; } if (S.editing) endEdit(); S.cur = +b.dataset.th; S.sel = ""; paint(); panel(); bar(); };
      // drag to reorder: at once with a mouse, after a short hold with a finger (so the row still scrolls)
      b.onpointerdown = (e) => { if (e.button > 0) return; const x0 = e.clientX, from = +b.dataset.th; let on = false, hold = e.pointerType === "mouse" ? null : setTimeout(() => { on = true; b.classList.add("drag"); try { b.setPointerCapture(e.pointerId); } catch {} }, 320);
        const mv = (m) => { if (!on && e.pointerType === "mouse" && Math.abs(m.clientX - x0) > 8) { on = true; b.classList.add("drag"); try { b.setPointerCapture(e.pointerId); } catch {} } if (on) { b.style.transform = `translateX(${m.clientX - x0}px) scale(1.06)`; m.preventDefault(); } else if (Math.abs(m.clientX - x0) > 10) clearTimeout(hold); };
        const up = (u) => { clearTimeout(hold); b.removeEventListener("pointermove", mv); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up); if (!on) return; b._dragged = true; b.classList.remove("drag"); b.style.transform = "";
          const to = clamp(from + Math.round((u.clientX - x0) / (b.offsetWidth + 8)), 0, n - 1); if (to !== from && u.type === "pointerup") moveSlide(from, to); };
        b.addEventListener("pointermove", mv); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); }; });
    $("[data-addslide]", p).onclick = () => addSheet(); $$("[data-mv]", p).forEach((b) => (b.onclick = () => moveSlide(i, i + +b.dataset.mv)));
    $("[data-copy]", p).onclick = () => { const c = JSON.parse(JSON.stringify(cur())); c.id = uid(); c.items.forEach((y) => (y.id = uid())); addSlide(c); paint(); panel(); commit("Slide copied"); };
    $("[data-del]", p).onclick = () => { S.slides.splice(i, 1); S.cur = clamp(i, 0, S.slides.length - 1); S.sel = ""; if (!S.slides.length) { S.hist.push(snap()); S.hi = S.hist.length - 1; Draft.clear(); S.dirty = false; return start(); } paint(); panel(); commit("Slide deleted"); }; }
  function moveSlide(from, to) { if (to < 0 || to >= S.slides.length || to === from) return; const [sl] = S.slides.splice(from, 1); S.slides.splice(to, 0, sl); S.cur = to; S.thumbs.clear(); panel(); commit(`Slide moved to ${to + 1} of ${S.slides.length}`); }

  // ---------- sheets ----------
  function sheet(title, body, { foot = "", full = false, label = "" } = {}) { $$(".stc-scrim", S.el).forEach((n) => n._close?.()); const sc = document.createElement("div"), back = document.activeElement; sc.className = "stc-scrim";
    sc.innerHTML = `<div class="stc-sheet${full ? " full" : ""}" role="dialog" aria-modal="true" aria-label="${esc(label || title)}"><div class="stc-sh-top"><h3>${esc(title)}</h3><button type="button" class="stc-ib" data-x aria-label="Close">${I.x}</button></div><div class="stc-sh-body">${body}</div>${foot ? `<div class="stc-sh-foot">${foot}</div>` : ""}</div>`;
    S.el.appendChild(sc); sc._close = () => { sc.remove(); try { (back && document.contains(back) ? back : S?.stage)?.focus({ preventScroll: true }); } catch {} }; $("[data-x]", sc).onclick = sc._close; sc.onpointerdown = (e) => { if (e.target === sc) sc._close(); };
    setTimeout(() => ($("input:not([type=hidden]),select,textarea", sc) || $(".stc-sh-body button", sc) || $("[data-x]", sc))?.focus({ preventScroll: true }), 0); return sc; }
  function addSheet() { const sc = sheet("Add a slide", `<div class="stc-opts"><button type="button" class="stc-opt" data-s="lib">${I.lib}<span><b>Photos and videos</b><small>Pick one or a few.</small></span></button><button type="button" class="stc-opt" data-s="cam">${I.cam}<span><b>Camera</b><small>Take a photo now.</small></span></button><button type="button" class="stc-opt" data-s="blank">${I.page}<span><b>Blank page</b><small>Just words, on a colour or paper.</small></span></button></div>`);
    $('[data-s="lib"]', sc).onclick = () => { sc._close(); pick(); }; $('[data-s="cam"]', sc).onclick = () => { sc._close(); camera(); }; $('[data-s="blank"]', sc).onclick = () => { sc._close(); addSlide(blank()); S.tool = "page"; paint(); panel(); commit("Blank page added"); }; }
  const ARTS = () => [...(window.Potto ? window.Potto.poses.map((p) => ["potto:" + p, "Potto, " + ({ wave: "waving", run: "running", cheer: "cheering", carry: "carrying a box", think: "thinking", sleep: "napping" }[p] || p)]) : []), ...(window.EventArt ? ["party", "dumpling", "coffee", "dinner", "wine", "picnic", "music", "dance", "games", "book", "hike", "run", "bike", "garden", "heart", "fireworks", "lantern", "leaf"].filter((k) => window.EventArt.KINDS.includes(k)).map((k, i) => [`art:${k}:${Object.keys(window.EventArt.SPOT)[i % 7]}`, window.EventArt.LABEL?.[k] || k]) : [])];
  function stickerSheet() { if (S.editing) endEdit(); const tile = (k, l, ic) => `<button type="button" class="stc-tile" data-st="${k}">${ic}<span>${l}</span></button>`, n = cur().items.filter(isLive).length, full = n >= (S.D?.limits?.stickers || 12);
    const sc = sheet("Stickers", `${full ? `<p class="stc-err" role="status">That's the most stickers one slide can hold. Remove one to add another.</p>` : ""}<p class="stc-sec">People can tap these</p><div class="stc-grid">${tile("event", "Event", I.sticker)}${tile("imin", "I'm in", I.go)}${tile("count", "Countdown", I.time)}${tile("mention", "Mention", svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 5 1 9 9 0 1 0-4 6"/>'))}${tile("question", "Question", svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M10 9a2 2 0 1 1 3 2c-.7.4-1 .8-1 1.5M12 14.5v.2"/>'))}${tile("poll", "Poll", svg('<path d="M5 20V10M12 20V4M19 20v-7"/>'))}${tile("slider", "Slider", svg('<path d="M3 12h18"/><circle cx="9" cy="12" r="3" fill="var(--pl-surface,#FAF8F3)"/>'))}</div>
      <p class="stc-sec">Notes</p><div class="stc-grid">${tile("place", "Place", svg('<path d="M12 21c-5-6-7-9-7-12a7 7 0 0 1 14 0c0 3-2 6-7 12z"/><circle cx="12" cy="9" r="2.5"/>'))}${tile("when", "Date and time", svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'))}</div>
      <p class="stc-sec">Drawings</p><div class="stc-grid">${ARTS().map(([src, l]) => `<button type="button" class="stc-tile" data-art="${src}" aria-label="${esc(l)}"><img src="${artSrc(src)}" alt="" width="64" height="54"></button>`).join("")}</div>`);
    $$("[data-st]", sc).forEach((b) => (b.onclick = () => { if (full && LIVE.includes(b.dataset.st)) return; sc._close(); stickerForm(b.dataset.st, null); })); $$("[data-art]", sc).forEach((b) => (b.onclick = () => { sc._close(); put({ t: "art", src: b.dataset.art, s: 0.9 }); })); }
  function put(it) { const sl = cur(), n = sl.items.length, o = { id: uid(), x: 0.5, y: clamp(0.36 + (n % 4) * 0.07, 0.2, 0.8), s: 1, r: 0, ...it }; sl.items.push(o); S.tool = ""; S.sel = o.id; items(); panel(); commit(`${labelOf(o)} added`); S.els.get(o.id)?.focus({ preventScroll: true }); }
  const nowLabel = (k) => { const d = new Date(), day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase(); return k === "date" ? day : k === "time" ? t : `${day} · ${t}`; };
  /** The few words a sticker needs before it lands on the slide; the same form edits it later. */
  function stickerForm(t, it) { const D = S.D || { events: [] }, done = (o) => { sc._close(); if (it) { Object.assign(it, o); items(); panel(); commit("Sticker changed"); } else put({ t, ...o }); };
    const evList = (L, none) => (L.length ? `<div class="stc-list">${L.map((e) => `<button type="button" class="stc-pick" data-ev="${esc(e.ev)}"><b>${esc(e.title)}</b><small>${esc(K().when(e) || "No date yet")}${e.own ? " · yours" : ""}</small></button>`).join("")}</div>` : `<p class="stc-note">${none}</p>`);
    let sc;
    if (t === "event" || t === "imin" || t === "count") { const L = t === "event" ? D.events : D.events.filter((e) => !e.past);
      sc = sheet(t === "event" ? "Which event?" : t === "imin" ? "I'm in for which event?" : "Count down to which event?", evList(L, t === "event" ? "Events you host or said I'm in to show up here. You have none yet." : "Nothing coming up yet. Events you host or said I'm in to show up here.") + (L.some((e) => !e.open) ? `<p class="stc-note" style="margin-top:10px">Only people who were there see a link-only event's sticker.</p>` : ""));
      $$("[data-ev]", sc).forEach((b) => (b.onclick = () => { const e = D.events.find((y) => y.ev === b.dataset.ev); done({ ev: e.ev, title: e.title, date: e.date, startTime: e.startTime, cover: e.cover, activity: e.activity, ...(t === "imin" ? { label: e.cta || "I'm in" } : {}), ...(t === "count" ? { at: Date.parse(`${e.date}T${/^\d{1,2}:\d\d$/.test(e.startTime) ? e.startTime.padStart(5, "0") : "12:00"}:00`) || 0 } : {}) }); })); return; }
    if (t === "mention") { sc = sheet("Mention a host", `<div class="stc-f"><label for="scHq">Who?</label><input type="search" id="scHq" placeholder="Search hosts by name" autocomplete="off" autocapitalize="off"></div><div class="stc-list" data-hosts aria-live="polite"></div>`);
      const box = $("[data-hosts]", sc), q = $("#scHq", sc); let n = 0; const find = async () => { const my = ++n; try { const r = await fetch("/api/story/hosts?q=" + encodeURIComponent(q.value.trim()), { credentials: "same-origin" }), j = await r.json(); if (my !== n) return; box.innerHTML = (j.hosts || []).length ? j.hosts.map((h) => `<button type="button" class="stc-pick" data-h="${esc(h.handle)}" data-n="${esc(h.name)}"><b>${esc(h.name)}</b><small>@${esc(h.handle)}</small></button>`).join("") : `<p class="stc-note">No host by that name.</p>`; $$("[data-h]", box).forEach((b) => (b.onclick = () => done({ handle: b.dataset.h, name: b.dataset.n }))); } catch { box.innerHTML = `<p class="stc-note">Couldn't look that up. Try again.</p>`; } };
      let tm = 0; q.oninput = () => { clearTimeout(tm); tm = setTimeout(find, 200); }; find(); return; }
    const F = { place: ["Add a place", `<div class="stc-f"><label for="scA">Where?</label><input type="text" id="scA" maxlength="40" placeholder="Like Greenpoint, or Mai's kitchen" value="${esc(it?.txt || "")}"></div>`], question: ["Ask a question", `<div class="stc-f"><label for="scA">Your question</label><input type="text" id="scA" maxlength="80" value="${esc(it?.prompt || "Ask me something")}"><small>Answers come to your inbox. Only you read them.</small></div>`],
      poll: ["Make a poll", `<div class="stc-f"><label for="scA">Question</label><input type="text" id="scA" maxlength="80" placeholder="Dumplings or noodles?" value="${esc(it?.q || "")}"></div><div class="stc-f"><label for="scB">First choice</label><input type="text" id="scB" maxlength="30" value="${esc(it?.a || "Yes")}"></div><div class="stc-f"><label for="scC">Second choice</label><input type="text" id="scC" maxlength="30" value="${esc(it?.b || "No")}"><small>People see the result after they vote.</small></div>`],
      slider: ["Make a slider", `<div class="stc-f"><label for="scA">Question</label><input type="text" id="scA" maxlength="60" placeholder="How hungry are you?" value="${esc(it?.q || "")}"></div><div class="stc-f"><label for="scB">The slider's emoji</label><input type="text" id="scB" maxlength="8" value="${esc(it?.emoji || "❤️")}"><small>Type any emoji from your keyboard.</small></div>`],
      when: ["Date and time", `<fieldset class="stc-f"><legend>Show</legend><div class="stc-list">${[["both", nowLabel("both")], ["date", nowLabel("date")], ["time", nowLabel("time")]].map(([k, l]) => `<button type="button" class="stc-pick" data-when="${esc(l)}"><b>${esc(l)}</b></button>`).join("")}</div></fieldset>`] }[t];
    if (!F) return; sc = sheet(F[0], F[1], { foot: t === "when" ? "" : `<button type="button" class="stc-btn pri" data-ok>${it ? "Save" : "Add to slide"}</button>` });
    $$("[data-when]", sc).forEach((b) => (b.onclick = () => done({ txt: b.dataset.when })));
    const ok = $("[data-ok]", sc); if (ok) { const v = (id) => ($(id, sc)?.value || "").trim(); ok.onclick = () => { if (t === "place") { if (!v("#scA")) return $("#scA", sc).focus(); done({ txt: v("#scA") }); } else if (t === "question") done({ prompt: v("#scA") || "Ask me something" }); else if (t === "poll") done({ q: v("#scA"), a: v("#scB") || "Yes", b: v("#scC") || "No" }); else if (t === "slider") done({ q: v("#scA"), emoji: v("#scB") || "❤️" }); };
      $$("input", sc).forEach((i) => (i.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } })); } }

  // ---------- leaving: keep the draft or let it go ----------
  function leave() { if (!S) return; if (S.editing) endEdit(); if (!S.slides.length || !S.dirty) { if (!S.slides.length) Draft.clear(); return close(); }
    const sc = sheet("Keep this for later?", `<p class="stc-note" style="margin:0">Your draft stays on this device and opens the next time you make a story.</p>`, { foot: `<button type="button" class="stc-btn" data-no>Discard</button><button type="button" class="stc-btn pri" data-yes>Keep draft</button>` });
    $("[data-yes]", sc).onclick = async () => { clearTimeout(saveT); await Draft.save({ slides: S.slides, cur: S.cur, share: S.share, at: Date.now() }); close(); }; $("[data-no]", sc).onclick = async () => { clearTimeout(saveT); await Draft.clear(); close(); }; setTimeout(() => $("[data-yes]", sc)?.focus(), 0); }

  // ---------- share ----------
  function shareSheet() { if (S.editing) endEdit(); const D = S.D || { events: [], highlights: [], reach: "circle" }, sh = S.share;
    const draw = () => { const ev = D.events.find((e) => e.ev === sh.eventId) || null; if (!ev) sh.eventId = ""; if (ev && !ev.open) sh.audience = "event"; if (!ev && sh.audience === "event") sh.audience = "everyone";
      const A = [["everyone", D.reach === "public" ? "Everyone" : "Friends and followers", D.reach === "public" ? "Anyone who can see your stories." : "People who follow you or added you as a friend. Your ring isn't public until you host something."], ["followers", "Followers", "People who follow your page, and your friends."], ["friends", "Friends only", "People you added as friends."], ...(ev ? [["event", `Only people at ${ev.title}`, "The host and the guests who were in."]] : [])].filter(([k]) => !(ev && !ev.open) || k === "event").filter(([k]) => !(D.reach !== "public" && k === "followers"));
      const fits = !!ev && ev.photos && ((sh.audience === "everyone" && ev.wall) || (sh.audience === "event" && !ev.wall)), hasPic = S.slides.some((s) => s.kind !== "video");
      body.innerHTML = `<div class="stc-prev" aria-hidden="true">${S.slides.map(() => `<canvas width="108" height="192"></canvas>`).join("")}</div><p class="stc-err" role="alert" data-err hidden></p>
        <fieldset class="stc-f"><legend>Who sees it</legend><div class="stc-list">${A.map(([k, l, s]) => `<label class="stc-radio"><input type="radio" name="scAud" value="${k}" ${sh.audience === k ? "checked" : ""}><span><b>${esc(l)}</b><small>${esc(s)}</small></span></label>`).join("")}</div>${ev && !ev.open ? `<small>${esc(ev.title)} is link-only, so its story stays with the people who were there.</small>` : ""}</fieldset>
        <div class="stc-f"><label for="scEv">Event</label><select id="scEv"><option value="">No event</option>${D.events.map((e) => `<option value="${esc(e.ev)}" ${e.ev === sh.eventId ? "selected" : ""}>${esc(e.title)}${e.date ? " · " + esc(K().when({ date: e.date })) : ""}</option>`).join("")}</select><small>${ev ? "People see the event's name on your story, with a link to its invite." : "A story doesn't need one."}</small></div>
        ${ev && ev.photos ? `<label class="stc-radio"><input type="checkbox" id="scPh" ${fits && sh.eventPhoto ? "checked" : ""} ${fits ? "" : "disabled"}><span><b>Add to the event's photos</b><small>${fits ? (ev.own ? "It stays with the event for 14 days." : "It stays with the event for 14 days, once the host says yes.") : ev.wall ? "Only a story for everyone can join this event's photos." : "Choose only people at the event to add it to the photos."}</small></span></label>` : ""}
        ${D.canHighlight ? `<div class="stc-f" style="margin-top:14px"><label for="scHl">Highlight</label><select id="scHl"><option value="">Not in a highlight</option>${(D.highlights || []).map((h) => `<option value="${esc(h.id)}" ${sh.highlight === h.id ? "selected" : ""}>${esc(h.name)}</option>`).join("")}${(D.highlights || []).length < 8 ? `<option value="new" ${sh.highlight === "new" ? "selected" : ""}>New highlight</option>` : ""}</select><small>A highlight keeps it on your page after the 24 hours.</small></div>${sh.highlight === "new" ? `<div class="stc-f"><label for="scHn">Name the highlight</label><input type="text" id="scHn" maxlength="30" placeholder="Like Supper clubs" value="${esc(sh.hlName)}"></div>` : ""}
        ${hasPic ? `<label class="stc-radio"><input type="checkbox" id="scSb" ${sh.scrapbook ? "checked" : ""}><span><b>Also keep in my scrapbook</b><small>The pictures go with the past events on your page.</small></span></label>` : ""}` : ""}`;
      $$("canvas", body).forEach((c, i) => { const sl = S.slides[i]; let t = S.thumbs.get(sl.id); if (!t) { t = flat(sl, 100 / U); S.thumbs.set(sl.id, t); } c.getContext("2d").drawImage(t, 0, 0, 108, 192); });
      $$('[name="scAud"]', body).forEach((r) => (r.onchange = () => { sh.audience = r.value; redraw("aud"); })); $("#scEv", body).onchange = (e) => { sh.eventId = e.target.value; redraw("#scEv"); };
      const ph = $("#scPh", body); if (ph) ph.onchange = () => (sh.eventPhoto = ph.checked); const hl = $("#scHl", body); if (hl) hl.onchange = () => { sh.highlight = hl.value; redraw("#scHl"); }; const hn = $("#scHn", body); if (hn) hn.oninput = () => (sh.hlName = hn.value); const sb = $("#scSb", body); if (sb) sb.onchange = () => (sh.scrapbook = sb.checked); saveSoon(); };
    const redraw = (focus) => { draw(); (focus === "aud" ? $('[name="scAud"]:checked', body) : $(focus, body))?.focus({ preventScroll: true }); };
    const sc = sheet("Share your story", "", { full: true, foot: `<button type="button" class="stc-btn" data-back>Back</button><button type="button" class="stc-btn pri" data-share>Share</button>` }), body = $(".stc-sh-body", sc); draw();
    $("[data-back]", sc).onclick = sc._close; const go = $("[data-share]", sc);
    go.onclick = async () => { const err = $("[data-err]", body); err.hidden = true; if (sh.highlight === "new" && !sh.hlName.trim()) { $("#scHn", body)?.focus(); err.textContent = "Give the new highlight a name."; err.hidden = false; return; }
      go.disabled = true; $("[data-back]", sc).disabled = true; try { const R = await send((i, n) => (go.textContent = n > 1 ? `Sharing ${i} of ${n}` : "Sharing")); clearTimeout(saveT); await Draft.clear(); const cb = S.opts.onDone; close(true);
        const hours = R.hours || 24, msg = `Your story is up for ${hours} hours.` + (R.waiting ? " The event's photo shows once the host says yes." : ""); cb ? cb(R, msg) : window.dispatchEvent(new CustomEvent("pl:story-shared", { detail: { ...R, message: msg } })); }
      catch (e) { if (!S) return; go.disabled = false; $("[data-back]", sc).disabled = false; go.textContent = "Share"; err.textContent = e.message || "That didn't share. Try again."; err.hidden = false; err.scrollIntoView({ block: "nearest" }); } }; }
  const blobOf = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
  /** The picture under about 600 KB: JPEG at 1080 by 1920, quality stepped down until it fits. */
  async function jpegOf(c) { let b = null; for (const q of [0.86, 0.8, 0.72, 0.64, 0.55, 0.45]) { b = await blobOf(c, "image/jpeg", q); if (b && b.size <= 600 * 1024) break; } return b; }
  async function up(as, blob, type, q = "") { const r = await fetch(`/api/story/media?as=${as}${q}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": type }, body: blob }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't upload. Try again."); return j.url; }
  async function send(step) { const sh = S.share, out = [], n = S.slides.length; try { await document.fonts.ready; } catch {}
    await Promise.all(S.slides.flatMap((sl) => sl.items.filter((i) => i.t === "art").map((i) => new Promise((res) => { const a = artOf(i.src); a.ok ? res() : a.wait.push(res); setTimeout(res, 3000); }))));
    for (const [i, sl] of S.slides.entries()) { step(i + 1, n); const m = MEDIA.get(sl.m), stickers = sl.items.filter(isLive).map(({ id, t, x, y, s, r, ev, handle, prompt, q, a, b, emoji }) => ({ id, t, x, y, s, r, ev, handle, prompt, q, a, b, emoji })), o = { stickers, dur: sl.dur * 1000 };
      if (sl.kind === "video" && m) { o.url = await up("video", m.blob, m.type === "video/quicktime" || /\.mov$/i.test(m.blob.name || "") ? "video/quicktime" : m.type || "video/mp4", `&duration=${(m.seconds || 0).toFixed(1)}&w=${m.w || 0}&h=${m.h || 0}`);
        if (sl.strokes.length || sl.items.some((y) => !isLive(y))) o.overlay = await up("overlay", await blobOf(flat(sl, 1, { transparent: true }), "image/png"), "image/png"); const pc = canvasOf(540, 960), px = pc.getContext("2d"); paintPhoto(px, sl, 0.5); px.drawImage(flat(sl, 0.5, { transparent: true }), 0, 0); o.poster = await up("poster", await blobOf(pc, "image/jpeg", 0.8), "image/jpeg"); if (sl.trim) o.trim = sl.trim; }
      else o.url = await up("image", await jpegOf(flat(sl, 1)), "image/jpeg", "&w=1080&h=1920");
      out.push(o); }
    const body = { slides: out, audience: sh.audience, ...(sh.eventId ? { eventId: sh.eventId, eventPhoto: !!sh.eventPhoto } : {}), ...(sh.highlight === "new" ? { highlight: { name: sh.hlName.trim() } } : sh.highlight ? { highlight: { id: sh.highlight } } : {}), ...(sh.scrapbook ? { scrapbook: true } : {}) };
    const r = await fetch("/api/story", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't share. Try again."); return { ...j, hours: S.D?.limits?.hours || 24 }; }

  window.PLStoryComposer = { open, close: () => close(true), get state() { return S; }, _flat: flat, _FONTS: FONTS, _LOOKS: LOOKS };
})();
