// The scrapbook: a host's past gatherings as a yearbook, including ones they hosted before Pottery Lab.
// Hosts import them from Partiful, Luma and Eventbrite links (we read the page's title, date, place and cover image,
// and keep our own copy of the image), from a CSV, or by hand, and add photos and a note to each.
// Link reading only talks to those three sites, over https, with a short timeout and a size cap.
import crypto from "node:crypto";
import { scopeStore, DEFAULT_WS } from "./workspaces.js";

const SITES = [/(^|\.)partiful\.com$/i, /(^|\.)lu\.ma$/i, /(^|\.)luma\.com$/i, /(^|\.)eventbrite\.[a-z.]{2,8}$/i];
const MAX_PAGE = 1_500_000, MAX_IMG = 6_000_000, MAX_ITEMS = 200;
const clean = (s, n) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const sourceOf = (host) => (/partiful/i.test(host) ? "Partiful" : /lu\.ma|luma/i.test(host) ? "Luma" : /eventbrite/i.test(host) ? "Eventbrite" : "");
const isoDate = (v) => { const s = String(v || "").trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const t = Date.parse(s); return isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ""; };

/** Is this a link we're willing to read? */
export function importable(u) { try { const x = new URL(String(u).trim()); return x.protocol === "https:" && SITES.some((re) => re.test(x.hostname)) ? x : null; } catch { return null; } }
// images can live on any CDN, but never on a private address
function safeImageUrl(u) { try { const x = new URL(u); if (x.protocol !== "https:") return null; const h = x.hostname; if (/^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^[\d.]+$/.test(h) || h.includes(":") || /^\[/.test(h)) return null; return x; } catch { return null; } }

async function fetchCapped(url, limit, accept) { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 7000);
  try { const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "PotteryLabBot/1.0 (+portfolio import)", accept } }); if (!r.ok) return null;
    const reader = r.body?.getReader(); if (!reader) return null; const chunks = []; let n = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > limit) { ctl.abort(); return null; } chunks.push(value); }
    return { buf: Buffer.concat(chunks), type: r.headers.get("content-type") || "", finalUrl: r.url }; } catch { return null; } finally { clearTimeout(t); } }

/** Read what a public event page says about itself (Open Graph and schema.org Event data). */
export function parseEventPage(html, url = "") {
  const meta = (p) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, "i")); return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : ""; };
  let ld = {}; for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { const j = JSON.parse(m[1]); const L = Array.isArray(j) ? j : j["@graph"] || [j]; const e = L.find((x) => /Event/i.test(String(x?.["@type"] || ""))); if (e) { ld = e; break; } } catch {} }
  const loc = ld.location || {}, addr = typeof loc.address === "string" ? loc.address : [loc.address?.addressLocality, loc.address?.addressRegion].filter(Boolean).join(", ");
  const image = Array.isArray(ld.image) ? ld.image[0] : typeof ld.image === "object" ? ld.image?.url : ld.image;
  return { title: clean(ld.name || meta("og:title") || (html.match(/<title>([^<]*)<\/title>/i) || [])[1], 140), date: isoDate(ld.startDate || meta("event:start_time") || meta("og:event:start_time")),
    place: clean(loc.name || addr || "", 120), about: clean(ld.description || meta("og:description") || meta("description"), 400), image: String(image || meta("og:image") || "").trim(), url };
}

export function mountScrapbook(app, { store, small, currentUser, C, saveImage }) {
  const S = (ws) => scopeStore(store, ws);
  const me = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const list = (ws) => S(ws).list("scrapbook").map((d) => ({ id: String(d.id).split("/").pop(), ...d.data })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.at || 0) - (a.at || 0));
  const save = (ws, item) => { const id = item.id || crypto.randomBytes(6).toString("hex"); const v = { title: clean(item.title, 140) || "A gathering", date: isoDate(item.date), place: clean(item.place, 120), guests: Math.max(0, Math.min(10000, Math.round(+item.guests || 0))) || 0,
      note: clean(item.note, 400), about: clean(item.about, 400), source: ["Partiful", "Luma", "Eventbrite", "CSV", ""].includes(item.source) ? item.source : "", link: importable(item.link)?.href || "",
      photos: (Array.isArray(item.photos) ? item.photos : []).filter((u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u)).slice(0, 12), cover: /^\/_blob\/[A-Za-z0-9]{20}$/.test(item.cover || "") ? item.cover : "", at: item.at || Date.now() };
    S(ws).set("scrapbook/" + id, v); return { id, ...v }; };
  const keepImage = async (src, ws) => { const x = safeImageUrl(src); if (!x) return ""; const r = await fetchCapped(x.href, MAX_IMG, "image/*"); if (!r || !/^image\/(png|jpe?g|webp|gif)/i.test(r.type)) return ""; try { return (await saveImage(r.buf, r.type.split(";")[0], ws)) || ""; } catch { return ""; } };

  // the public scrapbook: imported gatherings plus the ones hosted here
  app.get("/api/public/host/:handle/scrapbook", (req, res) => { const ws = C.wsOfHandle(String(req.params.handle || "").toLowerCase()); if (!ws) return res.json({ items: [] });
    res.json({ items: list(ws).map(({ id, title, date, place, guests, note, about, source, link, photos, cover }) => ({ id, title, date, place, guests, note, about, source, link, photos, cover })) }); });
  app.get("/api/host/scrapbook", (req, res) => { const u = me(req, res); if (!u) return; res.json({ items: list(u.ws) }); });
  // import: links (Partiful, Luma, Eventbrite), CSV rows already parsed by the page, or one by hand
  app.post("/api/host/scrapbook/import", small, async (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, out = [], skipped = [];
    if (list(u.ws).length >= MAX_ITEMS) return res.status(400).json({ code: "limit", message: "Your scrapbook is full (200 gatherings)." });
    const have = new Set(list(u.ws).map((x) => x.link).filter(Boolean));
    for (const raw of (Array.isArray(b.links) ? b.links : []).slice(0, 15)) { const x = importable(raw); if (!x) { skipped.push({ link: clean(raw, 200), why: "Only Partiful, Luma and Eventbrite links can be read." }); continue; } if (have.has(x.href)) { skipped.push({ link: x.href, why: "Already in your scrapbook." }); continue; }
      const page = await fetchCapped(x.href, MAX_PAGE, "text/html"); const info = page ? parseEventPage(page.buf.toString("utf8"), x.href) : { title: "", url: x.href };
      const slugTitle = decodeURIComponent(x.pathname.split("/").filter(Boolean).pop() || "").replace(/[-_]+/g, " ").replace(/\b[a-z0-9]{8,}\b/gi, "").trim();
      const cover = info.image ? await keepImage(info.image, u.ws) : "";
      out.push(save(u.ws, { title: info.title || slugTitle || `My ${sourceOf(x.hostname)} event`, date: info.date, place: info.place, about: info.about, source: sourceOf(x.hostname), link: x.href, cover, photos: cover ? [cover] : [] })); have.add(x.href); }
    for (const r of (Array.isArray(b.rows) ? b.rows : []).slice(0, 100)) { if (!clean(r?.title, 140)) continue; out.push(save(u.ws, { ...r, source: "CSV", photos: [] })); }
    if (b.item && clean(b.item.title, 140)) out.push(save(u.ws, { ...b.item, source: b.item.source || "" }));
    res.json({ added: out, skipped }); });
  app.post("/api/host/scrapbook/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id).replace(/[^a-f0-9]/g, ""); const cur = S(u.ws).get("scrapbook/" + id)?.data; if (!cur) return res.status(404).json({ code: "not_found", message: "Not in your scrapbook." });
    res.json({ item: save(u.ws, { ...cur, ...req.body, id, source: cur.source, link: cur.link, at: cur.at }) }); });
  app.delete("/api/host/scrapbook/:id", (req, res) => { const u = me(req, res); if (!u) return; const id = String(req.params.id).replace(/[^a-f0-9]/g, ""); S(u.ws).delete("scrapbook/" + id); res.json({ ok: true }); });
}
