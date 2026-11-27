// ---- Lists people follow: visibility, curators, follows and "I'd go again" (docs/lists-pm-spec.md) ----
// The library (server/library.js) keeps the lists. This adds what makes them public:
// - Visibility per list: Private (only the owner), Friends (people the owner added as friends), Link (anyone with
//   the link, unlisted) and Public (the curator page /@<handle>/lists, Discover's "Lists people love", followers' and
//   friends' feeds, a host's "On N public lists"). canSee() is the one gate every surface here goes through.
// - Following a curator or one list (in place, with Undo), saving a list to your library, and stepping out of one
//   person's friends lists (they aren't told).
// - "I'd go again" on an event or a host, only after you went (a past event you said I'm in to and didn't miss),
//   and the curator's one line on why something is on a list (stored on the list, server/library.js setNote).
// - The curator's strip (followers, saves of their lists, people who went to something from them) and the nudge
//   ("12 friends opened Quiet dinners. Make it public?").
// Privacy: a list shown to anyone but its owner shows public items only (library publicItems: never a private,
// unlisted, friends-only or members-only event, not even counted); blocks hide lists both ways; a host only ever
// learns about Public lists; people show by first name only and no answer carries an email.
// Docs (all carry the owner's email, so account deletion removes or scrubs them, server/account.js):
//   system/plcur-<hash>       one person's follows, saved lists, step-outs and dismissed nudges
//   system/plcurfans-<hash>   who follows a curator
//   system/pllistfans-<hash>  who follows or saved one list (by owner and list id, so a new link keeps them)
//   system/plopen-<hash>      who opened a shared list (hashed), for the nudge and "went from your list"
//   system/plvouch-<hash>     who would go again, for one event or host
import crypto from "node:crypto";
import { getWorkspace, scopeStore, DEFAULT_WS } from "./workspaces.js";
import { keyOf } from "./safety.js";
import { makeListFeed } from "./listfeed.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/, TOKEN_OK = /^[A-Za-z0-9_-]{24}$/, ID_OK = /^[A-Za-z0-9_-]{1,120}$/;
export const VOUCH_KINDS = ["event", "host"];
export const NUDGE_MIN = () => Math.max(1, +process.env.ENCORE_LISTS_NUDGE_MIN || 5);
const MAX = { fans: 20000, opens: 5000, follows: 1000, vouches: 5000 };

/** "5 would go again, including Maya": the viewer first, then names they may see, then a plain count. */
export function goAgainLine(count, mine, names = []) { if (!count) return ""; const others = count - (mine ? 1 : 0);
  if (mine) return !others ? "You'd go again" : others === 1 && names.length ? `You and ${names[0]} would go again` : `You and ${others} more would go again`;
  if (!names.length) return count === 1 ? "1 person would go again" : `${count} would go again`;
  return count === 1 ? `${names[0]} would go again` : `${count} would go again, including ${names[0]}`; }

export function makeCuration({ store, L, X, C, app, now: clock = () => Date.now() }) {
  const sys = (k) => store.get("system/" + k)?.data;
  const put = (k, v) => store.set("system/" + k, v);
  const listKey = (owner, id) => hash(owner + "|" + id);
  const safety = () => app?.locals?.appstore?.safety || null;
  const person = (em) => { try { return X.person(lc(em)) || {}; } catch { return {}; } };
  const friendsOf = (em) => { try { return X.friendsOf(lc(em)).map((f) => lc(f.email)); } catch { return []; } };
  const isFriend = (owner, viewer) => !!viewer && friendsOf(owner).includes(lc(viewer));
  const handleOf = (em) => person(em).handle || "";
  const ownerOfHandle = (h) => { h = lc(h); if (!HANDLE.test(h)) return ""; const ws = C.wsOfHandle(h); if (!ws || ws === DEFAULT_WS) return ""; return lc(getWorkspace(ws)?.ownerEmail); };

  // ---------- the one gate ----------
  const blockTargets = (em) => { try { return new Set((safety()?.blocksOf(em) || []).map((b) => b.target)); } catch { return new Set(); } };
  /** Has either person blocked the other (as a person, or as a host page)? */
  function blocked(a, b) { a = lc(a); b = lc(b); if (!a || !b || a === b) return false;
    const A = blockTargets(a), B = blockTargets(b), ha = handleOf(a), hb = handleOf(b);
    return A.has("person:" + keyOf(b)) || (hb && A.has("host:" + hb)) || B.has("person:" + keyOf(a)) || (ha && B.has("host:" + ha)); }
  const prefs = (em) => { const d = sys("plcur-" + hash(em)) || {}; return { curators: Array.isArray(d.curators) ? d.curators : [], lists: Array.isArray(d.lists) ? d.lists : [], saved: Array.isArray(d.saved) ? d.saved : [], optOut: Array.isArray(d.optOut) ? d.optOut : [], nudged: d.nudged && typeof d.nudged === "object" ? d.nudged : {} }; };
  const writePrefs = (em, P) => put("plcur-" + hash(em), { kind: "plcur", email: lc(em), ...P, at: clock() });
  const steppedOut = (owner, viewer) => !!viewer && prefs(viewer).optOut.includes(lc(owner));
  /** For server/library.js: is this list hidden from this viewer? mode "friends" also counts a step-out. */
  function hidden(owner, viewer, { mode = "block" } = {}) { if (!viewer || lc(owner) === lc(viewer)) return false; return blocked(owner, viewer) || (mode === "friends" && steppedOut(owner, viewer)); }
  /**
   * May this viewer see this list on this surface? surface: "link" (its /l/ page, the token in hand), "friends" (feed,
   * Shared with you), "public" (curator page, Discover, host lists, anyone's feed). Private never passes for anyone else.
   */
  function canSee(viewer, owner, Lst, surface = "public") { viewer = lc(viewer); owner = lc(owner); const mode = Lst?.share || "private";
    if (!Lst || !Lst.token && mode !== "private") return false;
    if (viewer && viewer === owner) return true;
    if (mode === "private") return false;
    if (viewer && blocked(owner, viewer)) return false;
    if (surface === "link") return mode === "link" || mode === "public" || (mode === "friends" && isFriend(owner, viewer) && !steppedOut(owner, viewer));
    if (surface === "friends") return (mode === "friends" || mode === "public") && isFriend(owner, viewer) && !steppedOut(owner, viewer);
    return mode === "public"; }

  // ---------- the lists ----------
  /** Every shared list with a live token: { owner, L, mode }. Read from the token docs, then checked against the list. */
  function shared(modes = ["public"]) { const out = [];
    for (const d of store.listPrefix("system", "pllibtok-")) { const t = d.data; if (t?.kind !== "pllibtok" || !modes.includes(t.mode)) continue;
      const R = L.raw(t.email), Lst = R.lists.find((x) => x.id === t.list); if (!Lst || !Lst.token || Lst.share !== t.mode) continue; out.push({ owner: lc(t.email), L: Lst, mode: t.mode }); }
    return out; }
  const byToken = (token) => { if (!TOKEN_OK.test(String(token || ""))) return null; const T = L.byToken(token); return T ? { owner: T.owner, L: T.L } : null; };
  const findList = (owner, id) => L.raw(owner).lists.find((x) => x.id === id) || null;
  const fansDoc = (owner, id) => sys("pllistfans-" + listKey(owner, id)) || { fans: [], saves: [] };
  const curFans = (owner) => sys("plcurfans-" + hash(owner))?.fans || [];
  /** A list as a card anywhere public: public items only, first name only. */
  function card(owner, Lst, viewer = "") { const items = L.publicItems(owner, Lst), F = fansDoc(owner, Lst.id), p = person(owner);
    return { token: Lst.token, url: "/l/" + Lst.token, name: Lst.name, note: Lst.note || "", mode: Lst.share, count: items.length, type: L.typeOf(items), covers: L.coverOf(items),
      by: first(p.name) || "Someone", handle: p.handle || "", curatorUrl: p.handle ? `/@${p.handle}/lists` : "", followers: F.fans.length, saves: F.saves.length,
      following: !!viewer && F.fans.some((f) => f.email === lc(viewer)), saved: !!viewer && F.saves.some((f) => f.email === lc(viewer)), mine: !!viewer && lc(viewer) === owner, updated: Lst.updated || Lst.at || 0 }; }
  const publicListsOf = (owner) => L.raw(owner).lists.filter((x) => x.share === "public" && x.token);

  // ---------- following ----------
  const addTo = (arr, rec, key) => [rec, ...arr.filter((x) => key(x) !== key(rec))];
  function followCurator(viewer, handle, on = true) { viewer = lc(viewer); const owner = ownerOfHandle(handle);
    if (!owner) return { error: "No one by that name.", status: 404, code: "not_found" }; if (owner === viewer) return { error: "That's you.", status: 400, code: "invalid" };
    if (blocked(owner, viewer)) return { error: "No one by that name.", status: 404, code: "not_found" };
    if (on && !publicListsOf(owner).length) return { error: "No public lists to follow yet.", status: 404, code: "not_found" };
    const P = prefs(viewer); P.curators = on ? addTo(P.curators, { email: owner, at: clock() }, (x) => x.email).slice(0, MAX.follows) : P.curators.filter((x) => x.email !== owner); writePrefs(viewer, P);
    const fans = curFans(owner).filter((f) => f.email !== viewer); if (on) fans.unshift({ email: viewer, at: clock() });
    put("plcurfans-" + hash(owner), { kind: "plcurfans", email: owner, fans: fans.slice(0, MAX.fans) });
    if (on) try { X.notify?.(owner, { kind: "follow", key: "plcurf-" + hash(owner + viewer), text: `${first(person(viewer).name) || "Someone"} followed your lists`, link: "/library" }); } catch {}
    return { ok: true, following: on, followers: fans.length }; }
  function listAction(viewer, token, field, on = true) { viewer = lc(viewer); const T = byToken(token);
    if (!T || T.L.share !== "public" || !canSee(viewer, T.owner, T.L, "public")) return { error: "This list isn't public.", status: 404, code: "not_found" };
    if (T.owner === viewer) return { error: "That's your list.", status: 400, code: "invalid" };
    const k = "pllistfans-" + listKey(T.owner, T.L.id), D = fansDoc(T.owner, T.L.id), arr = (D[field] || []).filter((f) => f.email !== viewer); if (on) arr.unshift({ email: viewer, at: clock() });
    put(k, { kind: "pllistfans", email: T.owner, list: T.L.id, fans: field === "fans" ? arr.slice(0, MAX.fans) : D.fans || [], saves: field === "saves" ? arr.slice(0, MAX.fans) : D.saves || [] });
    const P = prefs(viewer), pk = field === "fans" ? "lists" : "saved"; P[pk] = on ? addTo(P[pk], { owner: T.owner, id: T.L.id, at: clock() }, (x) => x.owner + "|" + x.id).slice(0, MAX.follows) : P[pk].filter((x) => !(x.owner === T.owner && x.id === T.L.id)); writePrefs(viewer, P);
    return { ok: true, [field === "fans" ? "following" : "saved"]: on, followers: field === "fans" ? arr.length : (D.fans || []).length }; }
  const followList = (viewer, token, on) => listAction(viewer, token, "fans", on);
  const saveList = (viewer, token, on) => listAction(viewer, token, "saves", on);
  /** Step out of (or back into) one person's friends lists. They aren't told. */
  function stepOut(viewer, token, on = true) { viewer = lc(viewer); const T = byToken(token); if (!T || T.owner === viewer) return { error: "No such list.", status: 404, code: "not_found" };
    const P = prefs(viewer); P.optOut = on ? [T.owner, ...P.optOut.filter((x) => x !== T.owner)].slice(0, 500) : P.optOut.filter((x) => x !== T.owner); writePrefs(viewer, P); return { ok: true, steppedOut: on, by: first(person(T.owner).name) }; }
  /** Lists and curators this person follows or saved, as cards (only ones they may still see). */
  function following(viewer) { viewer = lc(viewer); const P = prefs(viewer), seen = new Set(), lists = [];
    for (const r of [...P.lists.map((x) => ({ ...x, f: true })), ...P.saved]) { const k = r.owner + "|" + r.id; if (seen.has(k)) continue; seen.add(k); const Lst = findList(r.owner, r.id); if (Lst && canSee(viewer, r.owner, Lst, "public")) lists.push(card(r.owner, Lst, viewer)); }
    const curators = P.curators.filter((c) => !blocked(c.email, viewer)).map((c) => { const p = person(c.email); return { name: first(p.name), handle: p.handle || "", url: p.handle ? `/@${p.handle}/lists` : "", lists: publicListsOf(c.email).length }; }).filter((c) => c.handle);
    return { lists, curators }; }

  // ---------- opens (the nudge and "went from your list") ----------
  function opened(owner, Lst, viewer) { viewer = lc(viewer); owner = lc(owner); if (!viewer || viewer === owner || !Lst?.id) return;
    const k = "plopen-" + listKey(owner, Lst.id), D = sys(k) || { by: {} }, h = hash(viewer); if (D.by?.[h]) return;
    const by = { ...(D.by || {}), [h]: clock() }; const keys = Object.keys(by); if (keys.length > MAX.opens) for (const x of keys.slice(0, keys.length - MAX.opens)) delete by[x];
    put(k, { kind: "plopen", email: owner, list: Lst.id, by }); }
  const opensOf = (owner, id) => sys("plopen-" + listKey(owner, id))?.by || {};

  // ---------- I'd go again ----------
  const vKey = (kind, ref) => "plvouch-" + hash(kind + ":" + ref);
  const vouchesOf = (kind, ref) => sys(vKey(kind, ref))?.by || [];
  const rsvpMissed = (ws, eventId, email) => { try { return scopeStore(store, ws).listShared("rsvps").some((d) => d.data?.eventId === eventId && lc(d.data?.email) === email && d.data?.noShow); } catch { return false; } };
  /** Did this person go? An event: a past one they said I'm in to and didn't miss. A host: any such event of theirs. */
  function went(email, kind, ref, now = clock()) { email = lc(email); if (!email) return false; const I = X.index(), t = today(now), mine = I.att.get(email) || [];
    const ok = (eventId) => { const x = I.events.get(eventId); return !!x && !!x.e.date && x.e.date < t && !x.e.cancelled && !x.e.example && mine.some((a) => a.eventId === eventId) && !(rsvpMissed(x.ws, eventId, email) && !(x.e.guests || []).some((g) => lc(g.email) === email && /Attended/.test(g.status || ""))); };
    if (kind === "event") return ID_OK.test(ref) && ok(ref);
    if (kind === "host") { const ws = HANDLE.test(lc(ref)) ? C.wsOfHandle(lc(ref)) : null; return !!ws && mine.some((a) => I.events.get(a.eventId)?.ws === ws && ok(a.eventId)); }
    return false; }
  function vouch(email, kind, ref, on = true) { email = lc(email); kind = lc(kind); ref = kind === "host" ? lc(ref) : String(ref || "");
    if (!VOUCH_KINDS.includes(kind) || !(kind === "host" ? HANDLE.test(ref) : ID_OK.test(ref))) return { error: "That can't take an I'd go again.", status: 400, code: "invalid" };
    if (on && !went(email, kind, ref)) return { error: "You can say this once you've been.", status: 403, code: "not_attended" };
    const by = vouchesOf(kind, ref).filter((v) => v.email !== email); if (on) by.unshift({ email, at: clock() });
    put(vKey(kind, ref), { kind: "plvouch", item: kind + ":" + ref, by: by.slice(0, MAX.vouches) }); return { ok: true, mine: on, ...vouchInfo(kind, ref, email) }; }
  /** What a viewer sees: the count (people blocked either way left out), names they know first, and whether they can add theirs. */
  function vouchInfo(kind, ref, viewer = "", { also = [] } = {}) { viewer = lc(viewer); const fr = new Set(viewer ? X.friendsOf(viewer).map((f) => lc(f.email)) : []), pref = new Set(also.map(lc));
    let by = kind === "host" ? hostVouchers(ref) : vouchesOf(kind, ref); if (viewer) by = by.filter((v) => v.email === viewer || !blocked(v.email, viewer));
    const mine = !!viewer && by.some((v) => v.email === viewer), names = by.filter((v) => v.email !== viewer && (fr.has(v.email) || pref.has(v.email))).sort((a, b) => pref.has(b.email) - pref.has(a.email)).map((v) => first(person(v.email).name)).filter(Boolean);
    return { count: by.length, mine, names: names.slice(0, 3), line: goAgainLine(by.length, mine, names), can: !!viewer && !mine && VOUCH_KINDS.includes(kind) && went(viewer, kind, ref) }; }
  /** A host's count: people who would go again to the host or to any of their events, once each. */
  function hostVouchers(handle) { handle = lc(handle); const ws = C.wsOfHandle(handle); const M = new Map(); for (const v of vouchesOf("host", handle)) M.set(v.email, v);
    if (ws) for (const x of X.index().events.values()) if (x.ws === ws) for (const v of vouchesOf("event", x.id)) if (!M.has(v.email)) M.set(v.email, v); return [...M.values()]; }

  // ---------- what a shared list adds (server/library.js publicView) ----------
  function decorate(out, { owner, L: Lst, viewer }) { viewer = lc(viewer); const p = person(owner), F = fansDoc(owner, Lst.id);
    out.curator = { name: first(p.name), handle: p.handle || "", url: Lst.share === "public" && p.handle ? `/@${p.handle}/lists` : "" };
    out.followers = Lst.share === "public" ? F.fans.length : 0; out.following = !!viewer && F.fans.some((f) => f.email === viewer); out.saved = !!viewer && F.saves.some((f) => f.email === viewer);
    out.canFollow = Lst.share === "public" && !!viewer && viewer !== owner;
    out.canStepOut = Lst.share === "friends" && !!viewer && viewer !== owner && isFriend(owner, viewer);
    out.items = out.items.map((i) => (VOUCH_KINDS.includes(i.kind) ? { ...i, again: vouchInfo(i.kind, i.ref, viewer, { also: [owner] }) } : i));
    return out; }

  // ---------- curator pages, Discover, hosts ----------
  function curator(handle, viewer = "") { viewer = lc(viewer); const owner = ownerOfHandle(handle); if (!owner || (viewer && blocked(owner, viewer))) return null;
    const p = person(owner), lists = publicListsOf(owner).map((x) => card(owner, x, viewer)).sort((a, b) => b.updated - a.updated), fans = curFans(owner);
    return { name: first(p.name) || "Someone", handle: p.handle || lc(handle), emoji: p.emoji || "", color: p.color || "", followers: fans.length, following: !!viewer && fans.some((f) => f.email === viewer), me: viewer === owner, lists }; }
  /** "Lists people love" on Discover: public lists with 3 or more public things, most followed and freshest first. */
  function popular(viewer = "", { limit = 12, now = clock() } = {}) { viewer = lc(viewer);
    return shared(["public"]).filter(({ owner }) => !viewer || !blocked(owner, viewer)).map(({ owner, L: Lst }) => { const c = card(owner, Lst, viewer); const age = (now - (Lst.updated || Lst.at || 0)) / 864e5;
      return { ...c, _s: c.followers * 3 + c.saves * 2 + Object.keys(opensOf(owner, Lst.id)).length * 0.2 - Math.min(20, age / 3) }; })
      .filter((c) => c.count >= 3 && c.handle).sort((a, b) => b._s - a._s).slice(0, limit).map(({ _s, ...c }) => c); }
  /** "On 14 public lists" for a host: public lists whose public view still shows the host or one of their events. */
  function hostLists(handle, viewer = "") { handle = lc(handle); viewer = lc(viewer); const ws = HANDLE.test(handle) ? C.wsOfHandle(handle) : null; if (!ws) return { count: 0, top: [] };
    const I = X.index(), out = [];
    for (const { owner, L: Lst } of shared(["public"])) { if (viewer && blocked(owner, viewer)) continue;
      const items = L.publicItems(owner, Lst); if (!items.some((i) => ((i.kind === "host" || i.kind === "club") && lc(i.ref) === handle) || (i.kind === "event" && I.events.get(i.ref)?.ws === ws))) continue;
      out.push(card(owner, Lst, viewer)); }
    return { count: out.length, top: out.sort((a, b) => b.followers - a.followers || b.updated - a.updated).slice(0, 3) }; }

  // ---------- the curator's strip and the nudge ----------
  function stats(email) { email = lc(email); const R = L.raw(email), I = X.index(), mine = R.lists.filter((x) => x.share !== "private" && x.token);
    const followers = new Set(curFans(email).map((f) => f.email)); let saves = 0; const went = new Set();
    const byEvent = new Map(); for (const [em, recs] of I.att) for (const r of recs) { if (!r.rsvpAt) continue; if (!byEvent.has(r.eventId)) byEvent.set(r.eventId, []); byEvent.get(r.eventId).push({ em, at: r.rsvpAt }); }
    for (const Lst of mine) { const F = fansDoc(email, Lst.id); for (const f of F.fans) followers.add(f.email); saves += F.saves.length;
      const touched = new Map(Object.entries(opensOf(email, Lst.id))); for (const f of [...F.fans, ...F.saves]) { const h = hash(f.email); if (!touched.has(h) || touched.get(h) > f.at) touched.set(h, f.at); }
      for (const i of L.publicItems(email, Lst)) if (i.kind === "event") for (const r of byEvent.get(i.ref) || []) { const t = touched.get(hash(r.em)); if (t && t <= r.at && r.em !== email) went.add(r.em); } }
    return { followers: followers.size, saves, went: went.size, publicLists: R.lists.filter((x) => x.share === "public").length, handle: handleOf(email) }; }
  /** One nudge at a time: a Friends list opened by NUDGE_MIN friends or more, not dismissed. */
  function nudge(email) { email = lc(email); const P = prefs(email), fr = new Set(friendsOf(email).map(hash));
    let best = null; for (const Lst of L.raw(email).lists) { if (Lst.share !== "friends" || P.nudged[Lst.id]) continue; const n = Object.keys(opensOf(email, Lst.id)).filter((h) => fr.has(h)).length;
      if (n >= NUDGE_MIN() && (!best || n > best.opens)) best = { id: Lst.id, name: Lst.name, opens: n, line: `${n} friends opened ${Lst.name}. Make it public?` }; }
    return best; }
  function dismissNudge(email, id) { const P = prefs(email); P.nudged = { ...P.nudged, [String(id).slice(0, 20)]: clock() }; writePrefs(email, P); return { ok: true }; }

  // ---------- for the feed (server/listfeed.js) ----------
  /** The shared lists this viewer may see in their feed, with the moment each reached them. */
  function feedLists(viewer) { viewer = lc(viewer); if (!viewer) return []; const P = prefs(viewer), cur = new Set(P.curators.map((c) => c.email)), fl = new Set(P.lists.map((x) => x.owner + "|" + x.id)), out = [];
    for (const { owner, L: Lst, mode } of shared(["friends", "public"])) { if (owner === viewer) continue;
      const friend = canSee(viewer, owner, Lst, "friends"), fol = mode === "public" && canSee(viewer, owner, Lst, "public") && (cur.has(owner) || fl.has(owner + "|" + Lst.id));
      if (!friend && !fol) continue; const from = Math.min(...[friend ? Lst.sharedAt || Lst.at : Infinity, fol ? Lst.publicAt || Lst.sharedAt || Lst.at : Infinity]);
      out.push({ owner, L: Lst, mode, from: from === Infinity ? Lst.at || 0 : from, friend, followsList: fl.has(owner + "|" + Lst.id) }); }
    return out; }

  return { canSee, hidden, blocked, decorate, opened, shared, card, curator, popular, hostLists, followCurator, followList, saveList, stepOut, following, went, vouch, vouchInfo, stats, nudge, dismissNudge, feedLists, listKey, person, prefs, fansDoc, publicItems: (owner, Lst) => L.publicItems(owner, Lst) };
}

export function mountCuration(app, { store, small, currentUser, C, X, sendStatic }) {
  const L = app.locals.library; if (!L) return null;
  const CU = makeCuration({ store, L, X, C, app }); app.locals.curation = CU;
  app.locals.listFeed = makeListFeed({ CU, L }); // list cards in the feed (server/listfeed.js, plugged into server/feedblend.js)
  const hits = new Map(), over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); if (hits.size > 20000) hits.clear(); } return ++h.n > n; };
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; } catch { return null; } };
  const me = (req, res) => { const u = viewer(req); res.set("Cache-Control", "private, no-store"); if (!u) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } if (over("w|" + lc(u.email), 600)) { res.status(429).json({ code: "rate_limited", message: "That's a lot for one hour. Try again in a bit." }); return null; } return u; };
  const send = (res, r) => (r?.error ? res.status(r.status || 400).json({ code: r.code || "invalid", message: r.error }) : res.json(r));
  const slowIp = (req, res, n = 1200) => { if (over("ip|" + (req.ip || "?"), n)) { res.status(429).json({ code: "rate_limited", message: "Slow down." }); return true; } return false; };
  const on = (req) => req.body?.on !== false;
  const em = (req) => { const u = viewer(req); return u ? lc(u.email) : ""; };

  // the curator page
  app.get(/^\/@([a-z0-9][a-z0-9-]{1,29})\/lists$/, (req, res) => sendStatic(res, "curator.html", "<p>Page missing.</p>"));
  app.get("/api/public/curators/:handle", (req, res) => { if (slowIp(req, res)) return; res.set("Cache-Control", "private, no-store"); res.set("X-Robots-Tag", "noindex");
    const r = CU.curator(String(req.params.handle || ""), em(req)); if (!r) return res.status(404).json({ code: "not_found", message: "No one by that name." });
    if (r.me) r.stats = CU.stats(em(req)); res.json(r); });
  app.post("/api/me/curators/:handle/follow", small, (req, res) => { const u = me(req, res); if (!u) return; send(res, CU.followCurator(u.email, String(req.params.handle || ""), on(req))); });
  // one list: follow, save to your library, step out of someone's friends lists
  app.post("/api/me/lists/:token/follow", small, (req, res) => { const u = me(req, res); if (!u) return; send(res, CU.followList(u.email, String(req.params.token || ""), on(req))); });
  app.post("/api/me/lists/:token/save", small, (req, res) => { const u = me(req, res); if (!u) return; send(res, CU.saveList(u.email, String(req.params.token || ""), on(req))); });
  app.post("/api/me/lists/:token/step-out", small, (req, res) => { const u = me(req, res); if (!u) return; send(res, CU.stepOut(u.email, String(req.params.token || ""), on(req))); });
  app.get("/api/me/lists/following", (req, res) => { const u = me(req, res); if (!u) return; res.json(CU.following(u.email)); });
  // Discover's shelf and a host's lists
  app.get("/api/public/lists-popular", (req, res) => { if (slowIp(req, res)) return; const v = em(req); res.set("Cache-Control", v ? "private, no-store" : "public, max-age=60"); res.json({ lists: CU.popular(v) }); });
  app.get("/api/public/host-lists/:handle", (req, res) => { if (slowIp(req, res)) return; const v = em(req); res.set("Cache-Control", v ? "private, no-store" : "public, max-age=60"); res.json(CU.hostLists(String(req.params.handle || ""), v)); });
  // I'd go again: the line for an event or host page, and the tap
  app.get("/api/public/again", (req, res) => { if (slowIp(req, res)) return; res.set("Cache-Control", "private, no-store"); const kind = lc(req.query.kind), ref = kind === "host" ? lc(req.query.ref) : String(req.query.ref || ""), v = em(req);
    if (kind === "event") { const I = X.index(), x = I.events.get(ref), V = app.locals.feedVisual; if (!x || !(V?.cardPublic?.(x.e) || V?.wasThere?.(I, ref, v))) return res.json({ count: 0, line: "", mine: false, can: false }); }
    else if (kind === "host") { if (!HANDLE.test(ref) || !C.wsOfHandle(ref)) return res.json({ count: 0, line: "", mine: false, can: false }); }
    else return res.status(400).json({ code: "invalid", message: "Pick an event or a host." });
    res.json(CU.vouchInfo(kind, ref, v)); });
  app.post("/api/me/again", small, (req, res) => { const u = me(req, res); if (!u) return; if (over("v|" + lc(u.email), 120)) return res.status(429).json({ code: "rate_limited", message: "Slow down." }); send(res, CU.vouch(u.email, req.body?.kind, req.body?.ref, on(req))); });
  // the curator's note on an item, their strip and the nudge
  app.post("/api/me/library/lists/:id/note", small, (req, res) => { const u = me(req, res); if (!u) return; send(res, L.setNote(u.email, String(req.params.id || ""), lc(req.body?.kind), String(req.body?.ref || ""), req.body?.why)); });
  app.get("/api/me/lists/stats", (req, res) => { const u = me(req, res); if (!u) return; try { X.ensureProfile(u); } catch {} res.json({ ...CU.stats(u.email), nudge: CU.nudge(u.email) }); });
  app.post("/api/me/lists/nudge", small, (req, res) => { const u = me(req, res); if (!u) return; send(res, CU.dismissNudge(u.email, String(req.body?.id || ""))); });
  return CU;
}
// ---- end lists people follow ----
