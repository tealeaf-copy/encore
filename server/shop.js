// A host's little shop: pre-orders for pickup (Eric's pandan honeycomb cake, Claire's club tees, Jackie's beans).
// Hosts list a few things with a price and how many they can make; people order with a pickup time; the host sees
// orders, marks them paid or picked up, and can text everyone when it's ready.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const EMAIL_OK = (e) => /^[^\s@"<>()[\],;:]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e || "");
const PHONE_OK = (p) => /^\+?[0-9 ()-]{7,20}$/.test(String(p || "").trim());
const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
/** The host's pay link with the amount and a note filled in, for Venmo, PayPal.me and Cash App. Other links pass through. */
export function payLink(url, cents, note) { if (!url) return ""; const amt = (cents / 100).toFixed(cents % 100 ? 2 : 0); let m;
  if ((m = url.match(/^https:\/\/(?:www\.|account\.)?venmo\.com\/(?:u\/)?([A-Za-z0-9_-]+)\/?$/i))) return `https://venmo.com/${m[1]}?txn=pay&amount=${amt}&note=${encodeURIComponent(note)}`;
  if ((m = url.match(/^https:\/\/(?:www\.)?paypal\.me\/([A-Za-z0-9_-]+)\/?$/i))) return `https://paypal.me/${m[1]}/${amt}`;
  if ((m = url.match(/^https:\/\/cash\.app\/\$([A-Za-z0-9_-]+)\/?$/i))) return `https://cash.app/$${m[1]}/${amt}`;
  return url; }
const BLOB_OK = (u) => !u || /^\/_blob\/[A-Za-z0-9]{20}$/.test(u);

export function cleanShop(s = {}, cur = {}) {
  const items = (Array.isArray(s.items) ? s.items : cur.items || []).slice(0, 12).map((x, i) => ({
    id: /^[a-z0-9]{6,12}$/.test(x?.id || "") ? x.id : crypto.randomBytes(4).toString("hex"),
    name: clean(x?.name, 60), desc: clean(x?.desc, 200), emoji: clean(x?.emoji, 16), photo: BLOB_OK(x?.photo) ? x?.photo || "" : "",
    cents: Math.max(0, Math.min(100000, Math.round(+x?.cents || 0))), stock: Math.max(0, Math.min(999, Math.round(+x?.stock || 0))), max: Math.max(1, Math.min(50, Math.round(+x?.max || 6))), order: i,
  })).filter((x) => x.name);
  const slots = (Array.isArray(s.slots) ? s.slots : cur.slots || []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 8);
  return { open: s.open != null ? !!s.open : !!cur.open, title: clean(s.title ?? cur.title ?? "", 60), note: clean(s.note ?? cur.note ?? "", 240), where: clean(s.where ?? cur.where ?? "", 120), address: clean(s.address ?? cur.address ?? "", 160), slots, items, payUrl: /^https:\/\/[^\s<>"]{3,300}$/i.test(s.payUrl ?? cur.payUrl ?? "") ? s.payUrl ?? cur.payUrl : "", dropId: clean(s.dropId ?? cur.dropId ?? "", 20) || crypto.randomBytes(3).toString("hex") };
}

export function mountShop(app, { store, small, currentUser, publicOrigin, C, X }) {
  const hits = new Map(); const limited = (req, n = 20) => { const k = (req.ip || "?") + req.path, now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600_000) { h = { n: 0, start: now }; hits.set(k, h); } return ++h.n > n; };
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const sold = (ws, dropId) => { const n = {}; for (const d of scopeStore(store, ws).list("orders")) { const o = d.data; if (o.dropId !== dropId || o.status === "cancelled") continue; for (const l of o.lines || []) n[l.id] = (n[l.id] || 0) + l.qty; } return n; };
  const publicShop = (ws) => { const h = C.profileOf(ws), s = h?.shop; if (!s?.open || !s.items?.length) return null; const S = sold(ws, s.dropId);
    return { title: s.title, note: s.note, where: s.where, slots: s.slots, payUrl: !!s.payUrl, items: s.items.map((x) => ({ id: x.id, name: x.name, desc: x.desc, emoji: x.emoji, photo: x.photo, price: money(x.cents), cents: x.cents, max: x.max, left: x.stock ? Math.max(0, x.stock - (S[x.id] || 0)) : null })) }; };
  app.get("/api/public/shop/:handle", (req, res) => { const ws = C.wsOfHandle(req.params.handle); res.json({ shop: ws ? publicShop(ws) : null }); });
  // Discover: every open shop
  app.get("/api/public/shops", (req, res) => { const out = []; for (const ws of allWorkspaceIds()) { const h = C.profileOf(ws), p = h?.handle && publicShop(ws); if (!p) continue; out.push({ handle: h.handle, name: h.name, emoji: h.emoji, city: h.city, hood: h.hood, accent: h.theme?.accent || h.color, avatarArt: h.theme?.avatarArt || "", title: p.title, items: p.items.slice(0, 3), soldOut: p.items.every((x) => x.left === 0) }); } res.json({ shops: out }); });
  app.post("/api/public/order/:handle", small, async (req, res) => { if (limited(req, 15)) return bad(res, "Too many orders from here. Try again later.", 429, "rate_limited");
    const ws = C.wsOfHandle(req.params.handle), h = ws && C.profileOf(ws), s = h?.shop; if (!s?.open) return bad(res, "This shop isn't taking orders right now.", 404, "not_found");
    const b = req.body || {}, name = clean(b.name, 80), email = lc(clean(b.email, 200)), phone = clean(b.phone, 24), slot = clean(b.slot, 60);
    if (!name) return bad(res, "Add your name so they know whose order it is."); if (!PHONE_OK(phone) && !EMAIL_OK(email)) return bad(res, "Add a phone number or email so they can tell you it's ready.");
    if (s.slots?.length && !s.slots.includes(slot)) return bad(res, "Pick a pickup time.");
    const S = sold(ws, s.dropId), lines = [];
    for (const l of Array.isArray(b.items) ? b.items : []) { const it = s.items.find((x) => x.id === l?.id), q = Math.round(+l?.qty || 0); if (!it || q <= 0) continue; if (q > it.max) return bad(res, `Up to ${it.max} ${it.name} per order.`); if (it.stock && (S[it.id] || 0) + q > it.stock) return bad(res, `Only ${Math.max(0, it.stock - (S[it.id] || 0))} ${it.name} left.`, 409, "sold_out"); lines.push({ id: it.id, name: it.name, qty: q, cents: it.cents }); }
    if (!lines.length) return bad(res, "Pick something first.");
    const total = lines.reduce((a, l) => a + l.qty * l.cents, 0), code = crypto.randomBytes(2).toString("hex").toUpperCase(), o = { code, dropId: s.dropId, name, email, phone, slot, note: clean(b.note, 200), lines, total, status: "new", at: Date.now() };
    const r = scopeStore(store, ws).add("orders", o); const W = getWorkspace(ws);
    X.notify(W?.ownerEmail, { kind: "order", text: `🛍 ${first(name)} ordered ${lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}${slot ? ` for ${slot}` : ""} (${money(total)})`, link: `/@${h.handle}?orders=1`, eventId: "" });
    const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (cfg && EMAIL_OK(email) && X.canEmail(email)) sendEmail(cfg, { to: email, subject: `Your order from ${h.name}: #${code}`, text: `Thanks ${first(name)}!\n\n${lines.map((l) => `${l.qty} × ${l.name}`).join("\n")}\nTotal: ${money(total)}\n${slot ? `Pickup: ${slot}${s.where ? ` at ${s.where}` : ""}\n` : ""}${s.payUrl ? `\nPay here: ${s.payUrl}\n` : ""}\nOrder #${code}. Show this at pickup.`, fromName: h.name }).catch(() => {});
    res.json({ ok: true, id: r.id, code, total: money(total), slot, where: s.address || s.where, payUrl: payLink(s.payUrl, total, `${h.name} order #${code}`) }); });
  app.get("/api/host/orders", (req, res) => { const u = me(req, res); if (!u) return; const s = C.profileOf(u.ws)?.shop; const L = scopeStore(store, u.ws).list("orders").map((d) => ({ id: d.id, ...d.data })).sort((a, b) => b.at - a.at);
    res.json({ address: s?.address || "", where: s?.where || "", orders: L.slice(0, 300).map((o) => ({ ...o, totalText: money(o.total), current: o.dropId === s?.dropId })) }); });
  app.post("/api/host/orders/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), p = "orders/" + clean(req.params.id, 40), o = S.get(p)?.data; if (!o) return bad(res, "No such order.", 404, "not_found");
    const st = ["new", "paid", "ready", "picked", "cancelled"].includes(req.body?.status) ? req.body.status : o.status; S.update(p, { status: st, [st + "At"]: Date.now() }); res.json({ ok: true, status: st }); });
  // a new batch: sold counts start again
  async function tellSubscribers(ws, origin) { const h = C.profileOf(ws), s = h?.shop; if (!s?.open) return 0; const F = C.followersOf(ws), cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true), link = `${origin}/@${h.handle}`; let n = 0;
    for (const f of F) { if (!f.email) continue; X.notify(f.email, { kind: "drop", key: `drop-${ws}-${s.dropId}`, text: `🛍 ${h.name}: ${s.title || "a new batch"} is open for orders`, link: `/@${h.handle}`, eventId: "" }); if (cfg && X.canEmail(f.email)) { const r = await sendEmail(cfg, { to: f.email, subject: `${s.title || "New batch"} from ${h.name}`, text: `${s.title || "A new batch"} is open.\n${s.items.map((x) => `· ${x.name}: ${money(x.cents)}`).join("\n")}${s.slots?.length ? `\nPickup: ${s.slots.join(", ")}` : ""}\n\nOrder: ${link}\n\nYou subscribed to ${h.name} on Encore.`, fromName: h.name }).catch(() => ({})); if (r.ok) n++; } }
    return F.length; }
  app.post("/api/host/shop/new-drop", small, async (req, res) => { const u = me(req, res); if (!u) return; const h = C.profileOf(u.ws); if (!h?.shop) return bad(res, "Set up your shop first."); const r = C.setProfile(u.ws, { shop: { ...h.shop, dropId: crypto.randomBytes(3).toString("hex") } }); const told = req.body?.tell === false ? 0 : await tellSubscribers(u.ws, publicOrigin(req)); res.json({ ok: true, shop: r.host?.shop, told }); });
  app.post("/api/host/shop/announce", small, async (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, told: await tellSubscribers(u.ws, publicOrigin(req)) }); });
}
