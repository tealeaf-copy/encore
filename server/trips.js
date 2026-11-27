// Trips: a group trip from the first "would you be up for it?" to the last night's dinner (public/trip.js on the plan
// page /plans/<id>, public/tripfeel.js on the light invite /e/<id>). It sits on top of a weekend away (server/kinds.js:
// the lodging, beds, cars and shared costs ledger) and the itinerary (server/plans.js).
//
// - The feeler: the organiser says it in a line ("Vegas for Priya's 30th, sometime in March or April"). Potto reads the
//   place and the months (parseTripLine) and makes a draft trip in feeler stage (stage "interest", planKind "weekend",
//   activity "Trip"), with the weekends in those months to offer, budget bands per person and things to do there.
//   ev.trip holds only what friends see on the feeler: { destination, weekends: [{ from, to }], budgets, interests,
//   note }. Friends answer from the link with no account: I'm in, maybe or can't, the weekends that work, a budget band,
//   what they'd want to do and a note. A signed-in friend's answer is tied to their account. The answer is a reply
//   (rsvps, interest "in" | "maybe" | "no", dates = the weekends' Fridays, trip: { budget, wants, note }) with a code,
//   kept on their phone like any reply.
// - The organiser's summary: who's keen, the best weekend, the budget range, what people want to do. Only the organiser
//   sees names next to budgets and notes; a friend sees their own answer.
// - Make it the trip: one tap locks the weekend (date, endDate), turns the feeler into the trip and tells everyone who
//   said yes or maybe (the same "it's on" as any interest check, server/social.js itsOn): people who were in for that
//   weekend are in without a second tap. Their budgets and interests carry over to Potto's picks.
// - Where to stay: Potto drafts options by shape (rooms, suites, a big house) for the group size, the nights and the
//   budget, with rooms or beds needed and a per-person total. Every number is an estimate to check, never a fact:
//   we have no booking API. Each option has search links on big booking sites, prefilled with the city, the dates and
//   the head count only. The organiser books there and pastes the confirmation back (recordBooking): the address,
//   check-in and check-out, the total, which becomes a shared cost split among the people in.
// - Group deals: the same options ranked by estimated per-person total for the head count as it is now (it re-ranks when
//   people join or drop), the feeler's weekends ranked by likely price, and deal levers with the how (nights that cost
//   less, a hotel group-block request with an email draft, resort fees and taxes, splitting a big rental, refundable).
// - Things to do: Potto's ideas for the place that fit what people said, with group-rate tips and estimates; anyone in
//   adds their own; everyone in votes; the organiser puts one on a day and a time and it lands on the itinerary.
// - Arrivals: each person in adds when they land and leave (and a flight or "driving"), so the plan shows who lands when.
// - Paying back: "I paid" lines on the shared costs (server/kinds.js ledger), the organiser's Get paid buttons
//   (server/paymethods.js). No money moves in the app.
// Records: ev.trip (the feeler), trip/<eventId> (stays, votes, booking, ideas, arrivals, payments; shared with kinds).
import crypto from "node:crypto";
import { scopeStore, claimEvent, getWorkspace, DEFAULT_WS } from "./workspaces.js";
import { peopleIn, money, centsOf, timeOf, cleanLodging, clock } from "./kinds.js";
import { cleanItinerary, addDays, lastDay } from "./plans.js";
import { payOfWs, eventMethods, deepLink, PAY_LABEL } from "./paymethods.js";
import { latestReplies } from "./tables.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const newId = () => crypto.randomBytes(5).toString("hex");
const dayMs = 864e5;
const dayNo = (d) => Math.round(Date.parse(d + "T12:00:00Z") / dayMs);
const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
const short = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const httpsOf = (u) => { u = String(u ?? "").trim(); if (!u) return ""; if (/^http:\/\//i.test(u)) u = "https://" + u.slice(7); if (!/^https:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) u = "https://" + u; return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u.slice(0, 500) : ""; };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const cash = (cents) => { const c = Math.round(+cents || 0); return c % 100 ? "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "$" + (c / 100).toLocaleString("en-US"); }; // real amounts the organiser entered
const usd = (cents) => "$" + Math.round((+cents || 0) / 100).toLocaleString("en-US"); // whole dollars with commas, for estimates
const r5 = (c) => Math.round(c / 500) * 500; // estimates in $5 steps, so they never read as exact quotes

// ================= places =================
// What Potto knows about a place. Las Vegas in full; the rest by name, time zone and a plain fallback. Nightly prices are
// rough ranges for a typical weekend night before fees and taxes, used only to compare shapes; every one shows as an
// estimate to check.
const VEGAS = {
  key: "vegas", city: "Las Vegas", full: "Las Vegas, NV", tz: "America/Los_Angeles", tax: 0.1338, feeWord: "resort fee",
  months: { 1: 0.9, 2: 0.95, 3: 1.1, 4: 1.05, 5: 1.05, 6: 0.95, 7: 0.85, 8: 0.85, 9: 1, 10: 1.05, 11: 1, 12: 0.95 },
  busy: { 3: "March is one of the busiest months in Vegas" },
  interests: ["Shows", "Pool day", "Birthday dinner", "Day trip", "Nightclub", "Casino", "Spa", "Brunch"],
  stays: [
    { key: "strip-rooms", name: "Rooms at a resort on the Strip", area: "The Strip", kind: "rooms", per: 2, perMax: 4, rate: [150, 300], fee: [40, 55], beds: "two queens each",
      why: "Walk to the shows, the pools and dinner. Everyone has their own bed and bathroom to share with one person.", watch: "Resort fees are charged per room per night on top of the rate." },
    { key: "strip-suites", name: "Suites at a resort on the Strip", area: "The Strip", kind: "suites", per: 4, perMax: 6, rate: [420, 800], fee: [45, 55], beds: "a king and a sofa bed, or two queens, each",
      why: "Room to get ready together and a living room for the birthday toast.", watch: "Check how many each suite sleeps in beds, not on the sofa." },
    { key: "offstrip-rooms", name: "Rooms off the Strip", area: "Off the Strip, 10 to 15 minutes by car", kind: "rooms", per: 2, perMax: 4, rate: [80, 160], fee: [25, 40], beds: "two queens each",
      why: "Often the lowest per person, with rideshares to the Strip at night.", watch: "Add rideshares: a few rides a day for the group adds up." },
    { key: "downtown-rooms", name: "Rooms downtown near Fremont Street", area: "Downtown", kind: "rooms", per: 2, perMax: 4, rate: [70, 150], fee: [25, 35], beds: "two queens each",
      why: "Cheaper rooms and a lively street at night, about 15 minutes from the Strip.", watch: "Older rooms in some places; read recent reviews." },
    { key: "house", name: "A big house with a pool", area: "Henderson or Summerlin, 20 to 30 minutes out", kind: "house", base: [250, 500], perGuest: [45, 85], clean: [250, 450], beds: "a bedroom for every two",
      why: "Everyone under one roof, a private pool and a kitchen for a slow birthday breakfast.", watch: "Check the listing allows your group size; most ban parties. You'll want a car or rideshares." },
  ],
  ideas: [
    { key: "show", title: "A big show on the Strip", tags: ["shows"], part: "evening", time: "19:30", hours: 2, pp: [80, 200], group: "Groups of 10 or more can often get a group rate from the box office. Ask before buying seats one by one.", q: "Las Vegas shows group tickets" },
    { key: "comedy", title: "A comedy or magic show", tags: ["shows"], part: "evening", time: "21:30", hours: 1.5, pp: [50, 120], group: "Late shows and Sunday to Thursday nights usually cost less.", q: "Las Vegas comedy magic show" },
    { key: "pool", title: "Pool day with a cabana", tags: ["pool"], part: "afternoon", time: "11:00", hours: 5, total: [400, 1500], group: "A cabana or daybed holds 6 to 10. Split the minimum spend; weekday cabanas cost less.", note: "Most pools run from about March to October. Check it's open on your dates.", q: "Las Vegas pool cabana" },
    { key: "dinner", title: "Birthday dinner with a set menu", tags: ["dinner", "food"], part: "evening", time: "19:30", hours: 2.5, pp: [75, 160], group: "For 8 or more ask for a private room or a set menu. Many add a service charge of about 20% for big tables.", q: "Las Vegas private dining room group birthday dinner" },
    { key: "redrock", title: "Red Rock Canyon drive and short hike", tags: ["daytrip", "outdoors"], part: "morning", time: "08:30", hours: 4, pp: [15, 45], group: "Entry is per car, so pile in. The scenic drive needs a timed-entry booking in the busy months.", q: "Red Rock Canyon timed entry" },
    { key: "hoover", title: "Hoover Dam day trip", tags: ["daytrip"], part: "morning", time: "09:00", hours: 5, pp: [30, 120], group: "For 6 or more a private van can cost less each than a tour bus or several rideshares. Compare.", q: "Hoover Dam tour from Las Vegas group" },
    { key: "club", title: "Nightclub with a table", tags: ["nightlife"], part: "evening", time: "22:30", hours: 3, total: [1000, 4000], group: "Tables come with a bottle minimum. Split it per person, and ask about a birthday package. Sunday to Thursday minimums run lower.", q: "Las Vegas nightclub table group birthday package" },
    { key: "fremont", title: "Fremont Street at night", tags: ["nightlife", "sights"], part: "evening", time: "20:00", hours: 2, pp: [0, 40], group: "Free to walk. The zipline is extra and sells out on weekends.", q: "Fremont Street Experience" },
    { key: "spa", title: "Spa morning", tags: ["spa"], part: "morning", time: "10:00", hours: 3, pp: [60, 250], group: "A day pass is often far less than a treatment. Ask about group bookings for 6 or more.", q: "Las Vegas spa day pass group" },
    { key: "brunch", title: "Long brunch", tags: ["brunch", "food"], part: "morning", time: "11:00", hours: 2, pp: [45, 95], group: "Book ahead for 8 or more; some places take big groups only at set times.", q: "Las Vegas brunch large group" },
    { key: "casino", title: "Casino night with a table-games lesson", tags: ["casino"], part: "evening", time: "18:00", hours: 2, pp: [0, 100], group: "Many casinos run free table-game lessons; low-minimum tables are easier earlier in the evening.", q: "Las Vegas free table games lessons" },
    { key: "valley", title: "Valley of Fire day trip", tags: ["daytrip", "outdoors"], part: "morning", time: "08:00", hours: 6, pp: [15, 50], group: "Entry is per car. It gets very hot; go early and bring water.", q: "Valley of Fire State Park" },
  ],
};
const GENERIC = {
  months: {}, busy: {}, tax: 0.12, feeWord: "fees",
  interests: ["Good food", "A night out", "Outdoors", "Chill time", "Sights", "A show"],
  stays: [
    { key: "hotel-rooms", name: "Hotel rooms in the centre", area: "The centre", kind: "rooms", per: 2, perMax: 4, rate: [140, 260], fee: [0, 25], beds: "two beds each", why: "Close to everything, everyone with a bed.", watch: "Check fees and parking on the final price page." },
    { key: "hotel-suites", name: "Suites in the centre", area: "The centre", kind: "suites", per: 4, perMax: 6, rate: [300, 600], fee: [0, 30], beds: "a bedroom and a sofa bed, each", why: "Space to hang out between plans.", watch: "Check how many each suite sleeps in beds." },
    { key: "house", name: "A big rental house", area: "A neighbourhood a short ride out", kind: "house", base: [220, 450], perGuest: [40, 80], clean: [150, 350], beds: "a bedroom for every two", why: "Everyone under one roof with a kitchen.", watch: "Check the house rules for group size." },
  ],
  ideas: [
    { key: "dinner", title: "A group dinner", tags: ["food", "dinner"], part: "evening", time: "19:30", hours: 2.5, pp: [40, 100], group: "For 8 or more ask for a set menu or a private room." },
    { key: "walk", title: "A walking tour", tags: ["sights"], part: "morning", time: "10:00", hours: 2, pp: [0, 40], group: "Many towns have free or pay-what-you-like walking tours." },
    { key: "daytrip", title: "A day trip nearby", tags: ["outdoors", "daytrip"], part: "morning", time: "09:00", hours: 6, pp: [20, 80], group: "Renting one big car can cost less each than separate rides." },
    { key: "night", title: "A night out", tags: ["nightlife"], part: "evening", time: "21:30", hours: 3, pp: [30, 90], group: "Ask bars about a reserved area for groups." },
    { key: "show", title: "A local show", tags: ["shows"], part: "evening", time: "20:00", hours: 2, pp: [30, 120], group: "Ask the box office about group rates for 10 or more." },
    { key: "slow", title: "A slow morning and a long brunch", tags: ["chill", "food", "brunch"], part: "morning", time: "10:30", hours: 2, pp: [25, 60], group: "Book ahead for a big table." },
  ],
};
const OTHER_PLACES = [["Nashville", "America/Chicago"], ["New Orleans", "America/Chicago", "nola"], ["Miami", "America/New_York"], ["Austin", "America/Chicago"], ["Palm Springs", "America/Los_Angeles"], ["Scottsdale", "America/Phoenix"],
  ["San Diego", "America/Los_Angeles"], ["Chicago", "America/Chicago"], ["New York", "America/New_York", "nyc"], ["Los Angeles", "America/Los_Angeles"], ["Denver", "America/Denver"], ["Seattle", "America/Los_Angeles"], ["Portland", "America/Los_Angeles"],
  ["Charleston", "America/New_York"], ["Savannah", "America/New_York"], ["Lake Tahoe", "America/Los_Angeles", "tahoe"], ["Cabo", "America/Mazatlan"], ["Tulum", "America/Cancun"], ["Cancun", "America/Cancun"], ["Mexico City", "America/Mexico_City", "cdmx"]];
/** What Potto knows about a destination: Las Vegas in full, a known city by name, else the plain fallback. Pure. */
export function placeOf(dest) {
  const s = lc(dest); if (/\b(las vegas|vegas|henderson)\b/.test(s)) return VEGAS;
  const o = OTHER_PLACES.find(([n, , alt]) => s.includes(lc(n)) || (alt && new RegExp(`\\b${alt}\\b`).test(s)));
  const city = o ? o[0] : clean(dest, 60); return { ...GENERIC, key: o ? lc(o[0]).replace(/\s+/g, "-") : "", city, full: city, tz: o ? o[1] : "" };
}

// ================= reading the line =================
/** Fri to Sun weekends in these months (1 to 12), the next time each month comes round, at least a week out. Pure. */
export function weekendsIn(months, today) {
  const out = [], t = ISO.test(today || "") ? today : new Date().toISOString().slice(0, 10), [ty, tm] = t.split("-").map(Number);
  const fris = (y, m) => { const L = []; for (let d = 1; d <= 31; d++) { const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; if (new Date(iso + "T12:00:00Z").getUTCMonth() + 1 !== m) break; if (wd(iso) === 5 && dayNo(iso) - dayNo(t) >= 7) L.push({ from: iso, to: addDays(iso, 2) }); } return L; };
  for (const m of [...new Set(months)].filter((x) => x >= 1 && x <= 12)) { const y = m < tm ? ty + 1 : ty, L = fris(y, m); out.push(...(L.length ? L : fris(y + 1, m))); }
  return out.sort((a, b) => a.from.localeCompare(b.from)).slice(0, 10);
}
const TRIP_WORDS = /\b(trip|weekend away|getaway|girls'? weekend|guys'? weekend|bach(elor|elorette)?( party| weekend)?|vacation|road ?trip)\b/i;
/**
 * "Vegas for Priya's 30th, sometime in March or April" into { trip, destination, title, months, weekends }. A trip when it
 * names a trip, or a known destination with months or a loose time and no clock time. Pure.
 */
export function parseTripLine(text, today = "") {
  const s = clean(text, 300), low = lc(s); if (!s) return { trip: false };
  const P = /\b(las vegas|vegas)\b/.test(low) ? VEGAS : null, other = P ? null : OTHER_PLACES.find(([n, , alt]) => new RegExp(`\\b${lc(n)}\\b`).test(low) || (alt && new RegExp(`\\b${alt}\\b`).test(low)));
  const months = MONTHS.map((m, i) => (new RegExp(`\\b${m}\\b|\\b${m.slice(0, 3)}\\b(?!\\w)`).test(low) && !(m === "may" && !/\bin may\b|\bmay or\b|\bor may\b/.test(low)) ? i + 1 : 0)).filter(Boolean);
  const clockTime = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\bat \d{1,2}\b/.test(low), loose = /\bsometime\b|\bsome weekend\b|\ba weekend\b|\bweekend\b|\bnext (month|year|spring|summer|fall|autumn|winter)\b|\b(spring|summer|fall|autumn|winter)\b/.test(low);
  const dest = P ? P.city : other ? other[0] : "", trip = TRIP_WORDS.test(low) || (!!dest && !clockTime && (months.length > 0 || loose || /\b\d{1,2}(st|nd|rd|th)\b|birthday|bday/.test(low)));
  if (!trip) return { trip: false };
  let title = s.split(/,|\s+(?:sometime|some time|in (?:january|february|march|april|may|june|july|august|september|october|november|december)\b|next (?:month|year|spring|summer|fall|winter))/i)[0].trim().replace(/[.!?]+$/, "");
  if (title.length < 3) title = dest ? `${dest} trip` : "A trip away"; title = title[0].toUpperCase() + title.slice(1);
  return { trip: true, destination: dest, title: title.slice(0, 80), months, weekends: weekendsIn(months, today) };
}

// ================= the feeler =================
export const BUDGETS = ["Under $500", "$500 to $900", "$900 to $1,500", "$1,500 or more"];
const BUDGET_RANGE = [[0, 500], [500, 900], [900, 1500], [1500, null]];
/** What the organiser set for the feeler, cleaned: the place, 1 to 10 weekends, budget bands, interests and a note. Pure. */
export function cleanTrip(raw = {}, cur = {}) {
  const r = raw && typeof raw === "object" ? raw : {}, P = placeOf(r.destination ?? cur.destination ?? "");
  const weekends = []; for (const w of Array.isArray(r.weekends) ? r.weekends : cur.weekends || []) { const from = String(w?.from || w || ""), to = String(w?.to || ""); if (!ISO.test(from)) continue;
    const end = ISO.test(to) && to > from && dayNo(to) - dayNo(from) <= 6 ? to : addDays(from, 2); if (!weekends.some((x) => x.from === from)) weekends.push({ from, to: end }); }
  const list = (v, d, n, m) => { const L = (Array.isArray(v) ? v : d).map((x) => clean(x, m)).filter(Boolean); return [...new Set(L)].slice(0, n); };
  return { destination: clean(r.destination ?? cur.destination ?? "", 60), weekends: weekends.sort((a, b) => a.from.localeCompare(b.from)).slice(0, 10),
    budgets: list(r.budgets, cur.budgets || BUDGETS, 5, 30), interests: list(r.interests, cur.interests || P.interests, 10, 40), note: clean(r.note ?? cur.note ?? "", 300) };
}
const answerOf = (r) => ({ interest: ["in", "maybe", "no"].includes(r?.interest) ? r.interest : r?.response === "going" ? "in" : r?.response === "maybe" ? "maybe" : r?.response === "no" || r?.response === "declined" ? "no" : "",
  weekends: (r?.dates || []).filter((d) => ISO.test(d)), budget: Number.isInteger(r?.trip?.budget) ? r.trip.budget : -1, wants: Array.isArray(r?.trip?.wants) ? r.trip.wants : [], note: clean(r?.trip?.note, 300) });
/**
 * The organiser's summary of the answers: { answered, in, maybe, no, people, weekends: [{ from, to, yes, maybe, names }], best,
 * budget: { counts, line, cap }, wants: [{ label, count }] }. replies: [{ id, r }] (latest per person). Pure.
 */
export function feelerSummary(trip, replies) {
  const people = replies.map(({ id, r }) => ({ rid: id, name: first(r.name) || "Someone", signedIn: !!r.email, ...answerOf(r), at: r.changedAt || r.createdAt || 0 })).filter((p) => p.interest);
  const keen = people.filter((p) => p.interest !== "no");
  const weekends = (trip.weekends || []).map((w) => { const yes = keen.filter((p) => p.interest === "in" && p.weekends.includes(w.from)), mb = keen.filter((p) => p.interest === "maybe" && p.weekends.includes(w.from));
    return { from: w.from, to: w.to, yes: yes.length, maybe: mb.length, names: [...yes, ...mb].map((p) => p.name) }; });
  const best = weekends.slice().sort((a, b) => b.yes - a.yes || b.maybe - a.maybe || a.from.localeCompare(b.from))[0] || null;
  const counts = (trip.budgets || BUDGETS).map((label, i) => ({ label, count: keen.filter((p) => p.budget === i).length }));
  const said = keen.filter((p) => p.budget >= 0), low = said.length ? Math.min(...said.map((p) => p.budget)) : -1, high = said.length ? Math.max(...said.map((p) => p.budget)) : -1;
  const B = trip.budgets || BUDGETS, std = B.join() === BUDGETS.join(), num = (k, end) => { const [f, c] = BUDGET_RANGE[k]; return end ? (c ? usd(c * 100) : `${usd(f * 100)} or more`) : (f ? usd(f * 100) : "under $500"); };
  const line = !said.length ? "" : low === high ? `Everyone who said: ${B[low]} each.` : std ? `Answers run from ${num(low)} to ${num(high, true)} each. Plan for ${B[low][0].toLowerCase() + B[low].slice(1)} so it works for everyone.` : `Answers run from "${B[low]}" to "${B[high]}". Plan for "${B[low]}" so it works for everyone.`;
  const capBand = low >= 0 && B.join() === BUDGETS.join() ? BUDGET_RANGE[low] : null; // a cap only from the bands Potto knows the numbers of
  const wc = new Map(); for (const p of keen) for (const w of p.wants) wc.set(w, (wc.get(w) || 0) + 1);
  return { answered: people.length, in: people.filter((p) => p.interest === "in").length, maybe: people.filter((p) => p.interest === "maybe").length, no: people.filter((p) => p.interest === "no").length,
    people: people.sort((a, b) => ["in", "maybe", "no"].indexOf(a.interest) - ["in", "maybe", "no"].indexOf(b.interest) || a.at - b.at), weekends, best: best && (best.yes || best.maybe) ? best : null,
    budget: { counts, line, cap: capBand ? capBand[1] || null : null, floor: capBand ? capBand[0] : null }, wants: [...wc].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) };
}
/** "Fri, Mar 12 to Sun, Mar 14". Pure. */
export const weekendLine = (w) => w ? `${new Date(w.from + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} to ${new Date(w.to + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}` : "";

// ================= dates and prices =================
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`; }
const nthMon = (y, m, n) => { let c = 0; for (let d = 1; d <= 31; d++) { const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; if (new Date(iso + "T12:00:00Z").getUTCMonth() + 1 !== m) break; if (wd(iso) === 1 && ++c === n) return iso; } return ""; };
const lastMon = (y, m) => { let last = ""; for (let d = 1; d <= 31; d++) { const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; if (new Date(iso + "T12:00:00Z").getUTCMonth() + 1 !== m) break; if (wd(iso) === 1) last = iso; } return last; };
/** The holiday a weekend touches (Fri to Mon), if any: Easter, the long Monday weekends, July 4th, New Year. Pure. */
export function holidayOf(from, to) {
  const y = +from.slice(0, 4), H = [[easter(y), "Easter weekend"], [nthMon(y, 1, 3), "a long weekend (MLK Day)"], [nthMon(y, 2, 3), "Presidents' Day weekend"], [lastMon(y, 5), "Memorial Day weekend"], [`${y}-07-04`, "July 4th"], [nthMon(y, 9, 1), "Labor Day weekend"], [nthMon(y, 10, 2), "a long weekend in October"], [`${y}-12-31`, "New Year's Eve"]];
  const end = addDays(to || addDays(from, 2), 1); return H.find(([d]) => d && d >= addDays(from, -1) && d <= end)?.[1] || "";
}
/** How a weekend's prices likely compare: the month's usual level and a holiday bump. A rough guess, said as one. Pure. */
export function dateFactor(P, from, to) {
  const m = +String(from).slice(5, 7), hol = holidayOf(from, to), f = (P.months?.[m] || 1) * (hol ? 1.15 : 1);
  const why = [hol ? `${hol}, usually pricier` : "", P.busy?.[m] || ""].filter(Boolean).join("; ") || (f < 1 ? "A quieter month there" : "No holiday on it");
  return { f, why, holiday: hol };
}
/** The feeler's weekends from likely cheapest to dearest, with who's free. Pure. */
export function rankWeekends(P, weekends, summary = null) {
  return (weekends || []).map((w) => { const d = dateFactor(P, w.from, w.to), s = summary?.weekends?.find((x) => x.from === w.from); return { ...w, label: weekendLine(w), factor: Math.round(d.f * 100) / 100, why: d.why, free: s ? s.yes + s.maybe : null }; })
    .sort((a, b) => a.factor - b.factor || (b.free || 0) - (a.free || 0) || a.from.localeCompare(b.from));
}
/** Search links on big booking sites, prefilled with the place, the dates and the head count only (nothing about anyone). Pure. */
export function searchLinks(P, { from = "", to = "", people = 2, rooms = 1, kind = "rooms" } = {}) {
  const city = encodeURIComponent(P.full || P.city || ""), n = Math.max(1, Math.min(30, Math.round(+people || 1))), k = Math.max(1, Math.min(15, Math.round(+rooms || 1))), d = ISO.test(from) && ISO.test(to);
  const home = [{ label: "Search homes on airbnb.com", href: `https://www.airbnb.com/s/${city}/homes?${d ? `checkin=${from}&checkout=${to}&` : ""}adults=${n}` },
    { label: "Search homes on vrbo.com", href: `https://www.vrbo.com/search?destination=${city}${d ? `&startDate=${from}&endDate=${to}` : ""}&adults=${n}` }];
  const hotel = [{ label: "Search hotels on booking.com", href: `https://www.booking.com/searchresults.html?ss=${city}${d ? `&checkin=${from}&checkout=${to}` : ""}&group_adults=${n}&no_rooms=${k}` },
    { label: "Search hotels on google.com", href: `https://www.google.com/travel/hotels/${city}?q=${encodeURIComponent(`hotels in ${P.city || ""} for ${n} people`)}${d ? `&checkin=${from}&checkout=${to}` : ""}` }];
  return kind === "house" ? home : hotel;
}
/**
 * Potto's stay options for the group: each shape with the rooms or beds needed and an estimated total and per-person
 * cost for the nights (rate and fees per room per night, room tax, cleaning for a house, the date's likely level).
 * Sorted cheapest per person first. Every price is an estimate (est: true). Pure.
 */
export function stayOptions(P, { people = 4, from = "", to = "", cap = null } = {}) {
  const n = Math.max(1, Math.min(30, Math.round(+people || 1))), nights = ISO.test(from) && ISO.test(to) && to > from ? dayNo(to) - dayNo(from) : 2, D = ISO.test(from) ? dateFactor(P, from, to) : { f: 1, why: "" };
  const out = [];
  for (const s of P.stays || []) {
    let units, sleeps, low, high, roomsLine;
    if (s.kind === "house") { units = 1; sleeps = n; const bed = Math.ceil(n / 2); low = (s.base[0] + s.perGuest[0] * n) * nights * D.f; high = (s.base[1] + s.perGuest[1] * n) * nights * D.f; low = low * (1 + P.tax) + s.clean[0]; high = high * (1 + P.tax) + s.clean[1]; roomsLine = `One house, about ${bed} bedroom${bed === 1 ? "" : "s"} for ${n}`; if (n < 4) continue; }
    else { units = Math.ceil(n / s.per); sleeps = units * s.per; low = (s.rate[0] * D.f + s.fee[0]) * units * nights * (1 + P.tax); high = (s.rate[1] * D.f + s.fee[1]) * units * nights * (1 + P.tax); roomsLine = `${units} ${s.kind === "suites" ? (units === 1 ? "suite" : "suites") : units === 1 ? "room" : "rooms"}, ${s.beds}`;
      if (s.kind === "suites" && n < 3) continue; }
    const lowC = r5(low * 100), highC = r5(high * 100), perLow = r5(lowC / n), perHigh = r5(highC / n), mid = Math.round((perLow + perHigh) / 2);
    out.push({ key: s.key, name: s.name, area: s.area, kind: s.kind, units, sleeps, rooms: roomsLine, nights, people: n, est: true, total: { low: lowC, high: highC }, each: { low: perLow, high: perHigh }, mid,
      line: `About ${usd(perLow)} to ${usd(perHigh)} each for ${nights} night${nights === 1 ? "" : "s"}`, totalLine: `About ${usd(lowC)} to ${usd(highC)} for the group`,
      why: s.why, watch: s.watch, over: cap ? perLow > cap * 100 : false, links: searchLinks(P, { from, to, people: n, rooms: s.kind === "house" ? 1 : units, kind: s.kind }) });
  }
  return out.sort((a, b) => a.mid - b.mid);
}
/** A short email the organiser can send a hotel's group sales team, asking for a room block. Pure. */
export function blockEmail({ P, rooms, from, to, people, host = "" }) {
  const n = rooms || Math.ceil(people / 2), d = ISO.test(from) && ISO.test(to) ? `${weekendLine({ from, to })} (${dayNo(to) - dayNo(from)} nights)` : "[your dates]";
  return { subject: `Group rate request: ${n} rooms, ${d}`, body: `Hi,\n\nWe're a group of ${people} coming to ${P.city || "town"} for a birthday, ${d}. We'd like ${n} rooms with two beds each.\n\nCould you send your best group rate for those nights, with the resort fee, taxes and any deposit or cancellation terms included? We're comparing a few places this week.\n\nThanks,\n${host || "[your name]"}` };
}
/**
 * Group deals: the options ranked by estimated per-person total for the head count now, the feeler's weekends ranked
 * by likely price, and the levers that usually help, each with the how and "check the price". Pure.
 */
export function groupDeals(P, { people = 4, from = "", to = "", weekends = [], summary = null, cap = null, host = "" } = {}) {
  const options = stayOptions(P, { people, from, to, cap }), cheapest = options[0] || null, rooms = options.find((o) => o.kind === "rooms"), house = options.find((o) => o.kind === "house");
  const n = Math.max(1, Math.round(+people || 1)), tips = [];
  if (cheapest) tips.push({ key: "shape", title: `Cheapest shape for ${n}: ${cheapest.name}`, how: `${cheapest.rooms}. ${cheapest.line}, ${cheapest.totalLine.toLowerCase()}.`, check: "An estimate. Check the price on your dates." });
  tips.push({ key: "nights", title: "Move a night off Saturday", how: "Thursday to Saturday, or Sunday to Tuesday, often costs well below Friday and Saturday. Search the same place both ways and compare the total.", check: "Check the price both ways." });
  const ranked = rankWeekends(P, weekends, summary);
  if (ranked.length > 1) tips.push({ key: "weekend", title: `Likely cheapest of your weekends: ${ranked[0].label}`, how: `${ranked[0].why}. ${ranked.slice(1).filter((w) => w.factor > ranked[0].factor).slice(0, 2).map((w) => `${w.label}: ${w.why.toLowerCase()}`).join(". ")}`.replace(/\.\s*$/, "") + ".", check: "A rough guess from the season. Check the price for each weekend." });
  if (rooms) { const k = rooms.units, big = k >= 8; tips.push({ key: "block", title: big ? `Ask for a group block: you need ${k} rooms` : `A group block starts at about 8 to 10 rooms; you need ${k}`, how: big ? "Hotels usually offer a group rate from about 8 to 10 rooms a night. Email their group sales team with your dates and head count; here's a draft." : "Too small for most group desks, but a direct email can still get a better rate or the resort fee waived. Here's a draft.", check: "Ask for the total with fees and taxes.", email: blockEmail({ P, rooms: k, from, to, people: n, host }) }); }
  tips.push({ key: "fees", title: P.key === "vegas" ? "Compare the total, resort fees included" : "Compare the total, fees included", how: P.key === "vegas" ? `Resort fees run about $25 to $55 a room a night, and room tax is about ${Math.round(P.tax * 1000) / 10}%. Potto's estimates include both; compare the final checkout page, not the nightly rate.` : "Cleaning, service and booking fees can add a lot. Compare the final checkout page, not the nightly rate.", check: "Check the final price page." });
  if (house && n >= 6) tips.push({ key: "split", title: `Split a big house ${n} ways`, how: `${house.line}. A house can beat hotel rooms per person once you're 6 or more, and the pool and kitchen are yours.`, check: "An estimate. Check the listing's total with cleaning and fees." });
  tips.push({ key: "early", title: "Book early, and refundable", how: "Take a refundable rate as soon as the dates are locked, then check again a few weeks out and rebook if it drops.", check: "Read the cancellation terms before you book." });
  return { people: n, nights: options[0]?.nights || 2, options, weekends: ranked, tips, est: true, note: "Potto finds and compares; you book on the site. Every price here is an estimate. Check the price before you count on it." };
}
/** Potto's things to do for the place that fit what people said, best fits first, with group tips and estimates. Pure. */
export function activityIdeas(P, { wants = [], people = 4, interests = [] } = {}) {
  const n = Math.max(1, Math.round(+people || 1)), tagOf = (w) => { const s = lc(w); return /show/.test(s) ? "shows" : /pool/.test(s) ? "pool" : /dinner/.test(s) ? "dinner" : /day ?trip|red rock|hoover/.test(s) ? "daytrip" : /club|night ?out|night/.test(s) ? "nightlife" : /casino/.test(s) ? "casino" : /spa/.test(s) ? "spa" : /brunch/.test(s) ? "brunch" : /food/.test(s) ? "food" : /outdoor|hike/.test(s) ? "outdoors" : /chill|slow/.test(s) ? "chill" : /sight/.test(s) ? "sights" : s; };
  const score = new Map(); for (const w of wants) { const t = tagOf(w.label ?? w); score.set(t, (score.get(t) || 0) + (+w.count || 1)); }
  for (const w of interests) { const t = tagOf(w); if (!score.has(t)) score.set(t, 0); }
  return (P.ideas || []).map((x) => { const fits = Math.max(0, ...x.tags.map((t) => score.get(t) || 0)), pp = x.total ? [r5((x.total[0] * 100) / n), r5((x.total[1] * 100) / n)] : [x.pp[0] * 100, x.pp[1] * 100];
    return { key: x.key, title: x.title, part: x.part, time: x.time, hours: x.hours, tags: x.tags, fits, est: true, each: { low: pp[0], high: pp[1] }, line: pp[1] === 0 ? "Free" : `About ${pp[0] ? usd(pp[0]) + " to " : "up to "}${usd(pp[1])} each${x.total ? `, a ${usd(x.total[0] * 100)} to ${usd(x.total[1] * 100)} minimum split ${n} ways` : ""}`,
      group: x.group, note: x.note || "", link: x.q ? `https://www.google.com/search?q=${encodeURIComponent(x.q)}` : `https://www.google.com/search?q=${encodeURIComponent(`${x.title} ${P.city || ""}`)}` }; })
    .sort((a, b) => b.fits - a.fits);
}

// ================= arrivals and money =================
/** One person's arrival and departure: a day in the trip (or the day before or after), a time and a short note. Pure. */
export function cleanArrival(b = {}, ev = {}) {
  const from = ev.date, to = lastDay(ev), ok = (d) => ISO.test(d || "") && ISO.test(from || "") && d >= addDays(from, -2) && d <= addDays(to, 2);
  const a = { arriveDay: ok(b.arriveDay) ? b.arriveDay : "", arriveTime: timeOf(b.arriveTime) || "", arriveNote: clean(b.arriveNote, 60), departDay: ok(b.departDay) ? b.departDay : "", departTime: timeOf(b.departTime) || "", departNote: clean(b.departNote, 60) };
  if (b.arriveTime && timeOf(b.arriveTime) === null) return { error: "Use a time like 3:20pm for when you land." }; if (b.departTime && timeOf(b.departTime) === null) return { error: "Use a time like 11am for when you leave." };
  if (a.arriveDay && a.departDay && a.departDay < a.arriveDay) return { error: "You leave before you land. Check the days." };
  return { arrival: { ...a, at: Date.now() } };
}

// ================= Potto's answers about a trip =================
const T_ANY = /\b(trip|vegas|las vegas|getaway|weekend away|bach\w*)\b/i, T_STAY = /\b(stay|staying|hotels?|suites?|airbnb|vrbo|house|rental|lodging|accommodations?|rooms?|sleep)\b/i, T_DEAL = /\b(deals?|cheap|cheaper|cheapest|save|saving|discounts?|group rates?|block|budget)\b/i;
const T_TODO = /\b(things to do|activities|activity|what (should|can|could) we do|shows?|pool|club|nightclub|day trip|dinner|itinerary)\b/i, T_FEEL = /\b(feeler|keen|who'?s (in|coming)|answers?|which weekend|best weekend|interest)\b/i;
/**
 * Potto's answer to a trip question from the organiser (Ask Potto, server/potto.js): where to stay, group deals, things
 * to do, the feeler's answers, or how to start one. Built from the trip itself, with its own links; never a claim
 * that anything is booked. trips: [{ id, view }] the person hosts. Returns { answer, links } or null. Pure.
 */
export function tripAnswer(message, trips) {
  const m = String(message || ""); if (!T_ANY.test(m) && !(trips.length && (T_STAY.test(m) || T_DEAL.test(m) || T_FEEL.test(m)))) return null;
  if (!trips.length) return T_ANY.test(m) ? { answer: "Start it from New with one line, like \"Vegas for Priya's 30th, sometime in March or April\". I'll make a feeler friends can answer without an account: if they're up for it, which weekends work, a rough budget and what they'd want to do.", links: [{ label: "Start a trip", href: "/?app=1#studio" }] } : null;
  const low = m.toLowerCase(), t = trips.find((x) => low.includes(lc(x.view.destination).split(" ").pop()) || low.includes(lc(x.view.title).split(" ")[0])) || trips[0], V = t.view, href = `/plans/${encodeURIComponent(t.id)}`;
  const n = V.feeler ? V.deals?.people || 2 : V.group?.count || 2, D = V.deals, top = D?.options?.[0];
  if (V.feeler && (T_FEEL.test(m) || !(T_STAY.test(m) || T_DEAL.test(m) || T_TODO.test(m)))) { const S = V.summary || {};
    return { answer: S.answered ? `${S.in} keen, ${S.maybe} maybe and ${S.no} can't for ${V.title} so far.${S.best ? ` ${weekendLine(S.best)} works for the most people.` : ""}${S.budget?.line ? ` Budget: ${S.budget.line}` : ""} When you're happy, lock the weekend on the trip page and I'll tell everyone who said yes.` : `No answers yet for ${V.title}. Text the feeler link from the trip page; friends answer in a minute, no account needed.`, links: [{ label: "The trip page", href }] }; }
  if (T_DEAL.test(m) && top) return { answer: `For ${n} of you the cheapest shape is ${top.name.toLowerCase()}: ${top.line.replace(/^About/, "about")}, my estimate. Moving a night to Thursday or Sunday usually saves the most. Find group deals on the trip page has the rest, with an email you can send a hotel for a group rate. Check the real price before you count on it.`, links: [{ label: "Find group deals", href: href + "#stay" }] };
  if (T_STAY.test(m)) { const opts = (V.stays || []).slice(0, 3).map((s) => s.name.toLowerCase());
    return { answer: V.booking ? `You're booked at ${V.booking.name}${V.booking.checkIn ? `, check in ${V.booking.checkIn}` : ""}. The total is in the shared costs, split ${n} ways.` : `For ${n} of you I'd compare ${opts.length ? opts.join(", ") : top ? top.name.toLowerCase() : "a few shapes"}. The prices are my estimates; the search links fill in your dates and head count. You book on the site and paste the confirmation back, and I'll split the cost.`, links: [{ label: "Where to stay", href: href + "#stay" }] }; }
  if (T_TODO.test(m)) { const I = (V.ideas || []).slice(0, 3).map((x) => x.title.toLowerCase()), w = (V.wants || []).slice(0, 2).map((x) => x.label.toLowerCase());
    return { answer: `${w.length ? `People said ${w.join(" and ")}, so ` : ""}I'd start with ${I.length ? I.join(", ") : "a show, a pool day and a big dinner"}. Everyone going can vote and add their own; you put the winners on a day.`, links: [{ label: "Things to do", href: href + "#todo" }] }; }
  return { answer: V.feeler ? `${V.title} is still a feeler. The trip page has the answers and the lock button.` : `${V.title} is on for ${weekendLine({ from: V.dates.from, to: V.dates.to })}. ${V.group.count} going. The trip page has where you're staying, things to do and who lands when.`, links: [{ label: "The trip page", href }] };
}

// ================= the store and routes =================
export function mountTrips(app, { store, small, currentUser, C = {}, X = {}, P, K, publicOrigin = () => "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const hits = new Map(), limited = (req, n = 60) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 5).join("/"), now = Date.now(); if (hits.size > 20000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req) => { try { return currentUser(req); } catch { return null; } };
  const viewer = (req, id, b = {}) => { const u = me(req); return P.viewerOf(id, { rid: String(b.rid || req.query.rid || "").slice(0, 80), code: String(b.code || req.query.code || "").slice(0, 40), email: u?.email || "", ws: u?.ws && u.ws !== DEFAULT_WS ? u.ws : "" }); };
  const rec = (S, id) => K.tripRec(S, id);
  const save = (S, id, T) => S.set("trip/" + id, { ...T, eventId: id, at: Date.now() });
  const hostName = (ws, ev) => K.hostNameOf(ws, ev);
  const isTrip = (ev) => !!ev && (ev.trip || ev.planKind === "weekend");

  /** Everything this viewer may see of the trip. */
  function viewOf(id, V) {
    const { S, ev, isHost, ws } = V, trip = cleanTrip(ev.trip || {}, {}), Pl = placeOf(trip.destination || ev.city || ""), feeler = ev.stage === "interest";
    const pid = isHost ? "host" : V.r?.response === "going" ? V.rid : "", inn = !!pid, people = peopleIn(S, id, hostName(ws, ev)), nameOf = (p) => people.find((x) => x.pid === p)?.name || "";
    const T = rec(S, id), replies = latestReplies(S, id), out = { id, title: clean(ev.pubTitle || ev.name, 120), feeler, destination: trip.destination || Pl.city || "", host: first(hostName(ws, ev)) || "Your host", you: { pid, in: inn, host: isHost },
      honest: "Potto finds the options; you book on the site and paste the confirmation here.", feelerSetup: { weekends: trip.weekends, budgets: trip.budgets, interests: trip.interests, note: trip.note } };
    const summary = feelerSummary(trip, replies);
    if (isHost) { out.summary = summary; out.published = !!ev.published; out.link = `/e/${encodeURIComponent(id)}`; out.suggestWeekends = trip.weekends.length ? [] : weekendsIn([new Date().getMonth() + 2, new Date().getMonth() + 3].map((m) => ((m - 1) % 12) + 1), new Date().toISOString().slice(0, 10)); }
    else if (V.r) out.mine = { rid: V.rid, name: first(V.r.name), ...answerOf(V.r) };
    if (feeler) { if (isHost) { const w = summary.best || trip.weekends[0]; out.deals = groupDeals(Pl, { people: Math.max(2, summary.in + summary.maybe + 1), from: w?.from || "", to: w?.to || "", weekends: trip.weekends, summary, cap: summary.budget.cap, host: out.host }); } return out; }
    out.dates = { from: ev.date || "", to: lastDay(ev) || "" };
    out.group = { count: people.length, names: inn ? people.map((p) => (p.pid === pid ? "You" : p.name)) : [] };
    if (!inn) return out;
    const n = people.length, cap = summary.budget.cap, wantsAll = summary.wants;
    // where to stay: Potto's options and the group's own, with votes
    const votes = (map, key) => (map?.[key] || []).filter((p) => p === "host" || people.some((x) => x.pid === p));
    out.stays = (T.stays || []).map((s) => { const v = votes(T.stayVotes, s.id), fresh = s.potto ? stayOptions(Pl, { people: n, from: ev.date, to: lastDay(ev), cap }).find((o) => o.key === s.key) : null;
      return { id: s.id, name: s.name, area: s.area, kind: s.kind, rooms: fresh?.rooms || s.rooms || "", link: s.link || "", links: fresh?.links || [], potto: !!s.potto, est: !s.real, why: s.why || fresh?.why || "", watch: fresh?.watch || "",
        line: s.real ? `${cash(s.real)} for the group, ${cash(Math.round(s.real / Math.max(1, n)))} each` : fresh ? fresh.line : "", totalLine: s.real ? "" : fresh?.totalLine || "", over: fresh?.over || false,
        votes: v.length, voters: v.map((p) => (p === pid ? "You" : nameOf(p))), mine: v.includes(pid), picked: T.stayPick === s.id, by: s.by === pid ? "You" : nameOf(s.by) || "" }; })
      .sort((a, b) => +b.picked - +a.picked || b.votes - a.votes);
    out.booking = T.booking ? { name: T.booking.name, total: T.booking.cents ? cash(T.booking.cents) : "", each: T.booking.cents ? cash(Math.round(T.booking.cents / Math.max(1, n))) : "", checkIn: clock(T.booking.checkIn), checkOut: clock(T.booking.checkOut), address: T.booking.address, confirmation: T.booking.confirmation, link: T.booking.link, paidBy: T.booking.paidBy === pid ? "You" : nameOf(T.booking.paidBy) } : null;
    // things to do: ideas with votes and when they're on the plan
    out.ideas = (T.ideas || []).map((x) => { const v = votes(T.ideaVotes, x.id); return { id: x.id, title: x.title, note: x.note || "", group: x.group || "", line: x.line || "", link: x.link || "", potto: !!x.potto, est: !!x.potto && !x.real, part: x.part || "", time: x.time || "",
      fits: x.fits || 0, votes: v.length, voters: v.map((p) => (p === pid ? "You" : nameOf(p))), mine: v.includes(pid), when: x.when || null, whenLine: x.when ? `${new Date(x.when.day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}${x.when.time ? " at " + clock(x.when.time) : ""}` : "", by: x.by === pid ? "You" : nameOf(x.by) || "", mineToo: x.by === pid }; })
      .sort((a, b) => +!!a.when - +!!b.when || b.votes - a.votes || b.fits - a.fits);
    out.wants = wantsAll;
    out.days = []; if (ISO.test(ev.date || "")) for (let d = ev.date; d <= lastDay(ev); d = addDays(d, 1)) out.days.push({ day: d, label: new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) });
    // who lands when
    const A = T.arrivals || {};
    out.arrivals = people.map((p) => { const a = A[p.pid] || null; return { pid: p.pid, name: p.pid === pid ? "You" : p.name, you: p.pid === pid, ...(a ? { arriveDay: a.arriveDay, arriveTime: a.arriveTime, arriveNote: a.arriveNote, departDay: a.departDay, departTime: a.departTime, departNote: a.departNote } : {}), set: !!a }; })
      .sort((a, b) => (a.arriveDay || "9") .localeCompare(b.arriveDay || "9") || (a.arriveTime || "99").localeCompare(b.arriveTime || "99"));
    out.mineArrival = A[pid] || null;
    // money: the organiser's Get paid buttons for what you owe them, and who's paid back
    const hostPay = payOfWs(ws), keys = eventMethods(hostPay, { payHide: [] }).filter((k) => k !== "note");
    out.payHost = { methods: keys.map((k) => ({ key: k, label: PAY_LABEL[k] })), note: hostPay.note || "" };
    out.payments = (T.payments || []).filter((p) => isHost || p.from === pid || p.to === pid).map((p) => ({ id: p.id, line: `${p.from === pid ? "You" : nameOf(p.from)} paid ${p.to === pid ? "you" : nameOf(p.to)} ${money(p.cents)}`, at: p.at, mine: p.from === pid, cents: p.cents }));
    if (isHost) { out.deals = groupDeals(Pl, { people: n, from: ev.date, to: lastDay(ev), weekends: trip.weekends, summary, cap, host: out.host }); out.people = people.map((p) => ({ pid: p.pid, name: p.name })); }
    return out;
  }
  const payLinksFor = (ws, cents, note) => { const pay = payOfWs(ws); return eventMethods(pay, { payHide: [] }).filter((k) => k !== "note").map((k) => ({ label: `${PAY_LABEL[k]}`, href: deepLink(k, pay[k], cents, note) })).filter((x) => x.href); };
  /** Potto's trip answer for an organiser (server/potto.js). */
  const answerFor = (u, message) => { try { if (!u?.ws || u.ws === DEFAULT_WS) return null; const S = scopeStore(store, u.ws), today = new Date().toISOString().slice(0, 10);
    const trips = S.list("events").filter((d) => d.data?.trip && !d.data.cancelled && !(ISO.test(d.data.endDate || d.data.date || "") && (d.data.endDate || d.data.date) < today)).sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0)).slice(0, 5)
      .map((d) => ({ id: d.id, view: viewOf(d.id, P.viewerOf(d.id, { ws: u.ws })) })).filter((x) => x.view);
    return tripAnswer(message, trips); } catch { return null; } };
  app.locals.trips = { viewOf, payLinksFor, answerFor };

  const fresh = (req, id, b) => { const V = viewer(req, id, b); return V ? viewOf(id, V) : null; };
  app.get("/api/public/trip/:id", (req, res) => { const id = String(req.params.id || ""); if (!ID.test(id)) return bad(res, "No such trip.", 404, "not_found");
    const V = viewer(req, id); if (!V || !isTrip(V.ev) || (!V.isHost && !V.r && !V.ev.published)) return bad(res, "No such trip.", 404, "not_found");
    res.set("Cache-Control", "private, no-store").json({ trip: viewOf(id, V) }); });

  // ---------- the organiser ----------
  const hostOf = (req, res, id) => { const u = me(req); if (!u?.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; }
    const V = ID.test(id) ? P.viewerOf(id, { ws: u.ws }) : null; if (!V?.isHost) { bad(res, "No such trip.", 404, "not_found"); return null; } return { u, V }; };
  // a new trip from a line: a draft feeler, ready to set up and send
  app.post("/api/host/trips", small, (req, res) => { const u = me(req); if (!u?.ws || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated");
    const b = req.body || {}, today = new Date().toISOString().slice(0, 10), p = parseTripLine(b.say || "", today), dest = clean(b.destination || p.destination || "", 60), Pl = placeOf(dest);
    if (b.onlyTrip && !p.trip) return res.json({ trip: false }); // the New screen asks first; anything else stays an event
    const title = clean(b.title || (p.trip ? p.title : "") || (dest ? `${dest} trip` : ""), 80); if (!title) return bad(res, "Say where and roughly when, like Vegas sometime in March.");
    const S = scopeStore(store, u.ws); let id = ""; for (let i = 0; i < 5 && !id; i++) { const c = crypto.randomBytes(15).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 20); if (c.length >= 16 && claimEvent(c, u.ws)) id = c; }
    if (!id) return bad(res, "Couldn't start that. Try again.", 500, "error");
    const trip = cleanTrip({ destination: dest, weekends: p.weekends || [], interests: Pl.interests });
    S.set("events/" + id, { id, name: title, pubTitle: title, planKind: "weekend", activity: "Trip", stage: "interest", casual: true, published: false, discoverable: false, noMaybe: false, openRsvp: true, showWho: true, carpool: false,
      city: Pl.full || dest, hood: "", tz: Pl.tz || "", date: "", startTime: "", dateOptions: trip.weekends.map((w) => w.from), trip, hostName: u.name || "", concept: clean(b.say, 300), createdAt: Date.now(), updatedAt: Date.now() });
    X.bust?.(); res.json({ ok: true, id, url: `/plans/${id}`, trip: viewOf(id, P.viewerOf(id, { ws: u.ws })) }); });
  // the feeler: the place, the weekends, budget bands, things to do; publish makes the link work
  app.post("/api/host/trips/:id/feeler", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, b = req.body || {};
    if (V.ev.stage !== "interest") return bad(res, "The dates are already locked.", 409, "not_allowed");
    const trip = cleanTrip(b, V.ev.trip || {}); if (!trip.weekends.length) return bad(res, "Pick at least one weekend for friends to choose from.");
    const Pl = placeOf(trip.destination), title = clean(b.title, 80);
    V.S.update("events/" + id, { trip, dateOptions: trip.weekends.map((w) => w.from), ...(trip.destination ? { city: Pl.full || trip.destination, tz: Pl.tz || V.ev.tz || "" } : {}), ...(title ? { name: title, pubTitle: title } : {}), ...(b.publish ? { published: true } : {}), updatedAt: Date.now() });
    X.bust?.(); res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });
  // make it the trip: lock the weekend, the yeses for it are in, everyone who was keen is told
  app.post("/api/host/trips/:id/lock", small, async (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V, u } = H, id = req.params.id, b = req.body || {};
    if (V.ev.stage !== "interest") return bad(res, "The dates are already locked.", 409, "not_allowed");
    const trip = cleanTrip(V.ev.trip || {}), w = trip.weekends.find((x) => x.from === String(b.from || "")) || (ISO.test(b.from || "") ? { from: b.from, to: ISO.test(b.to || "") && b.to > b.from ? b.to : addDays(b.from, 2) } : null);
    if (!w) return bad(res, "Pick the weekend first.");
    V.S.update("events/" + id, { date: w.from, endDate: w.to, stage: "", dateOptions: [], published: true, lockedAt: Date.now(), updatedAt: Date.now() });
    let told = null; try { told = await X.itsOn?.({ ws: u.ws, id, hostName: u.name, origin: publicOrigin(req) }); } catch {}
    // Potto's first picks for where to stay and what to do, from the group as it is now and what they said
    const V2 = P.viewerOf(id, { ws: u.ws }), people = peopleIn(V2.S, id, hostName(u.ws, V2.ev)), summary = feelerSummary(trip, latestReplies(V2.S, id)), Pl = placeOf(trip.destination || V2.ev.city);
    const T = rec(V2.S, id); if (!(T.stays || []).length) T.stays = stayOptions(Pl, { people: people.length, from: w.from, to: w.to, cap: summary.budget.cap }).slice(0, 4).map((o) => ({ id: newId(), key: o.key, name: o.name, area: o.area, kind: o.kind, rooms: o.rooms, potto: true, by: "host", at: Date.now() }));
    if (!(T.ideas || []).length) T.ideas = activityIdeas(Pl, { wants: summary.wants, people: people.length, interests: trip.interests }).slice(0, 6).map((x) => ({ id: newId(), key: x.key, title: x.title, group: x.group, line: x.line, link: x.link, part: x.part, time: x.time, fits: x.fits, potto: true, by: "host", at: Date.now() }));
    save(V2.S, id, T); X.bust?.();
    const left = summary.people.filter((p) => p.interest !== "no" && !people.some((x) => x.pid === p.rid)).map((p) => p.name);
    res.json({ ok: true, told: told?.told || 0, confirmed: told?.confirmed || 0, notYet: left, message: `It's on: ${clean(V2.ev.pubTitle || V2.ev.name, 80)}, ${weekendLine(w)}. Tap to say you're in and see the plan: ${publicOrigin(req)}/e/${id}`, trip: viewOf(id, V2) }); });
  // where to stay: Potto's options (again, for the group now), your own, or remove one
  app.post("/api/host/trips/:id/stays", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, b = req.body || {}, T = rec(V.S, id);
    const people = peopleIn(V.S, id, hostName(H.u.ws, V.ev)), trip = cleanTrip(V.ev.trip || {}), Pl = placeOf(trip.destination || V.ev.city), cap = feelerSummary(trip, latestReplies(V.S, id)).budget.cap;
    T.stays = T.stays || [];
    if (b.action === "potto") { const have = new Set(T.stays.map((s) => s.key)); for (const o of stayOptions(Pl, { people: people.length, from: V.ev.date, to: lastDay(V.ev), cap })) if (!have.has(o.key)) T.stays.push({ id: newId(), key: o.key, name: o.name, area: o.area, kind: o.kind, rooms: o.rooms, potto: true, by: "host", at: Date.now() }); }
    else if (b.action === "remove") { T.stays = T.stays.filter((s) => s.id !== String(b.stay || "")); if (T.stayPick === b.stay) T.stayPick = ""; }
    else { const name = clean(b.name, 80); if (!name) return bad(res, "Give the place a name, like The Palms suite."); if (T.stays.length >= 12) return bad(res, "Twelve options is plenty. Remove one first.");
      const link = httpsOf(b.link); if (String(b.link || "").trim() && !link) return bad(res, "That link doesn't look right."); const real = b.total != null && String(b.total).trim() ? centsOf(b.total) : 0; if (String(b.total || "").trim() && !real) return bad(res, "Add the total like 1200 or 1,200.");
      T.stays.push({ id: newId(), name, area: clean(b.area, 60), kind: ["rooms", "suites", "house"].includes(b.kind) ? b.kind : "", rooms: clean(b.rooms, 80), link, real, why: clean(b.note, 200), by: "host", at: Date.now() }); }
    save(V.S, id, T); res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });
  app.post("/api/host/trips/:id/pick", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, T = rec(V.S, id), s = (T.stays || []).find((x) => x.id === String(req.body?.stay || ""));
    if (!s) return bad(res, "That option isn't on the list anymore."); T.stayPick = s.id; save(V.S, id, T);
    V.S.update("events/" + id, { lodging: cleanLodging({ ...(V.ev.lodging || {}), name: s.name, area: s.area, link: s.link || V.ev.lodging?.link || "" }), updatedAt: Date.now() });
    res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });
  // the booking, pasted back from the site: name, confirmation, address, check-in and out, the total (a shared cost)
  app.post("/api/host/trips/:id/booking", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, b = req.body || {}, T = rec(V.S, id), ev = V.ev;
    const name = clean(b.name || (T.stays || []).find((s) => s.id === T.stayPick)?.name || "", 80); if (!name) return bad(res, "Add the place's name.");
    const cents = String(b.total ?? "").trim() ? centsOf(b.total) : 0; if (String(b.total ?? "").trim() && !cents) return bad(res, "Add the total like 1,840 or 1840.50.");
    const checkIn = timeOf(b.checkIn), checkOut = timeOf(b.checkOut); if (checkIn === null) return bad(res, "Use a time like 4pm for check-in."); if (checkOut === null) return bad(res, "Use a time like 11am for check-out.");
    const link = httpsOf(b.link); if (String(b.link || "").trim() && !link) return bad(res, "That link doesn't look right.");
    const people = peopleIn(V.S, id, hostName(H.u.ws, ev)), paidBy = people.some((p) => p.pid === b.paidBy) ? b.paidBy : "host", costId = T.booking?.costId || newId();
    T.booking = { name, confirmation: clean(b.confirmation, 60), address: clean(b.address, 200), checkIn: checkIn || "", checkOut: checkOut || "", cents, link, paidBy, costId, at: Date.now() };
    T.costs = (T.costs || []).filter((c) => c.id !== costId); if (cents) T.costs.push({ id: costId, label: `Stay: ${name}`.slice(0, 60), cents, paidBy, among: [], at: Date.now() });
    const pick = (T.stays || []).find((s) => s.id === T.stayPick); if (pick && cents) pick.real = cents; else if (!pick) { const s = { id: newId(), name, area: clean(b.area || ev.lodging?.area, 60), link, real: cents, by: "host", at: Date.now() }; T.stays = [...(T.stays || []), s]; T.stayPick = s.id; }
    save(V.S, id, T);
    // the lodging card and the itinerary's check-in and check-out follow the booking
    const lodging = cleanLodging({ ...(ev.lodging || {}), name, area: clean(b.area, 60) || ev.lodging?.area || pick?.area || "", address: T.booking.address, checkIn: T.booking.checkIn, checkOut: T.booking.checkOut, link: link || ev.lodging?.link || "", notes: T.booking.confirmation ? `Confirmation ${T.booking.confirmation}` : ev.lodging?.notes || "" });
    let itin = (ev.itinerary || []).filter((x) => !(x.kind === "checkin" && /^Check in/.test(x.title)) && !(x.kind === "checkout" && /^Check out/.test(x.title)));
    if (ISO.test(ev.date || "")) { itin.push({ day: ev.date, time: T.booking.checkIn, kind: "checkin", title: `Check in at ${name}`.slice(0, 80), sub: "" }); itin.push({ day: lastDay(ev), time: T.booking.checkOut, kind: "checkout", title: `Check out of ${name}`.slice(0, 80), sub: "" }); }
    const ci = cleanItinerary(itin, ev); V.S.update("events/" + id, { lodging, ...(ci.items ? { itinerary: ci.items } : {}), updatedAt: Date.now() });
    res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });
  // things to do on the plan: a day and a time, or off it
  app.post("/api/host/trips/:id/schedule", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, b = req.body || {}, T = rec(V.S, id), ev = V.ev;
    const x = (T.ideas || []).find((i) => i.id === String(b.idea || "")); if (!x) return bad(res, "That idea isn't on the list anymore.");
    let itin = (ev.itinerary || []).filter((i) => !(x.when && i.day === x.when.day && i.title === x.title && (i.time || "") === (x.when.time || "")));
    if (b.off) x.when = null;
    else { if (!ISO.test(b.day || "") || b.day < ev.date || b.day > lastDay(ev)) return bad(res, "Pick a day of the trip."); const t = timeOf(b.time); if (t === null) return bad(res, "Use a time like 8pm.");
      x.when = { day: b.day, time: t || "" }; itin.push({ day: b.day, time: t || "", kind: /dinner|brunch|lunch/i.test(x.title) ? "meal" : "activity", title: x.title, sub: x.note || "" }); }
    const ci = cleanItinerary(itin, ev); if (ci.error) return bad(res, ci.error);
    if (b.cost != null && String(b.cost).trim()) { const cents = centsOf(b.cost); if (!cents) return bad(res, "Add the total like 480 or 480.50."); const cid = x.costId || newId(); x.costId = cid; T.costs = (T.costs || []).filter((c) => c.id !== cid); T.costs.push({ id: cid, label: x.title.slice(0, 60), cents, paidBy: "host", among: [], at: Date.now() }); x.real = cents; }
    save(V.S, id, T); V.S.update("events/" + id, { itinerary: ci.items, updatedAt: Date.now() }); res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });
  app.post("/api/host/trips/:id/ideas/potto", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, T = rec(V.S, id), trip = cleanTrip(V.ev.trip || {}), Pl = placeOf(trip.destination || V.ev.city);
    const summary = feelerSummary(trip, latestReplies(V.S, id)), have = new Set((T.ideas || []).map((x) => x.key).filter(Boolean)), people = peopleIn(V.S, id, hostName(H.u.ws, V.ev)).length;
    T.ideas = [...(T.ideas || []), ...activityIdeas(Pl, { wants: summary.wants, people, interests: trip.interests }).filter((x) => !have.has(x.key)).slice(0, 4).map((x) => ({ id: newId(), key: x.key, title: x.title, group: x.group, line: x.line, link: x.link, part: x.part, time: x.time, fits: x.fits, potto: true, by: "host", at: Date.now() }))].slice(0, 40);
    save(V.S, id, T); res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });
  // a paid-back line the organiser marks ("Sam paid me $84")
  app.post("/api/host/trips/:id/paid", small, (req, res) => { const H = hostOf(req, res, String(req.params.id || "")); if (!H) return; const { V } = H, id = req.params.id, b = req.body || {}, T = rec(V.S, id);
    const people = peopleIn(V.S, id, hostName(H.u.ws, V.ev)); if (b.undo) { T.payments = (T.payments || []).filter((p) => p.id !== String(b.undo)); save(V.S, id, T); return res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); }
    const from = people.some((p) => p.pid === b.from && p.pid !== "host") ? b.from : "", cents = centsOf(b.amount ?? (b.cents != null ? +b.cents / 100 : "")); if (!from) return bad(res, "Pick who paid you."); if (!cents) return bad(res, "Add the amount, like 84.");
    T.payments = [...(T.payments || []), { id: newId(), from, to: "host", cents, at: Date.now(), by: "host" }].slice(-200); save(V.S, id, T); res.json({ ok: true, trip: viewOf(id, P.viewerOf(id, { ws: H.u.ws })) }); });

  // ---------- friends ----------
  // the feeler answer, with no account: a reply with a code kept on their phone, or their account's when signed in
  app.post("/api/public/trip/:id/answer", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down a little.", 429, "rate_limited"); const id = String(req.params.id || ""), b = req.body || {};
    const V = ID.test(id) ? viewer(req, id, b) : null; if (!V || !V.ev?.trip || !V.ev.published || V.ev.cancelled) return bad(res, "No such trip.", 404, "not_found");
    if (V.isHost) return bad(res, "This is for your friends. Share the link with them.", 409, "not_allowed");
    if (V.ev.stage !== "interest") return bad(res, "The dates are locked now. Open the plan to say you're in.", 409, "closed");
    const trip = cleanTrip(V.ev.trip), u = me(req), interest = ["in", "maybe", "no"].includes(b.interest) ? b.interest : "";
    if (!interest) return bad(res, "Tap I'm in, Maybe or Can't make it.");
    const name = clean(b.name, 80) || clean(V.r?.name, 80) || clean(u?.name, 80); if (!name) return bad(res, "Add your name so they know it's you.");
    const c = clean(b.contact, 120), email = /@/.test(c) ? lc(c) : lc(u?.email || V.r?.email || ""), phone = !/@/.test(c) && c.replace(/[^\d]/g, "").length >= 7 ? c.replace(/[^\d+]/g, "").slice(0, 20) : V.r?.phone || "";
    if (/@/.test(c) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return bad(res, "That email doesn't look right.");
    const dates = (Array.isArray(b.weekends) ? b.weekends : []).map(String).filter((d) => trip.weekends.some((w) => w.from === d));
    const budget = Number.isInteger(+b.budget) && +b.budget >= 0 && +b.budget < trip.budgets.length && String(b.budget).trim() !== "" ? +b.budget : -1;
    const wants = (Array.isArray(b.wants) ? b.wants : []).map((w) => clean(w, 40)).filter((w) => trip.interests.includes(w)).slice(0, 10);
    const data = { eventId: id, name, ...(email ? { email } : {}), ...(phone ? { phone, contactVia: "sms" } : email ? { contactVia: "email" } : {}), response: interest === "no" ? "no" : "maybe", interest, dates: interest === "no" ? [] : dates,
      trip: { budget: interest === "no" ? -1 : budget, wants: interest === "no" ? [] : wants, note: clean(b.note, 300) }, via: "trip-feeler", changedAt: Date.now() };
    let rid = V.r && !V.isHost ? V.rid : "", code = V.r?.code || "";
    if (rid) V.S.update("rsvps/" + rid, data);
    else { code = Array.from(crypto.randomBytes(6), (x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join(""); const key = /^[A-Za-z0-9_-]{8,64}$/.test(String(b.key || "")) ? String(b.key) : crypto.randomBytes(16).toString("hex"), r = V.S.add("rsvps", { ...data, code, _k: key, createdAt: Date.now() }); /* _k: the browser key every guest reply carries, so the invite and the plan page can change it later */ rid = String(r.id || r.path || "").split("/").pop(); }
    const W = getWorkspace(V.ws), wk = dates.length ? `${dates.length} weekend${dates.length === 1 ? "" : "s"} work` : "no weekend picked yet";
    X.notify?.(W?.ownerEmail, { kind: "reply", key: `trip-${id}-${rid}-${interest}-${dates.join()}`, text: `${first(name)} ${interest === "in" ? "is keen" : interest === "maybe" ? "is a maybe" : "can't make it"} for ${clean(V.ev.pubTitle || V.ev.name, 60)}${interest === "no" ? "" : `: ${wk}`}.`, link: `/plans/${encodeURIComponent(id)}`, eventId: id });
    X.bust?.(); res.json({ ok: true, rid, code, trip: viewOf(id, { ...V, r: V.S.get("rsvps/" + rid)?.data, rid }) }); });
  // people who are in: vote, add an idea or an option, set when they land, say they paid
  const guest = (fn) => (req, res) => { if (limited(req, 90)) return bad(res, "Slow down a little.", 429, "rate_limited"); const id = String(req.params.id || ""), b = req.body || {};
    const V = ID.test(id) ? viewer(req, id, b) : null; if (!V || !isTrip(V.ev)) return bad(res, "No such trip.", 404, "not_found");
    const pid = V.isHost ? "host" : V.r?.response === "going" ? V.rid : ""; if (!pid) return bad(res, V.r ? "This is for people who are in." : "Say you're in first, then you can add yourself here.", 403, "not_granted");
    if (V.ev.cancelled) return bad(res, "This one was cancelled.", 409, "closed");
    const T = rec(V.S, id), err = fn(V, pid, b, T, id); if (err) return bad(res, err, 409, "not_allowed"); save(V.S, id, T); X.bust?.();
    res.json({ ok: true, trip: fresh(req, id, b) }); };
  app.post("/api/public/trip/:id/vote", small, guest((V, pid, b, T) => { const what = b.what === "idea" ? "idea" : "stay", list = what === "idea" ? T.ideas || [] : T.stays || [], key = what === "idea" ? "ideaVotes" : "stayVotes";
    if (!list.some((x) => x.id === String(b.item || ""))) return "That option isn't on the list anymore.";
    const M = { ...(T[key] || {}) }, L = (M[b.item] || []).filter((p) => p !== pid); if (b.on !== false) L.push(pid); M[b.item] = L; T[key] = M; return ""; }));
  app.post("/api/public/trip/:id/idea", small, guest((V, pid, b, T) => { if (b.remove) { const x = (T.ideas || []).find((i) => i.id === String(b.remove)); if (!x) return ""; if (x.by !== pid && pid !== "host") return "Only the person who added it, or the organiser, can take it off."; if (x.when) return "It's on the plan. Take it off the plan first."; T.ideas = T.ideas.filter((i) => i !== x); return ""; }
    const title = clean(b.title, 80); if (!title) return "Say what it is, like Sunset at the Bellagio fountains."; if ((T.ideas || []).length >= 40) return "That's a lot of ideas. Forty is the most.";
    const link = httpsOf(b.link); if (String(b.link || "").trim() && !link) return "That link doesn't look right.";
    T.ideas = [...(T.ideas || []), { id: newId(), title, note: clean(b.note, 200), link, by: pid, at: Date.now() }]; T.ideaVotes = { ...(T.ideaVotes || {}), [T.ideas.at(-1).id]: [pid] }; return ""; }));
  app.post("/api/public/trip/:id/arrival", small, guest((V, pid, b, T) => { if (b.clear) { T.arrivals = { ...(T.arrivals || {}) }; delete T.arrivals[pid]; return ""; } const a = cleanArrival(b, V.ev); if (a.error) return a.error; T.arrivals = { ...(T.arrivals || {}), [pid]: a.arrival }; return ""; }));
  app.post("/api/public/trip/:id/paid", small, guest((V, pid, b, T, id) => { if (b.undo) { const p = (T.payments || []).find((x) => x.id === String(b.undo)); if (p && (p.from === pid || pid === "host")) T.payments = T.payments.filter((x) => x !== p); return ""; }
    const people = peopleIn(V.S, id, ""), to = String(b.to || "host"); if (to === pid) return "That's you."; if (to !== "host" && !people.some((p) => p.pid === to)) return "Pick who you paid.";
    const cents = centsOf(b.amount ?? (b.cents != null ? +b.cents / 100 : "")); if (!cents) return "Add the amount, like 84.";
    T.payments = [...(T.payments || []), { id: newId(), from: pid, to, cents, at: Date.now(), by: pid }].slice(-200);
    const W = getWorkspace(V.ws); if (to === "host") X.notify?.(W?.ownerEmail, { kind: "pay", text: `${first(V.r?.name) || "Someone"} says they paid you ${money(cents)} for ${clean(V.ev.pubTitle || V.ev.name, 60)}.`, link: `/plans/${encodeURIComponent(id)}`, eventId: id }); return ""; }));

  // a draft trip from Potto's line on the New screen (index.html), and the helper the line reader uses
  app.post("/api/host/trips/read", small, (req, res) => { const u = me(req); if (!u?.ws || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated"); res.json(parseTripLine(req.body?.say || "", new Date().toISOString().slice(0, 10))); });
  return { viewOf };
}
