// Fan clubs and the follow graph: the host is front and center.
//
// Following (free, one tap when signed in) is the light tie: you hear when a host publishes. The bell on a follow
// ("Tell me about new events and drops") turns those notices on or off. A fan club is the deeper one, turned on by the
// host from their page: a name ("Bo's Regulars"), a one-line pitch and a few perks. Members get
//   - early access: new events and drops open to members first for a window the host picks (24 hours by default)
//   - members-only events: an event set to "Fan club only" is readable and bookable by members (and the host) only
//   - a members' group chat (server/chat.js, a "club-<id>" chat with no event behind it)
//   - host updates: short posts with an optional photo, for members only, also in members' feeds
//   - a small badge and "member since" on their own page, only when they opt in
// The host sees members (first names), growth over time, the most regular members (attendance), and can remove a
// member. Members can leave anytime and mute a club's notices (each email carries a one-click unsubscribe for that club).
//
// Free at launch. The owner decided Pottery Lab is free at launch: joining a fan club costs nothing, there's no paid
// plan and no in-app purchase. The older pledge and supporter tiers (and tip links) are web only. Apple's rules on paying
// digital creators (App Store guideline 3.1.1) mean the native app never shows a paid tier, a pledge form or a tip
// link: GET /api/public/host/:handle strips them for the app, and POST /api/public/pledge refuses from the app.
//
// Privacy and safety: who follows and who is a member is private; only the host sees the full list. Everyone else
// sees counts. Blocks count both ways (you blocked the host, or the host blocked you): no follow, no join, no posts.
// Host posts can be reported (target "post:club.<handle>:<id>", the same /api/report queue as every post) and a post
// the team hides (or three people report) is gone for everyone. Joins, follows and posts are rate limited.
//
// Docs, in the host's workspace: fanclub/main (settings), clubmembers/<hash of email>, clubposts/<id>,
// clubevents/<event id> (visibility: members only, or members first until a time). system/clubchat-<chat id> maps a
// club chat back to its workspace. Followers stay in followers/<hash> (server/community.js), with a `notify` bell.
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS, getDbUser } from "./workspaces.js";
import { makeSafety, keyOf, textProblem } from "./safety.js";
import { emailConfig, sendEmail } from "./email.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const line1 = (v, n) => clean(v, n).replace(/\s+/g, " ");
const h24 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 24);
const PHOTO_OK = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "");
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DAY = 864e5;

export const EARLY_HOURS_DEFAULT = 24, EARLY_HOURS = [0, 12, 24, 48, 72];
export const JOIN_PER_HOUR = 10, FOLLOW_PER_HOUR = 30, POST_PER_HOUR = 5, POST_PER_DAY = 20, POST_MAX = 500, PERKS_MAX = 5;
export const VISIBILITY = ["everyone", "early", "members"];

/** The app (Capacitor appends "PotteryLabApp/<v>" to its user agent; native.js also sends x-encore-native). */
export const isNativeReq = (req) => /PotteryLabApp\//.test(String(req?.get?.("user-agent") || "")) || req?.get?.("x-encore-native") === "1";
/** A host's public page as the native app may show it: no paid tiers, pledges, tip or supporter links (web only). */
export function stripPaid(body) {
  if (!body || typeof body !== "object" || !body.host) return body;
  const h = { ...body.host, support: { ...(body.host.support || {}), on: false, monthly: 0, yearly: 0, founding: 0 }, fanclubUrl: "", supportUrl: "", venmo: "", paypal: "", cashapp: "" };
  return { ...body, host: h, supporters: 0, paidHidden: true };
}
/** "Bo's Regulars" from "Bo's Omecasa", "Claire Regulars" from "Claire". */
export function defaultClubName(name) { const n = String(name || "").trim(); if (!n) return "Regulars"; if (n.split(/\s+/).length > 2) return `${n} Regulars`.slice(0, 60); /* "Long Table Supper Club Regulars", never "Long's Regulars" */ const w = n.split(/\s+/)[0].replace(/['’]s$/i, ""); return `${w}${/s$/i.test(w) ? "'" : "'s"} Regulars`; }

export function makeFanclub({ store, C, X = null, safety = null, now: clock = () => Date.now() }) {
  const SF = safety || makeSafety(store); // the app's own safety store, so a hide shows at once
  const S0 = (ws) => scopeStore(store, ws);
  const owner = (ws) => lc(getWorkspace(ws)?.ownerEmail);
  const handleOf = (ws) => C.profileOf(ws)?.handle || "";
  const chatIdOf = (ws) => "club-" + h24("club|" + ws).slice(0, 16);

  // ---- settings ----
  function config(ws) { const c = S0(ws).get("fanclub/main")?.data || {}, h = C.profileOf(ws) || {};
    return { on: !!c.on, name: c.name || defaultClubName(h.name || h.handle), pitch: c.pitch || "", perks: Array.isArray(c.perks) ? c.perks : [], earlyHours: EARLY_HOURS.includes(c.earlyHours) ? c.earlyHours : EARLY_HOURS_DEFAULT, startedAt: c.startedAt || 0, chatId: c.on ? chatIdOf(ws) : "" }; }
  function setConfig(ws, b = {}) { const cur = S0(ws).get("fanclub/main")?.data || {}, h = C.profileOf(ws) || {};
    const name = b.name != null ? line1(b.name, 60) : cur.name; const pitch = b.pitch != null ? line1(b.pitch, 140) : cur.pitch;
    for (const t of [name, pitch, ...(Array.isArray(b.perks) ? b.perks : [])]) { const p = textProblem(t); if (p) return { error: p.message }; }
    const perks = Array.isArray(b.perks) ? b.perks.map((x) => line1(x, 80)).filter(Boolean).slice(0, PERKS_MAX) : cur.perks || [];
    const earlyHours = b.earlyHours != null ? (EARLY_HOURS.includes(+b.earlyHours) ? +b.earlyHours : EARLY_HOURS_DEFAULT) : cur.earlyHours ?? EARLY_HOURS_DEFAULT;
    const on = b.on != null ? !!b.on : !!cur.on;
    const next = { on, name: name || defaultClubName(h.name || h.handle), pitch: pitch || "", perks, earlyHours, startedAt: cur.startedAt || (on ? clock() : 0), updatedAt: clock() };
    S0(ws).set("fanclub/main", next); if (on) store.set("system/clubchat-" + chatIdOf(ws), { kind: "clubchat", ws }); return { club: config(ws) }; }

  // ---- blocks, both ways ----
  function blocked(ws, email) { const em = lc(email), o = owner(ws), hd = lc(handleOf(ws)); if (!em || !o || em === o) return false;
    try { if (SF.blocksOf(o).some((b) => b.target === "person:" + keyOf(em))) return true; if (SF.blocksOf(em).some((b) => b.target === "host:" + hd || b.target === "person:" + keyOf(o))) return true; } catch {} return false; }

  // ---- members ----
  const mPath = (email) => "clubmembers/" + h24(lc(email));
  const active = (m) => !!m && !m.leftAt && !m.removedAt;
  function memberDoc(ws, email) { return email ? S0(ws).get(mPath(email))?.data || null : null; }
  function isMember(ws, email) { const m = memberDoc(ws, email); return active(m) && config(ws).on && !blocked(ws, email); }
  function membersOf(ws) { return S0(ws).list("clubmembers").map((d) => ({ id: d.id, ...d.data })).filter((m) => active(m) && !blocked(ws, m.email)); }
  function join(ws, { email, name }) { const em = lc(email); if (!config(ws).on) return { error: "This host hasn't started a fan club.", status: 404, code: "no_club" };
    if (em === owner(ws)) return { error: "It's your own club.", status: 400, code: "own" };
    if (blocked(ws, em)) return { error: "You can't join this club.", status: 403, code: "blocked" };
    const cur = memberDoc(ws, em); if (cur?.removedAt) return { error: "The host took you out of this club.", status: 403, code: "removed" };
    if (active(cur)) return { member: cur, already: true };
    const m = { email: em, name: clean(name, 80) || cur?.name || "", joinedAt: clock(), firstJoinedAt: cur?.firstJoinedAt || clock(), showBadge: cur?.showBadge || false, muted: false, history: [...(cur?.history || []), { at: clock(), j: 1 }].slice(-50) };
    S0(ws).set(mPath(em), m);
    // a member follows too: they hear about everything the host publishes
    try { if (!C.followersOf(ws).some((f) => lc(f.email) === em)) C.follow(ws, { email: em, name: m.name, via: "club" }); } catch {}
    return { member: m }; }
  function leave(ws, email, { by = "member" } = {}) { const em = lc(email), cur = memberDoc(ws, em); if (!active(cur)) return { ok: true, was: false };
    S0(ws).set(mPath(em), { ...cur, ...(by === "host" ? { removedAt: clock() } : { leftAt: clock() }), history: [...(cur.history || []), { at: clock(), j: 0 }].slice(-50) }); return { ok: true, was: true }; }
  function memberSettings(ws, email, b = {}) { const cur = memberDoc(ws, email); if (!active(cur)) return null; const p = {}; if (typeof b.showBadge === "boolean") p.showBadge = b.showBadge; if (typeof b.muted === "boolean") p.muted = b.muted;
    S0(ws).update(mPath(email), p); return { ...cur, ...p }; }
  /** Attendance at this host's past events (going, not marked no-show), by email. */
  function attendance(ws) { const today = new Date(clock()).toISOString().slice(0, 10), S = S0(ws), dates = new Map(S.list("events").map((d) => [d.id, d.data?.date || ""])), out = new Map(), seen = new Set();
    for (const d of S.list("rsvps")) { const r = d.data || {}, em = lc(r.email), dt = dates.get(r.eventId); if (!em || r.response !== "going" || r.noShow || !dt || dt > today) continue; const k = em + "|" + r.eventId; if (seen.has(k)) continue; seen.add(k); out.set(em, (out.get(em) || 0) + 1); }
    return out; }
  /** Weekly member counts for the last n weeks (oldest first), from join and leave history. */
  function growth(ws, weeks = 12) { const all = S0(ws).list("clubmembers").map((d) => d.data || {}), t = clock(), out = [];
    for (let i = weeks - 1; i >= 0; i--) { const end = t - i * 7 * DAY; let n = 0;
      for (const m of all) { const H = (m.history || []).filter((x) => x.at <= end); const last = H[H.length - 1]; if (last ? last.j === 1 : (m.joinedAt || 0) <= end && !m.leftAt && !m.removedAt && (m.joinedAt || 0) > 0) n++; }
      out.push({ week: new Date(end).toISOString().slice(0, 10), members: n }); }
    return out; }

  // ---- follows ----
  const fPath = (email) => "followers/" + h24(lc(email));
  function followerDoc(ws, email) { return email ? S0(ws).get(fPath(email))?.data || null : null; }
  function setFollow(ws, email, { on, notify, name } = {}) { const em = lc(email), cur = followerDoc(ws, em);
    if (on === false) { if (cur) S0(ws).delete(fPath(em)); return { following: false, notify: false }; }
    if (blocked(ws, em)) return { error: "You can't follow this host.", status: 403, code: "blocked" };
    if (!cur || cur.pending) C.follow(ws, { email: em, name: name || "", via: "page" });
    if (typeof notify === "boolean") S0(ws).update(fPath(em), { notify });
    const f = followerDoc(ws, em); return { following: !!f, notify: f?.notify !== false, isNew: !cur }; }
  /** The hosts someone follows, newest first. */
  function followedHosts(email) { const em = lc(email), out = []; if (!em) return out;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; try { const f = followerDoc(ws, em); if (!f || f.pending) continue; const h = C.profileOf(ws); if (!h?.handle || blocked(ws, em)) continue;
      out.push({ handle: h.handle, name: h.name || h.handle, emoji: h.emoji || "", color: h.theme?.accent || h.color || "", avatarArt: h.theme?.avatarArt || "", avatarUrl: PHOTO_OK(h.theme?.avatarUrl) ? h.theme.avatarUrl : "", city: h.city || "", notify: f.notify !== false, at: f.at || 0, member: isMember(ws, em) }); } catch {} }
    return out.sort((a, b) => b.at - a.at); }
  /** The fan clubs someone is in. */
  function clubMemberships(email) { const em = lc(email), out = []; if (!em) return out;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; try { const m = memberDoc(ws, em); if (!active(m) || !isMember(ws, em)) continue; const h = C.profileOf(ws), c = config(ws); if (!h?.handle) continue;
      out.push({ handle: h.handle, host: h.name || h.handle, club: c.name, since: m.joinedAt, firstSince: m.firstJoinedAt || m.joinedAt, showBadge: !!m.showBadge, muted: !!m.muted, chatId: c.chatId }); } catch {} }
    return out.sort((a, b) => a.since - b.since); }

  // ---- event visibility: members only, members first ----
  const evPath = (id) => "clubevents/" + id;
  const visOf = (ws, id) => (ID.test(String(id || "")) ? S0(ws).get(evPath(id))?.data || null : null);
  function visibility(ws, id) { const v = visOf(ws, id); if (!v) return "everyone"; if (v.only) return "members"; if (v.earlyUntil && v.earlyUntil > clock()) return "early"; return "everyone"; }
  function setVisibility(ws, id, vis, { tell = null } = {}) { const S = S0(ws), ev = S.get("events/" + id)?.data; if (!ev || ev.example) return { error: "No such event.", status: 404, code: "not_found" };
    if (!VISIBILITY.includes(vis)) return { error: "Pick everyone, members first or fan club only." };
    if (vis !== "everyone" && !config(ws).on) return { error: "Turn on your fan club first." };
    const cur = visOf(ws, id) || {}, c = config(ws);
    const next = { ...cur, only: vis === "members", earlyUntil: vis === "early" ? (cur.earlyUntil && cur.earlyUntil > clock() ? cur.earlyUntil : clock() + (c.earlyHours || EARLY_HOURS_DEFAULT) * 3600e3) : vis === "members" ? cur.earlyUntil || 0 : 0, setAt: clock() };
    if (vis === "members") { next.wasDiscoverable = cur.only ? cur.wasDiscoverable : !!ev.discoverable; S.update("events/" + id, { discoverable: false, unlisted: true }); }
    else if (cur.only) S.update("events/" + id, { discoverable: !!cur.wasDiscoverable, unlisted: false });
    S.set(evPath(id), next); if (typeof tell === "function") tell(); return { visibility: visibility(ws, id), earlyUntil: next.earlyUntil || 0 }; }
  /** Can this person read a club-only event? The host, members. */
  const canSee = (ws, email) => { const em = lc(email); return !!em && (em === owner(ws) || isMember(ws, em)); };
  /** Before a reply: null when it's fine, else the refusal. Members-only needs a member; members-first waits for the window. */
  function rsvpGate(ws, id, emails = []) { const v = visOf(ws, id); if (!v) return null; const E = emails.map(lc).filter(Boolean), c = config(ws);
    if (v.only && !E.some((e) => canSee(ws, e))) return { code: "club_only", message: `This one is for ${c.name} only. Join the fan club on ${C.profileOf(ws)?.name || "the host"}'s page to get in.`, handle: handleOf(ws) };
    if (!v.only && v.earlyUntil && v.earlyUntil > clock() && !E.some((e) => canSee(ws, e))) return { code: "club_early", message: `${c.name} get first dibs until ${new Date(v.earlyUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}. Join the fan club to book now, or come back then.`, handle: handleOf(ws), until: v.earlyUntil };
    return null; }

  // ---- posts ----
  const postTarget = (ws, id) => `post:club.${lc(handleOf(ws))}:${id}`;
  function postsOf(ws, { viewer = "" } = {}) { const hid = SF.hiddenSet(), mk = viewer ? h24("heart|" + lc(viewer)) : "";
    return S0(ws).list("clubposts").map((d) => ({ id: d.id, ...d.data })).filter((p) => !p.removedAt && !hid.has(postTarget(ws, p.id))).sort((a, b) => (b.at || 0) - (a.at || 0))
      .map((p) => ({ id: p.id, text: p.text || "", photo: PHOTO_OK(p.photo) ? p.photo : "", at: p.at || 0, hearts: (p.hearts || []).length, hearted: !!mk && (p.hearts || []).includes(mk), report: postTarget(ws, p.id) })); }
  function addPost(ws, { text, photo }) { const t = clean(text, POST_MAX); if (!t && !PHOTO_OK(photo)) return { error: "Write something or add a photo." }; const pr = textProblem(t); if (pr) return { error: pr.message, code: pr.code };
    const r = S0(ws).add("clubposts", { text: t, photo: PHOTO_OK(photo) ? photo : "", at: clock(), hearts: [] }); return { post: postsOf(ws).find((p) => p.id === r.id) }; }
  function heart(ws, id, email, on = true) { const p = S0(ws).get("clubposts/" + id)?.data; if (!p || p.removedAt) return null; const mk = h24("heart|" + lc(email)), L = new Set(p.hearts || []); if (on) L.add(mk); else L.delete(mk);
    S0(ws).update("clubposts/" + id, { hearts: [...L].slice(-5000) }); return { hearts: L.size, hearted: on }; }
  /** Recent posts from every club this person is in, as feed items ("post" items the feed already draws). */
  function feedItems(email, { days = 21, limit = 20 } = {}) { const em = lc(email), out = [], since = clock() - days * DAY;
    for (const c of clubMemberships(em)) { const ws = C.wsOfHandle(c.handle); if (!ws) continue; const h = C.profileOf(ws) || {};
      for (const p of postsOf(ws, { viewer: em }).filter((p) => p.at >= since).slice(0, 5)) out.push({ kind: "post", clubPost: true, at: p.at, id: p.id, author: "club." + lc(h.handle), who: { name: h.name || h.handle, handle: h.handle, emoji: h.emoji || "", color: h.theme?.accent || h.color || "" }, club: { name: c.club, handle: h.handle }, mine: false, text: p.text, link: "", cheers: [], cheered: p.hearted, ...(p.photo ? { media: { type: "image", url: p.photo } } : {}) }); }
    return out.sort((a, b) => b.at - a.at).slice(0, limit); }

  // ---- the club chat (server/chat.js asks) ----
  function chatEvent(id) { const ws = store.get("system/clubchat-" + String(id || ""))?.data?.ws; if (!ws || !getWorkspace(ws)) return null; const c = config(ws); if (!c.on || c.chatId !== id) return null;
    const h = C.profileOf(ws) || {}; return { ws, ev: { name: c.name, pubTitle: c.name, clubChat: true, published: true, clubUrl: h.handle ? `/@${h.handle}#club` : "/", activity: "club" } }; }
  const chatMembers = (ws) => membersOf(ws).map((m) => ({ email: m.email, name: m.name }));
  function chatIdsFor(email) { const em = lc(email), out = []; for (const c of clubMemberships(em)) if (c.chatId) out.push(c.chatId);
    try { const u = X?.userOf?.(em); if (u?.ws && config(u.ws).on) out.push(chatIdOf(u.ws)); } catch {} return out; }

  return { config, setConfig, blocked, isMember, memberDoc, membersOf, join, leave, memberSettings, attendance, growth, followerDoc, setFollow, followedHosts, clubMemberships,
    visibility, setVisibility, visOf, canSee, rsvpGate, postsOf, addPost, heart, feedItems, postTarget, chatEvent, chatMembers, chatIdsFor, chatIdOf, owner, handleOf, S0 };
}

export function mountFanclub(app, { store, small, currentUser, C, X, publicOrigin = () => "" }) {
  const F = makeFanclub({ store, C, X, safety: app.locals.appstore?.safety || null });
  app.locals.fanclub = F;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; } catch { return null; } };
  const me = (req, res) => { const u = viewer(req); if (!u) bad(res, "Make a free account to do that.", 401, "unauthenticated"); return u; };
  const hostOf = (req, res) => { const u = me(req, res); if (!u) return null; const h = C.profileOf(u.ws); if (!h?.handle) { bad(res, "Set up your page first."); return null; } return { u, ws: u.ws, h }; };
  const wsOf = (handle) => C.wsOfHandle(lc(handle).replace(/^@/, ""));
  const hits = new Map(); const over = (k, n, ms = 3600e3) => { const t = Date.now(); let h = hits.get(k); if (!h || t - h.start > ms) { h = { n: 0, start: t }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const demo = (ws) => process.env.ENCORE_ALLOW_DEMO_WRITES !== "1" && /@demo\.encore$/i.test(getWorkspace(ws)?.ownerEmail || "");
  const secret = () => process.env.SESSION_SECRET || "encore-club";
  const unsubToken = (ws, email) => crypto.createHmac("sha256", secret()).update("clubunsub|" + ws + "|" + lc(email)).digest("base64url").slice(0, 32);

  // ---- notifications: the bell always (unless muted), a push and an email where the person's prefs allow ----
  async function tellOne(req, ws, email, { key, text, link, subject, body, eventId = "", club = false }) { const em = lc(email); if (!em || F.blocked(ws, em)) return false;
    try { X?.notify?.(em, { kind: club ? "club" : "follow", key, text, link, eventId }); } catch {}
    const prefs = (() => { try { return X?.prefs?.(em) || {}; } catch { return {}; } })();
    try { const push = app.locals.appstore?.push?.send || app.locals.push?.send; if (typeof push === "function" && prefs.push !== false) Promise.resolve(push(em, { title: subject, body: text, url: link, tag: key })).catch(() => {}); } catch {}
    const cfg = emailConfig(ws, false) || emailConfig(DEFAULT_WS, true); if (!cfg || (X?.canEmail && !X.canEmail(em))) return true;
    const origin = (typeof req?.get === "function" ? publicOrigin(req) : "") || process.env.ENCORE_PUBLIC_URL || "", h = C.profileOf(ws) || {};
    const unsub = `${origin}/api/public/club/unsub?h=${encodeURIComponent(h.handle || "")}&e=${encodeURIComponent(Buffer.from(em).toString("base64url"))}&t=${unsubToken(ws, em)}`;
    try { await sendEmail(cfg, { list: "guest", origin, brandWs: ws, to: em, subject, fromName: h.name || "Pottery Lab", text: `${body}\n\n${origin}${link}\n\n${club ? `You're in ${F.config(ws).name}.` : `You follow ${h.name || "this host"} on Pottery Lab.`} Stop these from ${h.name || "this host"}: ${unsub}\n` }); } catch {}
    return true; }
  /** A host published an event or a drop: members first (or only), followers when it opens to everyone. */
  async function onPublish(req, ws, id) { try {
    const S = F.S0(ws), ev = S.get("events/" + id)?.data, h = C.profileOf(ws); if (!ev || ev.example || ev.sample || ev.cancelled || !h?.handle || demo(ws)) return;
    const v = F.visOf(ws, id) || {}; if (v.toldAt) return;
    const today = new Date().toISOString().slice(0, 10); if (ev.date && ev.date < today) return;
    const c = F.config(ws), title = ev.pubTitle || ev.name || "Something new", kind = ev.drop ? "drop" : "event", link = `/e/${encodeURIComponent(id)}`;
    let earlyUntil = v.earlyUntil || 0;
    if (c.on && !v.only && !earlyUntil && c.earlyHours > 0 && v.early !== false) earlyUntil = Date.now() + c.earlyHours * 3600e3;
    S.set("clubevents/" + id, { ...v, earlyUntil: v.only ? v.earlyUntil || 0 : earlyUntil, toldAt: Date.now(), followersToldAt: 0 });
    const M = c.on ? F.membersOf(ws).filter((m) => !m.muted) : [], memberSet = new Set(M.map((m) => lc(m.email)));
    const until = earlyUntil ? new Date(earlyUntil).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
    for (const m of M) await tellOne(req, ws, m.email, { club: true, key: `club-${id}`, eventId: id, link, subject: v.only ? `Members only: ${title}` : `Early access: ${title}`,
      text: v.only ? `${c.name}: ${title}, for members only.` : earlyUntil ? `${c.name} first: ${title}. Open to members until ${until}.` : `${h.name}: ${title}`,
      body: v.only ? `${h.name} made a ${kind} for ${c.name} only: ${title}.` : earlyUntil ? `${h.name} has a new ${kind}: ${title}. ${c.name} get first dibs until ${until}, before it opens to everyone.` : `${h.name} has a new ${kind}: ${title}.` });
    if (v.only) return;
    if (earlyUntil > Date.now()) return; // followers hear when it opens (runJobs)
    await tellFollowers(req, ws, id, memberSet); } catch (e) { console.warn("[fanclub] publish", e?.message); } }
  async function tellFollowers(req, ws, id, skip = new Set()) { const S = F.S0(ws), ev = S.get("events/" + id)?.data, h = C.profileOf(ws) || {}; if (!ev || ev.cancelled) return 0;
    S.update("clubevents/" + id, { followersToldAt: Date.now() }); const title = ev.pubTitle || ev.name || "Something new", link = `/e/${encodeURIComponent(id)}`; let n = 0;
    for (const f of C.followersOf(ws)) { const em = lc(f.email); if (!em || skip.has(em) || f.notify === false) continue;
      if (await tellOne(req, ws, em, { key: `fol-${id}`, eventId: id, link, subject: `${h.name}: ${title}`, text: `${h.name} posted ${ev.drop ? "a drop" : "something new"}: ${title}`, body: `${h.name} has a new ${ev.drop ? "drop" : "event"}: ${title}.` })) n++; }
    return n; }
  /** Followers hear about members-first events once the window closes. */
  async function runJobs(now = Date.now()) { let told = 0;
    for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const S = F.S0(ws); let L = []; try { L = S.list("clubevents"); } catch { continue; }
      for (const d of L) { const v = d.data || {}; if (!v.toldAt || v.only || v.followersToldAt || !v.earlyUntil || v.earlyUntil > now) continue; const skip = new Set(F.membersOf(ws).map((m) => lc(m.email))); told += await tellFollowers({}, ws, d.id, skip); } }
    return { told }; }
  F.onPublish = onPublish; F.runJobs = runJobs; F.tellFollowers = tellFollowers;
  if (!process.env.NODE_TEST_CONTEXT) { const t = setInterval(() => runJobs().catch((e) => console.warn("[fanclub] jobs", e?.message)), 10 * 60e3); t.unref?.(); }

  /** Event writes (server/app.js writeDoc): a newly published event or drop tells members and followers; members-only stays off Discover. */
  const live = (e) => !!e && !e.example && !e.sample && !e.cancelled && !!(e.published || e.discoverable);
  F.onEventWrite = (req, ws, id, before, after) => { try { if (!ws || ws === DEFAULT_WS || !ID.test(id)) return; const v = F.visOf(ws, id);
    if (v?.only && after && (after.discoverable || !after.unlisted)) F.S0(ws).update("events/" + id, { discoverable: false, unlisted: true });
    if (live(after) && !live(before)) onPublish(req, ws, id); } catch (e) { console.warn("[fanclub] write", e?.message); } };
  /** Guest reads of an event (/api/db/doc): members-only needs a member; members-first says so. */
  F.readGate = (req, ws, id) => { const v = F.visOf(ws, id); if (!v) return null; const u = viewer(req), c = F.config(ws), h = C.profileOf(ws) || {};
    if (v.only && !(u && (u.ws === ws || F.canSee(ws, u.email)))) return { deny: { code: "club_only", message: `This event is for ${c.name} only.`, club: c.name, handle: h.handle || "", host: h.name || "" } };
    return { extra: { club: { name: c.name, handle: h.handle || "", only: !!v.only, earlyUntil: v.earlyUntil && v.earlyUntil > Date.now() ? v.earlyUntil : 0, member: !!u && F.isMember(ws, u.email) } } }; };

  // ---- the public host page: club summary, follow state, stats; members-only events stay with members; no paid tiers in the app ----
  app.use((req, res, next) => {
    const m = req.method === "GET" && /^\/api\/public\/host\/([^/]+)$/.exec(req.path); if (!m) return next();
    const send = res.json.bind(res), native = isNativeReq(req);
    res.json = (body) => { try { if (res.statusCode < 400 && body?.host?.handle && !body.host.showcase) { const ws = wsOf(body.host.handle); if (ws) body = enrich(req, ws, body); } if (native) body = stripPaid(body); } catch (e) { console.warn("[fanclub] host page", e?.message); } return send(body); };
    next(); });
  function enrich(req, ws, body) { const u = viewer(req), em = lc(u?.email), own = !!u && u.ws === ws, c = F.config(ws);
    const hidden = new Set(); for (const d of F.S0(ws).list("clubevents")) if (d.data?.only) { hidden.add(d.id); hidden.add("p-" + crypto.createHash("sha256").update(ws + "|" + d.id).digest("hex").slice(0, 16)); }
    const member = !!em && F.isMember(ws, em), see = own || member, early = (e) => { const v = F.visOf(ws, e.id); return v && !v.only && v.earlyUntil > Date.now() ? { ...e, clubEarlyUntil: v.earlyUntil } : e; };
    const upcoming = (body.upcoming || []).filter((e) => see || !hidden.has(e.id)).map(early), past = (body.past || []).filter((e) => see || !hidden.has(e.id));
    let T = {}; try { T = X?.trustOf?.(ws) || {}; } catch {}
    const stats = { ...(T.events ? { events: T.events } : {}), ...(T.guests ? { guests: T.guests } : {}), ...(T.again?.pct ? { againPct: T.again.pct } : {}) };
    const f = em ? F.followerDoc(ws, em) : null, md = em ? F.memberDoc(ws, em) : null;
    const clubEvents = see && c.on ? F.S0(ws).list("clubevents").filter((d) => d.data?.only).map((d) => ({ id: d.id, e: F.S0(ws).get("events/" + d.id)?.data })).filter((x) => x.e && !x.e.cancelled && (x.e.date || "9999") >= new Date().toISOString().slice(0, 10))
      .map(({ id, e }) => ({ id, title: e.pubTitle || e.name || "", date: e.date || "", startTime: e.startTime || "", hood: e.hood || "", city: e.city || "", coverPhoto: PHOTO_OK(e.coverPhoto) ? e.coverPhoto : "", activity: e.activity || "", emoji: e.emoji || "", clubOnly: true })) : [];
    return { ...body, upcoming, past, stats, club: c.on ? { on: true, name: c.name, pitch: c.pitch, perks: c.perks, earlyHours: c.earlyHours, members: F.membersOf(ws).length, posts: F.postsOf(ws).length } : { on: false },
      viewer: { signedIn: !!u, own, following: !!f && !f.pending, notify: !!f && f.notify !== false, member, since: member ? md.joinedAt : 0, showBadge: !!md?.showBadge, muted: !!md?.muted, removed: !!md?.removedAt, blocked: !!em && F.blocked(ws, em) },
      ...(see && c.on ? { clubEvents } : {}) }; }

  // ---- blocks reach the old follow endpoint too (server/community.js) ----
  app.post("/api/public/follow", small, (req, res, next) => { const ws = wsOf(req.body?.handle), u = viewer(req), em = lc(u?.email || req.body?.email);
    if (ws && em && F.blocked(ws, em)) return bad(res, "You can't follow this host.", 403, "blocked"); next(); });
  // paid tiers are web only: the app never pledges (App Store guideline 3.1.1; free at launch)
  app.post("/api/public/pledge", (req, res, next) => (isNativeReq(req) ? bad(res, "Supporting a host happens on the web. Everything in the app is free.", 403, "web_only") : next()));
  // club posts in the feed take a heart through the feed's own Cheer button
  app.post("/api/me/posts/:author/:id/cheer", small, (req, res, next) => { const a = String(req.params.author || ""); if (!a.startsWith("club.")) return next(); const u = me(req, res); if (!u) return;
    const ws = wsOf(a.slice(5)); if (!ws || !F.isMember(ws, u.email)) return bad(res, "That post is for members.", 403, "not_member"); const p = F.S0(ws).get("clubposts/" + clean(req.params.id, 40))?.data;
    const r = F.heart(ws, clean(req.params.id, 40), u.email, !(p?.hearts || []).includes(h24("heart|" + lc(u.email)))); if (!r) return bad(res, "No such post.", 404, "not_found"); res.json({ ok: true, cheered: r.hearted, hearts: r.hearts }); });

  // ---- following ----
  app.post("/api/me/following/:handle", small, (req, res) => { const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws || !C.profileOf(ws)) return bad(res, "No host by that name.", 404, "not_found");
    if (ws === u.ws) return bad(res, "That's your own page.");
    if (over("fol|" + lc(u.email), FOLLOW_PER_HOUR) || over("folip|" + (req.ip || "?"), FOLLOW_PER_HOUR * 3)) return bad(res, "That's a lot of follows. Try again later.", 429, "rate_limited");
    const b = req.body || {}, r = F.setFollow(ws, u.email, { on: b.on !== false, notify: typeof b.notify === "boolean" ? b.notify : undefined, name: u.name }); if (r.error) return bad(res, r.error, r.status, r.code);
    if (r.isNew) { try { scopeStore(store, ws).add("audit", { what: `${first(u.name) || "Someone"} followed you`, kind: "growth", at: Date.now() }); const o = F.owner(ws); if (o) X?.notify?.(o, { kind: "follower", key: "fol-" + h24(lc(u.email)).slice(0, 16), text: `${first(u.name) || "Someone new"} followed you. They'll hear first about your next event.`, link: `/@${C.profileOf(ws).handle}`, eventId: "" }); } catch {} }
    res.json({ ok: true, following: r.following, notify: r.notify, followers: C.followersOf(ws).length }); });
  app.get("/api/me/following", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json({ hosts: F.followedHosts(u.email), clubs: F.clubMemberships(u.email) }); });
  app.get("/api/me/club-updates", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json({ items: F.feedItems(u.email) }); });

  // ---- joining, leaving, a member's own settings ----
  app.post("/api/me/club/:handle/join", small, (req, res) => { const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    if (over("join|" + lc(u.email), JOIN_PER_HOUR) || over("joinip|" + (req.ip || "?"), JOIN_PER_HOUR * 3)) return bad(res, "That's a lot of joining. Try again in a bit.", 429, "rate_limited");
    if (demo(ws)) return bad(res, "This is an example host, so there's no club to join.", 403, "example");
    const r = F.join(ws, { email: u.email, name: u.name }); if (r.error) return bad(res, r.error, r.status, r.code);
    if (typeof req.body?.showBadge === "boolean") F.memberSettings(ws, u.email, { showBadge: req.body.showBadge });
    if (!r.already) { const o = F.owner(ws); try { if (o) X?.notify?.(o, { kind: "club", key: "join-" + h24(lc(u.email)).slice(0, 16), text: `${first(u.name) || "Someone"} joined ${F.config(ws).name}.`, link: `/@${C.profileOf(ws).handle}#club`, eventId: "" }); } catch {} }
    res.json({ ok: true, member: true, since: r.member.joinedAt, members: F.membersOf(ws).length, chatId: F.config(ws).chatId }); });
  app.post("/api/me/club/:handle/leave", small, (req, res) => { const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    F.leave(ws, u.email); res.json({ ok: true, member: false, members: F.membersOf(ws).length }); });
  app.post("/api/me/club/:handle/settings", small, (req, res) => { const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws) return bad(res, "No host by that name.", 404, "not_found");
    const r = F.memberSettings(ws, u.email, req.body || {}); if (!r) return bad(res, "You're not in this club.", 404, "not_member"); res.json({ ok: true, showBadge: !!r.showBadge, muted: !!r.muted }); });
  app.post("/api/me/club/:handle/posts/:id/heart", small, (req, res) => { const u = me(req, res); if (!u) return; const ws = wsOf(req.params.handle); if (!ws || !F.isMember(ws, u.email)) return bad(res, "That post is for members.", 403, "not_member");
    const r = F.heart(ws, clean(req.params.id, 40), u.email, req.body?.on !== false); if (!r) return bad(res, "No such post.", 404, "not_found"); res.json({ ok: true, ...r }); });
  // what members read: posts, members-only events, the chat. Non-members get the pitch and counts.
  app.get("/api/public/club/:handle", (req, res) => { const ws = wsOf(req.params.handle), h = ws && C.profileOf(ws); if (!h) return bad(res, "No host by that name.", 404, "not_found"); res.set("Cache-Control", "private, no-store");
    const c = F.config(ws), u = viewer(req), own = !!u && u.ws === ws, member = !!u && F.isMember(ws, u.email), md = u ? F.memberDoc(ws, u.email) : null;
    if (!c.on) return res.json({ club: { on: false }, own });
    const out = { club: { on: true, name: c.name, pitch: c.pitch, perks: c.perks, earlyHours: c.earlyHours, members: F.membersOf(ws).length, posts: F.postsOf(ws).length }, own, member, signedIn: !!u, blocked: !!u && F.blocked(ws, u.email), removed: !!md?.removedAt };
    if (member || own) Object.assign(out, { since: member ? md.joinedAt : 0, showBadge: !!md?.showBadge, muted: !!md?.muted, chatId: c.chatId, posts: F.postsOf(ws, { viewer: u.email }).slice(0, 30) });
    res.json(out); });
  // a person's own page: the clubs they chose to show ("Regular at Bo's since March")
  app.get("/api/public/badges/:handle", (req, res) => { const ws = wsOf(req.params.handle), o = ws && F.owner(ws); if (!o) return res.json({ clubs: [] });
    res.json({ clubs: F.clubMemberships(o).filter((c) => c.showBadge).map((c) => ({ handle: c.handle, host: c.host, club: c.club, since: c.firstSince || c.since })) }); });
  // one-click unsubscribe from one club's (or one host's) notices
  const unsubPage = (title, msg) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:440px;margin:60px auto;padding:0 16px;color:#1F1A17;background:#FBF8F3"><h1 style="font-size:22px">${title}</h1><p>${msg}</p></body>`;
  app.get("/api/public/club/unsub", (req, res) => { const ws = wsOf(req.query.h); let em = ""; try { em = Buffer.from(String(req.query.e || ""), "base64url").toString(); } catch {}
    const tok = ws && em ? unsubToken(ws, em) : "", got = String(req.query.t || ""); if (!ws || !tok || tok.length !== got.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(got))) return res.status(400).type("html").send(unsubPage("This link isn't working", "Open the link from your email again."));
    const h = C.profileOf(ws) || {}; F.memberSettings(ws, em, { muted: true }); if (F.followerDoc(ws, em)) F.S0(ws).update("followers/" + h24(lc(em)), { notify: false });
    res.type("html").send(unsubPage("You won't get these any more", `No more notices from ${String(h.name || "this host").replace(/[<>&"]/g, "")}. You still follow them and stay in their club. Turn them back on from their page.`)); });

  // ---- the host: settings, members, posts, event visibility ----
  app.get("/api/host/club", (req, res) => { const H = hostOf(req, res); if (!H) return; res.set("Cache-Control", "private, no-store"); const { ws } = H, A = F.attendance(ws), M = F.membersOf(ws);
    const members = M.map((m) => ({ id: m.id, name: first(m.name) || "Member", since: m.joinedAt, attended: A.get(lc(m.email)) || 0, badge: !!m.showBadge })).sort((a, b) => b.since - a.since);
    const today = new Date().toISOString().slice(0, 10);
    const events = F.S0(ws).list("events").map((d) => ({ id: d.id, e: d.data || {} })).filter(({ e }) => !e.example && !e.sample && !e.cancelled && (e.date || "9999") >= today && (e.name || e.pubTitle))
      .sort((a, b) => String(a.e.date || "9").localeCompare(String(b.e.date || "9"))).slice(0, 20).map(({ id, e }) => ({ id, title: e.pubTitle || e.name, date: e.date || "", drop: !!e.drop, visibility: F.visibility(ws, id), earlyUntil: F.visOf(ws, id)?.earlyUntil || 0 }));
    res.json({ club: F.config(ws), members, regulars: [...members].filter((m) => m.attended > 0).sort((a, b) => b.attended - a.attended || a.since - b.since).slice(0, 5), growth: F.growth(ws), followers: C.followersOf(ws).length, posts: F.postsOf(ws), events }); });
  app.post("/api/host/club", small, (req, res) => { const H = hostOf(req, res); if (!H) return; const r = F.setConfig(H.ws, req.body || {}); if (r.error) return bad(res, r.error); res.json({ ok: true, ...r }); });
  app.get("/api/host/club/members.csv", (req, res) => { const H = hostOf(req, res); if (!H) return; const A = F.attendance(H.ws), q = (s) => `"${String(s ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const rows = [["First name", "Member since", "Events attended", "Shows badge"], ...F.membersOf(H.ws).map((m) => [first(m.name) || "Member", new Date(m.joinedAt).toISOString().slice(0, 10), A.get(lc(m.email)) || 0, m.showBadge ? "yes" : "no"])];
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${H.h.handle}-members.csv"`, "Cache-Control": "private, no-store" }).send(rows.map((r) => r.map(q).join(",")).join("\n") + "\n"); });
  app.post("/api/host/club/members/:id/remove", small, (req, res) => { const H = hostOf(req, res); if (!H) return; const id = clean(req.params.id, 40), d = F.S0(H.ws).get("clubmembers/" + id)?.data; if (!d) return bad(res, "No such member.", 404, "not_found");
    F.leave(H.ws, d.email, { by: "host" }); res.json({ ok: true, members: F.membersOf(H.ws).length }); });
  app.post("/api/host/club/posts", small, async (req, res) => { const H = hostOf(req, res); if (!H) return; const { ws, h } = H; const c = F.config(ws); if (!c.on) return bad(res, "Turn on your fan club first.");
    if (over("post|" + ws, POST_PER_HOUR) || over("postd|" + ws, POST_PER_DAY, DAY)) return bad(res, "That's a lot of updates for now. Try again later.", 429, "rate_limited");
    const r = F.addPost(ws, { text: req.body?.text, photo: req.body?.photo }); if (r.error) return bad(res, r.error, 400, r.code || "invalid");
    const snippet = String(r.post.text || "Sent a photo").replace(/\s+/g, " ").slice(0, 90);
    for (const m of F.membersOf(ws).filter((m) => !m.muted)) await tellOne(req, ws, m.email, { club: true, key: `cpost-${r.post.id}`, link: `/@${h.handle}#club`, subject: `${h.name}: a note for ${c.name}`, text: `${h.name}: ${snippet}`, body: `${h.name} posted to ${c.name}:\n\n${r.post.text || "(a photo)"}` });
    res.json({ ok: true, post: r.post }); });
  app.delete("/api/host/club/posts/:id", (req, res) => { const H = hostOf(req, res); if (!H) return; const p = "clubposts/" + clean(req.params.id, 40); if (!F.S0(H.ws).get(p)) return bad(res, "No such post.", 404, "not_found"); F.S0(H.ws).update(p, { removedAt: Date.now() }); res.json({ ok: true }); });
  app.post("/api/host/club/events/:id", small, (req, res) => { const H = hostOf(req, res); if (!H) return; const id = clean(req.params.id, 80); if (!ID.test(id)) return bad(res, "No such event.", 404, "not_found");
    const r = F.setVisibility(H.ws, id, String(req.body?.visibility || "")); if (r.error) return bad(res, r.error, r.status || 400, r.code || "invalid");
    const ev = F.S0(H.ws).get("events/" + id)?.data; if (live(ev) && !F.visOf(H.ws, id)?.toldAt && r.visibility !== "everyone") onPublish(req, H.ws, id);
    res.json({ ok: true, ...r }); });
  return F;
}
