// Plush Potto: our clay pot mascot as a soft felt toy, drawn in SVG (gradients for the roundness, a turbulence and
// displacement filter for the fuzzy edge, a lit grain for the felt). Eight colourways, four body shapes and a wardrobe
// tied to what people host. Each page load picks one combination and keeps it for the visit; a caller can ask for the
// outfit that suits an event type. It bobs and blinks slowly, looks toward the pointer and hops when asked. Nothing
// moves under prefers-reduced-motion, it pauses off screen, and its box is reserved so the page never jumps.
//   PottoPlush.mount(el, { size, type, wear, color, shape, seed, label }) -> { set(), react(), look(), el }
//   PottoPlush.svg(opts) -> markup, PottoPlush.typeFor("taco night friday") -> "dinner"
(function () {
  if (window.PottoPlush) return;
  const COLORS = { clay: "#DCA382", butter: "#F1D06E", plum: "#A77BAE", sky: "#8FC3EA", moss: "#9DB274", coral: "#F2907C", cream: "#F2E6CF", ink: "#6F8AD6" };
  const INK = "#33261F", WHITE = "#FFFDF8";
  // the belly changes, the lip and the face stay put so every outfit fits every shape
  const SHAPES = {
    round: "M100 50c34 0 60 25 60 60c0 34-26 56-60 56s-60-22-60-56c0-35 26-60 60-60z",
    tall: "M100 48c28 0 50 26 52 62c2 36-20 56-52 56s-54-20-52-56c2-36 24-62 52-62z",
    squat: "M100 54c38 0 67 22 67 58c0 32-29 54-67 54s-67-22-67-54c0-36 29-58 67-58z",
    pear: "M100 48c24 0 42 20 48 48c4 18 14 26 14 42c0 20-28 28-62 28s-62-8-62-28c0-16 10-24 14-42c6-28 24-48 48-48z"
  };
  const OUTFITS = [["glasses", "bowtie"], ["sunglasses"], ["partyhat"], ["chefhat"], ["headband"], ["flowercrown"], ["headphones"], ["coffee"], ["scarf"], ["glasses", "book"], ["apron", "flower"], ["bowtie"], ["sunglasses", "scarf"], ["partyhat", "bowtie"], ["flower"]];
  const TYPES = { dinner: ["chefhat"], run: ["headband"], book: ["glasses", "book"], drinks: ["bowtie"], party: ["partyhat"], workshop: ["apron", "flower"], coffee: ["coffee"], music: ["headphones"], outdoors: ["scarf"], garden: ["flowercrown"], sun: ["sunglasses"], games: ["glasses", "bowtie"] };
  const WORDS = [["book", /book|read|novel|poetry|writing/], ["run", /\brun|jog|5k|10k|marathon|ride|cycl|bike|yoga|pilates|gym|workout|climb|tennis|pickle|soccer|basketball/], ["coffee", /coffee|cafe|café|matcha|\btea\b|brunch|breakfast|bakery/], ["drinks", /drink|cocktail|wine|bar\b|happy hour|martini|beer|toast|gala|wedding/],
    ["party", /party|birthday|bday|celebrat|housewarming|shower|karaoke|new year/], ["workshop", /workshop|class|pottery|ceramic|craft|paint|make|knit|sew|floral|flower arrang|clay/], ["music", /music|concert|gig|listening|dj|vinyl|dance|jam\b/], ["garden", /garden|picnic|park|spring|plant/],
    ["sun", /beach|pool|rooftop|summer|bbq|barbecue|lake|boat/], ["outdoors", /hike|camp|walk|ski|snow|winter|trail|bonfire/], ["games", /game|trivia|quiz|poker|chess|puzzle|movie|film/], ["dinner", /dinner|supper|cook|potluck|dumpling|taco|pizza|pasta|lunch|feast|bbq|food|chef|ramen|hot ?pot/]];
  const typeFor = (t) => { t = String(t || "").toLowerCase(); if (!t.trim()) return ""; if (TYPES[t]) return t; for (const [k, re] of WORDS) if (re.test(t)) return k; return ""; };

  // one seed per page load, never the same as the last visit's
  let SEED = 0;
  try { const q = new URLSearchParams(location.search).get("potto"); if (q != null && q !== "") SEED = (+q >>> 0) || 1; } catch {}
  if (!SEED) { let last = 0; try { last = +localStorage.getItem("pl.potto") || 0; } catch {}
    const nC = Object.keys(COLORS).length; do { SEED = 1 + Math.floor(Math.random() * 1e6); } while (last && (SEED % nC === last % nC || SEED % OUTFITS.length === last % OUTFITS.length));
    try { localStorage.setItem("pl.potto", SEED); } catch {} }
  const pick = (seed) => { const s = seed >>> 0, ck = Object.keys(COLORS), sk = Object.keys(SHAPES); return { color: ck[s % ck.length], wear: OUTFITS[s % OUTFITS.length], shape: sk[(s >>> 3) % sk.length] }; };

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  const flatOnly = () => { try { return matchMedia("(prefers-reduced-transparency: reduce)").matches || !("SVGFEDisplacementMapElement" in window) || !window.CSS || !CSS.supports("transform-box", "fill-box"); } catch { return true; } };
  const still = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

  // ---- the wardrobe: each piece in the same 200 by 200 box ----
  const P = { coral: "#EE7F6B", butter: "#F4D36F", ink: "#29489A", moss: "#7F9A5A", plum: "#8E5E96", sky: "#8FC3EA", cream: "#FBF4E4" };
  const alt = (c, a, b) => (c === a ? b : a); // an accent that never matches the body
  const flower = (x, y, r, c, mid) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<circle r="${r}" cx="0" cy="${-r * 1.05}" fill="${c}" transform="rotate(${a})"/>`).join("")}<circle r="${r * 0.72}" fill="${mid}"/></g>`;
  const WEAR = {
    glasses: () => ({ soft: `<g fill="#fff" opacity=".3"><circle cx="84.5" cy="103" r="12"/><circle cx="115.5" cy="103" r="12"/></g>`, top: `<g fill="none" stroke="${INK}" stroke-width="3.2"><circle cx="84.5" cy="103" r="12.5"/><circle cx="115.5" cy="103" r="12.5"/></g><path d="M97 101.500q3-2.5 6 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>` }),
    sunglasses: () => ({ noEyes: 1, top: `<g fill="#2B2430"><rect x="69" y="93" width="28" height="20" rx="8.5"/><rect x="103" y="93" width="28" height="20" rx="8.5"/><rect x="94" y="97" width="12" height="4.5" rx="2"/></g><path d="M75 98.500l7-2M109 98.500l7-2" stroke="#fff" stroke-opacity=".55" stroke-width="2.6" stroke-linecap="round"/>` }),
    bowtie: (c) => { const a = alt(c, "coral", "ink"), d = mix(P[a], INK, 0.28); return { soft: `<path d="M99 136l-19-10q-4-1-4 3v16q0 4 4 3zM101 136l19-10q4-1 4 3v16q0 4-4 3z" fill="${P[a]}"/><rect x="93.5" y="129.5" width="13" height="13" rx="4.5" fill="${d}"/>` }; },
    partyhat: (c) => { const a = alt(c, "coral", "sky"), b = alt(c, "butter", "cream"); return { soft: `<g transform="rotate(-9 100 48)"><path d="M76 50q24 7 48 0l-21-44q-3-4-6 0z" fill="${P[a]}"/><path d="M83.5 35.500q15 5 31.5 0M90.5 21q9 3 18.5 0" fill="none" stroke="${P[b]}" stroke-width="5.5" stroke-linecap="round"/><circle cx="100" cy="5" r="7.5" fill="${P[b]}"/><path d="M75 50q25 8 50 0" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round"/></g>` }; },
    chefhat: () => ({ soft: `<g fill="${WHITE}"><circle cx="80" cy="26" r="15"/><circle cx="100" cy="19" r="17.5"/><circle cx="120" cy="26" r="15"/><path d="M77 28h46v19q-23 6-46 0z"/></g><path d="M78 40q22 5 44 0" fill="none" stroke="#DDD3C2" stroke-width="2.4" stroke-linecap="round"/>` }),
    headband: (c) => { const a = alt(c, "coral", "ink"); return { clip: `<path d="M20 78q80-22 160 0" fill="none" stroke="${P[a]}" stroke-width="13"/><path d="M20 78q80-22 160 0" fill="none" stroke="${WHITE}" stroke-width="3" stroke-dasharray="1 9" stroke-linecap="round" opacity=".8"/>` }; },
    flowercrown: (c) => { const L = [[62, 70, P[alt(c, "coral", "plum")]], [80, 58, P.cream], [100, 54, P[alt(c, "butter", "coral")]], [120, 58, P[alt(c, "plum", "sky")]], [138, 70, P.cream]]; return { soft: `<path d="M56 76q44-34 88 0" fill="none" stroke="${P.moss}" stroke-width="5" stroke-linecap="round"/>` + L.map(([x, y, col], i) => flower(x, y, i % 2 ? 5.5 : 6.5, col, col === P.cream ? P.butter : P.cream)).join("") }; },
    headphones: (c) => { const a = alt(c, "ink", "coral"); return { soft: `<path d="M41 104q-4-78 59-78t59 78" fill="none" stroke="#3A3340" stroke-width="7.5" stroke-linecap="round"/><rect x="28" y="86" width="21" height="38" rx="10" fill="${P[a]}"/><rect x="151" y="86" width="21" height="38" rx="10" fill="${P[a]}"/>` }; },
    coffee: (c) => { const a = alt(c, "coral", "ink"); return { hold: "R", soft: `<g transform="rotate(6 146 140)"><path d="M134 126h24l-3 30q-1 4-5 4h-8q-4 0-5-4z" fill="${WHITE}"/><path d="M135.4 136h21.200l-1.2 13h-18.800z" fill="${P[a]}"/><rect x="131" y="120" width="30" height="8" rx="4" fill="#5B4636"/></g>` }; },
    scarf: (c) => { const a = alt(c, "coral", "moss"), d = mix(P[a], INK, 0.22); return { clip: `<path d="M20 130q80 26 160 0" fill="none" stroke="${P[a]}" stroke-width="17"/><path d="M36 131q64 20 128 0" fill="none" stroke="${d}" stroke-width="2.5" stroke-dasharray="3 9" stroke-linecap="round"/>`, soft: `<path d="M118 135l19-3 5 30q1 5-4 5l-10 1q-4 0-5-4z" fill="${P[a]}"/><path d="M126 163l1 5M133 162l1 5" stroke="${d}" stroke-width="2.5" stroke-linecap="round"/>` }; },
    book: (c) => { const a = alt(c, "ink", "plum"); return { hold: "L", soft: `<g transform="rotate(-8 56 142)"><rect x="38" y="124" width="34" height="38" rx="4.5" fill="${P[a]}"/><rect x="42" y="127" width="30" height="32" rx="2.5" fill="${WHITE}"/><rect x="38" y="124" width="29" height="38" rx="4.5" fill="${P[a]}"/><rect x="45" y="132" width="15" height="4.5" rx="2.2" fill="${P.cream}" opacity=".9"/></g>` }; },
    apron: (c) => { const a = alt(c, "cream", "sky"), d = mix(P[a], INK, 0.2); return { clip: `<path d="M68 122h64l8 60H60z" fill="${P[a]}"/><path d="M68 122L50 108M132 122l18-14" stroke="${P[a]}" stroke-width="5" stroke-linecap="round"/><rect x="87" y="138" width="26" height="17" rx="5" fill="none" stroke="${d}" stroke-width="2.5"/>` }; },
    flower: (c) => ({ soft: `<path d="M139 66q5-9 3-17" fill="none" stroke="${P.moss}" stroke-width="4" stroke-linecap="round"/>` + flower(141, 44, 7.5, P[alt(c, "coral", "butter")], P.cream) })
  };

  let uid = 0;
  function build(o) {
    const k = COLORS[o.color] ? o.color : "clay", base = COLORS[k], path = SHAPES[o.shape] || SHAPES.round, id = "plp" + (++uid), flat = o.flat;
    const hi = mix(base, "#FFFFFF", 0.42), lo = mix(base, "#3B2A3A", 0.3), rim = mix(base, "#3B2A3A", 0.12), pale = k === "cream" || k === "butter";
    const W = (o.wear || []).filter((w) => WEAR[w]).map((w) => WEAR[w](k)), part = (key) => W.map((w) => w[key] || "").join("");
    const noEyes = W.some((w) => w.noEyes), holdL = W.some((w) => w.hold === "L"), holdR = W.some((w) => w.hold === "R");
    const f = (n) => (flat ? "" : ` filter="url(#${id}${n})"`), fill = `url(#${id}g)`;
    const defs = `<defs><radialGradient id="${id}g" cx=".36" cy=".26" r=".85"><stop offset="0" stop-color="${hi}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
<radialGradient id="${id}s"><stop offset="0" stop-color="#3B2A3A" stop-opacity=".26"/><stop offset="1" stop-color="#3B2A3A" stop-opacity="0"/></radialGradient>
<clipPath id="${id}c"><path d="${path}"/></clipPath>${flat ? "" : `
<filter id="${id}a" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="${o.seed % 97}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="15" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation=".5"/></filter>
<filter id="${id}b" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d0"/><feGaussianBlur in="d0" stdDeviation=".45" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="1.1 .7" numOctaves="2" seed="11" result="t"/><feDiffuseLighting in="t" surfaceScale=".8" diffuseConstant="1" lighting-color="#fff" result="l0"><feDistantLight azimuth="235" elevation="66"/></feDiffuseLighting><feGaussianBlur in="l0" stdDeviation=".35" result="l"/>
<feComposite in="d" in2="l" operator="arithmetic" k1=".8" k2=".37" k3="0" k4="0" result="m"/><feComposite in="m" in2="d" operator="in"/></filter>
<filter id="${id}w" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feDiffuseLighting in="n" surfaceScale=".6" diffuseConstant="1" lighting-color="#fff" result="l0"><feDistantLight azimuth="235" elevation="66"/></feDiffuseLighting><feGaussianBlur in="l0" stdDeviation=".3" result="l"/><feComposite in="d" in2="l" operator="arithmetic" k1=".6" k2=".47" k3="0" k4="0" result="m"/><feComposite in="m" in2="d" operator="in"/></filter>`}</defs>`;
    const nub = (x, y, rx, ry, r) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"${r ? ` transform="rotate(${r} ${x} ${y})"` : ""}/>`;
    const feet = nub(80, 170, 15, 9) + nub(120, 170, 15, 9);
    const lip = `<rect x="70" y="38" width="60" height="19" rx="9.5" fill="${rim}"/><rect x="70" y="37" width="60" height="16" rx="8" fill="${fill}"/>`;
    const armL = holdL ? nub(66, 150, 10, 8, -20) : nub(o.shape === "squat" ? 36 : 44, 124, 8, 11, 18), armR = holdR ? nub(137, 149, 10, 8, 20) : nub(o.shape === "squat" ? 164 : 156, 124, 8, 11, -18);
    const body = `<svg class="plp-l" viewBox="0 0 200 190" aria-hidden="true" focusable="false">${defs}<ellipse cx="100" cy="178" rx="62" ry="8" fill="url(#${id}s)"/>
<g${f("a")} opacity="${flat ? 0 : 0.5}">${feet}<path d="${path}" fill="${fill}"/></g>
<g${f("b")}>${feet}${lip}<path d="${path}" fill="${fill}"/>${holdL ? "" : armL}${holdR ? "" : armR}</g>
<g${f("w")}><g clip-path="url(#${id}c)">${part("clip")}</g>${part("soft")}</g><g${f("b")}>${holdL ? armL : ""}${holdR ? armR : ""}</g></svg>`;
    const eye = (x) => `<g class="plp-eye"><ellipse cx="${x}" cy="103" rx="4.3" ry="5" fill="${INK}"/><circle cx="${x + 1.4}" cy="101.2" r="1.5" fill="#fff"/></g>`;
    const face = `<svg class="plp-l plp-f" viewBox="0 0 200 190" aria-hidden="true" focusable="false"><g class="plp-look"><ellipse cx="72" cy="114" rx="8" ry="5" fill="${pale ? "#F2A08F" : "#FFD9CF"}" opacity="${pale ? 0.55 : 0.42}"/><ellipse cx="128" cy="114" rx="8" ry="5" fill="${pale ? "#F2A08F" : "#FFD9CF"}" opacity="${pale ? 0.55 : 0.42}"/>
${noEyes ? "" : eye(86) + eye(114)}<path d="M94.5 ${noEyes ? 119 : 113}q5.5 5.5 11 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/></g><g class="plp-top">${part("top")}</g></svg>`;
    return body + face;
  }

  const CSS_TEXT = `.plp{display:inline-block;position:relative;width:var(--plp-s,160px);height:calc(var(--plp-s,160px)*.95);flex:none;vertical-align:middle;line-height:0;-webkit-tap-highlight-color:transparent}
.plp-j,.plp-b{position:absolute;inset:0;transform-origin:50% 92%}.plp-l{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.plp-look{transform:translate(calc(var(--plp-x,0)*1px),calc(var(--plp-y,0)*1px));transition:transform .25s ease-out}.plp-eye{transform-box:fill-box;transform-origin:50% 60%}
@media (prefers-reduced-motion:no-preference){.plp-b{animation:plp-bob 4.6s ease-in-out infinite;will-change:transform}.plp-eye{animation:plp-blink 5.2s infinite}
.plp.is-off .plp-b,.plp.is-off .plp-eye{animation-play-state:paused}
.plp.is-hop .plp-j{animation:plp-hop .52s cubic-bezier(.3,.7,.3,1)}.plp.is-tilt .plp-j{animation:plp-tilt .5s ease-in-out}.plp.is-pop .plp-j{animation:plp-pop .24s ease-out}}
@keyframes plp-bob{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-2.2%) scale(.992,1.012)}}
@keyframes plp-blink{0%,94%,100%{transform:scaleY(1)}96.5%{transform:scaleY(.1)}}
@keyframes plp-hop{0%{transform:translateY(0) scale(1,1)}18%{transform:translateY(0) scale(1.06,.93)}50%{transform:translateY(-11%) scale(.97,1.04)}82%{transform:translateY(0) scale(1.04,.96)}100%{transform:translateY(0) scale(1,1)}}
@keyframes plp-tilt{0%,100%{transform:rotate(0)}35%{transform:rotate(-7deg)}70%{transform:rotate(4deg)}}
@keyframes plp-pop{0%{transform:scale(.94)}60%{transform:scale(1.03)}100%{transform:scale(1)}}`;
  function css() { if (document.getElementById("plpCss")) return; const s = document.createElement("style"); s.id = "plpCss"; s.textContent = CSS_TEXT; document.head.appendChild(s); }

  const resolve = (o) => { const seed = (o.seed ?? SEED) >>> 0, r = pick(seed), t = TYPES[typeFor(o.type)]; return { seed, color: o.color || r.color, shape: o.shape || r.shape, wear: o.wear || t || r.wear, flat: o.flat ?? flatOnly() }; };
  const svg = (o = {}) => { css(); const r = resolve(o); return `<span class="plp" style="--plp-s:${+o.size || 160}px" data-color="${r.color}" data-wear="${r.wear.join(" ")}"><span class="plp-j"><span class="plp-b">${build(r)}</span></span></span>`; };

  // every mounted Potto shares one pointer listener and one observer
  const live = new Set(); let raf = 0, px = 0, py = 0, io = null;
  const aim = () => { raf = 0; live.forEach((m) => { if (m.off || m.held) return; const r = m.el.getBoundingClientRect(); if (!r.width) return; const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height * 0.5), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160); m.eyes(dx / d * 3.2 * k, dy / d * 2.4 * k); }); };
  const onMove = (e) => { if (e.pointerType === "touch") return; px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(aim); };

  function mount(el, o = {}) {
    if (!el) return null; css();
    let cur = resolve(o); const size = +o.size || 160;
    el.classList.add("plp"); el.style.setProperty("--plp-s", size + "px");
    if (o.label) { el.setAttribute("role", "img"); el.setAttribute("aria-label", o.label); } else el.setAttribute("aria-hidden", "true");
    const draw = () => { el.dataset.color = cur.color; el.dataset.wear = cur.wear.join(" "); el.dataset.shape = cur.shape; el.innerHTML = `<span class="plp-j"><span class="plp-b">${build(cur)}</span></span>`; };
    draw();
    let lx = 0, ly = 0;
    const m = { el, off: false, held: 0,
      eyes(x, y) { x = Math.round(x * 10) / 10; y = Math.round(y * 10) / 10; if (x === lx && y === ly) return; lx = x; ly = y; const f = el.querySelector(".plp-f"); if (f) { f.style.setProperty("--plp-x", x); f.style.setProperty("--plp-y", y); } },
      get state() { return { ...cur }; },
      // change clothes (or colour): only redraws when something is different, then a small pop
      set(n = {}) { const t = n.type != null ? TYPES[typeFor(n.type)] : null, base = pick(cur.seed);
        const next = { ...cur, color: n.color || cur.color, shape: n.shape || cur.shape, wear: n.wear || t || (n.type != null ? base.wear : cur.wear) };
        if (next.color === cur.color && next.shape === cur.shape && next.wear.join() === cur.wear.join()) return false;
        cur = next; draw(); lx = ly = 0; m.react("pop"); return true; },
      react(kind = "hop") { if (still()) return; const c = "is-" + kind; el.classList.remove("is-hop", "is-tilt", "is-pop"); void el.offsetWidth; el.classList.add(c); setTimeout(() => el.classList.remove(c), 620); },
      // look toward a field (or anything) for a moment, e.g. while typing
      look(target, ms = 1600) { if (still() || !target) return; const a = el.getBoundingClientRect(), b = target.getBoundingClientRect(), dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), d = Math.hypot(dx, dy) || 1; m.eyes(dx / d * 3.2, dy / d * 2.6); clearTimeout(m.held); m.held = setTimeout(() => { m.held = 0; m.eyes(0, 0); }, ms); },
      destroy() { live.delete(m); io?.unobserve(el); } };
    el.__potto = m;
    if (!still()) {
      if (!live.size) addEventListener("pointermove", onMove, { passive: true });
      if (!io && "IntersectionObserver" in window) io = new IntersectionObserver((L) => L.forEach((e) => { const t = e.target.__potto; if (t) { t.off = !e.isIntersecting; e.target.classList.toggle("is-off", t.off); } }));
      io?.observe(el); live.add(m);
      if (o.tap !== false) el.addEventListener("click", () => m.react("hop"));
    }
    return m;
  }
  window.PottoPlush = { mount, svg, typeFor, pick, seed: SEED, COLORS: Object.keys(COLORS), WEAR: Object.keys(WEAR), SHAPES: Object.keys(SHAPES), OUTFITS, TYPES };
})();
