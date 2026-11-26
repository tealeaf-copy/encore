// Drops: "order ahead, pick up at a set time". One model with events and bookings: a drop is a pre-order event under
// the hood (preorder: true, drop: true), so orders are replies, and stock, payment, chat, reminders and the feed work
// the way they do for any event. A drop carries items with a price (required), an optional photo and an optional
// "how many this batch"; pickup windows ("Sat 9 to 10am"); a public area; and an exact address that only people who
// ordered get (the invite's address endpoint, the order email). "Always available" is a drop with no end date.
// The old host "shop" (host.shop) is converted into an always-available drop once (migrateShops); its old orders stay
// readable in the one Orders inbox (GET /api/host/orders, server/shop.js).
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, updateWorkspace, claimEvent, workspaceOfEvent, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/[<>]/g, "").trim().slice(0, n);
const BLOB_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "");
const DAY_OK = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
const newId = () => { let s = ""; while (s.length < 16) s += crypto.randomBytes(12).toString("base64").replace(/[^A-Za-z0-9]/g, ""); return s.slice(0, 16); };
/** "$12", "12.50", "12" read as dollars; anything else is no price. */
export const priceOf = (v) => { const m = String(v ?? "").replace(/[,\s$]/g, "").match(/^(\d{1,4})(\.\d{1,2})?$/); if (!m) return 0; const n = Math.round(+(m[1] + (m[2] || "")) * 100) / 100; return n > 0 && n <= 5000 ? n : 0; };

/**
 * A drop as the host set it up, checked. Returns { error } (a sentence the host reads) or { drop }.
 * Prices are required: an item without one is refused, never shown as "$0".
 */
export function cleanDrop(b = {}, cur = {}) {
  const raw = Array.isArray(b.items) ? b.items : cur.items || [];
  const items = [];
  for (const [i, x] of raw.slice(0, 12).entries()) {
    const name = clean(x?.name, 60), price = priceOf(x?.price), anyPrice = String(x?.price ?? "").trim();
    if (!name && !anyPrice) continue; // an empty row the host never filled
    if (!name) return { error: `Item ${i + 1} needs a name.` };
    if (!price) return { error: anyPrice ? `Check the price for ${name}. Use a number like 12 or 12.50.` : `Add a price for ${name}.` };
    items.push({ id: /^[a-z0-9]{6,12}$/.test(x?.id || "") ? x.id : crypto.randomBytes(4).toString("hex"), name, price, desc: clean(x?.desc, 160),
      stock: Math.max(0, Math.min(999, Math.round(+x?.stock || 0))), max: Math.max(1, Math.min(50, Math.round(+x?.max || 6))), photo: BLOB_OK(x?.photo) ? x.photo : "" });
  }
  if (!items.length) return { error: "Add at least one thing to sell, with a price." };
  const slots = (Array.isArray(b.slots) ? b.slots : cur.slots || []).map((s) => clean(s, 60)).filter(Boolean).filter((s, i, A) => A.indexOf(s) === i).slice(0, 8);
  if (!slots.length) return { error: "Add at least one pickup time." };
  const area = clean(b.area ?? cur.area, 80);
  if (!area) return { error: "Add the neighborhood people see, like Midtown or Greenpoint." };
  const always = b.always != null ? !!b.always : cur.always != null ? !!cur.always : true;
  const date = DAY_OK(b.date) ? b.date : DAY_OK(cur.date) ? cur.date : "";
  if (!always && !date) return { error: "Pick the pickup day, or make it always available." };
  const pay = ["link", "pickup"].includes(b.pay) ? b.pay : cur.pay || "pickup", payUrl = String(b.payUrl ?? cur.payUrl ?? "").trim();
  if (pay === "link" && !/^https:\/\/[^\s<>"]{3,300}$/i.test(payUrl)) return { error: "Payment links start with https://. Or pick Pay at pickup." };
  const title = clean(b.title ?? cur.title, 80) || (items.length === 1 ? items[0].name : `${items[0].name} and more`);
  return { drop: { title, note: clean(b.note ?? cur.note, 240), items, slots, area, address: clean(b.address ?? cur.address, 160), always, date: always ? "" : date,
    orderBy: clean(b.orderBy ?? cur.orderBy, 40), orderByDate: DAY_OK(b.orderByDate) ? b.orderByDate : "", pay, payUrl: pay === "link" ? payUrl : "",
    open: b.open != null ? !!b.open : cur.open != null ? !!cur.open : true, repeatWeekly: !always && (b.repeatWeekly != null ? !!b.repeatWeekly : !!cur.repeatWeekly) } };
}

/** The drop as the event it is under the hood. The exact address goes in venueAddr, which a casual event keeps for guests who are in. */
export function dropEvent(d, host = {}, cur = {}) {
  return { ...cur, name: d.title, pubTitle: d.title, why: d.note, drop: true, preorder: true, casual: true, always: d.always, date: d.date, startTime: "",
    slots: d.slots, orderItems: d.items, priceUnit: "each", price: "", headcount: 0, hood: d.area, meetPoint: "", venueName: "", venueAddr: d.address, city: cur.city || host.city || "",
    ticketUrl: d.payUrl, ticketNote: d.pay === "pickup" ? "Pay at pickup" : "", orderBy: d.orderBy, orderByDate: d.orderByDate, ordersPaused: !d.open, repeat: d.repeatWeekly ? "weekly" : "",
    hostName: host.name || cur.hostName || "", published: true, discoverable: true, unlisted: cur.unlisted ?? false, batchAt: cur.batchAt || Date.now(), updatedAt: Date.now(), createdAt: cur.createdAt || Date.now() };
}
/** Back from the event to what the setup sheet edits. */
export function dropOf(id, e) {
  return { id, title: e.pubTitle || e.name || "", note: e.why || "", items: (e.orderItems || []).map((x) => ({ id: x.id || "", name: x.name, price: +x.price || 0, desc: x.desc || "", stock: +x.stock || 0, max: +x.max || 6, photo: x.photo || "" })),
    slots: e.slots || [], area: e.hood || e.meetPoint || "", address: e.venueAddr || "", always: !!e.always, date: e.date || "", orderBy: e.orderBy || "", orderByDate: e.orderByDate || "",
    pay: e.ticketUrl ? "link" : "pickup", payUrl: e.ticketUrl || "", open: !e.ordersPaused, repeatWeekly: e.repeat === "weekly", batchAt: e.batchAt || 0 };
}

/** How many of each item this batch's orders hold (cancelled ones and replies from before the batch don't count). */
export function soldOf(S, eventId, ev) {
  const n = {}; const since = +ev?.batchAt || 0;
  for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== eventId || r.response !== "going" || r.orderStatus === "cancelled" || (+r.orderAt || +r.createdAt || 0) < since) continue;
    for (const l of r.orderLines || []) n[l.name] = (n[l.name] || 0) + (Math.max(0, Math.floor(+l.qty) || 0)); }
  return n;
}
/** Can this order go through? Paused, over an item's per-order max, or past what's left this batch: a sentence; else "". */
export function dropOrderError(ev, lines, sold) {
  if (!ev?.drop) return "";
  if (ev.ordersPaused) return "Orders are paused right now. Follow the host to hear when they open.";
  for (const l of lines || []) { const it = (ev.orderItems || []).find((x) => x.name === l.name); if (!it) continue;
    if (+it.max && l.qty > +it.max) return `Up to ${it.max} ${it.name} per order.`;
    if (+it.stock) { const left = Math.max(0, +it.stock - (sold[it.name] || 0)); if (l.qty > left) return left ? `Only ${left} ${it.name} left.` : `Sold out. No ${it.name} left.`; } }
  return "";
}
/** What guests see of a drop: never the exact address. */
export function publicDrop(id, ev, sold, host) {
  return { id, url: `/e/${encodeURIComponent(id)}`, title: ev.pubTitle || ev.name || "", note: ev.why || "", area: ev.hood || "", slots: ev.slots || [], always: !!ev.always, date: ev.date || "",
    orderBy: ev.orderBy || "", paused: !!ev.ordersPaused, payAtPickup: !ev.ticketUrl, payOnline: !!ev.ticketUrl, hasAddress: !!String(ev.venueAddr || "").trim(),
    items: (ev.orderItems || []).map((x, i) => ({ i, name: x.name, price: +x.price || 0, priceText: money(Math.round((+x.price || 0) * 100)), desc: x.desc || "", photo: x.photo || "", max: +x.max || 6, left: +x.stock ? Math.max(0, +x.stock - (sold[x.name] || 0)) : null })),
    ...(host ? { host: { handle: host.handle, name: host.name } } : {}) };
}
export const dropsOf = (store, ws) => scopeStore(store, ws).list("events").filter((d) => d.data?.drop && !d.data.cancelled).map((d) => ({ id: d.id, e: d.data }));
const today = () => new Date().toISOString().slice(0, 10);
/** The drops a page shows: open or not, always-available ones and dated ones not past. */
export const liveDrops = (store, ws) => dropsOf(store, ws).filter(({ e }) => e.always || !e.date || e.date >= today());

/** Turn a host's old shop into an always-available drop, once. Returns the new event id or "". */
export function shopToDrop(store, C, ws) {
  const W = getWorkspace(ws), h = W?.host, s = h?.shop; if (!s || s.eventId || !(s.items || []).some((x) => +x.cents > 0)) return ""; // a shop with no priced item is set up again (its words prefill the setup)
  const id = newId(); if (!claimEvent(id, ws)) return "";
  const d = { title: s.title || "From the shop", note: s.note || "", items: s.items.filter((x) => +x.cents > 0).map((x) => ({ id: x.id, name: x.name, price: (+x.cents || 0) / 100, desc: x.desc || "", stock: +x.stock || 0, max: +x.max || 6, photo: x.photo || "" })),
    slots: s.slots || [], area: s.where || h.hood || h.city || "", address: s.address || "", always: true, date: "", orderBy: "", orderByDate: "", pay: s.payUrl ? "link" : "pickup", payUrl: s.payUrl || "", open: !!s.open, repeatWeekly: false };
  scopeStore(store, ws).set("events/" + id, { id, ...dropEvent(d, h), fromShop: s.dropId || true });
  updateWorkspace(ws, { host: { ...h, shop: { ...s, eventId: id, migratedAt: Date.now() } } });
  return id;
}
export function migrateShops(store, C) { let n = 0; for (const ws of allWorkspaceIds()) { try { if (shopToDrop(store, C, ws)) n++; } catch {} } return n; }

export function mountDrops(app, { store, small, currentUser, publicOrigin, C, X }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  try { migrateShops(store, C); } catch {}
  const counts = (S, id, ev) => { let orders = 0, items = 0, cents = 0; const since = +ev.batchAt || 0;
    for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || r.response !== "going" || r.orderStatus === "cancelled" || (+r.orderAt || +r.createdAt || 0) < since || !(r.orderLines || []).length) continue; orders++; for (const l of r.orderLines) { items += +l.qty || 0; cents += Math.round((+l.price || 0) * 100) * (+l.qty || 0); } }
    return { orders, items, total: money(cents) }; };
  const mine = (u) => { const S = scopeStore(store, u.ws), h = C.profileOf(u.ws) || {}; return { S, h }; };

  app.get("/api/host/drops", (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u);
    // a shop set up before drops existed becomes one now (the first time its owner looks)
    try { shopToDrop(store, C, u.ws); } catch {}
    res.json({ handle: h.handle || "", legacy: h.shop && !h.shop.eventId ? { area: h.shop.where || "", address: h.shop.address || "", slots: h.shop.slots || [], payUrl: h.shop.payUrl || "", title: h.shop.title || "", note: h.shop.note || "", items: (h.shop.items || []).filter((x) => x.name).map((x) => ({ name: x.name, price: +x.cents ? x.cents / 100 : "", stock: x.stock || "", photo: x.photo || "" })) } : null,
      drops: dropsOf(store, u.ws).sort((a, b) => (b.e.createdAt || 0) - (a.e.createdAt || 0)).map(({ id, e }) => ({ ...dropOf(id, e), url: `${publicOrigin(req)}/e/${encodeURIComponent(id)}`, path: `/e/${encodeURIComponent(id)}`, batch: counts(S, id, e) })) }); });

  app.post("/api/host/drops", small, (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u); if (!h.handle) return bad(res, "Set up your page first.");
    const r = cleanDrop(req.body || {}); if (r.error) return bad(res, r.error);
    const id = newId(); if (!claimEvent(id, u.ws)) return bad(res, "Try that again.", 409, "conflict");
    S.set("events/" + id, { id, ...dropEvent(r.drop, h) });
    res.json({ ok: true, id, path: `/e/${encodeURIComponent(id)}`, url: `${publicOrigin(req)}/e/${encodeURIComponent(id)}`, drop: dropOf(id, S.get("events/" + id).data) }); });

  app.post("/api/host/drops/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u), id = clean(req.params.id, 80), cur = S.get("events/" + id)?.data; if (!cur?.drop) return bad(res, "No such drop.", 404, "not_found");
    const r = cleanDrop(req.body || {}, dropOf(id, cur)); if (r.error) return bad(res, r.error);
    S.set("events/" + id, { id, ...dropEvent(r.drop, h, cur) });
    res.json({ ok: true, id, path: `/e/${encodeURIComponent(id)}`, drop: dropOf(id, S.get("events/" + id).data) }); });

  // a new batch: an always-available drop clears this batch's counts and keeps its items; a dated one makes next week's
  app.post("/api/host/drops/:id/new-batch", small, async (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u), id = clean(req.params.id, 80), cur = S.get("events/" + id)?.data; if (!cur?.drop) return bad(res, "No such drop.", 404, "not_found");
    let nid = id;
    if (cur.always || !cur.date) S.update("events/" + id, { batchAt: Date.now(), ordersPaused: false });
    else { const nd = new Date(cur.date + "T12:00:00Z"); nd.setUTCDate(nd.getUTCDate() + 7); nid = newId(); while (!claimEvent(nid, u.ws)) nid = newId();
      S.set("events/" + nid, { ...cur, id: nid, date: nd.toISOString().slice(0, 10), orderByDate: "", prevId: id, batchAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), ordersPaused: false }); }
    let told = 0;
    if (req.body?.tell !== false) { const ev = S.get("events/" + nid).data, F = C.followersOf(u.ws), cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true), link = `${publicOrigin(req)}/e/${encodeURIComponent(nid)}`;
      for (const f of F) { if (!f.email) continue; try { X.notify(f.email, { kind: "drop", key: `drop-${nid}-${ev.batchAt}`, text: `${h.name}: ${ev.pubTitle} is open for orders`, link: `/e/${encodeURIComponent(nid)}`, eventId: nid }); } catch {}
        if (cfg && X.canEmail(f.email)) { const r = await sendEmail(cfg, { list: "guest", to: f.email, subject: `${ev.pubTitle} from ${h.name}`, text: `${ev.pubTitle} is open for orders.\n${(ev.orderItems || []).map((x) => `· ${x.name}: ${money(Math.round(x.price * 100))}`).join("\n")}${(ev.slots || []).length ? `\nPickup: ${ev.slots.join(", ")}` : ""}\n\nOrder: ${link}\n\nYou follow ${h.name} on Pottery Lab.`, fromName: h.name }).catch(() => ({})); if (r.ok) told++; } } }
    res.json({ ok: true, id: nid, path: `/e/${encodeURIComponent(nid)}`, told, fresh: nid !== id }); });

  // guests: one drop's menu, with what's left this batch. Never the exact address.
  app.get("/api/public/drop/:id", (req, res) => { const id = clean(req.params.id, 80); if (!/^[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(404).json({ code: "not_found", message: "No such drop." });
    const ws = workspaceOfEvent(id), S = scopeStore(store, ws), ev = ws && ws !== DEFAULT_WS ? S.get("events/" + id)?.data : null; if (!ev?.drop || ev.cancelled) return res.status(404).json({ code: "not_found", message: "No such drop." });
    res.json({ drop: publicDrop(id, ev, soldOf(S, id, ev), C.profileOf(ws)) }); });
  // a host's open drops, for their page's "What I offer"
  app.get("/api/public/drops/:handle", (req, res) => { const ws = C.wsOfHandle(clean(req.params.handle, 40).toLowerCase()); if (!ws) return res.json({ drops: [] }); const S = scopeStore(store, ws);
    res.json({ drops: liveDrops(store, ws).filter(({ e }) => e.discoverable).map(({ id, e }) => publicDrop(id, e, soldOf(S, id, e))) }); });

  // the old shop links (/x/<handle>/shop/<i>, from shares and the feed) open the drop that replaced the shop
  app.get(/^\/x\/([a-z0-9][a-z0-9-]{1,39})\/shop\/([A-Za-z0-9_-]{1,20})$/, (req, res, next) => { const ws = C.wsOfHandle(req.params[0]); if (!ws) return next();
    const h = C.profileOf(ws), L = liveDrops(store, ws); const to = (h?.shop?.eventId && L.find((x) => x.id === h.shop.eventId)) || L[0];
    return to ? res.redirect(302, `/e/${encodeURIComponent(to.id)}`) : next(); });

  // one Orders inbox: every drop's orders (they're replies), newest first
  const dropOrders = (ws, origin) => { const S = scopeStore(store, ws), D = new Map(dropsOf(store, ws).map((x) => [x.id, x.e])), out = [];
    for (const d of S.list("rsvps")) { const r = d.data || {}, ev = D.get(r.eventId); if (!ev || !(r.orderLines || []).length || !["going", "no"].includes(r.response)) continue;
      const cents = (r.orderLines || []).reduce((a, l) => a + Math.round((+l.price || 0) * 100) * (+l.qty || 0), 0);
      const status = r.orderStatus || (r.response === "no" ? "cancelled" : r.checkedInAt ? "picked" : r.paid ? "paid" : "new");
      out.push({ id: d.id, src: "drop", eventId: r.eventId, drop: ev.pubTitle || ev.name || "", code: String(r.code || d.id).slice(0, 6).toUpperCase(), name: r.name || "", email: r.email || "", phone: r.phone || "", slot: r.pickupLabel || r.slot || "",
        lines: r.orderLines.map((l) => ({ name: l.name, qty: +l.qty || 0, cents: Math.round((+l.price || 0) * 100) })), total: cents, totalText: money(cents), status, at: +r.orderAt || +r.createdAt || 0, current: (+r.orderAt || +r.createdAt || 0) >= (+ev.batchAt || 0) }); }
    return out; };
  app.locals.dropOrders = dropOrders;
  app.post("/api/host/drop-orders/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), p = "rsvps/" + clean(req.params.id, 60), r = S.get(p)?.data; if (!r) return bad(res, "No such order.", 404, "not_found");
    const ev = S.get("events/" + r.eventId)?.data; if (!ev?.drop) return bad(res, "No such order.", 404, "not_found");
    const st = ["new", "paid", "ready", "picked", "cancelled"].includes(req.body?.status) ? req.body.status : r.orderStatus || "new";
    S.update(p, { orderStatus: st, [st + "At"]: Date.now(), ...(st === "paid" ? { paid: true, paidAt: Date.now() } : {}), ...(st === "picked" ? { checkedInAt: Date.now() } : {}), ...(st === "cancelled" ? { response: "no" } : r.response === "no" ? { response: "going" } : {}) });
    res.json({ ok: true, status: st }); });
  return { dropOrders };
}
