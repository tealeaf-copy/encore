// A host's brand kit on the server: cleaned against a whitelist, stored on the host profile (host.brandKit), and handed to
// every page that shows the host. The pairings, starter kits and contrast rules live in public/brandkit.js (with
// public/color.js), loaded here in a vm so the server and the pages agree.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { getWorkspace } from "./workspaces.js";

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(PUB, "color.js"), "utf8"), ctx, { filename: "color.js" });
vm.runInContext(fs.readFileSync(path.join(PUB, "brandkit.js"), "utf8"), ctx, { filename: "brandkit.js" });
export const BK = ctx.EncoreBrandKit;
const COLOR = ctx.EncoreColor;
export const PAIRS = BK.PAIRS, STARTERS = BK.STARTERS;

const LOGO_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "");
const hex = (v) => COLOR.norm(v);
/** A voice line: one plain line, no markup, no em dashes (docs/brand-kit.md), at most 80 characters. */
export const cleanVoice = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Keep only known values: a listed pairing, hex colours (ink fixed to read at 4.5:1 on the page and cards, the page kept
 *  light), the listed corner, button and cover styles, a logo from the blob store, a voice line. Unknown keys are dropped.
 *  Missing values come from the current kit, then the house kit. */
export function cleanKit(k, cur) {
  if (!k || typeof k !== "object" || Array.isArray(k)) return cur || null;
  const base = cur && PAIRS[cur.pair] ? cur : BK.starter("house");
  const st = STARTERS[k.starter] ? k.starter : "";
  const from = st && k.fromStarter === true ? BK.starter(st) : null; // { starter, fromStarter: true } takes the whole starter kit
  const src = from || k;
  const one = (key, list) => (list.includes(src[key]) ? src[key] : list.includes(base[key]) ? base[key] : list[0]);
  const out = { v: 1, pair: PAIRS[src.pair] && BK.bodyOk(PAIRS[src.pair]) ? src.pair : base.pair, page: hex(src.page) || base.page, surface: hex(src.surface) || base.surface, ink: hex(src.ink) || base.ink, accent: hex(src.accent) || base.accent,
    accent2: src.accent2 === "" ? "" : hex(src.accent2) || base.accent2 || "", corners: one("corners", BK.ENUMS.corners), buttons: one("buttons", BK.ENUMS.buttons), cover: one("cover", BK.ENUMS.cover),
    logo: k.logo === "" ? "" : LOGO_OK(k.logo) ? k.logo : LOGO_OK(base.logo) ? base.logo : "", voice: "voice" in k ? cleanVoice(k.voice) : cleanVoice(base.voice), starter: st, at: Date.now() };
  // AA: what's stored is what's drawn
  const T = BK.derive(out); out.page = T.page; out.surface = T.surface; out.ink = T.ink;
  return out;
}
/** The kit to draw for a host: the saved one, else the one their page theme already draws (so nothing jumps). */
//  events: the host page's events, so a page that never picked a theme matches its latest event's look, as it does today
export const kitOf = (h, events) => (h ? (h.brandKit && PAIRS[h.brandKit.pair] ? h.brandKit : BK.fromTheme(BK.themeOf(h, events))) : null);
/** A kit made only of plain values, for JSON (the vm's objects are copied out). */
export const kitJson = (h, events) => { const k = kitOf(h, events); return k ? JSON.parse(JSON.stringify(k)) : null; };
/** Migration: an existing host's kit, derived from their page theme and font (and, for an untouched page, its events' look). */
export const migrateKit = (h, events) => JSON.parse(JSON.stringify(kitOf(h, events)));
/** A suggested starter for a host who hasn't saved a kit: from their first event's look, else what they host. */
export const suggestKit = (h, events) => JSON.parse(JSON.stringify(BK.suggest(h, events)));
/** The variables for a kit, as CSS text ("--kit-page:#F4F0E8;..."). */
export const kitCss = (k) => BK.cssText(k);

const escA = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** For server-rendered pages that show one host (the light invite, /x/<handle>/... pages): put this in <head>.
 *  It loads the kit's two fonts, sets the --kit-* variables on <html> before anything paints, and hands the kit to
 *  public/brandkit.js (which maps it into the design tokens through public/brandkit.css). */
export function brandKitHead(h, { script = true, events = null, kit = null, compact = false } = {}) {
  const k = kit || kitOf(h, events); if (!k) return "";
  // compact (the light invite, which stays under 40,000 characters): nothing for the house kit, which the page already
  // wears, and no inline variables, since public/brandkit.js sets them from the kit before the body draws
  if (compact && BK.isHouse(k)) return "";
  const F = BK.fonts(k), keep = ["pair", "page", "surface", "ink", "accent", "accent2", "corners", "buttons", "cover", "logo"];
  // compact: public/brandkit.js loads the two fonts and brandkit.css itself, from <head>, before the body draws
  if (compact) return `<meta name="theme-color" content="${escA(BK.derive(k).page)}"><script>window.__encoreKit=${JSON.stringify(Object.fromEntries(keep.filter((x) => k[x]).map((x) => [x, k[x]]))).replace(/</g, "\\u003c")}</script><script src="/brandkit.js"></script>`;
  const json = JSON.stringify(Object.fromEntries(keep.filter((x) => k[x] != null && k[x] !== "").map((x) => [x, k[x]]))).replace(/</g, "\u003c");
  return `<meta name="theme-color" content="${escA(BK.derive(k).page)}"><link rel="stylesheet" href="${escA(F.href)}"><link rel="stylesheet" href="/brandkit.css" id="bk-css">` + (compact ? "" : `<style>html{${BK.cssText(k)}}</style>`) +
    (script ? `<script>window.__encoreKit=${json}</script><script src="/brandkit.js"></script>` : "");
}
/** The class list for <html> on a server-rendered page. */
export const brandKitClass = (h, events) => BK.classes(kitOf(h, events)).join(" ");

// ---- emails to guests: the host's accent and logo ----
/** What a guest email wears: the host's name, accent (darkened until it reads on white) and logo. */
export function emailBrand(h) { if (!h) return null; const k = kitOf(h), T = BK.derive(k), accent = COLOR.contrast(T.btn, "#FFFFFF") >= 4.5 ? T.btn : T.accentText;
  return { name: String(h.name || "").slice(0, 60), accent, logo: LOGO_OK(k.logo) ? k.logo : "", handle: h.handle || "" }; }
const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** A plain-text email as simple HTML: a bar in the host's accent, their logo or name, the text with its links. */
export function emailHtml(text, brand, origin = "") {
  const base = String(origin || process.env.ENCORE_PUBLIC_URL || "").replace(/\/$/, ""), a = /^#[0-9A-F]{6}$/i.test(brand?.accent || "") ? brand.accent : "#9A4128";
  const link = (s) => s.replace(/https?:\/\/[^\s<>"]+[^\s<>".,)!?]/g, (u) => `<a href="${u}" style="color:${a};font-weight:600">${u}</a>`);
  const paras = escH(String(text || "")).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.5">${link(p).replace(/\n/g, "<br>")}</p>`).join("");
  const logo = brand?.logo && base ? `<img src="${escH(base + brand.logo)}" alt="${escH(brand.name || "")}" height="40" style="display:block;height:40px;width:auto;max-width:200px">` : brand?.name ? `<b style="font-size:18px;color:#1D1B18">${escH(brand.name)}</b>` : "";
  return `<!doctype html><html><body style="margin:0;background:#F4F0E8"><div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-top:4px solid ${a};font:16px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1D1B18">` +
    `${logo ? `<div style="padding:20px 24px 4px">${logo}</div>` : ""}<div style="padding:16px 24px 8px">${paras}</div></div></body></html>`;
}

// ---- the API: the signed-in host's kit, a suggestion, and saving ----
export function mountBrandKit(app, { small, ownerOnly, C, assetsDir }) {
  app.get("/api/host/brandkit", (req, res) => { const u = ownerOnly(req, res); if (!u) return; const h = C.profileOf(u.ws); res.set("Cache-Control", "private, no-store");
    let events = []; try { events = [...C.eventsOf(u.ws, { upcoming: false, discoverableOnly: false, owner: true }), ...C.eventsOf(u.ws, { discoverableOnly: false, owner: true })]; } catch {}
    res.json({ kit: h ? (C.kitOf ? C.kitOf(u.ws) : kitJson(h)) : JSON.parse(JSON.stringify(BK.starter("house"))), saved: !!h?.brandKit, suggest: h?.brandKit ? null : suggestKit(h, events), handle: h?.handle || "", name: h?.name || "" }); });
  app.post("/api/host/brandkit", small, async (req, res) => { const u = ownerOnly(req, res); if (!u) return; const W = getWorkspace(u.ws), h = W?.host;
    if (!h?.handle) return res.status(400).json({ code: "no_page", message: "Start your page first, then pick a brand kit." });
    const b = req.body || {};
    // a logo must be an image this workspace uploaded (png, jpeg or webp; no svg), at most 2 MB
    if (b.logo) { const id = String(b.logo).replace(/^\/_blob\//, ""); let meta = null;
      if (!LOGO_OK(b.logo)) return res.status(400).json({ code: "invalid", message: "Upload the logo as a PNG, JPEG or WebP image." });
      try { meta = JSON.parse(await fsp.readFile(path.join(assetsDir, id + ".json"), "utf8")); } catch {}
      if (!meta || !/^image\/(png|jpeg|webp)$/i.test(String(meta.contentType || "").split(";")[0].trim()) || +meta.sizeBytes > 2 * 1024 * 1024 || (meta.ws && meta.ws !== u.ws)) return res.status(400).json({ code: "invalid", message: "Upload the logo as a PNG, JPEG or WebP image, up to 2 MB." }); }
    const kit = b.reset ? null : cleanKit(b, h.brandKit || (C.kitOf ? C.kitOf(u.ws) : migrateKit(h)));
    const r = C.setProfile(u.ws, { ...h, brandKit: kit, ...(kit && "voice" in b ? { tagline: kit.voice || h.tagline } : {}) });
    if (r.error) return res.status(400).json({ code: "invalid", message: r.error });
    res.json({ ok: true, kit: kitJson(r.host), saved: !!r.host.brandKit }); });
}
