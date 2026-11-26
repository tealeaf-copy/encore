// Experiments: small, honest A/B tests on the moments that make hosting feel rewarding.
//
// - Variants live in server/experiments.json: { key: { about, goal, variants: { name: weight } } }.
// - Assignment is deterministic: sha256(key + ":" + unit) picks a variant by weight, so the same host (or the same
//   anonymous visitor id) always sees the same thing, on every device and every server, with nothing stored.
// - track(name, props) is the one function every event goes through. Today it writes a row to the store
//   (system/xp/events); a PostHog sink (or any other) plugs in with addSink(fn) and gets the same clean rows.
// - Rows never carry personal info: only the experiment key, the variant, the kind (exposure or conversion), the goal
//   and a salted hash of the unit. Emails, names, phones, free text and unknown keys are dropped before anything is kept.
// - /admin/experiments (admins only, the same isAdmin check as /api/admin/funnel; 404 for everyone else) shows
//   exposures, conversions and the rate per variant.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdmin } from "./metrics.js";
import { DEFAULT_WS } from "./workspaces.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, "experiments.json");
const COL = "system/xp/events";
const WORD = /^[a-z0-9_-]{1,40}$/i;
const UNIT = /^[A-Za-z0-9_-]{6,80}$/;
let S = null, defs = null, defsAt = 0;
const sinks = [];
export const useExperimentStore = (store) => { S = store; };
/** Send every clean row somewhere else too (PostHog later: addSink((row) => posthog.capture(...))). */
export const addSink = (fn) => { if (typeof fn === "function") sinks.push(fn); };
export const clearSinks = () => { sinks.length = 0; };

/** The experiments, read again when the JSON file changes. */
export function experiments() {
  try { const m = fs.statSync(FILE).mtimeMs; if (!defs || m !== defsAt) { defs = JSON.parse(fs.readFileSync(FILE, "utf8")); defsAt = m; } } catch { defs = defs || {}; }
  return defs;
}
const salt = () => process.env.SESSION_SECRET || "pottery-lab-xp";
/** A unit's stable, salted hash: what rows carry instead of an id. */
export const unitHash = (unit) => crypto.createHmac("sha256", salt()).update(String(unit)).digest("hex").slice(0, 16);

/** Deterministic: the same key and unit always get the same variant. Pure. */
export function assign(key, unit, D = experiments()) {
  const E = D[key]; if (!E || !E.variants) return null;
  const V = Object.entries(E.variants).filter(([, w]) => +w > 0); if (!V.length) return null;
  const total = V.reduce((a, [, w]) => a + +w, 0);
  const h = parseInt(crypto.createHash("sha256").update(`${key}:${unit}`).digest("hex").slice(0, 8), 16) / 0x100000000;
  let at = h * total; for (const [name, w] of V) { if (at < +w) return name; at -= +w; }
  return V[V.length - 1][0];
}

/** Keep only what's allowed, as short plain words. Anything that looks like a person is dropped. */
export function cleanProps(props = {}) {
  const out = {};
  for (const k of ["exp", "variant", "kind", "goal", "step"]) { const v = props[k]; if (v != null && WORD.test(String(v)) && !/@/.test(String(v))) out[k] = String(v); }
  if (props.unit != null) out.u = unitHash(props.unit);
  return out;
}

/** The one tracking function. Returns the row it kept (or null). Never throws. */
export function track(name, props = {}, at = Date.now()) {
  if (!WORD.test(String(name || ""))) return null;
  const row = { name: String(name), ...cleanProps(props), at: +at || Date.now() };
  try { S?.add(COL, row); } catch {}
  for (const f of sinks) { try { f({ ...row }); } catch {} }
  return row;
}

const onceKey = (kind, key, unit) => "system/xp-once-" + crypto.createHash("sha256").update(`${kind}:${key}:${unitHash(unit)}`).digest("hex").slice(0, 24);
/** Assign and log the exposure once per unit. Returns the variant (null for an unknown experiment). */
export function expose(key, unit) {
  const variant = assign(key, unit); if (!variant || !unit) return variant;
  try { const k = onceKey("x", key, unit); if (S && !S.get(k)) { S.set(k, { at: Date.now() }); track("xp", { exp: key, variant, kind: "exposure", unit }); } } catch {}
  return variant;
}
/** A conversion on the experiment's goal, once per unit (only for units that were exposed). */
export function convert(key, unit, goal) {
  const E = experiments()[key], variant = assign(key, unit); if (!E || !variant || !unit) return false;
  try { if (!S || !S.get(onceKey("x", key, unit))) return false; const k = onceKey("c", key, unit); if (S.get(k)) return false; S.set(k, { at: Date.now() }); } catch { return false; }
  track("xp", { exp: key, variant, kind: "conversion", goal: goal || E.goal || "goal", unit }); return true;
}

/** Exposures, conversions and the rate per variant. */
export function report() {
  const D = experiments(), rows = S ? S.list(COL).map((d) => d.data).filter((r) => r.name === "xp") : [], out = [];
  for (const [key, E] of Object.entries(D)) {
    const variants = Object.keys(E.variants || {}).map((v) => { const x = rows.filter((r) => r.exp === key && r.variant === v), n = x.filter((r) => r.kind === "exposure").length, c = x.filter((r) => r.kind === "conversion").length;
      return { variant: v, weight: +E.variants[v], exposures: n, conversions: c, rate: n ? Math.round((1000 * c) / n) / 10 : 0 }; });
    out.push({ key, about: E.about || "", goal: E.goal || "", variants });
  }
  return out;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
export function adminPage(R) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Experiments · Pottery Lab</title>
<link rel="stylesheet" href="/system.css"><style>body{margin:0;background:var(--pl-page);color:var(--pl-ink);font:16px/1.5 var(--pl-font-text)}main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
h1{font:400 32px/1.1 var(--pl-font-display);margin:0 0 6px}p{color:var(--pl-soft);margin:0 0 20px}section{border-top:1px dashed var(--pl-line-strong);padding:16px 0}
h2{font:600 16px var(--pl-font-mono);margin:0 0 4px}table{width:100%;border-collapse:collapse;font:14px var(--pl-font-mono)}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--pl-line)}th{color:var(--pl-soft);font-weight:500}</style></head>
<body><main><h1>Experiments</h1><p>Deterministic by host or visitor. Rows carry a hashed unit, never a name or email. Variants live in server/experiments.json.</p>
${R.map((e) => `<section><h2>${esc(e.key)}</h2><p>${esc(e.about)} Goal: ${esc(e.goal)}.</p><table><thead><tr><th>Variant</th><th>Weight</th><th>Exposed</th><th>Converted</th><th>Rate</th></tr></thead><tbody>${e.variants.map((v) => `<tr><td>${esc(v.variant)}</td><td>${v.weight}</td><td>${v.exposures}</td><td>${v.conversions}</td><td>${v.rate}%</td></tr>`).join("")}</tbody></table></section>`).join("")}
</main></body></html>`;
}

export function mountExperiments(app, { store, currentUser }) {
  useExperimentStore(store);
  const admin = (req) => { try { const u = currentUser(req); return !!u && isAdmin(u.email); } catch { return false; } };
  // the unit: a signed-in host's workspace, else the visitor's own random id from this browser
  const unitOf = (req) => { try { const u = currentUser(req); if (u && u.ws && u.ws !== DEFAULT_WS) return u.ws; } catch {} const a = String(req.query.u || req.body?.u || ""); return UNIT.test(a) ? "anon-" + a : ""; };
  app.get("/api/public/xp/:key", (req, res) => { const key = String(req.params.key || ""); if (!experiments()[key]) return res.status(404).json({ code: "not_found", message: "No such experiment." });
    const unit = unitOf(req); res.set("Cache-Control", "private, no-store").json({ key, variant: unit ? expose(key, unit) : assign(key, "none") }); });
  app.post("/api/public/xp/:key/convert", (req, res) => { const key = String(req.params.key || ""), unit = unitOf(req); res.json({ ok: !!(unit && convert(key, unit)) }); });
  app.get("/api/admin/experiments", (req, res) => { if (!admin(req)) return res.status(404).json({ code: "not_found", message: "Not found." }); res.set("Cache-Control", "private, no-store").json({ experiments: report() }); });
  app.get("/admin/experiments", (req, res) => { if (!admin(req)) return res.status(404).type("text").send("Not found"); res.set("Cache-Control", "private, no-store").type("html").send(adminPage(report())); });
  return { assign, expose, convert, track, report };
}
