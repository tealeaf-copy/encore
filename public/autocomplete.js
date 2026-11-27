// Potto's autocomplete: wherever someone types an idea for an event or a place, a tap finishes the thought.
//
// PLSuggest.attach(input, { kind, city, onPick, maxLen }) on any input or textarea:
//   kind: "idea" (an event title or plan), "kind" (a short name for a kind of thing), "alert" (what Watching looks for),
//         "ask" (a question for Potto), "post" (a feed post), "place" (where it happens) or "city".
//   city: the person's city (a string or a function), so places and ideas lean local.
//   onPick(item, input): after a pick fills the field; item can carry structure (k, day, time, place, city, title).
// On a wide screen: ghost text after the caret (Tab, right arrow or a tap on it takes it) and up to 5 rows under the
// field. On a phone: one row of suggestions above the keyboard. Both overlay the page (nothing moves), never take focus
// and never change what was typed until a pick. Combobox and listbox roles, aria-activedescendant, Escape closes.
//
// Local first, so it's instant and works offline: the phrase bank below, the person's own picks and past events, the
// type tags (public/eventtypes.js), and cities and neighbourhoods (server/geo.js through /api/public/suggest/places,
// kept on this device; accents and case don't matter; "nyc", "sf", "la" and friends work). Then, after a short pause and
// 3+ characters, Potto (POST /api/suggest, server/suggest.js) adds smarter ones. It gets only the typed text, the city
// and the field kind. Settings has "Suggestions from Potto" (pl.suggestPotto); off keeps the local ones.
// The pure part (bank, rank, rankPlaces) runs without a page too: server/suggestbank.js and the tests load this file.
(function (root) {
  if (root.PLSuggest && root.PLSuggest.attach) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  /** "São Paulo!" -> "sao paulo". Case, accents, apostrophes and punctuation don't count. */
  const norm = (s) => fold(s).replace(/[’'`]/g, "").replace(/[^a-z0-9#$ ]+/g, " ").replace(/\s+/g, " ").trim();

  // ================= the phrase bank =================
  // [text, plan kind (public/canvas.js PLAN_KINDS), structure]. Structure is only what the words already say: the day
  // (sun..sat), the time (HH:MM), the place, the city it belongs to (dest: where a trip goes), and a shorter title.
  const I = (t, k, x) => ({ t, k, ...(x || {}) });
  const NY = "New York", SF = "San Francisco", LA = "Los Angeles";
  const IDEAS = [
    I("Dinner at my place", "dinner", { place: "My place" }), I("Dinner for 6 at my place Friday 7pm", "dinner", { day: "fri", time: "19:00", place: "My place", n: 6, title: "Dinner for 6" }),
    I("Dinner party", "dinner"), I("Dinner for four", "dinner", { n: 4 }), I("Dinner out, I booked a table", "table"), I("Dumpling night", "dinner"), I("Supper club", "dinner"),
    I("Supper club, seven courses", "dinner"), I("Sunday supper", "dinner", { day: "sun" }), I("Taco night", "dinner"), I("Pasta night", "dinner"), I("Pizza night", "dinner"), I("Hot pot night", "dinner"),
    I("Friendsgiving", "dinner"), I("Birthday dinner", "dinner"), I("Dinner and a movie", "dinner"),
    I("Drinks after work", "drinks", { time: "18:30" }), I("Drinks on a rooftop", "drinks"), I("Wine night", "drinks"), I("Happy hour Friday 6pm", "drinks", { day: "fri", time: "18:00", title: "Happy hour" }),
    I("Brunch at mine Sunday 11am", "brunch", { day: "sun", time: "11:00", place: "My place", title: "Brunch at mine" }), I("Coffee, just us", "brunch"), I("Coffee walk Saturday morning", "brunch", { day: "sat", time: "09:30", title: "Coffee walk" }),
    I("Game night", "game"), I("Game night Friday 7:30pm", "game", { day: "fri", time: "19:30", title: "Game night" }), I("Board game night", "game"), I("Trivia night", "game"), I("Poker night", "game"),
    I("Mahjong night", "game"), I("Card games and snacks", "game"),
    I("Pottery class", "class"), I("Pottery class for beginners", "class"), I("Pottery night, wheel and wine", "class"), I("Painting class", "class"), I("Cooking class", "class"),
    I("Sourdough workshop", "class"), I("Flower arranging class", "class"), I("Candle making workshop", "class"),
    I("Potluck at mine", "potluck", { place: "My place" }), I("Potluck picnic", "potluck"),
    I("Picnic in the park", "picnic"), I("Picnic in Prospect Park Sunday noon", "picnic", { day: "sun", time: "12:00", place: "Prospect Park", city: NY, title: "Picnic in Prospect Park" }),
    I("Picnic in Dolores Park Saturday 1pm", "picnic", { day: "sat", time: "13:00", place: "Dolores Park", city: SF, title: "Picnic in Dolores Park" }), I("Sunset picnic", "picnic"),
    I("Book club", "book"), I("Book club, first meeting", "book"), I("Silent book club", "book"),
    I("Run club Saturday 8am", "run", { day: "sat", time: "08:00", title: "Run club" }), I("Easy 5K in Prospect Park Saturday 8am", "run", { day: "sat", time: "08:00", place: "Prospect Park", city: NY, title: "Easy 5K in Prospect Park" }),
    I("Run in Prospect Park, coffee after", "run", { place: "Prospect Park", city: NY }), I("Run in Central Park Sunday 9am", "run", { day: "sun", time: "09:00", place: "Central Park", city: NY, title: "Run in Central Park" }),
    I("Run in Golden Gate Park Saturday 8am", "run", { day: "sat", time: "08:00", place: "Golden Gate Park", city: SF, title: "Run in Golden Gate Park" }), I("Run along the Embarcadero", "run", { place: "The Embarcadero", city: SF }),
    I("Run in Griffith Park Sunday 8am", "run", { day: "sun", time: "08:00", place: "Griffith Park", city: LA, title: "Run in Griffith Park" }), I("Morning run, every pace", "run"), I("Walk and coffee", "run"),
    I("Hike this weekend, rides to share", "hike"), I("Sunrise hike", "hike"),
    I("Watch party", "watch"), I("Movie night", "watch"), I("Watch the game at mine", "watch", { place: "My place" }),
    I("Pop-up market", "popup"), I("Clothes swap", "popup"), I("Plant swap", "popup"), I("Bake sale", "popup"),
    I("Cookie drop, pick up Saturday", "drop", { day: "sat" }), I("Bread drop, order ahead", "drop"), I("Pickup: order ahead, pick up Friday", "drop", { day: "fri" }),
    I("Vegas for a 30th", "weekend", { dest: "Las Vegas" }), I("Vegas weekend, who's in?", "weekend", { dest: "Las Vegas" }), I("Vegas for a birthday, three nights", "weekend", { dest: "Las Vegas" }),
    I("A weekend upstate", "weekend"), I("Cabin weekend", "weekend"), I("Beach weekend", "weekend"), I("Ski trip", "weekend"), I("Bachelorette weekend", "weekend"), I("Lake house weekend", "weekend"),
    I("Hack night", "hack"), I("Hack night #1, bring a laptop", "hack"), I("A small summit", "summit"),
    I("Birthday party", "other"), I("Housewarming", "other"), I("Karaoke night", "other"), I("Dance party", "other"), I("Craft night", "other"), I("Volunteer morning", "other"),
  ];
  // what brands and teams book (server/brandpanel.js GOALS), a little lower unless the field is a brand's
  const BRAND = [I("Team offsite", "weekend", { b: 1 }), I("Team offsite, two days upstate", "weekend", { b: 1 }), I("Customer dinner", "dinner", { b: 1 }), I("Team bonding night", "game", { b: 1 }),
    I("Holiday party", "other", { b: 1 }), I("Launch party", "other", { b: 1 }), I("Office breakfast", "brunch", { b: 1 }), I("Team lunch", "dinner", { b: 1 }), I("Wellness morning, yoga and coffee", "class", { b: 1 }),
    I("Conference week happy hour", "drinks", { b: 1 }), I("Workshop for the team", "class", { b: 1 })];
  // "Something else": what is it? (24 characters)
  const KINDS = ["Clothes swap", "Plant swap", "Supper club", "Karaoke", "Mahjong", "Bake sale", "Craft night", "Sound bath", "Trivia", "Dance class", "Tasting", "Open studio", "Listening party",
    "Writing group", "Knitting circle", "Film club", "Volunteer day", "Birthday", "Housewarming", "Pottery class"].map((t) => I(t, "other"));
  // Watching (public/feed.html, server/social.js parseAlert reads "in my city", "near me", "within 3 miles", weekends)
  const ALERTS = ["Free game nights in my city", "Runs in my city on weekends", "Dinners within 3 miles", "Supper clubs in my city", "Pottery classes near me", "Book clubs near me", "Hikes on weekends",
    "Picnics on weekends", "Free events near me", "Trivia nights in my city", "Pop-up markets this weekend", "Run clubs near me", "Cooking classes within 5 miles", "Dinner parties in my city"].map((t) => I(t, ""));
  // Ask Potto (public/potto.js)
  const ASKS = ["Plan a dinner for 6 this Saturday", "Who hasn't replied to my dinner?", "What's on this weekend that's small and cozy?", "Find a run club near me", "Find a supper club near me",
    "Ideas for a first dinner I could host", "Write a reminder for my guests", "Write a thank-you note to everyone who came", "Help me plan a game night", "What should I bring to a potluck?",
    "Plan a weekend away for 8", "Who's going to Friday's game night?"].map((t) => I(t, ""));
  // the feed composer (public/composer.js)
  const POSTS = ["Hosting a game night Friday, who's in?", "Dumplings at mine on Friday?", "Anyone up for a run Saturday morning?", "Thank you all for coming last night", "Photos from last night",
    "Thinking about a supper club this month, who'd come?", "Picnic in the park Sunday if the sun's out", "New book club, first meeting soon"].map((t) => I(t, ""));
  // well-known spots for "run in pro" and the where field
  const SPOTS = [["Prospect Park", NY, "Brooklyn"], ["Central Park", NY, "Manhattan"], ["McCarren Park", NY, "Brooklyn"], ["Domino Park", NY, "Brooklyn"], ["Fort Greene Park", NY, "Brooklyn"],
    ["Brooklyn Bridge Park", NY, "Brooklyn"], ["Hudson River Park", NY, "Manhattan"], ["Riverside Park", NY, "Manhattan"], ["Washington Square Park", NY, "Manhattan"], ["Astoria Park", NY, "Queens"],
    ["Dolores Park", SF, ""], ["Golden Gate Park", SF, ""], ["Crissy Field", SF, ""], ["Alamo Square", SF, ""], ["The Presidio", SF, ""], ["Lake Merritt", SF, "Oakland"],
    ["Griffith Park", LA, ""], ["Echo Park Lake", LA, ""], ["Venice Beach", LA, ""], ["Hyde Park", "London", ""], ["Victoria Park", "London", ""], ["Hampstead Heath", "London", ""], ["London Fields", "London", ""],
    ["Lincoln Park", "Chicago", ""], ["Millennium Park", "Chicago", ""], ["Zilker Park", "Austin", ""], ["Lady Bird Lake", "Austin", ""], ["Green Lake", "Seattle", ""], ["Discovery Park", "Seattle", ""],
    ["Centennial Park", "Sydney", ""], ["Bondi Beach", "Sydney", ""], ["Tempelhofer Feld", "Berlin", ""], ["High Roller", "Las Vegas", ""]];
  // more names for cities, on top of public/place.js's own ("brooklyn", "sf", ...)
  const ALIAS = { "New York": "new york city|nyc|ny|manhattan|brooklyn|queens|bronx", "San Francisco": "sf|san fran|bay area", "Los Angeles": "la|l a|socal", "Washington": "dc|washington dc",
    "Philadelphia": "philly", "Chicago": "chi", "Austin": "atx", "Las Vegas": "vegas|lv", "New Orleans": "nola", "Mexico City": "cdmx", "London": "ldn", "São Paulo": "sao paulo|sp", "Bangalore": "bengaluru" };
  // cities the app's list (public/place.js) doesn't have yet, so trips and travel still complete
  const EXTRA = [["Las Vegas", 36.17, -115.14], ["New Orleans", 29.95, -90.07], ["Phoenix", 33.45, -112.07], ["Detroit", 42.33, -83.05], ["Pittsburgh", 40.44, -79.99], ["Baltimore", 39.29, -76.61],
    ["Salt Lake City", 40.76, -111.89, "slc"], ["Charleston", 32.78, -79.93], ["Savannah", 32.08, -81.09], ["Palm Springs", 33.83, -116.55], ["Honolulu", 21.31, -157.86], ["Tulum", 20.21, -87.47]];
  // a few cities to stand in when nothing else has loaded (first visit, offline, no public/place.js on the page)
  const CORE = [["New York", 40.71, -74.01], ["Los Angeles", 34.05, -118.24], ["San Francisco", 37.77, -122.42], ["Chicago", 41.88, -87.63], ["Boston", 42.36, -71.06], ["Seattle", 47.61, -122.33],
    ["Austin", 30.27, -97.74], ["Washington", 38.91, -77.04], ["Philadelphia", 39.95, -75.17], ["Miami", 25.76, -80.19], ["London", 51.51, -0.13], ["Paris", 48.86, 2.35], ["Berlin", 52.52, 13.4], ["Toronto", 43.65, -79.38], ["Sydney", -33.87, 151.21]];

  // ================= places: cities with every name they go by, neighbourhoods, spots =================
  /** { cities: [{ name, al: [normalised aliases] }], hoods: [{ hood, area, city }], spots } from what's known. */
  function placeData(given) {
    const g = given || {}, byName = new Map();
    const add = (name, al) => { if (!name) return; const k = norm(name); const c = byName.get(k) || { name, al: [] }; for (const a of String(al || "").split("|").map(norm).filter(Boolean)) if (!c.al.includes(a) && a !== k) c.al.push(a); byName.set(k, c); };
    const P = root.EncorePlace && Array.isArray(root.EncorePlace.CITIES) ? root.EncorePlace.CITIES : null;
    for (const c of [...(Array.isArray(g.cities) ? g.cities : []), ...(P || []), ...CORE, ...EXTRA]) { if (Array.isArray(c)) add(c[0], c[3]); else if (c && c.name) add(c.name, Array.isArray(c.al) ? c.al.join("|") : c.al); }
    for (const [name, al] of Object.entries(ALIAS)) add(name, al);
    for (const c of byName.values()) { const n = norm(c.name); if (fold(c.name) !== n && !c.al.includes(norm(fold(c.name)))) c.al.push(norm(fold(c.name))); }
    const hoods = (Array.isArray(g.hoods) ? g.hoods : []).map((h) => (Array.isArray(h) ? { hood: h[0], area: h[1] || h[2], city: h[2] || h[1] } : h)).filter((h) => h && h.hood && h.city);
    return { cities: [...byName.values()], hoods, spots: SPOTS.map(([name, city, area]) => ({ name, city, area: area || city })) };
  }
  /** The city we know for a name ("brooklyn" -> "New York"), or "". */
  function cityOf(name, data) { const n = norm(name); if (!n) return ""; const D = data && data.cities ? data : placeData(data);
    const c = D.cities.find((x) => norm(x.name) === n) || D.cities.find((x) => x.al.includes(n)); if (c) return c.name; const h = D.hoods.find((x) => norm(x.hood) === n); return h ? h.city : ""; }
  const TOWNS = ["brooklyn", "queens", "bronx", "manhattan", "oakland", "berkeley", "cambridge", "somerville"];
  const sameCity = (a, b, D) => !!a && !!b && (norm(a) === norm(b) || cityOf(a, D) === cityOf(b, D) && !!cityOf(a, D));

  // ================= matching and ranking =================
  /** How well a candidate fits what's typed: 100ish for "starts with it", 60 to 80 for each word starting in order, 35 inside. */
  function matchScore(cand, q) {
    const c = norm(cand); if (!q || !c) return 0;
    if (c === q) return 90;
    if (c.startsWith(q)) return 100 - Math.min(16, (c.length - q.length) / 5);
    const qt = q.split(" "), ct = c.split(" "); let j = 0, first = -1;
    for (let i = 0; i < qt.length; i++) { const last = i === qt.length - 1; let hit = -1;
      for (let k = j; k < ct.length; k++) if (last ? ct[k].startsWith(qt[i]) : ct[k] === qt[i] || (ct[k].startsWith(qt[i]) && qt[i].length >= 3)) { hit = k; break; }
      if (hit < 0) { j = -1; break; } if (first < 0) first = hit; j = hit + 1; }
    if (j > 0) return 62 + (first === 0 ? 12 : 0) + Math.min(6, q.length);
    if (q.length >= 3 && c.includes(q)) return 35;
    return 0;
  }
  /** What a candidate adds after what's typed, when it starts with it (case and accents aside): the ghost text. */
  function completion(typed, cand) { const t = String(typed || ""), c = String(cand || ""); if (!t || c.length <= t.length) return "";
    for (let i = 0; i < t.length; i++) if (fold(t[i]) !== fold(c[i])) return ""; return c.slice(t.length); }
  const titleCase = (s) => String(s || "").replace(/\b[a-z]/g, (m) => m.toUpperCase());
  const GROUP = { idea: "idea", kind: "idea", alert: "alert", ask: "ask", post: "post", place: "place", city: "city", search: "search" };

  /** Places for what's typed. kind "city" fills a city (a neighbourhood or nickname finds its city); "place" fills the
   *  spot itself ("Greenpoint, Brooklyn", "Prospect Park"). o: { kind, city, places, history, eventCities, limit } */
  function rankPlaces(q, o = {}) {
    const qn = norm(q); if (!qn) return [];
    const D = o.places && o.places.cities && o.places.hoods ? o.places : placeData(o.places), kind = o.kind === "place" ? "place" : "city", mine = o.city ? cityOf(o.city, D) || o.city : "", out = new Map();
    const ev = new Map((o.eventCities || []).map((x) => [norm(typeof x === "string" ? x : x.city), typeof x === "string" ? 1 : +x.n || 1]));
    const put = (it) => { const k = norm(it.text); const cur = out.get(k); if (!cur || cur.score < it.score) out.set(k, it); };
    const local = (city) => (mine && city && cityOf(city, D) === cityOf(mine, D) ? 12 : 0) + (ev.has(norm(city)) ? 4 + Math.min(6, ev.get(norm(city))) : 0);
    for (const c of D.cities) { let s = matchScore(c.name, qn), hint = "";
      for (const a of c.al) { if (s >= 96) break; if (a === qn) { s = Math.max(s, qn.length <= 3 ? 101 : 96); hint = qn.length > 3 && !norm(c.name).split(" ").includes(a) ? titleCase(a) : ""; } else if (qn.length >= 2 && a.startsWith(qn)) { if (s < 86) { s = 86; hint = a.length > 3 ? titleCase(a) : ""; } } }
      if (s) put({ text: c.name, value: c.name, city: c.name, hint: hint && norm(hint) !== norm(c.name) ? hint : kind === "place" ? "City" : "", score: s + local(c.name), src: "city" });
      // a borough or a city next door people say as their city ("Brooklyn", "Oakland") is a fine answer too
      if (kind === "city") for (const a of c.al) if (TOWNS.includes(a)) { const sa = matchScore(a, qn); if (sa >= 60) put({ text: titleCase(a), value: titleCase(a), city: c.name, hint: c.name, score: sa - 2 + local(c.name), src: "area" }); } }
    for (const h of D.hoods) { const s = matchScore(h.hood, qn), sa = h.area !== h.city ? matchScore(h.area, qn) : 0; if (!s && sa < 70) continue;
      if (kind === "city") put({ text: h.city, value: h.city, city: h.city, hint: s ? h.hood : h.area, score: Math.max(s, sa) - 14 + local(h.city), src: "hood" });
      else { const label = norm(h.hood) === norm(h.area) ? h.hood : `${h.hood}, ${h.area}`; put({ text: label, value: label, city: h.city, hood: h.hood, hint: h.area !== h.city ? h.city : "", score: (s ? s - 4 : sa - 30) + local(h.city), src: "hood" }); } }
    if (kind === "place") {
      const areas = new Map(); for (const h of D.hoods) if (h.area !== h.city) areas.set(norm(h.area), h); for (const h of areas.values()) { const s = matchScore(h.area, qn); if (s) put({ text: h.area, value: h.area, city: h.city, hint: h.city, score: s + 1 + local(h.city), src: "area" }); }
      for (const p of D.spots) { const s = matchScore(p.name, qn); if (s) put({ text: p.name, value: p.name, city: p.city, place: p.name, hint: p.area, score: s - 2 + local(p.city) - (mine && cityOf(mine, D) !== p.city ? 8 : 0), src: "spot" }); }
      for (const t of ["My place", "Our place", "A park near me"]) { const s = matchScore(t, qn); if (s) put({ text: t, value: t, score: s - 6, src: "bank" }); } }
    for (const h of o.history || []) { const t = typeof h === "string" ? h : h.t; const s = matchScore(t, qn); if (!s) continue; const cur = out.get(norm(t));
      put({ ...(cur || { text: t, value: t, city: cityOf(t, D) || undefined }), score: (cur ? cur.score : s) + 24 + Math.min(8, (+h.n || 1) * 2), src: cur ? cur.src : "recent", hint: cur?.hint || "Recent" }); }
    return [...out.values()].filter((x) => x.text !== String(q).trim()).sort((a, b) => b.score - a.score || a.text.length - b.text.length).slice(0, o.limit || 5);
  }

  /** Ideas (and the other phrase kinds) for what's typed. o: { kind, city, history, mine, places, extra, brand, maxLen, limit }
   *  history: [{ t, n, at }] this person picked or typed before; mine: [{ t, k }] their own events; extra: more candidates. */
  function rank(q, o = {}) {
    const kind = o.kind || "idea"; if (kind === "city" || kind === "place") return rankPlaces(q, o);
    // a search box for what or where ("pottery for 20" or a city): kinds of things and cities, side by side
    if (kind === "search") return [...rank(q, { ...o, kind: "kind" }), ...rankPlaces(q, { ...o, kind: "city" }).map((x) => ({ ...x, score: x.score - 2 }))].sort((a, b) => b.score - a.score).slice(0, o.limit || 5);
    const qn = norm(q); if (!qn) return [];
    const D = o.places && o.places.cities && o.places.hoods ? o.places : placeData(o.places), mine = o.city ? cityOf(o.city, D) || o.city : "", out = new Map(), max = o.maxLen || 0;
    const fits = (t) => !max || t.length <= max;
    const put = (it) => { if (!fits(it.text)) return; const k = norm(it.text); const cur = out.get(k); if (!cur || cur.score < it.score) out.set(k, { ...cur, ...it }); };
    const bank = kind === "alert" ? ALERTS : kind === "ask" ? ASKS : kind === "post" ? POSTS : kind === "kind" ? [...KINDS, ...IDEAS.filter((x) => x.t.length <= 24)] : [...IDEAS, ...BRAND];
    for (const b of [...bank, ...(o.extra || []).map((x) => (typeof x === "string" ? I(x, "") : { ...x, t: x.t || x.text }))]) {
      let s = matchScore(b.t, qn); if (!s) continue;
      if (b.city) s += mine ? (cityOf(b.city, D) === cityOf(mine, D) ? 10 : -12) : 0;
      if (b.b && !o.brand) s -= 6; else if (b.b && o.brand) s += 6;
      const { t, ...rest } = b; put({ ...rest, text: t, value: t, score: s, src: b.src || "bank" }); }
    // "run in pro", "dinners in brook": finish the place after in, at, near or around
    const m = /^(.*\b(?:in|at|near|around)\s+)([^,]{2,30})$/i.exec(String(q || "")); if (m && !/^(?:my|our|the|a|an)\b/i.test(m[2].trim())) {
      for (const p of rankPlaces(m[2], { kind: "place", city: o.city, places: D, limit: 4 })) { const name = p.src === "hood" ? p.hood || p.text : p.text; if (!name || norm(name) === norm(m[2])) continue;
        const text = m[1] + name; put({ text, value: text, place: p.src === "city" ? undefined : name, city: p.city, hint: p.hint || p.city || "", score: 97 - completion(q, text).length / 8 - (p.score < 90 ? 6 : 0) + (p.score > 100 ? 2 : 0), src: "place" }); } }
    for (const e of o.mine || []) { const t = typeof e === "string" ? e : e.t; const s = matchScore(t, qn); if (!s) continue; const cur = out.get(norm(t));
      put({ ...(cur || {}), text: t, value: t, k: (cur && cur.k) || e.k || "", score: (cur ? cur.score : s) + 20, src: cur ? cur.src : "mine", hint: "You hosted" }); }
    for (const h of o.history || []) { const t = typeof h === "string" ? h : h.t; const s = matchScore(t, qn); if (!s) continue; const cur = out.get(norm(t)), days = h.at ? (Date.now() - h.at) / 864e5 : 30;
      put({ ...(cur || {}), ...(h.k ? { k: h.k } : {}), text: t, value: t, score: (cur ? cur.score : s) + 30 + Math.min(9, (+h.n || 1) * 3) + (days < 7 ? 4 : 0), src: cur && cur.src !== "bank" ? cur.src : "recent", hint: cur && cur.hint ? cur.hint : "Recent" }); }
    const ET = root.EventTypes, typed = norm(q);
    return [...out.values()].filter((x) => norm(x.text) !== typed).sort((a, b) => b.score - a.score || a.text.length - b.text.length).slice(0, o.limit || 5)
      .map((x) => { if (!x.hint && ET && ET.typeOf && x.k && (kind === "idea" || kind === "kind")) { try { const k = ET.typeOf({ planKind: x.k, pubTitle: x.text }); if (k && k !== "event") x.hint = ET.LABEL[k]; } catch {} } return x; });
  }
  /** Potto's items (the server's) folded into the local ones: they rank by fit too, and up to two always show. */
  function merge(local, potto, q, limit = 5) {
    const qn = norm(q), seen = new Set(local.map((x) => norm(x.text))), P = [];
    for (const p of potto || []) { const t = String(p.text || "").trim(); if (!t || seen.has(norm(t)) || norm(t) === qn) continue; seen.add(norm(t)); P.push({ ...p, text: t, value: t, src: "potto", hint: p.hint || "Potto", score: Math.max(matchScore(t, qn), 72) + 2 }); }
    const by = (a, b) => b.score - a.score, top = [...local, ...P].sort(by).slice(0, limit);
    for (const p of P.slice(0, 2)) { if (top.includes(p)) continue; let at = -1; for (let i = top.length - 1; i >= 0; i--) if (top[i].src !== "potto") { at = i; break; }
      if (top.length < limit) top.push(p); else if (at >= 0) top[at] = p; }
    return top.sort((a, b) => b.score - a.score);
  }

  // ================= this device: picks and past entries, settings =================
  const HKEY = "pl.suggest.v1", MKEY = "pl.suggest.mine", PKEY = "pl.suggest.places", OFF = "pl.suggestPotto";
  const ls = { get(k) { try { return JSON.parse(root.localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  function history(kind) { const H = ls.get(HKEY) || {}; const L = H[GROUP[kind] || kind]; return Array.isArray(L) ? L.filter((x) => x && typeof x.t === "string") : []; }
  /** Remember what this person picked or typed, for this kind of field: 30 at most, the latest first. */
  function remember(kind, text, item) { const t = String(text || "").replace(/\s+/g, " ").trim().slice(0, 90); if (t.length < 3) return; const g = GROUP[kind] || kind, H = ls.get(HKEY) || {}, L = Array.isArray(H[g]) ? H[g] : [];
    const old = L.find((x) => norm(x.t) === norm(t)); H[g] = [{ t, n: (old ? old.n : 0) + 1, at: Date.now(), ...(item && item.k ? { k: item.k } : old && old.k ? { k: old.k } : {}) }, ...L.filter((x) => x !== old)].slice(0, 30); ls.set(HKEY, H); }
  /** "Suggestions from Potto" in Settings: on unless turned off. Off keeps the local ones. */
  const pottoOn = () => { try { return root.localStorage.getItem(OFF) !== "0"; } catch { return true; } };
  const setPotto = (on) => { try { root.localStorage.setItem(OFF, on ? "1" : "0"); } catch {} };

  const pure = { norm, fold, matchScore, completion, rank, rankPlaces, merge, placeData, cityOf, sameCity, history, remember, pottoOn, setPotto, IDEAS, BRAND, KINDS, ALERTS, ASKS, POSTS, SPOTS, ALIAS, EXTRA };
  root.PLSuggest = pure;
  if (typeof document === "undefined" || typeof root.addEventListener !== "function") return;

  // ================= the page =================
  const reduce = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const phone = () => !!root.matchMedia?.("(pointer: coarse)").matches && root.innerWidth < 700;
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie || "");
  // what this device knows about places (server/geo.js), kept a week; event cities with things coming up
  let PLACES = null, EVC = [];
  function places() { if (PLACES) return PLACES; const kept = ls.get(PKEY); PLACES = placeData(kept && kept.v === 1 ? kept : null);
    if (!kept || kept.v !== 1 || Date.now() - (kept.at || 0) > 7 * 864e5) fetch("/api/public/suggest/places", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j || !Array.isArray(j.hoods)) return; ls.set(PKEY, { v: 1, at: Date.now(), cities: j.cities || [], hoods: j.hoods }); PLACES = placeData(j); }).catch(() => {});
    fetch("/api/public/places", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && Array.isArray(j.cities)) EVC = j.cities; }).catch(() => {});
    return PLACES; }
  // your own events (titles, kind, city only), signed in, kept six hours; it also carries the Settings switch across devices
  let MINE = null;
  function mine() { if (MINE) return MINE; const kept = ls.get(MKEY); MINE = kept && Array.isArray(kept.events) ? kept.events : [];
    if (signedIn() && (!kept || Date.now() - (kept.at || 0) > 6 * 36e5)) fetch("/api/suggest/mine", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j || !Array.isArray(j.events)) return; MINE = j.events; ls.set(MKEY, { at: Date.now(), events: j.events }); if (typeof j.potto === "boolean") setPotto(j.potto); }).catch(() => {});
    return MINE; }

  // ---- Potto: after a pause, 3+ characters; cached by prefix, stale ones cancelled, failures quiet ----
  const CACHE = new Map(); let backoff = 0;
  const ckey = (kind, city, t) => kind + "|" + norm(city) + "|" + norm(t);
  function cachedPotto(kind, city, t) { const hit = CACHE.get(ckey(kind, city, t)); if (hit) return hit;
    const n = norm(t); for (let i = n.length - 1; i >= 3; i--) { const p = CACHE.get(kind + "|" + norm(city) + "|" + n.slice(0, i)); if (p) { const keep = p.filter((x) => matchScore(x.text, n) >= 60); if (keep.length) return keep; } } return null; }
  async function askPotto(kind, city, text, signal) {
    const k = ckey(kind, city, text); if (CACHE.has(k)) return CACHE.get(k);
    if (Date.now() < backoff) return null;
    const r = await fetch("/api/suggest", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 120), kind, city: String(city || "").slice(0, 60) }), signal });
    if (r.status === 429) { backoff = Date.now() + 60e3; return null; } if (!r.ok) { backoff = Date.now() + 30e3; return null; }
    const j = await r.json(); if (j && j.source === "off") { setPotto(false); return null; }
    const items = Array.isArray(j && j.items) ? j.items.filter((x) => x && typeof x.text === "string").slice(0, 5) : []; if (CACHE.size > 300) CACHE.clear(); CACHE.set(k, items); return items; }

  // ---- one list, one ghost and one live region for the page (only one field has focus at a time) ----
  let UI = null, cur = null, uiDown = 0;
  function ui() { if (UI) return UI;
    const st = document.createElement("style"); st.id = "pls-ac-css"; st.textContent = CSS; document.head.appendChild(st);
    const list = document.createElement("ul"); list.id = "plsList"; list.className = "plsa-list"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Suggestions"); list.hidden = true;
    const ghost = document.createElement("div"); ghost.className = "plsa-ghost"; ghost.setAttribute("aria-hidden", "true"); ghost.hidden = true;
    const live = document.createElement("div"); live.className = "plsa-sr"; live.setAttribute("aria-live", "polite"); live.setAttribute("role", "status");
    document.body.append(list, ghost, live);
    // a press on a row or the ghost keeps focus in the field
    for (const el of [list, ghost]) { el.addEventListener("mousedown", (e) => { e.preventDefault(); uiDown = Date.now(); }); el.addEventListener("pointerdown", () => { uiDown = Date.now(); }); el.addEventListener("touchstart", () => { uiDown = Date.now(); }, { passive: true }); }
    list.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li && cur) cur.pick(+li.dataset.i); });
    ghost.addEventListener("click", (e) => { if (cur && e.target.closest(".plsa-rest,.plsa-key")) cur.pick(cur.activeIndex()); });
    const again = () => { if (cur && !list.hidden) cur.place(); }; let raf = 0; const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(again); };
    root.addEventListener("scroll", soon, true); root.addEventListener("resize", soon); root.visualViewport?.addEventListener("resize", soon); root.visualViewport?.addEventListener("scroll", soon);
    // keys first, on the window before any sheet's own Escape or Tab handling: Escape here closes the suggestions, not the sheet
    root.addEventListener("keydown", (e) => { if (cur && e.target === cur.input) cur.key(e); }, true);
    UI = { list, ghost, live }; return UI; }
  let sayT = 0; const say = (t) => { clearTimeout(sayT); sayT = setTimeout(() => { if (UI) UI.live.textContent = t; }, 450); };

  let uid = 0;
  /** Suggestions on this field. Calling it again on the same field updates the options. */
  function attach(input, opts = {}) {
    if (!input || input.nodeType !== 1 || !/^(INPUT|TEXTAREA)$/.test(input.tagName)) return null;
    if (input.__pls) { Object.assign(input.__pls.o, opts); return input.__pls; }
    const o = { kind: "idea", limit: 5, ...opts }, area = input.tagName === "TEXTAREA";
    const c = { input, o, items: [], active: -1, open: false, dismissed: null, seq: 0, timer: 0, abort: null, ghostRest: "" };
    input.__pls = c; const id = "plsIn" + ++uid; if (!input.id) input.id = id;
    // a datalist's options become candidates, and its own dropdown goes, so there's only one list
    const dl = input.getAttribute("list") && document.getElementById(input.getAttribute("list")); if (dl) { o.extra = [...(o.extra || []), ...[...dl.options].map((x) => x.value).filter(Boolean)]; input.removeAttribute("list"); }
    if (!area) input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", area ? "list" : "both"); input.setAttribute("aria-controls", "plsList"); if (!area) input.setAttribute("aria-expanded", "false");
    if (!input.getAttribute("autocomplete") || /^(on|address-level2)$/.test(input.getAttribute("autocomplete"))) input.setAttribute("autocomplete", "off");
    const city = () => { try { return String((typeof o.city === "function" ? o.city() : o.city) || root.EncorePlace?.get?.()?.city || "").trim(); } catch { return ""; } };
    const minLen = () => (o.kind === "city" || o.kind === "place" ? 2 : 2);
    c.activeIndex = () => (c.active >= 0 ? c.active : 0);
    c.local = (v) => rank(v, { kind: o.kind, city: city(), history: history(o.kind), mine: o.kind === "idea" || o.kind === "kind" ? mine() : [], places: places(), eventCities: EVC, extra: o.extra, brand: o.brand, maxLen: o.maxLen, limit: o.limit });
    c.update = (force) => { const v = input.value; if (c.composing) return;
      if (document.activeElement !== input) return c.hide(); if (c.dismissed !== null && c.dismissed === v && !force) return c.hide(); c.dismissed = null;
      const t = v.trim(); if (norm(t).length < minLen() || t.length > (o.kind === "post" || o.kind === "ask" ? 70 : 90) || /\n/.test(v.trim())) { c.stop(); return c.hide(); }
      const loc = c.local(v), pc = o.kind !== "city" && o.potto !== false && pottoOn() ? cachedPotto(o.kind, city(), v) : null;
      c.items = pc ? merge(loc, pc, v, o.limit) : loc; c.active = -1; c.draw(); c.later(v); };
    c.later = (v) => { clearTimeout(c.timer); c.stop(); if (o.kind === "city" || o.potto === false || !pottoOn() || norm(v).length < 3 || CACHE.has(ckey(o.kind, city(), v))) return;
      const my = ++c.seq; c.timer = setTimeout(async () => { const ctl = typeof AbortController === "function" ? new AbortController() : null; c.abort = ctl;
        let got = null; try { got = await askPotto(o.kind, city(), v, ctl && ctl.signal); } catch { got = null; } if (my !== c.seq || input.value !== v || document.activeElement !== input || !got || !got.length) return;
        const keepActive = c.active >= 0 ? c.items[c.active] : null; c.items = merge(c.local(v), got, v, o.limit); c.active = keepActive ? c.items.indexOf(keepActive) : -1; c.draw(); }, 300); };
    c.stop = () => { clearTimeout(c.timer); if (c.abort) { try { c.abort.abort(); } catch {} c.abort = null; } };
    c.hide = () => { const U = UI; c.open = false; c.active = -1; c.ghostRest = ""; if (!area) input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
      if (U && cur === c) { U.list.hidden = true; U.list.innerHTML = ""; U.ghost.hidden = true; } };
    c.draw = () => { const U = ui(); if (!c.items.length) return c.hide(); cur = c; c.open = true; const v = input.value, mob = phone();
      U.list.className = "plsa-list" + (mob ? " plsa-row" : "") + (reduce() ? "" : " plsa-fade"); U.list.setAttribute("aria-orientation", mob ? "horizontal" : "vertical");
      U.list.innerHTML = c.items.map((it, i) => { const rest = completion(v, it.text); const label = rest ? `<span class="plsa-typed">${esc(it.text.slice(0, v.length))}</span><b>${esc(rest)}</b>` : `<span>${esc(it.text)}</span>`;
        return `<li role="option" id="plsOpt${i}" data-i="${i}" aria-selected="${i === c.active}"${it.src === "potto" ? ' data-potto=""' : ""}><span class="plsa-t">${label}</span>${it.hint && !mob ? `<small>${esc(it.hint)}</small>` : ""}</li>`; }).join("");
      U.list.hidden = false; if (!area) input.setAttribute("aria-expanded", "true"); if (c.active >= 0) input.setAttribute("aria-activedescendant", "plsOpt" + c.active); else input.removeAttribute("aria-activedescendant");
      const top = c.items[c.activeIndex()], caretEnd = input.selectionStart === v.length && input.selectionEnd === v.length;
      c.ghostRest = !mob && caretEnd && top ? completion(v, top.text) : "";
      c.place(); say(`${c.items.length} ${c.items.length === 1 ? "suggestion" : "suggestions"}. ${c.ghostRest ? `Tab to finish: ${top.text}. ` : ""}Up and down to choose.`); };
    c.place = () => { const U = UI; if (!U || cur !== c) return; const r = input.getBoundingClientRect(), L = U.list, vv = root.visualViewport, vw = vv ? vv.width : root.innerWidth, vh = vv ? vv.height : root.innerHeight, ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0;
      if (r.bottom < 0 || r.top > root.innerHeight) { L.hidden = true; U.ghost.hidden = true; return; } L.hidden = false;
      if (phone()) { L.style.width = ""; L.style.left = ox + "px"; L.style.right = ""; L.style.maxWidth = vw + "px"; const h = L.offsetHeight || 60; let y = oy + vh - h;
        if (r.bottom > y - 4) y = Math.max(oy + 4, r.top - h - 6); L.style.top = y + "px"; }
      else { const w = Math.min(Math.max(r.width, 280), 520, vw - 16); L.style.width = w + "px"; L.style.maxWidth = ""; L.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px"; const h = L.offsetHeight;
        L.style.top = (r.bottom + 4 + h > vh - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4) + "px"; }
      const G = U.ghost; if (!c.ghostRest || (!area && input.scrollWidth > input.clientWidth + 2)) { G.hidden = true; return; }
      const cs = getComputedStyle(input); for (const p of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "textIndent", "textAlign", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing", "direction", "fontVariantLigatures"]) G.style[p] = cs[p];
      G.style.left = r.left + "px"; G.style.top = r.top + "px"; G.style.width = r.width + "px"; G.style.height = r.height + "px"; G.style.whiteSpace = area ? "pre-wrap" : "pre"; G.style.alignItems = area ? "" : "center"; G.style.display = area ? "block" : "flex";
      G.innerHTML = `<span><span class="plsa-gt">${esc(input.value)}</span><span class="plsa-rest">${esc(c.ghostRest)}</span>${root.matchMedia?.("(pointer: fine)").matches ? '<span class="plsa-key">Tab</span>' : ""}</span>`; G.hidden = false; G.scrollTop = input.scrollTop; };
    c.move = (d) => { if (!c.open) return; const n = c.items.length; c.active = c.active < 0 ? (d > 0 ? 0 : n - 1) : (c.active + d + n) % n; c.draw(); UI.list.querySelector(`[data-i="${c.active}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      const it = c.items[c.active]; if (it) say(`${it.text}${it.hint ? ", " + it.hint : ""}. ${c.active + 1} of ${n}.`); };
    c.pick = (i) => { const it = c.items[i]; if (!it) return; const val = it.value != null ? it.value : it.text; c.stop(); c.seq++;
      input.value = val; try { input.setSelectionRange(val.length, val.length); } catch {} c.dismissed = val; c.hide();
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
      remember(o.kind, val, it); say(`${val}. Filled in.`); try { o.onPick && o.onPick(it, input); } catch (e) { console.warn(e); } };
    c.key = (e) => { if (e.isComposing || c.composing) return; const k = e.key, stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (k === "ArrowDown" || k === "ArrowUp") { if (!c.open) { if (k === "ArrowDown" && input.value.trim()) { c.update(true); if (c.open) stop(); } return; } if (area && c.active < 0 && k === "ArrowUp") return; stop(); c.move(k === "ArrowDown" ? 1 : -1); return; }
      if (!c.open) return;
      if (k === "Escape") { stop(); c.dismissed = input.value; c.hide(); say("Suggestions closed."); return; }
      if (k === "Enter" && c.active >= 0 && !e.shiftKey) { stop(); c.pick(c.active); return; }
      if (c.ghostRest && ((k === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) || (k === "ArrowRight" && !e.shiftKey && input.selectionStart === input.value.length))) { stop(); c.pick(c.activeIndex()); } };
    input.addEventListener("input", () => { if (document.activeElement === input) c.update(); });
    input.addEventListener("compositionstart", () => { c.composing = true; }); input.addEventListener("compositionend", () => { c.composing = false; c.update(); });
    input.addEventListener("focus", () => { ui(); places(); if (o.kind === "idea" || o.kind === "kind") mine(); });
    input.addEventListener("click", () => { if (c.open) c.draw(); });
    input.addEventListener("blur", () => { setTimeout(() => { if (document.activeElement === input) return; if (Date.now() - uiDown < 400 && cur === c && c.open) { try { input.focus({ preventScroll: true }); } catch {} return; } c.stop(); c.hide(); if (cur === c) cur = null; }, 0); });
    // a value typed by hand and kept counts as history (an idea you've used is one you might use again)
    input.addEventListener("change", (e) => { if (e.isTrusted && input.value.trim().length >= 3 && o.kind !== "ask" && o.kind !== "post") remember(o.kind, input.value); });
    return c;
  }
  /** Close whatever list is open (a sheet closing, a page changing). */
  function close() { if (cur) { cur.stop(); cur.hide(); cur = null; } }

  const CSS = `
.plsa-list{position:fixed;z-index:2147483000;margin:0;padding:4px;list-style:none;box-sizing:border-box;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border-radius:6px;box-shadow:0 0 0 1.5px var(--pl-ink,#1B1D1C),0 12px 28px rgba(27,29,28,.14);font:400 16px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);max-height:min(60vh,236px);overflow:auto;overscroll-behavior:contain;text-align:left;letter-spacing:normal;text-transform:none}
.plsa-list[hidden]{display:none}
.plsa-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;box-sizing:border-box;padding:0 10px;border-radius:4px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.plsa-list li .plsa-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plsa-list li b{font-weight:600}.plsa-list li .plsa-typed{color:var(--pl-soft,#444845)}
.plsa-list li small{flex:none;font:500 12px/1.2 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:.02em;color:var(--pl-soft,#444845)}
.plsa-list li[data-potto] small{color:var(--pl-accent-text,#29489A)}
.plsa-list li:hover{background:var(--pl-raised,#F0ECE3)}.plsa-list li[aria-selected=true]{background:var(--pl-accent-soft,#E3E8F4);box-shadow:inset 3px 0 0 var(--pl-accent,#29489A)}
.plsa-row{display:flex;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));right:auto;width:100%;max-height:none;overflow-x:auto;overflow-y:hidden;border-radius:0;box-shadow:0 -1.5px 0 var(--pl-ink,#1B1D1C),0 -8px 20px rgba(27,29,28,.08);scrollbar-width:none;touch-action:pan-x}
.plsa-row::-webkit-scrollbar{display:none}
.plsa-row li{flex:none;max-width:78vw;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:#fff;padding:0 14px}.plsa-row li[aria-selected=true]{border-color:var(--pl-accent,#29489A);box-shadow:none}
.plsa-row li[data-potto]{border-color:var(--pl-accent,#29489A)}
.plsa-ghost{position:fixed;z-index:2147482999;pointer-events:none;overflow:hidden;margin:0;border-style:solid;border-color:transparent;background:transparent;color:transparent}
.plsa-ghost[hidden]{display:none!important}.plsa-ghost .plsa-gt{visibility:hidden}.plsa-ghost .plsa-rest{color:var(--pl-muted,#7A7F7B);pointer-events:auto;cursor:pointer}
.plsa-ghost .plsa-key{display:inline-block;margin-left:8px;padding:1px 5px;border:1px solid var(--pl-line,#CFC8B9);border-radius:4px;font:500 11px/1.4 var(--pl-font-mono,"IBM Plex Mono",ui-monospace,monospace);letter-spacing:0;color:var(--pl-soft,#444845);vertical-align:middle;pointer-events:auto;cursor:pointer;background:var(--pl-surface,#FAF8F3)}
.plsa-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:no-preference){.plsa-fade{animation:plsa-in .12s ease-out}@keyframes plsa-in{from{opacity:0}to{opacity:1}}}`;

  root.PLSuggest = { ...pure, attach, close, places, mine };
  // a page can ask before the file arrives: window.__plSuggestQ = [fn, ...]
  try { const Q = root.__plSuggestQ; root.__plSuggestQ = { push: (f) => { try { f(root.PLSuggest); } catch (e) { console.warn(e); } } }; if (Array.isArray(Q)) Q.forEach((f) => root.__plSuggestQ.push(f)); } catch {}
})(typeof window !== "undefined" ? window : globalThis);
