// Episode numbers for a series (review round 13; who joins and who counts, round 14). Events that repeat are one series,
// and each date in it is an episode: "Hack night #14", counted from the dates before it (plus `episodeBase`, the
// host's own count of episodes before they used Pottery Lab). Pure reads of the host's events, cached per workspace and
// dropped whenever an event changes. Imported by community.js (cards), the directory and server/series.js.
import { scopeStore, workspaceOfEvent } from "./workspaces.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const clean = (v, n = 120) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
/** A title without its episode marker: "Hack Night #13" and "hack night ep. 14" are both "hack night". Pure. */
export const baseTitle = (t) => clean(t).replace(/\s*[-–:·]?\s*(?:#|no\.?\s*|ep\.?\s*|episode\s+|vol\.?\s*)\d{1,4}\s*$/i, "").trim();
export const seriesKey = (t) => baseTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const counted = (e) => !!e && !e.example && !e.sample && !e.cancelled && e.stage !== "interest" && ISO.test(e.date || "");
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
/** Seen by strangers: published (or listed) and not private. Only these number a series in public. Pure. */
export const publicEpisode = (e) => !!e && !closed(e) && !!(e.published || e.discoverable);
// Titles too generic to make a series on their own: "Dinner" in July and "Dinner" in December are two dinners. They join
// by title only when the host says the event repeats, or answers "Is this a series?" with Yes.
export const GENERIC_TITLES = new Set(["dinner", "dinner party", "party", "birthday", "birthday party", "potluck", "drinks", "brunch", "lunch", "hangout", "hang out", "game night", "picnic", "bbq"]);
const GAP_DAYS = 45, dayNo = (d) => Math.round(Date.parse(d + "T12:00:00Z") / 864e5);

/**
 * Every episode in one host's events: Map(id -> { root, n, total, title, ids }). Pure over the list given.
 * - `seriesId` and `prevId` (server/repeats.js) always join.
 * - The same title joins when one of those dates repeats, is in such a chain or is marked a series, or when 3+ dated
 *   events share it with no gap over 45 days. A generic title ("Dinner", "Birthday party") joins only on repeat or Yes.
 * - `series: false` keeps an event out of any series; `series: true` puts it in the one its title names.
 * - By default only published, non-private events count: a private or draft date never sets the title, a number or the
 *   total. `{ host: true }` is the host's own view, with every date.
 */
export function episodeMap(list, { host = false } = {}) {
  const E = list.filter((d) => d && ID.test(d.id || "") && counted(d.data) && d.data.series !== false && (host || publicEpisode(d.data)));
  const parent = new Map(), find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const join = (a, b) => { for (const k of [a, b]) if (!parent.has(k)) parent.set(k, k); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const have = new Set(E.map((d) => d.id)), linked = new Set(), buckets = new Map();
  for (const d of E) { const ev = d.data; join("e:" + d.id, "e:" + d.id);
    if (ID.test(ev.seriesId || "")) { join("e:" + d.id, "r:" + ev.seriesId); if (have.has(ev.seriesId)) join("e:" + d.id, "e:" + ev.seriesId); linked.add(d.id); linked.add(ev.seriesId); }
    if (ID.test(ev.prevId || "") && have.has(ev.prevId)) { join("e:" + d.id, "e:" + ev.prevId); linked.add(d.id); linked.add(ev.prevId); }
    const k = seriesKey(ev.pubTitle || ev.name); if (k.length >= 3) { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(d); } }
  for (const [k, B] of buckets) {
    if (B.length < 2) continue; const generic = GENERIC_TITLES.has(k), says = B.some((d) => !!d.data.repeat || d.data.series === true);
    if (says || (!generic && B.some((d) => linked.has(d.id)))) { for (const d of B) join("e:" + B[0].id, "e:" + d.id); continue; }
    if (generic) continue;
    const R = [...B].sort((a, b) => a.data.date.localeCompare(b.data.date)); let run = [R[0]];
    const close = () => { if (run.length >= 3) for (const d of run) join("e:" + run[0].id, "e:" + d.id); };
    for (let i = 1; i < R.length; i++) { if (dayNo(R[i].data.date) - dayNo(R[i - 1].data.date) <= GAP_DAYS) run.push(R[i]); else { close(); run = [R[i]]; } }
    close();
  }
  const groups = new Map(); for (const d of E) { const g = find("e:" + d.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
  const out = new Map();
  for (const G of groups.values()) {
    if (G.length < 2 && !G[0].data.repeat && G[0].data.series !== true) continue;
    G.sort((a, b) => a.data.date.localeCompare(b.data.date) || (a.data.createdAt || 0) - (b.data.createdAt || 0) || a.id.localeCompare(b.id));
    const first = G[0], base = Math.max(0, Math.min(5000, Math.floor(+G.map((d) => d.data.episodeBase).find((x) => +x > 0) || 0)));
    const latest = G[G.length - 1].data, title = baseTitle(latest.pubTitle || latest.name) || "Episode", ids = G.map((d) => d.id);
    G.forEach((d, i) => out.set(d.id, { root: first.id, n: base + i + 1, total: base + G.length, title, ids }));
  }
  return out;
}

const caches = new WeakMap();
function cacheOf(store) {
  let C = caches.get(store); if (C) return C; C = new Map(); caches.set(store, C);
  store.events?.on?.("change", (e) => { if (/(^|\/)events\//.test(String(e?.path || ""))) C.clear(); });
  return C;
}
/** The episode map for one workspace, cached until any event changes. Public numbering unless `{ host: true }`. */
export function episodesOf(store, ws, { host = false } = {}) {
  const C = cacheOf(store), key = (host ? "h:" : "p:") + ws; let M = C.get(key); if (M) return M;
  M = episodeMap(scopeStore(store, ws).list("events"), { host }); if (C.size > 2000) C.clear(); C.set(key, M); return M;
}
/** One event's episode: { n, total, title, root, ids, label: "Hack night #14" } or null (a private or draft date has none in public). */
export function episodeOf(store, id, ws = null, { host = false } = {}) {
  if (!ID.test(String(id || ""))) return null; const w = ws || workspaceOfEvent(String(id)); if (!w) return null;
  const x = episodesOf(store, w, { host }).get(String(id)); return x ? { ...x, label: `${x.title} #${x.n}` } : null;
}
/** Just the number, for cards and the directory. */
export const episodeNumber = (store, id, ws = null) => episodeOf(store, id, ws)?.n ?? null;
