// Potto, Pottery Lab's mascot: a little clay pot with gloves and sneakers, drawn as a die-cut sticker (thick ink
// lines, flat colour, a white border around everything). Original drawing. Poses: wave, run, cheer, carry, sleep.
(function () {
  const INK = "#1F1A17", CLAY = "#D2603A", CLAY_D = "#B84A28", GLAZE = "#F2D48F", SHOE = "#8EC5E8", SOLE = "#E8835C";
  const body = `<path d="M82 40h36v9c0 6-6 9-6 15 0 6 36 15 36 52 0 27-21 43-50 43s-50-16-50-43c0-37 36-46 36-52 0-6-6-9-6-15z"/>`;
  const limb = (d, w = 11) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 5}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${CLAY}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const glove = (x, y, r = 11) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${INK}" stroke-width="4"/><path d="M${x - r * 0.22} ${y - r * 0.75}v${r * 0.55}M${x + r * 0.22} ${y - r * 0.75}v${r * 0.55}" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
  const shoe = (x, y, flip = 1) => `<path d="M${x - 14 * flip} ${y - 4}c0-9 ${22 * flip}-11 ${30 * flip}-2 4 4 2 10-4 10H${x - 10 * flip}c-3 0-4-4-4-8z" fill="${SHOE}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M${x - 14 * flip} ${y + 2}h${30 * flip}" stroke="${SOLE}" stroke-width="4" stroke-linecap="round"/>`;
  const face = (mood) => mood === "sleep"
    ? `<path d="M86 104c3 3 7 3 10 0M106 104c3 3 7 3 10 0" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M96 120c3 2 7 2 10 0" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none"/>`
    : `<ellipse cx="90" cy="102" rx="4.5" ry="8" fill="#fff"/><ellipse cx="112" cy="102" rx="4.5" ry="8" fill="#fff"/><path d="M${mood === "cheer" ? "90 117c5 9 17 9 22 0" : "92 118c4 5 14 5 18 0"}" stroke="#fff" stroke-width="4.5" stroke-linecap="round" fill="${mood === "cheer" ? "#fff" : "none"}"/>`;
  const glaze = `<path d="M54 132c12 8 26-4 46 2s34 6 46-2" fill="none" stroke="${GLAZE}" stroke-width="9" stroke-linecap="round"/>`;
  const POSES = {
    wave: { arms: limb("M58 118c-14 4-20 14-22 26") + limb("M142 112c14-8 20-24 22-38"), hands: glove(36, 146) + glove(165, 70), legs: limb("M88 156v22", 10) + limb("M112 156v22", 10), feet: shoe(84, 184, -1) + shoe(116, 184), extra: `<path d="M178 58l8-6M182 72l10 0M176 46l4-9" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` },
    run: { arms: limb("M58 116c-16-2-24 8-28 18") + limb("M142 116c14 10 26 8 34 0"), hands: glove(30, 136) + glove(178, 114), legs: limb("M88 154c-6 10-16 16-26 16", 10) + limb("M112 154c8 8 10 18 8 28", 10), feet: shoe(56, 172, -1) + shoe(124, 186), extra: `<path d="M8 96h26M14 112h18M4 128h22" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".8"/>` },
    cheer: { arms: limb("M58 112c-12-10-16-28-14-44") + limb("M142 112c12-10 16-28 14-44"), hands: glove(44, 64) + glove(156, 64), legs: limb("M88 156c-4 8-8 16-14 22", 10) + limb("M112 156c4 8 8 16 14 22", 10), feet: shoe(70, 184, -1) + shoe(130, 184), extra: `<path d="M30 40l6 10M44 30v12M58 36l-4 10M142 36l4 10M156 30v12M170 40l-6 10" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` },
    carry: { arms: limb("M58 118c-6 14 4 22 18 22") + limb("M142 118c6 14-4 22-18 22"), hands: glove(80, 140) + glove(120, 140), legs: limb("M88 160v18", 10) + limb("M112 160v18", 10), feet: shoe(84, 184, -1) + shoe(116, 184), extra: `<path d="M66 132h68l-6 18H72z" fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M76 132c0-12 48-12 48 0" fill="${GLAZE}" stroke="${INK}" stroke-width="4"/><circle cx="100" cy="117" r="5" fill="#E2455C" stroke="${INK}" stroke-width="3"/>`, over: true },
    sleep: { arms: limb("M60 124c-10 6-12 16-8 24") + limb("M140 124c10 6 12 16 8 24"), hands: glove(52, 150) + glove(148, 150), legs: limb("M88 158v18", 10) + limb("M112 158v18", 10), feet: shoe(84, 182, -1) + shoe(116, 182), extra: `<text x="140" y="44" font-family="Fredoka,system-ui" font-weight="700" font-size="22" fill="${INK}">z</text><text x="156" y="28" font-family="Fredoka,system-ui" font-weight="700" font-size="16" fill="${INK}">z</text>`, mood: "sleep" },
  };
  /** A sticker of Potto. size in px; label for screen readers. */
  function svg(pose = "wave", size = 140, label = "Potto, the Pottery Lab pot") {
    const P = POSES[pose] || POSES.wave, mood = P.mood || pose;
    const figure = `${P.legs}${P.feet}${P.arms}<g fill="${CLAY}" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round">${body}</g><path d="M78 40h44" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M84 46c-2 6 2 10 2 10" stroke="${CLAY_D}" stroke-width="4" fill="none" stroke-linecap="round"/>${glaze}${face(mood)}<ellipse cx="80" cy="114" rx="6" ry="3.5" fill="#F7A9B6" opacity=".8"/><ellipse cx="122" cy="114" rx="6" ry="3.5" fill="#F7A9B6" opacity=".8"/>${P.hands}${P.extra || ""}`;
    // the sticker: the same drawing traced underneath in thick white, so it reads as a die-cut sticker on any background
    return `<svg viewBox="-6 10 212 196" width="${size}" height="${size}" role="img" aria-label="${label}" style="overflow:visible"><g style="filter:drop-shadow(0 3px 0 rgba(31,26,23,.18))"><g stroke="#fff" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" fill="#fff">${figure.replace(/<text[^>]*>[^<]*<\/text>/g, "").replace(/stroke-width="[^"]*"/g, "").replace(/stroke="[^"]*"/g, "").replace(/fill="(?!none)[^"]*"/g, 'fill="#fff"')}</g>${figure}</g></svg>`;
  }
  window.Potto = { svg, poses: Object.keys(POSES) };
})();
