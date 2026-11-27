// ---- comments on feed cards ----
// Every feed card with Kudos has a small thread under it: an upcoming event or interest check ("e:<id>"), a recap
// ("r:<id>"), a milestone ("m:<id>") and a fan club post ("club.<handle>|<post id>"). An event keeps one thread
// before and after its date, so "e:" and "r:" of the same event read the same comments.
//
// Rules, in one place:
// - Who may read: anyone who may see the card (server/feedblend.js cardOf). A private event has no card, so it has
//   no thread; a members-only event or club post is for members and the host.
// - Who may write: the same people, signed in. Plain text, 500 characters, the strong language and contact details
//   filter (server/safety.js textProblem), and limits per person and per IP an hour.
// - Who may delete: the writer, and the host of the card (the page's owner or anyone in its workspace).
// - Report and block: a comment the team hid ("comment:<id>", "text:<hash>" or its writer "person:<key>") is gone for
//   everyone; a blocked person's comments are gone for the person who blocked them; a deleted account's are gone.
// - The host hears through the inbox (X.notify), one line per card an hour, never for their own comment and never
//   from someone they blocked.
//
// Docs: system/feedcom-<hash of thread> { kind: "feedcomments", thread, list: [{ id, email, name, text, at }] }.
import crypto from "node:crypto";
import { DEFAULT_WS } from "./workspaces.js";
import { textProblem, textHash, keyOf } from "./safety.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const hashKey = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 20);
export const COMMENT_MAX = 500, THREAD_MAX = 500;
/** One thread per event (before and after its date); every other card has its own. */
export const threadKey = (target) => { const m = /^[er]:([A-Za-z0-9_-]{1,80})$/.exec(String(target || "")); return m ? "ev:" + m[1] : String(target || ""); };
/** The words as they are kept: plain text, no control characters, single blank lines at most. */
export const tidy = (t) => String(t ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export function makeCommentStore(store, { X = null, safety = () => null } = {}) {
  const path = (target) => "system/feedcom-" + hashKey("c:" + threadKey(target));
  const raw = (target) => store.get(path(target))?.data?.list || [];
  const hiddenSet = () => { try { return safety()?.hiddenSet() || new Set(); } catch { return new Set(); } };
  const gone = (c, hid) => hid.has("comment:" + c.id) || hid.has("text:" + textHash(c.text)) || hid.has("person:" + keyOf(c.email));
  const here = (email) => { try { return !X?.userOf || !!X.userOf(email); } catch { return true; } };
  /** The comments this viewer may see, oldest first. v: { email, blocks: Set of block targets }. */
  function visible(target, v = {}) { const hid = hiddenSet(), blocks = v.blocks || new Set();
    return raw(target).filter((c) => c && c.id && c.text && !gone(c, hid) && !blocks.has("person:" + keyOf(c.email)) && here(c.email)); }
  const nameOf = (c) => { let n = ""; try { n = first(X?.person?.(c.email)?.name); } catch {} return n || first(c.name) || "Someone"; };
  /** What a card carries: how many, and the latest two as a quiet preview. */
  function summary(target, v = {}) { const L = visible(target, v), me = lc(v.email);
    return { count: L.length, last: L.slice(-2).map((c) => ({ name: nameOf(c), text: c.text.replace(/\s+/g, " ").slice(0, 140), ...(me && lc(c.email) === me ? { mine: true } : {}) })) }; }
  /** The whole thread for the sheet. host: may this viewer delete any comment here? owner: the host's email. */
  function thread(target, v = {}, { host = false, owner = "", limit = 200 } = {}) { const L = visible(target, v), me = lc(v.email);
    return { count: L.length, comments: L.slice(-limit).map((c) => { const mine = !!me && lc(c.email) === me; let p = {}; try { p = X?.person?.(c.email) || {}; } catch {}
      return { id: c.id, name: nameOf(c), text: c.text, at: c.at || 0, mine, ...(owner && lc(c.email) === lc(owner) ? { host: true } : {}), ...(mine ? {} : { key: keyOf(c.email) }), canDelete: mine || host, face: { emoji: p.emoji || "", color: p.color || "" } }; }) }; }
  function add(target, { email, name = "" }, text) { const L = raw(target).slice(-(THREAD_MAX - 1)), c = { id: crypto.randomBytes(9).toString("base64url"), email: lc(email), name: first(name), text, at: Date.now() };
    L.push(c); store.set(path(target), { kind: "feedcomments", thread: threadKey(target), list: L }); return c; }
  const find = (target, id) => raw(target).find((c) => c.id === id) || null;
  function remove(target, id) { const L = raw(target), next = L.filter((c) => c.id !== id); if (next.length === L.length) return false; store.set(path(target), { kind: "feedcomments", thread: threadKey(target), list: next }); return true; }
  return { summary, thread, visible, add, find, remove, path };
}

export function mountFeedComments(app, { small, currentUser, X }) {
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

  // read a thread: anyone who can see the card
  app.get("/api/feed/comments", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|r|" + (req.ip || "?"), readsPerIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const target = targetOf(req.query.target), { u, v, card, host } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    res.json({ target, title: card.title, ...CS.thread(target, v, { host, owner: card.owner }), canPost: !!u, host, chat: card.chat || "", max: COMMENT_MAX }); });
  // write one: signed in, and only where you can see the card
  app.post("/api/feed/comments", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|w|" + (req.ip || "?"), perIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const u0 = viewer(req); if (!u0) return bad(res, "Sign in to comment.", 401, "unauthenticated");
    const target = targetOf(req.body?.target), { u, v, card, host } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    const text = tidy(typeof req.body?.text === "string" ? req.body.text : ""); if (!text) return bad(res, "Write something first.");
    if ([...text].length > COMMENT_MAX) return bad(res, `Keep it under ${COMMENT_MAX} characters.`, 400, "too_long");
    const p = textProblem(text, { contact: true }); if (p) return bad(res, p.code === "contact_info" ? "Keep phone numbers and emails out of comments. Everyone who sees this post can read them." : p.message, 400, p.code);
    if (over("who|w|" + lc(u.email), perWho())) return bad(res, "That's a lot of comments for one hour. Try again in a bit.", 429, "rate_limited");
    let name = ""; try { name = first(X.person(u.email).name) || first(u.name); } catch {}
    const c = CS.add(target, { email: u.email, name }, text), owner = lc(card.owner);
    // the host hears once per card an hour, never about their own comment
    try { if (owner && owner !== lc(u.email) && !blockedBy(owner, u.email)) X.notify(owner, { kind: "comment", key: `fcom-${hashKey(threadKey(target))}-${Math.floor(Date.now() / 3600e3)}`, text: `${name || "Someone"} commented on ${card.title}: "${text.replace(/\s+/g, " ").slice(0, 80)}${text.length > 80 ? "…" : ""}"`, from: lc(u.email), link: "/feed?comments=" + encodeURIComponent(target) }); } catch {}
    const T = CS.thread(target, v, { host, owner: card.owner });
    res.json({ ok: true, target, comment: T.comments.find((x) => x.id === c.id) || null, count: T.count, summary: CS.summary(target, v) }); });
  // take one back: your own, or any on a post you host
  app.delete("/api/feed/comments/:id", small, (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|w|" + (req.ip || "?"), perIp() * 2)) return bad(res, "Slow down.", 429, "rate_limited");
    const u0 = viewer(req); if (!u0) return bad(res, "Sign in first.", 401, "unauthenticated");
    const target = targetOf(req.query.target || req.body?.target), { u, v, card, host } = open(req, target); if (!card) return bad(res, "No such post.", 404, "not_found");
    const c = CS.find(target, String(req.params.id || "").slice(0, 40)); if (!c) return bad(res, "No such comment.", 404, "not_found");
    if (lc(c.email) !== lc(u.email) && !host) return bad(res, "You can delete your own comments.", 403, "not_granted");
    CS.remove(target, c.id); res.json({ ok: true, target, count: CS.summary(target, v).count, summary: CS.summary(target, v) }); });
  // fresh counts for the cards on screen (the feed itself may be a minute old, or a saved copy on a slow connection)
  app.get("/api/feed/social", (req, res) => { res.set("Cache-Control", "private, no-store");
    if (over("ip|r|" + (req.ip || "?"), readsPerIp())) return bad(res, "Slow down.", 429, "rate_limited");
    const u = viewer(req), v = B.viewerOf({ email: u ? u.email : "", ws: u ? u.ws : "" }), memo = {}, items = {};
    for (const t of [...new Set(String(req.query.targets || "").split(",").map(targetOf).filter(Boolean))].slice(0, 40)) { const card = B.cardOf(t, v, memo); if (card) items[t] = { kudos: B.kudosFor(v, card), comments: CS.summary(t, v) }; }
    res.json({ items }); });
}
// ---- end comments on feed cards ----
