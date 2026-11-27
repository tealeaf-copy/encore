// ---- Lists in the feed: "Maya made a list" and "Maya added Dumpling Night and 2 more to Weekend ideas" ----
// Cards for server/feedblend.js (a small hook there adds the "list" pool and lets cardOf answer "l:" targets, so kudos
// and comments work on them like any card). Drawn by public/listcards.js.
// Who sees a card: the owner's friends for a Friends list; followers of the curator or the list, and friends, for a
// Public list (server/curation.js feedLists, which applies blocks both ways and step-outs). Never the owner.
// What a card shows: public items only (server/library.js publicItems), first names only.
// Batching (batchCards): at most one card per list per day, and only the newest per list in the stream.
//   made   once the list is shared with this viewer and has 3 or more public things (the same day's adds join it)
//   added  a later day with 2 or more new public things
// Cards older than LIST_WINDOW_DAYS days are dropped.
const DAY = 864e5;
export const LIST_WINDOW_DAYS = 14, LIST_CARDS_MAX = 4;
const dayNum = (t) => Math.floor((+t || 0) / DAY);
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";

/** The cards one list makes for one viewer. items: its public items, each with `at`; from: when it reached them. */
export function batchCards(items, { from = 0, now = Date.now(), windowDays = LIST_WINDOW_DAYS } = {}) {
  const asc = (items || []).filter((i) => i && i.at).slice().sort((a, b) => a.at - b.at); if (asc.length < 3) return [];
  const A = Math.max(+from || 0, asc[2].at), aDay = dayNum(A), cards = [{ type: "made", day: aDay, at: A, items: asc.filter((i) => dayNum(i.at) <= aDay) }];
  const later = new Map(); for (const i of asc) { const d = dayNum(i.at); if (d <= aDay) continue; if (!later.has(d)) later.set(d, []); later.get(d).push(i); }
  for (const [d, L] of later) if (L.length >= 2) cards.push({ type: "added", day: d, at: Math.max(...L.map((i) => i.at)), items: L });
  return cards.filter((c) => c.at >= now - windowDays * DAY).sort((a, b) => a.day - b.day); }

/** "Dumpling Night", "Dumpling Night and Sunday Pasta", "Dumpling Night and 3 more" */
export const namesLine = (L) => { const t = L.map((i) => i.title || "something"); return t.length <= 1 ? t[0] || "" : t.length === 2 ? `${t[0]} and ${t[1]}` : `${t[0]} and ${t.length - 1} more`; };

export function makeListFeed({ CU, L }) {
  const cover = (i) => ({ kind: i.kind, ref: i.ref, title: i.title, img: i.img, art: i.art, emoji: i.emoji, url: i.url || "" });
  function build(v, x, c, items, { kudosOf = () => null, commentsOf = () => null } = {}) { const lk = CU.listKey(x.owner, x.L.id), target = `l:${lk}-${c.day}`, p = CU.person(x.owner), name = first(p.name) || "Someone", F = CU.fansDoc(x.owner, x.L.id);
    const shown = (c.type === "made" ? items : c.items.slice().sort((a, b) => b.at - a.at)).slice(0, 4).map(cover);
    return { kind: "list", key: target, type: c.type, at: c.at,
      by: { name, handle: p.handle || "", emoji: p.emoji || "", color: p.color || "", url: p.handle && x.mode === "public" ? `/@${p.handle}/lists` : "" },
      list: { name: x.L.name, token: x.L.token, url: "/l/" + x.L.token, count: items.length, mode: x.mode, canFollow: x.mode === "public", following: F.fans.some((f) => f.email === v.email), saved: F.saves.some((f) => f.email === v.email) },
      text: c.type === "made" ? `${name} made a list` : `${name} added ${namesLine(c.items.slice().sort((a, b) => b.at - a.at))} to ${x.L.name}`, items: shown, added: c.type === "added" ? c.items.length : 0,
      share: { url: "/l/" + x.L.token, title: x.L.name }, kudos: kudosOf(target), comments: commentsOf(target) }; }
  /** Every card this viewer may see now: the newest per list, newest first. */
  function all(v, now) { const out = [];
    for (const x of CU.feedLists(v.email)) { const items = CU.publicItems(x.owner, x.L), cs = batchCards(items, { from: x.from, now }); if (cs.length) out.push({ x, c: cs[cs.length - 1], cards: cs, items }); }
    return out.sort((a, b) => b.c.at - a.c.at); }
  function cards(v, { now = Date.now(), kudosOf, commentsOf } = {}) { if (!v?.email) return [];
    return all(v, now).filter(({ x }) => !v.blocks?.has?.("person:" + Buffer.from(x.owner).toString("base64url"))).slice(0, LIST_CARDS_MAX).map(({ x, c, items }) => build(v, x, c, items, { kudosOf, commentsOf })); }
  /** For feedblend cardOf: the list card a target names, when this viewer may see it now. */
  function cardOf(target, v) { const m = /^l:([a-f0-9]{24})-(\d{3,7})$/.exec(String(target || "")); if (!m || !v?.email) return null;
    for (const { x, cards: cs } of all(v, Date.now())) { if (CU.listKey(x.owner, x.L.id) !== m[1]) continue; if (!cs.some((c) => String(c.day) === m[2])) return null;
      const p = CU.person(x.owner); return { target: String(target), kind: "list", ws: p.ws || "", owner: x.owner, title: x.L.name }; }
    return null; }
  return { cards, cardOf, batchCards };
}
// ---- end lists in the feed ----
