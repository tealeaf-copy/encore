// Per-event looks: the colours, effect, title font and reply button a host picks in "Make it yours".
// Saved on the event as `look`; every value is checked against these lists (public/looks.js offers the same ones).
export const LOOK = {
  effects: ["none", "sparkles", "snow", "confetti", "petals", "paper", "velvet", "stars", "twinkle", "lanterns", "scanlines", "pixels", "jarwall",
    // drawn by public/effects.js (the canvas Effect tray); the older ids above stay valid so old events keep their effect
    "streamers", "balloons", "bulbs", "dice", "leaves", "rain", "steam", "bubbles"],
  // how much of the effect: a few shapes (subtle, the default) or more of them (lively)
  effectLevels: ["subtle", "lively"],
  titleFonts: ["clean", "bold", "serif", "script", "typewriter", "rounded", "mono", "pixel", "slab"],
  coverFits: ["banner", "poster"],
  buttonLabels: ["I'm in", "Join", "Count me in", "Ask to join"],
  // review round 11: labels off the word list (docs/brand-kit.md) that older events may still carry read "I'm in"
  oldLabels: { RSVP: "I'm in", "Save my spot": "I'm in" },
  buttonEmoji: ["👍", "🙌", "🎉", "✨", "🌿", "🌸", "💐", "🌷", "🍷", "🥂", "🍸", "🍜", "🎷", "🎶", "🎄", "❄️", "⛄", "🎁", "🏺", "🍵", "🕯️", "🔥", "🏮", "❤️", "💻", "🎮", "👾", "🕹️", "🎲", "🍂", "🫙", "☕"],
  vibes: ["garden", "jazz", "winter", "velvet", "flower", "night", "market", "terminal", "pixel", "cards", "pantry"],
  // how a drawn cover sits: the house cover, or a flat pastel playing card with the kind of event in the corner
  coverStyles: ["deck"],
  // how a menu is drawn on the invites: the house card, or a cream harvest card with a border of leaves, pinecones and berries
  menuStyles: ["harvest"],
  // stickers a host can put on their cover (public/looks.js STICKERS draws them), at most 6
  stickers: ["star", "heart", "sparkle", "flower", "lantern", "dumpling", "pot", "note", "d20", "controller", "key", "floppy", "heartbox", "cursor", "jar", "pinecone", "maple", "cocoa", "candle", "hextile"],
  maxStickers: 6,
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const size = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : 0);
/** A flyer taller than it is wide shows whole (a poster); anything else is a cropped banner. */
export const fitOf = (look = {}) => (LOOK.coverFits.includes(look?.coverFit) ? look.coverFit : size(look?.coverH) > size(look?.coverW) && size(look?.coverW) ? "poster" : "banner");
const clamp = (n, lo, hi, d) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d);
/** Stickers on the cover: a listed id, where it sits (percent of the cover, 0 to 100), its size (0.6 to 1.6) and tilt (-40 to 40 degrees). At most 6. */
export function cleanStickers(L) {
  if (!Array.isArray(L)) return [];
  return L.filter((x) => x && typeof x === "object" && LOOK.stickers.includes(x.id)).slice(0, LOOK.maxStickers)
    .map((x) => ({ id: x.id, x: clamp(x.x, 0, 100, 50), y: clamp(x.y, 0, 100, 50), s: clamp(x.s, 0.6, 1.6, 1), r: clamp(x.r, -40, 40, 0) }));
}
/** Keep only known values: hex colours, listed effects, fonts, labels and emoji. Anything else is dropped. */
export function cleanLook(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = {};
  if (Array.isArray(v.palette)) { const p = v.palette.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 3).map((c) => c.toUpperCase()); if (p.length) o.palette = p; }
  if (LOOK.effects.includes(v.effect)) o.effect = v.effect;
  if (o.effect && o.effect !== "none" && v.effectLevel === "lively") o.effectLevel = "lively"; // subtle is the default and is not stored
  if (LOOK.titleFonts.includes(v.titleFont)) o.titleFont = v.titleFont;
  if (LOOK.buttonEmoji.includes(v.buttonEmoji)) o.buttonEmoji = v.buttonEmoji;
  if (LOOK.buttonLabels.includes(v.buttonLabel)) o.buttonLabel = v.buttonLabel; else if (Object.hasOwn(LOOK.oldLabels, String(v.buttonLabel))) o.buttonLabel = LOOK.oldLabels[v.buttonLabel];
  if (LOOK.vibes.includes(v.vibe)) o.vibe = v.vibe;
  if (LOOK.coverStyles.includes(v.coverStyle)) o.coverStyle = v.coverStyle;
  if (LOOK.menuStyles.includes(v.menuStyle)) o.menuStyle = v.menuStyle;
  if (Array.isArray(v.stickers)) { const st = cleanStickers(v.stickers); if (st.length) o.stickers = st; }
  if (v.lights === true) o.lights = true; // string lights across the top, on top of any effect
  // brand kits (server/brandkit.js): a look saved since kits carries kit: 1, and its title font only wins over the
  // host's kit when the host picked it for this event (ownFont). Looks from before kits keep their font.
  if (v.kit === 1) o.kit = 1;
  if (v.ownFont === true && o.titleFont) o.ownFont = true;
  // an "Update" callout: one short line from the host, with when they posted it
  if (v.update && typeof v.update === "object") { const text = String(v.update.text ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const at = Number.isInteger(v.update.at) && v.update.at > 1.5e12 && v.update.at <= Date.now() + 864e5 ? v.update.at : Date.now(); if (text) o.update = { text, at }; }
  if (size(v.coverW) && size(v.coverH)) { o.coverW = v.coverW; o.coverH = v.coverH; }
  if (LOOK.coverFits.includes(v.coverFit)) o.coverFit = v.coverFit; else if (o.coverW && o.coverH > o.coverW) o.coverFit = "poster";
  return o;
}
/** An event write: its look cleaned, and no dotted "look.x" keys around the check. */
// a price typed as a bare number ("55") reads "$55" everywhere
export const dollarPrice = (v) => (typeof v === "string" && /^\s*\d{1,5}(\.\d{1,2})?\s*$/.test(v) ? "$" + v.trim() : typeof v === "number" && v > 0 ? "$" + v : v);
// ---- price tiers: "Adults $55 · Kids $35" (public/tiers.js has the same rules for the pages) ----
export const TIERS = { max: 4, label: 20 };
const tierNum = (v) => { const m = String(v ?? "").replace(/,/g, "").match(/(\d{1,6}(?:\.\d{1,2})?)/); const n = typeof v === "number" ? v : m ? +m[1] : 0; return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : 0; };
const tierLabel = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>$]/g, " ").replace(/\s+/g, " ").trim().slice(0, TIERS.label).trim();
/** At most 4 tiers, each a label (up to 20 characters, no markup or "$") and a price above zero; repeated labels dropped. */
export function cleanTiers(L) { if (!Array.isArray(L)) return []; const seen = new Set(), out = [];
  for (const x of L) { if (!x || typeof x !== "object") continue; const label = tierLabel(x.label), price = tierNum(x.price);
    if (!label || !price || seen.has(label.toLowerCase())) continue; seen.add(label.toLowerCase()); out.push({ label, price }); if (out.length >= TIERS.max) break; }
  return out; }
const money = (n) => { const c = Math.round(+n * 100); return "$" + (c % 100 ? (c / 100).toFixed(2) : String(c / 100)); };
/** "Adults $55 · Kids $35", or "" for an event with one price. */
export const tierLine = (e) => cleanTiers(e?.priceTiers).map((t) => `${t.label} ${money(t.price)}`).join(" · ");
/** A guest's picks: [{ label, n }], at most 4, 0 to 50 of each, zeros and repeats left out. */
export function cleanPicks(L) { if (!Array.isArray(L)) return []; const out = [];
  for (const p of L.slice(0, TIERS.max)) { const label = tierLabel(p?.label), n = Math.max(0, Math.min(50, Math.floor(+p?.n || 0)));
    if (label && n && !out.some((o) => o.label.toLowerCase() === label.toLowerCase())) out.push({ label, n }); }
  return out; }
/** What a reply costs on a tiered event: the sum over tiers of the tier's price times how many (0 without tiers or picks). */
export function tierTotal(ev, r) { const T = cleanTiers(ev?.priceTiers); if (!T.length) return 0; let c = 0;
  for (const p of cleanPicks(r?.tiers)) { const t = T.find((x) => x.label.toLowerCase() === p.label.toLowerCase()); if (t) c += Math.round(t.price * 100) * p.n; }
  return c / 100; }
export function withCleanLook(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if ("priceTiers" in body) body = { ...body, priceTiers: cleanTiers(body.priceTiers) };
  if ("price" in body && body.price !== "chip") { const d = dollarPrice(body.price); if (d !== body.price) body = { ...body, price: d }; }
  const hasDotted = Object.keys(body).some((k) => k.startsWith("look."));
  if (!("look" in body) && !hasDotted) return body;
  const out = { ...body };
  for (const k of Object.keys(out)) if (k.startsWith("look.")) delete out[k];
  if ("look" in body) out.look = cleanLook(body.look);
  return out;
}
