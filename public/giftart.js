// Drawn previews of personalized gifts: a mug with a name pressed into the clay, a loaf with initials scored in the crust,
// a starter jar, a lettered card, an instant photo, a stamped dish. Text is whatever the buyer types, so a brand sees
// their own name on the piece before asking for a quote.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fit = (s, n) => { s = String(s || "").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  // long names: "Priya Raghunathan" becomes "Priya R." before anything gets cut off
  // brand names keep their own case when it matters ("n8n", "eBay"); others print in caps
  const up = (b) => (/^[a-z]|\d|[a-z][A-Z]/.test(String(b || "")) ? String(b) : String(b || "").toUpperCase());
  const short = (s, n) => { s = String(s || "").trim(); if (s.length <= n) return s; const p = s.split(/\s+/); if (p.length > 1) { const a = `${p[0]} ${p[p.length - 1][0]}.`; return a.length <= n ? a : fit(p[0], n); } return fit(s, n); };
  const initials = (s) => String(s || "").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 3).toUpperCase() || "♥";
  const mix = (hex, pct, to = "#ffffff") => { const p = (h) => [1, 3, 5].map((i) => parseInt((h || "#888888").replace("#", "").padEnd(6, "0").slice(i - 1, i + 1), 16)); const a = p(hex), b = p(to); return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * pct).toString(16).padStart(2, "0")).join(""); };
  const lum = (hex) => { const h = String(hex || "#888888").replace("#", "").padEnd(6, "0"); return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255; };
  const wrap = (s, n) => { const out = [""]; for (const w of String(s || "").split(/\s+/)) { if ((out[out.length - 1] + " " + w).trim().length > n && out[out.length - 1]) out.push(w); else out[out.length - 1] = (out[out.length - 1] + " " + w).trim(); } return out.slice(0, 3); };
  const kindOf = (g) => { const by = (t) => (/keycap/.test(t) ? "keycap" : /cable clip|clips/.test(t) ? "clips" : /cord wrap|cable wrap|cord organi[sz]er|cable organi[sz]er/.test(t) ? "wrap" : /charger|charging/.test(t) ? "charger" : /desk ?mat/.test(t) ? "deskmat" : /usb|braided cable|\bcable\b/.test(t) ? "cable" : /iced|cup sleeve|latte cup|to-go/.test(t) ? "cup" : /\bphin\b|filter set|brew kit/.test(t) ? "phin" : /coffee bag|beans|blend|roast/.test(t) ? "bag" : /plush|plushie|stuffed|cushie|mascot|soft toy/.test(t) ? "plush" : /pop-?up/.test(t) ? "popup" : /instant|photo|polaroid/.test(t) ? "photo" : /\bmug|\bcup\b/.test(t) ? "mug" : /dish|bowl|tray|coaster|plate/.test(t) ? "dish" : /starter|\bjar\b/.test(t) ? "jar" : /loaf|bread|sourdough|boule|bake/.test(t) ? "loaf" : /card|letter|note/.test(t) ? "card" : "");
    return by(String(g?.name || "").toLowerCase()) || { "🧸": "plush", "📸": "photo", "☕": "mug", "🫙": "jar", "✉️": "card", "🍞": "loaf" }[g?.emoji] || by(String(g?.desc || "").toLowerCase()) || "card"; };
  const SCRIPT = "Caveat, 'Segoe Script', 'Bradley Hand', cursive", SANS = "'Instrument Sans', system-ui, sans-serif";

  function mug({ name = "Alex", brand = "", accent = "#2F7A8A", bg = "#F6EFE6" }) { const glaze = accent, clay = "#E9DCC9", dark = lum(accent) < 0.25 ? mix(accent, 0.55) : mix(accent, 0.35, "#000000");
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mug with ${esc(name)} pressed into the clay"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="196" rx="92" ry="10" fill="#000" opacity=".08"/>
      <path d="M232 82c38-4 46 54 4 66" fill="none" stroke="${glaze}" stroke-width="15" stroke-linecap="round"/><path d="M232 82c38-4 46 54 4 66" fill="none" stroke="${dark}" stroke-width="2" opacity=".25" stroke-linecap="round"/>
      <path d="M86 52h150l-6 128c-1 10-9 16-19 16H111c-10 0-18-6-19-16z" fill="${glaze}"/>
      <path d="M90 128 92 180c1 10 9 16 19 16h100c10 0 18-6 19-16l2-52c-14 8-26-6-40 2-14 8-24-6-38 2-14 8-26-6-40 2-12 6-22-4-34 2z" fill="${clay}"/>
      <path d="M90 128c12-6 22 4 34-2 14-8 26 6 40-2 14-8 24 6 38-2 14-8 26 6 30-2" fill="none" stroke="${dark}" stroke-width="1.5" opacity=".35"/>
      <ellipse cx="161" cy="52" rx="75" ry="9" fill="${dark}"/><ellipse cx="161" cy="51" rx="68" ry="6" fill="#3B2A20" opacity=".85"/>
      <text x="161" y="104" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${Math.max(11, Math.min(26, Math.floor((140 / Math.max(1, short(name, 14).length) - 2) / 0.68)))}" letter-spacing="2" fill="${lum(accent) < 0.6 ? mix(accent, 0.62) : dark}" opacity=".95">${esc(short(name, 14).toUpperCase())}</text>
      <text x="161" y="103" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${Math.max(11, Math.min(26, Math.floor((140 / Math.max(1, short(name, 14).length) - 2) / 0.68)))}" letter-spacing="2" fill="#000" opacity=".12" transform="translate(1 1.5)">${esc(short(name, 14).toUpperCase())}</text>
      ${brand ? `<text x="161" y="172" text-anchor="middle" font-family="${SANS}" font-size="10.5" letter-spacing="3" fill="#7A6A5A">${esc(up(fit(brand, 22)))}</text>` : ""}
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
        <text x="267" y="70" text-anchor="middle" font-family="${SCRIPT}" font-size="16" fill="#3B2A20">${esc(short(name, 11))}</text><text x="267" y="88" text-anchor="middle" font-family="${SANS}" font-size="7" fill="#7A6A5A">${esc(fit(note || (brand ? "from " + brand : "baked for you"), 26))}</text></g>
      <path d="M262 40c-6-8-14-10-22-6" stroke="#B9A894" fill="none"/></svg>`; }

  function jar({ name = "Alex", brand = "", accent = "#3E9C6E", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Starter jar labeled ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="198" rx="70" ry="9" fill="#000" opacity=".08"/>
      <rect x="104" y="38" width="112" height="22" rx="5" fill="${accent}"/><rect x="104" y="38" width="112" height="22" rx="5" fill="#000" opacity=".1"/>
      <path d="M100 66h120v118c0 8-6 14-14 14h-92c-8 0-14-6-14-14z" fill="#EAF3F4" stroke="#C9DADC" stroke-width="2"/>
      <path d="M102 104h116v80c0 7-5 12-12 12h-92c-7 0-12-5-12-12z" fill="#F1E6D2"/>
      ${[[118, 120, 4], [140, 160, 3], [196, 130, 5], [176, 176, 3], [128, 182, 2.5], [204, 166, 3], [158, 118, 2.5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".8"/>`).join("")}
      <rect x="108" y="120" width="104" height="54" rx="4" fill="#fff" stroke="#E4D9C8"/>
      <text x="160" y="142" text-anchor="middle" font-family="${SCRIPT}" font-size="19" fill="#2B211C">${esc(short(name, 11))}</text>
      <text x="160" y="157" text-anchor="middle" font-family="${SANS}" font-size="6.6" letter-spacing=".6" fill="#7A6A5A">${esc(fit(note || "LIVE STARTER · FEED ME", 30).toUpperCase())}</text>
      ${brand ? `<text x="160" y="167" text-anchor="middle" font-family="${SANS}" font-size="7" letter-spacing="2" fill="#9A8A7A">${esc(up(fit(brand, 22)))}</text>` : ""}
      <path d="M216 70v100" stroke="#fff" stroke-width="5" opacity=".5" stroke-linecap="round"/></svg>`; }

  function card({ name = "Alex", brand = "", accent = "#C2553A", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hand-lettered card for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <g transform="rotate(-5 120 112)"><rect x="40" y="34" width="150" height="160" rx="3" fill="#FFFDF8" stroke="#E4D9C8"/>
        <text x="115" y="104" text-anchor="middle" font-family="${SCRIPT}" font-size="${Math.max(18, Math.min(38, Math.floor(128 / (Math.max(1, short(name, 14).length) * 0.46))))}" fill="${accent}">${esc(short(name, 14))}</text>
        <path d="M70 118c30 8 60 8 90 0" stroke="${accent}" stroke-width="1.5" fill="none" opacity=".6"/>
        <text x="115" y="176" text-anchor="middle" font-family="${SANS}" font-size="8" letter-spacing="2" fill="#9A8A7A">${esc(fit(brand ? up(brand) : "WITH THANKS", 22))}</text></g>
      <g transform="rotate(4 230 120)"><rect x="170" y="50" width="120" height="140" rx="3" fill="#FFFDF8" stroke="#E4D9C8"/>
        <text font-family="${SCRIPT}" font-size="15" fill="#3B2A20">${wrap(note || "Thank you for everything this year.", 15).map((l, i) => `<tspan x="184" y="${84 + i * 20}">${esc(l)}</tspan>`).join("")}<tspan x="184" y="160">— the team</tspan></text></g></svg>`; }

  function photo({ name = "Alex", brand = "", accent = "#5B7FD6", bg = "#F6EFE6", note = "" }) { const sky = mix(accent, 0.55);
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Instant photo for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <g transform="rotate(-4 150 110)"><rect x="70" y="18" width="150" height="182" rx="3" fill="#fff" stroke="#E4D9C8"/><rect x="82" y="30" width="126" height="122" fill="${sky}"/>
        <rect x="82" y="112" width="126" height="40" fill="${mix(accent, 0.2, "#2B211C")}" opacity=".35"/>
        ${[[104, 104], [126, 98], [150, 102], [174, 97], [194, 106]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="10" fill="${["#F3D2B5", "#C99A73", "#8C5E3C", "#E8C29E", "#B07B55"][i]}"/><rect x="${x - 13}" y="${y + 9}" width="26" height="36" rx="12" fill="${[accent, "#2B211C", "#E0A030", "#3E9C6E", "#C2553A"][i]}"/>`).join("")}
        <text x="145" y="176" text-anchor="middle" font-family="${SCRIPT}" font-size="18" fill="#2B211C">${esc(short(name, 14))}</text>
        <text x="145" y="191" text-anchor="middle" font-family="${SANS}" font-size="6.8" letter-spacing="1" fill="#9A8A7A">${esc(fit(note ? note.toUpperCase() : up(brand || "offsite · 2026"), 34))}</text></g>
      <g transform="rotate(7 250 120)" opacity=".9"><rect x="206" y="60" width="96" height="116" rx="3" fill="#fff" stroke="#E4D9C8"/><rect x="214" y="68" width="80" height="78" fill="${mix(accent, 0.7)}"/></g></svg>`; }

  function dish({ name = "Alex", brand = "", accent = "#8C62C9", bg = "#F6EFE6", mark: m = "" }) { const mark = (m || initials(name)).slice(0, 4).toUpperCase();
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ring dish stamped ${esc(mark)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="150" rx="118" ry="42" fill="#000" opacity=".08"/><ellipse cx="160" cy="130" rx="112" ry="50" fill="${accent}"/><ellipse cx="160" cy="126" rx="96" ry="38" fill="${mix(accent, 0.45)}"/>
      <ellipse cx="160" cy="128" rx="96" ry="38" fill="none" stroke="${mix(accent, 0.3, "#000000")}" stroke-width="1.5" opacity=".3"/>
      <text x="160" y="140" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="34" letter-spacing="3" fill="${mix(accent, 0.25, "#000000")}" opacity=".75">${esc(mark)}</text>
      ${brand ? `<text x="160" y="198" text-anchor="middle" font-family="${SANS}" font-size="9" letter-spacing="3" fill="#7A6A5A">${esc(up(fit(brand, 24)))}</text>` : ""}
      <circle cx="226" cy="146" r="7" fill="none" stroke="#E8C77A" stroke-width="3"/></svg>`; }


  // a stitched plush: bear, beaver or robot, with a sewn-in tag
  function plush({ name = "Alex", brand = "", accent = "#C2553A", bg = "#F6EFE6", species = "", note = "" }) {
    const sp = species || (/beaver/i.test(name + note) ? "beaver" : /bot|robot/i.test(name + note) ? "robot" : "bear"), body = accent, shade = mix(accent, 0.25, "#000000"), belly = mix(accent, 0.55), stitch = mix(accent, 0.6);
    const eyes = (y) => `<circle cx="144" cy="${y}" r="6" fill="#1F1A17"/><circle cx="176" cy="${y}" r="6" fill="#1F1A17"/><circle cx="146" cy="${y - 2}" r="2" fill="#fff"/><circle cx="178" cy="${y - 2}" r="2" fill="#fff"/><ellipse cx="132" cy="${y + 12}" rx="7" ry="4" fill="#F29A9A" opacity=".55"/><ellipse cx="188" cy="${y + 12}" rx="7" ry="4" fill="#F29A9A" opacity=".55"/>`;
    const tag = `<g transform="rotate(-8 228 150)"><rect x="200" y="136" width="62" height="30" rx="4" fill="#fff" stroke="#E4D9C8"/><text x="231" y="150" text-anchor="middle" font-family="${SCRIPT}" font-size="13" fill="#2B211C">${esc(short(name, 10))}</text><text x="231" y="160" text-anchor="middle" font-family="${SANS}" font-size="6" letter-spacing="1" fill="#7A6A5A">${esc(fit(up(brand || "handmade"), 18))}</text><path d="M200 146c-6 0-10 4-14 2" stroke="${shade}" fill="none"/></g>`;
    let fig;
    if (sp === "robot") fig = `<rect x="104" y="120" width="112" height="72" rx="30" fill="${body}"/><rect x="126" y="134" width="68" height="40" rx="18" fill="${belly}"/><path d="M160 122v70" stroke="${stitch}" stroke-dasharray="4 4"/>
      <ellipse cx="104" cy="150" rx="12" ry="20" fill="${shade}"/><ellipse cx="216" cy="150" rx="12" ry="20" fill="${shade}"/>
      <line x1="160" y1="24" x2="160" y2="42" stroke="${shade}" stroke-width="4"/><circle cx="160" cy="22" r="7" fill="#F2C94C"/>
      <rect x="98" y="40" width="124" height="92" rx="34" fill="${body}"/><rect x="114" y="58" width="92" height="56" rx="20" fill="#1F1A17"/>
      <rect x="132" y="76" width="14" height="18" rx="7" fill="#8EE3F5"/><rect x="174" y="76" width="14" height="18" rx="7" fill="#8EE3F5"/><path d="M150 102q10 7 20 0" stroke="#8EE3F5" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M100 86h120" stroke="${stitch}" stroke-dasharray="4 4" opacity=".6"/>`;
    else if (sp === "beaver") fig = `<ellipse cx="226" cy="176" rx="40" ry="17" fill="#5A3A24" transform="rotate(-18 226 176)"/><path d="M196 170l52-14M200 180l50-14M206 188l40-10" stroke="#7A5236" stroke-width="2"/>
      <ellipse cx="160" cy="150" rx="62" ry="46" fill="${body}"/><ellipse cx="160" cy="158" rx="38" ry="30" fill="${belly}"/><ellipse cx="108" cy="150" rx="13" ry="18" fill="${shade}"/><ellipse cx="212" cy="150" rx="13" ry="18" fill="${shade}"/>
      <circle cx="122" cy="52" r="13" fill="${shade}"/><circle cx="198" cy="52" r="13" fill="${shade}"/><circle cx="160" cy="88" r="50" fill="${body}"/>
      <ellipse cx="160" cy="104" rx="24" ry="17" fill="${belly}"/><ellipse cx="160" cy="96" rx="8" ry="6" fill="#2B211C"/><rect x="152" y="108" width="8" height="12" rx="2" fill="#fff" stroke="#E4D9C8"/><rect x="160" y="108" width="8" height="12" rx="2" fill="#fff" stroke="#E4D9C8"/>${eyes(78)}`;
    else fig = `<ellipse cx="160" cy="150" rx="60" ry="46" fill="${body}"/><ellipse cx="160" cy="156" rx="36" ry="28" fill="${belly}"/><ellipse cx="110" cy="150" rx="13" ry="18" fill="${shade}"/><ellipse cx="210" cy="150" rx="13" ry="18" fill="${shade}"/>
      <circle cx="120" cy="50" r="17" fill="${body}"/><circle cx="120" cy="50" r="9" fill="${belly}"/><circle cx="200" cy="50" r="17" fill="${body}"/><circle cx="200" cy="50" r="9" fill="${belly}"/><circle cx="160" cy="88" r="48" fill="${body}"/>
      <ellipse cx="160" cy="104" rx="18" ry="13" fill="${belly}"/><ellipse cx="160" cy="99" rx="6" ry="4.5" fill="#2B211C"/><path d="M154 108q6 5 12 0" stroke="#2B211C" stroke-width="2" fill="none"/>${eyes(82)}`;
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Plush ${esc(sp)} for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/><ellipse cx="160" cy="200" rx="92" ry="10" fill="#000" opacity=".08"/>${fig}
      <path d="M160 40v0" /><circle cx="160" cy="88" r="${sp === "robot" ? 0 : 50}" fill="none" stroke="${stitch}" stroke-dasharray="3 5" opacity=".5"/>${tag}</svg>`; }

  // a pop-up card: open on the table, paper layers rising from the fold, the brand on a banner
  function popup({ name = "Alex", brand = "", accent = "#5B7FD6", bg = "#F6EFE6", note = "", scene = "" }) { const l1 = mix(accent, 0.75), l2 = mix(accent, 0.45), l3 = accent, dark = mix(accent, 0.35, "#000000");
    const sc = scene || "city";
    const layer = sc === "garden" ? `<path d="M96 150c0-30 20-40 30-40s14 18 14 40zM180 150c0-36 22-48 34-48s16 22 16 48z" fill="${l2}"/>${[[120, 96], [150, 80], [182, 92], [212, 84], [134, 112], [196, 110]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${12 - (i % 3) * 2}" fill="${i % 2 ? "#F6C1C9" : "#F2D48F"}"/><circle cx="${x}" cy="${y}" r="4" fill="${dark}"/><path d="M${x} ${y + 10}v40" stroke="${dark}" stroke-width="2"/>`).join("")}`
      : sc === "launch" ? `<path d="M160 36c18 18 24 44 18 74h-36c-6-30 0-56 18-74z" fill="${l3}"/><circle cx="160" cy="72" r="8" fill="#fff"/><path d="M142 104l-16 20h18zM178 104l16 20h-18z" fill="${dark}"/><path d="M150 112q10 30 20 0" fill="#F2C94C"/>${[[100, 60], [220, 52], [118, 92], [206, 96], [236, 80]].map(([x, y]) => `<path d="M${x} ${y - 6}l2 5 5 1-5 2-2 5-2-5-5-2 5-1z" fill="#F2C94C"/>`).join("")}`
      : `${[[96, 92, 26], [124, 70, 22], [148, 56, 26], [176, 80, 20], [198, 64, 24], [224, 96, 22]].map(([x, y, w], i) => `<rect x="${x}" y="${y}" width="${w}" height="${150 - y}" fill="${i % 2 ? l2 : l3}"/>${Array.from({ length: Math.floor((140 - y) / 16) }, (_, k) => `<rect x="${x + 5}" y="${y + 8 + k * 16}" width="${w - 10}" height="6" fill="#fff" opacity=".55"/>`).join("")}`).join("")}`;
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pop-up card for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="196" rx="130" ry="10" fill="#000" opacity=".08"/>
      <path d="M160 150 40 120 34 190 160 200z" fill="#FFFDF8" stroke="#E4D9C8"/><path d="M160 150 280 120 286 190 160 200z" fill="#FFF8EE" stroke="#E4D9C8"/>
      <path d="M80 150c0-70 160-70 160 0z" fill="${l1}"/>${layer}
      <path d="M100 150h120l-6 22H106z" fill="${dark}"/><text x="160" y="166" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="11" letter-spacing="2.5" fill="#fff">${esc(fit(up(brand || "THANK YOU"), 18))}</text>
      <text x="74" y="184" font-family="${SCRIPT}" font-size="14" fill="#3B2A20" transform="rotate(4 74 184)">for ${esc(short(name, 12))}</text>
      <text x="246" y="184" text-anchor="middle" font-family="${SCRIPT}" font-size="11" fill="#3B2A20" transform="rotate(-4 242 184)">${esc(fit(note || "thank you", 22))}</text></svg>`; }

  // a Vietnamese phin filter on a glass: condensed milk, coffee dripping through, the name engraved on the chamber
  function phin({ name = "Alex", brand = "", accent = "#7A4A2A", bg = "#F6EFE6", note = "" }) { const steel = "#C9CED3", steelD = "#9AA1A8";
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Phin filter engraved ${esc(brand || name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="150" cy="200" rx="80" ry="9" fill="#000" opacity=".08"/>
      <path d="M100 98h100l-8 96c-1 6-6 8-11 8h-62c-5 0-10-2-11-8z" fill="#EAF3F4" opacity=".85" stroke="#C9DADC" stroke-width="2"/>
      <path d="M106 160h88l-3 34c-1 5-5 7-10 7h-62c-5 0-9-2-10-7z" fill="#F4E6C8"/><path d="M104 136h92l-2 24h-88z" fill="#5A3420"/><path d="M104 136h92" stroke="#3B2214" stroke-width="2"/>
      ${[[118, 110], [178, 116], [146, 122]].map(([x, y]) => `<rect x="${x}" y="${y}" width="16" height="14" rx="3" fill="#fff" opacity=".55" transform="rotate(12 ${x} ${y})"/>`).join("")}
      <ellipse cx="150" cy="96" rx="64" ry="9" fill="${steelD}"/><ellipse cx="150" cy="94" rx="62" ry="8" fill="${steel}"/>
      <path d="M118 46h64v46c0 3-14 6-32 6s-32-3-32-6z" fill="${steel}"/><path d="M118 46h64v46c0 3-14 6-32 6s-32-3-32-6z" fill="url(#ps)"/>
      <defs><linearGradient id="ps" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs>
      <ellipse cx="150" cy="46" rx="34" ry="6" fill="${steelD}"/><ellipse cx="150" cy="40" rx="30" ry="5" fill="${steel}"/><rect x="144" y="30" width="12" height="9" rx="3" fill="${steelD}"/>
      <text x="150" y="70" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${(brand || name).length > 8 ? 9 : 11}" letter-spacing="2" fill="#6E767E">${esc(fit(up(brand || name), 12))}</text>
      <path d="M150 102v8" stroke="#5A3420" stroke-width="3" stroke-linecap="round"/><circle cx="150" cy="118" r="2.5" fill="#5A3420"/>
      <g transform="rotate(6 254 150)"><rect x="220" y="120" width="70" height="52" rx="4" fill="#fff" stroke="#E4D9C8"/><text x="255" y="144" text-anchor="middle" font-family="${SCRIPT}" font-size="15" fill="#2B211C">for ${esc(short(name, 9))}</text><text x="255" y="160" text-anchor="middle" font-family="${SANS}" font-size="6.5" letter-spacing="1" fill="#7A6A5A">${esc(fit((note || "slow drip · 5 min").toUpperCase(), 22))}</text></g></svg>`; }

  // a kraft coffee bag with a custom label
  function bag({ name = "Alex", brand = "", accent = "#C2553A", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Coffee bag labeled ${esc(brand || name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="202" rx="78" ry="9" fill="#000" opacity=".08"/>
      <path d="M104 40h112l6 150c0 6-4 10-10 10H108c-6 0-10-4-10-10z" fill="#C9A47A"/><path d="M104 40h112v14H104z" fill="#B48C60"/><path d="M110 46h100" stroke="#9C7448" stroke-dasharray="3 3"/>
      <circle cx="196" cy="72" r="6" fill="#B48C60" stroke="#9C7448"/>
      <rect x="114" y="88" width="92" height="88" rx="4" fill="#FFFDF8"/><rect x="114" y="88" width="92" height="16" rx="4" fill="${accent}"/>
      <text x="160" y="100" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="8" letter-spacing="2" fill="#fff">${esc(fit(up(brand || "HOUSE BLEND"), 18))}</text>
      <text x="160" y="130" text-anchor="middle" font-family="${SCRIPT}" font-size="20" fill="#2B211C">${esc(short(name, 10))}'s</text>
      <text x="160" y="146" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="9" letter-spacing="1.5" fill="#2B211C">BLEND</text>
      <text x="160" y="164" text-anchor="middle" font-family="${SANS}" font-size="6.5" letter-spacing="1" fill="#7A6A5A">${esc(fit((note || "Vietnamese robusta · 250 g").toUpperCase(), 30))}</text>
      ${[[72, 188], [86, 196], [238, 190], [252, 182], [246, 198]].map(([x, y], i) => `<g transform="rotate(${i * 40} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="7" ry="5" fill="#4A2A18"/><path d="M${x - 5} ${y}q5 -2 10 0" stroke="#2B160C" stroke-width="1.2" fill="none"/></g>`).join("")}</svg>`; }

  // an iced coffee in a clear cup with a printed sleeve and a name sticker
  function cup({ name = "Alex", brand = "", accent = "#3E9C6E", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Iced coffee cup with ${esc(brand || name)} sleeve"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="204" rx="56" ry="8" fill="#000" opacity=".08"/>
      <path d="M118 40c0-12 84-12 84 0v8h-84z" fill="#EAF3F4" stroke="#C9DADC" stroke-width="2"/><rect x="156" y="12" width="6" height="40" rx="3" fill="${accent}" transform="rotate(10 159 32)"/>
      <path d="M114 48h92l-10 150c0 4-3 6-7 6h-58c-4 0-7-2-7-6z" fill="#EAF3F4" opacity=".7" stroke="#C9DADC" stroke-width="2"/>
      <path d="M118 96h84l-6 102c0 3-3 5-6 5h-60c-3 0-6-2-6-5z" fill="#6B3E22"/><path d="M121 150h78l-3 48c0 3-3 5-6 5h-60c-3 0-6-2-6-5z" fill="#E9D9BC" opacity=".9"/><path d="M118 96h84" stroke="#4A2A18" stroke-width="2"/>
      ${[[130, 70], [164, 62], [178, 84], [140, 92]].map(([x, y]) => `<rect x="${x}" y="${y}" width="18" height="16" rx="3" fill="#fff" opacity=".7" transform="rotate(14 ${x} ${y})"/>`).join("")}
      <path d="M116 112h88l-3 40h-82z" fill="${accent}"/><text x="160" y="130" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="10" letter-spacing="2" fill="#fff">${esc(fit(up(brand || "ICED PHIN"), 14))}</text>
      <text x="160" y="144" text-anchor="middle" font-family="${SANS}" font-size="6.5" letter-spacing="1" fill="#fff" opacity=".85">${esc(fit((note || "cà phê sữa đá").toUpperCase(), 24))}</text>
      <g transform="rotate(-10 222 92)"><circle cx="222" cy="92" r="24" fill="#FFFDF8" stroke="#E4D9C8"/><text x="222" y="96" text-anchor="middle" font-family="${SCRIPT}" font-size="13" fill="#2B211C">${esc(short(name, 8))}</text></g></svg>`; }

  // ---- desk gifts for developers ----
  const node = (x, y, w, label, fill, txt = "#fff", r = 10) => `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" fill="${fill}"/><rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" fill="none" stroke="#000" stroke-opacity=".12"/>${label ? `<text x="${x + w / 2}" y="${y + w / 2 + 4}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${Math.max(7, Math.min(12, Math.floor((w - 8) / (label.length * 0.62))))}" fill="${txt}">${esc(label)}</text>` : ""}`;
  // a resin keycap with a word on top, next to two plain ones
  function keycap({ name = "Alex", brand = "", accent = "#EA4B71", bg = "#F6EFE6", note = "" }) { const top = mix(accent, 0.15), side = mix(accent, 0.3, "#000000"), word = short(note || name, 10);
    const cap = (x, y, w, t, f, sd, fs) => `<path d="M${x} ${y + 14}h${w}l-6 ${w * 0.62}h-${w - 12}z" fill="${sd}"/><rect x="${x + 8}" y="${y}" width="${w - 16}" height="${w * 0.62}" rx="9" fill="${f}"/><rect x="${x + 14}" y="${y + 5}" width="${w - 28}" height="${w * 0.62 - 12}" rx="7" fill="#fff" opacity=".12"/>${t ? `<text x="${x + w / 2}" y="${y + w * 0.36}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${fs}" fill="#fff">${esc(t)}</text>` : ""}`;
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Keycap with ${esc(word)}"><rect width="320" height="220" fill="${bg}"/>
      <rect x="20" y="150" width="280" height="56" rx="10" fill="#2B2B30"/><rect x="20" y="150" width="280" height="10" rx="5" fill="#3A3A40"/>
      ${cap(36, 108, 70, "", "#D9D4CC", "#A9A39A", 0)}${cap(214, 108, 70, "", "#D9D4CC", "#A9A39A", 0)}
      <ellipse cx="160" cy="176" rx="64" ry="8" fill="#000" opacity=".25"/>${cap(102, 72, 116, word.toUpperCase(), top, side, Math.max(10, Math.min(20, Math.floor(84 / (word.length * 0.68)))))}
      ${brand ? `<text x="160" y="196" text-anchor="middle" font-family="${SANS}" font-size="8" letter-spacing="3" fill="#9A958E">${esc(fit(up(brand), 22))}</text>` : ""}</svg>`; }
  // magnetic cable clips shaped like workflow nodes, the cables running between them
  function clips({ name = "Alex", brand = "", accent = "#EA4B71", bg = "#F6EFE6" }) { const a = accent, b = mix(accent, 0.45), c = mix(accent, 0.3, "#000000");
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Node cable clips"><rect width="320" height="220" fill="${bg}"/>
      <rect x="0" y="120" width="320" height="100" fill="#D8C3A5"/><rect x="0" y="120" width="320" height="6" fill="#C4AB88"/>
      <path d="M-10 92C40 92 50 92 78 92M130 92C160 92 170 92 196 92M248 92C280 92 300 92 330 92" stroke="#2B2B30" stroke-width="7" stroke-linecap="round" fill="none"/>
      <path d="M-10 108C50 108 80 106 104 106M156 106C180 106 196 106 222 106M274 106C300 106 310 108 330 108" stroke="#6B6B72" stroke-width="5" stroke-linecap="round" fill="none"/>
      ${node(78, 70, 52, short(name, 8), a)}${node(196, 70, 52, "", b)}<circle cx="104" cy="96" r="0" />
      ${node(137, 70, 52, "", c)}<path d="M150 96l8-8v6h12v4h-12v6z" fill="#fff" opacity=".85"/><circle cx="222" cy="96" r="9" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>
      ${[[104, 66], [163, 66], [222, 66]].map(([x, y]) => `<rect x="${x - 10}" y="${y}" width="20" height="5" rx="2" fill="#000" opacity=".18"/>`).join("")}
      ${brand ? `<text x="160" y="172" text-anchor="middle" font-family="${SANS}" font-size="9" letter-spacing="3" fill="#6E5A44">${esc(fit(up(brand), 22))}</text>` : ""}</svg>`; }
  // a leather cord wrap around a coiled cable, the name embossed
  function cordwrap({ name = "Alex", brand = "", accent = "#9A6A43", bg = "#F6EFE6" }) { const leather = lum(accent) > 0.6 ? "#9A6A43" : accent, deep = mix(leather, 0.3, "#000000");
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Leather cord wrap for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="190" rx="100" ry="10" fill="#000" opacity=".08"/>
      ${[0, 1, 2, 3].map((i) => `<ellipse cx="${118 + i * 28}" cy="112" rx="46" ry="62" fill="none" stroke="#2B2B30" stroke-width="7"/>`).join("")}
      <path d="M262 150c18 10 30 22 40 40" stroke="#2B2B30" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="294" y="186" width="16" height="12" rx="3" fill="#B9BEC4"/>
      <rect x="88" y="88" width="148" height="50" rx="12" fill="${leather}"/><rect x="94" y="94" width="136" height="38" rx="9" fill="none" stroke="#F3E6D6" stroke-dasharray="4 3" opacity=".6"/>
      <circle cx="218" cy="113" r="8" fill="#C9CED3" stroke="${deep}"/>
      <text x="152" y="118" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${Math.max(10, Math.min(16, Math.floor(100 / (short(name, 12).length * 0.66))))}" letter-spacing="1.5" fill="${deep}">${esc(short(name, 12).toUpperCase())}</text>
      <text x="152" y="117" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="${Math.max(10, Math.min(16, Math.floor(100 / (short(name, 12).length * 0.66))))}" letter-spacing="1.5" fill="#fff" opacity=".12">${esc(short(name, 12).toUpperCase())}</text>
      ${brand ? `<text x="160" y="206" text-anchor="middle" font-family="${SANS}" font-size="8.5" letter-spacing="3" fill="#7A6A5A">${esc(fit(up(brand), 22))}</text>` : ""}</svg>`; }
  // a walnut wireless charging pad, engraved
  function charger({ name = "Alex", brand = "", accent = "#EA4B71", bg = "#F6EFE6", note = "" }) {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Walnut charger engraved for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <path d="M232 132c30 6 50 20 70 60" stroke="#2B2B30" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="160" cy="142" rx="104" ry="40" fill="#4A2E1C"/><ellipse cx="160" cy="132" rx="104" ry="40" fill="#7A4E2E"/>
      ${[0, 1, 2, 3, 4].map((i) => `<path d="M${74 + i * 8} ${118 + i * 6}c40 -10 120 -10 ${170 - i * 16} ${4 - i}" stroke="#5E3A22" stroke-width="1.4" fill="none" opacity=".55"/>`).join("")}
      <ellipse cx="160" cy="132" rx="86" ry="30" fill="none" stroke="#5E3A22" stroke-width="1.5" opacity=".6"/>
      <text x="160" y="128" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="11" letter-spacing="1" fill="#3B2214" opacity=".85">${esc(short(name, 14))}</text>
      <text x="160" y="144" text-anchor="middle" font-family="${SANS}" font-size="8" letter-spacing="1.5" fill="#3B2214" opacity=".7">${esc(fit((note || "trigger → charge → ship").toUpperCase(), 30))}</text>
      ${brand ? `<g><rect x="118" y="38" width="84" height="22" rx="11" fill="${accent}"/><text x="160" y="53" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="9" letter-spacing="2" fill="#fff">${esc(fit(up(brand), 12))}</text></g>` : ""}</svg>`; }
  // a desk mat printed like a workflow canvas, their name on the first node
  function deskmat({ name = "Alex", brand = "", accent = "#EA4B71", bg = "#F6EFE6" }) { const n2 = mix(accent, 0.45), n3 = mix(accent, 0.3, "#000000");
    let dots = ""; for (let x = 32; x < 292; x += 14) for (let y = 40; y < 170; y += 14) dots += `<circle cx="${x}" cy="${y}" r="1" fill="#fff" opacity=".18"/>`;
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Workflow desk mat for ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <rect x="20" y="26" width="280" height="160" rx="14" fill="#1F1F24"/>${dots}
      <path d="M96 86c22 0 22 24 44 24M188 110c20 0 20-26 40-26M188 110c20 0 20 26 40 26" stroke="#9A9AA2" stroke-width="2" fill="none"/>
      ${node(48, 62, 48, short(name, 8), accent)}${node(140, 86, 48, "", n2)}${node(228, 60, 48, "", n3)}${node(228, 112, 48, "", "#3A3A40")}
      <path d="M156 110h16M164 102v16" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>
      <text x="252" y="88" text-anchor="middle" font-family="${SANS}" font-size="16" fill="#fff" opacity=".85">✉</text><text x="252" y="141" text-anchor="middle" font-family="${SANS}" font-size="15" fill="#fff" opacity=".7">{ }</text>
      <rect x="40" y="196" width="240" height="18" rx="5" fill="#D9D4CC"/>${Array.from({ length: 11 }, (_, i) => `<rect x="${46 + i * 21}" y="199" width="17" height="11" rx="2" fill="#fff"/>`).join("")}
      ${brand ? `<text x="282" y="178" text-anchor="end" font-family="${SANS}" font-size="7.5" letter-spacing="2.5" fill="#fff" opacity=".5">${esc(fit(up(brand), 22))}</text>` : ""}</svg>`; }
  // a braided USB-C cable, coiled, with a name tag sleeve
  function cable({ name = "Alex", brand = "", accent = "#EA4B71", bg = "#F6EFE6" }) { const dark = mix(accent, 0.3, "#000000");
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Braided cable tagged ${esc(name)}"><rect width="320" height="220" fill="${bg}"/>
      <ellipse cx="160" cy="194" rx="110" ry="9" fill="#000" opacity=".08"/>
      ${[0, 1, 2].map((i) => `<ellipse cx="150" cy="118" rx="${70 - i * 12}" ry="${56 - i * 10}" fill="none" stroke="${accent}" stroke-width="8"/><ellipse cx="150" cy="118" rx="${70 - i * 12}" ry="${56 - i * 10}" fill="none" stroke="${dark}" stroke-width="8" stroke-dasharray="3 5" opacity=".45"/>`).join("")}
      <path d="M220 118c20 0 30 20 52 30" stroke="${accent}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M220 118c20 0 30 20 52 30" stroke="${dark}" stroke-width="8" fill="none" stroke-dasharray="3 5" opacity=".45"/>
      <rect x="266" y="140" width="34" height="18" rx="6" fill="#C9CED3" transform="rotate(24 283 149)"/><rect x="290" y="150" width="14" height="8" rx="3" fill="#8A9097" transform="rotate(24 297 154)"/>
      <path d="M80 118c-20 0-30-24-48-30" stroke="${accent}" stroke-width="8" fill="none" stroke-linecap="round"/><rect x="14" y="76" width="34" height="18" rx="6" fill="#C9CED3" transform="rotate(20 31 85)"/>
      <rect x="196" y="98" width="62" height="24" rx="12" fill="#FFFDF8" stroke="#E4D9C8"/><text x="227" y="114" text-anchor="middle" font-family="${SCRIPT}" font-size="15" fill="#2B211C">${esc(short(name, 9))}</text>
      ${brand ? `<text x="150" y="122" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="9" letter-spacing="2.5" fill="#5A4E45">${esc(fit(up(brand), 12))}</text>` : ""}</svg>`; }
  const KINDS = { mug, loaf, jar, card, photo, dish, plush, popup, phin, bag, cup, keycap, clips, wrap: cordwrap, charger, deskmat, cable };
  window.GiftArt = { kindOf, svg: (kind, o = {}) => (KINDS[kind] || card)(o), forGift: (g, o = {}) => { const t = `${g?.name || ""} ${g?.desc || ""}`.toLowerCase(); return (KINDS[kindOf(g)] || card)({ species: /beaver/.test(t) ? "beaver" : /robot|\bbot\b/.test(t) ? "robot" : "", scene: /launch|invite|rocket/.test(t) ? "launch" : /flower|garden|bloom|bouquet/.test(t) ? "garden" : "", ...o }); } };
})();
