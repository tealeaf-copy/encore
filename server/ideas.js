// The ideas library for /ideas (Inspo): the get-together ideas from the app's "Steal an idea" shelf (index.html LIB,
// audience "friends", and the quick ideas CE_IDEAS), read from index.html so there's one list, plus ideas for the
// interests on the "What are you into?" picker that the shelf doesn't cover yet. Each idea gets an illustrated cover
// (an EventArt kind and tone), a look (one of public/looks.js VIBES) and the sentence Potto starts the event from.
// Ideas are suggestions, never events: no host, no date, no counts.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

// ideas for interests the shelf doesn't have yet: [title, line, say, art, tone, vibe, interests]
const MORE = [
  ["Supper club for 8", "Supper club for 8 · $45 a person", "A supper club for 8 at my place Saturday at 7, $45 a person, three courses", "dinner", "peach", "jazz", ["supper", "wine"]],
  ["Matcha tasting morning", "Three matchas, whisked side by side", "A matcha tasting morning for 10 Sunday at 10, three matchas whisked side by side", "tea", "mint", "garden", ["matcha", "coffee"]],
  ["Wheel-throwing night", "Clay, a wheel each, nobody needs to be good", "A pottery night for 6 Thursday at 7, wheel throwing for beginners", "pottery", "peach", "velvet", ["pottery", "crafts", "workshop"]],
  ["Salsa in the park", "A free beginner lesson, then just dancing", "Salsa in the park Sunday at 5, a free beginner lesson then dancing", "music", "blush", "night", ["dance", "picnic"]],
  ["Improv for beginners", "Games, not stand-up. Wear comfy shoes", "An improv jam for beginners Wednesday at 7, games not stand-up", "talk", "lilac", "night", ["improv", "workshop"]],
  ["Natural wine swap", "Everyone brings one bottle and one story about it", "A natural wine swap Friday at 7, everyone brings one bottle and a story", "wine", "blush", "velvet", ["wine", "supper"]],
  ["Makers' market on the stoop", "Six friends, six folding tables, one afternoon", "A makers' market on my stoop Saturday at noon, six friends selling what they make", "market", "butter", "market", ["market", "popup", "crafts"]],
  ["Bake sale pop-up", "Pre-orders first, walk-ups while it lasts", "A bake sale pop-up Saturday at 11, pre-orders first then walk-ups", "bake", "blush", "flower", ["popup", "baking"]],
  ["Phin coffee morning", "Slow-drip Vietnamese coffee and something sweet", "A phin coffee morning for 8 Sunday at 10, Vietnamese coffee and pastries", "coffee", "butter", "jazz", ["coffee"]],
  ["Sketch walk", "Pencils, a route with good views, coffee at the end", "A sketch walk Saturday at 10, pencils and a route with views, coffee at the end", "paint", "lilac", "garden", ["crafts", "hike"]],
  ["Bouquet-making workshop", "Market flowers, a bar of stems, take one home", "A bouquet-making workshop for 10 Saturday at 2, $35 a person, flowers included", "garden", "mint", "flower", ["crafts", "workshop"]],
  ["Living-room salon", "One speaker, twenty minutes, then everyone talks", "A living-room salon Thursday at 7, one short talk then a big conversation", "talk", "sand", "jazz", ["talks", "book"]],
  ["Sourdough class", "Mix, fold, shape, and take a starter home", "A sourdough class for 6 Saturday at 10, everyone takes a starter home", "bake", "butter", "garden", ["baking", "workshop"]],
  ["Sunset yoga on the roof", "Mats in a circle, golden hour, tea after", "Sunset yoga on the roof Wednesday at 6:30, tea after", "yoga", "lilac", "garden", ["movement"]],
  ["Mahjong night", "Learn in ten minutes, play until late", "A mahjong night for 8 Friday at 7, beginners welcome", "games", "lilac", "night", ["games"]],
  ["Dumpling-folding party", "Fold, steam, eat, repeat", "A dumpling-folding party for 10 Sunday at 5, everyone folds", "dumpling", "blush", "market", ["supper", "baking"]],
  ["Winter soup night", "Two big pots, bread, everyone brings a topping", "A soup night for 12 Saturday at 6, two big pots and bread", "cook", "butter", "winter", ["supper"]],
  ["Run and bagels", "An easy 5K, then bagels on the steps", "An easy 5K run club Saturday at 8, bagels after", "run", "sky", "winter", ["run"]],
];

/** The shelf's friends ideas, read from index.html (LIB entries for friends, and CE_IDEAS). Never throws. */
function fromApp() {
  let html = ""; try { html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"); } catch { return []; }
  const out = [];
  for (const m of html.matchAll(/\{name:"[^"\n]+",audience:"friends"[^\n]*?\}(?=\s*[,)\]])/g)) {
    try { const x = vm.runInNewContext("(" + m[0] + ")", {}, { timeout: 50 }); if (x?.name && x?.line) out.push({ title: x.name, line: x.line, format: x.format || "" }); } catch {}
  }
  const ce = html.match(/const CE_IDEAS=(\[[^\n]*?\]);/);
  if (ce) { try { for (const x of vm.runInNewContext(ce[1], {}, { timeout: 50 })) if (x?.t) out.push({ title: x.t, line: x.say, say: x.say, art: x.k }); } catch {} }
  return out;
}

// what an idea is about, from its words (the interests' words, as in public/interests.json)
function interestsOf(text, INTERESTS) { const t = " " + String(text || "").toLowerCase() + " ";
  return INTERESTS.filter((i) => (i.words || []).some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(t))).map((i) => i.id); }
const ART_FOR = [[/run|5k/, "run", "sky"], [/hike|trail/, "hike", "mint"], [/caf[eé]|coffee/, "coffee", "butter"], [/potluck/, "potluck", "peach"], [/picnic/, "picnic", "blush"], [/game/, "games", "lilac"], [/bake|giveaway/, "bake", "blush"], [/book/, "book", "sand"], [/pottery/, "pottery", "peach"], [/taco/, "taco", "butter"], [/dumpling/, "dumpling", "blush"], [/dinner|supper/, "dinner", "peach"]];
const VIBE_FOR = [[/pottery/, "velvet"], [/run|hike|picnic|park/, "garden"], [/game|night/, "night"], [/caf[eé]|coffee|book/, "jazz"], [/bake|giveaway/, "flower"], [/potluck|dinner|supper|taco|dumpling/, "market"]];

export function buildIdeas(INTERESTS) {
  const seen = new Set(), out = [];
  const add = (x) => { const id = "idea-" + slug(x.title); if (seen.has(id) || !x.title) return; seen.add(id); out.push({ id, ...x }); };
  for (const x of fromApp()) { const t = `${x.title} ${x.line} ${x.format}`.toLowerCase(), a = ART_FOR.find(([re]) => re.test(t));
    add({ title: x.title, line: x.line, say: x.say || `${x.title}: ${x.line}`, art: x.art && x.art !== "craft" ? x.art : a?.[1] || x.art || "party", tone: a?.[2] || "butter", vibe: (VIBE_FOR.find(([re]) => re.test(t)) || [0, "garden"])[1], interests: interestsOf(t, INTERESTS), from: "library" }); }
  for (const [title, line, say, art, tone, vibe, interests] of MORE) add({ title, line, say, art, tone, vibe, interests, from: "library" });
  return out;
}
