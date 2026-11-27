// One item at a time on the host's page: "Hide from my page" and "Pin to top" for a single event, drop, experience or
// past event (public/hostitems.js draws the controls, in Arrange and on each card's owner menu).
//
// Doc, in the host's workspace: pageitems/main = { hidden: [key], pinned: [key], at }. A key is "e:<eventId>" (an
// event or a drop), "x:<experienceId>" or "s:<scrapbookId>". Hidden items stay live: their link opens for anyone who
// has it and invited guests still reply. They only leave the public page, the scrapbook and the hire portfolio
// (/api/public/hosts). The owner still gets them, marked, so the "Hidden from your page" tray can bring them back.
// At most 2 pinned; a pinned item comes first in its section.
//
// Who counts as the host of an event (hostRole) is shared here too: the workspace that owns the event, or a co-host
// whose page handle the event names in cohosts. The host page, the invites and the reply endpoint all ask it, so the
// owner sees Manage everywhere and the server refuses a host replying to their own event.
import express from "express";
import { scopeStore, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";

const DOC = "pageitems/main", KEY = /^[esx]:[A-Za-z0-9_-]{1,80}$/, MAX_PINNED = 2, MAX_HIDDEN = 500;
const listOf = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === "string" && KEY.test(k)) : []);

/** { hidden: Set, pinned: [key] } for a workspace. Never throws. */
export function pageItems(store, ws) { try { const d = (ws && scopeStore(store, ws).get(DOC)?.data) || {}; return { hidden: new Set(listOf(d.hidden)), pinned: listOf(d.pinned).slice(0, MAX_PINNED) }; } catch { return { hidden: new Set(), pinned: [] }; } }

/** "host" (the event's own workspace), "cohost" (named in its co-hosts by page handle) or "" for this signed-in user. */
export function hostRole(C, u, ws, ev) { if (!u || !u.ws || u.ws === DEFAULT_WS || !ws) return ""; if (u.ws === ws) return "host";
  try { const mine = String(C?.profileOf?.(u.ws)?.handle || "").toLowerCase(); if (mine && (Array.isArray(ev?.cohosts) ? ev.cohosts : []).some((c) => String(c?.handle || "").replace(/^@/, "").toLowerCase() === mine)) return "cohost"; } catch {}
  return ""; }

export function mountPageItems(app, { store, C, currentUser, small }) {
  const body = small || express.json({ limit: "8kb" });
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; }
    if (u.owner === false) { res.status(403).json({ code: "not_granted", message: "Only the page's host can change it." }); return null; } return u; };
  // what each key names, for the tray: a title and a kind, from the host's own data
  const describe = (ws, key) => { const [k, id] = [key[0], key.slice(2)], S = scopeStore(store, ws);
    if (k === "e") { const e = S.get("events/" + id)?.data; return e ? { key, kind: e.drop ? "drop" : (e.date || "9999") < new Date().toISOString().slice(0, 10) ? "past" : "event", title: e.pubTitle || e.name || "Untitled", date: e.date || "" } : null; }
    if (k === "x") { const x = (C.profileOf(ws)?.experiences || []).find((y) => String(y.id) === id); return x ? { key, kind: "experience", title: x.name || "Untitled", date: "" } : null; }
    const s = S.get("scrapbook/" + id)?.data; return s ? { key, kind: "past", title: s.title || "A past event", date: s.date || "" } : null; };
  const view = (ws) => { const P = pageItems(store, ws); return { hidden: [...P.hidden].map((k) => describe(ws, k)).filter(Boolean), pinned: P.pinned, maxPinned: MAX_PINNED }; };
  app.get("/api/host/page-items", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store").json(view(u.ws)); });
  // { key, hidden?: bool, pinned?: bool }: one change, applied at once (no Done needed)
  app.post("/api/host/page-items", body, (req, res) => { const u = me(req, res); if (!u) return; const key = String(req.body?.key || "");
    if (!KEY.test(key) || !describe(u.ws, key)) return res.status(404).json({ code: "not_found", message: "That isn't on your page." });
    const S = scopeStore(store, u.ws), cur = S.get(DOC)?.data || {}, hidden = listOf(cur.hidden), pinned = listOf(cur.pinned);
    let H = hidden, Pn = pinned;
    if (typeof req.body?.hidden === "boolean") { H = hidden.filter((k) => k !== key); if (req.body.hidden) { H.push(key); Pn = Pn.filter((k) => k !== key); } }
    if (typeof req.body?.pinned === "boolean") { Pn = Pn.filter((k) => k !== key); if (req.body.pinned) { if (Pn.length >= MAX_PINNED) return res.status(409).json({ code: "pin_limit", message: `You can pin ${MAX_PINNED}. Unpin one first.` }); Pn.unshift(key); H = H.filter((k) => k !== key); } }
    S.set(DOC, { hidden: H.slice(-MAX_HIDDEN), pinned: Pn.slice(0, MAX_PINNED), at: Date.now() }); res.json({ ok: true, ...view(u.ws) }); });
  /** the signed-in user's role on an event, for pages that draw the guest action (the light invite asks this) */
  app.get("/api/public/event-role/:id", (req, res) => { const id = String(req.params.id || ""); res.set("Cache-Control", "private, no-store");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return res.json({ role: "" }); const ws = workspaceOfEvent(id), ev = ws && scopeStore(store, ws).get("events/" + id)?.data;
    let u = null; try { u = currentUser(req); } catch {} res.json({ role: ev ? hostRole(C, u, ws, ev) : "", manage: `/?app=1&open=${encodeURIComponent(id)}#studio` }); });
}
