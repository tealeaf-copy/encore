// ---- GIFs and stickers for feed comments ----
// The GIF button next to a comment box (public/feedfun.js) searches here. One provider, chosen by which key is set:
//   GIPHY_API_KEY   GIPHY search (api.giphy.com), rating "pg"; the picker shows "via GIPHY"
//   TENOR_API_KEY   Tenor search (tenor.googleapis.com, v2), contentfilter "medium"; the picker shows "via Tenor"
// With neither, the button opens our own stickers (STICKERS, drawn in public/feedfun.js), so it works with no key.
//
// Privacy: the search runs on the server. The provider gets the search words, the key and nothing else: no cookie, no
// email, no IP of the viewer (it sees ours), no user id. Results are cached for 10 minutes per search.
// A GIF comment keeps only the provider's CDN URLs (cleanGif checks the host), its size and which provider it came from.
//
// GET /api/feed/gifs?q=  ->  { provider: "giphy" | "tenor", results: [{ src, url, mp4?, w, h }] }  or
//                            { provider: "stickers", stickers: [ids] }
export const STICKERS = ["cheers", "bowl", "potto", "confetti", "shoe", "heart", "clap", "see-you", "so-good", "count-me-in", "dice", "coffee", "sun", "star", "wave", "cake"];
const HOSTS = { giphy: /^(media\d?\.giphy\.com|i\.giphy\.com)$/, tenor: /^(media\d?\.tenor\.com|c\.tenor\.com)$/ };
export const gifProvider = () => (process.env.GIPHY_API_KEY ? "giphy" : process.env.TENOR_API_KEY ? "tenor" : "");
/** A GIF as a comment may keep it: https on the provider's own CDN, a .gif/.mp4/.webp file, a sane size. Else null. */
export function cleanGif(g) {
  if (!g || typeof g !== "object") return null; const src = g.src === "giphy" || g.src === "tenor" ? g.src : ""; if (!src) return null;
  const ok = (u) => { try { const x = new URL(String(u || "")); return x.protocol === "https:" && !x.username && !x.password && !x.port && HOSTS[src].test(x.hostname) && /\.(gif|mp4|webp)$/i.test(x.pathname) ? x.origin + x.pathname : ""; } catch { return ""; } };
  const url = ok(g.url); if (!url || /\.mp4$/i.test(url)) return null; const mp4 = g.mp4 ? ok(g.mp4) : "";
  const w = Math.round(+g.w), h = Math.round(+g.h); if (!(w >= 16 && w <= 2000 && h >= 16 && h <= 2000)) return null;
  return { src, url, ...(mp4 && /\.mp4$/i.test(mp4) ? { mp4 } : {}), w, h };
}
export const cleanSticker = (s) => (STICKERS.includes(String(s || "")) ? String(s) : "");

export function mountGifs(app) {
  const cache = new Map(), hits = new Map(), TTL = 10 * 60e3;
  const over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  async function search(provider, q) {
    const k = provider + "|" + q, c = cache.get(k); if (c && Date.now() - c.at < TTL) return c.results;
    let url; if (provider === "giphy") { const p = new URLSearchParams({ api_key: process.env.GIPHY_API_KEY, limit: "24", rating: "pg", lang: "en", bundle: "messaging_non_clips" }); if (q) p.set("q", q); url = `https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}?${p}`; }
    else { const p = new URLSearchParams({ key: process.env.TENOR_API_KEY, limit: "24", contentfilter: "medium", media_filter: "tinygif,tinymp4", client_key: "pottery-lab" }); if (q) p.set("q", q); url = `https://tenor.googleapis.com/v2/${q ? "search" : "featured"}?${p}`; }
    // nothing about the viewer goes with it: no cookies, no forwarded headers, a plain client name
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "PotteryLab/1.0" }, redirect: "error", signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error("provider " + r.status); const j = await r.json();
    const results = (provider === "giphy" ? (j.data || []).map((d) => { const f = d?.images?.fixed_height || {}; return cleanGif({ src: "giphy", url: f.url, mp4: f.mp4, w: f.width, h: f.height }); })
      : (j.results || []).map((d) => { const g = d?.media_formats?.tinygif || {}, m = d?.media_formats?.tinymp4 || {}; return cleanGif({ src: "tenor", url: g.url, mp4: m.url, w: g.dims?.[0], h: g.dims?.[1] }); })).filter(Boolean).slice(0, 24);
    if (cache.size > 300) cache.clear(); cache.set(k, { at: Date.now(), results }); return results;
  }
  app.get("/api/feed/gifs", async (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|" + (req.ip || "?"), Math.max(30, +process.env.ENCORE_GIFS_PER_IP_HOUR || 240))) return res.status(429).json({ code: "rate_limited", message: "Slow down." });
    const provider = gifProvider(); if (!provider) return res.json({ provider: "stickers", stickers: STICKERS });
    const q = String(req.query.q || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50).toLowerCase();
    try { res.json({ provider, results: await search(provider, q) }); } catch { res.json({ provider, results: [], message: "GIFs didn't load. Try again in a moment." }); } });
}
// ---- end GIFs and stickers ----
