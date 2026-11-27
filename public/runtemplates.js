// New York run templates: ready-to-use runs for hosts in New York City, one tap from a template to a filled-in invite.
// Each template has a public, findable meeting spot, an approximate distance and route, pace groups, a default day
// and time, an idea for after, what to bring, a season note (dark mornings, heat) and its drawn cover. Distances are
// approximate on purpose and say so. Nothing here names a club, a shop or a brand.
//
// Pure (no page needed; server/runtemplates.js loads this file for Potto and the tests):
//   RunTemplates.LIST, byId(id), isNYC(city), toEvent(id, { today, date, time, title, repeat }), parse(text, today),
//   urlOf(id, over), fromQuery(URLSearchParams, today), signup(ev) / signupSet(ev, key, value), RUN_Q
// On a page (the app, index.html):
//   RunTemplates.sheet({ onPick, date, time, title, repeat }): the picker, a bottom sheet
//   RunTemplates.use(id, over): opens the create canvas (public/canvas.js) filled in from the template
//   the host's Home gets a "New York runs, ready to go" card when the host's city is New York (their page city, the
//   city picker, or Potto), with their followers and "Message them about the next run" (POST /api/host/announce)
//   and the Home composer reads "easy 5K in Prospect Park Saturday 8" straight into the template.
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // pace groups, written the way a run host says them
  const P = {
    easy: ["Run-walk, no rush", "Easy, 11:00 a mile or slower", "Steady, 9:30 to 11:00 a mile"],
    mixed: ["Easy, 11:00 a mile or slower", "Steady, 9:30 to 11:00 a mile", "Quicker, under 9:30 a mile"],
    tempo: ["Tempo, 9:00 a mile or slower", "Tempo, 8:00 to 9:00 a mile", "Tempo, under 8:00 a mile"],
    track: ["Easy laps", "Steady 400s", "Fast 400s"],
  };
  // d: day of the week (0 Sunday), t: start, m: minutes long, n: spots, tone: the drawn cover's colour (public/eventart.js)
  const LIST = [
    { id: "reservoir", at: "at the Reservoir", borough: "Manhattan", hood: "Central Park", park: "Central Park", title: "Reservoir loop, easy pace", short: "One or two laps of the Reservoir, soft path, big skyline.",
      spot: "Engineers' Gate, Fifth Ave at East 90th St", find: "Inside the park at the Fifth Ave and East 90th St entrance, at the foot of the path up to the Reservoir.",
      dist: "About 1.58 mi (2.5 km) a lap. Two laps is about 3.2 mi, a little over 5K.", route: "Up the path to the Jacqueline Kennedy Onassis Reservoir and around the running track. Everyone runs it counterclockwise. Soft, flat and wide.",
      paces: P.easy, d: 6, t: "08:00", m: 75, n: 15, tone: "mint", after: "Coffee and bagels nearby on Madison or Lexington. Stay as long as you like.",
      bring: ["Water", "A layer you can tie around your waist"], transit: "The 4, 5 and 6 stop at 86th St and Lexington Ave, about a 10 minute walk." },
    { id: "cp-loop", at: "in Central Park", borough: "Manhattan", hood: "Central Park", park: "Central Park", title: "Central Park full loop", short: "The whole park drive, Harlem Hill and all. A Saturday long run.",
      spot: "Merchants' Gate at Columbus Circle, by the USS Maine monument", find: "The park corner at Columbus Circle, Central Park South and Central Park West. We meet at the foot of the monument.",
      dist: "About 6.1 mi (9.8 km), one loop.", route: "One counterclockwise loop of the park drive, in the runners' lane. The long climb is Harlem Hill at the north end, then Cat Hill on the east side. Water fountains along the way in warm months.",
      paces: P.mixed, d: 6, t: "08:00", m: 105, n: 18, tone: "mint", after: "Bagels and coffee near the circle. Walk it off together.",
      bring: ["Water or a bottle to refill", "Something to eat after", "A layer for the start"], transit: "The A, B, C, D and 1 stop at 59th St-Columbus Circle." },
    { id: "hudson", at: "on the Hudson", borough: "Manhattan", hood: "Chelsea", park: "Hudson River Greenway", title: "Tuesday tempo on the Hudson", short: "Flat river path, out and back. A weekly tempo after work.",
      spot: "Hudson River Greenway at Chelsea Piers, West 23rd St", find: "On the river path across from the Chelsea Piers entrance at West 23rd St and the West Side Highway. Cross at the light.",
      dist: "About 3.1 mi (5 km) out and back. Go further and turn around later if you like.", route: "Warm up south along the river for 10 minutes, tempo out, turn around at about 2.5 km and come back. Flat the whole way. Bikes have their own lane, runners keep to the walking path.",
      paces: P.tempo, d: 2, t: "18:30", m: 60, n: 15, tone: "sky", repeat: "weekly", after: "A drink or a slice nearby, for whoever's in.",
      bring: ["Water", "A light and something bright after dark"], transit: "The C and E stop at 23rd St and 8th Ave, about a 15 minute walk west." },
    { id: "bridge", at: "over the Brooklyn Bridge", borough: "Manhattan", hood: "Civic Center", park: "Brooklyn Bridge", title: "Brooklyn Bridge sunrise run", short: "Across the bridge to DUMBO and back as the light comes up.",
      spot: "Brooklyn Bridge walkway entrance, across from City Hall Park", find: "The Manhattan end of the bridge walkway, on Centre St by Chambers St, across from City Hall Park.",
      dist: "About 2.5 mi (4 km) there and back.", route: "Over the bridge walkway to Brooklyn, a turn around at the far end, and back to Manhattan. The middle of the bridge is a gentle climb both ways. It fills up with walkers after mid-morning, so we go early and keep right.",
      paces: P.easy, d: 6, t: "06:45", m: 60, n: 15, tone: "butter", after: "Coffee in Lower Manhattan once the sun is up.",
      bring: ["A light layer", "Your phone for photos at the top"], transit: "The 4, 5 and 6 stop at Brooklyn Bridge-City Hall. The J and Z stop at Chambers St.", sunrise: true },
    { id: "prospect", at: "in Prospect Park", borough: "Brooklyn", hood: "Park Slope", park: "Prospect Park", title: "Easy loop of Prospect Park", short: "One loop of the park drive, a little over 5K. Every pace welcome.",
      spot: "Prospect Park entrance at Grand Army Plaza", find: "The main park entrance at Grand Army Plaza, where Flatbush Ave meets Prospect Park West. Look for us by the entrance.",
      dist: "About 3.35 mi (5.4 km), one loop.", route: "One loop of the park drive in the runners' lane. Rolling, with one longer climb. We regroup back at the entrance.",
      paces: P.easy, d: 6, t: "08:00", m: 75, n: 15, tone: "mint", after: "Bagels and coffee in Park Slope after.",
      bring: ["Water", "A layer you can tie around your waist"], transit: "The 2 and 3 stop at Grand Army Plaza, right at the entrance." },
    { id: "mccarren", at: "at McCarren Park", borough: "Brooklyn", hood: "Williamsburg", park: "McCarren Park", title: "McCarren track night", short: "Laps on the track in Williamsburg. Fast or slow, you're never far from the group.",
      spot: "McCarren Park running track, near Lorimer St", find: "The running track inside McCarren Park. Walk in from Lorimer St and look for the track.",
      dist: "About 3 mi (5 km) with warm-up. A lap of the track is 400 m.", route: "Two easy laps to warm up, then 6 x 400 m with an easy lap between, then a lap to cool down. If the track is busy, we loop the park instead.",
      paces: P.track, d: 3, t: "19:00", m: 60, n: 15, tone: "peach", after: "Something to drink nearby, for whoever's in.",
      bring: ["Water", "A light and something bright"], transit: "The G stops at Nassau Ave by the park. The L at Bedford Ave is about a 10 minute walk." },
    { id: "east-river", at: "on the East River", borough: "Manhattan", hood: "Yorkville", park: "East River Esplanade", title: "East River Esplanade easy run", short: "Along the water on the Upper East Side. Flat and calm on a Sunday.",
      spot: "Carl Schurz Park, East End Ave at East 86th St", find: "The park entrance at East End Ave and East 86th St. We meet just inside, then head down to the river path.",
      dist: "About 3.1 mi (5 km) out and back.", route: "Down to the East River Esplanade, north along the water, turn around and come back the same way. Flat. Parts of the path close for repairs now and then, so we go around.",
      paces: P.easy, d: 0, t: "09:00", m: 75, n: 15, tone: "sky", after: "Coffee on East End or York Ave after.",
      bring: ["Water", "A light layer for the wind off the river"], transit: "The Q stops at 86th St and 2nd Ave. The 4, 5 and 6 stop at 86th St and Lexington Ave." },
    { id: "astoria", at: "in Astoria Park", borough: "Queens", hood: "Astoria", park: "Astoria Park", title: "Astoria Park and Hell Gate loops", short: "Loops along the water under two bridges. Easy to join for one loop or three.",
      spot: "Astoria Park at Shore Blvd and Ditmars Blvd, by the Hell Gate Bridge", find: "Where Ditmars Blvd meets the park at Shore Blvd, at the north end by the Hell Gate Bridge.",
      dist: "About 3.1 mi (5 km) in loops. Do as many as feel good.", route: "Loops of the park along Shore Blvd, with the river on one side, under the Hell Gate and RFK bridges. One short climb each loop.",
      paces: P.easy, d: 0, t: "09:00", m: 75, n: 15, tone: "lilac", after: "Coffee and something to eat on Ditmars after.",
      bring: ["Water", "A layer for the wind off the river"], transit: "The N and W stop at Astoria-Ditmars Blvd, then about a 15 minute walk west on Ditmars." },
    { id: "van-cortlandt", at: "in Van Cortlandt Park", borough: "Bronx", hood: "Van Cortlandt Park", park: "Van Cortlandt Park", title: "Van Cortlandt Park trail run", short: "Grass and trails in the Bronx. A change from pavement.",
      spot: "Van Cortlandt Park at Broadway and West 242nd St", find: "The park entrance at Broadway and West 242nd St, right by the last stop of the 1 train.",
      dist: "About 3.1 mi (5 km) on grass and trails.", route: "A warm-up on the flat Parade Ground, then onto the park trails and back. Some short hills and roots, so watch your step.",
      paces: P.easy, d: 0, t: "09:00", m: 75, n: 15, tone: "mint", after: "Coffee nearby on Broadway after.",
      bring: ["Water", "Shoes you don't mind getting muddy"], transit: "The 1 stops at Van Cortlandt Park-242nd St, at the entrance." },
  ];
  const byId = (id) => LIST.find((t) => t.id === id) || null;
  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ISO = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^\d{2}:\d{2}$/;
  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plus = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  /** The next date on that weekday after today (a week out when today is that day). */
  const nextOn = (today, wd) => { const dow = new Date(today + "T12:00:00Z").getUTCDay(); return plus(today, (wd - dow + 7) % 7 || 7); };
  const addMin = (t, m) => { const [h, mm] = t.split(":").map(Number), x = (h * 60 + mm + m) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  const clock = (t) => { if (!HHMM.test(t || "")) return ""; let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`; };

  // ---- is this New York? (a page city, the city picker, a neighbourhood typed by the host) ----
  const NYC = /\b(new york|nyc|manhattan|brooklyn|queens|the bronx|bronx|staten island|harlem|astoria|williamsburg|greenpoint|bushwick|bed-?stuy|park slope|prospect heights|crown heights|dumbo|long island city|upper west side|upper east side|east village|west village|lower east side)\b/i;
  const isNYC = (city) => NYC.test(String(city || ""));

  // ---- a season note for New York: dark mornings and evenings in winter, heat in summer ----
  function seasonNote(date, t, tpl) { const mo = ISO.test(date || "") ? +date.slice(5, 7) : 0, h = HHMM.test(t || "") ? +t.slice(0, 2) : 8, early = h < 8, late = h >= 16;
    if ([11, 12, 1].includes(mo)) return `${early || late ? "It's dark at this hour this time of year. Bring a light and wear something bright. " : ""}Cold out, so dress in layers you can peel off.`;
    if ([2, 3].includes(mo)) return `${early || late ? "Still dark-ish at this hour. Something bright helps. " : ""}Chilly starts, so bring a layer for after.`;
    if ([6, 7, 8].includes(mo)) return `It gets hot and humid fast in summer. Bring water${h >= 9 && h < 18 ? ", and we'll ease the pace when it's steamy" : ""}.`;
    return tpl?.sunrise ? "Sunrise moves through the year, so check the time the night before." : "Mild weather most days. A light layer is plenty."; }

  // ---- run sign-up: the questions a run reply asks (public/questions.js draws them; answer ids are 1 to 12 letters) ----
  const RUN_Q = { pace: "runpace", first: "runfirst", ice: "runice", waiver: "runwaiver" };
  const WAIVER = "I'm running at my own pace and my own risk, and I'm fit for this distance.";
  /** What the run sign-up has on: { paces, first, ice, waiver, waiverText }. Pure. */
  function signup(ev) { const Q = (ev?.questions || []), f = (id) => Q.find((q) => q && q.id === id); const pace = f(RUN_Q.pace), w = f(RUN_Q.waiver);
    return { paces: pace ? pace.options.slice() : [], first: !!f(RUN_Q.first), ice: !!f(RUN_Q.ice), waiver: !!w, waiverText: w ? w.q : ev?.runSignup?.waiverText || WAIVER }; }
  /** Turn one part of the run sign-up on or off, or change the pace groups (a list) or the waiver words. The host's own
   *  questions stay where they are; the run ones go first, in a fixed order. No food question on a run. Pure. */
  function signupSet(ev, key, val) { ev = ev || {}; const cur = signup(ev), next = { ...cur };
    if (key === "paces") next.paces = (Array.isArray(val) ? val : String(val || "").split(/\n/)).map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 6);
    else if (key === "waiverText") next.waiverText = String(val || "").replace(/\s+/g, " ").trim().slice(0, 160) || WAIVER;
    else if (key in cur) next[key] = !!val;
    const own = (ev.questions || []).filter((q) => q && !Object.values(RUN_Q).includes(q.id)), run = [];
    if (next.paces.length) run.push({ id: RUN_Q.pace, q: "Which pace group?", type: "choice", required: false, options: next.paces });
    if (next.first) run.push({ id: RUN_Q.first, q: "First time running with us?", type: "yesno", required: false, options: ["Yes, first time", "I've been before"] });
    if (next.ice) run.push({ id: RUN_Q.ice, q: "Emergency contact, name and phone", type: "short", required: true, options: [], placeholder: "Sam, 917 555 0100" });
    if (next.waiver) run.push({ id: RUN_Q.waiver, q: next.waiverText, type: "choice", required: true, options: ["I agree"] });
    ev.questions = [...run, ...own]; ev.runSignup = { ice: next.ice, waiver: next.waiver, waiverText: next.waiverText }; ev.askDiet = false;
    return ev; }

  /** The event a template makes: the canvas's fields (public/canvas.js), ready to edit. today: "YYYY-MM-DD". Pure. */
  function toEvent(id, o = {}) { const T = byId(id); if (!T) return null; const today = ISO.test(o.today || "") ? o.today : localIso(new Date());
    const date = ISO.test(o.date || "") && o.date >= today ? o.date : nextOn(today, T.d), startTime = HHMM.test(o.time || "") ? o.time : T.t, title = String(o.title || "").trim().slice(0, 90) || T.title;
    const ev = { pubTitle: title, name: title, planKind: "run", activity: "run", casual: true, kind: "social", date, startTime, endTime: addMin(startTime, T.m), headcount: T.n,
      why: T.short, meetPoint: T.spot, venueName: T.park, city: "New York", hood: T.hood, placePublic: true, lastVis: "page", noMaybe: false, askDiet: false,
      bring: T.bring.slice(), getThere: [{ t: "", x: T.transit }], coverArt: { kind: "run", tone: T.tone }, runTpl: T.id,
      sections: [
        { icon: "pin", title: "The route", body: `${T.dist}\n${T.route}\nDistances are approximate.` },
        { icon: "clock", title: "Pace groups", body: `${T.paces.join("\n")}\nWe regroup at the end, so nobody finishes alone.` },
        { icon: "drink", title: "After", body: T.after },
        { icon: "info", title: "Good to know", body: `How to find us: ${T.find}\n${seasonNote(date, startTime, T)}\nIf the weather turns, I'll post a change here the night before.` },
      ] };
    const rep = o.repeat === "weekly" || o.repeat === "biweekly" ? o.repeat : o.repeat === "" ? "" : T.repeat || ""; if (rep) ev.repeat = rep;
    signupSet(ev, "paces", T.paces); signupSet(ev, "first", true);
    return ev; }

  // ---- reading a run from words: "easy 5K in Prospect Park Saturday 8", "weekly Tuesday tempo on the Hudson at 6:30" ----
  const PLACES = [["reservoir", /\breservoir\b|\bjackie o|\bengineers'? gate\b/], ["cp-loop", /\bcentral park\b|\bcolumbus circle\b|\bharlem hill\b/], ["hudson", /\bhudson\b|\bchelsea piers?\b|\bgreenway\b|\bwest side\b/],
    ["bridge", /\bbrooklyn bridge\b|\bthe bridge\b|\bdumbo\b|\bcity hall\b/], ["prospect", /\bprospect park\b|\bprospect\b|\bgrand army\b|\bpark slope\b/], ["mccarren", /\bmccarren\b|\bwilliamsburg\b|\bgreenpoint\b|\btrack\b/],
    ["east-river", /\beast river\b|\besplanade\b|\bcarl schurz\b|\byorkville\b|\bupper east\b/], ["astoria", /\bastoria\b|\bhell ?gate\b|\bditmars\b/], ["van-cortlandt", /\bvan cortlandt\b|\bbronx\b|\btrails?\b/]];
  const RUNNY = /\b(run|runs|running|runners?|jog|jogging|5 ?k|10 ?k|tempo|long run|run club|track|laps?|loops?|miles?)\b/i;
  /** { id, date, time, title, repeat, run } from a line of text, or null when it isn't about a run. today: "YYYY-MM-DD". Pure. */
  function parse(text, today) { const t = String(text || "").replace(/\s+/g, " ").trim(), lo = t.toLowerCase(); if (!t) return null;
    today = ISO.test(today || "") ? today : localIso(new Date());
    const hit = PLACES.find(([, re]) => re.test(lo)), id = hit ? hit[0] : "";
    // "central park" alone is the full loop, unless the reservoir is named (it comes first). A dinner in Williamsburg is not a run.
    if (!RUNNY.test(lo)) return null;
    const o = { id, run: true };
    const wd = /\b(?:every |each |this |next )?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|nes|nesday|rs|rsday|ur|urday|sday)?s?\b/i.exec(t);
    if (wd) o.date = nextOn(today, ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(wd[1].toLowerCase()));
    else if (/\btomorrow\b/i.test(t)) o.date = plus(today, 1);
    // "8", "8am", "at 6:30", "6:30pm", "7 pm": a bare hour is morning up to 11, evening from 1 to 6 (runs, not dinners)
    const tm = /\b(?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$|[,.!?])/i.exec(t.replace(/\b\d+(?:\.\d+)?\s*(?:k|km|mi|miles?)\b/gi, " ").replace(/\b\d+\s*x\s*\d+\b/gi, " ").replace(/\b\d+\s*(?:people|friends|runners|spots|guests)\b/gi, " "));
    if (tm) { let h = +tm[1]; const m = tm[2] || "00", ap = (tm[3] || "").toLowerCase().replace(/\./g, ""); if (h >= 1 && h <= 23 && +m < 60) { if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; if (!ap && h >= 1 && h <= 6) h += 12; o.time = `${String(h).padStart(2, "0")}:${m}`; } }
    if (/\b(every|each) (week|sun|mon|tue|wed|thu|fri|sat)|\bweekly\b/i.test(t)) o.repeat = "weekly"; else if (/\bevery (other|two|2) weeks?\b|\bbiweekly\b/i.test(t)) o.repeat = "biweekly";
    // a title from what the run is: "Easy 5K in Prospect Park", "Tempo run"
    const what = (/\b(easy|slow|social|chill|tempo|long|recovery|sunrise|speed|track)\b/i.exec(t) || [])[1], dist = (/\b(\d{1,2}(?:\.\d)?)\s*(k|km|mi|miles?)\b/i.exec(t) || []);
    const T = byId(id), size = dist[1] ? `${dist[1]}${/^k/i.test(dist[2]) ? "K" : " mi"}` : "";
    if (what || size) { const w = what ? what[0].toUpperCase() + what.slice(1).toLowerCase() : ""; o.title = [w, size || (w ? "run" : "Run")].filter(Boolean).join(" ") + (T ? ` ${T.at}` : ""); }
    return o; }

  /** The app link that opens the canvas with this template: /?app=1&new=1&kind=run&tpl=prospect&date=...#studio */
  function urlOf(id, over = {}) { let s = `/?app=1&new=1&kind=run&tpl=${byId(id) ? id : "pick"}`;
    for (const k of ["date", "time", "repeat", "title"]) if (over[k]) s += `&${k}=${encodeURIComponent(String(over[k]).slice(0, 90))}`; return s + "#studio"; }
  /** The canvas's preset from such a link (null for an unknown template; "pick" opens the picker). */
  function fromQuery(sp, today) { const id = sp.get("tpl") || ""; if (!byId(id)) return null; return toEvent(id, { today, date: sp.get("date") || "", time: sp.get("time") || "", title: sp.get("title") || "", repeat: sp.get("repeat") ?? undefined }); }

  /** A template's one line on a card: "Prospect Park · Sat 8am · about 3.35 mi". Pure. */
  const lineOf = (T, o = {}) => [T.park === T.hood ? T.park : `${T.park}, ${T.borough}`, `${WD[T.d].slice(0, 3)} ${clock(o.time || T.t)}`, T.dist.split(/\.\s/)[0].replace(/^About/, "about").replace(/ \(.*?\)/, "").replace(/\.$/, "")].join(" · ");

  const pure = { LIST, byId, isNYC, toEvent, parse, urlOf, fromQuery, signup, signupSet, RUN_Q, WAIVER, lineOf, seasonNote, nextOn };
  root.RunTemplates = pure;
  if (typeof document === "undefined") return;

  // ================= on a page =================
  const q = (s, el = document) => el.querySelector(s), qa = (s, el = document) => [...el.querySelectorAll(s)];
  const CSS = `.rt-bg{position:fixed;inset:0;z-index:9400;background:rgba(27,29,28,.42);display:flex;align-items:flex-end;justify-content:center}
.rt-sh{width:min(560px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border:1.5px solid var(--pl-ink,#1B1D1C);border-bottom:0;border-radius:6px 6px 0 0;font:16px/1.45 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif}
@media (min-width:700px){.rt-bg{align-items:center}.rt-sh{border-bottom:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px}}
.rt-sh header{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:8px;align-items:start;padding:16px 16px 10px;border-bottom:1px solid var(--pl-line,#E2DCD1)}
.rt-sh h2{margin:0;font:600 20px/1.25 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif}.rt-sh header p{margin:4px 0 0;color:var(--pl-soft,#444845);font-size:15px}
.rt-x{width:44px;height:44px;display:grid;place-items:center;border:1.5px solid var(--pl-line-strong,#CFC6B8);border-radius:6px;background:none;color:inherit;cursor:pointer}.rt-x svg{width:20px;height:20px}
.rt-list{overflow:auto;padding:6px 16px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;min-height:0}
.rt-b{flex:none;display:grid;gap:2px;width:100%;height:auto;min-height:64px;white-space:normal;line-height:1.35;padding:10px 12px;text-align:left;border:1.5px solid var(--pl-line-strong,#CFC6B8);border-radius:6px;background:#fff;color:inherit;font:inherit;cursor:pointer}
.rt-b:hover{border-color:var(--pl-ink,#1B1D1C)}.rt-b:focus-visible,.rt-x:focus-visible,.rt-go:focus-visible,.rt-ln:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.rt-b b{font-weight:600;font-size:16px}.rt-b span{font-size:14px;color:var(--pl-soft,#444845)}.rt-b small{font:500 12px/1.3 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.rt-card{margin:16px 0;padding:14px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:16px/1.45 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif}
.rt-hd{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:8px;align-items:start}.rt-card h2{margin:10px 0 0;font:600 18px/1.3 var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif}.rt-card>p{margin:4px 0 10px;color:var(--pl-soft,#444845);font-size:15px}
.rt-card .rt-row{display:grid;gap:8px}.rt-ln{background:none;border:0;padding:0;min-height:44px;color:var(--pl-accent-text,#29489A);font:600 15px inherit;font-family:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rt-fol{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--pl-line,#E2DCD1)}.rt-fol span{font-size:15px}
.rt-go{min-height:44px;padding:0 16px;border:1.5px solid var(--pl-accent,#29489A);border-radius:6px;background:var(--pl-accent,#29489A);color:#fff;font:600 15px var(--pl-font-text,"IBM Plex Sans"),system-ui,sans-serif;cursor:pointer}.rt-go:disabled{opacity:.6}
.rt-go.sec{background:none;color:var(--pl-ink,#1B1D1C);border-color:var(--pl-ink,#1B1D1C)}
.rt-f{display:grid;gap:4px;margin:0 0 10px;font-weight:600;font-size:14px}.rt-f select,.rt-f textarea{font:400 16px/1.4 inherit;font-family:inherit;padding:10px 12px;border:1px solid var(--pl-line-strong,#CFC6B8);border-radius:6px;background:#fff;color:inherit}
.rt-msg{padding:12px 16px calc(16px + env(safe-area-inset-bottom));overflow:auto}.rt-msg p{margin:0 0 10px}.rt-who{color:var(--pl-soft,#444845);font-size:14px}.rt-ok{color:var(--pl-ok,#3F5A2F);font-weight:600}.rt-err{color:var(--pl-danger,#A2361A);min-height:1em}`;
  const css = () => { if (q("#rtCss")) return; const s = document.createElement("style"); s.id = "rtCss"; s.textContent = CSS; document.head.appendChild(s); };
  const X = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>';
  function frame(label, head, body) { css(); const bg = document.createElement("div"); bg.className = "rt-bg";
    bg.innerHTML = `<div class="rt-sh" role="dialog" aria-modal="true" aria-label="${esc(label)}"><header><div>${head}</div><button type="button" class="rt-x" data-x aria-label="Close">${X}</button></header>${body}</div>`;
    document.body.appendChild(bg); const back = document.activeElement; const close = () => { bg.remove(); try { back?.focus?.({ preventScroll: true }); } catch {} };
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-x]")) close(); }); bg.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    setTimeout(() => q("[data-x]", bg)?.focus({ preventScroll: true }), 30); return { bg, close }; }

  /** The picker. onPick(id) gets the template; without one it opens the canvas filled in (use). */
  function sheet(o = {}) { const S = frame("New York runs", `<h2>New York runs, ready to go</h2><p>Pick a spot. I'll fill in the route, pace groups and coffee after. Change anything.</p>`,
      `<div class="rt-list">${LIST.map((T) => `<button type="button" class="rt-b" data-tpl="${T.id}"><small>${esc(T.borough)}</small><b>${esc(T.title)}</b><span>${esc(lineOf(T, o))}</span></button>`).join("")}</div>`);
    qa("[data-tpl]", S.bg).forEach((b) => (b.onclick = () => { S.close(); const id = b.dataset.tpl; if (o.onPick) o.onPick(id); else use(id, o); })); return S; }
  /** Open the canvas filled in from a template (or fill the open one). over: { date, time, title, repeat } */
  function use(id, over = {}) { const C = root.EventCanvas, pre = toEvent(id, { ...over, date: over.date || "", today: localIso(new Date()) }); if (!pre) return;
    try { if (C?.isOpen?.() && C.preset) return C.preset(pre); if (C?.open) return C.open({ mode: "new", kind: "run", preset: pre }); } catch (e) { console.warn(e); }
    location.href = urlOf(id, over); }

  // ---- is the host in New York? Their page city, the city picker on this phone, or what they told Potto ----
  let PROF = null; const getJ = (u) => fetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const profile = () => PROF || (PROF = getJ("/api/host/profile").then((j) => j?.host || {}));
  // the city picker keeps its choice in "encore.place" (public/place.js), which isn't loaded on every page
  const pickedCity = () => { try { return root.EncorePlace?.get?.()?.city || JSON.parse(localStorage.getItem("encore.place") || "null")?.city || ""; } catch { return ""; } };
  async function hostInNYC() { if (isNYC(pickedCity())) return true; try { if (isNYC(localStorage.getItem("pl.runCity"))) return true; } catch {} const h = await profile(); return isNYC(h.city) || isNYC(h.hood); }

  // ---- the host's followers, and one message to all of them about the next run ----
  async function messageSheet() { const [F, E] = await Promise.all([getJ("/api/host/followers"), getJ("/api/potto/events")]); const n = +F?.count || 0, mine = (E?.events || []).filter((e) => e.mine);
    const names = (F?.followers || []).map((f) => String(f.name || "").trim().split(/\s+/)[0]).filter(Boolean);
    const S = frame("Message your followers", `<h2>Message your followers</h2><p>${n ? `${n} ${n === 1 ? "person follows" : "people follow"} you. They get this by email, and by text if they gave a number.` : "Nobody follows you yet. After a run, guests can follow you in one tap."}</p>`,
      `<div class="rt-msg">${names.length ? `<p class="rt-who">${esc(names.slice(0, 12).join(", "))}${names.length > 12 ? ` and ${names.length - 12} more` : ""}</p>` : ""}${mine.length && n ? `<label class="rt-f">Which run<select id="rtEv">${mine.map((e) => `<option value="${esc(e.id)}">${esc(e.title)} · ${esc(e.when)}</option>`).join("")}</select></label>
        <label class="rt-f">Your message<textarea id="rtNote" rows="4" maxlength="500"></textarea></label><p class="rt-err" id="rtErr" role="alert"></p><button type="button" class="rt-go" id="rtSend">Send to ${n} ${n === 1 ? "follower" : "followers"}</button>` : n ? `<p>Make the next run first, then come back here to tell everyone.</p><button type="button" class="rt-go" data-new>Pick a run</button>` : ""}</div>`);
    const sel = q("#rtEv", S.bg), note = q("#rtNote", S.bg), fill = () => { const e = mine.find((x) => x.id === sel.value); if (e) note.value = `Next run: ${e.title}, ${e.when}. Are you in? Tap the link to reply.`; };
    if (sel) { fill(); sel.onchange = fill; }
    q("[data-new]", S.bg)?.addEventListener("click", () => { S.close(); sheet(); });
    q("#rtSend", S.bg)?.addEventListener("click", async (ev) => { const b = ev.currentTarget, er = q("#rtErr", S.bg); b.disabled = true; er.textContent = "";
      try { const r = await fetch("/api/host/announce", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: sel.value, note: note.value }) }), j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Didn't send. Try again.");
        q(".rt-msg", S.bg).innerHTML = `<p class="rt-ok">Sent.</p><p>${+j.emailed || 0} by email${+j.texted ? `, ${+j.texted} by text` : ""}. Replies land on the run's guest list.</p><button type="button" class="rt-go sec" data-x>Done</button>`; }
      catch (e) { er.textContent = e.message; b.disabled = false; } }); }

  // ---- the host's Home: a card when they're in New York ----
  async function homeCard() { const v = q("#view-programs"); let hid = false; try { hid = localStorage.getItem("pl.rtHide") === "1"; } catch {} if (!v || hid || q("#rtHome", v) || !root.__wsPersonal || !(await hostInNYC()) || q("#rtHome", v)) return;
    const F = await getJ("/api/host/followers"), n = +F?.count || 0, today = localIso(new Date()), dow = new Date().getDay();
    const top = LIST.slice().sort((a, b) => ((a.d - dow + 7) % 7 || 7) - ((b.d - dow + 7) % 7 || 7)).slice(0, 3); if (q("#rtHome", v)) return;
    const card = document.createElement("section"); card.className = "rt-card"; card.id = "rtHome"; card.setAttribute("aria-labelledby", "rtHomeH"); css();
    card.innerHTML = `<div class="rt-hd"><h2 id="rtHomeH">New York runs, ready to go</h2><button type="button" class="rt-x" data-hide aria-label="Hide New York runs">${X}</button></div><p>The spot, route, pace groups and coffee after are filled in. Pick one, check it, share the link.</p>
      <div class="rt-row">${top.map((T) => `<button type="button" class="rt-b" data-tpl="${T.id}"><b>${esc(T.title)}</b><span>${esc(lineOf(T))}</span></button>`).join("")}</div>
      <button type="button" class="rt-ln" data-all>See all ${LIST.length} New York runs</button>
      <div class="rt-fol"><span>${n ? `${n} ${n === 1 ? "person follows" : "people follow"} you` : "No followers yet. Guests can follow you after they reply."}</span>${n ? `<button type="button" class="rt-go sec" data-msg>Message them</button>` : ""}</div>`;
    card.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.hasAttribute("data-hide")) { try { localStorage.setItem("pl.rtHide", "1"); } catch {} card.remove(); return; } if (b.dataset.tpl) use(b.dataset.tpl, { today }); else if (b.hasAttribute("data-all")) sheet(); else if (b.hasAttribute("data-msg")) messageSheet(); });
    const at = q("#qsPanel", v) || q(".cg", v); if (at) at.after(card); else v.prepend(card); }
  let ht = 0; const later = () => { clearTimeout(ht); ht = setTimeout(() => homeCard().catch(() => {}), 200); };

  // ---- the Home composer: "easy 5K in Prospect Park Saturday 8" goes straight to its template, a run with no spot
  // opens the picker with the day and time kept. Anything else (and a run outside New York) is the app's as before.
  // Knowing the city can take a request, so the send is held and handed back to the app when it isn't ours.
  function guard(e) { const ta = q("#qsText"); if (!ta || e.__rt) return; const isGo = e.type === "click" ? !!e.target.closest?.("#qsGo") : e.target === ta && e.key === "Enter" && !e.shiftKey && !e.isComposing; if (!isGo) return;
    const P = parse(ta.value, localIso(new Date())); if (!P) return; e.preventDefault(); e.stopImmediatePropagation();
    hostInNYC().catch(() => false).then((nyc) => {
      if (nyc || P.id) { ta.value = ""; const over = { date: P.date || "", time: P.time || "", title: P.title || "", repeat: P.repeat || undefined }; return P.id ? use(P.id, over) : sheet(over); }
      const again = e.type === "click" ? new MouseEvent("click", { bubbles: true, cancelable: true }) : new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); again.__rt = 1; (e.type === "click" ? q("#qsGo") : ta)?.dispatchEvent(again); }); }

  function boot() { if (!q("#view-programs")) return; later(); new MutationObserver(later).observe(q("#view-programs"), { childList: true });
    document.addEventListener("click", guard, true); document.addEventListener("keydown", guard, true);
    addEventListener("pl:place", () => { const c = q("#rtHome"); if (!c) later(); }); }
  root.RunTemplates = { ...pure, sheet, use, messageSheet, hostInNYC, pickedCity };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})(typeof window !== "undefined" ? window : globalThis);
