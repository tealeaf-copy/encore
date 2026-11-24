// Hand-drawn portraits hosts can pick for their storefront: thick ink, a little wobbly, always friendly.
// Original drawings. A portrait is stored as "style" or "style~skin~hair" (e.g. "braids~4~0"), so every place that
// draws one gets the chosen skin tone and hair colour without knowing about them. The accent colour shows up as a
// blush on the cheeks and on scarves and hats.
(function () {
  const INK = "#151515";
  const SKINS = [
    { c: "#FFFFFF", label: "Line art" }, { c: "#FBE3D0", label: "Light" }, { c: "#F1C6A0", label: "Light medium" },
    { c: "#D69E73", label: "Medium" }, { c: "#A8693F", label: "Medium deep" }, { c: "#6B4126", label: "Deep" },
  ];
  const HAIRS = [
    { c: INK, label: "Black" }, { c: "#4A2C1A", label: "Dark brown" }, { c: "#8A5A2B", label: "Brown" },
    { c: "#D9A441", label: "Blonde" }, { c: "#B5482A", label: "Red" }, { c: "#B9B4AE", label: "Grey" },
  ];
  const head = (s) => `<path d="M52 72 C49 110 52 148 59 171 C91 177 128 176 151 169 C157 139 157 104 152 68 C120 61 85 62 52 72 Z" fill="${s}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
  const ears = (s) => `<path d="M53 110 C37 106 35 132 55 133" fill="${s}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M151 108 C168 104 170 130 150 131" fill="${s}" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
  const EYES = [
    { label: "Round eyes", d: `<circle cx="83" cy="113" r="6.5" fill="${INK}"/><circle cx="124" cy="111" r="6.5" fill="${INK}"/>` },
    { label: "Almond eyes", d: `<path d="M73 114 C78 107 89 107 94 113 C88 117 78 117 73 114 Z M114 112 C119 105 130 105 135 111 C129 115 119 115 114 112 Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` },
    { label: "Smiling eyes", d: `<path d="M73 116 C78 106 89 106 94 116 M114 114 C119 104 130 104 135 114" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
    { label: "Big bright eyes", d: `<circle cx="83" cy="113" r="9" fill="${INK}"/><circle cx="124" cy="111" r="9" fill="${INK}"/><circle cx="86" cy="109" r="3" fill="#fff"/><circle cx="127" cy="107" r="3" fill="#fff"/>` },
    { label: "Lashes", d: `<circle cx="83" cy="113" r="6.5" fill="${INK}"/><circle cx="124" cy="111" r="6.5" fill="${INK}"/><path d="M76 107 L72 102 M83 105 L83 99 M131 105 L135 100 M124 103 L124 97" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` },
    { label: "Sleepy eyes", d: `<path d="M73 112 C78 119 89 119 94 112 M114 110 C119 117 130 117 135 110" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
  ];
  const NOSES = [
    { label: "Curved nose", d: `<path d="M105 117 C97 125 98 132 107 134" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
    { label: "Button nose", d: `<path d="M98 128 C101 134 110 134 113 128" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
    { label: "Wide nose", d: `<path d="M94 126 C90 134 98 137 104 133 C110 137 118 134 114 126 M104 118 L104 128" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` },
    { label: "Long nose", d: `<path d="M104 110 C100 120 98 130 101 134 C105 137 110 135 112 132" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
  ];
  const MOUTHS = [
    { label: "Big smile", d: `<path d="M76 145 C88 166 122 167 137 143 C118 149 95 150 76 145 Z" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M90 157 C100 162 113 162 123 156" fill="none" stroke="#F28B9B" stroke-width="5" stroke-linecap="round"/>` },
    { label: "Soft smile", d: `<path d="M82 148 C94 160 116 160 128 146" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
    { label: "Toothy grin", d: `<path d="M76 145 C88 166 122 167 137 143 C118 149 95 150 76 145 Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M80 150 C98 154 118 153 134 148" fill="none" stroke="${INK}" stroke-width="3"/>` },
    { label: "Smirk", d: `<path d="M86 152 C100 156 116 152 128 142" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>` },
    { label: "Lipstick smile", d: `<path d="M80 146 C90 162 120 162 132 144 C118 150 94 151 80 146 Z" fill="#C2414B" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>` },
  ];
  const EXTRAS = [
    { label: "Nothing extra", d: "" },
    { label: "Freckles", d: `<g fill="#9A5B3C" opacity=".8"><circle cx="66" cy="126" r="2.4"/><circle cx="74" cy="130" r="2.4"/><circle cx="64" cy="134" r="2.4"/><circle cx="142" cy="123" r="2.4"/><circle cx="134" cy="127" r="2.4"/><circle cx="144" cy="131" r="2.4"/></g>` },
    { label: "Round glasses", d: `<circle cx="83" cy="113" r="17" fill="none" stroke="${INK}" stroke-width="5"/><circle cx="124" cy="111" r="17" fill="none" stroke="${INK}" stroke-width="5"/><path d="M100 112 C103 109 105 109 107 111" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` },
    { label: "Square glasses", d: `<rect x="66" y="100" width="34" height="25" rx="5" fill="none" stroke="${INK}" stroke-width="5"/><rect x="108" y="98" width="34" height="25" rx="5" fill="none" stroke="${INK}" stroke-width="5"/><path d="M100 111 L108 110" stroke="${INK}" stroke-width="5"/>` },
    { label: "Hoop earrings", d: `<circle cx="47" cy="140" r="9" fill="none" stroke="#D9A441" stroke-width="4.5"/><circle cx="162" cy="138" r="9" fill="none" stroke="#D9A441" stroke-width="4.5"/>` },
    { label: "Mustache", d: `<path d="M80 141 C88 132 100 134 105 139 C110 133 122 131 130 140 C120 142 112 143 105 141 C97 144 88 144 80 141 Z" fill="__HAIR__" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` },
    { label: "Beauty mark", d: `<circle cx="134" cy="140" r="3" fill="${INK}"/>` },
  ];
  const FEATURES = { eyes: EYES, nose: NOSES, mouth: MOUTHS, extra: EXTRAS };
  const ORDER = ["skin", "hair", "eyes", "nose", "mouth", "extra"];
  const cheeks = (a) => `<ellipse cx="70" cy="134" rx="9" ry="5" fill="${a}" opacity=".35"/><ellipse cx="140" cy="131" rx="9" ry="5" fill="${a}" opacity=".35"/>`;
  const line = (h) => (h === INK ? "" : ` stroke="${INK}" stroke-width="5" stroke-linejoin="round"`); // coloured hair gets an ink outline so it reads as a drawing
  const hairShort = (h) => `<path d="M50 84 C46 44 92 30 122 38 C146 44 160 58 156 86 C146 74 132 68 120 70 C112 80 96 84 82 80 C74 72 62 76 50 84 Z" fill="${h}"${line(h)}/>`;
  const hairLong = (h) => `<path d="M48 120 C38 70 58 34 104 32 C150 34 170 70 160 122 L162 176 C150 172 150 150 150 122 C150 96 142 80 128 74 C112 84 90 86 70 80 C60 92 56 106 58 124 C58 150 58 170 46 176 Z" fill="${h}"${line(h)}/>`;
  const hairBob = (h) => `<path d="M46 132 C40 64 70 34 104 34 C140 34 168 64 162 132 C152 132 150 118 150 100 C150 86 140 76 126 72 C110 82 86 84 66 78 C58 88 56 104 58 132 Z" fill="${h}"${line(h)}/>`;
  const curlTop = (h) => `<g fill="${h}"${line(h)}><circle cx="62" cy="70" r="16"/><circle cx="82" cy="52" r="18"/><circle cx="106" cy="46" r="19"/><circle cx="130" cy="52" r="18"/><circle cx="148" cy="70" r="16"/><circle cx="54" cy="92" r="12"/><circle cx="156" cy="92" r="12"/></g>`;
  const cap = (h) => `<path d="M50 92 C48 50 80 34 104 34 C130 34 160 50 156 92 C150 78 128 72 104 74 C80 72 58 78 50 92 Z" fill="${h}"${line(h)}/>`;
  const flower = `<g transform="translate(140 56)"><circle r="7" cx="0" cy="-9" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="7" cx="9" cy="0" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="7" cx="0" cy="9" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="7" cx="-9" cy="0" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="5" fill="#F2D48F" stroke="${INK}" stroke-width="3"/></g>`;
  const glassesOver = `<circle cx="83" cy="113" r="17" fill="none" stroke="${INK}" stroke-width="5"/><circle cx="124" cy="111" r="17" fill="none" stroke="${INK}" stroke-width="5"/><path d="M100 112 C103 109 105 109 107 111" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  // a soft tint of the accent for fabric, so scarves and hats stay light enough for the ink lines
  const tint = (a) => { const m = /^#([0-9a-f]{6})$/i.exec(a || ""); if (!m) return "#F3D9C8"; const n = parseInt(m[1], 16), mix = (v) => Math.round(v + (255 - v) * 0.55); return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`; };

  const ART = {
    florist: { label: "Long hair and a flower", draw: (h) => hairLong(h), over: () => flower },
    straight: { label: "Long hair", draw: (h) => hairLong(h) },
    bob: { label: "The bob", draw: (h) => hairBob(h) },
    pixie: { label: "Pixie cut", draw: (h) => `<path d="M48 98 C40 50 86 30 120 36 C150 42 164 64 156 96 C150 80 140 72 130 70 C110 86 76 92 58 86 C54 90 50 92 48 98 Z" fill="${h}"${line(h)}/>` },
    bun: { label: "Top bun", draw: (h) => `<circle cx="104" cy="32" r="20" fill="${h}"${line(h)}/><path d="M50 90 C46 50 80 38 104 38 C130 38 162 50 156 90 C150 76 132 68 104 68 C78 68 58 76 50 90 Z" fill="${h}"${line(h)}/>` },
    ponytail: { label: "Ponytail", under: (h) => `<path d="M146 66 C186 62 196 122 170 158 C166 134 158 112 146 98 Z" fill="${h}"${line(h)}/>`, draw: (h) => cap(h) },
    curls: { label: "Curls", draw: (h) => curlTop(h) },
    waves: { label: "Long curls", under: (h) => `<g fill="${h}"${line(h)}><circle cx="52" cy="112" r="17"/><circle cx="48" cy="138" r="16"/><circle cx="52" cy="162" r="15"/><circle cx="156" cy="110" r="17"/><circle cx="160" cy="136" r="16"/><circle cx="156" cy="160" r="15"/></g>`, draw: (h) => curlTop(h) },
    afro: { label: "Afro", under: (h) => `<g fill="${h}"${line(h)}><circle cx="174" cy="84" r="20"/><circle cx="169" cy="109" r="20"/><circle cx="153" cy="131" r="20"/><circle cx="131" cy="145" r="20"/><circle cx="104" cy="150" r="20"/><circle cx="77" cy="145" r="20"/><circle cx="55" cy="131" r="20"/><circle cx="39" cy="109" r="20"/><circle cx="34" cy="84" r="20"/><circle cx="39" cy="59" r="20"/><circle cx="55" cy="37" r="20"/><circle cx="77" cy="23" r="20"/><circle cx="104" cy="18" r="20"/><circle cx="131" cy="23" r="20"/><circle cx="153" cy="37" r="20"/><circle cx="169" cy="59" r="20"/></g><ellipse cx="104" cy="84" rx="72" ry="68" fill="${h}"/>`, draw: (h) => `<path d="M50 86 C56 58 152 54 158 86 C130 74 80 74 50 86 Z" fill="${h}"/>` },
    braids: { label: "Braids", under: (h) => `<path d="M40 100 C36 58 68 28 104 28 C142 28 174 58 170 100 L180 188 L136 188 L144 124 L66 124 L74 188 L28 188 Z" fill="${h}"${line(h)}/><path d="M38 128 L34 182 M50 128 L48 184 M62 128 L62 184 M146 128 L146 184 M158 128 L160 184 M170 128 L174 182" stroke="#fff" stroke-width="3" stroke-dasharray="7 6" opacity=".55" fill="none"/>`, draw: (h) => `${cap(h)}<path d="M104 36 L104 72" stroke="#fff" stroke-width="3" opacity=".6"/>` },
    locs: { label: "Locs", under: (h) => `<g stroke="${h}" stroke-width="13" stroke-linecap="round" fill="none"><path d="M52 90 C44 120 46 150 42 176"/><path d="M64 80 C58 116 62 150 60 170"/><path d="M146 80 C150 116 148 150 150 170"/><path d="M158 90 C166 120 164 150 168 176"/></g>`, draw: (h) => `<path d="M50 90 C46 50 80 36 104 36 C130 36 160 50 156 90 C140 74 70 74 50 90 Z" fill="${h}"${line(h)}/>` },
    hijab: { label: "Hijab", noEars: true, under: (h, a) => `<path d="M30 190 C26 150 34 120 40 96 C44 46 76 22 105 22 C136 22 166 46 168 96 C174 122 182 152 178 190 Z" fill="${tint(a)}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`, draw: (h, a) => `<path d="M46 124 C42 74 70 50 104 50 C140 50 166 74 160 124 C156 98 140 80 104 78 C70 80 52 98 46 124 Z" fill="${tint(a)}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` },
    headwrap: { label: "Head wrap", draw: (h, a) => `<path d="M46 90 C28 40 70 4 104 10 C146 4 182 44 160 90 C130 76 80 76 46 90 Z" fill="${tint(a)}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M70 40 C92 56 118 56 140 36 M82 22 C96 34 116 34 128 20" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` },
    beanie: { label: "Beanie", draw: (h, a) => `<path d="M48 84 C44 36 164 32 158 82 Z" fill="${tint(a)}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M44 78 C90 68 122 68 162 76 L162 96 C122 88 90 88 44 98 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><circle cx="104" cy="28" r="12" fill="${tint(a)}" stroke="${INK}" stroke-width="6"/>` },
    beard: { label: "Beard", draw: (h) => hairShort(h), over: (h) => `<path fill-rule="evenodd" d="M56 126 C56 162 80 186 106 186 C132 186 154 162 152 124 C146 140 136 146 128 140 C116 134 96 134 84 142 C74 148 62 142 56 126 Z M74 152 C86 170 124 170 138 150 C124 142 90 142 74 152 Z" fill="${h}"${line(h)}/>` },
    shaved: { label: "Shaved head", draw: () => `<path d="M70 82 C80 74 92 72 102 72" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" opacity=".5"/>` },
    chef: { label: "The chef", draw: (h) => `${hairShort(h)}<path d="M47 77 C90 64 124 64 159 72 L158 91 C124 84 90 84 48 95 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><circle cx="164" cy="81" r="7" fill="#fff" stroke="${INK}" stroke-width="5"/><path d="M169 78 L186 68 M170 85 L188 92" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` },
    runner: { label: "The runner", draw: (h) => `${hairShort(h)}<path d="M150 64 C178 62 190 92 174 122" fill="none" stroke="${h}" stroke-width="15" stroke-linecap="round"/><path d="M49 82 C90 72 124 71 157 78" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 10"/>` },
    barista: { label: "The barista", draw: (h) => `<circle cx="104" cy="38" r="19" fill="${h}"${line(h)}/>${hairShort(h)}` },
    baker: { label: "The baker", draw: () => `<path d="M60 72 C38 68 38 36 64 34 C64 12 100 6 108 24 C121 8 154 16 148 40 C168 42 168 68 150 72 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M58 70 L151 70 L151 88 C120 84 90 84 58 90 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` },
    glasses: { label: "The bookworm", draw: (h) => hairShort(h), over: () => glassesOver },
    hiker: { label: "The hiker", draw: (h) => `<path d="M48 86 C46 34 158 30 158 84 Z" fill="${h}"/><path d="M46 80 C90 70 122 70 160 78 L160 94 C122 88 90 88 46 96 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><circle cx="104" cy="30" r="12" fill="#fff" stroke="${INK}" stroke-width="6"/>` },
  };
  /** "braids~4~1" -> { style: "braids", skin: 4, hair: 1 }; unknown parts fall back to the defaults. */
  /** "braids~4~1~2~0~1~3": style, then skin, hair, eyes, nose, mouth, extra. Missing or unknown parts are 0. */
  const SIZES = { skin: SKINS.length, hair: HAIRS.length, eyes: EYES.length, nose: NOSES.length, mouth: MOUTHS.length, extra: EXTRAS.length };
  function parse(key) { const [style, ...rest] = String(key || "").split("~"), out = { style }; ORDER.forEach((k, i) => { const v = rest[i]; out[k] = /^\d$/.test(v || "") && +v < SIZES[k] ? +v : 0; }); return out; }
  /** make("braids", { skin: 4, eyes: 2 }) or the older make("braids", skin, hair) */
  function make(style, a, b) { const p = typeof a === "object" && a ? a : { skin: a, hair: b }; const nums = ORDER.map((k) => +p[k] || 0); while (nums.length && !nums[nums.length - 1]) nums.pop(); return nums.length ? [style, ...nums].join("~") : style; }
  function valid(key) { return key === "" || (/^[a-z]+(~\d){0,6}$/.test(String(key)) && !!ART[parse(key).style]); }
  function svg(key, accent = "#E26D8E", size = 120) {
    const p = parse(key), A = ART[p.style]; if (!A) return ""; const s = SKINS[p.skin].c, h = HAIRS[p.hair].c, mouth = MOUTHS[p.mouth].d, extra = EXTRAS[p.extra].d.replace("__HAIR__", h);
    return `<svg viewBox="20 0 180 190" width="${size}" height="${size}" style="width:100%;height:100%;max-width:${size}px;max-height:${size}px" role="img" aria-label="${A.label}"><circle cx="105" cy="98" r="96" fill="#fff"/>${A.under ? A.under(h, accent) : ""}${A.noEars ? "" : ears(s)}${head(s)}${A.draw(h, accent)}${EYES[p.eyes].d}${NOSES[p.nose].d}${mouth}${cheeks(accent)}${extra}${A.over ? A.over(h, accent) : ""}</svg>`;
  }
  window.EncoreAvatars = { ART, SKINS, HAIRS, FEATURES, svg, parse, make, valid, keys: Object.keys(ART) };
})();
