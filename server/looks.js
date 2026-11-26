// Per-event looks: the colours, effect, title font and reply button a host picks in "Make it yours".
// Saved on the event as `look`; every value is checked against these lists (public/looks.js offers the same ones).
export const LOOK = {
  effects: ["none", "sparkles", "snow", "confetti", "petals", "paper", "velvet", "stars", "twinkle", "lanterns", "scanlines", "pixels"],
  titleFonts: ["clean", "bold", "serif", "script", "typewriter", "rounded", "mono", "pixel"],
  coverFits: ["banner", "poster"],
  buttonLabels: ["I'm in", "Join", "Count me in", "Ask to join"],
  // review round 11: labels off the word list (docs/brand-kit.md) that older events may still carry read "I'm in"
  oldLabels: { RSVP: "I'm in", "Save my spot": "I'm in" },
  buttonEmoji: ["👍", "🙌", "🎉", "✨", "🌿", "🌸", "💐", "🌷", "🍷", "🥂", "🍸", "🍜", "🎷", "🎶", "🎄", "❄️", "⛄", "🎁", "🏺", "🍵", "🕯️", "🔥", "🏮", "❤️", "💻", "🎮", "👾", "🕹️", "🎲"],
  vibes: ["garden", "jazz", "winter", "velvet", "flower", "night", "market", "terminal", "pixel", "cards"],
  // how a drawn cover sits: the house cover, or a flat pastel playing card with the kind of event in the corner
  coverStyles: ["deck"],
  // stickers a host can put on their cover (public/looks.js STICKERS draws them), at most 6
  stickers: ["star", "heart", "sparkle", "flower", "lantern", "dumpling", "pot", "note", "d20", "controller", "key", "floppy", "heartbox", "cursor"],
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
  if (LOOK.titleFonts.includes(v.titleFont)) o.titleFont = v.titleFont;
  if (LOOK.buttonEmoji.includes(v.buttonEmoji)) o.buttonEmoji = v.buttonEmoji;
  if (LOOK.buttonLabels.includes(v.buttonLabel)) o.buttonLabel = v.buttonLabel; else if (Object.hasOwn(LOOK.oldLabels, String(v.buttonLabel))) o.buttonLabel = LOOK.oldLabels[v.buttonLabel];
  if (LOOK.vibes.includes(v.vibe)) o.vibe = v.vibe;
  if (LOOK.coverStyles.includes(v.coverStyle)) o.coverStyle = v.coverStyle;
  if (Array.isArray(v.stickers)) { const st = cleanStickers(v.stickers); if (st.length) o.stickers = st; }
  if (v.lights === true) o.lights = true; // string lights across the top, on top of any effect
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
export function withCleanLook(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if ("price" in body && body.price !== "chip") { const d = dollarPrice(body.price); if (d !== body.price) body = { ...body, price: d }; }
  const hasDotted = Object.keys(body).some((k) => k.startsWith("look."));
  if (!("look" in body) && !hasDotted) return body;
  const out = { ...body };
  for (const k of Object.keys(out)) if (k.startsWith("look.")) delete out[k];
  if ("look" in body) out.look = cleanLook(body.look);
  return out;
}
