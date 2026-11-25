// Per-event looks: a flyer shown whole, page colours from it, an ambient effect, a title font and a reply button
// with some personality. The light invite (/e/:id), the full invite (/g) and the host's "Make it yours" preview all
// draw with this file, so what the host sees is what guests get. Values match server/looks.js.
(function () {
  const C = window.EncoreColor;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const EFFECTS = [["none", "None"], ["sparkles", "Sparkles"], ["snow", "Snow"], ["confetti", "Confetti"], ["petals", "Petals"], ["paper", "Paper"], ["velvet", "Velvet"], ["stars", "Stars"], ["twinkle", "Twinkle"]];
  // title fonts: the title only; the rest of the page stays in the house sans
  const FONTS = {
    clean: { label: "Clean", css: '"Inter", "Instrument Sans", system-ui, sans-serif', q: "Inter:wght@700;800", w: 800, ls: "-.035em", k: 1 },
    bold: { label: "Bold", css: '"Archivo Black", "Arial Black", system-ui, sans-serif', q: "Archivo+Black", w: 400, ls: "-.01em", k: 1, up: true },
    serif: { label: "Serif", css: '"DM Serif Display", Georgia, serif', q: "DM+Serif+Display", w: 400, ls: "-.01em", k: 1.08 },
    script: { label: "Script", css: '"Dancing Script", "Brush Script MT", cursive', q: "Dancing+Script:wght@700", w: 700, ls: "0", k: 1.18 },
    typewriter: { label: "Typewriter", css: '"Courier Prime", "Courier New", monospace', q: "Courier+Prime:wght@700", w: 700, ls: "-.02em", k: 0.96 },
    rounded: { label: "Rounded", css: '"Baloo 2", Fredoka, system-ui, sans-serif', q: "Baloo+2:wght@800", w: 800, ls: "-.02em", k: 1.04 },
  };
  // eight colours to pick from when there's no flyer (each with two accents that suit it)
  const SWATCHES = [["#A9C3A4", "#3E6B48", "#F2D36B", "Sage"], ["#EFE2C6", "#1F1A17", "#C2553A", "Cream"], ["#C4DDF3", "#1E4E86", "#D94357", "Ice"], ["#6E0F1F", "#F2C46D", "#F4D7C8", "Velvet"],
    ["#F6C9D2", "#B0344F", "#4F7A52", "Blush"], ["#FFE08A", "#C94A30", "#2F7A8A", "Butter"], ["#D3C6F4", "#5A3DA8", "#E26D8E", "Lilac"], ["#4A2E1E", "#D8322E", "#F2C46D", "Night"]];
  const LABELS = ["I'm in", "Join", "RSVP", "Count me in", "Save my spot", "Ask to join"];
  const EMOJI = ["👍", "🙌", "🎉", "✨", "🌿", "🌸", "💐", "🌷", "🍷", "🥂", "🍸", "🍜", "🎷", "🎶", "🎄", "❄️", "⛄", "🎁", "🏺", "🍵", "🕯️", "🔥", "🏮", "❤️"];
  // one-tap vibes. Flower shop is the host page's Flower shop look (storefront.js LOOKS.florist: petal page, deep green)
  const VIBES = {
    garden: { label: "Garden party", look: { palette: ["#A9C3A4", "#3E6B48", "#F2D36B"], effect: "sparkles", titleFont: "rounded", buttonEmoji: "🌿", buttonLabel: "Count me in" } },
    jazz: { label: "Jazz night", look: { palette: ["#EFE2C6", "#1F1A17", "#C2553A"], effect: "paper", titleFont: "bold", buttonEmoji: "🎷", buttonLabel: "I'm in" } },
    winter: { label: "Winter benefit", look: { palette: ["#C4DDF3", "#1E4E86", "#D94357"], effect: "snow", titleFont: "clean", buttonEmoji: "❄️", buttonLabel: "Save my spot" } },
    velvet: { label: "Velvet sale", look: { palette: ["#6E0F1F", "#F2C46D", "#F4D7C8"], effect: "velvet", titleFont: "serif", buttonEmoji: "🏺", buttonLabel: "Save my spot" } },
    flower: { label: "Flower shop", look: { palette: ["#F4E9EC", "#1F3D30", "#E98973"], effect: "petals", titleFont: "script", buttonEmoji: "💐", buttonLabel: "Count me in" } },
    night: { label: "Night out", look: { palette: ["#4A2E1E", "#D8322E", "#F2C46D"], effect: "velvet", titleFont: "bold", buttonEmoji: "🏮", buttonLabel: "I'm in" } },
    market: { label: "Holiday market", look: { palette: ["#5A0F1E", "#E8C26A", "#F6EBD9"], effect: "twinkle", lights: true, titleFont: "bold", buttonEmoji: "🎄", buttonLabel: "Count me in" } },
  };
  const okHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
  const lookOf = (e) => (e && e.look && typeof e.look === "object" ? e.look : {});
  const has = (L) => !!(L && ((L.palette || []).some(okHex) || (L.effect && L.effect !== "none") || L.lights || FONTS[L.titleFont] || L.update?.text));
  // a portrait flyer shows whole unless the host picked the banner
  const fitOf = (L) => (L?.coverFit === "poster" || L?.coverFit === "banner" ? L.coverFit : +L?.coverH > +L?.coverW && +L?.coverW > 0 ? "poster" : "banner");
  const fonts = new Set(); const loadFont = (k) => { const F = FONTS[k]; if (!F || fonts.has(k) || typeof document === "undefined") return; fonts.add(k); const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${F.q}&display=swap`; document.head.appendChild(l); };
  // colours for a look: the page gradient, readable ink and soft text, and a button that passes contrast
  function colors(L) { const p = (L.palette || []).filter(okHex); if (!p.length || !C) return null; return C.pageFrom(p[0], p.slice(1)); }
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
  const CSS = `.lk-on{--lk-title:inherit}.lk-on.lk-page{background:linear-gradient(180deg,var(--lk-top) 0,var(--lk-bot) 100%) var(--lk-bot)!important;color:var(--lk-ink)}
html.lk-root{background:linear-gradient(180deg,var(--lk-top) 0,var(--lk-bot) 100vh,var(--lk-bot) 100%) var(--lk-bot)!important}html.lk-root body.lk-page.lk-page{background:transparent!important;background-color:transparent!important}
.lk-on .lk-title{font-family:var(--lk-title)!important;font-weight:var(--lk-tw,700)!important;letter-spacing:var(--lk-tls,-.01em)!important;color:var(--lk-ink)!important;text-wrap:balance}
.lk-on.lk-up .lk-title{text-transform:uppercase;line-height:.98!important}
.lk-vibe-night .lk-title{color:#FFFDF8!important;text-shadow:0 0 1px #fff,0 0 14px color-mix(in srgb,var(--lk-glow,#D8322E) 85%,transparent),0 0 34px color-mix(in srgb,var(--lk-glow,#D8322E) 55%,transparent)}
.lk-fxl{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}.lk-fxl.fixed{position:fixed;z-index:-1}.lk-fxl canvas{position:absolute;inset:0;width:100%;height:100%}
.lk-paper{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .27 0 0 0 0 .18 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E"),radial-gradient(120% 80% at 50% 0,transparent 55%,rgba(110,80,40,.10));opacity:.55;mix-blend-mode:multiply}
.lk-velvet{background:radial-gradient(70% 45% at 50% 0,color-mix(in srgb,var(--lk-glow,#C2384A) 55%,transparent),transparent 70%),radial-gradient(60% 40% at 85% 100%,color-mix(in srgb,var(--lk-glow,#C2384A) 30%,transparent),transparent 70%),radial-gradient(130% 90% at 50% 40%,transparent 55%,rgba(0,0,0,.45));animation:lk-breathe 9s ease-in-out infinite}
.lk-update{position:relative;z-index:2;display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:10px 16px 10px 10px;border-radius:18px;background:#FFF3B0;color:#1F1A17;border:2px solid #1F1A17;box-shadow:3px 3px 0 #1F1A17;transform:rotate(-1deg);width:fit-content;max-width:100%;box-sizing:border-box}
.lk-burst{flex:none;position:relative;width:54px;height:54px;display:grid;place-items:center}.lk-burst svg{position:absolute;inset:0;width:100%;height:100%;fill:#E2573A;stroke:#1F1A17;stroke-width:3;stroke-linejoin:round}.lk-burst b{position:relative;font:800 13px/1 "Instrument Sans",system-ui,sans-serif;color:#fff;transform:rotate(-10deg)}
.lk-upd-t{display:grid;gap:2px;font:600 16px/1.3 "Instrument Sans",system-ui,sans-serif;min-width:0;text-align:left}.lk-upd-t>b{font-size:12px;letter-spacing:.08em;text-transform:uppercase}.lk-upd-t time{font-weight:500;color:#5E534B;letter-spacing:0;text-transform:none;margin-left:4px}.lk-upd-t>span{overflow-wrap:anywhere}
.lk-lights{position:absolute;left:0;right:0;top:0;height:56px;pointer-events:none;z-index:1}.lk-lights.fixed{position:fixed;z-index:3}.lk-lights svg{width:100%;height:100%;display:block;overflow:visible}
.lk-lights .bulb{animation:lk-glow 3.2s ease-in-out infinite}.lk-lights .bulb:nth-child(3n+1){animation-delay:-1.1s}.lk-lights .bulb:nth-child(3n+2){animation-delay:-2.2s}
@keyframes lk-glow{0%,100%{opacity:.55}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.lk-lights .bulb{animation:none;opacity:.9}}
@keyframes lk-breathe{0%,100%{opacity:.85}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.lk-velvet{animation:none}}`;
  // the light invite (public/invite.html, body.lk-invite): its cards, form and buttons in the look's colours, and the flyer
  // beside the invite on wide screens. Kept here so the invite page itself stays small.
  const INVITE_CSS = `body.lk-invite.lk-on main{position:relative;z-index:1}body.lk-invite.lk-on .brand{color:var(--lk-ink)}body.lk-invite.lk-on a{color:inherit}
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
body.lk-invite.lk-on .full,body.lk-invite.lk-on .linkbtn{color:var(--lk-ink)}
html body.lk-invite.lk-on.lk-on button.go,html body.lk-invite.lk-on.lk-on button.go:hover,html body.lk-invite.lk-on.lk-on a.btn.main,html body.lk-invite.lk-on.lk-on a.btn.pay{background:var(--lk-btn)!important;color:var(--lk-on-btn)!important;border-color:var(--lk-btn)!important}
body.lk-invite.lk-fx-lights main{padding-top:calc(max(12px,env(safe-area-inset-top)) + 40px)}
body.lk-invite .cov.poster{width:fit-content;max-width:100%;margin:0 auto}body.lk-invite .cov.poster img{width:auto;max-width:100%;max-height:min(74vh,820px)}
/* wide screens: the flyer on the left, held in place, and the invite beside it */
@media (min-width:960px){body.lk-invite.lk-poster main{max-width:1080px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto repeat(24,auto) 1fr;column-gap:56px;padding-top:24px}
  body.lk-invite.lk-poster main>*{grid-column:2}body.lk-invite.lk-poster main>.top{grid-column:1/-1}body.lk-invite.lk-poster main>.cov.poster{grid-column:1;grid-row:2/-1;position:sticky;top:24px;align-self:start;margin:0 0 0 auto}
  body.lk-invite.lk-poster main>.cov.poster img{max-height:calc(100vh - 110px)}body.lk-invite.lk-poster h1.lk-title{margin-top:4px}body.lk-invite.lk-poster .stick{left:auto;right:max(16px,calc((100vw - 1080px) / 2 + 16px));transform:none;width:min(512px,calc(50vw - 44px));bottom:16px;border:1px solid var(--lk-line,var(--line));border-radius:999px;padding:8px}}`;
  function css() { if (typeof document === "undefined" || document.getElementById("lk-css")) return; const s = document.createElement("style"); s.id = "lk-css"; s.textContent = CSS + INVITE_CSS; document.head.appendChild(s); }
  const CLS = ["lk-on", "lk-dark", "lk-light", "lk-up", "lk-page"];
  /** Dress `el` (the body on an invite, a frame in the preview) in the event's look. Returns the colours used, or null. */
  function apply(el, e, { fixed = true, page = true } = {}) { css(); const L = lookOf(e);
    el.__lkStop?.(); el.__lkStop = null; if (el === document.body) document.documentElement.classList.remove("lk-root"); el.classList.remove(...CLS, ...[...el.classList].filter((c) => /^lk-(fx|font|vibe)-/.test(c)));
    if (!has(L)) return null;
    const T = colors(L), F = FONTS[L.titleFont]; el.classList.add("lk-on"); if (page && T) el.classList.add("lk-page");
    if (T) { el.classList.add(T.dark ? "lk-dark" : "lk-light"); Object.entries({ "--lk-top": T.top, "--lk-bot": T.bot, "--lk-ink": T.ink, "--lk-soft": T.soft, "--lk-btn": T.btn, "--lk-on-btn": T.onBtn, "--lk-card": T.card, "--lk-card-ink": T.cardInk, "--lk-line": T.line }).forEach(([k, v]) => el.style.setProperty(k, v)); }
    // the whole page: the gradient sits on the root, so the effect layer can sit under the content and over the colour
    if (el === document.body && page && T) { const R0 = document.documentElement; R0.classList.add("lk-root"); for (const k of ["--lk-top", "--lk-bot"]) R0.style.setProperty(k, el.style.getPropertyValue(k)); }
    if (F) { loadFont(L.titleFont); el.classList.add("lk-font-" + L.titleFont); el.style.setProperty("--lk-title", F.css); el.style.setProperty("--lk-tw", F.w); el.style.setProperty("--lk-tls", F.ls); el.style.setProperty("--lk-tk", F.k); if (F.up) el.classList.add("lk-up"); }
    if (L.vibe && VIBES[L.vibe]) el.classList.add("lk-vibe-" + L.vibe);
    el.style.setProperty("--lk-glow", glowOf(L));
    const stops = [];
    if (L.effect && L.effect !== "none") { el.classList.add("lk-fx-" + L.effect); stops.push(effect(el, L.effect, { fixed, dark: !!T?.dark, colors: particleColors(L, T) })); }
    if (L.lights) { el.classList.add("lk-fx-lights"); stops.push(lights(el, { fixed })); }
    el.__lkStop = () => stops.forEach((f) => f());
    return T; }
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
  // at most ~30 particles, ~30 frames a second, paused when the tab is hidden or the layer is off screen,
  // and a still frame for people who prefer less motion
  const COUNT = { snow: 30, confetti: 26, petals: 16, sparkles: 22, stars: 30, twinkle: 24 };
  function effect(host, kind, { fixed = true, dark = false, colors = ["#fff"] } = {}) { css(); if (typeof document === "undefined") return () => {};
    const layer = document.createElement("div"); layer.className = "lk-fxl" + (fixed ? " fixed" : ""); layer.setAttribute("aria-hidden", "true");
    if (!fixed && getComputedStyle(host).position === "static") host.style.position = "relative";
    host.prepend(layer);
    if (kind === "paper" || kind === "velvet") { layer.classList.add("lk-" + kind); return () => layer.remove(); }
    if (!COUNT[kind]) { layer.remove(); return () => {}; }
    const cv = document.createElement("canvas"); layer.appendChild(cv); const g = cv.getContext("2d"); if (!g) return () => layer.remove();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches, dpr = Math.min(2, window.devicePixelRatio || 1);
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
    const star4 = (x, y, r) => { g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill(); };
    const draw = (k) => { g.clearRect(0, 0, W, H);
      for (const p of P) { p.a += (p.vr || p.tw || 0.01) * k; p.y += p.vy * k;
        if (kind === "snow") { p.x += Math.sin(p.a + t * 0.01) * 0.3 * p.sw * k; g.globalAlpha = p.al; g.fillStyle = p.c; g.shadowColor = "rgba(30,60,110,.25)"; g.shadowBlur = 3; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); g.shadowBlur = 0; }
        else if (kind === "confetti") { p.x += Math.sin(p.a * 2) * 0.5 * p.sw * k; g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.scale(1, Math.cos(p.a * 3)); g.globalAlpha = 0.9; g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); }
        else if (kind === "petals") { p.x += Math.sin(p.a * 6 + t * 0.02) * 0.6 * p.sw * k; g.save(); g.translate(p.x, p.y); g.rotate(p.a * 4 + Math.sin(t * 0.02 + p.s * 9) * 0.6); g.globalAlpha = 0.85; g.fillStyle = p.c; g.beginPath(); g.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 7); g.fill(); g.globalAlpha = 0.25; g.fillStyle = "#B0344F"; g.beginPath(); g.ellipse(-p.r * 0.35, 0, p.r * 0.35, p.r * 0.12, 0, 0, 7); g.fill(); g.restore(); }
        else if (kind === "sparkles") { const al = 0.25 + 0.75 * Math.abs(Math.sin(p.a)); g.globalAlpha = al; g.fillStyle = p.c; g.shadowColor = dark ? p.c : "rgba(40,50,30,.35)"; g.shadowBlur = dark ? 8 : 5; star4(p.x, p.y, p.r * (0.6 + 0.4 * al)); g.shadowBlur = 0; }
        else if (kind === "twinkle") { const al = Math.max(0, Math.sin(p.a)) ** 3; g.globalAlpha = 0.12 + 0.88 * al; g.fillStyle = p.c; g.shadowColor = p.c; g.shadowBlur = 10 * al; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); g.shadowBlur = 0; }
        else if (kind === "stars") { g.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(p.a)); g.fillStyle = p.c; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
        if (p.y > H + 20 || p.y < -30) Object.assign(p, make(false), kind === "sparkles" ? { y: H + 10 } : {}); if (p.x < -20) p.x = W + 10; if (p.x > W + 20) p.x = -10; }
      g.globalAlpha = 1; };
    const loop = (now) => { raf = 0; if (!alive || document.hidden || !seen) return; const dt = now - (last || now); if (dt >= 32 || !last) { const k = Math.min(3, (dt || 16) / 16.7); t += k; last = now; draw(k); } raf = requestAnimationFrame(loop); };
    const go = () => { if (!raf && alive && !still) { last = 0; raf = requestAnimationFrame(loop); } };
    size(); for (let i = 0; i < Math.min(30, COUNT[kind]); i++) P.push(make(true)); draw(0); go();
    const onVis = () => (document.hidden ? (cancelAnimationFrame(raf), (raf = 0)) : go()); document.addEventListener("visibilitychange", onVis);
    let rt = 0; const onRs = () => { clearTimeout(rt); rt = setTimeout(() => { size(); if (still) draw(0); }, 150); }; addEventListener("resize", onRs);
    let io = null; if (!fixed && "IntersectionObserver" in window) { io = new IntersectionObserver(([x]) => { seen = x.isIntersecting; if (seen) go(); }); io.observe(layer); }
    return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); removeEventListener("resize", onRs); io?.disconnect(); layer.remove(); }; }

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
  const KINDS = [[/holiday market|christmas market|craft fair|makers market|winter market/, ["market", "velvet"]], [/holiday|christmas|xmas|winter|snow|hanukkah|new year|benefit|gala|fundrais/, ["winter", "velvet"]], [/sale|market|pop-?up|ceramic|pottery|clay/, ["velvet", "jazz", "garden"]],
    [/dinner|supper|wine|cocktail|izakaya|sake|bar\b|omakase|tasting|date night/, ["velvet", "night", "garden"]], [/workshop|class|craft|paint|draw|sew|knit|zine|print|stitch/, ["jazz", "garden"]],
    [/flower|floral|bouquet|garden|picnic|plant|tea\b|matcha|brunch/, ["flower", "garden"]], [/jazz|music|band|gig|show|open mic|poetry|record|vinyl|film|movie/, ["jazz", "night"]],
    [/party|birthday|dance|club|karaoke|night out|drinks/, ["night", "garden"]], [/run|hike|walk|bike|swim|yoga/, ["garden", "winter"]]];
  const FX_FOR = { market: ["twinkle", "sparkles"], winter: ["snow", "stars"], velvet: ["velvet", "sparkles"], night: ["velvet", "stars"], jazz: ["paper", "none"], garden: ["sparkles", "petals"], flower: ["petals", "sparkles"] };
  function surprise(e, { keepPalette = null, avoid = "" } = {}) { const txt = `${e?.activity || ""} ${e?.name || ""} ${e?.pubTitle || ""} ${e?.concept || ""} ${e?.kind || ""}`.toLowerCase();
    const opts = (KINDS.find(([re]) => re.test(txt)) || [null, Object.keys(VIBES)])[1], pool = opts.length > 1 ? opts.filter((v) => v !== avoid) : opts, v = pool[(Math.random() * pool.length) | 0], base = VIBES[v].look;
    const fx = FX_FOR[v], L = { ...base, vibe: v, effect: Math.random() < 0.75 ? base.effect : fx[(Math.random() * fx.length) | 0] };
    // with a flyer: its own colours, or now and then a page that contrasts with it (a dark flyer can get a dark page)
    if (keepPalette && keepPalette.length) { L.palette = Math.random() < 0.4 && C ? [C.contrastPage(keepPalette[0]), ...keepPalette.slice(1, 3)] : keepPalette.slice(0, 3); delete L.vibe; }
    if (e?.approvalRequired) L.buttonLabel = "Ask to join"; return L; }

  window.EncoreLooks = { lights, updateHTML, EFFECTS, FONTS, SWATCHES, LABELS, EMOJI, VIBES, has, fitOf, colors, buttonText, coverHTML, apply, effect, loadFont, fromFile, readImage, surprise, lookOf, safeSrc, css };
})();
