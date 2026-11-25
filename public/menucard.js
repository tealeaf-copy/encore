// Menu card for food experiences: each course on its own card, joined by + badges, ending in a tilted "= the night"
// card. Lines can be "To start: Pandan madeleines" (label: dish) or just the dish. Used on guest pages, host storefronts
// and as a live preview in the host kit, with a few templates to start from.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const TONES = { berry: ["#B8327E", "#7A1E55", "#FDF6D8", "#D8379A"], plum: ["#4A0F32", "#2E0820", "#F5E9FF", "#6A2E8F"], sage: ["#2F6B4F", "#1D4733", "#FFF6DA", "#8A5A0C"], tomato: ["#C94A30", "#8A2E1C", "#FFF3E2", "#B8361E"], lilac: ["#C9B8F5", "#8B6FD6", "#FFFBE6", "#7A4FD6"] };
  const BADGE = ["#2F9D5A", "#E85AB8", "#E8762C", "#2F6FE0", "#E0A030"];
  const TEMPLATES = [
    { name: "Three courses", theme: "A cozy dinner at mine", lines: ["To start: Pandan madeleines, salted butter", "Main: Lemongrass chicken, jasmine rice, herbs", "Dessert: Coconut pandan cake"] },
    { name: "Tasting menu", theme: "Autumn in Kyoto", lines: ["Snack: Hamachi, yuzu, shiso", "Small plate: Grilled maitake, miso butter", "Main: Miso black cod", "Pre-dessert: Yuzu sorbet", "Dessert: Matcha panna cotta"] },
    { name: "Friendsgiving", theme: "Friendsgiving", lines: ["The host makes: The turkey and gravy", "Sides: Claim one on the invite", "Dessert: Claim one on the invite", "Drinks: Cider, wine, or bring your favourite"], slots: ["Mashed potatoes", "Stuffing", "Green beans", "Cranberry sauce", "Pumpkin pie", "Apple crumble", "Drinks"] },
    { name: "Potluck", theme: "Everyone brings one thing", lines: ["The host makes: A big pot of soup", "Sides: Claim one on the invite", "Dessert: Claim one on the invite", "Drinks: Bring what you love"], slots: ["A salad", "A side", "Bread", "A dessert", "Drinks"] },
    { name: "Brunch", theme: "Slow Sunday", lines: ["Coffee: Vietnamese phin, oat milk on the side", "Plates: Bánh mì scramble, sourdough toast", "Sweet: Pandan waffles"] },
    { name: "Bake and tea", theme: "Tea and cake", lines: ["Tea: Jasmine and genmaicha", "Bakes: Pandan chiffon, kaya toast", "Take home: A slice for later"] },
  ];
  const split = (l) => { const m = String(l).match(/^\s*([^:]{1,24}):\s*(.+)$/); return m ? { label: m[1].trim(), dish: m[2].trim() } : { label: "", dish: String(l).trim() }; };
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  function html({ theme = "", courses = [], note = "", tone } = {}) {
    const L = (courses || []).map(split).filter((x) => x.dish).slice(0, 8); if (!L.length) return "";
    const keys = Object.keys(TONES), t = TONES[tone] ? tone : keys[hash(theme + L[0].dish) % keys.length], [bg, ring, fin, acc] = TONES[t];
    const card = (x, i) => `<li class="mc-c" style="--i:${i}">${x.label ? `<small>${esc(x.label)}</small>` : ""}<b>${esc(x.dish)}</b></li>`;
    const badge = (sym, i) => `<li class="mc-b" aria-hidden="true"><span style="background:${BADGE[i % BADGE.length]}">${sym}</span></li>`;
    const parts = []; L.forEach((x, i) => { if (i) parts.push(badge("+", i - 1)); parts.push(card(x, i)); });
    parts.push(badge("=", L.length)); parts.push(`<li class="mc-c mc-fin" style="--i:${L.length};background:${fin};color:${acc}"><b>${esc(theme || "A very good night")}</b></li>`);
    return `<figure class="mc" style="--mc-bg:${bg};--mc-ring:${ring}"><figcaption class="mc-h">The menu</figcaption><ol class="mc-l">${parts.join("")}</ol>${note ? `<p class="mc-note">${esc(note)}</p>` : ""}</figure>`;
  }
  const CSS = `.mc{margin:14px 0 0;padding:22px 18px 20px;border-radius:22px;background-color:var(--mc-bg);background-image:linear-gradient(rgba(255,255,255,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.14) 1px,transparent 1px);background-size:100% 25%,16.66% 100%;font-family:"Instrument Sans","Inter",system-ui,sans-serif;color:#151515}
.mc-h{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;opacity:.85;text-align:center;margin:0 0 12px}
.mc-l{list-style:none;margin:0 auto;padding:0;max-width:460px;display:grid;justify-items:stretch}
.mc-c{background:#fff;border-radius:18px;padding:14px 18px;text-align:center;display:grid;gap:2px;transition:transform .35s cubic-bezier(.3,1.5,.5,1),box-shadow .3s;transition-delay:calc(var(--i) * 40ms)}
.mc-c small{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8A7D73}.mc-c b{font-size:var(--fs-16-20,16px);font-weight:700;letter-spacing:-.015em;line-height:1.2}
.mc-fin{transform:rotate(-2.2deg);margin-top:2px}.mc-fin b{font-size:var(--fs-16-20,16px)}
.mc-b{display:grid;place-items:center;height:22px;position:relative;z-index:1}.mc-b span{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 20px/1 system-ui;border:4px solid var(--mc-ring);transition:transform .4s cubic-bezier(.3,1.6,.5,1)}
.mc .mc-h{color:#fff!important}.mc .mc-b span{color:#fff!important}.mc .mc-fin b{color:inherit!important}.mc .mc-c b{color:#151515}.mc .mc-c small{color:#8A7D73!important}
.mc-note{margin:14px 0 0;text-align:center;color:#fff;font-weight:600;font-size:14px}
@media (hover:hover){.mc:hover .mc-c{transform:translateY(-2px);box-shadow:0 6px 16px -10px rgba(0,0,0,.45)}.mc:hover .mc-fin{transform:rotate(0deg) scale(1.02)}.mc:hover .mc-b span{transform:rotate(90deg)}}
@media (prefers-reduced-motion:reduce){.mc *{transition:none!important}}
.mc-tpl{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}.mc-tpl button{border:1px solid #E4D9C8;background:#fff;border-radius:999px;padding:5px 11px;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}.mc-tpl button:hover{border-color:#1F1A17}`;
  function ensureCss() { if (document.getElementById("mcCss")) return; const s = document.createElement("style"); s.id = "mcCss"; s.textContent = CSS; document.head.appendChild(s); }
  if (typeof document !== "undefined") ensureCss();
  // template chips for a courses textarea; onUse(template) is called after the textarea is filled
  function templates(onUse, hint = "") { const box = document.createElement("div"); box.className = "mc-tpl"; const h = String(hint).toLowerCase(), order = TEMPLATES.map((t, i) => i).sort((a, b) => (h.includes(TEMPLATES[b].name.toLowerCase().split(" ")[0]) || (TEMPLATES[b].name === "Friendsgiving" && /thanksgiving|friendsgiving|turkey/.test(h)) ? 1 : 0) - (h.includes(TEMPLATES[a].name.toLowerCase().split(" ")[0]) || (TEMPLATES[a].name === "Friendsgiving" && /thanksgiving|friendsgiving|turkey/.test(h)) ? 1 : 0));
    box.innerHTML = `<small style="width:100%;color:#7A6E64">Start from a template:</small>` + order.map((i) => `<button type="button" data-mct="${i}">${esc(TEMPLATES[i].name)}</button>`).join(""); box.addEventListener("click", (e) => { const b = e.target.closest("[data-mct]"); if (b) onUse(TEMPLATES[+b.dataset.mct]); }); return box; }
  // the template that fits an event best, from its name and activity (-1 when nothing clearly fits)
  const FIT = [[/thanksgiving|friendsgiving|turkey/, "Friendsgiving"], [/potluck|bring a dish/, "Potluck"], [/brunch/, "Brunch"], [/bake|cake|pastr|cookie|\btea\b|matcha|mochi|bánh/, "Bake and tea"], [/tasting|omakase|chef'?s table|kaiseki|degustation/, "Tasting menu"], [/dinner|supper|feast|cook/, "Three courses"]];
  function best(hint = "") { const h = String(hint).toLowerCase(); for (const [re, name] of FIT) if (re.test(h)) return TEMPLATES.findIndex((t) => t.name === name); return -1; }
  window.MenuCard = { html, templates, TEMPLATES, ensureCss, best };
})();
