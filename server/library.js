// The library: everything that resonates with you, in one place, at /library (and /saved, its old name).
//
// For guests, a light layer over what already exists:
// - smart lists that fill themselves and can't be edited: Going (upcoming plans), Saved (every heart, server/hooks.js),
//   Hosts you follow and Fan clubs (server/fanclub.js), Went (past plans). Pinned by default.
// - your own lists ("Cozy winter spots"): a name, an optional note, items of any kind (events, hosts, clubs, ideas,
//   places, collections from Discover, drops). Private by default. A list can also be "share link" (read only, anyone with the link) or "shared with
//   friends" (people you added as friends can open it and add to it, for planning together). Shared lists use an
//   unguessable token; switching back to private kills the link, and a new share makes a new one.
//   Public (server/curation.js): on the owner's curator page, Discover and followers' feeds, followable. It keeps a
//   token too, so its /l/<token> link works like a share link. Every new list is Private.
// - the old boards (system/plsave-<hash>.boards, one board per save) stay where they are and keep working. Each board
//   shows up here as a list with the board's id: its items are its saves plus anything added here, and renaming or
//   deleting the list renames or deletes the board. Nothing is copied out of the saves record.
//
// For hosts, a "Host library" of reusable things from their own workspace: past events ("Copy as a new event"),
// menus, playlist links, their own photos and covers, guest lists from past events, and templates (any event saved as
// one). Every item has "Start from this": a new draft event made from it, opened in the create flow.
//
// What a shared list never shows: anyone's email, who saved what elsewhere, private, unlisted or members-only events
// (only what a public page already shows), the owner's other lists. People appear by first name only: the owner, and
// in a friends list, who added each item.
//
// Docs: system/pllib-<hash of email> (lists, pins, last-used list), system/pllibtok-<hash of token> (token to owner
// and list), ws/<host>/hostlib/<id> (templates). All carry the owner's email, so account deletion (server/account.js)
// removes them, and items a person added to a friend's list (they carry `by`) go with them.
import { coverOf as eventCover } from "./eventcover.js"; // one cover per event everywhere (coverOf below is a list's cover)
import crypto from "node:crypto";
import { scopeStore, workspaceOfEvent, getWorkspace, DEFAULT_WS, claimEvent } from "./workspaces.js";
import { randomId } from "./db.js";
import { SAVE_IMG_OK } from "./hooks.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const thash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex").slice(0, 32);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const ID_OK = /^[A-Za-z0-9_-]{1,120}$/, HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/, IDEA_OK = /^idea-[a-z0-9-]{1,60}$/, PLACE_OK = /^[a-z0-9][a-z0-9_.:-]{1,79}$/i;
const LIST_ID = /^[lb][a-f0-9]{10}$/, TOKEN_OK = /^[A-Za-z0-9_-]{24}$/;
const IMG = (u) => (SAVE_IMG_OK(u) ? u : "");
const PLAY_OK = (u) => /^https:\/\/[^\s"'<>()]{4,300}$/i.test(u || "");

export const KINDS = ["event", "host", "club", "idea", "place", "collection", "drop"];
export const SHARE = ["private", "friends", "link", "public"]; // public: server/curation.js
export const SMART = [
  { id: "going", name: "Going", sub: "Your plans coming up" },
  { id: "saved", name: "Saved", sub: "Everything you saved" },
  { id: "hosts", name: "Hosts you follow", sub: "Hosts" },
  { id: "clubs", name: "Fan clubs", sub: "Clubs you're in" },
  { id: "went", name: "Went", sub: "Past events" },
];
export const LIMITS = { lists: 100, items: 300, pins: 24, name: 60, note: 280, createPerHour: 20, addsPerHour: 240, friendAddsPerHour: 60, templates: 60 };
const DEFAULT_PINS = SMART.map((s) => "smart:" + s.id);
const COLL_OK = /^[a-z0-9][a-z0-9-]{1,40}$/;
const refOk = (kind, ref) => (kind === "event" || kind === "drop" ? ID_OK.test(ref) : kind === "host" || kind === "club" ? HANDLE.test(ref) : kind === "idea" ? IDEA_OK.test(ref) : kind === "place" ? PLACE_OK.test(ref) : kind === "collection" ? COLL_OK.test(ref) : false);
const keyOf = (i) => i.kind + ":" + i.ref;

export function makeLibrary({ store, H, Dir, F, X, C, G = () => null, now: clock = () => Date.now() }) {
  // ---- visibility (server/curation.js): blocks both ways, friends who stepped out, opens for the nudge ----
  const gate = () => { try { return G() || null; } catch { return null; } };
  const hiddenFor = (owner, viewer, mode) => { const g = gate(); try { return !!g && !!viewer && lc(owner) !== lc(viewer) && g.hidden(owner, viewer, { mode }); } catch { return false; } };
  // ---- end visibility ----
  const sys = (k) => store.get("system/" + k)?.data;
  const put = (k, v) => store.set("system/" + k, v);
  const lKey = (email) => "pllib-" + hash(email);
  const tKey = (token) => "pllibtok-" + thash(token);
  const person = (email) => { try { return X?.person?.(lc(email)) || {}; } catch { return {}; } };
  const friendsOf = (email) => { try { return (X?.friendsOf?.(lc(email)) || []).map((f) => lc(f.email)); } catch { return []; } };
  const isFriend = (owner, email) => !!email && friendsOf(owner).includes(lc(email));

  // ---- the record, with boards folded in ----
  function raw(email) { const d = sys(lKey(email)) || {}; return { lists: Array.isArray(d.lists) ? d.lists : [], pins: Array.isArray(d.pins) ? d.pins : null, last: typeof d.last === "string" ? d.last : "", opened: d.opened && typeof d.opened === "object" ? d.opened : {} }; }
  function write(email, R) { put(lKey(email), { kind: "pllib", email: lc(email), lists: R.lists.slice(0, LIMITS.lists + 40), pins: R.pins, last: R.last, opened: R.opened, at: clock() }); }
  /** Lists, with every board as a list (same id). Writes once when a board appears or goes. */
  function load(email) { const R = raw(email), S = H.savesRaw(email); let changed = false;
    for (const b of S.boards) { const L = R.lists.find((x) => x.id === b.id); if (L) { if (L.name !== b.name) { L.name = b.name; changed = true; } continue; }
      if ((R.droppedBoards || []).includes(b.id)) continue; R.lists.push({ id: b.id, board: b.id, name: b.name, note: "", share: "private", token: "", items: [], at: b.at || clock(), updated: b.at || clock() }); changed = true; }
    // a board deleted from the old page: its list goes too unless something lives only here
    R.lists = R.lists.filter((L) => { if (!L.board || S.boards.some((b) => b.id === L.board)) return true; if (L.items.length || L.note || L.share !== "private") { delete L.board; changed = true; return true; } changed = true; return false; });
    if (changed) write(email, R); return { R, S }; }
  const itemsOf = (L, S) => { const out = L.items.slice(), have = new Set(out.map(keyOf));
    if (L.board) for (const i of S.items) if (i.board === L.board && !have.has(keyOf(i))) { out.push({ kind: i.kind, ref: i.ref, title: i.title, img: i.img, at: i.at, board: true }); have.add(keyOf(i)); }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0)); };

  // ---- hydrating an item: what a public page shows, else the snapshot the owner saved ----
  function hydrate(base, i, { pub = false } = {}) { const K = H.catalog(base), out = { kind: i.kind, ref: i.ref, title: clean(i.title, 140), img: IMG(i.img), url: "", line: "", date: "", status: "", art: null, emoji: "", at: i.at || 0 };
    if (i.kind === "event") { const e = Dir.getEvent(base, i.ref);
      const clubOnly = (() => { try { const ws = workspaceOfEvent(i.ref); return !!ws && F?.visibility?.(ws, i.ref) === "members"; } catch { return false; } })();
      if (e && !(pub && (clubOnly || e.example))) return { ...out, title: e.title, img: IMG(H.rel(base, e.cover)) || out.img, url: H.rel(base, e.url), line: K.events.get(i.ref)?.card.line || "", date: e.start || "", status: e.status || "", art: { activity: e.format || "" }, host: first(e.host?.name) };
      if (pub) return null; return { ...out, url: "/e/" + encodeURIComponent(i.ref), status: i.status || "", date: i.date || "", art: { activity: i.activity || "" } }; }
    if (i.kind === "host" || i.kind === "club") { const h = K.hosts.get(i.ref);
      if (!h) return pub ? null : { ...out, url: "/@" + i.ref };
      // a shared list names hosts by first name only, like everyone else on it
      const v = { ...out, title: pub ? first(h.name) : h.name, img: IMG(H.rel(base, h.avatar)) || "", url: H.rel(base, h.url), line: clean(h.tagline, 120), emoji: h.emoji || "", status: i.kind };
      if (i.kind === "club") { let c = null; try { const ws = C.wsOfHandle(i.ref); c = ws ? F?.config?.(ws) : null; } catch {} if (!c?.on) return pub ? null : { ...v, line: "Fan club" };
        return { ...v, title: c.name, line: `${first(h.name)}'s fan club`, url: H.rel(base, h.url) + "#club" }; }
      return v; }
    if (i.kind === "idea") { const x = H.IDEAS.find((y) => y.id === i.ref); if (!x) return pub ? null : out; return { ...out, title: x.title, line: x.line, url: "/ideas#" + x.id, status: "idea", art: { kind: x.art, tone: x.tone } }; }
    if (i.kind === "place") return { ...out, title: out.title || "A place", line: clean(i.line, 80), status: "place", url: "" };
    // a Discover collection (/c/<id>): its own page; the title is what the shelf was called when it was saved
    if (i.kind === "collection") return { ...out, title: out.title || "A collection", line: "Collection", status: "collection", url: "/c/" + encodeURIComponent(i.ref) };
    // a drop (order ahead, pick up later): an event under the hood (server/drops.js), so its own invite page
    if (i.kind === "drop") { let ev = null; try { const ws = workspaceOfEvent(i.ref); ev = ws && ws !== DEFAULT_WS ? scopeStore(store, ws).get("events/" + i.ref)?.data : null; } catch {}
      if (!ev?.drop || ev.cancelled) return pub ? null : { ...out, line: "Drop", status: "drop", url: "/e/" + encodeURIComponent(i.ref) };
      if (pub && !ev.discoverable) return null;
      return { ...out, title: clean(ev.pubTitle || ev.name, 140) || out.title, img: IMG(ev.coverPhoto) || out.img, line: "Drop", status: "drop", date: ev.date || "", url: "/e/" + encodeURIComponent(i.ref) }; }
    return pub ? null : out; }
  const hydrateAll = (base, L, o) => L.map((i) => hydrate(base, i, o)).filter(Boolean);
  const kindWord = { event: "Events", host: "Hosts", club: "Clubs", idea: "Ideas", place: "Places", collection: "Collections", drop: "Drops" };
  const typeOf = (items) => { const k = [...new Set(items.map((i) => i.kind))]; return !k.length ? "List" : k.length === 1 ? kindWord[k[0]] : "Mixed"; };
  const coverOf = (items) => items.slice(0, 4).map((i) => ({ kind: i.kind, ref: i.ref, title: i.title, img: i.img, art: i.art, emoji: i.emoji }));
  const linkOf = (L) => (L.token ? "/l/" + L.token : "");

  // ---- smart lists ----
  function plans(email) { let P = { stamps: [], next: [] }; try { P = H.passport(email); } catch {}
    const row = (s) => { const ws = (() => { try { return workspaceOfEvent(s.eventId); } catch { return null; } })(), ev = ws ? scopeStore(store, ws).get("events/" + s.eventId)?.data : null;
      return { kind: "event", ref: s.eventId, title: s.title, img: IMG(ev?.coverPhoto), url: "/e/" + encodeURIComponent(s.eventId), line: [s.host?.name, s.city].filter(Boolean).join(" · "), date: s.date || "", status: s.date && s.date < iso(clock()) ? "past" : "upcoming", art: { activity: s.activity || "", kind: s.kind || "" }, emoji: "", at: s.date ? Date.parse(s.date + "T12:00:00Z") : 0 }; };
    return { going: (P.next || []).map(row), went: (P.stamps || []).map(row) }; }
  function smartItems(base, email, id) {
    if (id === "going" || id === "went") return plans(email)[id];
    if (id === "saved") return hydrateAll(base, H.savesRaw(email).items, {});
    if (id === "hosts") { let L = []; try { L = F?.followedHosts?.(email) || []; } catch {} return L.map((h) => ({ kind: "host", ref: h.handle, title: h.name, img: IMG(h.avatarUrl), url: "/@" + h.handle, line: h.city || "", date: "", status: "host", art: null, emoji: h.emoji || "", at: h.at || 0 })); }
    if (id === "clubs") { let L = []; try { L = F?.clubMemberships?.(email) || []; } catch {} return L.map((c) => ({ kind: "club", ref: c.handle, title: c.club, img: "", url: "/@" + c.handle + "#club", line: `${first(c.host)}'s fan club`, date: "", status: "club", art: null, emoji: "", at: c.since || 0 })); }
    return null; }

  // ---- reading ----
  function summary(base, L, S, R) { const items = hydrateAll(base, itemsOf(L, S), {});
    return { id: L.id, name: L.name, note: L.note || "", share: L.share, link: linkOf(L), count: items.length, type: typeOf(items), covers: coverOf(items), pinned: pinsOf(R).includes("list:" + L.id), at: L.at, updated: L.updated || L.at, opened: R.opened[L.id] || 0, board: !!L.board, contributors: L.share === "friends" ? [...new Set(L.items.filter((i) => i.by).map((i) => first(person(i.by).name)).filter(Boolean))].slice(0, 5) : [] }; }
  const pinsOf = (R) => (R.pins || DEFAULT_PINS);
  /** Friends lists other people shared with this person. */
  function sharedWith(email) { const me = lc(email), out = []; if (!me) return out;
    for (const d of store.listPrefix("system", "pllibtok-")) { const t = d.data; if (t?.kind !== "pllibtok" || t.mode !== "friends" || lc(t.email) === me) continue; if (!isFriend(t.email, me)) continue;
      if (hiddenFor(t.email, me, "friends")) continue; // visibility: a block, or they stepped out of this person's friends lists
      const R = raw(t.email), L = R.lists.find((x) => x.id === t.list && x.share === "friends" && x.token); if (L) out.push({ owner: t.email, L }); }
    return out; }
  function library(base, email) { const { R, S } = load(email), today = iso(clock());
    const smart = SMART.map((s) => { const items = smartItems(base, email, s.id) || []; return { id: s.id, name: s.name, sub: s.sub, count: items.length, pinned: pinsOf(R).includes("smart:" + s.id), at: items[0]?.at || 0, opened: R.opened["smart:" + s.id] || 0 }; });
    const lists = R.lists.map((L) => summary(base, L, S, R));
    const shared = sharedWith(email).map(({ owner, L }) => { const items = hydrateAll(base, L.items, {}); return { id: L.id, token: L.token, name: L.name, note: L.note || "", by: first(person(owner).name) || "A friend", count: items.length, type: typeOf(items), covers: coverOf(items), link: linkOf(L), updated: L.updated || L.at, at: L.at, pinned: pinsOf(R).includes("shared:" + L.token) }; });
    // every item once, for the chips and search: where it lives, and the newest time it was added
    const all = new Map(), add = (i, where) => { const k = keyOf(i), cur = all.get(k); if (cur) { if (!cur.in.includes(where)) cur.in.push(where); cur.at = Math.max(cur.at || 0, i.at || 0); return; } all.set(k, { ...i, in: [where] }); };
    for (const s of SMART) for (const i of smartItems(base, email, s.id) || []) add(i, s.name);
    for (const L of R.lists) for (const i of hydrateAll(base, itemsOf(L, S), {})) add(i, L.name);
    const items = [...all.values()].map((i) => ({ ...i, past: i.kind === "event" && (i.status === "past" || (!!i.date && i.date < today)) }));
    return { smart, lists, shared, items, pins: pinsOf(R), last: R.last && (R.lists.some((L) => L.id === R.last) || R.last.startsWith("t:")) ? R.last : "", limits: { lists: LIMITS.lists, items: LIMITS.items } }; }
  function openList(base, email, id) { const { R, S } = load(email);
    const sm = SMART.find((s) => s.id === id); if (sm) { R.opened["smart:" + id] = clock(); write(email, R); const items = smartItems(base, email, id); return { smart: true, id, name: sm.name, sub: sm.sub, count: items.length, items, pinned: pinsOf(R).includes("smart:" + id) }; }
    const L = R.lists.find((x) => x.id === id); if (!L) return null; R.opened[id] = clock(); write(email, R);
    const items = hydrateAll(base, itemsOf(L, S), {}).map((i) => { const src = L.items.find((x) => keyOf(x) === keyOf(i)); return { ...i, addedBy: src?.by && lc(src.by) !== lc(email) ? first(person(src.by).name) : "" }; });
    return { ...summary(base, L, S, R), items: items.map((i) => ({ ...i, why: L.notes?.[keyOf(i)] || "" })) }; }

  // ---- writing lists ----
  const cleanShare = (v) => (SHARE.includes(v) ? v : "private");
  function setShare(email, L, mode, { rotate = false } = {}) { mode = cleanShare(mode); const was = L.share || "private";
    // visibility: when it reached friends' feeds (sharedAt) and followers' (publicAt), for the feed cards (server/listfeed.js)
    if ((mode === "friends" || mode === "public") && was !== "friends" && was !== "public") L.sharedAt = clock();
    if (mode === "public" && was !== "public") L.publicAt = clock();
    if (L.token && (mode === "private" || rotate)) { store.delete("system/" + tKey(L.token)); L.token = ""; }
    if (mode !== "private") { if (!L.token) L.token = crypto.randomBytes(18).toString("base64url"); put(tKey(L.token), { kind: "pllibtok", email: lc(email), list: L.id, mode, at: clock() }); }
    L.share = mode; }
  function createList(email, { name, note, share } = {}) { const nm = clean(name, LIMITS.name); if (!nm) return { error: "Give the list a name.", status: 400, code: "invalid" };
    const { R } = load(email); if (R.lists.length >= LIMITS.lists) return { error: `That's ${LIMITS.lists} lists, the most for now. Delete one to make room.`, status: 400, code: "limit" };
    const L = { id: "l" + crypto.randomBytes(5).toString("hex"), name: nm, note: clean(note, LIMITS.note), share: "private", token: "", items: [], at: clock(), updated: clock() };
    if (share && share !== "private") setShare(email, L, share);
    R.lists.unshift(L); write(email, R); return { list: L }; }
  function updateList(email, id, b = {}) { const { R } = load(email), L = R.lists.find((x) => x.id === id); if (!L) return { error: "No such list.", status: 404, code: "not_found" };
    if (b.name !== undefined) { const nm = clean(b.name, LIMITS.name); if (!nm) return { error: "Give the list a name.", status: 400, code: "invalid" }; L.name = nm; if (L.board) H.renameBoard(email, L.board, nm); }
    if (b.note !== undefined) L.note = clean(b.note, LIMITS.note);
    if (b.share !== undefined || b.rotate) setShare(email, L, b.share !== undefined ? b.share : L.share, { rotate: !!b.rotate });
    L.updated = clock(); write(email, R); return { list: L }; }
  function deleteList(email, id) { const { R } = load(email), L = R.lists.find((x) => x.id === id); if (!L) return false;
    if (L.token) store.delete("system/" + tKey(L.token)); R.lists = R.lists.filter((x) => x.id !== id); R.pins = pinsOf(R).filter((p) => p !== "list:" + id); if (R.last === id) R.last = "";
    write(email, R); if (L.board) H.dropBoard(email, L.board); return true; }
  /** One item from what a client sent: a kind, a ref and a small snapshot. */
  function cleanItem(x) { const kind = lc(x?.kind), ref = String(x?.ref || "").trim(); if (!KINDS.includes(kind) || !refOk(kind, ref)) return null;
    return { kind, ref, title: clean(x?.title, 140), img: IMG(x?.img), ...(kind === "place" ? { line: clean(x?.line, 80) } : {}), at: clock() }; }
  function addTo(L, item, by = "") { if (L.items.some((i) => keyOf(i) === keyOf(item))) return { already: true };
    if (L.items.length >= LIMITS.items) return { error: `A list holds up to ${LIMITS.items} things.`, status: 400, code: "limit" };
    L.items.unshift({ ...item, ...(by ? { by: lc(by) } : {}) }); L.updated = clock(); return { added: true }; }
  function addItem(email, id, x) { const it = cleanItem(x); if (!it) return { error: "That can't go on a list.", status: 400, code: "invalid" };
    const { R, S } = load(email), L = R.lists.find((l) => l.id === id); if (!L) return { error: "No such list.", status: 404, code: "not_found" };
    if (itemsOf(L, S).some((i) => keyOf(i) === keyOf(it))) { R.last = id; write(email, R); return { ok: true, already: true }; }
    const r = addTo(L, it); if (r.error) return r; R.last = id; write(email, R); return { ok: true, added: true }; }
  function removeItem(email, id, kind, ref) { const { R, S } = load(email), L = R.lists.find((l) => l.id === id); if (!L) return { error: "No such list.", status: 404, code: "not_found" };
    const n = L.items.length; L.items = L.items.filter((i) => !(i.kind === kind && i.ref === ref)); let removed = n !== L.items.length;
    if (L.board && S.items.some((i) => i.board === L.board && i.kind === kind && i.ref === ref)) { H.addSave(email, { kind, ref, board: "" }); removed = true; }
    if (removed) { L.updated = clock(); write(email, R); } return { ok: true, removed }; }
  function pin(email, key, on) { const { R } = load(email); if (!/^(smart:[a-z]+|list:[lb][a-f0-9]{10}|shared:[A-Za-z0-9_-]{24})$/.test(String(key || ""))) return { error: "Nothing to pin.", status: 400, code: "invalid" };
    let P = pinsOf(R).filter((p) => p !== key); if (on) { if (P.length >= LIMITS.pins) return { error: `Up to ${LIMITS.pins} pins.`, status: 400, code: "limit" }; P.unshift(key); } R.pins = P; write(email, R); return { pins: P }; }

  // ---- shared lists, by token ----
  function byToken(token) { if (!TOKEN_OK.test(String(token || ""))) return null; const t = sys(tKey(token)); if (t?.kind !== "pllibtok") return null;
    const R = raw(t.email), L = R.lists.find((x) => x.id === t.list); if (!L || L.token !== token || L.share === "private") return null; return { owner: lc(t.email), L, R }; }
  /** What anyone with the link sees: public things only, first names only. Friends lists open for the owner and their friends. */
  function publicView(base, token, viewer = "") { const T = byToken(token); if (!T) return { error: "This list isn't shared any more.", status: 404, code: "not_found" };
    const { owner, L } = T, v = lc(viewer), own = !!v && v === owner, friend = !own && isFriend(owner, v) && !hiddenFor(owner, v, "friends");
    if (!own && hiddenFor(owner, v, "block")) return { error: "This list isn't shared any more.", status: 404, code: "not_found" }; // visibility: blocked either way
    if (L.share === "friends" && !own && !friend) return { error: "This list is shared with friends only.", status: 403, code: "friends_only", by: first(person(owner).name) || "" };
    const S = H.savesRaw(owner), items = itemsOf(L, S).map((i) => { const h = hydrate(base, i, { pub: true }); if (!h) return null; const by = L.share === "friends" && i.by ? first(person(i.by).name) : "";
      return { kind: h.kind, ref: h.ref, title: h.title, img: h.img, url: h.url, line: h.line, date: h.date, status: h.status, art: h.art, emoji: h.emoji, ...(h.host ? { host: h.host } : {}), ...(by ? { addedBy: by } : {}), mine: !!v && lc(i.by || "") === v, why: L.notes?.[keyOf(i)] || "" }; }).filter(Boolean);
    const out = { name: L.name, note: L.note || "", by: first(person(owner).name) || "", mode: L.share, count: items.length, type: typeOf(items), covers: coverOf(items), items, canAdd: L.share === "friends" && (own || friend), isOwner: own, id: own ? L.id : undefined };
    try { const g = gate(); if (g) { if (!own) g.opened(owner, L, v); return g.decorate(out, { owner, L, viewer: v }); } } catch {} // visibility: follow, notes and I'd go again (server/curation.js)
    return out; }
  function friendAdd(token, viewer, x) { const T = byToken(token); if (!T) return { error: "This list isn't shared any more.", status: 404, code: "not_found" };
    const { owner, L, R } = T, v = lc(viewer); if (L.share !== "friends" || !(v === owner || (isFriend(owner, v) && !hiddenFor(owner, v, "friends")))) return { error: "Only friends can add to this list.", status: 403, code: "not_granted" };
    const it = cleanItem(x); if (!it) return { error: "That can't go on a list.", status: 400, code: "invalid" };
    const r = addTo(L, it, v === owner ? "" : v); if (r.error) return r; if (r.added) write(owner, R);
    if (v !== owner) { const me = load(v); me.R.last = "t:" + token; write(v, me.R); }
    return { ok: true, ...r }; }
  function friendRemove(token, viewer, kind, ref) { const T = byToken(token); if (!T) return { error: "This list isn't shared any more.", status: 404, code: "not_found" };
    const { owner, L, R } = T, v = lc(viewer), i = L.items.find((x) => x.kind === kind && x.ref === ref); if (!i) return { ok: true, removed: false };
    if (!(v === owner || (L.share === "friends" && lc(i.by || "") === v && isFriend(owner, v)))) return { error: "You can take out what you added.", status: 403, code: "not_granted" };
    L.items = L.items.filter((x) => x !== i); L.updated = clock(); write(owner, R); return { ok: true, removed: true }; }

  // ---- the save-to-list sheet ----
  function sheet(email, kind, ref, base = "") { const { R, S } = load(email), k = kind + ":" + ref, covers = (items) => coverOf(hydrateAll(base, items.slice(0, 4), {}));
    const lists = R.lists.map((L) => { const items = itemsOf(L, S); return { id: L.id, name: L.name, count: items.length, has: items.some((i) => keyOf(i) === k), share: L.share, covers: covers(items) }; });
    lists.sort((a, b) => (b.id === R.last) - (a.id === R.last) || (R.lists.find((x) => x.id === b.id).updated || 0) - (R.lists.find((x) => x.id === a.id).updated || 0));
    const shared = sharedWith(email).map(({ L }) => ({ id: "t:" + L.token, name: L.name, count: L.items.length, has: L.items.some((i) => keyOf(i) === k), share: "friends", covers: covers(L.items) }));
    const saved = S.items.some((i) => i.kind === kind && i.ref === ref), canSave = ["event", "idea", "host"].includes(kind);
    const last = R.last && (lists.some((l) => l.id === R.last) || shared.some((l) => l.id === R.last)) ? R.last : "";
    return { saved, canSave, lists, shared, last }; }
  /** Every thing this person has saved or put on a list ("event:abc"), for the filled Save to list buttons. */
  function marks(email) { const { R, S } = load(email), out = new Set(S.items.map(keyOf)); for (const L of R.lists) for (const i of itemsOf(L, S)) out.add(keyOf(i));
    for (const { L } of sharedWith(email)) for (const i of L.items) if (i.by && lc(i.by) === lc(email)) out.add(keyOf(i));
    return [...out].slice(0, 2000); }
  /** Set where one thing lives: `lists` is every list it should be in (own ids and "t:<token>" for friends' lists). */
  function applySheet(email, x, { lists = [], saved, newName = "", base = "" } = {}) { const it = cleanItem(x); if (!it) return { error: "That can't go on a list.", status: 400, code: "invalid" };
    const want = new Set((Array.isArray(lists) ? lists : []).map(String).slice(0, 60)); let created = null;
    // "+ New list" with a name you already have adds to that list instead of making a second one
    if (clean(newName, LIMITS.name)) { const same = load(email).R.lists.find((l) => lc(l.name) === lc(clean(newName, LIMITS.name)));
      if (same) { created = same; want.add(same.id); } else { const c = createList(email, { name: newName }); if (c.error) return c; created = c.list; want.add(c.list.id); } }
    const out = { added: [], removed: [] }, { R, S } = load(email);
    for (const L of R.lists) { const has = itemsOf(L, S).some((i) => keyOf(i) === keyOf(it));
      if (want.has(L.id) && !has) { const r = addTo(L, it); if (r.error) return r; out.added.push(L.id); }
      if (!want.has(L.id) && has) { L.items = L.items.filter((i) => keyOf(i) !== keyOf(it)); if (L.board && S.items.some((i) => i.board === L.board && keyOf(i) === keyOf(it))) H.addSave(email, { kind: it.kind, ref: it.ref, board: "" }); L.updated = clock(); out.removed.push(L.id); } }
    const lastPick = [...want].find((id) => out.added.includes(id) || id.startsWith("t:")) || (created && created.id) || ""; if (lastPick) R.last = lastPick; write(email, R);
    for (const s of sharedWith(email)) { const id = "t:" + s.L.token, has = s.L.items.some((i) => keyOf(i) === keyOf(it));
      if (want.has(id) && !has) { const r = friendAdd(s.L.token, email, it); if (!r.error) out.added.push(id); }
      if (!want.has(id) && has) { const r = friendRemove(s.L.token, email, it.kind, it.ref); if (r.removed) out.removed.push(id); } }
    if (saved !== undefined && ["event", "idea", "host"].includes(it.kind)) { if (saved) H.addSave(email, { kind: it.kind, ref: it.ref, title: it.title, img: it.img }); else H.removeSave(email, it.kind, it.ref); }
    return { ok: true, ...out, created: created ? { id: created.id, name: created.name } : null, ...sheet(email, it.kind, it.ref, base) }; }

  // ---- host library ----
  const tplPath = (id) => "hostlib/" + id;
  const PER_DATE = ["id", "date", "endDate", "dates", "dateOptions", "pollDates", "createdAt", "updatedAt", "published", "publishedAt", "discoverable", "cameChecked", "stage", "kudosAskedAt", "remindedAt", "afterSent", "metrics", "opps", "debrief", "log", "oppLog", "answers", "tasksDone", "approvals", "blocked", "pmSent", "crmSyncedAt", "actualSpend", "commits", "meetLog", "rankSnap", "earlyUntil", "autoMade", "seriesId", "prevId", "guests", "example", "sample", "fromLibrary"];
  const baseTitle = (s) => String(s || "").replace(/ \((copy|[A-Z][a-z]{2} \d{1,2})\)$/, "").trim();
  const strip = (ev) => { const c = JSON.parse(JSON.stringify(ev || {})); for (const k of PER_DATE) delete c[k]; return c; };
  const titleOf = (ev) => clean(ev?.pubTitle || ev?.name, 120) || "Untitled event";
  const coverOfEv = (ev) => IMG(ev?.coverPhoto) || "";
  function hostLibrary(ws, ownerEmail = "") { const S = scopeStore(store, ws), today = iso(clock()), evs = S.list("events").filter((d) => d.data && !d.data.example && !d.data.sample).map((d) => ({ id: d.id, ev: d.data }));
    const rs = S.list("rsvps").map((d) => d.data || {}), going = (id) => rs.filter((r) => r.eventId === id && r.response === "going" && !r.deletedAccount);
    const guestsOf = ({ id, ev }) => { const M = new Map(); for (const g of Array.isArray(ev.guests) ? ev.guests : []) if (/Attended|Going/.test(g?.status || "") && (g.email || g.name)) M.set(lc(g.email) || lc(g.name), { name: clean(g.name, 80), email: lc(g.email) });
      for (const r of going(id)) if (r.email || r.name) M.set(lc(r.email) || lc(r.name), { name: clean(r.name, 80), email: lc(r.email) }); return [...M.values()]; };
    const past = evs.filter((x) => x.ev.date && x.ev.date < today).sort((a, b) => b.ev.date.localeCompare(a.ev.date));
    const card = (x) => ({ id: x.id, title: titleOf(x.ev), date: x.ev.date || "", img: coverOfEv(x.ev), coverSpec: eventCover(x.ev, x.id), art: { activity: clean(x.ev.activity, 40), kind: clean(x.ev.coverArt?.kind, 30), tone: clean(x.ev.coverArt?.tone, 12) } });
    const seen = new Set(), once = (k) => (k && !seen.has(k) ? (seen.add(k), true) : false);
    const menus = evs.filter((x) => Array.isArray(x.ev.courses) && x.ev.courses.some((c) => clean(c, 120))).filter((x) => once("m|" + x.ev.courses.join("|"))).map((x) => ({ ...card(x), lines: x.ev.courses.map((c) => clean(c, 120)).filter(Boolean).slice(0, 6) }));
    const playlists = evs.filter((x) => PLAY_OK(x.ev.playlistUrl) && once("p|" + x.ev.playlistUrl)).map((x) => ({ ...card(x), url: x.ev.playlistUrl, host: (() => { try { return new URL(x.ev.playlistUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })() }));
    const covers = evs.filter((x) => (coverOfEv(x.ev) && once("c|" + x.ev.coverPhoto)) || (!coverOfEv(x.ev) && x.ev.coverArt?.kind && once("a|" + x.ev.coverArt.kind + (x.ev.coverArt.tone || "")))).map(card).slice(0, 24);
    // photos: only the host's own (their uploads on their events' pages, and their page's scrapbook), never a guest's
    const owners = new Set([lc(ownerEmail), lc(getWorkspace(ws)?.ownerEmail)].filter(Boolean)), photos = [];
    for (const d of S.list("moments")) { const m = d.data || {}; if (m.type && m.type !== "image") continue; if (!owners.has(lc(m.authorEmail)) || !IMG(m.url)) continue; if (once("ph|" + m.url)) photos.push({ id: "m-" + d.id, img: m.url, title: titleOf(evs.find((x) => x.id === m.eventId)?.ev), eventId: m.eventId || "" }); }
    for (const d of S.list("scrapbook")) for (const p of Array.isArray(d.data?.photos) ? d.data.photos : [d.data?.cover]) if (IMG(p) && once("ph|" + p)) photos.push({ id: "s-" + d.id + "-" + photos.length, img: p, title: clean(d.data?.title, 120) });
    const guests = past.map((x) => ({ ...card(x), people: guestsOf(x) })).filter((g) => g.people.length).map(({ people, ...g }) => ({ ...g, count: people.length, names: people.map((p) => first(p.name)).filter(Boolean).slice(0, 4) }));
    const templates = S.list("hostlib").map((d) => d.data).filter((t) => t?.kind === "template").sort((a, b) => b.at - a.at).map((t) => ({ id: t.id, title: t.name, from: t.from || "", img: IMG(t.event?.coverPhoto), art: { activity: clean(t.event?.activity, 40), kind: clean(t.event?.coverArt?.kind, 30) }, at: t.at }));
    return { past: past.slice(0, 40).map((x) => ({ ...card(x), guests: guestsOf(x).length })), templates, menus: menus.slice(0, 24), playlists: playlists.slice(0, 24), photos: photos.slice(0, 48), covers, guests: guests.slice(0, 24) }; }
  function saveTemplate(ws, eventId, name, email) { const S = scopeStore(store, ws), ev = ID_OK.test(eventId || "") ? S.get("events/" + eventId)?.data : null; if (!ev) return { error: "No such event.", status: 404, code: "not_found" };
    if (S.list("hostlib").length >= LIMITS.templates) return { error: `Up to ${LIMITS.templates} templates.`, status: 400, code: "limit" };
    const id = "t" + crypto.randomBytes(5).toString("hex"), t = { kind: "template", id, name: clean(name, LIMITS.name) || baseTitle(titleOf(ev)), from: eventId, event: strip(ev), email: lc(email), at: clock() };
    S.set(tplPath(id), t); return { template: { id, title: t.name } }; }
  function dropTemplate(ws, id) { const S = scopeStore(store, ws); if (!/^t[a-f0-9]{10}$/.test(id || "") || !S.get(tplPath(id))) return false; S.delete(tplPath(id)); return true; }
  /** "Start from this": a new draft event from a past event, a template, a menu, a playlist, a cover, a photo or a guest list. */
  function startFrom(ws, { from, id }, email = "") { const S = scopeStore(store, ws), ev = (eid) => (ID_OK.test(eid || "") ? S.get("events/" + eid)?.data : null);
    let draft = null;
    if (from === "event") { const e = ev(id); if (!e || e.example) return { error: "No such event.", status: 404, code: "not_found" }; draft = strip(e); draft.name = baseTitle(e.name || titleOf(e)); if (e.pubTitle) draft.pubTitle = baseTitle(e.pubTitle); draft.lastVis = !e.discoverable ? "link" : e.unlisted ? "page" : "discover"; }
    else if (from === "template") { const t = /^t[a-f0-9]{10}$/.test(id || "") ? S.get(tplPath(id))?.data : null; if (!t) return { error: "No such template.", status: 404, code: "not_found" }; draft = JSON.parse(JSON.stringify(t.event || {})); draft.name = draft.name || t.name; }
    else if (from === "menu") { const e = ev(id); if (!e || !Array.isArray(e.courses)) return { error: "No such menu.", status: 404, code: "not_found" }; draft = { name: "New supper", activity: e.activity || "dinner", courses: e.courses.slice(0, 12), ...(e.allergens ? { allergens: e.allergens } : {}) }; }
    else if (from === "playlist") { const e = ev(id); if (!e || !PLAY_OK(e.playlistUrl)) return { error: "No such playlist.", status: 404, code: "not_found" }; draft = { name: "New event", playlistUrl: e.playlistUrl }; }
    else if (from === "cover") { const e = ev(id); if (!e) return { error: "No such cover.", status: 404, code: "not_found" }; draft = { name: "New event", ...(coverOfEv(e) ? { coverPhoto: e.coverPhoto } : {}), ...(e.coverArt ? { coverArt: e.coverArt } : {}), ...(e.look ? { look: e.look } : {}), activity: e.activity || "" }; }
    else if (from === "photo") { const L = hostLibrary(ws, email).photos, p = L.find((x) => x.id === id); if (!p) return { error: "No such photo.", status: 404, code: "not_found" }; draft = { name: "New event", coverPhoto: p.img }; }
    else if (from === "guests") { const e = ev(id); if (!e) return { error: "No such guest list.", status: 404, code: "not_found" }; const g = hostLibrary(ws, email).guests.find((x) => x.id === id); if (!g) return { error: "No guests on that one yet.", status: 404, code: "not_found" };
      const M = new Map(); for (const x of Array.isArray(e.guests) ? e.guests : []) if (/Attended|Going/.test(x?.status || "")) M.set(lc(x.email) || lc(x.name), x);
      for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId === id && r.response === "going" && !r.deletedAccount && (r.email || r.name)) { const k = lc(r.email) || lc(r.name); if (!M.has(k)) M.set(k, { name: clean(r.name, 80), email: lc(r.email) }); } }
      draft = { name: "New event", activity: e.activity || "", guests: [...M.values()].slice(0, 500).map((x) => ({ name: clean(x.name, 80), title: clean(x.title, 80), company: clean(x.company, 80), email: lc(x.email), tier: x.tier || "B", status: "Not invited", outcome: "None yet", value: 0, source: `Came to ${baseTitle(titleOf(e))}` })) }; }
    else return { error: "Pick something to start from.", status: 400, code: "invalid" };
    let nid = randomId(); while (!claimEvent(nid, ws)) nid = randomId();
    const doc = { ...draft, id: nid, date: "", published: false, createdAt: clock(), updatedAt: clock(), fromLibrary: { from, id } };
    if (from === "guests" || from === "event") { /* keeps its own guests choice above */ } else delete doc.guests;
    if (from === "event") doc.guests = [];
    S.set("events/" + nid, doc); return { id: nid, open: "/?app=1&open=" + encodeURIComponent(nid) + "#studio" }; }

  // ---- visibility (server/curation.js): what a list shows to anyone but its owner, and the curator's notes ----
  /** A list's items as a public page would show them (never a private or link-only event), newest first, with when each was added. */
  function publicItems(owner, L, base = "") { const S = H.savesRaw(owner);
    return itemsOf(L, S).map((i) => { const h = hydrate(base, i, { pub: true }); return h ? { ...h, at: i.at || L.at || 0, why: L.notes?.[keyOf(i)] || "" } : null; }).filter(Boolean); }
  /** The curator's one line on why something is on the list (empty takes it off). */
  function setNote(email, id, kind, ref, why) { const { R, S } = load(email), L = R.lists.find((x) => x.id === id); if (!L) return { error: "No such list.", status: 404, code: "not_found" };
    const k = kind + ":" + ref; if (!itemsOf(L, S).some((i) => keyOf(i) === k)) return { error: "That isn't on this list.", status: 404, code: "not_found" };
    const t = clean(why, 120); L.notes = { ...(L.notes || {}) }; if (t) L.notes[k] = t; else delete L.notes[k]; write(email, R); return { ok: true, why: t }; }
  // ---- end visibility ----
  return { publicItems, marks, setNote, coverOf, typeOf, raw, load, library, openList, createList, updateList, deleteList, addItem, removeItem, pin, sheet, applySheet, byToken, publicView, friendAdd, friendRemove, sharedWith, smartItems, hostLibrary, saveTemplate, dropTemplate, startFrom, tKey };
}

export function mountLibrary(app, { store, currentUser, publicOrigin, C, X, sendStatic, express }) {
  const H = app.locals.hooks, Dir = app.locals.directory, F = app.locals.fanclub;
  if (!H || !Dir) return null;
  const L = makeLibrary({ store, H, Dir, F, X, C, G: () => app.locals.curation }); app.locals.library = L; // G: visibility (server/curation.js)
  const base = (req) => String(publicOrigin(req) || "").replace(/\/+$/, "");
  const json = express.json({ limit: "32kb" });
  const hits = new Map(); const limited = (key, n) => { const now = Date.now(); let h = hits.get(key); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(key, h); if (hits.size > 20000) hits.clear(); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Make a free account to keep lists." }); return null; } res.set("Cache-Control", "private, no-store"); return u; };
  const slow = (res) => res.status(429).json({ code: "rate_limited", message: "That's a lot for one hour. Try again in a bit." });
  const send = (res, r) => (r?.error ? res.status(r.status || 400).json({ code: r.code || "invalid", message: r.error, ...(r.by !== undefined ? { by: r.by } : {}) }) : res.json(r));
  // a host: someone with an event of their own (every account has a handle, so a page alone says nothing)
  const hosting = (ws) => scopeStore(store, ws).list("events").some((d) => d.data && !d.data.example && !d.data.sample && !d.data.demo);
  const hostOf = (req, res) => { const u = me(req, res); if (!u) return null; if (!hosting(u.ws)) { res.status(403).json({ code: "not_host", message: "Host something first, and it lands here." }); return null; } return u; };

  for (const p of ["/library", "/library/host"]) app.get(p, (req, res) => sendStatic(res, "library.html", "<p>Library missing.</p>"));
  app.get("/l/:token", (req, res) => sendStatic(res, "library.html", "<p>Library missing.</p>"));

  app.get("/api/me/library", (req, res) => { const u = me(req, res); if (!u) return; const r = L.library(base(req), u.email); r.isHost = hosting(u.ws); res.json(r); });
  app.get("/api/me/library/lists/:id", (req, res) => { const u = me(req, res); if (!u) return; const r = L.openList(base(req), u.email, String(req.params.id)); return r ? res.json(r) : res.status(404).json({ code: "not_found", message: "No such list." }); });
  app.post("/api/me/library/lists", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited("create|" + u.email, LIMITS.createPerHour)) return slow(res); send(res, L.createList(u.email, req.body || {})); });
  app.post("/api/me/library/lists/:id", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited("edit|" + u.email, 300)) return slow(res); const r = L.updateList(u.email, String(req.params.id), req.body || {}); if (r.list) r.list = { ...r.list, link: r.list.token ? "/l/" + r.list.token : "", items: undefined }; send(res, r); });
  app.delete("/api/me/library/lists/:id", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: L.deleteList(u.email, String(req.params.id)) }); });
  app.post("/api/me/library/lists/:id/items", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited("add|" + u.email, LIMITS.addsPerHour)) return slow(res); send(res, L.addItem(u.email, String(req.params.id), req.body || {})); });
  app.delete("/api/me/library/lists/:id/items", (req, res) => { const u = me(req, res); if (!u) return; send(res, L.removeItem(u.email, String(req.params.id), lc(req.query.kind), String(req.query.ref || ""))); });
  app.post("/api/me/library/pins", json, (req, res) => { const u = me(req, res); if (!u) return; send(res, L.pin(u.email, String(req.body?.key || ""), req.body?.on !== false)); });
  // the save-to-list sheet, and what's on your lists already (a Save to list button shows filled for those)
  app.get("/api/me/library/marks", (req, res) => { const u = me(req, res); if (!u) return; res.json({ keys: L.marks(u.email) }); });
  app.get("/api/me/library/sheet", (req, res) => { const u = me(req, res); if (!u) return; res.json(L.sheet(u.email, lc(req.query.kind), String(req.query.ref || ""), base(req))); });
  app.post("/api/me/library/sheet", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited("add|" + u.email, LIMITS.addsPerHour)) return slow(res); const b = req.body || {};
    if (b.newName && limited("create|" + u.email, LIMITS.createPerHour)) return slow(res);
    send(res, L.applySheet(u.email, b.item || {}, { lists: b.lists, saved: typeof b.saved === "boolean" ? b.saved : undefined, newName: b.newName || "", base: base(req) })); });
  // shared lists
  app.get("/api/public/lists/:token", (req, res) => { if (limited("read|" + (req.ip || "?"), 1200)) return slow(res); res.set("Cache-Control", "private, no-store"); res.set("X-Robots-Tag", "noindex");
    const u = currentUser(req); send(res, L.publicView(base(req), String(req.params.token), u && u.ws !== DEFAULT_WS ? u.email : "")); });
  app.post("/api/public/lists/:token/items", json, (req, res) => { const u = me(req, res); if (!u) return; if (limited("fadd|" + u.email, LIMITS.friendAddsPerHour)) return slow(res); send(res, L.friendAdd(String(req.params.token), u.email, req.body || {})); });
  app.delete("/api/public/lists/:token/items", (req, res) => { const u = me(req, res); if (!u) return; send(res, L.friendRemove(String(req.params.token), u.email, lc(req.query.kind), String(req.query.ref || ""))); });
  // the host library
  app.get("/api/host/library", (req, res) => { const u = hostOf(req, res); if (!u) return; res.json(L.hostLibrary(u.ws, u.email)); });
  app.post("/api/host/library/templates", json, (req, res) => { const u = hostOf(req, res); if (!u) return; if (limited("tpl|" + u.email, 60)) return slow(res); send(res, L.saveTemplate(u.ws, String(req.body?.eventId || ""), req.body?.name, u.email)); });
  app.delete("/api/host/library/templates/:id", (req, res) => { const u = hostOf(req, res); if (!u) return; res.json({ ok: L.dropTemplate(u.ws, String(req.params.id)) }); });
  app.post("/api/host/library/start", json, (req, res) => { const u = hostOf(req, res); if (!u) return; if (limited("start|" + u.email, 60)) return slow(res); send(res, L.startFrom(u.ws, { from: String(req.body?.from || ""), id: String(req.body?.id || "") }, u.email)); });
  return L;
}
