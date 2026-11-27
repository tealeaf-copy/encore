// Paid host memberships: guests support a host with a monthly or yearly subscription and get priority access.
//
// Who can start one: a host with 5 or more events that really happened (a past date, not cancelled, not an example or
// a sample, at least one guest going or checked in). Example hosts (@demo.encore) and preview or showcase pages never
// qualify. Below 5 the host sees how many more they need.
//
// Tiers: up to 3, at $5, $10 or $20 a month, each with a name and one line the host writes ("Regular", "Friend of the
// house", "Patron"), and a yearly price (10x monthly to start, anywhere from 6x to 12x). Perks per tier:
//   early  - book a set number of hours before the public (the fan club's members-first window, one per tier; a
//            higher tier never gets a shorter head start than a lower one)
//   seats  - a block of seats held for members on each event (server/seats.js kind "member"), released to everyone
//            when the event opens to the public, and never more than the event has
//   only   - members-only events
//   badge  - a member badge on their own page
//   note   - a monthly note from the host
//
// Money: Stripe. Each host gets a Stripe Connect Express account, so the money is theirs and Stripe pays them out.
// Products and prices (one product per tier, a monthly and a yearly price) live on the host's account; sign-up is
// Stripe Checkout on that account (a direct charge, with an application fee of ENCORE_MEMBERSHIP_FEE_BPS, 0 at launch);
// members cancel or switch tiers in the Stripe Customer Portal (cancel takes effect at the end of the paid period).
// Webhooks (POST /api/stripe/webhook, signature checked, each event handled once) keep the member records current:
// checkout.session.completed, customer.subscription.created / updated / deleted, invoice.paid, invoice.payment_failed
// and account.updated. No card data ever reaches this server. Every call is plain fetch to api.stripe.com.
// Off unless STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set: hosts then read "Memberships need payments set up"
// and the owner (ENCORE_ADMIN_EMAILS) sees a setup checklist. docs/memberships.md has the owner's steps.
//
// Web only: the iPhone and Android apps never show a price or a buy button (App Store guideline 3.1.1 for digital
// subscriptions). They say "You can join on the web" and open the host's page in the browser. Checkout refuses
// requests from the app (isNativeReq).
//
// Priority access is enforced on the server inside every reply and order (server/app.js rsvpPolicy, hook below):
// during the window only members whose tier is open may say I'm in or order; everyone else reads "Opens to everyone
// on Fri at 10am" and may join the waitlist. Who is a member comes from the signed-in account (or an email the guest
// proved by link), never from the email typed into the form.
//
// Docs, in the host's workspace: membership/main (tiers, Stripe account, prices), paidmembers/<hash of email>,
// memberevents/<event id> (the window: publicAt, held seats, members only, who has been told), membernotes/<id>,
// stripesubs/<subscription id> and stripeevents/<event id> (handled once). Global: system/stripe-acct-<acct> and
// system/stripe-price-<price> map Stripe ids back to a workspace.
import crypto from "node:crypto";
import express from "express";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { isNativeReq } from "./fanclub.js";
import { textProblem } from "./safety.js";
import { eventTz } from "./tz.js";
import { startMs } from "./invites.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const line1 = (v, n) => clean(v, n).replace(/\s+/g, " ");
const h24 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 24);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const HOUR = 3600e3, DAY = 864e5;

export const AMOUNTS = [5, 10, 20]; // dollars a month
export const RANK = { 5: 1, 10: 2, 20: 3 };
export const ELIGIBLE_AT = 5;
export const YEARLY_MIN = 6, YEARLY_MAX = 12, YEARLY_X = 10; // a year costs 6x to 12x a month, 10x to start
export const EARLY_HOURS = [12, 24, 48, 72, 96, 168];
export const SEATS_MAX = 50, NOTE_MAX = 800, NOTES_PER_DAY = 5;
export const ACTIVE = new Set(["active", "trialing", "past_due"]);
export const STRIPE_VERSION = "2024-06-20";
export const DEFAULT_TIERS = {
  5: { name: "Regular", line: "First dibs on every new date.", perks: { early: true, earlyHours: 24, seats: false, only: false, badge: true, note: false } },
  10: { name: "Friend of the house", line: "Earlier dibs and a seat held for you.", perks: { early: true, earlyHours: 48, seats: true, only: false, badge: true, note: false } },
  20: { name: "Patron", line: "First in line for everything, and a note from me each month.", perks: { early: true, earlyHours: 72, seats: true, only: true, badge: true, note: true } },
};

/** Stripe settings from the environment. Memberships are on only with both a secret key and a webhook secret. */
export function stripeConfig(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || "").trim(), whsec = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  const bps = Math.floor(Number(env.ENCORE_MEMBERSHIP_FEE_BPS)); const feeBps = Number.isFinite(bps) && bps > 0 ? Math.min(bps, 3000) : 0;
  const keyOk = /^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(key), hookOk = /^whsec_[A-Za-z0-9+/=_-]{8,}$/.test(whsec);
  const missing = [...(keyOk ? [] : ["STRIPE_SECRET_KEY"]), ...(hookOk ? [] : ["STRIPE_WEBHOOK_SECRET"])];
  return { on: keyOk && hookOk && env.ENCORE_MEMBERSHIPS !== "0", key, whsec, clientId: String(env.STRIPE_CONNECT_CLIENT_ID || "").trim(), feeBps, test: /_test_/.test(key), missing };
}

/** Stripe's form encoding: a[b][c]=v, arrays as a[0][x]. Empty values are left out. */
export function formOf(obj, pre = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) { if (v == null || v === "") continue; const key = pre ? `${pre}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x && typeof x === "object" ? formOf(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") formOf(v, key, out); else out.append(key, String(v)); }
  return out;
}

let FETCH = null;
/** Tests swap in a stub (no network). */
export function setStripeFetch(f) { FETCH = typeof f === "function" ? f : null; }
/** One call to the Stripe API. account: a connected account (Stripe-Account header). idem: an Idempotency-Key. */
export async function stripeApi(cfg, method, path, params = null, { account = "", idem = "" } = {}) {
  const f = FETCH || globalThis.fetch, get = method === "GET";
  const url = "https://api.stripe.com/v1/" + String(path).replace(/^\/+/, "") + (get && params ? "?" + formOf(params) : "");
  const headers = { Authorization: "Bearer " + cfg.key, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": STRIPE_VERSION };
  if (account) headers["Stripe-Account"] = account; if (idem) headers["Idempotency-Key"] = idem.slice(0, 255);
  let r; try { r = await f(url, { method, headers, ...(get ? {} : { body: formOf(params || {}).toString() }), signal: AbortSignal.timeout(15000) }); }
  catch { throw Object.assign(new Error("We couldn't reach Stripe. Try again in a minute."), { code: "stripe_unreachable", status: 502 }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || "Stripe said no. Try again in a minute."), { code: "stripe_error", status: 502, stripe: j?.error || null });
  return j;
}

/** The Stripe-Signature header for a payload (tests, and the Stripe CLI does the same). */
export function signStripe(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac("sha256", secret).update(Buffer.concat([Buffer.from(t + "."), Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload))])).digest("hex");
  return `t=${t},v1=${sig}`;
}
/** Checks a webhook's Stripe-Signature against the raw body: HMAC-SHA256 of "<t>.<body>", 5 minutes of tolerance. */
export function verifyStripe(payload, header, secret, { tolerance = 300, now = Date.now() } = {}) {
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? "")); let t = 0; const v1 = [];
  for (const p of String(header || "").split(",")) { const i = p.indexOf("="); if (i < 1) continue; const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k === "t") t = Number(v); else if (k === "v1") v1.push(v); }
  if (!secret || !t || !v1.length) return { ok: false, reason: "no_signature" };
  if (Math.abs(now / 1000 - t) > tolerance) return { ok: false, reason: "too_old" };
  const want = Buffer.from(crypto.createHmac("sha256", secret).update(Buffer.concat([Buffer.from(t + "."), raw])).digest("hex"));
  const ok = v1.some((s) => { const b = Buffer.from(s); return b.length === want.length && crypto.timingSafeEqual(b, want); });
  return ok ? { ok: true, t } : { ok: false, reason: "bad_signature" };
}

/** "on Fri at 10am" in the event's own time zone. */
export function fmtWhen(ms, ev) {
  if (!ms) return ""; const tz = eventTz(ev || {});
  try { const P = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, ...(tz ? { timeZone: tz } : {}) }).formatToParts(new Date(ms)), g = (k) => P.find((p) => p.type === k)?.value || "";
    const m = g("minute"); return `on ${g("weekday")} at ${g("hour")}${m && m !== "00" ? ":" + m : ""}${g("dayPeriod").toLowerCase()}`; } catch { return "on " + new Date(ms).toUTCString().slice(0, 22); }
}
/** "3 days", "12 hours", "a week". */
export const hoursLabel = (h) => (h >= 168 && h % 168 === 0 ? (h === 168 ? "a week" : `${h / 168} weeks`) : h >= 24 && h % 24 === 0 ? (h === 24 ? "1 day" : `${h / 24} days`) : `${h} hours`);
const money = (d) => "$" + (Math.round(d * 100) % 100 ? (Math.round(d * 100) / 100).toFixed(2) : String(Math.round(d)));

/** A host's tiers, checked. Returns { tiers } (sorted cheapest first) or { error }. Amounts are dollars. */
export function cleanTiers(input) {
  if (!Array.isArray(input) || !input.length) return { error: "Pick at least one tier." };
  if (input.length > AMOUNTS.length) return { error: "Up to 3 tiers." };
  const seen = new Set(), out = [];
  for (const t of input) {
    const monthly = Number(t?.monthly); if (!AMOUNTS.includes(monthly)) return { error: "Each tier is $5, $10 or $20 a month." };
    if (seen.has(monthly)) return { error: "Each tier needs its own price." }; seen.add(monthly);
    const D = DEFAULT_TIERS[monthly], name = line1(t?.name, 40) || D.name, line = t?.line != null ? line1(t.line, 100) : D.line;
    for (const x of [name, line]) { const p = textProblem(x); if (p) return { error: p.message }; }
    let yearly = monthly * YEARLY_X;
    if (t?.yearly != null && t.yearly !== "") { const y = Math.round(Number(String(t.yearly).replace(/[$,\s]/g, "")) * 100) / 100;
      if (!Number.isFinite(y) || y < monthly * YEARLY_MIN || y > monthly * YEARLY_MAX) return { error: `A year of ${name} can be ${money(monthly * YEARLY_MIN)} to ${money(monthly * YEARLY_MAX)}.` }; yearly = y; }
    const P = t?.perks && typeof t.perks === "object" ? t.perks : D.perks, early = !!P.early, hrs = Number(P.earlyHours);
    const perks = { early, earlyHours: early ? (EARLY_HOURS.includes(hrs) ? hrs : 24) : 0, seats: !!P.seats, only: !!P.only, badge: !!P.badge, note: !!P.note };
    out.push({ id: "t" + monthly, rank: RANK[monthly], monthly, yearly, name, line, perks });
  }
  out.sort((a, b) => a.monthly - b.monthly);
  for (let i = 1; i < out.length; i++) if (out[i].perks.earlyHours < out[i - 1].perks.earlyHours)
    return { error: `Higher tiers get in first. Give ${out[i].name} a head start of at least ${hoursLabel(out[i - 1].perks.earlyHours)}.` };
  return { tiers: out };
}
/** What a tier gets, in plain words. */
export function perkLines(T, hostName = "the host") {
  const P = T?.perks || {};
  return [P.early && P.earlyHours ? `Book ${hoursLabel(P.earlyHours)} before everyone else` : "", P.seats ? "Seats held for members at each event" : "", P.only ? "Members-only events" : "", P.badge ? "A member badge on your page" : "", P.note ? `A monthly note from ${hostName}` : ""].filter(Boolean);
}

export function makeMemberships({ store, C, X = null, F = null, locals = {}, now: clock = () => Date.now(), env = () => process.env }) {
  const S0 = (ws) => scopeStore(store, ws);
  const cfgS = () => stripeConfig(env());
  const owner = (ws) => lc(getWorkspace(ws)?.ownerEmail);
  const demo = (ws) => /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  const today = () => new Date(clock()).toISOString().slice(0, 10);
  const hostFirst = (ws) => { const h = C.profileOf(ws) || {}; return first(h.name).replace(/['’]s$/i, "") || h.handle || "the host"; };

  // ---- eligibility: 5 events that really happened ----
  function realEvents(ws) {
    if (!ws || ws === DEFAULT_WS || !getWorkspace(ws) || demo(ws)) return 0;
    const h = C.profileOf(ws) || {}; if (h.showcase || h.preview || h.sample) return 0;
    const S = S0(ws), t = today(), came = new Set();
    for (const d of S.list("rsvps")) { const r = d.data || {}; if (r.response === "going" || r.checkedInAt) came.add(String(r.eventId || "")); }
    let n = 0;
    for (const d of S.list("events")) { const e = d.data || {};
      if (e.example || e.sample || e.cancelled || e.preview || e.showcase || e.stage === "interest") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date >= t) continue;
      if (came.has(d.id) || (e.guests || []).some((g) => /^(Going|Attended)$/i.test(String(g?.status || "")) || g?.checkedInAt)) n++; }
    return n;
  }
  function eligibility(ws) { const n = realEvents(ws); return { count: n, need: Math.max(0, ELIGIBLE_AT - n), eligible: n >= ELIGIBLE_AT, at: ELIGIBLE_AT }; }

  // ---- the host's membership ----
  const CFG = "membership/main";
  function config(ws) { const c = S0(ws).get(CFG)?.data || {};
    return { on: !!c.on, accepting: !!c.on && c.accepting !== false, tiers: Array.isArray(c.tiers) ? c.tiers : [], seatsN: Number.isFinite(+c.seatsN) ? +c.seatsN : 2, freeEarly: !!c.freeEarly,
      account: c.account || "", chargesEnabled: !!c.chargesEnabled, detailsSubmitted: !!c.detailsSubmitted, prices: c.prices || {}, portal: c.portal || "", startedAt: c.startedAt || 0, closingAt: c.closingAt || 0, synced: c.synced || 0, lastNoteAt: c.lastNoteAt || 0 }; }
  const setRaw = (ws, patch) => { const cur = S0(ws).get(CFG)?.data || {}; S0(ws).set(CFG, { ...cur, ...patch, updatedAt: clock() }); return config(ws); };
  const tierOf = (ws, id) => config(ws).tiers.find((t) => t.id === id) || null;

  // ---- members ----
  const mKey = (email) => h24("member|" + lc(email));
  const mPath = (k) => "paidmembers/" + k;
  const memberOf = (ws, email) => (email ? S0(ws).get(mPath(mKey(email)))?.data || null : null);
  /** Paying (or in the grace of a period they already paid for), and not taken out by the host. */
  const live = (m, t = clock()) => !!m && !m.removedAt && (ACTIVE.has(m.status) || (m.status === "canceled" && (m.graceUntil || 0) > t));
  /** 0 = not a paid member here. 1, 2, 3 = the tier's rank ($5, $10, $20). Blocks count both ways. */
  function rankOf(ws, email) { const em = lc(email); if (!em) return 0; const m = memberOf(ws, em); if (!live(m)) return 0; try { if (F?.blocked?.(ws, em)) return 0; } catch {} return tierOf(ws, m.tier)?.rank || RANK[m.monthly] || 0; }
  const membersOf = (ws) => S0(ws).list("paidmembers").map((d) => ({ key: d.id, ...d.data }));
  const liveOf = (ws) => membersOf(ws).filter((m) => live(m) && !(F?.blocked?.(ws, m.email)));

  // ---- the window on one event ----
  const EV = (id) => "memberevents/" + id;
  const evDoc = (ws, id) => (ID.test(String(id || "")) ? S0(ws).get(EV(id))?.data || null : null);
  function windowOf(ws, id, t = clock()) {
    const c = config(ws); if (!c.on || !c.tiers.length) return null; const v = evDoc(ws, id); if (!v || !v.on) return null;
    const pub = +v.publicAt || 0, opens = {};
    for (const T of c.tiers) opens[T.rank] = T.perks.early && T.perks.earlyHours ? pub - T.perks.earlyHours * HOUR : pub;
    const early = c.tiers.filter((T) => T.perks.early && T.perks.earlyHours); opens[0] = c.freeEarly && early.length ? opens[early[0].rank] : pub;
    const seatT = c.tiers.find((T) => T.perks.seats), onlyT = c.tiers.find((T) => T.perks.only);
    return { publicAt: pub, opens, open: t >= pub, only: !!v.only && !!onlyT, onlyRank: onlyT?.rank || 0, seats: seatT ? Math.max(0, Math.floor(+v.seats || 0)) : 0, seatRank: seatT?.rank || 0, first: Math.min(...Object.values(opens)) };
  }
  /** When this person may book: by their tier, a free fan club member (rank 0) when the host allows it, else the public. */
  const opensFor = (W, rank, club) => { if (rank) { for (let r = rank; r >= 1; r--) if (W.opens[r] != null) return W.opens[r]; return W.publicAt; } return club ? W.opens[0] : W.publicAt; };
  /** This event's replies are the memberships' to decide (server/fanclub.js rsvpGate steps aside). */
  const handles = (ws, id) => !!windowOf(ws, id);
  /** Someone who joined the waitlist during the window keeps waiting until it opens to everyone (server/app.js promoteWaitlist). */
  const holdsBack = (ws, id, r) => { if (!(+r?.memberWait > 0)) return false; const W = windowOf(ws, id); return !!W && !W.open; };

  /** The check inside a reply or an order. email: the signed-in (or proven) email, never the one typed into the form.
   * Returns null (nothing to check), { rank } (go ahead), { waitlist, memberWait } or { error, status, code, ... }. */
  function gate(ws, id, { email = "", invited = false, wait = false, ev = null, t = clock() } = {}) {
    const W = windowOf(ws, id, t); if (!W) return null;
    const em = lc(email); if (em && em === owner(ws)) return { rank: 3, own: true };
    const rank = rankOf(ws, em); let club = false; try { club = !!em && !!F?.isMember?.(ws, em); } catch {}
    const h = C.profileOf(ws) || {}, hostN = hostFirst(ws), E = ev || S0(ws).get("events/" + id)?.data || {};
    if (W.only) return rank >= W.onlyRank ? { rank } : { error: `This one is for members. Become a member on ${hostN}'s page to get in.`, status: 403, code: "members_only", handle: h.handle || "" };
    if (W.open || invited) return { rank };
    const at = opensFor(W, rank, club); if (t >= at) return { rank };
    const canWait = !E.preorder && E.autoWait !== false && +E.headcount > 0;
    if (wait && canWait) return { waitlist: true, memberWait: W.publicAt, rank };
    const pubW = fmtWhen(W.publicAt, E);
    if (at < W.publicAt) return { error: `Your early access opens ${fmtWhen(at, E)}. It opens to everyone ${pubW}.`, status: 403, code: "members_window", opensAt: at, publicAt: W.publicAt, canWait };
    return { error: `Opens to everyone ${pubW}. Members get in first.${canWait ? " Join the waitlist and you'll hear if a spot is yours." : ""}`, status: 403, code: "members_window", opensAt: W.publicAt, publicAt: W.publicAt, canWait, handle: h.handle || "" };
  }
  /** One plain line for the light invite (public/seats-line.js), for this viewer. null when there's no window. */
  function guestLine(ws, id, ev, email, { native = false } = {}) {
    const W = windowOf(ws, id); if (!W || (W.open && !W.only)) return null;
    const em = lc(email), rank = rankOf(ws, em), T = config(ws).tiers.find((x) => x.rank === rank); let club = false; try { club = !!em && !!F?.isMember?.(ws, em); } catch {}
    if (em && em === owner(ws)) return { on: true, line: `Members first until ${fmtWhen(W.publicAt, ev).replace(/^on /, "")}.`, can: true, member: true };
    if (W.only) return rank >= W.onlyRank ? { on: true, line: `Members only. You're in as ${T?.name || "a member"}.`, can: true, member: true } : { on: true, line: `This one is for members.${native ? "" : " Become a member on the host's page to get in."}`, can: false, member: false };
    const at = opensFor(W, rank, club), canWait = !ev.preorder && ev.autoWait !== false && +ev.headcount > 0;
    if (clock() >= at) return { on: true, line: `${T ? T.name + " early access" : "Early access"} is open. It opens to everyone ${fmtWhen(W.publicAt, ev)}.`, can: true, member: true, publicAt: W.publicAt };
    if (at < W.publicAt) return { on: true, line: `Your early access opens ${fmtWhen(at, ev)}.`, can: false, remind: true, opensAt: at, wait: canWait, member: true };
    return { on: true, line: `Opens to everyone ${fmtWhen(W.publicAt, ev)}. Members get in first.`, can: false, remind: true, opensAt: W.publicAt, wait: canWait, member: false };
  }

  // ---- held seats (server/seats.js kind "member"), never more than the event has ----
  function seatRoom(ws, id, ev) { const Z = locals.seats, cap = Math.max(0, Math.floor(+ev?.headcount || 0)); if (!cap) return 0;
    const others = Z ? Z.cfgOf(ws, id).blocks.filter((b) => b.kind !== "member" && b.kind !== "everyone").reduce((s, b) => s + b.n, 0) : 0; return Math.max(0, cap - others); }
  function syncSeats(ws, id) {
    const Z = locals.seats; if (!Z) return; const W = windowOf(ws, id), cur = Z.cfgOf(ws, id), others = cur.blocks.filter((b) => b.kind !== "member");
    const n = W && W.seatRank ? W.seats : 0; if (!n && !cur.blocks.some((b) => b.kind === "member")) return;
    const blocks = n ? [{ id: "members", kind: "member", label: "Members", n, minRank: W.seatRank, opensAt: 0, releaseAt: W.publicAt }, ...others] : others;
    Z.setCfg(ws, id, { blocks, on: blocks.length > 0, rollover: true }, { membership: true });
  }

  /** The host sets (or the publish sets) an event's window. b: { on, publicAt (ms), seats, only }. */
  function setEvent(ws, id, b = {}) {
    const S = S0(ws), ev = ID.test(String(id || "")) ? S.get("events/" + id)?.data : null; if (!ev || ev.example || ev.sample) return { error: "No such event.", status: 404, code: "not_found" };
    const c = config(ws); if (!c.on) return { error: "Start your membership first.", status: 409, code: "membership_off" };
    const cur = evDoc(ws, id) || {}, t = clock(), on = b.on != null ? !!b.on : cur.on ?? true;
    const maxH = Math.max(0, ...c.tiers.map((T) => (T.perks.early ? T.perks.earlyHours : 0)));
    let publicAt = +cur.publicAt || 0;
    if (b.publicAt != null && b.publicAt !== "") { const p = Math.floor(Number(b.publicAt)); if (!(p > 0)) return { error: "Pick when it opens to everyone." };
      if (p > t + 90 * DAY) return { error: "Pick a time in the next 90 days." }; const st = startMs(ev); if (st && p > st) return { error: "It has to open to everyone before the event starts." }; publicAt = p; }
    else if (!publicAt) publicAt = t + maxH * HOUR;
    let seats = cur.seats != null ? +cur.seats : null; const seatTier = c.tiers.some((T) => T.perks.seats);
    if (b.seats != null && b.seats !== "") { seats = Math.max(0, Math.floor(Number(b.seats) || 0));
      if (seats && !seatTier) return { error: "Turn on held seats for a tier first." };
      if (seats && !(+ev.headcount > 0)) return { error: "Set how many spots the event has first, then hold some for members." };
      const room = seatRoom(ws, id, ev); if (seats > Math.min(room, SEATS_MAX)) return { error: room ? `You can hold up to ${Math.min(room, SEATS_MAX)} seats. That's all the event has.` : "Every seat is already in another block.", code: "over_capacity" }; }
    else if (seats == null) seats = seatTier && +ev.headcount > 0 ? Math.min(c.seatsN, Math.floor(+ev.headcount / 2), seatRoom(ws, id, ev)) : 0;
    const only = b.only != null ? !!b.only : !!cur.only; if (only && on && !c.tiers.some((T) => T.perks.only)) return { error: "Turn on members-only events for a tier first." };
    const next = { ...cur, on, publicAt, seats, only, setAt: t, told: cur.told || {}, releasedAt: publicAt !== cur.publicAt ? 0 : cur.releasedAt || 0 };
    S.set(EV(id), next);
    // the fan club's members-first window mirrors it, so the host page and the invite say "members first" and followers
    // hear when it opens to everyone (server/fanclub.js runJobs); members only hides it from everyone else
    try { const v = S.get("clubevents/" + id)?.data || {};
      if (on && only && !v.only) F?.setVisibility?.(ws, id, "members"); else if (v.only && v.byMembership && (!on || !only)) F?.setVisibility?.(ws, id, "everyone");
      const v2 = S.get("clubevents/" + id)?.data || {};
      if (on) S.set("clubevents/" + id, { ...v2, earlyUntil: only ? 0 : publicAt, toldAt: v2.toldAt || t, followersToldAt: v2.followersToldAt && publicAt <= (v2.followersToldAt || 0) ? v2.followersToldAt : 0, byMembership: true, ...(only ? { only: true } : {}) });
      else if (v2.byMembership) S.set("clubevents/" + id, { ...v2, earlyUntil: 0, byMembership: false }); } catch (e) { console.warn("[memberships] club window", e?.message); }
    syncSeats(ws, id);
    return { event: eventView(ws, id) };
  }
  function eventView(ws, id) { const ev = S0(ws).get("events/" + id)?.data || {}, v = evDoc(ws, id) || {}, W = windowOf(ws, id), c = config(ws);
    return { id, title: ev.pubTitle || ev.name || "Untitled", date: ev.date || "", startTime: ev.startTime || "", drop: !!ev.drop, cap: +ev.headcount || 0, on: !!v.on, publicAt: +v.publicAt || 0, seats: +v.seats || 0, only: !!v.only, room: seatRoom(ws, id, ev),
      opens: W ? c.tiers.map((T) => ({ tier: T.id, name: T.name, at: W.opens[T.rank] })) : [], opensLabel: W ? fmtWhen(W.publicAt, ev) : "" }; }

  // ---- telling members as each tier's window opens (the bell, a push, an email; mutes and blocks respected) ----
  async function tellWindows(req, ws, id, t = clock()) {
    const W = windowOf(ws, id, t), S = S0(ws), ev = S.get("events/" + id)?.data, v = evDoc(ws, id); if (!W || !ev || ev.cancelled || ev.example) return 0;
    if (ev.date && ev.date < today()) return 0; if (typeof F?.tellOne !== "function") return 0;
    const c = config(ws), h = C.profileOf(ws) || {}, told = { ...(v.told || {}) }, title = ev.pubTitle || ev.name || "Something new", link = `/e/${encodeURIComponent(id)}`; let n = 0;
    const club = (() => { try { return F.membersOf(ws); } catch { return []; } })(), withRank = club.map((m) => ({ ...m, rank: rankOf(ws, m.email) }));
    if (W.only) { if (told.only) return 0; told.only = t; S.update(EV(id), { told });
      for (const m of withRank) if (m.rank >= W.onlyRank && !m.muted && await F.tellOne(req, ws, m.email, { club: true, key: `mem-only-${id}`, eventId: id, link, subject: `Members only: ${title}`, text: `${h.name || "Your host"}: ${title}, for members only.`, body: `${h.name || "Your host"} made something for members only: ${title}.` })) n++;
      return n; }
    for (const r of [3, 2, 1, 0]) { if (told[r]) continue; const at = opensFor(W, r, true); if (at > t) continue; told[r] = t;
      const late = W.open && t - W.publicAt > 6 * HOUR; if (late) continue; // a window that closed long ago: followers already heard
      const T = c.tiers.find((x) => x.rank === r), early = at < W.publicAt, until = fmtWhen(W.publicAt, ev);
      for (const m of withRank) { if (m.rank !== r || m.muted) continue; if (r === 0 && W.open && !early) continue; // free members hear with followers once it's open (server/fanclub.js)
        if (await F.tellOne(req, ws, m.email, { club: true, key: `mem-${id}-${r}`, eventId: id, link, subject: early ? `Early access: ${title}` : `Open now: ${title}`,
          text: early ? `${T ? T.name + " early access" : "Early access"} is open: ${title}. It opens to everyone ${until}.` : `${title} is open now.`,
          body: early ? `${h.name || "Your host"} has something new: ${title}. As ${T ? "a " + T.name : "a member"} you can book now, before it opens to everyone ${until}.` : `${h.name || "Your host"}: ${title} is open now.` })) n++; } }
    S.update(EV(id), { told }); return n;
  }

  // ---- Stripe ----
  const err = (message, status = 400, code = "invalid") => Object.assign(new Error(message), { status, code });
  const accountWs = (acct) => (acct ? store.get("system/stripe-acct-" + acct)?.data?.ws || null : null);
  async function connect(ws, { origin, email }) {
    const s = cfgS(); if (!s.on) throw err("Memberships need payments set up. We'll let you know when they're on.", 409, "payments_off");
    let c = config(ws), acct = c.account; const h = C.profileOf(ws) || {};
    if (!acct) { const a = await stripeApi(s, "POST", "accounts", { type: "express", email: lc(email) || undefined, capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { url: /^https:\/\//.test(origin) ? `${origin}/@${h.handle}` : undefined, product_description: `Memberships for ${h.name || h.handle}'s events on Pottery Lab` }, metadata: { pl_ws: ws } }, { idem: `pl-acct-${ws}` });
      acct = a.id; store.set("system/stripe-acct-" + acct, { ws }); c = setRaw(ws, { account: acct, chargesEnabled: !!a.charges_enabled, detailsSubmitted: !!a.details_submitted }); }
    const link = await stripeApi(s, "POST", "account_links", { account: acct, refresh_url: `${origin}/@${h.handle}?membership=refresh#membership`, return_url: `${origin}/@${h.handle}?membership=connected#membership`, type: "account_onboarding" });
    return { url: link.url };
  }
  async function refreshAccount(ws) { const s = cfgS(), c = config(ws); if (!s.on || !c.account) return c;
    const a = await stripeApi(s, "GET", "accounts/" + c.account); return setRaw(ws, { chargesEnabled: !!a.charges_enabled, detailsSubmitted: !!a.details_submitted }); }
  async function dashboardLink(ws) { const s = cfgS(), c = config(ws); if (!s.on || !c.account) throw err("Connect Stripe first.", 409, "no_account");
    return { url: (await stripeApi(s, "POST", `accounts/${c.account}/login_links`, {})).url }; }
  /** Products and prices on the host's account (prices can't change in Stripe: a new amount is a new price, the old one is archived), and the Customer Portal set to cancel at the period's end. */
  async function syncPrices(ws, origin = "") {
    const s = cfgS(), c = config(ws); if (!s.on || !c.account || !c.tiers.length) return c;
    const account = c.account, prices = { ...(c.prices || {}) }, h = C.profileOf(ws) || {};
    for (const T of c.tiers) { const P = { ...(prices[T.id] || {}) }, pname = `${T.name} (${h.name || h.handle || "membership"})`;
      if (!P.product) P.product = (await stripeApi(s, "POST", "products", { name: pname, metadata: { pl_ws: ws, pl_tier: T.id } }, { account, idem: `pl-prod-${ws}-${T.id}` })).id;
      else if (P.name !== pname || P.archived) await stripeApi(s, "POST", "products/" + P.product, { name: pname, active: true }, { account });
      P.name = pname; P.archived = false;
      for (const [k, cents] of [["month", T.monthly * 100], ["year", Math.round(T.yearly * 100)]]) { if (P[k]?.id && P[k].amount === cents) continue;
        const pr = await stripeApi(s, "POST", "prices", { product: P.product, currency: "usd", unit_amount: cents, recurring: { interval: k }, metadata: { pl_ws: ws, pl_tier: T.id } }, { account, idem: `pl-price-${ws}-${T.id}-${k}-${cents}` });
        if (P[k]?.id) await stripeApi(s, "POST", "prices/" + P[k].id, { active: false }, { account }).catch(() => {});
        P[k] = { id: pr.id, amount: cents }; store.set("system/stripe-price-" + pr.id, { ws, tier: T.id, interval: k }); }
      prices[T.id] = P; }
    for (const [id, P] of Object.entries(prices)) if (!c.tiers.some((T) => T.id === id) && !P.archived) { // a tier the host dropped: no new members on it; its members stay until they change or cancel
      for (const k of ["month", "year"]) if (P[k]?.id) await stripeApi(s, "POST", "prices/" + P[k].id, { active: false }, { account }).catch(() => {});
      if (P.product) await stripeApi(s, "POST", "products/" + P.product, { active: false }, { account }).catch(() => {}); prices[id] = { ...P, archived: true }; }
    const o = origin || env().ENCORE_PUBLIC_URL || "";
    const portal = { business_profile: { headline: `${F?.config?.(ws)?.name || (h.name || "Your host") + " membership"}`, ...(/^https:\/\//.test(o) ? { privacy_policy_url: o + "/privacy", terms_of_service_url: o + "/terms" } : {}) },
      features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: { enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations", products: c.tiers.map((T) => ({ product: prices[T.id].product, prices: [prices[T.id].month.id, prices[T.id].year.id] })) } } };
    let pid = c.portal; if (pid) await stripeApi(s, "POST", "billing_portal/configurations/" + pid, portal, { account }); else pid = (await stripeApi(s, "POST", "billing_portal/configurations", portal, { account, idem: `pl-portal-${ws}` })).id;
    return setRaw(ws, { prices, portal: pid, synced: clock() });
  }
  async function checkout(ws, u, { tier, interval, origin }) {
    const s = cfgS(), c = config(ws), h = C.profileOf(ws) || {}, em = lc(u?.email);
    if (!s.on) throw err("Memberships aren't on yet.", 409, "payments_off");
    if (!c.on || !c.accepting || !c.chargesEnabled) throw err(`${hostFirst(ws)} isn't taking members right now.`, 409, "not_open");
    if (!em) throw err("Make a free account to do that.", 401, "unauthenticated");
    if (em === owner(ws)) throw err("It's your own membership.", 400, "own");
    if (F?.blocked?.(ws, em)) throw err("You can't join this one.", 403, "blocked");
    const cm = F?.memberDoc?.(ws, em), cur = memberOf(ws, em); if (cm?.removedAt || cur?.removedAt) throw err("The host took you out of this club.", 403, "removed");
    if (live(cur) && ACTIVE.has(cur.status)) throw err("You're already a member. Change your tier from Manage.", 409, "already_member");
    const T = tierOf(ws, String(tier || "")); if (!T) throw err("Pick a tier.");
    const k = interval === "year" ? "year" : interval === "month" ? "month" : ""; if (!k) throw err("Pick monthly or yearly.");
    const P = c.prices?.[T.id]?.[k]; if (!P?.id) throw err("That tier isn't ready yet. Try again in a minute.", 409, "not_ready");
    const key = mKey(em), md = { pl_ws: ws, pl_member: key, pl_tier: T.id };
    const params = { mode: "subscription", line_items: [{ price: P.id, quantity: 1 }], success_url: `${origin}/@${h.handle}?member=welcome#membership`, cancel_url: `${origin}/@${h.handle}#membership`,
      client_reference_id: key, ...(cur?.customer ? { customer: cur.customer } : { customer_email: em }), metadata: md,
      subscription_data: { metadata: { ...md, pl_email: em }, ...(s.feeBps > 0 ? { application_fee_percent: (s.feeBps / 100).toFixed(2) } : {}) } };
    const sess = await stripeApi(s, "POST", "checkout/sessions", params, { account: c.account, idem: `pl-co-${key}-${T.id}-${k}-${Math.floor(clock() / 600e3)}` });
    S0(ws).set(mPath(key), { history: [], ...(cur || {}), email: em, name: clean(u.name, 80) || cur?.name || "", pending: { session: sess.id, tier: T.id, interval: k, at: clock() } });
    return { url: sess.url, session: sess.id };
  }
  async function portalLink(ws, u, { origin }) {
    const s = cfgS(), c = config(ws), h = C.profileOf(ws) || {}, m = memberOf(ws, u?.email); if (!s.on) throw err("Memberships aren't on yet.", 409, "payments_off");
    if (!m?.customer || !c.account) throw err("You're not a member here yet.", 404, "not_member");
    return { url: (await stripeApi(s, "POST", "billing_portal/sessions", { customer: m.customer, return_url: `${origin}/@${h.handle}#membership`, ...(c.portal ? { configuration: c.portal } : {}) }, { account: c.account })).url };
  }
  /** Stop future charges (the member keeps access until the period they paid for ends). */
  async function cancelAtEnd(ws, key, why) {
    const s = cfgS(), c = config(ws), p = mPath(key), m = S0(ws).get(p)?.data; if (!m || !m.subscription || m.cancelAtPeriodEnd || !ACTIVE.has(m.status)) return false;
    if (s.on && c.account) await stripeApi(s, "POST", "subscriptions/" + m.subscription, { cancel_at_period_end: true, metadata: { pl_cancel: why } }, { account: c.account, idem: `pl-cancel-${m.subscription}` });
    S0(ws).update(p, { cancelAtPeriodEnd: true, cancelReason: why, cancelRequestedAt: clock() }); return true;
  }
  /** The host took a member out (or blocked them): access ends now, charges stop at the period's end, refunds are the host's call in Stripe. */
  async function removeMember(ws, key, why = "removed") { const p = mPath(key), m = S0(ws).get(p)?.data; if (!m) return false;
    if (!m.removedAt) S0(ws).update(p, { removedAt: clock(), removedWhy: why }); try { if (F?.memberDoc?.(ws, m.email) && !F.memberDoc(ws, m.email).removedAt) F.leave(ws, m.email, { by: "host" }); } catch {}
    try { await cancelAtEnd(ws, key, why); } catch (e) { S0(ws).update(p, { cancelError: String(e?.message || e).slice(0, 200) }); } return true; }

  // ---- webhooks ----
  function onBecameMember(ws, m) {
    try { const c0 = F?.config?.(ws); if (c0 && !c0.on) F.setConfig(ws, { on: true }); F?.join?.(ws, { email: m.email, name: m.name }); } catch {}
    const T = tierOf(ws, m.tier), h = C.profileOf(ws) || {}, o = owner(ws);
    try { if (o) X?.notify?.(o, { kind: "club", key: "mem-join-" + mKey(m.email).slice(0, 16), text: `${first(m.name) || "Someone"} became a member: ${T?.name || "a tier"}.`, link: `/@${h.handle}#membership`, eventId: "" }); } catch {}
    try { X?.notify?.(m.email, { kind: "club", key: "mem-welcome-" + h24(ws + m.email).slice(0, 12), text: `You're a member of ${h.name || "this host"}'s ${T?.name || "membership"}. Thank you.`, link: `/@${h.handle}#membership`, eventId: "" }); } catch {}
  }
  function applySub(ws, sub, evt, { deleted = false } = {}) {
    const md = sub?.metadata || {}, S = S0(ws), key = /^[a-f0-9]{24}$/.test(md.pl_member || "") ? md.pl_member : S.get("stripesubs/" + String(sub?.id || "").replace(/[^A-Za-z0-9_]/g, ""))?.data?.key;
    if (!key || !sub?.id) return { ignored: "unknown_subscription" };
    const p = mPath(key), cur = S.get(p)?.data || { email: lc(md.pl_email), history: [] }; if (!cur.email) return { ignored: "no_member" };
    if (cur.subscription === sub.id && (cur.lastEventAt || 0) > (evt.created || 0)) return { stale: true };
    if (cur.subscription && cur.subscription !== sub.id && live(cur) && !deleted && !ACTIVE.has(String(sub.status))) return { ignored: "older_subscription" };
    if (deleted && cur.subscription && cur.subscription !== sub.id) return { ignored: "older_subscription" };
    const item = sub.items?.data?.[0] || {}, price = item.price || {}, map = price.id ? store.get("system/stripe-price-" + price.id)?.data : null;
    const tier = (map?.ws === ws && map.tier) || md.pl_tier || cur.tier || "", interval = price.recurring?.interval || map?.interval || cur.interval || "month";
    const periodEnd = (Number(sub.current_period_end || item.current_period_end) || 0) * 1000, status = deleted ? "canceled" : String(sub.status || "incomplete"), was = live(cur);
    const next = { ...cur, subscription: sub.id, customer: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || cur.customer || "", status, tier, interval,
      amount: Number.isFinite(+price.unit_amount) ? +price.unit_amount : cur.amount || 0, monthly: tierOf(ws, tier)?.monthly || cur.monthly || 0, periodEnd, cancelAtPeriodEnd: !!sub.cancel_at_period_end, lastEventAt: evt.created || 0, pending: null };
    if (deleted) { next.endedAt = (Number(sub.ended_at || sub.canceled_at || evt.created) || Math.floor(clock() / 1000)) * 1000; next.graceUntil = sub.cancellation_details?.reason === "cancellation_requested" && periodEnd > next.endedAt ? periodEnd : 0; }
    else { next.endedAt = 0; next.graceUntil = 0; }
    if (ACTIVE.has(status)) { if (!cur.since || (!was && cur.endedAt)) next.since = cur.since && !cur.endedAt ? cur.since : clock(); next.firstSince = cur.firstSince || clock(); }
    next.history = [...(cur.history || []), { at: clock(), s: status, tier, c: next.cancelAtPeriodEnd ? 1 : 0 }].slice(-40);
    S.set(p, next); S.set("stripesubs/" + sub.id, { key });
    if (live(next) && !was) onBecameMember(ws, next);
    return { status };
  }
  async function handleEvent(evt) {
    const id = String(evt?.id || ""); if (!/^evt_[A-Za-z0-9]{4,}$/.test(id)) return { ignored: "no_id" };
    const obj = evt.data?.object || {}, acct = String(evt.account || (evt.type === "account.updated" ? obj.id : "") || ""), ws = accountWs(acct);
    if (!ws || !getWorkspace(ws) || config(ws).account !== acct) return { ignored: "unknown_account" };
    const S = S0(ws), seen = "stripeevents/" + id; if (S.get(seen)) return { duplicate: true };
    let r = { ignored: evt.type };
    switch (evt.type) {
      case "account.updated": { const was = config(ws).chargesEnabled; const c = setRaw(ws, { chargesEnabled: !!obj.charges_enabled, detailsSubmitted: !!obj.details_submitted }); if (c.chargesEnabled && !was && c.tiers.length) syncPrices(ws).catch((e) => console.warn("[memberships] sync", e?.message)); r = { account: true }; break; }
      case "checkout.session.completed": { if (obj.mode !== "subscription") break; const key = /^[a-f0-9]{24}$/.test(obj.client_reference_id || "") ? obj.client_reference_id : obj.metadata?.pl_member; const p = key && mPath(key), cur = p && S.get(p)?.data; if (!cur) { r = { ignored: "no_member" }; break; }
        const sub = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id || "", cus = typeof obj.customer === "string" ? obj.customer : obj.customer?.id || "";
        S.set(p, { ...cur, customer: cus || cur.customer || "", ...(sub && !live(cur) ? { subscription: sub } : {}), status: live(cur) ? cur.status : cur.status || "incomplete", tier: cur.tier || obj.metadata?.pl_tier || "", checkoutAt: clock() }); if (sub) S.set("stripesubs/" + sub, { key }); r = { checkout: true }; break; }
      case "customer.subscription.created": case "customer.subscription.updated": r = applySub(ws, obj, evt); break;
      case "customer.subscription.deleted": r = applySub(ws, obj, evt, { deleted: true }); break;
      case "invoice.payment_failed": case "invoice.paid": { const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id || obj.parent?.subscription_details?.subscription || "";
        const key = subId ? S.get("stripesubs/" + subId.replace(/[^A-Za-z0-9_]/g, ""))?.data?.key : ""; const p = key && mPath(key), cur = p && S.get(p)?.data; if (!cur) { r = { ignored: "no_member" }; break; }
        if (evt.type === "invoice.paid") { S.set(p, { ...cur, paymentFailedAt: 0, lastPaidAt: clock(), paid: [...(cur.paid || []), { at: clock(), amount: +obj.amount_paid || 0 }].slice(-24) }); r = { paid: true }; break; }
        S.set(p, { ...cur, paymentFailedAt: clock() }); const h = C.profileOf(ws) || {};
        try { X?.notify?.(cur.email, { kind: "club", key: "mem-payfail-" + String(obj.id || id).slice(-20), text: `Your payment for ${h.name || "your"} membership didn't go through. Update your card from Manage on ${hostFirst(ws)}'s page to keep your perks.`, link: `/@${h.handle}#membership`, eventId: "" }); } catch {}
        r = { paymentFailed: true }; break; }
      default: break;
    }
    S.set(seen, { type: evt.type, at: clock() });
    return r;
  }

  // ---- jobs: tell tiers as windows open, move the waitlist up when an event opens to everyone, stop charges for removed or blocked members ----
  async function runJobs(t = clock(), { origin = "" } = {}) {
    let told = 0, released = 0, cancelled = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; let c; try { c = config(ws); } catch { continue; }
      if (c.on) for (const d of S0(ws).list("memberevents")) { const v = d.data || {}; if (!v.on) continue; const W = windowOf(ws, d.id, t); if (!W) continue;
        try { told += await tellWindows({}, ws, d.id, t); } catch (e) { console.warn("[memberships] tell", e?.message); }
        if (W.open && !W.only && !v.releasedAt) { S0(ws).update(EV(d.id), { releasedAt: t }); released++; // held seats roll over by themselves (server/seats.js releaseAt); people waiting move up now
          try { await locals.promoteWaitlist?.(fakeReq(origin), ws, d.id); } catch (e) { console.warn("[memberships] waitlist", e?.message); } } }
      for (const m of membersOf(ws)) { if (!m.subscription || !ACTIVE.has(m.status) || m.cancelAtPeriodEnd) continue;
        let why = ""; try { if (F?.blocked?.(ws, m.email)) why = "blocked"; else if (F?.memberDoc?.(ws, m.email)?.removedAt) why = "removed"; } catch {} if (!why && c.closingAt) why = "closing"; if (!why && m.removedAt) why = "removed"; if (!why) continue;
        try { if (why === "closing") { if (await cancelAtEnd(ws, m.key, why)) cancelled++; } else { await removeMember(ws, m.key, why); cancelled++; } } catch (e) { console.warn("[memberships] cancel", e?.message); } }
      if (c.on && c.closingAt && !liveOf(ws).length) setRaw(ws, { on: false, accepting: false });
      try { for (const d of S0(ws).list("stripeevents")) if ((d.data?.at || 0) < t - 45 * DAY) S0(ws).delete("stripeevents/" + d.id); } catch {} }
    return { told, released, cancelled };
  }
  const fakeReq = (origin) => { let u; try { u = new URL(origin || env().ENCORE_PUBLIC_URL || "http://localhost"); } catch { u = new URL("http://localhost"); } const H = { host: u.host }; return { headers: H, get: (k) => H[String(k).toLowerCase()] || "", protocol: u.protocol.replace(":", ""), secure: u.protocol === "https:", ip: "server", query: {}, body: {} }; };

  // ---- what people read ----
  const statusLine = (m, t = clock()) => { const d = (x) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (m.removedAt) return "Removed"; if (m.status === "past_due") return "Payment failed"; if (m.status === "canceled") return m.graceUntil > t ? `Ends ${d(m.graceUntil)}` : `Ended ${d(m.endedAt || t)}`;
    if (m.cancelAtPeriodEnd && m.periodEnd) return `Ends ${d(m.periodEnd)}`; if (ACTIVE.has(m.status)) return m.periodEnd ? `Renews ${d(m.periodEnd)}` : "Active"; return m.pending ? "Signing up" : "Not active"; };
  function stats(ws, t = clock()) { const A = membersOf(ws), L = A.filter((m) => live(m, t) && !m.removedAt);
    const mrr = L.filter((m) => !m.cancelAtPeriodEnd && ACTIVE.has(m.status)).reduce((s, m) => s + (m.interval === "year" ? (m.amount || 0) / 12 : m.amount || 0), 0) / 100;
    const ended30 = A.filter((m) => m.endedAt && m.endedAt > t - 30 * DAY).length, joined30 = L.filter((m) => (m.since || 0) > t - 30 * DAY).length, base = L.length + ended30 - joined30;
    return { members: L.length, mrr: Math.round(mrr * 100) / 100, cancelling: L.filter((m) => m.cancelAtPeriodEnd).length, pastDue: L.filter((m) => m.status === "past_due").length, joined30, ended30, churn30: base > 0 ? Math.round((ended30 / base) * 1000) / 10 : 0,
      byTier: config(ws).tiers.map((T) => ({ tier: T.id, name: T.name, n: L.filter((m) => m.tier === T.id).length })) }; }
  function hostView(ws, { admin = false, origin = "" } = {}) {
    const c = config(ws), s = cfgS(), E = eligibility(ws), t = clock(), td = today();
    const events = c.on ? S0(ws).list("events").map((d) => ({ id: d.id, e: d.data || {} })).filter(({ e }) => !e.example && !e.sample && !e.cancelled && (e.date || "9999") >= td && (e.name || e.pubTitle))
      .sort((a, b) => String(a.e.date || "9").localeCompare(String(b.e.date || "9"))).slice(0, 20).map(({ id }) => eventView(ws, id)) : [];
    const members = membersOf(ws).filter((m) => m.status && m.status !== "incomplete" && m.status !== "incomplete_expired").map((m) => ({ key: m.key, name: first(m.name) || "Member", tier: tierOf(ws, m.tier)?.name || "Old tier", tierId: m.tier, interval: m.interval, since: m.since || 0, status: statusLine(m, t), live: live(m, t), amount: (m.amount || 0) / 100 }))
      .sort((a, b) => Number(b.live) - Number(a.live) || b.since - a.since);
    return { eligibility: E, payments: { on: s.on, test: s.test, feeBps: s.feeBps, ...(admin ? { checklist: checklist(origin) } : {}) }, admin,
      membership: { on: c.on, accepting: c.accepting, closing: !!c.closingAt, tiers: c.tiers, seatsN: c.seatsN, freeEarly: c.freeEarly, startedAt: c.startedAt, lastNoteAt: c.lastNoteAt },
      account: { connected: !!c.account, chargesEnabled: c.chargesEnabled, detailsSubmitted: c.detailsSubmitted, ready: !!c.account && c.chargesEnabled && Object.keys(c.prices || {}).length > 0 },
      options: { amounts: AMOUNTS, earlyHours: EARLY_HOURS, yearly: { min: YEARLY_MIN, max: YEARLY_MAX, x: YEARLY_X }, defaults: DEFAULT_TIERS, noteMax: NOTE_MAX, seatsMax: SEATS_MAX },
      stats: stats(ws, t), members, events, notes: notesOf(ws).slice(0, 5), club: { on: !!F?.config?.(ws)?.on } };
  }
  function checklist(origin = "") { const s = cfgS(), e = env(), o = e.ENCORE_PUBLIC_URL || origin || "https://your-site";
    return [{ id: "key", ok: !s.missing.includes("STRIPE_SECRET_KEY"), text: `STRIPE_SECRET_KEY: your Stripe secret key${s.test ? " (test mode)" : ""}` },
      { id: "connect", ok: null, text: "Connect turned on in Stripe, with Express accounts" },
      { id: "webhook", ok: !s.missing.includes("STRIPE_WEBHOOK_SECRET"), text: `STRIPE_WEBHOOK_SECRET: from a webhook at ${o}/api/stripe/webhook that listens to connected accounts` },
      { id: "url", ok: !!e.ENCORE_PUBLIC_URL, text: "ENCORE_PUBLIC_URL: your site's https address, for Stripe's links back" },
      { id: "fee", ok: true, text: `ENCORE_MEMBERSHIP_FEE_BPS: your cut, now ${s.feeBps / 100}%` }]; }
  const notesOf = (ws) => S0(ws).list("membernotes").map((d) => ({ id: d.id, ...d.data })).filter((n) => !n.removedAt).sort((a, b) => b.at - a.at);
  /** The host page's membership card (server/fanclub.js enrich): tiers, and the viewer's own membership. No prices in the app. */
  function publicView(req, ws, u, origin = "") {
    const c = config(ws), s = cfgS(), h = C.profileOf(ws) || {}, own = !!u && u.ws === ws, native = isNativeReq(req), t = clock();
    const out = { payments: s.on, webOnly: native, joinUrl: `${origin || env().ENCORE_PUBLIC_URL || ""}/@${h.handle}#membership` };
    if (own) { const E = eligibility(ws); out.host = { eligible: E.eligible, count: E.count, need: E.need, on: c.on }; }
    if (!s.on || !c.on || !c.tiers.length) return { ...out, on: false };
    const hostN = hostFirst(ws), em = lc(u?.email), m = em ? memberOf(ws, em) : null, rank = rankOf(ws, em);
    const tiers = c.tiers.map((T) => ({ id: T.id, rank: T.rank, name: T.name, line: T.line, perks: perkLines(T, hostN), ...(native ? {} : { monthly: T.monthly, yearly: T.yearly, save: Math.max(0, Math.round(100 - (T.yearly / (T.monthly * 12)) * 100)) }) }));
    let me = null;
    if (rank && m) { const T = tierOf(ws, m.tier) || c.tiers.find((x) => x.rank === rank);
      const early = S0(ws).list("memberevents").filter((d) => d.data?.on).map((d) => ({ id: d.id, ev: S0(ws).get("events/" + d.id)?.data, W: windowOf(ws, d.id, t) })).filter((x) => x.ev && x.W && !x.ev.cancelled && (x.ev.date || "9999") >= today() && (!x.W.open || x.W.only))
        .sort((a, b) => a.W.publicAt - b.W.publicAt).slice(0, 5).map(({ id, ev, W }) => { const at = opensFor(W, rank, true); return { id, title: ev.pubTitle || ev.name || "", date: ev.date || "", only: W.only, canBook: W.only ? rank >= W.onlyRank : t >= at, opensAt: at, publicAt: W.publicAt, opens: fmtWhen(at, ev), public: fmtWhen(W.publicAt, ev) }; });
      me = { tier: T?.id || m.tier, name: T?.name || "Member", rank, interval: m.interval, status: m.status, pastDue: m.status === "past_due", periodEnd: m.graceUntil || m.periodEnd || 0, cancelling: !!m.cancelAtPeriodEnd || m.status === "canceled", since: m.since || 0, perks: T ? perkLines(T, hostN) : [], early,
        notes: notesOf(ws).filter((n) => rank >= (n.minRank || 1)).slice(0, 3).map((n) => ({ id: n.id, text: n.text, at: n.at })) }; }
    return { ...out, on: true, accepting: c.accepting && c.chargesEnabled, club: F?.config?.(ws)?.name || "", members: liveOf(ws).length, tiers, me, removed: !!m?.removedAt, signedIn: !!u, own };
  }
  /** "Patron" for a member's own badge, when their tier has the badge perk. */
  function badgeOf(ws, email) { const r = rankOf(ws, email); if (!r) return ""; const m = memberOf(ws, email), T = tierOf(ws, m?.tier); return T?.perks?.badge ? T.name : ""; }

  return { stripeConfig: cfgS, eligibility, realEvents, config, setRaw, tierOf, memberOf, mKey, live, rankOf, membersOf, liveOf, windowOf, opensFor, handles, holdsBack, gate, guestLine, setEvent, eventView, syncSeats, seatRoom,
    tellWindows, connect, refreshAccount, dashboardLink, syncPrices, checkout, portalLink, cancelAtEnd, removeMember, applySub, handleEvent, runJobs, stats, hostView, publicView, checklist, notesOf, badgeOf, accountWs };
}

export function mountMemberships(app, { store, small, currentUser, C, X, publicOrigin = () => "" }) {
  const F = app.locals.fanclub || null;
  const M = makeMemberships({ store, C, X, F, locals: app.locals });
  app.locals.memberships = M;
  const bad = (res, message, status = 400, code = "invalid", extra = {}) => res.status(status).json({ code, message, ...extra });
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; } catch { return null; } };
  const me = (req, res) => { const u = viewer(req); if (!u) bad(res, "Make a free account to do that.", 401, "unauthenticated"); return u; };
  const hostOf = (req, res) => { const u = me(req, res); if (!u) return null; const h = C.profileOf(u.ws); if (!h?.handle) { bad(res, "Set up your page first."); return null; } res.set("Cache-Control", "private, no-store"); return { u, ws: u.ws, h }; };
  const wsOf = (handle) => C.wsOfHandle(lc(handle).replace(/^@/, ""));
  const admins = () => String(process.env.ENCORE_ADMIN_EMAILS || "").split(/[,;\s]+/).map(lc).filter(Boolean);
  const isAdmin = (u) => !!u && admins().includes(lc(u.email));
  const origin = (req) => process.env.ENCORE_PUBLIC_URL || publicOrigin(req) || "";
  const fail = (res, e) => { if (e?.status && e.status < 500) return bad(res, e.message, e.status, e.code || "invalid"); console.warn("[memberships]", e?.message); return bad(res, e?.message || "That didn't work. Try again.", 502, e?.code || "stripe_error"); };
  const hits = new Map(); const over = (k, n, ms = 3600e3) => { const t = Date.now(); let h = hits.get(k); if (!h || t - h.start > ms) { h = { n: 0, start: t }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const demo = (ws) => process.env.ENCORE_ALLOW_DEMO_WRITES !== "1" && /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  const payOff = (res) => bad(res, "Memberships need payments set up. We'll let you know when they're on.", 409, "payments_off");

  // ---- hooks into server/fanclub.js ----
  if (F?.hooks) Object.assign(F.hooks, { handles: (ws, id) => M.handles(ws, id), onPublish: (req, ws, id) => onPublish(req, ws, id), hostPage: (req, ws, u) => M.publicView(req, ws, u, origin(req)), badgeOf: (ws, em) => M.badgeOf(ws, em),
    onRemove: (ws, em) => { const k = M.mKey(em); if (M.memberOf(ws, em)) M.removeMember(ws, k, "removed").catch(() => {}); } });
  /** A newly published event: the tiers' windows start now (the top tier first), held seats are set, members hear. */
  function onPublish(req, ws, id) { try { const c = M.config(ws); if (!c.on || !c.tiers.length || demo(ws)) return false; const cur = M.windowOf(ws, id); if (cur) return true;
      const ev = F?.S0?.(ws)?.get("events/" + id)?.data; if (!ev || ev.example || ev.sample) return false; if (scopeStore(store, ws).get("memberevents/" + id)?.data?.on === false) return false; // the host turned the window off for this one
      if (!c.tiers.some((T) => T.perks.early && T.perks.earlyHours) && !c.tiers.some((T) => T.perks.seats)) return false;
      const r = M.setEvent(ws, id, {}); if (r.error) return false; M.tellWindows(req, ws, id).catch((e) => console.warn("[memberships] tell", e?.message)); return true; } catch (e) { console.warn("[memberships] publish", e?.message); return false; } }

  // ---- the webhook: raw body, signature first, each event once ----
  app.post("/api/stripe/webhook", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
    const s = stripeConfig(); if (!s.on) return bad(res, "No such endpoint.", 404, "not_found");
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(""), v = verifyStripe(body, req.get("stripe-signature"), s.whsec);
    if (!v.ok) return bad(res, "Signature check failed.", 400, "bad_signature");
    let evt; try { evt = JSON.parse(body.toString("utf8")); } catch { return bad(res, "Not JSON.", 400, "invalid"); }
    try { res.json({ received: true, ...(await M.handleEvent(evt)) }); } catch (e) { console.warn("[memberships] webhook", e?.message); bad(res, "Try again.", 500, "error"); } });

  // ---- the host ----
  app.get("/api/host/membership", async (req, res) => {
    if (req.query.lite === "1") { const u = viewer(req), h = u && C.profileOf(u.ws); if (!h?.handle) return res.set("Cache-Control", "private, no-store").json({ handle: "" }); } // Home asks for every signed-in person: no page yet is not an error
    const H = hostOf(req, res); if (!H) return;
    if (req.query.refresh === "1" && M.config(H.ws).account) { try { await M.refreshAccount(H.ws); const c = M.config(H.ws); if (c.chargesEnabled && c.tiers.length && !Object.keys(c.prices).length) await M.syncPrices(H.ws, origin(req)); } catch (e) { console.warn("[memberships] refresh", e?.message); } }
    const v = M.hostView(H.ws, { admin: isAdmin(H.u), origin: origin(req) });
    if (req.query.lite === "1") return res.json({ eligibility: v.eligibility, payments: { on: v.payments.on }, membership: { on: v.membership.on }, stats: { members: v.stats.members }, handle: H.h.handle, admin: v.admin, ...(v.admin ? { checklist: v.payments.checklist } : {}) });
    res.json({ ...v, handle: H.h.handle }); });
  app.post("/api/host/membership", small, async (req, res) => { const H = hostOf(req, res); if (!H) return; const { ws } = H, b = req.body || {};
    if (!stripeConfig().on) return payOff(res);
    if (demo(ws)) return bad(res, "This is an example host, so it can't take members.", 403, "example");
    const E = M.eligibility(ws); if (!E.eligible) return bad(res, `${E.need} more ${E.need === 1 ? "event" : "events"} and you can start a membership.`, 403, "not_eligible", { need: E.need });
    const c = M.config(ws), patch = {};
    if (b.tiers != null) { const T = cleanTiers(b.tiers); if (T.error) return bad(res, T.error); patch.tiers = T.tiers; }
    if (b.seatsN != null) patch.seatsN = Math.max(0, Math.min(SEATS_MAX, Math.floor(+b.seatsN || 0)));
    if (typeof b.freeEarly === "boolean") patch.freeEarly = b.freeEarly;
    if (b.open === true) { const tiers = patch.tiers || c.tiers; if (!tiers.length) return bad(res, "Pick at least one tier.");
      if (!c.account || !c.chargesEnabled) return bad(res, "Connect Stripe first, so the money goes to you.", 409, "no_account");
      Object.assign(patch, { on: true, accepting: true, closingAt: 0, startedAt: c.startedAt || Date.now() }); }
    if (b.open === false && c.on) Object.assign(patch, { accepting: false, closingAt: Date.now() });
    M.setRaw(ws, patch);
    if (patch.on) { try { const fc = F?.config?.(ws); if (fc && !fc.on) F.setConfig(ws, { on: true }); } catch {} }
    const now = M.config(ws);
    if (now.account && now.chargesEnabled && (patch.tiers || patch.on)) { try { await M.syncPrices(ws, origin(req)); } catch (e) { return fail(res, e); } }
    if (patch.closingAt) M.runJobs().catch(() => {});
    res.json({ ok: true, ...M.hostView(ws, { admin: isAdmin(H.u), origin: origin(req) }) }); });
  app.post("/api/host/membership/connect", small, async (req, res) => { const H = hostOf(req, res); if (!H) return; if (!stripeConfig().on) return payOff(res);
    if (demo(H.ws)) return bad(res, "This is an example host, so it can't take members.", 403, "example");
    if (!M.eligibility(H.ws).eligible) return bad(res, "Host a few more events first.", 403, "not_eligible");
    if (isNativeReq(req)) return bad(res, "Set up payments on the web, at pottery lab in your browser.", 403, "web_only");
    if (over("conn|" + H.ws, 20)) return bad(res, "That's a lot of tries. Try again later.", 429, "rate_limited");
    try { res.json({ ok: true, ...(await M.connect(H.ws, { origin: origin(req), email: H.u.email })) }); } catch (e) { fail(res, e); } });
  app.post("/api/host/membership/dashboard", small, async (req, res) => { const H = hostOf(req, res); if (!H) return; if (!stripeConfig().on) return payOff(res);
    try { res.json({ ok: true, ...(await M.dashboardLink(H.ws)) }); } catch (e) { fail(res, e); } });
  app.post("/api/host/membership/events/:id", small, (req, res) => { const H = hostOf(req, res); if (!H) return; const id = String(req.params.id || ""); if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found");
    const b = req.body || {}, r = M.setEvent(H.ws, id, { on: b.on, publicAt: b.publicAt, seats: b.seats, only: b.only }); if (r.error) return bad(res, r.error, r.status || 400, r.code || "invalid");
    const ev = F?.S0?.(H.ws)?.get("events/" + id)?.data; if (ev && (ev.published || ev.discoverable) && r.event.on) M.tellWindows(req, H.ws, id).catch(() => {});
    res.json({ ok: true, ...r }); });
  app.post("/api/host/membership/members/:key/remove", small, async (req, res) => { const H = hostOf(req, res); if (!H) return; const k = String(req.params.key || ""); if (!/^[a-f0-9]{24}$/.test(k)) return bad(res, "No such member.", 404, "not_found");
    if (!(await M.removeMember(H.ws, k, "removed"))) return bad(res, "No such member.", 404, "not_found"); res.json({ ok: true, stats: M.stats(H.ws) }); });
  app.post("/api/host/membership/note", small, async (req, res) => { const H = hostOf(req, res); if (!H) return; const { ws, h } = H, c = M.config(ws); if (!c.on) return bad(res, "Start your membership first.", 409, "membership_off");
    const text = clean(req.body?.text, NOTE_MAX); if (!text) return bad(res, "Write a line first."); const p = textProblem(text); if (p) return bad(res, p.message, 400, p.code || "invalid");
    const minRank = [1, 2, 3].includes(+req.body?.minRank) ? +req.body.minRank : 1;
    if (over("mnote|" + ws, NOTES_PER_DAY, DAY)) return bad(res, "That's a lot of notes for one day. Try again tomorrow.", 429, "rate_limited");
    const r = F.S0(ws).add("membernotes", { text, minRank, at: Date.now() }); M.setRaw(ws, { lastNoteAt: Date.now() });
    const club = (() => { try { return F.membersOf(ws); } catch { return []; } })(); let sent = 0;
    for (const m of club) { if (m.muted || M.rankOf(ws, m.email) < minRank) continue; if (await F.tellOne(req, ws, m.email, { club: true, key: `mnote-${r.id}`, link: `/@${h.handle}#membership`, subject: `${h.name}: a note for members`, text: `${h.name}: ${text.replace(/\s+/g, " ").slice(0, 90)}`, body: `${h.name} wrote to members:\n\n${text}` })) sent++; }
    res.json({ ok: true, sent, note: { id: r.id, text, minRank, at: Date.now() } }); });

  // ---- members ----
  app.get("/api/public/membership/:handle", (req, res) => { const ws = wsOf(req.params.handle); if (!ws || !C.profileOf(ws)) return bad(res, "No host by that name.", 404, "not_found"); res.set("Cache-Control", "private, no-store"); res.json(M.publicView(req, ws, viewer(req), origin(req))); });
  app.post("/api/me/membership/:handle/checkout", small, async (req, res) => {
    if (isNativeReq(req)) return bad(res, "You can join on the web. Open the host's page in your browser.", 403, "web_only");
    const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    if (!stripeConfig().on) return bad(res, "Memberships aren't on yet.", 409, "payments_off"); if (demo(ws)) return bad(res, "This is an example host, so there's nothing to join.", 403, "example");
    if (over("co|" + lc(u.email), 20) || over("coip|" + (req.ip || "?"), 60)) return bad(res, "That's a lot of tries. Try again in a bit.", 429, "rate_limited");
    try { res.json({ ok: true, ...(await M.checkout(ws, u, { tier: req.body?.tier, interval: req.body?.interval, origin: origin(req) })) }); } catch (e) { fail(res, e); } });
  app.post("/api/me/membership/:handle/portal", small, async (req, res) => { const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    if (isNativeReq(req)) return bad(res, "Manage your membership on the web, from the host's page in your browser.", 403, "web_only");
    try { res.json({ ok: true, ...(await M.portalLink(ws, u, { origin: origin(req) })) }); } catch (e) { fail(res, e); } });

  // ---- the owner's checklist ----
  app.get("/api/admin/memberships", (req, res) => { const u = viewer(req); if (!isAdmin(u)) return bad(res, "No such endpoint.", 404, "not_found"); res.set("Cache-Control", "private, no-store");
    const s = stripeConfig(); res.json({ on: s.on, test: s.test, feeBps: s.feeBps, checklist: M.checklist(origin(req)), webhook: `${origin(req)}/api/stripe/webhook` }); });

  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => M.runJobs(Date.now()).catch((e) => console.warn("[memberships] jobs", e?.message)), 5 * 60e3); t.unref?.(); }
  return M;
}
