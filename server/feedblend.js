// ---- the blended feed: one stream of different cards, each with one job ----
// The feed used to be four sections of event cards. Now it is one stream that mixes:
//   event      an upcoming event or drop: the host first, who's going on top, a big title, one line, one full-width
//              button to the event's own page (/e/<id>, from eventCta), never the host page
//   follow     "Hosts and people to follow": a sideways row of cards, each with a real reason ("2 friends follow",
//              "You went to their supper", "Hosts in Park Slope", "Went to Dumpling Night with you")
//   recap      a past event's photos: the host (or the friend who shared them), the place, a short note, a stats row
//              ("24 went · 90% would go again · 3rd edition") and the photos in a row
//   milestone  "Crumb Theory hosted their 10th supper", "Priya kept a 5-week run streak", with one-tap Send kudos
//   ideas      the "Ideas to try" deck (public/swipedeck.js)
//   post       a friend's post (signed in)
//   club       a host's post to their fan club (server/fanclub.js postsOf), to members only; its kudos is the club heart
//   row        whatever events are left over, as one quiet sideways row at the end
// Rhythm (arrange): no kind sits next to itself more than twice, the follow row comes early and the ideas deck later.
// Hosts lead every card, and hosts you follow rank first.
//
// Privacy, in one place:
// - Only events on Discover (cardPublic: not private, friends-only, unlisted, cancelled or an example) and past events
//   the viewer was at. Sample (demo) hosts and preview pages that haven't joined never show (previews only when
//   ENCORE_FEED_PREVIEWS lists them, see server/previews.js). Fan club only events show to members alone.
// - People appear by first name only. A going guest is named only when the viewer follows them (a friend, or the
//   owner of a host page they follow) or they turned on "show me" for that reply, never when they hid themselves or
//   the event hides its guests. Everyone else is a count and an unnamed sketch face.
// - Kudos stacks name only the viewer's friends and guests whose kudos are already public on open events.
// - Blocks work both ways in suggestions; dismissed suggestions stay gone for that person or device.
// - Kudos and dismiss need a session and are rate limited by IP and by person.
// - Kudos and comments (server/feedcomments.js) share one gate, cardOf: the card a target names, only when this viewer
//   may see it. Every card kind's target goes through it, so what the feed draws is what the server accepts.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, DEFAULT_WS } from "./workspaces.js";
import { seriesKey, episodeNumber } from "./episodes.js";
import { streakOf } from "./recognition.js";
import { makeCommentStore } from "./feedcomments.js";
import { soldOf } from "./drops.js";
import "../public/pickup.js"; // a drop's pickup words, the same on every page (globalThis.PLPickup)

const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const hashKey = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 20);
const scrub = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
const keyOf = (email) => Buffer.from(lc(email)).toString("base64url");
const hiddenNames = (e) => !!(e?.hideGuests || e?.noWall || e?.discreet || e?.chatham);
const plural = (n, w, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;
export const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// what kind of thing a host makes, in one word, for "their 10th supper" and "You went to their run"
const NOUNS = [[/supper|dinner|dumpling|tasting|cook|feast|potluck|brunch/, "supper", "suppers"], [/\brun\b|running|runs|5k|10k|jog/, "run", "runs"], [/board game|game night|games?\b|chess|mahjong|trivia/, "game night", "game nights"],
  [/film|movie|cinema|screening/, "movie night", "movie nights"], [/wheel|pottery|ceramic|clay/, "wheel night", "wheel nights"], [/hike|trail|walk/, "walk", "walks"], [/book club|reading|book/, "book club", "book clubs"],
  [/coffee|matcha|cafe|café|tea\b/, "coffee morning", "coffee mornings"], [/bake|bread|loaf|pastry/, "bake", "bakes"], [/hack|code|build|demo night|founders/, "build night", "build nights"], [/salsa|dance|bachata/, "dance night", "dance nights"]];
export const nounOf = (e = {}, many = false) => { const t = lc(`${e.pubTitle || e.name || ""} ${e.activity || ""} ${e.format || ""}`); const m = NOUNS.find(([re]) => re.test(t)); return m ? m[many ? 2 : 1] : many ? "events" : "event"; };

// ---------- rhythm ----------
export const MAX_RUN = 2;
/** The longest run of one kind next to itself. */
export const maxRun = (L) => { let best = 0, n = 0, prev = null; for (const it of L) { n = it.kind === prev ? n + 1 : 1; prev = it.kind; best = Math.max(best, n); } return best; };
const PATTERN = ["club", "event", "recap", "event", "milestone", "post", "recap", "event", "post", "milestone"];
/**
 * One stream from pools of cards by kind (each pool already in order). Kinds take turns by PATTERN, a kind never sits
 * next to itself more than MAX_RUN times, and the single cards (the follow row, the ideas deck) go in at their slot.
 * Events that can't be placed without breaking the rhythm end the stream as one sideways row.
 */
export function arrange(pools = {}, { slots = { follow: 1, ideas: 6 }, pattern = PATTERN, rowMin = 1 } = {}) {
  const Q = {}; for (const [k, L] of Object.entries(pools)) Q[k] = (Array.isArray(L) ? L : [L]).filter(Boolean).map((x) => ({ ...x, kind: x.kind || k }));
  const singles = Object.keys(slots).filter((k) => Q[k]?.length), placed = new Set(), out = [];
  const ok = (k) => !(out.length >= MAX_RUN && out.slice(-MAX_RUN).every((x) => x.kind === k));
  const kinds = [...new Set([...pattern, ...Object.keys(Q)])].filter((k) => !slots[k]);
  let pi = 0;
  for (let guard = 0; guard < 500; guard++) {
    for (const s of singles) if (!placed.has(s) && out.length >= slots[s] && ok(s)) { out.push(Q[s][0]); placed.add(s); }
    let picked = false;
    for (let j = 0; j < pattern.length + kinds.length; j++) { const k = j < pattern.length ? pattern[(pi + j) % pattern.length] : kinds[j - pattern.length];
      if (!Q[k]?.length || !ok(k)) continue; out.push(Q[k].shift()); pi = j < pattern.length ? (pi + j + 1) % pattern.length : pi; picked = true; break; }
    if (!picked) break;
  }
  for (const s of singles) if (!placed.has(s)) { out.push(Q[s][0]); placed.add(s); } // a short stream still gets the follow row and the deck
  const left = [...(Q.event || [])]; if (left.length >= rowMin) out.push({ kind: "row", key: "row:more", title: "More coming up", items: left });
  return out;
}

export function makeFeedBlend(store, { C, X, V, app = null }) {
  // ---------- small stores: kudos on a card, suggestions someone dismissed ----------
  const kPath = (t) => "system/feedkudos-" + hashKey("k:" + t), dPath = (who) => "system/feeddismiss-" + hashKey("d:" + who);
  const kudosDoc = (t) => store.get(kPath(t))?.data || null;
  function giveKudos(target, who, email = "") { const d = kudosDoc(target) || { kind: "feedkudos", target, n: 0, by: {} }, w = hashKey(who);
    let mine; if (d.by[w]) { delete d.by[w]; mine = false; } else { d.by[w] = { at: Date.now(), ...(email ? { email: lc(email) } : {}) }; mine = true; }
    const keys = Object.keys(d.by); if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete d.by[k];
    d.n = Object.keys(d.by).length; store.set(kPath(target), d); return { count: d.n, mine }; }
  const dismissed = (who) => new Set(who ? store.get(dPath(who))?.data?.list || [] : []);
  function dismiss(who, target) { const L = [target, ...[...dismissed(who)].filter((x) => x !== target)].slice(0, 300); store.set(dPath(who), { kind: "feeddismiss", list: L }); return L.length; }
  const safety = () => app?.locals?.appstore?.safety || null;
  const CS = makeCommentStore(store, { X, safety }); // comments under a card (server/feedcomments.js)
  const commentsOf = (v, target) => { try { return CS.summary(target, v); } catch { return { count: 0, last: [] }; } };
  /** The words next to the count: the viewer first ("You and 2 more"), then names they may see, then a plain count. */
  const kudosLine = (count, mine, names = []) => { if (!count) return ""; const others = count - (mine ? 1 : 0), people = (n) => `${n} ${n === 1 ? "person" : "people"}`;
    if (mine) return !others ? "You gave kudos" : others === 1 && names.length === 1 ? `You and ${names[0]} gave kudos` : `You and ${others} more gave kudos`;
    return !names.length ? `${people(count)} gave kudos` : count === 1 ? `${names[0]} gave kudos` : count === 2 && names.length >= 2 ? `${names[0]} and ${names[1]} gave kudos` : `${names[0]} and ${count - 1} more gave kudos`; };
  const blocksOf = (em) => { try { return new Set((safety()?.blocksOf(em) || []).map((b) => b.target)); } catch { return new Set(); } };

  // ---------- who is looking ----------
  function viewerOf({ email = "", ws = "", device = "", city = "", I = X.index() } = {}) {
    email = lc(email); const friends = new Set(email ? X.friendsOf(email).map((f) => lc(f.email)) : []);
    const fol = new Map(); for (const w of new Set([...I.events.values()].map((x) => x.ws))) { try { fol.set(w, new Set(C.followersOf(w).map((f) => lc(f.email)))); } catch { fol.set(w, new Set()); } }
    const followed = new Set([...fol].filter(([, S]) => email && S.has(email)).map(([w]) => w));
    // the people whose names the viewer may see on "going": friends and the owners of host pages they follow
    const known = new Set(friends); for (const w of followed) { const o = lc(getWorkspace(w)?.ownerEmail); if (o) known.add(o); } known.delete(email);
    return { email, ws, device, who: email ? "u:" + email : device, city: lc(clean(city, 60)), friends, followed, fol, known, I, blocks: email ? blocksOf(email) : new Set(), gone: dismissed(email ? "u:" + email : device) };
  }
  const hostOK = (I, ws) => { const h = V.hostOf(ws, I); return h && !V.sample(ws, I) ? h : null; };
  const placeOf = (e) => clean(e.hood || e.city || "", 60);
  const descOf = (e, ws) => { for (const k of ["blurb", "pubDesc", "desc", "description", "about", "dinnerTheme", "audienceWho"]) if (typeof e[k] === "string" && clean(e[k]).length > 3) return clean(scrub(e[k]), 140);
    const t = clean(C.profileOf(ws)?.tagline || "", 140); return t || [e.activity, placeOf(e)].filter(Boolean).join(" in "); };
  const rsvpsOf = (ws, id) => { try { return scopeStore(store, ws).listShared("rsvps").filter((d) => d.data?.eventId === id).map((d) => ({ id: d.id, ...(d.data || {}) })); } catch { return []; } }; // listShared: read only, parsed once per change (server/db.js)
  const face = (p, name) => ({ name, emoji: p?.emoji || "", color: p?.color || "", handle: p?.handle || "" });
  // the host on top of every card, with a small Follow when the viewer doesn't follow them yet
  const hostLead = (v, ws, h) => ({ ...h, following: v.followed.has(ws), mine: !!v.ws && v.ws === ws, page: `/@${h.handle}` });

  /** "Maya, Jun and 2 others are going": named only when known to the viewer or opted in, the rest counted. */
  function proofOf(v, x, going) {
    const e = x.e; if (e.hideGuests) return { line: "", faces: [], sketches: [], n: 0 };
    const named = [], seen = new Set();
    if (!hiddenNames(e)) for (const r of rsvpsOf(x.ws, x.id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) { const em = lc(r.email);
      if (r.response !== "going" || r.noShow || r.showMe === false || !em || seen.has(em) || em === v.email) continue;
      if (!v.known.has(em) && !(r.showMe === true && X.userOf(em))) continue; seen.add(em);
      const p = X.person(em), nm = first(r.name) || first(p.name); if (nm) named.push(face(p, nm)); }
    const n = Math.max(+going || 0, named.length), shown = named.slice(0, 2).map((p) => p.name), others = n - shown.length;
    const are = (k) => (k === 1 ? "is" : "are"), oth = `${others} other${others === 1 ? "" : "s"}`;
    if (e.drop) return { line: "", faces: [], sketches: [], n: 0 }; // a drop is ordered, never "going"; its card says what is left instead, and buyers stay private
    const line = !shown.length ? (n >= 2 ? `${n} are going` : n === 1 ? "1 is going" : "")
      : shown.length === 1 ? (others ? `${shown[0]} and ${oth} are going` : `${shown[0]} ${are(1)} going`)
      : others ? `${shown[0]}, ${shown[1]} and ${oth} are going` : `${shown[0]} and ${shown[1]} are going`;
    let sketches = []; try { sketches = (C.goingOf(x.ws, x.id, e).faces || []).slice(0, Math.max(0, 3 - named.length)); } catch {}
    return { line, faces: named.slice(0, 3), sketches: n > named.length ? sketches : [], n };
  }
  // kudos on a card: the count, and the first names the viewer may see (friends; guests whose kudos are public)
  function kudosOf(v, target, publicNames = []) { const d = kudosDoc(target), by = Object.entries(d?.by || {}), me = v.who ? hashKey(v.who) : "";
    const names = [...publicNames]; for (const [w, g] of by) if (w !== me && g.email && v.friends.has(g.email)) { const nm = first(X.person(g.email).name); if (nm && !names.includes(nm)) names.push(nm); }
    const count = by.length + publicNames.length, mine = !!(me && d?.by?.[me]);
    return { target, count, mine, names: names.slice(0, 3), line: kudosLine(count, mine, names) }; }
  // a recap's kudos also count the guests whose kudos are already public on an open event (first names)
  const recapNames = (I, x) => (x && V.cardPublic(x.e) ? [...new Set(V.kudosOf(I, x.id).filter((k) => k.love && k.verified).map((k) => first(k.name)).filter(Boolean))].slice(0, 2) : []);
  const clubKudos = (handle, p) => ({ target: "club." + lc(handle) + "|" + p.id, club: true, count: p.hearts, mine: !!p.hearted, names: [], line: kudosLine(p.hearts, !!p.hearted) });
  // the event's group chat, for people who were in it; nobody else (a small link inside the comment sheet)
  const chatOf = (v, x) => (v.email && V.wasThere(v.I, x.id, v.email) ? `/g#rsvp-${encodeURIComponent(x.id)}` : "");

  const earlyFor = (v, x) => { const fc = app?.locals?.fanclub; try { return !!fc && fc.visibility(x.ws, x.id) === "early" && !(v.email && fc.isMember(x.ws, v.email)); } catch { return false; } };
  // a drop's card: pickup in the shared words, what's left of the batch, its cover or its best item photo, Order
  const dropBits = (x) => { const e = x.e, P = globalThis.PLPickup, items = (e.orderItems || []).map((it) => ({ name: it.name, stock: +it.stock || 0 })); let left = "";
    try { left = P.leftLine(items, soldOf(scopeStore(store, x.ws), x.id, e)); } catch {}
    const photo = /^\/_blob\/[A-Za-z0-9]{20}$/.test(e.coverPhoto || "") ? e.coverPhoto : (e.orderItems || []).map((it) => ((it.photos || [])[0] || it.photo || "")).find((u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u)) || "";
    const P0 = (e.orderItems || []).map((it) => +it.price || 0).filter((n) => n > 0), lo = P0.length ? Math.min(...P0) : 0;
    return { pickup: P.line(e), left, free: false, price: lo ? `${new Set(P0).size > 1 ? "From " : ""}$${lo % 1 ? lo.toFixed(2) : lo}` : "", ...(photo ? { cover: photo } : {}), cta: { label: "Order", url: `/e/${encodeURIComponent(x.id)}` } }; };
  // ---------- events ----------
  function events(v, now = Date.now()) { const I = v.I, t = today(now), once = new Set(), M = memberEvents(v);
    const early = (x) => earlyFor(v, x) && !(v.email && lc(x.owner) === v.email); // a members-first date is still on its own host's feed (it was missing there: review round 19)
    const dayOf = (x) => (x.e.drop ? globalThis.PLPickup.firstDate(x.e, t) : x.e.date || "");
    const L = [...I.events.values()].filter((x) => (V.cardPublic(x.e) || M.has(x.id)) && !early(x) && dayOf(x) >= t && !(x.e.drop && x.e.ordersPaused) && hostOK(I, x.ws) && !v.blocks.has("host:" + lc(V.hostOf(x.ws, I).handle)) && !v.blocks.has("event:" + x.id));
    const local = (x) => (v.city && lc(`${x.e.city || ""} ${x.e.hood || ""}`).includes(v.city) ? 1 : 0);
    const score = (x) => (v.followed.has(x.ws) ? 100 : 0) + (v.known.has(lc(x.owner)) ? 60 : 0) + local(x) * 20 + ((x.e.createdAt || x.e.updatedAt || 0) > now - 4 * DAY ? 6 : 0) - Math.min(30, Math.max(0, (Date.parse(dayOf(x)) - now) / DAY));
    return L.sort((a, b) => score(b) - score(a) || String(dayOf(a)).localeCompare(String(dayOf(b))))
      .filter((x) => { const k = x.ws + "|" + (seriesKey(x.e.pubTitle || x.e.name) || x.id); if (once.has(k)) return false; once.add(k); return true; }).slice(0, 12)
      .map((x) => { const c = V.card(I, x, { email: v.email }), h = hostLead(v, x.ws, c.host);
        return { kind: "event", key: "e:" + x.id, id: x.id, host: h, title: c.title, line: descOf(x.e, x.ws), date: c.date, startTime: c.startTime, where: placeOf(x.e), city: c.city, cover: c.cover, coverArt: c.coverArt, look: { palette: c.look?.palette || [] },
          members: M.has(x.id), free: c.free, price: c.price, drop: !!(x.e.preorder || x.e.drop), ...(x.e.drop ? dropBits(x) : {}), going: c.going || 0, ...(c.spotsLeft != null ? { spotsLeft: c.spotsLeft } : {}), proof: proofOf(v, x, c.going), approvalRequired: c.approvalRequired,
          cta: c.cta?.own ? c.cta : V.eventCta(x.e, x.id) /* the event's own page; the host's own card says Manage */, share: { url: `/e/${encodeURIComponent(x.id)}`, title: c.title }, comment: chatOf(v, x), chat: chatOf(v, x), kudos: kudosOf(v, "e:" + x.id), comments: commentsOf(v, "e:" + x.id), followed: v.followed.has(x.ws) }; }); }

  // ---------- recaps ----------
  function recaps(v, now = Date.now()) { const I = v.I, t = today(now), out = [];
    for (const x of I.events.values()) { const e = x.e; if (!e.date || e.date >= t || Date.parse(e.date) < now - 60 * DAY || e.cancelled || e.example) continue;
      if (!(V.cardPublic(e) || V.wasThere(I, x.id, v.email)) || !hostOK(I, x.ws) || v.blocks.has("host:" + lc(V.hostOf(x.ws, I).handle))) continue;
      const P = V.momentsOf(I, x.id).filter((m) => V.momentSeen(I, m, v.email) && !v.blocks.has("moment:" + m.url)).sort((a, b) => (a.at || 0) - (b.at || 0)); if (P.length < 2) continue;
      const c = V.card(I, x, { email: v.email }), h = hostLead(v, x.ws, c.host);
      // a friend who shared photos from it leads the note (first name only)
      const fr = new Map(); for (const m of P) { const em = lc(m.authorEmail); if (em && v.friends.has(em)) fr.set(em, (fr.get(em) || 0) + 1); }
      const top = [...fr].sort((a, b) => b[1] - a[1])[0], by = top ? { ...face(X.person(top[0]), first(X.person(top[0]).name) || first(P.find((m) => lc(m.authorEmail) === top[0])?.authorName)), key: keyOf(top[0]), photos: top[1] } : null;
      const K = V.kudosOf(I, x.id).filter((k) => k.love || (k.tags || []).length), of = K.length, yes = K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length;
      let ed = null; try { ed = episodeNumber(store, x.id, x.ws); } catch {}
      const stats = [c.came ? `${c.came} went` : "", of >= 3 ? `${Math.round((yes / of) * 100)}% would go again` : "", ed >= 2 ? `${ord(ed)} edition` : ""].filter(Boolean);
      const pub = recapNames(I, x);
      const note = c.quote ? { text: c.quote.text, name: c.quote.name } : P.find((m) => clean(m.caption).length > 3) ? { text: scrub(clean(P.find((m) => clean(m.caption).length > 3).caption, 200)), name: first(P.find((m) => clean(m.caption).length > 3).authorName) } : null;
      const nx = V.nextOf(I, x, t);
      out.push({ kind: "recap", key: "r:" + x.id, id: x.id, host: h, by, title: c.title, date: e.date, where: placeOf(e), note, stats, photos: P.slice(-10).map(V.momentOut), photoCount: P.length,
        next: nx ? { title: nx.title, date: nx.date, url: nx.url } : null, share: { url: `/e/${encodeURIComponent(x.id)}`, title: c.title }, comment: chatOf(v, x), chat: chatOf(v, x), kudos: kudosOf(v, "r:" + x.id, pub), comments: commentsOf(v, "r:" + x.id), followed: v.followed.has(x.ws),
        _s: (v.followed.has(x.ws) ? 50 : 0) + (by ? 40 : 0) + Math.min(10, P.length) - (now - Date.parse(e.date)) / DAY / 3 }); }
    return out.sort((a, b) => b._s - a._s).slice(0, 8).map(({ _s, ...r }) => r); }

  // ---------- milestones ----------
  const STEPS = [3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
  function milestones(v, now = Date.now()) { const I = v.I, t = today(now), out = [], byWs = new Map();
    for (const x of I.events.values()) if (V.cardPublic(x.e) && x.e.date && x.e.date < t) { if (!byWs.has(x.ws)) byWs.set(x.ws, []); byWs.get(x.ws).push(x); }
    for (const [ws, L] of byWs) { const h = hostOK(I, ws); if (!h || v.blocks.has("host:" + lc(h.handle))) continue; L.sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)));
      const n = L.length, last = L[n - 1]; if (!STEPS.includes(n) || Date.parse(last.e.date) < now - 21 * DAY) continue;
      const noun = nounOf(last.e), id = `h-${hashKey(ws + "|" + n)}`, came = V.card(I, last, { email: v.email }).came || 0;
      out.push({ kind: "milestone", key: "m:" + id, id, type: "host", host: hostLead(v, ws, h), text: `${h.name} hosted their ${ord(n)} ${noun}`, sub: [clean(last.e.pubTitle || last.e.name, 80), placeOf(last.e), came ? `${came} came last time` : ""].filter(Boolean).join(" · "),
        n, at: Date.parse(last.e.date), kudos: kudosOf(v, "m:" + id), comments: commentsOf(v, "m:" + id), share: { url: `/@${h.handle}`, title: h.name }, followed: v.followed.has(ws) }); }
    // friends' streaks: three weeks or more in a row at one host's events, the latest in the last eight days
    for (const f of v.friends) { const A = (I.att.get(f) || []).map((a) => I.events.get(a.eventId)).filter((x) => x && V.cardPublic(x.e) && x.e.date && x.e.date < t); if (A.length < 3) continue;
      const p = X.person(f), nm = first(p.name); if (!nm || v.blocks.has("person:" + keyOf(f))) continue;
      const ws = [...A.reduce((m, x) => m.set(x.ws, (m.get(x.ws) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0], at = A.filter((x) => x.ws === ws), h = hostOK(I, ws); if (!h) continue;
      const wk = streakOf(at.map((x) => x.e.date), t, "week"), latest = at.map((x) => x.e.date).sort().at(-1); if (wk < 3 || Date.parse(latest) < now - 8 * DAY) continue;
      const id = `s-${hashKey(f + "|" + ws + "|" + wk)}`, noun = nounOf(at[at.length - 1].e);
      out.push({ kind: "milestone", key: "m:" + id, id, type: "streak", host: hostLead(v, ws, h), person: { ...face(p, nm), key: keyOf(f) }, text: `${nm} kept a ${wk}-week ${noun} streak`, sub: `with ${h.name}`, n: wk, at: Date.parse(latest), kudos: kudosOf(v, "m:" + id), comments: commentsOf(v, "m:" + id), share: { url: `/@${h.handle}`, title: h.name }, followed: v.followed.has(ws) }); }
    return out.sort((a, b) => (b.followed - a.followed) || b.at - a.at).slice(0, 4).map(({ at, ...m }) => m); }

  // ---------- hosts and people to follow ----------
  function follows(v, { limit = 12 } = {}) { const I = v.I, hosts = [], people = [];
    const evByWs = new Map(); for (const x of I.events.values()) if (V.cardPublic(x.e)) { if (!evByWs.has(x.ws)) evByWs.set(x.ws, []); evByWs.get(x.ws).push(x); }
    const mine = new Set((I.att.get(v.email) || []).map((a) => a.eventId));
    for (const [ws, L] of evByWs) { const h = hostOK(I, ws); if (!h || ws === v.ws || v.followed.has(ws)) continue; const hk = "host:" + lc(h.handle); if (v.gone.has(hk) || v.blocks.has(hk)) continue;
      const fans = v.fol.get(ws) || new Set(), nf = [...v.friends].filter((f) => fans.has(f)).length;
      const went = [...I.events.values()].find((x) => x.ws === ws && mine.has(x.id)), hood = L.map((x) => placeOf(x.e)).find(Boolean) || "";
      const local = !!v.city && L.some((x) => lc(`${x.e.city || ""} ${x.e.hood || ""}`).includes(v.city)), up = L.filter((x) => (x.e.date || "") >= today()).length;
      const reason = nf ? `${plural(nf, "friend")} follow${nf === 1 ? "s" : ""}` : went ? `You went to their ${nounOf(went.e)}` : local && hood ? `Hosts in ${hood}` : fans.size >= 3 ? `${fans.size} people follow` : hood ? `${nounOf(L[0].e, true).replace(/^./, (c) => c.toUpperCase())} in ${hood}` : up ? `${plural(up, nounOf(L[0].e))} coming up` : "";
      if (!reason) continue;
      hosts.push({ type: "host", handle: h.handle, name: h.name, emoji: h.emoji, color: h.color, avatarArt: h.avatarArt, avatarUrl: h.avatarUrl, reason, url: `/@${h.handle}`, _s: nf * 3 + (went ? 4 : 0) + (local ? 2 : 0) + (up ? 1 : 0) + Math.min(2, fans.size / 10) }); }
    if (v.email) for (const p of peopleFor(v, { limit })) people.push({ ...p, _s: p.score });
    hosts.sort((a, b) => b._s - a._s); people.sort((a, b) => b._s - a._s);
    // hosts lead: two hosts, then a person, and so on
    const out = []; let hi = 0, pi = 0;
    while (out.length < limit && (hi < hosts.length || pi < people.length)) { for (let k = 0; k < 2 && hi < hosts.length; k++) out.push(hosts[hi++]); if (pi < people.length) out.push(people[pi++]); }
    return out.slice(0, limit).map(({ _s, score, ...c }) => c); }

  /** People the viewer may know: went to the same things (and didn't hide themselves), friends of friends, fans of the same hosts. */
  function peopleFor(v, { limit = 30 } = {}) { const I = v.I, me = v.email; if (!me) return [];
    const mineEv = [...new Set([...(I.att.get(me) || []).map((a) => a.eventId), ...[...I.events.values()].filter((x) => lc(x.owner) === me).map((x) => x.id)])];
    const hidden = new Map(); const hid = (id) => { if (!hidden.has(id)) { const x = I.events.get(id); hidden.set(id, new Set(x ? rsvpsOf(x.ws, id).filter((r) => r.showMe === false).map((r) => lc(r.email)) : [])); } return hidden.get(id); };
    const C0 = new Map(), add = (em, why, s) => { em = lc(em); if (!em || em === me || v.friends.has(em) || !X.userOf(em)) return; const c = C0.get(em) || { score: 0, why: [] }; c.score += s; c.why.push(why); C0.set(em, c); };
    for (const id of mineEv) { const x = I.events.get(id); if (!x || hiddenNames(x.e) || x.e.private) continue; const title = clean(x.e.pubTitle || x.e.name, 60);
      for (const [em, L] of I.att) if (L.some((a) => a.eventId === id) && !hid(id).has(em)) add(em, { k: "event", title }, 3); }
    for (const f of v.friends) for (const ff of X.friendsOf(f)) add(ff.email, { k: "friend", name: first(X.person(f).name) }, 1);
    const myHosts = [...v.followed]; if (myHosts.length) { const cnt = new Map(); for (const w of myHosts) for (const em of v.fol.get(w) || []) cnt.set(em, (cnt.get(em) || 0) + 1); for (const [em, n] of cnt) if (n >= 2) add(em, { k: "hosts", n }, n * 0.5); }
    const out = []; for (const [em, c] of C0) { const key = keyOf(em), pk = "person:" + key; if (v.gone.has(pk) || v.blocks.has(pk)) continue;
      if (blocksOf(em).has("person:" + keyOf(me))) continue; // they blocked the viewer: never suggested either way
      const p = X.person(em), nm = first(p.name); if (!nm) continue; const ev = c.why.filter((w) => w.k === "event"), fr = c.why.find((w) => w.k === "friend"), ho = c.why.find((w) => w.k === "hosts");
      const reason = ev.length > 1 ? `${ev.length} events together` : ev.length ? `Went to ${ev[0].title} with you` : ho ? `Follows ${ho.n} hosts you follow` : fr ? `Friends with ${fr.name}` : "";
      const prof = p.handle ? C.profileOf(p.ws) : null, place = prof && prof.handle ? clean([prof.hood, prof.city].filter(Boolean).join(", "), 60) : "";
      if (reason) out.push({ type: "person", key, name: nm, emoji: p.emoji, color: p.color, handle: p.handle || "", place, reason, url: p.handle ? `/@${p.handle}` : "", score: c.score }); }
    return out.sort((a, b) => b.score - a.score).slice(0, limit); }

  // ---------- fan club posts (server/fanclub.js): members see their clubs' recent posts, the host first ----------
  function clubPosts(v, now = Date.now()) { const fc = app?.locals?.fanclub; if (!v.email || !fc) return []; const out = [];
    try { for (const c of fc.clubMemberships(v.email)) { const ws = C.wsOfHandle(c.handle); if (!ws) continue; const h = hostOK(v.I, ws); if (!h || v.blocks.has("host:" + lc(h.handle))) continue;
      for (const p of fc.postsOf(ws, { viewer: v.email }).filter((p) => p.at >= now - 21 * DAY).slice(0, 3))
        out.push({ kind: "club", key: "c:" + ws + ":" + p.id, id: p.id, host: hostLead(v, ws, h), club: { name: c.club, handle: h.handle }, text: p.text, photo: p.photo, at: p.at, report: p.report,
          kudos: clubKudos(h.handle, p), comments: commentsOf(v, "club." + lc(h.handle) + "|" + p.id) }); } } catch {}
    return out.sort((a, b) => b.at - a.at).slice(0, 4); }
  /** Members-only events from the clubs the viewer is in (they're off Discover, so cardPublic leaves them out). */
  function memberEvents(v) { const fc = app?.locals?.fanclub; if (!v.email || !fc) return new Set(); const S = new Set();
    try { for (const x of v.I.events.values()) if (fc.visibility(x.ws, x.id) === "members" && fc.isMember(x.ws, v.email) && !x.e.cancelled && !x.e.private && !x.e.example) S.add(x.id); } catch {} return S; }

  // ---------- the stream ----------
  /** The blended feed for one viewer (email "" when signed out). posts: a signed-in viewer's friends' posts. */
  function blend({ email = "", ws = "", device = "", city = "", posts = [], now = Date.now() } = {}) {
    const I = X.index(), v = viewerOf({ email, ws, device, city, I });
    const F = follows(v), ideas = app?.locals?.hooks?.IDEAS || [];
    const pools = { club: clubPosts(v, now), event: events(v, now), recap: recaps(v, now), milestone: milestones(v, now), post: (posts || []).map((p) => ({ ...p, kind: "post", key: "p:" + p.id })),
      follow: F.length >= 2 ? [{ kind: "follow", key: "follow", title: email ? "Hosts and people to follow" : "Hosts to follow", cards: F }] : [],
      ideas: ideas.length ? [{ kind: "ideas", key: "ideas", count: ideas.length, titles: ideas.slice(0, 3).map((x) => clean(x.title, 60)) }] : [] };
    const items = arrange(pools);
    return { items, cold: !email || (!v.followed.size && !v.friends.size), following: v.followed.size, city: v.city ? clean(city, 60) : "" };
  }
  /** What one device or person did to a shared (cached) stream: their kudos, and the suggestions they dismissed. */
  function decorate(B, { who = "" } = {}) { if (!B || !who) return B; const gone = dismissed(who), w = hashKey(who);
    return { ...B, items: B.items.map((it) => { let x = it; if (it.kudos) { const mine = !!kudosDoc(it.kudos.target)?.by?.[w]; x = { ...x, kudos: { ...it.kudos, mine, line: kudosLine(it.kudos.count, mine, it.kudos.names) } }; }
      if (it.kind === "follow") x = { ...x, cards: it.cards.filter((c) => !gone.has(c.type === "host" ? "host:" + lc(c.handle) : "person:" + c.key)) }; return x; }).filter((it) => it.kind !== "follow" || it.cards.length >= 2) }; }
  /**
   * The card a target names, when this viewer may see it (else null): { target, kind, ws, owner, title, eventId, chat }.
   * One gate for kudos and comments, with the same rules the stream uses: upcoming open events and interest checks,
   * members-only events for members (and their host), past events the viewer may see, current milestones, and fan
   * club posts for members (and their host). Private, unlisted, friends-only and cancelled events have no card.
   */
  function cardOf(target, v, memo = {}) { const tg = String(target || ""), I = v.I, t = today(), fc = app?.locals?.fanclub;
    const cm = /^club\.([a-z0-9][a-z0-9-]{1,29})\|([A-Za-z0-9_-]{1,40})$/.exec(tg);
    if (cm) { try { const ws = C.wsOfHandle(cm[1]); if (!fc || !ws || !v.email || !hostOK(I, ws) || v.blocks.has("host:" + cm[1])) return null; const owner = lc(getWorkspace(ws)?.ownerEmail), member = fc.isMember(ws, v.email);
        if (!member && owner !== v.email && v.ws !== ws) return null; const p = fc.postsOf(ws, { viewer: v.email }).find((p) => p.id === cm[2]); if (!p) return null;
        return { target: tg, kind: "club", ws, owner, title: clean(p.text, 60) || "your club post", handle: cm[1], post: p, member }; } catch { return null; } }
    const m = /^([erm]):([A-Za-z0-9_-]{1,80})$/.exec(tg); if (!m) return null;
    if (m[1] === "m") { const ms = (memo.ms || (memo.ms = milestones(v))).find((x) => x.id === m[2]); if (!ms) return null; const ws = C.wsOfHandle(ms.host.handle); return { target: tg, kind: "milestone", ws, owner: lc(getWorkspace(ws)?.ownerEmail), title: ms.text }; }
    const x = I.events.get(m[2]), h = x && hostOK(I, x.ws); if (!h || v.blocks.has("host:" + lc(h.handle)) || v.blocks.has("event:" + x.id)) return null;
    const e = x.e, mine = !!v.email && lc(x.owner) === v.email, card = { target: tg, ws: x.ws, owner: lc(x.owner), title: clean(e.pubTitle || e.name, 80) || "an event", eventId: x.id, chat: chatOf(v, x) };
    if (m[1] === "e") { if ((e.date || "") < t) return null; const M = memo.M || (memo.M = memberEvents(v));
      let hostOfMembers = false; try { hostOfMembers = mine && !!fc && fc.visibility(x.ws, x.id) === "members" && !e.cancelled && !e.private && !e.example; } catch {}
      return (V.cardPublic(e) && (mine || !earlyFor(v, x))) || M.has(x.id) || hostOfMembers ? { ...card, kind: "event" } : null; }
    return e.date && e.date < t && !e.example && (V.cardPublic(e) || (!e.cancelled && V.wasThere(I, x.id, v.email))) ? { ...card, kind: "recap" } : null; }
  /** The kudos on a card as this viewer sees them now: the count, whether theirs is in, and the line of names. */
  function kudosFor(v, card) { if (card.kind === "club") { let p = card.post; try { p = app.locals.fanclub.postsOf(card.ws, { viewer: v.email }).find((q) => q.id === card.post.id) || p; } catch {} return clubKudos(card.handle, p); }
    return kudosOf(v, card.target, card.kind === "recap" ? recapNames(v.I, v.I.events.get(card.eventId)) : []); }
  /** May this viewer give kudos to this card? (kept for callers that only need yes or no) */
  function kudosTarget(target, { email = "", ws = "" } = {}) { return !!cardOf(target, viewerOf({ email, ws })); }
  /** What the "+" sheet offers this person (public/composer.js): the tiles that fit what they can do. */
  function composeOptions({ email = "", ws = "", now = Date.now() } = {}) { email = lc(email); if (!email) return { signedIn: false, tiles: [] };
    const I = X.index(), t = today(now), p = X.person(email), prof = ws && ws !== DEFAULT_WS ? C.profileOf(ws) : null, host = !!prof?.handle && [...I.events.values()].some((x) => x.ws === ws && !x.e.example); // a host: has a page and has made something
    let club = null; try { const c = host && app?.locals?.fanclub?.config(ws); if (c?.on) club = { name: c.name || "" }; } catch {}
    const ids = new Set([...(I.att.get(email) || []).map((a) => a.eventId), ...[...I.events.values()].filter((x) => x.ws === ws).map((x) => x.id)]), past = [];
    for (const id of ids) { const x = I.events.get(id); if (!x || !x.e.date || x.e.date >= t || x.e.cancelled || x.e.example || Date.parse(x.e.date) < now - 60 * DAY) continue; past.push({ id, title: clean(x.e.pubTitle || x.e.name || "Your event", 80), date: x.e.date }); }
    past.sort((a, b) => b.date.localeCompare(a.date));
    const tiles = ["event", ...(prof?.handle ? ["drop"] : []) /* anyone with a page can open a drop, even before their first event */, ...(past.length ? ["photos"] : []), ...(club ? ["club"] : [])];
    return { signedIn: true, name: first(p.name) || first(prof?.name) || "", face: { name: first(p.name), emoji: p.emoji || "", color: p.color || "", handle: p.handle || "" }, host, club, past: past.slice(0, 6), tiles }; }
  return { composeOptions, blend, decorate, arrange, follows, peopleFor, viewerOf, milestones, recaps, events, giveKudos, kudosDoc, dismiss, dismissed, kudosTarget, cardOf, kudosFor, kudosLine, comments: CS };
}

export function mountFeedBlend(app, { store, small, currentUser, C, X, V }) {
  const B = makeFeedBlend(store, { C, X, V, app });
  app.locals.feedBlend = B;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; } catch { return null; } };
  // rate limits: per IP an hour, per person or device an hour, and signed out one IP gets a few taps per card a day
  const hits = new Map(); const over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const perIp = () => Math.max(1, +process.env.ENCORE_FEED_KUDOS_PER_IP_HOUR || 120), perWho = () => Math.max(1, +process.env.ENCORE_FEED_KUDOS_PER_HOUR || 60);
  const whoOf = (req, res) => { const u = viewer(req); if (!u) { bad(res, "Sign in to give kudos.", 401, "unauthenticated"); return null; } return { u, who: "u:" + lc(u.email) }; };
  // one tap of appreciation (toggled): on an event or interest check, a recap, a milestone or a fan club post.
  // The answer is the card's kudos as the feed would draw them now: count, mine, names and the line.
  app.post("/api/feed/kudos", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|k|" + (req.ip || "?"), perIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const W = whoOf(req, res); if (!W) return; if (over("who|k|" + W.who, perWho())) return bad(res, "That's a lot of kudos for one hour.", 429, "rate_limited");
    const target = String(req.body?.target || "").slice(0, 120), v = B.viewerOf({ email: W.u.email, ws: W.u.ws }), card = B.cardOf(target, v); if (!card) return bad(res, "No such post.", 404, "not_found");
    // a fan club post keeps its own heart (server/fanclub.js); everything else is a tap on the card's kudos doc
    if (card.kind === "club") { if (!card.member) return bad(res, "That post is for members.", 403, "not_member"); if (!app.locals.fanclub.heart(card.ws, card.post.id, W.u.email, !card.post.hearted)) return bad(res, "No such post.", 404, "not_found"); }
    else B.giveKudos(target, W.who, W.u.email);
    res.json({ ok: true, ...B.kudosFor(v, card) }); });
  // the "+" sheet (public/composer.js): which tiles to show
  app.get("/api/me/compose", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = viewer(req); if (!u) return res.json({ signedIn: false, tiles: [] }); res.json(B.composeOptions({ email: u.email, ws: u.ws })); });
  // "not for me" on a follow suggestion: gone for this person or device
  app.post("/api/feed/dismiss", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|d|" + (req.ip || "?"), perIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const W = whoOf(req, res); if (!W) return; if (over("who|d|" + W.who, perWho())) return bad(res, "Slow down.", 429, "rate_limited");
    const t = String(req.body?.target || ""); if (!/^(host:[a-z0-9][a-z0-9-]{1,29}|person:[A-Za-z0-9_-]{4,200})$/.test(t)) return bad(res, "Pick a suggestion.");
    res.json({ ok: true, count: B.dismiss(W.who, t) }); });
  return B;
}
// ---- end blended feed ----
