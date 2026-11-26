// ---- Find people (/people, public/people.html): search, suggestions with real reasons, contacts, your code ----
// - Suggested: people you went to things with (who didn't hide themselves), friends of friends, fans of the same hosts;
//   hosts with the same reasons the feed's follow row gives (server/feedblend.js). First names only for people, and a
//   place only when their own page shows one.
// - Contacts: the browser or the app hashes each email and phone (SHA-256 of "e:<email>" or "t:<digits>", normalized
//   the same way as normEmail / normPhone below) and posts only the hashes. Only members who turned on "Let people
//   find me by email or phone" (/settings, off by default) can match. The hashes are compared in memory and never
//   stored or logged. Authed and rate limited.
// - My code: a QR for your page (/@<handle>#follow), drawn in the browser by public/qr.js (vendored, MIT) in the brand
//   accent with the Pottery Lab mark in the middle; /api/me/qr.svg is the same code from server/qr.js, for a download.
// - Blocks work both ways everywhere here: someone you blocked, or who blocked you, never shows.
import crypto from "node:crypto";
import express from "express";
import { getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { qrSvg } from "./qr.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const keyOf = (email) => Buffer.from(lc(email)).toString("base64url");
export const normEmail = (e) => { const x = lc(e); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) ? x : ""; };
/** Digits only; a leading US/Canada 1 on 11 digits is dropped, so "+1 (415) 555-0101" and "415 555 0101" match. */
export const normPhone = (p) => { let d = String(p || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length >= 7 && d.length <= 15 ? d : ""; };
export const contactHashes = ({ email = "", phone = "" } = {}) => [normEmail(email) && sha("e:" + normEmail(email)), normPhone(phone) && sha("t:" + normPhone(phone))].filter(Boolean);
const fPath = (em) => "system/findable-" + sha("findable:" + lc(em)).slice(0, 24);

export function mountFindPeople(app, { store, small, currentUser, C, X, B, sendPage }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { let u = null; try { u = currentUser(req); } catch {} if (!u || u.ws === DEFAULT_WS || !u.email) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const hits = new Map(); const over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const safety = () => app.locals.appstore?.safety || null;
  const blocks = (em) => { try { return new Set((safety()?.blocksOf(em) || []).map((b) => b.target)); } catch { return new Set(); } };
  /** Neither has blocked the other. */
  const clear = (a, b) => !blocks(a).has("person:" + keyOf(b)) && !blocks(b).has("person:" + keyOf(a));
  const findable = (em) => store.get(fPath(em))?.data?.on === true;
  const sample = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  const placeOf = (p) => { const h = p?.ws ? C.profileOf(p.ws) : null; return h?.handle ? clean([h.hood, h.city].filter(Boolean).join(", "), 60) : ""; };
  const personRow = (viewer, em, reason = "") => { const p = X.person(em), friends = new Set(X.friendsOf(viewer).map((f) => lc(f.email)));
    return { type: "person", key: keyOf(em), name: first(p.name), emoji: p.emoji, color: p.color, handle: p.handle || "", place: placeOf(p), reason, url: p.handle ? `/@${p.handle}` : "", following: friends.has(lc(em)) }; };

  app.get("/people", (req, res) => sendPage(res, "people.html"));
  // "Let people find me by email or phone": off until you turn it on
  app.get("/api/me/findable", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json({ on: findable(u.email) }); });
  app.post("/api/me/findable", small, (req, res) => { const u = me(req, res); if (!u) return; const on = req.body?.on === true; store.set(fPath(u.email), { kind: "findable", email: lc(u.email), on, at: Date.now() }); res.json({ ok: true, on }); });

  // suggestions: people, and hosts and clubs, each with a real reason
  app.get("/api/me/people/suggested", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); const em = lc(u.email);
    const v = B.viewerOf({ email: em, ws: u.ws, city: String(req.query.city || "").slice(0, 60) });
    const people = B.peopleFor(v, { limit: 40 }).filter((p) => clear(em, Buffer.from(p.key, "base64url").toString())).map(({ score, ...p }) => ({ ...p, following: false }));
    const clubOf = (handle) => { try { const ws = C.wsOfHandle(handle), c = ws && app.locals.fanclub?.config(ws); return c?.on ? c.name || "Fan club" : ""; } catch { return ""; } };
    const hosts = B.follows({ ...v, email: "" }, { limit: 40 }).filter((h) => h.type === "host").map((h) => ({ ...h, club: clubOf(h.handle), following: false }));
    res.json({ people, hosts }); });

  // search members (first names) and hosts; blocked either way never shows
  app.get("/api/me/people/search", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); if (over("s|" + lc(u.email), 240)) return bad(res, "Slow down.", 429, "rate_limited");
    const q = lc(req.query.q).replace(/^@/, "").slice(0, 60), em = lc(u.email); if (q.length < 2) return res.json({ people: [], hosts: [] });
    const I = X.index(), hostWs = new Set([...I.events.values()].filter((x) => app.locals.feedVisual?.cardPublic?.(x.e)).map((x) => x.ws)), people = [], hosts = [];
    const fol = (ws) => { try { return C.followersOf(ws).some((f) => lc(f.email) === em); } catch { return false; } };
    for (const d of store.listPrefix("system", "ws-")) { const w = d.data; if (w?.kind !== "workspace" || !w.ownerEmail || sample(w.id)) continue; const owner = lc(w.ownerEmail); if (owner === em) continue;
      const h = C.profileOf(w.id), p = X.person(owner), nm = lc(p.name), hn = lc(h?.name);
      if (hostWs.has(w.id) && h?.handle && (h.handle.includes(q) || hn.includes(q)) && !blocks(em).has("host:" + lc(h.handle))) hosts.push({ type: "host", handle: h.handle, name: h.name, emoji: h.emoji, color: h.theme?.accent || h.color, place: clean([h.hood, h.city].filter(Boolean).join(", "), 60), url: `/@${h.handle}`, following: fol(w.id), reason: "" });
      if ((nm.split(/\s+/).some((x) => x.startsWith(q)) || (h?.handle || "").startsWith(q)) && first(p.name) && clear(em, owner)) people.push(personRow(em, owner));
      if (people.length >= 20 && hosts.length >= 20) break; }
    res.json({ people: people.slice(0, 20), hosts: hosts.slice(0, 20) }); });

  // contacts: hashes in, matches out, nothing kept
  const perUser = () => Math.max(1, +process.env.ENCORE_CONTACT_MATCH_PER_HOUR || 6), perIp = () => Math.max(1, +process.env.ENCORE_CONTACT_MATCH_PER_IP_HOUR || 20);
  app.post("/api/me/people/match", express.json({ limit: "100kb" }), (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store");
    if (over("m|ip|" + (req.ip || "?"), perIp()) || over("m|u|" + lc(u.email), perUser())) return bad(res, "That's a lot of checking. Try again in an hour.", 429, "rate_limited");
    const H = Array.isArray(req.body?.hashes) ? req.body.hashes : null; if (!H) return bad(res, "Send the hashes to check.");
    if (H.length > 1000) return bad(res, "Up to 1,000 contacts at a time.", 413, "too_large");
    const want = new Set(H.filter((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))), em = lc(u.email), out = [];
    if (want.size) for (const d of store.listPrefix("system", "findable-")) { const f = d.data; if (f?.kind !== "findable" || f.on !== true) continue; const other = lc(f.email); if (!other || other === em || !X.userOf(other)) continue;
      const mine = contactHashes({ email: other, phone: getDbUser(other)?.phone || "" }); if (!mine.some((h) => want.has(h)) || !clear(em, other)) continue;
      const r = personRow(em, other, "In your contacts"); if (r.name) out.push(r); if (out.length >= 200) break; }
    res.json({ checked: want.size, matches: out }); });

  // my code: a QR for my page, in the colour the page asks for (the brand accent token)
  app.get("/api/me/qr.svg", (req, res) => { const u = me(req, res); if (!u) return; const h = X.ensureProfile?.(u) || C.profileOf(u.ws); if (!h?.handle) return bad(res, "Make your page first.", 404, "not_found");
    const dark = /^#[0-9a-f]{6}$/i.test(String(req.query.dark || "")) ? String(req.query.dark) : "#1F1A17", origin = (process.env.ENCORE_PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    res.set("Cache-Control", "private, no-store").type("image/svg+xml").send(qrSvg(`${origin}/@${h.handle}#follow`, { dark, light: "#FFFFFF" })); });
  app.get("/api/me/code", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); const h = X.ensureProfile?.(u) || C.profileOf(u.ws), p = X.person(u.email);
    const origin = (process.env.ENCORE_PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    res.json({ name: first(p.name) || h?.name || "", emoji: h?.emoji || p.emoji, color: h?.theme?.accent || h?.color || p.color, avatarArt: h?.theme?.avatarArt || "", avatarUrl: /^\/_blob\/[A-Za-z0-9]{20}$/.test(h?.theme?.avatarUrl || "") ? h.theme.avatarUrl : "", handle: h?.handle || "", url: h?.handle ? `${origin}/@${h.handle}` : "" }); });
}
