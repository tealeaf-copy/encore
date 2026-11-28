// The invite plan for one event: who to invite, in which wave, and where each person stands, so the whole loop
// (pick people, invite, track, follow up, the next event) happens here and not in a spreadsheet.
//
//   invplans/<eventId>  { people: { <person id>: { wave, addedAt, invitedAt, seenAt, reminders: [ms], skipped } },
//                         waves: [{ id, name, any: [[chips]], kind: "people" | "public", at, sentAt, sent }],
//                         thanksAt, nextFrom, updatedAt }
//
// Status for one person, worked out on read from the plan and their reply (rsvps):
//   planned -> invited -> seen -> asked (Ask to join) | maybe | no | yes -> in (let in) | waitlist -> came | noshow
// A reply moves someone forward even if they were never invited here (they found the invite themselves).
//
// Sending: the bell, a push, and an email (list "guest": unsubscribes are skipped by server/email.js) with a personal
// link that marks the invite seen. Blocks either way skip a person. A brand only emails people who opted in or who
// replied to them before; a host with friends can email anyone they added. Sends are rate limited per workspace
// (LIMITS); a wave that hits the limit finishes on the next run. Reminders: one per person a day, two per event.
// Waves send on schedule from runDue (every few minutes outside tests). The fan club wave also sets the club's
// members-first window (server/fanclub.js) to end when the next wave goes.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, workspaceOfEvent, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { emailConfig, sendEmail } from "./email.js";
import { readImport, lc, first, h24, cleanChips, matchAll, chipLabel, replyRate, expectedYes, isBrandWs, view, keyFor, idOf, csvCell } from "./people.js";

const DAY = 864e5, HOUR = 3600e3;
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const LIMITS = { perHour: 150, perDay: 600, remindersPerPerson: 2, remindGapMs: DAY };
export const WAVE_GAP_H = 48;

/** When the event starts, in ms (noon when there's no time). */
export function startMs(ev) { const d = String(ev?.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 0; const t = /^\d{2}:\d{2}$/.test(ev?.startTime || "") ? ev.startTime : "12:00"; return Date.parse(`${d}T${t}:00`); }

/** The three waves a plan starts with: VIPs and the fan club now, followers and the rest 48 hours later, then open to everyone.
 * Waves never land after the day before the event; a close date squeezes the gap. */
export function defaultWaves(t0, ev, { brand = false } = {}) {
  const start = startMs(ev), last = start ? start - 24 * HOUR : 0;
  let gap = WAVE_GAP_H * HOUR; if (last && t0 + 2 * gap > last) gap = Math.max(HOUR, Math.floor((last - t0) / 2));
  const hr = (t) => Math.ceil(t / HOUR) * HOUR, at = (k) => (k ? Math.max(t0, last ? Math.min(hr(t0 + k * gap), last) : hr(t0 + k * gap)) : t0);
  return [
    brand ? { id: "w1", name: "VIPs and customers", any: [[{ k: "tag", v: "VIP" }], [{ k: "tag", v: "Customer" }]], kind: "people", at: at(0) } : { id: "w1", name: "VIPs and fan club", any: [[{ k: "tag", v: "VIP" }], [{ k: "club" }], [{ k: "supporter" }]], kind: "people", at: at(0) },
    { id: "w2", name: brand ? "Everyone else on your list" : "Followers and the rest of your list", any: [[]], kind: "people", at: at(1) },
    { id: "w3", name: brand ? "Open registration" : "Open to everyone", any: [], kind: "public", at: at(2) },
  ];
}
export function cleanWaves(W) {
  return (Array.isArray(W) ? W : []).slice(0, 6).map((w, i) => ({ id: ID.test(String(w?.id || "")) ? String(w.id) : "w" + (i + 1), name: clean(w?.name, 60) || `Wave ${i + 1}`, any: (Array.isArray(w?.any) ? w.any : []).slice(0, 6).map(cleanChips),
    kind: w?.kind === "public" ? "public" : "people", at: Math.max(0, Math.floor(+w?.at || 0)), ...(w?.sentAt ? { sentAt: +w.sentAt } : {}), ...(w?.sent ? { sent: +w.sent } : {}) }));
}
/** The wave a person goes out in: the one the host picked, else the first people-wave whose audience they match. */
export function waveFor(entry, p, waves) {
  const W = waves.filter((w) => w.kind === "people"); if (entry?.wave && W.some((w) => w.id === entry.wave)) return entry.wave;
  for (const w of W) if (w.any.some((chips) => matchAll(p, chips))) return w.id;
  return W[W.length - 1]?.id || "";
}

export const STAGES = ["planned", "invited", "seen", "asked", "maybe", "no", "yes", "in", "waitlist", "came", "noshow"];
export const STAGE_LABEL = { planned: "Not sent", invited: "Invited", seen: "Seen", asked: "Asked to join", maybe: "Maybe", no: "Can't go", yes: "I'm in", in: "Let in", waitlist: "Waitlist", came: "Came", noshow: "No-show" };
/** Where one person stands. r: their reply (or null). */
export function statusOf(entry, r, ev, { now = Date.now(), door = false } = {}) {
  if (r) { const past = !!ev?.date && ev.date < new Date(now).toISOString().slice(0, 10);
    switch (r.response) {
      case "going": if (r.noShow === true) return "noshow"; if (r.checkedInAt || r.noShow === false || (past && !door)) return "came"; if (past && door) return "noshow"; return r.letInAt ? "in" : "yes";
      case "maybe": return "maybe"; case "no": case "declined": return "no"; case "requested": return "asked"; case "waitlist": return "waitlist"; default: break; } }
  if (entry?.seenAt) return "seen"; if (entry?.invitedAt) return "invited"; return "planned";
}
/** The columns on the status board. */
export const BOARD = [["planned", "Not sent", ["planned"]], ["invited", "Invited", ["invited"]], ["seen", "Seen", ["seen"]], ["replied", "Replied", ["asked", "maybe", "no", "yes"]], ["decided", "Let in or waitlist", ["in", "waitlist"]], ["came", "Came", ["came", "noshow"]]];

export function makeInvites({ store, C, X, P, F = null, seats = null, now: clock = () => Date.now(), secret = () => process.env.SESSION_SECRET || "encore-invites" }) {
  const S0 = (ws) => scopeStore(store, ws);
  const planPath = (id) => "invplans/" + id;
  const eventOf = (ws, id) => (ID.test(String(id || "")) ? S0(ws).get("events/" + id)?.data || null : null);
  function plan(ws, id) { const d = S0(ws).get(planPath(id))?.data || {}; return { people: d.people && typeof d.people === "object" ? d.people : {}, waves: cleanWaves(d.waves), thanksAt: d.thanksAt || 0, nextFrom: d.nextFrom || "", createdAt: d.createdAt || 0, updatedAt: d.updatedAt || 0 }; }
  function save(ws, id, pl) { S0(ws).set(planPath(id), { ...pl, updatedAt: clock(), createdAt: pl.createdAt || clock() }); }
  const tokenOf = (ws, eventId, pid) => { const sig = crypto.createHmac("sha256", secret()).update(`inv|${ws}|${eventId}|${pid}`).digest("base64url").slice(0, 16); return Buffer.from(`${eventId}.${pid}`).toString("base64url") + "." + sig; };
  function readToken(t) { const [a, s] = String(t || "").split("."); if (!a || !s) return null; let eventId = "", pid = ""; try { [eventId, pid] = Buffer.from(a, "base64url").toString().split("."); } catch { return null; }
    if (!ID.test(eventId) || !/^[a-f0-9]{24}$/.test(pid)) return null; const ws = workspaceOfEvent(eventId); if (!ws) return null; const want = tokenOf(ws, eventId, pid).split(".")[1];
    return want.length === s.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s)) ? { ws, eventId, pid } : null; }

  // ---- the rows: everyone in the plan, plus anyone who replied on their own ----
  function rowsOf(ws, id, { book = null } = {}) {
    const ev = eventOf(ws, id); if (!ev) return null; const pl = plan(ws, id), B = book || P.build(ws), byId = new Map(B.map((p) => [p.id, p])), t = clock();
    const R = S0(ws).list("rsvps").map((d) => ({ rid: d.id, ...(d.data || {}) })).filter((r) => r.eventId === id && !r.deletedAccount), door = R.some((r) => r.checkedInAt);
    const rBy = new Map(); for (const r of R) { const k = keyFor(r.email, r.phone); if (k) rBy.set(idOf(k), r); }
    const rows = [], seen = new Set();
    for (const [pid, entry] of Object.entries(pl.people)) { const p = byId.get(pid); if (!p) continue; seen.add(pid); const r = rBy.get(pid) || null;
      rows.push({ p, entry, r, wave: waveFor(entry, p, pl.waves), status: statusOf(entry, r, ev, { now: t, door }), planned: true }); }
    for (const [pid, r] of rBy) { if (seen.has(pid)) continue; const p = byId.get(pid); if (!p) continue; rows.push({ p, entry: null, r, wave: "", status: statusOf(null, r, ev, { now: t, door }), planned: false }); }
    return { ev, pl, rows, door, R };
  }
  /** "18 invited · 24 spots · expect ~15 in". Expected counts people already in as yes, and the rest by their reply rate. */
  function meter(ev, rows) {
    const cap = +ev.headcount || 0, invited = rows.filter((x) => x.planned).length, sent = rows.filter((x) => x.planned && (x.entry.invitedAt || x.r)).length, toSend = invited - sent, inNow = rows.filter((x) => ["yes", "in", "came"].includes(x.status));
    const spots = inNow.reduce((s, x) => s + Math.max(1, Math.floor(+x.r?.party) || 1), 0);
    const open = rows.filter((x) => ["planned", "invited", "seen", "maybe"].includes(x.status)), exp = inNow.length + expectedYes(open.map((x) => x.p));
    const no = rows.filter((x) => x.status === "no").length;
    return { invited, sent, toSend, seats: cap, in: inNow.length, spots, expect: exp, waiting: open.length, no, left: cap ? Math.max(0, cap - spots) : null,
      line: [!sent && invited ? `${invited} on the list` : `${sent} invited`, sent && toSend ? `${toSend} to send` : "", cap ? `${cap} spots` : "", `expect ~${exp} in`].filter(Boolean).join(" · ") };
  }

  // ---- what the host does ----
  function add(ws, id, { ids = [], chips = null, listId = "", wave = "" } = {}) {
    const ev = eventOf(ws, id); if (!ev) return { error: "No such event.", status: 404 };
    const pl = plan(ws, id); if (!pl.waves.length) pl.waves = defaultWaves(clock(), ev, { brand: isBrandWs(ws) });
    const B = P.build(ws), ch = listId ? P.listChips(ws, listId) : chips ? cleanChips(chips) : null, inv = new Set(Object.keys(pl.people));
    const pick = ch ? B.filter((p) => matchAll(p, ch, { invited: inv })) : B.filter((p) => ids.includes(p.id));
    let n = 0; for (const p of pick.slice(0, 2000)) { if (pl.people[p.id]) { if (wave) pl.people[p.id].wave = wave; continue; } pl.people[p.id] = { addedAt: clock(), ...(wave ? { wave } : {}) }; n++; }
    save(ws, id, pl); return { added: n };
  }
  function remove(ws, id, ids = []) { const pl = plan(ws, id); let n = 0; for (const pid of ids) if (pl.people[pid] && !pl.people[pid].invitedAt) { delete pl.people[pid]; n++; } save(ws, id, pl); return { removed: n }; }
  function setWaves(ws, id, waves) { const ev = eventOf(ws, id); if (!ev) return { error: "No such event.", status: 404 }; const pl = plan(ws, id), old = new Map(pl.waves.map((w) => [w.id, w]));
    pl.waves = cleanWaves(waves).map((w) => { const o = old.get(w.id); return o?.sentAt ? { ...w, sentAt: o.sentAt, sent: o.sent } : w; }); if (!pl.waves.length) pl.waves = defaultWaves(clock(), ev, { brand: isBrandWs(ws) }); save(ws, id, pl); syncClub(ws, id, pl); return { waves: pl.waves }; }
  /** The fan club wave ends the members-first window when the next wave goes. */
  function syncClub(ws, id, pl) { try { if (!F?.config?.(ws)?.on) return; const w1 = pl.waves.find((w) => w.kind === "people" && w.any.some((c) => c.some((x) => x.k === "club"))), next = w1 && pl.waves.find((w) => w.at > w1.at);
      if (!w1 || !next) return; const S = S0(ws), v = S.get("clubevents/" + id)?.data || {}; if (v.only) return; S.set("clubevents/" + id, { ...v, earlyUntil: next.at, fromPlan: true }); } catch {} }

  // ---- sending ----
  const sent = new Map(); // ws -> [ms]
  const budget = (ws) => { const t = clock(), L = (sent.get(ws) || []).filter((x) => t - x < DAY); sent.set(ws, L); return Math.max(0, Math.min(LIMITS.perHour - L.filter((x) => t - x < HOUR).length, LIMITS.perDay - L.length)); };
  const spend = (ws) => { const L = sent.get(ws) || []; L.push(clock()); sent.set(ws, L); };
  const emailOk = (ws, p) => !!p.email && !p.unsubscribed && p.consent?.status !== "out" && (!isBrandWs(ws) || ["in", "activity"].includes(p.consent?.status)) && (X?.canEmail ? X.canEmail(p.email) : true);
  async function deliver(ws, id, ev, p, { kind, origin = "" }) {
    if (!p.email && !p.phone) return { ok: false, skipped: "No email" };
    if (p.email && F?.blocked?.(ws, p.email)) return { ok: false, skipped: "Blocked" };
    const h = C.profileOf(ws) || {}, W = getWorkspace(ws) || {}, hostName = h.name || W.company || "Your host", title = ev.pubTitle || ev.name || "an event";
    const base = origin || process.env.ENCORE_PUBLIC_URL || "", link = `/api/public/inv/${tokenOf(ws, id, p.id)}`;
    const when = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || "") ? new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "";
    const T = { invite: { subj: `${hostName} invited you: ${title}`, bell: `${hostName} invited you to ${title}${when ? `, ${when}` : ""}.`, body: `Hi ${first(p.name) || "there"},\n\n${hostName} would love you to come to ${title}${when ? ` on ${when}` : ""}.\n\nSee the details and reply:` },
      reminder: { subj: `Still thinking? ${title}`, bell: `${hostName} saved you a spot at ${title}. Reply when you can.`, body: `Hi ${first(p.name) || "there"},\n\nA quick nudge from ${hostName}: ${title}${when ? ` is ${when}` : ""}. A reply either way helps them plan.\n\nReply here:` },
      thanks: { subj: `Thanks for coming to ${title}`, bell: `${hostName} says thanks for coming to ${title}.`, body: `Hi ${first(p.name) || "there"},\n\nThanks for coming to ${title}. It was better with you there.\n\nPhotos and the next one:` },
      next: { subj: `${hostName}: you're on the list for ${title}`, bell: `${hostName} wants you at ${title}.`, body: `Hi ${first(p.name) || "there"},\n\nYou came last time, so ${hostName} is asking you first: ${title}${when ? ` on ${when}` : ""}.\n\nReply here:` } }[kind];
    // co-host hook (server/cohost.js): the line the host wrote for this person, or the reminder they read, opens the message
    { const extra = kind === "invite" || kind === "reminder" ? clean(plan(ws, id).people?.[p.id]?.[kind === "invite" ? "line" : "nudge"], 300) : ""; if (extra) { T.bell = `${hostName}: ${extra}`; T.body = kind === "invite" ? T.body.replace(/^(Hi [^\n]*\n\n)/, `$1${extra}\n\n`) : T.body.replace(/^(Hi [^\n]*\n\n)[\s\S]*?(\n\n[^\n]*:)$/, `$1${extra}$2`); } }
    const ch = []; const acct = p.email ? getDbUser(p.email) : null;
    if (acct) { try { X?.notify?.(p.email, { kind: "invite", key: `inv-${kind}-${id}`, text: T.bell, link: kind === "thanks" ? `/g#rsvp-${id}` : link, eventId: id }); ch.push("bell"); } catch {} }
    if (emailOk(ws, p)) { const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true);
      if (cfg) { const r = await sendEmail(cfg, { list: "guest", origin: base, brandWs: ws, to: p.email, fromName: hostName, subject: T.subj, text: `${T.body}\n${base}${kind === "thanks" ? `/e/${encodeURIComponent(id)}` : link}\n${kind !== "thanks" && when ? `\nPut it in your calendar: ${base}/e/${encodeURIComponent(id)}.ics\n` : ""}` }); if (r.ok) ch.push("email"); } }
    if (!ch.length) return { ok: false, skipped: p.unsubscribed ? "Unsubscribed" : isBrandWs(ws) && p.email && !emailOk(ws, p) ? "No email opt-in" : "No way to reach them here", link };
    spend(ws); return { ok: true, ch, link };
  }
  /** Send to these people now (or the ones in a wave). Returns counts; people past the hour's budget wait for the next run. */
  async function send(ws, id, { ids = null, waveId = "", origin = "" } = {}) {
    const X0 = rowsOf(ws, id); if (!X0) return { error: "No such event.", status: 404 }; const { ev, pl, rows } = X0; let n = 0, skipped = 0, held = 0;
    for (const x of rows) { if (!x.planned || x.entry.invitedAt) continue; if (ids && !ids.includes(x.p.id)) continue; if (waveId && x.wave !== waveId) continue;
      if (x.r) { x.entry.invitedAt = clock(); continue; } // they already replied: nothing to send
      if (budget(ws) <= 0) { held++; continue; }
      const r = await deliver(ws, id, ev, x.p, { kind: "invite", origin }); if (r.ok) { x.entry.invitedAt = clock(); x.entry.ch = r.ch; delete x.entry.skipped; n++; } else { x.entry.skipped = r.skipped; skipped++; } }
    save(ws, id, pl); return { sent: n, skipped, held };
  }
  /** Due waves go out. A public wave opens the event to everyone (on the host's page and Discover). */
  async function runDue(t = clock(), { origin = "" } = {}) { let out = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; let L = []; try { L = S0(ws).list("invplans"); } catch { continue; }
      for (const d of L) { const id = d.id, ev = eventOf(ws, id); if (!ev || ev.cancelled || ev.example) continue; const pl0 = plan(ws, id);
        for (const w of pl0.waves) { if (w.sentAt || !w.at || w.at > t) continue;
          if (w.kind === "public") { const before = eventOf(ws, id); S0(ws).update("events/" + id, { published: true, discoverable: true, unlisted: false }); try { F?.onEventWrite?.({}, ws, id, before, eventOf(ws, id)); } catch {} const pl = plan(ws, id); const ww = pl.waves.find((x) => x.id === w.id); ww.sentAt = t; save(ws, id, pl); out++; continue; }
          const r = await send(ws, id, { waveId: w.id, origin }); const pl = plan(ws, id), ww = pl.waves.find((x) => x.id === w.id); ww.sent = (ww.sent || 0) + r.sent; if (!r.held) ww.sentAt = t; save(ws, id, pl); out += r.sent; } } }
    return { sent: out }; }
  async function remind(ws, id, { ids = null, origin = "" } = {}) {
    const X0 = rowsOf(ws, id); if (!X0) return { error: "No such event.", status: 404 }; const { ev, pl, rows } = X0, t = clock(); let n = 0, held = 0, tooSoon = 0;
    for (const x of rows) { if (!x.planned || !["invited", "seen"].includes(x.status)) continue; if (ids && !ids.includes(x.p.id)) continue; const R = x.entry.reminders || [];
      if (R.length >= LIMITS.remindersPerPerson || (R.length && t - R[R.length - 1] < LIMITS.remindGapMs)) { tooSoon++; continue; }
      if (budget(ws) <= 0) { held++; continue; } const r = await deliver(ws, id, ev, x.p, { kind: "reminder", origin }); if (r.ok) { x.entry.reminders = [...R, t]; n++; } }
    save(ws, id, pl); return { reminded: n, tooSoon, held }; }
  async function thanks(ws, id, { origin = "" } = {}) { const X0 = rowsOf(ws, id); if (!X0) return { error: "No such event.", status: 404 }; const { ev, pl, rows } = X0; if (pl.thanksAt) return { already: true, thanked: 0 }; let n = 0;
    for (const x of rows.filter((x) => x.status === "came")) { if (budget(ws) <= 0) break; const r = await deliver(ws, id, ev, x.p, { kind: "thanks", origin }); if (r.ok) n++; }
    pl.thanksAt = clock(); save(ws, id, pl); return { thanked: n }; }
  /** "Invite these people to the next one": the people who came (or who'd go again) go on the next event's plan. */
  function carry(ws, fromId, toId, { who = "came" } = {}) { const X0 = rowsOf(ws, fromId); if (!X0 || !eventOf(ws, toId)) return { error: "No such event.", status: 404 };
    const ids = X0.rows.filter((x) => (who === "again" ? x.p.again && x.status === "came" : who === "yes" ? ["came", "yes", "in", "maybe"].includes(x.status) : x.status === "came")).map((x) => x.p.id);
    const r = add(ws, toId, { ids }); const pl = plan(ws, toId); pl.nextFrom = fromId; save(ws, toId, pl); return r; }
  function markSeen(token) { const T = readToken(token); if (!T) return null; const pl = plan(T.ws, T.eventId), e = pl.people[T.pid]; if (e && !e.seenAt) { e.seenAt = clock(); if (!e.invitedAt) e.invitedAt = clock(); save(T.ws, T.eventId, pl); } return T; }

  // ---- context for Ask to join ----
  function askContext(ws, p, book) { const bits = [];
    if (p.attended) bits.push(p.attended === 1 ? "Came once" : `Came ${p.attended} times`); else bits.push(p.replies > 1 || p.noShows ? "Hasn't come yet" : "New to you");
    if (p.club) bits.push("In your fan club"); else if (p.follower) bits.push("Follows you");
    if (p.again) bits.push("Said would go again"); else if (p.kudos) bits.push("Gave kudos");
    if (p.noShows) bits.push(p.noShows === 1 ? "1 no-show" : `${p.noShows} no-shows`);
    try { const fr = (X?.friendsOf?.(p.email) || []).map((f) => lc(f.email)), keys = new Set(book.filter((q) => q.attended > 0).map((q) => q.key)); const m = fr.filter((e) => keys.has(e)).length; if (m) bits.push(m === 1 ? "1 friend has come before" : `${m} friends have come before`); } catch {}
    return bits; }

  // ---- suggestions for the People page and the plan ----
  function upcoming(ws) { const today = new Date(clock()).toISOString().slice(0, 10); return S0(ws).list("events").map((d) => ({ id: d.id, e: d.data || {} })).filter(({ e }) => !e.example && !e.sample && !e.cancelled && e.date && e.date >= today && (e.name || e.pubTitle)).sort((a, b) => a.e.date.localeCompare(b.e.date)); }
  const dayName = (d) => { const t = new Date(d + "T12:00:00"), diff = (t - clock()) / DAY; return diff < 6.5 ? t.toLocaleDateString("en-US", { weekday: "long" }) : t.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  function suggestions(ws) { const today = new Date(clock()).toISOString().slice(0, 10), out = [], U = upcoming(ws).filter((u) => u.e.date > today).slice(0, 2), B = P.build(ws);
    for (const { id, e } of U) { const inv = new Set(Object.keys(plan(ws, id).people)); const R = new Set(S0(ws).list("rsvps").filter((d) => d.data?.eventId === id).map((d) => idOf(keyFor(d.data.email, d.data.phone)))); const fresh = (p) => !inv.has(p.id) && !R.has(p.id) && !p.noShows;
      const title = e.pubTitle || e.name, soon = (new Date(e.date + "T12:00:00") - clock()) / DAY < 6.5, day = soon ? dayName(e.date) : title;
      const reg = B.filter((p) => p.attended >= 2 && fresh(p)); if (reg.length) out.push({ eventId: id, event: title, chips: [{ k: "came", n: 2 }, { k: "notInvited" }], n: reg.length, text: `${reg.length} ${reg.length === 1 ? "regular hasn't" : "regulars haven't"} been invited to ${day} yet` });
      const club = B.filter((p) => p.club && fresh(p) && p.attended < 2); if (club.length) out.push({ eventId: id, event: title, chips: [{ k: "club" }, { k: "notInvited" }], n: club.length, text: `${club.length} fan club ${club.length === 1 ? "member hasn't" : "members haven't"} heard about ${day}` });
      const mb = B.filter((p) => p.lastReply?.response === "maybe" && fresh(p)); if (mb.length) out.push({ eventId: id, event: title, chips: [{ k: "maybeLast" }, { k: "notInvited" }], n: mb.length, text: `${mb.length} said maybe last time. Ask them for ${day}?` }); }
    return out.slice(0, 4); }
  /** "Fill the empty seats": when people said no and there's room, the likeliest people not yet asked. */
  function fill(ws, id, rows, m) { if (!m.no && !(m.left > 0)) return null; const room = m.seats ? m.seats - m.expect : 0; if (room <= 0 && !m.no) return null; const inPlan = new Set(rows.map((x) => x.p.id));
    const C2 = P.build(ws).filter((p) => !inPlan.has(p.id) && !p.noShows && (p.email || p.phone) && replyRate(p) >= 0.35).sort((a, b) => replyRate(b) - replyRate(a)).slice(0, Math.max(3, Math.min(10, room || m.no)));
    if (!C2.length) return null; return { text: m.no ? `${m.no} can't make it. ${C2.length === 1 ? "1 more person" : `${C2.length} more people`} could fill the gap.` : `${Math.max(0, room)} spots may go empty. ${C2.length === 1 ? "1 person" : `${C2.length} people`} you haven't asked are likely to come.`, ids: C2.map((p) => p.id), people: C2.map((p) => ({ id: p.id, name: p.name, rate: Math.round(replyRate(p) * 100) })) }; }

  /** Everything the Invite tab draws. */
  function summary(ws, id, role = "manage") {
    const X0 = rowsOf(ws, id); if (!X0) return null; const { ev, pl, rows } = X0, B = P.build(ws), m = meter(ev, rows);
    const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((x) => x.status === s).length]));
    const row = (x) => ({ ...view(x.p, role), status: x.status, wave: x.wave, planned: x.planned, rid: x.r?.rid || "", party: Math.max(1, Math.floor(+x.r?.party) || 1), invitedAt: x.entry?.invitedAt || 0, seenAt: x.entry?.seenAt || 0, reminders: (x.entry?.reminders || []).length, remindedAt: (x.entry?.reminders || []).slice(-1)[0] || 0, skipped: x.entry?.skipped || "", block: x.r?.seatBlock || "", link: role === "manage" && x.planned ? `/api/public/inv/${tokenOf(ws, id, x.p.id)}` : "" });
    const waves = pl.waves.map((w) => ({ ...w, labels: w.any.map((c) => (c.length ? c.map(chipLabel).join(" and ") : "Everyone else you picked")), people: rows.filter((x) => x.planned && x.wave === w.id).length, waiting: rows.filter((x) => x.planned && x.wave === w.id && !x.entry.invitedAt).length }));
    const asks = rows.filter((x) => x.status === "asked").map((x) => ({ ...row(x), context: askContext(ws, x.p, B) }));
    const today = new Date(clock()).toISOString().slice(0, 10), others = upcoming(ws).filter((u) => u.id !== id).slice(0, 6).map((u) => ({ id: u.id, title: u.e.pubTitle || u.e.name, date: u.e.date }));
    return { event: { id, title: ev.pubTitle || ev.name || "Untitled event", date: ev.date || "", startTime: ev.startTime || "", headcount: +ev.headcount || 0, approval: !!ev.approvalRequired, published: !!(ev.published || ev.discoverable), past: !!ev.date && ev.date < today, today: ev.date === today },
      meter: m, counts, board: BOARD.map(([k, label, st]) => ({ k, label, n: st.reduce((s, x) => s + counts[x], 0) })), rows: rows.map(row), waves, asks, fill: fill(ws, id, rows, m), thanksAt: pl.thanksAt, others,
      seats: seats?.summary?.(ws, id, ev, X0.R) || null, club: !!F?.config?.(ws)?.on, brand: isBrandWs(ws), limits: { left: budget(ws) } };
  }
  /** Did the host personally invite this person to this event? (Then the members-first window doesn't make them wait.) */
  function isInvited(ws, id, emails = []) { try { const P0 = plan(ws, id).people; return emails.map((e) => keyFor(e)).filter(Boolean).some((k) => !!P0[idOf(k)]?.invitedAt); } catch { return false; } }
  return { isInvited, plan, save, rowsOf, meter, add, remove, setWaves, send, runDue, remind, thanks, carry, markSeen, readToken, tokenOf, summary, suggestions, upcoming, eventOf, budget, _sent: sent };
}

export function mountInvites(app, { store, small, currentUser, C, X, publicOrigin = () => "" }) {
  const P = app.locals.people, F = app.locals.fanclub || null;
  const I = makeInvites({ store, C, X, P, F, seats: app.locals.seats || null });
  app.locals.invites = I;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const host = (req, res, need = "view") => { let u = null; try { u = currentUser(req); } catch {} if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; }
    const role = P.access(u.ws, u.email), rank = { none: 0, view: 1, manage: 2 }; if (rank[role] < rank[need]) { bad(res, role === "none" ? "Your team hasn't shared contacts with you." : "Ask the owner for manage access to do that.", 403, "not_granted"); return null; }
    const id = String(req.params.id || ""); if (!I.eventOf(u.ws, id)) { bad(res, "No such event.", 404, "not_found"); return null; } res.set("Cache-Control", "private, no-store"); return { u, ws: u.ws, id, role }; };
  const ids = (b) => (Array.isArray(b?.ids) ? b.ids.map(String).filter((x) => /^[a-f0-9]{24}$/.test(x)).slice(0, 2000) : null);
  const origin = (req) => { try { return publicOrigin(req) || ""; } catch { return ""; } };

  app.get("/api/plan/:id", (req, res) => { const H = host(req, res); if (!H) return; res.json(I.summary(H.ws, H.id, H.role)); });
  app.post("/api/plan/:id/add", small, (req, res) => { const H = host(req, res, "manage"); if (!H) return; const b = req.body || {};
    // someone new, by email, straight onto the list: they join People too
    if (typeof b.emails === "string" && b.emails.trim()) { const R = readImport(b.emails.slice(0, 20000)); if (!R.rows.length) return bad(res, "That doesn't look like an email.");
      const ev = I.eventOf(H.ws, H.id); P.importRows(H.ws, R.rows.slice(0, 200), { source: `Added to ${String(ev.pubTitle || ev.name || "an event").slice(0, 40)}` }); const r = I.add(H.ws, H.id, { ids: R.rows.slice(0, 200).map((x) => idOf(x.email)) }); return res.json({ ok: true, ...r, plan: I.summary(H.ws, H.id, H.role) }); }
    const r = I.add(H.ws, H.id, { ids: ids(b) || [], chips: Array.isArray(b.chips) ? b.chips : null, listId: String(b.list || ""), wave: /^[A-Za-z0-9_-]{1,20}$/.test(b.wave || "") ? b.wave : "" }); if (r.error) return bad(res, r.error, r.status); res.json({ ok: true, ...r, plan: I.summary(H.ws, H.id, H.role) }); });
  app.post("/api/plan/:id/remove", small, (req, res) => { const H = host(req, res, "manage"); if (!H) return; const r = I.remove(H.ws, H.id, ids(req.body) || []); res.json({ ok: true, ...r, plan: I.summary(H.ws, H.id, H.role) }); });
  app.post("/api/plan/:id/waves", small, (req, res) => { const H = host(req, res, "manage"); if (!H) return; const b = req.body || {}; const r = b.reset ? I.setWaves(H.ws, H.id, []) : I.setWaves(H.ws, H.id, b.waves); if (r.error) return bad(res, r.error, r.status); res.json({ ok: true, plan: I.summary(H.ws, H.id, H.role) }); });
  app.post("/api/plan/:id/send", small, async (req, res) => { const H = host(req, res, "manage"); if (!H) return; const b = req.body || {}; const r = await I.send(H.ws, H.id, { ids: ids(b), waveId: String(b.wave || ""), origin: origin(req) });
    if (b.wave) { const pl = I.plan(H.ws, H.id), w = pl.waves.find((x) => x.id === b.wave); if (w && !r.held) { w.sentAt = Date.now(); w.sent = (w.sent || 0) + r.sent; I.save(H.ws, H.id, pl); } }
    res.json({ ok: true, ...r, plan: I.summary(H.ws, H.id, H.role) }); });
  app.post("/api/plan/:id/remind", small, async (req, res) => { const H = host(req, res, "manage"); if (!H) return; const r = await I.remind(H.ws, H.id, { ids: ids(req.body), origin: origin(req) }); res.json({ ok: true, ...r, plan: I.summary(H.ws, H.id, H.role) }); });
  app.post("/api/plan/:id/thanks", small, async (req, res) => { const H = host(req, res, "manage"); if (!H) return; const r = await I.thanks(H.ws, H.id, { origin: origin(req) }); res.json({ ok: true, ...r, plan: I.summary(H.ws, H.id, H.role) }); });
  app.post("/api/plan/:id/next", small, (req, res) => { const H = host(req, res, "manage"); if (!H) return; const to = String(req.body?.to || ""); const r = I.carry(H.ws, H.id, to, { who: String(req.body?.who || "came") }); if (r.error) return bad(res, r.error, r.status); res.json({ ok: true, ...r }); });
  // this event's list for a CRM: who was invited, how they replied, who came (manage only)
  app.get("/api/plan/:id/export.csv", (req, res) => { const H = host(req, res, "manage"); if (!H) return; const X0 = I.rowsOf(H.ws, H.id); const d = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");
    const rows = [["Email", "First name", "Last name", "Company", "Title", "Tags", "Status", "Invited", "Seen", "Party", "Events attended", "Email opt-in", "Unsubscribed"],
      ...X0.rows.map((x) => { const [fn, ...ln] = String(x.p.fullName || x.p.name).split(/\s+/); return [x.p.email, fn || "", ln.join(" "), x.p.company, x.p.title, x.p.tags.join("; "), STAGE_LABEL[x.status] || x.status, d(x.entry?.invitedAt), d(x.entry?.seenAt), Math.max(1, Math.floor(+x.r?.party) || 1), x.p.attended, x.p.consent?.status === "in" ? "yes" : x.p.consent?.status === "out" ? "no" : "", x.p.unsubscribed ? "yes" : ""]; })];
    const name = String(X0.ev.pubTitle || X0.ev.name || "event").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-guests.csv"` }).send(rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n"); });
  // the personal link in an invite: marks it seen, then opens the invite
  app.get("/api/public/inv/:token", (req, res) => { const T = I.markSeen(String(req.params.token || "")); res.redirect(302, T ? `/e/${encodeURIComponent(T.eventId)}` : "/"); });
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => I.runDue().catch((e) => console.warn("[invites]", e?.message)), 5 * 60e3); t.unref?.(); }
  return I;
}
