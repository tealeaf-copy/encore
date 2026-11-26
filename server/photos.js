// Photos people choose for themselves: an event's cover, their page's cover and their profile picture. One server side for
// the "Change photo" sheet (public/photosheet.js): upload, recent uploads, templates, use and remove.
// - Uploads are PNG, JPEG or WebP only (the bytes are sniffed; the browser's type is only a claim), up to 10 MB for a
//   cover and 5 MB for a profile picture, at least 64px on each side, into the existing blob store (/_blob/<id>) under the
//   uploader's own workspace. Signed-in owners only.
// - The sheet uploads the original once, then a crop made from it in the browser (16:9 for an event cover, 3:1 for a page
//   cover, a square for a profile picture) around the point the person dragged to. The crop is what every card, invite,
//   story ring, chat header and og:image shows; the original and the focal point are kept so the next drag starts there.
// - Only photos from the owner's own workspace can be put on their event or page (ownsBlob), so nobody can point their
//   page at someone else's upload.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { randomId } from "./db.js";
import { DEFAULT_WS, getWorkspace, scopeStore } from "./workspaces.js";
import { sniffType } from "./feedvisual.js";

export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const PHOTO_FOR = ["cover", "page", "avatar"];
export const PHOTO_MAX = { cover: 10 * 1048576, page: 10 * 1048576, avatar: 5 * 1048576 };
export const PHOTO_MIN_SIDE = 64;
const BLOB = /^\/_blob\/([A-Za-z0-9]{20})$/;
const lc = (s) => String(s || "").trim().toLowerCase();

/** Width and height from a PNG, JPEG or WebP header, or null. */
export function imageSize(buf) {
  try {
    const t = sniffType(buf);
    if (t === "image/png" && buf.length >= 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (t === "image/jpeg") { let i = 2; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + len; } return null; }
    if (t === "image/webp" && buf.length >= 30) { const f = buf.toString("latin1", 12, 16);
      if (f === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (f === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (f === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }; }
  } catch {}
  return null;
}
/** A focal point as whole percents, {x, y} each 0 to 100; anything else is the middle. */
export const cleanFocus = (f) => { const n = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(100, Math.round(+v))) : 50); return { x: n(f?.x), y: n(f?.y) }; };

let ASSETS = "";
const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(ASSETS, id + ".json"), "utf8")); } catch { return null; } };
/** True when the url is an upload stored under this workspace. Presets and https links aren't uploads and answer false. */
export function ownsBlob(ws, url) { const m = BLOB.exec(String(url || "")); if (!m || !ASSETS || !ws) return false; const meta = metaOf(m[1]); return !!meta && (meta.ws || DEFAULT_WS) === ws; }
/** An upload url that belongs to someone else (keep the old value instead). Not-uploads (presets, https, "") pass. */
export const foreignBlob = (ws, url) => BLOB.test(String(url || "")) && !!ASSETS && !ownsBlob(ws, url);

/** Strip a cover photo that isn't the workspace's own upload from an event write (the old one stays). */
export function guardEventPhotos(body, ws, before) {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  if ("coverPhoto" in out && out.coverPhoto !== (before?.coverPhoto || "") && foreignBlob(ws, out.coverPhoto)) { if (before?.coverPhoto) out.coverPhoto = before.coverPhoto; else delete out.coverPhoto; }
  if ("coverSource" in out && out.coverSource !== (before?.coverSource || "") && foreignBlob(ws, out.coverSource)) delete out.coverSource;
  if ("coverFocus" in out) out.coverFocus = out.coverFocus ? cleanFocus(out.coverFocus) : null;
  return out;
}
/** The same for a page's theme: a profile picture or page cover that isn't theirs is dropped from the save. */
export function guardTheme(theme, ws) {
  if (!theme || typeof theme !== "object") return theme;
  const t = { ...theme };
  for (const k of ["avatarUrl", "coverUrl", "avatarSource", "coverSource"]) if (k in t && foreignBlob(ws, t[k])) delete t[k];
  return t;
}

// templates the sheet offers when the caller doesn't bring its own: drawn covers for an event (public/eventart.js draws
// them), portraits for a profile picture (public/avatars.js), colour washes for a page cover (the host page's covers)
const COVER_ART = ["coffee", "dinner", "cook", "bake", "wine", "run", "hike", "yoga", "games", "book", "music", "tech", "talk", "craft", "picnic", "party"];
const PORTRAITS = ["florist", "straight", "bob", "pixie", "bun", "ponytail", "curls", "waves", "afro", "braids", "locs", "hijab", "headwrap", "beanie", "beard", "shaved", "chef", "runner", "barista", "baker", "glasses", "hiker"];
const WASHES = [["wash", "#F3E4CF"], ["sunrise", "#F6C9A8"], ["dusk", "#C8B6D9"], ["dots", "#F2D48F"], ["waves", "#BFD6CF"], ["confetti", "#F4C7C3"], ["plain", "#EFE6D8"]];
export function templatesFor(kind) {
  if (kind === "avatar") return PORTRAITS.map((id) => ({ id, kind: "portrait", label: id[0].toUpperCase() + id.slice(1) }));
  if (kind === "page") return WASHES.map(([id, color]) => ({ id, kind: "wash", color, label: id[0].toUpperCase() + id.slice(1) }));
  return COVER_ART.map((id) => ({ id, kind: "art", label: id[0].toUpperCase() + id.slice(1) }));
}

export function mountPhotos(app, { store, assetsDir, currentUser, C, raw, small }) {
  ASSETS = assetsDir;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } return u; };
  const hits = new Map(), limited = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > 3600_000) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const avatarPath = (email) => "system/avatar-" + crypto.createHash("sha256").update(lc(email)).digest("hex").slice(0, 24);
  const recentCache = new Map(); // ws -> { at, list }

  app.post("/api/photos", raw, async (req, res) => { const u = me(req, res); if (!u) return;
    if (limited("up:" + u.ws, 120)) return bad(res, "That's a lot of uploads for one hour. Try again later.", 429, "rate_limited");
    const kind = PHOTO_FOR.includes(req.query.for) ? req.query.for : "cover", body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) return bad(res, "That file is empty.");
    if (body.length > PHOTO_MAX[kind]) return bad(res, `Photos can be up to ${PHOTO_MAX[kind] / 1048576} MB. Try a smaller one.`, 413, "too_large");
    const type = sniffType(body); if (!PHOTO_TYPES.includes(type)) return bad(res, "Pick a PNG, JPEG or WebP photo.", 415, "unsupported_type");
    const size = imageSize(body); if (size && (size.w < PHOTO_MIN_SIDE || size.h < PHOTO_MIN_SIDE)) return bad(res, `That photo is very small (${size.w}×${size.h}). Pick one at least ${PHOTO_MIN_SIDE}px on each side.`, 400, "too_small");
    const crop = req.query.crop === "1", src = BLOB.exec(String(req.query.source || "")), source = crop && src && ownsBlob(u.ws, req.query.source) ? req.query.source : "";
    const id = randomId(), meta = { id, url: "/_blob/" + id, sizeBytes: body.length, contentType: type, createdAt: Date.now(), ws: u.ws, photo: { for: kind, ...(size || {}), ...(crop ? { crop: true, source, focus: cleanFocus({ x: req.query.fx, y: req.query.fy }) } : {}) } };
    await fsp.writeFile(path.join(assetsDir, id), body); await fsp.writeFile(path.join(assetsDir, id + ".json"), JSON.stringify(meta));
    recentCache.delete(u.ws);
    res.json({ id, url: meta.url, w: size?.w || 0, h: size?.h || 0, contentType: type }); });

  // the owner's own photo uploads, newest first (crops left out: they're made from these)
  app.get("/api/photos/recent", async (req, res) => { const u = me(req, res); if (!u) return;
    let c = recentCache.get(u.ws);
    if (!c || Date.now() - c.at > 30_000) { const list = [];
      for (const f of await fsp.readdir(assetsDir).catch(() => [])) { if (!f.endsWith(".json")) continue; try { const m = JSON.parse(await fsp.readFile(path.join(assetsDir, f), "utf8"));
          if ((m.ws || DEFAULT_WS) === u.ws && PHOTO_TYPES.includes(String(m.contentType || "").split(";")[0].trim()) && !m.photo?.crop && !m.hidden) list.push({ url: m.url, at: m.createdAt || 0, w: m.photo?.w || 0, h: m.photo?.h || 0, for: m.photo?.for || "" }); } catch {} }
      list.sort((a, b) => b.at - a.at); c = { at: Date.now(), list: list.slice(0, 30) }; recentCache.set(u.ws, c); }
    res.set("Cache-Control", "private, no-store").json({ photos: c.list }); });

  app.get("/api/public/photos/templates", (req, res) => { const kind = PHOTO_FOR.includes(req.query.kind) ? req.query.kind : "cover"; res.set("Cache-Control", "public, max-age=300").json({ kind, templates: templatesFor(kind) }); });

  // what's set now: the profile picture (page or account) and the page cover, with their originals and focal points
  const mine = (u) => { const h = C.profileOf(u.ws), t = h?.theme || {}, a = store.get(avatarPath(u.email))?.data || {};
    return { hasPage: !!h?.handle, handle: h?.handle || "", avatar: { url: t.avatarUrl || a.url || "", source: t.avatarSource || a.source || "", focus: t.avatarFocus || a.focus || null, art: t.avatarArt || a.art || "" }, page: { url: t.coverUrl || "", source: t.coverSource || "", focus: t.coverFocus || null, wash: t.cover || "" } }; };
  app.get("/api/photos/mine", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store").json(mine(u)); });

  // put a photo (or a template, or nothing) on the profile picture, the page cover or an event's cover
  app.post("/api/photos/use", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, kind = PHOTO_FOR.includes(b.for) ? b.for : "";
    if (!kind) return bad(res, "Say which photo: cover, page or avatar.");
    const url = String(b.url || ""), source = String(b.source || ""), focus = b.focus ? cleanFocus(b.focus) : null, template = String(b.template || "").slice(0, 40);
    if (url && !ownsBlob(u.ws, url)) return bad(res, "Pick one of your own photos.", 403, "not_yours");
    if (source && !ownsBlob(u.ws, source)) return bad(res, "Pick one of your own photos.", 403, "not_yours");
    if (template && !templatesFor(kind).some((t) => t.id === template)) return bad(res, "That template isn't one of ours.");
    if (kind === "cover") { const id = String(b.eventId || "").slice(0, 80), S = scopeStore(store, u.ws), ev = /^[A-Za-z0-9_-]{2,80}$/.test(id) ? S.get("events/" + id)?.data : null;
      if (!ev) return bad(res, "No such event.", 404, "not_found");
      const patch = url ? { coverPhoto: url, coverSource: source || url, coverFocus: focus, coverArt: null } : template ? { coverPhoto: "", coverSource: "", coverFocus: null, coverArt: { kind: template, tone: ev.coverArt?.tone || "" } } : { coverPhoto: "", coverSource: "", coverFocus: null };
      S.update("events/" + id, { ...patch, updatedAt: Date.now() }); return res.json({ ok: true, ...patch }); }
    const h = C.profileOf(u.ws);
    if (kind === "avatar") { const was = store.get(avatarPath(u.email))?.data || {}; store.set(avatarPath(u.email), { url, source: url ? source || url : "", focus: url ? focus : null, art: template || (url ? "" : was.art || ""), at: Date.now() });
      if (h?.handle) { const theme = { ...(h.theme || {}), avatarUrl: url, avatarSource: url ? source || url : "", avatarFocus: url ? focus : null, ...(template ? { avatarArt: template } : {}) }; const r = C.setProfile(u.ws, { theme }); if (r.error) return bad(res, r.error); }
      return res.json({ ok: true, ...mine(u) }); }
    if (!h?.handle) return bad(res, "Start your page first, then add its cover.", 400, "no_page");
    const theme = { ...(h.theme || {}), coverUrl: url, coverSource: url ? source || url : "", coverFocus: url ? focus : null, ...(template ? { cover: template } : {}) }; const r = C.setProfile(u.ws, { theme }); if (r.error) return bad(res, r.error);
    res.json({ ok: true, ...mine(u) }); });
  return { mine, avatarOf: (email) => store.get(avatarPath(email))?.data?.url || "" };
}
