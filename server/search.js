// Smarter host search: people type what they want ("a pottery class for 20 people in Brooklyn", "something
// sweet for a team offsite") and Claude picks the hosts that fit, with one line on why. Only hosts on the public
// directory are sent, only public fields, and Claude can only return handles from that list.
import { complete, isFake, parseJsonLoose } from "./ai.js";

const CACHE_MS = 15 * 60e3, MAX_CACHE = 300, PER_HOUR = 40;
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// a few everyday words people use for what hosts do, for the offline ranking
const SYN = {
  coffee: ["cafe", "café", "latte", "espresso", "phin", "barista", "matcha", "tea"], tea: ["matcha", "coffee"], matcha: ["tea", "coffee"],
  bake: ["baking", "bread", "sourdough", "cake", "pastry", "dessert", "bánh"], dessert: ["cake", "sweet", "pastry", "bánh", "pandan"], sweet: ["cake", "dessert", "pandan", "pastry"],
  draw: ["drawing", "sketch", "portrait", "illustration", "art", "painting"], art: ["drawing", "painting", "portrait", "illustration", "pottery", "ceramics"], portrait: ["drawing", "portraits", "sketch"],
  wedding: ["weddings", "bride", "celebration"], run: ["running", "runner", "run club", "jog"], dinner: ["supper", "dining", "cook", "chef", "meal"], cook: ["chef", "cooking", "dinner", "food"],
  pottery: ["ceramics", "clay", "kiln"], flowers: ["flower", "bouquet", "florist", "floral"], team: ["offsite", "company", "brand", "corporate"], offsite: ["team", "company"],
  vietnamese: ["bánh", "phin", "pho", "viet"], food: ["dinner", "cook", "bake", "cake", "supper"], workshop: ["class", "lesson", "learn"], class: ["workshop", "lesson"],
};
// look synonyms up both ways: "latte" finds coffee hosts just as "coffee" finds latte ones
const REL = new Map(); for (const [k, L] of Object.entries(SYN)) for (const w of [k, ...L]) { const set = REL.get(w) || new Set(); set.add(k); L.forEach((x) => set.add(x)); REL.set(w, set); }
const words = (s) => String(s || "").toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
const STOP = new Set(["the", "and", "for", "with", "who", "someone", "something", "people", "looking", "want", "need", "can", "near", "our", "that", "this", "host", "hosts", "find"]);

export function cardOf(h) {
  return { handle: h.handle, name: clean(h.name, 80), city: clean([h.hood, h.city].filter(Boolean).join(", "), 80), tagline: clean(h.tagline, 160), about: clean(h.bio, 400), tags: (h.tags || []).slice(0, 8).map((t) => clean(t, 30)),
    offers: (h.experiences || []).slice(0, 4).map((x) => clean([x.name, x.min && x.max ? `${x.min}-${x.max} people` : "", x.price].filter(Boolean).join(", "), 120)), sells: [...((h.shop?.open && h.shop.items) || []), ...(h.gifts || [])].slice(0, 6).map((x) => clean(x.name, 60)).filter(Boolean), upcoming: h.upcoming || 0, notOnEncoreYet: !!h.showcase };
}

/** Keyword ranking used offline and as a fallback: each query word (and its everyday synonyms) that a host mentions counts. */
// whole words only (an optional plural is fine): "tea" shouldn't match "team"
const has = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?($|[^\\p{L}\\p{N}])`, "u").test(text);
export function keywordRank(q, hosts, n = 8) {
  const want = words(q).filter((w) => !STOP.has(w)); if (!want.length) return [];
  const out = [];
  for (const h of hosts) { const c = cardOf(h), text = `${c.name} ${c.city} ${c.tagline} ${c.about} ${c.tags.join(" ")} ${c.offers.join(" ")} ${c.sells.join(" ")}`.toLowerCase(); let score = 0; const hits = [];
    for (const w of want) { const stem = w.replace(/(ing|es|s)$/, ""); const alts = [w, stem, ...(REL.get(w) || REL.get(stem) || [])]; const hit = alts.find((a) => a.length > 2 && has(text, a)); if (hit) { score += hit === w || hit === stem ? 2 : 1; hits.push(hit); } }
    if (score) out.push({ handle: h.handle, score, why: `Mentions ${[...new Set(hits)].slice(0, 3).join(", ")}` }); }
  return out.sort((a, b) => b.score - a.score).slice(0, n).map(({ handle, why }) => ({ handle, why }));
}

async function askClaude(q, hosts) {
  const cards = hosts.slice(0, 80).map(cardOf);
  const prompt = `You help people find hosts on Pottery Lab, a site where people host small experiences (supper clubs, run clubs, workshops, pop-ups) and brands book them.
Someone searched: "${clean(q, 200)}"

Hosts (JSON):
${JSON.stringify(cards)}

Pick the hosts that fit what they asked for, best first, at most 6. Leave out hosts that don't fit; an empty list is fine.
Prefer hosts who are on the site and list offers they can be booked for; put hosts marked notOnEncoreYet after them. Judge only from the information given. Don't invent prices, dates or details. Where a host is "notOnEncoreYet", they can still be a match.
For each, write one short reason (at most 14 words) that points to something on their profile.
Reply with JSON only: {"matches":[{"handle":"...","why":"..."}]}`;
  const r = await complete({ prompt, effort: "low" });
  const j = parseJsonLoose(r.text) || {}, known = new Set(hosts.map((h) => h.handle));
  return (Array.isArray(j.matches) ? j.matches : []).filter((m) => m && known.has(m.handle)).slice(0, 6).map((m) => ({ handle: m.handle, why: clean(m.why, 140) }));
}

export function registerSearch(app, { hosts }) {
  const cache = new Map(), hits = new Map();
  const limited = (req) => { const k = req.ip || "?", now = Date.now(); const h = (hits.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); hits.set(k, h); return h.length > PER_HOUR; };
  app.get("/api/public/hosts/search", async (req, res) => {
    const q = clean(req.query.q, 200); if (q.length < 3) return res.json({ q, matches: [], by: "none" });
    const list = hosts(), key = q.toLowerCase(), hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json({ q, matches: hit.matches, by: hit.by });
    let matches = [], by = "keywords";
    if (!isFake() && !limited(req)) { try { matches = await askClaude(q, list); by = "ai"; } catch { matches = []; by = "keywords"; } }
    if (by !== "ai") matches = keywordRank(q, list);
    // hosts who can actually be booked here come first; pages for hosts not on the site yet go after them
    { const H = new Map(list.map((h) => [h.handle, h])), rank = (m) => { const h = H.get(m.handle) || {}, offers = (h.experiences || []).length > 0; return h.showcase ? 4 : offers ? (h.sample ? 1 : 0) : h.sample ? 3 : 2; }; matches = matches.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m); }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), matches, by });
    res.json({ q, matches, by });
  });
}
