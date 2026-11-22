// Host-to-host collabs: one experience host asks another to co-host, pop up together or swap guest lists.
// The other host replies, accepts or declines. Accepted collabs show on both storefronts.
import crypto from "node:crypto";
import { getWorkspace, DEFAULT_WS } from "./workspaces.js";

const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
export const COLLAB_KINDS = [["cohost", "Co-host an event"], ["popup", "Pop up together"], ["swap", "Swap guest lists or cross-promote"], ["other", "Something else"]];

export function mountCollabs(app, { store, small, currentUser, C, X }) {
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "account_required", message: "Sign in to request a collab." }); return null; } return u; };
  const hits = new Map(); const limited = (k, n) => { const now = Date.now(); const h = (hits.get(k) || []).filter((t) => now - t < 864e5); h.push(now); hits.set(k, h); return h.length > n; };
  const all = () => store.list("system").map((d) => d.data).filter((x) => x?.kind === "collab");
  const get = (id) => store.get("system/collab-" + id)?.data;
  const put = (c) => store.set("system/collab-" + c.id, c);
  const card = (ws) => { const h = C.profileOf(ws); return h?.handle ? { handle: h.handle, name: h.name || "@" + h.handle, avatarArt: h.theme?.avatarArt || "", accent: h.theme?.accent || h.color || "" } : null; };
  const emailOf = (ws) => getWorkspace(ws)?.ownerEmail || "";
  const view = (c, ws) => { const mine = c.toWs === ws, other = mine ? c.from : c.to; return { id: c.id, incoming: mine, kind: c.collabKind, kindLabel: (COLLAB_KINDS.find(([k]) => k === c.collabKind) || [, "Collab"])[1], idea: c.idea, when: c.when, city: c.city, status: c.status, at: c.at, other, thread: c.thread || [], ...(c.status === "accepted" ? { otherEmail: emailOf(mine ? c.fromWs : c.toWs) } : {}) }; };

  // ask another host
  app.post("/api/collab/:handle", small, (req, res) => { const u = me(req, res); if (!u) return; const from = getWorkspace(u.ws)?.regularOnly ? null : card(u.ws);
    if (!from) return res.status(403).json({ code: "host_page_required", message: "Set up your own host page first, so they can see who you are." });
    const toWs = C.wsOfHandle(req.params.handle), to = toWs && card(toWs); if (!to) return res.status(404).json({ code: "not_found", message: "No host by that name." });
    if (toWs === u.ws) return res.status(400).json({ code: "invalid", message: "That's your own page." });
    if (limited(u.ws, 10)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of collab requests today. Try again tomorrow." });
    const b = req.body || {}, idea = clean(b.idea, 1200), kind = COLLAB_KINDS.some(([k]) => k === b.kind) ? b.kind : "other";
    if (idea.length < 10) return res.status(400).json({ code: "invalid", message: "Say a little about the idea." });
    if (all().some((c) => c.fromWs === u.ws && c.toWs === toWs && c.status === "new")) return res.status(409).json({ code: "conflict", message: `You already have a request waiting with ${to.name}.` });
    const c = { kind: "collab", collabKind: kind, id: crypto.randomBytes(6).toString("hex"), fromWs: u.ws, toWs, from, to, idea, when: clean(b.when, 80), city: clean(b.city, 80), status: "new", at: Date.now(), thread: [] };
    put(c);
    X?.notify?.(emailOf(toWs), { kind: "collab", text: `🤝 ${from.name} wants to collab: ${idea.slice(0, 120)}`, link: `/@${to.handle}?collabs=1` });
    res.json({ ok: true, id: c.id }); });
  // my collabs, both directions
  app.get("/api/collabs", (req, res) => { const u = me(req, res); if (!u) return; const L = all().filter((c) => c.fromWs === u.ws || c.toWs === u.ws).sort((a, b) => b.at - a.at).map((c) => view(c, u.ws));
    res.json({ incoming: L.filter((c) => c.incoming), sent: L.filter((c) => !c.incoming) }); });
  // reply, accept or decline
  app.post("/api/collabs/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const c = get(String(req.params.id).replace(/[^a-f0-9]/g, "")); if (!c || (c.fromWs !== u.ws && c.toWs !== u.ws)) return res.status(404).json({ code: "not_found", message: "No such request." });
    const b = req.body || {}, mineIn = c.toWs === u.ws, other = mineIn ? c.fromWs : c.toWs, who = mineIn ? c.to : c.from;
    if (b.action === "accept" || b.action === "decline") { if (!mineIn) return res.status(403).json({ code: "forbidden", message: "Only the host you asked can answer." }); c.status = b.action === "accept" ? "accepted" : "declined"; c.decidedAt = Date.now();
      X?.notify?.(emailOf(other), { kind: "collab", text: c.status === "accepted" ? `🤝 ${who.name} said yes to your collab. Their email is on your Collabs tab.` : `${who.name} can't do this collab right now.`, link: `/@${c.from.handle}?collabs=1` }); }
    else if (b.action === "message") { const text = clean(b.text, 1000); if (!text) return res.status(400).json({ code: "invalid", message: "Write a message." }); c.thread = [...(c.thread || []), { by: mineIn ? "to" : "from", name: who.name, text, at: Date.now() }].slice(-50);
      X?.notify?.(emailOf(other), { kind: "collab", text: `💬 ${who.name}: ${text.slice(0, 120)}`, link: `/@${(mineIn ? c.from : c.to).handle}?collabs=1` }); }
    else return res.status(400).json({ code: "invalid", message: "Unknown action." });
    put(c); res.json({ ok: true, collab: view(c, u.ws) }); });
  // a storefront's accepted collabs, for its "Collabs with" line
  app.get("/api/public/collabs/:handle", (req, res) => { const ws = C.wsOfHandle(req.params.handle); if (!ws) return res.json({ collabs: [] });
    const seen = new Set(), L = []; for (const c of all().filter((x) => x.status === "accepted" && (x.fromWs === ws || x.toWs === ws)).sort((a, b) => b.decidedAt - a.decidedAt)) { const o = c.fromWs === ws ? card(c.toWs) : card(c.fromWs); if (o && !seen.has(o.handle)) { seen.add(o.handle); L.push(o); } }
    res.json({ collabs: L.slice(0, 8) }); });
}
