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

// ---------------------------------------------------------------------------------------------------------------
// The /teams matcher: the goal decides what wins. A seated 12-seat dinner should beat a run club for 12 execs;
// a sampling cart should beat a workshop for a street pop-up; a venue should come first for a meetup.
export const METROS = [["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx", "staten island", "jersey city", "hoboken", "bushwick", "williamsburg", "greenpoint"], ["san francisco", "sf", "oakland", "berkeley", "bay area", "sf bay area", "san jose", "palo alto"], ["los angeles", "la", "santa monica", "pasadena"], ["chicago"], ["boston", "cambridge", "somerville"], ["seattle"], ["austin"], ["denver"], ["las vegas", "vegas"]];
export const METRO_NAMES = ["New York", "SF Bay Area", "Los Angeles", "Chicago", "Boston", "Seattle", "Austin", "Denver", "Las Vegas"];
export const metroOf = (s) => { s = String(s || "").trim().toLowerCase(); return s ? METROS.findIndex((m) => m.some((x) => s === x || (s.includes(x) && x.length > 3))) : -1; };
// a borough or neighbourhood someone typed, so "Manhattan" stays in Manhattan when it can
const BOROUGH_OF = { bushwick: "brooklyn", williamsburg: "brooklyn", greenpoint: "brooklyn", "park slope": "brooklyn", "lower east side": "manhattan", soho: "manhattan", "east village": "manhattan", "west village": "manhattan", tribeca: "manhattan", chelsea: "manhattan", midtown: "manhattan", harlem: "manhattan", astoria: "queens", "long island city": "queens", mission: "san francisco", soma: "san francisco" };
export const placeOf = (s) => { const t = String(s || "").trim().toLowerCase(); for (const [k, v] of Object.entries(BOROUGH_OF)) if (t.includes(k)) return v; return t; };
/** Where a host is, relative to what was asked: "here" (same city or borough), "metro" (same metro, other borough), or "away". */
export function placeFit(ask, h) { const a = placeOf(ask), hc = String(h.city || "").trim().toLowerCase(), hh = String(h.hood || "").trim().toLowerCase(); if (!a) return "here";
  const hp = [placeOf(hc), placeOf(hh), hc, hh].filter(Boolean); if (hp.some((x) => x === a || x.includes(a) || (a.length > 3 && a.includes(x) && x.length > 3))) return "here";
  const ma = metroOf(a); if (ma >= 0 && (ma === metroOf(hc) || ma === metroOf(hh) || (h.alsoIn || []).some((x) => metroOf(x) === ma))) { const generic = ["new york", "nyc", "san francisco", "sf", "bay area", "sf bay area", "los angeles", "la"].includes(a); return generic ? "here" : "metro"; }
  return "away"; }
export const perPerson = (price) => { const m = String(price || "").replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)/); return m ? +m[1] : 0; };
export const isFlat = (price) => /\bflat\b|per (event|day|booking)|total/i.test(String(price || ""));

// What each goal is for, who comes, and what the format needs
export const TEAM_GOALS = {
  bonding: { label: "Team bonding", audience: "team", cats: ["workshop", "movement", "food", "dining"], words: /\b(workshop|class|make|build|together|hands-on|cook|run)\b/i },
  clients: { label: "Client or customer appreciation", audience: "guests", cats: ["dining", "drinks", "food", "workshop"], words: /\b(dinner|tasting|chef|supper|private|clients?|customers?|wine|reception)\b/i, avoid: /\b(run|jog|hike|sweat|pilates|bootcamp)\b/i },
  exec: { label: "Prospect / exec dinner", audience: "guests", cats: ["dining"], seated: true, words: /\b(omakase|tasting|chef'?s table|private (room|dining)|seated|supper|dinner|roundtable|counter|courses?)\b/i, avoid: /\b(run|jog|hike|sweat|pilates|yoga|bootcamp|cart|pop-?up|kids)\b/i },
  sampling: { label: "Public sampling / pop-up", audience: "public", cats: ["food", "drinks"], words: /\b(pop-?up|cart|sampl\w*|booth|stand|street|market|bar|tasting|truck|kiosk|activation)\b/i, content: /\b(photo|content|reel|post|stories|ugc|video)\b/i },
  offsite: { label: "Offsite afternoon", audience: "team", cats: ["movement", "workshop", "culture", "food"], words: /\b(offsite|day|afternoon|farm|retreat|outdoor|hike)\b/i },
  activation: { label: "Brand moment or launch", audience: "guests", cats: ["workshop", "drinks", "culture", "food"], words: /\b(launch|brand|pop-?up|reception|demo|party|activation|bar)\b/i },
  wellbeing: { label: "Wellbeing week", audience: "team", cats: ["movement", "workshop", "culture"], words: /\b(yoga|pilates|wellness|wellbeing|breath|mindful|stretch|run)\b/i },
  community: { label: "Meetup or hackathon", audience: "attendees", cats: ["drinks", "workshop"], venue: true, words: /\b(meetup|hackathon|demo night|build|venue|room|space|projector|wifi|wi-fi|talks?|reception|workflow|agent|code)\b/i, avoid: /\b(run|jog|hike|pilates|yoga|bouquet|flower)\b/i },
};
export const AUDIENCE_WORD = { team: "your team", guests: "your guests", public: "the people who stop by", attendees: "your attendees" };

/** How well one experience fits a goal and headcount. Returns null when it shouldn't be offered at all. */
export function goalFit(goal, x, n = 0) {
  const G = TEAM_GOALS[goal] || TEAM_GOALS.bonding, text = `${x.name || ""} ${x.desc || ""} ${(x.includes || []).join(" ")} ${x.setup || ""} ${x.av || ""}`, why = [];
  if (x.service) return null;
  // a little over the listed size is a question for the host, not a no: "Seats 12, ask about 14"
  if (n && ((x.max && n > Math.floor(x.max * 1.2)) || (x.min && n < Math.ceil(x.min * 0.8)))) return null;
  const stretch = n && ((x.max && n > x.max) || (x.min && n < x.min));
  if ((x.goals || []).length && !x.goals.includes(goal) && !(goal === "exec" && x.goals.includes("clients")) && !(goal === "sampling" && x.goals.includes("activation"))) return null;
  let score = 0; const ci = G.cats.indexOf(x.category);
  if (ci >= 0) score += 6 - ci * 1.2; else score -= 3;
  const hit = (text.match(G.words) || [])[0]; if (hit) { score += 3; }
  if (G.avoid && G.avoid.test(text)) score -= goal === "exec" || goal === "community" ? 9 : 5;
  if (stretch) { score -= 2; why.push(n > x.max ? `Listed for up to ${x.max}: ask about ${n}` : `Usually ${x.min}+: ask about ${n}`); }
  if (G.seated) { const seats = +x.seated || 0; if (seats && n && seats < Math.floor(n / 1.2)) return null; if (seats) { score += 3; if (!stretch) why.push(`Seated for ${seats}`); } else if (x.category !== "dining") score -= 4;
    if (/private (room|dining)|chef'?s (table|counter)|omakase|counter/i.test(text)) { score += 2; why.push(/omakase/i.test(text) ? "Omakase counter" : "Private room"); } }
  if (G.venue) { const room = Math.max(+x.standing || 0, +x.seated || 0); if (room) { score += 3; why.push(`Room for ${room}`); } if (x.av) { score += 1.5; why.push("AV in the room"); } if (/hackathon|build|workflow|code|agent/i.test(text)) score += 2; }
  if (goal === "sampling") { if (x.travels) { score += 3; why.push("Comes to your spot"); } else if (!hit) score -= 3; if (G.content.test(text)) { score += 1; why.push("Content you can post"); } if (/permit/i.test(text)) { score += 1; why.push("Handles permits"); } }
  if (n && x.max) score += 1.5 * Math.min(1, n / x.max); // a room that fits, not one twice the size
  return { score, why };
}
