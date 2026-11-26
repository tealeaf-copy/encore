// Potto, Pottery Lab's mascot and chief of staff: a little clay pot with gloves and sneakers, drawn as a die-cut
// sticker (thick ink lines, flat colour, a white border). It moves: it bobs and blinks, each pose has its own motion
// (waving, running, cheering, carrying, thinking, napping), its eyes follow your pointer, it squishes on hover and
// hops when tapped. Nothing moves for people who ask their device for less motion.
(function () {
  // drawn soft and chubby: one round pot, a warm brown outline, dot eyes, a little U smile, pink cheeks and a striped glaze band
  const INK = "#5A3B2B", CLAY = "#DDA88A", CLAY_D = "#C98C6C", GLAZE = "#EBE0CA", STRIPE = "#BF9671", CREAM = "#FAF8F3", SW = 3.6;
  const BODY_D = "M80 50c0-4-3-6-3-9h46c0 3-3 5-3 9c24 6 41 25 41 52c0 32-27 56-61 56s-61-24-61-56c0-27 17-46 41-52z";
  const body = `<path d="${BODY_D}"/>`;
  const limb = (d, w = 10) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + SW * 2}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${CLAY}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const glove = (x, y, r = 8) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${CLAY}" stroke="${INK}" stroke-width="${SW}"/>`;
  const shoe = (x, y, flip = 1) => `<ellipse cx="${x + 2 * flip}" cy="${y}" rx="12" ry="7.5" fill="${CLAY}" stroke="${INK}" stroke-width="${SW}"/>`;
  const eyes = (mood) => mood === "sleep"
    ? `<path d="M76 104c3 3 8 3 11 0M113 104c3 3 8 3 11 0" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
    : `<circle cx="81" cy="103" r="4" fill="${INK}"/><circle cx="119" cy="103" r="4" fill="${INK}"/>`;
  const mouth = (mood) => mood === "sleep" ? `<path d="M96 116c2 2 6 2 8 0" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
    : mood === "cheer" ? `<path d="M92 108c0 10 16 10 16 0z" fill="${INK}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M96 114c2 2 6 2 8 0" stroke="#E6A99A" stroke-width="3" stroke-linecap="round" fill="none"/>`
    : mood === "think" ? `<path d="M95 112c3-2 7-2 10 0" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" fill="none"/>`
    : `<path d="M94 106c0 8 12 8 12 0" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" fill="none"/>`;
  let _pid = 0;
  const glaze = (id) => `<defs><clipPath id="${id}"><path d="${BODY_D}"/></clipPath></defs><g clip-path="url(#${id})"><rect x="30" y="126" width="140" height="17" fill="${GLAZE}"/>${Array.from({ length: 12 }, (_, i) => `<path d="M${36 + i * 12} 143l9-17" stroke="${STRIPE}" stroke-width="4"/>`).join("")}<path d="M30 126h140M30 143h140" stroke="${INK}" stroke-width="2.4"/></g>`;
  // each pose: limbs as separate parts so they can move; each arm includes its glove, each leg its shoe
  const POSES = {
    wave: { armL: limb("M58 118c-14 4-20 14-22 26") + glove(36, 146), armR: limb("M142 112c14-8 20-24 22-38") + glove(165, 70), legL: limb("M88 156v22", 10) + shoe(84, 184, -1), legR: limb("M112 156v22", 10) + shoe(116, 184), fx: `<path d="M178 58l8-6M182 72l10 0M176 46l4-9" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` },
    run: { armL: limb("M58 116c-16-2-24 8-28 18") + glove(30, 136), armR: limb("M142 116c14 10 26 8 34 0") + glove(178, 114), legL: limb("M88 154c-6 10-16 16-26 16", 10) + shoe(56, 172, -1), legR: limb("M112 154c8 8 10 18 8 28", 10) + shoe(124, 186), fx: `<path d="M8 96h26M14 112h18M4 128h22" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".8"/>` },
    cheer: { armL: limb("M58 112c-12-10-16-28-14-44") + glove(44, 64), armR: limb("M142 112c12-10 16-28 14-44") + glove(156, 64), legL: limb("M88 156c-4 8-8 16-14 22", 10) + shoe(70, 184, -1), legR: limb("M112 156c4 8 8 16 14 22", 10) + shoe(130, 184), fx: `<path d="M30 40l6 10M44 30v12M58 36l-4 10M142 36l4 10M156 30v12M170 40l-6 10" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` },
    carry: { armL: limb("M58 118c-6 14 4 22 18 22") + glove(80, 140), armR: limb("M142 118c6 14-4 22-18 22") + glove(120, 140), legL: limb("M88 160v18", 10) + shoe(84, 184, -1), legR: limb("M112 160v18", 10) + shoe(116, 184), front: `<path d="M66 132h68l-6 18H72z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M76 132c0-12 48-12 48 0" fill="${GLAZE}" stroke="${INK}" stroke-width="4"/><circle cx="100" cy="117" r="5" fill="#A4533A" stroke="${INK}" stroke-width="3"/>` },
    think: { armL: limb("M58 118c-14 4-20 14-22 26") + glove(36, 146), armR: limb("M142 124c12 2 8-12-6-14") + glove(134, 110), legL: limb("M88 156v22", 10) + shoe(84, 184, -1), legR: limb("M112 156v22", 10) + shoe(116, 184), fx: `<circle cx="160" cy="62" r="5" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="176" cy="42" r="9" fill="#fff" stroke="${INK}" stroke-width="3"/>`, mood: "think" },
    sleep: { armL: limb("M60 124c-10 6-12 16-8 24") + glove(52, 150), armR: limb("M140 124c10 6 12 16 8 24") + glove(148, 150), legL: limb("M88 158v18", 10) + shoe(84, 182, -1), legR: limb("M112 158v18", 10) + shoe(116, 182), fx: `<g class="pt-z"><path d="M140 30h12l-12 14h12" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M160 12h8l-8 9h8" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`, mood: "sleep" },
  };
  // the white die-cut border: the same shapes traced thick in white, drawn under everything (part by part, so it moves too)
  const under = (html) => html.replace(/stroke-width="[^"]*"/g, "").replace(/stroke="[^"]*"/g, "").replace(/fill="(?!none)[^"]*"/g, 'fill="#fff"').replace(/opacity="[^"]*"/g, "");
  /** A Potto sticker. pose: wave | run | cheer | carry | think | sleep. */
  function svg(pose = "wave", size = 140, label = "Potto, your Pottery Lab chief of staff") {
    const P = POSES[pose] || POSES.wave, mood = P.mood || pose;
    const gid = "ptg" + (++_pid), torso = `<g fill="${CLAY}">${body}</g>${glaze(gid)}<path d="M77 41h46" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round"/><path d="M60 78c6-8 14-12 20-14" stroke="${CREAM}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/><ellipse cx="72" cy="113" rx="7" ry="4" fill="#E6A99A" opacity=".9"/><ellipse cx="128" cy="113" rx="7" ry="4" fill="#E6A99A" opacity=".9"/><g fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round">${body}</g>`;
    const parts = [["legL", P.legL], ["legR", P.legR], ["armL", P.armL], ["armR", P.armR], ["torso", torso + (P.front || "")]];
    const W = "" && `<g stroke="#fff" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" fill="#fff">${parts.map(([k, h]) => `<g class="pt-${k}">${under(h)}</g>`).join("")}<g class="pt-fx">${under(P.fx || "")}</g></g>`;
    const ink = parts.map(([k, h]) => k === "torso" ? `<g class="pt-torso">${torso}<g class="pt-eyes">${eyes(mood)}</g>${mouth(mood)}${P.front || ""}</g>` : `<g class="pt-${k}">${h}</g>`).join("");
    return `<svg class="potto p-${pose}" viewBox="-6 6 212 200" width="${size}" height="${size}" role="img" aria-label="${label}" style="overflow:visible"><g class="pt-all"><g class="pt-drop">${W}${ink}<g class="pt-fx">${P.fx || ""}</g></g></g></svg>`;
  }

  const CSS = `
.potto{cursor:pointer;-webkit-tap-highlight-color:transparent}
.potto .pt-all{transform-box:view-box;transform-origin:100px 190px;animation:pt-bob 2.6s ease-in-out infinite}
.potto .pt-drop{filter:none}
.potto .pt-eyes{transform-box:fill-box;transform-origin:center;animation:pt-blink 4.2s infinite;transition:translate .15s ease-out}
.potto .pt-armL,.potto .pt-armR,.potto .pt-legL,.potto .pt-legR{transform-box:view-box}
.potto .pt-armL{transform-origin:58px 116px}.potto .pt-armR{transform-origin:142px 114px}.potto .pt-legL{transform-origin:88px 156px}.potto .pt-legR{transform-origin:112px 156px}
.p-wave .pt-armR{animation:pt-wave 1.1s ease-in-out infinite}.p-wave .pt-fx{animation:pt-flash 1.1s ease-in-out infinite}
.p-run .pt-all{animation:pt-bob .5s ease-in-out infinite}.p-run .pt-legL,.p-run .pt-armR{animation:pt-swing .5s ease-in-out infinite}.p-run .pt-legR,.p-run .pt-armL{animation:pt-swing .5s ease-in-out infinite reverse}.p-run .pt-fx{animation:pt-dash .5s linear infinite}
.p-cheer .pt-all{animation:pt-jump 1.2s cubic-bezier(.3,1.5,.5,1) infinite}.p-cheer .pt-armL{animation:pt-pumpL .6s ease-in-out infinite}.p-cheer .pt-armR{animation:pt-pumpR .6s ease-in-out infinite}.p-cheer .pt-fx{animation:pt-flash .6s ease-in-out infinite}
.p-carry .pt-all{animation:pt-sway 2.4s ease-in-out infinite}
.p-think .pt-fx{animation:pt-flash 2s ease-in-out infinite}.p-think .pt-all{animation:pt-sway 3.6s ease-in-out infinite}
.p-sleep .pt-all{animation:pt-breathe 3.2s ease-in-out infinite}.p-sleep .pt-eyes{animation:none}.p-sleep .pt-z{animation:pt-z 3.2s ease-in-out infinite}
@media (hover:hover){.potto:hover .pt-all{animation:pt-squish .5s cubic-bezier(.3,1.6,.5,1)}}
.potto.pt-hop .pt-all{animation:pt-hop .6s cubic-bezier(.3,1.6,.5,1)}
@keyframes pt-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes pt-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.97)}}
@keyframes pt-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.12)}}
@keyframes pt-wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-22deg)}}
@keyframes pt-swing{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}}
@keyframes pt-pumpL{0%,100%{transform:rotate(0)}50%{transform:rotate(14deg)}}
@keyframes pt-pumpR{0%,100%{transform:rotate(0)}50%{transform:rotate(-14deg)}}
@keyframes pt-jump{0%,100%{transform:translateY(0) scale(1,1)}20%{transform:translateY(2px) scale(1.06,.94)}50%{transform:translateY(-14px) scale(.97,1.04)}}
@keyframes pt-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes pt-squish{0%{transform:scale(1,1)}30%{transform:scale(1.1,.88)}60%{transform:scale(.95,1.06)}100%{transform:scale(1,1)}}
@keyframes pt-hop{0%{transform:translateY(0) scale(1,1)}25%{transform:translateY(3px) scale(1.12,.86)}55%{transform:translateY(-26px) scale(.94,1.08) rotate(-6deg)}100%{transform:translateY(0) scale(1,1)}}
@keyframes pt-flash{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes pt-dash{0%{transform:translateX(6px);opacity:.3}50%{opacity:1}100%{transform:translateX(-6px);opacity:.3}}
@keyframes pt-z{0%{transform:translate(0,6px);opacity:0}40%{opacity:1}100%{transform:translate(8px,-10px);opacity:0}}
.pt-spark{position:fixed;pointer-events:none;z-index:2147483001;font-size:20px;animation:pt-spark .8s ease-out forwards}
@keyframes pt-spark{0%{transform:translate(-50%,-50%) scale(.4);opacity:1}100%{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.1);opacity:0}}
@media (prefers-reduced-motion:reduce){.potto *{animation:none!important;transition:none!important}}`;
  function ensureCss() { if (typeof document === "undefined" || document.getElementById("pottoCss")) return; const s = document.createElement("style"); s.id = "pottoCss"; s.textContent = CSS; (document.head || document.documentElement).appendChild(s); }
  ensureCss();
  if (typeof document !== "undefined") {
    const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // eyes follow the pointer, a few pixels, like it's watching you
    let raf = 0; document.addEventListener("pointermove", (e) => { if (still() || raf) return; raf = requestAnimationFrame(() => { raf = 0; document.querySelectorAll(".potto:not(.p-sleep) .pt-eyes").forEach((g) => { const r = g.getBoundingClientRect(); if (!r.width) return; const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 300); g.style.translate = `${((dx / d) * 3.5 * k).toFixed(2)}px ${((dy / d) * 3 * k).toFixed(2)}px`; }); }); }, { passive: true });
    // a tap or click: hop, with a little burst of sparkles
    document.addEventListener("click", (e) => { const p = e.target.closest?.(".potto"); if (!p || still()) return; p.classList.remove("pt-hop"); void p.getBoundingClientRect(); p.classList.add("pt-hop"); setTimeout(() => p.classList.remove("pt-hop"), 650);
      for (let i = 0; i < 6; i++) { const s = document.createElement("span"); s.className = "pt-spark"; s.textContent = ["✨", "⭐", "💛", "🌱", "🎉", "✨"][i]; const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.5, R = 40 + Math.random() * 30; s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px"; s.style.setProperty("--dx", Math.cos(a) * R + "px"); s.style.setProperty("--dy", Math.sin(a) * R + "px"); document.body.appendChild(s); setTimeout(() => s.remove(), 850); } });
  }
  window.Potto = { svg, poses: Object.keys(POSES), ensureCss };
})();
