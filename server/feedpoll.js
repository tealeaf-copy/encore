// ---- Availability polls in the feed: "When works for you?" ----
// A host asks when people are free: a question, an optional "for what" ("Dumpling night") and 2 to 5 options, each a
// date with an optional time. People who see the card tap every option that works (one tap each, tap again to undo).
// The host sees the counts and who picked what, and turns the winner into an event in one tap: the card's "Pick this
// date" opens the new-event editor filled in (public/canvas.js reads ?poll=...), and the event it saves carries
// fromPoll: "<poll id>.<option id>". The first time such an event is saved with a date and shared (server/app.js calls
// onEvent), the card turns into "It's on: <date>" with a link to the event, and everyone who answered the poll gets
// one note in their Inbox with the link. Nobody is replied for: they tap I'm in themselves.
//
// It sits next to the interest check (an event at stage "interest" with dateOptions, index.html): that one needs an
// event first and collects replies with a name and email on the invite. This one is the lighter step before there is
// an event at all, and it lives in the feed. The words ("It's on: ...", the "itson" Inbox kind) are the same.
//
// Rules, in one place:
// - Who sees a card in their feed: the host, people who follow the host (the host is in their friends) and followers
//   of the host's page: the same people who see their posts and events. Followers only: the link
//   (/feed?poll=<id>, the card's Share) opens it for those same people and nobody else, and never signed out.
// - Who asks: anyone signed in. Up to 3 open polls each at a time (POLL_OPEN_MAX).
// - Who answers: anyone signed in who can open it.
// - Blocks work both ways (server/safety.js): if either blocked the other, there is no card and no vote, and a
//   blocked person's picks are left out of the counts and faces for the person who blocked them.
// - Names: the host sees first names on each option. Everyone else sees small faces, by each person's "Show my name
//   on kudos and comments" setting (server/feedblend.js personFor).
// - Only the host closes the poll, deletes it or makes the event. A poll also closes on its own after its closing day
//   (by default the last option's date).
// - The host hears once: an Inbox note when the first person answers, and while it is unread the next few people are
//   folded into it ("Maya, Jun and 2 others answered ..."). Never one note per vote.
// - Kudos and comments work like on any card: the target is "q:<id>" (feedblend.js cardOf asks cardOf below).
// - Writes are rate limited by IP and by person each hour (ENCORE_FEED_POLLS_PER_HOUR, ENCORE_FEED_POLL_VOTES_PER_HOUR
//   and their _PER_IP_ twins).
//
// Docs: system/feedpoll-<id> { kind: "feedpoll", id, owner, ws, q, title, options: [{ id: "a".."e", date, time }],
//   votes: { <option id>: { <person key>: { e: email, at } } }, at, closes, closedAt?, event?: { id, opt, at }, noted? }
// and system/feedpolls-<hash of owner> { kind: "feedpolls", list: [id, ...] } (the owner's latest 30).
// Routes: POST /api/feed/polls, GET /api/feed/polls/:id, POST /api/feed/polls/:id/vote { option, on },
//   POST /api/feed/polls/:id/close, DELETE /api/feed/polls/:id.
import crypto from "node:crypto";
import { DEFAULT_WS, getWorkspace } from "./workspaces.js";
import { textProblem, keyOf } from "./safety.js";
import { notify } from "./inbox.js";

const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const hash24 = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // the inbox's own key (server/inbox.js)
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/, PID = /^[a-f0-9]{24}$/;
export const POLL_MIN = 2, POLL_MAX = 5, POLL_Q = "When works for you?", POLL_Q_MAX = 80, POLL_TITLE_MAX = 60, POLL_FEED_MAX = 3, POLL_OPEN_MAX = 3, POLL_KEEP_DAYS = 7, POLL_NOTE_FOLD = 5;
const realDate = (d) => DATE.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00Z")) && iso(Date.parse(d + "T12:00:00Z")) === d;

/** "Sat, Dec 5" */
export const dayLabel = (d) => (realDate(d) ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");
/** "7pm", "7:30pm" */
export const timeLabel = (t) => { const m = TIME.exec(String(t || "")) && String(t).split(":"); if (!m) return ""; const h = +m[0], mm = m[1]; return `${h % 12 || 12}${mm === "00" ? "" : ":" + mm}${h < 12 ? "am" : "pm"}`; };
/** "Sat, Dec 5 at 7pm" */
export const whenLabel = (d, t) => [dayLabel(d), timeLabel(t)].filter(Boolean).join(" at ");

/**
 * The options as they are kept, or a plain sentence saying what is wrong. Dates run from today to a year out (a day of
 * slack for people west of the server's clock), a time is optional, doubles are dropped, and they are kept in order.
 */
export function cleanOptions(list, now = Date.now()) {
  if (!Array.isArray(list)) return "Add two or more times people can pick from.";
  if (list.length > 12) return `Keep it to ${POLL_MAX} options.`;
  const lo = iso(now - DAY), hi = iso(now + 366 * DAY), seen = new Set(), out = [];
  for (const o of list) { const date = String(o?.date || "").trim(), time = String(o?.time || "").trim();
    if (!date && !time) continue;
    if (!realDate(date)) return "One of the dates doesn't look right. Pick it again.";
    if (time && !TIME.test(time)) return "One of the times doesn't look right. Pick it again.";
    if (date < lo) return "One of those dates has already passed. Pick one from today on.";
    if (date > hi) return "Keep the dates within the next year.";
    const k = date + " " + time; if (seen.has(k)) continue; seen.add(k); out.push({ date, time }); }
  if (out.length < POLL_MIN) return "Add two or more times people can pick from.";
  if (out.length > POLL_MAX) return `Keep it to ${POLL_MAX} options.`;
  return out.sort((a, b) => (a.date + " " + (a.time || "99")).localeCompare(b.date + " " + (b.time || "99"))).map((o, i) => ({ id: "abcde"[i], ...o }));
}

export function makeFeedPoll(store, { C, X, app = null }) {
  const B = () => app?.locals?.feedBlend || null;
  const path = (id) => "system/feedpoll-" + id, idxPath = (email) => "system/feedpolls-" + hash24(email);
  const get = (id) => (PID.test(String(id || "")) ? store.get(path(id))?.data || null : null);
  const save = (P) => { store.set(path(P.id), P); return P; };
  const idsOf = (email) => store.get(idxPath(email))?.data?.list || [];
  const safety = () => app?.locals?.appstore?.safety || null;
  const blocked = (a, b) => { try { return (safety()?.blocksOf(a) || []).some((x) => x.target === "person:" + keyOf(b)); } catch { return false; } };
  const handleOf = (ws) => { try { return lc(C.profileOf(ws)?.handle || ""); } catch { return ""; } };

  function create(u, { q, title, options, closes }, now = Date.now()) {
    const id = crypto.randomBytes(12).toString("hex"), last = options[options.length - 1].date;
    const P = save({ kind: "feedpoll", id, owner: lc(u.email), ws: u.ws, q, title, options, votes: {}, at: now, closes: closes || last });
    store.set(idxPath(u.email), { kind: "feedpolls", email: lc(u.email), list: [id, ...idsOf(u.email)].slice(0, 30) }); return P; }
  function remove(P) { store.delete(path(P.id)); store.set(idxPath(P.owner), { kind: "feedpolls", email: P.owner, list: idsOf(P.owner).filter((x) => x !== P.id) }); }

  /** The event a poll became, while it is still there: { id, url, title, date, time }, or null. */
  function eventOf(P) { if (!P.event?.id) return null; try { const x = X.index().events.get(P.event.id), e = x?.e; if (!e || e.cancelled || !e.date) return null;
      return { id: P.event.id, url: "/e/" + encodeURIComponent(P.event.id), title: clean(e.pubTitle || e.name, 80), date: e.date, time: TIME.test(e.startTime || "") ? e.startTime : "" }; } catch { return null; } }
  const isOpen = (P, now = Date.now()) => !P.closedAt && !P.event && iso(now - DAY) <= (P.closes || "");
  const votersOf = (P) => { const S = new Set(); for (const o of P.options) for (const k of Object.keys(P.votes?.[o.id] || {})) S.add(k); return S; };
  const ctxOf = (P) => ({ owner: P.owner, ws: P.ws });

  /** May this viewer open this poll? Not when either side blocked the other, or the viewer blocked the host's page. */
  function canSee(P, v) { if (!P) return false; if (v.email && v.email === P.owner) return true;
    const h = handleOf(P.ws); if (v.blocks?.has("person:" + keyOf(P.owner)) || (h && v.blocks?.has("host:" + h))) return false;
    if (v.email && blocked(P.owner, v.email)) return false;
    return inFeed(P, v); } // followers only: the link opens it for the people who would see it in their feed, nobody else
  /** Is this poll in this viewer's feed? Their own, a friend's, or a host page they follow. */
  function inFeed(P, v) { return !!v.email && (v.email === P.owner || !!v.friends?.has(P.owner) || !!v.followed?.has(P.ws)); }

  /** The card as this viewer sees it (the shape public/feedpoll.js draws). */
  function item(P, v, now = Date.now()) { const mine = !!v.email && v.email === P.owner, me = v.email ? keyOf(v.email) : "", F = B(), ctx = ctxOf(P), all = new Set();
    let p = {}; try { p = X.person(P.owner) || {}; } catch {} const h = handleOf(P.ws);
    const options = P.options.map((o) => { const V = Object.entries(P.votes?.[o.id] || {}).filter(([, x]) => !v.blocks?.has("person:" + keyOf(x.e))).sort((a, b) => (b[0] === me) - (a[0] === me) || (a[1].at || 0) - (b[1].at || 0));
      const faces = [], names = []; for (const [k, x] of V) { all.add(k); let who = null; try { who = k === me ? { name: "You", face: F.myFace(v) } : F.personFor(v, x.e, ctx); } catch {} if (!who) continue;
        if (faces.length < 4) faces.push(who.face); if (mine && !who.guest) names.push(who.name); }
      return { id: o.id, date: o.date, time: o.time || "", count: V.length, mine: !!me && V.some(([k]) => k === me), faces, ...(mine ? { names: names.slice(0, 12) } : {}) }; });
    const top = Math.max(0, ...options.map((o) => o.count)), ev = eventOf(P), open = isOpen(P, now), target = "q:" + P.id, title = P.title || P.q;
    let kudos = null, comments = { count: 0, last: [] }; try { kudos = F.kudosFor(v, { kind: "poll", target, ...ctx }); comments = F.comments.summary(target, v, ctx); } catch {}
    return { kind: "poll", key: target, id: P.id, at: P.at, mine, q: P.q, title: P.title || "",
      host: { name: clean(p.name, 80) || "A host", handle: p.handle || "", emoji: p.emoji || "", color: /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "", page: h ? "/@" + h : p.handle ? "/h/" + p.handle : "" },
      options, voters: all.size, lead: top ? options.find((o) => o.count === top).id : "", open, closes: P.closes, closed: !open,
      ...(ev ? { event: ev, picked: P.event.opt } : {}), ...(mine ? {} : { report: { type: "person", target: "person:" + keyOf(P.owner), key: keyOf(P.owner), name: clean(p.name, 80) } }),
      share: { url: "/feed?poll=" + P.id, title }, kudos, comments, ...(v.email ? { me: (() => { try { return F.myFace(v); } catch { return null; } })() } : {}) }; }

  /** The polls in this viewer's feed: open ones they haven't answered first, then the newest; a finished one stays a week. */
  function cards(v, now = Date.now()) { if (!v?.email) return []; const authors = new Set([v.email, ...(v.friends || [])]);
    for (const w of v.followed || []) { const o = lc(getWorkspace(w)?.ownerEmail); if (o) authors.add(o); }
    const me = keyOf(v.email), out = [];
    for (const a of authors) for (const id of idsOf(a).slice(0, 6)) { const P = get(id); if (!P || !inFeed(P, v) || !canSee(P, v)) continue;
      const open = isOpen(P, now), done = P.event?.at || P.closedAt || Date.parse((P.closes || iso(P.at)) + "T23:59:59Z"); if (!open && now - done > POLL_KEEP_DAYS * DAY) continue;
      out.push({ P, open, todo: open && P.owner !== v.email && !votersOf(P).has(me) }); }
    return out.sort((a, b) => b.todo - a.todo || b.open - a.open || b.P.at - a.P.at).slice(0, POLL_FEED_MAX).map((x) => item(x.P, v, now)); }
  /** Polls go in near the top of the stream: the first leads it, the next ones a few cards apart. */
  function weave(items, v, now = Date.now()) { const L = cards(v, now); if (!L.length) return items; const out = items.slice(), at = [0, 3, 7];
    L.forEach((c, i) => out.splice(Math.min(at[i] ?? out.length, out.length), 0, c)); return out; }
  /** For feedblend cardOf: the card a "q:<id>" target names, when this viewer may see it. */
  function cardOf(target, v) { const m = /^q:([a-f0-9]{24})$/.exec(String(target || "")), P = m && get(m[1]); if (!P || !canSee(P, v)) return null;
    return { target: String(target), kind: "poll", ws: P.ws, owner: P.owner, title: P.title || "your poll" }; }

  /** One tap on an option: on or off. Returns the poll, and whether this person just answered for the first time. */
  function vote(P, email, optId, on, now = Date.now()) { email = lc(email); const k = keyOf(email), had = votersOf(P).has(k), V = { ...(P.votes || {}) }, cur = { ...(V[optId] || {}) };
    if (on) cur[k] = cur[k] || { e: email, at: now }; else delete cur[k];
    V[optId] = cur; save({ ...P, votes: V }); const next = get(P.id);
    if (on && !had && email !== P.owner) { try { noteHost(next, email); } catch {} }
    return get(P.id); }
  /** The host's one note: sent on the first answer; while unread, the next few people are folded into it. */
  function noteHost(P, from) { const n = votersOf(P).size - (votersOf(P).has(keyOf(P.owner)) ? 1 : 0); if (n > POLL_NOTE_FOLD) return;
    if (blocked(P.owner, from) || blocked(from, P.owner)) return;
    const F = B(), who = (() => { try { return F.personFor({ email: P.owner, ws: P.ws }, from, ctxOf(P)).name; } catch { return "Someone"; } })();
    const what = P.title ? `when works for ${P.title}` : "your poll", key = "poll-" + P.id + "-answers", link = "/feed?poll=" + P.id;
    const line = (names, c) => { const o = c - names.length; return `${names.length === 1 ? (o > 0 ? `${names[0]} and ${o} other${o === 1 ? "" : "s"}` : names[0]) : `${names.slice(0, -1).join(", ")}${o > 0 ? `, ${names[names.length - 1]} and ${o} other${o === 1 ? "" : "s"}` : ` and ${names[names.length - 1]}`}`} answered ${what}`; };
    if (!P.noted) { if (notify(X, P.owner, { kind: "poll", type: "people", key, actor: { name: who, email: from }, title: line([who], 1), preview: "See who picked what, then pick a date.", link }) !== false) save({ ...get(P.id), noted: { names: [who], n: 1 } }); return; }
    // fold: the same note, rewritten in place while it is unread (no second note, no second push)
    const p = "system/inbox-" + hash24(P.owner), d = store.get(p)?.data, i = (d?.list || []).findIndex((x) => x.key === key), it = i >= 0 ? d.list[i] : null; if (!it || it.read) return;
    const names = [who, ...(P.noted.names || []).filter((x) => x !== who)].slice(0, 2), c = (P.noted.n || 1) + 1, L = d.list.slice(), title = line(names, c); L.splice(i, 1);
    L.unshift({ ...it, at: Date.now(), title, text: `${title}: ${it.preview || ""}` }); store.set(p, { ...d, list: L }); save({ ...get(P.id), noted: { names, n: c } }); }

  const close = (P, now = Date.now()) => { const n = save({ ...P, closedAt: P.closedAt || now }); return n; };
  /**
   * An event was saved carrying fromPoll (server/app.js): when it is the host's own, has a date and is shared, the poll
   * becomes "It's on" and everyone who answered hears once, with the link. Nobody is replied for.
   */
  function onEvent(ws, eventId, e, now = Date.now()) { const m = /^([a-f0-9]{24})\.([a-e])$/.exec(String(e?.fromPoll || "")); if (!m || !eventId) return false;
    const P = get(m[1]); if (!P || P.event || !ws || P.ws !== ws || !P.options.some((o) => o.id === m[2])) return false;
    if (!DATE.test(e.date || "") || !e.published || e.cancelled) return false;
    save({ ...P, event: { id: String(eventId), opt: m[2], at: now }, closedAt: P.closedAt || now });
    const title = clean(e.pubTitle || e.name, 80) || P.title || "It", when = whenLabel(e.date, e.startTime); let host = ""; try { host = first(X.person(P.owner)?.name); } catch {}
    const yes = new Set(Object.values(P.votes?.[m[2]] || {}).map((x) => lc(x.e))), told = new Set(); // everyone who answered hears, whichever time they picked
    for (const x of P.options.flatMap((o) => Object.values(P.votes?.[o.id] || {}))) { const to = lc(x.e); if (!to || told.has(to) || to === P.owner || blocked(P.owner, to) || blocked(to, P.owner)) continue; told.add(to);
      try { notify(X, to, { kind: "itson", key: "itson-" + eventId, actor: { name: host || "Your host", email: P.owner }, title: `It's on: ${title}, ${when}`, preview: yes.has(to) ? `${host || "Your host"} picked a time you said works. Are you in?` : `${host || "Your host"} picked ${when}. Can you make it?`, link: "/e/" + encodeURIComponent(eventId), eventId: String(eventId) }); } catch {} }
    return true; }
  const openOf = (email, now = Date.now()) => idsOf(email).map(get).filter((P) => P && isOpen(P, now));
  return { openOf, create, remove, get, item, cards, weave, cardOf, canSee, inFeed, vote, close, onEvent, isOpen, votersOf };
}

export function mountFeedPoll(app, { store, small, currentUser, C, X }) {
  const FP = makeFeedPoll(store, { C, X, app }); app.locals.feedPoll = FP;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; } catch { return null; } };
  const hits = new Map(); const over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const env = (k, d) => Math.max(1, +process.env[k] || d);
  const vOf = (u) => app.locals.feedBlend.viewerOf({ email: u ? u.email : "", ws: u ? u.ws : "" });
  // the poll behind an id, for this viewer (404 when it is gone or they may not see it)
  const open = (req, res) => { const u = viewer(req), v = vOf(u), P = FP.get(req.params.id);
    if (P && !u) { bad(res, "Sign in to see this poll.", 401, "unauthenticated"); return null; }
    if (!P || !FP.canSee(P, v)) { bad(res, "That poll isn't here any more.", 404, "not_found"); return null; } return { u, v, P }; };

  // ask: the host posts a poll
  app.post("/api/feed/polls", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|c|" + (req.ip || "?"), env("ENCORE_FEED_POLLS_PER_IP_HOUR", 30))) return bad(res, "Slow down.", 429, "rate_limited");
    const u = viewer(req); if (!u) return bad(res, "Sign in to ask when people are free.", 401, "unauthenticated");
    const b = req.body || {}, q = clean(b.q, 200) || POLL_Q, title = clean(b.title, 200);
    if ([...q].length > POLL_Q_MAX) return bad(res, `Keep the question under ${POLL_Q_MAX} characters.`, 400, "too_long");
    if ([...title].length > POLL_TITLE_MAX) return bad(res, `Keep what it's for under ${POLL_TITLE_MAX} characters.`, 400, "too_long");
    const p = textProblem(`${q} ${title}`, { contact: true }); if (p) return bad(res, p.code === "contact_info" ? "Keep phone numbers and emails out of a poll. Everyone who sees it can read them." : p.message, 400, p.code);
    const options = cleanOptions(b.options); if (typeof options === "string") return bad(res, options, 400, "bad_options");
    let closes = String(b.closes || "").trim(); const last = options[options.length - 1].date;
    if (closes) { if (!DATE.test(closes) || Number.isNaN(Date.parse(closes + "T12:00:00Z"))) return bad(res, "That closing day doesn't look right.", 400, "bad_closes");
      if (closes < iso(Date.now() - DAY)) return bad(res, "Pick a closing day from today on.", 400, "bad_closes"); if (closes > last) closes = last; }
    if (over("who|c|" + lc(u.email), env("ENCORE_FEED_POLLS_PER_HOUR", 10))) return bad(res, "That's a lot of polls for one hour. Try again in a bit.", 429, "rate_limited");
    if (FP.openOf(u.email).length >= POLL_OPEN_MAX) return bad(res, `You have ${POLL_OPEN_MAX} polls open. Close one, or pick a date on it, then ask again.`, 409, "too_many_open");
    try { X.ensureProfile?.(u); } catch {}
    const P = FP.create(u, { q, title, options, closes }); res.json({ ok: true, poll: FP.item(P, vOf(u)) }); });
  // read one (the shared link, and a fresh look after a tap)
  app.get("/api/feed/polls/:id", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|r|" + (req.ip || "?"), Math.max(60, +process.env.ENCORE_FEED_PER_IP_HOUR || 1200))) return bad(res, "Slow down.", 429, "rate_limited");
    const o = open(req, res); if (!o) return; res.json({ poll: FP.item(o.P, o.v), signedIn: !!o.u }); });
  // one tap on an option: { option, on }
  app.post("/api/feed/polls/:id/vote", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|v|" + (req.ip || "?"), env("ENCORE_FEED_POLL_VOTES_PER_IP_HOUR", 240))) return bad(res, "Slow down.", 429, "rate_limited");
    if (!viewer(req)) return bad(res, "Sign in to say when you're free.", 401, "unauthenticated");
    const o = open(req, res); if (!o) return; const { u, v, P } = o;
    if (over("who|v|" + lc(u.email), env("ENCORE_FEED_POLL_VOTES_PER_HOUR", 120))) return bad(res, "Slow down a little.", 429, "rate_limited");
    const opt = String(req.body?.option || ""); if (!P.options.some((x) => x.id === opt)) return bad(res, "Pick one of the times on the poll.", 400, "bad_option");
    if (!FP.isOpen(P)) return res.status(409).json({ code: "closed", message: P.event ? "A date is already picked for this one." : "This poll is closed.", poll: FP.item(P, v) });
    res.json({ ok: true, poll: FP.item(FP.vote(P, u.email, opt, req.body?.on !== false), v) }); });
  const mineOnly = (req, res) => { if (!viewer(req)) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const o = open(req, res); if (!o) return null;
    if (o.P.owner !== lc(o.u.email)) { bad(res, "Only the host can do that.", 403, "not_host"); return null; } return o; };
  // the host closes it (results stay) or takes it down
  app.post("/api/feed/polls/:id/close", small, (req, res) => { res.set("Cache-Control", "private, no-store"); const o = mineOnly(req, res); if (!o) return; res.json({ ok: true, poll: FP.item(FP.close(o.P), o.v) }); });
  app.delete("/api/feed/polls/:id", small, (req, res) => { res.set("Cache-Control", "private, no-store"); const o = mineOnly(req, res); if (!o) return; FP.remove(o.P); res.json({ ok: true }); });
  return FP;
}
// ---- end availability polls ----
