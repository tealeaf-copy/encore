// Insights for brand teams: "What resonates". A privacy-safe view of which kinds of experiences people love, cut by
// place and shape, how well each fits a brand's buyers, and an optional plain-language summary. Pages:
// /teams/insights (brand workspaces only) and /teams/insights/how (the explainer, public).
//
// Where the numbers come from: events hosts ran on Pottery Lab (X.index(): events, who came, kudos), the interests
// guests picked ("What are you into?", system/plint-<hash>), the guest's archetype (X.eventProfile), the "what you
// do" chips a guest can add when they turn insights on, and how team bookings went (server/brandbook.js reviews).
//
// Privacy rules, kept here and tested (test/insights.test.js):
//   1. Opt in. A guest's activity counts only when they turned it on in /settings (system/plinsight-<hash>,
//      include: true). Off by default: the stricter choice, in line with "Finding you" (off unless you turn it on)
//      and the privacy page ("Brands never see a host's guests").
//   2. k-anonymity. A cell (a kind in a city, a weekday evening, a price band...) shows numbers only with at least
//      K.people different people and K.events different events behind it. Otherwise it says "Not enough yet".
//      When exactly one cell in a breakdown is hidden, the next smallest is hidden too, so a total can't be
//      subtracted back into the hidden one. People counts are shown in bands ("40+"), never exact.
//   3. No identities. Payloads carry no guest names, emails, handles or keys: only labels, bands and percentages.
//      Hosts are named (they run public pages), with their numbers under the same thresholds.
//   4. No raw data out. There is no export of guest-level rows, and the AI summary is written from the aggregate
//      numbers alone (summaryPrompt), never from people.
// Fill rate uses the headcount a host's invite already shows publicly, so it counts every event that passes the
// thresholds, without reading anyone's reply.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { allWorkspaceIds, getWorkspace, scopeStore, DEFAULT_WS } from "./workspaces.js";
import { complete, isFake } from "./ai.js";

export const K = { people: 10, events: 3 };
const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 80) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

// ---------------------------------------------------------------------------------------------------------------
// Kinds of experience, worked out from what an event says it is.
export const KINDS = [
  { id: "games", label: "Game nights", one: "a game night", re: /\b(game night|games|board games?|trivia|mahjong|quiz|puzzles?)\b/ },
  { id: "run", label: "Run clubs", one: "a run club", re: /\b(run|runs|running|5k|10k|jog|run club)\b/ },
  { id: "coffee", label: "Coffee mornings", one: "a coffee morning", re: /\b(coffee|matcha|espresso|latte|cupping|breakfast)\b/ },
  { id: "tasting", label: "Tastings", one: "a tasting", re: /\b(tasting|tastings|wine|sake|cheese|chocolate|whisky|whiskey|mezcal)\b/ },
  { id: "workshop", label: "Hands-on workshops", one: "a hands-on workshop", re: /\b(workshop|class|pottery|ceramics?|clay|wheel|print|printing|craft|crafts|candle|flowers?|ikebana|bread|baking|knife|risograph)\b/ },
  { id: "supper", label: "Supper clubs", one: "a supper club", re: /\b(supper|dinner|dinners|feast|potluck|omakase|brunch|pasta|dumplings?|long table)\b/ },
  { id: "tour", label: "Walks and tours", one: "a walk or tour", re: /\b(walk|walks|tour|tours|hike|hikes|crawl)\b/ },
  { id: "talk", label: "Talks and salons", one: "a talk or salon", re: /\b(talk|talks|salon|panel|fireside|lecture|demo night|keynote)\b/ },
  { id: "book", label: "Book clubs", one: "a book club", re: /\b(book club|books?|reading|readers)\b/ },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
/** The kind of one event (or a team package), from its activity, title and tags; null when we can't tell. */
export function kindOf(e = {}) {
  // what the host called it first (the activity), then the title, then tags: "Game night with dumplings" is a game night
  for (const t of [e.activity, e.pubTitle || e.name || e.title, (Array.isArray(e.tags) ? e.tags : []).join(" ")].map(lc)) { if (!t) continue; for (const k of KINDS) if (k.re.test(t)) return k.id; }
  return null;
}

// The cuts a brand can slice by. Each has a label and the values in display order.
export const CUTS = {
  kind: { label: "Kind of experience", values: KINDS.map((k) => [k.id, k.label]) },
  city: { label: "City", values: [] },
  hood: { label: "Neighbourhood", values: [] },
  size: { label: "Group size", values: [["small", "Under 12 people"], ["medium", "12 to 24 people"], ["large", "25 or more"]] },
  days: { label: "Weekday or weekend", values: [["weekday", "Weekdays"], ["weekend", "Weekends"]] },
  time: { label: "Time of day", values: [["morning", "Mornings"], ["daytime", "Afternoons"], ["evening", "Evenings"]] },
  price: { label: "Price a person", values: [["free", "Free"], ["u25", "Under $25"], ["p25", "$25 to $60"], ["p60", "$60 to $120"], ["p120", "$120 and up"]] },
  season: { label: "Season", values: [["winter", "Winter"], ["spring", "Spring"], ["summer", "Summer"], ["fall", "Fall"]] },
};
export const sizeOf = (n) => (!n ? null : n < 12 ? "small" : n < 25 ? "medium" : "large");
export const timeOf = (hhmm) => { const h = +String(hhmm || "").split(":")[0]; if (!String(hhmm || "").includes(":") || Number.isNaN(h)) return null; return h < 11 ? "morning" : h < 17 ? "daytime" : "evening"; };
export const seasonOf = (d) => { const m = +String(d || "").slice(5, 7); return !m ? null : m === 12 || m <= 2 ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "fall"; };
export const daysOf = (d) => { const w = new Date(String(d) + "T12:00:00Z").getUTCDay(); return Number.isNaN(w) ? null : w === 0 || w === 6 ? "weekend" : "weekday"; };
export function priceCentsOf(e = {}) { if (e.free === true || /^(free|0|\$0)$/i.test(String(e.price ?? "").trim())) return 0; const m = /(\d+(?:\.\d+)?)/.exec(String(e.price ?? "").replace(/,/g, "")); return m ? Math.round(+m[1] * 100) : null; }
export const priceBand = (c) => (c == null ? null : c === 0 ? "free" : c < 2500 ? "u25" : c < 6000 ? "p25" : c < 12000 ? "p60" : "p120");
const cityKey = (c) => lc(String(c || "").split(",")[0]);
const titleCase = (s) => String(s || "").replace(/\b([a-z])/g, (m) => m.toUpperCase());

// ---------------------------------------------------------------------------------------------------------------
// What a guest can tell brands about themselves, only when they turn insights on: what they do, in broad strokes.
export const WORK = [
  ["engineering", "Engineering"], ["product", "Product"], ["design", "Design"], ["data", "Data"], ["founder", "Founder"], ["marketing", "Marketing"],
  ["sales", "Sales"], ["people", "People and HR"], ["finance", "Finance"], ["ops", "Operations"], ["creative", "Creative"], ["student", "Student"], ["leader", "I lead a team"],
];
const WORK_IDS = new Set(WORK.map(([k]) => k));
export const cleanWork = (L) => [...new Set((Array.isArray(L) ? L : []).map(lc).filter((x) => WORK_IDS.has(x)))].slice(0, 4);

/** A brand's plain words for its buyers ("engineers", "design leaders", "coffee lovers") as interest and work ids. */
const TAG_WORDS = [
  [/engineer|developer|devs?\b|software|programmer|technical/, { work: ["engineering"] }], [/product manager|\bpms?\b|product/, { work: ["product"] }],
  [/design/, { work: ["design"] }], [/data|analyst|scientist/, { work: ["data"] }], [/founder|startup|ceo|entrepreneur/, { work: ["founder"] }],
  [/market/, { work: ["marketing"] }], [/sales|account exec|\baes?\b|revenue/, { work: ["sales"] }], [/\bhr\b|people team|recruit/, { work: ["people"] }],
  [/finance|cfo|accountant/, { work: ["finance"] }], [/ops|operations/, { work: ["ops"] }], [/creative|artist|writer/, { work: ["creative"] }], [/student/, { work: ["student"] }],
  [/leader|lead\b|leads\b|manager|exec|director|vp|head of/, { work: ["leader"] }],
  [/coffee|espresso/, { interests: ["coffee"] }], [/matcha|tea/, { interests: ["matcha"] }], [/wine|sommelier/, { interests: ["wine"] }], [/food|foodie|cook|chef|eat/, { interests: ["supper", "baking"] }],
  [/run|runner|fitness|athlet/, { interests: ["run", "movement"] }], [/hike|outdoor/, { interests: ["hike"] }], [/book|reader|reading/, { interests: ["book"] }], [/game|gamer|board/, { interests: ["games"] }],
  [/craft|maker|pottery|ceramic/, { interests: ["pottery", "crafts", "workshop"] }], [/music|dance/, { interests: ["dance"] }], [/comedy|improv/, { interests: ["improv"] }], [/learn|curious|talk|ideas/, { interests: ["talks"] }],
  [/bak/, { interests: ["baking"] }],
];
export function parseAudience(tags = []) {
  const L = [...new Set((Array.isArray(tags) ? tags : String(tags || "").split(",")).map((t) => clean(t, 40)).filter(Boolean))].slice(0, 8), specs = [], known = [], unknown = [];
  for (const t of L) { const s = lc(t), work = new Set(), interests = new Set(); for (const [re, m] of TAG_WORDS) if (re.test(s)) { (m.work || []).forEach((x) => work.add(x)); (m.interests || []).forEach((x) => interests.add(x)); }
    if (work.size || interests.size) { known.push(t); specs.push({ tag: t, work: [...work], interests: [...interests] }); } else unknown.push(t); }
  return { tags: L, specs, work: [...new Set(specs.flatMap((x) => x.work))], interests: [...new Set(specs.flatMap((x) => x.interests))], known, unknown };
}
// A guest fits when they fit any one tag. Within a tag, "design leaders" needs both: design work and leading a team.
export function matchesAudience(g, A) {
  const W = new Set(g.work || []), I = new Set(g.interests || []);
  return (A.specs || []).some((t) => { const roles = t.work.filter((w) => w !== "leader"), lead = t.work.includes("leader");
    const workOk = !t.work.length ? null : lead && roles.length ? W.has("leader") && roles.some((w) => W.has(w)) : t.work.some((w) => W.has(w));
    const intOk = !t.interests.length ? null : t.interests.some((x) => I.has(x));
    return workOk === true || intOk === true; });
}

// ---------------------------------------------------------------------------------------------------------------
// Pure: the numbers for one group of event facts.
function tally(F) {
  const people = new Set(), events = new Set(), pairs = new Map(); let againYes = 0, againOf = 0, kudos = 0, going = 0, cap = 0, priceN = 0; const prices = [];
  for (const f of F) { events.add(f.id); kudos += f.kudos || 0; againYes += (f.yes || []).length; againOf += (f.ans || []).length; if (f.capacity) { cap += f.capacity; going += Math.min(f.going || 0, f.capacity); } if (f.priceCents != null) { prices.push(f.priceCents); priceN++; }
    for (const g of f.people || []) { people.add(g); const k = f.hostWs + "|" + g; pairs.set(k, (pairs.get(k) || 0) + 1); } }
  const rep = [...pairs.values()].filter((n) => n >= 2).length;
  prices.sort((a, b) => a - b);
  return { events: events.size, people: people.size, againPct: againOf >= K.people ? pct(againYes, againOf) : null, againOf, repeatPct: pairs.size ? pct(rep, pairs.size) : null, fillPct: cap ? pct(going, cap) : null,
    kudosPerEvent: events.size ? Math.round((kudos / events.size) * 10) / 10 : null, medianPriceCents: priceN ? prices[Math.floor((priceN - 1) / 2)] : null };
}
/** Does a cell have enough people and events behind it to show? */
export const visible = (t) => (t?.people || 0) >= K.people && (t?.events || 0) >= K.events;
/** People as a band, never exact: 10+, 20+, ... 100+, 250+. */
export const band = (n) => (n >= 250 ? "250+" : n >= 100 ? `${Math.floor(n / 50) * 50}+` : n >= K.people ? `${Math.floor(n / 10) * 10}+` : "");
const shown = (t) => ({ events: t.events, peopleBand: band(t.people), againPct: t.againPct, repeatPct: t.repeatPct, fillPct: t.fillPct, kudosPerEvent: t.kudosPerEvent, medianPriceCents: t.medianPriceCents });

/** One breakdown: facts grouped by `by`, each cell shown or hidden by the thresholds, with secondary suppression. */
export function breakdown(facts, by, { labels = null } = {}) {
  const groups = new Map();
  for (const f of facts) { const v = f[by]; if (v == null || v === "") continue; if (!groups.has(v)) groups.set(v, []); groups.get(v).push(f); }
  const order = labels || (CUTS[by]?.values?.length ? CUTS[by].values : [...groups.keys()].sort().map((v) => [v, titleCase(v)]));
  const rows = order.filter(([v]) => groups.has(v)).map(([v, label]) => { const t = tally(groups.get(v)); return { value: v, label, t, hidden: !visible(t) }; });
  // secondary suppression: one hidden cell next to a shown total could be worked out by subtraction
  const hid = rows.filter((r) => r.hidden);
  if (hid.length === 1 && rows.length > 1) { const next = rows.filter((r) => !r.hidden).sort((a, b) => a.t.people - b.t.people || a.t.events - b.t.events)[0]; if (next) { next.hidden = true; next.secondary = true; } }
  return rows.map((r) => (r.hidden ? { value: r.value, label: r.label, hidden: true, why: r.secondary ? "Hidden so the one next to it stays private" : "Not enough yet" } : { value: r.value, label: r.label, ...shown(r.t) }));
}
/** A score that ranks kinds in a trend list: would go again first, then repeat, fill and kudos. */
const trendScore = (r) => (r.againPct ?? 0) * 0.45 + (r.repeatPct ?? 0) * 0.25 + (r.fillPct ?? 0) * 0.2 + Math.min(10, r.kudosPerEvent ?? 0) * 1;

/** Trends: the kinds, best first, under a filter; and the chosen cut (city, size, days, time, price, season) for each. */
export function trends(facts, { city = "", cut = "", kind = "" } = {}) {
  const ck = cityKey(city), F = facts.filter((f) => (!ck || f.cityKey === ck || lc(f.hood) === ck) && (!kind || f.kind === kind));
  const overall = tally(F), kinds = breakdown(F, "kind").sort((a, b) => (a.hidden - b.hidden) || trendScore(b) - trendScore(a));
  const cityLabels = [...new Map(facts.map((f) => [f.cityKey, f.city])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const by = CUTS[cut] && cut !== "kind" ? cut : "";
  const cutRows = by ? breakdown(F, by, by === "city" ? { labels: cityLabels } : by === "hood" ? { labels: [...new Set(F.map((f) => f.hood).filter(Boolean))].sort().map((h) => [h, h]) } : {}) : [];
  return { overall: visible(overall) ? { shown: true, ...shown(overall) } : { shown: false, why: "Not enough yet" }, kinds, cut: by ? { by, label: CUTS[by].label, rows: cutRows } : null,
    cities: cityLabels.map(([k, c]) => ({ key: k, label: c })), thresholds: K };
}

// ---------------------------------------------------------------------------------------------------------------
// Fit: how well each kind of experience (and each host) fits the buyers a brand describes.
export function fit(facts, { tags = [], city = "", budgetCents = 0, guests = new Map(), teams = { kinds: {}, hosts: {} }, hosts = [] } = {}) {
  const A = parseAudience(tags), ck = cityKey(city), F = facts.filter((f) => !ck || f.cityKey === ck || lc(f.hood) === ck), all = F.length ? F : facts;
  const inAud = (g) => matchesAudience(guests.get(g) || {}, A);
  const audF = (L) => L.map((f) => ({ ...f, people: (f.people || []).filter(inAud), yes: (f.yes || []).filter(inAud), ans: (f.ans || []).filter(inAud), kudos: (f.ans || []).filter(inAud).length }));
  const att = (L) => L.reduce((a, f) => a + (f.people || []).length, 0);
  const totalAll = att(all), A_all = audF(all), totalAud = att(A_all), audPeople = new Set(A_all.flatMap((f) => f.people)).size;
  const kinds = [];
  for (const k of KINDS) {
    const KF = all.filter((f) => f.kind === k.id); if (!KF.length) continue;
    const t = tally(KF); if (!visible(t)) { kinds.push({ kind: k.id, label: k.label, hidden: true, why: "Not enough yet" }); continue; }
    const AK = audF(KF), ta = tally(AK), audOk = visible(ta);
    const lift = audOk && totalAud && totalAll ? (att(AK) / totalAud) / (att(KF) / totalAll) : null;
    const again = audOk && ta.againPct != null ? ta.againPct : t.againPct;
    const team = teams.kinds[k.id]; const teamOk = team && team.n >= K.events;
    const under = budgetCents ? KF.filter((f) => f.priceCents != null && f.priceCents <= budgetCents).length / Math.max(1, KF.filter((f) => f.priceCents != null).length) : null;
    const a = lift == null ? 0.35 : Math.max(0, Math.min(1, lift / 2));
    const score = Math.round(100 * (0.35 * a + 0.3 * ((again ?? 60) / 100) + 0.15 * (teamOk ? team.avg / 5 : 0.6) + 0.2 * (under == null ? 0.6 : under)));
    const why = [];
    if (lift != null && A.tags.length) why.push(lift >= 1.15 ? `${audLabel(A)} go to ${lc(k.label)} ${lift.toFixed(1)}x as often as everyone else` : lift <= 0.85 ? `${audLabel(A)} go a little less often than everyone else` : `${audLabel(A)} go about as often as everyone else`);
    else if (A.tags.length) why.push(`Not enough on ${lc(audLabel(A))} yet, so this uses everyone`);
    if (again != null) why.push(audOk && ta.againPct != null && A.tags.length ? `${again}% of them would go again` : `${again}% would go again`);
    if (t.repeatPct != null && t.repeatPct >= 20) why.push(`${t.repeatPct}% came back to the same host`);
    if (teamOk) why.push(`Teams rated them ${team.avg.toFixed(1)} out of 5`);
    if (under != null && under < 0.6) why.push(under > 0 ? `Some fit ${moneyRound(budgetCents)} a person` : `Most cost more than ${moneyRound(budgetCents)} a person`);
    kinds.push({ kind: k.id, label: k.label, score, liftX: lift == null ? null : Math.round(lift * 10) / 10, againPct: again, repeatPct: t.repeatPct, fillPct: t.fillPct, medianPriceCents: t.medianPriceCents, events: t.events, peopleBand: band(t.people), audience: audOk ? { peopleBand: band(ta.people) } : null, why });
  }
  kinds.sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0) || (b.score || 0) - (a.score || 0));
  const kScore = Object.fromEntries(kinds.filter((k) => !k.hidden).map((k) => [k.kind, k.score]));
  // hosts: the host's main kind's fit, their own numbers (under the same thresholds), Trusted, team rating and price
  const H = [];
  for (const h of hosts) {
    if (ck && cityKey(h.city) !== ck && lc(h.area) !== ck) continue;
    const HF = facts.filter((f) => f.hostWs === h.ws), t = tally(HF), ok = visible(t), kind = h.kind || topKind(HF);
    const base = kScore[kind] ?? 50, perPerson = h.perPersonCents || null;
    const budgetOk = !budgetCents || !perPerson ? null : perPerson <= budgetCents;
    let s = base * 0.55 + (ok && t.againPct != null ? t.againPct * 0.25 : 15) + (h.trusted ? 8 : 0) + (h.teamReviews >= 3 ? (h.teamRating / 5) * 7 : 3.5) + (budgetOk === false ? -12 : budgetOk ? 5 : 0);
    s = Math.max(0, Math.min(100, Math.round(s)));
    const why = [];
    if (kind && KIND[kind]) why.push(KIND[kind].label);
    if (ok && t.againPct != null) why.push(`${t.againPct}% would go again`); else why.push("Newer here: fewer numbers to show");
    if (h.trusted) why.push("Trusted host");
    if (h.teamReviews >= 3) why.push(`${h.teamRating.toFixed(1)} from ${h.teamReviews} teams`);
    if (budgetOk === false) why.push(`Over ${moneyRound(budgetCents)} a person`);
    H.push({ handle: h.handle, name: h.name, area: h.area || h.city || "", city: h.city || "", pkg: h.pkg || "", pkgName: h.pkgName || "", perPersonCents: perPerson, trusted: !!h.trusted, kind, kindLabel: KIND[kind]?.label || "", score: s,
      stats: ok ? { events: t.events, peopleBand: band(t.people), againPct: t.againPct, repeatPct: t.repeatPct } : null, why });
  }
  H.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { audience: { tags: A.tags, known: A.known, unknown: A.unknown, enough: audPeople >= K.people, peopleBand: band(audPeople) }, city: city || "", budgetCents, kinds, hosts: H.slice(0, 12), thresholds: K };
}
const audLabel = (A) => { const t = A.tags.length ? A.tags.slice(0, 2).map(lc).join(" and ") : "people"; return t.charAt(0).toUpperCase() + t.slice(1); };
const moneyRound = (c) => "$" + Math.round((+c || 0) / 100).toLocaleString("en-US");
const topKind = (F) => { const n = {}; for (const f of F) if (f.kind) n[f.kind] = (n[f.kind] || 0) + 1; return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };

// ---------------------------------------------------------------------------------------------------------------
// The optional summary: written from the aggregate numbers only. The prompt is built here so it can be tested.
export function summaryPrompt(F) {
  const top = (F.kinds || []).filter((k) => !k.hidden).slice(0, 4).map((k) => ({ kind: k.label, fit: k.score, timesAsOften: k.liftX, wouldGoAgainPct: k.againPct, repeatPct: k.repeatPct, fillPct: k.fillPct, medianPricePerPerson: k.medianPriceCents != null ? Math.round(k.medianPriceCents / 100) : null }));
  const facts = { audience: (F.audience?.tags || []).map((t) => clean(t, 40)), city: clean(F.city, 60), budgetPerPerson: F.budgetCents ? Math.round(F.budgetCents / 100) : null, kinds: top };
  return `You help a brand's field marketing team decide what in-person experiences to run. Below are aggregate numbers only (no people). Write 3 short sentences titled "What we'd try for you": the one or two kinds of experience to start with, why in plain numbers, and one practical tip (group size, day or price). Plain, warm, professional words. No em dashes. No names.\n\nNUMBERS: ${JSON.stringify(facts)}`;
}
export function rulesSummary(F) {
  const ks = (F.kinds || []).filter((k) => !k.hidden); if (!ks.length) return "There isn't enough activity yet to suggest a starting point here. Try a nearby city or fewer audience tags.";
  const [a, b] = ks, aud = F.audience?.tags?.length ? F.audience.tags.slice(0, 2).map(lc).join(" and ") : "your buyers", where = F.city ? ` in ${F.city}` : "";
  const s1 = `Start with ${lc(a.label)}${b ? `, then ${lc(b.label)}` : ""}${where}.`;
  const s2 = [a.liftX && a.liftX >= 1.15 ? `${aud.charAt(0).toUpperCase() + aud.slice(1)} go to ${lc(a.label)} ${a.liftX}x as often as everyone else` : "", a.againPct != null ? `${a.againPct}% of guests would go again` : ""].filter(Boolean).join(", and ");
  const s3 = a.medianPriceCents != null ? `Most run around ${moneyRound(a.medianPriceCents)} a person; a table of 12 to 20 keeps it personal.` : "A table of 12 to 20 keeps it personal.";
  return [s1, s2 ? s2 + "." : "", s3].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------------------------------------------
// Opt in: a guest's choice, stored by a hash of their email. Default: not included.
export const prefKey = (email) => "system/plinsight-" + hash(email);
export function prefsOf(store, email) { const d = store.get(prefKey(email))?.data; return { include: d?.include === true, work: cleanWork(d?.work), at: d?.at || null }; }
export function setPrefs(store, email, b = {}) { const cur = prefsOf(store, email), v = { kind: "plinsight", include: b.include != null ? b.include === true : cur.include, work: b.work != null ? cleanWork(b.work) : cur.work, at: Date.now() }; store.set(prefKey(email), v); return { include: v.include, work: v.work, at: v.at }; }

/** Every past event as an aggregate-ready fact. Only opted-in guests are in `people`; their attributes go in `guests`, keyed by a salted hash. */
export function collectFacts({ store, X, C, now = Date.now(), salt = "" }) {
  const I = X.index(), today = isoDay(now), byEvent = new Map();
  for (const [em, L] of I.att) for (const a of L) { if (!byEvent.has(a.eventId)) byEvent.set(a.eventId, new Set()); byEvent.get(a.eventId).add(em); }
  const kudosBy = new Map(); for (const k of I.kudos) { if (!k.eventId) continue; if (!kudosBy.has(k.eventId)) kudosBy.set(k.eventId, []); kudosBy.get(k.eventId).push(k); }
  const pref = new Map(), P = (em) => { if (!pref.has(em)) pref.set(em, prefsOf(store, em)); return pref.get(em); };
  const gk = (em) => crypto.createHash("sha256").update(salt + "|" + em).digest("hex").slice(0, 16), guests = new Map(), facts = [], hostOk = new Map();
  for (const x of I.events.values()) {
    const e = x.e; if (!e || e.example || e.sample || e.stage === "interest" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date > today) continue;
    if (!hostOk.has(x.ws)) { const W = getWorkspace(x.ws), h = C.profileOf(x.ws); hostOk.set(x.ws, !!(h?.handle && W?.plan === "friends" && h.directory !== false && !/@demo\.encore$/i.test(W?.ownerEmail || ""))); }
    if (!hostOk.get(x.ws)) continue;
    const came = [...(byEvent.get(x.id) || [])], inn = came.filter((em) => P(em).include);
    const K0 = (kudosBy.get(x.id) || []).filter((k) => inn.includes(lc(k.email)));
    const ans = [...new Set(K0.filter((k) => (k.tags || []).length || k.love || k.compare).map((k) => gk(lc(k.email))))], yes = [...new Set(K0.filter((k) => (k.tags || []).includes("again") || k.compare === "better").map((k) => gk(lc(k.email))))];
    for (const em of inn) { const key = gk(em); if (guests.has(key)) continue; let interests = []; try { interests = (store.get("system/plint-" + hash(em))?.data?.interests || []).slice(0, 20); } catch {}
      let archetype = ""; try { archetype = X.eventProfile?.(em)?.top?.name || ""; } catch {} guests.set(key, { interests, work: P(em).work, archetype }); }
    const city = clean(String(e.city || C.profileOf(x.ws)?.city || "").split(",")[0], 60), pc = priceCentsOf(e);
    facts.push({ id: x.id, hostWs: x.ws, kind: kindOf(e), city, cityKey: cityKey(city), hood: clean(e.hood, 60), date: e.date, days: daysOf(e.date), time: timeOf(e.startTime), size: sizeOf(+e.headcount || came.length), price: priceBand(pc), priceCents: pc,
      season: seasonOf(e.date), capacity: +e.headcount || 0, going: came.length, people: inn.map(gk), yes, ans, kudos: K0.length });
  }
  return { facts, guests };
}

// ---------------------------------------------------------------------------------------------------------------
export function mountInsights(app, { store, small, currentUser, C, X, PUBLIC_DIR = "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  const brandOf = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const W = getWorkspace(u.ws); if (!W || W.plan === "friends") { bad(res, "Insights are for brand teams.", 403, "not_brand"); return null; } return { u, W }; };
  const TTL = () => (process.env.ENCORE_INSIGHTS_CACHE_MS != null ? Math.max(0, +process.env.ENCORE_INSIGHTS_CACHE_MS || 0) : 60_000);
  const salt = crypto.randomBytes(8).toString("hex"); // keys change with each start: nothing joins across runs
  let cache = null;
  const data = () => { if (!cache || Date.now() - cache.at > TTL()) { try { X.bust?.(); } catch {} cache = { at: Date.now(), ...collectFacts({ store, X, C, salt }), ...teamData() }; } return cache; };
  X.insightsReset = () => { cache = null; };
  // team booking outcomes: by kind (from the package) and by host, from brand reviews already made public
  function teamData() {
    const kinds = {}, hostsT = {}, hostList = [];
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const W = getWorkspace(ws); if (W?.plan !== "friends") continue; const h = C.profileOf(ws); if (!h?.handle || h.directory === false) continue;
      const s = scopeStore(store, ws).get("teambook/setup")?.data; let st = {}; try { st = X.teamStatsOf ? X.teamStatsOf(ws) : {}; } catch {}
      const pk = (s?.on ? s.packages || [] : []).filter((p) => p.on !== false && !p.remote)[0];
      hostList.push({ ws, handle: h.handle, name: h.name || h.handle, city: s?.city || h.city || "", area: s?.area || h.hood || "", pkg: pk?.id || "", pkgName: pk?.name || "", perPersonCents: pk?.perPersonCents || null, kind: pk ? kindOf({ name: pk.name, tags: [pk.story || ""] }) : null, trusted: !!st.trusted, teamRating: st.rating || 0, teamReviews: st.reviews || 0 }); }
    for (const d of store.listPrefix("system", "bbreq-")) { const r = d.data; if (r?.kind !== "bbreq" || !r.reviews?.brand?.rating) continue; const k = kindOf({ name: r.pkgName }); if (!k) continue; (kinds[k] ||= { n: 0, sum: 0 }); kinds[k].n++; kinds[k].sum += r.reviews.brand.rating; }
    for (const k of Object.keys(kinds)) kinds[k].avg = kinds[k].sum / kinds[k].n;
    return { teams: { kinds, hosts: hostsT }, hostList };
  }
  const audienceDoc = (ws) => scopeStore(store, ws).get("insights/audience")?.data || null;
  const fitFor = (q, ws) => { const D = data(), saved = audienceDoc(ws) || {};
    const tags = q.tags != null ? q.tags : saved.tags || [], city = q.city != null ? clean(q.city, 60) : saved.city || "", budgetCents = q.budget != null ? Math.max(0, Math.min(1e6, Math.round(+String(q.budget).replace(/[^\d.]/g, "") * 100) || 0)) : saved.budgetCents || 0;
    return fit(D.facts, { tags, city, budgetCents, guests: D.guests, teams: D.teams, hosts: D.hostList }); };

  app.get("/teams/insights", page("teams-insights.html"));
  app.get("/teams/insights/how", page("teams-insights-how.html"));
  app.get("/api/insights/meta", (req, res) => res.json({ kinds: KINDS.map(({ id, label }) => ({ id, label })), cuts: Object.fromEntries(Object.entries(CUTS).map(([k, v]) => [k, { label: v.label, values: v.values }])), work: WORK, thresholds: K,
    suggestions: ["Engineers", "Founders", "Design leaders", "Product managers", "Marketing leaders", "Coffee lovers", "Runners", "Foodies", "Book lovers"] }));
  app.get("/api/insights/trends", (req, res) => { const B = brandOf(req, res); if (!B) return; const q = req.query || {};
    const T = trends(data().facts, { city: clean(q.city, 60), cut: clean(q.cut, 20), kind: KIND[q.kind] ? q.kind : "" });
    res.set("Cache-Control", "private, no-store").json(T); });
  app.get("/api/insights/audience", (req, res) => { const B = brandOf(req, res); if (!B) return; const d = audienceDoc(B.u.ws); let suggested = [];
    try { const P = B.W.brand?.profile || {}; suggested = [...(P.audience?.segments || []), ...(P.audience?.interests || [])].map((s) => clean(s, 40)).filter(Boolean).slice(0, 6); } catch {}
    res.json({ audience: d || { tags: [], city: B.W.city || "", budgetCents: 0 }, suggested }); });
  app.post("/api/insights/audience", small, (req, res) => { const B = brandOf(req, res); if (!B) return; const b = req.body || {};
    const v = { tags: parseAudience(b.tags).tags, city: clean(b.city, 60), budgetCents: Math.max(0, Math.min(1e6, Math.round(+String(b.budget ?? 0).replace(/[^\d.]/g, "") * 100) || 0)), by: lc(B.u.email), at: Date.now() };
    scopeStore(store, B.u.ws).set("insights/audience", v); res.json({ audience: v }); });
  app.post("/api/insights/fit", small, (req, res) => { const B = brandOf(req, res); if (!B) return; res.set("Cache-Control", "private, no-store").json(fitFor(req.body || {}, B.u.ws)); });
  app.get("/api/insights/fit", (req, res) => { const B = brandOf(req, res); if (!B) return; const q = req.query || {}; res.set("Cache-Control", "private, no-store").json(fitFor({ ...(q.tags != null ? { tags: String(q.tags).split(",") } : {}), ...(q.city != null ? { city: q.city } : {}), ...(q.budget != null ? { budget: q.budget } : {}) }, B.u.ws)); });
  app.post("/api/insights/summary", small, async (req, res) => { const B = brandOf(req, res); if (!B) return; const F = fitFor(req.body || {}, B.u.ws), prompt = summaryPrompt(F);
    let text = rulesSummary(F), source = "rules";
    if (!isFake() && (F.kinds || []).some((k) => !k.hidden)) { try { const r = await complete({ prompt, effort: "low" }); const t = String(r.text || "").replace(/\u2014/g, ",").trim(); if (t.length > 40) { text = t.slice(0, 900); source = "ai"; } } catch {} }
    X.lastInsightsPrompt = prompt; // for tests: the exact words that would go to the model
    res.json({ title: "What we'd try for you", text, source, note: "Written from the totals on this page, never from anyone's details." }); });
  // a guest's own choice
  app.get("/api/me/insights", (req, res) => { const u = currentUser(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); res.json({ ...prefsOf(store, u.email), work: prefsOf(store, u.email).work, options: WORK, defaultOff: true }); });
  app.post("/api/me/insights", small, (req, res) => { const u = currentUser(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); const v = setPrefs(store, u.email, req.body || {}); cache = null; res.json(v); });
  return { data, fitFor };
}
