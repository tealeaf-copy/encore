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
import { DEFAULT_WS, getWorkspace } from "./workspaces.js";
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
      includes: (Array.isArray(x.includes) ? x.includes : []).map((t) => clean(t, 120)).filter(Boolean).slice(0, 10), runOfShow: (Array.isArray(x.runOfShow) ? x.runOfShow : []).map((t) => clean(t, 160)).filter(Boolean).slice(0, 12), allIn: clean(x.allIn, 200), photo: /^\/_blob\/[A-Za-z0-9]{20}$/.test(x.photo || "") ? x.photo : "", category: clean(x.category, 30) }); });
    (P.gifts || []).forEach((g, i) => { const id = String(g.id || "g" + i); M.set(id, { key: id, kind: "gift", id, title: clean(g.name, 100), desc: clean(g.desc, 400), emoji: clean(g.emoji, 8), price: g.cents ? money(g.cents) + " each" : "", lead: clean(g.lead, 40), minQty: +g.minQty || 0, includes: (g.personalize || []).map((t) => clean(t, 120)).slice(0, 8), runOfShow: [], allIn: clean(g.allIn, 200), photo: "" }); });
    (P.shop?.items || []).forEach((x, i) => { const id = preview ? String(i) : String(x.id || i); M.set("shop:" + id, { key: "shop:" + id, kind: "shop", id, title: clean(x.name, 100), desc: clean(x.desc, 300), emoji: clean(x.emoji, 8), price: x.cents ? money(x.cents) : "", cents: +x.cents || 0, max: +x.max || 6, includes: [], runOfShow: [], photo: /^\/_blob\/[A-Za-z0-9]{20}$/.test(x.photo || "") ? x.photo : "" }); });
    if (preview) M.set("any", { key: "any", kind: "any", id: "any", title: `Something from ${clean(P.name, 60)}`, desc: clean(P.tagline || P.bio, 300), emoji: clean(P.emoji, 8), price: "", includes: [], runOfShow: [] });
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
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interest · Pottery Lab</title><meta name="robots" content="noindex"><style>body{font:15px/1.5 system-ui,sans-serif;color:#1D1B18;background:#FBF9F5;max-width:960px;margin:0 auto;padding:16px}table{width:100%;border-collapse:collapse;margin:8px 0 24px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #E2DCD1;vertical-align:top}h2{margin:20px 0 4px}small{color:#5D564E}</style></head><body><h1>People who asked</h1><p><small>From preview pages: "I'm interested". The preview host is never emailed; people who asked get one email when someone takes the handle.</small></p>
${H.length ? H.map((d) => `<h2>@${e(d.handle)} <small>${d.list.length} · ${C.wsOfHandle(d.handle) ? "claimed" : "not claimed"}${d.toldAt ? " · told " + new Date(d.toldAt).toISOString().slice(0, 10) : ""}</small></h2><div style="overflow-x:auto"><table><tr><th>When</th><th>What</th><th>Name</th><th>Email</th><th>Size</th><th>Note</th></tr>${d.list.slice().sort((a, b) => b.at - a.at).map((r) => `<tr><td>${e(new Date(r.at).toISOString().slice(0, 10))}</td><td>${e(r.title)}</td><td>${e(r.name)}</td><td>${e(r.email)}</td><td>${r.size || ""}</td><td>${e(r.note)}</td></tr>`).join("")}</table></div>`).join("") : "<p>Nobody yet.</p>"}</body></html>`); });

  // ---------- the page ----------
  // the same drawing the feed's art card picks (public/feedvisual.js artCard: EventArt.suggest on the title and category)
  // the same drawing the story shows (public/feedvisual.js: the title and category)
  const baseOf = (it) => ({ id: it.key, name: it.title, pubTitle: it.title, title: it.title, activity: `${it.title} ${it.category || ""}` });
  const kindOf = (it) => { try { return String(EA.kindOf(baseOf(it)) || "party").split("+")[0]; } catch { return "party"; } };
  const ogFor = (it, base) => { if (it.photo) return base + it.photo; const k = EA ? kindOf(it) : "party"; try { return fs.existsSync(path.join(PUBLIC, "og", k + ".png")) ? `${base}/og/${k}.png` : `${base}/og/party.png`; } catch { return ""; } };
  const artOf = (it) => { if (it.photo) return `<img src="${e(it.photo)}" alt="" width="800" height="500" decoding="async" fetchpriority="high">`; try { return EA ? EA.cover({ ...baseOf(it), coverArt: { kind: kindOf(it) } }, { title: "" }) : ""; } catch { return ""; } };
  function render(req, res, T, it) { const base = String(publicOrigin(req)).replace(/\/+$/, ""), P = T.P, nm = clean(P.name, 60), fn = firstOf(P), url = urlOf(T.handle, it);
    const sizeLine = it.kind === "exp" ? (it.min > 1 && it.max ? `${it.min} to ${it.max} guests` : it.max ? `Up to ${it.max} guests` : "") : it.minQty ? `Min ${it.minQty}` : "";
    const meta = [it.price, sizeLine, it.length, it.lead ? `${it.lead} to make` : "", it.travels ? "Comes to you" : ""].filter(Boolean);
    const where = [clean(P.hood, 40), clean(P.city, 40)].filter(Boolean).join(", ");
    const canBook = !T.preview && !T.sample && it.kind === "exp" && !!P.forHire, shopOpen = !T.preview && it.kind === "shop" && !!P.shop?.open;
    const mode = T.preview ? "interest" : canBook ? "book" : shopOpen ? "order" : "none";
    const desc = [meta.join(" · "), it.desc].filter(Boolean).join(". ").slice(0, 200) || `From ${nm} on Pottery Lab.`;
    const field = (label, inner, hint = "") => `<label class="f"><span>${label}${hint ? ` <small>${hint}</small>` : ""}</span>${inner}</label>`;
    const quantity = it.kind === "shop" || it.kind === "gift";
    const today = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const form = mode === "interest" ? `<h2 id="act">I'm interested</h2><p class="lead">${e(fn)} isn't taking requests on Pottery Lab yet. Leave your email and we'll tell you when you can book.</p>
      <form id="f" data-mode="interest" novalidate><input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        ${field("Your name", `<input name="name" autocomplete="name" required maxlength="80">`)}${field("Email", `<input name="email" type="email" autocomplete="email" inputmode="email" required maxlength="200">`)}
        ${quantity || it.kind === "exp" ? field(quantity ? "How many" : "Team size", `<input name="size" type="number" min="1" max="5000" inputmode="numeric">`, "optional") : "" /* team size only on a team experience */}${field("A note", `<textarea name="note" rows="2" maxlength="500" placeholder="${quantity ? "What it's for, when you'd need it" : "Roughly when, and what it's for"}"></textarea>`, "optional")}
        <button class="go" type="submit">I'm interested</button><p class="err" role="alert"></p><p class="fine">We only use your email to tell you once. ${e(fn)} doesn't get it until they join.</p></form>`
      : mode === "book" ? `<h2 id="act">Book for your team</h2><p class="lead">Send ${e(fn)} a request. Nothing is booked or charged yet: ${e(fn)} replies with a quote${P.respondsIn ? `, usually ${/^(within|in|under|same|by)\b/i.test(P.respondsIn) ? "" : "within "}${e(clean(P.respondsIn, 30))}` : ""}.</p>
      <form id="f" data-mode="book" novalidate>${field("Your name", `<input name="name" autocomplete="name" required maxlength="80">`)}${field("Work email", `<input name="email" type="email" autocomplete="email" inputmode="email" required maxlength="200">`)}
        ${field("Company", `<input name="company" autocomplete="organization" maxlength="120">`, "optional")}<div class="two">${field("Date", `<input name="date" type="date" min="${today}">`)}${field("Guests", `<input name="people" type="number" min="${Math.max(1, it.min || 1)}" max="${it.max || 5000}" value="${Math.max(1, it.min || 10)}" inputmode="numeric" required>`)}</div>
        ${field("A note", `<textarea name="message" rows="2" maxlength="1500" placeholder="What it's for, where, anything ${e(fn)} should know"></textarea>`, "optional")}
        <button class="go" type="submit">Send request</button><p class="err" role="alert"></p><p class="fine"><a href="/@${e(T.handle)}?exp=${encodeURIComponent(it.id)}#book">More options</a>: add-ons, a date hold, content and usage.</p></form>`
      : mode === "order" ? `<h2 id="act">Order</h2><p class="lead">${it.price ? `${e(it.price)} each. ` : ""}${P.shop.where ? `Pickup at ${e(clean(P.shop.where, 80))}.` : "Pickup only."}${P.shop.payUrl ? " You pay the host after you order." : ""}</p>
      <form id="f" data-mode="order" novalidate><div class="two">${field("How many", `<select name="qty">${Array.from({ length: Math.max(1, Math.min(50, it.max || 6)) }, (_, i) => `<option>${i + 1}</option>`).join("")}</select>`)}${(P.shop.slots || []).length ? field("Pickup", `<select name="slot" required>${P.shop.slots.map((s) => `<option>${e(clean(s, 60))}</option>`).join("")}</select>`) : ""}</div>
        ${field("Your name", `<input name="name" autocomplete="name" required maxlength="80">`)}${field("Email or phone", `<input name="contact" autocomplete="email" required maxlength="200">`, "so they can tell you it's ready")}${field("A note", `<input name="note" maxlength="200">`, "optional")}
        <button class="go" type="submit">Order</button><p class="err" role="alert"></p></form>`
      : `<h2 id="act">Not taking requests right now</h2><p class="lead">${e(fn)} isn't taking ${it.kind === "shop" ? "orders" : "team requests"} on Pottery Lab right now.</p><a class="go ghost" href="/@${e(T.handle)}">Follow ${e(fn)}</a>`;
    const list = (title, L, ol) => (L || []).length ? `<h3>${title}</h3><${ol ? "ol" : "ul"}>${L.map((t) => `<li>${e(t)}</li>`).join("")}</${ol ? "ol" : "ul"}>` : "";
    const avatar = P.theme?.avatarUrl && /^\/(presets|_blob)\/[A-Za-z0-9._-]+$/.test(P.theme.avatarUrl) ? `<img class="av" src="${e(P.theme.avatarUrl)}" alt="" width="40" height="40">` : `<span class="av" aria-hidden="true">${e(clean(P.emoji, 4) || "🎉")}</span>`;
    const title = `${it.title} · ${nm}`;
    res.set("Cache-Control", "public, max-age=60").type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(title)} · Pottery Lab</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(base + url)}"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:site_name" content="Pottery Lab"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(base + url)}"><meta property="og:image" content="${e(ogFor(it, base))}"><meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<style>:root{--bg:#FBF9F5;--ink:#1D1B18;--smoke:#5D564E;--line:#E2DCD1;--ember:#9A4128;--card:#fff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "Instrument Sans",system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:12px 16px 40px}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}.brand{font:600 17px 'Instrument Sans',system-ui,sans-serif;color:var(--ink);text-decoration:none;display:inline-flex;align-items:center;min-height:44px}
.hero{position:relative;border-radius:20px;overflow:hidden;border:1.5px solid var(--line);background:#E3D7BE;height:clamp(120px,36vw,200px);width:100%;display:grid}.hero img{width:100%;height:100%;object-fit:cover}.hero .ea-cover{height:100%}
.host{display:flex;align-items:center;gap:10px;margin:14px 0 4px;color:var(--smoke);font-size:15px}.av{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#F0E9DA;font-size:22px;object-fit:cover;flex:none}
h1{font:600 clamp(26px,7vw,34px)/1.15 'Instrument Serif',Georgia,serif;margin:4px 0 6px}.meta{margin:0 0 14px;color:var(--smoke)}.meta b{color:var(--ink)}
.act{background:var(--card);border:1.5px solid var(--line);border-radius:20px;padding:16px;margin:0 0 20px}.act h2{font:600 22px 'Instrument Serif',Georgia,serif;margin:0 0 4px}.lead{margin:0 0 12px;color:#3B322C}
.f{display:grid;gap:4px;margin:0 0 10px;font-weight:600;font-size:15px}.f small{font-weight:400;color:var(--smoke)}.f input,.f select,.f textarea{font:inherit;font-weight:400;min-height:44px;padding:9px 12px;border:1px solid #CFC6B8;border-radius:12px;background:#fff;color:var(--ink);width:100%}.f textarea{min-height:64px;resize:vertical}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.go{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:0 22px;border-radius:999px;border:2px solid var(--ink);background:var(--ember);color:#fff;font:700 17px "Instrument Sans",system-ui;text-decoration:none;cursor:pointer;box-shadow:3px 3px 0 var(--ink)}.go.ghost{background:#fff;color:var(--ink)}.go:disabled{opacity:.6}
.go:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--ember);outline-offset:2px}
.err{color:#A3402B;font-weight:600;margin:8px 0 0;min-height:0}.err:empty{display:none}.fine{font-size:13px;color:var(--smoke);margin:10px 0 0}.fine a{color:#8A3A1E}
.done h2{font:600 22px var(--sys-display);margin:0 0 4px}.about h3{font:600 17px var(--sys-title);margin:16px 0 4px}.about ul,.about ol{margin:0;padding-left:20px}.about p{margin:0 0 8px}
.foot{margin-top:24px;font-size:14px;color:var(--smoke)}.foot a{color:#8A3A1E;display:inline-flex;min-height:44px;align-items:center}${EA_CSS}.pv-note{margin:0;padding:10px 16px;background:#F2D48F;color:#1F1A17;font:600 14px/1.3 "Instrument Sans",system-ui,sans-serif;text-align:center}</style></head><body>${T.preview && !T.P?.example ? `<p class="pv-note" role="note" data-preview>${e(PREVIEW_LABEL)}</p>` : ""}
<main><div class="top"><a class="brand" href="/">Pottery Lab</a>${T.preview ? `<small style="color:var(--smoke)">Preview page</small>` : ""}</div>
<div class="hero">${artOf(it)}</div>
<p class="host">${avatar}<span><b style="color:var(--ink)">${e(nm)}</b>${where ? ` · ${e(where)}` : ""}</span></p>
<h1>${e(it.emoji ? it.emoji + " " : "")}${e(it.title)}</h1>${meta.length ? `<p class="meta">${meta.map((m, i) => (i ? e(m) : `<b>${e(m)}</b>`)).join(" · ")}</p>` : ""}
<section class="act" aria-labelledby="act">${form}</section>
<section class="about">${it.desc ? `<p>${e(it.desc)}</p>` : ""}${list("What's included", it.includes)}${it.allIn ? `<p>${e(it.allIn)}</p>` : ""}${list("Run of show", it.runOfShow, true)}</section>
<p class="foot">${T.preview ? `${e(nm)} hasn't joined Pottery Lab yet. This page shows what they offer.` : ""} <a href="/@${e(T.handle)}">More from ${e(fn)}</a></p></main>
<script>(function(){var f=document.getElementById("f");if(!f)return;var M=f.dataset.mode,err=f.querySelector(".err"),H=${JSON.stringify(T.handle)},IT=${JSON.stringify(it.key)},EX=${JSON.stringify(it.id)},FN=${JSON.stringify(fn)};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
try{var n=localStorage.getItem("encore.name"),em=localStorage.getItem("encore.email");if(n&&f.elements.name&&!f.elements.name.value)f.elements.name.value=n;var c=f.elements.email||f.elements.contact;if(em&&c&&!c.value)c.value=em}catch(x){}
function done(h){var s=f.closest(".act");s.classList.add("done");s.innerHTML=h;var t=s.querySelector("h2");if(t){t.tabIndex=-1;t.focus()}}
f.addEventListener("submit",async function(ev){ev.preventDefault();err.textContent="";var b=f.querySelector("button[type=submit]"),E=f.elements,d,u;
if(!E.name.value.trim()){err.textContent="Add your name.";E.name.focus();return}
if(M==="interest"){if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(E.email.value.trim())){err.textContent="Add an email we can reach you at.";E.email.focus();return}d={item:IT,name:E.name.value.trim(),email:E.email.value.trim(),size:E.size.value,note:E.note.value,website:E.website.value};u="/api/public/interest/"+H}
else if(M==="book"){if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$/.test(E.email.value.trim())){err.textContent="Add a work email for the quote.";E.email.focus();return}var dt=E.date.value?new Date(E.date.value+"T12:00:00"):null;d={experienceId:EX,name:E.name.value.trim(),email:E.email.value.trim(),company:E.company.value.trim(),date:E.date.value,people:+E.people.value||0,message:E.message.value.trim(),when:dt?dt.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}):""};u="/api/public/book/"+H}
else{var v=E.contact.value.trim(),isE=v.indexOf("@")>0;d={name:E.name.value.trim(),email:isE?v:"",phone:isE?"":v,slot:E.slot?E.slot.value:"",note:E.note.value,items:[{id:EX,qty:+E.qty.value||1}]};u="/api/public/order/"+H}
b.disabled=true;try{var r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}),j=await r.json().catch(function(){return{}});
if(!r.ok){err.textContent=j.message||"That didn't go through. Try again.";b.disabled=false;return}
try{localStorage.setItem("encore.name",d.name);if(d.email)localStorage.setItem("encore.email",d.email)}catch(x){}
var nm=esc(d.name.split(/\\s+/)[0]);
if(M==="interest")done("<h2>Thanks, "+nm+"</h2><p class=lead>We'll email you once when you can book with "+esc(FN)+".</p>");
else if(M==="book")done("<h2>"+(j.instant?"Almost booked":"Request sent")+"</h2><p class=lead>"+esc(FN)+" has your request and replies with a quote. We emailed you a link too.</p><a class=go href=\\""+esc(j.link)+"\\">Track request</a>");
else done("<h2>Order #"+esc(j.code)+"</h2><p class=lead>"+esc(j.total)+(j.slot?". Pickup "+esc(j.slot):"")+(j.where?" at "+esc(j.where):"")+". Show this at pickup.</p>"+(j.payUrl?"<a class=go href=\\""+esc(j.payUrl)+"\\" rel=noopener>Pay "+esc(j.total)+"</a>":""))}
catch(x){err.textContent="That didn't go through. Check your connection and try again.";b.disabled=false}})})();</script></body></html>`); }

  const notFound = (res) => res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Pottery Lab</title><body style="font:16px system-ui;background:#FBF9F5;color:#1D1B18;padding:24px"><p>We couldn't find that. <a href="/discover">See what's on</a></p>`);
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
