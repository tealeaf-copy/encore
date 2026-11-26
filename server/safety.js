// Keeping people safe on Pottery Lab (App Store guideline 1.2, Google Play's user-generated content policy):
// - Report: posts, photos, kudos and reviews, host pages and people (POST /api/report), from anyone, signed in or not.
//   Reports land in a queue at /moderation (ENCORE_ADMIN_EMAILS only), and the team hears by email. Three different
//   people reporting the same thing hide it at once, until someone on the team looks.
// - Hide and restore (the team): hidden things are taken out of every feed, deck, host page and photo wall answer.
// - Block (anyone signed in): a person or a host. Their posts, photos, kudos and events leave your feed and lists,
//   and a block between friends ends the friendship both ways.
// - A filter on new public text: strong language anywhere public, phone numbers and emails in kudos and questions.
//
// Docs: system/report-<id>, system/modhide-<hash of target>, system/blocks-<hash of email>.
// Targets: "person:<key>" (key = base64url of the email, as the feed sends it), "host:<handle>", "post:<author key>:<id>",
// "moment:<url>", "text:<hash of the words>" (a kudos or review), "event:<id>", "other:<anything>".
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WS, scopeStore, allWorkspaceIds } from "./workspaces.js";
import { isAdmin } from "./metrics.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";

const lc = (s) => String(s || "").trim().toLowerCase();
const sha = (s, n = 24) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, n);
export const keyOf = (email) => Buffer.from(lc(email)).toString("base64url");
export const textHash = (t) => sha(String(t || "").trim().replace(/\s+/g, " ").toLowerCase(), 16);
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

export const REASONS = { spam: "Spam or scam", hate: "Hate or harassment", sexual: "Sexual content", violence: "Violence or threats", unsafe: "Unsafe event or person", private: "Shares private info", fake: "Fake or misleading", other: "Something else" };
const TYPES = ["post", "moment", "kudos", "review", "host", "person", "event", "other"];
const TARGET_RE = /^(person|host|post|moment|text|event|other):[^\s]{1,300}$/;

// ---------- the text filter ----------
// Whole words only (so "Scunthorpe" and "classic" pass), with common letter swaps (f*ck, sh1t, @ss).
const STEMS = ["fuck", "fuk", "fck", "shit", "cunt", "bitch", "asshole", "bastard", "dick", "dickhead", "cock", "pussy", "whore", "slut", "fag", "faggot", "nigger", "nigga", "retard", "retarded", "kike", "spic", "chink", "twat", "wanker", "motherfucker", "dyke", "tranny"];
const norm = (s) => String(s || "").toLowerCase().replace(/[@4]/g, "a").replace(/[1!|]/g, "i").replace(/0/g, "o").replace(/3/g, "e").replace(/\$|5/g, "s").replace(/7/g, "t").replace(/\*/g, "u");
const BAD = new RegExp(`(^|[^a-z])(${STEMS.join("|")})(s|es|er|ers|ing|in|ed|ty)?(?=$|[^a-z])`, "i");
const EMAIL_IN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, PHONE_IN = /(?:\+?\d[\s().-]*){7,}\d/;
/** null when the text is fine; else { code, message } to show the writer. contact: also refuse phone numbers and emails. */
export function textProblem(text, { contact = false } = {}) {
  const s = String(text || ""); if (!s.trim()) return null;
  if (BAD.test(norm(s)) || BAD.test(s.toLowerCase())) return { code: "language", message: "Let's keep it kind. Take out the strong language and try again." };
  if (contact && (EMAIL_IN.test(s) || PHONE_IN.test(s))) return { code: "contact_info", message: "Keep phone numbers and emails out of public posts. Guests can message the host from the invite." };
  return null;
}
// New public text, by route: [method, path pattern, body fields, refuse contact info too?]
const TEXT_ROUTES = [
  ["POST", /^\/api\/me\/posts$/, ["text"], false],
  ["POST", /^\/api\/public\/kudos$/, ["love"], true],
  ["POST", /^\/api\/public\/faq\/[^/]+$/, ["q", "question", "text"], true],
  ["POST", /^\/api\/host\/profile$/, ["name", "tagline", "bio"], false],
  ["POST", /^\/api\/moments$/, [], false], // a photo's caption rides in the query
];

// ---------- the store ----------
export function makeSafety(store) {
  const blocksPath = (em) => "system/blocks-" + sha(lc(em));
  const hidePath = (target) => "system/modhide-" + sha(target, 40);
  const blocksOf = (em) => (em ? store.get(blocksPath(em))?.data?.list || [] : []);
  let hidCache = null;
  const hiddenSet = () => { if (hidCache && Date.now() - hidCache.at < 10_000) return hidCache.set;
    hidCache = { at: Date.now(), set: new Set(store.listPrefix("system", "modhide-").map((d) => d.data?.target).filter(Boolean)) }; return hidCache.set; };
  const bust = () => { hidCache = null; };
  function block(em, { kind, key, handle, name }) {
    const t = kind === "host" ? "host:" + lc(handle) : "person:" + String(key || "");
    if (kind === "person" && (!key || key === keyOf(em))) return { error: "You can't block yourself." };
    if (kind === "host" && !/^[a-z0-9][a-z0-9-]{1,29}$/.test(lc(handle))) return { error: "No such host." };
    const L = blocksOf(em).filter((b) => b.target !== t); L.unshift({ target: t, name: clean(name, 80), at: Date.now() });
    store.set(blocksPath(em), { kind: "blocks", email: lc(em), list: L.slice(0, 500) }); return { ok: true, target: t };
  }
  function unblock(em, target) { const L = blocksOf(em), next = L.filter((b) => b.target !== target); store.set(blocksPath(em), { kind: "blocks", email: lc(em), list: next }); return L.length - next.length; }
  function hide(target, { by, reportId, auto = false } = {}) { store.set(hidePath(target), { kind: "modhide", target, at: Date.now(), by: by || "", reportId: reportId || "", auto }); bust(); }
  function unhide(target) { store.delete(hidePath(target)); bust(); }
  const isHidden = (target) => hiddenSet().has(target);
  const reports = () => store.listPrefix("system", "report-").map((d) => d.data).filter((r) => r?.kind === "report").sort((a, b) => b.at - a.at);
  return { blocksOf, block, unblock, hide, unhide, isHidden, hiddenSet, reports, bust, blocksPath, hidePath };
}

/** Is this item (anything in a list the app sends) covered by these targets? */
export function matches(el, T) {
  if (!el || typeof el !== "object" || !T.size) return false;
  for (const k of [el.key, el.author, el.authorKey, el.who?.key, el.by?.key]) if (k && typeof k === "string" && T.has("person:" + k)) return true;
  for (const h of [el.handle, el.host?.handle, el.who?.handle, el.event?.host?.handle, el.by?.handle]) if (h && typeof h === "string" && T.has("host:" + lc(h))) return true;
  for (const u of [el.url, el.media?.url, el.thumb]) if (u && typeof u === "string" && T.has("moment:" + u)) return true;
  if (el.kind === "post" && el.author && T.has(`post:${el.author}:${el.id}`)) return true;
  for (const t of [el.love, el.kind === "post" ? el.text : null, el.quote]) if (t && typeof t === "string" && T.has("text:" + textHash(t))) return true;
  return false;
}
/** A copy of a JSON answer with every list item the targets cover taken out. */
export function scrub(v, T, depth = 0) {
  if (!T.size || depth > 8 || !v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.filter((x) => !matches(x, T)).map((x) => scrub(x, T, depth + 1));
  const o = {}; for (const [k, x] of Object.entries(v)) o[k] = scrub(x, T, depth + 1); return o;
}
// Answers that show other people's things (never the host's own management views)
const FILTERED = /^\/api\/(me\/(feed|sidebar|friends-going)|feed\/stories|public\/(feed|deck|discover|cards|hosts(\/[a-z]+)?|inspo|suggest\/[a-z]+|host\/[^/]+(\/[a-z]+)?|profile\/[^/]+|moments\/[^/]+|roundtables|leaderboard\/card|collabs\/[^/]+))$/;

export function mountSafety(app, { store, small, currentUser, X, publicOrigin, express }) {
  const S = makeSafety(store);
  const viewer = (req) => { try { const u = currentUser(req); return u && u.ws !== DEFAULT_WS ? u : null; } catch { return null; } };
  const me = (req, res) => { const u = viewer(req); if (!u) res.status(401).json({ code: "unauthenticated", message: "Sign in first." }); return u; };
  const admin = (req, res) => { const u = viewer(req); if (!u || !isAdmin(u.email)) { res.status(404).json({ code: "not_found", message: "Not found." }); return null; } return u; };
  const hits = new Map(); const limited = (req, n) => { const k = (req.ip || "?") + req.path.split("/").slice(0, 3).join("/"), now = Date.now(); let h = hits.get(k); if (!h || now - h.start > 3600e3) { h = { n: 0, start: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };
  const contact = () => String(process.env.ENCORE_SAFETY_EMAIL || process.env.ENCORE_SUPPORT_EMAIL || "").split(/[\s,]+/).find((x) => EMAIL_RE.test(x)) || "";

  // ---- what people see: hidden things are gone for everyone, blocked things for the person who blocked them ----
  app.use((req, res, next) => {
    if (req.method !== "GET" || !FILTERED.test(req.path)) return next();
    const send = res.json.bind(res);
    res.json = (body) => { try { const u = viewer(req), T = new Set(S.hiddenSet()); for (const b of u ? S.blocksOf(u.email) : []) T.add(b.target);
      if (T.size && res.statusCode < 400) { // a hidden or blocked host's own page answers like a missing one
        const m = /^\/api\/public\/host\/([^/]+)$/.exec(req.path); if (m && T.has("host:" + lc(decodeURIComponent(m[1])))) { const blocked = !S.isHidden("host:" + lc(decodeURIComponent(m[1]))); res.status(blocked ? 200 : 404); return send(blocked ? { ...scrub(body, T), blockedByYou: true } : { code: "not_found", message: "This page isn't available." }); }
        return send(scrub(body, T)); } } catch (e) { console.warn("[safety] filter", e.message); }
      return send(body); };
    next();
  });
  // ---- new public text: strong language (and contact details where strangers read it) ----
  const parse = express.json({ limit: "200kb" });
  app.use((req, res, next) => {
    const R = TEXT_ROUTES.find(([m, re]) => m === req.method && re.test(req.path)); if (!R) return next();
    const check = () => { const b = req.body && typeof req.body === "object" ? req.body : {};
      const texts = [...R[2].map((f) => b[f]), req.query?.caption].filter((x) => typeof x === "string");
      for (const t of texts) { const p = textProblem(t, { contact: R[3] }); if (p) return res.status(400).json(p); }
      next(); };
    if (!R[2].length || !/json/.test(String(req.get("content-type") || ""))) return check();
    parse(req, res, (err) => (err ? next(err) : check()));
  });

  // ---- report ----
  app.post("/api/report", small, async (req, res) => {
    if (limited(req, 30)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of reports. Try again in a bit." });
    const b = req.body || {}, type = String(b.type || ""), reason = String(b.reason || "other");
    if (!TYPES.includes(type)) return res.status(400).json({ code: "invalid", message: "type must be one of " + TYPES.join(", ") });
    if (!REASONS[reason]) return res.status(400).json({ code: "invalid", message: "Pick a reason." });
    const text = clean(b.text, 2000); let target = clean(b.target, 300);
    if ((type === "kudos" || type === "review") && !target && text) target = "text:" + textHash(text);
    if (!TARGET_RE.test(target)) return res.status(400).json({ code: "invalid", message: "What are you reporting?" });
    const u = viewer(req), from = u ? lc(u.email) : EMAIL_RE.test(lc(b.email)) ? lc(b.email) : "", who = u ? "u:" + sha(lc(u.email)) : "ip:" + sha(req.ip || "?");
    const id = crypto.randomBytes(9).toString("base64url");
    const r = { kind: "report", id, type, target, reason, note: clean(b.note, 1000), text, name: clean(b.name, 120), url: /^\/[^/]/.test(String(b.url || "")) ? clean(b.url, 300) : "", from, who, at: Date.now(), status: "open" };
    store.set("system/report-" + id, r);
    // three different people on the same thing: hide it now, a person looks next
    const others = new Set(S.reports().filter((x) => x.target === target && x.status === "open").map((x) => x.who));
    let autoHidden = false; if (others.size >= 3 && !S.isHidden(target) && !target.startsWith("other:")) { S.hide(target, { reportId: id, auto: true }); autoHidden = true; afterHide(target, true); }
    const to = String(process.env.ENCORE_ADMIN_EMAILS || "").split(/[\s,]+/).filter((x) => EMAIL_RE.test(x)), cfg = emailConfig(DEFAULT_WS, true);
    if (to.length && cfg) sendEmail(cfg, { to: to.join(","), subject: `Report: ${REASONS[reason]} (${type})${autoHidden ? ", hidden after 3 reports" : ""}`, text: `${REASONS[reason]} on a ${type}.\n\n${r.note ? "Note: " + r.note + "\n" : ""}${r.text ? "Text: " + r.text.slice(0, 500) + "\n" : ""}${r.url ? "Where: " + publicOrigin(req) + r.url + "\n" : ""}\nReview it within 24 hours: ${publicOrigin(req)}/moderation#r-${id}` }).catch(() => {});
    res.json({ ok: true, id, message: "Thanks for telling us. We look at every report within 24 hours." });
  });

  // ---- block ----
  app.get("/api/me/blocks", (req, res) => { const u = me(req, res); if (!u) return; res.set("Cache-Control", "private, no-store"); res.json({ blocks: S.blocksOf(u.email) }); });
  app.post("/api/me/blocks", small, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    const r = S.block(u.email, { kind: b.kind === "host" ? "host" : "person", key: clean(b.key, 400), handle: clean(b.handle, 40), name: b.name }); if (r.error) return res.status(400).json({ code: "invalid", message: r.error });
    if (r.target.startsWith("person:") && X) { try { const other = Buffer.from(r.target.slice(7), "base64url").toString(); if (EMAIL_RE.test(other)) { X.dropFriend(u.email, other); X.dropFriend(other, u.email); } X.bust?.(); } catch {} }
    res.json({ ok: true, target: r.target, message: "Blocked. You won't see their posts, photos or events." }); });
  app.delete("/api/me/blocks", small, (req, res) => { const u = me(req, res); if (!u) return; res.json({ ok: true, removed: S.unblock(u.email, clean(req.query.target || req.body?.target, 300)) }); });
  app.get("/api/public/safety", (req, res) => res.json({ email: contact(), reasons: REASONS, rules: "/community", respondWithin: "24 hours" }));

  // ---- the moderation queue (ENCORE_ADMIN_EMAILS) ----
  // a moment hidden by the team is also marked hidden where it lives, so the photo walls and stories drop it too
  function afterHide(target, hidden) {
    if (target.startsWith("moment:")) { const url = target.slice(7); for (const ws of allWorkspaceIds()) { const St = scopeStore(store, ws); for (const d of St.list("moments")) if (d.data?.url === url) St.update("moments/" + d.id, hidden ? { hidden: true, modHidden: Date.now() } : { hidden: false, modHidden: null }); } }
    try { X?.bust?.(); } catch {}
  }
  const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "moderation.html");
  app.get("/moderation", (req, res) => { const u = viewer(req); if (!u || !isAdmin(u.email)) return res.status(404).type("text").send("Not found"); res.set("Cache-Control", "private, no-store").sendFile(PAGE, { dotfiles: "allow" }); });
  app.get("/api/admin/reports", (req, res) => { if (!admin(req, res)) return; const status = String(req.query.status || "open");
    const L = S.reports().filter((r) => status === "all" || r.status === status || (status === "open" && r.status === "open")).slice(0, 300).map((r) => ({ ...r, hidden: S.isHidden(r.target), count: S.reports().filter((x) => x.target === r.target).length }));
    res.set("Cache-Control", "private, no-store").json({ reports: L, reasons: REASONS, hidden: [...S.hiddenSet()] }); });
  app.post("/api/admin/reports/:id", small, (req, res) => { const a = admin(req, res); if (!a) return; const p = "system/report-" + String(req.params.id).replace(/[^A-Za-z0-9_-]/g, ""), r = store.get(p)?.data; if (!r) return res.status(404).json({ code: "not_found", message: "No such report." });
    const action = String(req.body?.action || ""); if (!["hide", "restore", "dismiss"].includes(action)) return res.status(400).json({ code: "invalid", message: "action must be hide, restore or dismiss" });
    if (action === "hide") { S.hide(r.target, { by: a.email, reportId: r.id }); afterHide(r.target, true); }
    if (action === "restore") { S.unhide(r.target); afterHide(r.target, false); }
    const status = { hide: "hidden", restore: "restored", dismiss: "dismissed" }[action], now = Date.now();
    for (const x of S.reports()) if (x.target === r.target && (x.status === "open" || x.id === r.id || action !== "dismiss")) store.update("system/report-" + x.id, { status, handledAt: now, handledBy: a.email, note2: clean(req.body?.note, 500) || x.note2 || "" });
    res.json({ ok: true, status, hidden: S.isHidden(r.target) }); });
  return S;
}
