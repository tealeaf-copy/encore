// Leaderboards for hosts (Strava-style segments): who guests loved most in a city, per kind of event, this month and all time.
//
// A board is one city x one category x one period:
//  - category: from each event's format (the same guess the events directory makes): supper clubs, runs and hikes,
//    workshops, pop-ups, talks, community events, or "all" (every event the host hosted).
//  - period: "month" (the last 30 days) or "all" (all time).
//
// The score counts what guests did, never raw activity:
//
//   score = 3 x (kudos from guests on the guest list + 0.6 x kudos from guests who replied I'm in)
//         + 20 x the share of those guests who'd go again (only once there are 3 or more of those kudos)
//         + 1 x each different guest who came
//         + 2 x each event in the period, counting at most 4 (so many tiny events can't win on their own)
//
//   Kudos from someone who never replied I'm in (verified: null) count 0. "Would go again" uses the same definition as a
//   host's page: tapped "Would go again" or said it was better than usual, out of the kudos that said anything.
//
// Who's on a board: real hosts with a finished page and a city. Example hosts (sample accounts), prepared pages nobody has
// claimed, hosts who left the directory (`directory: false`) and hosts who turned the leaderboard off (`leaderboard: false`)
// are never ranked. A board is shown only once at least 3 hosts are on it; below that it reads as empty.
//
// Moments ("Mai is now #2 in Brooklyn supper clubs") come from state changes: we keep each host's last-known ranks,
// badges and streak, and write a moment only when one of them changes. Nothing is made up.
import { allWorkspaceIds, getWorkspace } from "./workspaces.js";
import { formatOf } from "./directory.js";

const DAY = 864e5;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 80) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
const TTL = () => (process.env.ENCORE_LEADERBOARD_CACHE_MS != null ? Math.max(0, +process.env.ENCORE_LEADERBOARD_CACHE_MS || 0) : 60_000);
const OBSERVE_MS = () => (process.env.ENCORE_LEADERBOARD_OBSERVE_MS != null ? Math.max(0, +process.env.ENCORE_LEADERBOARD_OBSERVE_MS || 0) : 10 * 60_000);

export const CATEGORIES = [
  { id: "all", label: "All events", noun: "" },
  { id: "supper", label: "Supper clubs", noun: "supper clubs", formats: ["dinner", "brunch", "picnic", "drinks"] },
  { id: "movement", label: "Runs and hikes", noun: "runs and hikes", formats: ["run", "hike", "movement"] },
  { id: "workshop", label: "Workshops", noun: "workshops", formats: ["workshop", "class"] },
  { id: "popup", label: "Pop-ups", noun: "pop-ups", formats: ["pop-up", "launch"] },
  { id: "talks", label: "Talks", noun: "talks", formats: ["summit", "conference", "panel", "online", "talk", "keynote", "webinar", "podcast"] },
  { id: "community", label: "Community", noun: "community events", formats: ["meetup", "coffee", "game night", "book club", "party", "tour", "offsite"] },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const CAT_OF_FORMAT = {}; for (const c of CATEGORIES) for (const f of c.formats || []) CAT_OF_FORMAT[f] = c.id;
export const PERIODS = { month: { label: "This month", days: 30 }, all: { label: "All time", days: null } };

/** The leaderboard category of one hosted event, from its format; null when we can't tell (it still counts for "all"). */
export function categoryOf(e = {}) {
  const title = e.pubTitle || e.name || e.title || "", t = `${e.activity || ""} ${title}`.toLowerCase();
  if (/\b(market|bazaar|craft fair|bake sale|pop[- ]?ups?)\b/.test(t)) return "popup";
  return CAT_OF_FORMAT[formatOf({ activity: e.activity || "", title, tags: Array.isArray(e.tags) ? e.tags : [] })] || null;
}

export const KUDOS_WEIGHT = { guest_list: 1, rsvp: 0.6 };
export const RULES = {
  points: { kudos: 3, wouldGoAgain: 20, wouldGoAgainMinKudos: 3, guest: 1, event: 2, eventCap: 4 },
  kudosWeight: { guest_list: 1, rsvp: 0.6, none: 0 },
  minHosts: 3, chipTop: 10,
  periods: { month: "The last 30 days", all: "All time" },
  categories: CATEGORIES.map(({ id, label, formats }) => ({ id, label, formats: formats || [] })),
  formula: "score = 3 x (kudos from guests on the guest list + 0.6 x kudos from guests who replied I'm in) + 20 x share of those guests who'd go again (once there are 3 or more) + 1 x each different guest who came + 2 x each event, counting at most 4",
  text: [
    "Boards rank hosts by what their guests did, not by how much they posted.",
    "Kudos count most. Kudos from a guest the host marked as there count in full. Kudos from a guest who replied I'm in count a little less. Kudos from anyone else don't count.",
    "Once a host has 3 or more of those kudos, the share who'd go again counts too.",
    "Each different guest who came adds a point.",
    "Each event adds a small bonus, up to 4 events, so lots of tiny events can't win on their own.",
    "Month means the last 30 days. All time means everything.",
    "Only real hosts with a page and a city are ranked. Example hosts and hosts who opted out are left off.",
    "A board shows once at least 3 hosts are on it.",
  ],
};

/** One host's score on one board, from the kudos and guests of the events that count. Pure. */
export function scoreOf({ kudos = [], guests = 0, events = 0 } = {}) {
  const P = RULES.points, V = kudos.filter((k) => KUDOS_WEIGHT[k?.verified] > 0), weighted = V.reduce((s, k) => s + KUDOS_WEIGHT[k.verified], 0);
  let again = null;
  if (V.length >= P.wouldGoAgainMinKudos) { const of = V.filter((k) => (k.tags || []).length || k.love || k.compare).length, yes = V.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length; again = of ? yes / of : null; }
  const raw = P.kudos * weighted + (again != null ? P.wouldGoAgain * again : 0) + P.guest * guests + P.event * Math.min(events, P.eventCap);
  const parts = [];
  if (V.length) parts.push(`${V.length} kudos`);
  if (again != null && again > 0) parts.push(`${Math.round(again * 100)}% would go again`);
  if (guests) parts.push(`${guests} ${guests === 1 ? "guest" : "guests"}`);
  if (!parts.length && events) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  return { raw, score: Math.round(raw), kudos: V.length, againPct: again == null ? null : Math.round(again * 100), guests, events, why: parts.join(" · ") };
}

const cityKey = (c) => lc(String(c || "").split(",")[0]);
const placeOf = (cat, city) => (CAT[cat]?.noun ? `${city} ${CAT[cat].noun}` : city);
const boardUrl = (b) => `/leaderboard?city=${encodeURIComponent(b.city)}${b.category !== "all" ? `&category=${b.category}` : ""}${b.period !== "month" ? `&period=${b.period}` : ""}`;
const weekStart = (now) => { const d = new Date(now); const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow); };

export function makeLeaderboard({ store, C, X }) {
  let cache = null, lastObserve = 0;
  const R = () => X.recognition || null;
  // ---- who can be ranked, and what their guests did ----
  function collect(now) {
    const I = X.index(), today = isoDay(now), guestsBy = new Map(), kudosBy = new Map();
    for (const [em, L] of I.att) for (const a of L) { if (!guestsBy.has(a.eventId)) guestsBy.set(a.eventId, new Set()); guestsBy.get(a.eventId).add(em); }
    for (const k of I.kudos) { if (!k.eventId) continue; if (!kudosBy.has(k.eventId)) kudosBy.set(k.eventId, []); kudosBy.get(k.eventId).push(k); }
    const evsBy = new Map(); for (const x of I.events.values()) { const e = x.e; if (!e || e.example || e.sample || e.stage === "interest" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date > today) continue;
      if (!evsBy.has(x.ws)) evsBy.set(x.ws, []); evsBy.get(x.ws).push({ id: x.id, date: e.date, cat: categoryOf(e) }); }
    const hosts = [];
    for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws); if (!h?.handle || !h.name || isDemo(ws) || h.showcase || h.directory === false || h.leaderboard === false) continue;
      if (C.pageGaps && C.pageGaps(h).length) continue; const city = clean(String(h.city || "").split(",")[0], 60); if (!city) continue;
      hosts.push({ ws, handle: h.handle, name: clean(h.name, 60), emoji: h.emoji || "", color: h.color || "", avatarArt: h.theme?.avatarArt || "", accent: h.theme?.accent || h.color || "", avatarUrl: h.theme?.avatarUrl || "", city, cityKey: cityKey(city), owner: lc(getWorkspace(ws)?.ownerEmail), evs: evsBy.get(ws) || [] }); }
    return { hosts, guestsBy, kudosBy };
  }
  function tally(H, D, cat, from, to) {
    const E = H.evs.filter((x) => x.date > from && x.date <= to && (cat === "all" || x.cat === cat)); if (!E.length) return null;
    const kudos = E.flatMap((x) => D.kudosBy.get(x.id) || []), g = new Set(); for (const x of E) for (const em of D.guestsBy.get(x.id) || []) g.add(em);
    return scoreOf({ kudos, guests: g.size, events: E.length });
  }
  const order = (a, b) => b.s.raw - a.s.raw || b.s.kudos - a.s.kudos || b.s.guests - a.s.guests || a.H.name.localeCompare(b.H.name);
  function rankList(list, D, cat, from, to) { return list.map((H) => ({ H, s: tally(H, D, cat, from, to) })).filter((x) => x.s && x.s.raw > 0).sort(order).map((x, i) => ({ ...x, rank: i + 1 })); }
  function build(now = Date.now()) {
    if (TTL() === 0) R()?.reset?.();
    const D = collect(now), today = isoDay(now), m30 = isoDay(now - 30 * DAY), m60 = isoDay(now - 60 * DAY);
    const W = { month: { cur: [m30, today], prev: [m60, m30] }, all: { cur: ["", today], prev: ["", m30] } };
    const byCity = new Map(); for (const H of D.hosts) { if (!byCity.has(H.cityKey)) byCity.set(H.cityKey, []); byCity.get(H.cityKey).push(H); }
    const boards = new Map();
    for (const [ck, list] of byCity) {
      const spell = {}; for (const H of list) spell[H.city] = (spell[H.city] || 0) + 1; const city = Object.entries(spell).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      for (const c of CATEGORIES) for (const period of Object.keys(PERIODS)) {
        const cur = rankList(list, D, c.id, ...W[period].cur), prev = new Map(rankList(list, D, c.id, ...W[period].prev).map((x) => [x.H.handle, x.rank]));
        const b = { key: `${ck}|${c.id}|${period}`, city, cityKey: ck, category: c.id, category_label: c.label, period, period_label: PERIODS[period].label, place: placeOf(c.id, city), qualified: cur.length >= RULES.minHosts, hosts_on_board: cur.length,
          from: W[period].cur[0] ? isoDay(Date.parse(W[period].cur[0]) + DAY) : null, to: today, _list: cur };
        b.url = boardUrl(b);
        b.entries = cur.map((x) => { const r = R()?.of?.(x.H.handle), p = prev.get(x.H.handle);
          return { rank: x.rank, host: { handle: x.H.handle, name: x.H.name, url: `/@${x.H.handle}`, city: x.H.city, emoji: x.H.emoji, avatarArt: x.H.avatarArt, avatarUrl: x.H.avatarUrl, accent: x.H.accent },
            score: x.s.score, why: x.s.why, badges: (r?.badges || []).map((bd) => ({ id: bd.id, emoji: bd.emoji, label: bd.label })), streak: { weeks: r?.streak?.weeks || 0, months: r?.streak?.months || 0 },
            movement: p == null ? { direction: "new", by: 0 } : p > x.rank ? { direction: "up", by: p - x.rank } : p < x.rank ? { direction: "down", by: x.rank - p } : { direction: "same", by: 0 },
            stats: { kudos: x.s.kudos, would_go_again_pct: x.s.againPct, guests: x.s.guests, events: x.s.events }, _ws: x.H.ws, _raw: x.s.raw, _events: x.s.events }; });
        boards.set(b.key, b); } }
    return { at: Date.now(), now, hosts: D.hosts, boards };
  }
  const data = () => { if (!cache || Date.now() - cache.at > TTL()) cache = build(); return cache; };
  const reset = () => { cache = null; };

  // ---- reading boards ----
  const qualified = (period = "month") => [...data().boards.values()].filter((b) => b.qualified && b.period === period);
  function defaultCity() { const L = qualified("month").filter((b) => b.category === "all"), A = L.length ? L : qualified("all").filter((b) => b.category === "all");
    return A.sort((a, b) => b.hosts_on_board - a.hosts_on_board || b._list.reduce((s, x) => s + x.s.raw, 0) - a._list.reduce((s, x) => s + x.s.raw, 0))[0]?.city || ""; }
  function find({ city = "", category = "all", period = "month" } = {}) {
    const cat = CAT[lc(category)] ? lc(category) : "all", per = PERIODS[lc(period)] ? lc(period) : "month", ck = cityKey(city) || cityKey(defaultCity());
    return data().boards.get(`${ck}|${cat}|${per}`) || null; }
  const pubEntry = (e, base = "") => { const { _ws, _raw, _events, ...o } = e; return { ...o, host: { ...o.host, url: base + o.host.url } }; };
  /** The public shape: a board (entries only when it qualifies) and the list of boards that qualify, for pickers. */
  function board(q = {}, base = "") {
    const cat = CAT[lc(q.category)] ? lc(q.category) : "all", per = PERIODS[lc(q.period)] ? lc(q.period) : "month", b = find({ city: q.city, category: cat, period: per });
    const city = b?.city || clean(q.city, 60) || "";
    const out = b ? { city: b.city, category: b.category, category_label: b.category_label, period: b.period, period_label: b.period_label, from: b.from, to: b.to, title: b.category === "all" ? `Top hosts in ${b.city}` : `Top ${b.category_label.toLowerCase()} in ${b.city}`,
      qualified: b.qualified, min_hosts: RULES.minHosts, hosts_on_board: b.qualified ? b.hosts_on_board : null, url: base + b.url, entries: b.qualified ? b.entries.slice(0, 50).map((e) => pubEntry(e, base)) : [],
      note: b.qualified ? "" : `A board shows once ${RULES.minHosts} hosts are on it.` }
      : { city, category: cat, category_label: CAT[cat].label, period: per, period_label: PERIODS[per].label, from: null, to: isoDay(Date.now()), title: "", qualified: false, min_hosts: RULES.minHosts, hosts_on_board: null, url: "", entries: [], note: `A board shows once ${RULES.minHosts} hosts are on it.` };
    const boards = [...data().boards.values()].filter((x) => x.qualified).map((x) => ({ city: x.city, category: x.category, category_label: x.category_label, period: x.period, hosts: x.hosts_on_board }));
    return { data: out, boards, rules_url: base + "/api/v1/leaderboard/rules" };
  }
  /** Where a host ranks in the top 10 on a board that qualifies, this month: best first. */
  function ranksOf(handle) { const hd = lc(handle).replace(/^@/, ""), out = [];
    for (const b of qualified("month")) { const e = b.entries.find((x) => x.host.handle === hd); if (e && e.rank <= RULES.chipTop) out.push({ rank: e.rank, city: b.city, category: b.category, period: b.period, place: b.place, text: `#${e.rank} in ${b.place} this month`, url: b.url, _raw: e._raw, _events: e._events, _b: b }); }
    return out.sort((a, b) => a.rank - b.rank || (a.category === "all") - (b.category === "all") || b._b.hosts_on_board - a._b.hosts_on_board); }

  // ---- moments: from state changes only ----
  const momentsOf = () => store.get("system/lb-moments")?.data?.list || [];
  function observe({ force = false } = {}) {
    if (!force && Date.now() - lastObserve < OBSERVE_MS()) return [];
    lastObserve = Date.now(); const D = data(), ranks = new Map();
    for (const b of qualified("month")) for (const e of b.entries) { if (!ranks.has(e.host.handle)) ranks.set(e.host.handle, {}); ranks.get(e.host.handle)[b.key] = e.rank; }
    const out = [], have = new Set(momentsOf().map((m) => m.key));
    for (const H of D.hosts) {
      const path = "system/lbstate-" + H.handle, prev = store.get(path)?.data, r = R()?.of?.(H.handle);
      const cur = { kind: "lbstate", ranks: ranks.get(H.handle) || {}, badges: (r?.badges || []).map((b) => b.id).filter((id) => id === "legend" || id === "super"), weeks: r?.streak?.weeks || 0 };
      if (prev) {
        const add = (type, detail, text, emoji, link) => { const key = `${H.handle}|${type}|${detail}`; if (have.has(key)) return; have.add(key); out.push({ key, ws: H.ws, handle: H.handle, type, text, emoji, link, at: Date.now() }); };
        // a better rank in the top 3 on a board (one per host each time): the best one, a specific category over "all"
        const up = Object.entries(cur.ranks).filter(([k, n]) => n <= 3 && (prev.ranks?.[k] == null || n < prev.ranks[k])).map(([k, n]) => ({ k, n, b: D.boards.get(k) })).filter((x) => x.b)
          .sort((a, b) => a.n - b.n || (a.b.category === "all") - (b.b.category === "all"))[0];
        if (up) add("rank", `${up.k}|${up.n}|${isoDay(Date.now())}`, `${H.name} is now #${up.n} in ${up.b.place}`, up.n === 1 ? "🥇" : up.n === 2 ? "🥈" : "🥉", up.b.url);
        if (cur.weeks >= 3 && cur.weeks > (prev.weeks || 0)) add("streak", `${cur.weeks}|${isoDay(Date.now())}`, `${H.name} hit a ${cur.weeks}-week streak 🔥`, "🔥", `/@${H.handle}`);
        if (cur.badges.includes("legend") && !(prev.badges || []).includes("legend")) add("legend", isoDay(Date.now()), `${H.name} is a Local legend 👑`, "👑", `/@${H.handle}`);
        if (cur.badges.includes("super") && !(prev.badges || []).includes("super")) add("super", isoDay(Date.now()), `${H.name} became a Super host ⭐`, "⭐", `/@${H.handle}`);
      }
      if (!prev || JSON.stringify({ ...prev, at: 0 }) !== JSON.stringify({ ...cur, at: 0 })) store.set(path, { ...cur, at: Date.now() });
    }
    if (out.length) store.set("system/lb-moments", { kind: "lb-moments", list: [...out, ...momentsOf()].slice(0, 500) });
    return out;
  }

  // ---- the feed ----
  const pubHost = (x) => ({ handle: x.host.handle, name: x.host.name, url: x.host.url, city: x.host.city, emoji: x.host.emoji, avatarArt: x.host.avatarArt, avatarUrl: x.host.avatarUrl, accent: x.host.accent });
  function cardFrom(b, { me = "", myWs = "" } = {}, now = Date.now()) {
    if (!b?.qualified) return null;
    return { kind: "leaderboard", at: Math.min(now, weekStart(now) + 9 * 3600e3), title: `This week in ${b.city}`, sub: b.category === "all" ? "Top hosts over the last 30 days" : `Top ${b.category_label.toLowerCase()} over the last 30 days`,
      city: b.city, category: b.category, url: b.url, hosts_on_board: b.hosts_on_board,
      entries: b.entries.slice(0, 3).map((e) => ({ rank: e.rank, host: pubHost(e), why: e.why, score: e.score, badges: e.badges.slice(0, 2), streak: e.streak, movement: e.movement, mine: !!myWs && e._ws === myWs, following: !!me && C.followersOf(e._ws).some((f) => lc(f.email) === me) })) };
  }
  /** The signed-out feed's card: the city with the most going on, when its board qualifies. */
  function publicCard(city = "") { const b = (city && find({ city, category: "all", period: "month" })?.qualified ? find({ city, category: "all", period: "month" }) : null) || find({ category: "all", period: "month" }); return cardFrom(b); }
  /** Extra feed items for a signed-in viewer: at most one leaderboard card, moments from hosts they follow, their own standing. */
  function feedItems(u, F = {}, now = Date.now()) {
    const me = lc(u.email), myWs = u.ws, I = X.index(), out = [];
    try { observe(); } catch {}
    // where the viewer is, and what they go to and follow
    const W = getWorkspace(myWs), wantCity = cityKey(W?.host?.city || W?.city || ""), cats = {};
    const followed = new Set((F.following || []).map(lc)), friends = new Set((X.friendsOf(me) || []).map((f) => lc(f.email)));
    for (const a of I.att.get(me) || []) { const x = I.events.get(a.eventId); const c = x && categoryOf(x.e); if (c) cats[c] = (cats[c] || 0) + 1; }
    for (const H of data().hosts) if (followed.has(H.handle)) for (const e of H.evs) if (e.cat) cats[e.cat] = (cats[e.cat] || 0) + 0.5;
    let ck = wantCity;
    if (!ck) { const seen = {}; for (const a of I.att.get(me) || []) { const c = cityKey(I.events.get(a.eventId)?.e?.city); if (c) seen[c] = (seen[c] || 0) + 1; } ck = Object.entries(seen).sort((a, b) => b[1] - a[1])[0]?.[0] || cityKey(defaultCity()); }
    const pick = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c]) => data().boards.get(`${ck}|${c}|month`)).find((b) => b?.qualified) || data().boards.get(`${ck}|all|month`);
    const card = cardFrom(pick, { me, myWs }, now); if (card) out.push(card);
    // moments from hosts the viewer follows (or is friends with), the last 3 weeks
    const live = new Map(data().hosts.map((H) => [H.ws, H]));
    for (const m of momentsOf()) { if (m.at < now - 21 * DAY || m.ws === myWs) continue; const H = live.get(m.ws); if (!H) continue;
      if (!followed.has(H.handle) && !friends.has(H.owner)) continue;
      out.push({ kind: "standing", at: m.at, type: m.type, text: m.text, emoji: m.emoji, link: m.link, who: { name: H.name, handle: H.handle, emoji: H.emoji || "🎉", color: H.color } }); }
    // the viewer's own standing, if they're a host in the top 10 somewhere this month
    const mine = myWs && live.get(myWs);
    if (mine) { const R0 = ranksOf(mine.handle)[0];
      if (R0) { const b = R0._b, third = b.entries[2], P = RULES.points;
        const could = R0.rank > 3 && R0._events < P.eventCap && third && R0._raw + P.event > third._raw;
        const next = (R()?.of?.(mine.handle)?.next || [])[0];
        out.push({ kind: "you-rank", at: Math.min(now, weekStart(now) + 9 * 3600e3 + 1), rank: R0.rank, text: could ? `You're #${R0.rank} in ${R0.place}. One more event this month could put you in the top 3.` : `You're #${R0.rank} in ${R0.place} this month.`, next: could ? "" : next?.text || "", link: R0.url }); } }
    return out;
  }
  return { data, reset, board, find, ranksOf, defaultCity, observe, momentsOf, feedItems, publicCard, rules: () => RULES };
}

export function mountLeaderboard(app, { store, C, X, sendStatic }) {
  const L = makeLeaderboard({ store, C, X });
  app.locals.leaderboard = L;
  // the signed-in feed asks for its extra items here (server/social.js, /api/me/feed)
  app.locals.leaderboardFeed = (u, F) => L.feedItems(u, F);
  app.get("/leaderboard", (req, res) => sendStatic(res, "leaderboard.html", "<p>Leaderboard missing.</p>"));
  app.get("/api/public/leaderboard/card", (req, res) => { let card = null; try { card = L.publicCard(clean(req.query.city, 60)); } catch {} res.set("Cache-Control", "public, max-age=120").json({ card }); });
  app.get("/api/public/host/:handle/rank", (req, res) => { let R = []; try { R = L.ranksOf(String(req.params.handle || "")); } catch {}
    res.set("Cache-Control", "public, max-age=120").json({ ranks: R.slice(0, 3).map(({ rank, city, category, period, text, url }) => ({ rank, city, category, period, text, url })) }); });
  return L;
}
