// The host page cover photo: the host's own picture, full-bleed, with a focal point they drag into place.
// POST /api/host/cover takes the image itself (PNG, JPEG or WebP, checked by its bytes, not its name), stores it in the
// same blob store as every upload (marked with the owner's workspace) and sets theme.coverUrl and theme.coverPos.
// POST /api/host/cover/position moves the focal point; DELETE /api/host/cover goes back to a drawn cover.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { DEFAULT_WS } from "./workspaces.js";

export const COVER_MAX_BYTES = 8 * 1024 * 1024;
/** The image type from the first bytes, or "" when it isn't a PNG, JPEG or WebP. */
export function sniffImage(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return "";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}
/** "50% 30%": where the photo's focal point sits. Anything else reads as the middle. */
export const cleanPos = (x, y) => { const n = (v) => Math.max(0, Math.min(100, Math.round(+v))); return Number.isFinite(+x) && Number.isFinite(+y) && x !== "" && y !== "" ? `${n(x)}% ${n(y)}%` : "50% 50%"; };

export function mountCover(app, { assetsDir, currentUser, C }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const owner = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; }
    const h = C.profileOf(u.ws); if (!h?.handle) { bad(res, "Set up your page first.", 400, "no_page"); return null; } return { u, h }; };
  const setTheme = (ws, h, patch) => { const r = C.setProfile(ws, { theme: { ...(h.theme || {}), ...patch } }, { coverOk: true }); return r.host; };
  // the body is the image; the focal point rides along in the query (?x=50&y=30)
  app.post("/api/host/cover", express.raw({ type: () => true, limit: COVER_MAX_BYTES + 1024 }), async (req, res) => {
    const o = owner(req, res); if (!o) return;
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) return bad(res, "Pick a photo first.");
    if (body.length > COVER_MAX_BYTES) return bad(res, "That photo is over 8 MB. Pick a smaller one.", 413, "too_large");
    const type = sniffImage(body); if (!type) return bad(res, "Use a PNG, JPEG or WebP photo.", 415, "unsupported_type");
    const id = crypto.randomBytes(15).toString("base64").replace(/[^A-Za-z0-9]/g, "").padEnd(20, "x").slice(0, 20);
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, id), body);
    await fs.writeFile(path.join(assetsDir, id + ".json"), JSON.stringify({ id, url: "/_blob/" + id, sizeBytes: body.length, contentType: type, createdAt: Date.now(), ws: o.u.ws, kind: "cover" }));
    const host = setTheme(o.u.ws, o.h, { coverUrl: "/_blob/" + id, coverPos: cleanPos(req.query.x ?? 50, req.query.y ?? 50) });
    res.json({ ok: true, coverUrl: host.theme.coverUrl, coverPos: host.theme.coverPos, host }); });
  app.post("/api/host/cover/position", express.json({ limit: "2kb" }), (req, res) => { const o = owner(req, res); if (!o) return;
    if (!o.h.theme?.coverUrl) return bad(res, "Add a cover photo first.");
    const host = setTheme(o.u.ws, o.h, { coverPos: cleanPos(req.body?.x, req.body?.y) }); res.json({ ok: true, coverPos: host.theme.coverPos }); });
  app.delete("/api/host/cover", (req, res) => { const o = owner(req, res); if (!o) return; const host = setTheme(o.u.ws, o.h, { coverUrl: "", coverPos: "" }); res.json({ ok: true, host }); });
}
