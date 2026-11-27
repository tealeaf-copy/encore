// A host's brand kit: one font pairing, one palette, corners, buttons, a cover treatment, an optional logo and a voice line.
// Everything a host shows (their page, /g and /e, the menu card, shop and experience cards, story cards, /x pages) reads the
// same --kit-* variables, set once per page on <html> and mapped into the design tokens in public/brandkit.css.
// The rules: a page never mixes more than two families. Display and title use the display face; body, meta, chips, list
// items and prices use the body face (prices with tabular figures). The page stays light, so every block reads; dark moods
// belong to an event's look.
// Runs in the browser and in Node (server/brandkit.js loads this file with public/color.js in a vm), so the starter kits,
// the pairings and the contrast rules live in one place. The editor sheet is public/brandkit-editor.js, loaded on demand.
(function (root) {
  const CC = () => root.EncoreColor;
  // ---- the pairings: a display face and a body face that work together ----
  // dw: display weight, dls: display letter spacing, dk: display size factor (wide or small faces are scaled to sit right)
  const PAIRS = {
    house: { title: "serif", label: "Pottery Lab", note: "A sturdy serif for titles, Plex Sans for the rest", display: "IBM Plex Serif", body: "IBM Plex Sans", dfb: "Georgia, serif", bfb: "system-ui, -apple-system, sans-serif", dw: 600, dls: "-.01em", dk: 1, q: "IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500;600" },
    supper: { title: "serif", label: "Supper club", note: "A classic serif", display: "Playfair Display", body: "Lato", dfb: "Georgia, serif", bfb: "system-ui, sans-serif", dw: 600, dls: "-.005em", dk: 1, q: "Playfair+Display:wght@600;700&family=Lato:wght@400;700" },
    florist: { title: "serif", label: "Flower shop", note: "Soft and elegant", display: "Cormorant Garamond", body: "Lato", dfb: "Georgia, serif", bfb: "system-ui, sans-serif", thin: true, dw: 600, dls: "0", dk: 1.1, q: "Cormorant+Garamond:wght@600;700&family=Lato:wght@400;700" },
    pantry: { title: "serif", label: "Pantry", note: "A warm slab", display: "Zilla Slab", body: "Work Sans", dfb: 'Rockwell, "Roboto Slab", Georgia, serif', bfb: "system-ui, sans-serif", dw: 700, dls: "-.005em", dk: 1.04, q: "Zilla+Slab:wght@600;700&family=Work+Sans:wght@400;500;600" },
    studio: { title: "sans", label: "Studio", note: "Clean and modern", display: "Space Grotesk", body: "Inter", dfb: "system-ui, sans-serif", bfb: "system-ui, sans-serif", dw: 700, dls: "-.02em", dk: 1, q: "Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600" },
    market: { title: "sans", label: "Market day", note: "Loud and bold", display: "Archivo Black", body: "Archivo", dfb: '"Arial Black", system-ui, sans-serif', bfb: "system-ui, sans-serif", dw: 400, dls: "-.01em", dk: 0.92, q: "Archivo+Black&family=Archivo:wght@400;500;600" },
    terminal: { title: "sans", label: "Terminal", note: "Mono headings, plain text", display: "IBM Plex Mono", body: "IBM Plex Sans", dfb: "ui-monospace, Menlo, monospace", bfb: "system-ui, sans-serif", dw: 600, dls: "-.02em", dk: 0.92, q: "IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600" },
    arcade: { title: "sans", label: "Arcade", note: "8-bit headings", display: "Silkscreen", body: "Inter", dfb: "ui-monospace, monospace", bfb: "system-ui, sans-serif", dw: 400, dls: "0", dk: 0.78, q: "Silkscreen:wght@400;700&family=Inter:wght@400;500;600" },
  };
  // ---- reading guardrails, whatever the kit (docs/brand-kit.md "Host brand kits") ----
  // body text never under 16px; the display face only for titles of 20px and up (24px for a thin or condensed face, the
  // "thin" pairs); smaller headings, meta, buttons and body are the body face, which is always a sturdy text face: never
  // a script, a hairline or a display-only face
  const GUARD = { bodyMin: 16, displayMin: 20, thinDisplayMin: 24, bodyNever: /\b(script|hand|brush|cursive|hairline|thin|display|black|silkscreen|pixel|mono)\b/i };
  // ---- the guest invite is Field Notes whatever the kit (docs/brand-kit.md): a kit brings its accent and cover there, and
  // its title face only through the sturdy set (IBM Plex Serif 600 or IBM Plex Sans 600; a thin, high-contrast, display or
  // pixel face reads as the nearest of the two). The page stays linen, the text ink, the corners 6px, and the date, body
  // and buttons IBM Plex Sans. Read at draw time, so saved kits keep their data. ----
  const INVITE_FACES = { serif: '"IBM Plex Serif", Georgia, serif', sans: '"IBM Plex Sans", system-ui, -apple-system, sans-serif' };
  const INVITE_Q = "IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500;600";
  /** The sturdy face ("serif" or "sans") a kit's titles take on an invite. */
  const inviteFace = (k) => (PAIRS[k?.pair]?.title === "sans" ? "sans" : "serif");
  /** Whether this page is a guest invite: the light invite (/e, /i) or the full invite (/g). */
  const onInvite = () => typeof location !== "undefined" && /^\/(?:[ei]\/[A-Za-z0-9_-]{2,80}\/?$|g$)/.test(location.pathname || "");
  const bodyOk = (P) => !!P && !GUARD.bodyNever.test(P.body);
  // ---- starter kits, named by vibe ----
  const STARTERS = {
    house: { label: "Pottery Lab", vibe: "Field notes: linen, ink and blue", pair: "house", page: "#EFEBE2", surface: "#FAF8F3", ink: "#1B1D1C", accent: "#29489A", accent2: "#F3E7A8", corners: "crisp", buttons: "pill", cover: "lineart" },
    supper: { label: "Supper club", vibe: "Candlelit and calm", pair: "supper", page: "#FBF6EF", surface: "#FFFFFF", ink: "#2B211C", accent: "#8E2F2B", accent2: "#E0A030", corners: "crisp", buttons: "pill", cover: "photo" },
    florist: { label: "Flower shop", vibe: "Soft petals", pair: "florist", page: "#F4E9EC", surface: "#FFFFFF", ink: "#17251D", accent: "#1F3D30", accent2: "#E98973", corners: "soft", buttons: "pill", cover: "lineart" },
    pantry: { label: "Pantry", vibe: "Cozy and homemade", pair: "pantry", page: "#F6EBD9", surface: "#FFFBF2", ink: "#2B1D12", accent: "#8A4B0F", accent2: "#2F5D3A", corners: "soft", buttons: "pill", cover: "lineart" },
    studio: { label: "Studio", vibe: "Clean and modern", pair: "studio", page: "#F6F7F9", surface: "#FFFFFF", ink: "#14171C", accent: "#2F5FD0", accent2: "#F2B84B", corners: "crisp", buttons: "pill", cover: "photo" },
    market: { label: "Market day", vibe: "Sunny and loud", pair: "market", page: "#FFF6E0", surface: "#FFFFFF", ink: "#1F1A17", accent: "#D9480F", accent2: "#2F7A8A", corners: "crisp", buttons: "pill", cover: "deck" },
    terminal: { label: "Terminal", vibe: "Quiet and nerdy", pair: "terminal", page: "#F3F6F1", surface: "#FFFFFF", ink: "#0E1411", accent: "#1F7A3E", accent2: "#F2B84B", corners: "crisp", buttons: "outline", cover: "lineart" },
    arcade: { label: "Arcade", vibe: "8-bit and playful", pair: "arcade", page: "#F4EED8", surface: "#FFFDF5", ink: "#3A2E5C", accent: "#C8384F", accent2: "#3A2E5C", corners: "crisp", buttons: "pill", cover: "deck" },
  };
  const ENUMS = { corners: ["soft", "crisp"], buttons: ["pill", "outline"], cover: ["photo", "lineart", "deck"] };
  const HOUSE = STARTERS.house;
  // ---- the host page's older theme, read as a kit, so nothing jumps (server/community.js STORE, public/storefront.js) ----
  // the "classic" font has always drawn as the house display face (playful.css pl-house-font); "handmade" joins the house pair
  const FROM_FONT = { classic: "house", playful: "house", handmade: "house", editorial: "supper", florist: "florist", modern: "studio", bold: "market" };
  const BGS = { cream: ["#FBF6EF", "#FFFFFF", "#2B211C"], white: ["#FFFFFF", "#FAF8F5", "#1F1A17"], blush: ["#FFF1F3", "#FFFFFF", "#2B1D21"], sage: ["#F1F6F1", "#FFFFFF", "#1E2A22"], petal: ["#F4E9EC", "#FFFFFF", "#17251D"] };
  const THEME_DEFAULT = { accent: "#E26D8E", font: "classic", bg: "cream", buttons: "round" };
  /** The kit a host's current page theme already draws: the same faces, colours and corners. */
  function fromTheme(t) { t = { ...THEME_DEFAULT, ...(t || {}) }; const b = BGS[t.bg] || BGS.cream; const C = CC();
    // the untouched default page is the house brand
    if (t.font === "classic" && t.bg === "cream" && t.accent === THEME_DEFAULT.accent && (t.buttons || "round") === "round") return { ...pick(HOUSE), starter: "house", from: "theme" };
    return { pair: FROM_FONT[t.font] || "house", page: b[0], surface: b[1], ink: b[2], accent: norm(t.accent) || "#C94A30", accent2: C ? C.mix(norm(t.accent) || "#C94A30", b[0], 0.55) : "", corners: t.buttons === "round" ? "soft" : "crisp", buttons: "pill", cover: t.coverUrl ? "photo" : "lineart", logo: "", voice: "", starter: "", from: "theme" }; }
  const pick = (s) => ({ pair: s.pair, page: s.page, surface: s.surface, ink: s.ink, accent: s.accent, accent2: s.accent2 || "", corners: s.corners, buttons: s.buttons, cover: s.cover, logo: "", voice: "" });
  const norm = (h) => (CC() ? CC().norm(h) : /^#[0-9a-f]{6}$/i.test(h || "") ? String(h).toUpperCase() : "");
  /** A starter kit as a full kit. */
  const starter = (k) => (STARTERS[k] ? { ...pick(STARTERS[k]), starter: k } : null);
  // a page that never picked a theme wears its latest event's look (public/storefront.js withEventLook), so its kit does too
  const EVENT_THEMES = { night: { accent: "#26346F", font: "bold", bg: "cream", cover: "noren", buttons: "soft" }, flower: { accent: "#1F3D30", font: "florist", bg: "petal", cover: "awning", buttons: "round" }, terminal: { accent: "#3E9C6E", font: "modern", bg: "white", cover: "dots", buttons: "soft" }, pixel: { accent: "#8C62C9", font: "modern", bg: "white", cover: "dots", buttons: "square" }, cards: { accent: "#E26D8E", font: "playful", bg: "blush", cover: "confetti", buttons: "round" }, garden: { accent: "#3E9C6E", font: "classic", bg: "sage", cover: "wash", buttons: "round" }, jazz: { accent: "#C2553A", font: "editorial", bg: "cream", cover: "dusk", buttons: "soft" }, winter: { accent: "#5B7FD6", font: "modern", bg: "white", cover: "waves", buttons: "round" }, velvet: { accent: "#C2553A", font: "classic", bg: "cream", cover: "dusk", buttons: "soft" }, market: { accent: "#C2553A", font: "bold", bg: "cream", cover: "dusk", buttons: "soft" } };
  const THEME_DEF = { accent: "#E26D8E", font: "classic", bg: "cream", cover: "wash", layout: "classic" };
  function themeOf(h, events) { const T = h?.theme || {}; if (["accent", "font", "bg", "cover", "layout"].some((k) => T[k] && T[k] !== THEME_DEF[k])) return T;
    const e = (events || []).find((x) => x?.look?.vibe && EVENT_THEMES[x.look.vibe]); return e ? { ...T, ...EVENT_THEMES[e.look.vibe] } : T; }
  /** The kit to draw for a host: the one they saved, else the one their page already draws (its theme, or its latest event's look). */
  function kitOf(h, events) { if (!h) return null; return upgrade(h.brandKit && PAIRS[h.brandKit.pair] ? h.brandKit : h.kit && PAIRS[h.kit.pair] ? h.kit : fromTheme(themeOf(h, events))); }
  // a kit saved with the 2025 house colours (cream, ember, warm ink) wears the 2026 house colours, so it moves with the brand
  // ... and one saved with the Bone and clay house colours (Nov 2026) wears Field Notes
  const OLD_HOUSES = [{ page: "#F7F1E8", surface: "#FFFCF7", ink: "#1F1A17", accent: "#C94A30", accent2: "#F2D48F" }, { page: "#F4F0E8", surface: "#FBF9F5", ink: "#1D1B18", accent: "#9A4128", accent2: "#E3D7BE", corners: "soft" }];
  function upgrade(k) { const OLD = k && k.pair === "house" && OLD_HOUSES.find((h) => norm(k.page) === h.page && norm(k.accent) === h.accent); if (!OLD) return k; const o = { ...k }; for (const f of ["page", "surface", "ink", "accent", "accent2", "corners"]) if (OLD[f] && (!o[f] || (norm(o[f]) || o[f]) === OLD[f])) o[f] = HOUSE[f]; return o; }
  const isHouse = (k) => !k || (k.pair === "house" && norm(k.page) === HOUSE.page && norm(k.accent) === HOUSE.accent && norm(k.ink) === HOUSE.ink && (k.corners || "crisp") === HOUSE.corners && (k.buttons || "pill") === "pill" && (k.cover || "lineart") !== "deck" && !k.logo);

  // ---- colours that pass AA ----
  // the page and its cards stay light; ink reads at 4.5:1 on both; quiet text too; the button stands out from the page
  // (3:1) and carries readable text (4.5:1); accent text on the page reads at 4.5:1
  function lightOf(c, fb) { const C = CC(); c = norm(c) || fb; if (!C) return c; let i = 0; while (C.lum(c) < 0.62 && i++ < 12) c = C.mix(c, "#FFFFFF", 0.25); return c; }
  function textOn(c, bgs, ink) { const C = CC(); if (!C) return c; c = norm(c) || ink; for (let i = 0; i <= 12; i++) { const x = C.mix(c, ink, i * 0.08); if (C.worst(x, bgs) >= 4.5) return x; } return ink; }
  function derive(k) { k = k && PAIRS[k.pair] ? k : { ...pick(HOUSE), starter: "house" }; const C = CC();
    const page = lightOf(k.page, HOUSE.page), surface = lightOf(k.surface || (C ? C.mix(page, "#FFFFFF", 0.6) : "#FFFFFF"), "#FFFFFF"), bgs = [page, surface];
    if (!C) return { page, surface, ink: norm(k.ink) || "#1B1D1C", soft: "#444845", line: "#CFC8B9", lineStrong: "#1B1D1C", accent: norm(k.accent) || HOUSE.accent, accentText: "#29489A", accent2: norm(k.accent2) || HOUSE.accent2, btn: norm(k.accent) || HOUSE.accent, onBtn: "#FFFFFF", tint: surface };
    const ink0 = norm(k.ink) || "#1B1D1C", ink = C.worst(ink0, bgs) >= 4.5 ? ink0 : C.inkFor(bgs, ink0), soft = C.softFor(ink, bgs);
    const accent = norm(k.accent) || HOUSE.accent, btn = C.buttonFor(accent, bgs), onBtn = C.onColor(btn), accentText = textOn(accent, bgs, ink);
    const accent2 = norm(k.accent2) || C.mix(accent, page, 0.55);
    return { page, surface, ink, soft, line: C.mix(page, ink, 0.17), lineStrong: C.mix(page, ink, 0.3), accent, accentText, accent2, btn, onBtn, tint: C.mix(surface, accent, 0.08) }; }
  /** The contrast numbers the editor shows: text on the page and cards, the button, and accent text. */
  function checks(k) { const C = CC(), T = derive(k); if (!C) return []; const bgs = [T.page, T.surface];
    return [{ k: "text", label: "Text", ratio: C.worst(T.ink, bgs), need: 4.5 }, { k: "quiet", label: "Quiet text", ratio: C.worst(T.soft, bgs), need: 4.5 }, { k: "button", label: "Button text", ratio: C.contrast(T.btn, T.onBtn), need: 4.5 }, { k: "edge", label: "Button edge", ratio: C.worst(T.btn, bgs), need: 3 }, { k: "accent", label: "Accent text", ratio: C.worst(T.accentText, bgs), need: 4.5 }]
      .map((x) => ({ ...x, ratio: Math.round(x.ratio * 10) / 10, ok: x.ratio >= x.need })); }

  // ---- fonts and variables ----
  const stack = (name, fb) => `"${name}", ${fb}`;
  function fonts(k, invite = onInvite()) { const P = PAIRS[k?.pair] || PAIRS.house;
    if (invite) { const f = inviteFace(k), fam = f === "sans" ? "IBM Plex Sans" : "IBM Plex Serif"; return { display: INVITE_FACES[f], body: INVITE_FACES.sans, dw: 600, dls: f === "sans" ? "-.015em" : "-.01em", dk: 1, href: `https://fonts.googleapis.com/css2?family=${INVITE_Q}&display=swap`, families: [fam, "IBM Plex Sans"] }; }
    return { display: stack(P.display, P.dfb), body: stack(P.body, P.bfb), dw: P.dw, dls: P.dls, dk: P.dk, href: `https://fonts.googleapis.com/css2?family=${P.q}&display=swap`, families: [P.display, P.body] }; }
  /** The --kit-* variables for a kit, as an object. */
  function vars(k, invite = onInvite()) { k = k && PAIRS[k.pair] ? k : { ...pick(HOUSE), starter: "house" }; const T = derive(k), F = fonts(k, invite), soft = k.corners !== "crisp";
    if (invite) { const C = CC(), bgs = [HOUSE.page, HOUSE.surface], btn = C ? C.buttonFor(T.accent, bgs) : T.btn; let at = T.accentText; if (C) for (let i = 0; i < 12 && C.worst(at, bgs) < 4.5; i++) at = C.mix(at, HOUSE.ink, 0.15);
      return { "--kit-display": F.display, "--kit-body": F.body, "--kit-dw": "600", "--kit-dls": F.dls, "--kit-dk": "1", "--kit-display-min": "24px", "--kit-body-min": GUARD.bodyMin + "px",
        "--kit-page": HOUSE.page, "--kit-surface": HOUSE.surface, "--kit-ink": HOUSE.ink, "--kit-soft": "#444845", "--kit-line": "#CFC8B9", "--kit-line-strong": HOUSE.ink,
        "--kit-accent": T.accent, "--kit-accent-text": C && C.worst(at, bgs) >= 4.5 ? at : HOUSE.accent, "--kit-accent2": T.accent2, "--kit-btn": btn, "--kit-on-btn": C ? C.onColor(btn) : T.onBtn, "--kit-tint": C ? C.mix(HOUSE.surface, T.accent, 0.06) : HOUSE.surface,
        "--kit-r-card": "6px", "--kit-r-sheet": "6px", "--kit-r-btn": "6px", "--kit-r-chip": "6px", "--kit-r-field": "6px" }; }
    return { "--kit-display": F.display, "--kit-body": F.body, "--kit-dw": String(F.dw), "--kit-dls": F.dls, "--kit-dk": String(F.dk), "--kit-display-min": (PAIRS[k.pair]?.thin ? GUARD.thinDisplayMin : GUARD.displayMin) + "px", "--kit-body-min": GUARD.bodyMin + "px",
      "--kit-page": T.page, "--kit-surface": T.surface, "--kit-ink": T.ink, "--kit-soft": T.soft, "--kit-line": T.line, "--kit-line-strong": T.lineStrong,
      "--kit-accent": T.accent, "--kit-accent-text": T.accentText, "--kit-accent2": T.accent2, "--kit-btn": T.btn, "--kit-on-btn": T.onBtn, "--kit-tint": T.tint,
      "--kit-r-card": soft ? "16px" : "6px", "--kit-r-sheet": soft ? "24px" : "10px", "--kit-r-btn": soft ? "12px" : "8px", "--kit-r-chip": soft ? "999px" : "6px", "--kit-r-field": soft ? "12px" : "6px" }; }
  const cssText = (k) => Object.entries(vars(k)).map(([n, v]) => `${n}:${String(v).replace(/[;{}<>]/g, "")}`).join(";");
  /** The classes a page wears for a kit (on <html>). */
  const classes = (k, invite = onInvite()) => ["kit-on", "kit-" + (invite || k?.corners === "crisp" ? "crisp" : "soft"), "kit-btn-" + (!invite && k?.buttons === "outline" ? "outline" : "pill"), "kit-pair-" + (PAIRS[k?.pair] ? k.pair : "house"), ...(!invite && PAIRS[k?.pair]?.thin ? ["kit-thin"] : []), ...(invite ? ["kit-invite"] : []), "kit-cover-" + (ENUMS.cover.includes(k?.cover) ? k.cover : "lineart"), ...(isHouse(k) ? ["kit-house"] : [])];

  // ---- event looks inherit the kit ----
  const HEX = /^#[0-9a-f]{6}$/i;
  const hasLook = (L) => !!(L && ((L.palette || []).some((c) => HEX.test(c)) || (L.effect && L.effect !== "none") || L.lights || L.titleFont || L.update?.text || L.coverStyle === "deck" || L.menuStyle === "harvest" || (L.stickers || []).length));
  /** Whether an event's own title font wins over the kit: a look saved before kits (no kit marker) keeps its font, and a
   *  kit-era look only when the host picked a font for this event (ownFont). */
  const ownFont = (L) => !!(L && L.titleFont && (!L.kit || L.ownFont));
  /** The look an event is drawn with: its own look (fonts from the kit unless overridden), or, with no look, one made from the kit. */
  function lookFor(L, k) { L = L && typeof L === "object" ? L : {};
    if (!k) return L;
    if (hasLook(L)) { if (L.titleFont && !ownFont(L)) { const n = { ...L }; delete n.titleFont; return n; } return L; }
    if (isHouse(k)) return L;
    const T = derive(k), n = { ...L, palette: [T.page, T.btn, T.accent2], kit: 1 }; if (k.cover === "deck") n.coverStyle = "deck"; return n; }

  // ---- suggestions for new hosts: from their first event's look or kind ----
  const FROM_VIBE = { terminal: "terminal", pixel: "arcade", pantry: "pantry", flower: "florist", garden: "florist", jazz: "supper", velvet: "supper", night: "supper", winter: "studio", market: "market", cards: "market" };
  const KINDS = [[/\b(hack|hacking|coding|code|build night|builders?|demo night|devs?|engineers?|ship|startup|ai)\b/i, "terminal", "hack nights"], [/\b(game night|games?|arcade|retro|pixel|board games?|d&d|dnd)\b/i, "arcade", "game nights"],
    [/\b(omakase|tasting|wine|supper club|chef'?s table)\b/i, "supper", "tasting dinners"], [/\b(dinner|potluck|friendsgiving|brunch|bake|baking|bakery|cake|pie|cooking|pantry|harvest)\b/i, "pantry", "dinners"],
    [/\b(flowers?|floral|bouquet|ikebana|garden)\b/i, "florist", "flower workshops"], [/\b(market|pop-?up|sale|flea|swap)\b/i, "market", "pop-ups"], [/\b(run|running|hike|yoga|pilates|climb|ride|cycling|workout|design|studio)\b/i, "studio", "active plans"]];
  /** A starter kit for a host who has none yet: { starter, why } from their first event's look, else what it is. */
  function suggest(h, events) { const E = (events || []).filter(Boolean); const v = E.find((e) => e?.look?.vibe && FROM_VIBE[e.look.vibe]);
    if (v) return { starter: FROM_VIBE[v.look.vibe], why: `from the look on ${String(v.pubTitle || v.title || v.name || "your event").slice(0, 60)}` };
    const text = [...E.slice(0, 3).map((e) => [e.activity, e.pubTitle, e.title, e.name, e.dinnerTheme].join(" ")), h?.tagline, h?.bio, ...(h?.tags || [])].filter(Boolean).join(" ");
    for (const [re, k, what] of KINDS) if (re.test(text)) return { starter: k, why: `for ${what}` };
    return { starter: "house", why: "the house look" }; }

  const API = { GUARD, bodyOk, INVITE_FACES, inviteFace, onInvite, PAIRS, STARTERS, ENUMS, HOUSE, FROM_FONT, fromTheme, themeOf, starter, kitOf, isHouse, derive, checks, fonts, vars, cssText, classes, lookFor, ownFont, hasLook, suggest };

  // ================= the browser: set once per page =================
  if (typeof document === "undefined" || typeof window === "undefined") { root.EncoreBrandKit = API; return; }
  const loaded = new Set();
  function loadFonts(k) { const F = fonts(k); if (loaded.has(F.href)) return; loaded.add(F.href); if (document.querySelector(`link[href="${F.href}"]`)) return; const l = document.createElement("link"); l.rel = "stylesheet"; l.href = F.href; document.head.appendChild(l); }
  function css() { if (document.getElementById("bk-css")) return; const l = document.createElement("link"); l.id = "bk-css"; l.rel = "stylesheet"; l.href = "/brandkit.css"; document.head.appendChild(l); }
  /** Dress an element (default <html>) in a kit: the variables and classes, and its two fonts. */
  function paint(k, el = document.documentElement) { if (!k) return; loadFonts(k); for (const [n, v] of Object.entries(vars(k))) el.style.setProperty(n, v);
    el.classList.remove(...[...el.classList].filter((c) => /^kit-/.test(c))); el.classList.add(...classes(k)); if (el === document.documentElement) { css(); el.classList.toggle("kit-saved", !!k.at); } }
  function unpaint(el = document.documentElement) { el.classList.remove(...[...el.classList].filter((c) => /^kit-/.test(c))); for (const n of Object.keys(vars(HOUSE))) el.style.removeProperty(n); }
  // the host's logo above their name on the host page (an uploaded image from the blob store)
  function decor(k) { const row = document.querySelector(".head .name-row"); if (!row) return; let img = document.querySelector(".head .kit-logo");
    if (!/^\/_blob\/[A-Za-z0-9]{20}$/.test(k?.logo || "")) { img?.remove(); return; } if (!img) { img = document.createElement("img"); img.className = "kit-logo"; img.alt = ""; row.before(img); } if (img.getAttribute("src") !== k.logo) img.src = k.logo; }
  // the owner's own page: a suggested kit, accepted in one tap (only until they save one)
  async function ownerBanner() { if (document.querySelector(".bk-sug")) return; let j; try { const pre = window.__bkP; window.__bkP = null; if (pre) j = await pre; if (!j) { const r = await fetch("/api/host/brandkit", { credentials: "same-origin" }); if (!r.ok) return; j = await r.json(); } } catch { return; }
    mineKit = j.kit || null; if (j.saved || !j.suggest || !STARTERS[j.suggest.starter]) return; const S = STARTERS[j.suggest.starter], box = document.createElement("div"); box.className = "bk-sug kit-off"; box.setAttribute("role", "region"); box.setAttribute("aria-label", "Brand kit");
    const e = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    box.innerHTML = `<span><b>Your brand kit:</b> ${e(S.label)}, ${e(j.suggest.why)}. One look for your page, events and invites.</span><span class="bk-sug-a"><button type="button" class="go1">Use ${e(S.label)}</button><button type="button" data-brandkit="${e(j.suggest.starter)}">See all</button></span>`;
    box.querySelector(".go1").onclick = async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const r = await fetch("/api/host/brandkit", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starter: j.suggest.starter, fromStarter: true }) }); const x = await r.json(); if (!r.ok) throw new Error(x.message || "That didn't save."); saved(x.kit); box.innerHTML = `<span><b>${e(S.label)} is your brand kit.</b> Your page, events and invites wear it now.</span><span class="bk-sug-a"><button type="button" data-brandkit>Change it</button></span>`; } catch (err) { b.disabled = false; box.querySelector("span").textContent = err.message; } };
    (document.querySelector("main") || document.body).prepend(box); }
  /** After a save: the page wears the new kit right away. */
  let savedKit = null;
  function saved(k) { if (!k) return; mineKit = k; savedKit = k; if (!document.body.classList.contains("store")) return; const h = window.__encoreStoreHost;
    if (h && window.EncoreStore?.apply) { try { const keep = [...document.querySelectorAll("#storeLinks > :not(a[target])")]; window.EncoreStore.apply({ ...h, brandKit: k, tagline: k.voice || h.tagline }); const ln = document.getElementById("storeLinks"); keep.forEach((x) => ln?.appendChild(x)); return; } catch {} } use(k); } /* the host page redraws in the new kit (cover, portrait, fonts, colours) */
  let current = null, mineKit = null, last = null;
  /** The page's kit (the host whose page, event or invite this is). Re-dresses the last event look drawn with it. */
  function use(k) { if (!k || !PAIRS[k.pair]) return; current = k;
    // in the app (index.html), only the guest view wears a host's kit: it's painted when the event is drawn (eventFor)
    const g = document.getElementById("view-guest"); if (!g || (!g.hidden && g.offsetParent !== null) || (last && Object.keys(last[1] || {}).length)) { paint(k); decor(k); } if (last && window.EncoreLooks) { const [el, e, o] = last; try { window.EncoreLooks.apply(el, e, o); } catch {} } }
  // looks.js asks this before it draws an event: the event with the look it should wear (page: <body>, or a preview frame)
  function eventFor(e, el, o) { if (!e || typeof e !== "object") return e; const page = el === document.body;
    if (page) { last = [el, e, o]; if (!Object.keys(e).length) { if (current) unpaint(); return e; } if (current) { paint(current); decor(current); } } /* {} is the app leaving the guest view */
    const k = page ? current : mineKit || current; if (!k) return e;
    const L0 = e.look && typeof e.look === "object" ? e.look : {}, L = lookFor(L0, k); if (page) document.documentElement.classList.toggle("kit-look", !hasLook(L0) && L !== L0); /* drawn covers take the kit's colours */ return L === L0 ? e : { ...e, look: L }; }
  // ... and after: a title with no font of its own takes the kit's display face; an event's own font leads the page's headings
  function after(el, e) { const k = el === document.body ? current : mineKit || current; if (!k || !el?.classList) return; const L = e?.look || {};
    if (el.classList.contains("lk-on") && !ownFont(L)) { const F = fonts(k); if (el !== document.body) loadFonts(k); el.style.setProperty("--lk-title", el === document.body ? "var(--kit-display)" : F.display); /* a preview frame in the app: the face itself, the app isn't dressed in the kit */ el.style.setProperty("--lk-tw", String(F.dw)); el.style.setProperty("--lk-tls", F.dls); el.style.setProperty("--lk-tk", String(F.dk)); el.classList.remove("lk-up"); }
    if (el === document.body) { const R = document.documentElement, LK = window.EncoreLooks, F = ownFont(L) && LK?.FONTS?.[L.titleFont] && (onInvite() && LK.titleFace ? LK.titleFace(L.titleFont) : LK.FONTS[L.titleFont]); if (F) R.style.setProperty("--kit-display", F.css); else if (current) R.style.setProperty("--kit-display", fonts(current).display); } }
  /** The storefront's own variables, pointed at the kit (public/storefront.js apply). */
  const storeTokens = () => ({ "--accent": "var(--kit-accent)", "--bg": "var(--kit-page)", "--card": "var(--kit-surface)", "--ink": "var(--kit-ink)", "--soft": "var(--kit-soft)", "--line": "var(--kit-line)", "--brand": "var(--kit-btn)", "--brand2": "var(--kit-accent-text)", "--on-brand": "var(--kit-on-btn)", "--c": "var(--kit-accent)", "--pink": "var(--kit-tint)", "--radius": "var(--kit-r-btn)", "--head": "var(--kit-display)", "--body": "var(--kit-body)" });
  /** For /x pages and anything else that knows its host: dress the page. */
  function host(h) { const k = kitOf(h); if (k) use(k); return k; }
  /** For story cards (public/feedvisual.js): the kit's display face and accent, as a style string; the card's own colours stay. */
  // Shared surfaces (feed, Discover, stories, the swipe deck, search, lists, the chats inbox) are the platform's frame:
  // a host brings only the cover, the title, their face and a subtle accent (a thin line or a dot). Never the font.
  function storyStyle(h) { const k = h && (h.kit || h.brandKit) ? kitOf(h) : null; if (!k) return ""; const T = derive(k); return `--kit-accent:${T.accent};--kit-accent-text:${T.accentText}`; }
  // the signed-in host's own kit, for previews in the app (Make it yours)
  function mine() { if (mineKit || mine.p) return mine.p || Promise.resolve(mineKit); if (!/(?:^|;\s*)encore_in=1/.test(document.cookie)) return Promise.resolve(null);
    return (mine.p = fetch("/api/host/brandkit", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { mineKit = j?.kit || null; return mineKit; }).catch(() => null)); }
  // the editor: any [data-brandkit] button opens it (the host page's owner view, Settings in the app)
  function open(opts = {}) { return new Promise((res) => { const go = () => res(window.EncoreBrandKitEditor?.open(opts)); if (window.EncoreBrandKitEditor) return go(); const s = document.createElement("script"); s.src = "/brandkit-editor.js"; s.onload = go; s.onerror = () => res(null); document.head.appendChild(s); }); }
  document.addEventListener("click", (ev) => { const b = ev.target.closest?.("[data-brandkit]"); if (!b) return; ev.preventDefault(); open({ opener: b, starter: b.dataset.brandkit || "" }); });
  try { if (/[?&]brandkit=1\b/.test(location.search)) setTimeout(() => open({}), 600); } catch {}
  Object.assign(API, { paint, unpaint, use, ownerBanner, saved, eventFor, after, storeTokens, host, storyStyle, mine, open, loadFonts }); Object.defineProperty(API, "current", { get: () => current, enumerable: true }); Object.defineProperty(API, "savedKit", { get: () => savedKit, enumerable: true });
  root.EncoreBrandKit = API;
  // a page served with its host's kit (the light invite, /x pages): <script>window.__encoreKit=...</script>
  if (window.__encoreKit) use(window.__encoreKit);
  // platform sheets (editors, share, save, the drop setup) stay in the house kit on a host's branded page: mark each as it opens (public/brandkit.css .kit-off)
  if (typeof document !== "undefined" && typeof MutationObserver === "function") { const mark = (n) => { if (n.nodeType !== 1) return; if (n.matches?.('[aria-modal="true"]')) n.classList.add("kit-off"); n.querySelectorAll?.('[aria-modal="true"]').forEach((d) => d.classList.add("kit-off")); };
    const go = () => new MutationObserver((L) => { if (!document.documentElement.classList.contains("kit-on")) return; for (const m of L) { m.addedNodes.forEach(mark); if (m.type === "attributes") mark(m.target); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
    if (document.body) go(); else addEventListener("DOMContentLoaded", go); }
})(typeof window !== "undefined" ? window : globalThis);
