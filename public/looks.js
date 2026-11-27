// Per-event looks: a flyer shown whole, page colours from it, an ambient effect, a title font and a reply button
// with some personality. The light invite (/e/:id), the full invite (/g) and the host's "Make it yours" preview all
// draw with this file, so what the host sees is what guests get. Values match server/looks.js.
(function () {
  const C = window.EncoreColor;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const EFFECTS = [["none", "None"], ["sparkles", "Sparkles"], ["snow", "Snow"], ["confetti", "Confetti"], ["petals", "Petals"], ["paper", "Paper"], ["velvet", "Velvet"], ["stars", "Stars"], ["twinkle", "Twinkle"], ["lanterns", "Lanterns"], ["scanlines", "Scanlines"], ["pixels", "Pixels"], ["jarwall", "Jar wall"],
    ["streamers", "Streamers"], ["balloons", "Balloons"], ["bulbs", "String lights"], ["dice", "Dice"], ["leaves", "Leaves"], ["rain", "Rain"], ["steam", "Steam"], ["bubbles", "Bubbles"]]; // the last row is drawn by public/effects.js
  // title fonts: the title only; the rest of the page stays in the house sans
  const FONTS = {
    clean: { label: "Clean", css: '"Inter", "IBM Plex Sans", system-ui, sans-serif', q: "Inter:wght@700;800", w: 800, ls: "-.035em", k: 1 },
    bold: { label: "Bold", css: '"Archivo Black", "Arial Black", system-ui, sans-serif', q: "Archivo+Black", w: 400, ls: "-.01em", k: 1, up: true },
    serif: { label: "Serif", css: '"DM Serif Display", Georgia, serif', q: "DM+Serif+Display", w: 400, ls: "-.01em", k: 1.08 },
    script: { label: "Script", css: '"Dancing Script", "Brush Script MT", cursive', q: "Dancing+Script:wght@700", w: 700, ls: "0", k: 1.18 },
    typewriter: { label: "Typewriter", css: '"Courier Prime", "Courier New", monospace', q: "Courier+Prime:wght@700", w: 700, ls: "-.02em", k: 0.96 },
    rounded: { label: "Rounded", css: '"Baloo 2", Fredoka, system-ui, sans-serif', q: "Baloo+2:wght@800", w: 800, ls: "-.02em", k: 1.04 },
    // a terminal prompt: monospace, with a blinking block cursor after the title (still, for people who prefer less motion)
    mono: { label: "Mono", css: '"IBM Plex Mono", ui-monospace, Menlo, monospace', q: "IBM+Plex+Mono:wght@600;700", w: 700, ls: "-.03em", k: 0.9 },
    pixel: { label: "Pixel", css: '"Silkscreen", ui-monospace, monospace', q: "Silkscreen:wght@400;700", w: 700, ls: "0", k: 0.78 },
    // a warm slab, like a stamped pantry label
    slab: { label: "Slab", css: '"Zilla Slab", Rockwell, "Roboto Slab", Georgia, serif', q: "Zilla+Slab:wght@600;700", w: 700, ls: "-.005em", k: 1.04 },
  };
  // eight colours to pick from when there's no flyer (each with two accents that suit it)
  const SWATCHES = [["#DCE3D2", "#2F4A35", "#A4533A", "Sage"], ["#EFE7D8", "#1D1B18", "#9A4128", "Bone"], ["#E4E9EC", "#24384C", "#9A4128", "Stone"], ["#F1E4E1", "#5E2128", "#B08A4E", "Oxblood"],
    ["#F3E8E6", "#3A2A30", "#8C5A55", "Rose"], ["#E8DDC8", "#5C3013", "#3D5A39", "Oat"], ["#E5EADF", "#24392D", "#A8843A", "Forest"], ["#EEE6D8", "#3B2F25", "#A87A35", "Espresso"]];
  const LABELS = ["I'm in", "Join", "Count me in", "Ask to join"]; // older labels off the word list read "I'm in" (server/looks.js cleanLook)
  const EMOJI = ["👍", "🙌", "🎉", "✨", "🌿", "🌸", "💐", "🌷", "🍷", "🥂", "🍸", "🍜", "🎷", "🎶", "🎄", "❄️", "⛄", "🎁", "🏺", "🍵", "🕯️", "🔥", "🏮", "❤️", "💻", "🎮", "👾", "🕹️", "🎲", "🍂", "🫙", "☕"];
  // one-tap vibes, curated as whole palettes: page, ink accent and one warm accent designed together (2026 brand pass).
  // Light looks sit on bone, stone and paper; dark looks on ink, forest, oxblood, slate and espresso with warm off-white
  // text. Flat pages, no glows by default, plain "I'm in" with no emoji. Flower shop is the host page's Flower shop look
  // (storefront.js LOOKS.florist: petal page, deep green)
  const VIBES = {
    garden: { label: "Garden party", look: { palette: ["#DCE3D2", "#2F4A35", "#A4533A"], effect: "none", titleFont: "serif", buttonLabel: "I'm in" } },
    jazz: { label: "Jazz night", look: { palette: ["#EEE6D8", "#3B2F25", "#A87A35"], effect: "none", titleFont: "serif", buttonLabel: "I'm in" } },
    winter: { label: "Winter benefit", look: { palette: ["#E4E9EC", "#24384C", "#9A4128"], effect: "snow", titleFont: "clean", buttonLabel: "I'm in" } },
    velvet: { label: "Velvet sale", look: { palette: ["#F1E4E1", "#5E2128", "#B08A4E"], effect: "none", titleFont: "serif", buttonLabel: "I'm in" } },
    flower: { label: "Flower shop", look: { palette: ["#F4E9EC", "#1F3D30", "#A85A55"], effect: "petals", titleFont: "script", buttonLabel: "I'm in" } },
    // an izakaya after dark: deep slate, paper lanterns and a noren curtain, warm amber on the button
    night: { label: "Night out", look: { palette: ["#E7E9EE", "#26304A", "#B5762E"], effect: "lanterns", titleFont: "clean", buttonLabel: "I'm in" } },
    market: { label: "Holiday market", look: { palette: ["#E5EADF", "#24392D", "#A8843A"], effect: "twinkle", lights: true, titleFont: "serif", buttonLabel: "I'm in" } },
    // for the quiet, nerdy crowd: a calm dark terminal (soft phosphor green, amber accent, faint scanlines) and an 8-bit page in four colours
    terminal: { label: "Terminal", look: { palette: ["#E9EEE8", "#1F4D33", "#8A6A22"], effect: "scanlines", titleFont: "mono", buttonLabel: "I'm in" } },
    pixel: { label: "Pixel", look: { palette: ["#EEEADC", "#2E2A44", "#B4495B"], effect: "pixels", titleFont: "pixel", buttonLabel: "I'm in" } },
    // a hand of muted cards: the cover is a flat playing card, the kind of event in the corner and the drawing in the middle
    cards: { label: "Card deck", look: { palette: ["#F2EDE4", "#2C2836", "#9A4128"], effect: "none", titleFont: "serif", buttonLabel: "I'm in", coverStyle: "deck" } },
    // a cozy winter pantry: warm ochre plaster, a wall of backlit jars over the page, a hex-tile floor, a slab title and the harvest menu card
    pantry: { label: "Pantry", look: { palette: ["#D8B47E", "#5C3013", "#3D5A39"], effect: "jarwall", titleFont: "slab", buttonLabel: "I'm in", menuStyle: "harvest" } },
  };
  // the card deck's grounds (the same hand as the swipe deck, public/swipedeck.js), muted to the brand's natural tones
  const DECK = ["#E8E2D3", "#E3DEE4", "#DDE3E4", "#DFE5D9", "#EEDDD4", "#EDE3CC"];
  // ---------- stickers: small original drawings a host drops on their cover (server/looks.js keeps at most 6) ----------
  const SK = 'stroke="#1F1A17" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"', BK = 'fill="#fff" stroke="#fff" stroke-width="11" stroke-linejoin="round"';
  const two = (d, fill) => `<path ${BK} d="${d}"/><path fill="${fill}" ${SK} d="${d}"/>`;
  const STICKERS = {
    star: { label: "Star", svg: two("M32 7l7.4 15.3 16.8 2.4-12.2 11.8 2.9 16.7L32 45.3l-14.9 7.9 2.9-16.7L7.8 24.7l16.8-2.4z", "#F7D36B") + `<path fill="none" ${SK} d="M25 33.5q1.5 2 3 0M35 33.5q1.5 2 3 0"/>` },
    heart: { label: "Heart", svg: two("M32 54C15 43 8 33 8 23.5 8 15.5 14 10 21 10c4.8 0 8.6 2.6 11 6.6C34.4 12.6 38.2 10 43 10c7 0 13 5.5 13 13.5C56 33 49 43 32 54z", "#F48FA0") + `<path fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" d="M17 21q2-5 7-5"/>` },
    sparkle: { label: "Sparkle", svg: two("M30 6q3 19 22 24-19 4-22 26-3-22-22-26 19-5 22-24z", "#FFF1A8") + two("M51 6q1 6 7 7.5-6 1.3-7 8-1-6.7-7-8 6-1.5 7-7.5z", "#BFE4EA") },
    flower: { label: "Flower", svg: [0, 72, 144, 216, 288].map((a) => `<ellipse ${BK} cx="32" cy="17" rx="10" ry="12" transform="rotate(${a} 32 32)"/>`).join("") + [0, 72, 144, 216, 288].map((a) => `<ellipse fill="#F6CBD5" ${SK} cx="32" cy="17" rx="10" ry="12" transform="rotate(${a} 32 32)"/>`).join("") + `<circle fill="#F2A71B" ${SK} cx="32" cy="32" r="8"/>` },
    lantern: { label: "Lantern", svg: `<path ${BK} d="M32 4v6M22 10h20v5H22zM32 15c-15 0-21 8-21 18s6 18 21 18 21-8 21-18-6-18-21-18zM22 51h20v5H22z"/><path fill="none" ${SK} d="M32 3v7"/><rect fill="#1F1A17" x="22" y="10" width="20" height="5" rx="2"/><ellipse fill="#E5533D" ${SK} cx="32" cy="33" rx="21" ry="18"/><path fill="none" ${SK} d="M12 27h40M11.5 34h41M13 41h38"/><path fill="none" stroke="#FFD9A0" stroke-width="3" stroke-linecap="round" d="M20 22q-4 5-3 10"/><rect fill="#1F1A17" x="22" y="51" width="20" height="5" rx="2"/><path fill="none" ${SK} d="M32 56v6"/>` },
    dumpling: { label: "Dumpling", svg: two("M6 44c0-15 12-26 26-26s26 11 26 26c0 4-3 6-7 6H13c-4 0-7-2-7-6z", "#FBF1DF") + `<path fill="none" ${SK} d="M20 24q3 5 1 9M30 19q3 6 1 11M40 20q3 6 0 11M49 27q2 4-1 8"/><circle fill="#F48FA0" cx="22" cy="41" r="3"/><circle fill="#F48FA0" cx="42" cy="41" r="3"/><path fill="none" ${SK} d="M29 41q3 3 6 0"/>` },
    pot: { label: "Pot", svg: two("M18 18h28v5c0 3 9 7 9 18 0 10-8 17-23 17S9 51 9 41c0-11 9-15 9-18z", "#E39A6E") + `<path fill="#F2C9A8" ${SK} d="M15 16h34v6H15z"/><path fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" d="M17 36q0-5 4-8"/><path fill="none" ${SK} d="M23 41q2 2.5 4 0M37 41q2 2.5 4 0"/>` },
    note: { label: "Music note", svg: `<path fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" d="M24 46V14l28-6v32"/><ellipse ${BK} cx="17" cy="47" rx="9" ry="7"/><ellipse ${BK} cx="45" cy="41" rx="9" ry="7"/><path fill="none" ${SK} d="M24 46V14l28-6v32M24 22l28-6"/><ellipse fill="#B9A6F0" ${SK} cx="17" cy="47" rx="9" ry="7"/><ellipse fill="#B9A6F0" ${SK} cx="45" cy="41" rx="9" ry="7"/>` },
    d20: { label: "D20", svg: two("M32 5l24 13.5v27L32 59 8 45.5v-27z", "#BFE4EA") + `<path fill="#E6F4F6" ${SK} d="M32 17l13 23H19z"/><path fill="none" ${SK} d="M32 5v12M56 18.5L45 40M8 18.5L19 40M32 59l-13-19M32 59l13-19M8 45.5L19 40M56 45.5L45 40"/>` },
    controller: { label: "Controller", svg: two("M18 20h28c8 0 12 6 14 16 2 11-1 18-7 18-5 0-7-6-12-6H23c-5 0-7 6-12 6-6 0-9-7-7-18 2-10 6-16 14-16z", "#DCC3EC") + `<path fill="none" ${SK} d="M17 31v10M12 36h10"/><circle fill="#F48FA0" ${SK} cx="44" cy="33" r="3.2"/><circle fill="#F7D36B" ${SK} cx="51" cy="39" r="3.2"/>` },
    key: { label: "Key", svg: two("M10 12h44a5 5 0 0 1 5 5v31a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5z", "#E9E3D6") + `<path fill="#FFFCF5" ${SK} d="M15 16h34a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z"/><path fill="none" ${SK} d="M21 24l7 6-7 6M32 37h11"/>` },
    floppy: { label: "Floppy disk", svg: two("M9 8h40l7 7v39a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z", "#9BC4E8") + `<path fill="#E6EEF5" ${SK} d="M18 8h26v15H18z"/><path fill="#1F1A17" d="M35 11h5v9h-5z"/><path fill="#FFFCF5" ${SK} d="M16 34h32v22H16z"/><path fill="none" stroke="#9BC4E8" stroke-width="3" stroke-linecap="round" d="M22 42h20M22 49h14"/>` },
    heartbox: { label: "Heart container", svg: (() => { const rows = ["..XX.XX..", ".XooXooX.", "XowooooOX", "XooooooOX", ".XooooOX.", "..XooOX..", "...XoX...", "....X...."], c = { X: "#1F1A17", o: "#E5533D", O: "#B3321F", w: "#FFFFFF" }; let r = `<rect x="-1" y="2" width="66" height="58" rx="10" fill="#fff"/>`;
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (c[ch]) r += `<rect x="${x * 7 + 0.5}" y="${y * 7 + 4}" width="7.2" height="7.2" fill="${c[ch]}"/>`; })); return `<g shape-rendering="crispEdges">${r}</g>`; })() },
    cursor: { label: "Cursor", svg: two("M16 6v44l11-10 8 18 8-3.5-8-17.5h15z", "#FFFFFF") },
    // the Pantry set: a jar of preserves, a pinecone, a maple leaf, a mug of cocoa, a candle and a hex tile
    jar: { label: "Jar", svg: two("M18 18h28v4c4 2 7 6 7 12v18c0 5-3 8-8 8H19c-5 0-8-3-8-8V34c0-6 3-10 7-12z", "#F2B84B") + `<path fill="#FFFCF5" ${SK} d="M17 8h30v10H17z"/><path fill="none" ${SK} d="M17 13h30"/><path fill="#E07A2A" d="M14 38h36v13c0 4-2 6-6 6H20c-4 0-6-2-6-6z" opacity=".85"/><path fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" d="M19 30v12"/><circle fill="#F6D774" cx="30" cy="47" r="3"/><circle fill="#F6D774" cx="40" cy="51" r="2.5"/>` },
    pinecone: { label: "Pinecone", svg: two("M32 6c-8 6-17 16-17 29 0 13 8 23 17 23s17-10 17-23C49 22 40 12 32 6z", "#A8693A") + `<path fill="none" ${SK} d="M20 24q12 6 24 0M17 33q15 8 30 0M18 42q14 8 28 0M22 51q10 5 20 0"/><path fill="none" stroke="#E9C29A" stroke-width="3" stroke-linecap="round" d="M23 18q-3 4-4 9"/>` },
    maple: { label: "Maple leaf", svg: two("M32 4l5 10 8-4-1 11 11-1-6 9 7 4-12 4 3 8-11-3-2 12h-4l-2-12-11 3 3-8-12-4 7-4-6-9 11 1-1-11 8 4z", "#D9622B") + `<path fill="none" ${SK} d="M32 56V20M32 36l9-8M32 36l-9-8M32 46l6-5M32 46l-6-5"/>` },
    cocoa: { label: "Mug of cocoa", svg: two("M12 24h34v20c0 8-6 14-14 14h-6c-8 0-14-6-14-14z", "#E26D5A") + `<path fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" d="M46 30h4c4 0 6 3 6 6s-2 7-7 7h-3"/><path fill="none" ${SK} d="M46 30h4c4 0 6 3 6 6s-2 7-7 7h-3"/><path fill="#6B3E1C" ${SK} d="M12 24h34v5H12z"/><circle fill="#FFFCF5" ${SK} cx="22" cy="21" r="4.5"/><circle fill="#FFFCF5" ${SK} cx="33" cy="19" r="4.5"/><path fill="none" ${SK} d="M24 13q-3-4 0-8M34 11q-3-4 0-8"/><path fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" d="M18 36v8"/>` },
    candle: { label: "Candle", svg: two("M20 28h24v28c0 2-2 4-4 4H24c-2 0-4-2-4-4z", "#FBF1DF") + `<path fill="#F2B84B" ${SK} d="M32 6c5 6 7 10 7 14a7 7 0 0 1-14 0c0-4 2-8 7-14z"/><path fill="#FFF3B0" d="M32 13c2 3 3 5 3 7a3 3 0 0 1-6 0c0-2 1-4 3-7z"/><path fill="none" ${SK} d="M32 24v4M20 34q6 3 8 0t8 0 8 0"/><path fill="none" stroke="#E07A2A" stroke-width="3" stroke-linecap="round" d="M26 40v12"/>` },
    hextile: { label: "Hex tile", svg: two("M32 6l22 13v26L32 58 10 45V19z", "#E9E5DE") + `<path fill="#FFFFFF" ${SK} d="M32 17l12 7v14l-12 7-12-7V24z"/><path fill="none" stroke="#B9B2A6" stroke-width="2.5" stroke-linecap="round" d="M32 6v11M54 19l-10 5M54 45l-10-7M32 58V45M10 45l10-7M10 19l10 5"/>` },
  };
  const stickerSVG = (id) => (STICKERS[id] ? `<svg viewBox="-4 -4 72 72" aria-hidden="true" focusable="false">${STICKERS[id].svg}</svg>` : "");
  const MAX_STICKERS = 6;
  const cleanStickers = (L) => (Array.isArray(L) ? L : []).filter((x) => x && STICKERS[x.id]).slice(0, MAX_STICKERS).map((x) => ({ id: x.id, x: Math.min(100, Math.max(0, +x.x || 0)), y: Math.min(100, Math.max(0, +x.y || 0)), s: Math.min(1.6, Math.max(0.6, +x.s || 1)), r: Math.min(40, Math.max(-40, +x.r || 0)) }));
  function stickersHTML(L) { const st = cleanStickers(L?.stickers); if (!st.length) return "";
    return `<div class="lk-stk" aria-hidden="true">${st.map((x, i) => `<span class="lk-st" data-i="${i}" style="left:${x.x}%;top:${x.y}%;--s:${x.s};--r:${x.r}deg">${stickerSVG(x.id)}</span>`).join("")}</div>`; }
  const okHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
  const lookOf = (e) => (e && e.look && typeof e.look === "object" ? e.look : {});
  const has = (L) => !!(L && ((L.palette || []).some(okHex) || (L.effect && L.effect !== "none") || L.lights || FONTS[L.titleFont] || L.update?.text || L.coverStyle === "deck" || L.menuStyle === "harvest" || (L.stickers || []).length));
  // a portrait flyer shows whole unless the host picked the banner
  const fitOf = (L) => (L?.coverFit === "poster" || L?.coverFit === "banner" ? L.coverFit : +L?.coverH > +L?.coverW && +L?.coverW > 0 ? "poster" : "banner");
  const fonts = new Set(); const loadFont = (k) => { const F = FONTS[k]; if (!F || fonts.has(k) || typeof document === "undefined") return; fonts.add(k); const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${F.q}&display=swap`; document.head.appendChild(l); };
  // colours for a look: the page gradient, readable ink and soft text, and a button that passes contrast
  // ---- legacy dark looks (removed Dec 2026: every page is light) ----
  // Events saved with a dark look keep their data; at read time the palette maps to the light look of the same family and
  // accent hue. Any other dark page (a flyer, an old custom palette) is made light by color.js pageFrom.
  const LEGACY_DARK = { jazz: ["#1E1A17", "#1F2A2E", "#24201C", "#1B2226", "#4A2E1E"], velvet: ["#6E0F1F", "#3B1519", "#4B0F24", "#2E1A3A", "#35161C", "#2A1D24"],
    night: ["#141A3A", "#1B1530", "#0F2230", "#151A24", "#161B26", "#14201F"], market: ["#5A0F1E", "#1F3D30", "#1D2A23", "#1F2B24", "#2C1A1C"], terminal: ["#0E1411", "#101418", "#14121C", "#0F1412", "#14141A"] };
  const LEGACY = Object.fromEntries(Object.entries(LEGACY_DARK).flatMap(([v, pages]) => pages.map((h) => [h, v])));
  /** The palette a look draws with: a legacy dark palette becomes its vibe's light palette. */
  function paletteOf(L) { const p = (L?.palette || []).filter(okHex).map((c) => c.toUpperCase()); const v = LEGACY[p[0]]; return v && VIBES[v] ? VIBES[v].look.palette.slice() : p; }
  function colors(L) { const p = paletteOf(L); if (!p.length || !C) return null; return C.pageFrom(p[0], p.slice(1)); }
  // ---- Field Notes on the invite (Dec 2026): a look or a brand kit changes only the accent, the cover art and, from a short
  // sturdy set, the title face. The page stays linen and notebook paper, text stays ink, nothing moves over the page, and the
  // date, body and buttons are always IBM Plex Sans. Older looks keep their data; at read time a thin, script, display or
  // pixel title face draws as the nearest sturdy one (brandkit.js does the same for a kit's display face). ----
  const FN = { page: "#EFEBE2", surface: "#FAF8F3", ink: "#1B1D1C", soft: "#444845", line: "#CFC8B9", lineStrong: "#1B1D1C" };
  const TITLE_FACES = { serif: { label: "Serif", css: '"IBM Plex Serif", Georgia, serif', family: "IBM Plex Serif", w: 600, ls: "-.01em" }, sans: { label: "Sans", css: '"IBM Plex Sans", system-ui, sans-serif', family: "IBM Plex Sans", w: 600, ls: "-.015em" } };
  const STURDY = { serif: "serif", script: "serif", slab: "serif", clean: "sans", bold: "sans", rounded: "sans", typewriter: "sans", mono: "sans", pixel: "sans" };
  /** The sturdy face a title font key draws with on an invite: "serif" (IBM Plex Serif 600) or "sans" (IBM Plex Sans 600). */
  const sturdyOf = (k) => STURDY[k] || (TITLE_FACES[k] ? k : "serif");
  const titleFace = (k) => TITLE_FACES[sturdyOf(k)];
  /** The colours an invite draws with for a look: house paper and ink, the look's accent on buttons and links (at AA on
   *  linen and notebook), and at most a very light tint of the look's page on the cover frame. */
  function fieldNotes(T) { const bgs = [FN.page, FN.surface], out = { top: FN.page, bot: FN.page, ink: FN.ink, soft: FN.soft, card: FN.surface, cardInk: FN.ink, line: FN.line, raised: FN.surface, raisedSoft: FN.soft, field: FN.surface, lineStrong: FN.lineStrong, link: "#29489A", btn: "#29489A", onBtn: "#FFFFFF", cover: FN.surface, spot: "" };
    if (!T || !C) return out; const btn = C.buttonFor(T.btn || T.link || "#29489A", bgs); out.btn = btn; out.onBtn = C.onColor(btn); out.spot = T.spot || btn;
    let link = C.norm(T.link || btn) || btn; for (let i = 0; i < 12 && C.worst(link, bgs) < 4.5; i++) link = C.mix(link, FN.ink, 0.15); out.link = C.worst(link, bgs) >= 4.5 ? link : FN.ink;
    out.cover = C.mix(FN.surface, C.norm(T.top) || FN.surface, 0.35); return out; }
  // the main reply button: the host's emoji and words; Ask to join events always say "Ask to join"
  function buttonText(e, fallback) { const L = lookOf(e), em = EMOJI.includes(L.buttonEmoji) ? L.buttonEmoji + " " : ""; if (e?.approvalRequired) return em + "Ask to join";
    const w = LABELS.includes(L.buttonLabel) && L.buttonLabel !== "Ask to join" ? L.buttonLabel : fallback || "I'm in"; return em + w; }
  const safeSrc = (u) => (/^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "") ? u : "");
  // the flyer: whole at its own shape (poster) or a cropped banner; width/height reserve the space before it loads
  function coverHTML(e, { lazy = false } = {}) { const L = lookOf(e), u = safeSrc(e?.coverPhoto); if (!u) return ""; const w = +L.coverW || 0, h = +L.coverH || 0;
    return `<img class="lk-flyer" src="${esc(u)}" alt="${esc("Flyer for " + (e.pubTitle || e.name || "the event"))}"${w && h ? ` width="${w}" height="${h}"` : ""} decoding="async"${lazy ? ` loading="lazy"` : ` fetchpriority="high"`}>`; }

  // the host's "Update" callout: a starburst sticker with one line and when it was posted
  const ago = (at) => { const m = Math.max(0, (Date.now() - at) / 6e4); return m < 2 ? "just now" : m < 60 ? `${m | 0} min ago` : m < 1440 ? `${(m / 60) | 0}h ago` : m < 2880 ? "yesterday" : m < 20160 ? `${(m / 1440) | 0} days ago` : new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const burst = () => { let d = ""; for (let i = 0; i < 24; i++) { const a = (i * Math.PI) / 12 - Math.PI / 2, r = i % 2 ? 38 : 50; d += (i ? "L" : "M") + (50 + Math.cos(a) * r).toFixed(1) + " " + (50 + Math.sin(a) * r).toFixed(1); } return d + "Z"; };
  function updateHTML(e) { const u = lookOf(e).update; if (!u?.text) return ""; const at = +u.at || 0;
    return `<div class="lk-update" role="note"><span class="lk-burst" aria-hidden="true"><svg viewBox="0 0 100 100"><path d="${burst()}"/></svg><b>New!</b></span><span class="lk-upd-t"><b>Update${at ? ` <time datetime="${new Date(at).toISOString()}">${esc(ago(at))}</time>` : ""}</b><span>${esc(u.text)}</span></span></div>`; }
  // ---------- the page: colours, title font and the effect, on any element ----------
  const CSS = `.lk-on{--lk-title:var(--inv-title-face,inherit)}.lk-on.lk-page{background:linear-gradient(180deg,var(--lk-top) 0,var(--lk-bot) 100%) var(--lk-bot)!important;color:var(--lk-ink)}
html.lk-root{background:linear-gradient(180deg,var(--lk-top) 0,var(--lk-bot) 100vh,var(--lk-bot) 100%) var(--lk-bot)!important}html.lk-root body.lk-page.lk-page{background:transparent!important;background-color:transparent!important}
.lk-on .lk-title{font-family:var(--lk-title)!important;font-weight:var(--lk-tw,700)!important;letter-spacing:var(--lk-tls,-.01em)!important;color:var(--lk-ink)!important;text-wrap:balance}
.lk-on.lk-up .lk-title{line-height:1.05!important}
.lk-vibe-pantry .lk-title{color:#3B2414!important;text-shadow:0 1px 0 rgba(255,244,220,.55)}
.lk-fxl{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}.lk-fxl.fixed{position:fixed;z-index:-1}.lk-fxl canvas{position:absolute;inset:0;width:100%;height:100%}
.lk-paper{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .27 0 0 0 0 .18 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(120% 80% at 50% 0,transparent 55%,rgba(110,80,40,.10));opacity:.55;mix-blend-mode:multiply}
.lk-velvet{background:radial-gradient(150vw 75vh at 50% 0,color-mix(in srgb,var(--lk-glow,#C2384A) 14%,transparent),transparent 70%),radial-gradient(100vw 55vh at 85% 100%,color-mix(in srgb,var(--lk-glow,#C2384A) 8%,transparent),transparent 70%),radial-gradient(130% 90% at 50% 40%,transparent 55%,rgba(0,0,0,.45));animation:lk-breathe 9s ease-in-out infinite}
.lk-update{position:relative;z-index:2;display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:10px 16px 10px 10px;border-radius:18px;background:#FFF3B0;color:#1F1A17;border:2px solid #1F1A17;box-shadow:3px 3px 0 #1F1A17;transform:rotate(-1deg);width:fit-content;max-width:100%;box-sizing:border-box}
.lk-burst{flex:none;position:relative;width:54px;height:54px;display:grid;place-items:center}.lk-burst svg{position:absolute;inset:0;width:100%;height:100%;fill:#E2573A;stroke:#1F1A17;stroke-width:3;stroke-linejoin:round}.lk-burst b{position:relative;font:800 13px/1 "IBM Plex Sans",system-ui,sans-serif;color:#fff;transform:rotate(-10deg)}
.lk-upd-t{display:grid;gap:2px;font:600 16px/1.3 "IBM Plex Sans",system-ui,sans-serif;min-width:0;text-align:left}.lk-upd-t>b{font-size:12px;letter-spacing:.08em;text-transform:uppercase}.lk-upd-t time{font-weight:500;color:#5E534B;letter-spacing:0;text-transform:none;margin-left:4px}.lk-upd-t>span{overflow-wrap:anywhere}
.lk-lights{position:absolute;left:0;right:0;top:0;height:56px;pointer-events:none;z-index:1}.lk-lights.fixed{position:fixed;z-index:3}.lk-lights svg{width:100%;height:100%;display:block;overflow:visible}
.lk-lights .bulb{animation:lk-glow 3.2s ease-in-out infinite}.lk-lights .bulb:nth-child(3n+1){animation-delay:-1.1s}.lk-lights .bulb:nth-child(3n+2){animation-delay:-2.2s}
@keyframes lk-glow{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.lk-lights .bulb{animation:none;opacity:.9}}
@keyframes lk-breathe{0%,100%{opacity:.85}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.lk-velvet{animation:none}}
/* card deck: the drawn cover as a flat pastel playing card, the kind of event in spaced caps top-left, the drawing big in the middle */
.ea-cover.lk-deck{background:var(--lk-deck,#F6CBD5)!important}.ea-cover.lk-deck .ea-txt{display:none!important}
.ea-cover.lk-deck .ea-art{inset:17% 7% 6%!important;width:auto!important;height:auto!important;max-width:none!important;justify-content:center!important;align-items:center!important}.ea-cover.lk-deck .ea-art svg{width:100%!important;height:100%!important;max-width:none!important;overflow:visible}.ea-cover.lk-deck .ea-art svg [stroke-width]{stroke-width:6px}
.lk-corner{position:absolute;left:6%;top:7%;z-index:2;font:700 clamp(11px,4.4cqw,18px)/1 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.26em;text-transform:uppercase;color:#1F1A17;pointer-events:none;white-space:nowrap}
/* stickers on the cover (shown even where a cover hides its other layers) */
html body .lk-stk.lk-stk.lk-stk.lk-stk{display:block!important}
.lk-stk{position:absolute;inset:0;z-index:3;pointer-events:none;container-type:inline-size}.lk-st{position:absolute;width:calc(clamp(34px,17cqw,120px) * var(--s,1));aspect-ratio:1;transform:translate(-50%,-50%) rotate(var(--r,0deg));filter:drop-shadow(0 4px 6px rgba(31,26,23,.22))}
.lk-st svg{display:block;width:100%;height:100%;overflow:visible}.lk-stk.edit{pointer-events:auto}.lk-stk.edit .lk-st{cursor:grab;touch-action:none}.lk-stk.edit .lk-st.drag{cursor:grabbing;filter:drop-shadow(0 10px 12px rgba(31,26,23,.35))}
.lk-pop{animation:lk-pop .45s cubic-bezier(.3,1.7,.5,1)}@keyframes lk-pop{0%{transform:translate(-50%,-50%) scale(.2) rotate(var(--r,0deg))}100%{transform:translate(-50%,-50%) scale(1) rotate(var(--r,0deg))}}
@media (prefers-reduced-motion:reduce){.lk-pop{animation:none}}
/* night out: a noren curtain across the top, two paper lanterns that sway, and a warm glow under them */
.lk-lant{position:absolute;left:0;right:0;top:0;height:460px;z-index:-1;pointer-events:none;overflow:hidden;background:radial-gradient(240px 200px at 7% 120px,rgba(242,164,74,.30),transparent 70%),radial-gradient(240px 200px at 93% 120px,rgba(229,83,61,.26),transparent 70%)}
.lk-lant.inbox{z-index:0;height:340px}
.lk-noren{display:block;width:100%;height:54px}
.lk-ch{position:absolute;top:30px;width:clamp(34px,5.6vw,74px);transform-origin:50% 0;animation:lk-sway 6s ease-in-out infinite}.lk-ch.l{left:max(8px,3vw)}.lk-ch.r{right:max(8px,3vw);animation-delay:-3s}.lk-ch svg{display:block;width:100%;height:auto;overflow:visible}
.lk-ch::before{content:"";position:absolute;left:-60%;right:-60%;top:20%;height:90%;border-radius:50%;background:radial-gradient(closest-side,rgba(255,190,110,.55),transparent);z-index:-1}
.lk-lant.inbox .lk-ch{width:34px;top:24px}.lk-lant.inbox .lk-noren{height:40px}
@media (max-width:600px){.lk-lant:not(.inbox) .lk-ch.l{display:none}.lk-lant:not(.inbox) .lk-ch.r{width:32px;right:10px}}
@keyframes lk-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@media (prefers-reduced-motion:reduce){.lk-ch{animation:none}}
/* terminal: faint scanlines over a calm light page, a block cursor after mono titles */
.lk-scan{background:repeating-linear-gradient(180deg,rgba(27,29,28,.06) 0 1px,transparent 1px 3px);opacity:.7}
@media (prefers-reduced-motion:reduce){.lk-scan{display:none}}
.lk-fxl.fixed.lk-pix::after{display:none}
.lk-font-mono .lk-title::after{content:"";display:inline-block;width:.52em;height:.86em;margin-left:.14em;vertical-align:-.06em;background:currentColor;animation:lk-blink 1.1s steps(1) infinite}
@keyframes lk-blink{50%{opacity:0}}@media (prefers-reduced-motion:reduce){.lk-font-mono .lk-title::after{animation:none}}
/* pixel: a crenellated pixel border top and bottom, a few original sprites, crisp edges, square covers */
.lk-pix{image-rendering:pixelated}.lk-pix::before,.lk-pix::after{content:"";position:absolute;left:0;right:0;height:16px;background:linear-gradient(var(--lk-pix,#3A2E5C) 0 0) 0 0/100% 8px no-repeat,repeating-linear-gradient(90deg,var(--lk-pix,#3A2E5C) 0 8px,transparent 8px 16px) 0 8px/100% 8px no-repeat}
.lk-pix::before{top:0}.lk-pix::after{bottom:0;transform:scaleY(-1)}
.lk-pix svg{position:absolute;width:44px;height:44px;shape-rendering:crispEdges}.lk-pix .s1{left:12px;top:30px}.lk-pix .s2{right:14px;top:34px}.lk-pix .s3{right:22px;bottom:28px}
@media (max-width:600px){.lk-pix svg{width:28px;height:28px}.lk-pix .s1{display:none}}
.lk-fx-pixels :is(.cov,.gxcover,.mk-cov){border-radius:0!important;box-shadow:6px 6px 0 var(--lk-pix,#3A2E5C)!important}.lk-fx-pixels .ea-cover{border-radius:0!important}
body.lk-invite.lk-fx-pixels main{padding-top:calc(max(12px,env(safe-area-inset-top)) + 20px)}
/* night out menu: a handwritten slip of paper, like the menu on an izakaya wall */
.lk-fx-lanterns .mc{background:#F4EAD3!important;background-image:repeating-linear-gradient(180deg,transparent 0 33px,rgba(31,26,23,.08) 33px 34px)!important;border:2px solid #1F1A17;box-shadow:0 18px 36px -20px rgba(0,0,0,.6);transform:rotate(-.6deg);color:#1F1A17}
.lk-fx-lanterns .mc .mc-h{color:#B3321F!important;font:700 22px/1 Kalam,"Comic Sans MS",cursive;letter-spacing:.04em;text-transform:none;opacity:1}
.lk-fx-lanterns .mc .mc-c{background:transparent!important;border-radius:0;padding:8px 6px;border-bottom:2px dotted rgba(31,26,23,.35);text-align:left;box-shadow:none!important}
.lk-fx-lanterns .mc .mc-c b{font:700 20px/1.25 Kalam,"Comic Sans MS",cursive;color:#1F1A17!important;letter-spacing:0}.lk-fx-lanterns .mc .mc-c small{font:400 15px/1.2 Kalam,"Comic Sans MS",cursive;color:#5A4E45!important;text-transform:none;letter-spacing:0}
.lk-fx-lanterns .mc .mc-b{display:none}.lk-fx-lanterns .mc .mc-fin{background:#1F1A17!important;color:#F4EAD3!important;border-radius:6px;text-align:center;margin-top:10px;border:0}.lk-fx-lanterns .mc .mc-fin b{color:#F4EAD3!important}
.lk-fx-lanterns .mc .mc-note{color:#5A4E45!important}
/* pantry: a wall of backlit jars in wooden cubbies across the top (it fades into the page before any text), a faint hex-tile floor */
.lk-jw{position:absolute;left:0;right:0;top:0;height:var(--jw-h,200px);z-index:-1;pointer-events:none;overflow:hidden;-webkit-mask:linear-gradient(180deg,#000 0,#000 50%,transparent 85%);mask:linear-gradient(180deg,#000 0,#000 50%,transparent 85%)}
.lk-jw svg{display:block;width:100%;height:100%}.lk-jw::after{content:"";position:absolute;inset:0;background:radial-gradient(60% 90% at 50% 30%,rgba(255,196,110,.28),transparent 70%);animation:lk-jwglow 7s ease-in-out infinite}
.lk-jw .pt-glow{animation:lk-jwflick 9s ease-in-out infinite}.lk-jw.inbox{height:var(--jw-h,128px);z-index:0}
@keyframes lk-jwglow{0%,100%{opacity:.75}50%{opacity:1}}@keyframes lk-jwflick{0%,100%{opacity:1}40%{opacity:.9}55%{opacity:.97}}
@media (prefers-reduced-motion:reduce){.lk-jw::after,.lk-jw .pt-glow{animation:none}}
.lk-hex{background-repeat:repeat;-webkit-mask:linear-gradient(180deg,transparent 0,#000 30%,#000 70%,transparent 100%);mask:linear-gradient(180deg,transparent 0,#000 30%,#000 70%,transparent 100%)} /* review round 13: the floor fades in and out, no hard edge */
body.lk-invite.lk-fx-jarwall main{padding-top:calc(max(12px,env(safe-area-inset-top)) + 132px)}
@media (min-width:700px){body.lk-invite.lk-fx-jarwall main{padding-top:calc(max(12px,env(safe-area-inset-top)) + 176px)}}`;
  // the light invite (public/invite.html, body.lk-invite): its cards, form and buttons in the look's colours, and the flyer
  // beside the invite on wide screens. Kept here so the invite page itself stays small.
  const INVITE_CSS = `body.lk-invite.lk-on main{position:relative;z-index:1}body.lk-invite.lk-on .brand,html body.lk-on.lk-on a.brand.brand{color:var(--lk-ink)!important}body.lk-invite.lk-on a{color:inherit}
body.lk-invite.lk-on .muted{color:var(--lk-soft)}body.lk-invite.lk-on h1.lk-title{font-size:calc(clamp(36px,9.5vw,58px) * var(--lk-tk,1));line-height:1.02;margin:20px 0 12px}
body.lk-invite .cov.poster{aspect-ratio:auto;border:0;background:none;border-radius:18px;box-shadow:0 22px 44px -22px rgba(0,0,0,.55)}body.lk-invite .cov.poster img{height:auto}
body.lk-invite.lk-on .cov:not(.poster){border-color:var(--lk-ink);box-shadow:0 18px 36px -22px rgba(0,0,0,.5)}
body.lk-invite.lk-on form,body.lk-invite.lk-on .ticket,body.lk-invite.lk-on .kit{background:var(--lk-card);color:var(--lk-card-ink);border:1px solid var(--lk-line)!important;box-shadow:0 22px 44px -28px rgba(0,0,0,.55)}
body.lk-invite.lk-on form .muted,body.lk-invite.lk-on .ticket .muted,body.lk-invite.lk-on label.f small{color:color-mix(in srgb,var(--lk-card-ink) 74%,var(--lk-card))}
body.lk-invite.lk-on input[type=text],body.lk-invite.lk-on input[type=email],body.lk-invite.lk-on input[type=tel],body.lk-invite.lk-on textarea,body.lk-invite.lk-on select{background:color-mix(in srgb,var(--lk-card-ink) 5%,var(--lk-card));color:var(--lk-card-ink);border-color:color-mix(in srgb,var(--lk-card-ink) 28%,var(--lk-card))}
body.lk-invite.lk-on .resp label{border-color:color-mix(in srgb,var(--lk-card-ink) 28%,var(--lk-card))}body.lk-invite.lk-on .resp label:has(input:checked){background:var(--lk-card-ink);color:var(--lk-card);border-color:var(--lk-card-ink)}
body.lk-invite.lk-on .go,body.lk-invite.lk-on .stick a,body.lk-invite.lk-on .btn.main,body.lk-invite.lk-on .btn.pay{background:var(--lk-btn);color:var(--lk-on-btn);border-color:var(--lk-btn)}
body.lk-invite.lk-on .btn{background:var(--lk-card);color:var(--lk-card-ink);border-color:color-mix(in srgb,var(--lk-card-ink) 28%,var(--lk-card))}
body.lk-invite.lk-on .stick{background:color-mix(in srgb,var(--lk-bot) 90%,transparent);border-top-color:var(--lk-line);z-index:4}body.lk-invite.lk-on .stick b{color:var(--lk-ink)}
body.lk-invite.lk-on .going span,body.lk-invite.lk-on .host .av{background:var(--lk-card);color:var(--lk-card-ink);border-color:var(--lk-line)}
body.lk-invite.lk-on .full,body.lk-invite.lk-on .linkbtn{color:var(--lk-link,var(--lk-ink))}
html body.lk-invite.lk-on.lk-on button.go,html body.lk-invite.lk-on.lk-on button.go:hover,html body.lk-invite.lk-on.lk-on a.btn.main,html body.lk-invite.lk-on.lk-on a.btn.pay{background:var(--lk-btn)!important;color:var(--lk-on-btn)!important;border-color:var(--lk-btn)!important}
body.lk-invite.lk-fx-lights main,body.lk-invite.lk-fx-lanterns main{padding-top:calc(max(12px,env(safe-area-inset-top)) + 40px)}
body.lk-invite .cov.poster{width:fit-content;max-width:100%;margin:0 auto}body.lk-invite .cov.poster img{width:auto;max-width:100%;max-height:min(74vh,820px)}
/* wide screens: the flyer on the left, held in place, and the invite beside it */
/* a dark look: one palette from the look's own tokens. The cover sits in the page's deep tone with the drawing in light
   lines, cards are the raised surface, fields the field tone, secondary buttons outlined. Nothing white, no offset shadows */
/* the drawing's one spot of colour is the look's accent (docs/brand-kit.md: a drawing never brings a hue of its own) */
.lk-on :is(.cov,.gxcover,.mk-cov,.em-drawn) .ea-art svg :is([fill="#29489A"],[fill="#C2431F"],[fill="#56683F"]){fill:var(--lk-spot)}
.lk-dark :is(.cov,.gxcover):not(.poster):not(.lk-pcov){background:var(--lk-cover)!important;border:1.5px solid var(--lk-line2)!important;box-shadow:none!important}
.lk-dark :is(.cov,.gxcover) .ea-cover:not(.lk-deck):not(.ea-custom){background:var(--lk-cover)!important;color:var(--lk-ink)!important}
.lk-dark :is(.cov,.gxcover,.em-drawn) .ea-art svg [stroke="#2A2622"],.lk-dark .em-drawn svg [stroke="#2A2622"]{stroke:var(--lk-ink)}.lk-dark :is(.cov,.gxcover) .ea-art svg [fill="#2A2622"],.lk-dark .em-drawn svg [fill="#2A2622"]{fill:var(--lk-ink)}
.lk-dark :is(.cov,.gxcover) .ea-cover:not(.lk-deck) .ea-art svg [fill="#fff"],.lk-dark .em-drawn svg [fill="#fff"]{fill:var(--lk-raised)}.lk-dark :is(.cov,.gxcover) .ea-cover:not(.lk-deck) .ea-art svg{filter:none!important}
body.lk-invite.lk-dark :is(.pls-btn,.sl-btn,.btn:not(.main):not(.pay)){background:transparent!important;color:var(--lk-ink)!important;border:1.5px solid var(--lk-line2)!important;box-shadow:none!important}
body.lk-invite.lk-dark :is(.pls-btn,.sl-btn) svg{color:var(--lk-ink)}.lk-dark .pls-btn{--pls-fill:transparent}.lk-dark .pls-btn svg path{stroke:var(--lk-ink)}.lk-dark .pls-btn[aria-pressed=true]{--pls-fill:var(--lk-btn)}
body.lk-invite.lk-dark form,body.lk-invite.lk-dark .tb-card{background:var(--lk-raised)!important;color:var(--lk-ink)!important;border:1.5px solid var(--lk-line)!important;box-shadow:none!important}
body.lk-invite.lk-dark .tb-card :is(summary,b,p,span,label){color:var(--lk-ink)!important}body.lk-invite.lk-dark :is(form,.tb-card) :is(small,.muted,.consent){color:var(--lk-raised-soft)!important}
body.lk-invite.lk-dark :is(input:not([type=checkbox]):not([type=radio]),textarea,select){background:var(--lk-field)!important;color:var(--lk-ink)!important;border:1.5px solid var(--lk-line2)!important}
body.lk-invite.lk-dark :is(input,textarea)::placeholder{color:var(--lk-raised-soft);opacity:1}
body.lk-invite.lk-dark input[type=checkbox]{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:6px;border:1.5px solid var(--lk-line2);background:var(--lk-field);display:inline-grid;place-items:center;margin:0}
body.lk-invite.lk-dark input[type=checkbox]:checked{background:var(--lk-ink);border-color:var(--lk-ink)}body.lk-invite.lk-dark input[type=checkbox]:checked::after{content:"";width:10px;height:6px;border:2px solid var(--lk-bot);border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
body.lk-invite.lk-on h1.lk-title{font-size:calc(var(--fs-28-40,28px) * var(--lk-tk,1))!important;line-height:1.08;text-transform:none;text-shadow:none}body.lk-invite.lk-on h2.ask{font-size:20px}
@media (min-width:960px){body.lk-invite.lk-poster main{max-width:1080px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto repeat(24,auto) 1fr;column-gap:56px;padding-top:24px}
  body.lk-invite.lk-poster main>*{grid-column:2}body.lk-invite.lk-poster main>.top{grid-column:1/-1}body.lk-invite.lk-poster main>.cov.poster{grid-column:1;grid-row:2/-1;position:sticky;top:24px;align-self:start;margin:0 0 0 auto}
  body.lk-invite.lk-poster main>.cov.poster img{max-height:calc(100vh - 110px)}body.lk-invite.lk-poster h1.lk-title{margin-top:4px}body.lk-invite.lk-poster .stick{left:auto;right:max(16px,calc((100vw - 1080px) / 2 + 16px));transform:none;width:min(512px,calc(50vw - 44px));bottom:16px;border:1px solid var(--lk-line,var(--line));border-radius:999px;padding:8px}}`;
  function css() { if (typeof document === "undefined" || document.getElementById("lk-css")) return; const s = document.createElement("style"); s.id = "lk-css"; s.textContent = CSS + INVITE_CSS; document.head.appendChild(s); }
  const CLS = ["lk-on", "lk-dark", "lk-light", "lk-up", "lk-page", "lk-face-serif", "lk-face-sans"];
  /** Dress `el` (the body on an invite, a frame in the preview) in the event's look. Returns the colours used, or null. */
  function apply(el, e, { fixed = true, page = true } = {}) { css(); const BK = window.EncoreBrandKit; if (BK) e = BK.eventFor(e, el, { fixed, page }); /* the host's brand kit: fonts from the kit unless the event overrides them; no look, the kit's colours */ const L = lookOf(e);
    el.__lkStop?.(); el.__lkStop = null; if (el === document.body) document.documentElement.classList.remove("lk-root"); el.classList.remove(...CLS, ...[...el.classList].filter((c) => /^lk-(fx|font|vibe)-/.test(c)));
    if (!has(L)) return null;
    // Field Notes: the page stays linen (no lk-page, no gradient on the root) and the text ink; the look brings its accent
    const T0 = colors(L), T = T0 && fieldNotes(T0), F = FONTS[L.titleFont] && titleFace(L.titleFont); el.classList.add("lk-on");
    if (T) { el.classList.add("lk-light"); Object.entries({ "--lk-top": T.top, "--lk-bot": T.bot, "--lk-ink": T.ink, "--lk-soft": T.soft, "--lk-link": T.link, "--lk-btn": T.btn, "--lk-on-btn": T.onBtn, "--lk-card": T.card, "--lk-card-ink": T.cardInk, "--lk-line": T.line, "--lk-raised": T.raised, "--lk-raised-soft": T.raisedSoft, "--lk-field": T.field, "--lk-line2": T.lineStrong, "--lk-cover": T.cover }).forEach(([k, v]) => v && el.style.setProperty(k, v)); }
    if (F) { el.classList.add("lk-face-" + sturdyOf(L.titleFont)); el.style.setProperty("--lk-title", F.css); el.style.setProperty("--lk-tw", F.w); el.style.setProperty("--lk-tls", F.ls); el.style.setProperty("--lk-tk", 1); }
    if (L.vibe && VIBES[L.vibe]) el.classList.add("lk-vibe-" + L.vibe);
    el.style.setProperty("--lk-glow", L.effect === "lanterns" ? "#F28A3A" : glowOf(L)); if (T) { el.style.setProperty("--lk-pix", T.ink); el.style.setProperty("--lk-spot", T.spot || T.btn); }
    // the effect: drawn behind the words by public/effects.js, loaded the first time a page has one (still for less motion)
    const stops = []; if (L.effect && L.effect !== "none") stops.push(fxMount(el, e, L, T));
    decorate(el === document.body ? document : el, e); if (BK) BK.after(el, e);
    el.__lkStop = () => stops.forEach((f) => f());
    return T; }
  function fxMount(el, e, L, T) { let stop = null, dead = false; const go = () => { if (!dead && window.EncoreEffects) stop = window.EncoreEffects.mount(el, L, { event: e, theme: T }); };
    if (window.EncoreEffects) go(); else { let s = document.getElementById("fx-js"); if (!s) { s = document.createElement("script"); s.id = "fx-js"; s.src = "/effects.js"; s.async = true; document.head.appendChild(s); } s.addEventListener("load", go, { once: true }); }
    return () => { dead = true; stop?.(); }; }
  // ---------- the cover: card deck and stickers, on every cover inside root (the invite's .cov, /g's .gxcover, the preview's .mk-cov) ----------
  const hash = (t) => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  function cornerWord(e) { const A = window.EventArt; let w = ""; try { if (A) { const k = String((A.valid?.(e?.coverArt?.kind) && e.coverArt.kind) || A.kindOf(e || {})).split("+")[0]; w = A.LABEL?.[k] || ""; } } catch {}
    return String(w || "Event").replace(/[^\p{L}\p{N}&' -]/gu, "").trim().split(/\s+/).reduce((o, x) => (!o || (o + " " + x).length <= 14 ? (o ? o + " " + x : x) : o), "").slice(0, 14); }
  function decorate(root, e) { if (!root?.querySelectorAll) return; const L = lookOf(e), deck = L.coverStyle === "deck", sig = JSON.stringify([e?.id, deck, L.stickers || []]);
    root.querySelectorAll(".cov, .gxcover, .mk-cov").forEach((box) => { if (box.dataset.lkDeco === sig && (!deck || !box.querySelector(".ea-cover") || box.querySelector(".lk-deck")) && (!(L.stickers || []).length || box.querySelector(".lk-stk"))) return; box.dataset.lkDeco = sig;
      box.querySelectorAll(".lk-stk,.lk-corner").forEach((x) => x.remove());
      box.querySelectorAll(".ea-cover.lk-deck").forEach((x) => { x.classList.remove("lk-deck"); const a = x.querySelector(".ea-art"); if (a && x.__lkArt != null) a.innerHTML = x.__lkArt; });
      const ea = box.querySelector(".ea-cover:not(.ea-custom)"), A = window.EventArt;
      if (deck && ea) { ea.classList.add("lk-deck");
        // one chubby drawing in the middle of the card, the event's own kind
        const art = ea.querySelector(".ea-art"); if (art && A) { if (ea.__lkArt == null) ea.__lkArt = art.innerHTML; try { const k = String((A.valid?.(e?.coverArt?.kind) && e.coverArt.kind) || A.kindOf(e || {})).split("+")[0], tone = A.toneOf(e || {}, k); art.innerHTML = A.drawing(k, A.SPOT?.[tone] || "#A4533A"); } catch {} } ea.style.setProperty("--lk-deck", DECK[hash(e?.id || e?.name || "") % DECK.length]); const c = document.createElement("span"); c.className = "lk-corner"; c.setAttribute("aria-hidden", "true"); c.textContent = cornerWord(e); ea.appendChild(c); }
      const st = stickersHTML(L); if (st) { if (getComputedStyle(box).position === "static") box.style.position = "relative"; box.insertAdjacentHTML("beforeend", st); } });
    menus(root, e); }
  // the harvest menu: the full invite's menu card (#menuCard, public/menucard.js) redrawn as the cream harvest card, with the price line
  const priceLine = (e) => { const t = window.EncoreTiers?.line(e); if (t) return t; const p = String(e?.price ?? "").trim(); if (!p || p === "chip" || e?.free === true || /^(free|\$?0)$/i.test(p)) return "";
    const a = /^\$?\d/.test(p) ? (p.startsWith("$") ? p : "$" + p) : p; return /a person|each|per |at the door/i.test(a) ? a : a + " a person"; };
  function menus(root, e) { const M = window.MenuCard, want = lookOf(e).menuStyle === "harvest", courses = Array.isArray(e?.courses) ? e.courses : []; if (!M || !courses.length) return;
    root.querySelectorAll("#menuCard").forEach((box) => { if (want === !!box.querySelector(".mc-hv")) return; box.innerHTML = M.html(want ? { style: "harvest", theme: e.dinnerTheme, courses, price: priceLine(e) } : { theme: e.dinnerTheme, courses }); }); }
  // the velvet glow: an accent close in hue to the page colour (a red on wood, a pink on red), else the page colour lifted
  function glowOf(L) { const p = (L.palette || []).filter(okHex); if (!p.length || !C) return "#C2384A"; const h0 = C.hsl(p[0])[0];
    const near = p.slice(1).find((c) => { const d = Math.abs(C.hsl(c)[0] - h0); return Math.min(d, 360 - d) < 36 && C.hsl(c)[1] > 0.3; }); return near || C.mix(p[0], "#FF8A8A", 0.35); }
  function particleColors(L, T) { const p = (L.palette || []).filter(okHex), dark = !!T?.dark;
    switch (L.effect) { case "snow": return dark ? ["#FFFFFF"] : ["#FFFFFF"];
      case "sparkles": return dark ? ["#FFF6D5", "#FFFFFF", p[2] || "#F2C46D"] : ["#FFFFFF", "#FFF3C4", p[2] || "#F2D36B"];
      case "twinkle": return dark ? ["#F2C46D", "#FFE9B0", "#FFF6E0"] : ["#B8862B", "#D9A441"];
      case "stars": return dark ? ["#FFFFFF", "#FFF1C9"] : [T?.ink || "#1F1A17", p[1] || "#C94A30"];
      case "petals": return ["#F4B2C0", "#F7CBD3", p[2] && C && C.lum(p[2]) > 0.25 ? p[2] : "#E98973", "#FFFFFF"];
      default: return [...p.slice(1), "#F2C46D", "#E26D8E", "#5B7FD6", "#3E9C6E"].slice(0, 5); } }

  // ---------- ambient effects: CSS for paper and velvet, a small canvas for the rest ----------
  // at most 30 particles (fewer on a small screen: the count follows the viewport's area), 30 frames a second, paused
  // when the tab is hidden or the layer is off screen, and a still frame for people who prefer less motion.
  // Soft glows are drawn once into a small sprite and stamped with drawImage: no shadowBlur per particle per frame.
  const COUNT = { snow: 30, confetti: 26, petals: 16, sparkles: 22, stars: 30, twinkle: 24 };
  const FPS = 30, AREA = 1280 * 800;
  /** How many particles for a viewport: the full count at 1280x800 or bigger, scaled down by area, never under 8 or over 30. */
  const countFor = (kind, w, h) => Math.max(Math.min(8, COUNT[kind] || 0), Math.min(30, COUNT[kind] || 0, Math.round((COUNT[kind] || 0) * Math.min(1, (w * h) / AREA))));
  // a blurred dot or four-point star, drawn once per colour at about the size it's drawn at (B css px radius), then stamped
  const SPR = new Map();
  function sprite(shape, color, glow, blur, dpr, B) { const key = shape + "|" + color + "|" + glow + "|" + blur + "|" + dpr + "|" + B; let c = SPR.get(key); if (c) return c;
    const pad = Math.ceil(blur * 2) + 2, n = Math.ceil((B + pad) * 2 * dpr); c = document.createElement("canvas"); c.width = c.height = n; const x = c.getContext("2d"); if (!x) return null;
    x.scale(dpr, dpr); const m = B + pad; x.fillStyle = color; x.shadowColor = glow; x.shadowBlur = blur * dpr; x.beginPath();
    if (shape === "star") { x.moveTo(m, m - B); x.quadraticCurveTo(m, m, m + B, m); x.quadraticCurveTo(m, m, m, m + B); x.quadraticCurveTo(m, m, m - B, m); x.quadraticCurveTo(m, m, m, m - B); } else x.arc(m, m, B, 0, 7);
    x.fill(); c.__m = m; c.__b = B; if (SPR.size > 60) SPR.clear(); SPR.set(key, c); return c; }
  function effect(host, kind, { fixed = true, dark = false, colors = ["#fff"] } = {}) { css(); if (typeof document === "undefined") return () => {};
    const layer = document.createElement("div"); layer.className = "lk-fxl" + (fixed ? " fixed" : ""); layer.setAttribute("aria-hidden", "true");
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    host.prepend(layer);
    if (kind === "paper" || kind === "velvet") { layer.classList.add("lk-" + kind); return () => layer.remove(); }
    if (kind === "lanterns") { layer.remove(); return lanterns(host, { fixed }); }
    if (kind === "jarwall") { layer.classList.add("lk-hex"); const stop = jarwall(host, layer, { fixed }); return () => { stop(); layer.remove(); }; }
    if (kind === "scanlines") { layer.classList.add("lk-scan"); return () => layer.remove(); }
    if (kind === "pixels") { layer.classList.add("lk-pix"); layer.innerHTML = SPRITES.map((s, i) => `<svg class="s${i + 1}" viewBox="0 0 ${s[0].length} ${s.length}" aria-hidden="true">${pxRects(s)}</svg>`).join(""); return () => layer.remove(); }
    if (!COUNT[kind]) { layer.remove(); return () => {}; }
    const cv = document.createElement("canvas"); layer.appendChild(cv); const g = cv.getContext("2d"); if (!g) return () => layer.remove();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches, phone = matchMedia("(pointer: coarse)").matches || innerWidth < 700, dpr = Math.min(phone ? 1.5 : 2, window.devicePixelRatio || 1);
    let W = 0, H = 0, P = [], raf = 0, last = 0, seen = true, alive = true, t = 0;
    const rnd = (a, b) => a + Math.random() * (b - a), pick = (L) => L[(Math.random() * L.length) | 0];
    const size = () => { const r = fixed ? { width: innerWidth, height: innerHeight } : layer.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const make = (anyY) => { const p = { x: rnd(0, W), y: anyY ? rnd(0, H) : rnd(-40, -8), c: pick(colors), a: rnd(0, Math.PI * 2), s: rnd(0.6, 1) };
      if (kind === "snow") Object.assign(p, { r: rnd(1.4, 3.8), vy: rnd(0.35, 1.0), sw: rnd(0.4, 1.2), al: rnd(0.55, 0.95) });
      if (kind === "confetti") Object.assign(p, { w: rnd(5, 8), h: rnd(9, 13), vy: rnd(0.9, 1.7), vr: rnd(-0.08, 0.08), sw: rnd(0.4, 1) });
      if (kind === "petals") Object.assign(p, { r: rnd(6, 10), vy: rnd(0.45, 0.9), vr: rnd(-0.03, 0.03), sw: rnd(0.8, 1.6) });
      if (kind === "sparkles") Object.assign(p, { y: rnd(0, H), r: rnd(4, 10), vy: -rnd(0.05, 0.22), tw: rnd(0.01, 0.03) });
      if (kind === "stars") Object.assign(p, { y: rnd(0, H * 0.85), r: rnd(0.7, 1.8), vy: 0, tw: rnd(0.01, 0.035) });
      if (kind === "twinkle") Object.assign(p, { y: rnd(0, H), r: rnd(1.6, 3.2), vy: 0, tw: rnd(0.004, 0.012) });
      return p; };
    // stamp a sprite centred on x, y at radius r
    const stamp = (S, x, y, r) => { if (!S) return; const k = r / S.__b, m = S.__m * k; g.drawImage(S, x - m, y - m, m * 2, m * 2); };
    const snowS = (c) => sprite("dot", c, "rgba(30,60,110,.25)", 3, dpr, 2.6), sparkS = (c) => sprite("star", c, dark ? c : "rgba(40,50,30,.35)", dark ? 8 : 5, dpr, 7), glowS = (c) => sprite("dot", c, c, 10, dpr, 2.4);
    const draw = (k) => { g.clearRect(0, 0, W, H);
      for (const p of P) { p.a += (p.vr || p.tw || 0.01) * k; p.y += p.vy * k;
        if (kind === "snow") { p.x += Math.sin(p.a + t * 0.01) * 0.3 * p.sw * k; g.globalAlpha = p.al; stamp(snowS(p.c), p.x, p.y, p.r); }
        else if (kind === "confetti") { p.x += Math.sin(p.a * 2) * 0.5 * p.sw * k; g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.scale(1, Math.cos(p.a * 3)); g.globalAlpha = 0.9; g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); }
        else if (kind === "petals") { p.x += Math.sin(p.a * 6 + t * 0.02) * 0.6 * p.sw * k; g.save(); g.translate(p.x, p.y); g.rotate(p.a * 4 + Math.sin(t * 0.02 + p.s * 9) * 0.6); g.globalAlpha = 0.85; g.fillStyle = p.c; g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 7); g.fill(); g.globalAlpha = 0.25; g.fillStyle = "#B0344F"; g.beginPath(); g.ellipse(-p.r * 0.35, 0, p.r * 0.35, p.r * 0.12, 0, 0, 7); g.fill(); g.restore(); }
        else if (kind === "sparkles") { const al = 0.25 + 0.75 * Math.abs(Math.sin(p.a)); g.globalAlpha = al; stamp(sparkS(p.c), p.x, p.y, p.r * (0.6 + 0.4 * al)); }
        else if (kind === "twinkle") { const al = Math.max(0, Math.sin(p.a)) ** 3; g.globalAlpha = 0.12 + 0.88 * al; stamp(glowS(p.c), p.x, p.y, p.r); }
        else if (kind === "stars") { g.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(p.a)); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
        if (p.y > H + 20 || p.y < -30) Object.assign(p, make(false), kind === "sparkles" ? { y: H + 10 } : {}); if (p.x < -20) p.x = W + 10; if (p.x > W + 20) p.x = -10; }
      g.globalAlpha = 1; };
    // 30 frames a second at most (a frame is skipped until 1/30 s has passed, with a little slack for 60 Hz timing)
    const loop = (now) => { raf = 0; if (!alive || document.hidden || !seen) return; const dt = now - (last || now); if (dt >= 1000 / FPS - 3 || !last) { const k = Math.min(3, (dt || 16) / 16.7); t += k; last = now; draw(k); } raf = requestAnimationFrame(loop); };
    const go = () => { if (!raf && alive && !still) { last = 0; raf = requestAnimationFrame(loop); } };
    size(); for (let i = 0, n = countFor(kind, W, H); i < n; i++) P.push(make(true)); draw(0); go();
    const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : go()); document.addEventListener("visibilitychange", onVis);
    let rt = 0; const onRs = () => { clearTimeout(rt); rt = setTimeout(() => { size(); const n = countFor(kind, W, H); while (P.length > n) P.pop(); while (P.length < n) P.push(make(true)); if (still) draw(0); }, 150); }; addEventListener("resize", onRs);
    // off screen (the layer, or for a fixed layer the part of the page it decorates): stop drawing until it's back
    let io = null; if ("IntersectionObserver" in window) { io = new IntersectionObserver(([x]) => { seen = x.isIntersecting; if (seen) go(); }); io.observe(fixed ? host : layer); }
    return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); removeEventListener("resize", onRs); io?.disconnect(); layer.remove(); }; }

  // night out: a noren curtain (split cloth panels on a wooden rod) and two paper lanterns, line art in warm cream
  const LANTERN = (id) => `<svg viewBox="0 0 80 128"><defs><radialGradient id="${id}" cx=".45" cy=".45" r=".6"><stop offset="0" stop-color="#FFD58A" stop-opacity=".85"/><stop offset=".7" stop-color="#FFB060" stop-opacity="0"/></radialGradient></defs>
    <path d="M40 0v16" stroke="#E8D3A8" stroke-width="3" stroke-linecap="round"/><rect x="24" y="14" width="32" height="9" rx="3" fill="#1A1410" stroke="#E8D3A8" stroke-width="2.5"/>
    <ellipse cx="40" cy="64" rx="36" ry="42" fill="#D9472F" stroke="#FFE2B0" stroke-width="3"/><ellipse cx="40" cy="64" rx="36" ry="42" fill="url(#${id})"/>
    <path d="M6 44h68M4.5 56h71M4.5 70h71M7 84h66" stroke="#8F2617" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".7"/><path d="M22 34q-8 14-6 30" stroke="#FFE7BF" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <rect x="24" y="103" width="32" height="9" rx="3" fill="#1A1410" stroke="#E8D3A8" stroke-width="2.5"/><path d="M40 112v14M34 116v10M46 116v10" stroke="#F2A44A" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  function noren(w) { const n = Math.max(3, Math.min(9, Math.round(w / 120))), seg = w / n; let panels = "";
    for (let i = 0; i < n; i++) { const x = i * seg + 3, pw = seg - 6, mid = i === Math.floor(n / 2);
      panels += `<path d="M${x.toFixed(1)} 8h${pw.toFixed(1)}v38q0 6-6 6h-${(pw - 12).toFixed(1)}q-6 0-6-6z" fill="#26346F" stroke="#F1DFB8" stroke-width="2"/>`
        + `<path d="M${(x + 8).toFixed(1)} 42h${(pw - 16).toFixed(1)}" stroke="#F1DFB8" stroke-width="1.6" stroke-dasharray="1 6" stroke-linecap="round"/>`
        + (mid ? `<circle cx="${(x + pw / 2).toFixed(1)}" cy="27" r="10" fill="none" stroke="#F1DFB8" stroke-width="2.4"/><path d="M${(x + pw / 2 - 6).toFixed(1)} 28q3-4 6 0t6 0" fill="none" stroke="#F2A44A" stroke-width="2.4" stroke-linecap="round"/>` : ""); }
    return `<svg class="lk-noren" viewBox="0 0 ${w.toFixed(0)} 54" preserveAspectRatio="none">${panels}<path d="M0 7h${w.toFixed(0)}" stroke="#B9874E" stroke-width="5" stroke-linecap="round"/></svg>`; }
  let lid = 0;
  function lanterns(host, { fixed = true } = {}) { css(); if (typeof document === "undefined") return () => {}; loadHand();
    const box = document.createElement("div"); box.className = "lk-lant" + (fixed ? "" : " inbox"); box.setAttribute("aria-hidden", "true");
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    const w = Math.max(320, Math.min(1600, fixed ? innerWidth : host.clientWidth || 360));
    box.innerHTML = noren(w) + `<span class="lk-ch l">${LANTERN("lkLg" + ++lid)}</span><span class="lk-ch r">${LANTERN("lkLg" + ++lid)}</span>`;
    host.prepend(box); return () => box.remove(); }
  // pantry: the jar wall (public/pantry.js draws it, loaded the first time a page needs it) and the hex-tile floor on the effect layer
  let ptWait = null; const needPantry = () => window.EncorePantry ? Promise.resolve(window.EncorePantry) : ptWait || (ptWait = new Promise((ok) => { const t = document.createElement("script"); t.src = "/pantry.js"; t.onload = () => ok(window.EncorePantry || null); t.onerror = () => ok(null); document.head.appendChild(t); }));
  function jarwall(host, layer, { fixed = true } = {}) { css(); if (typeof document === "undefined") return () => {}; let alive = true;
    const box = document.createElement("div"); box.className = "lk-jw" + (fixed ? "" : " inbox"); box.setAttribute("aria-hidden", "true");
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    host.prepend(box);
    needPantry().then((P) => { if (!alive || !P) return; const w = Math.max(320, Math.min(1600, fixed ? innerWidth : host.clientWidth || 360)), h = fixed ? (innerWidth < 700 ? 170 : 250) : 128;
      box.style.setProperty("--jw-h", h + "px"); box.innerHTML = P.jarWall(w, h, P.hash(host.dataset?.lkSeed || location.pathname + location.hash)); const T = P.hexTile(); layer.style.backgroundImage = T.url; layer.style.backgroundSize = T.size; });
    return () => { alive = false; box.remove(); }; }
  let hand = false; const loadHand = () => { if (hand || typeof document === "undefined") return; hand = true; const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap"; document.head.appendChild(l); };
  // pixel sprites, drawn here (original): a star, a heart and a small clay pot, in the page's own ink and two accents
  const SPRITES = [["...a...", "..aaa..", "aaaaaaa", ".aaaaa.", ".aa.aa.", "a.....a"], [".bb.bb.", "bbbbbbb", "bbbbbbb", ".bbbbb.", "..bbb..", "...b..."], ["..ccc..", ".c...c.", "..ccc..", ".ccccc.", "ccaaacc", ".ccccc.", "..ccc.."]];
  const pxRects = (rows) => { const col = { a: "var(--lk-btn,#3A2E5C)", b: "#E0566B", c: "var(--lk-pix,#3A2E5C)" }; let o = ""; rows.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) o += `<rect x="${x}" y="${y}" width="1.02" height="1.02" style="fill:${col[ch]}"/>`; })); return o; };
  // string lights: a scalloped wire of small bulbs across the top that glow gently (CSS only, so it costs nothing to run)
  function lights(host, { fixed = true } = {}) { css(); const box = document.createElement("div"); box.className = "lk-lights" + (fixed ? " fixed" : ""); box.setAttribute("aria-hidden", "true");
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    const w = Math.max(320, Math.min(1600, fixed ? innerWidth : host.clientWidth || 400)), n = Math.max(3, Math.round(w / 150)), seg = w / n, COL = ["#FFD36E", "#FFF1C9", "#FF9F6E", "#FFE08A"];
    let wire = "M0 4", bulbs = "", j = 0;
    for (let i = 0; i < n; i++) { const x0 = i * seg; wire += ` Q${(x0 + seg / 2).toFixed(1)} 40 ${(x0 + seg).toFixed(1)} 4`;
      for (const t of [0.2, 0.4, 0.6, 0.8]) { const x = x0 + seg * t, y = 4 + 72 * t * (1 - t) * 0.5; bulbs += `<g class="bulb"><rect x="${(x - 1.6).toFixed(1)}" y="${(y - 1).toFixed(1)}" width="3.2" height="4" rx="1" fill="#3B2A20"/><ellipse cx="${x.toFixed(1)}" cy="${(y + 7).toFixed(1)}" rx="3.6" ry="5" fill="${COL[j++ % 4]}" filter="url(#lkg)"/></g>`; } }
    box.innerHTML = `<svg viewBox="0 0 ${w.toFixed(0)} 56" preserveAspectRatio="xMidYMin slice"><defs><filter id="lkg" x="-3" y="-3" width="7" height="7"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="${wire}" fill="none" stroke="#3B2A20" stroke-width="1.5"/>${bulbs}</svg>`;
    host.prepend(box); return () => box.remove(); }

  // ---------- a flyer's colours, read on the host's device when they pick the file ----------
  async function readImage(src) { const img = new Image(); img.decoding = "async"; img.src = src; await (img.decode ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; }));
    const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 96 / Math.max(w, h)), cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, cv.width, cv.height); let palette = [];
    try { palette = C.paletteFromPixels(g.getImageData(0, 0, cv.width, cv.height).data); } catch {} return { palette, w, h }; }
  async function fromFile(file) { const u = URL.createObjectURL(file); try { return await readImage(u); } finally { setTimeout(() => URL.revokeObjectURL(u), 2000); } }

  // ---------- Surprise me: a combo that suits the event ----------
  const KINDS = [[/\b(game night|gaming|gamers?|lan party|board ?games?|d&d|dnd|tabletop|ttrpg|arcade|speedrun|retro|pixel|hackathon|hack night|demo night|coding|code|devs?|engineers?|engineering|tech|startup|founders?|ops|sre|meetup|linux|open source)\b/, ["terminal", "pixel"]], [/holiday market|christmas market|craft fair|makers market|winter market/, ["market", "velvet"]],
    // potlucks and harvest suppers: the Pantry first (jars, a hex floor, the harvest menu)
    [/potluck|friendsgiving|thanksgiving|harvest|soup|stew|preserves?|pickl|canning|\bjam\b|cocoa|cider|fondue|pantry/, ["pantry"]],
    [/holiday|christmas|xmas|winter|snow|hanukkah|new year|benefit|gala|fundrais/, ["winter", "velvet", "pantry"]], [/sale|market|pop-?up|ceramic|pottery|clay/, ["velvet", "jazz", "garden"]],
    [/dinner|supper|wine|cocktail|izakaya|sake|bar\b|omakase|tasting|date night/, ["velvet", "night", "garden", "pantry"]], [/workshop|class|craft|paint|draw|sew|knit|zine|print|stitch/, ["jazz", "garden"]],
    [/flower|floral|bouquet|garden|picnic|plant|tea\b|matcha|brunch/, ["flower", "garden"]], [/jazz|music|band|gig|show|open mic|poetry|record|vinyl|film|movie/, ["jazz", "night"]],
    [/party|birthday|dance|club|karaoke|night out|drinks/, ["night", "garden"]], [/run|hike|walk|bike|swim|yoga/, ["garden", "winter"]]];
  // what goes with each vibe: a second palette or two in the same family, and effects, fonts and button emoji that suit it.
  // Surprise me rolls one of each, so the result is random but never a clash (a snowflake on a garden party, say).
  const MOODS = {
    garden: { pal: [["#E3E6D6", "#344A2E", "#9A4128"], ["#E9E4D6", "#3E5A3A", "#7A5C2E"]], fx: ["none", "petals"], font: ["serif", "clean"], em: ["🌿", "🌷", "🌸", "🙌"] },
    jazz: { pal: [["#EFE9DF", "#33291F", "#9C7232"], ["#E6E8E6", "#26312F", "#9A6E36"]], fx: ["none", "paper", "stars"], font: ["serif", "typewriter", "bold"], em: ["🎷", "🎶", "🍷", "🥂"] },
    winter: { pal: [["#E6EAEE", "#2B3E52", "#8E3B24"], ["#ECEBE6", "#2F3F4F", "#5F6B57"]], fx: ["snow", "none"], font: ["clean", "serif"], em: ["❄️", "⛄", "🎁", "🕯️"] },
    velvet: { pal: [["#F2E7E4", "#5A1F27", "#A9844C"], ["#EEE6EA", "#4A2A3A", "#A07A50"]], fx: ["none", "twinkle"], font: ["serif", "script"], em: ["🏺", "🍷", "✨", "🕯️"] },
    flower: { pal: [["#F3E8E6", "#3A2A30", "#8C5A55"], ["#EEEAE2", "#2F4034", "#A86A5E"]], fx: ["petals", "none"], font: ["script", "serif"], em: ["💐", "🌷", "🌸", "🌿"] },
    night: { pal: [["#E8EAEF", "#252C40", "#B0702A"], ["#E4EAE8", "#1F3532", "#A07A2E"]], fx: ["lanterns", "stars", "none"], font: ["clean", "bold", "typewriter"], em: ["🏮", "🍜", "🍸", "🔥"] },
    market: { pal: [["#E6EBE1", "#26392E", "#A5823A"], ["#F1E6E2", "#572228", "#A9844C"]], fx: ["twinkle", "snow", "none"], font: ["serif", "bold"], em: ["🎄", "🎁", "🍵", "✨"] },
    terminal: { pal: [["#E8ECEA", "#22423A", "#8A6A22"], ["#E8E9EE", "#29304A", "#4E7A5A"]], fx: ["scanlines", "none"], font: ["mono", "typewriter"], em: ["💻", "👾", "🕹️", "✨"] },
    pixel: { pal: [["#EAEEE2", "#26324A", "#B4495B"], ["#F1E9DC", "#2E2442", "#3D6A4C"]], fx: ["pixels", "none"], font: ["pixel", "mono"], em: ["👾", "🎮", "🕹️", "🎲"] },
    cards: { pal: [["#F3EEE8", "#33283F", "#9A4128"], ["#EDF0EB", "#22433A", "#9C6F2A"]], fx: ["none", "paper"], font: ["serif", "clean", "bold"], em: ["✨", "🎉", "❤️", "🙌"] },
    // the jar wall stays (it is the look); a serif title for a change
    pantry: { pal: [["#DDC29A", "#7A3E14", "#3E5A3A"], ["#CDA06A", "#5A2A0E", "#EBDCC0"]], fx: ["jarwall"], font: ["slab", "serif"], em: ["🍂", "🫙", "☕", "🕯️"] },
  };
  // ---------- review round 12: taste defaults by the event's kind ----------
  // The vibes in the order that suits the event (Terminal first for a hack night, Card deck or Pixel for games, Night out
  // or Pantry for food), and Surprise me's pool. What the host named the event is read before the rest of their words,
  // so "supper club for ops folks" is food, and a board game table never rolls Terminal.
  const KIND_VIBES = [[/\b(hack ?nights?|hackathon|build night|demo night|code night|dev night|coding|terminal|devs?|engineers?|engineering|sre|linux|open source)\b/, ["terminal", "pixel"]],
    [/\b(lan( party)?|video ?games?|gaming|gamers?|speedrun|gdq|arcade|retro|esports|watch ?party)\b/, ["pixel", "terminal"]],
    [/\b(board ?games?|games? night|tabletop|d&d|dnd|ttrpg|mahjong|card games?|trivia)\b/, ["cards", "pixel"]],
    [/\b(potluck|friendsgiving|thanksgiving|soup|harvest|pantry|preserves?)\b/, ["pantry"]], // cozy food: always the Pantry
    [/\b(supper|dinner|potluck|omakase|tasting|izakaya|feast|cooking|brunch|pantry|harvest)\b/, ["night", "pantry", "velvet"]],
    [/\b(book club|paper club|reading group)\b/, ["jazz", "cards"]]];
  function kindVibes(e) { const main = `${e?.activity || ""} ${e?.pubTitle || ""} ${e?.name || ""}`.toLowerCase(), rest = `${e?.concept || ""}`.toLowerCase();
    const hit = KIND_VIBES.find(([re]) => re.test(main)) || KIND_VIBES.find(([re]) => re.test(rest)); return hit ? hit[1].filter((k) => VIBES[k]) : null; }
  function vibeOrder(e) { const first = kindVibes(e) || []; return [...first, ...Object.keys(VIBES).filter((k) => !first.includes(k))]; }
  const FX_FOR = Object.fromEntries(Object.entries(MOODS).map(([k, m]) => [k, m.fx]));
  const pickOf = (L) => L[(Math.random() * L.length) | 0];
  function surprise(e, { keepPalette = null, avoid = "" } = {}) { const txt = `${e?.activity || ""} ${e?.name || ""} ${e?.pubTitle || ""} ${e?.concept || ""} ${e?.kind || ""}`.toLowerCase();
    const opts = kindVibes(e) || (KINDS.find(([re]) => re.test(txt)) || [null, Object.keys(VIBES)])[1], pool = opts.length > 1 ? opts.filter((v) => v !== avoid) : opts, v = pickOf(pool), base = VIBES[v].look, M = MOODS[v];
    // the vibe's own palette most of the time, else one of its cousins; then an effect, a title font and an emoji from what suits it
    const L = { ...base, vibe: v, palette: Math.random() < 0.55 ? base.palette : pickOf(M.pal), effect: Math.random() < 0.5 ? base.effect : pickOf(M.fx), titleFont: Math.random() < 0.5 ? base.titleFont : pickOf(M.font) }; delete L.buttonEmoji; /* the button stays plain: a host can still pick an emoji */
    if (!base.coverStyle) delete L.coverStyle;
    // with a flyer: its own colours, or now and then a page that contrasts with it (a dark flyer can get a dark page)
    if (keepPalette && keepPalette.length) { L.palette = Math.random() < 0.4 && C ? [C.contrastPage(keepPalette[0]), ...keepPalette.slice(1, 3)] : keepPalette.slice(0, 3); delete L.vibe; }
    if (e?.approvalRequired) L.buttonLabel = "Ask to join"; return L; }

  window.EncoreLooks = { TITLE_FACES, sturdyOf, titleFace, fieldNotes, LEGACY, paletteOf, kindVibes, vibeOrder, priceLine, jarwall, needPantry, countFor, lights, lanterns, decorate, STICKERS, stickerSVG, stickersHTML, cleanStickers, MAX_STICKERS, DECK, cornerWord, MOODS, updateHTML, EFFECTS, FONTS, SWATCHES, LABELS, EMOJI, VIBES, has, fitOf, colors, buttonText, coverHTML, apply, effect, loadFont, fromFile, readImage, surprise, lookOf, safeSrc, css };
})();
