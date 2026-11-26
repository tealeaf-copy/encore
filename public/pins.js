// PLPins: the map's small drawn objects. One per vibe (a teacup for cozy, a meeple for quiet and nerdy, a sneaker for
// active, a bowl and chopsticks for food, a pot on the wheel for making things, a spark for late night), drawn in ink
// on a 32 x 32 grid with the vibe's colour as a pencil fill, plus the line icons for the category chips.
// PLPins.object(vibe) -> <svg>, PLPins.pin(card, { exact, saved, went, selected }) -> the pin's HTML,
// PLPins.cat(id) -> a chip icon, PLPins.intro() -> the first-open drawing, PLPins.css() adds the pin styles once.
// Colours come from PLMapCore.VIBES (public/mapcore.js). Original drawings, made for Pottery Lab.
(function () {
  if (window.PLPins) return;
  const INK = "#1B1D1C";
  const S = `fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  const F = (d, fill = "var(--v)") => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const L = (d) => `<path d="${d}" ${S}/>`;
  const OBJ = {
    cozy: () => F("M8 13h14v4.6a7 7 0 0 1-14 0z") + L("M22 14.6h1.5a2.6 2.6 0 0 1 0 5.2h-2.1M5 25.6h20M12 9.6c-1-1.2 1-2.3 0-3.6M16.5 9.6c-1-1.2 1-2.3 0-3.6") + `<path d="M9.5 15.6h11" stroke="#FAF8F3" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>`,
    nerdy: () => F("M16 5.5a3.6 3.6 0 0 1 3.6 3.6c0 1.2-.5 2-1.2 2.6 2.6.5 7.4 1.6 7.4 3.8 0 1.6-2.6 1.6-4.6 1.4l3.8 7.6c.4.8-.1 1.5-1 1.5h-4.6L16 21.3l-3.4 4.7H8c-.9 0-1.4-.7-1-1.5l3.8-7.6c-2 .2-4.6.2-4.6-1.4 0-2.2 4.8-3.3 7.4-3.8-.7-.6-1.2-1.4-1.2-2.6A3.6 3.6 0 0 1 16 5.5z") + `<circle cx="14.6" cy="9" r=".7" fill="#FAF8F3"/><circle cx="17.4" cy="9" r=".7" fill="#FAF8F3"/>`,
    active: () => L("M5 21.5v-8.7c0-.7.6-1.2 1.3-1l3.2.9c.5 1.6 2 2.6 3.7 2.6 1 0 1.6-.3 2.2-.8l4.4 3.1c1.2.8 2.6 1.2 4 1.3l2.4.2c1.3.1 2.3 1.2 2.3 2.5v.9z") + F("M4.5 21.5h23.2v1.6c0 .8-.6 1.4-1.4 1.4H5.9c-.8 0-1.4-.6-1.4-1.4z") + L("M15.2 16.6l1.6-1.8M17.8 18.4l1.6-1.8M5 15.6h3"),
    food: () => L("M19.5 4.5l-5 11.5M24 6.2l-7.4 9.8") + F("M5 16h22c0 5-4.9 9-11 9S5 21 5 16z") + L("M12 25.6h8") + `<path d="M8.4 19.4h15.2" stroke="#FAF8F3" stroke-width="1.2" stroke-linecap="round" opacity=".75"/>`,
    make: () => F("M12.2 8.6c0 2.2-2.7 3.8-2.7 8S12 24 16 24s6.5-3.2 6.5-7.4-2.7-5.8-2.7-8z") + L("M11 8.6h10M5.5 26.4h21M9 24.4h14") + `<path d="M10.2 17.2h11.6" stroke="#FAF8F3" stroke-width="1.2" stroke-linecap="round" opacity=".75"/>`,
    late: () => F("M15 4.8c.9 5.2 2.8 7.1 8 8-5.2.9-7.1 2.8-8 8-.9-5.2-2.8-7.1-8-8 5.2-.9 7.1-2.8 8-8z") + F("M24.6 19.6c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5z") + `<circle cx="8.6" cy="24.4" r="1" fill="${INK}"/>`,
  };
  const CAT = {
    supper: L("M16 8.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM16 12a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM5 5.5v20M3.4 5.5v3.4c0 1.2.7 2 1.6 2.2M6.6 5.5v3.4c0 1.2-.7 2-1.6 2.2M27.5 5.5c-1.6 1.6-2.2 4.6-2.2 7.8h2.2v12.2"),
    games: L("M8.5 4.5h15a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4h-15a4 4 0 0 1-4-4v-15a4 4 0 0 1 4-4z") + `<circle cx="11" cy="11" r="1.5" fill="${INK}"/><circle cx="16" cy="16" r="1.5" fill="${INK}"/><circle cx="21" cy="21" r="1.5" fill="${INK}"/>`,
    run: L("M5 21.5v-8.7c0-.7.6-1.2 1.3-1l3.2.9c.5 1.6 2 2.6 3.7 2.6 1 0 1.6-.3 2.2-.8l4.4 3.1c1.2.8 2.6 1.2 4 1.3l2.4.2c1.3.1 2.3 1.2 2.3 2.5v.9zM4.5 21.5h23.2v1.6c0 .8-.6 1.4-1.4 1.4H5.9c-.8 0-1.4-.6-1.4-1.4zM15.2 16.6l1.6-1.8M17.8 18.4l1.6-1.8"),
    workshop: L("M9.5 19.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM22.5 19.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM11.8 20.4L23.5 5.5M20.2 20.4L8.5 5.5"),
    drop: L("M8 11.5h16l-1.3 15H9.3zM12 11.5V9.6a4 4 0 0 1 8 0v1.9M12.5 16.5c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2"),
    market: L("M5 12l2.6-6.5h16.8L27 12zM5 12a2.75 2.75 0 0 0 5.5 0 2.75 2.75 0 0 0 5.5 0 2.75 2.75 0 0 0 5.5 0 2.75 2.75 0 0 0 5.5 0M7 15v11M25 15v11M4.5 26.5h23M7 20.5h18"),
  };
  const svg = (inner, size) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">${inner}</svg>`;
  const colorOf = (id) => (window.PLMapCore?.vibe(id)?.color) || INK;
  /** The drawn object for a vibe, as an <svg>. size in px (default 32). */
  const object = (vibe, size = 32) => `<span style="--v:${colorOf(vibe)};display:contents">${svg((OBJ[vibe] || OBJ.cozy)(), size)}</span>`;
  const cat = (id, size = 18) => svg(CAT[id] || CAT.supper, size);
  /** A map pin's HTML. exact: a pin with a point (public venues); otherwise the object floats on its soft area circle. */
  function pin(c, o = {}) { const v = c.vibe || "cozy";
    return `<span class="plpin ${o.exact ? "plpin--exact" : "plpin--area"}${o.saved ? " is-saved" : ""}${o.went ? " is-went" : ""}${o.selected ? " is-sel" : ""}" style="--v:${colorOf(v)}" data-vibe="${v}"><span class="plpin-disc">${svg((OBJ[v] || OBJ.cozy)(), 26)}</span>${o.exact ? `<span class="plpin-tail" aria-hidden="true"></span>` : ""}${o.went ? `<span class="plpin-stamp" aria-hidden="true">${svg(L("M9 16.5l4.5 4.5L23 11.5"), 12)}</span>` : o.saved ? `<span class="plpin-tab" aria-hidden="true">${svg(`<path d="M10 6.5h12v19l-6-4.6-6 4.6z" fill="#F2DD6B" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`, 13)}</span>` : ""}</span>`; }
  // the first-open drawing: the objects around the wordmark, a dashed route between them, one soft area, one sticker
  function intro() { const at = (v, x, y, s, r) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})" style="--v:${colorOf(v)}">${(OBJ[v])()}</g>`;
    return `<svg viewBox="0 0 320 210" class="plmap-introart" role="img" aria-label="A hand-drawn map: a teacup, a meeple, a sneaker, a bowl with chopsticks, a pot and a spark around the words pottery lab">
<path class="pli-route" d="M48 58c30 6 44 30 78 26s52-36 96-30 58 34 60 62M52 160c34-4 50-26 86-22s40 26 84 24 46-22 58-26" fill="none" stroke="${INK}" stroke-width="1.3" stroke-dasharray="3 5" stroke-linecap="round" opacity=".55"/>
<circle cx="236" cy="150" r="30" fill="#C2431F" fill-opacity=".1" stroke="#C2431F" stroke-width="1.2" stroke-dasharray="3 3"/>
<text x="160" y="112" text-anchor="middle" font-family="'IBM Plex Serif',Georgia,serif" font-size="34" font-weight="600" fill="${INK}" letter-spacing="-.5">pottery lab</text>
<path d="M104 122c18 5 92 5 112 0" fill="none" stroke="#F2DD6B" stroke-width="7" stroke-linecap="round" opacity=".9"/>
<g class="pli-o">${at("cozy", 26, 36, 1.35, -8)}</g><g class="pli-o">${at("nerdy", 128, 20, 1.2, 6)}</g><g class="pli-o">${at("active", 250, 30, 1.4, -4)}</g>
<g class="pli-o"><rect x="34" y="140" width="50" height="50" rx="10" fill="#fff" stroke="${INK}" stroke-width="1.2" transform="rotate(-7 59 165)"/>${at("food", 39, 145, 1.25, -7)}</g>
<g class="pli-o">${at("late", 140, 152, 1.15, 10)}</g><g class="pli-o">${at("make", 220, 132, 1.25, -3)}</g>
<path d="M286 168l8 8m0-8l-8 8" stroke="#29489A" stroke-width="2" stroke-linecap="round"/>
</svg>`; }
  const CSS = `.plpin{position:relative;display:block;width:40px;height:40px;cursor:pointer;transform-origin:50% 100%;transition:transform .18s cubic-bezier(.3,1.5,.5,1)}
.plpin-disc{position:absolute;left:3px;top:0;width:34px;height:34px;border-radius:50%;background:#FAF8F3;border:1.5px solid ${INK};display:grid;place-items:center;box-sizing:border-box}
.plpin-disc svg{display:block}
.plpin-tail{position:absolute;left:50%;top:31px;width:10px;height:10px;margin-left:-5px;background:#FAF8F3;border-right:1.5px solid ${INK};border-bottom:1.5px solid ${INK};transform:rotate(45deg);box-sizing:border-box;border-bottom-right-radius:2px}
.plpin--exact{height:46px}.plpin--exact .plpin-disc{z-index:1}.plpin--exact .plpin-tail{z-index:0}
.plpin--area{transform-origin:50% 50%;height:34px}.plpin--area .plpin-disc{width:32px;height:32px;left:4px;border-style:solid;border-color:color-mix(in srgb,${INK} 70%,transparent)}
.plpin.is-saved .plpin-disc{box-shadow:0 0 0 3px #fff,0 0 0 4.5px ${INK};transform:rotate(-6deg)}
.plpin.is-went .plpin-disc{box-shadow:0 0 0 3px #fff,0 0 0 4.5px #56683F;transform:rotate(5deg)}
.plpin-tab{position:absolute;right:-4px;top:-7px;z-index:2;transform:rotate(8deg)}.plpin-tab svg{display:block}
.plpin-stamp{position:absolute;right:-5px;top:-6px;z-index:2;width:17px;height:17px;border-radius:50%;background:#E4E9DA;border:1.5px solid #56683F;display:grid;place-items:center}.plpin-stamp svg path{stroke:#3E5A2C;stroke-width:3}
.plpin.is-sel{transform:scale(1.2);z-index:5}.plpin.is-sel .plpin-disc,.plpin.is-sel .plpin-tail{background:#F2DD6B}
.plpin:hover{transform:scale(1.08)}.plpin.is-sel:hover{transform:scale(1.2)}
@media (prefers-reduced-motion:reduce){.plpin{transition:none}}`;
  const css = () => { if (document.getElementById("plPinsCss")) return; const s = document.createElement("style"); s.id = "plPinsCss"; s.textContent = CSS; document.head.appendChild(s); };
  window.PLPins = { object, pin, cat, intro, css, OBJ: Object.keys(OBJ), CATS: Object.keys(CAT) };
})();
