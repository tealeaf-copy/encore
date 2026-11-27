// Guides: short programs for hosts ("Host your first supper club" in 5 steps, "Start a monthly game night", "Run a
// drop", "Grow your regulars"). Each step points at the real feature (start an event, the brand kit, the fan club, the
// share sheet, kudos, your stats) and is ticked off by what the host has actually done, read from their own data, or
// by hand when there's nothing to read. Progress is per host (system/plguide-<hash>), private to them. The host's Home
// shows one light "Your next step" card (public/guides.js); the guides live at /guides and /guides/<id>.
import crypto from "node:crypto";
import { scopeStore, DEFAULT_WS } from "./workspaces.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// {page} is the host's own page (/@handle), {event} their latest event's page. Links resolve in linkOf().
const NEW = "/?app=1&new=1#studio", HOME = "/?app=1#programs", newOf = (k) => `/?app=1&new=1&kind=${k}#studio`;
export const GUIDES = [
  { id: "first-supper", title: "Host your first supper club", short: "Five steps, one table, one good night.", for: "new",
    intro: "A supper club is a dinner you host for people who don't all know each other yet. Keep it small, cook one thing you love, and let the table do the rest.",
    steps: [
      { id: "event", title: "Pick a night and a small table", body: "Six to ten spots is plenty. Say what you're cooking and where, roughly. You can change it later.", label: "Start the event", href: NEW, auto: (s) => s.events > 0 },
      { id: "look", title: "Make it look like you", body: "Pick a brand kit once and your page, events and invites all match. Two minutes.", label: "Open your brand kit", href: "{page}?edit=1", auto: (s) => s.brandKit },
      { id: "share", title: "Send the invite", body: "Share the link with a few friends first, then wherever your people are. Guests reply in one tap, no account.", label: "Share the invite", href: "{event}", auto: (s) => s.shared },
      { id: "guests", title: "Welcome your first guests", body: "When people say they're in, Potto sends the reminders. Add a line about the first 30 minutes so nobody arrives wondering.", label: "See who's in", href: HOME, auto: (s) => s.going > 0 },
      { id: "kudos", title: "Ask how it went", body: "The morning after, guests get one kind question. Their kudos land on your page and in your scrapbook.", label: "See your kudos", href: "{page}#kudos", auto: (s) => s.kudos > 0 },
    ] },
  { id: "game-night", title: "Start a monthly game night", short: "Same night every month. The regulars do the rest.", for: "any",
    intro: "A game night works best when it's predictable: same week, same place, a shelf of games and a seat kept for someone new.",
    steps: [
      { id: "event", title: "Set up the first night", body: "Name the games you'll bring and how many tables. Say if it's beginner friendly.", label: "Start the event", href: NEW, auto: (s) => s.games > 0 },
      { id: "repeat", title: "Make it monthly", body: "Turn on repeat so the next date makes itself, and the same link always shows what's next.", label: "Open your events", href: HOME, auto: (s) => s.repeats > 0 },
      { id: "solo", title: "Keep a seat for someone new", body: "Mark it come alone friendly, or open a table for strangers. Quiet people say yes to that.", label: "Open your events", href: HOME, auto: (s) => s.soloFriendly > 0 },
      { id: "share", title: "Share the invite", body: "Post the link where your people already are. A group chat beats a flyer.", label: "Share the invite", href: "{event}", auto: (s) => s.shared },
      { id: "club", title: "Give your regulars a home", body: "A fan club gives the people who keep coming first dibs and a chat of their own. It's free.", label: "Start a fan club", href: "{page}?edit=1#club", auto: (s) => s.club },
    ] },
  { id: "run-drop", title: "Run a drop", short: "Order ahead, pick up at a set time.", for: "any",
    intro: "A drop is a small batch people order ahead and pick up at a set time: a cake, a box of dumplings, a run of prints.",
    steps: [
      { id: "drop", title: "Set up the drop", body: "What you're making, how many, the price and the pickup window. Potto keeps count.", label: "Start a drop", href: NEW, auto: (s) => s.drops > 0 },
      { id: "look", title: "Make it look like you", body: "Your brand kit carries onto the drop page, so it looks like your shop.", label: "Open your brand kit", href: "{page}?edit=1", auto: (s) => s.brandKit },
      { id: "first", title: "Give your regulars first dibs", body: "With a fan club on, members can order before everyone else.", label: "Start a fan club", href: "{page}?edit=1#club", auto: (s) => s.club },
      { id: "share", title: "Share the drop", body: "One link for orders. People see what's left as it sells.", label: "Share the drop", href: "{event}", auto: (s) => s.sharedDrop },
    ] },
  { id: "grow-regulars", title: "Grow your regulars", short: "Turn one good night into a table that meets again.", for: "hosted",
    intro: "Regulars are the people who come back. They come back when it's easy to: a next date, a word from you, a reason to bring a friend.",
    steps: [
      { id: "second", title: "Host a second one", body: "The next date matters more than the first one. Put it on the calendar while the last one is fresh.", label: "Start the next one", href: NEW, auto: (s) => s.pastEvents >= 2 || (s.pastEvents >= 1 && s.upcoming >= 1) },
      { id: "kudos", title: "Ask how it went", body: "Kudos tell you what to keep. Guests get one kind question the morning after.", label: "See your kudos", href: "{page}#kudos", auto: (s) => s.kudos > 0 },
      { id: "club", title: "Start a fan club", body: "First dibs on new dates and a members' chat. Free, and you can turn it off.", label: "Start a fan club", href: "{page}?edit=1#club", auto: (s) => s.club },
      { id: "post", title: "Send your members an update", body: "A short note between events: what's next, a photo from last time.", label: "Open your page", href: "{page}", auto: (s) => s.posts > 0 },
      { id: "back", title: "See who came back", body: "Your stats show regulars and would-go-again, privately. Watch them grow.", label: "See your stats", href: "/me", auto: (s) => s.returning > 0 },
    ] },
  // review 18: one guide for each scale, from a booked table to a summit (server/kinds.js)
  { id: "book-a-table", title: "Book a table for friends", short: "A restaurant, a reply-by day, a count that matches.", for: "any",
    intro: "The simplest night out: you book, friends reply, and the table matches the people who come. Pottery Lab keeps the count against the booking.",
    steps: [
      { id: "event", title: "Book the table, then invite", body: "Pick Book a table. Add the restaurant, the time and the party size you booked. The booking link and confirmation go only to people who are in.", label: "Book a table", href: newOf("table"), auto: (s) => s.tables > 0 },
      { id: "hold", title: "Give a reply-by day", body: "Two days before is plenty. Guests read: Reply by Thursday so I can update the booking.", label: "Open your events", href: HOME, auto: (s) => s.tableHolds > 0 },
      { id: "share", title: "Send the invite", body: "Drop the link in the group chat. Replies count against the party size as they come in.", label: "Share the invite", href: "{event}", auto: (s) => s.shared },
      { id: "count", title: "Call when the count moves", body: "You'll see \"You're at 7 of 6. Call to add a seat?\" in your bell and in Plans. Tap The booking matches once you've called.", label: "See your plans", href: "/plans", auto: (s) => s.tablesConfirmed > 0 },
      { id: "split", title: "Settle the bill", body: "Even split or each pays their own. Add the total after and everyone sees their share with your pay link.", label: "Open your events", href: HOME, auto: (s) => s.tablesSplit > 0 },
    ] },
  { id: "teach-a-class", title: "Teach your first class", short: "Small, hands-on, everything included.", for: "any",
    intro: "A class works when people know what they'll make, what's included and what to bring. Keep it to eight and leave time to make a mess.",
    steps: [
      { id: "event", title: "Set up the class", body: "Pick Class. Say what everyone makes and how long it takes.", label: "Start a class", href: newOf("class"), auto: (s) => s.classes > 0 },
      { id: "included", title: "Say what's included", body: "Materials, tools, firing and pickup. Guests stop wondering what to buy.", label: "Open your events", href: HOME, auto: (s) => s.included > 0 },
      { id: "share", title: "Share the invite", body: "A small class fills from a few friends of friends. Send it to three people first.", label: "Share the invite", href: "{event}", auto: (s) => s.shared },
      { id: "repeat", title: "Make it a series", body: "Turn on repeat and the next class makes itself. Regulars hear first.", label: "Open your events", href: HOME, auto: (s) => s.repeats > 0 },
    ] },
  { id: "weekend-away", title: "Plan a weekend away", short: "A house, a plan by day, beds, rides and shared costs.", for: "any",
    intro: "Book the place before the people, share a rough plan, and keep the money plain: who paid what, and who owes whom. Nothing moves through the app.",
    steps: [
      { id: "event", title: "Start the weekend", body: "Pick Weekend away. Add the dates, the place and the area. The address goes only to people who are in.", label: "Plan a weekend", href: newOf("weekend"), auto: (s) => s.trips > 0 },
      { id: "plan", title: "Lay out the days", body: "Arrive, dinner, a hike, checkout. Start from the Weekend away shape on the plan page and change what you like.", label: "See your plans", href: "/plans", auto: (s) => s.tripPlans > 0 },
      { id: "beds", title: "Beds and rides", body: "List the beds once. Guests claim one each, and drivers offer seats in their car.", label: "See your plans", href: "/plans", auto: (s) => s.tripBeds > 0 },
      { id: "costs", title: "Add the shared costs", body: "The house, groceries, the car. Each is split among the people who are in, with \"You owe Maya $84\" and your pay link.", label: "See your plans", href: "/plans", auto: (s) => s.tripCosts > 0 },
    ] },
  { id: "small-summit", title: "Run a small summit", short: "Tracks, rooms, speakers, a door that moves.", for: "any",
    intro: "Start with five speakers you know, a host for every room and long hallway time. Guests pick their own agenda; you keep the run of show.",
    steps: [
      { id: "event", title: "Start the summit", body: "Pick Summit. Add the days, your tracks and your rooms with how many fit.", label: "Start a summit", href: newOf("summit"), auto: (s) => s.summits > 0 },
      { id: "agenda", title: "Build the agenda", body: "Sessions with a time, a track, a room and speakers. Guests save the ones they want, and we warn them when two overlap.", label: "See your plans", href: "/plans", auto: (s) => s.sessions > 0 },
      { id: "speakers", title: "Ask speakers about their page", body: "A speaker's page is public only when they say yes, or you mark it public. Everyone else is named to guests who are in.", label: "See your plans", href: "/plans", auto: (s) => s.speakers > 0 },
      { id: "tickets", title: "Tickets and tiers", body: "Early, regular, student. Guests pick a tier when they reply and pay with your link.", label: "Open your events", href: HOME, auto: (s) => s.tiered > 0 },
      { id: "door", title: "Get the door ready", body: "Print the agenda and the name tags, then check people in from the invite planner on the day.", label: "Open your events", href: HOME, auto: (s) => s.checkedIn > 0 },
    ] },
];
export const guideById = (id) => GUIDES.find((g) => g.id === id) || null;

/** One guide's progress: auto (from real activity) or by hand. Pure. */
export function progressOf(guide, signals = {}, manual = {}) {
  const steps = guide.steps.map((st) => { const auto = !!st.auto?.(signals), hand = !!manual[`${guide.id}.${st.id}`]; return { id: st.id, title: st.title, body: st.body, label: st.label, href: st.href, done: auto || hand, by: auto ? "auto" : hand ? "hand" : "" }; });
  const done = steps.filter((s) => s.done).length, next = steps.find((s) => !s.done) || null;
  return { id: guide.id, title: guide.title, short: guide.short, intro: guide.intro, steps, done, total: steps.length, complete: done === steps.length, next };
}
/** Which guide's step the Home card shows: the one the host started last that isn't finished, else a fit for where they are. Pure. */
export function nextStepOf(all, started = {}, signals = {}) {
  const open = all.filter((g) => !g.complete), byStart = open.filter((g) => started[g.id]).sort((a, b) => started[b.id] - started[a.id]);
  const fit = signals.pastEvents >= 1 ? ["grow-regulars", "game-night", "run-drop", "first-supper"] : ["first-supper", "game-night", "run-drop", "grow-regulars"];
  const g = byStart[0] || fit.map((id) => open.find((x) => x.id === id)).find(Boolean);
  return g ? { guide: { id: g.id, title: g.title, done: g.done, total: g.total }, step: g.next } : null;
}
/** Fill a step's link for this host. */
export function linkOf(href, { handle = "", eventId = "" } = {}) {
  let h = String(href || "");
  if (h.includes("{page}")) h = handle ? h.replace("{page}", "/@" + encodeURIComponent(handle)) : HOME;
  if (h.includes("{event}")) h = eventId ? "/e/" + encodeURIComponent(eventId) + "?share=1" : NEW;
  return h;
}

export function makeGuides({ store, C, X, F }) {
  const key = (ws) => "system/plguide-" + hash(ws);
  const read = (ws) => { const d = store.get(key(ws))?.data || {}; return { started: d.started && typeof d.started === "object" ? d.started : {}, done: d.done && typeof d.done === "object" ? d.done : {} }; };
  const write = (ws, v) => store.set(key(ws), { kind: "plguide", ws, started: v.started, done: v.done, at: Date.now() });
  /** What the host has actually done, from their own events, replies, kudos, page and club. */
  function signals(ws, now = Date.now()) {
    const S = scopeStore(store, ws), today = iso(now), E = S.list("events").map((d) => ({ id: d.id, ...(d.data || {}) })).filter((e) => !e.example && e.stage !== "interest" && (e.name || e.pubTitle || e.title));
    const R = S.list("rsvps").map((d) => d.data || {}), h = C.profileOf(ws) || {};
    const shared = (e) => !!(e.published || e.discoverable || e.toldAt || e.sharedAt || e.inviteSent);
    const text = (e) => lc(`${e.name || ""} ${e.pubTitle || ""} ${e.activity || ""}`);
    let club = false, posts = 0; try { club = !!F?.config(ws)?.on; posts = (F?.postsOf?.(ws) || []).length; } catch {}
    let returning = 0; try { returning = X?.hostStrengths?.(ws)?.returning || 0; } catch {}
    const latest = [...E].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.createdAt || 0) - (a.createdAt || 0));
    return { events: E.length, shared: E.some(shared), going: R.filter((r) => r.response === "going").length, kudos: S.list("kudos").length, brandKit: !!h.brandKit, club, posts, returning,
      repeats: E.filter((e) => ["weekly", "biweekly", "monthly"].includes(e.repeat)).length, games: E.filter((e) => /\b(game|games|board|tabletop|d&d|dnd|chess|mahjong|catan|trivia)\b/.test(text(e))).length,
      soloFriendly: E.filter((e) => (Array.isArray(e.comfort) && e.comfort.includes("solo")) || (e.openTable && e.openTable.on !== false)).length,
      drops: E.filter((e) => e.drop || e.preorder).length, sharedDrop: E.some((e) => (e.drop || e.preorder) && shared(e)),
      pastEvents: E.filter((e) => e.date && e.date <= today).length, upcoming: E.filter((e) => e.date && e.date > today).length,
      // the kinds (server/kinds.js): a booked table, a class, a weekend away, a summit
      tables: E.filter((e) => e.planKind === "table" || e.reservation?.restaurant).length, tableHolds: E.filter((e) => e.reservation?.holdUntil).length, tablesConfirmed: E.filter((e) => Number.isInteger(e.reservation?.confirmedFor)).length, tablesSplit: E.filter((e) => e.reservation?.split === "own" || e.reservation?.bill > 0).length,
      classes: E.filter((e) => e.planKind === "class" || /\b(class|workshop|lesson)\b/.test(text(e))).length, included: E.filter((e) => (e.included || []).length).length,
      trips: E.filter((e) => e.planKind === "weekend" || (e.endDate && e.endDate > (e.date || ""))).length, tripPlans: E.filter((e) => e.endDate && (e.itinerary || []).length).length, tripBeds: E.filter((e) => (e.beds || []).length).length,
      tripCosts: E.filter((e) => (S.get("trip/" + e.id)?.data?.costs || []).length).length,
      summits: E.filter((e) => e.planKind === "summit" || e.kind === "summit").length, sessions: E.filter((e) => (e.agenda?.sessions || []).length).length, speakers: E.filter((e) => (e.speakers || []).length).length,
      tiered: E.filter((e) => (e.priceTiers || []).length).length, checkedIn: R.filter((r) => r.checkedInAt).length,
      handle: h.handle || "", latest: (latest.find((e) => e.date && e.date >= today) || latest[0])?.id || "", latestDrop: latest.find((e) => e.drop || e.preorder)?.id || "" };
  }
  function view(ws) { const sig = signals(ws), M = read(ws);
    const all = GUIDES.map((g) => { const p = progressOf(g, sig, M.done); const ev = g.id === "run-drop" ? sig.latestDrop || sig.latest : sig.latest;
      const fix = (s) => s && { ...s, href: linkOf(s.href, { handle: sig.handle, eventId: ev }) }; return { ...p, started: M.started[g.id] || 0, steps: p.steps.map(fix), next: fix(p.next) }; });
    return { guides: all, next: nextStepOf(all, M.started, sig) }; }
  function start(ws, id) { if (!guideById(id)) return null; const M = read(ws); M.started[id] = Date.now(); write(ws, M); return view(ws); }
  function mark(ws, id, step, done) { const g = guideById(id); if (!g || !g.steps.some((s) => s.id === step)) return null; const M = read(ws), k = `${id}.${step}`;
    if (done) M.done[k] = Date.now(); else delete M.done[k]; if (!M.started[id]) M.started[id] = Date.now(); write(ws, M); return view(ws); }
  return { signals, view, start, mark, read };
}

export function mountGuides(app, { store, small, currentUser, C, X, sendStatic }) {
  const G = makeGuides({ store, C, X, F: app.locals.fanclub }); app.locals.guides = G;
  const host = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in to see your guides." }); return null; } return u; };
  const ID = /^[a-z0-9-]{2,40}$/;
  app.get("/api/host/guides", (req, res) => { const u = host(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json(G.view(u.ws)); });
  app.post("/api/host/guides/:id/start", small, (req, res) => { const u = host(req, res); if (!u) return; const v = ID.test(req.params.id) ? G.start(u.ws, req.params.id) : null; return v ? res.json({ ok: true, ...v }) : res.status(404).json({ code: "not_found", message: "No such guide." }); });
  app.post("/api/host/guides/:id/steps/:step", small, (req, res) => { const u = host(req, res); if (!u) return; const v = ID.test(req.params.id) && ID.test(req.params.step) ? G.mark(u.ws, req.params.id, req.params.step, req.body?.done !== false) : null;
    return v ? res.json({ ok: true, ...v }) : res.status(404).json({ code: "not_found", message: "No such step." }); });
  // the guides themselves are public reading (what each step is), progress is the host's own
  app.get("/api/public/guides", (req, res) => res.set("Cache-Control", "public, max-age=300").json({ guides: GUIDES.map((g) => ({ id: g.id, title: g.title, short: g.short, intro: g.intro, steps: g.steps.map((s) => ({ id: s.id, title: s.title, body: s.body, label: s.label })) })) }));
  app.get(["/guides", "/guides/:id"], (req, res) => { if (req.params.id && !guideById(req.params.id)) { res.status(404); return sendStatic(res, "404.html", "<p>Page not found.</p>"); } sendStatic(res, "guides.html", "<p>Guides page missing.</p>"); });
  return G;
}
