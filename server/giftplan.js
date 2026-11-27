// Potto as a gifting strategist: a brand describes a moment (a launch, a thank-you, a new-hire welcome, a speaker
// thank-you), says who it's for, how many and how much, and Potto writes a plan a marketer can run: a gift per group,
// matched to makers on Pottery Lab, with dates, a budget that respects the cap, compliance flags, a holdout decision and
// a tracking sheet with one row per person.
//
// Two paths share one skeleton. The input-driven planner (skeleton + finish) always runs: it reads the brief exactly
// (groups and counts, the per-person cap, the date, the deal size, the account list) and does all the arithmetic. When
// research is on, the AI writes the creative parts (what the moment is, the idea, the gift tie-ins and the copy) and the
// same finish step re-applies every rule, so the numbers never drift from what the marketer asked for. When research is
// off, rate-limited or fails, the input-driven plan is returned as a labelled draft. Nothing in a draft is "researched".
import crypto from "node:crypto";
import { complete, isFake, aiMode, parseJsonLoose } from "./ai.js";
import { scopeStore, DEFAULT_WS } from "./workspaces.js";
import { keywordRank } from "./search.js";
import { categoryOf, FEE_LINE } from "./market.js";

const clean0 = (v) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
const clean = (v, n = 300) => { const t = clean0(v); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
const cleanLines = (v, n) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\r/g, "").split("\n").map((l) => l.replace(/[\u0000-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const list = (a, n, f) => (Array.isArray(a) ? a : []).slice(0, n).map(f).filter(Boolean);
const url = (u) => (/^https:\/\/[^\s<>"]{4,400}$/.test(String(u || "")) ? String(u) : "");
const int = (v) => { const n = Math.round(+v); return Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 0; };
const num = (v) => { const m = String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?\s*k?/i); if (!m) return 0; return parseFloat(m[0]) * (/k$/i.test(m[0].trim()) ? 1000 : 1); };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const cap1 = (s) => String(s || "").replace(/^\s*([a-z])/, (_, c) => c.toUpperCase());
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const PLU = { story: "stories", "new hire welcomed": "new hires welcomed", "anniversary marked": "anniversaries marked", "person thanked": "people thanked" };
const plu = (u) => PLU[u] || u + "s";
const aOf = (u) => `${/^[aeiou]/i.test(u) ? "an" : "a"} ${u}`;
const andList = (L) => (L.length < 2 ? L.join("") : `${L.slice(0, -1).join(", ")} and ${L[L.length - 1]}`);
const PER_HOUR = 6, running = new Set();
const KEY_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(16).toString("hex");
const ownerKey = (id) => crypto.createHmac("sha256", KEY_SECRET).update("giftplan:" + id).digest("base64url").slice(0, 22);

/* ---------------------------------------------------------------- who it's for */

// Audience presets. Each has its own jobs, measures, guardrails and playbook language; only "b2b" talks about pipeline.
export const KINDS = {
  b2b: { label: "Product launch", hint: "Customers, early users, investors", saas: true, brief: "Sales brief", fallbackRole: "champion", anchor: "launch day" },
  press: { label: "Press and analysts", hint: "Before the news goes out", brief: "Brief for the PR team", fallbackRole: "press", anchor: "embargo day" },
  creators: { label: "Creators", hint: "People who post about you", brief: "Brief for the creator team", fallbackRole: "creator", anchor: "launch day" },
  retail: { label: "Stores and stockists", hint: "Thank them, get the reorder", brief: "Brief for the wholesale team", fallbackRole: "buyer", anchor: "delivery day" },
  customers: { label: "Customer thank-you", hint: "Your best customers", brief: "Brief for account managers", fallbackRole: "customer", anchor: "delivery day" },
  employees: { label: "Team and new hires", hint: "Welcomes, anniversaries, thanks", brief: "Team brief", fallbackRole: "employee", anchor: "delivery day" },
  community: { label: "Community thank-you", hint: "Speakers, co-organizers, contributors", brief: "Brief for the community team", fallbackRole: "speaker", anchor: "the event" },
};

// Recipient roles. `rx` reads the group label the marketer typed; the rest is what the plan says about that group.
const ROLES = {
  designPartner: { rx: /design partner|beta (user|customer|tester)|early access|pilot (customer|user)|alpha/i, who: "Design partners", job: "Become public references", kpi: "Quotes, case studies and reference calls agreed", owner: "Product marketing", followUp: "Within a week of delivery", tier: "Everyone who gave product feedback in the last 90 days", gifts: ["commission", "mug", "print", "card"], outcome: { unit: "reference", rate: 0.3 }, kind: "b2b" },
  investor: { rx: /investors?|\bvcs?\b|angels?\b|board members?|backers?/i, who: "Investors", job: "Amplify the news in the first week", kpi: "Posts and intros in the first week", owner: "Founder", followUp: "On the day", tier: "Investors and advisers who have offered to help", gifts: ["coffee", "card"], outcome: { unit: "intro", rate: 0.3 }, kind: "b2b" },
  analyst: { rx: /analysts?|gartner|forrester|\bidc\b/i, who: "Analysts", job: "Take a briefing and mention it in their notes", kpi: "Briefings held, mentions in published notes", owner: "Analyst relations lead", followUp: "Briefing before the embargo lifts", tier: "Analysts who cover your category", gifts: ["dish", "card"], outcome: { unit: "briefing", rate: 0.5 }, valueCap: 25, noPerishable: true, kind: "press" },
  press: { rx: /journalists?|reporters?|editors?|\bpress\b|media|writers?|podcast(er)?s?|newsletter (writer|author)s?/i, who: "Journalists", job: "Cover it on news day", kpi: "Stories published on news day, briefings held", owner: "PR lead", followUp: "Thank-you note the day the story runs", tier: "Reporters who cover your category and have written about you or a competitor", gifts: ["dish", "card"], outcome: { unit: "story", rate: 0.25 }, valueCap: 25, noPerishable: true, kind: "press" },
  creator: { rx: /creators?|influencers?|\bugc\b|tiktok|instagram|youtub|bloggers?|run.?club|micro|ambassadors?|community leads?|tastemakers?/i, who: "Creators", job: "Post about it in their own words", kpi: "Posts, saves and code redemptions", owner: "Creator / community manager", followUp: "Personal message within 3 days of delivery, with their code", tier: "Creators whose audience already buys from brands like yours", gifts: ["creatorKit", "print", "card"], outcome: { unit: "post", rate: 0.4 }, local: true, kind: "creators" },
  buyer: { rx: /buyers?|wholesale|retailers?|stockists?|\bstores?\b|\bshops?\b|caf[eé]s?|coffee ?shops?|restaurants?|boutiques?|distributors?|grocers?|\bdelis?\b|\bbars?\b|hotels?\b/i, who: "Buyers", job: "Take a buyer meeting and place an order", kpi: "Buyer meetings held, orders and reorders", owner: "Wholesale lead", followUp: "Call within 3 business days of delivery", tier: "Current stockists first, then the buyers you most want", gifts: ["cupset", "mug", "dish", "card"], outcome: { unit: "buyer meeting", rate: 0.3 }, account: true, kind: "retail" },
  newHire: { rx: /new.?hires?|new joiners?|onboard|starters?|incoming|interns?/i, who: "New hires", job: "Feel welcome before day one", kpi: "Arrived before the start date. One survey question after 30 days", owner: "People team", followUp: "Manager message on day one", tier: "Everyone starting in this cohort", gifts: ["welcomeBox", "mug", "card"], outcome: { unit: "new hire welcomed", rate: 1 }, kind: "employees" },
  anniversary: { rx: /anniversar|work.?iversar|years? (of service|at)|tenure/i, who: "Work anniversaries", job: "Feel seen for the years they've given", kpi: "Thank-you replies. Stay intent in the next team survey", owner: "People team + their manager", followUp: "Manager says it out loud in the next team meeting", tier: "Everyone hitting a 1, 3, 5 or 10-year mark this quarter", gifts: ["commission", "mug", "card"], outcome: { unit: "anniversary marked", rate: 1 }, kind: "employees" },
  employee: { rx: /employees?|staff|team ?mates?|colleagues|crew|engineers|the team|our team|everyone|people team/i, who: "Team", job: "Feel thanked for something specific", kpi: "Replies, and one survey question on feeling thanked", owner: "People team + their manager", followUp: "Manager names what they're thanking them for", tier: "Everyone on the team", gifts: ["mug", "bakebox", "card"], outcome: { unit: "person thanked", rate: 1 }, kind: "employees" },
  speaker: { rx: /speakers?|presenters?|panel(l)?ists?|\bmcs?\b|keynote/i, who: "Speakers", job: "Come back and bring a friend", kpi: "Speakers who agree to the next one, and posts about the event", owner: "Community lead", followUp: "Invite to the next one the week the gift arrives", tier: "Everyone who spoke", gifts: ["print", "mug", "card"], outcome: { unit: "returning speaker", rate: 0.5 }, kind: "community" },
  organizer: { rx: /co-?organi[sz]ers?|volunteers?|organi[sz]ers?|mentors?|moderators?|chapter leads?|meetup hosts?/i, who: "Co-organizers", job: "Stay on for the next one", kpi: "Co-organizers who sign up again", owner: "Community lead", followUp: "Personal thank-you within a week", tier: "Everyone who gave their time", gifts: ["mug", "print", "card"], outcome: { unit: "returning organizer", rate: 0.6 }, kind: "community" },
  contributor: { rx: /contributors?|maintainers?|committers?|open.?source|\boss\b/i, who: "Contributors", job: "Keep contributing and feel credited", kpi: "Contributors active in the next 90 days. Thank-you posts", owner: "Developer relations lead", followUp: "Public thank-you in the release notes", tier: "Everyone with a merged contribution this year", gifts: ["mug", "print", "card"], outcome: { unit: "returning contributor", rate: 0.5 }, kind: "community" },
  champion: { rx: /champions?|prospects?|target accounts?|buying (committee|group)|decision.?makers?|\bvps?\b|directors?|head of|heads of|revops|finance leads?|economic buyers?|\bcio\b|\bcto\b|\bcfo\b|\bcmo\b|executives?|leads at|leaders?/i, who: "Champions at target accounts", job: "Open or speed up a deal", kpi: "Meetings booked and deals created", owner: "Account owner", followUp: "2 business days after delivery", tier: "Top-tier accounts with an open deal or recent interest", gifts: ["mug", "coffee", "card"], outcome: { unit: "meeting", rate: 0.15 }, account: true, kind: "b2b" },
  customer: { rx: /customers?|clients?|users?|members|subscribers|patrons|regulars/i, who: "Customers", job: "Feel thanked. Stay and refer a friend", kpi: "Replies, referrals and renewals", owner: "Account manager", followUp: "Personal note within a week of delivery", tier: "Your longest-standing and most active customers", gifts: ["mug", "coffee", "card"], outcome: { unit: "referral", rate: 0.1 }, account: true, kind: "customers" },
  partner: { rx: /partners?|resellers?|agenc(y|ies)|affiliates?/i, who: "Partners", job: "Bring it to their clients", kpi: "Partner-sourced meetings and referrals", owner: "Partner lead", followUp: "Call within a week of delivery", tier: "Partners who sold or referred in the last year", gifts: ["mug", "coffee", "card"], outcome: { unit: "referral", rate: 0.15 }, account: true, kind: "b2b" },
};
const ROLE_ORDER = ["designPartner", "investor", "analyst", "press", "newHire", "anniversary", "speaker", "organizer", "contributor", "creator", "buyer", "champion", "partner", "customer", "employee"];
export const roleOf = (label) => ROLE_ORDER.find((r) => ROLES[r].rx.test(label)) || "";

// Gifts a small maker can make. Costs are per person in USD: the piece, the maker's personalisation or packing, shipping.
const CATALOG = {
  mug: { name: "A mug with their name pressed into the clay", inside: ["Hand-thrown mug", "Handwritten card"], personalize: "Their name pressed into the clay", gift: 34, maker: 8, ship: 14, min: 24, lead: "3 to 4 weeks", leadDays: 24, keys: ["ceramics", "pottery", "mug"], capacity: "About 40 a week from one studio", regions: "US and Canada. Fragile, so no international", backup: "Split the order across two studios", wow: "No two are the same, and it stays on the desk.", art: "mug" },
  commission: { name: "A commissioned ceramic piece with their initials", inside: ["Hand-built ceramic piece", "Maker's note on how it was made", "Handwritten card"], personalize: "Initials in the glaze", gift: 70, maker: 15, ship: 18, min: 45, lead: "4 to 5 weeks", leadDays: 32, keys: ["ceramics", "pottery"], capacity: "About 25 pieces in 4 weeks per studio", regions: "US and Canada. Fragile, so no international", backup: "A second studio in the same glaze, booked as standby", wow: "It's one of a kind, and the maker's note says so.", art: "dish" },
  dish: { name: "A small hand-glazed dish", inside: ["Hand-glazed trinket dish", "Letterpress card"], personalize: "A one-word glaze stamp", gift: 18, maker: 5, ship: 10, min: 12, lead: "3 weeks", leadDays: 21, keys: ["ceramics", "pottery"], capacity: "About 60 a week from one studio", regions: "Ships worldwide, well packed", backup: "A letterpress card alone", wow: "Small enough to keep on a desk, nothing to eat or throw away.", art: "dish" },
  card: { name: "A hand-lettered letterpress card", inside: ["Letterpress card, hand-lettered"], personalize: "Their name lettered by hand", gift: 9, maker: 4, ship: 3, min: 5, lead: "1 to 2 weeks", leadDays: 10, keys: ["illustration", "letterpress", "card", "print"], capacity: "About 150 a week from one studio", regions: "Ships worldwide", backup: "A second letterpress studio", wow: "Someone actually wrote it.", art: "card" },
  print: { name: "An illustrated print", inside: ["Signed illustrated print", "Card with a handwritten line"], personalize: "Their name worked into the illustration", gift: 26, maker: 6, ship: 8, min: 16, lead: "2 to 3 weeks", leadDays: 18, keys: ["illustration", "print", "art"], capacity: "About 80 prints a week from one illustrator", regions: "Ships worldwide, flat", backup: "A second illustrator in the same style", wow: "It goes on a wall, not in a drawer.", art: "card" },
  coffee: { name: "Small-batch coffee from a local roaster", inside: ["A bag of small-batch coffee", "Handwritten card"], personalize: "Their name on the label", gift: 18, maker: 4, ship: 9, min: 12, lead: "1 to 2 weeks", leadDays: 10, keys: ["coffee", "roast", "roaster"], capacity: "About 150 bags a week from one roaster", regions: "Domestic. Shelf-stable", backup: "A second roaster", wow: "Roasted the week it ships.", art: "bag" },
  bakebox: { name: "A bake box from a local bakery", inside: ["Six pastries", "Handwritten card"], personalize: "Their name on the box", gift: 28, maker: 5, ship: 14, min: 18, lead: "1 week", leadDays: 7, perishable: true, keys: ["bakery", "bake", "pastry"], capacity: "About 80 boxes a week from one bakery", regions: "Domestic only. Perishable", backup: "Shelf-stable shortbread from a second bakery", wow: "It arrives the same week it was baked.", art: "loaf" },
  welcomeBox: { name: "Welcome box", inside: ["Mug with their name", "Small-batch coffee", "Card signed by the team"], personalize: "Their name on the mug", gift: 40, maker: 8, ship: 15, min: 28, lead: "3 to 4 weeks", leadDays: 24, keys: ["ceramics", "mug", "pottery"], capacity: "About 40 boxes a week from one studio", regions: "Ships to each home address; US and Canada (a card and coffee for anyone abroad)", backup: "Card and coffee now, the mug a week later", wow: "It's waiting at home before day one.", art: "mug" },
  cupset: { name: "A pair of cups glazed for their shop", inside: ["Two hand-thrown cups", "Card signed by your team"], personalize: "The shop's name in the glaze", gift: 38, maker: 8, ship: 16, min: 24, lead: "3 to 4 weeks", leadDays: 24, keys: ["ceramics", "pottery", "cup"], capacity: "About 40 sets a week from one studio", regions: "Domestic. Fragile", backup: "One cup each from a second studio", wow: "It goes on their counter, where customers see it.", art: "mug" },
  creatorKit: { name: "A box made in their own city", inside: ["A piece by a maker in their city", "Your product", "Card with their personal code"], personalize: "Their handle on the card; a maker near them", gift: 30, maker: 6, ship: 10, min: 18, lead: "2 to 3 weeks", leadDays: 18, keys: ["ceramics", "illustration", "bakery"], capacity: "One maker per city, about 20 boxes each", regions: "Made and delivered locally where Pottery Lab has makers", backup: "A shipped box from one studio for cities without a maker", wow: "It's from a maker their followers can visit.", art: "card" },
  camera: { name: "The instant camera kit", inside: ["Instant camera", "Two packs of film", "Illustrated card with their name"], personalize: "A hand-drawn portrait of them on the card", gift: 62, maker: 12, ship: 12, min: 45, lead: "2 weeks", leadDays: 14, keys: ["illustration", "portraits", "print"], capacity: "About 30 portraits a week from one illustrator", regions: "Ships worldwide (no food)", backup: "A second illustrator in the same style", wow: "The first photo develops while they read the note.", art: "photo" },
};

/* ---------------------------------------------------------------- reading the brief */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY = 864e5;
const today = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
export function parseDate(v, moment = "") {
  const s = String(v || "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) { const t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return Number.isFinite(t) ? t : 0; }
  m = `${s} ${moment}`.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/i);
  if (m) { const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); let t = Date.UTC(m[3] ? +m[3] : new Date().getUTCFullYear(), mi, +m[2]); if (!m[3] && t < today() - 7 * DAY) t = Date.UTC(new Date().getUTCFullYear() + 1, mi, +m[2]); return t; }
  return 0;
}
const fmt = (t) => new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const iso = (t) => new Date(t).toISOString().slice(0, 10);
// US federal holidays (and the weekday they're observed on), plus Christmas Eve and New Year's Eve, so no plan date lands on a day off or a weekend
const HOL = new Map();
const holidays = (y) => { if (HOL.has(y)) return HOL.get(y); const nth = (m, wd, n) => { const d0 = new Date(Date.UTC(y, m, 1)).getUTCDay(); return Date.UTC(y, m, 1 + ((wd - d0 + 7) % 7) + 7 * (n - 1)); };
  const last = (m, wd) => { const t = Date.UTC(y, m + 1, 0); return t - ((new Date(t).getUTCDay() - wd + 7) % 7) * DAY; }, fixed = (m, d) => { const t = Date.UTC(y, m, d), w = new Date(t).getUTCDay(); return [t, w === 6 ? t - DAY : w === 0 ? t + DAY : t]; };
  const S = new Set([...fixed(0, 1), nth(0, 1, 3), nth(1, 1, 3), last(4, 1), ...fixed(5, 19), ...fixed(6, 4), nth(8, 1, 1), nth(9, 1, 2), ...fixed(10, 11), nth(10, 4, 4), ...fixed(11, 25), Date.UTC(y, 11, 24), Date.UTC(y, 11, 31)]); HOL.set(y, S); return S; };
const workday = (t) => { const w = new Date(t).getUTCDay(); return w > 0 && w < 6 && !holidays(new Date(t).getUTCFullYear()).has(t); };
/** The nearest working day: earlier (dir -1) for "by" dates, later (dir 1) for "after" dates. */
const bizOn = (t, dir = 1) => { let d = t; for (let i = 0; i < 14 && !workday(d); i++) d += dir * DAY; return d; };
const addBiz = (t, n) => { let d = t, k = 0; while (k < Math.abs(n)) { d += Math.sign(n) * DAY; if (workday(d)) k++; } return d; };

// "We just launched Snapshot" → "Snapshot"; "launching our data governance module" → "our data governance module"
export function subjectOf(moment) {
  const m = clean(moment, 200).replace(/[.!?]+$/, "");
  const r = m.match(/\b(?:launch(?:ed|ing|es)?(?:\s+of)?|releas(?:ed|ing)|ship(?:ped|ping)|announc(?:ed|ing)|introduc(?:ed|ing)|unveil(?:ed|ing)|debut(?:ed|ing)|open(?:ed|ing)|rolling out|rolled out)\s+(.+)$/i);
  if (!r) return "";
  let s = r[1].split(/,|;|:|\s[—–-]\s|\s\(|\s+(?:to|for|on|at|with|in|this|next|today|tomorrow)\s+(?=our|the|all|\d|[a-z]+day|week|month|year|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)[0].trim();
  s = s.replace(/^(?:a|an)\s+new\s+/i, "our new ").replace(/^(?:a|an)\s+/i, "our ").replace(/^my\s+/i, "our ");
  if (/^(?:our|the|their|its)\s/i.test(s)) s = s.replace(/^\w+/, (w) => w.toLowerCase());
  else if (/^[a-z]/.test(s)) s = "our " + s;
  return s.slice(0, 80);
}
const momentType = (m) => (/welcom|new.?hire|onboard|joiner|first day|starters?/i.test(m) ? "welcome" : /anniversar/i.test(m) ? "anniversary" : /thank|appreciat|holiday|year.?end|gratitude|celebrat/i.test(m) ? "thanks" : /launch|releas|ship|announc|introduc|unveil|debut|open|rolling out|rolled out/i.test(m) ? "launch" : /series [a-z]\b|raised?|funding|round|milestone|\d+(st|nd|rd|th)\b|ipo/i.test(m) ? "milestone" : /conference|summit|meetup|event|talk|hackathon|festival|workshop/i.test(m) ? "event" : "thanks");
const eventOf = (m) => (String(m).match(/\b(?:at|from|for|of)\s+((?:[A-Z0-9][\w&'.-]*\s?){1,5})/) || [])[1]?.trim().replace(/\s+(?:this|last|next)$/i, "") || "";

// "40 champions, 12 journalists + 4 analysts under embargo, 15 design partners" → four groups with counts
export function parseGroups(text, kind = "") {
  const t = clean(text, 600); if (!t) return [];
  const first = t.split(/\s*(?:,|;|\+|&|\n|\/)\s*/).filter(Boolean);
  const parts = first.flatMap((p) => { const bits = p.split(/\s+(?:and|plus|as well as)\s+/i); if (bits.length < 2) return [p];
    const roles = bits.map(roleOf), nums = bits.map((b) => /\d/.test(b)); return (roles.every(Boolean) && new Set(roles).size === roles.length) || nums.every(Boolean) ? bits : [p]; });
  const out = [];
  for (const p of parts) {
    const n = p.match(/(?:^|\s|~)(\d[\d,]*)(?![\d,])(?!\s*(?:accounts?|companies|orgs?|organi[sz]ations|logos|cities|countries|%|years?|yrs?)\b)/i);
    const count = n ? int(n[1].replace(/,/g, "")) : 0;
    let label = p.replace(/(?:^|\s)~?\d[\d,]*(?:\s*(?:accounts?|companies|orgs?|logos))?/gi, " ").replace(/^\s*(?:about|around|roughly|some|approx\.?|our|the|top|all|and|plus)\s+/gi, "").replace(/^\s*(?:about|around|roughly|some|our|the|top|all)\s+/gi, "").replace(/\s+/g, " ").trim().replace(/^(of|at)\s+/i, "").replace(/\s+(at|in|from|across|of|for|under)$/i, "");
    if (!label && !count) continue;
    const role = roleOf(label) || KINDS[kind]?.fallbackRole || "";
    label = cap1(label || ROLES[role]?.who || "People");
    out.push({ label: label.slice(0, 80), count, role: role || "customer" });
  }
  return out.slice(0, 6);
}

export function inferKind(input, groups) {
  if (KINDS[input.kind]) return input.kind;
  const t = `${input.moment} ${input.audience}`;
  const kinds = groups.map((g) => ROLES[g.role]?.kind);
  if (kinds.includes("employees") || /new.?hire|onboard|welcom\w* .*(team|hires|joiners)|work anniversar|employee/i.test(t)) return "employees";
  if (kinds.length && kinds.every((k) => k === "community") || /speakers?|meetup|conference|contributors?|maintainers?|co-?organi/i.test(t) && !kinds.includes("b2b")) return "community";
  if (kinds.length && kinds.every((k) => k === "press")) return "press";
  if (kinds.includes("creators")) return "creators";
  if (kinds.includes("retail") && !kinds.includes("b2b")) return "retail";
  if (kinds.length && kinds.every((k) => k === "customers") || (/thank/i.test(t) && /customers?|clients?/i.test(t))) return "customers";
  if (/wholesale|stockist|retail/i.test(t)) return "retail";
  if (/creator|influencer/i.test(t)) return "creators";
  return "b2b";
}

// A pasted list: one company per line, or a CSV/TSV export with headers (account, contact, email, role, tier, stage, owner)
const COLS = { account: /^(account( name)?|company( name)?|organi[sz]ation|org|shop|store|caf[eé]|business)$/i, contact: /^(contact( name)?|name|full name|person|recipient)$/i, first: /^first( name)?$/i, last: /^last( name)?$/i, email: /^e-?mail( address)?$/i, role: /^(role|title|job title|segment|persona|group|type)$/i, tier: /^(tier|account tier|priority)$/i, stage: /^(stage|opp(ortunity)? stage|deal stage|lifecycle stage)$/i, owner: /^(owner|account owner|ae|rep|sales rep|contact owner)$/i, city: /^(city|location)$/i };
function splitRow(line, sep) { if (sep === "\t") return line.split("\t").map((x) => x.trim()); const out = []; let cur = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur.trim()); cur = ""; } else cur += c; } out.push(cur.trim()); return out; }
export function parseRoster(raw) {
  const text = Array.isArray(raw) ? raw.map((x) => String(x ?? "")).join("\n") : String(raw || "");
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 400);
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",", head = splitRow(lines[0], sep).map((h) => h.toLowerCase().replace(/[_*]/g, " ").trim());
  const idx = {}; head.forEach((h, i) => { for (const [k, rx] of Object.entries(COLS)) if (idx[k] == null && rx.test(h)) idx[k] = i; });
  let rows;
  if (head.length === 1 && COLS.account.test(head[0])) lines.shift();
  if (head.length > 1 && (idx.account != null || (idx.contact != null && idx.email != null))) {
    rows = lines.slice(1).map((l) => { const c = splitRow(l, sep), g = (k) => (idx[k] != null ? clean(c[idx[k]], 120) : ""); const contact = g("contact") || [g("first"), g("last")].filter(Boolean).join(" ");
      return { account: g("account") || (g("email").split("@")[1] || ""), contact, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g("email")) ? g("email") : "", role: g("role"), tier: g("tier"), stage: g("stage"), owner: g("owner"), city: g("city") }; });
  } else {
    const flat = lines.length === 1 && lines[0].includes(",") ? lines[0].split(",") : lines;
    rows = flat.map((l) => ({ account: clean(l, 80) }));
  }
  const seen = new Set();
  return rows.filter((r) => r.account || r.contact).filter((r) => { const k = `${r.account}|${r.contact}|${r.email}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 300);
}

// Public-sector, healthcare and regulated-finance recipients get a note, never a gift.
const COMPLIANCE = [
  { rx: /\.gov(\.[a-z]{2})?\b|\.mil\b|\bstate of\b|\bdept\b\.?|\bdepartment of\b|\bcity of\b|\bcounty\b|\bministry\b|\bgovernment\b|\bfederal\b|\bmunicipal|\bschool district\b|\bpublic schools?\b|\bcity council\b|\bborough of\b|\bcommonwealth of\b/i, kind: "Public sector", reason: "Public sector: government gift rules ban or cap gifts." },
  { rx: /\bhealth\b|healthcare|hospital|clinic|medical|pharma|\bnhs\b|biotech|health system/i, kind: "Healthcare", reason: "Healthcare: hospital and anti-kickback gift policies." },
  { rx: /\bbank\b|bancorp|credit union|securities|brokerage|\binsurance\b|asset management|wealth management|financial services|capital markets|\bfinra\b/i, kind: "Financial services", reason: "Regulated finance: FINRA and bank gift limits." },
];
export const complianceOf = (r) => { const t = `${r.account || ""} ${r.email || ""} ${r.role || ""}`; return COMPLIANCE.find((c) => c.rx.test(t)) || null; };

/* ---------------------------------------------------------------- the input-driven planner */

const SHORT = { mug: "mug", commission: "ceramic piece", dish: "dish", card: "card", print: "print", coffee: "coffee", bakebox: "bake box", welcomeBox: "welcome box", cupset: "cups", creatorKit: "box", camera: "camera kit" };
const shortOf = (name, id) => SHORT[id] && CATALOG[id]?.name === name ? SHORT[id] : String(name || "gift").replace(/^(a|an|the)\s+/i, "").replace(/\s+(with|from|for|by|made|glazed)\s.*$|:.*$/i, "").toLowerCase();
const pickGift = (role, cap, avoid, theme) => {
  const R = ROLES[role] || ROLES.customer;
  let order = [...R.gifts];
  if (theme === "snap" && ["champion", "designPartner", "customer"].includes(role)) order = ["camera", ...order];
  order = order.filter((g) => !avoid.includes(g));
  if (R.noPerishable) order = order.filter((g) => !CATALOG[g].perishable);
  for (const id of order) {
    const g = CATALOG[id]; let gift = g.gift;
    if (R.valueCap) gift = Math.min(gift, R.valueCap - g.maker);
    if (cap) gift = Math.min(gift, cap - g.maker - g.ship);
    if (gift >= g.min) return { id, gift: Math.round(gift), maker: g.maker, ship: g.ship, fits: true };
  }
  const id = order[order.length - 1] || "card", g = CATALOG[id];
  return { id, gift: g.min, maker: g.maker, ship: g.ship, fits: false };
};

function readInput(input) {
  const company = clean(input.company, 100) || "Your company", moment = clean(input.moment, 200);
  const groups0 = parseGroups(input.audience, KINDS[input.kind] ? input.kind : "");
  const kind = inferKind({ ...input, moment }, groups0), K = KINDS[kind];
  const headcount = int(num(input.people)), cap = Math.round(num(input.budget)) || 0, deal = Math.round(num(input.dealSize)) || 0;
  const roster = (input.contacts?.length ? input.contacts : parseRoster(input.accounts || [])).map((r) => ({ ...r }));
  const protect = new Set((Array.isArray(input.protect) ? input.protect : String(input.protect || "").split(/\r?\n|,/)).map((x) => clean(x, 80).toLowerCase()).filter(Boolean));
  const date = parseDate(input.date, moment), type = momentType(moment), subj = subjectOf(moment), ab = /^\d{4}-\d{2}-\d{2}$/.test(String(input.arriveBy || "")) ? parseDate(input.arriveBy) : 0;
  const move = new Set((Array.isArray(input.move) ? input.move : []).filter((k) => CATALOG[k]));
  return { company, moment, kind, K, groups0, headcount, cap, deal, roster, protect, move, date, arriveBy: date && ab > date ? ab : 0, type, subj, city: clean(input.city, 60) };
}

// Who gets what, sized from the brief; every number traces back to something the marketer typed (or says it doesn't).
export function skeleton(input) {
  const I = readInput(input), { kind, headcount, roster } = I, notes = [];
  let groups = I.groups0.map((g) => ({ ...g }));
  const accts = new Set(roster.map((r) => r.account).filter(Boolean));
  if (!groups.length) {
    const role = kind === "employees" ? (I.type === "welcome" ? "newHire" : I.type === "anniversary" ? "anniversary" : "employee") : kind === "community" ? (/contribut|open.?source|maintain/i.test(I.moment) ? "contributor" : "speaker") : KINDS[kind].fallbackRole;
    groups = [{ label: ROLES[role].who, count: 0, role }];
    if (kind === "b2b") notes.push("Only champions are planned. Add design partners, investors or press under “Who it's for” if you want them in.");
  }
  const sum = () => groups.reduce((a, g) => a + g.count, 0), missing = groups.filter((g) => !g.count);
  const listSized = groups.find((g) => !g.count && ROLES[g.role]?.account);
  if (listSized && roster.length) { listSized.count = roster.length; listSized.fromList = true; }
  if (headcount) {
    const left = headcount - sum(), open = groups.filter((g) => !g.count);
    if (open.length) {
      const each = Math.max(1, Math.floor(Math.max(0, left) / open.length)); open.forEach((g, i) => (g.count = i === open.length - 1 ? Math.max(1, left - each * (open.length - 1)) : each));
      if (left > 0) notes.push(open.length === 1 && groups.length === 1 ? `Planned for the ${headcount} people you said.` : `You gave counts for some groups. The rest of your ${headcount} (${left}) went to ${open.map((g) => g.label.toLowerCase()).join(" and ")}${open.length > 1 ? ", split evenly" : ""}.`);
      else notes.push(`Your group counts already add up to ${sum() - open.reduce((a, g) => a + g.count, 0)} of the ${headcount}, so ${open.map((g) => g.label.toLowerCase()).join(" and ")} got the minimum of 1 each. Add counts to fix this.`);
    } else if (sum() !== headcount) notes.push(sum() > headcount ? `Your groups add up to ${sum()}, more than the ${headcount} you said. Potto planned for the ${sum()} you named, group by group. Lower a group's count if ${headcount} is the real limit.` : `Your groups add up to ${sum()}, but you said ${headcount} people. Potto planned for the ${sum()} you named and left ${headcount - sum()} unassigned. Add them to a group if they're real.`);
  } else if (missing.length) {
    groups.filter((g) => !g.count).forEach((g) => (g.count = 25));
    notes.push(`You didn't say how many${missing.length > 1 ? " for some groups" : ""}, so Potto planned 25 for ${missing.map((g) => g.label.toLowerCase()).join(" and ")}. Change “How many” and the budget follows.`);
  }
  if (roster.length && listSized && !listSized.fromList && listSized.count !== roster.length) notes.push(`You pasted ${plural(roster.length, "row", "rows")} (${plural(accts.size, "account", "accounts")}) for ${listSized.count} ${listSized.label.toLowerCase()}. The tracking sheet has one row per pasted row. Add contacts to get one row for each person.`);
  if (listSized?.fromList) notes.push(`${listSized.label} sized from your list: ${plural(roster.length, "row", "rows")}.`);

  const theme = /snap|photo|camera|lens|picture/i.test(I.moment) ? "snap" : "";
  const avoid = [/coffee|roast|caf[eé]/i.test(`${I.company} ${I.moment}`) ? "coffee" : "", /bak(e|ery)|pastr/i.test(`${I.company} ${I.moment}`) ? "bakebox" : ""].filter(Boolean);
  const segments = groups.map((g) => { if (g.role === "employee" && ["welcome", "anniversary"].includes(I.type)) g.role = I.type === "welcome" ? "newHire" : "anniversary"; let R = ROLES[g.role] || ROLES.customer; const p = pickGift(g.role, I.cap, avoid, theme);
    if (g.role === "buyer" && I.type !== "launch") R = { ...R, job: "Reorder and keep recommending you", kpi: "Reorders and replies in the 60 days after", tier: "Every shop that ordered from you this year", outcome: { unit: "reorder", rate: 0.5 } };
    return { role: g.role, who: g.label, count: g.count, pick: p, R, why: "" }; });
  return { I, segments, notes, theme };
}

// Words that only make sense for software companies; non-SaaS plans never show them.
const SAAS = /\b(pipeline|account executives?|AEs?|opportunit(y|ies)|API keys?|trials?|seats?|SaaS|design partners?|docs|demo)\b/i;
const scrub = (s, saas) => { let t = String(s || "").replace(/[📸🎁🚀✨🎉]/gu, "").replace(/[ \t]{2,}/g, " ").replace(/on one task you did by hand( this week)?/gi, "first").trim(); if (!saas) t = t.replace(/\bpipeline\b/gi, "results").replace(/\bAE\b/g, "owner"); return cap1(t); };

function themeFor(I, theme, follow = false) {
  const S = I.subj, Sc = cap1(S), co = I.company;
  if (theme === "snap") return { name: "Snap it", idea: `${Sc || "The launch"} is about capturing what's true right now. The gift does the same for a moment in their week: an instant camera and a print that develops in their hands.`, line: "Some things are worth a snapshot.", doesForThem: "A reminder that they can see what's true right now, not last month.", searchFor: `On the card: the one thing ${S || "the product"} shows them first (pick it with product marketing).` };
  const by = {
    b2b: { name: "Made for this launch", idea: `Each group gets one piece made by an independent maker, with a note that says why ${S || "the launch"} matters to them. One thing people keep beats a box of merch.`, line: "We made something. So did they.", doesForThem: "A piece that stays on the desk and brings the launch back to mind when the follow-up arrives.", searchFor: `On the card: the one thing ${S || "it"} does that they'll want to see first.` },
    press: { name: "Nothing to declare", idea: `A small, non-perishable piece under $25 in value with the embargo details, so ${S || "the news"} reaches reporters without asking anything of them.`, line: "No strings. Just the story.", doesForThem: "The embargo time, a press contact and a piece that fits any outlet's gift policy.", searchFor: "On the card: the embargo time and a press contact." },
    creators: { name: "Made where they are", idea: `Each creator gets a box from a maker in their own city, with ${S || "the product"} inside. Something local is worth filming; a PR box isn't.`, line: "Made near you, for you.", doesForThem: "A local maker to tag and a product to try, with no obligation to post.", searchFor: "On the card: their personal code and one sentence on what makes it different. No posting required." },
    retail: { name: "For the counter", idea: I.type === "launch" ? `Buyers get a handmade piece for their shop with the line sheet for ${S || "the launch"}, so the meeting starts with something on the counter.` : `A handmade piece for each shop's counter, glazed with the shop's name. It says thank you where their customers can see it.`, line: I.type === "launch" ? "Something for the shelf before it ships." : "Thank you for pouring it, stocking it and telling people about it.", doesForThem: "Something useful in the shop with their name on it, from a maker, not a catalog.", searchFor: "On the card: their rep's name and the easiest way to reorder." },
    customers: { name: "Thank you, by hand", idea: `A piece made for each customer by an independent maker, with a note from the person who looks after them at ${co}.`, line: "Made for you. Thank you.", doesForThem: "A real thank-you from a real person, not a discount code.", searchFor: "On the card: who to call when they need something." },
    employees: { name: I.type === "welcome" ? "Welcome home" : I.type === "anniversary" ? "Years, pressed into clay" : "Thank you, specifically", idea: I.type === "welcome" ? `${follow ? "A welcome box at home in their first weeks" : "A welcome box waiting at home before day one"}: a mug with their name, coffee from a local roaster and a card signed by the team at ${co}.` : `A piece made for each person by an independent maker, with a note from their manager that names what they're being thanked for.`, line: I.type === "welcome" ? "Glad you're here." : "We noticed.", doesForThem: I.type === "welcome" ? (follow ? "They feel part of the team in their first weeks." : "They feel part of the team from day one.") : "They hear what they did, from the person who saw it.", searchFor: I.type === "welcome" ? "On the card: who to ask for what in week one." : "On the card: one specific thing they did." },
    community: { name: "Thank you for showing up", idea: `A thank-you made by an independent maker for the people who gave their time to ${eventOf(I.moment) || "the community"}, with an invitation to the next one.`, line: "The room was better because you were in it.", doesForThem: "Real credit for unpaid work, and an open door back.", searchFor: "On the card: the date of the next one, and an open invitation." },
  };
  return by[I.kind];
}

// The note on the card, the follow-up script and the trigger list, all specific to the group and to the gift it got.
function voice(I, s, giftName, follow = false) {
  const S = I.subj || "", Sc = cap1(S), co = I.company, ev = eventOf(I.moment) || "the event", dt = I.date ? fmt(I.date) : "";
  const g = giftName, launch = I.type === "launch" && S;
  const N = {
    champion: launch ? `We built ${S} for teams like yours, and wanted you to have something made by hand to go with it.\n{sender}, ${co}` : `Thank you for your time this year. We had this made for you.\n{sender}, ${co}`,
    designPartner: launch ? `You helped us shape ${S}. This piece was made for you. Thank you.\nThe ${co} team` : `You helped us get here. This piece was made for you. Thank you.\nThe ${co} team`,
    investor: launch ? `${Sc} is out${dt ? ` on ${dt}` : ""}. Thank you for backing us early; a share or an intro this week would mean a lot.\n${co}` : `Thank you for backing us early.\nThe ${co} team`,
    press: launch && follow ? `Thanks for covering ${Sc}. If your outlet doesn't accept gifts, tell us and we'll donate it.\n${co}` : launch ? `${Sc} is coming${dt ? ` on ${dt}` : ""}. Please hold the news until then. If your outlet doesn't accept gifts, tell us and we'll donate it.\n${co}` : `Thank you for covering ${co}. If your outlet doesn't accept gifts, tell us and we'll donate it.\n${co}`,
    analyst: follow ? `Thank you for the briefing time on ${S || "our news"}. If your firm doesn't accept gifts, tell us and we'll donate it.\n${co}` : `${Sc || "Our news"} is coming${dt ? ` on ${dt}` : ""}. Thank you for the briefing time; please hold the news until then. If your firm doesn't accept gifts, tell us and we'll donate it.\n${co}`,
    creator: launch ? `We made ${S} and thought of you. This box was made near you by a local maker. Your code is on the back if you want it; no posting required.\n${co}` : `Thank you for everything you make. This was made near you by a local maker.\n${co}`,
    buyer: launch ? `${Sc} lands${dt ? ` on ${dt}` : " soon"}. We'd love 20 minutes to show you the line before it ships.\n{sender}, ${co}` : `Thank you for stocking ${co} this year. We had these made for your counter.\n{sender}, ${co}`,
    customer: `Thank you for being ${/^[aeiou]/i.test(co) ? "an" : "a"} ${co} customer. We had this made for you.\n{sender}, ${co}`,
    partner: `Thank you for bringing ${co} to your clients. We had this made for you.\n{sender}, ${co}`,
    newHire: `Welcome to ${co}. We're glad you're here. This is from all of us${follow ? "." : "; see you on day one."}\n{manager} and the team`,
    anniversary: `{years} years at ${co}. Thank you for all of it.\n{manager}`,
    employee: `Thank you for {the specific thing}. We noticed.\n{manager}`,
    speaker: `Thank you for speaking at ${ev}. People are still talking about your session.\nthe ${co} organizers`,
    organizer: `Thank you for helping run ${ev}. None of it happens without you.\nThe ${co} team`,
    contributor: `Thank you for your contributions to ${co}. This was made for you.\nthe maintainers`,
  };
  const F = {
    champion: `Hi {first name}, I hope the ${g} arrived in one piece. ${launch ? `If it'd help, I can show you ${S} in 20 minutes this week.` : "If it'd help, happy to catch up for 20 minutes this week."} No pressure either way.`,
    designPartner: `Hi {first name}, I hope the ${g} arrived safely. Would you be open to a short quote or a reference call about ${S || "working with us"}?`,
    investor: `Hi {first name}, I hope the ${g} arrived. ${launch ? `If you can share the ${S} announcement or make one intro this week, here's the link: {link}.` : "Thank you again."}`,
    press: `Hi {first name}, I hope the ${g} arrived safely. Thanks for the time at the briefing. The news goes out${dt ? ` on ${dt}` : ""}.`,
    analyst: `Hi {first name}, I hope the ${g} arrived. Thanks again for the briefing. Anything else you need before ${dt || "the announcement"}?`,
    creator: `Hi {first name}, I hope you liked the ${g}. If you share it, your code is {code}; if not, no worries at all.`,
    buyer: `Hi {first name}, I hope the ${g} found a spot on the counter. ${launch ? "Could we find 20 minutes to walk through the line?" : "Is there anything you need for the next order?"}`,
    customer: `Hi {first name}, I hope the ${g} arrived. Thank you again for being with us. Anything we can do better?`,
    partner: `Hi {first name}, I hope the ${g} arrived. Who on your client list should we talk to next?`,
    newHire: `Hi {first name}, did the ${g} make it? ${follow ? "Glad you're here." : "We can't wait to see you on day one."}`,
    anniversary: `Hi {first name}, I hope the ${g} arrived. Thank you for {years} years.`,
    employee: `Hi {first name}, I hope the ${g} arrived. Thank you, really.`,
    speaker: `Hi {first name}, I hope the ${g} arrived. We'd love you back for the next one; want first pick of a slot?`,
    organizer: `Hi {first name}, I hope the ${g} arrived. Are you in for the next one?`,
    contributor: `Hi {first name}, I hope the ${g} arrived. Thank you for everything you've merged this year.`,
  };
  return { note: N[s.role] || N.customer, follow: F[s.role] || F.customer };
}

// Plan arithmetic and rules, applied to the input-driven draft and to a researched plan alike.
export function finish(sk, overlay = {}) {
  const { I, segments, notes } = sk, K = I.K, saas = !!K.saas || segments.some((s) => ROLES[s.role]?.kind === "b2b");
  const co = I.company, S = I.subj, Sc = cap1(S), evAnchor = I.kind === "employees" ? (I.type === "welcome" ? "start date" : I.type === "anniversary" ? "the anniversary" : "delivery day") : K.anchor, now = today();
  // "Plan for <date> arrival": the launch, news or start date stays; only the gifts move. Where the date is the delivery day itself, the new date replaces it.
  let AB = I.kind !== "community" && I.arriveBy && I.date && I.arriveBy > I.date ? I.arriveBy : 0;
  // only some gifts were late: those move to the later arrival, the rest keep the day
  const MV = AB && I.move.size && segments.some((s) => !I.move.has(s.pick.id)) ? AB : 0; if (MV) AB = 0; const moved = (id) => !!MV && I.move.has(id);
  if (AB && evAnchor === "delivery day") { I.date = AB; AB = 0; }
  const anchor = AB ? "arrival" : evAnchor, afterDay = { "launch day": "after launch day", "start date": "after their start date", "embargo day": "after the news goes out", "the anniversary": "after the anniversary" }[evAnchor] || `after ${evAnchor}`;
  // community thank-yous go out after the event: the date that matters is when the gift lands, never in the past
  const after = I.kind === "community", maxLead = Math.max(...segments.map((s) => CATALOG[s.pick.id].leadDays)), D0 = I.date;
  const arrive = after ? addBiz(Math.max((D0 || now) + 20 * DAY, now + (maxLead + 6) * DAY), 1) : 0, D = after ? arrive : AB || D0;
  const risks = [], approvals = [], yours = sk.seed === "example" ? "a" : "your";

  // gifts: one per group (merged when two groups get the same piece at the same price), all-in cost under the cap
  const cards = [];
  for (const s of segments) {
    const c = CATALOG[s.pick.id], ov = (overlay.gifts || [])[segments.indexOf(s)] || null;
    let gift = s.pick.gift;
    if (ov && num(ov.perPerson)) { gift = Math.round(num(ov.perPerson)); const R = s.R; if (R.valueCap) gift = Math.min(gift, R.valueCap - s.pick.maker); if (I.cap) gift = Math.min(gift, I.cap - s.pick.maker - s.pick.ship); gift = Math.max(gift, Math.min(c.min, s.pick.gift)); }
    const allIn = gift + s.pick.maker + s.pick.ship, name = scrub(ov?.name || c.name, saas);
    s.gift = name; s.short = shortOf(name, s.pick.id); s.cost = allIn; s.giftCost = gift;
    let card = cards.find((x) => x.name === name && x.cost.allIn === allIn);
    if (!card) { card = { name, key: s.pick.id, short: s.short, tieIn: scrub(ov?.tieIn || "", saas), whatsInside: (ov?.whatsInside?.length ? ov.whatsInside : c.inside).map((x) => scrub(x, saas)), personalize: scrub(ov?.personalize || c.personalize, saas), leadTime: c.lead, wow: scrub(ov?.wow || c.wow, saas), makerKeywords: ov?.makerKeywords?.length ? ov.makerKeywords : c.keys, art: c.art, cost: { gift, maker: s.pick.maker, shipping: s.pick.ship, allIn }, qty: 0, segments: [], perishable: !!c.perishable, late: false, leadDays: c.leadDays, id: s.pick.id, fits: s.pick.fits, delivery: { capacity: c.capacity, regions: c.regions, backup: c.backup } }; cards.push(card); }
    card.qty += s.count; card.segments.push(s.who);
    if (!card.alternatives) card.alternatives = s.R.gifts.filter((id) => id !== s.pick.id && CATALOG[id]).map((id) => { const o = CATALOG[id]; let gc = o.gift; if (s.R.valueCap) gc = Math.min(gc, s.R.valueCap - o.maker); if (I.cap) gc = Math.min(gc, I.cap - o.maker - o.ship); return gc >= o.min && !(s.R.noPerishable && o.perishable) ? { name: o.name, allIn: gc + o.maker + o.ship } : null; }).filter(Boolean).slice(0, 2);
  }
  for (const g of cards) {
    if (moved(g.id)) g.arrive = iso(MV);
    if (AB || moved(g.id)) g.tieIn = `Arrives ${fmt(moved(g.id) ? MV : D)}, ${afterDay}.`; else if (!g.tieIn) g.tieIn = I.type === "launch" && S ? `Lands on ${S} launch day.` : "";
    g.bestFor = g.segments.join(", "); g.perPerson = `${money(g.cost.allIn)} all-in`;
    const pressOnly = !after && D && segments.filter((s) => g.segments.includes(s.who)).every((s) => s.role === "press" || s.role === "analyst"), shipDays = g.perishable ? 2 : 5, orderDays = shipDays + g.leadDays + (pressOnly && !AB && !moved(g.id) ? 2 : 0), base = after ? arrive : moved(g.id) ? MV : pressOnly && !AB ? bizOn(D - 2 * DAY, -1) : D, orderAt = base ? bizOn(base - orderDays * DAY, -1) : 0, shipAt = base ? bizOn(base - shipDays * DAY, -1) : 0; g._orderDays = orderDays; g._orderAt = orderAt; g._by = D ? fmt(orderAt) : "";
    g.delivery.shipBy = after || moved(g.id) ? `${fmt(shipAt)}, to arrive ${fmt(after ? arrive : MV)}` : D ? `${fmt(shipAt)} (${plural(Math.round((D - shipAt) / DAY), "day", "days")} before ${anchor})` : `${shipDays} days before ${anchor}`;
    g.delivery.orderBy = base ? `${fmt(orderAt)} (${g.leadTime} to make)` : `${orderDays} days before ${anchor} (${g.leadTime} to make)`;
    if (D && !after && orderAt < now) { const left = Math.round((D - now) / DAY), seg = segments.find((x) => x.gift === g.name), fast = seg && seg.R.gifts.map((id) => CATALOG[id]).find((o) => o && o.leadDays + (o.perishable ? 2 : 5) <= left && o.name !== g.name); g.late = true; g._fast = fast ? `${fast.name.toLowerCase()} (${fast.lead})` : ""; }
    if (!g.fits) risks.push(`At ${money(I.cap)} a person all-in, nothing handmade fits for ${g.segments.join(" and ").toLowerCase()} once shipping is counted. The cheapest option is ${money(g.cost.allIn)} all-in (${g.name.toLowerCase()}). Raise the cap to ${money(g.cost.allIn)} or send a note only.`);
    delete g.leadDays;
  }
  const lateGifts = cards.filter((g) => g.late), maxOrder = Math.max(0, ...cards.map((g) => g._orderDays || 0)), firstOrder = D && !after ? Math.min(...cards.map((g) => g._orderAt)) : 0, ordO = firstOrder ? Math.round((firstOrder - D) / DAY) : 0;
  // ordered tomorrow or later, every gift arrives by this date: a working day, with every order date a working day after today
  let nextOk = now + (maxOrder + 1) * DAY; for (let i = 0; i < 30 && (!workday(nextOk) || cards.some((g) => bizOn(nextOk - g._orderDays * DAY, -1) <= now)); i++) nextOk += DAY;
  cards.forEach((g) => { delete g._orderDays; delete g._orderAt; });
  const timing = D && !after && (D < now || lateGifts.length) ? { late: true, passed: D < now, nextDate: iso(nextOk), next: fmt(nextOk), afterStart: D >= now && I.kind === "employees" && I.type === "welcome", text: D < now ? `${fmt(D)} has already passed.` : lateGifts.length < cards.length ? `${cap1(lateGifts.map((g) => g.name).join(" and "))} won't make ${fmt(D)}.` : `Handmade needs till ${fmt(nextOk)}.`, hint: D < now ? "" : I.kind === "employees" && I.type === "welcome" ? "That's after day one. Send a card now and the gift after." : `Ask about a rush${lateGifts.find((g) => g._fast) ? `, switch to ${lateGifts.find((g) => g._fast)._fast}` : ""}, or send a card now and the gift after.` } : null; cards.forEach((g) => { delete g._by; delete g._fast; });
  // a late plan never promises the original day on a gift card
  if (timing) cards.forEach((g) => (g.tieIn = ""));
  // the gift lands after the day (late, or planned for a later arrival): nothing promises "before day one"
  const follow = !!(timing || AB);
  const lateIds = new Set(lateGifts.map((g) => g.id)), arrOf = (id) => (moved(id) ? MV : timing && lateIds.has(id) ? nextOk : D), ARR = MV || (timing ? nextOk : D);
  const welcomeLate = I.kind === "employees" && I.type === "welcome" && follow;
  if (I.kind === "employees" && I.type === "welcome" && D0 && !workday(D0) && [0, 6].includes(new Date(D0).getUTCDay())) notes.push(`${new Date(D0).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} is a ${new Date(D0).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}. Start dates are usually Mondays.`);
  if (follow) segments.forEach((s) => { if (s.role === "newHire") s.R = { ...s.R, job: "Feel welcome in their first weeks", kpi: "Delivery date logged. One survey question after 30 days" }; });
  if (D && [9, 10, 11].includes(new Date(D).getUTCMonth())) risks.push(I.type !== "launch" ? "Makers book up in Nov and Dec. Confirm dates first." : "Makers book up in Nov and Dec. Confirm dates before you announce.");
  if (cards.some((g) => g.perishable)) risks.push("Collect dietary needs before sending food. Perishables ship domestic only.");
  if (segments.some((s) => s.role === "creator")) risks.push("Creators: say “no posting required” on the card, and if they do post, they must disclose the gift (#gifted).");

  // compliance: every pasted row is checked; flagged rows get a note, $0 and a reason
  const flagged = I.roster.filter((r) => (r.flag = complianceOf(r)));
  const byKind = {}; flagged.forEach((r) => (byKind[r.flag.kind] = (byKind[r.flag.kind] || 0) + 1));
  const textFlag = COMPLIANCE.find((c) => c.rx.test(`${I.moment} ${segments.map((s) => s.who).join(" ")}`));
  const compliance = { line: I.kind === "employees" && !flagged.length ? "Gift rules: gifts to employees can count as taxable income. Check with payroll." : flagged.length ? `Gift rules: ${plural(flagged.length, "contact", "contacts")} on your list (${Object.keys(byKind).map((k) => k.toLowerCase()).join(", ")}) get a note only.` : textFlag ? `Gift rules: your brief mentions ${textFlag.kind.toLowerCase()} recipients. They get a note only.` : I.roster.length ? `Gift rules: none of the ${plural(I.roster.length, "contact", "contacts")} you pasted look public-sector, healthcare or regulated finance. Still check each company's gift policy.` : ["b2b", "press", "creators"].includes(I.kind) ? "Gift rules: government, healthcare and finance contacts get a note only. Add your list to flag them." : "", flagged: flagged.length, rules: COMPLIANCE.map((c) => c.reason) };
  const rulesOn = I.kind !== "employees" && !!compliance.line;
  if (rulesOn) approvals.push({ gate: "Check the note-only contacts on the list", who: "Legal" });
  if (segments.some((s) => ROLES[s.role]?.valueCap)) approvals.push({ gate: "Press gifts: gift value under $25 (shipping not counted), nothing perishable, check each outlet's policy", who: "PR lead" });
  if (I.cap) approvals.push({ gate: `Cap: ${money(I.cap)} a ${I.kind === "retail" ? "shop" : "person"}, all-in (gift, maker and shipping)`, who: I.kind === "employees" ? "People team" : "Marketing" });
  approvals.push({ gate: saas ? "Confirm each recipient on your accounts" : `${segments[0].R.owner} ${/\+| and /.test(segments[0].R.owner) ? "confirm" : "confirms"} each recipient and address`, who: saas ? "AE" : segments[0].R.owner });
  if (I.kind !== "employees") approvals.push({ gate: "Every card offers to decline or donate", who: "Marketing" });
  if (saas) approvals.push({ gate: "Never make a gift conditional on taking a meeting", who: "AE" });
  if (I.kind === "employees") approvals.push({ gate: "Same gift for everyone", who: "People team" });

  // holdout: only where it can mean something, never on strategic accounts, stratified by tier
  const acctSeg = segments.find((s) => ROLES[s.role]?.account) || null, thanks = ["thanks", "welcome", "anniversary"].includes(I.type) || ["employees", "community", "customers"].includes(I.kind);
  const unitsAll = acctSeg ? [...new Set(I.roster.filter((r) => !r.flag).map((r) => r.account || r.contact))] : [];
  const eligible = unitsAll.filter((a) => !I.protect.has(String(a).toLowerCase()));
  let held = new Set(), holdout, useHoldout = false;
  const seed = String(overlay.seed || sk.seed || "plan");
  const h = (t) => { let x = 2166136261; for (const ch of seed + "|" + String(t).toLowerCase()) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0; return x; };
  if (!acctSeg || thanks || I.kind === "press") holdout = thanks ? `None. ${I.kind === "employees" ? "Nobody holds back gifts to their own people." : "Leaving people out of a thank-you costs more goodwill than the data is worth."} Compare ${I.kind === "retail" || I.kind === "customers" ? "reorders and replies in the 60 days after with the same period last year" : "against your last round"} instead.` : `None. ${cap1(segments.map((s) => s.who.toLowerCase()).join(" and "))} aren't a list you can split fairly. Measure each group against its own target below.`;
  else {
    const n = I.roster.length ? eligible.length : acctSeg.count;
    if (n < 30) holdout = `None. With ${plural(n, I.roster.length ? "account" : "recipient", I.roster.length ? "accounts" : "recipients")} left${I.roster.length && unitsAll.length !== I.roster.length || I.protect.size ? " (after gift rules and your always-gift list)" : ""}, that's too few to split. Gift them all and compare with similar ${saas ? "accounts" : "recipients"} you didn't gift, or your last ${I.type === "launch" ? "launch" : "round"}. Split once you have 30 or more.`;
    else {
      useHoldout = true;
      if (I.roster.length) { const tiers = {}; I.roster.filter((r) => eligible.includes(r.account || r.contact)).forEach((r) => { const k = r.tier || "-"; (tiers[k] ||= new Set()).add(r.account || r.contact); });
        for (const set of Object.values(tiers)) { const arr = [...set].sort((a, b) => h(a) - h(b)); arr.slice(0, Math.round(arr.length * 0.2)).forEach((a) => held.add(a)); }
        holdout = `Put ${held.size} of the ${eligible.length} accounts in the comparison group, picked at random${Object.keys(tiers).length > 1 ? `, matched by tier (${Object.keys(tiers).filter((k) => k !== "-").join(", ")})` : ""}. They get the ${anchor === "launch day" ? "launch email" : "same email"} but no gift.${I.protect.size ? ` The ${plural(unitsAll.length - eligible.length, "account", "accounts")} on your always-gift list get one.` : ""}`; }
      else holdout = `Pick ${Math.max(1, Math.round(acctSeg.count * 0.2))} of the ${acctSeg.count} at random (a few from each tier, never your always-gift list). They get the email, not the gift.`;
    }
  }

  // who gets what, and what it costs
  const lines = segments.map((s) => { const inList = acctSeg === s && I.roster.length; const out = inList ? I.roster.filter((r) => r.flag).length : 0, hold = inList ? I.roster.filter((r) => !r.flag && held.has(r.account || r.contact)).length : useHoldout && acctSeg === s ? Math.round(s.count * 0.2) : 0;
    const people = Math.max(0, s.count - out - hold);
    s.sent = people; s.held = hold; s.noted = out;
    return { segment: s.who, people: String(people), gift: s.gift, giftCost: money(s.giftCost), makerFee: money(s.pick.maker), shipping: money(s.pick.ship), each: money(s.cost), total: money(people * s.cost), n: people * s.cost }; });
  for (const g of cards) g.qty = segments.filter((s) => g.segments.includes(s.who)).reduce((a, s) => a + s.sent, 0);
  const total = lines.reduce((a, x) => a + x.n, 0), people = segments.reduce((a, s) => a + s.sent, 0);

  // targets per outcome, from the deal size or goal where there is one
  const targets = segments.map((s) => { const o = s.R.outcome, exp = Math.max(o.rate >= 1 ? s.sent : 1, Math.round(s.sent * o.rate)), spend = s.sent * s.cost;
    return { segment: s.who, outcome: o.unit, expected: exp, costPer: s.sent ? money(spend / Math.max(1, exp)) : "$0", rate: o.rate }; });
  const main = targets.find((t) => t.outcome === "meeting") || targets.find((t) => t.outcome === "buyer meeting") || targets[0];
  const pipe = saas && I.deal && main && main.outcome === "meeting" ? Math.round(main.expected * 0.5) * I.deal : 0;
  const orders = !saas && I.deal && main && /reorder|buyer meeting|referral/.test(main.outcome) ? Math.round(main.expected * (main.outcome === "buyer meeting" ? 0.5 : 1)) * I.deal : 0;
  const finance = {
    spend: `Spend: about ${money(total)} on ${plural(people, "gift", "gifts")}, all-in.`,
    expect: I.kind === "employees" ? `Expected return: every one of the ${people} ${I.type === "welcome" ? (follow ? "new hires gets a card now and the gift soon after" : "new hires has it before day one") : "people hears thank you for something specific"}.` : `Expected return: an estimate from the rates below, not a promise. ${targets.map((t) => `about ${plural(t.expected, t.outcome, plu(t.outcome))} from ${t.segment.toLowerCase()} (up to ${t.costPer} ${aOf(t.outcome)})`).join("; ").replace(/^a/, "A")}.${pipe ? ` At ${yours} ${money(I.deal)} average deal, if ${Math.round(main.expected * 0.5)} ${Math.round(main.expected * 0.5) === 1 ? "becomes a deal" : "become deals"}, that's about ${money(pipe)} in new deals.` : orders ? ` At ${yours} ${money(I.deal)} average order, that could be about ${money(orders)} in orders.` : saas && !I.deal ? " Add an average deal to see what the meetings are worth." : !I.deal && I.kind === "retail" ? " Add an average order to see what it's worth." : ""}`,
    measure: I.kind === "employees" ? `How it's measured: delivery date in the tracking sheet, and one survey question${D ? ` on ${fmt(bizOn(ARR + 30 * DAY, 1))}` : " 30 days later"}.` : `How it's measured: log ${andList(targets.map((t) => `${plu(t.outcome)}`).filter((x, i, a) => a.indexOf(x) === i))} in the tracking sheet${D ? ` by ${fmt(bizOn(ARR + 30 * DAY, 1))}` : " 30 days after"}.${useHoldout ? " Compare gifted accounts with the comparison group." : ""}`,
    // the model's assumptions: in the downloads, not on the page
    rates: I.kind === "employees" || !targets.length ? "" : `Assumed rates, not measured: ${targets.map((t) => `${Math.round(t.rate * 100)}% ${plu(t.outcome)}`).filter((x, i, a) => a.indexOf(x) === i).join(", ")}.`,
  };

  // sends and timeline, dated when there's a date
  const sends = segments.map((s) => ({ wave: s.who, what: s.gift, when: moved(s.pick.id) ? `Arrives ${fmt(MV)}` : s.role === "press" || s.role === "analyst" ? (D ? `Arrives ${fmt(AB ? D : bizOn(D - 2 * DAY, -1))}, non-perishable` : "Two days before the embargo lifts") : after ? `Arrives about ${fmt(arrive)}` : D ? `Arrives ${fmt(D)}` : `Arrives on ${anchor}`, why: s.R.job }));
  const rel = (o, an = anchor) => (o === 0 ? cap1(an) : `${Math.abs(o) % 7 === 0 ? plural(Math.abs(o) / 7, "week", "weeks") : plural(Math.abs(o), "day", "days")} ${o < 0 ? "before" : "after"}${o < 0 ? " " + an : ""}`);
  const T = (o, step, owner) => { if (!D) return { o, when: rel(o), step, owner }; const t = o === 0 ? D : bizOn(D + o * DAY, o < 0 ? -1 : 1); return { o, when: `${fmt(t)} (${o === 0 ? anchor : rel(Math.round((t - D) / DAY))})`, step, owner }; };
  const TE = !AB ? T : (o, step, owner) => { const t = o === 0 ? D0 : bizOn(D0 + o * DAY, o < 0 ? -1 : 1); return { o: (t - D) / DAY, when: `${fmt(t)} (${o === 0 ? evAnchor : rel(Math.round((t - D0) / DAY), evAnchor)})`, step, owner }; };
  const TA = (base, o, step, owner) => { if (!D || base === D) return T(o, step, owner); const t = bizOn(base + o * DAY, 1); return { o: (t - D) / DAY, when: `${fmt(t)} (${plural(o, "day", "days")} after the gifts arrive)`, step, owner }; };
  const hasPress = segments.some((s) => s.role === "press" || s.role === "analyst");
  // press kits arrive two working days before the news and ship a full transit (5 days) before that, never on the same day
  const pArrO = AB ? 0 : D ? (bizOn(D - 2 * DAY, -1) - D) / DAY : -2, pShipO = D ? (bizOn(D + (pArrO - 5) * DAY, -1) - D) / DAY : -7;
  const pressKit = [T(pShipO, "Makers ship the press gifts", "Makers"), T(pArrO, "Press gifts arrive", "Makers")];
  const pressSteps = hasPress && I.kind !== "press" ? [TE(-7, "Press briefings before the news is out", "PR lead"), ...pressKit] : [];
  const start = after ? Math.max((D0 || now) + DAY, now) : 0, A = (t, step, owner, lab) => ({ o: (t - arrive) / DAY, when: D0 || after ? `${fmt(t)}${lab ? ` (${lab})` : ""}` : lab, step, owner });
  let timeline = after ? [A(start, `Thank-you email to every ${segments.map((s) => s.who.toLowerCase().replace(/s$/, "")).join(" and ")}; confirm addresses`, "Community lead", start === now ? "today" : "the day after"), A(addBiz(start, 2), "Book the makers and a backup", "Community lead", ""), A(bizOn(arrive - 5 * DAY, -1), "Makers ship", "Makers", ""), A(arrive, "Gifts arrive with the invitation to the next one", "Makers", ""), A(addBiz(arrive, 10), "Count who's in for the next one", "Community lead", "")]
    : I.kind === "employees" ? [T(Math.min(-28, ordO), "Collect home addresses from the people team. Book the maker", "People team"), T(-21, "Maker starts. Managers write their notes", "Managers"), T(-Math.max(2, ...cards.map((g) => (g.perishable ? 2 : 5))), "Makers ship", "Makers"), T(0, "Gifts arrive at home", "Makers"), TE(0, "Manager message on the day", "Managers"), ...(welcomeLate ? [{ o: (now - D) / DAY - 0.01, when: `${fmt(now)} (today)`, step: "Send a welcome card", owner: "Managers" }] : []), TA(ARR, 30, `Ask one question: did you feel ${I.type === "welcome" ? "welcome" : "thanked"}?`, "People team")]
    : I.kind === "press" ? [T(Math.min(-21, ordO - 7), "Pick outlets. Check each outlet's gift policy and skip those that accept none", "PR lead"), T(Math.min(-14, ordO), "Book the maker. Draft the briefing", "PR lead"), TE(-7, "Press briefings before the news is out", "PR lead"), ...pressKit, TE(0, "Embargo lifts", "PR lead"), TE(1, "Thank journalists who covered it", "PR lead")]
    : [T(Math.min(-28, ordO - 7), saas ? "Agree the targets with finance. Pull the list from the CRM; flag note-only contacts" : rulesOn ? "Agree the targets. Build the list. Flag note-only contacts" : "Agree the targets. Build the list", "Marketing ops"), T(Math.min(-21, ordO), saas ? "AEs confirm recipients. Book makers and a backup" : `${segments[0].R.owner} ${/\+| and /.test(segments[0].R.owner) ? "confirm" : "confirms"} recipients. Book makers and a backup`, saas ? "Sales + marketing" : segments[0].R.owner),
      ...(useHoldout ? [T(-20, "Pick the comparison group at random, a few from each tier", "Marketing ops")] : []), ...pressSteps, T(-5, hasPress ? "Makers ship the other gifts" : "Makers ship", "Makers"), ...(AB ? [...(I.type === "launch" ? [TE(0, "The announcement goes out", "Marketing")] : []), T(0, "Gifts arrive", "Marketing")] : [T(0, `Gifts arrive${I.type === "launch" ? "; the announcement goes out" : ""}`, "Marketing")]),
      ...segments.filter((s) => !(hasPress && (s.role === "press" || s.role === "analyst"))).map((s) => { const k = /2 business/.test(s.R.followUp) ? 2 : /week/.test(s.R.followUp) ? 5 : 3, t = addBiz(D ? arrOf(s.pick.id) : today(), k); return { o: (t - (D || today())) / DAY + 0.5, when: D ? fmt(t) : s.R.followUp, step: `${s.who}: follow up, mentioning the ${s.short}`, owner: s.R.owner }; }),
      ...(hasPress ? [TE(1, "Thank journalists who covered it", "PR lead")] : []),
      TA(ARR, 30, `Report ${targets.map((t) => plu(t.outcome)).filter((x, i, a) => a.indexOf(x) === i).join(", ")}${useHoldout ? ", gifted vs. comparison group" : ""}`, "Marketing ops")];
  if (MV && D) { const mv = cards.filter((g) => moved(g.id)), isP = (g) => segments.filter((s) => g.segments.includes(s.who)).every((s) => s.role === "press" || s.role === "analyst"), pM = mv.some(isP), oM = mv.some((g) => !isP(g)), nm = andList(mv.map((g) => `the ${g.short}`)), shipT = bizOn(MV - 5 * DAY, -1);
    if (pM) timeline = timeline.filter((x) => !/^(Makers ship the press gifts|Press gifts arrive)/.test(x.step)).map((x) => (x.step === "Press briefings before the news is out" ? { ...x, step: "Brief press by email. Their gifts follow" } : x.step === "Makers ship the other gifts" ? { ...x, step: "Makers ship" } : x));
    if (oM) timeline = timeline.map((x) => (/^Gifts arrive/.test(x.step) ? { ...x, step: x.step.replace(/^Gifts arrive/, "The other gifts arrive") } : x.step === "Makers ship" ? { ...x, step: "Makers ship the other gifts" } : x));
    timeline.push({ o: (shipT - D) / DAY, when: fmt(shipT), step: `Makers ship ${nm}`, owner: "Makers" }, { o: (MV - D) / DAY, when: `${fmt(MV)} (${afterDay})`, step: pM && !oM ? "Press gifts arrive after the news" : `${cap1(nm)} ${mv.length > 1 ? "arrive" : "arrives"}`, owner: "Makers" }); }
  timeline = timeline.sort((a, b) => a.o - b.o).map(({ o, ...x }) => (D && D + o * DAY < now ? { ...x, _o: o, past: true } : { ...x, _o: o }));
  // a holiday can pull the press kits' arrival onto the day the other gifts ship: say it as one step
  timeline = timeline.flatMap((x, i, L) => { const sh = L.find((y) => y.step === "Makers ship the other gifts" && y.when === x.when); return x.step === "Makers ship the other gifts" && L.some((y) => /^Press gifts arrive/.test(y.step) && y.when === x.when) ? [] : /^Press gifts arrive/.test(x.step) && sh ? [{ ...x, step: `${x.step}; makers ship the other gifts` }] : [x]; });
  // both ship steps on one day are one step
  { const a = timeline.find((y) => y.step === "Makers ship the press gifts"), o = timeline.find((y) => y.step === "Makers ship the other gifts"); if (a && o && a.when === o.when) { o.step = "Makers ship"; timeline = timeline.filter((y) => y !== a); } }
  // a late plan never schedules the missed date: ship steps wait for the makers, arrivals say they're late
  if (timing) { const isPress = (g) => segments.filter((s) => g.segments.includes(s.who)).every((s) => s.role === "press" || s.role === "analyst"), pL = lateGifts.some(isPress), oL = lateGifts.some((g) => !isPress(g));
    timeline = timeline.map((x) => { const st = x.step, { past, ...y } = x;
      if ((st === "Makers ship" && oL) || (st === "Makers ship the other gifts" && oL) || (st === "Makers ship the press gifts" && pL)) return { ...y, when: "As soon as they're made" };
      if (/^Gifts arrive(?: at home)?$/.test(st) && oL) return { ...y, _o: (nextOk - D) / DAY, when: `${timing.next} at the earliest`, step: `${st} late` };
      if (/^(Gifts arrive|The other gifts arrive)/.test(st) && oL) return { ...y, step: st.replace(/^((?:The other )?[Gg]ifts arrive(?: at home)?)/, `$1 late (earliest ${timing.next})`) };
      if (st === "Makers ship" && pL && !oL) return { ...x, step: "Makers ship the other gifts" };
      if (/^Press gifts arrive/.test(st) && pL) return { ...y, _o: (nextOk - D) / DAY, when: `${timing.next} at the earliest`, step: st.replace(/^Press gifts arrive/, "Press gifts arrive after the news") };
      if (st === "Press briefings before the news is out" && pL) return { ...x, step: "Brief press by email. Their gifts follow" };
      return x; }).sort((a, b) => a._o - b._o); }
  if (AB && D + pArrO * DAY > D0) timeline = timeline.map((x) => (/^Press gifts arrive/.test(x.step) ? { ...x, step: x.step.replace(/^Press gifts arrive/, "Press gifts arrive after the news") } : x.step === "Press briefings before the news is out" ? { ...x, step: "Brief press by email. Their gifts follow" } : x));
  if (D && D < now && !after) risks.unshift(`The date you gave (${fmt(D)}) has passed. Every date here is counted from it; change the date to re-plan.`);

  // triggers: what starts a follow-up (never a condition on the gift)
  const triggers = saas ? [{ signal: "Opened the announcement twice", send: "AE note the same week", segment: segments.find((s) => s.role === "champion")?.who || segments[0].who }, { signal: "Visited the pricing page", send: "AE offers 20 minutes", segment: segments.find((s) => s.role === "champion")?.who || segments[0].who }, { signal: "Deal moved to a new stage", send: "a gift for the next person in the buying group, within the cap", segment: segments.find((s) => s.role === "champion")?.who || segments[0].who }]
    : I.kind === "creators" ? [{ signal: "Posted about it", send: "Thank-you message and a repost", segment: "Creators" }, { signal: "Code used 5 or more times", send: "Invite to the next drop", segment: "Creators" }]
    : I.kind === "retail" ? (I.type === "launch" ? [{ signal: "Opened the line sheet", send: "Call from the wholesale lead", segment: segments[0].who }, { signal: "Placed an opening order", send: "Handwritten thank-you", segment: segments[0].who }] : [{ signal: "A regular reorder is two weeks late", send: "Call from the wholesale lead", segment: segments[0].who }, { signal: "Placed a reorder", send: "Handwritten thank-you", segment: segments[0].who }]) : [];

  // the brief for whoever follows up, per group, quoting the gift that group actually got
  const brief = { name: K.brief, sections: segments.map((s) => { const v = voice(I, s, s.short, follow || moved(s.pick.id)); return { who: s.who, owner: s.R.owner, gift: s.gift, job: s.R.job, followUp: s.R.followUp, measure: s.R.kpi, script: v.follow }; }) };
  const theme = { ...themeFor(I, sk.theme, follow), ...(overlay.theme?.name ? overlay.theme : {}) };
  const first = segments[0], emailSubj = I.type === "launch" && S ? `${Sc} is ${I.date && I.date > now ? "coming" : "out"} (and something for you)` : I.kind === "employees" && I.type === "welcome" ? `Welcome to ${co}: something's on its way` : `Thank you from ${co}`;
  const email = overlay.message?.email || (I.kind === "employees" && I.type === "welcome" ? `Hi {first name},\n\nWelcome to ${co}. ${follow ? "Something" : `Before your first day${D ? ` on ${fmt(D)}` : ""}, something`} from the team is on its way to your home address. Keep an eye out for it.\n\n{manager}` : I.type === "launch" && S ? `Hi {first name},\n\n${I.date && I.date > now ? `On ${fmt(I.date)} we launch` : "We just launched"} ${S}. We had something made for you to go with it. ${follow || MV ? "It's on its way." : `It should arrive ${I.date ? "the same day" : "this week"}.`}\n\n{sender}` : `Hi {first name},\n\nWe had something made for you to say thank you. ${timing ? "It's on its way." : `It should arrive ${I.date ? `around ${fmt(I.date)}` : "soon"}.`}\n\n{sender}`);
  const social = I.kind === "employees" ? "" : I.kind === "press" ? `(After the embargo lifts) ${Sc || "Our news"} is out. Thank you to everyone who covered it.` : overlay.message?.social || (I.type === "launch" && S ? `${Sc} is out. To the people who helped us get here: check your mailbox.` : after ? `Thank you to every ${segments.map((s) => s.who.toLowerCase().replace(/s$/, "")).join(" and ")}${eventOf(I.moment) ? ` at ${eventOf(I.moment)}` : ""}. Something made by hand is on its way to you.` : `Thank you to everyone who made our year. Something handmade is on its way.`);
  const goal = I.kind === "employees" ? `Every one of the ${people} ${segments.length > 1 ? "people" : first.who.toLowerCase()} feels ${I.type === "welcome" ? (follow ? "welcome in their first weeks" : "welcome before day one") : "thanked for something specific"}.` : `${targets.map((t) => `${plural(t.expected, t.outcome, plu(t.outcome))} from ${t.segment.toLowerCase()}`).join(", ")}.`;

  return cleanPlan({
    company: co, website: overlay.website || "", kind: I.kind, kindLabel: K.label, date: D0 ? iso(D0) : "", arriveBy: AB ? iso(AB) : "", timing,
    moment: { title: overlay.moment?.title || I.moment.replace(/^(we are|we're|we’re)\s+/i, "").replace(/^./, (c) => c.toUpperCase()), what: overlay.moment?.what || `${co}: “${I.moment}”.`, when: overlay.moment?.when || (AB ? fmt(D0) : D ? fmt(D) : ""), whyItMatters: overlay.moment?.whyItMatters || "", sources: overlay.moment?.sources || [] },
    audience: { summary: `${plural(segments.length, "group", "groups")}, ${plural(segments.reduce((a, s) => a + s.count, 0), "person", "people")}, ${plural(people, "gift", "gifts")}.`, reconcile: notes, segments: segments.map((s) => ({ who: s.who, role: s.role, why: s.R.tier, count: String(s.count), job: s.R.job, kpi: s.R.kpi, owner: s.R.owner, followUpBy: s.R.followUp, tier: s.R.tier, gift: s.gift, cost: s.cost, sent: s.sent,
      send: s.sent === 0 ? "none" : s.held || s.noted ? "fewer" : "all", sendNote: [s.noted ? `${s.noted} of ${s.count} get a note only (gift rules).` : "", s.held ? `${s.held} get the email only (comparison group).` : ""].filter(Boolean).join(" ") })) },
    theme: { ...theme, name: scrub(theme.name, saas), idea: scrub(theme.idea, saas), line: scrub(theme.line, saas), doesForThem: scrub(theme.doesForThem, saas), searchFor: scrub(theme.searchFor, saas) },
    gifts: cards.slice(0, 6),
    experience: overlay.experience || [],
    playbook: { goal: scrub(goal, saas), list: { who: segments.map((s) => s.who).join(", "), howMany: `${people} people`, howToPick: I.roster.length ? (sk.seed === "example" ? `From ${co}'s ${I.roster.length}-row list. Each owner confirms their recipients.` : `From the ${plural(I.roster.length, "row", "rows")} you pasted. Each owner confirms their recipients.`) : `${segments.map((s) => `${s.who}: ${s.R.tier.toLowerCase()}`).join(". ")}.` },
      timeline, message: { notes: segments.map((s) => ({ segment: s.who, note: voice(I, s, s.short, follow || moved(s.pick.id)).note })), note: voice(I, first, first.short, follow || moved(first.pick.id)).note, subject: scrub(overlay.message?.subject || emailSubj, saas), email: scrub(email, saas), social: scrub(social, saas) },
      unboxing: "Put the note on top.",
      followUp: [...segments.map((s) => `${s.who}: ${s.R.owner}, ${s.R.followUp.replace(/\.$/, "").toLowerCase()}. Mention the ${s.short}.`)],
      measure: segments.map((s) => `${s.who}: ${s.R.kpi.toLowerCase()}`),
      budget: { perPerson: `about ${money(total / Math.max(1, people))} a ${I.kind === "retail" ? "shop" : "person"}`, total: `about ${money(total)} for ${people}`, note: "Each maker confirms the price on your quote.", fee: FEE_LINE ? `${FEE_LINE}.` : "" },
      risks: [...risks, ...(overlay.risks || []).map((x) => scrub(x, saas)).filter((x) => !/Q[1-4]\b/.test(x))].slice(0, 8), sends, triggers, compliance, finance, targets: targets.map(({ rate, ...t }) => t),
      prove: { cfo: [finance.spend, finance.expect, finance.measure].join(" "), holdout, useHoldout, held: held.size, lines: saas ? [{ name: "New deals", how: "Deals created in 60 days" + (useHoldout ? ", gifted vs. comparison group" : "") }, { name: "Deal acceleration", how: "Days to the next stage on open deals that received a gift" }, { name: "Expansion", how: "Seats or usage added at existing customers who received a gift" }] : I.kind === "employees" ? [] : targets.map((t) => ({ name: t.segment, how: `${cap1(plu(t.outcome))}, target ${t.expected} at up to ${t.costPer} ${aOf(t.outcome)}` })), target: pipe ? `Target: about ${money(pipe)} in pipeline from about ${main.expected} meetings, on ${money(total)} spend (up to ${main.costPer} a meeting).` : orders ? `Target: about ${plural(main.expected, main.outcome, plu(main.outcome))} (up to ${main.costPer} ${aOf(main.outcome)}), about ${money(orders)} in orders on ${money(total)} spend.` : main && I.kind !== "employees" ? `Target: about ${plural(main.expected, main.outcome, plu(main.outcome))} at up to ${main.costPer} ${aOf(main.outcome)}.` : "", caveat: useHoldout ? "One round is a hint, not proof. Compare again next time." : "" },
      approvals, budgetLines: lines.map(({ n, ...x }) => x), brief },
    source: overlay.source || "draft",
  });
}

export const planFromInput = (input, seed = "plan") => { const sk = skeleton(input); sk.seed = seed; return finish(sk, { seed }); };
// kept for callers and tests that know the old name
export const samplePlan = (input) => planFromInput(input);

/* ---------------------------------------------------------------- shape, prompt, roster */

/** Keep only the shape we use; anything else the model writes is dropped. */
export function cleanPlan(p = {}) {
  const m = p.moment || {}, a = p.audience || {}, t = p.theme || {}, b = p.playbook || {}, msg = b.message || {}, bud = b.budget || {}, l = b.list || {}, cpl = b.compliance || {}, fin = b.finance || {}, br = b.brief || {};
  const cost = (c) => ({ gift: int(c?.gift), maker: int(c?.maker), shipping: int(c?.shipping), allIn: int(c?.allIn) });
  return {
    timing: p.timing?.late && /^\d{4}-\d{2}-\d{2}$/.test(p.timing.nextDate || "") ? { late: true, passed: !!p.timing.passed, nextDate: p.timing.nextDate, next: clean(p.timing.next, 40), afterStart: !!p.timing.afterStart, text: clean(p.timing.text, 300), hint: clean(p.timing.hint, 300) } : null,
    company: clean(p.company, 100), website: url(p.website), kind: KINDS[p.kind] ? p.kind : "", kindLabel: clean(p.kindLabel, 60), date: /^\d{4}-\d{2}-\d{2}$/.test(p.date || "") ? p.date : "", arriveBy: /^\d{4}-\d{2}-\d{2}$/.test(p.arriveBy || "") ? p.arriveBy : "", source: ["draft", "researched", "example"].includes(p.source) ? p.source : "draft",
    moment: { title: clean(m.title, 200), what: clean(m.what, 600), when: clean(m.when, 60), whyItMatters: clean(m.whyItMatters, 500), sources: list(m.sources, 4, (s) => (url(s?.url) ? { title: clean(s.title, 120), url: url(s.url) } : null)) },
    audience: { summary: clean(a.summary, 500), reconcile: list(a.reconcile, 6, (x) => clean(x, 300)), segments: list(a.segments, 6, (s) => (clean(s?.who, 120) ? { who: clean(s.who, 120), role: ROLES[s.role] ? s.role : "", why: clean(s.why, 240), count: clean(s.count, 40),
      job: clean(s.job, 160), kpi: clean(s.kpi, 160), owner: clean(s.owner, 60), followUpBy: clean(s.followUpBy, 60), tier: clean(s.tier, 240), gift: clean(s.gift, 120), cost: int(s.cost), sent: int(s.sent), send: ["all", "fewer", "none"].includes(s.send) ? s.send : "all", sendNote: clean(s.sendNote, 200) } : null)) },
    theme: { name: clean(t.name, 80), idea: clean(t.idea, 400), line: clean(t.line, 160), doesForThem: clean(t.doesForThem, 300), searchFor: clean(t.searchFor, 200) },
    gifts: list(p.gifts, 6, (g) => (clean(g?.name, 90) ? { name: clean(g.name, 90), key: CATALOG[g.key] ? g.key : "", short: clean(g.short, 40), arrive: /^\d{4}-\d{2}-\d{2}$/.test(g.arrive || "") ? g.arrive : "", tieIn: clean(g.tieIn, 300), whatsInside: list(g.whatsInside, 6, (x) => clean(x, 120)), personalize: clean(g.personalize, 240), perPerson: clean(g.perPerson, 40), bestFor: clean(g.bestFor, 160), leadTime: clean(g.leadTime, 40), wow: clean(g.wow, 240), makerKeywords: list(g.makerKeywords, 5, (x) => clean(x, 40)), alternatives: list(g.alternatives, 2, (x) => (clean(x?.name, 90) ? { name: clean(x.name, 90), allIn: int(x.allIn) } : null)), art: clean(g.art, 20), late: !!g.late, qty: int(g.qty), segments: list(g.segments, 6, (x) => clean(x, 120)), cost: cost(g.cost),
      delivery: { capacity: clean(g.delivery?.capacity, 120), regions: clean(g.delivery?.regions, 140), shipBy: clean(g.delivery?.shipBy, 80), orderBy: clean(g.delivery?.orderBy, 80), backup: clean(g.delivery?.backup, 160) } } : null)),
    experience: list(p.experience, 3, (x) => (clean(x?.name, 90) ? { name: clean(x.name, 90), why: clean(x.why, 280) } : null)),
    playbook: {
      goal: clean(b.goal, 400),
      list: { who: clean(l.who, 300), howMany: clean(l.howMany, 60), howToPick: clean(l.howToPick, 500) },
      timeline: list(b.timeline, 12, (x) => (clean(x?.step, 300) ? { when: clean(x.when, 60), step: clean(x.step, 300), owner: clean(x.owner, 60), ...(x.past ? { past: true } : {}) } : null)),
      message: { notes: list(msg.notes, 6, (x) => (clean(x?.note, 500) ? { segment: clean(x.segment, 120), note: cleanLines(x.note, 500) } : null)), note: cleanLines(msg.note, 700), email: cleanLines(msg.email, 1200), subject: clean(msg.subject, 120), social: clean(msg.social, 500) },
      unboxing: clean(b.unboxing, 500), followUp: list(b.followUp, 7, (x) => clean(x, 300)), measure: list(b.measure, 7, (x) => clean(x, 200)),
      budget: { perPerson: clean(bud.perPerson, 60), total: clean(bud.total, 60), note: clean(bud.note, 300), fee: clean(bud.fee, 120) }, risks: list(b.risks, 8, (x) => clean(x, 300)),
      sends: list(b.sends, 6, (x) => (clean(x?.what, 200) ? { wave: clean(x.wave, 120), what: clean(x.what, 200), when: clean(x.when, 80), why: clean(x.why, 240) } : null)),
      triggers: list(b.triggers, 6, (x) => (clean(x?.signal, 160) ? { signal: clean(x.signal, 160), send: clean(x.send, 160), segment: clean(x.segment, 120) } : null)),
      compliance: { line: clean(cpl.line, 400), flagged: int(cpl.flagged), rules: list(cpl.rules, 4, (x) => clean(x, 200)) },
      finance: { spend: clean(fin.spend, 300), expect: clean(fin.expect, 600), measure: clean(fin.measure, 400), rates: clean(fin.rates, 300) },
      targets: list(b.targets, 6, (x) => (clean(x?.segment, 120) ? { segment: clean(x.segment, 120), outcome: clean(x.outcome, 40), expected: int(x.expected), costPer: clean(x.costPer, 30) } : null)),
      prove: { cfo: clean(b.prove?.cfo, 1400), holdout: clean(b.prove?.holdout, 500), useHoldout: !!b.prove?.useHoldout, held: int(b.prove?.held), lines: list(b.prove?.lines, 6, (x) => (clean(x?.name, 120) ? { name: clean(x.name, 120), how: clean(x.how, 240) } : null)), target: clean(b.prove?.target, 300), caveat: clean(b.prove?.caveat, 300) },
      approvals: list(b.approvals, 10, (x) => (clean(x?.gate, 200) ? { gate: clean(x.gate, 200), who: clean(x.who, 60) } : null)),
      budgetLines: list(b.budgetLines, 6, (x) => (clean(x?.segment, 120) ? { segment: clean(x.segment, 120), people: clean(x.people, 20), gift: clean(x.gift, 120), giftCost: clean(x.giftCost, 30), makerFee: clean(x.makerFee, 30), shipping: clean(x.shipping, 30), each: clean(x.each, 30), total: clean(x.total, 30) } : null)),
      brief: { name: clean(br.name, 80), sections: list(br.sections, 6, (x) => (clean(x?.who, 120) ? { who: clean(x.who, 120), owner: clean(x.owner, 60), gift: clean(x.gift, 120), job: clean(x.job, 160), followUp: clean(x.followUp, 120), measure: clean(x.measure, 200), script: clean(x.script, 500) } : null)) },
    },
  };
}

export function prompt(input) {
  const { company, moment, website, audience, people, budget, tier, accounts = [] } = input, sk = skeleton(input), I = sk.I;
  const groups = sk.segments.map((s) => `${s.who} (${s.count}${ROLES[s.role] ? `, role: ${s.role}` : ""})`).join("; ");
  return `You are Potto, the gifting strategist at Pottery Lab, a home for independent makers and experience hosts (bakers, ceramicists, florists, coffee roasters, illustrators, supper clubs, run clubs).
A marketer at ${company}${website ? ` (${website})` : ""} wants a gift campaign for this moment: "${moment}".
Who it's for: ${I.K.label}.${audience ? ` In their words: ${audience}.` : ""}${people ? ` About ${people} people.` : ""}${budget ? ` Hard cap for each person, all-in (gift + maker + shipping): ${budget}.` : ""}${I.date ? ` The date: ${iso(I.date)}.` : ""}${tier ? ` How big this moment is: ${tier}.` : ""}${accounts.length ? ` They pasted ${accounts.length} accounts.` : ""}
The groups are fixed: ${groups}. Write one gift per group, in this order.

Rules (the plan is checked against them and anything that breaks them is replaced):
1. Honour the inputs exactly. Use only the groups above with their counts. Never add groups they didn't ask for (no design partners, investors or press unless listed). Every gift's all-in cost per person stays within the cap; if nothing fits, say so.
2. Speak to this audience. ${I.K.saas ? "B2B: champions open deals owned by an AE; design partners become references. Investors amplify." : "This is not a software company audience: never use pipeline, AE, opportunity, API, trial, seat or design-partner language."} Press and analysts: under $25 in value, nothing perishable before the embargo, respect outlet gift policies. Creators: posts, saves and codes, made by a maker in their city, no posting required. Retail buyers: buyer meetings and reorders. Employees: welcome, anniversary or thank-you, written for internal comms. Community: speakers, co-organizers and contributors.
3. Use real dates from the date given. Never write a season or quarter ("Q4", "by June"). No emoji. Start every sentence with a capital letter.
4. Public-sector, healthcare and regulated-finance recipients get a note only, never a gift.
5. Use web search to find what the moment actually is and who ${company} sells to. Cite 1-4 sources. Never invent numbers about the company. Write plainly, no hype.
6. Tie the gift to what the moment means for the recipient, not only its name. Prefer things a small maker can make or personalise over merch. No QR codes.

Reply with JSON only, in this shape (gifts in the same order as the groups):
{"company":"","website":"","moment":{"title":"","what":"","when":"","whyItMatters":"","sources":[{"title":"","url":""}]},
"theme":{"name":"","idea":"","line":"","doesForThem":"","searchFor":""},
"gifts":[{"name":"","tieIn":"","whatsInside":[""],"personalize":"","perPerson":"$ gift cost only","wow":"","makerKeywords":[""]}],
"experience":[{"name":"","why":""}],
"playbook":{"message":{"subject":"","email":"","social":""},"risks":[""]}}`;
}

// Apply a researched plan over the input-driven skeleton; the skeleton's rules win.
export function mergeResearched(input, ai, seed) {
  const sk = skeleton(input); sk.seed = seed; const saas = !!sk.I.K.saas;
  const bad = (s) => !s || (!saas && SAAS.test(s)) || /\bQ[1-4]\b|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(s);
  const keep = (s) => (bad(s) ? "" : s);
  const th = ai.theme || {}, msg = ai.playbook?.message || {};
  return finish(sk, { seed, source: "researched", website: ai.website, moment: { ...ai.moment, what: keep(ai.moment?.what) || "", whyItMatters: keep(ai.moment?.whyItMatters) || "" },
    theme: th.name && !bad(th.idea) ? { name: th.name, idea: th.idea, line: keep(th.line), doesForThem: keep(th.doesForThem), searchFor: keep(th.searchFor) } : null,
    gifts: (ai.gifts || []).map((g) => (bad(g.name) || bad(g.tieIn) ? null : g)), experience: ai.experience, risks: (ai.playbook?.risks || []).filter((x) => !bad(x)),
    message: { subject: keep(msg.subject), email: keep(msg.email), social: keep(msg.social) } });
}

const CSV_HEAD = ["Campaign Name", "Campaign Member Status", "HubSpot List", "Company", "Contact", "Email", "Role", "Tier", "Stage", "Owner", "Segment", "Group", "Gift", "Approved Cost", "Reason", "Follow-up Owner", "Follow Up By", "Sent Date", "Delivered Date", "Meeting Booked", "Opp Created", "Opp Amount", "Outcome"];
// One row per pasted account or contact (or, with no list, one template row per group), ready for Salesforce or HubSpot.
export function crmRows(plan, input = {}, seed = "plan") {
  const I = readInput(input), segs = plan.audience.segments, camp = `${plan.company} · ${plan.moment.title}`.slice(0, 80);
  const acct = segs.find((s) => ROLES[s.role]?.account) || segs[0];
  const h = (t) => { let x = 2166136261; for (const ch of String(seed) + "|" + String(t).toLowerCase()) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0; return x; };
  // the same holdout the plan describes
  const held = new Set(); if (plan.playbook.prove.useHoldout && I.roster.length) { const tiers = {}; I.roster.filter((r) => !complianceOf(r) && !I.protect.has(String(r.account || r.contact).toLowerCase())).forEach((r) => { (tiers[r.tier || "-"] ||= new Set()).add(r.account || r.contact); }); for (const set of Object.values(tiers)) { const arr = [...set].sort((a, b) => h(a) - h(b)); arr.slice(0, Math.round(arr.length * 0.2)).forEach((a) => held.add(a)); } }
  const list = (s, g) => `${plan.company} · ${plan.moment.title.slice(0, 40)} · ${s} · ${g}`;
  if (!I.roster.length) return segs.map((s) => ({ "Campaign Name": camp, "Campaign Member Status": "Gift planned", "HubSpot List": list(s.who, "Gift"), Company: "", Contact: "", Email: "", Role: "", Tier: "", Stage: "", Owner: "", Segment: s.who, Group: "Gift", Gift: s.gift, "Approved Cost": String(s.cost || ""), Reason: `Placeholder. Add a row for each of your ${s.who.toLowerCase()}.`, "Follow-up Owner": s.owner, "Follow Up By": s.followUpBy, "Sent Date": "", "Delivered Date": "", "Meeting Booked": "", "Opp Created": "", "Opp Amount": "", Outcome: "" }));
  return I.roster.map((r) => { const seg = (r.role && segs.find((s) => s.role && s.role === roleOf(r.role))) || (r.role && segs.find((s) => s.who.toLowerCase() === r.role.toLowerCase())) || acct, flag = complianceOf(r), unit = r.account || r.contact;
    const group = flag ? "Note only" : held.has(unit) ? "Comparison group" : "Gift";
    return { "Campaign Name": camp, "Campaign Member Status": { Gift: "Gift planned", "Comparison group": "Comparison group (no gift)", "Note only": "Note only (gift rules)" }[group], "HubSpot List": list(seg.who, group), Company: r.account, Contact: r.contact || "", Email: r.email || "", Role: r.role || "", Tier: r.tier || "", Stage: r.stage || "", Owner: r.owner || "", Segment: seg.who, Group: group,
      Gift: group === "Gift" ? seg.gift : group === "Comparison group" ? "None (comparison group)" : "Note only, no gift", "Approved Cost": group === "Gift" ? String(seg.cost) : "0", Reason: flag ? flag.reason : group === "Comparison group" ? "Comparison group, picked at random" : I.protect.has(String(unit).toLowerCase()) ? "On your always-gift list" : "", "Follow-up Owner": r.owner || seg.owner, "Follow Up By": seg.followUpBy, "Sent Date": "", "Delivered Date": "", "Meeting Booked": "", "Opp Created": "", "Opp Amount": "", Outcome: "" }; });
}
const cell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""')}"` : t; };
// a team gift (new hires, anniversaries) has no sales columns
const TEAM_DROP = new Set(["Campaign Member Status", "HubSpot List", "Meeting Booked", "Opp Created", "Opp Amount"]);
export const toCsv = (rows, kind = "") => { const H = kind === "employees" ? CSV_HEAD.filter((k) => !TEAM_DROP.has(k)) : CSV_HEAD; return [H, ...rows.map((r) => H.map((k) => r[k]))].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"; };

/* ---------------------------------------------------------------- routes */

const EXAMPLE = () => ({ company: "Fernlight", moment: "We're launching Snapshot", kind: "b2b", audience: "40 champions, 12 journalists, 4 analysts, 15 design partners", people: "71", budget: "$120", dealSize: "$40,000", date: iso(bizOn(today() + 42 * DAY, 1)),
  accounts: ["account,contact,role,tier,owner", "Bramblecot Foods,Ada Moss,VP Finance,1,Sam", "Kettleby Freight,Raj Patel,RevOps lead,1,Sam", "Northvale Outfitters,Lena Ortiz,Head of Data,2,Priya", "City of Fernvale Dept of Finance,Tom Reyes,Controller,2,Priya", "Quillon Labs,Mei Chen,CFO,1,Sam", "Harbor & Pine,Jo Park,Director of Ops,2,Priya", "Saltmarsh Health,Kim Hale,VP Finance,2,Sam", "Tidewater Tools,Ola Berg,RevOps lead,1,Priya"], protect: "Quillon Labs" });

export function readBody(b = {}) {
  const roster = parseRoster(b.accounts);
  return { company: clean(b.company, 100), moment: clean(b.moment, 200), website: clean(b.website, 200), audience: clean(b.audience, 600), people: clean(b.people, 20), budget: clean(b.budget, 40), dealSize: clean(b.dealSize, 40), date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : "", arriveBy: /^\d{4}-\d{2}-\d{2}$/.test(String(b.arriveBy || "")) ? b.arriveBy : "", move: (Array.isArray(b.move) ? b.move : []).map(String).filter((k) => CATALOG[k]).slice(0, 6), city: clean(b.city, 60),
    kind: KINDS[b.kind] ? b.kind : "", tier: ["Major launch", "Feature launch", "Funding or milestone", "Holiday or thank-you"].includes(b.tier) ? b.tier : "",
    accounts: [...new Set(roster.map((r) => r.account).filter(Boolean))], contacts: roster, protect: [...new Set((Array.isArray(b.protect) ? b.protect : String(b.protect || "").split(/\r?\n|,/)).map((x) => clean(x, 80)).filter(Boolean))].slice(0, 100) };
}

export function mountGiftPlan(app, { store, small, discoverHosts }) {
  const S = scopeStore(store, DEFAULT_WS), hits = new Map();
  const drafts = new Map(), DRAFTS_PER_HOUR = +process.env.ENCORE_GIFT_DRAFTS_PER_HOUR || 40;
  const limited = (req) => { const k = req.ip || "?", now = Date.now(); const h = (hits.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); hits.set(k, h); return h.length > PER_HOUR; };
  // which hosts on Pottery Lab could make each gift; makers in the recipients' city first, then ones taking orders
  const makes = (h) => { const sells = [...(h.gifts || []), ...(h.shop?.items || [])], X = h.experiences || []; if (!sells.length && X.length && X.every((x) => categoryOf(x) === "movement")) return "";
    // someone who sells nothing yet counts as a maker only when their name or tagline says they make it
    return [h.name, h.tagline, ...(sells.length ? h.tags || [] : []), ...sells.map((x) => `${x.name || ""} ${x.desc || ""}`)].join(" ").toLowerCase().replace(/[\p{L}-]+ (after|afterwards)\b/gu, " "); };
  // the first two keywords name the craft (ceramics, pottery; coffee, roast); a shop that sells cups is not a ceramicist
  const madeBy = (h, keys) => { const t = makes(h); return !!t && keys.slice(0, 2).some((k) => { const st = k.toLowerCase().replace(/(ing|es|s|y)$/, ""); return new RegExp(`(^|[^\\p{L}])(${k.toLowerCase()}|${st}\\p{L}{0,3})($|[^\\p{L}])`, "u").test(t); }); };
  const withMakers = (plan, city = "") => { let hosts = []; try { hosts = discoverHosts() || []; } catch {}
    const near = (h) => (city && new RegExp(city.replace(/[^\w ]/g, "").split(" ")[0], "i").test(`${h.city || ""} ${h.hood || ""}`) ? 0 : 1);
    return { ...plan, gifts: plan.gifts.map((g) => ({ ...g, makers: keywordRank(g.makerKeywords.join(" ") || g.name, hosts, 12).filter((m) => { const hit = String(m.why || "").replace(/^Mentions /, "").split(", "); return g.makerKeywords.some((k) => { const kk = k.toLowerCase(), st = kk.replace(/(ing|es|s|y)$/, ""); return hit.some((x) => x === kk || x === st || (st.length > 3 && x.startsWith(st))); }) && madeBy(hosts.find((x) => x.handle === m.handle) || {}, g.makerKeywords); }).map((m) => { const h = hosts.find((x) => x.handle === m.handle) || {}; return { handle: h.handle, name: h.name, city: h.city || "", showcase: !!h.showcase, quotes: (h.gifts || []).length > 0, why: m.why, near: !near(h) }; })
      .filter((m, i, a) => m.handle && a.findIndex((x) => x.name === m.name && x.city === m.city) === i).sort((x, y) => (x.showcase - y.showcase) || (y.near - x.near)).slice(0, 3) })) }; };
  // an old or typed address for the planner
  app.get("/giftplan", (req, res) => res.redirect(301, "/gifts/plan"));
  const draftReason = () => (isFake() ? "fake" : aiMode() === "missing_key" ? "missing_key" : "");
  app.post("/api/public/giftplan", small, (req, res) => { const b = req.body || {}, input = readBody(b);
    if (input.company.length < 2 || input.moment.length < 4) return res.status(400).json({ code: "invalid", message: input.company.length < 2 ? "Add your brand and a few words on what's happening." : "Add a few words on what's happening." });
    const id = crypto.randomBytes(8).toString("hex"), done = (plan, reason) => S.set("giftplans/" + id, { status: "ready", input, plan: withMakers(plan, input.city), demo: !!reason, draft: reason || "", at: Date.now() });
    // research off, missing or rate-limited: the plan from their answers, straight away (never "try again later")
    // drafts are cheap but still stored: a generous per-visitor cap keeps storage from being flooded
    { const k = req.ip || "?", now = Date.now(), h = (drafts.get(k) || []).filter((t) => now - t < 3600e3); h.push(now); drafts.set(k, h); if (drafts.size > 5000) drafts.clear(); if (h.length > DRAFTS_PER_HOUR) return res.status(429).json({ code: "slow_down", message: "That's a lot of plans. Try again in an hour." }); }
    const why = draftReason() || (limited(req) ? "rate_limited" : "");
    if (why) { done(planFromInput(input, id), why); return res.json({ id, status: "ready", key: ownerKey(id), draft: why }); }
    S.set("giftplans/" + id, { status: "working", input, at: Date.now() }); running.add(id);
    (async () => { try { const { text } = await complete({ prompt: prompt(input), effort: "medium", maxIterations: 10, tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }] });
        const ai = cleanPlan(parseJsonLoose(text)); if (!ai.gifts.length) throw new Error("no gifts"); done(mergeResearched(input, ai, id), ""); }
      catch { done(planFromInput(input, id), "error"); } finally { running.delete(id); } })().catch(() => {});
    res.json({ id, status: "working", key: ownerKey(id) }); });
  // a worked example anyone can open before filling the form (made-up company and accounts, labelled as such)
  app.get("/api/public/giftplan/example", (req, res) => { const input = readBody(EXAMPLE()), plan = { ...planFromInput(input, "example"), source: "example" };
    res.set("Cache-Control", "public, max-age=600").json({ id: "example", status: "ready", example: true, demo: false, input, plan: withMakers(plan), crm: toCsv(crmRows(plan, input, "example"), plan.kind) }); });
  app.get("/api/public/giftplan/:id", (req, res) => { const id = String(req.params.id).replace(/[^a-f0-9]/g, "").slice(0, 16), d = S.get("giftplans/" + id)?.data; if (!d) return res.status(404).json({ code: "not_found", message: "I can't find that plan. Start a new one?" });
    const own = String(req.query.k || "") === ownerKey(id), { accounts, contacts, protect, ...pub } = d.input || {};
    const out = { id, ...d, input: own ? d.input : { ...pub, accountCount: (accounts || []).length, rowCount: (contacts || []).length }, canResearch: own && aiMode() === "live" };
    if (d.status === "ready") out.crm = toCsv(crmRows(d.plan, own ? d.input : { ...pub }, id), d.plan.kind);
    res.json(out); });
}
