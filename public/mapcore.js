// PLMapCore: the map view's plain logic, with no page in it (filters, distances, dates, the sheet's snap points), so
// public/map.html and the tests (test/map.test.js) run the same code. Loaded as a script; also readable with node's vm.
(function (root) {
  if (root.PLMapCore) return;
  // the six vibes, each with its pin colour from the Field Notes palette (and the drawn object in public/pins.js)
  const VIBES = [
    { id: "cozy", label: "Cozy", color: "#C9A227" },           // lamp ochre: the highlighter, deepened
    { id: "nerdy", label: "Quiet and nerdy", color: "#29489A" }, // ink blue
    { id: "active", label: "Active", color: "#56683F" },        // moss
    { id: "food", label: "Food", color: "#C2431F" },            // tomato
    { id: "make", label: "Make something", color: "#7D93C9" },  // pencil blue: ink blue, washed
    { id: "late", label: "Late night", color: "#1B1D1C" },      // ink
  ];
  const CATS = [{ id: "supper", label: "Supper clubs" }, { id: "games", label: "Game nights" }, { id: "run", label: "Run clubs" }, { id: "workshop", label: "Workshops" }, { id: "drop", label: "Drops" }, { id: "market", label: "Markets" }];
  const WHO = [{ id: "all", label: "Everyone" }, { id: "friends", label: "Friends going" }, { id: "following", label: "Hosts I follow" }];
  const PRICES = [{ id: "free", label: "Free" }, { id: "$", label: "$" }, { id: "$$", label: "$$" }, { id: "$$$", label: "$$$" }];
  const WHEN = [{ id: "any", label: "Any time" }, { id: "tonight", label: "Tonight" }, { id: "weekend", label: "This weekend" }, { id: "week", label: "Next 7 days" }];
  const vibe = (id) => VIBES.find((v) => v.id === id) || VIBES[0];

  // ---- distance ----
  function distanceKm(a, b) { if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return null; const r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h))); }
  /** Miles where people say miles: the US, the UK, Liberia, Myanmar. Everyone else gets kilometres. */
  const usesMiles = (locale) => /^(en-(us|gb|lr)|my)(-|$)/i.test(String(locale || ""));
  const num = (x, locale, d) => { try { return x.toLocaleString(locale || "en", { maximumFractionDigits: d, minimumFractionDigits: d }); } catch { return x.toFixed(d); } };
  /** "350 m", "1.2 km", "12 km"; or "0.3 mi", "1.2 mi", "12 mi" by locale. Null in, empty out. */
  function formatDistance(km, locale) { if (km == null || !isFinite(km) || km < 0) return "";
    if (usesMiles(locale)) { const mi = km * 0.621371; return mi < 0.1 ? "0.1 mi" : mi < 10 ? `${num(Math.round(mi * 10) / 10, locale, 1)} mi` : `${num(Math.round(mi), locale, 0)} mi`; }
    if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`; return km < 10 ? `${num(Math.round(km * 10) / 10, locale, 1)} km` : `${num(Math.round(km), locale, 0)} km`; }

  // ---- dates ----
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const dow = (day) => new Date(day + "T12:00:00").getDay();
  /** Friday to Sunday of this weekend (from today when it is already the weekend). */
  function weekendOf(today) { const d = dow(today); if (d === 6) return { from: today, to: addDays(today, 1) }; if (d === 0) return { from: today, to: today }; const fri = addDays(today, 5 - d); return { from: d === 5 ? today : fri, to: addDays(fri, 2) }; }
  function whenMatches(date, when, today) { if (!when || when === "any") return true; if (!date) return false;
    if (when === "tonight") return date === today; if (when === "week") return date >= today && date <= addDays(today, 7);
    if (when === "weekend") { const w = weekendOf(today); return date >= w.from && date <= w.to; } return true; }
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const clock = (t) => { if (!/^\d{2}:\d{2}$/.test(t || "")) return ""; let h = +t.slice(0, 2); const m = t.slice(3), ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return m === "00" ? `${h} ${ap}` : `${h}:${m} ${ap}`; };
  /** "Tonight, 8 pm", "Tomorrow, 9:30 am", "Sat, 8 am", "Dec 12" (and "Went" or the date for past ones). */
  function whenLabel(date, startTime, today) { if (!date) return ""; const t = clock(startTime);
    const day = date === today ? (t && +startTime.slice(0, 2) >= 17 ? "Tonight" : "Today") : date === addDays(today, 1) ? "Tomorrow" : date > today && date <= addDays(today, 6) ? DAYS[dow(date)] : `${MON[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}`;
    return t ? `${day}, ${t}` : day; }

  // ---- filters ----
  const EMPTY = () => ({ who: "all", prices: [], vibes: [], when: "any", cat: "", mine: false });
  /** The events a set of filters keeps. ctx: { today, friends: { id: {...} }, follows: [handles], saved: [ids], went: [ids] } */
  function filterEvents(list, f = EMPTY(), ctx = {}) { const F = { ...EMPTY(), ...(f || {}) }, today = ctx.today || iso(new Date());
    const follows = new Set(ctx.follows || []), saved = new Set(ctx.saved || []), went = new Set(ctx.went || []), friends = ctx.friends || {};
    return (list || []).filter((e) => {
      if (F.mine && !(saved.has(e.id) || went.has(e.id))) return false;
      if (!F.mine && e.past) return false; // past places only belong on Your map
      if (F.who === "friends" && !friends[e.id]) return false;
      if (F.who === "following" && !follows.has(e.host?.handle)) return false;
      if (F.prices.length && !F.prices.includes(e.tier)) return false;
      if (F.vibes.length && !F.vibes.includes(e.vibe)) return false;
      if (F.cat && (e.etype || e.cat) !== F.cat) return false; // the type chips (public/eventtypes.js); the old categories still match
      if (!F.mine && !whenMatches(e.date, F.when, today)) return false;
      return true; }); }
  const activeCount = (f) => { const F = { ...EMPTY(), ...(f || {}) }; return (F.who !== "all") + !!F.prices.length + !!F.vibes.length + (F.when !== "any") + !!F.cat; };
  /** Nearest first (when we know where "here" is), else soonest. */
  function sortEvents(list, origin) { return [...list].sort((a, b) => { if (origin) { const da = distanceKm(origin, a.geo), db = distanceKm(origin, b.geo); if (da != null && db != null && Math.abs(da - db) > 0.05) return da - db; } return String(a.date || "9").localeCompare(String(b.date || "9")) || String(a.startTime).localeCompare(String(b.startTime)); }); }
  /** The fallback list: events by neighbourhood, busiest first, "Around town" for ones with no neighbourhood. */
  function groupByHood(list) { const m = new Map(); for (const e of list || []) { const k = e.hood || "Around town"; if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return [...m].map(([hood, events]) => ({ hood, events })).sort((a, b) => (a.hood === "Around town") - (b.hood === "Around town") || b.events.length - a.events.length || a.hood.localeCompare(b.hood)); }
  /** The social line under a row: friends first, then going, then saves. Counts only: never a stranger's name. */
  function proofLine(e, friend) { if (friend?.line) return friend.line; if (e.going > 0) return `${e.going} going`; if (e.saves > 0) return `Saved ${e.saves} ${e.saves === 1 ? "time" : "times"}`; return ""; }
  /** Pins that share a spot (two events from one host, a regular run) fan out in a small ring, so each can be tapped.
   * Areas move freely (they are approximate already); exact places move only when they sit on top of each other. */
  function spread(list, { within = 0.5, ring = 0.3 } = {}) { const out = {}, done = new Set();
    for (const e of list || []) { if (done.has(e.id) || !e.geo) continue; const group = (list || []).filter((x) => x.geo && !done.has(x.id) && distanceKm(e.geo, x.geo) < (x.geo.exact && e.geo.exact ? 0.03 : within));
      group.forEach((x, i) => { done.add(x.id); if (group.length === 1) { out[x.id] = { lat: x.geo.lat, lng: x.geo.lng }; return; }
        const a = (i / group.length) * 2 * Math.PI + 0.6, dLat = (ring / 111.32) * Math.sin(a), dLng = (ring / (111.32 * Math.cos((e.geo.lat * Math.PI) / 180))) * Math.cos(a);
        out[x.id] = { lat: e.geo.lat + dLat, lng: e.geo.lng + dLng }; }); }
    return out; }
  const priceLabel = (f) => (f.prices.length ? f.prices.map((p) => (p === "free" ? "Free" : p)).join(", ") : "Price");

  // ---- the bottom sheet: three snap points ----
  /** Heights (px of sheet showing) for a viewport height. */
  const snapHeights = (vh) => ({ peek: Math.round(Math.min(176, vh * 0.26)), half: Math.round(vh * 0.52), full: Math.round(vh - 64) });
  /** Where a drag lands: the nearest snap point, nudged one step by a quick flick (velocity in px/ms, positive = up). */
  function snapTo(shown, velocity, H) { const order = ["peek", "half", "full"], pts = order.map((k) => H[k]);
    if (velocity > 0.5) { const up = pts.findIndex((p) => p > shown + 8); return order[up >= 0 ? up : 2]; }
    if (velocity < -0.5) { let down = 0; pts.forEach((p, j) => { if (p < shown - 8) down = j; }); return order[down]; }
    let best = 0; pts.forEach((p, j) => { if (Math.abs(p - shown) < Math.abs(pts[best] - shown)) best = j; }); return order[best]; }

  root.PLMapCore = { VIBES, CATS, WHO, PRICES, WHEN, vibe, distanceKm, usesMiles, formatDistance, weekendOf, whenMatches, whenLabel, clock, filterEvents, activeCount, sortEvents, groupByHood, proofLine, priceLabel, spread, snapHeights, snapTo, EMPTY, today: () => iso(new Date()), addDays };
})(typeof window !== "undefined" ? window : globalThis);
