// Review round 8: pre-orders through a reply. The guest sends which of the host's items they want and how many
// (orderQty: [{ i, qty }], i is the item's place in the event's orderItems); the server writes the order line and the
// total from the event itself, so a reply can't name its own prices. Free text only when the host listed no items.

export const MAX_QTY = 50;

const ampm = (h, m, ap) => `${h % 12 || 12}${m && m !== "00" ? ":" + m : ""}${ap}`;
/** "10:00–11:00" or "10-11" reads "10am to 11am" (the brand's time format). Unknown text is kept, with "to" for the dash. */
export function slotLabel(slot) {
  const t = String(slot || "").trim(); if (!t) return "";
  const parts = t.split(/\s*(?:–|\u2014|-|\bto\b)\s*/i).filter(Boolean);
  if (!parts.length || parts.length > 2) return t;
  const P = parts.map((p) => p.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i));
  if (P.some((m) => !m || +m[1] > 23 || (m[2] && +m[2] > 59))) return t.replace(/\s*[–\u2014-]\s*/g, " to ");
  // a stated am/pm on either end carries to the other ("10-11am"); else 24-hour, or 7 to 11 is morning and 12 to 6 afternoon
  const said = P.map((m) => (m[3] ? (/^p/i.test(m[3]) ? "pm" : "am") : ""));
  const out = P.map((m, i) => { let h = +m[1]; const mm = m[2] || "";
    let ap = said[i] || said[1 - i] || ""; if (said[i]) return ampm(h, mm, ap);
    if (ap && i === 0 && h % 12 > +P[1][1] % 12) ap = ap === "pm" ? "am" : "pm"; // "11-1pm" starts in the morning
    if (h > 12 || h === 0) return ampm(h, mm, h >= 12 ? "pm" : "am");
    if (!ap) ap = h === 12 || h < 7 ? "pm" : "am";
    return ampm(h, mm, ap); });
  return out.join(" to ");
}

const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
/** The event's items as { name, cents } (what the host typed, priced or not). */
export const itemsOf = (ev) => (Array.isArray(ev?.orderItems) ? ev.orderItems : []).slice(0, 12)
  .map((x) => ({ name: String(x?.name || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 60), cents: Math.max(0, Math.round((+x?.price || 0) * 100)) || 0 }));

/**
 * Build a reply's order from the event. Returns { error } for a bad request, {} when there's nothing to store, or
 * { order, orderLines, orderTotal } (orderTotal in dollars, orderLines [{ name, qty, price }]).
 */
export function buildOrder(ev, raw = {}) {
  if (!ev?.preorder) return {};
  const items = itemsOf(ev).filter((x) => x.name), slot = String(raw.slot || "").trim();
  const tail = (cents) => (slot ? ` · pickup ${slotLabel(slot)}` : "") + (cents ? ` · ${money(cents)}` : "");
  if (!items.length) { const free = String(raw.order || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200); return free ? { order: (free + tail(0)).slice(0, 300) } : {}; }
  const q = raw.orderQty; if (q == null) return {};
  const L = Array.isArray(q) ? q : q && typeof q === "object" ? Object.entries(q).map(([i, qty]) => ({ i, qty })) : null;
  if (!L || L.length > items.length) return { error: "That order doesn't match the menu." };
  const qty = new Array(items.length).fill(0);
  for (const x of L) { const i = Number(x?.i), n = Number(x?.qty);
    if (!Number.isInteger(i) || i < 0 || i >= items.length) return { error: "That order doesn't match the menu." };
    if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) return { error: `Pick 0 to ${MAX_QTY} of each.` };
    qty[i] += n; if (qty[i] > MAX_QTY) return { error: `Pick 0 to ${MAX_QTY} of each.` }; }
  const lines = items.map((x, i) => ({ name: x.name, qty: qty[i], price: x.cents / 100, _c: x.cents })).filter((x) => x.qty > 0);
  if (!lines.length) return { error: "Pick something first." };
  const cents = lines.reduce((a, x) => a + x.qty * x._c, 0);
  return { order: (lines.map((x) => `${x.qty} × ${x.name}`).join(", ") + tail(cents)).slice(0, 300), orderLines: lines.map(({ _c, ...x }) => x), orderTotal: cents / 100, ...(slot ? { pickupLabel: slotLabel(slot) } : {}) };
}
export const orderMoney = (dollars) => money(Math.round((+dollars || 0) * 100));
