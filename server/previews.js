// Preview pages (public/presets/showcase.json) are pages the owner prepared for hosts who haven't joined yet. They show
// at /@handle and /x/..., labelled "Preview, not on Pottery Lab yet". Owner decision (Nov 2026): they are listed again in
// the feed, stories, the swipe deck, Discover and the Hosts lists, to show the range of hosts on Pottery Lab.
// ENCORE_FEED_PREVIEWS narrows that: unset or "all" lists every one, a list of handles lists only those, and "none"
// lists none. ENCORE_HIDE_PREVIEWS takes single handles out (say, a host who asks to be removed). Clearly made-up
// example pages (marked example) are always listed.
// A module of its own, with no imports, so community.js, feedvisual.js, interest.js and app.js can all use it.
export const PREVIEW_LABEL = "Preview, not on Pottery Lab yet";
const handles = (v) => new Set(String(v || "").split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean));
export const feedPreviews = () => handles(process.env.ENCORE_FEED_PREVIEWS);
export const previewListed = (handle, P) => { if (P?.example) return true; const h = String(handle || "").toLowerCase(); if (handles(process.env.ENCORE_HIDE_PREVIEWS).has(h)) return false;
  const only = feedPreviews(); if (!only.size || only.has("all")) return true; if (only.has("none")) return false; return only.has(h); };
