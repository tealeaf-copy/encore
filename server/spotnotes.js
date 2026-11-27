// Spot notes: new and notable places the Pottery Lab team spotted by hand, a sibling of server/trendnotes.js.
// The feed shows them as inspiration cards (server/inspiration.js), labelled "Spotted by the Pottery Lab team",
// with the source the team read it in. We never invent places, so nothing ships in a seed: every note is added at
// runtime by an admin (POST /api/admin/spot-notes, gated by ENCORE_ADMIN_EMAILS like every admin route).
//
// A note (type "spot"): name, hood (neighbourhood, optional), city (one geo knows, server/geo.js), category (CATS),
// line (one sentence), source (an https link where the team saw it), added (YYYY-MM-DD), expires (YYYY-MM-DD, about
// SPOT_DAYS after added, at most MAX_DAYS). An expired or retired note drops out by itself. No personal data.
// Stored in one system doc, system/spotnotes.
import crypto from "node:crypto";
import { cityCentre } from "./geo.js";

export const SPOT_DAYS = 60, MAX_DAYS = 90;
const DAY = 864e5;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// category -> what to plan there: canvas kind (public/canvas.js PLAN_KINDS), the cover drawing (public/eventart.js),
// the noun in "New matcha spot", the plan ("Plan a matcha morning") and the title it starts with
export const CATS = {
  dinner: { noun: "dinner spot", kind: "table", cover: "dinner", plan: "Plan a dinner there", title: (n) => `Dinner at ${n}`, interests: ["supper", "wine"] },
  coffee: { noun: "coffee shop", kind: "brunch", cover: "coffee", plan: "Plan a coffee morning", title: (n) => `Coffee morning at ${n}`, interests: ["coffee"] },
  matcha: { noun: "matcha spot", kind: "brunch", cover: "tea", plan: "Plan a matcha morning", title: (n) => `Matcha morning at ${n}`, interests: ["matcha", "coffee"] },
  bakery: { noun: "bakery", kind: "brunch", cover: "bake", plan: "Plan a pastry morning", title: (n) => `Pastry morning at ${n}`, interests: ["baking", "coffee"] },
  "wine bar": { noun: "wine bar", kind: "drinks", cover: "wine", plan: "Plan a wine night", title: (n) => `Wine night at ${n}`, interests: ["wine"] },
};
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const at = (d) => Date.parse(d + "T00:00:00Z");

/** Is a note live on this day: added already, not expired, not retired? */
export const liveSpot = (n, now = Date.now()) => !!n && !n.retired && ISO.test(n.added || "") && ISO.test(n.expires || "") && at(n.added) <= now + DAY && at(n.expires) + DAY > now;

/** Check and tidy a note an admin sends. Returns { note } or { error }. */
export function cleanSpot(b = {}, now = Date.now()) {
  const name = clean(b.name, 60), hood = clean(b.hood || b.neighbourhood || b.neighborhood, 60), line = clean(b.line, 160), category = lc(b.category);
  if (name.length < 2) return { error: "Give the place its name." };
  const c = cityCentre(clean(b.city, 60)); if (!c) return { error: "Pick a city Pottery Lab knows, like New York." };
  if (!CATS[category]) return { error: `Pick a category: ${Object.keys(CATS).join(", ")}.` };
  if (line.length < 10) return { error: "Add a one-line description." };
  if (/\d+\s*(%|percent|k\b|million|thousand|views|likes|followers|reviews|stars)/i.test(line)) return { error: "Keep it plain: no counts or ratings. Spot notes are editorial." };
  let source = ""; try { const u = new URL(String(b.source || "")); if (u.protocol === "https:") source = u.href.slice(0, 300); } catch {}
  if (!source) return { error: "Add the https link where you saw it." };
  const added = ISO.test(b.added || "") && at(b.added) <= now + DAY ? b.added : iso(now);
  let expires = ISO.test(b.expires || "") ? b.expires : iso(at(added) + SPOT_DAYS * DAY);
  if (at(expires) > at(added) + MAX_DAYS * DAY) expires = iso(at(added) + MAX_DAYS * DAY);
  if (at(expires) <= at(added)) return { error: "The end date comes after the day it was added." };
  const id = "s-" + crypto.createHash("sha256").update(lc(name) + "|" + c.name + "|" + added).digest("hex").slice(0, 10);
  return { note: { id, type: "spot", name, hood, city: c.name, category, line, source, added, expires } };
}

const PATH = "system/spotnotes";
export function makeSpotNotes(store) {
  const doc = () => store.get(PATH)?.data || { kind: "spotnotes", added: [], retired: [] };
  const all = () => { const d = doc(), gone = new Set(d.retired || []); return (d.added || []).map((n) => ({ ...n, retired: gone.has(n.id) })); };
  /** The notes the feed may use now, optionally in one city. */
  const active = (now = Date.now(), city = "") => { const c = city ? cityCentre(city)?.name || city : ""; return all().filter((n) => liveSpot(n, now) && (!c || lc(n.city) === lc(c))); };
  function add(b, now = Date.now()) { const r = cleanSpot(b, now); if (r.error) return r; const d = doc();
    if ((d.added || []).some((n) => n.id === r.note.id)) return { error: "That note is already there." };
    store.set(PATH, { ...d, kind: "spotnotes", added: [...(d.added || []), r.note].slice(-300) }); return { note: r.note }; }
  function retire(id, on = true) { const d = doc(); if (!(d.added || []).some((n) => n.id === id)) return { error: "No such note." };
    const R = new Set(d.retired || []); if (on) R.add(id); else R.delete(id); store.set(PATH, { ...d, kind: "spotnotes", retired: [...R] }); return { ok: true }; }
  return { all, active, add, retire };
}
