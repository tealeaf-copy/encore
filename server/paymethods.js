// Get paid: how a person gets paid back, kept on their own account (hosts and guests alike) and set in Settings.
// Venmo (@handle), PayPal (PayPal.Me name), Cash App ($cashtag), an optional other pay link (only https, only known
// payment hosts) and an optional short note ("Zelle: maya@example.com", text only).
//
// Every event and drop uses them by default; an event can turn some off (ev.payHide: the keys it leaves out). Guests only
// ever see them through GET /api/public/pay/:eventId with their own reply's id and code, once they are in (a "going"
// reply, which is also what an order is), on an event that asks for money (a price, chip in, a pre-order or a drop).
// Pay in person (ticketNote with no link) shows none. Nothing here touches money: the buttons open the person's own app.
// The browser side is public/paymethods.js (the same cleaning and deep links, the Settings section, the editor sheet).
import { scopeStore, getWorkspace, getDbUser, putDbUser, DEFAULT_WS } from "./workspaces.js";
import { dueCents } from "./social.js";
import { payStateOf } from "./droppay.js"; // a drop's order: Paid, Claimed, Not paid yet, at pickup

export const PAY_KEYS = ["venmo", "paypal", "cashapp", "link", "note"];
export const PAY_LABEL = { venmo: "Venmo", paypal: "PayPal", cashapp: "Cash App", link: "Pay link", note: "Note" };
/** The only hosts an "other pay link" may point at. */
export const PAY_HOSTS = ["buy.stripe.com", "donate.stripe.com", "checkout.stripe.com", "paypal.me", "www.paypal.me", "paypal.com", "www.paypal.com", "venmo.com", "account.venmo.com", "cash.app", "square.link", "checkout.square.site"];

const squash = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f\s]+/g, "");
const URLISH = /^(https?:\/\/|www\.)|\.(com|me|app|link|site)\b/i;
const ID = { venmo: /^[A-Za-z0-9_-]{2,30}$/, paypal: /^[A-Za-z0-9_-]{2,20}$/, cashapp: /^(?=.*[A-Za-z])[A-Za-z0-9_-]{1,20}$/ };
// what each provider's pasted link looks like; group 1 is the handle
const FROM_URL = {
  venmo: /^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?@?([^/?#]+)/i,
  paypal: /^(?:https?:\/\/)?(?:www\.)?(?:paypal\.me|paypal\.com\/paypalme)\/@?([^/?#]+)/i,
  cashapp: /^(?:https?:\/\/)?(?:www\.)?cash\.app\/\$?([^/?#]+)/i,
};
const LEAD = { venmo: /^@/, paypal: /^@/, cashapp: /^\$/ };

/** A handle from what someone typed or pasted: "@maya", "https://venmo.com/u/maya" → "maya". "" when empty, null when it can't be one. */
export function cleanHandle(k, v) {
  let s = squash(v); if (!s) return "";
  const m = s.match(FROM_URL[k]); if (m) s = m[1]; else if (URLISH.test(s)) return null;
  s = s.replace(LEAD[k], "");
  return ID[k].test(s) ? s : null;
}
export const cleanVenmo = (v) => cleanHandle("venmo", v), cleanPaypal = (v) => cleanHandle("paypal", v), cleanCashtag = (v) => cleanHandle("cashapp", v);

/** The other pay link: https only, a known payment host, no login in it. "" when empty, null when it isn't allowed. */
export function cleanPayLink(v) {
  let s = String(v ?? "").trim(); if (!s) return "";
  if (/\s/.test(s) || s.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!PAY_HOSTS.includes(u.hostname.toLowerCase())) return null;
  return u.href;
}
/** The short note ("Zelle: maya@example.com"): plain text, one line. */
export const cleanPayNote = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

const WHY = { venmo: "That Venmo name doesn't look right. Use 2 to 30 letters, numbers, dashes or underscores, like @maya-lee.", paypal: "That PayPal.Me name doesn't look right. Use up to 20 letters or numbers, like paypal.me/mayalee.",
  cashapp: "That $cashtag doesn't look right. Use up to 20 letters or numbers, like $mayalee.", link: "Pay links have to start with https:// and be from Stripe, PayPal, Venmo, Cash App or Square." };

/** Checks what Settings sent. Fields left out keep their saved value. Returns { pay } or { error, field }. */
export function cleanPay(b = {}, cur = {}) {
  const pay = {};
  for (const k of ["venmo", "paypal", "cashapp"]) { if (b[k] == null) { pay[k] = cur[k] || ""; continue; } const h = cleanHandle(k, b[k]); if (h === null) return { error: WHY[k], field: k }; pay[k] = h; }
  if (b.link == null) pay.link = cur.link || ""; else { const l = cleanPayLink(b.link); if (l === null) return { error: WHY.link, field: "link" }; pay.link = l; }
  pay.note = b.note == null ? cur.note || "" : cleanPayNote(b.note);
  pay.updatedAt = Date.now();
  return { pay };
}

const amtOf = (cents) => (cents > 0 ? (cents / 100).toFixed(cents % 100 ? 2 : 0) : "");
/** The profile page, for "Test it". */
export function profileUrl(k, h) {
  if (!h) return ""; const e = encodeURIComponent(h);
  return k === "venmo" ? `https://venmo.com/u/${e}` : k === "paypal" ? `https://paypal.me/${e}` : k === "cashapp" ? `https://cash.app/$${e}` : k === "link" ? h : "";
}
/** The button's link with the amount and a note filled in where the app takes them (Venmo both, PayPal.Me and Cash App the amount). */
export function deepLink(k, h, cents = 0, note = "") {
  if (!h) return ""; const e = encodeURIComponent(h), a = amtOf(Math.round(+cents || 0));
  if (k === "venmo") return `https://venmo.com/${e}?txn=pay${a ? "&amount=" + a : ""}${note ? "&note=" + encodeURIComponent(note) : ""}`;
  if (k === "paypal") return `https://paypal.me/${e}${a ? "/" + a : ""}`;
  if (k === "cashapp") return `https://cash.app/$${e}${a ? "/" + a : ""}`;
  return k === "link" ? h : "";
}

/** Someone's pay methods: what they saved in Settings, else the tip handles already on their page. */
export function payFor(rec, host) {
  const p = rec?.pay; if (p && p.updatedAt) return { venmo: p.venmo || "", paypal: p.paypal || "", cashapp: p.cashapp || "", link: p.link || "", note: p.note || "", saved: true };
  const h = (k) => (host?.[k] ? cleanHandle(k, host[k]) || "" : "");
  return { venmo: h("venmo"), paypal: h("paypal"), cashapp: h("cashapp"), link: "", note: "", saved: false };
}
/** The pay methods of whoever owns a workspace (an event's host). */
export function payOfWs(ws) { const W = getWorkspace(ws); return payFor(W?.ownerEmail ? getDbUser(W.ownerEmail) : null, W?.host); }
export const hasPay = (p) => !!(p && (p.venmo || p.paypal || p.cashapp || p.link || p.note));
/** The ones this event shows: every method the person has, less the ones the host turned off for it (ev.payHide). */
export function eventMethods(pay, ev) {
  const off = Array.isArray(ev?.payHide) ? ev.payHide : [];
  return PAY_KEYS.filter((k) => pay?.[k] && !off.includes(k));
}
const priced = (v) => /\d/.test(String(v ?? "")) && !/^(free|\$?0+(\.0+)?)$/i.test(String(v).trim());
/** Does this event ask guests for money? A price, a group or class pass price, chip in, a pre-order or a drop. Pay in person only: no. */
export function asksMoney(ev) {
  if (!ev || ev.cancelled) return false;
  if (ev.ticketNote && !String(ev.ticketUrl || "").trim()) return false;
  return (ev.price !== "chip" && priced(ev.price)) || priced(ev.groupPrice) || priced(ev.passPrice) || !!ev.chipIn || ev.price === "chip" || !!ev.preorder || !!ev.drop;
}
/** A method the event's own pay link already is (the invite's Pay button), so it isn't shown twice. */
export function sameAsLink(pay, url) {
  const u = String(url || "").trim(); if (!u) return "";
  for (const k of ["venmo", "paypal", "cashapp"]) { const m = u.match(FROM_URL[k]); if (m && pay[k] && m[1].replace(LEAD[k], "").toLowerCase() === pay[k].toLowerCase()) return k; }
  return pay.link && pay.link === u ? "link" : "";
}
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const orderCents = (r) => { const t = Math.round((+r?.orderTotal || 0) * 100); if (t > 0) return t; return (Array.isArray(r?.orderLines) ? r.orderLines : []).reduce((a, l) => a + Math.round((+l.price || 0) * 100) * (Math.max(0, Math.floor(+l.qty) || 0)), 0); };

/** What a guest who is in sees: the buttons, each with this reply's amount and the event's name as the note. */
export function guestPay(ws, ev, r) {
  const pay = payOfWs(ws), skip = sameAsLink(pay, ev.ticketUrl), keys = eventMethods(pay, ev).filter((k) => k !== skip);
  const cents = ev.preorder ? orderCents(r) : dueCents(ev, r), title = String(ev.pubTitle || ev.name || "").trim(), note = [first(r?.name), title].filter(Boolean).join(" · ");
  const W = getWorkspace(ws), host = first(ev.hostName) || first(getDbUser(W?.ownerEmail || "")?.name) || "your host";
  const ds = ev.drop ? payStateOf(ev, r) : null; // a drop: a claim or a mark counts only for the order as it stands
  return { ok: true, host, cents, note, text: keys.includes("note") ? pay.note : "", paid: ds ? ds.state === "paid" : !!r?.paid, claimed: ds ? ds.state === "claimed" : !!r?.paidClaim, hasLink: !!String(ev.ticketUrl || "").trim(),
    ...(ds ? { state: ds.state, pickupOk: ds.pickupOk, choice: ds.choice, amount: ds.amount, changed: !!ds.changed } : {}),
    methods: keys.filter((k) => k !== "note").map((k) => ({ k, label: PAY_LABEL[k], handle: k === "link" ? "" : pay[k], href: deepLink(k, pay[k], cents, note), url: profileUrl(k, pay[k]) })) };
}

export function mountPayMethods(app, { store, small, currentUser, X }) {
  const bad = (res, message, status = 400, code = "invalid", extra = {}) => res.status(status).json({ code, message, ...extra });
  const me = (req, res) => { const u = currentUser(req); if (!u?.email || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } return u; };
  const today = () => new Date().toISOString().slice(0, 10);
  // the host's Home: an upcoming event that asks for money with no way to pay set anywhere
  const needOf = (ws, pay) => { if (hasPay(pay)) return null; try {
    const L = scopeStore(store, ws).list("events").map((d) => ({ id: d.id, e: d.data })).filter(({ e }) => e && !e.example && !e.sample && !e.cancelled && asksMoney(e) && !String(e.ticketUrl || "").trim() && (e.drop || e.always || !e.date || e.date >= today()));
    const x = L.sort((a, b) => (b.e.updatedAt || 0) - (a.e.updatedAt || 0))[0]; return x ? { eventId: x.id, title: x.e.pubTitle || x.e.name || "Your event", drop: !!x.e.drop } : null; } catch { return null; } };

  app.get("/api/me/pay", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store");
    const W = getWorkspace(u.ws), pay = payFor(getDbUser(u.email), W?.host); res.json({ pay, has: hasPay(pay), need: needOf(u.ws, pay) }); });
  app.post("/api/me/pay", small, (req, res) => { const u = me(req, res); if (!u) return; const rec = getDbUser(u.email); if (!rec) return bad(res, "No account.", 404, "not_found");
    const W = getWorkspace(u.ws), cur = payFor(rec, W?.host), out = cleanPay(req.body || {}, cur); if (out.error) return bad(res, out.error, 400, "invalid", { field: out.field });
    putDbUser({ ...rec, pay: out.pay }); const pay = payFor({ pay: out.pay }); res.json({ ok: true, pay, has: hasPay(pay) }); });

  // a guest who is in: the host's chosen methods with this reply's amount. Anyone else gets { ok: false } and nothing more.
  app.get("/api/public/pay/:eventId", (req, res) => { res.set("Cache-Control", "private, no-store");
    const P = X.rsvpProof(String(req.params.eventId || "").slice(0, 80), String(req.query.rid || "").slice(0, 80), String(req.query.code || "").slice(0, 40));
    if (!P || P.r.response !== "going" || !P.ev || !asksMoney(P.ev)) return res.json({ ok: false });
    res.json(guestPay(P.ws, P.ev, P.r)); });
  // "I paid", from those buttons: a claim on their own reply. The host still confirms.
  app.post("/api/public/pay/:eventId/claim", small, (req, res) => { const b = req.body || {}, P = X.rsvpProof(String(req.params.eventId || "").slice(0, 80), String(b.rid || "").slice(0, 80), String(b.code || "").slice(0, 40));
    if (!P || P.r.response !== "going") return bad(res, "Reply first.", 403, "not_granted");
    // a drop's claim is for the whole order as it stands (server/droppay.js): a bigger order later is Not paid yet again
    const dropCents = P.ev?.drop ? orderCents(P.r) : 0, again = P.r.paidClaim && dropCents && +P.r.paidClaimCents > 0 && +P.r.paidClaimCents < dropCents;
    if (!P.r.paidClaim || again) P.S.update("rsvps/" + P.rid.replace(/[^A-Za-z0-9_-]/g, ""), { paidClaim: true, paidClaimAt: Date.now(), changedAt: Date.now(), ...(P.ev?.drop ? { paidClaimCents: dropCents, payChoice: "" } : {}) });
    res.json({ ok: true }); });
}
