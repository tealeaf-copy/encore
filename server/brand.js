// Brand research: when a company signs up, Pottery Lab looks it up on the web and makes a smart first guess at who
// it sells to, who it competes with, which brands share its audience, how it positions itself and how it talks.
// The guess drives everything brand-facing: inspiration, host matches and Potto's suggestions. The team can correct it.
import { getWorkspace, updateWorkspace, DEFAULT_WS } from "./workspaces.js";
import { complete, isFake, aiMode, parseJsonLoose } from "./ai.js";
import { CATEGORIES } from "./market.js";
import fs from "node:fs";
import path from "node:path";

const clean0 = (v) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/\s+/g, " ").trim();
// Long text is cut at a word, with an ellipsis, never mid-word.
const clean = (v, n = 300) => { const t = clean0(v); if (t.length <= n) return t; const c = t.slice(0, n - 1), i = c.lastIndexOf(" "); return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[,;:.\s]+$/, "") + "…"; };
const list = (a, n, f) => (Array.isArray(a) ? a : []).slice(0, n).map(f).filter(Boolean);
const CAT_KEYS = CATEGORIES.map(([k]) => k);
const domainOf = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Keep only the fields we use, in the shapes we expect. Anything the model invents beyond that is dropped. */
export function cleanProfile(p = {}) {
  const v = p.voice || {}, a = p.audience || {};
  return {
    company: clean(p.company, 120), website: clean(p.website, 200), oneLiner: clean(p.oneLiner, 360), category: clean(p.category, 80), stage: clean(p.stage, 80),
    audience: { summary: clean(a.summary, 700), segments: list(a.segments, 5, (s) => clean(s, 220)), whereTheyAre: list(a.whereTheyAre, 6, (s) => clean(s, 160)), b2b: !!a.b2b,
      interests: list(a.interests, 8, (s) => clean(s, 100)), values: list(a.values, 5, (s) => clean(s, 280)), tiredOf: list(a.tiredOf, 4, (s) => clean(s, 280)), shareTriggers: list(a.shareTriggers, 4, (s) => clean(s, 280)), moments: list(a.moments, 4, (s) => clean(s, 280)),
      personas: list(a.personas, 3, (x) => (clean(x?.name, 60) ? { name: clean(x.name, 60), who: clean(x.who, 320), wants: clean(x.wants, 320), weekend: clean(x.weekend, 320), wouldShowUpFor: clean(x.wouldShowUpFor, 320) } : null)) },
    positioning: clean(p.positioning, 700),
    voice: { adjectives: list(v.adjectives, 5, (s) => clean(s, 30)), tone: clean(v.tone, 400), soundsLike: list(v.soundsLike, 3, (s) => clean(s, 240)), avoid: list(v.avoid, 4, (s) => clean(s, 160)) },
    competitors: list(p.competitors, 6, (c) => (clean(c?.name, 60) ? { name: clean(c.name, 60), note: clean(c.note, 280) } : null)),
    adjacent: list(p.adjacent, 6, (c) => (clean(c?.name, 60) ? { name: clean(c.name, 60), why: clean(c.why, 280) } : null)),
    insights: list(p.insights, 5, (x) => (clean(x?.fact, 500) ? { fact: clean(x.fact, 500), soWhat: clean(x.soWhat, 400), source: /^https?:\/\//.test(String(x.source || "")) ? clean(x.source, 400) : "" } : null)),
    othersDid: list(p.othersDid, 5, (x) => (clean(x?.brand, 60) && clean(x?.what, 400) ? { brand: clean(x.brand, 60), what: clean(x.what, 400), takeaway: clean(x.takeaway, 400), source: /^https?:\/\//.test(String(x.source || "")) ? clean(x.source, 400) : "" } : null)),
    ideas: list(p.ideas, 6, (x) => (clean(x?.name, 80) ? { name: clean(x.name, 80), line: clean(x.line, 320), why: clean(x.why, 320), insight: clean(x.insight, 320), category: CAT_KEYS.includes(x.category) ? x.category : "culture", people: Math.max(0, Math.min(2000, Math.round(+x.people || 0))), city: clean(x.city, 60) } : null)),
    cities: list(p.cities, 4, (s) => clean(s, 60)),
    homeCity: clean(p.homeCity, 80),
    sources: list(p.sources, 8, (s) => (/^https?:\/\//.test(String(s?.url || "")) ? { title: clean(s.title || s.url, 120), url: clean(s.url, 400) } : null)),
    confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "medium",
    unsure: list(p.unsure, 4, (s) => clean(s, 300)),
  };
}

export function prompt(company, website, hint) {
  return `You are a brand strategist helping an events team at "${company}"${website ? ` (website: ${website})` : ""} plan events their customers will love. ${hint ? `They describe themselves as: "${hint}". ` : ""}
Use web search (and fetch their site if you can) to research the company. Then make your best, specific guesses. Where you are guessing, say so in "unsure". Do not invent facts, numbers, customers or quotes. Prefer recent sources.

Find:
1. What they sell and to whom (a one-liner, their category, rough stage).
2. Their target audience: who buys, in plain words, 2-4 segments, and where those people spend time (places, communities, media, events). Say whether they sell to businesses (b2b).
   Go beyond job titles and demographics: what they're into (interests, hobbies, media, other brands they buy), what they value and worry about, what they're tired of (in marketing and in events), what makes them share something with friends or post it, and the moments when they're most open to a brand. Then sketch 2-3 personas as real-feeling people: a first name and age, who they are, what they want, what their weekend looks like, and what event they would actually show up for. Base this on what you find (reviews, community threads, interviews, the brand's own social), not stereotypes.
3. Their positioning: what they claim to be best at and for whom, in one or two sentences, close to their own words.
4. Their brand voice: 3-5 adjectives, the tone in a sentence, 2-3 short example lines that sound like them (paraphrase their style; do not quote marketing copy at length), and 2-4 things that would sound off-brand.
5. Direct competitors (up to 6) with a short note on how each differs.
6. Brands that sell to a similar audience but don't compete (up to 6), and why the audience overlaps. These are partner and inspiration candidates.
7. The cities where their customers or team are concentrated, if you can tell.
7b. Up to 5 insights this team might not know: specific, sourced findings about their audience or category (a behaviour, a shift, a number from a credible study, something customers keep saying in reviews). For each, the "so what" for an event, and the source URL. Only include what a source supports.
7c. Up to 5 events or activations that competitors or same-audience brands actually ran, with what they did, the takeaway, and a source URL. Only real, findable examples.
8. Six event ideas that fit this brand and audience, small and memorable, the kind an independent host could run (a food cart, a chef's table, a run or hike, a hands-on workshop, coffee or drinks, music or culture). Tie each to something you learned about the audience. For each: a name, one line describing it, why it fits this audience, the insight it builds on, a category from [${CAT_KEYS.join(", ")}], a typical headcount, and a city.

Write in plain English. No hype words (no "elevate", "unlock", "seamless", "curated experiences").
Reply with only JSON in this shape:
{"company":"","website":"","oneLiner":"","category":"","stage":"","audience":{"summary":"","segments":[""],"whereTheyAre":[""],"b2b":false,"interests":[""],"values":[""],"tiredOf":[""],"shareTriggers":[""],"moments":[""],"personas":[{"name":"","who":"","wants":"","weekend":"","wouldShowUpFor":""}]},"positioning":"","voice":{"adjectives":[""],"tone":"","soundsLike":[""],"avoid":[""]},"competitors":[{"name":"","note":""}],"adjacent":[{"name":"","why":""}],"cities":[""],"insights":[{"fact":"","soWhat":"","source":""}],"othersDid":[{"brand":"","what":"","takeaway":"","source":""}],"ideas":[{"name":"","line":"","why":"","insight":"","category":"","people":0,"city":""}],"sources":[{"title":"","url":""}],"confidence":"high|medium|low","unsure":[""]}`;
}

/** Offline mode: an honest, clearly labelled sample built only from the name, so the flow can be tried without the API. */
function sampleProfile(company, website) {
  const t = `${company} ${website}`.toLowerCase();
  const kind = /skin|beauty|glow|serum|cosmetic|labs/.test(t) ? "beauty" : /coffee|tea|food|snack|kitchen|bake/.test(t) ? "food" : /fit|run|sport|athlet|active/.test(t) ? "fitness" : /software|ai|data|cloud|\.io|saas|tech/.test(t) ? "b2b" : "consumer";
  const P = {
    beauty: { oneLiner: `${company} makes skincare for people who read ingredient lists.`, category: "Skincare (DTC)", seg: ["Skincare enthusiasts, 25-40", "Beauty creators and editors", "Customers who buy on subscription"], where: ["Instagram and TikTok", "Beauty newsletters", "Wellness studios", "Weekend markets"], pos: "Effective, gentle formulas without the luxury markup.", adj: ["warm", "clear", "a little nerdy"], tone: "Friendly and specific, explains the why behind ingredients.", like: ["Here's what this actually does for your skin.", "Fewer steps, better skin."], avoid: ["Miracle claims", "Luxury jargon"], comp: [["Glossier", "Bigger community brand, more makeup"], ["The Ordinary", "Cheaper, more clinical"], ["Drunk Elephant", "Premium price point"]], adj2: [["Aesop", "Same design-minded customer"], ["Outdoor Voices", "Overlapping wellness audience"], ["Sweetgreen", "Same urban, health-conscious buyer"]], ideas: [["Morning glow run and smoothie bar", "An easy 5k, then fresh juice and samples at the finish.", "Their audience already runs and posts their mornings.", "movement", 40], ["Build-your-own bouquet and skincare night", "A florist teaches bouquets while guests try the new launch.", "Hands-on, photogenic, and a natural fit for gifting.", "workshop", 30], ["Creator dinner at a chef's table", "Seven courses for 14 creators and editors, the launch at every place setting.", "Small enough to talk, beautiful enough to post.", "dining", 14], ["Matcha cart at a weekend market", "A pop-up cart pours matcha and hands out minis.", "Meets customers where they already spend Saturdays.", "drinks", 200], ["Bánh mì cart for the launch party", "Street food that people line up for and photograph.", "Turns a launch into a block party.", "food", 120], ["Listening night with a local DJ", "Vinyl, low light and the new collection on display.", "Culture-led, not a product demo.", "culture", 60]] },
    food: { oneLiner: `${company} makes food and drink people want to share.`, category: "Food and beverage", seg: ["Urban food lovers, 25-45", "Cafés and grocers who stock it", "Food creators"], where: ["Farmers markets", "Instagram", "Food newsletters"], pos: "Great taste, honest ingredients.", adj: ["generous", "playful", "warm"], tone: "Casual and appetising.", like: ["Come hungry.", "Made in small batches."], avoid: ["Corporate wellness speak"], comp: [], adj2: [], ideas: [["Supper club takeover", "A guest chef cooks with your product for 14 people.", "Food people trust chefs.", "dining", 14], ["Market-day pop-up", "Tastings at a weekend market.", "Meets buyers where they shop.", "food", 200], ["Run and brunch", "A short social run, then brunch.", "Built-in reason to post.", "movement", 30]] },
    fitness: { oneLiner: `${company} makes gear for people who move.`, category: "Fitness and outdoor", seg: ["Runners and gym-goers, 22-40", "Run clubs", "Fitness creators"], where: ["Run clubs", "Strava", "Instagram"], pos: "Performance without the pretension.", adj: ["energetic", "inclusive", "direct"], tone: "Upbeat and encouraging.", like: ["Every pace welcome.", "See you at the start line."], avoid: ["Elitist race talk"], comp: [], adj2: [], ideas: [["No-drop community 5k", "A social run for every pace, coffee after.", "Run clubs are where this audience lives.", "movement", 60], ["Trail day upstate", "Train, trail, picnic.", "A full day together builds loyalty.", "movement", 25]] },
    b2b: { oneLiner: `${company} sells software to teams.`, category: "B2B software", seg: ["Operators and team leads", "Executives who sign off on budget", "Practitioner communities"], where: ["LinkedIn", "Industry conferences", "Slack communities"], pos: "Saves teams time on work they hate.", adj: ["clear", "confident", "practical"], tone: "Plain and helpful.", like: ["Here's how teams like yours do it."], avoid: ["Buzzwords"], comp: [], adj2: [], ideas: [["Chef's table for 12 customers", "A small dinner where customers swap notes.", "Execs say yes to small, good dinners.", "dining", 12], ["Sunrise run before the conference", "An easy 5k and coffee on day two.", "A memorable break from booths.", "movement", 30]] },
    consumer: { oneLiner: `${company} sells to consumers.`, category: "Consumer brand", seg: ["Customers who already love the brand", "Creators in the category"], where: ["Instagram", "Local events"], pos: "", adj: ["warm", "friendly"], tone: "Friendly and plain.", like: [], avoid: [], comp: [], adj2: [], ideas: [["Community pop-up", "A weekend pop-up with a local host.", "Meets customers in person.", "food", 100], ["Hands-on workshop", "Make something together.", "People remember what they made.", "workshop", 25]] },
  }[kind];
  const deep = kind === "beauty" ? { interests: ["Ingredient deep-dives", "Pilates and run clubs", "Natural wine", "Design-led home goods", "Skincare TikTok"], values: ["Knowing what's in a product and why", "Value without feeling cheap", "Brands that admit what they don't do"], tiredOf: ["Influencer hauls that feel paid", "Launch parties with nothing to do but stand", "Ten-step routines"], shareTriggers: ["Something they made with their hands", "A first look before anyone else", "A beautiful, unexpected setting"], moments: ["Sunday reset routines", "Seasonal skin changes in spring and fall", "Gifting season"],
      personas: [{ name: "Priya, 31", who: "Product designer who reads every ingredient list", wants: "Fewer, better products she understands", weekend: "Saturday run club, farmers market, a long brunch", wouldShowUpFor: "A hands-on session where she learns something and leaves with something she made" }, { name: "Jess, 27", who: "Beauty creator with 18k followers", wants: "Content that feels like hers, not an ad", weekend: "Shooting content, pop-ups, dinner with other creators", wouldShowUpFor: "A small dinner with interesting people and a first look at the launch" }] }
    : { interests: [], values: [], tiredOf: [], shareTriggers: [], moments: [], personas: [] };
  const sampleInsight = { fact: "In this sample we can't cite real findings. With web search on, this section lists sourced facts about your audience and category.", soWhat: "Turn web search on to see what's true for your brand.", source: "" };
  return cleanProfile({ company, website, oneLiner: P.oneLiner, insights: [sampleInsight], othersDid: [], category: P.category, stage: "", audience: { summary: P.seg[0], segments: P.seg, whereTheyAre: P.where, b2b: kind === "b2b", ...deep }, positioning: P.pos, voice: { adjectives: P.adj, tone: P.tone, soundsLike: P.like, avoid: P.avoid }, competitors: P.comp.map(([name, note]) => ({ name, note })), adjacent: P.adj2.map(([name, why]) => ({ name, why })), cities: ["New York"], ideas: P.ideas.map(([name, line, why, category, people]) => ({ name, line, why, category, people, city: "New York", insight: "" })), sources: [], confidence: "low", unsure: [] });
}

const running = new Set();
/** Start research in the background. Status lives on the workspace: researching → ready | failed. */
export function startResearch(ws, { company, website = "", hint = "", by = "" } = {}) {
  const W = getWorkspace(ws); if (!W || ws === DEFAULT_WS) return null;
  company = clean(company || W.company, 120); website = clean(website, 200); hint = clean(hint, 200);
  if (!company || running.has(ws)) return W.brand || null;
  const prev = W.brand || {};
  const brand = { ...prev, status: "researching", company, website, hint, startedAt: Date.now(), error: "", by };
  updateWorkspace(ws, { brand }); running.add(ws);
  (async () => {
    try {
      let profile, demo = false;
      // Testing only: ENCORE_BRAND_FIXTURES points at saved research (<slug>.json), so reviews can run offline on real output.
      const fx = isFake() && process.env.ENCORE_BRAND_FIXTURES ? path.join(process.env.ENCORE_BRAND_FIXTURES, company.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json") : "";
      if (fx && fs.existsSync(fx)) { await new Promise((r) => setTimeout(r, 4000)); profile = cleanProfile(JSON.parse(fs.readFileSync(fx, "utf8"))); }
      else if (isFake() || aiMode() === "missing_key") { await new Promise((r) => setTimeout(r, isFake() ? 1500 : 0)); profile = sampleProfile(company, website); demo = true; }
      else {
        const { text } = await complete({ prompt: prompt(company, website, hint), effort: "medium", maxIterations: 10, tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 }] });
        profile = cleanProfile(parseJsonLoose(text));
        if (!profile.company) profile.company = company; if (!profile.website && website) profile.website = website;
      }
      updateWorkspace(ws, { brand: { ...(getWorkspace(ws)?.brand || {}), status: "ready", profile, demo, readyAt: Date.now(), edits: {} } });
    } catch (e) {
      console.warn(`[brand] research failed for ${ws}: ${e?.code || ""} ${e?.message || e}`);
      try { updateWorkspace(ws, { brand: { ...(getWorkspace(ws)?.brand || {}), status: "failed", error: clean(e?.message || "Research didn't finish.", 200) } }); } catch {}
    } finally { running.delete(ws); }
  })().catch(() => {});
  return brand;
}

/** The profile with the team's corrections on top. */
export function brandOf(ws) { const b = getWorkspace(ws)?.brand; if (!b) return null; const p = b.profile ? { ...b.profile, ...(b.edits || {}) } : null; return { status: b.status, company: b.company, website: b.website, demo: !!b.demo, startedAt: b.startedAt, readyAt: b.readyAt, error: b.error || "", profile: p, edited: Object.keys(b.edits || {}) }; }

export function mountBrand(app, { small, currentUser }) {
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  app.get("/api/brand", (req, res) => { const u = me(req, res); if (!u) return; const W = getWorkspace(u.ws); res.json({ brand: brandOf(u.ws), personal: W?.plan === "friends" }); });
  app.post("/api/brand/research", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, web = clean(b.website, 200);
    if (web && !domainOf(web)) return res.status(400).json({ code: "invalid", message: "That website doesn't look right. Try something like fernwoodlabs.com." });
    const r = startResearch(u.ws, { company: b.company, website: web, hint: b.hint, by: u.email }); res.json({ brand: brandOf(u.ws) || r }); });
  // Corrections from the team win over the research. Only known fields, cleaned the same way.
  app.put("/api/brand", small, (req, res) => { const u = me(req, res); if (!u) return; const W = getWorkspace(u.ws), B = W?.brand; if (!B?.profile) return res.status(409).json({ code: "conflict", message: "Research hasn't finished yet." });
    const merged = cleanProfile({ ...B.profile, ...(B.edits || {}), ...(req.body || {}) }), edits = { ...(B.edits || {}) };
    for (const k of Object.keys(req.body || {})) if (k in merged) edits[k] = merged[k];
    updateWorkspace(u.ws, { brand: { ...B, edits } }); res.json({ brand: brandOf(u.ws) }); });
}
