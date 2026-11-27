// The host page's layout ("Make it yours" on /@handle): the order of the sections, their styles, which are hidden, and
// the host's own blocks. The allow-list, the checks and the CSS live in public/arrange-core.js, run here in a sandbox,
// so the browser and the server can't disagree about what a layout means.
//
// Doc, in the host's workspace: pagelayout/main = { draft, live, draftAt, liveAt }. The editor autosaves the draft as
// the host drags; Done publishes it (live = draft). Visitors only ever get the live one, and they get it in the page's
// HTML (inject below): the layout's CSS goes in <head>, so the first paint is already in the host's order. A page with
// no live layout is sent as it always was.
//
// Writes are the page owner's only: signed out is 401, any other account 403. Images and videos in a block must be the
// host's own uploads (a /_blob file their workspace uploaded, or a photo already in their gallery).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import express from "express";
import { scopeStore, DEFAULT_WS } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const box = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, "..", "public", "arrange-core.js"), "utf8"), box, { filename: "arrange-core.js", timeout: 1000 });
export const PL = box.window.PLLayout;
const DOC = "pagelayout/main";
const HANDLE = /^[a-z0-9][a-z0-9-]{1,29}$/;

/** A plain copy (the sandbox's objects come from another realm; JSON makes them ours). */
const own = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export function makePageLayout({ store, C, assetsDir, X }) {
  const docOf = (ws) => scopeStore(store, ws).get(DOC)?.data || null;
  const liveOf = (ws) => { try { return docOf(ws)?.live || null; } catch { return null; } };
  /** whether a /_blob file is this host's: their upload (its metadata names the workspace) or a gallery photo */
  const blobOk = (ws) => (u, kind) => { const id = String(u || "").replace(/^\/_blob\//, ""); if (!/^[A-Za-z0-9]{20}$/.test(id)) return false;
    if (kind === "image" && (C.profileOf(ws)?.gallery || []).includes(u)) return true;
    try { const m = JSON.parse(fs.readFileSync(path.join(assetsDir, id + ".json"), "utf8")); const t = String(m.contentType || "").toLowerCase(); return m.ws === ws && (kind === "video" ? /^video\//.test(t) : /^image\//.test(t)); } catch { return false; } };
  const check = (ws, L) => own(PL.check(L, { imgOk: blobOk(ws) }));
  /** what the host has, for Potto's suggestion and the starter that fits them */
  function facts(ws) { const h = C.profileOf(ws) || {}, f = { photos: (h.gallery || []).length, kudos: 0, upcoming: 0, drops: 0, experiences: (h.experiences || []).length, forHire: !!h.forHire, brandKit: !!h.brandKit, bio: !!String(h.bio || "").trim(), cover: !!h.theme?.coverUrl, activity: "" };
    try { const S = X?.hostStrengths?.(ws); if (S) { f.kudos = S.kudosCount || 0; f.photos += (S.moments || []).length; } } catch {}
    try { const up = C.eventsOf(ws, { upcoming: true, onPage: true }) || [], acts = {};
      for (const x of up) { const e = x.e || x; if (e.drop) f.drops++; else f.upcoming++; const a = String(e.activity || e.kind || "").toLowerCase(); if (a) acts[a] = (acts[a] || 0) + 1; }
      const past = C.eventsOf(ws, { upcoming: false, onPage: true }) || []; for (const x of past) { const a = String((x.e || x).activity || "").toLowerCase(); if (a) acts[a] = (acts[a] || 0) + 1; }
      f.activity = Object.entries(acts).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; } catch {}
    if (h.shop?.open && (h.shop.items || []).length) f.drops = Math.max(f.drops, 1);
    return f; }
  /** The host page HTML with the live layout in it: its CSS in <head>, its classes on <html>, its blocks as JSON. */
  function inject(html, ws) { const L = ws && liveOf(ws); if (!L) return html;
    const json = JSON.stringify(own(L)).replace(/</g, "\\u003c");
    return html.replace(/<html lang="en">/, `<html lang="en" class="${PL.classes(L).join(" ")}">`)
      .replace("</head>", `<style id="plLayoutCss">${PL.css(L)}</style><script type="application/json" id="plLayout">${json}</script></head>`); }
  return { docOf, liveOf, check, facts, inject, blobOk };
}

export function mountPageLayout(app, { store, C, X, currentUser, assetsDir }) {
  const P = makePageLayout({ store, C, assetsDir, X }); app.locals.pageLayout = P;
  const body = express.json({ limit: "48kb" });
  const no = (res, status, code, message) => res.status(status).json({ code, message });
  // the page's owner, or a 401 / 403 / 404 answer
  const ownerOf = (req, res) => { const h = String(req.params.handle || "").toLowerCase(); if (!HANDLE.test(h)) { no(res, 404, "not_found", "No host by that name."); return null; }
    const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { no(res, 401, "unauthenticated", "Sign in first."); return null; }
    const ws = C.wsOfHandle(h); if (!ws || ws !== u.ws || u.owner === false) { no(res, 403, "not_granted", "Only the page's host can arrange it."); return null; }
    return ws; };
  const save = (ws, patch) => { const S = scopeStore(store, ws), cur = S.get(DOC)?.data || {}; const next = { ...cur, ...patch }; S.set(DOC, next); return next; };
  const view = (ws) => { const d = P.docOf(ws) || {}, f = P.facts(ws); return { draft: d.draft || null, live: d.live || null, draftAt: d.draftAt || 0, liveAt: d.liveAt || 0, suggested: own(PL.defaults()), kind: PL.kindOf(f), facts: f }; };
  app.get("/api/host/layout/:handle", (req, res) => { const ws = ownerOf(req, res); if (!ws) return; res.set("Cache-Control", "no-store").json(view(ws)); });
  // the draft, as the host goes (the editor debounces): checked, then kept
  app.put("/api/host/layout/:handle", body, (req, res) => { const ws = ownerOf(req, res); if (!ws) return; const r = P.check(ws, req.body?.layout);
    if (r.error) return no(res, 400, "bad_layout", r.error); save(ws, { draft: r.layout, draftAt: Date.now() }); res.json({ ok: true, draft: r.layout }); });
  // Done: the draft (or the layout sent with it) goes live for everyone
  app.post("/api/host/layout/:handle/publish", body, (req, res) => { const ws = ownerOf(req, res); if (!ws) return; const src = req.body?.layout ?? P.docOf(ws)?.draft;
    if (!src) return no(res, 400, "no_draft", "Arrange something first.");
    const r = P.check(ws, src); if (r.error) return no(res, 400, "bad_layout", r.error);
    const now = Date.now(); save(ws, { draft: r.layout, live: r.layout, draftAt: now, liveAt: now }); res.json({ ok: true, live: r.layout }); });
  // back to the page as it was before any arranging (the draft is cleared too)
  app.delete("/api/host/layout/:handle", (req, res) => { const ws = ownerOf(req, res); if (!ws) return; save(ws, { draft: null, live: null, draftAt: Date.now(), liveAt: Date.now() }); res.json({ ok: true }); });
  // Potto's suggestion: plain rules from what the host has, so it works offline and costs nothing
  app.post("/api/host/layout/:handle/suggest", body, (req, res) => { const ws = ownerOf(req, res); if (!ws) return; const f = P.facts(ws), cur = P.check(ws, req.body?.layout).layout || P.docOf(ws)?.draft || null;
    res.json(own(PL.suggest(f, cur))); });
  app.get("/api/public/host/:handle/layout", (req, res) => { const h = String(req.params.handle || "").toLowerCase(); const ws = HANDLE.test(h) && C.wsOfHandle(h);
    res.set("Cache-Control", "no-cache").json({ layout: (ws && own(P.liveOf(ws))) || null }); });
  return P;
}
