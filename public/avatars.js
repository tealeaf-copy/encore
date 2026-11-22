// Hand-drawn portraits hosts can pick for their storefront: thick ink, a little wobbly, always friendly.
// Original drawings; the accent colour shows up only as a blush on the cheeks.
(function () {
  const INK = "#151515";
  const head = `<path d="M52 72 C49 110 52 148 59 171 C91 177 128 176 151 169 C157 139 157 104 152 68 C120 61 85 62 52 72 Z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
  const ears = `<path d="M53 110 C37 106 35 132 55 133" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M151 108 C168 104 170 130 150 131" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
  const eyes = `<circle cx="83" cy="113" r="6.5" fill="${INK}"/><circle cx="124" cy="111" r="6.5" fill="${INK}"/>`;
  const nose = `<path d="M105 117 C97 125 98 132 107 134" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>`;
  const smile = `<path d="M76 145 C88 166 122 167 137 143 C118 149 95 150 76 145 Z" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M90 157 C100 162 113 162 123 156" fill="none" stroke="#F28B9B" stroke-width="5" stroke-linecap="round"/>`;
  const cheeks = (a) => `<ellipse cx="70" cy="134" rx="9" ry="5" fill="${a}" opacity=".35"/><ellipse cx="140" cy="131" rx="9" ry="5" fill="${a}" opacity=".35"/>`;
  const hairShort = `<path d="M50 84 C46 44 92 30 122 38 C146 44 160 58 156 86 C146 74 132 68 120 70 C112 80 96 84 82 80 C74 72 62 76 50 84 Z" fill="${INK}"/>`;
  const hairLong = `<path d="M48 120 C38 70 58 34 104 32 C150 34 170 70 160 122 L162 176 C150 172 150 150 150 122 C150 96 142 80 128 74 C112 84 90 86 70 80 C60 92 56 106 58 124 C58 150 58 170 46 176 Z" fill="${INK}"/>`;
  const hairBob = `<path d="M46 132 C40 64 70 34 104 34 C140 34 168 64 162 132 C152 132 150 118 150 100 C150 86 140 76 126 72 C110 82 86 84 66 78 C58 88 56 104 58 132 Z" fill="${INK}"/>`;
  const hairCurly = `<g fill="${INK}"><circle cx="62" cy="70" r="16"/><circle cx="82" cy="52" r="18"/><circle cx="106" cy="46" r="19"/><circle cx="130" cy="52" r="18"/><circle cx="148" cy="70" r="16"/><circle cx="54" cy="92" r="12"/><circle cx="156" cy="92" r="12"/></g>`;
  const ART = {
    florist: { label: "The florist", draw: () => `${hairLong}`, over: () => `<g transform="translate(140 56)"><circle r="7" cx="0" cy="-9" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="7" cx="9" cy="0" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="7" cx="0" cy="9" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="7" cx="-9" cy="0" fill="#F7A9B6" stroke="${INK}" stroke-width="3"/><circle r="5" fill="#F2D48F" stroke="${INK}" stroke-width="3"/></g>` },
    curls: { label: "Curls", draw: () => hairCurly },
    bob: { label: "The bob", draw: () => hairBob },
    chef: { label: "The chef", draw: () => `${hairShort}<path d="M47 77 C90 64 124 64 159 72 L158 91 C124 84 90 84 48 95 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><circle cx="164" cy="81" r="7" fill="#fff" stroke="${INK}" stroke-width="5"/><path d="M169 78 L186 68 M170 85 L188 92" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>` },
    runner: { label: "The runner", draw: () => `${hairShort}<path d="M150 64 C178 62 190 92 174 122" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/><path d="M49 82 C90 72 124 71 157 78" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 10"/>` },
    barista: { label: "The barista", draw: () => `<circle cx="104" cy="38" r="19" fill="${INK}"/>${hairShort}` },
    baker: { label: "The baker", draw: () => `<path d="M60 72 C38 68 38 36 64 34 C64 12 100 6 108 24 C121 8 154 16 148 40 C168 42 168 68 150 72 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><path d="M58 70 L151 70 L151 88 C120 84 90 84 58 90 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` },
    glasses: { label: "The bookworm", draw: () => `${hairShort}`, over: () => `<circle cx="83" cy="113" r="17" fill="none" stroke="${INK}" stroke-width="5"/><circle cx="124" cy="111" r="17" fill="none" stroke="${INK}" stroke-width="5"/><path d="M100 112 C103 109 105 109 107 111" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` },
    hiker: { label: "The hiker", draw: () => `<path d="M48 86 C46 34 158 30 158 84 Z" fill="${INK}"/><path d="M46 80 C90 70 122 70 160 78 L160 94 C122 88 90 88 46 96 Z" fill="#fff" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/><circle cx="104" cy="30" r="12" fill="#fff" stroke="${INK}" stroke-width="6"/>` },
  };
  function svg(key, accent = "#E26D8E", size = 120) { const A = ART[key]; if (!A) return ""; return `<svg viewBox="20 0 180 190" width="${size}" height="${size}" style="width:100%;height:100%;max-width:${size}px;max-height:${size}px" role="img" aria-label="${A.label}"><circle cx="105" cy="98" r="96" fill="#fff"/>${ears}${head}${A.draw()}${eyes}${nose}${smile}${cheeks(accent)}${A.over ? A.over() : ""}</svg>`; }
  window.EncoreAvatars = { ART, svg, keys: Object.keys(ART) };
})();
