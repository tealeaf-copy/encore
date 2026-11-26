// A made-up world for brand Insights and Campaigns (tests and screenshots only, always in a temp store): hosts in
// New York and San Francisco with past events, a few hundred guests with interests and "what you do" chips (most
// opted in to insights, some not), kudos, a brand team (owner, editor, viewer), team bookings past and upcoming, and
// campaigns with guest lists, replies, check-ins and feedback. Every company and person here is invented.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { scopeStore, getDbUser } from "../server/workspaces.js";
import { prefKey } from "../server/insights.js";

const hash = (s) => crypto.createHash("sha256").update(String(s || "").trim().toLowerCase()).digest("hex").slice(0, 24);
// a small deterministic random, so every run builds the same world
function rng(seed = 7) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const weekdayAfter = (n, want = [1, 2, 3, 4, 5]) => { for (let i = n; i < n + 14; i++) { const d = day(i), w = new Date(d + "T12:00:00Z").getUTCDay(); if (want.includes(w)) return d; } return day(n); };

export const HOSTS = [
  { handle: "long-table", name: "Long Table Supper Club", person: "Ines Calloway", city: "New York", hood: "Greenpoint", kind: "supper", pkg: { name: "Supper club for your team", story: "Six courses at one long table in my flat. Seasonal, family style, lots of talking.", moods: ["client", "bonding"], perPersonCents: 11000, minimumCents: 110000, minGuests: 8, maxGuests: 20, includes: ["Ingredients", "Wine pairing", "Service"] }, price: "$65", head: 16, time: "19:30", again: 0.9 },
  { handle: "wheel-and-kiln", name: "Wheel and Kiln Studio", person: "Theo Marsh", city: "New York", hood: "Bushwick", kind: "workshop", pkg: { name: "Pottery workshop on the wheel", story: "Two hours at the wheel. Everyone leaves with a mug, fired and posted a week later.", moods: ["handson", "bonding"], perPersonCents: 8500, minimumCents: 85000, minGuests: 6, maxGuests: 16, includes: ["Clay", "Firing", "Aprons"] }, price: "$55", head: 12, time: "18:30", again: 0.88 },
  { handle: "dice-and-dumplings", name: "Dice and Dumplings", person: "Rafa Quint", city: "New York", hood: "Long Island City", kind: "games", pkg: { name: "Game night with dumplings", story: "Board games picked for your group, a dumpling bar and a host who teaches every game.", moods: ["bonding", "celebrate"], perPersonCents: 6000, minimumCents: 60000, minGuests: 8, maxGuests: 30, includes: ["Games", "Dumplings", "Drinks"] }, price: "$30", head: 24, time: "19:00", again: 0.93 },
  { handle: "east-river-run", name: "East River Run Club", person: "Dana Wu", city: "New York", hood: "Williamsburg", kind: "run", pkg: { name: "Team run and coffee", story: "A no-drop 5k along the river, then coffee and pastries.", moods: ["bonding", "calm"], perPersonCents: 2500, minimumCents: 30000, minGuests: 8, maxGuests: 60, includes: ["Pacers", "Coffee", "Pastries"] }, price: "Free", head: 30, time: "07:30", again: 0.72 },
  { handle: "corner-cellar", name: "Corner Cellar Tastings", person: "Margo Bell", city: "New York", hood: "West Village", kind: "tasting", pkg: { name: "Natural wine tasting", story: "Six wines from small growers, cheese, and stories about each bottle.", moods: ["client", "celebrate"], perPersonCents: 9500, minimumCents: 95000, minGuests: 8, maxGuests: 18, includes: ["Six wines", "Cheese", "Notes"] }, price: "$70", head: 14, time: "19:00", again: 0.78 },
  { handle: "slow-pour", name: "Slow Pour Mornings", person: "Kofi Adeyemi", city: "New York", hood: "Fort Greene", kind: "coffee", pkg: { name: "Coffee cupping morning", story: "A slow morning tasting coffees side by side, with a roaster who loves questions.", moods: ["calm", "handson"], perPersonCents: 4500, minimumCents: 40000, minGuests: 6, maxGuests: 20, includes: ["Six coffees", "Pastries"] }, price: "$20", head: 14, time: "09:00", again: 0.8, weekend: true },
  { handle: "mission-table", name: "Mission Table", person: "Lucia Ferro", city: "San Francisco", hood: "Mission", kind: "supper", pkg: { name: "Family style supper for teams", story: "A long table, a Oaxacan menu and a host who seats people who should meet.", moods: ["client", "bonding"], perPersonCents: 12500, minimumCents: 125000, minGuests: 8, maxGuests: 22, includes: ["Ingredients", "Mezcal flight", "Service"] }, price: "$75", head: 18, time: "19:00", again: 0.89 },
  { handle: "hayes-clay", name: "Hayes Valley Clay", person: "June Park", city: "San Francisco", hood: "Hayes Valley", kind: "workshop", pkg: { name: "Hand-building workshop", story: "Pinch pots and slab plates, no wheel needed, lots of laughing.", moods: ["handson", "calm"], perPersonCents: 9000, minimumCents: 90000, minGuests: 6, maxGuests: 14, includes: ["Clay", "Glaze", "Firing"] }, price: "$60", head: 12, time: "18:00", again: 0.86 },
  { handle: "fog-city-games", name: "Fog City Game Night", person: "Omar Haddad", city: "San Francisco", hood: "Mission", kind: "games", pkg: { name: "Board game night for teams", story: "Cooperative games and a trivia round written about your team.", moods: ["bonding", "celebrate"], perPersonCents: 5500, minimumCents: 55000, minGuests: 8, maxGuests: 40, includes: ["Games", "Snacks", "Trivia"] }, price: "$25", head: 22, time: "19:00", again: 0.91 },
];
// who likes what: guests' "what you do" and interests make some kinds more likely
const AFFINITY = { engineering: { games: 2.4, workshop: 1.6, run: 1.2, supper: 0.9 }, founder: { supper: 2.2, tasting: 1.6, run: 1.3 }, design: { workshop: 2.3, coffee: 1.9, tasting: 1.1 }, product: { games: 1.5, supper: 1.3, coffee: 1.3 }, marketing: { tasting: 1.8, supper: 1.4 }, leader: { supper: 1.5, tasting: 1.4 } };
const INT_AFF = { coffee: { coffee: 2.5 }, matcha: { coffee: 1.6 }, wine: { tasting: 2.5, supper: 1.2 }, supper: { supper: 1.8 }, run: { run: 2.8 }, games: { games: 2.4 }, pottery: { workshop: 2.4 }, crafts: { workshop: 1.8 }, book: { coffee: 1.2 } };
const FIRST = ["Avery", "Bea", "Cal", "Dev", "Eli", "Fern", "Gus", "Hana", "Ivo", "Jules", "Kit", "Lena", "Milo", "Nia", "Oren", "Pia", "Quinn", "Rae", "Seb", "Tova", "Uma", "Vic", "Wren", "Xavi", "Yara", "Zed", "Ari", "Bo", "Cleo", "Dax"];
const LAST = ["Abbott", "Bram", "Cole", "Dunn", "Ekker", "Frost", "Gale", "Hart", "Imre", "Jory", "Kemp", "Lund", "Moss", "Nash", "Orr", "Pike", "Quill", "Rowe", "Sloan", "Thorne"];
const WORKS = ["engineering", "engineering", "engineering", "product", "design", "design", "founder", "marketing", "data", "sales", "ops", "creative"];
const INTS = ["supper", "coffee", "wine", "run", "games", "pottery", "book", "crafts", "matcha", "talks", "hike", "baking"];

const J = { "content-type": "application/json" };
async function call(base, method, p, body, cookie) { const r = await fetch(base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); assert.ok(r.ok, `${method} ${p}: ${r.status} ${t.slice(0, 300)}`); return { r, j: t ? JSON.parse(t) : {} }; }
const cookieOf = (r) => r.headers.get("set-cookie").split(";")[0];

export async function seedBrandIntel(base, store, { guests: NG = 300, optIn = 0.8 } = {}) {
  const R = rng(11), pick = (L) => L[Math.floor(R() * L.length)];
  // ---- hosts ----
  const hosts = [];
  for (const H of HOSTS) {
    const email = `${H.handle}@hosts.example`, { r } = await call(base, "POST", "/api/signup", { name: H.person, email, password: "long-password-1", mode: "friends" }), c = cookieOf(r);
    await call(base, "POST", "/api/host/profile", { handle: H.handle, name: H.name, city: H.city, hood: H.hood, forHire: true, tagline: H.pkg.story.split(".")[0] }, c);
    const S = (await call(base, "POST", "/api/bb/host/setup", { on: true, policy: "standard", area: H.hood, city: H.city, address: "On file, shared once booked", phone: "+1 555 0100", story: H.pkg.story, since: 2021,
      packages: [{ ...H.pkg, leadDays: 7, weekdays: H.weekend ? [0, 6, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5], time: H.time < "12" ? "daytime" : "evening", taxBps: 0, depositPct: 25 }] }, c)).j;
    hosts.push({ ...H, email, c, ws: getDbUser(email).ws, pkgId: S.setup.packages[0].id });
  }
  // ---- guests ----
  const people = [];
  for (let i = 0; i < NG; i++) { const city = i % 3 === 2 ? "San Francisco" : "New York", work = [pick(WORKS)]; if (R() < 0.25) work.push("leader");
    const ints = [...new Set([pick(INTS), pick(INTS), ...(R() < 0.5 ? [pick(INTS)] : [])])], email = `guest${i}@guests.example`, name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
    const include = R() < optIn; people.push({ email, name, city, work, ints, include, fav: null });
    store.set("system/plint-" + hash(email), { kind: "plint", email, interests: ints, city, at: Date.now() });
    store.set(prefKey(email), { kind: "plinsight", include, work, at: Date.now() }); }
  // ---- past events: 8 to 11 per host over the last ten months ----
  let evN = 0;
  for (const H of hosts) {
    const pool = people.filter((p) => p.city === H.city), S = scopeStore(store, H.ws), n = 8 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const date = day(-(12 + Math.floor((k / n) * 290) + Math.floor(R() * 9))), weight = (p) => { let w = 1; for (const x of p.work) w *= AFFINITY[x]?.[H.kind] || 1; for (const x of p.ints) w *= INT_AFF[x]?.[H.kind] || 1; if (p.fav === H.handle) w *= 4; return w; };
      const want = Math.max(6, Math.round(H.head * (0.75 + R() * 0.25))), chosen = new Set(), W = pool.map((p) => [p, weight(p)]), tot = W.reduce((a, [, w]) => a + w, 0);
      while (chosen.size < want && chosen.size < pool.length) { let x = R() * tot; for (const [p, w] of W) { x -= w; if (x <= 0) { chosen.add(p); break; } } }
      const id = "ev" + (++evN).toString(36) + crypto.randomBytes(3).toString("hex"), start = k % 4 === 3 && !H.weekend ? (H.time < "12" ? "08:00" : "18:00") : H.time;
      S.set("events/" + id, { name: `${H.name}: ${H.pkg.name}`, pubTitle: H.pkg.name, activity: H.kind === "games" ? "game night" : H.kind === "run" ? "run" : H.kind === "coffee" ? "coffee" : H.kind === "tasting" ? "wine tasting" : H.kind === "workshop" ? "pottery workshop" : "supper club",
        date, startTime: start, city: H.city, hood: H.hood, headcount: H.head, price: H.price, discoverable: true, guests: [...chosen].map((p) => ({ name: p.name, email: p.email, status: "Attended" })), createdAt: Date.parse(date) - 20 * 864e5 });
      for (const p of chosen) { if (!p.fav && R() < 0.35) p.fav = H.handle; if (R() < 0.72) { const again = R() < H.again; S.add("kudos", { eventId: id, email: p.email, name: p.name, tags: again ? ["again", "welcome"] : ["vibe"], love: true, at: Date.parse(date) + 864e5 }); } }
    }
  }
  // ---- the brand: Fernwood Labs, a made-up developer tools company, with an owner, an editor and a viewer ----
  const owner = { name: "Maya Lindqvist", email: "maya@fernwood.example" }, editor = { name: "Sam Okoro", email: "sam@fernwood.example" }, viewer = { name: "Priya Anand", email: "priya@fernwood.example" };
  const { r: rb } = await call(base, "POST", "/api/signup", { name: owner.name, email: owner.email, password: "long-password-1", mode: "work", company: "Fernwood Labs", city: "New York" }); owner.c = cookieOf(rb);
  for (const m of [editor, viewer]) { const inv = (await call(base, "POST", "/api/invite", { email: m.email }, owner.c)).j; const { r } = await call(base, "POST", "/api/join", { token: inv.token, name: m.name, password: "long-password-1" }); m.c = cookieOf(r); }
  const brandWs = getDbUser(owner.email).ws;
  // team bookings: request, pay the deposit, the host accepts. Past ones are then moved into the past and reviewed.
  async function book(handle, headcount, date, { past = false, review = 0, accept = true, campaign = "" } = {}) {
    const H = hosts.find((h) => h.handle === handle), { j } = await call(base, "POST", "/api/bb/requests", { handle, pkg: H.pkgId, headcount, date, company: "Fernwood Labs", ...(campaign ? { campaign } : {}) }, owner.c);
    if (accept) { await call(base, "POST", `/api/bb/requests/${j.id}/pay`, {}, owner.c); await call(base, "POST", `/api/bb/host/requests/${j.id}`, { action: "accept" }, H.c); }
    if (past) { const k = "system/bbreq-" + j.id, r = store.get(k).data; r.date = past; if (review) { r.reviews = { brand: { rating: review, text: "Our guests talked about it for weeks.", at: Date.now() - 5 * 864e5, role: "Field marketing" }, host: { rating: 5, text: "Lovely group.", at: Date.now() - 5 * 864e5 } }; } store.set(k, r); }
    return j.id; }
  // ---- campaigns ----
  const C1 = (await call(base, "POST", "/api/campaigns", { title: "Q1 developer dinners in NYC and SF", goal: "Meet 80 senior engineers at teams on our target list, and book 20 follow-up meetings before the spring release.", audience: { tags: ["Engineers", "Engineering leaders"], perPerson: 120 }, cities: ["New York", "San Francisco"], budget: 24000, start: day(-40), end: day(110), kpis: { attendees: 80, meetings: 20, againPct: 85 }, status: "active" }, owner.c)).j.id;
  const C2 = (await call(base, "POST", "/api/campaigns", { title: "Design leaders breakfast series", goal: "Small, calm mornings with design leads in New York. Learn what they need from our design tools.", audience: { tags: ["Design leaders", "Coffee lovers"], perPerson: 60 }, cities: ["New York"], budget: 8000, start: day(20), end: day(140), kpis: { attendees: 40, meetings: 8, againPct: 80 }, status: "planning" }, owner.c)).j.id;
  const C3 = (await call(base, "POST", "/api/campaigns", { title: "Customer thank-you nights", goal: "Say thank you to our first 50 customers in person.", audience: { tags: ["Founders"], perPerson: 100 }, cities: ["New York"], budget: 6000, start: day(-120), end: day(-30), kpis: { attendees: 30, meetings: 5, againPct: 85 }, status: "done" }, owner.c)).j.id;
  const b1 = await book("long-table", 16, weekdayAfter(10), { past: day(-26), review: 5, campaign: C1 });
  const b2 = await book("mission-table", 18, weekdayAfter(11), { past: day(-12), review: 5, campaign: C1 });
  const b3 = await book("dice-and-dumplings", 24, weekdayAfter(18), { campaign: C1 });
  const b4 = await book("hayes-clay", 12, weekdayAfter(32), { campaign: C1 });
  const b5 = await book("corner-cellar", 14, weekdayAfter(60), { accept: false, campaign: C1 });
  const b6 = await book("slow-pour", 12, weekdayAfter(28, [0, 6]), { accept: false, campaign: C2 });
  const b7 = await book("long-table", 14, weekdayAfter(14), { past: day(-70), review: 5, campaign: C3 });
  const b8 = await book("corner-cellar", 12, weekdayAfter(15), { past: day(-45), review: 4, campaign: C3 });
  await call(base, "POST", `/api/campaigns/${C1}/team`, { email: viewer.email, role: "viewer" }, owner.c);
  // a cost that isn't a host: notebooks for every guest
  await call(base, "POST", `/api/campaigns/${C1}/costs`, { label: "Notebooks for every guest", amount: 640, paid: true }, owner.c);
  // guest lists: a CSV import for each event, then replies, check-ins and feedback, as guests would have given them
  const SAID = ["Met three people I'll actually stay in touch with. The host made it easy to talk.", "The food was incredible and the table was the right size for real conversation.", "Loved making something with my hands after a week of screens.",
    "Relaxed, small, no pitch. I learned more about their roadmap than at any booth.", "Great host, great people. It ran a little long but I didn't mind.", "The room was cozy and the conversations were the best part.", "Useful ideas from peers working on the same problems.", "Delicious menu, and I met people from teams I admire."];
  const fill = (c, ev, n, { yes = 0.8, came = 0.85, again = 0.9, past = true, consent = 0.6, meetings = 0.3 } = {}) => { const k = "system/camp-" + c, D = store.get(k).data;
    for (let i = 0; i < n; i++) { const fn = FIRST[(i * 7 + ev.length) % FIRST.length], ln = LAST[(i * 3 + n) % LAST.length], g = { id: crypto.randomBytes(5).toString("hex"), token: crypto.randomBytes(12).toString("hex"), event: ev, name: `${fn} ${ln}`, email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@acme-${i % 9}.example`, company: ["Larkspur", "Tidewater", "Brightline", "Quarry", "Halcyon", "Northpine", "Kestrel", "Juniper", "Waypoint"][i % 9] + " " + ["Systems", "Labs", "Cloud", "Data"][i % 4], title: ["Staff engineer", "Engineering manager", "Principal engineer", "VP Engineering", "Senior engineer"][i % 5],
      source: "csv", consent: R() < consent ? { share: true, at: Date.now() - 30 * 864e5, via: "csv" } : { share: false, at: 0, via: "" }, status: "invited", invitedAt: Date.now() - 35 * 864e5, repliedAt: 0, checkedIn: false, checkedAt: 0, again: null, said: "", quoteOk: false, followUp: "none", addedAt: Date.now() - 36 * 864e5 };
      if (R() < yes) { g.status = "yes"; g.repliedAt = Date.now() - 30 * 864e5; } else if (R() < 0.6) { g.status = "no"; g.repliedAt = Date.now() - 30 * 864e5; }
      if (past && g.status === "yes" && R() < came) { g.checkedIn = true; g.checkedAt = Date.now() - 20 * 864e5; if (R() < 0.92) g.again = R() < again; if (R() < 0.85) g.said = SAID[Math.floor(R() * SAID.length)]; g.quoteOk = !!g.said && R() < 0.3; g.followUp = R() < meetings ? "meeting" : R() < 0.5 ? "sent" : "none"; if (g.followUp === "meeting") g.consent = { share: true, at: Date.now() - 18 * 864e5, via: "rsvp" }; }
      D.guests.push(g); }
    store.set(k, D); };
  fill(C1, b1, 20); fill(C1, b2, 22); fill(C1, b3, 26, { past: false, yes: 0.55 }); fill(C1, b4, 14, { past: false, yes: 0.4 });
  fill(C3, b7, 18, { again: 0.95 }); fill(C3, b8, 16, { again: 0.8 });
  { const k = "system/camp-" + C1, D = store.get(k).data; D.guests.push({ id: "g0form", token: crypto.randomBytes(12).toString("hex"), event: b3, name: "Noor Halvorsen", email: "noor@example.com", company: "", title: "", source: "form", consent: { share: false, at: 0, via: "" }, status: "asked", invitedAt: 0, repliedAt: 0, checkedIn: false, checkedAt: 0, again: null, said: "", quoteOk: false, followUp: "none", addedAt: Date.now() }); store.set(k, D); }
  // the brand's buyers, saved for Insights and the Home dashboard
  await call(base, "POST", "/api/insights/audience", { tags: ["Engineers", "Engineering leaders"], city: "New York", budget: 120 }, owner.c);
  return { hosts, people, owner, editor, viewer, brandWs, campaigns: { C1, C2, C3 }, bookings: { b1, b2, b3, b4, b5, b6, b7, b8 } };
}
