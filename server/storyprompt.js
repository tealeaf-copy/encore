// Story prompts: asking guests and hosts for photos right when they have them, without nagging
// (public/storyprompt.js draws every surface).
//
// 1. After an event ends (the same evening through the next 3 days, where the event is), everyone who went (replied
//    I'm in, was let in or checked in, and wasn't marked a no-show) and the host get:
//    - one card at the top of /feed and on Home: "How was <event>? Add a photo to your story", Add photos (the file
//      picker, already set to that event) and Not now. "Maya and 2 others added photos" only when it is true.
//    - one bell note the morning after (9am to 9pm, on the 3 days after), which pushes like every bell note:
//      "Photos from <event>? Add yours to the story." It opens /feed?story=<event>, where the card is for that event.
//      It shares its key (pd-<event>) with the photo drop's inbox item (server/photodrop.js), so a person never gets
//      two bell notes about one event's photos; the photo drop uses these words and this link for people with an account.
//    - a dot and "Add photos" on the "Your story" ring while a card is open.
// 2. "Add a photo from the night": one line on a past event's invite for someone who went (GET /api/public/story-line).
// 3. The host's "Ask guests for photos": one tap sends the same bell note to everyone who went, once per event, and
//    the host sees how many photos have come in (GET/POST /api/host/story-ask/:eventId).
//    On Home the card comes from a cookie (pl_sp) set with the page, so it is there from the first paint.
// 4 and 5. The event sheet and the new-user sheet read GET /api/me/story-prompt (events: the last 30 days, newest first).
//
// Limits: one prompt per event per person (the card, and one bell note whoever sends it); Not now hides the card for
// that event for good (system/storyprompt-<hash of email>, so it follows the account); one card at a time; nothing for
// cancelled events, No photos events, drops, interest checks or example and sample events; nothing once that person
// has added a photo to the event (a photo the host hid still counts). Private and friends-only events still prompt the
// people who were there: who sees those photos is unchanged (server/feedvisual.js momentsPublic and wasThere).
//
// Storage: system/storyprompt-<hash of email> { dismissed: { <eventId>: at } }, system/storyask-<eventId>
// { bell: { <hash of email>: at }, askedAt, asked }.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, workspaceOfEvent, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { timesOf } from "./delightafter.js";
import { localParts } from "./reminders.js";
import { coverOf } from "./eventcover.js";
import { momentsPublic } from "./feedvisual.js";

const DAY = 864e5, ISO = /^\d{4}-\d{2}-\d{2}$/, ID = /^[A-Za-z0-9_-]{1,80}$/;
export const STORY_PROMPT = { days: 3, eveningFrom: 20, bellFrom: 9, bellTo: 21, pickerDays: 30, pickerMax: 12 };
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const dayNo = (d) => Math.round(Date.parse(d + "T12:00:00Z") / DAY);
const endDay = (ev) => (ISO.test(ev?.endDate || "") && ev.endDate >= (ev.date || "") ? ev.endDate : ev?.date || "");
const titleOf = (ev) => clean(ev?.pubTitle || ev?.name, 120) || "your event";
const isDemo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");

/** An event that can get a story prompt at all: real, happened as planned, photos allowed. Pure. */
export const promptable = (ev) => !!ev && !ev.example && !ev.sample && !ev.cancelled && !ev.noPhotos && ev.stage !== "interest" && !ev.drop && !ev.preorder && ISO.test(ev.date || "");
/** Days since the event's last day, and the hour, where the event is. Pure. */
function sinceEnd(ev, now) { const t = timesOf(ev), L = localParts(now, t.tz); return { t, hour: L.hour, dd: dayNo(L.day) - dayNo(endDay(ev)) }; }
/** Has it ended? With a time: its end has passed. Without one (or over several days): from 8pm on its last day. Pure. */
export function ended(ev, now = Date.now()) { if (!ISO.test(ev?.date || "")) return false; const { t, hour, dd } = sinceEnd(ev, now), timed = t.hasTime && endDay(ev) === ev.date;
  if (dd > 0) return !timed || now >= t.endMs; return dd === 0 && (timed ? now >= t.endMs : hour >= STORY_PROMPT.eveningFrom); }
/** The card shows from the end of the event (the same evening) through the next 3 days. Pure. */
export function cardWindow(ev, now = Date.now()) { return promptable(ev) && ended(ev, now) && sinceEnd(ev, now).dd <= STORY_PROMPT.days; }
/** The bell note goes the morning after: 9am to 9pm where the event is, on any of the 3 days after (if the server slept). Pure. */
export function bellWindow(ev, now = Date.now()) { if (!promptable(ev) || !ended(ev, now)) return false; const { hour, dd } = sinceEnd(ev, now); return dd >= 1 && dd <= STORY_PROMPT.days && hour >= STORY_PROMPT.bellFrom && hour < STORY_PROMPT.bellTo; }
/** "Maya and 2 others added photos": from the people who really added (first names; `count` people in all). Pure. */
export function addedLine(names = [], count = names.length) { const N = [...new Set(names.map(first).filter(Boolean))], n = Math.max(count, N.length); if (!n) return "";
  if (!N.length) return `${n} ${n === 1 ? "guest" : "guests"} added photos`; if (n === 1) return `${N[0]} added photos`; if (n === 2 && N.length >= 2) return `${N[0]} and ${N[1]} added photos`;
  return `${N[0]} and ${n - 1} ${n - 1 === 1 ? "other" : "others"} added photos`; }
export const bellText = (title) => `Photos from ${title}? Add yours to the story.`;
export const bellLink = (id) => `/feed?story=${encodeURIComponent(id)}`;
/** The words the kudos ask by text gains (server/kudosask.js), so photos never need a text of their own. */
export const TEXT_TAIL = "Got photos? Add them there too.";

export function makeStoryPrompt({ store, C, X, app = null }) {
  const sys = (k) => store.get("system/" + k)?.data || null, put = (k, d) => store.set("system/" + k, d);
  const mineDoc = (email) => sys("storyprompt-" + hash(email)) || { kind: "storyprompt", dismissed: {} };
  const askDoc = (id) => sys("storyask-" + id) || { kind: "storyask", eventId: id, bell: {} };
  const sample = (ws, I) => { try { return isDemo(ws) || !!app?.locals?.feedVisual?.sample?.(ws, I); } catch { return false; } };
  const isAccount = (email) => { const u = getDbUser(email); return !!u && u.ws !== DEFAULT_WS; };
  // every photo and video on an event, hidden ones too (a photo the host hid still means that person added one)
  const momentsAll = (ws, id) => scopeStore(store, ws).list("moments").map((d) => d.data || {}).filter((m) => m.eventId === id);
  const noShows = (ws, id) => new Set(scopeStore(store, ws).list("rsvps").map((d) => d.data || {}).filter((r) => r.eventId === id && r.noShow === true && r.email).map((r) => lc(r.email)));
  /** Everyone who went, the host first: [{ email, host }]. */
  function wentTo(I, x) { const out = [], gone = noShows(x.ws, x.id), owner = lc(x.owner); if (owner) out.push({ email: owner, host: true });
    for (const [em, L] of I.att) if (em !== owner && !gone.has(em) && L.some((a) => a.eventId === x.id)) out.push({ email: em, host: false }); return out; }
  const eventOut = (r) => ({ id: r.x.id, title: titleOf(r.x.e), date: r.x.e.date, host: !!r.host, open: momentsPublic(r.x.e), mine: r.n, cover: { title: titleOf(r.x.e), activity: clean(r.x.e.activity, 60), coverSpec: coverOf(r.x.e, r.x.id) } });
  /** The events this person can add photos to: went to or hosted, in the last 30 days, newest first. */
  function eventsFor(email, now = Date.now()) { const me = lc(email); if (!me || !isAccount(me)) return []; const I = X.index(), today = new Date(now + DAY).toISOString().slice(0, 10), from = new Date(now - STORY_PROMPT.pickerDays * DAY).toISOString().slice(0, 10), out = [];
    const ids = new Set((I.att.get(me) || []).map((a) => a.eventId)); for (const [id, x] of I.events) if (lc(x.owner) === me) ids.add(id);
    for (const id of ids) { const x = I.events.get(id); if (!x || !promptable(x.e) || x.e.date > today || x.e.date < from || !ended(x.e, now) || sample(x.ws, I)) continue; const host = lc(x.owner) === me; if (!host && noShows(x.ws, id).has(me)) continue;
      out.push({ x, host, n: momentsAll(x.ws, id).filter((m) => lc(m.authorEmail) === me).length }); }
    return out.sort((a, b) => String(endDay(b.x.e)).localeCompare(String(endDay(a.x.e))) || (timesOf(b.x.e).startMs || 0) - (timesOf(a.x.e).startMs || 0)).slice(0, STORY_PROMPT.pickerMax); }
  /** Who else added photos to an event, as a line; "" when nobody has. */
  function addedBy(x, me) { const by = new Map(); for (const m of momentsAll(x.ws, x.id)) { if (m.hidden) continue; const k = lc(m.authorEmail) || m.authorKey || ""; if (!k || k === lc(me)) continue; if (!by.get(k)) by.set(k, first(m.authorName)); }
    return addedLine([...by.values()].filter(Boolean), by.size); }
  /** What the feed, Home and the sheets need: { card, events, dot }. `forId`: the event a bell note opened. */
  function promptFor(email, { now = Date.now(), forId = "" } = {}) { const L = eventsFor(email, now), D = mineDoc(email).dismissed || {};
    const open = L.filter((r) => !r.n && !D[r.x.id] && cardWindow(r.x.e, now)), linked = forId ? L.find((r) => r.x.id === forId && !r.n) : null, pick = linked || open[0] || null;
    // host: they have made an event before, so the new-user sheet's next step is "Plan something", not "Find something to go to"
    const me = lc(email), ws = getDbUser(me)?.ws || "", host = !!(ws && ws !== DEFAULT_WS && [...X.index().events.values()].some((x) => lc(x.owner) === me));
    return { card: pick ? { ...eventOut(pick), added: addedBy(pick.x, email) } : null, dot: open.length > 0, events: L.map(eventOut), host }; }
  function dismiss(email, id) { if (!ID.test(id)) return false; const d = mineDoc(email), D = { ...(d.dismissed || {}), [id]: Date.now() }, keep = Object.entries(D).sort((a, b) => b[1] - a[1]).slice(0, 200);
    put("storyprompt-" + hash(email), { kind: "storyprompt", email: lc(email), dismissed: Object.fromEntries(keep) }); return true; }
  const dismissed = (email, id) => !!(mineDoc(email).dismissed || {})[id];
  /** The one bell note for this person and event. False when they already had it (from here, the host or the photo drop). */
  function bell(email, x, now = Date.now()) { const em = lc(email), d = askDoc(x.id), k = hash(em); if (d.bell?.[k]) return false;
    put("storyask-" + x.id, { ...d, bell: { ...(d.bell || {}), [k]: now } }); // logged first: a crash mid-send never means a second note
    return X.notify(em, { kind: "photos", key: `pd-${x.id}`, title: bellText(titleOf(x.e)), text: bellText(titleOf(x.e)), link: bellLink(x.id), eventId: x.id }) !== false; }
  /** For the photo drop (server/photodrop.js): the words and link for its inbox item when this guest has an account. */
  function bellFor(email, id) { try { const em = lc(email), x = X.index().events.get(id); if (!x || !promptable(x.e) || !isAccount(em)) return null; const d = askDoc(id), k = hash(em);
    if (!d.bell?.[k]) put("storyask-" + id, { ...d, bell: { ...(d.bell || {}), [k]: Date.now() } }); return { text: bellText(titleOf(x.e)), link: bellLink(id) }; } catch { return null; } }
  const wants = (x, p) => isAccount(p.email) && !dismissed(p.email, x.id) && !momentsAll(x.ws, x.id).some((m) => lc(m.authorEmail) === p.email);
  /** The morning-after bell notes that are due, for every event. */
  function run({ now = Date.now() } = {}) { const I = X.index(), out = { sent: 0, events: [] };
    for (const x of I.events.values()) { if (!bellWindow(x.e, now) || sample(x.ws, I)) continue; let n = 0;
      for (const p of wentTo(I, x)) { if (!p.host && (x.e.autoRemind === false || x.e.photoDrops === false)) continue; // the host switched off messages to guests
        if (wants(x, p) && bell(p.email, x, now)) n++; }
      if (n) { out.sent += n; out.events.push({ eventId: x.id, sent: n }); } }
    return out; }
  /** The host's view of one event: how many photos are in, and whether guests were asked. */
  function status(x, now = Date.now()) { const I = X.index(), M = momentsAll(x.ws, x.id).filter((m) => !m.hidden), d = askDoc(x.id), guests = wentTo(I, x).filter((p) => !p.host);
    return { photos: M.length, people: new Set(M.map((m) => lc(m.authorEmail) || m.authorKey || "")).size, went: guests.length, asked: !!d.askedAt, askedAt: d.askedAt || 0, sent: d.asked || 0, can: promptable(x.e) && ended(x.e, now) && !sample(x.ws, I) && guests.length > 0 }; }
  /** Ask guests for photos: the bell note to everyone who went, once per event. */
  function ask(x, now = Date.now()) { const d = askDoc(x.id); if (d.askedAt) return { ok: true, already: true, ...status(x, now) };
    const I = X.index(), guests = wentTo(I, x).filter((p) => !p.host); let sent = 0; put("storyask-" + x.id, { ...d, askedAt: now, asked: 0 });
    for (const p of guests) if (wants(x, p) && bell(p.email, x, now)) sent++;
    put("storyask-" + x.id, { ...askDoc(x.id), askedAt: now, asked: sent }); return { ok: true, already: false, ...status(x, now) }; }
  return { promptFor, eventsFor, dismiss, dismissed, run, bell, bellFor, ask, status, wentTo, addedBy };
}

export function mountStoryPrompt(app, { store, small, currentUser, C, X, jobs = !process.env.NODE_TEST_CONTEXT }) {
  const SP = makeStoryPrompt({ store, C, X, app }); app.locals.storyPrompt = SP;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + "|sp", now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { if (hits.size > 20000) hits.clear(); h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const viewer = (req) => { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; };
  // signed out this answers with nothing to show (never a 401: pages ask it without knowing who is looking)
  app.get("/api/me/story-prompt", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = viewer(req); if (!u) return res.json({ signedIn: false, card: null, dot: false, events: [] });
    const forId = ID.test(String(req.query.for || "")) ? String(req.query.for) : ""; res.json({ signedIn: true, ...SP.promptFor(u.email, { forId }) }); });
  app.post("/api/me/story-prompt/dismiss", small, (req, res) => { res.set("Cache-Control", "private, no-store"); const u = viewer(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated");
    const id = String(req.body?.eventId || ""); if (!ID.test(id)) return bad(res, "No such event."); SP.dismiss(u.email, id); res.json({ ok: true }); });
  // "Add a photo from the night" on a past event's invite: only for someone who went (their reply's proof, or their account)
  app.get("/api/public/story-line/:eventId", (req, res) => { res.set("Cache-Control", "private, no-store"); if (limited(req, 600)) return bad(res, "Slow down.", 429, "rate_limited");
    const id = clean(req.params.eventId, 80), no = () => res.json({ can: false }); if (!ID.test(id)) return no(); const ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null;
    if (!ev || !promptable(ev) || !ended(ev) || isDemo(ws)) return no();
    const P = req.query.rid ? (X.kudosProof || X.rsvpProof)?.(id, clean(req.query.rid, 80), clean(req.query.code, 40)) : null, u = viewer(req); let who = "";
    if (P && P.r.response === "going" && P.r.noShow !== true) who = "proof"; else if (u && app.locals.feedVisual?.wasThere?.(X.index(), id, lc(u.email))) who = "account";
    if (!who) return no(); res.json({ can: true, title: clean(ev.pubTitle || ev.name, 120), open: momentsPublic(ev), proof: who === "proof" }); });
  // ---- the host: how many photos are in, and one tap to ask everyone who went ----
  const hostEvent = (req, res) => { const u = viewer(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const id = clean(req.params.eventId, 80);
    if (!ID.test(id) || workspaceOfEvent(id) !== u.ws) { bad(res, "No such event.", 404, "not_found"); return null; } const x = X.index().events.get(id); if (!x) { bad(res, "No such event.", 404, "not_found"); return null; } return x; };
  app.get("/api/host/story-ask/:eventId", (req, res) => { res.set("Cache-Control", "private, no-store"); const x = hostEvent(req, res); if (!x) return; res.json(SP.status(x)); });
  app.post("/api/host/story-ask/:eventId", small, (req, res) => { res.set("Cache-Control", "private, no-store"); const x = hostEvent(req, res); if (!x) return;
    if (!promptable(x.e)) return bad(res, x.e.cancelled ? "This one was cancelled, so there's nothing to ask for." : x.e.noPhotos ? "This one was no photos, so there's nothing to ask for." : "Photos aren't part of this one.", 400, "not_promptable");
    if (!ended(x.e)) return bad(res, "You can ask once it's over.", 400, "not_yet"); res.json(SP.ask(x)); });
  // Home in the app draws its card from a small cookie (pl_sp) set with the page itself, so the card is there from the
  // first paint and nothing below it moves. Set (or cleared) on GET / only, for the signed-in person; never HttpOnly, since the page reads it.
  SP.hint = (req, res) => { if (req.method !== "GET" || req.path !== "/") return; const cur = (/(?:^|;\s*)pl_sp=([^;]*)/.exec(req.headers.cookie || "") || [])[1] || "", u = viewer(req); let val = "";
    if (u) { const c = SP.promptFor(u.email).card; if (c) { const min = { id: c.id, title: c.title, added: c.added, open: c.open, cover: c.cover }; val = encodeURIComponent(JSON.stringify(min)); if (val.length > 1800) val = encodeURIComponent(JSON.stringify({ ...min, cover: { title: c.title, activity: c.cover.activity } })); if (val.length > 1800) val = ""; } }
    if (val !== cur) res.append("Set-Cookie", val ? `pl_sp=${val}; Path=/; SameSite=Lax; Max-Age=${4 * 86400}${req.secure ? "; Secure" : ""}` : "pl_sp=; Path=/; SameSite=Lax; Max-Age=0"); };
  if (jobs) { const tick = () => { try { SP.run(); } catch (e) { console.warn("[story prompt]", e?.message || e); } }; const t = setInterval(tick, 30 * 60e3); t.unref?.(); setTimeout(tick, 150e3).unref?.(); }
  return SP;
}
