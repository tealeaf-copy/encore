// What kind of thing it is, at a glance: one small type tag on every event, drop and booking card and page.
// The same everywhere (a host's own brand kit never recolours it), so guests learn it once. Each tag carries a line
// icon and the type word as well as its colour, so colour is never the only signal.
//
// - EventTypes.typeOf(x): the type key for an event, drop, booking or card ("popup", "pickup", ...), "event" when unsure.
//   Reads, in order: a key the server already worked out (x.etype), a booking, a drop, what the host picked in
//   "What are you planning?" (planKind), what the event has (a booked table, an agenda, a place to stay), the cover the
//   host picked, then words in the title and activity.
// - EventTypes.tag(x, { quiet }): the tag's HTML (<span class="pl-type pl-type--popup">icon Pop-up</span>).
// - EventTypes.chip(k, pressed): a filter chip in the same colours (Discover, the map).
// - TYPES, KIND (every known kind to its type), LABEL, PLURAL, ICON.
// Colours are tokens in public/system.css (--pl-type-<key>-bg / -fg); test/event-types.test.js checks each pair
// passes AA for small text. The server uses this same file (server/eventtypes.js), so emails and link previews agree.
(function (root) {
  if (root.EventTypes) return;
  const TYPES = ["popup", "pickup", "party", "dinner", "class", "active", "games", "trip", "talk", "booking", "event"];
  const LABEL = { popup: "Pop-up", pickup: "Pickup", party: "House party", dinner: "Dinner", class: "Class", active: "Active", games: "Games", trip: "Trip", talk: "Talk", booking: "Experience", event: "Event" };
  const PLURAL = { popup: "Pop-ups", pickup: "Pickups", party: "House parties", dinner: "Dinners", class: "Classes", active: "Active", games: "Games", trip: "Trips", talk: "Talks", booking: "Experiences", event: "Everything else" };
  // a line under each, for a title attribute or the help page
  const LINE = { popup: "A one-off stall, market or tasting, open to anyone", pickup: "Order ahead, pick up at a set time", party: "At someone's place", dinner: "A seated meal, at home or a table booked",
    class: "Learn something hands-on", active: "A run, a hike, a walk, a ride", games: "Games, a hack night, a watch party", trip: "A weekend away", talk: "Talks, panels, a summit", booking: "Booked for a team or a brand", event: "Everything else" };
  // the same hex as the tokens in public/system.css, for emails and anywhere the stylesheet isn't (keep them in step)
  const COLOR = { popup: ["#F6DED3", "#93300F"], pickup: ["#F3E7A8", "#5C4A00"], party: ["#F2DCE5", "#86294F"], dinner: ["#F1E1CA", "#743F0C"], class: ["#E5E0F0", "#4D3D80"],
    active: ["#DEE6D2", "#3A5527"], games: ["#D6E6EE", "#1D5273"], trip: ["#D5EAE3", "#1C5A4E"], talk: ["#E7E2D8", "#4A433C"], booking: ["#E3E8F4", "#29489A"], event: ["#EAE6DC", "#444845"] };
  // line icons on a 20 grid, drawn in the text colour (the bag, pencil and calendar are the system.css glyphs; the
  // plate, mic and car are public/kinds.js's)
  const ICON = {
    popup: "M3 8.2 4.6 4h10.8L17 8.2zM3 8.2a2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.7 0M4.6 10.5v6h10.8v-6M8.6 16.5v-3.5h2.8v3.5",
    pickup: "M4.5 7h11l-1 9.5h-9zM7.5 7V5.5a2.5 2.5 0 0 1 5 0V7",
    party: "M3 9.3 10 3.5l7 5.8M5 8v8.5h10V8M8.5 16.5v-4h3v4",
    dinner: "M6 3v5a2 2 0 0 0 4 0V3M8 3v14M14 17V3c-1.7 0-3 2-3 5s1.3 3 3 3",
    class: "M12.8 3.8l3.4 3.4-9 9H3.8v-3.4zM11 5.6l3.4 3.4",
    active: "M2.5 16.5 7.8 8l3.2 4.8 2.2-3 4.3 6.7zM12.5 4.5a1.6 1.6 0 1 0 .01 0",
    games: "M5.5 3.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM7.3 7.3h.01M12.7 7.3h.01M10 10h.01M7.3 12.7h.01M12.7 12.7h.01",
    trip: "M4 13.5V10l1.6-4h8.8L16 10v3.5zM4 13.5V16h2.5v-2.5M13.5 13.5V16H16v-2.5M4 10h12",
    talk: "M7.5 3h5v9h-5zM5 10a5 5 0 0 0 10 0M10 15v2.5",
    booking: "M5.5 4.5h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM3.5 8.5h13M7 3v3M13 3v3M7.6 12.4l1.7 1.6 3.2-3.4",
    event: "M5.5 4.5h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM3.5 8.5h13M7 3v3M13 3v3",
  };
  // every kind the code knows, to one type: "What are you planning?" (public/canvas.js, server/kinds.js PLAN_KINDS),
  // the drawings (public/eventart.js), the map's categories (server/map.js), event formats, drops and bookings.
  // A kind here that says "event" is known and left neutral on purpose (a coffee isn't a house party).
  const KIND = {
    // what are you planning?
    dinner: "dinner", table: "dinner", supper: "dinner", supperclub: "dinner", potluck: "dinner", brunch: "dinner", lunch: "dinner", meal: "dinner", food: "dinner", cook: "dinner", taco: "dinner", dumpling: "dinner", turkey: "dinner", heart: "dinner",
    drop: "pickup", preorder: "pickup", pickup: "pickup", order: "pickup", shop: "pickup",
    popup: "popup", "pop-up": "popup", market: "popup", stall: "popup", tasting: "popup", sale: "popup", swap: "popup", giveaway: "popup", fair: "popup",
    party: "party", house: "party", houseparty: "party", "house-party": "party", home: "party", hangout: "party", gather: "party", birthday: "party", celebration: "party", fireworks: "party", tree: "party", holiday: "party", new: "party",
    class: "class", workshop: "class", lesson: "class", craft: "class", pottery: "class", paint: "class", garden: "class", museum: "event", course: "class",
    run: "active", hike: "active", walk: "active", bike: "active", ride: "active", yoga: "active", swim: "active", climb: "active", sport: "active", active: "active", outdoors: "active", tour: "active",
    game: "games", games: "games", gamenight: "games", hack: "games", hacknight: "games", tech: "games", laptop: "games", controller: "games", screen: "games", watch: "games", watchparty: "games", trivia: "games",
    weekend: "trip", trip: "trip", getaway: "trip", retreat: "trip", travel: "trip", compass: "trip",
    summit: "talk", conference: "talk", talk: "talk", panel: "talk", meetup: "talk", salon: "talk", book: "talk", bookclub: "talk", lecture: "talk",
    booking: "booking", booked: "booking", experience: "booking", team: "booking", offsite: "booking",
    // known, and neutral on purpose
    coffee: "event", cafe: "event", bake: "event", tea: "event", wine: "event", drinks: "event", music: "event", movie: "event", dance: "event", picnic: "event", park: "event", leaf: "event", lantern: "event", pin: "event", social: "event", other: "event", event: "event",
  };
  // the map's old categories (server/map.js catOf), for links and saved filters that still say them
  const CAT = { supper: "dinner", games: "games", run: "active", workshop: "class", drop: "pickup", market: "popup" };
  // words, strongest first: a drop before a pop-up, a supper club before a tasting, a class before a dinner
  const WORDS = [
    ["pickup", /\bpre-?orders?\b|\border ahead\b|\bpick ?ups?\b|\bdrops?\b(?![- ]in\b)|\bcake box\b/],
    ["dinner", /\bsupper club\b|\btasting menu\b|\bomakase\b/],
    ["popup", /\bpop-?ups?\b|\bmarkets?\b|\bstalls?\b|\bflea\b|\bbazaar\b|\bswap\b|\bbake sale\b|\btasting\b|\bsampling\b|\btrunk show\b|\bmakers? fair\b/],
    ["trip", /\bweekend away\b|\bgetaway\b|\broad ?trip\b|\btrip\b|\bretreat\b|\bcabin\b|\bcamping\b/],
    ["talk", /\bsummit\b|\bconference\b|\bpanel\b|\bfireside\b|\btalks?\b|\blecture\b|\bsalon\b|\bmeetup\b|\bbook club\b|\bq&a\b|\bkeynote\b|\blanguage exchange\b/],
    ["class", /\bclass(es)?\b|\bworkshops?\b|\blessons?\b|\bcourse\b|\bpottery\b|\bceramics?\b|\bwheel throwing\b|\bknit(ting)?\b|\bsewing\b|\bcalligraphy\b|\bikebana\b|\bbouquet\b/],
    ["games", /\bgame nights?\b|\bboard ?games?\b|\bgames?\b|\btrivia\b|\bmahjong\b|\bpoker\b|\bchess\b|\bd&d\b|\bdnd\b|\bhack ?nights?\b|\bhackathon\b|\bbuild night\b|\blan party\b|\bvideo ?games?\b|\bwatch ?party\b|\bquiz\b/],
    ["active", /\bruns?\b|\brunning\b|\brun club\b|\b5k\b|\b10k\b|\bjog(ging)?\b|\bhikes?\b|\bhiking\b|\btrail\b|\bwalks?\b|\bstroll\b|\bbike\b|\bcycling\b|\byoga\b|\bpilates\b|\bswim\b|\bclimb(ing)?\b|\bbouldering\b|\bpickleball\b|\btennis\b|\bsoccer\b/],
    ["dinner", /\bdinners?\b|\bsupper\b|\bfeast\b|\bbrunch\b|\bpotluck\b|\bbanquet\b|\blunch\b|\bfriendsgiving\b|\bthanksgiving\b/],
    ["party", /\bhouse party\b|\bparty\b|\bhousewarming\b|\bbirthday\b|\bkickback\b|\bat (my|our) place\b/],
  ];
  const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();
  const kindKey = (s) => lc(s).replace(/[\s_]+/g, "");
  const valid = (k) => TYPES.includes(k);
  /** The type key for an event, a drop, a booking or a card made from one. Pure. */
  function typeOf(x) {
    x = x && typeof x === "object" ? x : {};
    if (valid(x.etype)) return x.etype;
    if (x.bookingId || x.forCompany || x.booked === true || lc(x.kind) === "experience" || lc(x.kind) === "booking") return "booking";
    const pk = kindKey(x.planKind);
    if (pk === "drop" || x.drop || x.preorder || lc(x.kind) === "drop") return "pickup";
    if (pk && KIND[pk] && KIND[pk] !== "event") return KIND[pk];
    if (x.reservation && typeof x.reservation === "object" && lc(x.reservation.restaurant)) return "dinner";
    if (["summit", "conference"].includes(lc(x.kind)) || (x.agenda && Array.isArray(x.agenda.sessions) && x.agenda.sessions.length)) return "talk";
    if ((x.lodging && typeof x.lodging === "object" && (x.lodging.name || x.lodging.address)) || (Array.isArray(x.beds) && x.beds.length)) return "trip";
    if (CAT[x.cat]) return CAT[x.cat];
    const text = lc([x.pubTitle, x.title, x.name, x.activity, x.format, x.dinnerTheme, x.category, ...(Array.isArray(x.tags) ? x.tags : [])].filter((v) => typeof v === "string").join(" "));
    for (const [k, re] of WORDS) if (re.test(text)) return k;
    const art = x.coverArt && typeof x.coverArt === "object" ? kindKey(String(x.coverArt.kind || "").split("+")[0]) : "";
    if (art && KIND[art] && KIND[art] !== "event") return KIND[art];
    const act = kindKey(x.activity);
    if (act && KIND[act]) return KIND[act];
    return "event";
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (k, size = 14) => `<svg class="pl-type__i" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICON[k] || ICON.event}"/></svg>`;
  /** The tag's HTML: an icon and the type word on the type's tint. x is an event-like object or a type key. */
  function tag(x, o = {}) { const k = typeof x === "string" ? (valid(x) ? x : "event") : typeOf(x);
    return `<span class="pl-type pl-type--${k}${o.cls ? " " + esc(o.cls) : ""}" data-type="${k}">${icon(k)}<span>${esc(LABEL[k])}</span></span>`; }
  /** A filter chip in the type's colours. */
  const chip = (k, pressed, attr = "data-type") => `<button type="button" class="pl-type-chip pl-type--${valid(k) ? k : "event"}" ${attr}="${esc(k)}" aria-pressed="${!!pressed}">${icon(valid(k) ? k : "event", 16)}<span>${esc(PLURAL[k] || LABEL[k] || k)}</span></button>`;
  /** The types present in a list, in the platform's order: for a row of filter chips that never offers an empty one. */
  const present = (list) => { const have = new Set((list || []).map(typeOf)); return TYPES.filter((k) => have.has(k)); };
  root.EventTypes = { TYPES, LABEL, PLURAL, LINE, COLOR, ICON, KIND, CAT, typeOf, labelOf: (x) => LABEL[typeof x === "string" && valid(x) ? x : typeOf(x)], tag, chip, icon, present, valid };
})(typeof window !== "undefined" ? window : globalThis);
