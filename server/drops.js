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
import { foreignBlob } from "./photos.js";
import { payStateOf, payModeOf, asksAhead, pickupOk, makeDropPay } from "./droppay.js";
import { payOfWs, hasPay } from "./paymethods.js"; // Orders: nudge a host who asks to be paid ahead with no way to get paid // paying before pickup: where an order stands, reminders
import { pageItems } from "./pageitems.js";
import "../public/pickup.js"; // the one reader of pickup windows, shared with every page (window.PLPickup)
const P = () => globalThis.PLPickup;

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
const HM = /^\d{2}:\d{2}$/, WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PHOTO_OK = (u) => BLOB_OK(u) || /^\/presets\/[\w./-]{1,80}$/.test(u || "");
/** A drawn cover ("Describe it and Potto draws it"): an <svg> with no script, handler or link in it. */
const svgOk = (s) => typeof s === "string" && /^<svg[\s>]/.test(s) && s.length < 40000 && !/<script|<foreign|\bon[a-z]+\s*=|javascript:|href\s*=/i.test(s);
const focusOf = (f) => (f && typeof f === "object" && Number.isFinite(+f.x) && Number.isFinite(+f.y) ? { x: Math.max(0, Math.min(100, Math.round(+f.x))), y: Math.max(0, Math.min(100, Math.round(+f.y))) } : null);
/** The cover as a drop keeps it: a photo (with its original and focal point) or a drawn cover. */
function coverOf(b, cur) { const has = (k) => Object.prototype.hasOwnProperty.call(b, k), pick = (k) => (has(k) ? b[k] : cur[k]);
  const photo = pick("coverPhoto"), art = pick("coverArt");
  return { coverPhoto: PHOTO_OK(photo) ? photo : "", coverSource: BLOB_OK(pick("coverSource")) ? pick("coverSource") : "", coverFocus: focusOf(pick("coverFocus")),
    coverArt: art && typeof art === "object" && /^[a-z+-]{2,40}$/.test(String(art.kind || "")) ? { kind: art.kind, tone: clean(art.tone, 20), ...(art.kind === "custom" && svgOk(art.svg) ? { svg: art.svg, prompt: clean(art.prompt, 120) } : {}) } : null }; }
/**
 * Pickup windows: a date and a time ("Sun, Dec 6, 9 to 10am"), or a weekday for a drop that runs every week. Drops made
 * before windows existed send free words in slots ("Sat 9 to 10am"), read by the shared reader (public/pickup.js).
 */
export function cleanWindows(raw, { date = "", always = true } = {}) {
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const w of src.slice(0, 8)) { if (!w || typeof w !== "object") continue;
    const d = DAY_OK(w.date) ? w.date : "", day = WEEKDAYS.includes(w.day) ? w.day : "", start = HM.test(w.start || "") ? w.start : "", end = HM.test(w.end || "") && (!start || w.end > w.start) ? w.end : "";
    if (!d && !day) return { error: "Pick a day for each pickup window." };
    if (!start) return { error: "Pick a start time for each pickup window." };
    const id = /^[a-z0-9]{4,12}$/.test(w.id || "") ? w.id : crypto.randomBytes(3).toString("hex");
    out.push({ id, date: d, day: d ? "" : day, start, end, cap: Math.max(0, Math.min(500, Math.round(+w.cap || 0))) }); }
  return { windows: out };
}
const windowsFromSlots = (slots, date, always) => P().windowsOf({ slots, date, always }).filter((w) => w.start).map((w) => ({ id: crypto.randomBytes(3).toString("hex"), date: w.date || "", day: w.date ? "" : w.day || "", start: w.start, end: w.end || "", cap: 0 }));

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
    // up to 4 photos an item, the first is its main one (an old item kept one photo)
    const photos = [...new Set([...(Array.isArray(x?.photos) ? x.photos : []), ...(x?.photo ? [x.photo] : [])].filter(BLOB_OK))].slice(0, 4);
    items.push({ id: /^[a-z0-9]{6,12}$/.test(x?.id || "") ? x.id : crypto.randomBytes(4).toString("hex"), name, price, desc: clean(x?.desc, 160),
      stock: Math.max(0, Math.min(999, Math.round(+x?.stock || 0))), max: Math.max(1, Math.min(50, Math.round(+x?.max || 6))), photo: photos[0] || "", photos });
  }
  if (!items.length) return { error: "Add at least one thing to sell, with a price." };
  const date0 = DAY_OK(b.date) ? b.date : DAY_OK(cur.date) ? cur.date : "", always0 = b.always != null ? !!b.always : cur.always != null ? !!cur.always : true;
  let windows;
  if (Array.isArray(b.windows)) { const r = cleanWindows(b.windows); if (r.error) return r; windows = r.windows; }
  else if (Array.isArray(b.slots)) windows = windowsFromSlots(b.slots.map((s) => clean(s, 60)).filter(Boolean), date0, always0);
  else windows = (cur.windows || []).length ? cleanWindows(cur.windows).windows || [] : windowsFromSlots(cur.slots || [], date0, always0);
  // words that never read as a time ("after church") stay as the host wrote them, as before
  const loose = !Array.isArray(b.windows) && Array.isArray(b.slots) ? b.slots.map((s) => clean(s, 60)).filter((s) => s && !P().parseSlot(s)) : [];
  if (!windows.length && !loose.length) return { error: "Add at least one pickup time." };
  const cap = Math.max(0, Math.min(500, Math.round(+(b.windowCap ?? cur.windowCap ?? 0) || 0)));
  if (cap) windows = windows.map((w) => ({ ...w, cap: w.cap || cap }));
  const dated = windows.filter((w) => w.date).sort((a, z) => a.date.localeCompare(z.date) || a.start.localeCompare(z.start));
  const always = windows.length ? !dated.length : always0, date = dated[0]?.date || (always ? "" : date0);
  if (!always && !date) return { error: "Pick the pickup day, or make it always available." };
  const slots = [...windows.map((w) => P().label(w)), ...loose].filter((s, i, A) => A.indexOf(s) === i).slice(0, 8);
  const area = clean(b.area ?? cur.area, 80);
  if (!area) return { error: "Add the neighborhood people see, like Midtown or Greenpoint." };
  // how they pay (server/droppay.js): ahead, ahead or at pickup, at pickup only. "link" is the older pay-ahead-with-a-link.
  const pay = ["link", "pickup", "ahead", "either"].includes(b.pay) ? b.pay : cur.pay || "pickup", payUrl = pay === "pickup" ? "" : String(b.payUrl ?? cur.payUrl ?? "").trim();
  if (pay === "link" && !/^https:\/\/[^\s<>"]{3,300}$/i.test(payUrl)) return { error: "Payment links start with https://. Or pick Pay at pickup." };
  if (payUrl && !/^https:\/\/[^\s<>"]{3,300}$/i.test(payUrl)) return { error: "Payment links start with https://. Or leave it empty to use your Get paid methods." };
  const title = clean(b.title ?? cur.title, 80) || (items.length === 1 ? items[0].name : `${items[0].name} and more`);
  const byDate = DAY_OK(b.orderByDate) ? b.orderByDate : b.orderByDate === "" ? "" : DAY_OK(cur.orderByDate) ? cur.orderByDate : "", byTime = HM.test(b.orderByTime ?? cur.orderByTime ?? "") ? (b.orderByTime ?? cur.orderByTime) : "";
  return { drop: { title, note: clean(b.note ?? cur.note, 240), items, slots, windows, windowCap: cap, area, address: clean(b.address ?? cur.address, 160), always, date: always ? "" : date,
    orderBy: clean(b.orderBy ?? cur.orderBy, 40), orderByDate: byDate, orderByTime: byDate ? byTime : "", pay, payUrl, allergens: clean(b.allergens ?? cur.allergens, 200),
    open: b.open != null ? !!b.open : cur.open != null ? !!cur.open : true, repeatWeekly: !always && (b.repeatWeekly != null ? !!b.repeatWeekly : !!cur.repeatWeekly), ...coverOf(b, cur) } };
}

/** The drop as the event it is under the hood. The exact address goes in venueAddr, which a casual event keeps for guests who are in.
 *  Its date and time are the first pickup window's, so every view that reads an event's date shows the pickup day. */
export function dropEvent(d, host = {}, cur = {}) {
  const first = (d.windows || []).filter((w) => w.date).sort((a, z) => a.date.localeCompare(z.date) || a.start.localeCompare(z.start))[0];
  return { ...cur, name: d.title, pubTitle: d.title, why: d.note, drop: true, preorder: true, casual: true, planKind: "drop", always: d.always, date: first?.date || d.date, startTime: first?.start || "", endTime: first?.end || "",
    slots: d.slots, windows: d.windows || [], windowCap: d.windowCap || 0, orderItems: d.items, priceUnit: "each", price: "", headcount: 0, hood: d.area, meetPoint: "", venueName: "", venueAddr: d.address, city: cur.city || host.city || "",
    ticketUrl: d.pay === "pickup" ? "" : d.payUrl || "", ticketNote: d.pay === "pickup" ? "Pay at pickup" : "", payMode: d.pay || "pickup", orderBy: d.orderBy || (d.orderByDate ? P().day(d.orderByDate) + (d.orderByTime ? " " + P().span({ start: d.orderByTime }) : "") : ""), orderByDate: d.orderByDate, orderByTime: d.orderByTime || "",
    allergens: d.allergens || "", ordersPaused: !d.open, repeat: d.repeatWeekly ? "weekly" : "",
    coverPhoto: d.coverPhoto || "", coverSource: d.coverSource || "", coverFocus: d.coverFocus || null, coverArt: d.coverArt || null,
    hostName: host.name || cur.hostName || "", published: true, discoverable: true, unlisted: cur.unlisted ?? false, batchAt: cur.batchAt || Date.now(), updatedAt: Date.now(), createdAt: cur.createdAt || Date.now() };
}
/** Back from the event to what the setup sheet edits. */
export function dropOf(id, e) {
  const windows = (e.windows || []).length ? e.windows : windowsFromSlots(e.slots || [], e.date, e.always);
  return { id, title: e.pubTitle || e.name || "", note: e.why || "", items: (e.orderItems || []).map((x) => ({ id: x.id || "", name: x.name, price: +x.price || 0, desc: x.desc || "", stock: +x.stock || 0, max: +x.max || 6, photo: x.photo || "", photos: (x.photos || []).length ? x.photos : x.photo ? [x.photo] : [] })),
    slots: e.slots || [], windows, windowCap: +e.windowCap || 0, area: e.hood || e.meetPoint || "", address: e.venueAddr || "", always: !!e.always, date: e.date || "", orderBy: e.orderBy || "", orderByDate: e.orderByDate || "", orderByTime: e.orderByTime || "",
    pay: ["link", "ahead", "either", "pickup"].includes(e.payMode) ? e.payMode : e.ticketUrl ? "link" : "pickup", payUrl: e.ticketUrl || "", allergens: e.allergens || "", open: !e.ordersPaused, repeatWeekly: e.repeat === "weekly", batchAt: e.batchAt || 0,
    coverPhoto: e.coverPhoto || "", coverSource: e.coverSource || "", coverFocus: e.coverFocus || null, coverArt: e.coverArt || null };
}

const live = (r, eventId, since) => r.eventId === eventId && r.response === "going" && r.orderStatus !== "cancelled" && (+r.orderAt || +r.createdAt || 0) >= since;
/** How many of each item this batch's orders hold (cancelled ones and replies from before the batch don't count). */
export function soldOf(S, eventId, ev) {
  const n = {}; const since = +ev?.batchAt || 0;
  for (const d of S.list("rsvps")) { const r = d.data || {}; if (!live(r, eventId, since)) continue;
    for (const l of r.orderLines || []) n[l.name] = (n[l.name] || 0) + (Math.max(0, Math.floor(+l.qty) || 0)); }
  return n;
}
/** How many orders each pickup window holds this batch, by the window's words. */
export function ordersBySlot(S, eventId, ev) {
  const n = {}; const since = +ev?.batchAt || 0;
  for (const d of S.list("rsvps")) { const r = d.data || {}; if (!live(r, eventId, since) || !(r.orderLines || []).length) continue; const k = String(r.slot || ""); n[k] = (n[k] || 0) + 1; }
  return n;
}
/** Can this order go through? Paused, over an item's per-order max, past what's left this batch, or a full window: a sentence; else "". */
export function dropOrderError(ev, lines, sold, slot = "", bySlot = {}) {
  if (!ev?.drop) return "";
  if (ev.ordersPaused) return "Orders are paused right now. Follow the host to hear when they open.";
  for (const l of lines || []) { const it = (ev.orderItems || []).find((x) => x.name === l.name); if (!it) continue;
    if (+it.max && l.qty > +it.max) return `Up to ${it.max} ${it.name} per order.`;
    if (+it.stock) { const left = Math.max(0, +it.stock - (sold[it.name] || 0)); if (l.qty > left) return left ? `Only ${left} ${it.name} left.` : `Sold out. No ${it.name} left.`; } }
  const W = P().windowsOf(ev);
  if (W.length && W.some((w) => w.start)) { const w = P().windowOfSlot(ev, slot);
    if (!w) return "Pick a pickup time.";
    if (+w.cap && (bySlot[P().label(w)] || 0) >= +w.cap) return `${P().label(w)} is full. Pick another pickup time.`; }
  return "";
}
/** The day before a pickup, or once orders close: when someone who ordered gets the exact address. */
export function addressOpen(ev, slot, now = Date.now()) {
  if (!ev?.drop) return true;
  const today = new Date(now).toISOString().slice(0, 10), tomorrow = new Date(now + 864e5).toISOString().slice(0, 10);
  if (DAY_OK(ev.orderByDate) && today > ev.orderByDate) return true;
  const w = P().windowOfSlot(ev, slot), day = w ? P().dateFor(w, today) : P().firstDate(ev, today);
  return !day || day <= tomorrow;
}
/** What guests see of a drop: never the exact address. */
export function publicDrop(id, ev, sold, host, bySlot = {}) {
  const items = (ev.orderItems || []).map((x, i) => ({ i, name: x.name, price: +x.price || 0, priceText: money(Math.round((+x.price || 0) * 100)), desc: x.desc || "", photo: x.photo || "", photos: (x.photos || []).length ? x.photos : x.photo ? [x.photo] : [], max: +x.max || 6, stock: +x.stock || 0, left: +x.stock ? Math.max(0, +x.stock - (sold[x.name] || 0)) : null }));
  const windows = P().windowsOf(ev).map((w) => { const label = P().label(w), n = bySlot[label] || 0; return { id: w.id, date: w.date || "", day: w.day || "", start: w.start || "", end: w.end || "", label, full: !!(+w.cap && n >= +w.cap), ...(+w.cap ? { left: Math.max(0, +w.cap - n) } : {}) }; });
  return { id, url: `/e/${encodeURIComponent(id)}`, title: ev.pubTitle || ev.name || "", note: ev.why || "", area: ev.hood || "", slots: ev.slots || [], windows, always: !!ev.always, date: ev.date || "",
    pickup: P().line(ev), left: P().leftLine(items), cover: PHOTO_OK(ev.coverPhoto) ? ev.coverPhoto : items.find((x) => x.photo)?.photo || "", coverPhoto: PHOTO_OK(ev.coverPhoto) ? ev.coverPhoto : "", coverArt: ev.coverArt || null,
    allergens: ev.allergens || "", orderBy: ev.orderBy || "", orderByDate: ev.orderByDate || "", paused: !!ev.ordersPaused, payMode: payModeOf(ev), payAhead: asksAhead(ev), payAtPickup: !asksAhead(ev) || pickupOk(ev), payOnline: asksAhead(ev), payLink: !!String(ev.ticketUrl || "").trim(), hasAddress: !!String(ev.venueAddr || "").trim(),
    city: ev.city || "", example: !!(ev.example || ev.sample), items,
    ...(host ? { host: { handle: host.handle, name: host.name, avatarUrl: host.theme?.avatarUrl || "" } } : {}) };
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

export function mountDrops(app, { store, small, currentUser, publicOrigin, C, X, replyToken = null }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { const u = currentUser(req); if (!u || u.ws === DEFAULT_WS) { res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return null; } return u; };
  try { migrateShops(store, C); } catch {}
  const counts = (S, id, ev) => { let orders = 0, items = 0, cents = 0; const since = +ev.batchAt || 0;
    for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.eventId !== id || r.response !== "going" || r.orderStatus === "cancelled" || (+r.orderAt || +r.createdAt || 0) < since || !(r.orderLines || []).length) continue; orders++; for (const l of r.orderLines) { items += +l.qty || 0; cents += Math.round((+l.price || 0) * 100) * (+l.qty || 0); } }
    return { orders, items, total: money(cents) }; };
  // a drop wears only its owner's own uploads (server/photos.js): someone else's photo url is dropped from the save
  const ownPhotos = (b, ws) => { if (!b || typeof b !== "object") return b; const o = { ...b };
    if (foreignBlob(ws, o.coverPhoto)) delete o.coverPhoto; if (foreignBlob(ws, o.coverSource)) delete o.coverSource;
    if (Array.isArray(o.items)) o.items = o.items.map((x) => (x && typeof x === "object" ? { ...x, photo: foreignBlob(ws, x.photo) ? "" : x.photo, photos: Array.isArray(x.photos) ? x.photos.filter((u) => !foreignBlob(ws, u)) : x.photos } : x));
    return o; };
  const mine = (u) => { const S = scopeStore(store, u.ws), h = C.profileOf(u.ws) || {}; return { S, h }; };

  // the first-time tutorial ("How drops work", public/dropsetup.js): shown once a person, before their first drop
  const tourKey = (email) => "system/droptour-" + crypto.createHash("sha256").update(String(email || "").toLowerCase()).digest("hex").slice(0, 24);
  app.post("/api/host/drop-tour", small, (req, res) => { const u = me(req, res); if (!u) return; store.set(tourKey(u.email), { kind: "droptour", at: Date.now() }); res.json({ ok: true }); });
  app.get("/api/host/drops", (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u);
    // a shop set up before drops existed becomes one now (the first time its owner looks)
    try { shopToDrop(store, C, u.ws); } catch {}
    res.json({ handle: h.handle || "", tour: !dropsOf(store, u.ws).length && !store.get(tourKey(u.email)), getPaid: hasPay(payOfWs(u.ws)), legacy: h.shop && !h.shop.eventId ? { area: h.shop.where || "", address: h.shop.address || "", slots: h.shop.slots || [], payUrl: h.shop.payUrl || "", title: h.shop.title || "", note: h.shop.note || "", items: (h.shop.items || []).filter((x) => x.name).map((x) => ({ name: x.name, price: +x.cents ? x.cents / 100 : "", stock: x.stock || "", photo: x.photo || "" })) } : null,
      drops: dropsOf(store, u.ws).sort((a, b) => (b.e.createdAt || 0) - (a.e.createdAt || 0)).map(({ id, e }) => ({ ...dropOf(id, e), url: `${publicOrigin(req)}/e/${encodeURIComponent(id)}`, path: `/e/${encodeURIComponent(id)}`, batch: counts(S, id, e) })) }); });

  app.post("/api/host/drops", small, (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u); if (!h.handle) return bad(res, "Set up your page first.");
    const r = cleanDrop(ownPhotos(req.body || {}, u.ws)); if (r.error) return bad(res, r.error);
    const id = newId(); if (!claimEvent(id, u.ws)) return bad(res, "Try that again.", 409, "conflict");
    S.set("events/" + id, { id, ...dropEvent(r.drop, h) });
    try { req.app?.locals?.fanclub?.onPublish?.(req, u.ws, id); } catch {} // members first, then followers (server/fanclub.js)
    res.json({ ok: true, id, path: `/e/${encodeURIComponent(id)}`, url: `${publicOrigin(req)}/e/${encodeURIComponent(id)}`, drop: dropOf(id, S.get("events/" + id).data) }); });

  app.post("/api/host/drops/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u), id = clean(req.params.id, 80), cur = S.get("events/" + id)?.data; if (!cur?.drop) return bad(res, "No such drop.", 404, "not_found");
    const r = cleanDrop(ownPhotos(req.body || {}, u.ws), dropOf(id, cur)); if (r.error) return bad(res, r.error);
    S.set("events/" + id, { id, ...dropEvent(r.drop, h, cur) });
    res.json({ ok: true, id, path: `/e/${encodeURIComponent(id)}`, drop: dropOf(id, S.get("events/" + id).data) }); });

  // a new batch: an always-available drop clears this batch's counts and keeps its items; a dated one makes next week's
  app.post("/api/host/drops/:id/new-batch", small, async (req, res) => { const u = me(req, res); if (!u) return; const { S, h } = mine(u), id = clean(req.params.id, 80), cur = S.get("events/" + id)?.data; if (!cur?.drop) return bad(res, "No such drop.", 404, "not_found");
    let nid = id;
    if (cur.always || !cur.date) S.update("events/" + id, { batchAt: Date.now(), ordersPaused: false });
    else { const nd = new Date(cur.date + "T12:00:00Z"); nd.setUTCDate(nd.getUTCDate() + 7); nid = newId(); while (!claimEvent(nid, u.ws)) nid = newId();
      const wk = (d) => (DAY_OK(d) ? new Date(Date.parse(d + "T12:00:00Z") + 7 * 864e5).toISOString().slice(0, 10) : d), W2 = (cur.windows || []).map((w) => ({ ...w, date: wk(w.date) }));
      S.set("events/" + nid, { ...cur, id: nid, date: nd.toISOString().slice(0, 10), ...(W2.length ? { windows: W2, slots: W2.map((w) => P().label(w)) } : {}), orderByDate: "", prevId: id, batchAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), ordersPaused: false }); }
    let told = 0;
    if (req.body?.tell !== false) { const ev = S.get("events/" + nid).data, F = C.followersOf(u.ws), cfg = emailConfig(u.ws, false) || emailConfig(DEFAULT_WS, true), link = `${publicOrigin(req)}/e/${encodeURIComponent(nid)}`;
      for (const f of F) { if (!f.email) continue; try { X.notify(f.email, { kind: "drop", key: `drop-${nid}-${ev.batchAt}`, text: `${h.name}: ${ev.pubTitle} is open for orders`, link: `/e/${encodeURIComponent(nid)}`, eventId: nid }); } catch {}
        if (cfg && X.canEmail(f.email)) { const r = await sendEmail(cfg, { list: "guest", to: f.email, subject: `${ev.pubTitle} from ${h.name}`, text: `${ev.pubTitle} is open for orders.\n${(ev.orderItems || []).map((x) => `· ${x.name}: ${money(Math.round(x.price * 100))}`).join("\n")}${(ev.slots || []).length ? `\nPickup: ${ev.slots.join(", ")}` : ""}\n\nOrder: ${link}\n\nYou follow ${h.name} on Pottery Lab.`, fromName: h.name }).catch(() => ({})); if (r.ok) told++; } } }
    res.json({ ok: true, id: nid, path: `/e/${encodeURIComponent(nid)}`, told, fresh: nid !== id }); });

  // guests: one drop's menu, with what's left this batch. Never the exact address.
  app.get("/api/public/drop/:id", (req, res) => { const id = clean(req.params.id, 80); if (!/^[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(404).json({ code: "not_found", message: "No such drop." });
    const ws = workspaceOfEvent(id), S = scopeStore(store, ws), ev = ws && ws !== DEFAULT_WS ? S.get("events/" + id)?.data : null; if (!ev?.drop || ev.cancelled) return res.status(404).json({ code: "not_found", message: "No such drop." });
    res.json({ drop: { ...publicDrop(id, ev, soldOf(S, id, ev), C.profileOf(ws), ordersBySlot(S, id, ev)), ws } }); });
  // a host's open drops, for their page's "What I offer"
  app.get("/api/public/drops/:handle", (req, res) => { const ws = C.wsOfHandle(clean(req.params.handle, 40).toLowerCase()); if (!ws) return res.json({ drops: [] }); const S = scopeStore(store, ws);
    // "Hide from my page" (server/pageitems.js): off the page for visitors, marked for the host; the drop's link still works
    let own = false; try { own = currentUser(req)?.ws === ws; } catch {} const PI = pageItems(store, ws); if (own) res.set("Cache-Control", "private, no-store");
    res.json({ drops: liveDrops(store, ws).filter(({ id, e }) => e.discoverable && (own || !PI.hidden.has("e:" + id))).map(({ id, e }) => ({ ...publicDrop(id, e, soldOf(S, id, e), null, ordersBySlot(S, id, e)), ...(PI.hidden.has("e:" + id) ? { pageHidden: true } : {}), ...(PI.pinned.includes("e:" + id) ? { pinned: PI.pinned.indexOf("e:" + id) + 1 } : {}) })) }); });

  // the old shop links (/x/<handle>/shop/<i>, from shares and the feed) open the drop that replaced the shop
  app.get(/^\/x\/([a-z0-9][a-z0-9-]{1,39})\/shop\/([A-Za-z0-9_-]{1,20})$/, (req, res, next) => { const ws = C.wsOfHandle(req.params[0]); if (!ws) return next();
    const h = C.profileOf(ws), L = liveDrops(store, ws); const to = (h?.shop?.eventId && L.find((x) => x.id === h.shop.eventId)) || L[0];
    return to ? res.redirect(302, `/e/${encodeURIComponent(to.id)}`) : next(); });

  // one Orders inbox: every drop's orders (they're replies), newest first
  const dropOrders = (ws, origin) => { const S = scopeStore(store, ws), D = new Map(dropsOf(store, ws).map((x) => [x.id, x.e])), out = [];
    for (const d of S.list("rsvps")) { const r = d.data || {}, ev = D.get(r.eventId); if (!ev || !(r.orderLines || []).length || !["going", "no"].includes(r.response)) continue;
      const cents = (r.orderLines || []).reduce((a, l) => a + Math.round((+l.price || 0) * 100) * (+l.qty || 0), 0);
      const status = r.orderStatus || (r.response === "no" ? "cancelled" : r.checkedInAt ? "picked" : r.paid ? "paid" : "new");
      const ps = payStateOf(ev, r); // Paid, Claimed, Not paid, at pickup (server/droppay.js)
      out.push({ id: d.id, src: "drop", eventId: r.eventId, drop: ev.pubTitle || ev.name || "", pay: ps.state, payChoice: r.payChoice || "", payAhead: ps.ahead, reminded: (r.payReminders || []).length, payChanged: !!ps.changed, code: String(r.code || d.id).slice(0, 6).toUpperCase(), name: r.name || "", email: r.email || "", phone: r.phone || "", slot: r.slot || r.pickupLabel || "", note: r.orderNote || "",
        lines: r.orderLines.map((l) => ({ name: l.name, qty: +l.qty || 0, cents: Math.round((+l.price || 0) * 100) })), total: cents, totalText: money(cents), status, at: +r.orderAt || +r.createdAt || 0, current: (+r.orderAt || +r.createdAt || 0) >= (+ev.batchAt || 0) }); }
    return out; };
  app.locals.dropOrders = dropOrders;
  // ---- paying before pickup (server/droppay.js): Mark paid, Remind unpaid, the buyer's I'll pay at pickup, the reminders ----
  const DP = makeDropPay({ store, C, X, replyToken, potto: () => app.locals.pottoText }); app.locals.dropPay = DP;
  app.post("/api/host/drop-orders/:id/paid", small, (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), p = "rsvps/" + clean(req.params.id, 60), r = S.get(p)?.data; if (!r) return bad(res, "No such order.", 404, "not_found");
    const ev = S.get("events/" + r.eventId)?.data; if (!ev?.drop) return bad(res, "No such order.", 404, "not_found");
    const on = req.body?.paid !== false, cents = payStateOf(ev, r).cents;
    // Mark paid: cash at pickup, or confirming a buyer's I paid. Undo takes it back (their claim, if any, stays theirs).
    S.update(p, on ? { paid: true, paidAt: Date.now(), paidCents: cents } : { paid: false, paidAt: null, paidCents: 0, ...(r.orderStatus === "paid" ? { orderStatus: "new" } : {}) });
    res.json({ ok: true, pay: payStateOf(ev, S.get(p).data).state }); });
  app.post("/api/host/drops/:id/remind-unpaid", small, async (req, res) => { const u = me(req, res); if (!u) return; const r = await DP.remindUnpaid(u.ws, clean(req.params.id, 80), Date.now(), publicOrigin(req));
    if (r.error) return bad(res, r.error, r.status || 400, r.code || "invalid"); res.json(r); });
  // a buyer chooses how they'll pay, proved by their order's own code: "pickup" (where the host allows it) or back to paying ahead
  app.post("/api/public/drop-pay/:id", small, (req, res) => { const b = req.body || {}, P0 = X.rsvpProof(clean(req.params.id, 80), String(b.rid || "").slice(0, 80), String(b.code || "").slice(0, 40));
    if (!P0 || P0.r.response !== "going" || !P0.ev?.drop) return bad(res, "Open your order first.", 403, "not_granted");
    const choice = b.choice === "pickup" ? "pickup" : "ahead"; if (choice === "pickup" && !pickupOk(P0.ev)) return bad(res, `${P0.ev.hostName ? String(P0.ev.hostName).split(/\s+/)[0] : "The maker"} asks to pay ahead for this one.`, 409, "pay_ahead");
    P0.S.update("rsvps/" + P0.rid.replace(/[^A-Za-z0-9_-]/g, ""), { payChoice: choice === "pickup" ? "pickup" : "", payChoiceAt: Date.now(), changedAt: Date.now() });
    res.json({ ok: true, ...payStateOf(P0.ev, P0.S.get("rsvps/" + P0.rid.replace(/[^A-Za-z0-9_-]/g, ""))?.data) }); });
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => DP.runReminders().catch((e) => console.warn("[droppay]", e?.message)), 15 * 60e3); t.unref?.(); }
  app.post("/api/host/drop-orders/:id", small, (req, res) => { const u = me(req, res); if (!u) return; const S = scopeStore(store, u.ws), p = "rsvps/" + clean(req.params.id, 60), r = S.get(p)?.data; if (!r) return bad(res, "No such order.", 404, "not_found");
    const ev = S.get("events/" + r.eventId)?.data; if (!ev?.drop) return bad(res, "No such order.", 404, "not_found");
    const st = ["new", "paid", "ready", "picked", "cancelled"].includes(req.body?.status) ? req.body.status : r.orderStatus || "new";
    S.update(p, { orderStatus: st, [st + "At"]: Date.now(), ...(st === "paid" ? { paid: true, paidAt: Date.now(), paidCents: payStateOf(ev, r).cents } : {}), ...(st === "picked" ? { checkedInAt: Date.now() } : {}), ...(st === "cancelled" ? { response: "no" } : r.response === "no" ? { response: "going" } : {}) });
    res.json({ ok: true, status: st }); });
  return { dropOrders };
}
