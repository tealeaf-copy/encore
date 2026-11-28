// ---- comments on feed cards ----
// Every feed card with Kudos has a thread: an upcoming event or interest check ("e:<id>"), a recap ("r:<id>"), a
// milestone ("m:<id>") and a fan club post ("club.<handle>|<post id>"). An event keeps one thread before and after its
// date, so "e:" and "r:" of the same event read the same comments. The thread is public, out in the open on the card:
// the feed carries the count, up to five kudos faces and the latest three comments; the whole conversation lives on
// the post page, /post/<e|r|m>/<id> or /post/c/<handle>/<post id> (public/post.html), which works signed out.
//
// Rules, in one place:
// - Who may read: anyone who may see the card (server/feedblend.js cardOf), signed in or not. A private event has no
//   card, so it has no thread; a members-only event or club post is for members and the host.
// - Who may write: the same people, signed in. Plain text, 500 characters, the strong language and contact details
//   filter (server/safety.js textProblem), and limits per person and per IP an hour (replies count the same).
// - Replies: one level. A comment may carry parent (kept as re: the id of a first-level comment in the same thread);
//   a reply to a reply joins the same first comment and names the person it answers (to, drawn as "@Maya"). The
//   comment answered has to be there, not removed, and visible to the person replying. A thread reads the same way
//   for everyone who may see the card and nobody else: a private or members-only card has no thread to read.
// - Names: a person's "Show my name on kudos and comments" setting (Settings; X.prefs socialName: everyone, the
//   default | follow: people they follow | hosts: only the card's host). Anyone else sees "A guest" and a plain face,
//   and no key to block by (the key is the email in base64). See feedblend.js nameShown.
// - Who may delete: the writer, and the host of the card (the page's owner or anyone in its workspace). A reply goes
//   on its own. A first comment with replies, deleted by its writer, leaves "Comment removed" in its place and the
//   replies stay; when the host removes someone's comment, or the team hides it, its replies go with it.
// - Report and block: a comment the team hid ("comment:<id>", "text:<hash>" or its writer "person:<key>") is gone for
//   everyone; a blocked person's comments (and kudos) are gone for the person who blocked them, and the blocker's
//   comments are gone for the person they blocked; a deleted account's are gone. Replies under a comment you can't see
//   are gone with it, and "@Maya" is left off when Maya is someone you can't see.
// - Notes (the inbox, X.notify): the host hears once per card an hour; the person answered hears "Maya replied to your
//   comment" (the link opens the post with that reply marked for a moment), the first comment's writer and the others
//   in that thread hear too. One note per thread an hour: while it is unread, later replies are folded into it ("Maya
//   and Jun replied"). Never for your own reply, never between two people where either blocked the other, never to
//   someone who can no longer see the card, and not when you muted the card's host or turned notes off in the Inbox.
// - Fun: a comment can be a GIF (server/gifs.js: only the provider's CDN) or one of our stickers, with or without words;
//   1 to 3 emoji alone are drawn larger (big); quick reactions on a comment (REACTIONS, one per person, block-aware,
//   POST /api/feed/comments/:id/react). The words still go through the filter. public/feedfun.js draws the pickers.
// - Freshness: kudos and comment writes bump the feed's generation (server/feedvisual.js), so the signed-out feed (a
//   minute's cache) is rebuilt; the page also asks /api/feed/social for fresh counts after it draws, and the service
//   worker drops its saved feed after a kudos or comment goes through (public/sw.js).
//
// Docs: system/feedcom-<hash of thread> { kind: "feedcomments", thread, list: [{ id, email, name, text, at, re?, to?, toName? }] };
// a removed first comment that still has replies is kept as { id, at, del: 1 }.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WS, getDbUser } from "./workspaces.js";
import { textProblem, textHash, keyOf } from "./safety.js";
import { cleanGif, cleanSticker, mountGifs } from "./gifs.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const hashKey = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 20);
const hash24 = (s) => crypto.createHash("sha256").update(lc(s)).digest("hex").slice(0, 24); // the inbox's own key (server/inbox.js)
export const COMMENT_MAX = 500, THREAD_MAX = 500, PREVIEW = 3;
/** Quick reactions on a comment: one per person per comment (the card's Kudos stays the post-level one). */
export const REACTIONS = ["heart", "laugh", "wow", "clap", "fire", "sad"];
/** One thread per event (before and after its date); every other card has its own. */
export const threadKey = (target) => { const m = /^[er]:([A-Za-z0-9_-]{1,80})$/.exec(String(target || "")); return m ? "ev:" + m[1] : String(target || ""); };
/** The words as they are kept: plain text, no control characters, single blank lines at most. */
export const tidy = (t) => String(t ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const SEG = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
/** A comment that is only one to three emoji (drawn a little larger, like a sticker). */
export const emojiOnly = (t) => { const s = String(t || "").replace(/\s+/g, ""); if (!s || s.length > 48) return false;
  const G = SEG ? [...SEG.segment(s)].map((x) => x.segment) : [...s];
  return G.length >= 1 && G.length <= 3 && G.every((g) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g) && !/[\p{L}\p{N}]/u.test(g.replace(/[\u{1F3FB}-\u{1F3FF}⃣️]/gu, ""))); };
/** The post page for a card: /post/e/<id>, /post/r/<id>, /post/m/<id>, /post/c/<handle>/<post id> ("" when it isn't a card). */
export const postPath = (target) => { const s = String(target || ""); let m = /^([erm]):([A-Za-z0-9_-]{1,80})$/.exec(s); if (m) return `/post/${m[1]}/${m[2]}`;
  m = /^club\.([a-z0-9][a-z0-9-]{1,29})\|([A-Za-z0-9_-]{1,40})$/.exec(s); return m ? `/post/c/${m[1]}/${m[2]}` : ""; };
/** The target a post page names. */
export const targetOfPost = (kind, a, b = "") => (kind === "c" ? `club.${lc(a)}|${b}` : /^[erm]$/.test(kind) ? `${kind}:${a}` : "");

export function makeCommentStore(store, { X = null, safety = () => null, who = null } = {}) {
  const path = (target) => "system/feedcom-" + hashKey("c:" + threadKey(target));
  const raw = (target) => store.get(path(target))?.data?.list || [];
  const save = (target, L) => store.set(path(target), { kind: "feedcomments", thread: threadKey(target), list: L });
  const hiddenSet = () => { try { return safety()?.hiddenSet() || new Set(); } catch { return new Set(); } };
  const gone = (c, hid) => hid.has("comment:" + c.id) || (!!c.text && hid.has("text:" + textHash(c.text))) || hid.has("person:" + keyOf(c.email));
  const here = (email) => { try { return !X?.userOf || !!X.userOf(email); } catch { return true; } };
  const blocksOf = (em) => { try { return safety()?.blocksOf(em) || []; } catch { return []; } };
  const body = (c) => !!(c.text || c.gif || c.sticker);
  /** The comments this viewer may see, oldest first: a removed first comment stays (del) while replies under it show; replies under a comment the viewer can't see are left out. v: { email, blocks: Set of block targets }. */
  function visible(target, v = {}) { const hid = hiddenSet(), blocks = v.blocks || new Set(), R = raw(target).filter((c) => c && c.id), byId = new Map(R.map((c) => [c.id, c])), meKey = v.email ? "person:" + keyOf(v.email) : "", back = new Map();
    const blockedMe = (em) => { if (!meKey || !em || lc(em) === lc(v.email)) return false; if (!back.has(em)) back.set(em, blocksOf(em).some((b) => b.target === meKey)); return back.get(em); };
    const seen = (c) => body(c) && !gone(c, hid) && !blocks.has("person:" + keyOf(c.email)) && !blockedMe(c.email) && here(c.email);
    const L = R.filter((c) => { const p = c.re ? byId.get(c.re) : null; if (c.del) return !hid.has("comment:" + c.id); return (!p || (p.del ? !hid.has("comment:" + p.id) : seen(p))) && seen(c); });
    const kids = new Set(L.map((c) => c.re).filter(Boolean)); return L.filter((c) => !c.del || kids.has(c.id)); }
  /** Is this comment a reply (its first comment is still in the thread)? An old reply whose first comment is long gone reads as a first comment. */
  const parentOf = (target, c) => (c?.re ? raw(target).find((x) => x.id === c.re) || null : null);
  const nameOf = (c) => { let n = ""; try { n = first(X?.person?.(c.email)?.name); } catch {} return n || first(c.name) || "Someone"; };
  /** The writer as this viewer may see them (feedblend.js personFor), or by first name when there's no rule to ask. */
  const writer = (v, c, ctx) => { if (who) try { return who(v, c.email, ctx, c.name); } catch {} let p = {}; try { p = X?.person?.(c.email) || {}; } catch {} const n = nameOf(c); return { name: n, face: { i: n.slice(0, 1).toUpperCase(), c: /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "" } }; };
  /** The reactions on a comment as this viewer sees them: [{ r, n, mine? }] in REACTIONS order; blocked people don't count. */
  function rxOf(c, v = {}) { const me = lc(v.email), blocks = v.blocks || new Set(), N = new Map(), mine = new Set();
    for (const x of Object.values(c.rx || {})) { if (!x || !REACTIONS.includes(x.r) || (x.e && blocks.has("person:" + keyOf(x.e)))) continue; N.set(x.r, (N.get(x.r) || 0) + 1); if (me && x.e === me) mine.add(x.r); }
    return REACTIONS.filter((r) => N.get(r)).map((r) => ({ r, n: N.get(r), ...(mine.has(r) ? { mine: true } : {}) })); }
  /** The person a reply to a reply answers, as this viewer may see them: { to: { name, guest?, mine?, href? } }; left off when they are someone the viewer can't see. */
  function toOf(c, v, ctx) { const em = lc(c.to); if (!em) return {}; if (em === lc(v.email)) return { to: { name: "you", mine: true } };
    if ((v.blocks || new Set()).has("person:" + keyOf(em)) || hiddenSet().has("person:" + keyOf(em)) || !here(em) || (v.email && blocksOf(em).some((b) => b.target === "person:" + keyOf(v.email)))) return {};
    const P = writer(v, { email: em, name: c.toName }, ctx); if (P.guest) return { to: { name: "A guest", guest: true } };
    let h = ""; try { h = lc(X?.person?.(em)?.handle || ""); } catch {} return { to: { name: P.name, ...(/^[a-z0-9][a-z0-9-]{1,29}$/.test(h) ? { href: "/@" + h } : {}) } }; }
  /** One comment as the page draws it. */
  function shape(c, v, ctx = {}) { const me = lc(v.email), mine = !!me && lc(c.email) === me, P = writer(v, c, ctx), rx = rxOf(c, v);
    return { id: c.id, name: P.name, text: c.text || "", at: c.at || 0, face: P.face, ...(P.guest ? { guest: true } : {}), ...(mine ? { mine: true } : {}), ...(ctx.owner && lc(c.email) === lc(ctx.owner) ? { host: true } : {}), ...(c.re ? { re: c.re, parent: c.re } : {}), ...toOf(c, v, ctx),
      ...(c.gif ? { gif: c.gif } : {}), ...(c.sticker ? { sticker: c.sticker } : {}), ...(c.text && emojiOnly(c.text) ? { big: true } : {}), ...(rx.length ? { rx } : {}) }; }
  const live = (L) => L.filter((c) => !c.del);
  /** What a card carries: how many (replies count), and the latest three first comments, oldest of the three first, each with how many replies it has. ctx: the card's { owner, ws }. */
  function summary(target, v = {}, ctx = {}) { const L = visible(target, v), ids = new Set(L.map((c) => c.id)), n = new Map(); for (const c of L) if (c.re && ids.has(c.re)) n.set(c.re, (n.get(c.re) || 0) + 1);
    return { count: live(L).length, last: L.filter((c) => !c.del && !(c.re && ids.has(c.re))).slice(-PREVIEW).map((c) => ({ ...shape(c, v, ctx), text: String(c.text || "").replace(/\s+/g, " ").slice(0, 280), ...(n.get(c.id) ? { replies: n.get(c.id) } : {}) })) }; }
  /** The whole thread for the post page, oldest first; a reply carries parent, a removed first comment is { id, at, gone }. host: may this viewer delete any comment here? owner/ws: the card's host. */
  function thread(target, v = {}, { host = false, owner = "", ws = "", limit = THREAD_MAX } = {}) { const L = visible(target, v);
    return { count: live(L).length, comments: L.slice(-limit).map((c) => { if (c.del) return { id: c.id, at: c.at || 0, gone: true, ...(host ? { canDelete: true } : {}) }; const x = shape(c, v, { owner, ws }); return { ...x, ...(x.mine || x.guest ? {} : { key: keyOf(c.email) }), canDelete: !!x.mine || host }; }) }; }
  /** extra: { gif } (server/gifs.js cleanGif) or { sticker } (an id from STICKERS). */
  function add(target, { email, name = "" }, text, re = "", extra = {}) { const L = raw(target).slice(-(THREAD_MAX - 1)), c = { id: crypto.randomBytes(9).toString("base64url"), email: lc(email), name: first(name), text, at: Date.now(), ...(re ? { re } : {}), ...(extra.to ? { to: lc(extra.to), toName: first(extra.toName) } : {}), ...(extra.gif ? { gif: extra.gif } : {}), ...(extra.sticker ? { sticker: extra.sticker } : {}) };
    L.push(c); save(target, L); return c; }
  const find = (target, id) => raw(target).find((c) => c.id === id) || null;
  /** Take a comment out. A reply goes on its own (and a removed first comment with it once no reply is left). A first comment with replies: all = false keeps "Comment removed" in its place, all = true takes the replies too. Returns { ids: [gone ids], kept: left as "Comment removed"? } or null. */
  function remove(target, id, { all = false } = {}) { let L = raw(target); const c = L.find((x) => x.id === id); if (!c) return null; const kids = L.filter((x) => x.re === id).map((x) => x.id);
    if (kids.length && !all && !c.del) { save(target, L.map((x) => (x.id === id ? { id, at: x.at || 0, del: 1 } : x))); return { ids: [], kept: true }; }
    const out = new Set([id, ...(kids.length ? kids : [])]); L = L.filter((x) => !out.has(x.id));
    if (c.re) { const p = L.find((x) => x.id === c.re); if (p?.del && !L.some((x) => x.re === p.id)) { L = L.filter((x) => x.id !== p.id); out.add(p.id); } }
    save(target, L); return { ids: [...out], kept: false }; }
  /** One reaction per person per comment: the same one again takes it back, another one replaces it. Returns the comment. */
  function react(target, id, email, r) { const L = raw(target), c = L.find((x) => x.id === id); if (!c || c.del || !REACTIONS.includes(r)) return null; const k = hashKey("rx:" + lc(email));
    c.rx = { ...(c.rx || {}) }; if (c.rx[k]?.r === r) delete c.rx[k]; else c.rx[k] = { r, e: lc(email), at: Date.now() };
    const ks = Object.keys(c.rx); if (ks.length > 2000) for (const x of ks.slice(0, ks.length - 2000)) delete c.rx[x]; save(target, L); return c; }
  /** Did this person mute the card's host in their Inbox, or turn notes off? (server/inbox.js keeps both) */
  const muted = (email, handle) => { try { const d = store.get("system/inboxprefs-" + hash24(email))?.data || {}; return (!!handle && (d.mutedHosts || []).some((m) => lc(m.handle) === lc(handle))) || (d.offTypes || []).includes("note"); } catch { return false; } };
  /** A note about a thread, one per key: while the first is unread, the next person is folded into it ("Maya and Jun replied ..."). who: the sender's name as this reader sees it; line(names) writes the words. */
  function note(to, key, { from, who, line, link, eventId = "" }) { const p = "system/inbox-" + hash24(to), d = store.get(p)?.data, i = (d?.list || []).findIndex((x) => x.key === key), it = i >= 0 ? d.list[i] : null, k = hashKey("by:" + lc(from));
    if (it && !it.read && Array.isArray(it.by)) { const by = [k, ...it.by.filter((x) => x !== k)].slice(0, 50), names = [who, ...(it.byNames || []).filter((x) => x !== who)].slice(0, 3), L = d.list.slice(); L.splice(i, 1);
      L.unshift({ ...it, at: Date.now(), by, byNames: names, text: line(names, by.length), from: lc(from), link }); store.set(p, { ...d, list: L }); return true; }
    try { return X.notify(to, { kind: "comment", key: it ? `${key}-${Date.now().toString(36)}` : key, text: line([who], 1), from: lc(from), link, by: [k], byNames: [who], ...(eventId ? { eventId } : {}) }) !== false; } catch { return false; } }
  return { summary, thread, visible, add, parentOf, note, find, remove, react, rxOf, path, raw, muted };
}

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function mountFeedComments(app, { small, currentUser, X, sendHtml = (req, res, html) => res.type("html").send(html) }) {
  const B = app.locals.feedBlend; if (!B) throw new Error("feed comments need the feed blend mounted first");
  const CS = B.comments;
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS && u.email ? u : null; } catch { return null; } };
  const hits = new Map(); const over = (k, n) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 50000) hits.clear(); return ++h.n > n; };
  const perIp = () => Math.max(1, +process.env.ENCORE_FEED_COMMENTS_PER_IP_HOUR || 60), perWho = () => Math.max(1, +process.env.ENCORE_FEED_COMMENTS_PER_HOUR || 30), readsPerIp = () => Math.max(60, +process.env.ENCORE_FEED_PER_IP_HOUR || 1200);
  const targetOf = (v) => String(v || "").slice(0, 120);
  // the card behind a target, for this viewer; an event answers to "e:" and "r:" alike so a link keeps working after the date
  function open(req, target) { const u = viewer(req), v = B.viewerOf({ email: u ? u.email : "", ws: u ? u.ws : "" });
    const m = /^([er]):(.+)$/.exec(target), card = B.cardOf(target, v) || (m ? B.cardOf((m[1] === "e" ? "r:" : "e:") + m[2], v) : null);
    return { u, v, card, host: !!(u && card && (lc(card.owner) === lc(u.email) || (card.ws && card.ws === u.ws))) }; }
  const blockedBy = (owner, email) => { try { return (app.locals.appstore?.safety?.blocksOf(owner) || []).some((b) => b.target === "person:" + keyOf(email)); } catch { return false; } };
  // a person as someone else sees them in a note: the same name rule as the card, from where the reader stands
  const nameFor = (reader, email, card, fallback) => { let ws = ""; try { ws = getDbUser(lc(reader))?.ws || ""; } catch {} try { return B.nameShown({ email: lc(reader), ws }, email, card) ? fallback : "Someone"; } catch { return fallback; } };
  // may this person still see the card? (a note about a reply carries its words)
  const canSee = (email, target) => { try { let ws = ""; try { ws = getDbUser(lc(email))?.ws || ""; } catch {} const v = B.viewerOf({ email: lc(email), ws }), m = /^([er]):(.+)$/.exec(target); return !!(B.cardOf(target, v) || (m && B.cardOf((m[1] === "e" ? "r:" : "e:") + m[2], v))); } catch { return false; } };
  const snip = (t) => `${t.replace(/\s+/g, " ").slice(0, 80)}${t.length > 80 ? "…" : ""}`;

  // read a thread: anyone who can see the card
  app.get("/api/feed/comments", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|r|" + (req.ip || "?"), readsPerIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const target = targetOf(req.query.target), { u, v, card, host } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    res.json({ target, title: card.title, ...CS.thread(target, v, { host, owner: card.owner, ws: card.ws }), canPost: !!u, host, chat: card.chat || "", max: COMMENT_MAX, path: postPath(card.target) }); });
  // write one: signed in, and only where you can see the card; parent (or re): the comment it answers (one level)
  app.post("/api/feed/comments", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|w|" + (req.ip || "?"), perIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const u0 = viewer(req); if (!u0) return bad(res, "Sign in to comment.", 401, "unauthenticated");
    const target = targetOf(req.body?.target), { u, v, card, host } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    // words, a GIF from the provider's CDN (server/gifs.js) or one of our stickers; the words still go through the filter
    const text = tidy(typeof req.body?.text === "string" ? req.body.text : ""), gif = req.body?.gif ? cleanGif(req.body.gif) : null, sticker = req.body?.sticker ? cleanSticker(req.body.sticker) : "";
    if (req.body?.gif && !gif) return bad(res, "That GIF can't be used here. Pick another one.", 400, "bad_gif");
    if (req.body?.sticker && !sticker) return bad(res, "That sticker isn't one of ours.", 400, "bad_sticker");
    if (!text && !gif && !sticker) return bad(res, "Write something first.");
    if ([...text].length > COMMENT_MAX) return bad(res, `Keep it under ${COMMENT_MAX} characters.`, 400, "too_long");
    const p = text ? textProblem(text, { contact: true }) : null; if (p) return bad(res, p.code === "contact_info" ? "Keep phone numbers and emails out of comments. Everyone who sees this post can read them." : p.message, 400, p.code);
    const words = text || (gif ? "sent a GIF" : "sent a sticker");
    // a reply: the comment answered must be here, not removed, and visible to this person; a reply to a reply joins the same first comment and names who it answers
    let parent = null, direct = null; const pid = req.body?.parent ?? req.body?.re;
    if (pid) { direct = CS.find(target, String(pid).slice(0, 40)); if (!direct || direct.del || !CS.visible(target, v).some((c) => c.id === direct.id)) return bad(res, "That comment isn't here any more.", 404, "not_found"); parent = CS.parentOf(target, direct) || direct; }
    if (over("who|w|" + lc(u.email), perWho())) return bad(res, "That's a lot of comments for one hour. Try again in a bit.", 429, "rate_limited");
    let name = ""; try { name = first(X.person(u.email).name) || first(u.name); } catch {}
    const me = lc(u.email), answers = direct && direct !== parent && lc(direct.email) !== me ? direct : null;
    const c = CS.add(target, { email: u.email, name }, text, parent?.id || "", { gif, sticker, ...(answers ? { to: answers.email, toName: answers.name } : {}) }), owner = lc(card.owner), hour = Math.floor(Date.now() / 3600e3), link = postPath(card.target) + "#c-" + c.id, hostH = B.hostHandle(card.ws);
    const ok = (to) => to && to !== me && !blockedBy(to, me) && !blockedBy(me, to) && !CS.muted(to, hostH) && canSee(to, target);
    // a reply: the person it answers, the first comment's writer and everyone else who replied there, one note per thread an hour
    const told = new Set();
    if (parent) { const ans = lc(direct.email), top = parent.del ? "" : lc(parent.email), R = new Set([ans, top, ...CS.raw(target).filter((x) => x.re === parent.id).map((x) => lc(x.email))]), tail = `on ${card.title}: "${snip(words)}"`, and = (N, n) => (n <= 1 ? N[0] : n === 2 && N[1] ? `${N[0]} and ${N[1]}` : `${N[0]} and ${n - 1} other${n === 2 ? "" : "s"}`);
      for (const to of R) { if (!ok(to)) continue; const verb = to === ans ? "replied to your comment" : to === top ? "replied under your comment" : "also replied";
        if (CS.note(to, `fcre-${hashKey(threadKey(target) + "|" + parent.id)}-${hour}`, { from: me, who: nameFor(to, me, card, name || "Someone"), line: (N, n) => `${and(N, n)} ${verb} ${tail}`, link, eventId: card.eventId || "" })) told.add(to); } }
    // the host hears once per card an hour, never about their own comment (and not twice when the reply was to them)
    try { if (owner && ok(owner) && !told.has(owner)) X.notify(owner, { kind: "comment", key: `fcom-${hashKey(threadKey(target))}-${hour}`, text: `${name || "Someone"} commented on ${card.title}: "${snip(words)}"`, from: me, link: postPath(card.target), ...(card.eventId ? { eventId: card.eventId } : {}) }); } catch {}
    const T = CS.thread(target, v, { host, owner: card.owner, ws: card.ws });
    res.json({ ok: true, target, comment: T.comments.find((x) => x.id === c.id) || null, count: T.count, summary: CS.summary(target, v, card) }); });
  // a quick reaction on a comment: signed in, where you can see the comment; one per person, the same again takes it back
  app.post("/api/feed/comments/:id/react", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|x|" + (req.ip || "?"), perIp() * 4)) return bad(res, "Slow down.", 429, "rate_limited");
    const u0 = viewer(req); if (!u0) return bad(res, "Sign in to react.", 401, "unauthenticated");
    const target = targetOf(req.body?.target), { u, v, card } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    const r = String(req.body?.r || ""); if (!REACTIONS.includes(r)) return bad(res, "Pick one of the reactions.");
    const id = String(req.params.id || "").slice(0, 40); if (!CS.visible(target, v).some((c) => c.id === id && !c.del)) return bad(res, "No such comment.", 404, "not_found"); // a blocked writer's comment isn't there for you
    if (over("who|x|" + lc(u.email), perWho() * 4)) return bad(res, "That's a lot of reactions for one hour.", 429, "rate_limited");
    const c = CS.react(target, id, u.email, r); if (!c) return bad(res, "No such comment.", 404, "not_found");
    res.json({ ok: true, target, id, reactions: CS.rxOf(c, v) }); });
  mountGifs(app); // GIF search or our stickers for the GIF button (server/gifs.js)
  // take one back: your own, or any on a post you host
  app.delete("/api/feed/comments/:id", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|w|" + (req.ip || "?"), perIp() * 2)) return bad(res, "Slow down.", 429, "rate_limited");
    const u0 = viewer(req); if (!u0) return bad(res, "Sign in first.", 401, "unauthenticated");
    const target = targetOf(req.query.target || req.body?.target), { u, v, card, host } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    const c = CS.find(target, String(req.params.id || "").slice(0, 40)); if (!c) return bad(res, "No such comment.", 404, "not_found");
    const mine = !c.del && lc(c.email) === lc(u.email); if (!mine && !host) return bad(res, c.del ? "No such comment." : "You can delete your own comments.", c.del ? 404 : 403, c.del ? "not_found" : "not_granted");
    // your own first comment leaves "Comment removed" over its replies; a host removing someone's comment (or asking to, thread=1) takes the replies too
    const out = CS.remove(target, c.id, { all: host && (!mine || String(req.query.thread || req.body?.thread || "") === "1") }) || { ids: [], kept: false };
    const S = CS.summary(target, v, card); res.json({ ok: true, target, count: S.count, summary: S, removed: out.ids, kept: out.kept }); });
  // fresh counts for the cards on screen (the feed itself may be a minute old, or a saved copy on a slow connection)
  app.get("/api/feed/social", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|r|" + (req.ip || "?"), readsPerIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const u = viewer(req), v = B.viewerOf({ email: u ? u.email : "", ws: u ? u.ws : "" }), memo = {}, items = {};
    for (const t of [...new Set(String(req.query.targets || "").split(",").map(targetOf).filter(Boolean))].slice(0, 40)) { const card = B.cardOf(t, v, memo); if (card) items[t] = { kudos: B.kudosFor(v, card), comments: CS.summary(t, v, card) }; }
    res.json({ items }); });

  // ---- the post page: the card on top, everyone who gave kudos, every comment and the box to add one ----
  /** Everything the post page draws, for this viewer (or null when they may not see the card). */
  function postFor(req, target) { const { u, v, card, host } = open(req, target); if (!card) return null; const got = B.itemOf(card.target, v); if (!got) return null;
    const T = CS.thread(card.target, v, { host, owner: card.owner, ws: card.ws });
    return { target: card.target, path: postPath(card.target), title: card.title, kind: card.kind, item: got.item, kudos: { ...B.kudosFor(v, card), people: card.kind === "club" ? [] : B.kudosPeople(v, card) },
      ...T, canPost: !!u, signedIn: !!u, host, chat: card.chat || "", max: COMMENT_MAX, ...(u ? { me: B.myFace(v) } : {}) }; }
  app.get("/api/feed/post", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|r|" + (req.ip || "?"), readsPerIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const P = postFor(req, targetOf(req.query.target)); if (!P) return bad(res, "No such post.", 404, "not_found"); res.json(P); });
  let pageHtml = "", notFound = "";
  const read = (f) => { try { return fs.readFileSync(path.join(PUBLIC_DIR, f), "utf8"); } catch { return ""; } };
  // the page carries its own first answer (the same as /api/feed/post), so the card and the thread draw in the first pass
  function page(req, res, target) {
    if (over("ip|r|" + (req.ip || "?"), readsPerIp())) return res.status(429).type("text").send("Slow down.");
    const P = /^(e|r|m|club\.)/.test(target) ? postFor(req, target) : null;
    if (!P) { notFound ||= read("404.html") || "<!doctype html><title>Not found</title><p>Page not found.</p>"; res.status(404); return sendHtml(req, res, notFound); }
    if (!pageHtml || process.env.NODE_ENV !== "production") pageHtml = read("post.html");
    const title = `${P.title} | Pottery Lab`, desc = [P.kudos.line, P.count ? `${P.count} comment${P.count === 1 ? "" : "s"}` : ""].filter(Boolean).join(". ") || "Kudos and comments on Pottery Lab.";
    const data = JSON.stringify(P).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");
    sendHtml(req, res, pageHtml.replace("<title>Post | Pottery Lab</title>", () => `<title>${escHtml(title)}</title><meta name="description" content="${escHtml(desc)}"><meta property="og:title" content="${escHtml(P.title)}"><meta property="og:description" content="${escHtml(desc)}">`)
      .replace('<script id="postData" type="application/json">null</script>', () => `<script id="postData" type="application/json">${data}</script>`)); }
  app.get("/post/:kind/:id", (req, res) => page(req, res, targetOf(targetOfPost(String(req.params.kind), String(req.params.id)))));
  app.get("/post/c/:handle/:id", (req, res) => page(req, res, targetOf(targetOfPost("c", String(req.params.handle), String(req.params.id)))));
}
// ---- end comments on feed cards ----
