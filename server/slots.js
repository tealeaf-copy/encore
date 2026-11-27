// Slots on the invite and quiet-guest mode (review round 13, for engineers, gamers and the people who run their nights).
//
// One block per event, set up by the host as `lineup` on the event:
// - demos: a lightning demo queue, `slots` slots of `minutes` minutes. A guest who is in claims one with a title (one each);
//   the host reorders or removes them.
// - poll: a game-pick poll over `options`, one vote per reply (I'm in or Maybe), changeable.
// - bracket: a small bracket (4, 8 or 16). Guests who are in opt in; the host seeds it from them (in the order they opted
//   in, top seeds get the byes) and enters each winner.
// Guests act with their reply proof (rid + code), like every other guest endpoint, rate-limited per address. On a private
// or friends-only event only guests who are in see the block; names are first names only, and none at all on a hidden,
// discreet or Chatham event (or to someone who isn't in on a private one). Records: `lineup/<eventId>`.
//
// Quiet guests: "Coming solo" on a reply (`solo`), "3 others are coming solo" on the invite (a count, never names), an
// "Ask me about" line (60 characters, emails, phone numbers and links taken out) on Who's coming for guests who are in,
// and the host's first-timer table note (`firstTimerNote`) for guests coming solo.
import { scopeStore, workspaceOfEvent } from "./workspaces.js";
import { latestReplies } from "./tables.js";

const ID = /^[A-Za-z0-9_-]{2,80}$/;
const clean = (v, n = 200) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1) : ""; };
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
const hiddenNames = (ev) => !!(ev?.hideGuests || ev?.noWall || ev?.discreet || ev?.chatham);
export const KINDS = ["demos", "poll", "bracket"];

/** The host's block, cleaned. Pure. */
export function lineupOf(ev) {
  const L = ev?.lineup && typeof ev.lineup === "object" ? ev.lineup : null; if (!L || !KINDS.includes(L.kind) || L.on === false) return null;
  const title = clean(L.title, 60);
  if (L.kind === "demos") return { kind: "demos", title: title || "Lightning demos", slots: Math.max(1, Math.min(30, Math.round(+L.slots) || 6)), minutes: Math.max(1, Math.min(60, Math.round(+L.minutes) || 5)) };
  if (L.kind === "poll") { const options = (Array.isArray(L.options) ? L.options : String(L.options || "").split(/\n|,/)).map((o) => clean(o, 40)).filter((o, i, a) => o && a.indexOf(o) === i).slice(0, 8); return options.length >= 2 ? { kind: "poll", title: title || "What should we play?", options } : null; }
  return { kind: "bracket", title: title || "Bracket", size: [4, 8, 16].includes(+L.size) ? +L.size : 8 };
}
// review round 14: a clause (between commas) that carries a way to reach someone goes whole, not just the handle, so
// "Zig, email me at zed@x.io, retro consoles" keeps "Zig, retro consoles"
const CONTACT = [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /\b(?:https?:\/\/|www\.)\S+/i, /\b[a-z0-9-]+\.(?:com|io|dev|net|org|me|app|gg|xyz|co|ly|link|so|sh)\b/i,
  /(?:\+?\d[\s().-]*){7,}\d/, /@[A-Za-z0-9_.]{2,}/, /\S#\d{4}\b/, // email, link, domain, phone, @handle, a Discord tag (name#1234)
  /\bd[i1!|]sc[o0]rd\b\s*[:=@-]?\s*(?!(?:bots?|servers?|communit(?:y|ies)|mods?|nitro|api|stuff|dev)\b)[A-Za-z0-9_.]{2,32}/i, // discord ann_42, disc0rd: ann
  /\b\S+\s*[([]?\s*at\s*[)\]]?\s*\S+\s*[([]?\s*dot\s*[)\]]?\s*[a-z]{2,}\b/i, // ann at gmail dot com
  /\b(?:e-?mail|text|call|dm|ping|message|msg|find|reach|add|hit)\s+me\b/i, /\b(?:telegram|whatsapp|signal|snapchat|insta(?:gram)?|wechat|line id|kik)\b/i];
/** "Ask me about": short, and no way to reach anyone in it. Pure. */
export const scrubAsk = (v) => clean(v, 200).split(/\s*[,;|]\s*|\s+\/\s+/).map((c) => c.trim()).filter((c) => c && !CONTACT.some((re) => re.test(c)))
  .join(", ").replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "").trim().slice(0, 60).replace(/[\s,;:-]+$/, "");

/** A fair shuffle (Fisher-Yates) for "Shuffle seeds". */
export function shuffled(L, rnd = Math.random) { const a = L.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** Seed positions for a bracket of `size`: top seeds meet the lowest (and get the byes). Pure. */
export function seedOrder(size) { let o = [1, 2]; while (o.length < size) { const n = o.length * 2 + 1; o = o.flatMap((x) => [x, n - x]); } return o; }
/** The rounds of a bracket from its entrants (null is a bye) and the winners entered so far. Pure. */
// A slot holds a player, null (a bye: nobody will ever be there) or undefined (waiting on the match before it). Only a
// real bye moves a player on by itself; someone facing a match that hasn't been played waits for it (review 17: an
// unplayed first round used to send the top seed straight to the final).
export function bracketRounds(entrants, winners = {}) {
  const R = []; let cur = entrants.map((x) => x ?? null);
  for (let r = 0; cur.length > 1; r++) { const round = [], next = [];
    for (let m = 0; m < cur.length / 2; m++) { const a = cur[2 * m], b = cur[2 * m + 1], w0 = winners[`${r}-${m}`], known = a !== undefined && b !== undefined;
      const w = !known ? null : a && !b ? a : b && !a ? b : w0 && (w0 === a || w0 === b) ? w0 : null;
      round.push({ a: a ?? null, b: b ?? null, w, bye: known && (!!(a && !b) || !!(b && !a)) });
      next.push(w || (known && !a && !b ? null : undefined)); }
    R.push(round); cur = next; }
  return R;
}

export function mountSlots(app, { store, small, X, ownerOnly }) {
  const hits = new Map(), limited = (req, n = 240) => { const k = (req.ip || "?") + req.method + req.path.split("/").slice(0, 5).join("/"), now = Date.now(); if (hits.size > 20000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const evOf = (id) => { if (!ID.test(id || "")) return null; const ws = workspaceOfEvent(id); if (!ws) return null; const S = scopeStore(store, ws), ev = S.get("events/" + id)?.data; return ev && !ev.example ? { ws, S, ev, id } : null; };
  const proof = (id, rid, code) => { const P = X.rsvpProof(String(id || ""), clean(rid, 80), clean(code, 40)); return P && P.ev ? P : null; };
  const rec = (S, id) => ({ demos: [], votes: {}, optin: [], entrants: [], winners: {}, ...(S.get("lineup/" + id)?.data || {}) });
  const nameOf = (S, rid) => clean(S.get("rsvps/" + rid)?.data?.name, 60);
  const goingNow = (S, id) => new Set(latestReplies(S, id).filter((x) => x.id && x.r.response === "going" && x.r.noShow !== true).map((x) => x.id));

  function view(E, P, host = false) {
    const { S, ev, id } = E, B = lineupOf(ev); if (!B) return null;
    const going = !!P && P.r.response === "going";
    if (closed(ev) && !going && !host) return { kind: B.kind, title: B.title, locked: true };
    const namesOk = host || (!hiddenNames(ev) && (!closed(ev) || going)), L = rec(S, id), who = (rid) => (host ? nameOf(S, rid) : namesOk ? first(nameOf(S, rid)) : "");
    const out = { kind: B.kind, title: B.title, canAct: going, past: !!ev.date && ev.date < new Date().toISOString().slice(0, 10) };
    if (B.kind === "demos") { const live = goingNow(S, id), D = (L.demos || []).filter((d) => host || live.has(d.rid)).slice(0, B.slots);
      Object.assign(out, { slots: B.slots, minutes: B.minutes, open: Math.max(0, B.slots - D.length), queue: D.map((d, i) => ({ n: i + 1, title: clean(d.title, 80), who: who(d.rid), mine: !!P && d.rid === P.rid, ...(host ? { rid: d.rid } : {}) })), mine: P ? clean((L.demos || []).find((d) => d.rid === P.rid)?.title, 80) : "" });
      out.canAct = going && (!!out.mine || out.open > 0); }
    else if (B.kind === "poll") { const V = L.votes || {}; out.options = B.options.map((o, i) => ({ i, label: o, votes: Object.values(V).filter((v) => v === i).length })); out.votes = Object.keys(V).length; out.myVote = P && Number.isInteger(V[P.rid]) ? V[P.rid] : null; out.canAct = !!P && ["going", "maybe"].includes(P.r.response); }
    else { const live = goingNow(S, id), opt = (L.optin || []).filter((r) => live.has(r)), E2 = L.entrants || [];
      out.size = B.size; out.optedIn = opt.length; out.mine = !!P && opt.includes(P.rid); out.seeded = E2.some(Boolean);
      if (out.seeded) { const R = bracketRounds(E2, L.winners || {}), nm = (rid, i) => (rid ? who(rid) || `Player ${E2.indexOf(rid) + 1}` : "");
        out.rounds = R.map((round, r) => round.map((x, m) => ({ r, m, a: nm(x.a), b: nm(x.b), w: x.w ? (x.w === x.a ? "a" : "b") : "", bye: x.bye, ...(host ? { ra: x.a, rb: x.b } : {}) })));
        const fin = R[R.length - 1]?.[0]; out.champion = fin?.w ? nm(fin.w) : ""; }
      if (host) out.entrantsReady = opt.map((rid) => ({ rid, name: nameOf(S, rid) })); }
    return out;
  }
  app.get("/api/public/lineup/:id", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const E = evOf(clean(req.params.id, 80)); if (!E) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, no-store"); const P = req.query.rid ? proof(E.id, req.query.rid, req.query.code) : null; res.json({ lineup: view(E, P) }); });

  // ---------- guests: claim a demo slot, vote, opt in to the bracket ----------
  const guestWrite = (fn) => (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, id = clean(req.params.id, 80), P = proof(id, b.rid, b.code);
    if (!P) return bad(res, "Reply first, then you can add yourself here.", 403, "not_granted"); const B = lineupOf(P.ev); if (!B) return bad(res, "This one doesn't have that.", 404, "not_found");
    if (P.ev.date && P.ev.date < new Date().toISOString().slice(0, 10)) return bad(res, "This one has already happened.", 409, "past");
    // review round 14: the same lock as the view: on a private or friends-only event only guests who are in take part
    if (closed(P.ev) && P.r.response !== "going") return bad(res, "This is for guests who are in.", 409, "locked");
    const L = rec(P.S, id), err = fn(B, L, P, b); if (err) return bad(res, err, 409, "not_allowed");
    P.S.set("lineup/" + id, { ...L, eventId: id, at: Date.now() }); res.json({ ok: true, lineup: view({ ...P, id }, P) }); };
  app.post("/api/public/lineup/:id/claim", small, guestWrite((B, L, P, b) => {
    if (B.kind !== "demos") return "There's no demo queue on this one."; if (P.r.response !== "going") return "Reply I'm in first.";
    const title = clean(b.title, 80); L.demos = (L.demos || []).filter((d) => d.rid !== P.rid || title);
    if (!title) { L.demos = L.demos.filter((d) => d.rid !== P.rid); return ""; }
    const mine = L.demos.find((d) => d.rid === P.rid); if (mine) { mine.title = title; return ""; }
    const live = goingNow(P.S, P.r.eventId); if (L.demos.filter((d) => live.has(d.rid)).length >= B.slots) return "All the slots are taken.";
    L.demos.push({ rid: P.rid, title, at: Date.now() }); return ""; }));
  app.post("/api/public/lineup/:id/vote", small, guestWrite((B, L, P, b) => {
    if (B.kind !== "poll") return "There's no poll on this one."; if (!["going", "maybe"].includes(P.r.response)) return P.r.response === "requested" ? "Vote once the host lets you in." : "Reply first.";
    const i = b.option == null || b.option === "" ? null : Math.floor(+b.option); L.votes = { ...(L.votes || {}) };
    if (i == null) { delete L.votes[P.rid]; return ""; } if (!(i >= 0 && i < B.options.length)) return "Pick one of the options."; L.votes[P.rid] = i; return ""; }));
  app.post("/api/public/lineup/:id/optin", small, guestWrite((B, L, P, b) => {
    if (B.kind !== "bracket") return "There's no bracket on this one."; if (P.r.response !== "going") return "Reply I'm in first.";
    L.optin = (L.optin || []).filter((r) => r !== P.rid); if (b.on !== false) L.optin.push(P.rid); return ""; }));

  // ---------- the host ----------
  app.get("/api/host/lineup/:id", (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.params.id, 80), S = scopeStore(store, u.ws), ev = ID.test(id) ? S.get("events/" + id)?.data : null; if (!ev) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, no-store").json({ config: lineupOf(ev), lineup: view({ S, ev, id, ws: u.ws }, null, true), firstTimerNote: clean(ev.firstTimerNote, 200), solo: soloCount(S, id) }); });
  app.post("/api/host/lineup/:id", small, (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.params.id, 80), S = scopeStore(store, u.ws), ev = ID.test(id) ? S.get("events/" + id)?.data : null; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const b = req.body || {}, L = rec(S, id);
    if (b.action === "config") { const cfg = b.lineup == null ? null : lineupOf({ lineup: { ...b.lineup, kind: String(b.lineup.kind || "") } }); const note = b.firstTimerNote != null ? clean(b.firstTimerNote, 200) : ev.firstTimerNote;
      S.update("events/" + id, { lineup: cfg, ...(note != null ? { firstTimerNote: note || "" } : {}) }); }
    else if (b.action === "reorder") { const want = (Array.isArray(b.order) ? b.order : []).map((r) => clean(r, 80)), D = L.demos || []; L.demos = [...want.map((r) => D.find((d) => d.rid === r)).filter(Boolean), ...D.filter((d) => !want.includes(d.rid))]; }
    else if (b.action === "remove") { const r = clean(b.rid, 80); L.demos = (L.demos || []).filter((d) => d.rid !== r); }
    else if (b.action === "seed") { const B = lineupOf(ev); if (B?.kind !== "bracket") return bad(res, "There's no bracket on this one."); const live = goingNow(S, id), how = ["shuffle", "here"].includes(b.order) ? b.order : "optin";
      // seeding helpers: in the order people opted in (the default), only who's checked in tonight, or shuffled
      const here = how === "here" ? new Set(latestReplies(S, id).filter((x) => x.r.checkedInAt).map((x) => x.id)) : null;
      let opt = (L.optin || []).filter((r) => live.has(r) && (!here || here.has(r)));
      if (how === "shuffle") opt = shuffled(opt);
      opt = opt.slice(0, B.size);
      if (opt.length < 2) return bad(res, how === "here" ? "Check in two players who opted in first." : "Two guests need to opt in first."); let P = 2; while (P < opt.length) P *= 2; const order = seedOrder(P); L.entrants = order.map((s) => opt[s - 1] || null); L.winners = {}; L.champion = null; }
    else if (b.action === "winner") { const R = bracketRounds(L.entrants || [], L.winners || {}), r = Math.floor(+b.round), m = Math.floor(+b.match), x = R[r]?.[m], w = clean(b.rid, 80);
      if (!x || !x.a || !x.b || (w && w !== x.a && w !== x.b)) return bad(res, "That match isn't ready."); L.winners = { ...(L.winners || {}) }; if (w) L.winners[`${r}-${m}`] = w; else delete L.winners[`${r}-${m}`];
      // a changed winner clears what came after it
      for (const k of Object.keys(L.winners)) { const [rr] = k.split("-").map(Number); if (rr > r) { const R2 = bracketRounds(L.entrants, L.winners); const y = R2[rr]?.[+k.split("-")[1]]; if (!y || (L.winners[k] !== y.a && L.winners[k] !== y.b)) delete L.winners[k]; } }
      const R3 = bracketRounds(L.entrants, L.winners); L.champion = R3[R3.length - 1]?.[0]?.w || null; }
    else if (b.action === "reset") { L.demos = []; L.votes = {}; L.optin = []; L.entrants = []; L.winners = {}; L.champion = null; }
    else return bad(res, "Unknown action.");
    if (b.action !== "config") S.set("lineup/" + id, { ...L, eventId: id, at: Date.now() });
    const ev2 = S.get("events/" + id)?.data; res.json({ ok: true, config: lineupOf(ev2), lineup: view({ S, ev: ev2, id, ws: u.ws }, null, true), firstTimerNote: clean(ev2.firstTimerNote, 200) }); });

  // ---------- quiet guests ----------
  function soloCount(S, id, skip = "") { return latestReplies(S, id).filter((x) => x.id !== skip && x.r.response === "going" && x.r.noShow !== true && x.r.solo === true).length; }
  app.get("/api/public/quiet/:id", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const E = evOf(clean(req.params.id, 80)); if (!E) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, no-store"); const P = req.query.rid ? proof(E.id, req.query.rid, req.query.code) : null, going = !!P && P.r.response === "going";
    if (closed(E.ev) && !going) return res.json({ solo: null, me: P ? { solo: !!P.r.solo, askMe: clean(P.r.askMe, 60) } : null });
    const others = soloCount(E.S, E.id, P?.rid || ""), out = { solo: hiddenNames(E.ev) && !going ? null : others, me: null, firstTimer: "", askMe: [] };
    if (P) { out.me = { solo: !!P.r.solo, askMe: clean(P.r.askMe, 60) }; if (P.r.solo) out.firstTimer = clean(E.ev.firstTimerNote, 200); }
    if (going && !hiddenNames(E.ev)) out.askMe = latestReplies(E.S, E.id).filter((x) => x.r.response === "going" && x.r.showMe !== false && x.r.noShow !== true && clean(x.r.askMe, 60)).slice(0, 40).map((x) => ({ name: first(x.r.name), askMe: clean(x.r.askMe, 60), solo: !!x.r.solo, me: x.id === P.rid }));
    res.json(out); });
  app.post("/api/public/quiet/:id", small, (req, res) => { if (limited(req, 30)) return bad(res, "Slow down.", 429, "rate_limited"); const b = req.body || {}, id = clean(req.params.id, 80), P = proof(id, b.rid, b.code);
    if (!P) return bad(res, "Reply first.", 403, "not_granted"); const up = {};
    if (b.solo != null) up.solo = b.solo === true; if (b.askMe != null) up.askMe = scrubAsk(b.askMe);
    if (Object.keys(up).length) P.S.update("rsvps/" + P.rid, up); const r = P.S.get("rsvps/" + P.rid).data;
    res.json({ ok: true, solo: !!r.solo, askMe: clean(r.askMe, 60), firstTimer: r.solo ? clean(P.ev.firstTimerNote, 200) : "" }); });
}
