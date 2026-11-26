// Episode numbers for a series (review round 13). Events that repeat, or carry the same name by the same host, are one
// series, and each date in it is an episode: "Hack night #14", counted from the dates before it (plus `episodeBase`, the
// host's own count of episodes before they used Pottery Lab). Pure reads of the host's events, cached per workspace and
// dropped whenever an event changes. Imported by community.js (cards), the directory and server/series.js.
import { scopeStore, workspaceOfEvent } from "./workspaces.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/, ID = /^[A-Za-z0-9_-]{2,80}$/;
const clean = (v, n = 120) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
/** A title without its episode marker: "Hack Night #13" and "hack night ep. 14" are both "hack night". Pure. */
export const baseTitle = (t) => clean(t).replace(/\s*[-–:·]?\s*(?:#|no\.?\s*|ep\.?\s*|episode\s+|vol\.?\s*)\d{1,4}\s*$/i, "").trim();
export const seriesKey = (t) => baseTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const counted = (e) => !!e && !e.example && !e.sample && !e.cancelled && e.stage !== "interest" && ISO.test(e.date || "");

/** Every episode in one host's events: Map(id -> { root, n, total, title, ids }). Pure over the list given. */
export function episodeMap(list) {
  const E = list.filter((d) => d && ID.test(d.id || "") && counted(d.data)), parent = new Map(), find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const join = (a, b) => { for (const k of [a, b]) if (!parent.has(k)) parent.set(k, k); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const d of E) { const ev = d.data, k = seriesKey(ev.pubTitle || ev.name); join("e:" + d.id, "r:" + (ID.test(ev.seriesId || "") ? ev.seriesId : d.id)); if (k.length >= 3) join("e:" + d.id, "t:" + k); }
  const groups = new Map(); for (const d of E) { const g = find("e:" + d.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
  const out = new Map();
  for (const G of groups.values()) {
    if (G.length < 2 && !G[0].data.repeat) continue;
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
/** The episode map for one workspace, cached until any event changes. */
export function episodesOf(store, ws) {
  const C = cacheOf(store); let M = C.get(ws); if (M) return M;
  M = episodeMap(scopeStore(store, ws).list("events")); if (C.size > 2000) C.clear(); C.set(ws, M); return M;
}
/** One event's episode: { n, total, title, root, ids, label: "Hack night #14" } or null. */
export function episodeOf(store, id, ws = null) {
  if (!ID.test(String(id || ""))) return null; const w = ws || workspaceOfEvent(String(id)); if (!w) return null;
  const x = episodesOf(store, w).get(String(id)); return x ? { ...x, label: `${x.title} #${x.n}` } : null;
}
/** Just the number, for cards and the directory. */
export const episodeNumber = (store, id, ws = null) => episodeOf(store, id, ws)?.n ?? null;
