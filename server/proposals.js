// Brand proposals: when a brand asks for a host (or a host wants to pitch one), the host builds a proposal in minutes
// from a template, mostly filled in from what Pottery Lab already knows, and sends it as a link and a PDF signed
// "Powered by Pottery Lab". Built on the team bookings (server/brandbook.js, X.bb); none of their rules change.
//
//   /proposals ................. the host's proposals; /proposals/new?request=<id>; /proposals/<id>/edit (public/proposals.html)
//   /proposals/example/<tpl> ... an example proposal from an example host, labelled "Example" everywhere
//   /p-brand/<token> ........... the brand's read-only page (noindex), /p-brand/<token>/pdf?pages=one|full, /og.png
//
// Docs: system/prop-<id> holds one proposal (the host's words and choices, never platform numbers); system/proptok-<token>
// points a link at it. The platform numbers (proof) are worked out when the proposal is drawn, from real activity, so a
// host can choose which to show but can't type one in. Views and the brand's answer are kept as counts only.
//
// Honesty and privacy, kept here and tested (test/proposals.test.js):
//   - proof numbers come from X.trustOf / X.teamStatsOf only; a count under 3 stays off (a new host gets the "First brand
//     partnership" framing and what they've done offline, labelled "Host-provided")
//   - kudos quotes: only from events listed on the host's page, first names only, and only when the guest's "Show my name"
//     setting is Everyone (otherwise "A guest"); emails and numbers in the words are hidden; never a guest's email
//   - example proposals are built from the example hosts and say "Example" on the page, the PDF and the card
//   - totals are labelled estimates; the pricing guide is labelled a guide and is never applied for the host
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getWorkspace, getDbUser, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { FEE_BPS, UNITS, unitsFor, money, cancellationTerms, POLICIES, payProvider, isBooked } from "./brandbook.js";
import { exampleByHandle, exampleByWs, isExampleWs, examplesHidden } from "./brandexamples.js";
import { scrubContact } from "./chat.js";
import { complete, isFake, aiMode, parseJsonLoose } from "./ai.js";
import { kitJson, BK } from "./brandkit.js";
import { WEAK_MIN, shareLine } from "./recognition.js";
import { TEMPLATES, TEMPLATE_IDS, templateOf, guessTemplate, withBrand, TIPS } from "./proposaltemplates.js";
import { docHtml, pageHtml, pdfOf, ogSpec } from "./proposaldoc.js";
import { renderCardAsync } from "./sharecards.js";

const noDash = (s) => String(s ?? "").replace(/\s*[\u2014\u2013]\s*/g, ", ");
const clean = (v, n = 200) => noDash(v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const cleanText = (v, n = 1500) => noDash(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v || 0)));
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const BLOB = /^\/_blob\/[A-Za-z0-9]{20}$/;
const DAY = 864e5;
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const list = (a, n, len = 200) => (Array.isArray(a) ? a : []).map((x) => clean(x, len)).filter(Boolean).slice(0, n);
export const SECTIONS = ["cover", "about", "proof", "idea", "plan", "pricing", "timeline", "terms", "next"];
export const NEXT = { accept: "Accept and pay the deposit", question: "Ask a question", call: "Book a call" };
const UNIT_KEYS = Object.keys(UNITS);

// ---------------------------------------------------------------------------------------------------------------
// Pricing: a package priced the way team bookings are (a person, a table, an hour, a staffer a day, the package), the
// add-ons that are on, the booking fee when there is one (in dollars, never a percentage), the deposit and the rest.
/** priceTier(tier, headcount) -> { lines, subtotalCents, feeCents, totalCents, depositCents, balanceCents, schedule, optional, ... } */
export function priceTier(t = {}, headcount = 0, { depositPct = 25, feeBps = FEE_BPS() } = {}) {
  const n = int(headcount, 0, 5000), unit = UNIT_KEYS.includes(t.unit) ? t.unit : "person", c = int(t.cents, 0, 1e8), dep = int(depositPct || 25, 10, 100);
  const pkg = { unit, perUnitGuests: int(t.perUnitGuests || (unit === "table" ? 8 : unit === "staff-day" ? 50 : 1), 1, 1000), minUnits: int(t.minUnits || 1, 1, 1000) };
  const units = unit === "person" ? n : unitsFor(pkg, n), lines = [];
  lines.push(unit === "package" ? { k: "base", label: `${t.line || t.name || "Package"}, for up to ${n} guests`, cents: c } : { k: "base", label: `${money(c)} ${UNITS[unit]} × ${units}`, cents: c * units, ...(unit === "table" ? { note: `${pkg.perUnitGuests} guests a table` } : unit === "hour" && pkg.minUnits > 1 ? { note: `${pkg.minUnits} hours minimum` } : {}) });
  const base = lines[0].cents, min = int(t.minimumCents, 0, 1e9);
  if (min > base) lines.push({ k: "minimum", label: `Group minimum is ${money(min)}`, cents: min - base, note: "Small groups pay the minimum" });
  const optional = [];
  for (const a of (t.addOns || []).slice(0, 8)) { const ac = int(a.cents, 0, 1e8), per = a.per === "flat" ? "flat" : "person", cents = per === "flat" ? ac : ac * n, label = `${clean(a.name, 80)}${per === "flat" ? "" : ` (${money(ac)} a person × ${n})`}`;
    if (a.on) lines.push({ k: "addon", label, cents }); else optional.push({ name: clean(a.name, 80), cents: ac, per, text: per === "flat" ? money(ac) : `${money(ac)} a person` }); }
  const subtotal = lines.reduce((s, l) => s + l.cents, 0), fee = Math.round((subtotal * int(feeBps, 0, 3000)) / 10000);
  if (fee) lines.push({ k: "fee", label: "Pottery Lab booking fee", cents: fee, note: "Shown before you pay, never added later" });
  const total = subtotal + fee, deposit = Math.round((total * dep) / 100), balance = total - deposit;
  return { headcount: n, unit, units, perUnitCents: c, subtotalCents: subtotal, feeCents: fee, taxCents: 0, totalCents: total, depositPct: dep, depositCents: deposit, balanceCents: balance,
    perGuestCents: n ? Math.round(total / n) : 0, lines, optional, estimate: true,
    schedule: [{ when: "When you accept", cents: deposit, what: `${dep}% deposit holds the date` }, ...(balance ? [{ when: "7 days before", cents: balance, what: "The rest, paid through Pottery Lab" }] : [])] };
}
/** The price in the shape a team booking keeps (r.price), so an accepted proposal pays its deposit the usual way. */
export function bookingPrice(t, headcount, opts) { const P = priceTier(t, headcount, opts);
  return { headcount: P.headcount, unit: P.unit, units: P.units, perPersonCents: P.unit === "person" ? P.perUnitCents : P.perGuestCents, minimumCents: int(t.minimumCents, 0, 1e9), subtotalCents: P.subtotalCents, feeCents: P.feeCents, taxCents: 0, totalCents: P.totalCents,
    depositPct: P.depositPct, depositCents: P.depositCents, balanceCents: P.balanceCents, effectivePerPersonCents: P.perGuestCents, lines: P.lines.map((l) => ({ k: l.k === "base" ? "people" : l.k, label: l.label, cents: l.cents, ...(l.note ? { note: l.note } : {}) })),
    includes: "", summary: P.headcount ? `${money(P.totalCents)} total for ${P.headcount}` : "", line: P.headcount ? `${money(P.totalCents)} total for ${P.headcount}` : "" }; }

// "$65 a person", "$450", "From $900", "$45 an hour each" -> { cents, per }
export function parseAddOnPrice(s = "") { const m = /\$\s*([\d,]+(?:\.\d\d)?)/.exec(String(s)); if (!m) return null; return { cents: Math.round(parseFloat(m[1].replace(/,/g, "")) * 100), per: /a person|per guest|each guest/i.test(s) ? "person" : "flat" }; }

// ---------------------------------------------------------------------------------------------------------------
// Readiness: what a brand needs before it can say yes.
export function readiness(P = {}, { proof = null } = {}) {
  const S = P.sections || {}, tiers = (S.pricing?.tiers || []).filter((t) => +t.cents > 0);
  const items = [
    { k: "brand", label: "Who it's for", done: !!clean(P.brand?.name), step: "start" },
    { k: "photo", label: "A photo of you or your work", done: !!(S.about?.on !== false && BLOB.test(S.about?.photo || "")), step: "about" },
    { k: "idea", label: "One idea, with a name", done: S.idea?.on !== false && (S.idea?.concepts || []).some((c) => clean(c.name)), step: "idea" },
    { k: "proof", label: proof?.isNew ? "Your first-partnership story" : "Proof from Pottery Lab", done: S.proof?.on !== false && (proof ? (proof.stats.length > 0 && !proof.isNew) || (S.proof?.offline || []).some((o) => clean(o.what)) : true), step: "proof" },
    { k: "price", label: "A price", done: S.pricing?.on !== false && tiers.length > 0, step: "pricing" },
    { k: "cancel", label: "Cancellation terms", done: !!POLICIES[S.terms?.policy], step: "terms" },
    { k: "contact", label: "A way to reach you", done: S.next?.question !== false || /^https:\/\//.test(S.next?.callUrl || ""), step: "send" },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, of: items.length, pct: Math.round((done / items.length) * 100), ready: done === items.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Potto, offline: plain rules that never add a fact. Used with ENCORE_FAKE_AI=1, with no key, and when a call fails.
const FILLER = /\b(really|very|just|actually|basically|truly|quite|simply|definitely)\s+/gi;
export function rewriteLocal(text, how) {
  const t = cleanText(text, 2000); if (!t) return "";
  if (how === "shorter") { const S = t.replace(FILLER, "").match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [t];
    let keep = S.slice(0, Math.max(1, Math.ceil(S.length * 0.6))).join(" "); const words = keep.split(/\s+/);
    if (words.length > 45 || keep.length >= t.length) keep = words.slice(0, Math.min(40, Math.max(6, Math.floor(words.length * 0.7)))).join(" ").replace(/[,;:]$/, "") + (/[.!?]$/.test(keep) && words.length <= 40 ? "" : ".");
    return keep.length < t.length ? keep : t.slice(0, Math.max(20, Math.floor(t.length * 0.7))).replace(/\s+\S*$/, "") + "."; }
  // warmer: contractions, "we" for the room, a kind opener and closer if there isn't one
  let w = t.replace(/\bWe will\b/g, "We'll").replace(/\bwe will\b/g, "we'll").replace(/\bdo not\b/g, "don't").replace(/\bDo not\b/g, "Don't").replace(/\bI am\b/g, "I'm").replace(/\bit is\b/g, "it's").replace(/\bIt is\b/g, "It's").replace(/\bcannot\b/g, "can't").replace(/\battendees\b/gi, "guests");
  if (!/^(thank|hi|hello|we'?d love|i'?d love|so glad)/i.test(w)) w = "I'd love to host this with you. " + w;
  if (!/(soon|together|with you)[.!]?$/i.test(w)) w = w.replace(/[.!]?$/, ".") + " I can't wait to make it together.";
  return w;
}
function aboutLocal({ person, name, city, bio, kinds, range }) {
  const bits = [];
  bits.push(person && name && lc(person) !== lc(name) ? `I'm ${person}, and I run ${name}${city ? ` in ${city}` : ""}.` : name ? `${name} is a host${city ? ` in ${city}` : ""} on Pottery Lab.` : "");
  const b = cleanText(bio, 400).replace(/^I'm [^.]+\.\s*/, ""); if (b) bits.push(b);
  if (kinds.length) bits.push(`I host ${kinds.length > 1 ? kinds.slice(0, -1).join(", ") + " and " + kinds.slice(-1) : kinds[0]}${range ? ` for groups of ${range}` : ""}.`);
  return bits.filter(Boolean).join(" ").slice(0, 700);
}

// ---------------------------------------------------------------------------------------------------------------
export function mountProposals(app, { store, small, currentUser, C, X = {}, PUBLIC_DIR = "", assetsDir = "", publicOrigin = () => "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req) => { const u = currentUser(req); return u && u.ws && u.ws !== DEFAULT_WS ? u : null; };
  const BB = () => X.bb || {};
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const get = (id) => store.get("system/prop-" + String(id || "").replace(/[^a-f0-9]/g, "").slice(0, 24))?.data || null;
  const put = (P) => { P.updatedAt = Date.now(); store.set("system/prop-" + P.id, P); return P; };
  const byToken = (t) => { const k = String(t || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40); if (k.length < 20) return null; const p = store.get("system/proptok-" + k)?.data; const P = p && get(p.id); return P && P.token === k ? P : null; };
  const mine = (ws) => store.listPrefix("system", "prop-").map((d) => d.data).filter((p) => p && p.kind === "proposal" && p.hostWs === ws);
  const hostMe = (req, res) => { const u = me(req); if (!u) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const h = C.profileOf(u.ws); if (!h?.handle) { bad(res, "Set up your host page first.", 409, "no_page"); return null; } return { u, h, ws: u.ws }; };
  const ownerOf = (ws) => getWorkspace(ws)?.ownerEmail || "";
  const personOf = (ws) => (isExampleWs(ws) ? exampleByWs(ws)?.person || "" : first(getDbUser(ownerOf(ws))?.name || ""));
  const origin = (req) => String(publicOrigin(req) || "").replace(/\/$/, "");

  // ---- what Pottery Lab knows: the host, their kit, their numbers ----
  function hostOf(ws) { const h = C.profileOf(ws) || {}, E = exampleByWs(ws);
    let kit = null; try { kit = E ? null : kitJson(h); } catch {} const T = (() => { try { return BK.derive(kit || BK.starter("house")); } catch { return null; } })();
    const accent = E ? h.color || "#29489A" : T?.btn || "#29489A";
    const photo = BLOB.test(h.theme?.avatarUrl || "") ? h.theme.avatarUrl : BLOB.test(h.theme?.coverUrl || "") ? h.theme.coverUrl : (h.gallery || []).find((u) => BLOB.test(u)) || "";
    return { name: h.name || h.handle || "", handle: h.handle || "", person: personOf(ws), city: h.city || "", hood: h.hood || "", bio: h.bio || "", tagline: h.tagline || "", photo, photos: [photo, ...(h.gallery || [])].filter((u, i, A) => BLOB.test(u) && A.indexOf(u) === i).slice(0, 8),
      kit: { accent, accentText: E ? accent : T?.accentText || "#29489A", onAccent: E ? "#FFFFFF" : T?.onBtn || "#FFFFFF", page: E ? "#FAF8F3" : T?.page || "#FAF8F3", ink: T?.ink || "#1B1D1C", logo: kit && BLOB.test(kit.logo || "") ? kit.logo : "", house: !kit || BK.isHouse?.(kit) }, example: !!E, experiences: h.experiences || [] };
  }
  const nameRule = (email) => { try { const r = X.prefs?.(email)?.socialName; return ["everyone", "follow", "hosts"].includes(r) ? r : "everyone"; } catch { return "everyone"; } };
  const HIDE = (s) => String(s || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…").replace(/\(?(?:\+?\d[\s().-]*){7,}\d/g, "…");
  /** The numbers a brand sees, from real activity only; null-free and never below WEAK_MIN for counts. */
  function proofOf(ws) {
    if (isExampleWs(ws)) { const E = exampleByWs(ws) || {}, s = E.stats || {}, stats = [];
      if (s.events) stats.push({ k: "events", n: String(s.events), label: "events hosted" }); if (s.teamEvents) stats.push({ k: "team", n: String(s.teamEvents), label: "team bookings" });
      if (s.reviews >= 1) stats.push({ k: "rating", n: s.rating.toFixed(1), label: `average from ${s.reviews} team reviews` }); if (s.years) stats.push({ k: "years", n: String(s.years), label: "years hosting" });
      return { example: true, verified: false, isNew: false, stats, quotes: (E.kudos || []).map((k, i) => ({ id: "x" + i, text: k.text, name: first(k.name) || "A guest", event: k.event || "", example: true })), recent: [], followers: 0 }; }
    let T = {}, team = {}; try { T = X.trustOf ? X.trustOf(ws) : {}; } catch {} try { team = X.teamStatsOf ? X.teamStatsOf(ws) : {}; } catch {}
    const stats = [], ev = +T.events || 0, guests = +T.guests || 0, ret = +T.returning || 0, kud = +T.kudos || 0, fol = +T.followers || 0, teamN = +team.teamEvents || 0;
    if (ev >= WEAK_MIN) stats.push({ k: "events", n: String(ev), label: "events hosted on Pottery Lab" });
    if (guests >= WEAK_MIN) stats.push({ k: "guests", n: String(guests), label: "guests welcomed" });
    const again = T.again || null; if (again) stats.push({ k: "again", n: again.pct != null ? `${again.pct}%` : `${again.n} of ${again.of}`, label: again.pct != null ? `would go again, of ${again.of} guests who left kudos` : "guests who left kudos would go again" });
    if (ret >= 1 && guests >= WEAK_MIN) stats.push({ k: "repeat", n: String(ret), label: ret === 1 ? "guest came back for another" : "guests came back for another" });
    if (kud >= 1 && (kud >= WEAK_MIN || ev >= WEAK_MIN)) stats.push({ k: "kudos", n: String(kud), label: "kudos from guests" });
    if (fol >= WEAK_MIN) stats.push({ k: "followers", n: String(fol), label: "people follow their page" });
    if (teamN >= 1) stats.push({ k: "team", n: String(teamN), label: teamN === 1 ? "team booking on Pottery Lab" : "team bookings on Pottery Lab" });
    if ((team.reviews || 0) >= WEAK_MIN) stats.push({ k: "rating", n: (+team.rating || 0).toFixed(1), label: `average from ${team.reviews} team reviews` });
    // quotes and recent events: only events on the host's page; names only as the guest allows
    const quotes = [], recent = []; let I = null; try { I = X.index?.(); } catch {}
    if (I) { const listed = (id) => { const e = I.events.get(id); return e && e.ws === ws && e.e.discoverable && !e.e.cancelled ? e.e : null; };
      for (const k of I.kudos.filter((k) => k.ws === ws && String(k.love || "").trim().length >= 12).sort((a, b) => (b.at || 0) - (a.at || 0))) { const e = listed(k.eventId); if (!e) continue;
        const shown = !k.deletedAccount && nameRule(k.email) === "everyone" && first(k.name); quotes.push({ id: String(k.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), text: HIDE(clean(k.love, 280)), name: shown || "A guest", event: e.pubTitle || e.name || "", month: /^\d{4}-\d{2}/.test(e.date || "") ? e.date.slice(0, 7) : "", verified: true }); if (quotes.length >= 12) break; }
      const today = isoDay(); for (const x of [...I.events.values()].filter((x) => x.ws === ws && x.e.discoverable && !x.e.cancelled && x.e.date && x.e.date <= today && x.e.stage !== "interest").sort((a, b) => String(b.e.date).localeCompare(String(a.e.date))).slice(0, 3)) recent.push({ title: x.e.pubTitle || x.e.name || "", month: x.e.date.slice(0, 7) }); }
    const isNew = ev < WEAK_MIN && guests < WEAK_MIN && !teamN;
    return { example: false, verified: true, isNew, stats, quotes, recent, followers: fol };
  }

  // ---- the pricing guide: the host's own prices, then similar hosts' public packages (aggregate), then our starting guide ----
  function guideOf(ws, tplId) { const tpl = templateOf(tplId), unit = tpl.guide.unit, own = [];
    const S = BB().setupOf?.(ws); for (const p of S?.packages || []) if ((p.unit || "person") === unit && p.perPersonCents) own.push(p.perPersonCents);
    for (const r of (BB().reqs?.() || []).filter((r) => r.hostWs === ws && r.price && ["accepted", "booked", "done"].includes(r.status))) if ((r.price.unit || "person") === unit && r.price.perPersonCents) own.push(r.price.perPersonCents);
    const peers = []; const hosts = new Set();
    try { for (const x of BB().allSetups?.({ examples: false }) || []) { if (x.ws === ws) continue; for (const p of x.s.packages || []) if (p.on && (p.unit || "person") === unit && p.perPersonCents && tpl.match.test(`${p.name} ${p.story}`)) { peers.push(p.perPersonCents); hosts.add(x.ws); } } } catch {}
    const q = (A, f) => { const s = [...A].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * f)))]; };
    const label = `${UNITS[unit]}`;
    return { unit, unitLabel: label,
      own: own.length ? { lo: Math.min(...own), hi: Math.max(...own), n: own.length, text: `Your own prices on Pottery Lab: ${money(Math.min(...own))}${own.length > 1 && Math.max(...own) !== Math.min(...own) ? ` to ${money(Math.max(...own))}` : ""} ${label}` } : null,
      peers: hosts.size >= 3 ? { lo: q(peers, 0.25), mid: q(peers, 0.5), hi: q(peers, 0.75), hosts: hosts.size, text: `Similar hosts on Pottery Lab: mostly ${money(q(peers, 0.25))} to ${money(q(peers, 0.75))} ${label} (${hosts.size} hosts' public packages). A guide, not a rule.` } : null,
      start: { lo: tpl.guide.lo, hi: tpl.guide.hi, text: `A starting guide from Pottery Lab for ${tpl.label.toLowerCase().split(":")[0]}: ${money(tpl.guide.lo)} to ${money(tpl.guide.hi)} ${label}. An estimate, not platform data.` } };
  }

  // ---- making and cleaning a proposal ----
  const reqOf = (id) => (id ? BB().reqGet?.(id) : null);
  function fresh(ws, { template, requestId, example } = {}) {
    const H = hostOf(ws), r = reqOf(requestId), own = r && r.hostWs === ws ? r : null, S = BB().setupOf?.(ws) || {}, pkg = own ? (S.packages || []).find((p) => p.id === own.pkgId) : null;
    const tid = TEMPLATE_IDS.includes(template) ? template : guessTemplate([pkg?.name, pkg?.story, own?.pkgName, H.tagline, H.bio, ...(H.experiences || []).map((e) => e.name)].filter(Boolean).join(" "));
    const T = templateOf(tid), brand = own ? clean(own.company, 120) : "", B = (s) => withBrand(s, brand || "{brand}");
    const tiers = T.tiers.map((t) => ({ ...t, addOns: t.addOns.map((a) => ({ ...a })), includes: [...t.includes] }));
    if (pkg && pkg.perPersonCents) { const u = pkg.unit && UNITS[pkg.unit] ? pkg.unit : "person"; tiers[1] = { name: "Better", line: clean(pkg.name, 120), unit: u, cents: pkg.perPersonCents, perUnitGuests: pkg.perUnitGuests || 0, minUnits: pkg.minUnits || 0, minimumCents: pkg.minimumCents || 0, includes: list(pkg.includes, 8, 120),
      addOns: (pkg.addOns || []).map((a) => { const p = parseAddOnPrice(a.price); return p ? { name: clean(a.name, 80), cents: p.cents, per: p.per, on: false } : null; }).filter(Boolean).slice(0, 6) }; }
    const head = own?.headcount || pkg?.minGuests || 12;
    const P = { kind: "proposal", id: rid(8), hostWs: ws, handle: H.handle, template: tid, status: "draft", token: "", requestId: own ? own.id : "", fromExample: example ? clean(example, 40) : "",
      brand: { name: brand, contact: own ? first(own.contactName) : "", occasion: own ? clean(own.occasion, 120) : "", date: own?.date || "", headcount: head, brief: own ? cleanText([own.notes, (own.diets || []).length ? `Diets: ${own.diets.join(", ")}` : "", (own.access || []).length ? `Access: ${own.access.join(", ")}` : ""].filter(Boolean).join("\n"), 1200) : "" },
      sections: {
        cover: { on: true, title: brand ? `A proposal for ${brand}` : "A proposal for your team", sub: own?.occasion ? clean(own.occasion, 120) : T.line },
        about: { on: true, text: aboutLocal({ person: H.person, name: H.name, city: H.city, bio: H.bio || S.story, kinds: [...new Set((H.experiences || []).map((e) => lc(e.name)).filter(Boolean))].slice(0, 3), range: pkg ? `${pkg.minGuests} to ${pkg.maxGuests}` : "" }), photo: H.photo },
        proof: { on: true, hide: [], quotes: [], offline: [], note: "" },
        idea: { on: true, concepts: T.concepts.map((c) => ({ name: c.name, line: B(c.line), experience: B(c.experience), brand: B(c.brand) })), pick: 0 },
        plan: { on: true, ros: T.ros.map((x) => ({ time: x.time, what: B(x.what) })), includes: [...(pkg?.includes?.length ? list(pkg.includes, 8, 120) : T.includes)], guests: head, venues: pkg?.venue === "host" && S.area ? [`My space in ${S.area}`] : ["Your office or a space you choose", "A space I book for you"],
          access: (own?.access || []).length ? `You asked for: ${own.access.join(", ")}. I'll confirm the room works for everyone.` : (pkg?.access || []).length ? `Ready for: ${pkg.access.join(", ")}.` : "Tell me what your guests need and I'll check the room before we confirm.",
          diets: (own?.diets || []).length ? `Cooked for, not worked around: ${own.diets.join(", ")}.` : (pkg?.diets || []).length ? `Ready for: ${pkg.diets.join(", ")}.` : "Every dietary need on the final list is planned for.",
          presence: { signage: B(T.presence.signage), sampling: B(T.presence.sampling), photos: B(T.presence.photos) } },
        pricing: { on: true, tiers, recommend: 1, depositPct: pkg?.depositPct || 25, notIncluded: [...T.notIncluded] },
        timeline: { on: true, steps: T.timeline.map((s) => ({ ...s })) },
        terms: { on: true, policy: POLICIES[S.policy] ? S.policy : "standard", usage: "Photos from the night are yours to use on your own channels, with credit to the host. Guests who asked to be left out are left out.", insurance: "Do you need a certificate of insurance? Tell me and I'll confirm it before you pay.", extra: "" },
        next: { primary: "accept", question: true, callUrl: "" } },
      createdAt: Date.now(), views: { n: 0, first: 0, last: 0 }, answers: { accept: 0, question: 0, decline: 0 } };
    return P;
  }
  function cleanSections(b = {}, cur) { const S = cur.sections, o = (k) => (b[k] && typeof b[k] === "object" ? b[k] : null), on = (x, d) => (typeof x?.on === "boolean" ? x.on : d);
    const out = JSON.parse(JSON.stringify(S));
    let x;
    if ((x = o("cover"))) out.cover = { on: true, title: clean(x.title ?? S.cover.title, 120), sub: clean(x.sub ?? S.cover.sub, 160) };
    if ((x = o("about"))) out.about = { on: on(x, S.about.on), text: cleanText(x.text ?? S.about.text, 900), photo: x.photo === "" ? "" : BLOB.test(x.photo || "") ? x.photo : S.about.photo };
    if ((x = o("proof"))) out.proof = { on: on(x, S.proof.on), hide: list(x.hide ?? S.proof.hide, 12, 20), quotes: list(x.quotes ?? S.proof.quotes, 3, 40), note: cleanText(x.note ?? S.proof.note, 400),
      offline: (Array.isArray(x.offline) ? x.offline : S.proof.offline).slice(0, 6).map((y) => ({ what: clean(y?.what, 140), when: clean(y?.when, 40), people: clean(y?.people, 40) })).filter((y) => y.what) };
    if ((x = o("idea"))) out.idea = { on: on(x, S.idea.on), concepts: (Array.isArray(x.concepts) ? x.concepts : S.idea.concepts).slice(0, 3).map((c) => ({ name: clean(c?.name, 80), line: clean(c?.line, 200), experience: cleanText(c?.experience, 600), brand: cleanText(c?.brand, 400) })).filter((c) => c.name || c.line), pick: int(x.pick ?? S.idea.pick, 0, 2) };
    if ((x = o("plan"))) { const p = x.presence || {}; out.plan = { on: on(x, S.plan.on), ros: (Array.isArray(x.ros) ? x.ros : S.plan.ros).slice(0, 14).map((r) => ({ time: clean(r?.time, 20), what: clean(r?.what, 160) })).filter((r) => r.what), includes: list(x.includes ?? S.plan.includes, 10, 140), guests: int(x.guests ?? S.plan.guests, 1, 5000),
      venues: list(x.venues ?? S.plan.venues, 4, 140), access: cleanText(x.access ?? S.plan.access, 400), diets: cleanText(x.diets ?? S.plan.diets, 400), presence: { signage: clean(p.signage ?? S.plan.presence.signage, 200), sampling: clean(p.sampling ?? S.plan.presence.sampling, 200), photos: clean(p.photos ?? S.plan.presence.photos, 240) } }; }
    if ((x = o("pricing"))) out.pricing = { on: on(x, S.pricing.on), recommend: int(x.recommend ?? S.pricing.recommend, 0, 2), depositPct: int(x.depositPct ?? S.pricing.depositPct, 10, 100), notIncluded: list(x.notIncluded ?? S.pricing.notIncluded, 8, 160),
      tiers: (Array.isArray(x.tiers) ? x.tiers : S.pricing.tiers).slice(0, 3).map((t, i) => ({ name: clean(t?.name, 30) || ["Good", "Better", "Best"][i], line: clean(t?.line, 120), unit: UNIT_KEYS.includes(t?.unit) ? t.unit : "person", cents: int(t?.cents, 0, 1e8), perUnitGuests: int(t?.perUnitGuests, 0, 1000), minUnits: int(t?.minUnits, 0, 1000), minimumCents: int(t?.minimumCents, 0, 1e9),
        includes: list(t?.includes, 8, 120), addOns: (Array.isArray(t?.addOns) ? t.addOns : []).slice(0, 6).map((a) => ({ name: clean(a?.name, 80), cents: int(a?.cents, 0, 1e8), per: a?.per === "flat" ? "flat" : "person", on: !!a?.on })).filter((a) => a.name) })) };
    if ((x = o("timeline"))) out.timeline = { on: on(x, S.timeline.on), steps: (Array.isArray(x.steps) ? x.steps : S.timeline.steps).slice(0, 10).map((s) => ({ when: clean(s?.when, 40), what: clean(s?.what, 160) })).filter((s) => s.what) };
    if ((x = o("terms"))) out.terms = { on: on(x, S.terms.on), policy: POLICIES[x.policy] ? x.policy : S.terms.policy, usage: cleanText(x.usage ?? S.terms.usage, 500), insurance: cleanText(x.insurance ?? S.terms.insurance, 300), extra: cleanText(x.extra ?? S.terms.extra, 500) };
    if ((x = o("next"))) out.next = { primary: NEXT[x.primary] ? x.primary : S.next.primary, question: typeof x.question === "boolean" ? x.question : S.next.question, callUrl: /^https:\/\/[^\s<>"]{4,300}$/.test(x.callUrl || "") ? x.callUrl : x.callUrl === "" ? "" : S.next.callUrl };
    if (out.next.primary === "call" && !out.next.callUrl) out.next.primary = "accept";
    return out; }
  function cleanBrand(b = {}, cur) { return { name: clean(b.name ?? cur.name, 120), contact: first(clean(b.contact ?? cur.contact, 60)), occasion: clean(b.occasion ?? cur.occasion, 120), date: ISO.test(b.date || "") ? b.date : b.date === "" ? "" : cur.date, headcount: int(b.headcount ?? cur.headcount, 1, 5000), brief: cleanText(b.brief ?? cur.brief, 1200) }; }

  // ---- the view a page, a PDF and a card are drawn from ----
  function viewOf(P, { mode = "public", req = null } = {}) {
    const H = hostOf(P.hostWs), proof = proofOf(P.hostWs), S = P.sections, n = S.plan?.guests || P.brand.headcount || 0, B = (s) => withBrand(s, P.brand.name);
    const hide = new Set(S.proof.hide || []), quotes = (S.proof.quotes?.length ? S.proof.quotes.map((id) => proof.quotes.find((q) => q.id === id)).filter(Boolean) : proof.quotes.slice(0, 2)).slice(0, 3);
    const tiers = (S.pricing.tiers || []).filter((t) => t.cents > 0).map((t) => ({ ...t, price: priceTier(t, n, { depositPct: S.pricing.depositPct }) }));
    const terms = cancellationTerms(S.terms.policy, S.pricing.depositPct);
    return { id: P.id, mode, example: H.example || !!P.example, token: P.token, status: P.status, host: H, brand: P.brand, template: templateOf(P.template), origin: req ? origin(req) : "",
      cover: S.cover, about: S.about, idea: { ...S.idea, concepts: S.idea.concepts.map((c) => ({ name: B(c.name), line: B(c.line), experience: B(c.experience), brand: B(c.brand) })) },
      proof: { on: S.proof.on, ...proof, stats: proof.stats.filter((s) => !hide.has(s.k)), quotes, offline: S.proof.offline || [], note: S.proof.note || "" },
      plan: { ...S.plan, guests: n, ros: S.plan.ros.map((r) => ({ ...r, what: B(r.what) })), presence: Object.fromEntries(Object.entries(S.plan.presence || {}).map(([k, v]) => [k, B(v)])) },
      pricing: { ...S.pricing, tiers, recommend: Math.min(S.pricing.recommend || 0, Math.max(0, tiers.length - 1)) }, timeline: S.timeline, terms: { ...S.terms, lines: terms.lines, deposit: terms.deposit, label: terms.label },
      next: { ...S.next, label: NEXT[S.next.primary] }, readiness: readiness(P, { proof }) };
  }

  // ---- pages ----
  // from a request in Team requests: find or make the draft on the server and open it (one proposal a request)
  app.get("/proposals/new", (req, res, next) => { const u = me(req), r = req.query.request ? reqOf(String(req.query.request)) : null; if (!u || !r || r.hostWs !== u.ws || !C.profileOf(u.ws)?.handle) return next();
    let P = mine(u.ws).find((p) => p.requestId === r.id && p.status !== "withdrawn"); if (!P) P = put(fresh(u.ws, { requestId: r.id })); res.redirect(302, `/proposals/${P.id}/edit`); });
  // signed out, the page shows "Sign in" without asking the API first (no failed request on the way)
  app.get(["/proposals", "/proposals/new", "/proposals/:id/edit"], (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, "proposals.html"), "utf8"); } catch { return res.status(404).type("text").send("Not found"); }
    if (!me(req)) html = html.replace('<main class="pb" id="main">', '<main class="pb" id="main" data-out="1">'); res.set("Cache-Control", "private, no-cache").type("html").send(html); });
  const sendDoc = (res, html, { cache = "private, no-store" } = {}) => res.set({ "Cache-Control": cache, "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "same-origin" }).type("html").send(html);

  // the brand's page: read-only, noindex, the link is the key
  app.get("/p-brand/:token", (req, res) => { const P = byToken(req.params.token); if (!P || P.status === "withdrawn") return res.status(404).set("X-Robots-Tag", "noindex").type("html").send(notFound());
    const u = me(req), host = !!u && u.ws === P.hostWs, bot = /bot|crawl|spider|preview|slack|facebookexternalhit|whatsapp|discord|telegram|embedly|headless/i.test(req.get("user-agent") || "");
    if (!host && !bot) { const now = Date.now(); P.views = { n: (P.views?.n || 0) + 1, first: P.views?.first || now, last: now }; put(P); if ((P.views.n === 1) && !P.example) tellHost(P, `${P.brand.name || "The brand"} opened your proposal.`); }
    const V = viewOf(P, { req }); const r = P.requestId ? reqOf(P.requestId) : null;
    sendDoc(res, pageHtml(V, { signedIn: !!u, brandSide: !!u && !!r && r.brandWs === u.ws, isHost: host, answered: P.answer || null, requestId: P.requestId })); });
  app.get("/p-brand/:token/og.png", async (req, res) => { const P = byToken(req.params.token); if (!P) return res.status(404).end(); const png = await renderCardAsync(ogSpec(viewOf(P, { req })), "link"); res.set({ "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" }).type("png").send(png); });
  app.get("/p-brand/:token/pdf", (req, res) => { const P = byToken(req.params.token); if (!P) return res.status(404).type("text").send("Not found"); sendPdf(req, res, P); });
  function sendPdf(req, res, P) { const one = req.query.pages === "one", V = viewOf(P, { req }); let buf; try { buf = pdfOf(V, { one, assetsDir }); } catch (e) { console.warn("[proposals] pdf", e.message); return res.status(500).type("text").send("The PDF didn't draw. Try again in a minute."); }
    const name = `${(V.host.handle || "proposal").replace(/[^a-z0-9-]/g, "")}-for-${lc(P.brand.name || "your-team").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "your-team"}${one ? "-one-page" : ""}.pdf`;
    res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${name}"` }).type("application/pdf").send(buf); }

  // example proposals from the example hosts: read-only, labelled Example everywhere, never sendable
  const exampleProposal = (tid) => { if (examplesHidden()) return null; const T = templateOf(tid); if (T.id !== tid) return null; const E = T.examples.map((h) => exampleByHandle(h)).find(Boolean); if (!E) return null;
    const P = fresh(E.ws, { template: tid }); P.id = "example" + tid; P.example = true; P.status = "example"; P.brand = { name: "Fernlight", contact: "Sam", occasion: "A thank-you night for our first 100 customers", date: "", headcount: T.tiers[0].unit === "hour" ? 60 : 16, brief: "We want our best customers to meet each other. Warm, not salesy." };
    P.sections.cover.title = "A proposal for Fernlight"; P.sections.cover.sub = P.brand.occasion; P.sections.plan.guests = P.brand.headcount;
    for (const c of P.sections.idea.concepts) for (const k of ["line", "experience", "brand"]) c[k] = withBrand(c[k].replace(/your team/g, "{brand}"), "Fernlight");
    P.sections.about.text = aboutLocal({ person: E.person, name: E.h.name, city: E.h.city, bio: E.h.bio, kinds: [], range: "" }); P.sections.about.photo = "";
    for (const k of ["signage", "sampling", "photos"]) P.sections.plan.presence[k] = withBrand(P.sections.plan.presence[k].replace(/your team/g, "{brand}"), "Fernlight");
    P.sections.plan.ros = P.sections.plan.ros.map((r) => ({ ...r, what: r.what.replace(/your team/g, "Fernlight") }));
    return P; };
  app.get("/proposals/example/:tpl", (req, res) => { const P = exampleProposal(req.params.tpl); if (!P) return res.status(404).type("html").send(notFound()); sendDoc(res, pageHtml(viewOf(P, { req }), { example: true }), { cache: "public, max-age=300" }); });
  app.get("/proposals/example/:tpl/pdf", (req, res) => { const P = exampleProposal(req.params.tpl); if (!P) return res.status(404).type("text").send("Not found"); sendPdf(req, res, P); });
  app.get("/proposals/example/:tpl/og.png", async (req, res) => { const P = exampleProposal(req.params.tpl); if (!P) return res.status(404).end(); res.set("Cache-Control", "public, max-age=3600").type("png").send(await renderCardAsync(ogSpec(viewOf(P, { req })), "link")); });

  // ---- the host's API ----
  const summary = (P) => ({ id: P.id, status: P.status, brand: P.brand.name, occasion: P.brand.occasion, template: P.template, templateLabel: templateOf(P.template).label, requestId: P.requestId, url: P.token ? `/p-brand/${P.token}` : "", views: P.views?.n || 0, answers: P.answers || {}, answer: P.answer || null, updatedAt: P.updatedAt, sentAt: P.sentAt || 0, readiness: readiness(P).pct });
  const templatesOut = () => TEMPLATES.map((t) => ({ id: t.id, label: t.label, line: t.line, example: examplesHidden() || !t.examples.some((h) => exampleByHandle(h)) ? "" : `/proposals/example/${t.id}`, exampleHost: examplesHidden() ? "" : exampleByHandle(t.examples.find((h) => exampleByHandle(h)))?.h?.name || "", concepts: t.concepts.map((c) => c.name) }));
  app.get("/api/proposals/templates", (req, res) => res.json({ templates: templatesOut(), tips: TIPS, sections: SECTIONS, next: NEXT, policies: Object.fromEntries(Object.keys(POLICIES).map((k) => [k, cancellationTerms(k, 25).short])), units: UNITS }));
  app.get("/api/proposals", (req, res) => { const H = hostMe(req, res); if (!H) return; const L = mine(H.ws).sort((a, b) => b.updatedAt - a.updatedAt);
    const open = (BB().reqs?.() || []).filter((r) => r.hostWs === H.ws && ["requested", "question", "countered"].includes(r.status)).map((r) => ({ id: r.id, company: r.company, pkgName: r.pkgName, headcount: r.headcount, date: r.date, occasion: r.occasion || "", status: r.status, proposal: L.find((p) => p.requestId === r.id)?.id || "" }));
    res.set("Cache-Control", "private, no-store").json({ proposals: L.map(summary), requests: open, templates: templatesOut(), host: { name: H.h.name, handle: H.h.handle } }); });
  app.post("/api/proposals", small, (req, res) => { const H = hostMe(req, res); if (!H) return; if (limited("pc:" + H.ws, 60)) return bad(res, "That's a lot of proposals at once. Try again later.", 429, "rate_limited");
    const b = req.body || {}; if (b.requestId) { const r = reqOf(b.requestId); if (!r || r.hostWs !== H.ws) return bad(res, "That request isn't yours.", 404, "not_found"); const have = mine(H.ws).find((p) => p.requestId === r.id && p.status !== "withdrawn"); if (have) return res.json({ id: have.id, existing: true }); }
    const P = fresh(H.ws, { template: b.template, requestId: b.requestId, example: b.fromExample ? b.template : "" });
    if (!P.requestId && b.brand) P.brand = cleanBrand(b.brand, P.brand);
    if (P.brand.name) { P.sections.cover.title = `A proposal for ${P.brand.name}`; for (const c of P.sections.idea.concepts) for (const k of ["line", "experience", "brand"]) c[k] = withBrand(c[k], P.brand.name); P.sections.plan.ros = P.sections.plan.ros.map((r) => ({ ...r, what: withBrand(r.what, P.brand.name) })); for (const k of ["signage", "sampling", "photos"]) P.sections.plan.presence[k] = withBrand(P.sections.plan.presence[k], P.brand.name); }
    put(P); res.json({ id: P.id }); });
  const loadMine = (req, res) => { const H = hostMe(req, res); if (!H) return null; const P = get(req.params.id); if (!P || P.hostWs !== H.ws) { bad(res, "Not found.", 404, "not_found"); return null; } return { H, P }; };
  const editorOut = (req, P) => { const V = viewOf(P, { mode: "preview", req }), proof = proofOf(P.hostWs), r = P.requestId ? reqOf(P.requestId) : null;
    return { proposal: P, html: docHtml(V), readiness: V.readiness, proof, guide: guideOf(P.hostWs, P.template), host: { name: V.host.name, handle: V.host.handle, photos: V.host.photos, kit: V.host.kit, person: V.host.person },
      tips: { ...TIPS, proof: proof.isNew ? TIPS.proofNew : TIPS.proof }, request: r ? { id: r.id, company: r.company, pkgName: r.pkgName, headcount: r.headcount, date: r.date, flexText: r.flex ? `${r.flex.month}` : "", status: r.status, occasion: r.occasion || "", notes: r.notes || "", diets: r.diets || [], access: r.access || [] } : null,
      totals: (P.sections.pricing.tiers || []).map((t) => { const x = priceTier(t, V.plan.guests, { depositPct: P.sections.pricing.depositPct }); return { name: t.name, totalCents: x.totalCents, depositCents: x.depositCents, perGuestCents: x.perGuestCents }; }), url: P.token ? `/p-brand/${P.token}` : "" }; };
  app.get("/api/proposals/for-request/:rid", (req, res) => { const u = me(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); const r = reqOf(req.params.rid); if (!r || !(r.brandWs === u.ws || r.hostWs === u.ws)) return bad(res, "Not found.", 404, "not_found");
    const L = store.listPrefix("system", "prop-").map((d) => d.data).filter((p) => p?.kind === "proposal" && p.requestId === r.id && p.token && p.status !== "draft" && p.status !== "withdrawn");
    res.set("Cache-Control", "private, no-store").json({ proposals: L.map((p) => ({ url: `/p-brand/${p.token}`, status: p.status, title: p.sections.cover.title, host: hostOf(p.hostWs).name, sentAt: p.sentAt || 0, answer: p.answer?.action || "" })) }); });
  app.get("/api/proposals/:id", (req, res) => { const L = loadMine(req, res); if (!L) return; res.set("Cache-Control", "private, no-store").json(editorOut(req, L.P)); });
  app.put("/api/proposals/:id", small, (req, res) => { const L = loadMine(req, res); if (!L) return; const b = req.body || {}, P = L.P;
    if (b.template && TEMPLATE_IDS.includes(b.template)) P.template = b.template;
    if (b.brand) P.brand = cleanBrand(b.brand, P.brand); if (b.sections) P.sections = cleanSections(b.sections, P);
    put(P); res.json(editorOut(req, P)); });
  app.delete("/api/proposals/:id", (req, res) => { const L = loadMine(req, res); if (!L) return; if (L.P.token) store.delete("system/proptok-" + L.P.token); store.delete("system/prop-" + L.P.id); res.json({ ok: true }); });
  app.get("/api/proposals/:id/pdf", (req, res) => { const L = loadMine(req, res); if (!L) return; sendPdf(req, res, L.P); });
  app.get("/api/proposals/:id/og.png", async (req, res) => { const L = loadMine(req, res); if (!L) return; res.set("Cache-Control", "private, no-store").type("png").send(await renderCardAsync(ogSpec(viewOf(L.P, { req })), "link")); });

  // send: a link only the brand gets, and (when it answers a request) a reply in that request's thread
  app.post("/api/proposals/:id/send", small, (req, res) => { const L = loadMine(req, res); if (!L) return; const P = L.P, R = readiness(P, { proof: proofOf(P.hostWs) });
    if (!P.brand.name) return bad(res, "Add who it's for first.", 400, "not_ready");
    if (!(P.sections.pricing.tiers || []).some((t) => t.cents > 0) && P.sections.pricing.on !== false) return bad(res, "Add a price to at least one package.", 400, "not_ready");
    if (!P.token) { P.token = crypto.randomBytes(18).toString("base64url"); store.set("system/proptok-" + P.token, { id: P.id }); }
    const isFirst = !P.sentAt; P.status = P.answer ? P.status : "sent"; P.sentAt ||= Date.now(); P.resentAt = Date.now();
    const url = `${origin(req)}/p-brand/${P.token}`; let posted = false;
    const r = P.requestId ? reqOf(P.requestId) : null;
    if (r && r.hostWs === P.hostWs && isFirst) { const note = clean(req.body?.note, 400);
      r.messages = [...(r.messages || []), { id: rid(4), from: "host", name: firstName(P.hostWs), text: `${note ? note + "\n\n" : ""}I put together a proposal for ${P.brand.name}: ${url}`, at: Date.now(), hidden: false, proposal: P.id }].slice(-300);
      if (!r.respondedAt && r.status !== "approval") { r.respondedAt = Date.now(); if (r.status === "question") r.answeredAt = Date.now(); }
      r.proposalId = P.id; BB().push?.(r, "host", "sent a proposal"); BB().reqSet?.(r); BB().tell?.(r.brandEmail, `${hostOf(P.hostWs).name} sent you a proposal for ${r.pkgName}.`, `/p-brand/${P.token}`); posted = true; }
    put(P); res.json({ ok: true, url, path: `/p-brand/${P.token}`, pdf: `/p-brand/${P.token}/pdf`, onePage: `/p-brand/${P.token}/pdf?pages=one`, posted, readiness: R }); });
  const firstName = (ws) => first(personOf(ws) || hostOf(ws).name);
  app.post("/api/proposals/:id/withdraw", small, (req, res) => { const L = loadMine(req, res); if (!L) return; L.P.status = "withdrawn"; put(L.P); res.json({ ok: true }); });

  // Potto: draft the about paragraph, draft concepts for the brief, rewrite any block shorter or warmer
  const ai = async (prompt) => { if (isFake() || aiMode() === "missing_key") return null; try { return (await complete({ prompt, effort: "low" })).text; } catch { return null; } };
  const RULES = "Write in plain, warm English, first person, as the host. Use only the facts given. Never invent numbers, names, clients or reviews. No em dashes, no emoji, no hype words (seamless, elevate, curated, unlock, magical). Say guests, never attendees.";
  app.post("/api/proposals/:id/potto", small, async (req, res) => { const L = loadMine(req, res); if (!L) return; if (limited("pp:" + L.H.ws, 120)) return bad(res, "Potto needs a breather. Try again in a while.", 429, "rate_limited");
    const P = L.P, H = hostOf(P.hostWs), what = req.body?.what, T = templateOf(P.template);
    if (what === "about") { const facts = { person: H.person, name: H.name, city: H.city, bio: H.bio, tagline: H.tagline, kinds: (H.experiences || []).map((e) => e.name).slice(0, 4) };
      const t = await ai(`${RULES}\nWrite one paragraph (60 to 90 words) introducing this host to a brand that wants to book them. Facts as JSON:\n${JSON.stringify(facts)}\nReply with the paragraph only.`);
      return res.json({ text: cleanText(t, 900) || aboutLocal({ ...facts, kinds: facts.kinds.map(lc), range: "" }), by: t ? "potto" : "rules" }); }
    if (what === "concepts") { const t = await ai(`${RULES}\nDraft 3 event concepts this host could run for the brand. Reply with only JSON: {"concepts":[{"name":"","line":"","experience":"","brand":""}]}. "line" is one sentence, "experience" is what guests do (2 sentences), "brand" is how the brand shows up tastefully (1 sentence).\nHost: ${JSON.stringify({ name: H.name, city: H.city, bio: H.bio, kind: T.label })}\nBrand: ${JSON.stringify({ name: P.brand.name, occasion: P.brand.occasion, brief: P.brand.brief, guests: P.brand.headcount })}`);
      let C = null; try { C = t ? parseJsonLoose(t).concepts : null; } catch {}
      if (!Array.isArray(C) || !C.length) { const brief = lc(P.brand.brief + " " + P.brand.occasion), hook = /launch/.test(brief) ? "Built around your launch." : /thank|customer/.test(brief) ? "A thank-you your guests will feel." : /team|offsite/.test(brief) ? "Made for a team to do together." : "";
        C = T.concepts.map((c) => ({ name: c.name, line: withBrand(c.line, P.brand.name) + (hook ? " " + hook : ""), experience: withBrand(c.experience, P.brand.name), brand: withBrand(c.brand, P.brand.name) })); }
      return res.json({ concepts: C.slice(0, 3).map((c) => ({ name: clean(c.name, 80), line: clean(c.line, 200), experience: cleanText(c.experience, 600), brand: cleanText(c.brand, 400) })), by: t ? "potto" : "rules" }); }
    bad(res, "Ask for about or concepts."); });
  app.post("/api/proposals/rewrite", small, async (req, res) => { const u = me(req); if (!u) return bad(res, "Sign in first.", 401, "unauthenticated"); if (limited("rw:" + u.ws, 200)) return bad(res, "Potto needs a breather. Try again in a while.", 429, "rate_limited");
    const how = req.body?.how === "warmer" ? "warmer" : "shorter", text = cleanText(req.body?.text, 2000); if (text.length < 3) return bad(res, "Write something first.");
    const t = await ai(`${RULES}\nRewrite this to be ${how === "shorter" ? "shorter (about half the length), keeping every fact" : "warmer and friendlier, keeping every fact and about the same length"}. Reply with the text only.\n\n${text}`);
    const out = cleanText(t, 2000); res.json({ text: out && (how !== "shorter" || out.length < text.length) ? out : rewriteLocal(text, how), by: out ? "potto" : "rules" }); });

  // ---- the brand answers: accept (into the booking and deposit path), ask a question (the request thread), or decline ----
  const tellHost = (P, text) => { try { X.notify?.(ownerOf(P.hostWs), { kind: "proposal", text, link: `/proposals/${P.id}/edit`, eventId: "" }); } catch {} };
  app.post("/api/p-brand/:token/respond", small, (req, res) => { if (limited("pr:" + req.ip, 60)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const P = byToken(req.params.token); if (!P || P.status === "withdrawn") return bad(res, "This proposal isn't open anymore.", 404, "not_found");
    const b = req.body || {}, action = ["accept", "question", "decline"].includes(b.action) ? b.action : "", u = me(req); if (!action) return bad(res, "Accept, ask a question, or decline.");
    if (u && u.ws === P.hostWs) return bad(res, "That's your own proposal. Send the link to the brand.", 403, "own");
    const r = P.requestId ? reqOf(P.requestId) : null; if (r && u && r.brandWs !== u.ws) return bad(res, "This proposal was sent to another team.", 403, "not_granted");
    const count = () => { P.answers = { ...(P.answers || {}), [action]: (P.answers?.[action] || 0) + 1 }; };
    if (action === "decline") { if (P.answer?.action === "accept") return bad(res, "This one is already accepted.", 409, "conflict");
      count(); P.status = "declined"; P.answer = { action, at: Date.now() }; const note = scrubContact(cleanText(b.text, 600));
      if (r && u) { r.messages = [...(r.messages || []), { id: rid(4), from: "brand", name: first(u.name || r.contactName), text: `We'll pass on the proposal this time.${note ? " " + note : ""}`, at: Date.now() }].slice(-300); BB().push?.(r, "brand", "passed on the proposal"); BB().reqSet?.(r); }
      put(P); tellHost(P, `${P.brand.name || "The brand"} passed on your proposal this time.`); return res.json({ ok: true, status: P.status }); }
    if (!u) return res.status(401).json({ code: "unauthenticated", message: action === "accept" ? "Sign in with your work account to accept and pay the deposit." : "Sign in with your work account to ask a question.", login: `/login?next=${encodeURIComponent(`/p-brand/${P.token}`)}` });
    if (getWorkspace(u.ws)?.plan === "friends" && !r) return bad(res, "Use a work account to book a host for a team.", 403, "work_only");
    if (action === "question") { const text = scrubContact(cleanText(b.text, 1000)); if (text.length < 3) return bad(res, "Write your question first.");
      let R = r; if (!R) R = newRequest(P, u, "question");
      R.messages = [...(R.messages || []), { id: rid(4), from: "brand", name: first(u.name || R.contactName), text, at: Date.now(), hidden: false }].slice(-300); BB().push?.(R, "brand", "asked about the proposal"); BB().reqSet?.(R);
      if (!P.requestId) P.requestId = R.id; count(); if (P.status === "sent") P.status = "question"; P.answer = P.answer?.action === "accept" ? P.answer : { action, at: Date.now() }; put(P);
      BB().tell?.(ownerOf(P.hostWs), `${R.company} has a question about your proposal.`, "/host/teams#inbox"); return res.json({ ok: true, url: `/teams/bookings/${R.id}` }); }
    // accept
    if (P.answer?.action === "accept" && P.acceptedRequest) return res.json({ ok: true, already: true, url: `/teams/bookings/${P.acceptedRequest}` });
    const S = P.sections, tiers = (S.pricing.tiers || []).filter((t) => t.cents > 0), ti = int(b.tier ?? S.pricing.recommend, 0, Math.max(0, tiers.length - 1)), t = tiers[ti]; if (!t) return bad(res, "This proposal has no price yet. Ask the host a question instead.", 409, "no_price");
    const n = S.plan.guests || P.brand.headcount, price = bookingPrice(t, n, { depositPct: S.pricing.depositPct, feeBps: r?.feeBps ?? FEE_BPS() });
    let R = r;
    if (R) { if (!["requested", "countered", "question"].includes(R.status)) return bad(res, R.status === "accepted" || isBooked(R) ? "This booking is already agreed." : "This request is closed.", 409, "conflict");
      R.price = price; R.headcount = n; R.deposit = { ...(R.deposit || {}), cents: price.depositCents }; R.terms = cancellationTerms(S.terms.policy, S.pricing.depositPct); if (!R.date && P.brand.date) R.date = P.brand.date; R.status = "accepted"; R.respondedAt ||= Date.now(); R.counter = null;
      R.proposal = { id: P.id, tier: t.name, title: S.cover.title }; BB().push?.(R, "brand", `accepted the proposal (${t.name})`); if (R.deposit.state === "held") BB().chargeDeposit?.(R); BB().reqSet?.(R); }
    else R = newRequest(P, u, "accepted", { price, tier: t });
    count(); P.status = "accepted"; P.answer = { action, at: Date.now(), tier: t.name }; P.acceptedRequest = R.id; if (!P.requestId) P.requestId = R.id; put(P);
    tellHost(P, `${R.company} accepted your proposal (${t.name}). The deposit is next.`);
    res.json({ ok: true, url: `/teams/bookings/${R.id}`, request: R.id, depositCents: R.deposit.cents }); });
  // a pitched proposal (no request yet): the brand's answer makes the team booking, in the shape server/brandbook.js keeps
  function newRequest(P, u, status, { price = null, tier = null } = {}) { const W = getWorkspace(u.ws), S = P.sections, n = S.plan.guests || P.brand.headcount, pr = price || bookingPrice((S.pricing.tiers || [])[S.pricing.recommend] || { cents: 0 }, n, { depositPct: S.pricing.depositPct });
    const R = { kind: "bbreq", id: rid(8), hostWs: P.hostWs, handle: hostOf(P.hostWs).handle, pkgId: "proposal-" + P.id, pkgName: clean(S.idea.concepts[S.idea.pick]?.name || S.cover.title, 120) || "Proposal", brandWs: u.ws, brandEmail: lc(u.email), brandPhone: "", contactName: clean(u.name || getDbUser(u.email)?.name || "", 80), company: clean(W?.plan !== "friends" ? W?.company : "", 120) || P.brand.name || first(u.name),
      date: P.brand.date || "", flex: null, headcount: n, diets: [], access: [], occasion: P.brand.occasion || "", notes: "", price: pr, feeBps: FEE_BPS(), terms: cancellationTerms(S.terms.policy, S.pricing.depositPct), venue: { kind: "venue", address: "" }, deposit: { state: "none", cents: pr.depositCents, provider: payProvider().name },
      status, ...(tier ? { proposal: { id: P.id, tier: tier.name, title: S.cover.title } } : {}), messages: [], history: [], reviews: {}, billing: { company: clean(W?.company, 120) }, createdAt: Date.now(), sentAt: Date.now(), ...(status === "accepted" ? { respondedAt: Date.now() } : {}) };
    BB().push?.(R, "brand", status === "accepted" ? `accepted the proposal (${tier?.name || ""})` : "asked about the proposal"); BB().reqSet?.(R); return R; }

  function notFound() { return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not found · Pottery Lab</title><link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/proposals.css"></head><body class="pp-body"><main class="pp-gone"><h1>This proposal isn't here</h1><p>The link may be old, or the host took it down. Ask them for a fresh one.</p><p><a class="pp-btn" href="/">Go to Pottery Lab</a></p></main></body></html>`; }

  return { priceTier, readiness, proofOf, viewOf, guideOf, fresh, get, byToken };
}
