// Drawn previews of personalized gifts: a mug with a name pressed into the clay, a loaf with initials scored in the crust,
// a starter jar, a lettered card, an instant photo, a stamped dish. Text is whatever the buyer types, so a brand sees
// their own name on the piece before asking for a quote.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fit = (s, n) => { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const initials = (s) => String(s || "").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 3).toUpperCase() || "♥";
  const mix = (hex, pct, to = "#ffffff") => { const p = (h) => [1, 3, 5].map((i) => parseInt((h || "#888888").replace("#", "").padEnd(6, "0").slice(i - 1, i + 1), 16)); const a = p(hex), b = p(to); return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * pct).toString(16).padStart(2, "0")).join(""); };
  const lum = (hex) => { const h = String(hex || "#888888").replace("#", "").padEnd(6, "0"); return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255; };
  const wrap = (s, n) => { const out = [""]; for (const w of String(s || "").split(/\s+/)) { if ((out[out.length - 1] + " " + w).trim().length > n && out[out.length - 1]) out.push(w); else out[out.length - 1] = (out[out.length - 1] + " " + w).trim(); } return out.slice(0, 3); };
  const kindOf = (g) => { const by = (t) => (/instant|photo|polaroid/.test(t) ? "photo" : /\bmug|\bcup\b/.test(t) ? "mug" : /dish|bowl|tray|coaster|plate/.test(t) ? "dish" : /starter|\bjar\b/.test(t) ? "jar" : /loaf|bread|sourdough|boule|bake/.test(t) ? "loaf" : /card|letter|note/.test(t) ? "card" : "");
    return by(String(g?.name || "").toLowerCase()) || { "📸": "photo", "☕": "mug", "🫙": "jar", "✉️": "card", "🍞": "loaf" }[g?.emoji] || by(String(g?.desc || "").toLowerCase()) || "card"; };
  const SCRIPT = "Caveat, 'Segoe Script', 'Bradley Hand', cursive", SANS = "'Instrument Sans', system-ui, sans-serif";

  function mug({ name = "Alex", brand = "", accent = "#2F7A8A", bg = "#F6EFE6" }) { const glaze = accent, clay = "#E9DCC9", dark = lum(accent) < 0.25 ? mix(accent, 0.55) : mix(accent, 0.35, "#000000");
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mug with ${esc(name)} pressed into the clay"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="196" rx="92" ry="10" fill="#000" opacity=".08"/>
      <path d="M232 82c38-4 46 54 4 66" fill="none" stroke="${glaze}" stroke-width="15" stroke-linecap="round"/><path d="M232 82c38-4 46 54 4 66" fill="none" stroke="${dark}" stroke-width="2" opacity=".25" stroke-linecap="round"/>
      <path d="M86 52h150l-6 128c-1 10-9 16-19 16H111c-10 0-18-6-19-16z" fill="${glaze}"/>
      <path d="M90 128 92 180c1 10 9 16 19 16h100c10 0 18-6 19-16l2-52c-14 8-26-6-40 2-14 8-24-6-38 2-14 8-26-6-40 2-12 6-22-4-34 2z" fill="${clay}"/>
      <path d="M90 128c12-6 22 4 34-2 14-8 26 6 40-2 14-8 24 6 38-2 14-8 26 6 30-2" fill="none" stroke="${dark}" stroke-width="1.5" opacity=".35"/>
      <ellipse cx="161" cy="52" rx="75" ry="9" fill="${dark}"/><ellipse cx="161" cy="51" rx="68" ry="6" fill="#3B2A20" opacity=".85"/>
      <text x="161" y="104" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${name.length > 9 ? 20 : 26}" letter-spacing="2" fill="${lum(accent) < 0.6 ? mix(accent, 0.62) : dark}" opacity=".95">${esc(fit(name, 14).toUpperCase())}</text>
      <text x="161" y="103" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${name.length > 9 ? 20 : 26}" letter-spacing="2" fill="#000" opacity=".12" transform="translate(1 1.5)">${esc(fit(name, 14).toUpperCase())}</text>
      ${brand ? `<text x="161" y="172" text-anchor="middle" font-family="${SANS}" font-size="10.5" letter-spacing="3" fill="#7A6A5A">${esc(fit(brand, 22).toUpperCase())}</text>` : ""}
      <path d="M120 40c-6-10 6-14 0-24M150 38c-6-10 6-14 0-24M180 40c-6-10 6-14 0-24" stroke="#B9A894" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/></svg>`; }

  function loaf({ name = "Alex", brand = "", accent = "#E0A030", bg = "#F6EFE6", note = "" }) { const mark = initials(brand || name);
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sourdough loaf scored with ${esc(mark)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="150" cy="190" rx="112" ry="12" fill="#000" opacity=".08"/>
      <path d="M40 150c0-62 52-100 112-100s110 38 110 100c0 28-30 40-110 40S40 178 40 150z" fill="#B8742F"/>
      <path d="M52 146c4-52 48-84 100-84s96 32 100 84" fill="none" stroke="#8E5420" stroke-width="3" opacity=".35"/>
      <path d="M70 120c20-40 60-56 82-56" fill="none" stroke="#F3DFC0" stroke-width="7" stroke-linecap="round" opacity=".95"/>
      <text x="152" y="140" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${mark.length > 2 ? 40 : 52}" fill="#F7EAD3" opacity=".95" letter-spacing="2">${esc(mark)}</text>
      <circle cx="100" cy="160" r="2" fill="#F7EAD3" opacity=".7"/><circle cx="200" cy="96" r="1.6" fill="#F7EAD3" opacity=".7"/><circle cx="215" cy="150" r="2" fill="#F7EAD3" opacity=".6"/>
      <g transform="rotate(8 262 72)"><rect x="222" y="44" width="90" height="56" rx="4" fill="#fff" stroke="#E4D9C8"/><circle cx="232" cy="54" r="3" fill="none" stroke="#B9A894"/>
        <text x="267" y="70" text-anchor="middle" font-family="${SCRIPT}" font-size="16" fill="#3B2A20">${esc(fit(name, 11))}</text><text x="267" y="88" text-anchor="middle" font-family="${SANS}" font-size="7" fill="#7A6A5A">${esc(fit(note || (brand ? "from " + brand : "baked for you"), 26))}</text></g>
      <path d="M262 40c-6-8-14-10-22-6" stroke="#B9A894" fill="none"/></svg>`; }

  function jar({ name = "Alex", brand = "", accent = "#3E9C6E", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Starter jar labeled ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="198" rx="70" ry="9" fill="#000" opacity=".08"/>
      <rect x="104" y="38" width="112" height="22" rx="5" fill="${accent}"/><rect x="104" y="38" width="112" height="22" rx="5" fill="#000" opacity=".1"/>
      <path d="M100 66h120v118c0 8-6 14-14 14h-92c-8 0-14-6-14-14z" fill="#EAF3F4" stroke="#C9DADC" stroke-width="2"/>
      <path d="M102 104h116v80c0 7-5 12-12 12h-92c-7 0-12-5-12-12z" fill="#F1E6D2"/>
      ${[[118, 120, 4], [140, 160, 3], [196, 130, 5], [176, 176, 3], [128, 182, 2.5], [204, 166, 3], [158, 118, 2.5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".8"/>`).join("")}
      <rect x="108" y="120" width="104" height="54" rx="4" fill="#fff" stroke="#E4D9C8"/>
      <text x="160" y="142" text-anchor="middle" font-family="${SCRIPT}" font-size="19" fill="#2B211C">${esc(fit(name, 11))}</text>
      <text x="160" y="157" text-anchor="middle" font-family="${SANS}" font-size="6.6" letter-spacing=".6" fill="#7A6A5A">${esc(fit(note || "LIVE STARTER · FEED ME", 30).toUpperCase())}</text>
      ${brand ? `<text x="160" y="167" text-anchor="middle" font-family="${SANS}" font-size="7" letter-spacing="2" fill="#9A8A7A">${esc(fit(brand, 22).toUpperCase())}</text>` : ""}
      <path d="M216 70v100" stroke="#fff" stroke-width="5" opacity=".5" stroke-linecap="round"/></svg>`; }

  function card({ name = "Alex", brand = "", accent = "#C2553A", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hand-lettered card for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <g transform="rotate(-5 120 112)"><rect x="40" y="34" width="150" height="160" rx="3" fill="#FFFDF8" stroke="#E4D9C8"/>
        <text x="115" y="104" text-anchor="middle" font-family="${SCRIPT}" font-size="${name.length > 8 ? 30 : 38}" fill="${accent}">${esc(fit(name, 12))}</text>
        <path d="M70 118c30 8 60 8 90 0" stroke="${accent}" stroke-width="1.5" fill="none" opacity=".6"/>
        <text x="115" y="176" text-anchor="middle" font-family="${SANS}" font-size="8" letter-spacing="2" fill="#9A8A7A">${esc(fit(brand ? brand.toUpperCase() : "WITH THANKS", 22))}</text></g>
      <g transform="rotate(4 230 120)"><rect x="170" y="50" width="120" height="140" rx="3" fill="#FFFDF8" stroke="#E4D9C8"/>
        <text font-family="${SCRIPT}" font-size="15" fill="#3B2A20">${wrap(note || "Thank you for everything this year.", 15).map((l, i) => `<tspan x="184" y="${84 + i * 20}">${esc(l)}</tspan>`).join("")}<tspan x="184" y="160">— the team</tspan></text></g></svg>`; }

  function photo({ name = "Alex", brand = "", accent = "#5B7FD6", bg = "#F6EFE6", note = "" }) { const sky = mix(accent, 0.55);
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Instant photo for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <g transform="rotate(-4 150 110)"><rect x="70" y="18" width="150" height="182" rx="3" fill="#fff" stroke="#E4D9C8"/><rect x="82" y="30" width="126" height="122" fill="${sky}"/>
        <rect x="82" y="112" width="126" height="40" fill="${mix(accent, 0.2, "#2B211C")}" opacity=".35"/>
        ${[[104, 104], [126, 98], [150, 102], [174, 97], [194, 106]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="10" fill="${["#F3D2B5", "#C99A73", "#8C5E3C", "#E8C29E", "#B07B55"][i]}"/><rect x="${x - 13}" y="${y + 9}" width="26" height="36" rx="12" fill="${[accent, "#2B211C", "#E0A030", "#3E9C6E", "#C2553A"][i]}"/>`).join("")}
        <text x="145" y="176" text-anchor="middle" font-family="${SCRIPT}" font-size="18" fill="#2B211C">${esc(fit(name, 14))}</text>
        <text x="145" y="191" text-anchor="middle" font-family="${SANS}" font-size="6.8" letter-spacing="1" fill="#9A8A7A">${esc(fit((note || brand || "offsite · 2026").toUpperCase(), 34))}</text></g>
      <g transform="rotate(7 250 120)" opacity=".9"><rect x="206" y="60" width="96" height="116" rx="3" fill="#fff" stroke="#E4D9C8"/><rect x="214" y="68" width="80" height="78" fill="${mix(accent, 0.7)}"/></g></svg>`; }

  function dish({ name = "Alex", brand = "", accent = "#8C62C9", bg = "#F6EFE6", mark: m = "" }) { const mark = (m || initials(name)).slice(0, 4).toUpperCase();
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ring dish stamped ${esc(mark)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="150" rx="118" ry="42" fill="#000" opacity=".08"/><ellipse cx="160" cy="130" rx="112" ry="50" fill="${accent}"/><ellipse cx="160" cy="126" rx="96" ry="38" fill="${mix(accent, 0.45)}"/>
      <ellipse cx="160" cy="128" rx="96" ry="38" fill="none" stroke="${mix(accent, 0.3, "#000000")}" stroke-width="1.5" opacity=".3"/>
      <text x="160" y="140" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="34" letter-spacing="3" fill="${mix(accent, 0.25, "#000000")}" opacity=".75">${esc(mark)}</text>
      ${brand ? `<text x="160" y="198" text-anchor="middle" font-family="${SANS}" font-size="9" letter-spacing="3" fill="#7A6A5A">${esc(fit(brand, 24).toUpperCase())}</text>` : ""}
      <circle cx="226" cy="146" r="7" fill="none" stroke="#E8C77A" stroke-width="3"/></svg>`; }

  const KINDS = { mug, loaf, jar, card, photo, dish };
  window.GiftArt = { kindOf, svg: (kind, o = {}) => (KINDS[kind] || card)(o), forGift: (g, o = {}) => (KINDS[kindOf(g)] || card)(o) };
})();
