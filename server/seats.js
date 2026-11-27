// Seats by audience: an optional split of an event's spots into blocks ("24 = 8 Fan club, 6 Regulars, 4 VIP list,
// 6 New guests"), each with its own count and open time. Unfilled blocks roll over to everyone at a time the host sets
// (on by default). Casual hosts never see this: it lives under More in the Invite tab.
//
//   seatplans/<eventId> { on, blocks: [{ id, kind, label, n, opensAt, releaseAt, tier?, list? }], rollover, preset }
//
// kinds: tier (a paid supporter tier, web only), club (fan club members, free), vip (tagged VIP), list (a saved smart
// list), regulars (came 2+ times), new (never came), everyone (everyone else). A reply takes the most exclusive block
// the guest qualifies for that is open and has room; nobody ever sees which block anyone else is in. The check runs on
// the server inside the reply (server/app.js rsvpPolicy), and a short hold counts replies still in flight so two people
// can't both take the last seat of a block. The rsvp keeps `seatBlock`.
//
// The guest side is plain: a member reads "Members can reply first. 2 member spots left.", everyone else "Opens to
// everyone Wed 9am" with Remind me, or the waitlist when their block is full. In the app (isNativeReq) paid tiers are
// never named: a supporter block reads as early access, and the host can't add one there.
import crypto from "node:crypto";
import { scopeStore, workspaceOfEvent, DEFAULT_WS, allWorkspaceIds, getDbUser } from "./workspaces.js";
import { seatsOf } from "./social.js";
import { eventTz } from "./tz.js";
import { isNativeReq } from "./fanclub.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { lc, h24, keyFor, idOf, matchAll, TIER_LABEL } from "./people.js";
import { startMs } from "./invites.js";

const HOUR = 3600e3, DAY = 864e5;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const clean = (v, n = 60) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
export const KINDS = ["tier", "club", "vip", "list", "regulars", "new", "everyone"];
const RANK = { tier: 0, club: 1, vip: 2, list: 2, regulars: 3, new: 4, everyone: 9 };
export const KIND_LABEL = { club: "Fan club", vip: "VIP list", list: "A list", regulars: "Regulars", new: "New guests", everyone: "Everyone else", tier: "Supporters" };
export const HOLD_MS = 20e3;

/** "Wed 9am" in the event's own time zone. */
export function fmtOpen(ms, ev) { if (!ms) return ""; const tz = eventTz(ev);
  try { return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) }).format(new Date(ms)).replace(":00", "").replace(/\s?([AP])M/, (m, x) => x.toLowerCase() + "m"); } catch { return new Date(ms).toUTCString().slice(0, 16); } }

export function cleanBlocks(B) {
  return (Array.isArray(B) ? B : []).slice(0, 8).map((b, i) => { const kind = KINDS.includes(b?.kind) ? b.kind : "everyone";
    return { id: ID.test(String(b?.id || "")) ? String(b.id).slice(0, 20) : "b" + (i + 1), kind, label: clean(b?.label) || (kind === "tier" ? TIER_LABEL[b?.tier] || "Supporters" : KIND_LABEL[kind]), n: Math.max(0, Math.min(10000, Math.floor(+b?.n || 0))),
      opensAt: Math.max(0, Math.floor(+b?.opensAt || 0)), releaseAt: kind === "everyone" ? 0 : Math.max(0, Math.floor(+b?.releaseAt || 0)), ...(kind === "tier" ? { tier: ["monthly", "yearly", "founding"].includes(b?.tier) ? b.tier : "founding" } : {}), ...(kind === "list" && ID.test(String(b?.list || "")) ? { list: String(b.list) } : {}) }; })
    .filter((b) => b.n > 0 || b.kind === "everyone");
}

/** The four quick setups. t0: now. Opens and roll-overs land before the event. */
export function preset(name, { cap, t0, ev, club = false, tiers = [] }) {
  const n = Math.max(0, Math.floor(+cap || 0)); if (!n) return [];
  const start = startMs(ev), last = start ? start - 24 * HOUR : 0, gap = last && t0 + 48 * HOUR > last ? Math.max(HOUR, Math.floor((last - t0) / 2)) : 48 * HOUR;
  const hr = (t) => Math.ceil(t / HOUR) * HOUR, later = hr(t0 + gap), rel = Math.max(t0, later - 3 * HOUR); const top = club ? "club" : "regulars";
  const part = (fr) => Math.max(1, Math.round(n * fr));
  if (name === "even") { const k = club ? 3 : 2, a = Math.floor(n / k), r = n - a * k; const B = club ? [{ kind: "club", n: a }, { kind: "regulars", n: a }] : [{ kind: "regulars", n: a }]; return cleanBlocks([...B.map((b) => ({ ...b, opensAt: t0, releaseAt: rel })), { kind: "everyone", n: a + r, opensAt: later }]); }
  if (name === "regulars") { const a = part(0.5); return cleanBlocks([{ kind: "regulars", n: a, opensAt: t0, releaseAt: rel }, { kind: "everyone", n: n - a, opensAt: later }]); }
  if (name === "members") { const tierN = tiers.length ? Math.max(1, Math.round(n * 0.15)) : 0, a = part(0.5) - tierN; const B = [...(tierN ? [{ kind: "tier", tier: tiers[tiers.length - 1], n: tierN, opensAt: t0, releaseAt: rel }] : []), { kind: top, n: Math.max(1, a), opensAt: tierN ? hr(t0 + Math.min(gap / 2, 24 * HOUR)) : t0, releaseAt: rel }];
    return cleanBlocks([...B, { kind: "everyone", n: Math.max(0, n - B.reduce((s, b) => s + b.n, 0)), opensAt: later }]); }
  if (name === "fresh") { const a = part(0.5); return cleanBlocks([{ kind: "new", n: a, opensAt: t0, releaseAt: Math.max(t0, hr((last || later) - 24 * HOUR)) }, { kind: "everyone", n: n - a, opensAt: t0 }]); }
  return [];
}
export const PRESETS = [["even", "Even split", "Fan club, regulars and everyone get the same share."], ["regulars", "Regulars first", "Half for people who came twice, the rest opens 2 days later."], ["members", "Members first", "Half for your fan club, opening first."], ["fresh", "Fresh faces", "Half saved for people who've never come."]];

export function makeSeats({ store, P, F = null, now: clock = () => Date.now() }) {
  const S0 = (ws) => scopeStore(store, ws);
  const cfgOf = (ws, id) => { const d = ID.test(String(id || "")) ? S0(ws).get("seatplans/" + id)?.data : null; return d ? { on: !!d.on, blocks: cleanBlocks(d.blocks), rollover: d.rollover !== false, preset: d.preset || "" } : { on: false, blocks: [], rollover: true, preset: "" }; };
  function setCfg(ws, id, b = {}, { native = false } = {}) { const cur = cfgOf(ws, id); let blocks = b.blocks != null ? cleanBlocks(b.blocks) : cur.blocks;
    if (native) { const old = cur.blocks.filter((x) => x.kind === "tier"); blocks = [...old, ...blocks.filter((x) => x.kind !== "tier")]; } // the app never adds or edits a paid block
    const ids = new Set(); blocks = blocks.map((x, i) => { let k = x.id; while (ids.has(k)) k = x.id + i; ids.add(k); return { ...x, id: k }; });
    const next = { on: b.on != null ? !!b.on : cur.on || blocks.length > 0, blocks, rollover: b.rollover != null ? !!b.rollover : cur.rollover, preset: clean(b.preset, 20) || cur.preset, updatedAt: clock() };
    S0(ws).set("seatplans/" + id, next);
    // seat blocks take over from the fan club's members-first window: the club block's open time is the early access
    if (next.on) { try { const v = S0(ws).get("clubevents/" + id)?.data; if (v && !v.only && v.earlyUntil) S0(ws).set("clubevents/" + id, { ...v, earlyUntil: 0, bySeats: true }); } catch {} }
    return cfgOf(ws, id); }

  // ---- who qualifies ----
  const tierOf = (ws, email) => { const k = crypto.createHash("sha256").update(lc(email)).digest("hex").slice(0, 24); const t = S0(ws).get("pledges/" + k)?.data?.tier; return t && t !== "none" ? t : ""; };
  function eligible(ws, b, email, person) { const em = lc(email);
    switch (b.kind) {
      case "everyone": return true;
      case "new": return !person || !person.attended;
      case "regulars": return !!person && person.attended >= 2;
      case "club": return !!em && !!F?.isMember?.(ws, em);
      case "tier": return !!em && tierOf(ws, em) === b.tier;
      case "vip": return !!person && (person.tags || []).some((t) => lc(t) === "vip");
      case "list": { const ch = b.list && P.listChips(ws, b.list); return !!person && !!ch && matchAll(person, ch); }
      default: return false; } }

  // ---- counts ----
  const holds = new Map(); // eventId -> Map(key -> { block, n, at })
  const holdsOf = (id) => { const H = holds.get(id) || new Map(), t = clock(); for (const [k, v] of H) if (t - v.at > HOLD_MS) H.delete(k); holds.set(id, H); if (holds.size > 5000) holds.clear(); return H; };
  /** Each block's room right now, with roll-overs applied. R: the event's rsvps (data objects or docs). */
  function state(ws, id, ev, R, { skipKey = "" } = {}) {
    const c = cfgOf(ws, id), t = clock(); if (!c.on || !c.blocks.length) return null;
    const rs = R.map((x) => (x && x.data && x.data.eventId ? { id: x.id, ...x.data } : x)).filter((r) => r && r.eventId === id && r.response === "going");
    const B = c.blocks.map((b) => ({ ...b, taken: 0, cap: b.n })); let open = B.find((b) => b.kind === "everyone");
    if (!open) { const rest = Math.max(0, (+ev.headcount || 0) - B.reduce((s, b) => s + b.n, 0)); open = { id: "_open", kind: "everyone", label: "Everyone else", n: rest, cap: rest, taken: 0, opensAt: Math.max(0, ...B.map((b) => b.opensAt)), releaseAt: 0, implicit: true }; B.push(open); }
    const byId = new Map(B.map((b) => [b.id, b])), done = new Set();
    for (const r of rs) { const k = keyFor(r.email, r.phone); if (k && k === skipKey) continue; if (k) done.add(k); (byId.get(r.seatBlock) || open).taken += seatsOf(r, ev); }
    for (const [k, h] of holdsOf(id)) { if (k === skipKey || done.has(k)) continue; (byId.get(h.block) || open).taken += h.n; }
    let extra = 0; for (const b of B) { if (b === open || !c.rollover || !b.releaseAt || t < b.releaseAt) continue; b.released = true; extra += Math.max(0, b.n - b.taken); b.cap = Math.min(b.n, b.taken); }
    open.cap += extra; open.rolled = extra;
    for (const b of B) { b.left = Math.max(0, b.cap - b.taken); b.open = !b.opensAt || b.opensAt <= t; }
    return { cfg: c, blocks: B, open };
  }
  /** A guest's I'm in: the block they get, a refusal (not open yet), or the waitlist. */
  function gate(ws, id, ev, R, out, prior, emails = []) {
    const st0 = cfgOf(ws, id); if (!st0.on) return null;
    const pr = prior?.data || {}; if (pr.response === "going" && pr.seatBlock) return { block: pr.seatBlock };
    const em = emails.map(lc).find((e) => EMAIL_RE.test(e)) || "", key = keyFor(em || out.email, out.phone) || "anon:" + h24(JSON.stringify([out.name, out.phone]));
    const st = state(ws, id, ev, R, { skipKey: key }); if (!st) return null;
    const person = em ? P.byKey(ws, em) : null, mine = seatsOf({ ...out, response: "going" }, ev);
    // someone the host invited personally (server/invites.js) never waits for the public open time
    let invited = false; try { invited = !!S0(ws).get("invplans/" + id)?.data?.people?.[idOf(key)]?.invitedAt; } catch {}
    if (invited) for (const b of st.blocks) if (b.kind === "everyone") b.open = true;
    const E = st.blocks.filter((b) => eligible(ws, b, em, person)).sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    const pick = E.find((b) => b.open && b.left >= mine);
    if (pick) { holdsOf(id).set(key, { block: pick.id, n: mine, at: clock() }); return { block: pick.id === "_open" ? "" : pick.id }; }
    const later = E.filter((b) => !b.open && b.left >= mine).sort((a, b) => a.opensAt - b.opensAt)[0];
    if (later) return { error: `${later.kind === "everyone" ? "Opens to everyone" : "Opens"} ${fmtOpen(later.opensAt, ev)}. Tap Remind me and we'll tell you.`, status: 403, code: "seats_not_open", opensAt: later.opensAt };
    return { waitlist: true };
  }
  const release = (id, email) => { const k = lc(email); if (k) holdsOf(id).delete(k); };

  /** "Fan club 6/8 · Regulars 6/6 · New 3/6" for the host. */
  function summary(ws, id, ev, R) { const s = state(ws, id, ev, R || S0(ws).list("rsvps")); if (!s) return { on: false, ...cfgOf(ws, id) };
    const B = s.blocks.filter((b) => !(b.implicit && !b.n && !b.rolled));
    return { on: true, rollover: s.cfg.rollover, preset: s.cfg.preset, blocks: B.map((b) => ({ id: b.id, kind: b.kind, label: b.label, tier: b.tier || "", list: b.list || "", n: b.n, cap: b.cap, taken: b.taken, left: b.left, open: b.open, opensAt: b.opensAt, releaseAt: b.releaseAt, released: !!b.released, rolled: b.rolled || 0, implicit: !!b.implicit, opens: fmtOpen(b.opensAt, ev), releases: fmtOpen(b.releaseAt, ev) })),
      line: B.map((b) => `${b.label} ${b.taken}/${b.cap}`).join(" · "), total: B.reduce((x, b) => x + b.cap, 0) }; }

  /** What one guest reads on the invite. Never another person's block, never a paid tier in the app. */
  function guestLine(ws, id, ev, email, { native = false } = {}) {
    const s = state(ws, id, ev, S0(ws).list("rsvps")); if (!s) return { on: false };
    const em = lc(email), person = em ? P.byKey(ws, em) : null;
    const E = s.blocks.filter((b) => b.kind !== "everyone" && eligible(ws, b, em, person)).sort((a, b) => RANK[a.kind] - RANK[b.kind]), open = s.open;
    const word = (b) => (b.kind === "tier" ? (native ? "early" : "supporter") : b.kind === "club" ? "member" : b.kind === "regulars" ? "regular" : b.kind === "new" ? "first-timer" : "early");
    const who = (b) => (b.kind === "tier" ? (native ? "You" : "Supporters") : b.kind === "club" ? "Members" : b.kind === "regulars" ? "Regulars" : b.kind === "new" ? "First-timers" : "You");
    const mineB = E.find((b) => b.open && b.left > 0) || E.find((b) => !b.open && b.left > 0);
    if (mineB && mineB.open) return { on: true, line: `${who(mineB)} can reply first. ${mineB.left === 1 ? `1 ${word(mineB)} spot left.` : `${mineB.left} ${word(mineB)} spots left.`}`, can: true, left: mineB.left };
    if (mineB) return { on: true, line: `Your early access opens ${fmtOpen(mineB.opensAt, ev)}.`, can: false, remind: true, opensAt: mineB.opensAt };
    if (!open.open) return { on: true, line: `Opens to everyone ${fmtOpen(open.opensAt, ev)}.`, can: false, remind: true, opensAt: open.opensAt };
    if (open.left > 0) return { on: true, line: open.left <= 5 ? `${open.left} ${open.left === 1 ? "spot" : "spots"} open to everyone.` : "", can: true, left: open.left };
    return { on: true, line: "It's full for now. Join the waitlist and you'll hear if a spot opens.", can: true, full: true };
  }

  // ---- Remind me ----
  function addReminder(ws, id, email, at) { const k = "seatremind/" + id + "-" + h24(lc(email)).slice(0, 16); S0(ws).set(k, { eventId: id, email: lc(email), at, done: false, createdAt: clock() }); return true; }
  async function runReminders(t = clock(), { notify = null, origin = "" } = {}) { let n = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; let L = []; try { L = S0(ws).list("seatremind"); } catch { continue; }
      for (const d of L) { const r = d.data || {}; if (r.done || !r.at || r.at > t) continue; const ev = S0(ws).get("events/" + r.eventId)?.data; S0(ws).update("seatremind/" + d.id, { done: true, doneAt: t }); if (!ev || ev.cancelled) continue;
        const title = ev.pubTitle || ev.name || "The event", link = `/e/${encodeURIComponent(r.eventId)}`;
        try { if (getDbUser(r.email)) notify?.(r.email, { kind: "invite", key: "seatopen-" + r.eventId, text: `${title} is open now. Grab a spot.`, link, eventId: r.eventId }); } catch {}
        const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (cfg) await sendEmail(cfg, { list: "guest", origin, brandWs: ws, to: r.email, subject: `Open now: ${title}`, text: `You asked us to tell you. ${title} is open now.\n\n${origin}${link}\n` });
        n++; } }
    return n; }

  return { cfgOf, setCfg, state, gate, release, summary, guestLine, eligible, addReminder, runReminders, tierOf };
}

export function mountSeats(app, { store, small, currentUser, C, X, publicOrigin = () => "" }) {
  const P = app.locals.people, F = app.locals.fanclub || null;
  const Z = makeSeats({ store, P, F });
  app.locals.seats = Z;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const viewer = (req) => { try { const u = currentUser(req); return u && u.email ? u : null; } catch { return null; } };
  const hits = new Map(); const over = (k, n) => { const t = Date.now(); let h = hits.get(k); if (!h || t - h.start > 3600e3) { h = { n: 0, start: t }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const hostOf = (req, res, manage = false) => { const u = viewer(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } const role = P.access(u.ws, u.email); if (role === "none" || (manage && role !== "manage")) { bad(res, "Ask the owner for manage access to do that.", 403, "not_granted"); return null; }
    const id = String(req.params.id || ""); const ev = ID.test(id) ? scopeStore(store, u.ws).get("events/" + id)?.data : null; if (!ev) { bad(res, "No such event.", 404, "not_found"); return null; } res.set("Cache-Control", "private, no-store"); return { u, ws: u.ws, id, ev }; };
  const tiersOf = (ws) => { const h = C.profileOf(ws) || {}, s = h.support || {}; return ["monthly", "yearly", "founding"].filter((k) => +s[k] > 0); };

  app.get("/api/plan/:id/seats", (req, res) => { const H = hostOf(req, res); if (!H) return; const native = isNativeReq(req), s = Z.summary(H.ws, H.id, H.ev);
    const tiers = native ? [] : tiersOf(H.ws), lists = P.lists(H.ws).filter((l) => !l.builtin).map((l) => ({ id: l.id, name: l.name, count: l.count }));
    const out = { ...s, presets: PRESETS.map(([id, name, line]) => ({ id, name, line })), kinds: KINDS.filter((k) => k !== "tier" || tiers.length), tiers: tiers.map((t) => ({ id: t, label: TIER_LABEL[t] })), lists, club: !!F?.config?.(H.ws)?.on, cap: +H.ev.headcount || 0 };
    if (native && out.blocks) out.blocks = out.blocks.map((b) => (b.kind === "tier" ? { ...b, label: "Early access", tier: "" } : b));
    res.json(out); });
  app.post("/api/plan/:id/seats", small, (req, res) => { const H = hostOf(req, res, true); if (!H) return; const b = req.body || {}, native = isNativeReq(req);
    let blocks = b.blocks; if (b.preset) { blocks = preset(String(b.preset), { cap: +b.cap || +H.ev.headcount || 0, t0: Date.now(), ev: H.ev, club: !!F?.config?.(H.ws)?.on, tiers: native ? [] : tiersOf(H.ws) }); if (!blocks.length) return bad(res, "Set how many spots the event has first."); }
    const c = Z.setCfg(H.ws, H.id, { ...b, blocks }, { native }); res.json({ ok: true, ...Z.summary(H.ws, H.id, H.ev), cfg: c }); });
  // the guest: one plain line about their own access
  app.get("/api/public/seats/:id", (req, res) => { const id = String(req.params.id || ""); if (!ID.test(id)) return res.json({ on: false }); const ws = workspaceOfEvent(id), ev = ws && scopeStore(store, ws).get("events/" + id)?.data; if (!ev) return res.json({ on: false });
    res.set("Cache-Control", "private, no-store"); const u = viewer(req); res.json(Z.guestLine(ws, id, ev, u?.email || "", { native: isNativeReq(req) })); });
  app.post("/api/public/seats/:id/remind", small, (req, res) => { const id = String(req.params.id || ""); const ws = ID.test(id) && workspaceOfEvent(id), ev = ws && scopeStore(store, ws).get("events/" + id)?.data; if (!ev) return bad(res, "That event isn't here any more.", 404, "not_found");
    if (over("sr|" + (req.ip || "?"), 20)) return bad(res, "That's a lot of reminders. Try again later.", 429, "rate_limited");
    const u = viewer(req), email = lc(u?.email || req.body?.email); if (!EMAIL_RE.test(email)) return bad(res, "Add your email so we can tell you.");
    const line = Z.guestLine(ws, id, ev, u?.email || ""); const at = line.opensAt || Z.state(ws, id, ev, [])?.open?.opensAt || 0; if (!at || at <= Date.now()) return res.json({ ok: true, open: true });
    Z.addReminder(ws, id, email, at); res.json({ ok: true, at }); });
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => Z.runReminders(Date.now(), { notify: X?.notify, origin: process.env.ENCORE_PUBLIC_URL || "" }).catch((e) => console.warn("[seats]", e?.message)), 5 * 60e3); t.unref?.(); }
  return Z;
}
