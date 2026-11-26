// Preview pages (public/presets/showcase.json) are set up for businesses that haven't joined. Owner decision: they stay
// reachable at /@handle and /x/..., labelled "Preview, not on Pottery Lab yet", and stay out of the feed, stories, the
// swipe deck, Discover, the Hosts lists and directory results, unless their handle is in ENCORE_FEED_PREVIEWS (the
// ones the owner has written consent from; empty by default). Clearly made-up example pages (marked example) can stay.
// A module of its own, with no imports, so community.js, feedvisual.js, interest.js and app.js can all use it.
export const PREVIEW_LABEL = "Preview, not on Pottery Lab yet";
export const feedPreviews = () => new Set(String(process.env.ENCORE_FEED_PREVIEWS || "").split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean));
export const previewListed = (handle, P) => !!P?.example || feedPreviews().has(String(handle || "").toLowerCase());
