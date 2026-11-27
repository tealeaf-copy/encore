// "Ideas to try" where people feel stuck (owner request): 3 or 4 ideas from the ideas library (server/ideas.js via
// IDEAS in server/hooks.js), local and seasonal, matched to what the host has made before or the interests they picked.
// GET /api/public/ideas/try?n=4&interests=run,coffee&city=Austin  ->  { ideas: [{ id, title, line, say }] }
// Signed in, the host's own past events count too (their activities and titles), and ideas they've already run drop out.
import { DEFAULT_WS, scopeStore } from "./workspaces.js";

const lc = (s) => String(s || "").toLowerCase();
// what fits the month: northern-hemisphere seasons (the cities Pottery Lab is in today)
const SEASON = [
  [[11, 0, 1], /soup|game|board|mahjong|movie|watch|bake|sourdough|dumpling|supper|salon|book|matcha|coffee|pottery|wheel|hack|lan|paper/],
  [[2, 3, 4], /run|hike|picnic|walk|sketch|bouquet|market|bake sale|coffee|salsa/],
  [[5, 6, 7], /picnic|park|run|hike|sunset|yoga|roof|salsa|taco|wine|market|bagels/],
  [[8, 9, 10], /supper|potluck|dumpling|pottery|wheel|book|salon|improv|game|run|hike|wine|sourdough/],
];
const dayHash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/** Up to n ideas, best fit first. `kinds` is free text about what the host has made before. */
export function pickIdeas(IDEAS, { interests = [], kinds = "", made = [], month = new Date().getMonth(), n = 4, today = new Date().toISOString().slice(0, 10), boost = null } = {}) {
  const I = interests.map(lc).filter(Boolean), K = lc(kinds), M = new Set(made.map(lc)), season = (SEASON.find(([ms]) => ms.includes(month)) || [[], /$^/])[1];
  const words = K.split(/[^a-z]+/).filter((w) => w.length > 3);
  return IDEAS.filter((x) => x?.id && x.title && !M.has(lc(x.title)))
    .map((x) => { const t = lc(`${x.title} ${x.line} ${(x.interests || []).join(" ")}`); let s = 0;
      s += (x.interests || []).filter((k) => I.includes(k)).length * 3;
      s += words.filter((w) => t.includes(w)).length * 2;
      if (season.test(t)) s += 2;
      if (boost) s += +boost[x.id] || 0; // trends (server/trends.js): loved here, then trending on social
      return { x, s, r: dayHash(x.id + today) }; })
    .sort((a, b) => b.s - a.s || a.r - b.r).slice(0, Math.max(1, Math.min(4, n)))
    .map(({ x }) => ({ id: x.id, title: x.title, line: x.line || "", say: x.say || `${x.title}: ${x.line || ""}` }));
}

export function mountIdeasNudge(app, { store, currentUser, IDEAS }) {
  app.get("/api/public/ideas/try", (req, res) => {
    const u = currentUser(req), list = (v) => String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z-]{2,24}$/.test(s)).slice(0, 12);
    let kinds = "", made = [];
    if (u && u.ws && u.ws !== DEFAULT_WS) { try { const E = scopeStore(store, u.ws).list("events").map((d) => d.data).filter((e) => e && !e.example && !e.sample); kinds = E.map((e) => `${e.activity || ""} ${e.pubTitle || e.name || ""}`).join(" "); made = E.map((e) => e.pubTitle || e.name || ""); } catch {} }
    // trends (server/trends.js): each idea says who vouches for it ("Loved here: ...", "Trending on social", "An idea from Potto")
    const T = app.locals.trends, city = String(req.query.city || "").replace(/[^\p{L}\p{N} .'-]/gu, "").slice(0, 60); let boost = null, A = null;
    if (T) { try { A = new Map(T.annotate(IDEAS, { city }).map((x) => [x.id, x])); boost = Object.fromEntries([...A.values()].map((x) => [x.id, x.rank * 2])); } catch {} }
    const L = pickIdeas(IDEAS, { interests: list(req.query.interests), kinds, made, n: +req.query.n || 4, boost }).map((x) => { const a = A?.get(x.id); return a ? { ...x, source: a.source, sourceLine: a.sourceLine } : x; });
    res.set("Cache-Control", u ? "private, no-store" : "public, max-age=300").json({ ideas: L });
  });
}
