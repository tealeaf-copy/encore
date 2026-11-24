// Potto as a gifting strategist: a brand describes a moment (a product launch, a fundraise, a milestone), Potto looks
// it up, works out who the gift is for, suggests gifts that tie to the story (a Polaroid for a product called
// Snapshot), and writes a campaign playbook a marketer can run. Each gift is matched to makers and hosts on Pottery Lab.
import crypto from "node:crypto";
import { complete, isFake, aiMode, parseJsonLoose } from "./ai.js";
import { scopeStore, DEFAULT_WS } from "./workspaces.js";
import { keywordRank } from "./search.js";

const clean0 = (v) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
const clean = (v, n = 300) => { const t = clean0(v); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
const list = (a, n, f) => (Array.isArray(a) ? a : []).slice(0, n).map(f).filter(Boolean);
const url = (u) => (/^https:\/\/[^\s<>"]{4,400}$/.test(String(u || "")) ? String(u) : "");
const PER_HOUR = 6, running = new Set();

/** Keep only the shape we use; anything else the model writes is dropped. */
export function cleanPlan(p = {}) {
  const m = p.moment || {}, a = p.audience || {}, t = p.theme || {}, b = p.playbook || {}, msg = b.message || {}, bud = b.budget || {}, l = b.list || {};
  return {
    company: clean(p.company, 100), website: url(p.website),
    moment: { title: clean(m.title, 140), what: clean(m.what, 600), when: clean(m.when, 60), whyItMatters: clean(m.whyItMatters, 500), sources: list(m.sources, 4, (s) => (url(s?.url) ? { title: clean(s.title, 120), url: url(s.url) } : null)) },
    audience: { summary: clean(a.summary, 500), segments: list(a.segments, 5, (s) => (clean(s?.who, 120) ? { who: clean(s.who, 120), why: clean(s.why, 240), count: clean(s.count, 40) } : null)) },
    theme: { name: clean(t.name, 80), idea: clean(t.idea, 400), line: clean(t.line, 160) },
    gifts: list(p.gifts, 6, (g) => (clean(g?.name, 90) ? { name: clean(g.name, 90), tieIn: clean(g.tieIn, 300), whatsInside: list(g.whatsInside, 6, (x) => clean(x, 120)), personalize: clean(g.personalize, 240), perPerson: clean(g.perPerson, 40), bestFor: clean(g.bestFor, 120), leadTime: clean(g.leadTime, 40), wow: clean(g.wow, 240), makerKeywords: list(g.makerKeywords, 5, (x) => clean(x, 40)) } : null)),
    experience: list(p.experience, 3, (x) => (clean(x?.name, 90) ? { name: clean(x.name, 90), why: clean(x.why, 280) } : null)),
    playbook: {
      goal: clean(b.goal, 300),
      list: { who: clean(l.who, 300), howMany: clean(l.howMany, 60), howToPick: clean(l.howToPick, 400) },
      timeline: list(b.timeline, 10, (x) => (clean(x?.step, 300) ? { when: clean(x.when, 40), step: clean(x.step, 300), owner: clean(x.owner, 40) } : null)),
      message: { note: clean(msg.note, 700), email: clean(msg.email, 1200), subject: clean(msg.subject, 120), social: clean(msg.social, 500) },
      unboxing: clean(b.unboxing, 500), followUp: list(b.followUp, 5, (x) => clean(x, 300)), measure: list(b.measure, 6, (x) => clean(x, 200)),
      budget: { perPerson: clean(bud.perPerson, 60), total: clean(bud.total, 60), note: clean(bud.note, 300) }, risks: list(b.risks, 5, (x) => clean(x, 260)),
    },
  };
}

export function prompt({ company, moment, website, audience, people, budget }) {
  return `You are Potto, the gifting strategist at Pottery Lab, a marketplace of independent makers and experience hosts (bakers, ceramicists, florists, coffee roasters, illustrators, supper clubs, run clubs).
A marketer at ${company}${website ? ` (${website})` : ""} wants a gift campaign for this moment: "${moment}".
${audience ? `They say the audience is: ${audience}.` : ""}${people ? ` About ${people} people.` : ""}${budget ? ` Budget per person: ${budget}.` : ""}

1. Use web search to find out what the moment actually is (the product, what it does, when it launched, how it was announced) and who ${company} sells to. Cite 1-4 sources.
2. Work out who should get a gift: 2-4 segments (for example design partners, power users, investors, press, the people who'd champion it inside their company), and why each.
3. Find one creative theme that ties the gift to the story of this moment. The best gifts are a pun or a metaphor made physical: a launch called "Snapshot" invites a Polaroid camera and film; "Deep Research" invites a beautiful field notebook. Be specific to this product, not generic swag.
4. Suggest 3-5 gifts at different price points. Prefer things a small maker could make or personalise (ceramics, baked goods, coffee, prints, flowers, illustrated cards) over mass-produced merch. For each: the tie-in, what's inside, how to personalise it per recipient, a realistic cost per person in USD, lead time, the "wow" moment, and 2-4 maker keywords (like "ceramics", "bakery", "coffee", "illustration", "print", "flowers").
5. Optionally 1-2 small in-person experiences that would fit (a dinner, a workshop).
6. Write a playbook a marketer can run next week: goal, who's on the list and how to pick them, a timeline (from two weeks before to two weeks after), the handwritten note, an email (with subject) and a social post in the company's voice, the unboxing moment, follow-up steps, what to measure, a budget, and risks (customs, dietary needs, compliance gift limits for public companies and government, perishables).
Never invent numbers about the company; say "about" when estimating costs. Write plainly, no hype.

Reply with JSON only, in this shape:
{"company":"","website":"","moment":{"title":"","what":"","when":"","whyItMatters":"","sources":[{"title":"","url":""}]},
"audience":{"summary":"","segments":[{"who":"","why":"","count":""}]},
"theme":{"name":"","idea":"","line":""},
"gifts":[{"name":"","tieIn":"","whatsInside":[""],"personalize":"","perPerson":"","bestFor":"","leadTime":"","wow":"","makerKeywords":[""]}],
"experience":[{"name":"","why":""}],
"playbook":{"goal":"","list":{"who":"","howMany":"","howToPick":""},"timeline":[{"when":"","step":"","owner":""}],"message":{"note":"","subject":"","email":"","social":""},"unboxing":"","followUp":[""],"measure":[""],"budget":{"perPerson":"","total":"","note":""},"risks":[""]}}`;
}

// offline (tests and demos without a key): a worked example that follows the same shape
export function samplePlan({ company, moment }) {
  const snap = /snap|photo|camera|lens|picture/i.test(moment), co = company || "Your company";
  return cleanPlan({ company: co, moment: { title: moment, what: `${co} is marking “${moment}”. (This is a sample plan; with research on, Potto reads the launch itself.)`, when: "This month", whyItMatters: "A launch is the one moment your best users are paying attention at the same time.", sources: [] },
    audience: { summary: "The people who shaped the product and the people who'll spread it.", segments: [{ who: "Design partners and early users", why: "They gave feedback that made the launch", count: "about 50" }, { who: "Champions at target accounts", why: "They'll bring it into their team", count: "about 100" }, { who: "Investors and friends of the company", why: "They'll share it", count: "about 30" }] },
    theme: snap ? { name: "Develop the moment", idea: "Snapshot captures the web as it is right now. The gift captures a moment too: an instant camera and a print that develops in your hands.", line: "Some things are worth a snapshot." } : { name: "Made for this moment", idea: "A small, handmade gift that tells the story of what you just shipped.", line: "We made something. So did they." },
    gifts: snap ? [
      { name: "The instant camera kit", tieIn: "A Snapshot for the real world: point, shoot, watch it develop.", whatsInside: ["Instant camera", "Two packs of film", "Illustrated card with their name"], personalize: "A hand-drawn portrait of the recipient on the card, by an illustrator", perPerson: "about $110", bestFor: "Design partners", leadTime: "2 weeks", wow: "The first photo develops while they read the note.", makerKeywords: ["illustration", "portraits", "print"] },
      { name: "Developed: a ceramic photo tray", tieIn: "A tray shaped like a print frame, glazed in brand colours.", whatsInside: ["Hand-thrown ceramic tray", "One printed photo from launch day"], personalize: "Initials pressed into the clay", perPerson: "about $65", bestFor: "Champions at target accounts", leadTime: "3 weeks", wow: "No two are the same; it stays on the desk.", makerKeywords: ["ceramics", "pottery"] },
      { name: "Snapshot cookies", tieIn: "Cookies iced like Polaroids with the launch date.", whatsInside: ["Six iced cookies", "Card with a QR to try Snapshot"], personalize: "Their name iced on one cookie", perPerson: "about $28", bestFor: "Wider launch list", leadTime: "1 week", wow: "Shareable on day one.", makerKeywords: ["bakery", "cookies", "bake"] }] : [
      { name: "A handmade keepsake", tieIn: "Something made by hand for something you built by hand.", whatsInside: ["Ceramic piece", "Handwritten note"], personalize: "Initials in the glaze", perPerson: "about $60", bestFor: "Your closest users", leadTime: "3 weeks", wow: "It lasts longer than the launch.", makerKeywords: ["ceramics"] },
      { name: "Launch-day bake box", tieIn: "Celebrate the day with something sweet.", whatsInside: ["Six pastries", "Card with the news"], personalize: "Their name on the box", perPerson: "about $30", bestFor: "Wider list", leadTime: "1 week", wow: "Arrives the morning of the launch.", makerKeywords: ["bakery", "bake"] }],
    experience: [{ name: "A launch supper for 12", why: "Your design partners around one table, with a host who cooks." }],
    playbook: { goal: "Thank the people behind the launch and give them a reason to share it in the first week.", list: { who: "Design partners, top users, champions at target accounts, investors", howMany: "about 150", howToPick: "Start from people who gave feedback in the last 90 days; add the 50 accounts most likely to adopt; leave out anyone whose company bans gifts." },
      timeline: [{ when: "2 weeks before", step: "Lock the list and addresses; brief the makers", owner: "Marketing" }, { when: "1 week before", step: "Approve proofs of cards and personalisation", owner: "Marketing" }, { when: "Launch day", step: "Gifts arrive; launch email and post go out", owner: "Marketing" }, { when: "Week after", step: "Thank everyone who posted; book calls with champions", owner: "Sales" }, { when: "2 weeks after", step: "Report on posts, replies and pipeline", owner: "Marketing" }],
      message: { note: `You helped us build this. Here's something to capture the next moment worth keeping. — the ${co} team`, subject: `We made something (and a little something for you)`, email: `Hi {first name},\n\nToday we launched ${moment.replace(/^.*?launched\s+/i, "")}. You were part of it, so we sent you something. Keep an eye on your door.\n\n— {sender}`, social: `We just launched. To the people who helped us get here: check your mailbox. 📸` },
      unboxing: "The note is on top; the gift is wrapped so the first thing they do is use it.", followUp: ["Reply to every post within a day", "Ask three recipients for a short quote", "Invite champions to a 20-minute walkthrough"],
      measure: ["Posts mentioning the gift", "Replies and calls booked", "Activation among recipients vs. similar users"], budget: { perPerson: "about $60 average", total: "about $9,000 for 150", note: "Shipping, about $12 each, is extra." }, risks: ["Check gift limits for public-company and government recipients", "Perishables can't ship internationally", "Collect dietary needs before sending food"] } });
}

export function mountGiftPlan(app, { store, small, discoverHosts }) {
  const S = scopeStore(store, DEFAULT_WS), hits = new Map();
  const limited = (req) => { const k = req.ip || "?", now = Date.now(); const h = (hits.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); hits.set(k, h); return h.length > PER_HOUR; };
  // which hosts on Pottery Lab could make or deliver each gift
  const withMakers = (plan) => { let hosts = []; try { hosts = discoverHosts() || []; } catch {}
    return { ...plan, gifts: plan.gifts.map((g) => ({ ...g, makers: keywordRank(`${g.makerKeywords.join(" ")} ${g.name}`, hosts, 3).map((m) => { const h = hosts.find((x) => x.handle === m.handle) || {}; return { handle: h.handle, name: h.name, city: h.city || "", showcase: !!h.showcase, why: m.why }; }) })) }; };
  app.post("/api/public/giftplan", small, (req, res) => { const b = req.body || {}, company = clean(b.company, 100), moment = clean(b.moment, 200);
    if (company.length < 2 || moment.length < 4) return res.status(400).json({ code: "invalid", message: "Tell Potto the company and the moment (for example: Exa, launched Snapshot)." });
    if (limited(req)) return res.status(429).json({ code: "rate_limited", message: "Potto needs a breather. Try again in an hour." });
    const input = { company, moment, website: clean(b.website, 200), audience: clean(b.audience, 300), people: clean(b.people, 20), budget: clean(b.budget, 40) };
    const id = crypto.randomBytes(8).toString("hex"); S.set("giftplans/" + id, { status: "working", input, at: Date.now() }); running.add(id);
    (async () => { try { let plan, demo = false;
        if (isFake() || aiMode() === "missing_key") { await new Promise((r) => setTimeout(r, isFake() ? 600 : 0)); plan = samplePlan(input); demo = true; }
        else { const { text } = await complete({ prompt: prompt(input), effort: "medium", maxIterations: 10, tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }] }); plan = cleanPlan(parseJsonLoose(text)); if (!plan.company) plan.company = company; if (!plan.gifts.length) throw new Error("Potto couldn't put a plan together. Try describing the moment differently."); }
        S.set("giftplans/" + id, { status: "ready", input, plan: withMakers(plan), demo, at: Date.now() }); }
      catch (e) { S.set("giftplans/" + id, { status: "failed", input, error: clean(e?.message || "That didn't work. Try again.", 200), at: Date.now() }); } finally { running.delete(id); } })().catch(() => {});
    res.json({ id, status: "working" }); });
  app.get("/api/public/giftplan/:id", (req, res) => { const id = String(req.params.id).replace(/[^a-f0-9]/g, "").slice(0, 16), d = S.get("giftplans/" + id)?.data; if (!d) return res.status(404).json({ code: "not_found", message: "No plan by that link." }); res.json({ id, ...d }); });
}
