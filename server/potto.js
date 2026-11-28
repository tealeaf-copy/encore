// Ask Potto: the assistant sheet behind the "Ask Potto" pill (public/potto.js), for guests and hosts.
//
// - POST /api/potto/ask { message, threadId?, eventId?, photo?: { type, data }, tz? }
//   → { threadId, answer, links: [{ label, href }], actions: [{ id, label, confirm, method, url, body, done }], mode, note? }
//   or { route: "help" } for support questions: the sheet asks the help guide (POST /api/help/ask, server/help.js) and
//   keeps "Talk to a person" there, so one Potto covers both. POST /api/potto/note saves that answer to the thread.
// - GET /api/potto/status?eventId=&tz=: what works here (AI on, off or offline mode), today's allowance, and three
//   questions to open with (suggestFor): about the event on screen, a draft that still needs something, what's next.
// - GET /api/potto/events: events to attach (yours, and your plans).
// - GET /api/potto/threads, GET /api/potto/threads/:id, DELETE /api/potto/threads/:id, DELETE /api/potto/threads.
//
// Grounding: every answer comes from a small context built here, for the person asking only (buildContext):
// their own events (titles, dates, the area, counts, and guests' first names, which a host already sees), their plans
// (and, only for an event they're in, the first names of others who are in and chose to show), the hosts they follow,
// and public events. Never an email, a phone, a street address, a reply's note or anyone's private event. Blocked people
// and hosts are left out. The model (server/ai.js complete, with ENCORE_FAKE_AI=1 for tests and offline) answers in
// JSON; links must be ones the context holds, and actions are built here, only for the host's own events, from a fixed
// list of existing endpoints. Nothing is sent until the person taps Send in the sheet.
// Nudges (server/pottonudge.js) answer here too: who would get one, by which channel, and a card that sends on Send only.
// Without a key the same context is answered by plain rules (server/pottorules.js): search, who's going, who hasn't
// replied, finding pages, help, and a plain reminder template. The sheet says what needs AI.
//
// Limits: ENCORE_POTTO_PER_HOUR asks an hour (default 30) and ENCORE_POTTO_TOKENS_PER_DAY model tokens a day (default
// 40000, counted as characters / 4). Past the day's tokens Potto keeps answering with the plain rules, and says so.
// History: system/potto-<hash> { email, threads } (20 threads, 40 turns each), deletable here, and removed with the
// account (server/account.js deletes every system doc that carries the person's email). Usage: system/pottouse-<hash>.
import crypto from "node:crypto";
import { complete, aiMode, parseJsonLoose } from "./ai.js";
import { pottoReply, whenOf, isSupport } from "./pottorules.js";
import { scopeStore, getWorkspace, getDbUser, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { seatsOf, waitlistOf } from "./social.js";
import { keyOf } from "./safety.js";
import { todayIn, tzOk } from "./tz.js";
import { safeLink } from "./inbox.js";
import { POTTO_VOICE } from "./pottovoice.js";
import { runPottoReply, runCityAction, RUN_LINK } from "./runtemplates.js"; // New York run templates

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const cleanText = (v, n) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const rid = () => crypto.randomBytes(6).toString("hex");
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const perHour = () => Math.max(1, Number(process.env.ENCORE_POTTO_PER_HOUR || 30));
export const tokensPerDay = () => Math.max(0, Number(process.env.ENCORE_POTTO_TOKENS_PER_DAY ?? 40000));
export const estimateTokens = (...parts) => parts.reduce((n, p) => n + Math.ceil(String(p || "").length / 4), 0);
export const MAX_THREADS = 20, MAX_TURNS = 40;
const where = (e) => [e.hood, e.city].filter(Boolean).join(", "); // the area, never the street
// pages Potto may link to besides the ones in the context
const PAGE = /^\/(discover|plans|saved|chats|inbox|settings|ideas|feed|about|community)(\?[\w=&%+.-]*)?$|^\/\?app=1(&new=1)?(#studio)?$/;
// what an action may call: existing endpoints only
export const ACTION_URL = /^\/api\/(chats\/[A-Za-z0-9_-]{1,80}\/messages|host\/broadcast|host\/announce)$/;

/** What an invite still needs before it's shared, in the order a guest would miss it. Words only, never the values. */
export const missingOf = (e) => [!e?.date && !(e?.stage === "interest" && (e.dateOptions || []).length) && "a date", !String(e?.meetPoint || e?.venueName || e?.reservation?.restaurant || e?.lodging?.name || "").trim() && "a place", !String(e?.why || e?.description || "").trim() && "a few words on what to expect"].filter(Boolean);
/** The context for one person. Everything in it is theirs to see. */
export function buildContext({ store, C, X, F, safety, user, tz = "", eventId = "", now = Date.now() }) {
  const em = lc(user.email), today = todayIn(tzOk(tz) ? tz : ""), soon = addDays(today, 60), W = getWorkspace(user.ws), h = C?.profileOf?.(user.ws);
  const blocked = new Set((safety?.blocksOf?.(em) || []).map((b) => b.target)); const hid = safety?.hiddenSet?.() || new Set();
  const okPerson = (email) => !email || !(blocked.has("person:" + keyOf(email)) || hid.has("person:" + keyOf(email)));
  const okHost = (handle) => !handle || !(blocked.has("host:" + lc(handle)) || hid.has("host:" + lc(handle)));
  const isHost = !!h?.handle && W?.personal !== false;
  // my own events
  const myEvents = [], drafts = [];
  if (user.ws && user.ws !== DEFAULT_WS) {
    const S = scopeStore(store, user.ws), R = S.list("rsvps").map((d) => ({ id: d.id, ...d.data }));
    for (const d of S.list("events")) { const e = d.data; if (!e || e.example || e.sample || e.cancelled) continue;
      // a draft with no date yet: only its title and what it still needs, so Potto can say what's missing before sharing
      if (!e.date) { if (drafts.length < 10 && !e.published) drafts.push({ id: d.id, title: clean(e.pubTitle || e.name, 90) || "Untitled event", missing: missingOf(e), shared: false, link: `/?app=1&open=${encodeURIComponent(d.id)}#studio` }); continue; }
      if (e.date < addDays(today, -7) || e.date > soon) continue;
      const rs = R.filter((r) => r.eventId === d.id && okPerson(r.email)), going = rs.filter((r) => r.response === "going");
      const seats = going.reduce((n, r) => n + seatsOf(r, e), 0), spots = +e.headcount || 0;
      const replied = new Set(rs.flatMap((r) => [lc(r.email), lc(r.name)]).filter(Boolean));
      const noReply = (e.guests || []).filter((g) => g && !/going|attended|declined|maybe|waitlist|requested|no\b|not invited/i.test(g.status || "") && !replied.has(lc(g.email)) && !replied.has(lc(g.name)) && okPerson(g.email)).map((g) => first(g.name)).filter(Boolean);
      const id = encodeURIComponent(d.id);
      myEvents.push({ id: d.id, title: e.pubTitle || e.name || "Your event", date: e.date, time: e.startTime || "", where: where(e), spots, going: seats, open: spots ? Math.max(0, spots - seats) : 0,
        maybe: rs.filter((r) => r.response === "maybe").length, asked: rs.filter((r) => r.response === "requested").length, waitlist: waitlistOf(rs.map((r) => ({ id: r.id, data: r }))).length,
        goingNames: going.map((r) => first(r.name)).filter(Boolean).slice(0, 40), maybeNames: rs.filter((r) => r.response === "maybe").map((r) => first(r.name)).filter(Boolean).slice(0, 20), noReply: noReply.slice(0, 40),
        missing: missingOf(e), shared: !!(e.published || e.discoverable), pageLink: `/e/${id}`,
        discoverable: !!e.discoverable, audienceWho: e.audienceWho ? clean(e.audienceWho, 80) : "", approval: !!e.approvalRequired,
        link: `/?app=1&open=${id}#studio`, guestsLink: `/?app=1&open=${id}&step=6#studio`, shareLink: `/?app=1&open=${id}#studio`, chatLink: `/chats/${id}` }); }
    myEvents.sort((a, b) => a.date.localeCompare(b.date));
  }
  // my plans: events I'm in for
  const plans = [];
  try { const I = X?.index?.(); for (const a of I?.att?.get(em) || []) { const x = I.events.get(a.eventId); if (!x || x.ws === user.ws) continue; const e = x.e, ph = C?.profileOf?.(x.ws);
    if (!e.date || e.date < today || e.date > soon || e.cancelled || !okHost(ph?.handle)) continue;
    const R = scopeStore(store, x.ws).list("rsvps").map((d) => d.data).filter((r) => r && r.eventId === a.eventId && r.response === "going");
    const meIn = R.some((r) => lc(r.email) === em);
    const names = meIn && !e.hideGuests ? R.filter((r) => lc(r.email) !== em && r.showMe !== false && okPerson(r.email)).map((r) => first(r.name)).filter(Boolean).slice(0, 30) : null;
    plans.push({ id: a.eventId, title: e.pubTitle || e.name || "Event", date: e.date, time: e.startTime || "", where: where(e), host: ph?.name || "", going: R.reduce((n, r) => n + seatsOf(r, e), 0), names, link: `/g#rsvp-${encodeURIComponent(a.eventId)}`, ...(meIn ? { chatLink: `/chats/${encodeURIComponent(a.eventId)}` } : {}) }); } } catch {}
  plans.sort((a, b) => a.date.localeCompare(b.date));
  // hosts I follow
  let follows = []; try { follows = (F?.followedHosts?.(em) || []).filter((x) => okHost(x.handle)).slice(0, 20).map((x) => ({ name: x.name, handle: x.handle, link: `/@${x.handle}` })); } catch {}
  // public events
  let pub = []; try { pub = (C?.discover?.().events || []).filter((c) => c && !c.private && !String(c.id).startsWith("p-") && c.date && c.date >= today && c.date <= addDays(today, 21) && okHost(c.host?.handle))
    .slice(0, 60).map((c) => ({ id: c.id, title: c.title, date: c.date, time: c.startTime || "", where: [c.hood, c.city].filter(Boolean).join(", "), size: +c.headcount || 0, going: +c.going || 0, price: c.priceLine || (c.free || !c.price ? "Free" : String(c.price)), tags: (c.tags || []).slice(0, 5), kind: c.activity || c.kind || "", host: c.host?.name || "", link: `/e/${encodeURIComponent(c.id)}` })); } catch {}
  const attached = eventId && ID.test(eventId) && (myEvents.some((e) => e.id === eventId) || drafts.some((e) => e.id === eventId) || plans.some((e) => e.id === eventId)) ? eventId : "";
  return { today, me: { first: first(user.name), host: isHost, handle: h?.handle || "", city: h?.city || "", followers: isHost ? (C?.followersOf?.(user.ws) || []).length : 0 }, myEvents, ...(drafts.length ? { drafts } : {}), plans, follows, public: pub, attached };
}

/**
 * Three questions to open the sheet with, from what this person has going on and the event on screen (eventId), each
 * one a question the plain rules answer from the context. Never a made-up event: with nothing going on, how to start.
 */
export function suggestFor(ctx, { eventId = "" } = {}) {
  const t = (e) => clean(e.title, 48), mine = ctx.myEvents || [], drafts = ctx.drafts || [], up = mine.filter((e) => e.date >= ctx.today), past = mine.filter((e) => e.date < ctx.today).sort((a, b) => b.date.localeCompare(a.date)), plans = ctx.plans || [];
  const out = [], add = (q) => { if (q && out.length < 3 && !out.includes(q)) out.push(q); };
  const forEvent = (e) => { if (!e) return; if (e.date && e.date < ctx.today) return add(`How did ${t(e)} go?`);
    if (e.missing?.length || !e.shared) add(`What's missing from ${t(e)}?`);
    if (!e.date) return add("Which date works for everyone?");
    if ((e.noReply || []).length) add(`Who hasn't replied to ${t(e)}?`);
    if (e.going && e.date <= addDays(ctx.today, 2)) add(`Draft a reminder for ${t(e)}`);
    if (e.shared && e.open > 0) add(`Fill the open spots for ${t(e)}`);
    if (e.going) add(`Draft a reminder for ${t(e)}`); };
  const here = eventId && ID.test(eventId) ? [...drafts, ...mine].find((e) => e.id === eventId) : null, plan = eventId ? plans.find((e) => e.id === eventId) : null;
  forEvent(here);
  if (plan) { add(`What time is ${t(plan)}?`); add(`Who else is going to ${t(plan)}?`); add(`What should I bring to ${t(plan)}?`); }
  forEvent(drafts[0]); forEvent(up[0]); forEvent(past[0]); forEvent(up[1]);
  if (!mine.length && !drafts.length) { if (plans[0]) { add(`What time is ${t(plans[0])}?`); add(`Who else is going to ${t(plans[0])}?`); }
    add("What should I host?"); add("Which date works for everyone?"); add("Where could I host it?"); }
  add("What should I host?"); add("What's on this weekend?");
  return { suggest: out, here: here || plan ? { eventId: (here || plan).id, title: t(here || plan) } : null };
}

/** The prompt for the model: the rules, the context, the last few turns and the question. */
export function pottoPrompt(ctx, message, history = []) {
  return `POTTO-ASK
You are Potto, the small clay pot who helps people on Pottery Lab. Hosts plan small events for their people; guests reply I'm in, Maybe or Can't go.
Answer using only the context below. Never invent events, people, names, numbers or prices. If the context doesn't have it, say so plainly.
${POTTO_VOICE}
At most 90 words. No headings. Say "spots", not "seats". Say "guests", not "attendees".
Links: only hrefs that appear in the context, at most 3.
Ideas to host: start from "ideas" in the context, in order, and say each one's label as given. Only ideas with source "platform" are measured; call the rest trends on social or general ideas, never data, and never add numbers to them.
Planning help: "missing" on an event or a draft lists what its invite still needs; name those, and say it's ready only when the list is empty. No date yet: in the editor, tapping the date offers "Ask friends first" (up to three dates, friends tap the ones that work). No place yet: never name a venue; in the editor, places nearby that fit show under the title once a kind is picked.
At most one action, only for the host's own events (myEvents): "remind" with text (a short reminder for the group chat, under 300 characters), "broadcast" (tell people on Pottery Lab it suits, when discoverable or audienceWho is set) or "announce" (tell the host's followers). The person confirms before anything is sent, so describe it, don't claim it's done.
Reply with only JSON: {"answer": string, "links": [{"label": string, "href": string}], "action": null or {"type": "remind" | "broadcast" | "announce", "eventId": string, "text": string}}
<context>
${JSON.stringify(ctx)}
</context>
<history>
${history.slice(-6).map((t) => `${t.role === "me" ? "Person" : "Potto"}: ${clean(t.text, 400)}`).join("\n")}
</history>
<question>
${message}
</question>`;
}

/** Links a reply may carry: ones in the context, or the app's own pages. */
export function allowedLinks(ctx, links) {
  const known = new Set(); for (const L of [ctx.myEvents, ctx.drafts, ctx.plans, ctx.public, ctx.follows]) for (const e of L || []) for (const k of ["link", "guestsLink", "shareLink", "chatLink", "pageLink"]) if (e[k]) known.add(e[k]);
  const out = []; for (const l of Array.isArray(links) ? links : []) { const href = safeLink(l?.href), label = clean(l?.label, 60); if (!href || !label || !(known.has(href) || PAGE.test(href) || RUN_LINK.test(href)) || out.some((x) => x.href === href)) continue; out.push({ label, href }); if (out.length >= 3) break; }
  return out;
}
/** A one-tap action, built here from the model's proposal, only for one of the host's own upcoming events. */
export function buildAction(ctx, a) {
  if (!a || typeof a !== "object" || !ctx.me?.host) return null; const e = (ctx.myEvents || []).find((x) => x.id === a.eventId && x.date >= ctx.today); if (!e) return null;
  const id = encodeURIComponent(e.id);
  if (a.type === "remind") { const text = cleanText(a.text, 600); if (!text || !e.going) return null; return { id: "remind-" + e.id, type: "remind", label: "Send to the chat", confirm: `Send this to the ${e.going} ${e.going === 1 ? "guest" : "guests"} in the ${e.title} chat?`, method: "POST", url: `/api/chats/${id}/messages`, body: { text }, done: "Sent. It's in the group chat.", preview: text }; }
  if (a.type === "broadcast" && (e.discoverable || e.audienceWho)) return { id: "broadcast-" + e.id, type: "broadcast", label: "Tell people it suits", confirm: `Tell people on Pottery Lab who'd like ${e.title} that ${e.open || "some"} ${e.open === 1 ? "spot is" : "spots are"} open?`, method: "POST", url: "/api/host/broadcast", body: { eventId: e.id }, done: "Done. I told people it suits." };
  if (a.type === "announce" || a.type === "broadcast") { if (!ctx.me.followers) return null; return { id: "announce-" + e.id, type: "announce", label: "Tell your followers", confirm: `Tell your ${ctx.me.followers} ${ctx.me.followers === 1 ? "follower" : "followers"} about ${e.title}?`, method: "POST", url: "/api/host/announce", body: { eventId: e.id }, done: "Sent to your followers." }; }
  return null;
}

// ---------- storage ----------
const histPath = (em) => "system/potto-" + hash(em);
const usePath = (em) => "system/pottouse-" + hash(em);
export function makePottoStore(store) {
  const threads = (em) => store.get(histPath(em))?.data?.threads || [];
  const save = (em, T) => (T.length ? store.set(histPath(em), { kind: "potto", email: lc(em), threads: T.slice(0, MAX_THREADS) }) : store.delete(histPath(em)));
  function append(em, threadId, turns) { const T = threads(em); let t = T.find((x) => x.id === threadId);
    if (!t) { t = { id: rid(), title: clean(turns[0]?.text, 60) || "New chat", at: Date.now(), turns: [] }; T.unshift(t); }
    t.turns = [...t.turns, ...turns.map((x) => ({ ...x, at: Date.now() }))].slice(-MAX_TURNS); t.at = Date.now();
    save(em, [t, ...T.filter((x) => x.id !== t.id)]); return t; }
  const day = () => new Date().toISOString().slice(0, 10);
  const usage = (em) => { const u = store.get(usePath(em))?.data; return u && u.day === day() ? u : { kind: "pottouse", email: lc(em), day: day(), tokens: 0, asks: 0 }; };
  const spend = (em, tokens) => { const u = usage(em); store.set(usePath(em), { ...u, tokens: u.tokens + tokens, asks: u.asks + 1 }); };
  return { threads, save, append, usage, spend, remove: (em, id) => { const T = threads(em), next = id ? T.filter((x) => x.id !== id) : []; save(em, next); return T.length - next.length; } };
}

// ---------- routes ----------
export function mountPotto(app, { store, express, currentUser, C, X }) {
  const body = express.json({ limit: "3mb" }), small = express.json({ limit: "64kb" }), P = makePottoStore(store);
  const me = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || !u.email || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in to ask Potto." }); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  const hits = new Map(); const limited = (k) => { const now = Date.now(), h = (hits.get(k) || []).filter((t) => now - t < 3600e3); if (h.length >= perHour()) { hits.set(k, h); return true; } h.push(now); hits.set(k, h); if (hits.size > 20000) hits.clear(); return false; };
  const ctxOf = (req, u, eventId = "") => { const c = buildContext({ store, C, X, F: app.locals.fanclub, safety: app.locals.appstore?.safety, user: u, tz: String(req.body?.tz || req.query?.tz || "").slice(0, 60), eventId });
    try { const I = app.locals.trends?.forPotto(u); if (I?.length) c.ideas = I; } catch {}
    try { app.locals.pottoNudge?.enrich?.(u, c); } catch {} return c; }; // people on the invite plan who haven't replied, and who was nudged (server/pottonudge.js) // ideas to host, labelled by source (server/trends.js)
  const status = (u) => { const mode = aiMode(), used = P.usage(u.email).tokens, cap = tokensPerDay(); return { ai: mode, left: Math.max(0, cap - used), limit: cap, can: { search: true, help: true, navigation: true, drafting: mode !== "missing_key", photos: mode === "live" },
    unavailable: mode === "missing_key" ? "AI isn't set up on this server. I can still search, find pages, look things up and answer help questions." : used >= cap ? "You've used today's AI allowance. I'll keep to plain answers until tomorrow." : "" }; };
  app.locals.potto = { P, ctxOf, lastPrompt: "" };

  const hosting = (u) => { try { const t = new Date().toISOString().slice(0, 10); return scopeStore(store, u.ws).list("events").some((d) => d.data && !d.data.example && !d.data.sample && !d.data.cancelled && (d.data.date || "") >= t); } catch { return false; } };
  app.get("/api/potto/status", (req, res) => { const u = me(req, res); if (!u) return; let sug = {}; try { sug = suggestFor(ctxOf(req, u), { eventId: clean(req.query.eventId, 80) }); } catch {} // what to ask from here
    res.json({ ...status(u), hosting: hosting(u), first: first(u.name), ...sug }); });
  app.get("/api/potto/events", (req, res) => { const u = me(req, res); if (!u) return; const c = ctxOf(req, u);
    res.json({ events: [...c.myEvents.filter((e) => e.date >= c.today).map((e) => ({ id: e.id, title: e.title, when: whenOf(e), mine: true })), ...c.plans.map((e) => ({ id: e.id, title: e.title, when: whenOf(e) }))].slice(0, 20) }); });
  app.post("/api/potto/ask", body, async (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    if (limited("u:" + lc(u.email))) return res.status(429).json({ code: "rate_limited", message: "That's a lot of questions for one hour. Try again a little later." });
    const message = cleanText(b.message, 800); if (message.length < 2 && !b.photo) return res.status(400).json({ code: "invalid", message: "Ask me something first." });
    const T = P.threads(u.email), thread = b.threadId ? T.find((t) => t.id === String(b.threadId)) : null;
    if (isSupport(message)) { const t = P.append(u.email, thread?.id, [{ role: "me", text: message }]); return res.json({ route: "help", threadId: t.id }); }
    const eventId = clean(b.eventId, 80), ctx = ctxOf(req, u, eventId);
    // nudge hook (server/pottonudge.js): "nudge the people who haven't replied", "message the maybes", "who did I nudge?".
    // The answer names who would get it; the sheet's card (public/pottonudge.js) shows the message and sends only on Send.
    let nudged = null; try { nudged = b.photo ? null : app.locals.pottoNudge?.pottoAnswer?.(u, message, ctx, { origin: process.env.ENCORE_PUBLIC_URL || `${req.protocol}://${req.get("host")}` }); } catch (e) { console.warn("[potto] nudge:", e?.message); }
    if (nudged && !nudged.reply) { const links = allowedLinks(ctx, nudged.links), actions = nudged.actions || []; const t = P.append(u.email, thread?.id, [{ role: "me", text: message, ...(ctx.attached ? { eventId: ctx.attached } : {}) }, { role: "potto", text: nudged.answer, links, actions: [] }]); return res.json({ threadId: t.id, answer: nudged.answer, links, actions, mode: "rules" }); }
    // trips hook: a trip question gets the trip's own answer and links (server/trips.js tripAnswer), never a made-up booking
    const tr = b.photo ? null : app.locals.trips?.answerFor?.(u, message); if (tr) { const t = P.append(u.email, thread?.id, [{ role: "me", text: message }, { role: "potto", text: tr.answer, links: tr.links, actions: [] }]); return res.json({ threadId: t.id, answer: tr.answer, links: tr.links, actions: [], mode: "rules" }); }
    // co-host hook (server/cohost.js): a sentence that reads as a plan gets "Here's your night"; "find a time" gets the times
    const co = b.photo || nudged || runPottoReply(message, ctx) ? null : app.locals.cohost?.pottoAnswer?.(u, message, ctx); if (co) { const t = P.append(u.email, thread?.id, [{ role: "me", text: message }, { role: "potto", text: co.answer, links: co.links, actions: [] }]); return res.json({ threadId: t.id, answer: co.answer, links: co.links, actions: [], mode: "rules" }); }
    const photo = b.photo && /^image\/(jpeg|png|webp|gif)$/.test(String(b.photo.type || "")) && typeof b.photo.data === "string" && b.photo.data.length < 2_200_000 && /^[A-Za-z0-9+/=]+$/.test(b.photo.data.slice(0, 200)) ? { type: b.photo.type, data: b.photo.data } : null;
    const mode0 = aiMode(), cap = tokensPerDay(), used = P.usage(u.email).tokens, capped = mode0 !== "missing_key" && used >= cap;
    let mode = capped || mode0 === "missing_key" ? "offline" : mode0, note = capped ? "You've used today's AI allowance, so this is the plain version." : "";
    // New York run templates (server/runtemplates.js): the templates for a run host in New York, a run filled in from its words
    let reply = nudged?.reply || runPottoReply(message, ctx); // "remind everyone who's in" goes to the reminder that already exists
    if (!reply && mode !== "offline") {
      const prompt = pottoPrompt(photo && mode === "fake" ? { ...ctx, photo: true } : ctx, message || "What's in this photo?", thread?.turns || []); app.locals.potto.lastPrompt = prompt;
      const content = photo && mode === "live" ? [{ type: "image", source: { type: "base64", media_type: photo.type, data: photo.data } }, { type: "text", text: prompt }] : prompt;
      try { const r = await complete({ prompt: content, effort: "low" }); P.spend(u.email, estimateTokens(prompt, r.text) + (photo ? 1500 : 0)); const j = parseJsonLoose(r.text);
        if (j && typeof j.answer === "string" && j.answer.trim()) reply = { answer: cleanText(j.answer, 1500).replace(/\u2014/g, ", "), links: j.links, action: j.action, route: j.route }; }
      catch (e) { console.warn("[potto] model call failed, using plain rules:", e?.code || e?.message || "error"); note = "I'm a little slow right now, so here's the short version."; mode = "offline"; }
    }
    if (!reply) reply = pottoReply(message, photo ? { ...ctx, photo: true } : ctx, { mode: "offline" });
    if (reply.route === "help") { const t = P.append(u.email, thread?.id, [{ role: "me", text: message }]); return res.json({ route: "help", threadId: t.id }); }
    const links = allowedLinks(ctx, reply.links), action = buildAction(ctx, reply.action) || runCityAction(ctx, reply.action), actions = action ? [action] : [];
    const t = P.append(u.email, thread?.id, [{ role: "me", text: message || "Photo", ...(photo ? { photo: true } : {}), ...(ctx.attached ? { eventId: ctx.attached } : {}) }, { role: "potto", text: reply.answer, links, actions: actions.map(({ body: _b, ...a }) => a) }]);
    res.json({ threadId: t.id, answer: reply.answer, links, actions, mode, ...(note ? { note } : {}), ...(reply.needsAi && mode === "offline" && !note ? { note: status(u).unavailable } : {}) }); });
  // the help guide's answer to a support question, kept in the same thread
  app.post("/api/potto/note", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}; const t = P.threads(u.email).find((x) => x.id === String(b.threadId || "")); if (!t) return res.status(404).json({ code: "not_found", message: "No such chat." });
    const answer = cleanText(b.answer, 1500); if (!answer) return res.status(400).json({ code: "invalid", message: "Nothing to save." });
    const links = (Array.isArray(b.links) ? b.links : []).map((l) => ({ label: clean(l?.label, 60), href: safeLink(l?.href) })).filter((l) => l.label && l.href).slice(0, 4);
    P.append(u.email, t.id, [{ role: "potto", text: answer, links, help: true }]); res.json({ ok: true }); });
  app.get("/api/potto/threads", (req, res) => { const u = me(req, res); if (!u) return; res.json({ threads: P.threads(u.email).map((t) => ({ id: t.id, title: t.title, at: t.at, n: t.turns.length })) }); });
  app.get("/api/potto/threads/:id", (req, res) => { const u = me(req, res); if (!u) return; const t = P.threads(u.email).find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ code: "not_found", message: "No such chat." }); res.json({ thread: t }); });
  app.delete("/api/potto/threads/:id", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, removed: P.remove(u.email, String(req.params.id)) }); });
  app.delete("/api/potto/threads", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, removed: P.remove(u.email, null) }); });
}
