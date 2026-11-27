// Potto's picks: the moment someone starts creating an event, places and ideas that fit what they're planning.
//
// Where it shows: inside the create canvas (public/canvas.js, below the title) and on /start (below "What is it").
// A calm panel, never a popup: it opens only after the person picks a kind or types, never covers the invite, and the
// X hides it for this event. Fixed-height skeletons hold its space while picks load, so nothing below it moves.
//
// The pure part (INTENTS, intentOf, nudges, fmtDist) runs without a page: server/placesuggest.js loads this file for
// the same reading of the words, and test/place-suggest.test.js runs it in Node.
//   intentOf({ text, planKind, headcount }) -> { key, label, heading, cover, n, birthday, atHome, with: ["Sam"] } | null
//   The title's words win (the earliest one: "5K, coffee after" is a run), then the kind picked, then the top idea from
//   the autocomplete bank (public/autocomplete.js) for a half-typed word ("coff" reads as coffee).
//
// Providers, one panel for all of them:
//   PLSuggestPlaces.register(kind, provider) adds a section for an intent (kind is an intent key: "run", "coffee", ...).
//   provider = { id, title, load(ctx) -> Promise<{ items, attribution?, note? }>, replace?, onPick?(item, api) }
//   ctx = { intent, text, n, where: { mode, label, city, lat?, lng? }, server(body) } ; server() asks the server's
//   provider of the same id (registered with app.locals.placeSuggest.register), which alone knows a private home area.
//   An item: { name, hood?, city?, distanceM?, why: [one or two short lines], label, source, mapsUrl?, lat?, lng?,
//   fill?: { meetPoint, venueName, city, hood, placePublic, coverKind } }. Names and numbers come only from data.
// Data: POST /api/place-suggest (server/placesuggest.js). The home area is set in Settings (public/homearea.js).
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ================= the pure bits =================
  // key, words, the canvas kinds that mean it, the panel heading, the cover drawing (public/eventart.js)
  const INTENTS = [
    { key: "coffee", label: "Coffee", re: /\b(coffee|caf[eé]s?|espresso|latte|matcha|cortado|flat white)\b/i, kinds: [], heading: "Cafés", cover: "coffee" },
    { key: "brunch", label: "Brunch", re: /\b(brunch|breakfast|pancakes?|bagels?)\b/i, kinds: ["brunch"], heading: "Brunch spots", cover: "coffee" },
    { key: "drinks", label: "Drinks", re: /\b(drinks?|happy hour|wine|cocktails?|beers?|pints?|pub|bar|aperitivo)\b/i, kinds: ["drinks"], heading: "Bars and wine bars", cover: "wine" },
    { key: "dinner", label: "Dinner", re: /\b(dinner|supper|dumplings?|tacos?|pizza|pasta|hot ?pot|ramen|sushi|feast|potluck)\b/i, kinds: ["dinner", "table", "potluck"], heading: "Restaurants", cover: "dinner" },
    { key: "picnic", label: "Picnic", re: /\b(picnic|bbq|barbecue|frisbee)\b/i, kinds: ["picnic"], heading: "Parks", cover: "picnic" },
    { key: "games", label: "Games", re: /\b(board ?games?|game night|games|mahjong|poker|trivia|card games|catan|chess|d&d|dnd)\b/i, kinds: ["game"], heading: "Board-game cafés and park tables", cover: "games" },
    { key: "class", label: "Class", re: /\b(pottery|ceramics|clay|wheel throwing|workshop|class|painting|life drawing|candle making|flower arranging)\b/i, kinds: ["class"], heading: "Studios", cover: "craft" },
    { key: "run", label: "Run", re: /\b(run|runs|running|5k|10k|jog|run club)\b/i, kinds: ["run"], heading: "Parks to start from", cover: "run" },
    { key: "hike", label: "Hike", re: /\b(hike|hiking|trail)\b/i, kinds: ["hike"], heading: "Parks and trails", cover: "hike" },
    { key: "book", label: "Book club", re: /\b(book club|reading club)\b/i, kinds: ["book"], heading: "Cafés for a book club", cover: "book" },
    { key: "watch", label: "Watch party", re: /\b(watch party|super bowl|world cup|the game|the match|the finals)\b/i, kinds: ["watch"], heading: "Bars with screens", cover: "party" },
  ];
  const BY = Object.fromEntries(INTENTS.map((x) => [x.key, x]));
  const BDAY = /\b(birthday|bday|b-day)\b/i;
  const HOME = /\b(?:at|in) (?:my|our) (?:place|apartment|flat|house|home|backyard|garden|rooftop|kitchen)\b|\bat (?:mine|home|ours)\b|\bpotluck\b/i;
  const NOT_NAMES = new Set(["Me", "My", "The", "A", "An", "Friends", "Everyone", "Work", "Family", "You"]);
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  /** Names after "with": "coffee with Sam", "drinks with Ana and Jun". Capitalised words only, at most 6. */
  function withNames(t) { const m = /\bwith ((?:[A-Z][\p{L}'-]+)(?:(?:,\s*|\s+and\s+|\s*&\s*)[A-Z][\p{L}'-]+){0,5})/u.exec(String(t || "")); if (!m) return [];
    return [...new Set(m[1].split(/,\s*|\s+and\s+|\s*&\s*/).map((x) => x.trim()).filter((x) => x && !NOT_NAMES.has(x)))].slice(0, 6); }
  /** How many: "dinner for 6", "6 friends", else the kind's number when it was set by hand. */
  function countOf(t, fallback = 0) { const s = String(t || ""); const m = /\bfor (\d{1,3})\b(?!\s*(?:am|pm|:|hours?|mins?))/i.exec(s) || /\b(\d{1,3})\s*(?:friends|people|guests|of us)\b/i.exec(s); const n = m ? +m[1] : 0; return n >= 2 && n <= 200 ? n : +fallback || 0; }
  /** What they're planning, from the words first, then the kind, then the autocomplete bank. Pure. */
  function intentOf({ text = "", planKind = "", headcount = 0, bank = null } = {}) {
    const t = String(text || "").replace(/\s+/g, " ").trim(); let best = null, at = Infinity;
    for (const I of INTENTS) { const m = I.re.exec(t); if (m && m.index < at) { best = I; at = m.index; } }
    if (best && best.key === "brunch" && /\bcoffee\b/i.test(t) && !/\bbrunch\b/i.test(t)) best = BY.coffee;
    if (!best && planKind) { if (planKind === "brunch") best = /\bbrunch|breakfast\b/i.test(t) ? BY.brunch : BY.coffee; else best = INTENTS.find((I) => I.kinds.includes(planKind)) || null; }
    if (!best && t.length >= 3 && bank && typeof bank.rank === "function") { try { const top = bank.rank(t, { kind: "idea", limit: 1 })[0]; if (top && top.score >= 60) for (const I of INTENTS) if (I.re.test(top.text)) { best = I; break; } } catch {} }
    const birthday = BDAY.test(t); if (!best && birthday) best = BY.dinner;
    if (!best) return null;
    return { key: best.key, label: best.label, heading: best.heading, cover: best.cover, n: countOf(t, headcount), birthday, atHome: HOME.test(t) || planKind === "potluck", with: withNames(t) };
  }
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  /** The next given weekday from tomorrow on, as YYYY-MM-DD. */
  function nextDay(k, now = new Date()) { const n = DAYS.indexOf(k), d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); while (d.getDay() !== n) d.setDate(d.getDate() + 1); return isoOf(d); }
  const hasSection = (W, title) => (W.sections || []).some((s) => String(s.title || "").toLowerCase() === title.toLowerCase());
  /** One or two quick, useful nudges for the intent. Each is { id, text, cta, patch }; patch says what one tap changes:
   *  { date, startTime, why, askDiet, kind, section: {icon,title,body}, bring: [..], addon }. Pure. can: what the page
   *  can change (/start has no kinds, sections or questions). */
  function nudges(I, W = {}, { now = new Date(), can = {} } = {}) {
    if (!I) return []; const out = [], c = { kind: true, diet: true, section: true, bring: true, ...can }, n = I.n || +W.headcount || 0, desc = String(W.why || "").trim();
    const time = (id, text, cta, day, hm) => { if (W.date && W.startTime === hm) return; out.push({ id, text, cta, patch: { ...(W.date ? {} : { date: nextDay(day, now) }), startTime: hm } }); };
    if (I.birthday && c.section && !hasSection(W, "A group gift")) out.push({ id: "gift", text: "For a birthday, one group gift beats six small ones. I can add a line asking who's in.", cta: "Add the gift line", patch: { section: { icon: "gift", title: "A group gift", body: "We're chipping in for one present. Reply if you'd like to join, and I'll share the total after." } } });
    switch (I.key) {
      case "coffee": if (n <= 3) time("time", "Weekday mornings usually work for coffee. Tuesday at 9:30?", "Use Tue 9:30", "tue", "09:30"); else time("time", "Saturday mid-morning suits a bigger coffee.", "Use Sat 10:30", "sat", "10:30");
        if (!desc) out.push({ id: "line", text: "A short line helps people say yes. Something like: \"Coffee, just us. I'll save a table.\"", cta: "Use this line", patch: { why: "Coffee, just us. I'll save a table." } }); break;
      case "brunch": time("time", "Brunch spots fill up after 11. Booking for 10:30 is usually easier.", "Use Sun 10:30", "sun", "10:30");
        if (n >= 5 && c.kind && W.planKind !== "table") out.push({ id: "table", text: `For ${n}, booking ahead helps. Book a table keeps the count and the deposit straight.`, cta: "Make it a booking", patch: { kind: "table" } }); break;
      case "drinks": time("time", "Starting at 6:30 lets people come straight from work.", "Use Thu 6:30pm", "thu", "18:30");
        if (!desc) out.push({ id: "line", text: "Say what the first round looks like, so nobody wonders.", cta: "Add \"First round's on me\"", patch: { why: "First round's on me. Come when you can." } }); break;
      case "dinner": if (I.atHome) { if (c.diet && W.askDiet !== true) out.push({ id: "diet", text: "Cooking? Ask what people don't eat, so the menu works for everyone.", cta: "Ask about food", patch: { askDiet: true } }); if (c.bring && !(W.bring || []).length) out.push({ id: "bring", text: "A short bring list saves a lot of texts.", cta: "Add \"Something to drink\"", patch: { bring: ["Something to drink"] } }); break; }
        if (n >= 5 && c.kind && W.planKind !== "table") out.push({ id: "table", text: `A table for ${n} is easier booked ahead. Book a table keeps the count and splits the bill.`, cta: "Make it a booking", patch: { kind: "table" } });
        if (c.diet && W.askDiet !== true) out.push({ id: "diet", text: "Ask what people don't eat, so the place works for everyone.", cta: "Ask about food", patch: { askDiet: true } }); break;
      case "picnic": if (c.section && !hasSection(W, "If it rains")) out.push({ id: "rain", text: "Outdoors depends on the weather. Check the forecast the day before, and add a rain plan now so nobody has to ask.", cta: "Add a rain plan", patch: { section: { icon: "note", title: "If it rains", body: "If rain is forecast, we'll move it. I'll message everyone by 10am on the day." } } });
        if (c.bring && !(W.bring || []).some((x) => /blanket/i.test(x))) out.push({ id: "bring", text: "Ask everyone to bring something to share and a blanket.", cta: "Add to the bring list", patch: { bring: ["Something to share", "A blanket"] } }); break;
      case "games": if (c.bring && !(W.bring || []).some((x) => /game/i.test(x))) out.push({ id: "bring", text: "Ask people to bring a game they can teach in five minutes.", cta: "Add to the bring list", patch: { bring: ["A game you can teach in five minutes"] } });
        time("time", "Game nights tend to start around 7:30, after dinner.", "Use Fri 7:30pm", "fri", "19:30"); break;
      case "class": if (c.section && !hasSection(W, "What's included")) out.push({ id: "incl", text: "Say what's included, like clay, tools and firing, so the price makes sense.", cta: "Add what's included", patch: { addon: "included" } }); break;
      case "book": if (!desc) out.push({ id: "line", text: "Name the book and one question, so people can come ready.", cta: "Add a starter line", patch: { why: "This month's book is up to you. Finished or not, come." } }); break;
      case "run": break; // pace groups and the route live in the run's own blocks (public/runtemplates.js, Routes near you)
      case "hike": if (c.bring && !(W.bring || []).length) out.push({ id: "bring", text: "Water, good shoes and a snack: worth saying.", cta: "Add to the bring list", patch: { bring: ["Water", "Good shoes", "A snack"] } }); break;
      case "watch": time("time", "Doors 30 minutes before kick-off gets everyone a seat.", "Use Sun 6pm", "sun", "18:00"); break;
    }
    return out.slice(0, 2);
  }
  /** "8 min walk" up to half an hour on foot, then "3.2 km away" (or miles in the US). */
  function fmtDist(m, imperial = false) { if (!(m >= 0)) return ""; if (m <= 2400) return `${Math.max(1, Math.round(m / 80))} min walk`; return imperial ? `${(m / 1609.34).toFixed(1)} mi away` : `${(m / 1000).toFixed(1)} km away`; }
  /** A link that opens the place in a maps app: the provider's own link, else Apple Maps on Apple devices, else Google Maps search. */
  function mapsUrl(it, apple = false) { if (/^https:\/\//.test(it?.mapsUrl || "")) return it.mapsUrl; const q = [it?.name, it?.hood, it?.city].filter(Boolean).join(", ");
    if (apple) return "https://maps.apple.com/?q=" + encodeURIComponent(it?.name || q) + (Number.isFinite(it?.lat) ? `&ll=${it.lat},${it.lng}` : "&address=" + encodeURIComponent(q));
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q); }

  const CLIENT = new Map(); // kind -> [provider]
  /** Add a provider for an intent (see the top of the file). Returns a function that removes it. */
  function register(kind, provider) { if (!kind || !provider || typeof provider.load !== "function") throw new Error("PLSuggestPlaces.register(kind, { id, title, load })");
    const p = { id: String(provider.id || kind), title: String(provider.title || "More ideas"), ...provider }; const L = (CLIENT.get(kind) || []).filter((x) => x.id !== p.id); L.push(p); CLIENT.set(kind, L); try { redraw(); } catch {} return () => { CLIENT.set(kind, (CLIENT.get(kind) || []).filter((x) => x !== p)); try { redraw(); } catch {} }; }
  const pure = { INTENTS, intentOf, withNames, countOf, nudges, nextDay, fmtDist, mapsUrl, register, providers: (k) => [...(CLIENT.get(k) || [])] };
  const prev = root.PLSuggestPlaces; root.PLSuggestPlaces = { ...(prev || {}), ...pure };
  let redraw = () => {};
  if (typeof document === "undefined") return;

  // ================= the panel =================
  const q = (s, el) => el.querySelector(s), qa = (s, el) => [...el.querySelectorAll(s)];
  const apple = /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent || "") && (navigator.maxTouchPoints > 0 || /iP(hone|ad|od)/.test(navigator.userAgent));
  const imperial = /^en-US$/i.test(navigator.language || "") || /United States/.test(Intl.DateTimeFormat?.().resolvedOptions?.().timeZone || "") || /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage)/.test(Intl.DateTimeFormat?.().resolvedOptions?.().timeZone || "");
  const G = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const IX = `<svg ${G}><path d="M5 5l10 10M15 5 5 15"/></svg>`, IPIN = `<svg ${G}><path d="M10 17.5c-3.6-4.2-5.4-7.2-5.4-9.6a5.4 5.4 0 0 1 10.8 0c0 2.4-1.8 5.4-5.4 9.6z"/><circle cx="10" cy="7.9" r="2"/></svg>`;
  const P = { el: null, api: null, open: false, dismissed: false, I: null, mode: "auto", here: null, res: new Map(), want: "", loading: false, err: "", picked: "", t: 0, tries: 0, meta: null, scroll: {} };
  const getJ = (u, o) => fetch(u, { credentials: "same-origin", ...(o || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "http " + r.status), { status: r.status }); return j; });
  const post = (body) => getJ("/api/place-suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  getJ("/api/public/place-suggest/meta").then((m) => { P.meta = m; redraw(); }).catch(() => {});

  /** Mount the panel into el. api: { get() -> the event draft, isNew() -> bool, apply(fn, msg), pickKind?(k), say?(m), city?() -> string, can?: {...} } */
  function mount(el, api) { if (!el) return; if (api && api.session && api.session !== P.session) { Object.assign(P, { session: api.session, open: false, dismissed: false, I: null, mode: "auto", here: null, want: "", loading: false, err: "", picked: "", tries: 0, scroll: {} }); }
    P.el = el; P.api = api; css(); render(); }
  /** Something changed (a kind tap, a word typed): open the panel if there's an intent, and refresh it. */
  function poke() { if (!P.api || !P.api.isNew()) return; P.open = true; clearTimeout(P.t); P.t = setTimeout(() => { render(); load(); }, 180); }
  function intentNow() { const W = P.api?.get?.() || {}; return intentOf({ text: W.pubTitle || W.name || "", planKind: W.planKind || "", headcount: W.headcount, bank: root.PLSuggest }); }
  const W0 = () => P.api?.get?.() || {};
  function placeTyped(W) { const p = String(W.meetPoint || W.venueName || "").trim(); return p && p !== P.picked && !/^(my|our) place$/i.test(p) ? p : ""; }
  function body(extra) { const W = W0(), I = P.I; return { intent: I.key, text: String(W.pubTitle || W.name || "").slice(0, 120), kind: W.planKind || "", n: I.n || 0, birthday: !!I.birthday, mode: P.mode, place: placeTyped(W), hood: placeTyped(W) ? String(W.hood || "").slice(0, 60) : "", city: String(W.city || P.api.city?.() || "").slice(0, 60),
    with: I.with, guests: (W.guests || []).map((g) => g?.email).filter(Boolean).slice(0, 30), ...(P.mode === "here" && P.here ? { lat: P.here.lat, lng: P.here.lng } : {}), ...(extra || {}) }; }
  const keyOf = (b) => JSON.stringify([b.intent, b.mode, b.place, b.hood, b.city, b.n > 4, b.with, b.lat, b.lng, b.section || ""]);
  async function load() { const I = (P.I = intentNow()); if (!I || P.dismissed || !P.open) return render();
    if (I.atHome && ["dinner", "games", "brunch", "drinks"].includes(I.key)) return render(); // at their own place: no venue to suggest
    const b = body(), k = keyOf(b); P.want = k; if (P.res.has(k) && !P.res.get(k).pending) return render();
    P.loading = true; P.err = ""; render();
    try { const j = await post(b); if (P.want !== k) return; P.res.set(k, j); if (j.where?.mode && P.mode === "auto") P.autoMode = j.where.mode;
      if (j.pending && P.tries < 3) { P.tries++; setTimeout(() => { if (P.want === k) { P.res.delete(k); load(); } }, 1200); } else P.tries = 0; }
    catch (e) { if (P.want === k) P.err = e.status === 429 ? "That's a lot of looking. Give me a minute." : "I couldn't look nearby just now. Try again in a moment."; }
    finally { if (P.want === k) P.loading = false; render(); loadClient(I, b); } }
  // client providers for this intent (Routes near you and friends)
  const clientRes = new Map();
  function loadClient(I, b) { for (const p of pure.providers(I.key)) { const k = p.id + keyOf(b); if (clientRes.has(k)) continue; clientRes.set(k, { pending: true });
      const res = P.res.get(keyOf(b)) || {}; const ctx = { intent: I, text: b.text, n: b.n, where: { mode: res.where?.mode || b.mode, label: res.where?.label || "", city: res.where?.city || b.city, ...(P.here && b.mode === "here" ? { lat: P.here.lat, lng: P.here.lng } : {}), ...(res.where?.public ? { lat: res.where.lat, lng: res.where.lng } : {}) }, server: (x) => post({ ...b, ...(x || {}), section: p.id }) };
      Promise.resolve().then(() => p.load(ctx)).then((r) => clientRes.set(k, { items: (r?.items || []).slice(0, 5), attribution: r?.attribution || "", note: r?.note || "" })).catch(() => clientRes.set(k, { items: [], note: "Nothing to show here yet." })).finally(render); } }

  // ---- drawing ----
  const SK = () => `<ul class="psg-row" aria-hidden="true">${"<li class=\"psg-c psg-sk\"><i></i><i></i><i></i><i></i></li>".repeat(3)}</ul>`;
  function card(it, i, sec) { const meta = [it.hood, Number.isFinite(it.distanceM) && !(it.why || []).some((w) => /min walk|away$/.test(w)) ? fmtDist(it.distanceM, imperial) : ""].filter(Boolean).join(" · "), picked = P.picked && P.picked === it.name, href = mapsUrl(it, apple);
    return `<li class="psg-c${picked ? " on" : ""}"><span class="psg-b${/Pottery Lab/.test(it.label || "") ? " pl" : ""}">${esc(it.label || "Nearby")}</span><b class="psg-n">${esc(it.name)}</b>${meta ? `<span class="psg-m">${esc(meta)}</span>` : ""}
      ${(it.why || []).slice(0, 2).map((w) => `<span class="psg-w">${esc(w)}</span>`).join("")}
      <span class="psg-a"><button type="button" class="psg-use" data-psg-pick="${esc(sec)}:${i}" aria-pressed="${picked}">${picked ? "Picked" : "Use this"}</button><a class="psg-map" href="${esc(href)}" target="_blank" rel="noopener" aria-label="Open ${esc(it.name)} in Maps">${IPIN}<span>Map</span></a></span></li>`; }
  function section(id, title, r, loading) { const items = r?.items || [];
    const inner = loading && !items.length ? SK() : items.length ? `<ul class="psg-row" aria-label="${esc(title)}">${items.map((it, i) => card(it, i, id)).join("")}</ul>` : `<div class="psg-row psg-empty"><p>${esc(r?.note || "Nothing nearby I can vouch for yet. Try another area above.")}</p></div>`;
    return `<div class="psg-sec" data-psg-sec="${esc(id)}"><p class="psg-st">${esc(title)}</p>${inner}</div>`; }
  function render() { const el = P.el; if (!el) return; const I = P.I || (P.open ? (P.I = intentNow()) : null);
    if (!P.open || P.dismissed || !I || !P.api?.isNew?.()) { el.hidden = true; el.innerHTML = ""; return; }
    // keep the rows' scroll across redraws
    qa(".psg-row", el).forEach((r) => { const s = r.closest("[data-psg-sec]")?.dataset.psgSec; if (s) P.scroll[s] = r.scrollLeft; });
    const W = W0(), b = body(), r = P.res.get(keyOf(b)), loading = P.loading || !r || r.pending, home = I.atHome && ["dinner", "games", "brunch", "drinks"].includes(I.key);
    const N = nudges(I, W, { can: P.api.can || {} }), extra = [...(P.meta?.sections?.[I.key] || []), ...pure.providers(I.key).map((p) => ({ id: p.id, title: p.title, client: true, replace: !!p.replace }))];
    const replaced = extra.some((x) => x.replace), modes = r?.modes || [], cur = P.mode === "auto" ? r?.where?.mode || "" : P.mode;
    const chips = home ? "" : `<div class="psg-where" role="group" aria-label="Near where">${modes.length ? modes.map((m) => `<button type="button" class="psg-mode" data-psg-mode="${esc(m.id)}" aria-pressed="${m.id === cur}">${esc(m.label)}</button>`).join("") : r ? "" : `<span class="psg-mode psg-sk" aria-hidden="true"></span><span class="psg-mode psg-sk" aria-hidden="true"></span>`}<button type="button" class="psg-mode" data-psg-mode="here" aria-pressed="${cur === "here"}">Use my location</button></div>`;
    const line = home ? "At your place, so no venue needed. A couple of things that help:" : P.err ? P.err : r?.where?.line ? `${I.heading} ${r.where.line}` : `${I.heading} near you`;
    const secs = home ? "" : (replaced ? "" : section("places", r?.sections?.[0]?.title || "Places", r?.sections?.[0], loading)) + extra.map((x) => { const sr = x.client ? clientRes.get(x.id + keyOf(b)) : r?.sections?.find((s) => s.id === x.id); return section(x.id, x.title, sr, x.client ? !sr || sr.pending : loading); }).join("");
    const attrib = home ? "" : [...new Set([...(r?.attribution || []), ...extra.map((x) => (x.client ? clientRes.get(x.id + keyOf(b))?.attribution : "")).filter(Boolean)])];
    el.hidden = false; el.className = (el.className.replace(/\bpsg\b/g, "") + " psg").trim();
    el.innerHTML = `<header class="psg-h"><div><h3 id="psgH">Potto's picks</h3><p class="psg-l" role="status">${esc(line)}</p></div><button type="button" class="psg-x" data-psg-x aria-label="Hide Potto's picks">${IX}</button></header>
      ${chips}${secs}
      ${N.length ? `<ul class="psg-nudges" aria-label="Ideas from Potto">${N.map((n) => `<li><span>${esc(n.text)}</span><button type="button" class="psg-nb" data-psg-nudge="${esc(n.id)}">${esc(n.cta)}</button></li>`).join("")}</ul>` : ""}
      ${attrib && attrib.length ? `<p class="psg-src">${attrib.map((a) => /OpenStreetMap/.test(a) ? `Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>` : esc(a)).join(". ")}</p>` : home ? "" : `<p class="psg-src"></p>`}`;
    el.setAttribute("aria-labelledby", "psgH"); el.setAttribute("role", "region");
    qa(".psg-row", el).forEach((row) => { const s = row.closest("[data-psg-sec]")?.dataset.psgSec; if (s && P.scroll[s]) row.scrollLeft = P.scroll[s]; });
    if (!el.__psg) { el.__psg = 1; el.addEventListener("click", onClick); } }
  redraw = render;

  async function onClick(e) { const b = e.target.closest("button"); if (!b || !P.el?.contains(b)) return; e.stopPropagation();
    if (b.hasAttribute("data-psg-x")) { P.dismissed = true; render(); P.api.say?.("Hidden for this event."); try { P.api.afterDismiss?.(); } catch {} return; }
    if (b.dataset.psgMode) { const m = b.dataset.psgMode;
      if (m === "here") { b.disabled = true; b.textContent = "Finding you…"; const r = await locate(); b.disabled = false; if (!r.ok) { P.err = r.message || "I couldn't read your location. Pick another area."; render(); return; } P.here = { lat: Math.round(r.lat * 1000) / 1000, lng: Math.round(r.lng * 1000) / 1000 }; }
      P.mode = m; P.err = ""; load(); return; }
    if (b.dataset.psgNudge) { const n = nudges(P.I, W0(), { can: P.api.can || {} }).find((x) => x.id === b.dataset.psgNudge); if (n) applyNudge(n); return; }
    if (b.dataset.psgPick) { const [sec, i] = b.dataset.psgPick.split(":"), r = P.res.get(keyOf(body())), I = P.I; let it = null, prov = null;
      if (sec === "places" || r?.sections?.some((s) => s.id === sec)) it = (r?.sections || []).find((s) => s.id === sec)?.items?.[+i];
      if (!it) { prov = pure.providers(I.key).find((p) => p.id === sec); it = prov && clientRes.get(prov.id + keyOf(body()))?.items?.[+i]; }
      if (!it) return; if (prov?.onPick) { prov.onPick(it, P.api); return; } pick(it); } }
  function pick(it) { const f = it.fill || {}, I = P.I, name = String(f.meetPoint || it.name || "").slice(0, 120); P.picked = name;
    P.api.apply((W) => { W.meetPoint = name; if (f.venueName) W.venueName = f.venueName; const city = f.city || it.city; if (city && !String(W.city || "").trim()) W.city = city; const hood = f.hood || it.hood; if (hood) W.hood = hood;
      if (f.venueAddr && !String(W.venueAddr || "").trim()) W.venueAddr = f.venueAddr; if (f.placePublic !== false) W.placePublic = true;
      const ck = f.coverKind || I?.cover; if (ck && !W.coverPhoto && !W.coverArt?.kind) W.coverArt = { ...(W.coverArt || {}), kind: ck }; }, `${name}: set as the place. Tap Where to change it.`); }
  function applyNudge(n) { const p = n.patch || {};
    if (p.kind) { if (P.api.pickKind) P.api.pickKind(p.kind); return; }
    if (p.addon) { if (P.api.openAddon) P.api.openAddon(p.addon); return; }
    P.api.apply((W) => { if (p.date && !W.date) W.date = p.date; if (p.startTime) W.startTime = p.startTime; if (p.why && !String(W.why || "").trim()) W.why = p.why; if (p.askDiet) W.askDiet = true;
      if (p.section) W.sections = [...(W.sections || []), p.section]; if (p.bring) W.bring = [...new Set([...(W.bring || []), ...p.bring])].slice(0, 30); }, "Done. Tap it on the page to change it."); }
  function locate() { if (root.EncorePlace?.locate) return root.EncorePlace.locate();
    return new Promise((res) => { if (!navigator.geolocation) return res({ ok: false, message: "This browser can't share your location. Pick another area." });
      navigator.geolocation.getCurrentPosition((p) => res({ ok: true, lat: p.coords.latitude, lng: p.coords.longitude }), () => res({ ok: false, message: "Location is off for this site. Pick another area." }), { maximumAge: 300e3, timeout: 15000, enableHighAccuracy: false }); }); }

  function css() { if (document.getElementById("psgCss")) return; const s = document.createElement("style"); s.id = "psgCss"; s.textContent = CSS; document.head.appendChild(s); }
  // Field Notes kit: tokens only, Plex Sans, 6px corners, 44px taps. Inside the canvas the --cv-* tokens follow its look.
  const CSS = `
.psg{--psg-ink:var(--cv-ink,var(--pl-ink,#1B1D1C));--psg-soft:var(--cv-soft,var(--pl-soft,#444845));--psg-line:var(--cv-line,var(--pl-line,#CFC8B9));--psg-line2:var(--cv-line2,var(--pl-line-strong,#1B1D1C));--psg-card:var(--cv-card,var(--pl-surface,#FAF8F3));--psg-pri:var(--pl-accent,#29489A);
  display:block;border:0;border-radius:6px;background:var(--psg-card);padding:12px 12px 10px;color:var(--psg-ink);font:400 15px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);min-width:0}
.psg[hidden]{display:none!important}
.psg button{font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;text-transform:none;letter-spacing:normal;box-shadow:none}
.psg :focus-visible{outline:2px solid var(--psg-ink)!important;outline-offset:2px}
.psg .psg-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.psg h3{margin:0;font:600 17px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--psg-ink)}
.psg .psg-l{margin:2px 0 0;font-size:14px;color:var(--psg-soft);min-height:20px}
.psg .psg-x{flex:none;width:44px;height:44px;margin:-8px -8px 0 0;display:grid;place-items:center;border:0!important;background:transparent!important;color:var(--psg-soft);border-radius:6px!important;padding:0}.psg .psg-x svg{width:18px;height:18px}
.psg .psg-where{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0;min-height:44px;align-content:flex-start}@media (max-width:560px){.psg .psg-where{min-height:96px}}
.psg .psg-mode{flex:none;min-height:44px;padding:0 14px;border-radius:6px!important;border:1px solid var(--psg-line2)!important;background:transparent!important;color:var(--psg-ink)!important;font-size:14px;font-weight:500;max-width:100%;text-align:center;display:inline-flex;align-items:center;justify-content:center;margin:0}
.psg .psg-mode[aria-pressed=true]{background:var(--psg-ink)!important;color:var(--psg-card)!important;border-color:var(--psg-ink)!important}
.psg span.psg-mode.psg-sk{width:112px;border-color:var(--psg-line)!important}
.psg .psg-sec{margin-top:10px}.psg .psg-st{margin:0 0 6px;font-size:13px;font-weight:600;color:var(--psg-soft)}
.psg .psg-row{list-style:none;margin:0 -12px;padding:0 12px 4px;display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x proximity;scroll-padding-inline:12px;height:236px;box-sizing:border-box;scrollbar-width:thin}
.psg .psg-c{flex:none;width:244px;height:228px;box-sizing:border-box;scroll-snap-align:start;border:1px solid var(--psg-line);border-radius:6px;background:var(--cv-field,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:3px;overflow:hidden}
.psg .psg-c.on{border-color:var(--psg-pri);box-shadow:inset 0 0 0 1px var(--psg-pri)}
.psg .psg-b{align-self:flex-start;font-size:12px;font-weight:600;line-height:20px;padding:0 6px;border-radius:6px;background:var(--pl-raised,#E6E1D5);color:var(--psg-ink)}.psg .psg-b.pl{background:var(--pl-accent-soft,#E3E8F4);color:var(--pl-accent-text,#29489A)}
.psg .psg-n{font-size:16px;font-weight:600;line-height:1.3;margin-top:2px;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.psg .psg-m{font-size:14px;color:var(--psg-soft)}.psg .psg-w{font-size:14px;color:var(--psg-ink);line-height:1.35}
.psg .psg-a{margin-top:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.psg .psg-use,.psg .psg-map{min-height:44px;border-radius:6px!important;border:1px solid var(--psg-line2)!important;background:transparent!important;color:var(--psg-ink)!important;font-size:15px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;margin:0;padding:0 8px;box-sizing:border-box}
.psg .psg-use[aria-pressed=true]{border-color:var(--psg-pri)!important;color:var(--psg-pri)!important}.psg .psg-map svg{width:16px;height:16px}
@media (hover:hover){.psg .psg-use:hover,.psg .psg-map:hover,.psg .psg-mode:not([aria-pressed=true]):hover{background:var(--pl-raised,#E6E1D5)!important}}
.psg .psg-sk{background:var(--cv-field,#fff)}.psg li.psg-sk i{display:block;height:14px;border-radius:6px;background:var(--pl-raised,#E6E1D5);margin:6px 0}.psg li.psg-sk i:nth-child(1){width:40%}.psg li.psg-sk i:nth-child(2){width:80%;height:18px}.psg li.psg-sk i:nth-child(3){width:60%}.psg li.psg-sk i:nth-child(4){width:70%}
@media (prefers-reduced-motion:no-preference){.psg .psg-sk i,.psg span.psg-mode.psg-sk{animation:psgPulse 1.4s ease-in-out infinite}@keyframes psgPulse{50%{opacity:.55}}}
.psg .psg-empty{align-items:center;justify-content:center;text-align:center;border:1px dashed var(--psg-line);border-radius:6px;margin:0;padding:12px}.psg .psg-empty p{margin:0;color:var(--psg-soft);font-size:14px}
.psg .psg-nudges{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px}
.psg .psg-nudges li{display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px dashed var(--psg-line);padding-top:8px;font-size:14px;line-height:1.4}
.psg .psg-nb{flex:none;min-height:44px;padding:0 12px;border-radius:6px!important;border:1px solid var(--psg-line2)!important;background:transparent!important;color:var(--psg-ink)!important;font-size:14px;font-weight:600;max-width:46%;white-space:normal;text-align:center;margin:0}
.psg .psg-src{margin:8px 0 0;font-size:12px;color:var(--psg-soft);min-height:17px}.psg .psg-src a{color:inherit}
`;
  root.PLSuggestPlaces = { ...root.PLSuggestPlaces, mount, poke, render: () => render(), state: () => ({ open: P.open, dismissed: P.dismissed, intent: P.I?.key || "", mode: P.mode }) };
  for (const f of root.__plPicksQ || []) { try { f(root.PLSuggestPlaces); } catch (e) { console.warn(e); } } root.__plPicksQ = { push: (f) => { try { f(root.PLSuggestPlaces); } catch (e) { console.warn(e); } } };
})(typeof window !== "undefined" ? window : globalThis);
