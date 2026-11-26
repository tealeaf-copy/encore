// "Host one like this": on a real past event (feed photo dumps and recap stories, the past invite at /e/<id> and /g,
// the host page's scrapbook) and on ideas. Signed out it opens signup, signed in it opens the app, and Potto drafts a
// new event from a sentence built here: the event's title, what kind of thing it was, a rough price and size, and the
// visitor's own city. Never the address, the host's name or any guest's name.
//
// Each draft made this way is recorded against the event (or idea) it came from. The count shown under it, "3 people
// hosted this after seeing it", is the hosts whose draft they then shared (published or on Discover), never the source
// host, and only on public events.
import { scopeStore, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";

const ID_OK = /^[A-Za-z0-9_-]{2,80}$/, KEY_OK = /^(?:idea-)?[A-Za-z0-9_-]{2,120}$/;
const clean = (v, n = 80) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
export const isPublicEvent = (ev) => !!ev && !!ev.discoverable && !ev.unlisted && !ev.example;
/** "about $15 a person", "free", "chip in", "" */
export function roughPrice(ev) {
  const p = String(ev?.price ?? "").trim(); if (!p || ev.free || /^(free|\$?0)$/i.test(p)) return "free"; if (p === "chip") return "chip in";
  const g = +ev.groupPrice > 0 && +ev.groupSize > 1, n = g ? +ev.groupPrice : parseFloat(p.replace(/[^\d.]/g, "")); if (!(n > 0)) return "";
  const r = n < 20 ? Math.round(n) : Math.round(n / 5) * 5;
  return g ? `about $${r} for ${+ev.groupSize}` : ev.priceUnit === "each" ? `about $${r} each` : `about $${r} a person`;
}
/** "6 pairs", "about 20 people", "" */
export function roughSize(ev) {
  const n = +ev?.headcount || 0, g = Math.floor(+ev?.groupSize) || 0;
  if (ev?.headUnit === "pairs" || ev?.headUnit === "groups") { const u = +ev.unitCount || +ev.groupCount || (n && g > 1 ? Math.floor(n / g) : n ? Math.floor(n / 2) : 0); return u ? `${u} ${ev.headUnit}` : ""; }
  if (ev?.preorder || !n) return ""; return n <= 12 ? `${n} people` : `about ${Math.round(n / 5) * 5} people`;
}
/** What kind of thing it was, in a word or two: the activity, else the drawing on its cover. */
export const kindOf = (ev) => clean(ev?.activity || (typeof ev?.coverArt === "object" ? String(ev.coverArt.kind || "").split("+")[0] : "") || ev?.format || "", 30).toLowerCase().replace(/^get-together$/, "");
/** The sentence Potto drafts from: "Salsa Sunday: a dance night for about 20 people, about $15 a person, in Oakland". */
export function promptFor(ev, city = "") {
  const title = clean(ev?.pubTitle || ev?.name, 80) || "Something like this", kind = kindOf(ev), size = roughSize(ev), price = roughPrice(ev), c = clean(city, 60);
  const what = [kind && !title.toLowerCase().includes(kind) ? `a ${kind}` : "", size ? `for ${size}` : "with friends"].filter(Boolean).join(" ");
  return [`${title}: ${what}`, price, c ? `in ${c}` : ""].filter(Boolean).join(", ");
}

const recOf = (store, key) => store.get("system/hostlike-" + key)?.data || { kind: "hostlike", key, starts: [] };
/** How many hosts shared an event they drafted from this one (never the source event's own host). */
export function hostedCount(store, key) { const R = recOf(store, key), src = key.startsWith("idea-") ? null : workspaceOfEvent(key), seen = new Set();
  for (const s of R.starts || []) { if (!s?.ws || s.ws === src || seen.has(s.ws) || !ID_OK.test(String(s.id || ""))) continue;
    try { const e = scopeStore(store, s.ws).get("events/" + s.id)?.data; if (e && !e.example && !e.cancelled && (e.published || e.discoverable)) seen.add(s.ws); } catch {} }
  return seen.size; }
export const countLine = (n) => (n >= 1 ? `${n} ${n === 1 ? "person" : "people"} hosted this after seeing it` : "");

export function mountHostLike(app, { store, small, currentUser }) {
  const hits = new Map(), limited = (k, n) => { const now = Date.now(); if (hits.size > 50_000) hits.clear(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const rec = (key) => recOf(store, key), counted = (key) => hostedCount(store, key);
  // what a new draft starts from: never the address, the host or the guests
  app.get("/api/public/like/:eventId", (req, res) => { const id = String(req.params.eventId || ""); if (!ID_OK.test(id)) return bad(res, "No such event.", 404, "not_found");
    const ws = workspaceOfEvent(id), ev = ws ? scopeStore(store, ws).get("events/" + id)?.data : null; if (!ev || ev.example || ev.cancelled) return bad(res, "No such event.", 404, "not_found");
    const pub = isPublicEvent(ev), n = pub ? counted(id) : 0, L = ev.look && typeof ev.look === "object" ? ev.look : null, art = typeof ev.coverArt === "object" && ev.coverArt?.kind ? { kind: clean(ev.coverArt.kind, 40), ...(ev.coverArt.tone ? { tone: clean(ev.coverArt.tone, 20) } : {}) } : null;
    res.set("Cache-Control", "public, max-age=60");
    res.json({ ok: true, id, title: clean(ev.pubTitle || ev.name, 80), kind: kindOf(ev), price: roughPrice(ev), size: roughSize(ev), past: !!ev.date && ev.date < new Date().toISOString().slice(0, 10),
      prompt: promptFor(ev, ""), headUnit: ev.headUnit === "pairs" || ev.headUnit === "groups" ? ev.headUnit : "", ...(L && Array.isArray(L.palette) ? { look: { palette: L.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3), effect: clean(L.effect, 20), titleFont: clean(L.titleFont, 20), buttonEmoji: clean(L.buttonEmoji, 8), ...(L.vibe ? { vibe: clean(L.vibe, 30) } : {}) } } : {}), ...(art ? { art } : {}),
      public: pub, hosted: n, line: countLine(n) }); });
  app.get("/api/public/like-counts", (req, res) => { const ids = String(req.query.ids || "").split(",").filter((x) => KEY_OK.test(x)).slice(0, 40), out = {};
    for (const k of ids) { if (k.startsWith("idea-")) { const n = counted(k); if (n) out[k] = n; continue; } const ws = workspaceOfEvent(k), ev = ws ? scopeStore(store, ws).get("events/" + k)?.data : null; if (!isPublicEvent(ev)) continue; const n = counted(k); if (n) out[k] = n; }
    res.set("Cache-Control", "public, max-age=60"); res.json({ counts: out }); });
  // the app made a draft from it: remember which, so it counts once that host shares it
  app.post("/api/me/like/:key/started", small, (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated");
    const key = String(req.params.key || ""), draft = String(req.body?.draftId || ""); if (!KEY_OK.test(key) || !ID_OK.test(draft)) return bad(res, "Missing the draft.", 400);
    if (limited("u:" + u.ws, 40)) return bad(res, "Slow down.", 429, "rate_limited");
    if (!scopeStore(store, u.ws).get("events/" + draft)) return bad(res, "No such draft.", 404, "not_found");
    if (!key.startsWith("idea-") && !workspaceOfEvent(key)) return bad(res, "No such event.", 404, "not_found");
    const R = rec(key), starts = (R.starts || []).filter((s) => s.ws !== u.ws).concat({ ws: u.ws, id: draft, at: Date.now() }).slice(-500);
    store.set("system/hostlike-" + key, { ...R, starts }); res.json({ ok: true }); });
}
