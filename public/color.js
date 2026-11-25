// Shared colour helpers: contrast (WCAG), mixing, readable ink, and a palette from an image's pixels.
// Used by the host page themes (storefront.js) and the per-event looks (looks.js). No DOM needed, so tests run it in a vm.
(function (root) {
  const HEX = /^#[0-9a-f]{6}$/i;
  const isHex = (h) => typeof h === "string" && HEX.test(h);
  const norm = (h) => { h = String(h || "").trim(); if (/^#[0-9a-f]{3}$/i.test(h)) h = "#" + [...h.slice(1)].map((c) => c + c).join(""); return isHex(h) ? h.toUpperCase() : ""; };
  const rgb = (h) => { const n = parseInt(norm(h).slice(1) || "000000", 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  // relative luminance and contrast ratio, as WCAG defines them
  const lum = (h) => { const c = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // mix(a, b, t): t of b into a
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };
  const hsl = (h) => { let [r, g, b] = rgb(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let H = 0, S = 0;
    if (mx !== mn) { const d = mx - mn; S = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); H = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H *= 60; }
    return [H, S, l]; };
  const fromHsl = (H, S, L) => { H = ((H % 360) + 360) % 360; const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return hex(f(H / 360 + 1 / 3) * 255, f(H / 360) * 255, f(H / 360 - 1 / 3) * 255); };
  // a page colour that contrasts with a flyer: the opposite hue, dark for a dark flyer (forest green gets wine red), soft for a light one
  const contrastPage = (h) => { const [H, S, L] = hsl(h), dark = lum(h) < 0.2; return fromHsl(H + 180 + (dark ? 18 : 0), Math.max(0.45, Math.min(0.75, S + 0.15)), dark ? Math.min(0.2, Math.max(0.14, L)) : 0.8); };
  // the worst contrast of a colour against each of several backgrounds (a gradient's two ends)
  const worst = (c, bgs) => Math.min(...[].concat(bgs).map((b) => contrast(c, b)));
  // ink for text on these backgrounds: a tinted near-black or near-white when it passes AA (4.5:1), else plain black or white
  function inkFor(bgs, tint) { bgs = [].concat(bgs); const dark = bgs.every((b) => lum(b) < 0.18);
    const tries = dark ? [tint ? mix(tint, "#FFFFFF", 0.92) : "", "#FFF8EE", "#FFFFFF"] : [tint ? mix(tint, "#000000", 0.82) : "", "#1F1A17", "#000000"];
    for (const c of tries) if (c && worst(c, bgs) >= 4.5) return c;
    return worst("#FFFFFF", bgs) >= worst("#000000", bgs) ? "#FFFFFF" : "#000000"; }
  // quieter text (dates, captions) that still passes AA: as far toward the background as it can go
  function softFor(ink, bgs) { for (const t of [0.42, 0.34, 0.26, 0.18, 0.1]) { const c = mix(ink, [].concat(bgs)[0], t); if (worst(c, bgs) >= 4.5) return c; } return ink; }
  // the storefront guardrail: text on a button is white when it reads at 3:1 (large, bold button text), else ink
  const onColor = (c, min = 4.5) => (contrast(c, "#FFFFFF") >= min ? "#FFFFFF" : contrast(c, "#1F1A17") >= min ? "#1F1A17" : contrast(c, "#FFFFFF") >= contrast(c, "#000000") ? "#FFFFFF" : "#000000");
  // a button colour that stands out from the page (3:1, non-text contrast) and carries readable text (4.5:1):
  // the accent itself when it passes, else the accent darkened or lightened step by step
  function buttonFor(accent, bgs) { accent = norm(accent) || "#C94A30"; bgs = [].concat(bgs); const darkBg = bgs.every((b) => lum(b) < 0.18);
    const ok = (c) => worst(c, bgs) >= 3 && Math.max(contrast(c, "#FFFFFF"), contrast(c, "#1F1A17")) >= 4.5;
    if (ok(accent)) return accent;
    for (let i = 1; i <= 10; i++) { const c = mix(accent, darkBg ? "#FFFFFF" : "#000000", i * 0.08); if (ok(c)) return c; }
    for (let i = 1; i <= 10; i++) { const c = mix(accent, darkBg ? "#000000" : "#FFFFFF", i * 0.08); if (ok(c)) return c; }
    return darkBg ? "#FFF8EE" : "#1F1A17"; }
  // a page from one colour: a soft vertical gradient, light (most colours) or dark (deep colours), and the ink that reads on it
  function pageFrom(dom, accents = []) { dom = norm(dom) || "#FFE08A"; const dark = lum(dom) < 0.11 || (lum(dom) < 0.2 && hsl(dom)[1] > 0.45 && lum(dom) < 0.16);
    const top = dark ? mix(dom, "#000000", 0.18) : mix(dom, "#FFFFFF", 0.5), bot = dark ? mix(dom, "#000000", 0.62) : mix(dom, "#FFFFFF", 0.12);
    const bgs = [top, bot], ink = inkFor(bgs, dom), soft = softFor(ink, bgs);
    const btn = buttonFor(accents.find((a) => norm(a) && Math.abs(lum(a) - lum(top)) > 0.05) || (dark ? mix(dom, "#FFFFFF", 0.5) : mix(dom, "#000000", 0.45)), bgs);
    const card = dark ? mix(dom, "#000000", 0.4) : mix(dom, "#FFFFFF", 0.93), cardInk = inkFor([card], dom);
    return { dark, top, bot, ink, soft, btn, onBtn: onColor(btn), card, cardInk, line: mix(top, ink, 0.16) }; }
  // ---- a palette from pixels: a dominant colour and two accents, skipping near-white, near-black and see-through pixels ----
  // data: RGBA bytes (canvas getImageData().data). Buckets of 4 bits a channel; each bucket keeps its average colour.
  function paletteFromPixels(data, step = 1) { const B = new Map();
    for (let i = 0; i + 3 < data.length; i += 4 * step) { const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]; if (a < 200) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mn > 232 || mx < 28 || (mx - mn < 14 && mn > 215)) continue;
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); let o = B.get(k); if (!o) B.set(k, (o = { n: 0, r: 0, g: 0, b: 0 })); o.n++; o.r += r; o.g += g; o.b += b; }
    // merge neighbouring buckets into colour groups, biggest first
    const L = [...B.values()].map((o) => ({ n: o.n, c: [o.r / o.n, o.g / o.n, o.b / o.n] })).sort((a, b) => b.n - a.n), G = [];
    const dist = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    for (const o of L) { const g = G.find((x) => dist(x.c, o.c) < 42); if (g) { const t = o.n / (g.n + o.n); g.c = g.c.map((v, j) => v + (o.c[j] - v) * t); g.n += o.n; } else G.push({ ...o }); }
    G.sort((a, b) => b.n - a.n); if (!G.length) return [];
    const sat = (c) => hsl(hex(...c))[1], dom = G[0], out = [dom];
    // accents: the most colourful of what is left, far enough from what we have
    const rest = G.slice(1).filter((g) => g.n >= dom.n * 0.015).sort((a, b) => b.n * (0.35 + sat(b.c)) - a.n * (0.35 + sat(a.c)));
    for (const g of rest) { if (out.length >= 3) break; if (out.every((x) => dist(x.c, g.c) > 60)) out.push(g); }
    while (out.length < 3) { const base = hex(...dom.c), l = lum(base); out.push({ c: rgb(mix(base, l > 0.4 ? "#000000" : "#FFFFFF", out.length === 1 ? 0.45 : 0.7)) }); }
    return out.map((g) => hex(...g.c)); }
  const API = { fromHsl, contrastPage, isHex, norm, rgb, hex, lum, contrast, mix, hsl, worst, inkFor, softFor, onColor, buttonFor, pageFrom, paletteFromPixels };
  root.EncoreColor = API;
})(typeof window !== "undefined" ? window : globalThis);
