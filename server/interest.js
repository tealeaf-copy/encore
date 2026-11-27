// ---- one page per thing: /x/<handle>/<id> (a team experience, a gift or "any") and /x/<handle>/shop/<id> ----
// Every story and feed button lands somewhere a person can act right away (server/feedvisual.js eventCta/afterCta):
// an event on its light invite (/e/<id>), and a host's experience or shop item on its own page, made here:
// - a real host who takes team requests: "Book for your team", the same request /api/public/book/:handle takes
// - a real host's open shop: "Order", the same order /api/public/order/:handle takes
// - a preview (showcase) host who hasn't joined: "I'm interested". Name, email, an optional team size or quantity and
//   note, stored here per handle (system/interest-<handle>): validated, rate-limited, emails and phone numbers scrubbed
//   from notes, capped. The preview host is never emailed (they haven't joined).
// When a workspace later takes that handle, the people who asked get one email with a link, and the host sees
// "N people asked about Matcha workshop" (GET /api/host/interest: their Home and their page's owner view).
// Admins (ENCORE_ADMIN_EMAILS) list everything at GET /api/admin/interest and /admin/interest.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { DEFAULT_WS, getWorkspace, scopeStore } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { isAdmin } from "./metrics.js";
import { PREVIEW_LABEL } from "./previews.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const lc = (s) => String(s || "").trim().toLowerCase();
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const scrub = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
const EMAIL_OK = (e) => /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e || "");
const HANDLE_OK = (h) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(h || "");
const e = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
export const INTEREST_CAP = 1000; // people per handle
const KEY = (h) => "system/interest-" + h;
// a price as brands read it (docs/brand-kit.md): "$60" is "$60 a person", "from $45 a person" starts with a capital
const priceOf = (p) => { let s = clean(p, 50).replace(/\s*(\/\s*(person|head|pp)|per (person|head)|\bpp\b)\.?$/i, " a person"); if (/^\$?\s*\d[\d,]*(\.\d{1,2})?$/.test(s)) s = "$" + s.replace(/^\$\s*/, "") + " a person"; return s ? s[0].toUpperCase() + s.slice(1) : ""; };
/** The name to use in a sentence: a person's first name, "Ken" for "Ken's Sourdough", else the page's name. */
export const firstOf = (P) => { const p = clean(P?.person, 60), n = clean(P?.name, 60); if (p) return p.split(/\s+/)[0]; const m = n.match(/^(\S+?)['’]s\b/); if (m) return m[1]; return n.split(/\s+/).length === 1 ? n : n || "This host"; };

// the illustrated covers (public/eventart.js), drawn here so the page needs no script for its art
let EA = null, EA_CSS = "";
try { const sandbox = { window: {}, document: { head: { appendChild(s) { EA_CSS = s?.textContent || EA_CSS; } }, createElement: () => ({ style: {} }), getElementById: () => null, querySelector: () => null } };
  sandbox.window.document = sandbox.document; vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "eventart.js"), "utf8"), sandbox); EA = sandbox.window.EventArt || null; } catch {}

export function mountInterest(app, { store, small, currentUser, C, X, publicOrigin }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + "|" + req.path.split("/").slice(0, 4).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50_000) hits.clear(); return ++h.n > n; };

  // ---------- what one handle offers: the preview page's things, or the real host's ----------
  function thingsOf(handle) { handle = lc(handle); if (!HANDLE_OK(handle)) return null;
    const ws = C.wsOfHandle(handle), real = ws && C.profileOf(ws), P = real || C.showcaseOf(handle); if (!P) return null;
    const preview = !real, M = new Map();
    (P.experiences || []).forEach((x, i) => { const id = String(x.id || "x" + i); M.set(id, { key: id, kind: "exp", id, title: clean(x.name, 100), desc: clean(x.desc, 400), emoji: clean(x.emoji, 8), price: priceOf(x.price), min: +x.min || 0, max: +x.max || 0, length: clean(x.length, 40), travels: !!x.travels,
      includes: (Array.isArray(x.includes) ? x.includes : []).map((t) => clean(t, 120)).filter(Boolean).slice(0, 10), runOfShow: (Array.isArray(x.runOfShow) ? x.runOfShow : []).map((t) => clean(t, 160)).filter(Boolean).slice(0, 12), allIn: clean(x.allIn, 200), photo: /^\/_blob\/[A-Za-z0-9]{20}$/.test(x.photo || "") ? x.photo : "", category: clean(x.category, 30),
      setup: clean(x.setup, 200), access: clean(x.access, 140), dietary: clean(x.dietary, 140), hybrid: clean(x.hybrid, 140), branding: clean(x.branding, 160), goals: Array.isArray(x.goals) ? x.goals.map((g) => clean(g, 20)) : [] }); });
    (P.gifts || []).forEach((g, i) => { const id = String(g.id || "g" + i); M.set(id, { key: id, kind: "gift", id, title: clean(g.name, 100), desc: clean(g.desc, 400), emoji: clean(g.emoji, 8), price: g.cents ? money(g.cents) + " each" : "", lead: clean(g.lead, 40), minQty: +g.minQty || 0, includes: (g.personalize || []).map((t) => clean(t, 120)).filter(Boolean).slice(0, 8), runOfShow: [], allIn: clean(g.allIn, 200), ships: clean(g.ships, 80), photo: /^\/_blob\/[A-Za-z0-9]{20}$/.test(g.photo || "") ? g.photo : "" }); });
    (P.shop?.items || []).forEach((x, i) => { const id = preview ? String(i) : String(x.id || i); M.set("shop:" + id, { key: "shop:" + id, kind: "shop", id, title: clean(x.name, 100), desc: clean(x.desc, 300), emoji: clean(x.emoji, 8), price: x.cents ? money(x.cents) : "", cents: +x.cents || 0, max: +x.max || 6, includes: [], runOfShow: [], photo: /^\/_blob\/[A-Za-z0-9]{20}$/.test(x.photo || "") ? x.photo : "" }); });
    if (preview) M.set("any", { key: "any", kind: "any", id: "any", title: `Something from ${clean(P.name, 60)}`, desc: clean(P.bio || P.tagline, 400), emoji: clean(P.emoji, 8), price: "", includes: [], runOfShow: [] });
    return { handle, ws: ws || "", P, preview, items: M, sample: !!ws && /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "") }; }
  const urlOf = (handle, it) => it.kind === "shop" ? `/x/${handle}/shop/${encodeURIComponent(it.id)}` : `/x/${handle}/${encodeURIComponent(it.id)}`;

  // ---------- storage: one document per handle ----------
  const docOf = (handle) => store.get(KEY(handle))?.data || null;
  function addInterest(handle, it, who, origin) { const d = docOf(handle) || { kind: "interest", handle, list: [], items: {} };
    const i = d.list.findIndex((x) => x.email === who.email && x.item === it.key);
    const row = { item: it.key, title: it.title, name: who.name, email: who.email, size: who.size, note: who.note, at: Date.now() };
    if (i >= 0) d.list[i] = { ...d.list[i], ...row }; else { if (d.list.length >= INTEREST_CAP) return { full: true }; d.list.push(row); }
    d.items[it.key] = it.title; d.origin = origin || d.origin || ""; d.updatedAt = Date.now(); store.set(KEY(handle), d); return { ok: true, again: i >= 0 }; }

  // ---------- after a claim: the people who asked hear once, when that thing can be booked or ordered on the real page ----------
  // Checked whenever the page saves (its handle is written each time): a row is ready once the same thing (by name) is on
  // the page and takes requests (an experience while the host is open to team requests, a shop item while the shop is
  // open, a gift), or right away for "anything from this host". Each row is told once; one email per person.
  const sending = new Set();
  const readyOf = (T, P, r) => { if (r.item === "any") return { url: `/@${T.handle}` }; const it = [...T.items.values()].find((x) => (r.item.startsWith("shop:") ? x.kind === "shop" : x.kind !== "shop") && lc(x.title) === lc(r.title)); if (!it) return null;
    if (it.kind === "exp" && !P.forHire) return null; if (it.kind === "shop" && !P.shop?.open) return null; return { url: urlOf(T.handle, it) }; };
  async function tellOnClaim(handle) { const d0 = docOf(handle); if (!d0 || d0.toldAt || sending.has(handle)) return 0; const ws = C.wsOfHandle(handle), P = ws && C.profileOf(ws), T = P && thingsOf(handle); if (!P || !T || T.preview) return 0;
    sending.add(handle); try {
      const origin = String(process.env.ENCORE_PUBLIC_URL || d0.origin || "").replace(/\/+$/, ""), cfg = emailConfig(DEFAULT_WS, true), nm = clean(P.name, 60) || handle;
      const people = new Map(); for (const r of d0.list) { if (r.told) continue; const R = readyOf(T, P, r); if (!R) continue; (people.get(r.email) || people.set(r.email, []).get(r.email)).push({ r, url: R.url }); }
      let n = 0; const told = new Set();
      for (const [email, rows] of people) { const lines = rows.map((x) => `${x.r.title}: ${origin}${x.url}`);
        const ok = cfg && (!X?.canEmail || X.canEmail(email)) ? (await sendEmail(cfg, { list: "guest", origin, to: email, subject: `${nm} is on Pottery Lab now`, fromName: "Pottery Lab",
          text: `Hi ${clean(rows[0].r.name, 40).split(/\s+/)[0] || "there"},\n\nYou asked about ${rows.map((x) => x.r.title).join(" and ")}. ${nm} is on Pottery Lab now, so you can ask them directly:\n\n${lines.join("\n")}\n\nWe said we'd tell you once, so this is the only email about it.` }).catch(() => ({}))).ok : false;
        if (ok) n++; for (const x of rows) told.add(email + "|" + x.r.item); }
      // written onto the latest copy, so someone who asked while the emails went out isn't lost
      const d = docOf(handle) || d0; for (const r of d.list) if (told.has(r.email + "|" + r.item)) r.told = true;
      store.set(KEY(handle), { ...d, ws, ...(d.list.every((r) => r.told) ? { toldAt: Date.now() } : {}) }); return n;
    } finally { sending.delete(handle); } }
  // a handle being taken (system/handle-<h>, written when a page saves): tell the people who asked about it
  store.events?.on?.("change", (ev) => { const m = /^system\/handle-([a-z0-9][a-z0-9-]{1,39})$/.exec(String(ev?.path || "")); if (!m) return; const h = m[1], d = docOf(h); if (!d || d.toldAt) return;
    setTimeout(() => { tellOnClaim(h).catch(() => {}); }, 30); });

  // ---------- POST: "I'm interested" on a preview page ----------
  app.post("/api/public/interest/:handle", small, (req, res) => {
    if (limited(req, Math.max(1, +process.env.ENCORE_INTEREST_PER_IP_HOUR || 8))) return bad(res, "That's a lot from here. Try again in an hour.", 429, "rate_limited");
    const b = req.body || {}; if (b.website) return res.json({ ok: true }); // a form field people never see: bots fill it in
    const T = thingsOf(req.params.handle); if (!T) return bad(res, "No page by that name.", 404, "not_found");
    const it = T.items.get(clean(b.item, 60)); if (!it) return bad(res, "Pick something on the page.", 404, "not_found");
    if (!T.preview) return bad(res, `${firstOf(T.P)} is on Pottery Lab now, so you can ask them directly.`, 409, "claimed");
    const name = clean(b.name, 80), email = lc(clean(b.email, 200)), size = Math.max(0, Math.min(5000, Math.round(+b.size || 0))), note = scrub(clean(b.note, 500));
    if (!name) return bad(res, "Add your name."); if (!EMAIL_OK(email)) return bad(res, "Add an email we can reach you at.");
    if (b.size != null && b.size !== "" && !(Number.isFinite(+b.size) && +b.size >= 0)) return bad(res, "Add a number, or leave it blank.");
    const r = addInterest(T.handle, it, { name, email, size, note }, publicOrigin(req)); if (r.full) return bad(res, "This page has a long list already. Check back soon.", 409, "full");
    res.json({ ok: true, again: !!r.again, first: firstOf(T.P) }); });

  // ---------- the host: "N people asked about Matcha workshop" ----------
  app.get("/api/host/interest", (req, res) => { res.set("Cache-Control", "private, no-store"); const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) return bad(res, "Sign in first.", 401, "unauthenticated");
    const P = C.profileOf(u.ws); if (!P?.handle) return res.json({ total: 0, items: [] }); const d = docOf(P.handle); if (!d || C.wsOfHandle(P.handle) !== u.ws) return res.json({ total: 0, items: [] });
    if (!d.toldAt) tellOnClaim(P.handle).catch(() => {});
    const T = thingsOf(P.handle), N = new Map(); for (const r of d.list) N.set(r.title, (N.get(r.title) || 0) + 1);
    const items = [...N].map(([title, n]) => { const it = [...(T?.items.values() || [])].find((x) => lc(x.title) === lc(title)); return { title, n, line: `${n} ${n === 1 ? "person" : "people"} asked about ${title}`, url: it ? urlOf(P.handle, it) : "" }; }).sort((a, b) => b.n - a.n);
    res.json({ total: new Set(d.list.map((r) => r.email)).size, items, told: !!d.toldAt }); });

  // ---------- admins: everything ----------
  const admin = (req) => { const u = currentUser(req); return u && isAdmin(u.email) ? u : null; };
  const allInterest = () => (store.listPrefix ? store.listPrefix("system", "interest-") : []).map((d) => d.data).filter((d) => d?.kind === "interest");
  app.get("/api/admin/interest", (req, res) => { if (!admin(req)) return bad(res, "Not found.", 404, "not_found"); res.set("Cache-Control", "private, no-store");
    res.json({ handles: allInterest().map((d) => ({ handle: d.handle, claimed: !!C.wsOfHandle(d.handle), toldAt: d.toldAt || 0, count: d.list.length, list: d.list.slice().sort((a, b) => b.at - a.at) })).sort((a, b) => b.count - a.count) }); });
  app.get("/admin/interest", (req, res) => { if (!admin(req)) return res.status(404).type("text").send("Not found."); res.set("Cache-Control", "private, no-store");
    const H = allInterest().sort((a, b) => b.list.length - a.list.length);
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interest · Pottery Lab</title><meta name="robots" content="noindex"><style>body{font:15px/1.5 system-ui,sans-serif;color:#1B1D1C;background:#FAF8F3;max-width:960px;margin:0 auto;padding:16px}table{width:100%;border-collapse:collapse;margin:8px 0 24px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #CFC8B9;vertical-align:top}h2{margin:20px 0 4px}small{color:#444845}</style></head><body><h1>People who asked</h1><p><small>From preview pages: "I'm interested". The preview host is never emailed; people who asked get one email when someone takes the handle.</small></p>
${H.length ? H.map((d) => `<h2>@${e(d.handle)} <small>${d.list.length} · ${C.wsOfHandle(d.handle) ? "claimed" : "not claimed"}${d.toldAt ? " · told " + new Date(d.toldAt).toISOString().slice(0, 10) : ""}</small></h2><div style="overflow-x:auto"><table><tr><th>When</th><th>What</th><th>Name</th><th>Email</th><th>Size</th><th>Note</th></tr>${d.list.slice().sort((a, b) => b.at - a.at).map((r) => `<tr><td>${e(new Date(r.at).toISOString().slice(0, 10))}</td><td>${e(r.title)}</td><td>${e(r.name)}</td><td>${e(r.email)}</td><td>${r.size || ""}</td><td>${e(r.note)}</td></tr>`).join("")}</table></div>`).join("") : "<p>Nobody yet.</p>"}</body></html>`); });

  // ---------- the page ----------
  // A calm magazine page in the Field Notes kit (docs/brand-kit.md), top to bottom: a quiet header (the mark, Help); the
  // title in the serif (never an emoji: the host's emoji stays out of the heading); "Hosted by" with the host's page and
  // neighbourhood; the host's own photo full-bleed on a phone (4:5, the platform's cover crop; whole on a computer) (the thing's photo, else their cover or gallery, else a
  // photo from their past events), with a credit line; a facts table (price, group size, length, where, kudos); a
  // three-line intro with Read more; one row of actions (one primary, then Save to list, Share, Follow); What's included,
  // Run of show and Good to know as ruled sections; kudos; the request card (or its compact thanks); more from the host.
  // The drawn cover shows only when the host has no photo at all, and never with a kind label ("Market", "Hangout").
  // Every field is 17px so iOS never zooms in on focus: the zoom that left the thanks state wider than the screen.
  const baseOf = (it) => ({ id: it.key, name: it.title, pubTitle: it.title, title: it.title, activity: `${it.title} ${it.category || ""}` });
  const kindOf = (it) => { try { return String(EA.kindOf(baseOf(it)) || "party").split("+")[0]; } catch { return "party"; } };
  const PHOTO_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || (/^\/presets\/[a-z0-9][a-z0-9_-]{0,70}\.(jpe?g|png|webp)$/i.test(u || "") && fs.existsSync(path.join(PUBLIC, u)));
  const words = (s) => new Set(lc(s).split(/[^a-z0-9À-ɏ]+/).filter((w) => w.length > 2 && !/^(the|and|for|your|with|our)$/.test(w)));
  /** The host's own photo for this thing: its photo, else the past event that shares the most words with it, else the
   *  page cover or the first gallery photo, else any past event's photo. "" when the host has none. */
  function photoOf(P, it) { if (PHOTO_OK(it.photo)) return it.photo;
    const W = words(it.title), past = [...(Array.isArray(P.scrapbook) ? P.scrapbook : []), ...(Array.isArray(P.past) ? P.past : [])].map((x) => ({ title: x?.title, cover: [x?.cover, x?.photo, ...(Array.isArray(x?.photos) ? x.photos : [])].find(PHOTO_OK) })).filter((x) => x.cover);
    const best = past.map((x) => ({ u: x.cover, n: [...words(x.title)].filter((w) => W.has(w)).length })).sort((a, b) => b.n - a.n)[0];
    if (best?.n) return best.u;
    return [P.theme?.coverUrl, ...(Array.isArray(P.gallery) ? P.gallery : []), best?.u].find(PHOTO_OK) || ""; }
  const ogFor = (it, photo, base) => { if (photo) return base + photo; const k = EA ? kindOf(it) : "party"; try { return fs.existsSync(path.join(PUBLIC, "og", k + ".png")) ? `${base}/og/${k}.png` : `${base}/og/party.png`; } catch { return ""; } };
  const drawn = (it) => { try { return EA ? EA.cover({ ...baseOf(it), coverArt: { kind: kindOf(it) } }, { title: "", label: "" }) : ""; } catch { return ""; } };
  // kudos on a real host's page (the same records the host page shows); none on a preview page
  function kudosOf(T) { if (T.preview || !T.ws || T.P.sections?.kudos === false || T.P.directory === false) return null;
    try { const K = scopeStore(store, T.ws).list("kudos").map((d) => d.data).filter((k) => k && typeof k === "object" && (k.love || (k.tags || []).length)); if (!K.length) return null;
      const yes = K.filter((k) => (k.tags || []).includes("again") || k.compare === "better").length;
      return { n: K.length, again: K.length >= 3 ? Math.round((100 * yes) / K.length) : null, quotes: K.filter((k) => clean(k.love, 10)).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 3).map((k) => ({ text: scrub(clean(k.love, 280)), name: clean(k.name, 40).split(/\s+/)[0] || "A guest" })) }; } catch { return null; } }
  const TEAM = /\b(team|teams|office|offsite|company|corporate|staff|colleagues?|work)\b/i, GROUP = /\b(event|events|wedding|launch|party|parties)\b/i;
  const ICON = { expand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>`, share: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>`,
    list: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h11M4 12h11M4 17.5h7M18.5 14v7M15 17.5h7"/></svg>`, follow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M16 11h6"/></svg>` };
  const CSS = `:root{--pl-page:#EFEBE2;--pl-surface:#FAF8F3;--pl-raised:#E6E1D5;--pl-ink:#1B1D1C;--pl-soft:#444845;--pl-muted:#444845;--pl-line:#CFC8B9;--pl-line-strong:#1B1D1C;--pl-accent:#29489A;--pl-accent-press:#1F3878;--pl-accent-text:#29489A;--pl-accent-soft:#E3E8F4;--pl-on-accent:#fff;--pl-sand:#F3E7A8;--pl-sand-soft:#F7EFCB;--pl-danger:#A2361A;--pl-r-btn:6px;--pl-r-md:6px;--pl-bw:1.5px;--pl-rule:1.5px solid #1B1D1C;--pl-rule-dashed:1px dashed #CFC8B9;
--pl-font-serif:"IBM Plex Serif",Georgia,"Times New Roman",serif;--pl-font-text:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--pl-font-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;--sys-display:var(--pl-font-text);--sys-sans:var(--pl-font-text);--ink:#1B1D1C;--line:#CFC8B9}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%}body{margin:0;background:var(--pl-page);color:var(--pl-ink);font:400 17px/1.6 var(--pl-font-text);overflow-wrap:break-word;text-wrap:pretty}
img,svg{display:block;max-width:100%}a{color:var(--pl-accent-text);text-underline-offset:3px}
.pv-note{margin:0;padding:10px 16px;background:var(--pl-sand);color:var(--pl-ink);font:600 15px/1.4 var(--pl-font-text);text-align:center}
.top{max-width:720px;margin:0 auto;padding:4px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:var(--pl-rule-dashed)}
.brand{display:inline-flex;align-items:center;gap:8px;min-height:48px;color:var(--pl-ink);text-decoration:none;font:600 25px/1 var(--pl-font-text);letter-spacing:-.03em;white-space:nowrap}.brand img{width:28px;height:28px}
.help{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;color:var(--pl-ink);font:500 15px var(--pl-font-text);text-decoration:underline;text-decoration-color:var(--pl-line)}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
.kick{margin:0 0 12px;font:500 13px/1.4 var(--pl-font-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-soft)}
h1{margin:0;font:600 clamp(30px,8.4vw,44px)/1.12 var(--pl-font-serif);letter-spacing:-.01em;overflow-wrap:anywhere;text-wrap:balance}
.by{display:flex;align-items:center;gap:12px;margin:16px 0 0;min-width:0}.by>span{min-width:0;overflow-wrap:anywhere;line-height:1.35}.by a{font-weight:600;color:var(--pl-ink);display:inline-block;padding:4px 0}.by small{display:block;font:500 15px/1.4 var(--pl-font-text);color:var(--pl-soft)}
.av{width:44px;height:44px;border-radius:50%;flex:none;object-fit:cover;background:var(--pl-sand-soft);border:1px solid var(--pl-line);display:grid;place-items:center;font:600 17px var(--pl-font-text);color:var(--pl-ink)}
.hero{margin:24px -16px 0}.ph{position:relative;aspect-ratio:4/5;background:var(--pl-raised);overflow:hidden}.ph img{width:100%;height:100%;object-fit:cover}.ph.art{aspect-ratio:16/9}.ph .ea-cover{height:100%;border-radius:0}
.expand{position:absolute;right:12px;bottom:12px;width:44px;height:44px;display:grid;place-items:center;border-radius:var(--pl-r-btn);background:var(--pl-surface);border:var(--pl-bw) solid var(--pl-ink);color:var(--pl-ink)}.expand svg,.btn2 svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.hero figcaption{margin:8px 16px 0;font:400 14px/1.4 var(--pl-font-text);color:var(--pl-soft)}
@media (min-width:760px){.hero{margin:32px 0 0}.ph,.ph.art{aspect-ratio:3/2;border-radius:var(--pl-r-md)}.ph img{object-fit:contain}.hero figcaption{margin:8px 0 0}}
.facts{display:grid;grid-template-columns:minmax(0,8.5em) minmax(0,1fr);margin:24px 0 0;border-top:var(--pl-rule)}
.facts dt,.facts dd{margin:0;padding:12px 0;border-bottom:var(--pl-rule-dashed);min-width:0}.facts dt{font-weight:600;padding-right:12px}.facts dd{overflow-wrap:anywhere}
.intro{margin:24px 0 0}.intro p{margin:0;max-width:62ch}.intro p.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden}
.more{display:inline-flex;align-items:center;min-height:44px;padding:0;border:0;background:none;color:var(--pl-accent-text);font:600 17px var(--pl-font-text);text-decoration:underline;text-underline-offset:3px;cursor:pointer}.more[hidden]{display:none}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0}
.go,.btn2{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:var(--pl-r-btn);font:600 16px/1.2 var(--pl-font-text);text-decoration:none;cursor:pointer;text-align:center;max-width:100%}
.go{background:var(--pl-accent);color:var(--pl-on-accent);border:var(--pl-bw) solid var(--pl-accent)}.go:hover{background:var(--pl-accent-press)}.go:disabled{opacity:.6;cursor:default}
.btn2{background:var(--pl-surface);color:var(--pl-ink);border:var(--pl-bw) solid var(--pl-ink)}.btn2:hover{background:var(--pl-raised)}
.actions .go{flex:1 1 100%}.actions .btn2{flex:1 1 0;padding:0 10px;min-width:0}@media (min-width:560px){.actions .go{flex:0 1 auto}.actions .btn2{flex:0 1 auto;padding:0 16px}}
.sec{margin:40px 0 0;padding-top:12px;border-top:3px solid var(--pl-ink)}
.sh{margin:0 0 16px;font:600 15px/1.4 var(--pl-font-text);letter-spacing:.06em;text-transform:uppercase}
.sub{margin:24px 0 8px;font:600 15px/1.4 var(--pl-font-text);font-variant:small-caps;letter-spacing:.04em}
.items{list-style:none;margin:0;padding:0}.items li{padding:10px 0;border-bottom:var(--pl-rule-dashed)}.items li:last-child{border-bottom:0}
ol.items{counter-reset:s}ol.items li{counter-increment:s;display:grid;grid-template-columns:2em minmax(0,1fr)}ol.items li::before{content:counter(s);font:500 13px/1.9 var(--pl-font-mono);color:var(--pl-soft)}
.note{margin:16px 0 0}.label{margin:16px 0 0;padding:12px;background:var(--pl-surface);border:var(--pl-rule-dashed);border-radius:var(--pl-r-md)}
.good{display:grid;gap:0;margin:0}.good div{padding:12px 0;border-bottom:var(--pl-rule-dashed)}.good div:last-child{border-bottom:0}.good dt{font-weight:600}.good dd{margin:4px 0 0}
.kq{margin:0;padding:12px 0;border-bottom:var(--pl-rule-dashed)}.kq:last-child{border-bottom:0}.kq p{margin:0}.kq cite{display:block;margin-top:4px;font:500 15px var(--pl-font-text);font-style:normal;color:var(--pl-soft)}
.act{margin:40px 0 0;padding:20px 16px;background:var(--pl-surface);border:var(--pl-bw) solid var(--pl-ink);border-radius:var(--pl-r-md);scroll-margin-top:16px}
.act h2{margin:0;font:600 24px/1.25 var(--pl-font-serif);overflow-wrap:anywhere}.lead{margin:8px 0 0;color:var(--pl-soft)}
.act form{margin:16px 0 0}.f{display:grid;gap:4px;margin:0 0 16px;min-width:0}.f>span{font:600 15px/1.4 var(--pl-font-text)}.f small{font-weight:400;color:var(--pl-soft)}
.f input,.f select,.f textarea{font:400 17px/1.4 var(--pl-font-text);min-height:48px;padding:10px 12px;border:var(--pl-bw) solid var(--pl-ink);border-radius:var(--pl-r-md);background:#fff;color:var(--pl-ink);width:100%;min-width:0;max-width:100%}.f textarea{min-height:88px;resize:vertical}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.act .go{width:100%}.err{color:var(--pl-danger);font-weight:600;margin:12px 0 0}.err:empty{display:none}.fine{font-size:15px;line-height:1.5;color:var(--pl-soft);margin:12px 0 0}
.next{display:grid;gap:8px;margin:16px 0 0}.next a{width:100%}
.go:focus-visible,.btn2:focus-visible,a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.act h2:focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}.act h2:focus:not(:focus-visible){outline:0}
.others{list-style:none;margin:0;padding:0}.others li{border-bottom:var(--pl-rule-dashed)}.others a{display:flex;justify-content:space-between;gap:12px;padding:12px 0;min-height:44px;color:var(--pl-ink);text-decoration:none}.others a b{font-weight:600;min-width:0;overflow-wrap:anywhere}.others a span{color:var(--pl-soft);flex:none}.others a:hover b{text-decoration:underline}
.foot{margin:32px 0 0;font-size:15px;line-height:1.5;color:var(--pl-soft)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;
  function render(req, res, T, it) { const base = String(publicOrigin(req)).replace(/\/+$/, ""), P = T.P, nm = clean(P.name, 60), fn = firstOf(P), url = urlOf(T.handle, it);
    const where = [clean(P.hood, 40), clean(P.city, 40)].filter(Boolean).join(", "), photo = photoOf(P, it), K = kudosOf(T), host = `/@${e(T.handle)}`;
    const canBook = !T.preview && !T.sample && it.kind === "exp" && !!P.forHire, shopOpen = !T.preview && it.kind === "shop" && !!P.shop?.open;
    const mode = T.preview ? "interest" : canBook ? "book" : shopOpen ? "order" : "none";
    const team = it.kind === "exp" && (TEAM.test(it.title) || (it.goals || []).length > 0), group = it.kind === "exp" && !team && GROUP.test(it.title), quantity = it.kind === "shop" || it.kind === "gift";
    const size = it.kind === "exp" ? (it.min > 1 && it.max ? `${it.min} to ${it.max} people` : it.max ? `Up to ${it.max}` : "") : "";
    // the facts table: label, value (HTML-escaped here)
    const facts = [["Price", it.price], ["Group size", size], ["Minimum", it.minQty > 1 ? `${it.minQty}` : ""], ["Length", it.length], ["Lead time", it.lead ? `${it.lead} to make` : ""],
      ["Where", it.travels ? (where ? `Comes to you, from ${where}` : "Comes to you") : it.kind === "shop" && P.shop?.where ? clean(P.shop.where, 80) : where], ["Ships", it.ships]].filter((f) => f[1]).map(([k, v]) => [k, e(v)]);
    if (K) facts.push(["Kudos", `<a href="#kudos">${K.n} ${K.n === 1 ? "guest sent kudos" : "guests sent kudos"}${K.again != null ? `, ${K.again}% would go again` : ""}</a>`]);
    const meta = [it.price, size, it.length].filter(Boolean);
    const desc = [meta.join(" · "), it.desc].filter(Boolean).join(". ").slice(0, 200) || `From ${nm} on Pottery Lab.`;
    const field = (label, inner, hint = "") => `<label class="f"><span>${label}${hint ? ` <small>${hint}</small>` : ""}</span>${inner}</label>`;
    const today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const sizeField = quantity ? field("How many", `<input name="size" type="number" min="1" max="5000" inputmode="numeric">`, "optional") : team ? field("Team size", `<input name="size" type="number" min="1" max="5000" inputmode="numeric">`, "optional") : group ? field("How many guests", `<input name="size" type="number" min="1" max="5000" inputmode="numeric">`, "optional") : "";
    const bookTitle = team ? "Book for your team" : "Request a date", primary = mode === "interest" ? "I'm interested" : mode === "book" ? bookTitle : mode === "order" ? "Order" : "";
    const form = mode === "interest" ? `<h2 id="act">I'm interested</h2><p class="lead">${e(fn)} isn't taking requests on Pottery Lab yet. Leave your email and we'll tell you when you can book.</p>
      <form id="f" data-mode="interest" novalidate><input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        ${field("Your name", `<input name="name" autocomplete="name" required maxlength="80">`)}${field("Email", `<input name="email" type="email" autocomplete="email" inputmode="email" required maxlength="200">`)}
        ${sizeField}${field("A note", `<textarea name="note" rows="3" maxlength="500" placeholder="${quantity ? "What it's for, when you'd need it" : "Roughly when, and what it's for"}"></textarea>`, "optional")}
        <button class="go" type="submit">I'm interested</button><p class="err" role="alert"></p><p class="fine">We only use your email to tell you once. ${e(fn)} doesn't get it until they join.</p></form>`
      : mode === "book" ? `<h2 id="act">${bookTitle}</h2><p class="lead">Send ${e(fn)} a request. Nothing is booked or charged yet: ${e(fn)} replies with a quote${P.respondsIn ? `, usually ${/^(within|in|under|same|by)\b/i.test(P.respondsIn) ? "" : "within "}${e(clean(P.respondsIn, 30))}` : ""}.</p>
      <form id="f" data-mode="book" novalidate>${field("Your name", `<input name="name" autocomplete="name" required maxlength="80">`)}${field(team ? "Work email" : "Email", `<input name="email" type="email" autocomplete="email" inputmode="email" required maxlength="200">`)}
        ${team ? field("Company", `<input name="company" autocomplete="organization" maxlength="120">`, "optional") : ""}<div class="two">${field("Date", `<input name="date" type="date" min="${today}">`)}${field("Guests", `<input name="people" type="number" min="${Math.max(1, it.min || 1)}" max="${it.max || 5000}" value="${Math.max(1, it.min || 10)}" inputmode="numeric" required>`)}</div>
        ${field("A note", `<textarea name="message" rows="3" maxlength="1500" placeholder="What it's for, where, anything ${e(fn)} should know"></textarea>`, "optional")}
        <button class="go" type="submit">Send request</button><p class="err" role="alert"></p><p class="fine"><a href="${host}?exp=${encodeURIComponent(it.id)}#book">More options</a>: add-ons, a date hold, content and usage.</p></form>`
      : mode === "order" ? `<h2 id="act">Order</h2><p class="lead">${it.price ? `${e(it.price)} each. ` : ""}${P.shop.where ? `Pickup at ${e(clean(P.shop.where, 80))}.` : "Pickup only."}${P.shop.payUrl ? " You pay the host after you order." : ""}</p>
      <form id="f" data-mode="order" novalidate><div class="two">${field("How many", `<select name="qty">${Array.from({ length: Math.max(1, Math.min(50, it.max || 6)) }, (_, i) => `<option>${i + 1}</option>`).join("")}</select>`)}${(P.shop.slots || []).length ? field("Pickup", `<select name="slot" required>${P.shop.slots.map((s) => `<option>${e(clean(s, 60))}</option>`).join("")}</select>`) : ""}</div>
        ${field("Your name", `<input name="name" autocomplete="name" required maxlength="80">`)}${field("Email or phone", `<input name="contact" autocomplete="email" required maxlength="200">`, "so they can tell you it's ready")}${field("A note", `<input name="note" maxlength="200">`, "optional")}
        <button class="go" type="submit">Order</button><p class="err" role="alert"></p></form>`
      : `<h2 id="act">Not taking requests right now</h2><p class="lead">${e(fn)} isn't taking ${it.kind === "shop" ? "orders" : "team requests"} on Pottery Lab right now.</p><div class="next"><a class="btn2" href="${host}#follow">Follow ${e(fn)}</a></div>`;
    const list = (L, ol) => `<${ol ? "ol" : "ul"} class="items">${L.map((t) => `<li>${e(t)}</li>`).join("")}</${ol ? "ol" : "ul"}>`;
    const sec = (id, title, inner) => (inner ? `<section class="sec" aria-labelledby="${id}"><h2 class="sh" id="${id}">${title}</h2>${inner}</section>` : "");
    const food = /^(food|dining|drinks)$/.test(it.category || "") || /\b(cake|bake|bread|loaf|coffee|tea|matcha|dinner|supper|lunch|brunch|cook|cooking|food|chocolate|wine|pastry|dumpling)/i.test(it.title);
    const dietLine = it.kind === "exp" && food ? `<p class="label"><b>Allergies and diets:</b> ${it.dietary ? e(it.dietary) : `Ask ${e(fn)} in your note.`}</p>` : "";
    const included = it.includes.length || it.allIn || dietLine ? `${it.includes.length ? list(it.includes) : ""}${it.allIn ? `<p class="note">${e(it.allIn)}</p>` : ""}${dietLine}` : "";
    const good = [["Where", it.setup], ["Getting around", it.access], ["Joining remotely", it.hybrid], ["Your branding", it.branding]].filter((g) => g[1]);
    const others = [...T.items.values()].filter((x) => x.key !== it.key && x.kind !== "any").slice(0, 4);
    const avatar = P.theme?.avatarUrl && /^\/(presets|_blob)\/[A-Za-z0-9._-]+$/.test(P.theme.avatarUrl) ? `<img class="av" src="${e(P.theme.avatarUrl)}" alt="" width="44" height="44">` : `<span class="av" aria-hidden="true">${e((nm.match(/[A-Za-z0-9À-ɏ]/) || ["P"])[0].toUpperCase())}</span>`;
    const kick = { exp: "Experience", gift: "Gift", shop: "From the shop", any: "Preview" }[it.kind] + (it.kind === "exp" && it.category ? ` · ${it.category}` : "");
    const longDesc = (it.desc || "").length > 170, save = e(JSON.stringify({ kind: "host", ref: T.handle, title: nm, img: photo || "" }));
    const similar = it.category ? `/hosts?category=${encodeURIComponent(it.category)}` : "/hosts";
    const title = `${it.title} · ${nm}`;
    res.set("Cache-Control", "public, max-age=60").type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(title)} · Pottery Lab</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(base + url)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#EFEBE2">
<meta property="og:type" content="website"><meta property="og:site_name" content="Pottery Lab"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(base + url)}"><meta property="og:image" content="${e(ogFor(it, photo, base))}"><meta name="twitter:card" content="summary_large_image">
${photo ? `<link rel="preload" as="image" href="${e(photo)}" fetchpriority="high">` : ""}<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<style>${CSS}${photo ? "" : EA_CSS}</style></head><body>${T.preview && !T.P?.example ? `<p class="pv-note" role="note" data-preview>${e(PREVIEW_LABEL)}</p>` : ""}
<header class="top"><a class="brand" href="/" aria-label="Pottery Lab home"><img src="/favicon.svg" alt="" width="28" height="28">pottery lab</a><a class="help" href="/about" data-help-open>Help</a></header>
<main><article>
<p class="kick">${e(kick)}</p>
<h1>${e(it.title)}</h1>
<p class="by">${avatar}<span>Hosted by <a href="${host}">${e(nm)}</a>${where ? `<small>${e(where)}</small>` : ""}</span></p>
<figure class="hero"><div class="ph${photo ? "" : " art"}">${photo ? `<img src="${e(photo)}" alt="${e(`${it.title}, from ${nm}`)}" width="1200" height="1500" decoding="async" fetchpriority="high"><a class="expand" href="${e(photo)}" target="_blank" rel="noopener" aria-label="Open the full photo">${ICON.expand}</a>` : drawn(it)}</div>${photo ? `<figcaption>Photo: ${e(nm)}</figcaption>` : ""}</figure>
${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
${it.desc ? `<div class="intro"><p id="intro"${longDesc ? ` class="clamp"` : ""}>${e(it.desc)}</p>${longDesc ? `<button class="more" type="button" aria-expanded="false" aria-controls="intro">Read more</button>` : ""}</div>` : ""}
<div class="actions">${primary ? `<a class="go" href="#request">${primary}</a>` : ""}<button class="btn2" type="button" data-pl-savelist="${save}" aria-label="Save ${e(nm)} to a list">${ICON.list}<span>Save</span></button><button class="btn2" type="button" id="share" aria-label="Share this page">${ICON.share}<span>Share</span></button>${T.preview ? "" : `<a class="btn2" href="${host}#follow">${ICON.follow}<span>Follow<span class="sr"> ${e(nm)}</span></span></a>`}</div>
${sec("inc", it.kind === "gift" ? "You can personalize" : "What's included", included)}
${sec("ros", "Run of show", it.runOfShow.length ? list(it.runOfShow, true) : "")}
${sec("good", "Good to know", good.length ? `<dl class="good">${good.map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join("")}</dl>` : "")}
${K ? `<section class="sec" id="kudos" aria-labelledby="kh"><h2 class="sh" id="kh">Kudos</h2>${K.quotes.length ? K.quotes.map((q) => `<blockquote class="kq"><p>${e(q.text)}</p><cite>${e(q.name)}</cite></blockquote>`).join("") : `<p>${K.n} ${K.n === 1 ? "guest" : "guests"} sent kudos.</p>`}</section>` : ""}
<section class="act" id="request" aria-labelledby="act">${form}</section>
${others.length ? `<section class="sec" aria-labelledby="mh"><h2 class="sh" id="mh">More from ${e(nm)}</h2><ul class="others">${others.map((x) => `<li><a href="${e(urlOf(T.handle, x))}"><b>${e(x.title)}</b>${x.price ? `<span>${e(x.price)}</span>` : ""}</a></li>`).join("")}</ul>` : `<section>`}<p class="foot">${T.preview ? `${e(nm)} hasn't joined Pottery Lab yet. This page shows what they offer. ` : ""}<a href="${host}">See ${e(nm)}'s page</a></p></section>
</article></main>
<script src="/save.js" defer></script>
<script>(function(){var $=function(s){return document.querySelector(s)};
var mo=$(".more"),ip=$("#intro");if(mo&&ip&&ip.scrollHeight<=ip.clientHeight+2){mo.hidden=true;ip.classList.remove("clamp")}if(mo&&ip)mo.addEventListener("click",function(){var open=ip.classList.toggle("clamp")===false;mo.setAttribute("aria-expanded",open);mo.textContent=open?"Show less":"Read more"});
var sh=$("#share");if(sh)sh.addEventListener("click",async function(){var u=location.href.split("#")[0],t=document.title;try{if(navigator.share){await navigator.share({title:t,url:u});return}await navigator.clipboard.writeText(u);sh.lastChild.textContent="Copied"}catch(x){}});
var hp=$("[data-help-open]");if(hp)hp.addEventListener("click",function(ev){if(window.EncoreHelp)return;ev.preventDefault();var s=document.createElement("script");s.src="/help.js";s.onload=function(){if(window.EncoreHelp)window.EncoreHelp.open(true);else location.href=hp.href};s.onerror=function(){location.href=hp.href};document.head.appendChild(s)},true);
var f=document.getElementById("f");if(!f)return;var M=f.dataset.mode,err=f.querySelector(".err"),H=${JSON.stringify(T.handle)},IT=${JSON.stringify(it.key)},EX=${JSON.stringify(it.id)},FN=${JSON.stringify(fn)},NM=${JSON.stringify(nm)},HOST=${JSON.stringify("/@" + T.handle)},SIM=${JSON.stringify(similar)};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
try{var n=localStorage.getItem("encore.name"),em=localStorage.getItem("encore.email");if(n&&f.elements.name&&!f.elements.name.value)f.elements.name.value=n;var c=f.elements.email||f.elements.contact;if(em&&c&&!c.value)c.value=em}catch(x){}
function done(h){var s=f.closest(".act");s.classList.add("done");s.innerHTML=h;var t=s.querySelector("h2");if(t){t.tabIndex=-1;t.focus({preventScroll:true});s.scrollIntoView({block:"start",behavior:"smooth"})}var g=document.querySelector(".actions .go");if(g)g.remove()}
var more="<a class=btn2 href=\\""+esc(HOST)+"\\">See more from "+esc(NM)+"</a>";
f.addEventListener("submit",async function(ev){ev.preventDefault();err.textContent="";var b=f.querySelector("button[type=submit]"),E=f.elements,d,u;
if(!E.name.value.trim()){err.textContent="Add your name.";E.name.focus();return}
if(M==="interest"){if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(E.email.value.trim())){err.textContent="Add an email we can reach you at.";E.email.focus();return}d={item:IT,name:E.name.value.trim(),email:E.email.value.trim(),size:E.size?E.size.value:"",note:E.note.value,website:E.website.value};u="/api/public/interest/"+H}
else if(M==="book"){if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(E.email.value.trim())){err.textContent="Add an email for the quote.";E.email.focus();return}var dt=E.date.value?new Date(E.date.value+"T12:00:00"):null;d={experienceId:EX,name:E.name.value.trim(),email:E.email.value.trim(),company:E.company?E.company.value.trim():"",date:E.date.value,people:+E.people.value||0,message:E.message.value.trim(),when:dt?dt.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}):""};u="/api/public/book/"+H}
else{var v=E.contact.value.trim(),isE=v.indexOf("@")>0;d={name:E.name.value.trim(),email:isE?v:"",phone:isE?"":v,slot:E.slot?E.slot.value:"",note:E.note.value,items:[{id:EX,qty:+E.qty.value||1}]};u="/api/public/order/"+H}
b.disabled=true;try{var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json().catch(function(){return{}});
if(!r.ok){err.textContent=j.message||"That didn't go through. Try again.";b.disabled=false;return}
try{localStorage.setItem("encore.name",d.name);if(d.email)localStorage.setItem("encore.email",d.email)}catch(x){}
if(M==="interest")done("<h2>You're on the list</h2><p class=lead>"+(j.again?"We updated your note. ":"")+"We'll email you once, when "+esc(NM)+" joins.</p><div class=next>"+more+"<a class=btn2 href=\\""+esc(SIM)+"\\">Explore similar hosts</a></div>");
else if(M==="book")done("<h2>"+(j.instant?"Almost booked":"Request sent")+"</h2><p class=lead>"+esc(FN)+" has your request and replies with a quote. We emailed you a link too.</p><div class=next><a class=go href=\\""+esc(j.link)+"\\">Track request</a>"+more+"</div>");
else done("<h2>Order #"+esc(j.code)+"</h2><p class=lead>"+esc(j.total)+(j.slot?". Pickup "+esc(j.slot):"")+(j.where?" at "+esc(j.where):"")+". Show this at pickup.</p><div class=next>"+(j.payUrl?"<a class=go href=\\""+esc(j.payUrl)+"\\" rel=noopener>Pay "+esc(j.total)+"</a>":"")+more+"</div>")}
catch(x){err.textContent="That didn't go through. Check your connection and try again.";b.disabled=false}})})();</script></body></html>`); }

  const notFound = (res) => res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Pottery Lab</title><body style="font:16px system-ui;background:#FAF8F3;color:#1B1D1C;padding:24px"><p>We couldn't find that. <a href="/discover">See what's on</a></p>`);
  app.get(/^\/x\/([a-z0-9][a-z0-9-]{1,39})\/shop\/([A-Za-z0-9_-]{1,20})$/, (req, res) => { const T = thingsOf(req.params[0]), it = T?.items.get("shop:" + req.params[1]);
    if (T && !it && !T.preview) return res.redirect(302, movedTo(T, req.params[1], "shop")); return it ? render(req, res, T, it) : notFound(res); });
  app.get(/^\/x\/([a-z0-9][a-z0-9-]{1,39})\/([A-Za-z0-9_-]{1,20})$/, (req, res) => { const T = thingsOf(req.params[0]); if (!T) return notFound(res); const it = T.items.get(req.params[1]);
    if (it?.kind === "gift" && !T.preview) return res.redirect(302, `/@${T.handle}?gift=${encodeURIComponent(it.id)}#gifts`); // a real host's gift: their gift form
    if (!it && !T.preview) return res.redirect(302, movedTo(T, req.params[1], "")); // an old preview link after the host joined
    return it && it.kind !== "shop" ? render(req, res, T, it) : notFound(res); });
  // a preview page's link once someone has taken the handle: the same thing on the real page (by name), else their page
  function movedTo(T, id, pre) { try { const P0 = C.showcasePreset?.(T.handle); if (!P0) return `/@${T.handle}`; const L = pre ? P0.shop?.items || [] : [...(P0.experiences || []), ...(P0.gifts || [])];
      const o = pre ? L[+id] : L.find((x) => x.id === id), it = o && [...T.items.values()].find((x) => (pre ? x.kind === "shop" : x.kind !== "shop") && lc(x.title) === lc(o.name)); return it ? urlOf(T.handle, it) : `/@${T.handle}`; } catch { return `/@${T.handle}`; } }
  return { thingsOf, tellOnClaim, docOf };
}
// ---- end one page per thing ----
