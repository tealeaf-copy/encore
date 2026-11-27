// One cover per event, everywhere (server/cover.js is the cover photo upload): the host's photo (with its focus point) when there is one, else the drawn cover's
// recipe from public/eventart.js (EventArt.spec: kind, tone and the scene's kinds), worked out here with that same file.
// Every API that sends an event for a page to draw (the invite, the feed, Discover, Plans, the host page, chats,
// Library) adds `coverSpec: coverOf(ev, id)`, and the page draws EventArt.thumb(e) or EventArt.cover(e), which read it: a small
// card is the same picture as the big cover, never a different drawing or an emoji. Link previews pick their
// illustration from the same recipe (server/app.js ogCardFor).
// A drop with no cover photo of its own shows its first item's photo, as its order page does.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
let EA = null;
const art = () => { if (EA) return EA; try { const box = { window: {}, document: undefined }; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "eventart.js"), "utf8"), box, { timeout: 1000 }); EA = box.window.EventArt; } catch { EA = null; } return EA; };
const PHOTO = (u) => (/^\/_blob\/[A-Za-z0-9_-]{6,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "") ? u : "");
const focusOf = (f) => (f && Number.isFinite(+f.x) && Number.isFinite(+f.y) ? { x: Math.max(0, Math.min(100, Math.round(+f.x))), y: Math.max(0, Math.min(100, Math.round(+f.y))) } /* percent, as server/photos.js cleanFocus keeps it */ : null);

/** The cover of an event (its stored data; id helps pick a steady tone): { photo, focus } or { art: { kind, tone, scene } }. */
export function coverOf(ev = {}, id = "") {
  const e = ev || {}, photo = PHOTO(e.coverPhoto);
  if (photo) return { photo, focus: focusOf(e.coverFocus) };
  if (e.drop) { const it = (e.orderItems || e.items || []).map((x) => PHOTO((x?.photos || [])[0] || x?.photo)).find(Boolean); if (it) return { photo: it, focus: null }; }
  const A = art(); if (!A?.spec) return { art: null };
  try { const s = A.spec({ ...e, id: e.id || id, title: e.pubTitle || e.title || e.name || "" }); return { art: { kind: String(s.kind), tone: String(s.tone), ...(s.scene ? { scene: Array.from(s.scene, String) } : {}), ...(s.custom ? { custom: true } : {}) } }; } catch { return { art: null }; }
}
/** Two covers are the same picture: the same photo, or the same drawing. */
export const sameCover = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
