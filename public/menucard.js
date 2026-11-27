// Menu card for food experiences: a ruled notebook card, each course on its own numbered line, signed off with the
// night's theme. Lines can be "To start: Pandan madeleines" (label: dish) or just the dish. Used on guest pages, host storefronts
// and as a live preview in the host kit, with a few templates to start from.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
  // ---- the harvest card (the Pantry look): cream paper, a dense band of leaves, pinecones and berries top and bottom,
  // a bold stamped title, the dishes stacked and centred on a soft tinted panel, and a price line that can carry tiers ----
  const HV = { maple: "M0-16 3-9 8-12 7-5 14-6 10 0 13 3 6 4 7 9 1 6 0 14-1 6-7 9-6 4-13 3-10 0-14-6-7-5-8-12-3-9Z", leaf: "M0-15C8-9 9 5 0 15-9 5-8-9 0-15Z" };
  function band() { // one 260 x 72 tile, repeated across the card; every piece drawn here (original)
    const leaf = (x, y, r, k, c, maple) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k})"><path d="${maple ? HV.maple : HV.leaf}" fill="${c}" stroke-linejoin="round"/><path d="${maple ? "M0 14V-11M0 3 8-5M0 3-8-5M0-3 4-10M0-3-4-10" : "M0 13V-12M0 2 5-3M0 2-5-3M0 8 4 4M0 8-4 4"}" stroke="#5B2A12" stroke-opacity=".45" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M0 14v7" stroke="#6B4A2E" stroke-width="1.6" stroke-linecap="round"/></g>`;
    const cone = (x, y, r) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0-15v-5" stroke="#6B4A2E" stroke-width="2" stroke-linecap="round"/><ellipse rx="8.5" ry="14" fill="#8A5528"/>${[-9, -4, 1, 6, 11].map((v, i) => `<path d="M${-7 + Math.abs(i - 2)} ${v}q${7 - Math.abs(i - 2)} 4.5 ${14 - Math.abs(i - 2) * 2} 0" fill="none" stroke="#5A3416" stroke-width="1.6" stroke-linecap="round"/>`).join("")}</g>`;
    const berries = (x, y) => `<g transform="translate(${x} ${y})"><path d="M0-12 1-2M1-2-5 1M1-2 7 2" stroke="#6B4A2E" stroke-width="1.4" fill="none" stroke-linecap="round"/>${[[0, 0], [-6, 3], [6, 4], [0, 7], [-3, -4]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="4" fill="#A3242A"/><circle cx="${a - 1.2}" cy="${b - 1.3}" r="1.1" fill="#F6C9BE"/>`).join("")}</g>`;
    const twig = (x, y, r) => `<path transform="translate(${x} ${y}) rotate(${r})" d="M-16 0q10-3 32 0M-6-1l-5-6M6 0l5-6" stroke="#6B4A2E" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
    const g = [twig(40, 40, -8), twig(170, 30, 10), twig(230, 48, -14),
      leaf(16, 30, -30, 1.15, "#B5541C", 1), leaf(46, 50, 25, 0.9, "#D99A2B"), cone(74, 28, -18), leaf(100, 48, 40, 1.05, "#8E2A1E", 1), berries(124, 26),
      leaf(146, 50, -20, 0.95, "#6E7B2F"), leaf(170, 24, 15, 1.1, "#D99A2B", 1), cone(198, 46, 22), leaf(222, 26, -40, 0.85, "#B5541C"), berries(244, 50), leaf(252, 20, 30, 0.8, "#6E7B2F")].join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="72" viewBox="0 0 260 72">${g}</svg>`; }
  let bandUrl = ""; const bandBg = () => bandUrl || (bandUrl = `url("data:image/svg+xml,${encodeURIComponent(band())}")`);
  let slabOn = false; const slab = () => { if (slabOn || typeof document === "undefined") return; slabOn = true; const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@600;700&display=swap"; document.head.appendChild(l); };
  /** The harvest card: courses ("Main: Roast squash") and/or items ([{ name, price }]), a title, and a price line. */
  function harvest({ theme = "", courses = [], items = [], note = "", price = "" } = {}) {
    const L = [...(courses || []).map(split).filter((x) => x.dish), ...(items || []).filter((x) => x && x.name).map((x) => ({ label: "", dish: String(x.name), price: +x.price > 0 ? +x.price : 0 }))].slice(0, 10); if (!L.length) return "";
    ensureCss(); slab(); const amt = (n) => "$" + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n)));
    return `<figure class="mc-hv"><span class="mh-band t" aria-hidden="true"></span><figcaption><small>The menu</small><b class="mh-title">${esc(theme || "Supper")}</b></figcaption>`
      + `<div class="mh-panel"><ol class="mh-l">${L.map((x) => `<li>${x.label ? `<small>${esc(x.label)}</small>` : ""}<b>${esc(x.dish)}</b>${x.price ? `<span>${esc(amt(x.price))}</span>` : ""}</li>`).join(`<li class="mh-dot" aria-hidden="true">❦</li>`)}</ol></div>`
      + `${price ? `<p class="mh-price">${esc(price)}</p>` : ""}${note ? `<p class="mh-note">${esc(note)}</p>` : ""}<span class="mh-band b" aria-hidden="true"></span></figure>`; }
  const HV_CSS = `.mc-hv{position:relative;margin:16px 0 0;padding:84px 20px 86px;border-radius:16px;background:#FBF4E4;color:#2B1D12;text-align:center;box-shadow:0 1px 0 rgba(90,60,30,.12),0 18px 36px -24px rgba(74,42,18,.55);border:1px solid #E9D9B8;font-family:var(--kit-body,"IBM Plex Sans",system-ui,sans-serif);overflow:hidden}
.mc-hv .mh-band{position:absolute;left:0;right:0;height:72px;background-repeat:repeat-x;background-size:260px 72px;pointer-events:none}.mc-hv .mh-band.t{top:6px}.mc-hv .mh-band.b{bottom:6px;transform:scaleY(-1)}
.mc-hv figcaption{display:grid;gap:4px;margin:0 0 14px}.mc-hv figcaption small{font:700 13px/1 var(--kit-body,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:.22em;text-transform:uppercase;color:#6B4E36}
.mc-hv .mh-title{font:700 clamp(28px,7vw,40px)/1 var(--kit-display,"Zilla Slab",Rockwell,"Roboto Slab",Georgia,serif);letter-spacing:.04em;text-transform:uppercase;color:#3B2414;text-shadow:1px 1px 0 rgba(59,36,20,.12)}
.mc-hv .mh-panel{max-width:440px;margin:0 auto;background:#F3E3C4;border-radius:12px;padding:16px 16px 14px;box-shadow:inset 0 0 0 1px rgba(107,78,54,.18)}
.mc-hv .mh-l{list-style:none;margin:0;padding:0;display:grid;gap:4px}.mc-hv .mh-l li{display:grid;gap:2px}.mc-hv .mh-l small{font:700 13px/1.2 var(--kit-body,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:.12em;text-transform:uppercase;color:#6B4E36}
.mc-hv .mh-l b{font:500 17px/1.35 var(--kit-body,"Zilla Slab",Georgia,serif);color:#2B1D12}.mc-hv .mh-l span{font:600 14px var(--kit-body,"IBM Plex Sans",system-ui,sans-serif);color:#6B4E36}.mc-hv .mh-l .mh-dot{color:#8A3414;font-size:14px;line-height:1;opacity:.8}
.mc-hv .mh-price{margin:16px 0 0;font:700 17px/1.35 var(--kit-body,"Zilla Slab",Georgia,serif);font-variant-numeric:tabular-nums;color:#8A3414;letter-spacing:.02em}.mc-hv .mh-note{margin:6px 0 0;font-size:14px;color:#6B4E36}
html body .mc-hv .mh-l b{color:#2B1D12!important}html body .mc-hv .mh-l small,html body .mc-hv figcaption small,html body .mc-hv .mh-note{color:#6B4E36!important}html body .mc-hv .mh-title{color:#3B2414!important}html body .mc-hv .mh-price{color:#8A3414!important}
@media (max-width:480px){.mc-hv{padding:76px 14px 78px}.mc-hv .mh-band{height:64px;background-size:232px 64px}}`;
  function html({ theme = "", courses = [], note = "", style = "", items = [], price = "" } = {}) {
    if (style === "harvest") return harvest({ theme, courses, items, note, price });
    const L = (courses || []).map(split).filter((x) => x.dish).slice(0, 8); if (!L.length) return "";
    // the house card is a page from the notebook: ruled lines, numbered courses, the theme signed off underneath. It
    // uses the page's own tokens, so on a host's page with a brand kit it wears their ink and accent (review round 18;
    // it was a plum card with coloured dots).
    const card = (x, i) => `<li class="mc-c"><span class="mc-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div>${x.label ? `<small>${esc(x.label)}</small>` : ""}<b>${esc(x.dish)}</b></div></li>`;
    return `<figure class="mc"><figcaption class="mc-h">The menu</figcaption><ol class="mc-l">${L.map(card).join("")}</ol>${theme ? `<p class="mc-fin">${esc(theme)}</p>` : ""}${note ? `<p class="mc-note">${esc(note)}</p>` : ""}</figure>`;
  }
  const CSS = `.mc{margin:14px 0 0;padding:16px 16px 14px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);font-family:var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-align:left}
.mc .mc-h{font:500 13px/1 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--pl-accent-text,#29489A)!important;margin:0 0 8px}
.mc-l{list-style:none;margin:0;padding:0}
.mc-c{display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;align-items:baseline;padding:10px 0;border-top:1px dashed var(--pl-line,#CFC8B9)}
.mc .mc-n{font:500 13px/1.5 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);color:var(--pl-soft,#444845)!important}
.mc .mc-c small{display:block;font:500 13px/1.4 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.06em;text-transform:uppercase;color:var(--pl-soft,#444845)!important}
.mc .mc-c b{display:block;font-weight:600;font-size:16px;line-height:1.35;color:var(--pl-ink,#1B1D1C)!important}
.mc .mc-fin{margin:0;padding:12px 0 2px;border-top:1.5px solid var(--pl-line-strong,#1B1D1C);font:500 24px/1.2 var(--pl-font-display,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:-.01em;color:var(--pl-ink,#1B1D1C)!important}
.mc .mc-note{margin:8px 0 0;font-size:14px;line-height:1.45;color:var(--pl-soft,#444845)!important}
.mc-tpl{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}.mc-tpl button{border:1px solid #E4D9C8;background:#fff;border-radius:999px;padding:5px 11px;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}.mc-tpl button:hover{border-color:#1F1A17}`;
  function ensureCss() { if (typeof document === "undefined" || document.getElementById("mcCss")) return; const s = document.createElement("style"); s.id = "mcCss"; s.textContent = CSS + HV_CSS.replace(/\.mc-hv \.mh-band\{/, `.mc-hv .mh-band{background-image:${bandBg()};`); document.head.appendChild(s); }
  if (typeof document !== "undefined") ensureCss();
  // template chips for a courses textarea; onUse(template) is called after the textarea is filled
  function templates(onUse, hint = "") { const box = document.createElement("div"); box.className = "mc-tpl"; const h = String(hint).toLowerCase(), order = TEMPLATES.map((t, i) => i).sort((a, b) => (h.includes(TEMPLATES[b].name.toLowerCase().split(" ")[0]) || (TEMPLATES[b].name === "Friendsgiving" && /thanksgiving|friendsgiving|turkey/.test(h)) ? 1 : 0) - (h.includes(TEMPLATES[a].name.toLowerCase().split(" ")[0]) || (TEMPLATES[a].name === "Friendsgiving" && /thanksgiving|friendsgiving|turkey/.test(h)) ? 1 : 0));
    box.innerHTML = `<small style="width:100%;color:#7A6E64">Start from a template:</small>` + order.map((i) => `<button type="button" data-mct="${i}">${esc(TEMPLATES[i].name)}</button>`).join(""); box.addEventListener("click", (e) => { const b = e.target.closest("[data-mct]"); if (b) onUse(TEMPLATES[+b.dataset.mct]); }); return box; }
  // the template that fits an event best, from its name and activity (-1 when nothing clearly fits)
  const FIT = [[/thanksgiving|friendsgiving|turkey/, "Friendsgiving"], [/potluck|bring a dish/, "Potluck"], [/brunch/, "Brunch"], [/bake|cake|pastr|cookie|\btea\b|matcha|mochi|bánh/, "Bake and tea"], [/tasting|omakase|chef'?s table|kaiseki|degustation/, "Tasting menu"], [/dinner|supper|feast|cook/, "Three courses"]];
  function best(hint = "") { const h = String(hint).toLowerCase(); for (const [re, name] of FIT) if (re.test(h)) return TEMPLATES.findIndex((t) => t.name === name); return -1; }
  window.MenuCard = { html, harvest, band, templates, TEMPLATES, ensureCss, best };
})();
