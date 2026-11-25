// Per-event looks: the colours, effect, title font and reply button a host picks in "Make it yours".
// Saved on the event as `look`; every value is checked against these lists (public/looks.js offers the same ones).
export const LOOK = {
  effects: ["none", "sparkles", "snow", "confetti", "petals", "paper", "velvet", "stars", "twinkle"],
  titleFonts: ["clean", "bold", "serif", "script", "typewriter", "rounded"],
  coverFits: ["banner", "poster"],
  buttonLabels: ["I'm in", "Join", "RSVP", "Count me in", "Save my spot", "Ask to join"],
  buttonEmoji: ["👍", "🙌", "🎉", "✨", "🌿", "🌸", "💐", "🌷", "🍷", "🥂", "🍸", "🍜", "🎷", "🎶", "🎄", "❄️", "⛄", "🎁", "🏺", "🍵", "🕯️", "🔥", "🏮", "❤️"],
  vibes: ["garden", "jazz", "winter", "velvet", "flower", "night", "market"],
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const size = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : 0);
/** A flyer taller than it is wide shows whole (a poster); anything else is a cropped banner. */
export const fitOf = (look = {}) => (LOOK.coverFits.includes(look?.coverFit) ? look.coverFit : size(look?.coverH) > size(look?.coverW) && size(look?.coverW) ? "poster" : "banner");
/** Keep only known values: hex colours, listed effects, fonts, labels and emoji. Anything else is dropped. */
export function cleanLook(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = {};
  if (Array.isArray(v.palette)) { const p = v.palette.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 3).map((c) => c.toUpperCase()); if (p.length) o.palette = p; }
  if (LOOK.effects.includes(v.effect)) o.effect = v.effect;
  if (LOOK.titleFonts.includes(v.titleFont)) o.titleFont = v.titleFont;
  if (LOOK.buttonEmoji.includes(v.buttonEmoji)) o.buttonEmoji = v.buttonEmoji;
  if (LOOK.buttonLabels.includes(v.buttonLabel)) o.buttonLabel = v.buttonLabel;
  if (LOOK.vibes.includes(v.vibe)) o.vibe = v.vibe;
  if (v.lights === true) o.lights = true; // string lights across the top, on top of any effect
  // an "Update" callout: one short line from the host, with when they posted it
  if (v.update && typeof v.update === "object") { const text = String(v.update.text ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const at = Number.isInteger(v.update.at) && v.update.at > 1.5e12 && v.update.at <= Date.now() + 864e5 ? v.update.at : Date.now(); if (text) o.update = { text, at }; }
  if (size(v.coverW) && size(v.coverH)) { o.coverW = v.coverW; o.coverH = v.coverH; }
  if (LOOK.coverFits.includes(v.coverFit)) o.coverFit = v.coverFit; else if (o.coverW && o.coverH > o.coverW) o.coverFit = "poster";
  return o;
}
/** An event write: its look cleaned, and no dotted "look.x" keys around the check. */
export function withCleanLook(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const hasDotted = Object.keys(body).some((k) => k.startsWith("look."));
  if (!("look" in body) && !hasDotted) return body;
  const out = { ...body };
  for (const k of Object.keys(out)) if (k.startsWith("look.")) delete out[k];
  if ("look" in body) out.look = cleanLook(body.look);
  return out;
}
