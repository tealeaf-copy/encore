// Series as a changelog (review round 13, for the people who run the same night every week).
//
// - GET /api/public/episode/:id: "Hack night #14" for one event (server/episodes.js), for /g and the light invite.
// - GET /api/public/episodes?ids=a,b: numbers for cards, only for events strangers may see.
// - GET /api/public/host/:handle/series: the host page's changelog. One entry per past episode that is on the page
//   (open events; link-only and Ask to join ones are left out, never their place or who came): the date, the number,
//   how many came (a count, never names; none on a hidden-guests event), what the host noted (demos, games played) and
//   what the lineup kept (demo titles, the poll's winner, the bracket's champion; server/slots.js), and a strip of
//   photos from moments when the event shows its photos on the page. Plus how many hosts forked it (server/hostlike.js
//   records, every episode of the series together, never the source host).
// - POST /api/host/series/:id/notes: the host's notes for one episode ({ demos, games, note }), cleaned here.
import { scopeStore, workspaceOfEvent } from "./workspaces.js";
import { episodeOf, episodesOf } from "./episodes.js";
import { cameTo } from "./tables.js";
import { momentsOnPage } from "./feedvisual.js";

const ID = /^[A-Za-z0-9_-]{2,80}$/, ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v, n = 120) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const closed = (e) => !!e && (e.private === true || e.friendsOnly === true || e.visibility === "private" || e.visibility === "friends");
const hiddenNames = (ev) => !!(ev?.hideGuests || ev?.noWall || ev?.discreet || ev?.chatham);
/** Shown to strangers on the host page: an open, listed-on-the-page event. */
export const onPage = (e) => !!e && !e.example && !e.sample && !e.cancelled && !!e.discoverable && !closed(e) && !e.approvalRequired;
const MEDIA_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[a-z0-9-]{1,60}\.(jpg|webp|png)$/.test(u || "");
const list = (v, n = 8, len = 80) => (Array.isArray(v) ? v : String(v || "").split(/\n|,/)).map((x) => clean(x, len)).filter(Boolean).slice(0, n);
/** The host's notes for one episode, cleaned. Pure. */
export const notesOf = (e) => { const N = e?.changelog && typeof e.changelog === "object" ? e.changelog : {}; return { demos: list(N.demos), games: list(N.games), note: clean(N.note, 200) }; };

/** Hosts who shared a draft they forked from any of these events (never the source host). */
export function forkCount(store, ids, srcWs) {
  const seen = new Set();
  for (const id of ids) { const R = store.get("system/hostlike-" + id)?.data; for (const s of R?.starts || []) { if (!s?.ws || s.ws === srcWs || seen.has(s.ws) || !ID.test(String(s.id || ""))) continue;
    try { const e = scopeStore(store, s.ws).get("events/" + s.id)?.data; if (e && !e.example && !e.cancelled && (e.published || e.discoverable)) seen.add(s.ws); } catch {} } }
  return seen.size;
}

export function mountSeries(app, { store, small, C, ownerOnly }) {
  const hits = new Map(), limited = (req, n = 240) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); if (hits.size > 20000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const today = () => new Date().toISOString().slice(0, 10);

  app.get("/api/public/episode/:id", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const id = clean(req.params.id, 80); if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found");
    const ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null; if (!ev || ev.example) return bad(res, "No such event.", 404, "not_found");
    const x = episodeOf(store, id, ws); res.set("Cache-Control", "public, max-age=60");
    if (!x) return res.json({ episode: null });
    const h = C.profileOf?.(ws), pub = onPage(ev);
    res.json({ episode: x.n, label: x.label, series: x.title, of: x.total, ...(pub && h?.handle ? { changelog: `/@${h.handle}#series-${x.root}` } : {}) }); });

  app.get("/api/public/episodes", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const out = {};
    for (const id of String(req.query.ids || "").split(",").filter((x) => ID.test(x)).slice(0, 60)) { const ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null;
      if (!ev || closed(ev) || ev.example || !(ev.discoverable || ev.published)) continue; const x = episodeOf(store, id, ws); if (x) out[id] = x.n; }
    res.set("Cache-Control", "public, max-age=60").json({ episodes: out }); });

  /** The changelog for one host: every series with at least one episode on the page. */
  function changelog(ws) {
    const S = scopeStore(store, ws), M = episodesOf(store, ws), t = today(), by = new Map(), moments = S.list("moments").filter((d) => d.data && !d.data.hidden && d.data.type !== "video" && MEDIA_OK(d.data.url));
    for (const [id, x] of M) { if (!by.has(x.root)) by.set(x.root, x); }
    const out = [];
    for (const x of by.values()) {
      const eps = x.ids.map((id) => ({ id, e: S.get("events/" + id)?.data })).filter((o) => o.e && onPage(o.e)), n = (id) => M.get(id)?.n;
      const past = eps.filter((o) => o.e.date < t).sort((a, b) => b.e.date.localeCompare(a.e.date)), next = eps.filter((o) => o.e.date >= t).sort((a, b) => a.e.date.localeCompare(b.e.date))[0];
      if (!past.length && !next) continue;
      const entries = past.slice(0, 24).map(({ id, e }) => { const N = notesOf(e), L = S.get("lineup/" + id)?.data || null, cfg = e.lineup && typeof e.lineup === "object" ? e.lineup : null;
        const demos = N.demos.length ? N.demos : cfg?.kind === "demos" && L ? (L.demos || []).map((d) => clean(d.title, 80)).filter(Boolean).slice(0, 8) : [];
        let games = N.games; if (!games.length && cfg?.kind === "poll" && L?.votes) { const opts = list(cfg.options, 8, 40), tally = opts.map((o, i) => [o, Object.values(L.votes).filter((v) => v === i).length]).sort((a, b) => b[1] - a[1]); if (tally[0]?.[1]) games = [tally[0][0]]; }
        const champ = cfg?.kind === "bracket" && L?.champion && !hiddenNames(e) ? clean(S.get("rsvps/" + L.champion)?.data?.name, 60).split(" ")[0] : "";
        const photos = momentsOnPage(e) ? moments.filter((m) => m.data.eventId === id).sort((a, b) => (a.data.at || 0) - (b.data.at || 0)).slice(0, 6).map((m) => m.data.url) : [];
        return { id, n: n(id), date: e.date, came: hiddenNames(e) ? null : cameTo(S, id, e).length || null, demos, games, ...(champ ? { champion: champ } : {}), note: N.note, photos, url: `/e/${encodeURIComponent(id)}` }; });
      out.push({ root: x.root, title: x.title, episodes: x.total, entries, next: next ? { id: next.id, n: n(next.id), date: next.e.date, startTime: /^\d{2}:\d{2}$/.test(next.e.startTime || "") ? next.e.startTime : "", url: `/e/${encodeURIComponent(next.id)}` } : null,
        forks: forkCount(store, x.ids, ws), forkFrom: (past[0] || next).id });
    }
    return out.sort((a, b) => (b.entries[0]?.date || b.next?.date || "").localeCompare(a.entries[0]?.date || a.next?.date || ""));
  }
  app.get("/api/public/host/:handle/series", (req, res) => { if (limited(req)) return bad(res, "Slow down.", 429, "rate_limited"); const ws = C.wsOfHandle?.(String(req.params.handle || "").toLowerCase()); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    res.set("Cache-Control", "public, max-age=60").json({ series: changelog(ws) }); });

  app.post("/api/host/series/:id/notes", small, (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.params.id, 80), S = scopeStore(store, u.ws), ev = ID.test(id) ? S.get("events/" + id)?.data : null; if (!ev) return bad(res, "No such event.", 404, "not_found");
    const b = req.body || {}, N = notesOf({ changelog: { demos: b.demos, games: b.games, note: b.note } }), base = b.episodeBase != null ? Math.max(0, Math.min(5000, Math.floor(+b.episodeBase) || 0)) : null;
    S.update("events/" + id, { changelog: N, ...(base != null ? { episodeBase: base } : {}) }); res.json({ ok: true, notes: N, episode: episodeOf(store, id, u.ws, { host: true }) }); });
  app.get("/api/host/series/:id", (req, res) => { const u = ownerOnly(req, res); if (!u) return; const id = clean(req.params.id, 80), ev = ID.test(id) ? scopeStore(store, u.ws).get("events/" + id)?.data : null; if (!ev) return bad(res, "No such event.", 404, "not_found");
    res.set("Cache-Control", "private, no-store").json({ notes: notesOf(ev), episodeBase: +ev.episodeBase || 0, episode: episodeOf(store, id, u.ws, { host: true }) }); });
  app.locals.series = { changelog };
}
