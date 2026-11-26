// Your stats: a calm card of what you've actually done, for guests and hosts. Guests: events gone to, hosts followed,
// neighbourhoods explored, "would go again" given, a gentle monthly streak, favourite kinds of events, fan clubs. Hosts:
// events hosted, guests welcomed, regulars, would-go-again, a hosting streak. Every number comes from real activity
// (server/social.js index and hostStrengths, server/fanclub.js); a zero is left out, never shown as a zero.
//
// Private by default. Nothing here is on your public page (/@handle) until you pick it, one stat at a time, in your
// stats (/me). The public read (GET /api/public/host/:handle/stats) returns only what the page's owner picked.
//
// "How was it?": a soft check-in for events you went to in the last 10 days and haven't left kudos for. It doesn't
// collect anything itself: it opens the kudos page (public/kudos.html, /k/<event>) with your own reply's proof.
import crypto from "node:crypto";
import { streakOf, rhythmOf, shareLine } from "./recognition.js";
import { interestsOf, INTERESTS } from "./hooks.js";
import { scopeStore, getWorkspace, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailVerified } from "./verify.js";

const DAY = 864e5;
const lc = (s) => String(s || "").trim().toLowerCase();
const hash = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const plural = (n, one, many) => (n === 1 ? one : many);

export const GUEST_KEYS = ["events", "hosts", "places", "again", "streak", "kinds", "clubs"];
export const HOST_KEYS = ["hosted", "welcomed", "regulars", "againPct", "hostStreak"];
export const ALL_KEYS = [...GUEST_KEYS, ...HOST_KEYS];

/**
 * A guest's stats. Pure.
 *   went: [{ eventId, date, title, activity, city, hood }] events they said I'm in to (any date)
 *   following: hosts followed (count or list), clubs: [{ club, host }], given: kudos they left [{ tags, compare }]
 */
export function guestStats({ went = [], following = 0, clubs = [], given = [], now = Date.now() } = {}) {
  const today = iso(now), past = went.filter((a) => ISO.test(a.date || "") && a.date <= today);
  const ids = new Set(), P = []; for (const a of past) if (!ids.has(a.eventId)) { ids.add(a.eventId); P.push(a); }
  const places = [...new Map(P.map((a) => [lc(a.hood || a.city), String(a.hood || a.city || "").trim()]).filter(([k]) => k)).values()];
  const again = given.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length;
  const streak = streakOf(P.map((a) => a.date), today, "month");
  const kindN = new Map(); for (const a of P) for (const t of interestsOf(`${a.title || ""} ${a.activity || ""}`, a.format || "")) kindN.set(t, (kindN.get(t) || 0) + 1);
  const kinds = [...kindN].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => INTERESTS.find((i) => i.id === t)?.label).filter(Boolean);
  const nFollow = Array.isArray(following) ? following.length : +following || 0;
  const out = [];
  if (P.length) out.push({ key: "events", icon: "table", n: P.length, label: plural(P.length, "event gone to", "events gone to") });
  if (nFollow) out.push({ key: "hosts", icon: "follow", n: nFollow, label: plural(nFollow, "host followed", "hosts followed") });
  if (places.length) out.push({ key: "places", icon: "map", n: places.length, label: plural(places.length, "neighbourhood explored", "neighbourhoods explored"), detail: places.slice(0, 3).join(", ") });
  if (again) out.push({ key: "again", icon: "again", n: again, label: `"would go again" given` });
  // a streak starts to mean something at two months; one month is just a good month
  if (streak >= 2) out.push({ key: "streak", icon: "streak", n: streak, label: "months in a row", line: `${streak} months in a row out with your people` });
  if (kinds.length) out.push({ key: "kinds", icon: "kinds", value: kinds.join(", "), label: kinds.length === 1 ? "your favourite kind of event" : "your favourite kinds of events" });
  if (clubs.length) out.push({ key: "clubs", icon: "club", n: clubs.length, label: plural(clubs.length, "fan club", "fan clubs"), detail: clubs.slice(0, 3).map((c) => c.club || c.host).filter(Boolean).join(", ") });
  return out;
}

/** A host's stats, from hostStrengths (server/social.js). Pure. */
export function hostStats(S = {}, { now = Date.now(), repeats = [] } = {}) {
  const today = iso(now), dates = (S.dates || []).filter((d) => ISO.test(d) && d <= today), out = [];
  const unit = rhythmOf(dates, repeats), streak = streakOf(dates, today, unit);
  if (dates.length) out.push({ key: "hosted", icon: "pot", n: dates.length, label: plural(dates.length, "event hosted", "events hosted") });
  if (S.guests) out.push({ key: "welcomed", icon: "door", n: S.guests, label: plural(S.guests, "guest welcomed", "guests welcomed") });
  if (S.returning) out.push({ key: "regulars", icon: "regulars", n: S.returning, label: plural(S.returning, "regular", "regulars"), detail: "came back for another" });
  // the same rule brands see (server/recognition.js shareLine): a percentage from 10 answers up, counts below that
  const again = shareLine(S.againYes, S.againOf, S.againOf === 1 ? "guest" : "guests", "would go again");
  if (again) out.push({ key: "againPct", icon: "again", n: again.pct != null ? again.pct : again.n, pct: again.pct != null, of: again.of, label: again.pct != null ? "would go again" : `of ${again.of} would go again`, line: again.text });
  if (streak >= 2) out.push({ key: "hostStreak", icon: "streak", n: streak, label: unit === "month" ? "months in a row hosting" : "weeks in a row hosting", line: unit === "month" ? `Hosted ${streak} months in a row` : `Hosted ${streak} weeks in a row` });
  return out;
}

/** Only the stats the person picked to show, and only ones that aren't zero. Pure. */
export const publicOnly = (stats = [], show = []) => { const S = new Set(show); return stats.filter((s) => S.has(s.key)); };
export const cleanShow = (L) => [...new Set((Array.isArray(L) ? L : []).map(String).filter((k) => ALL_KEYS.includes(k)))];

export function makeStats({ store, C, X, F }) {
  const pKey = (email) => "system/plstats-" + hash(email);
  const prefs = (email) => { const d = store.get(pKey(email))?.data || {}; return { show: cleanShow(d.show) }; };
  const setPrefs = (email, show) => { const v = { kind: "plstats", email: lc(email), show: cleanShow(show), at: Date.now() }; store.set(pKey(email), v); return { show: v.show }; };
  function wentOf(email) { const me = lc(email), I = X.index(), A = I.att.get(me) || [];
    return A.map((a) => { const x = I.events.get(a.eventId); if (!x || lc(x.owner) === me) return null; const e = x.e; return { eventId: a.eventId, ws: x.ws, date: e.date || "", title: e.pubTitle || e.name || "", activity: e.activity || "", city: e.city || "", hood: e.hood || "" }; }).filter(Boolean); }
  function guest(email, now = Date.now()) { const me = lc(email), I = X.index();
    let following = [], clubs = []; try { following = F?.followedHosts?.(me) || []; clubs = F?.clubMemberships?.(me) || []; } catch {}
    return guestStats({ went: wentOf(me), following, clubs, given: I.kudos.filter((k) => lc(k.email) === me), now }); }
  function host(ws, now = Date.now()) { if (!ws || ws === DEFAULT_WS || !C.profileOf(ws)?.handle) return []; let S = {}; try { S = X.hostStrengths(ws); } catch {}
    let repeats = []; try { repeats = scopeStore(store, ws).list("events").map((d) => d.data?.repeat).filter(Boolean); } catch {} return hostStats(S, { now, repeats }); }
  /** Events gone to in the last 10 days with no kudos from you yet, each with a link to the kudos page. */
  function checkins(email, now = Date.now()) { const me = lc(email), I = X.index(), today = iso(now), from = iso(now - 10 * DAY), out = [];
    if (!emailVerified(me)) return out; // the reply is found by email, so the email has to be yours
    for (const a of wentOf(me)) { if (!(a.date >= from && a.date < today) || out.some((x) => x.eventId === a.eventId)) continue;
      if (I.kudos.some((k) => k.eventId === a.eventId && lc(k.email) === me)) continue;
      const S = scopeStore(store, a.ws), r = S.list("rsvps").find((d) => d.data?.eventId === a.eventId && lc(d.data?.email) === me && d.data?.response === "going" && d.data?.code && !d.data?.noShow);
      if (!r) continue; const h = C.profileOf(a.ws) || {};
      out.push({ eventId: a.eventId, title: a.title, date: a.date, host: String(getDbUser(getWorkspace(a.ws)?.ownerEmail || "")?.name || h.name || "").trim().split(/\s+/)[0] || h.name || "", link: `/k/${encodeURIComponent(a.eventId)}?rid=${encodeURIComponent(r.id)}&code=${encodeURIComponent(r.data.code)}` }); }
    return out.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 3); }
  return { prefs, setPrefs, guest, host, checkins };
}

export function mountStats(app, { store, small, currentUser, C, X, sendStatic }) {
  const T = makeStats({ store, C, X, F: app.locals.fanclub }); app.locals.stats = T;
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in to see your stats." }); return null; } return u; };
  app.get("/me", (req, res) => sendStatic(res, "stats.html", "<p>Stats page missing.</p>"));
  app.get("/api/me/stats", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store");
    const h = C.profileOf(u.ws); res.json({ guest: T.guest(u.email), host: T.host(u.ws), show: T.prefs(u.email).show, handle: h?.handle || "", name: String(u.name || h?.name || "").trim().split(/\s+/)[0] || "", isHost: !!h?.handle && T.host(u.ws).length > 0 }); });
  app.put("/api/me/stats/show", small, (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, ...T.setPrefs(u.email, req.body?.show) }); });
  app.get("/api/me/checkins", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json({ checkins: T.checkins(u.email) }); });
  // a page's public stats: only the ones its owner picked to show
  app.get("/api/public/host/:handle/stats", (req, res) => { const ws = C.wsOfHandle(lc(req.params.handle)); const W = ws && getWorkspace(ws), email = lc(W?.ownerEmail);
    if (!ws || !email || /@demo\.encore$/i.test(email)) return res.json({ stats: [] });
    const show = T.prefs(email).show; if (!show.length) return res.json({ stats: [] });
    res.set("Cache-Control", "public, max-age=60"); res.json({ stats: publicOnly([...T.host(ws), ...T.guest(email)], show) }); });
  return T;
}
