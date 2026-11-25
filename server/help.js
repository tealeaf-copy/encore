// Help for hosts: Potto answers questions from docs/help.md, and a person answers the rest.
//
// - POST /api/help/ask {message, page, eventId?, history[]} → {answer, actions:[{label, href}], suggestHuman}.
//   Signed in: 30 an hour per person (ENCORE_HELP_PER_HOUR). Signed out: only from the onboarding pages (sign up, sign in,
//   forgot password, join, onboard), 10 an hour per IP (ENCORE_HELP_PER_HOUR_IP), with no account context.
//   With ANTHROPIC_API_KEY the model answers from the guide and the host's light context (handle, what their page is
//   missing, the page they're on, the event's title and status). It never sees a guest's name, email, phone or reply.
//   Without a key (or with ENCORE_FAKE_AI=1, or when the call fails) the best-matching guide section answers.
// - POST /api/help/ticket: a message to a person. Stored in system/support-<id> (outside every workspace, like collabs),
//   status open. The team hears by email (ENCORE_SUPPORT_EMAIL, comma list) and text (ENCORE_SUPPORT_SMS, comma list).
//   Signed out needs an email; a hidden honeypot field and per-IP limits keep bots out.
// - GET /api/help/tickets, POST /api/help/tickets/:id: the host's own conversations ("Your conversations").
// - GET /support, GET /api/support/tickets, POST /api/support/tickets/:id: the team inbox, for ENCORE_ADMIN_EMAILS only.
//   Everyone else gets a 404. A reply reaches the host as an in-app notification, an email, and in their help panel.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { complete, aiMode, parseJsonLoose } from "./ai.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { smsConfig, sendSms } from "./sms.js";
import { scopeStore, getWorkspace, DEFAULT_WS } from "./workspaces.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE_FILE = path.join(ROOT, "docs", "help.md");
const HOUR = 3600e3;
export const EXPECT = "We'll reply here and by email, usually within a day.";
export const STATUSES = ["open", "waiting", "solved"];
// what someone who can't get in can pick, so the team knows at a glance
export const TOPICS = { code: "I need a host code", email_taken: "My email is already in use", reset: "My reset email didn't come", google: "Google sign-in", other: "Something else" };
// pages where a signed-out person may ask Potto: every step before (or while) the account is made
export const ONBOARDING_PAGE = /^\/(signup|login|forgot|reset|join|onboard)(?:[/?#]|$)/;

const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const cleanText = (v, n) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const list = (v) => String(v || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const cleanPath = (p) => { const s = clean(p, 200); return /^\/(?!\/)[^\s<>"']*$/.test(s) ? s : ""; };
const noDash = (s) => String(s || "").replace(/\s*[—–]\s*/g, ", ");
export const adminEmails = () => list(process.env.ENCORE_ADMIN_EMAILS).map(lc);

// ---------- the guide ----------
let guideCache = null;
/** docs/help.md as sections: {title, keywords[], body, links[]}. Read again when the file changes. */
export function loadGuide() {
  try { const m = fs.statSync(GUIDE_FILE).mtimeMs; if (guideCache?.m === m) return guideCache; const md = fs.readFileSync(GUIDE_FILE, "utf8"); guideCache = { m, md, sections: parseGuide(md) }; }
  catch { guideCache = guideCache || { m: 0, md: "", sections: [] }; }
  return guideCache;
}
export function parseGuide(md) {
  return String(md || "").split(/^## /m).slice(1).map((chunk) => {
    const [title, ...rest] = chunk.split("\n"); let keywords = []; const lines = [], links = [];
    for (const raw of rest) { const line = raw.trim(); if (!line) continue;
      if (/^keywords:/i.test(line)) { keywords = line.replace(/^keywords:/i, "").split(",").map((k) => lc(k)).filter(Boolean); continue; }
      for (const m of line.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) links.push({ label: m[1], href: m[2] });
      const text = line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "").trim(); if (text) lines.push(line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")); }
    return { title: title.trim(), keywords, body: lines.join(" "), links };
  });
}
const STOP = new Set("a an the i im i'm me my we our you your it its is are was be to of in on at for and or but how do does can cant can't what when where why who which this that with from there here get got have has not no yes so if just help please want need".split(" "));
const words = (t) => lc(t).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9@\s'-]/g, " ").split(/\s+/).map((w) => w.replace(/^'+|'+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w));
/** The best guide section for a question, or null. Pure. */
export function matchSection(message, sections = loadGuide().sections) {
  const q = " " + words(message).join(" ") + " ", qw = new Set(words(message)); let best = null, top = 0;
  for (const s of sections) { let score = 0;
    for (const k of s.keywords) { const kk = words(k).join(" "); if (kk && q.includes(" " + kk + " ")) score += 3 * kk.split(" ").length; }
    for (const w of new Set(words(s.title))) if (qw.has(w)) score += 2;
    let b = 0; for (const w of new Set(words(s.body))) if (qw.has(w)) b += 0.5; score += Math.min(b, 2);
    if (score > top) { top = score; best = s; } }
  return top >= 2 ? best : null;
}
const PERSON = { label: "Talk to a person", href: "#person" };
/** The no-AI answer: the best section's first lines, its links, and a person. */
export function offlineAnswer(message) {
  const s = matchSection(message);
  if (!s) return { answer: "I'm not sure about that one. A person can help.", actions: [PERSON], suggestHuman: true, section: null };
  const sentences = s.body.split(/(?<=[.!?])\s+/); let answer = ""; for (const x of sentences) { if (answer && (answer + " " + x).length > 320) break; answer = answer ? answer + " " + x : x; if (answer.length > 160) break; }
  return { answer: noDash(answer), actions: [...s.links.slice(0, 2), PERSON], suggestHuman: /person/i.test(s.title), section: s.title };
}

// ---------- what Potto knows about the host (never anything about guests) ----------
const today = () => new Date().toISOString().slice(0, 10);
function eventStatus(ev) { if (ev.cancelled) return "cancelled"; if (ev.stage === "interest") return "picking a date"; if (ev.date && ev.date < today()) return "past"; return ev.published || ev.discoverable ? "shared" : "draft"; }
/** The light context: handle, what the page still needs, the page path, and one event's title and status. */
export function hostContext({ store, C, user, page, eventId }) {
  const ctx = { signedIn: !!user, page: cleanPath(page) || "" };
  if (!user) return ctx;
  const h = (() => { try { return C?.profileOf?.(user.ws) || null; } catch { return null; } })();
  ctx.handle = h?.handle || ""; ctx.hasPage = !!h?.handle;
  try { ctx.pageMissing = C?.pageGaps ? C.pageGaps(h) : []; } catch { ctx.pageMissing = []; }
  const id = clean(eventId, 80);
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) { try { const ev = scopeStore(store, user.ws).get("events/" + id)?.data;
    if (ev && !ev.example) ctx.event = { title: clean(ev.pubTitle || ev.name, 120), status: eventStatus(ev), date: /^\d{4}-\d{2}-\d{2}$/.test(ev.date || "") ? ev.date : "", whoCanCome: ev.approvalRequired ? "they ask to join" : "anyone with the link", visibility: !ev.discoverable ? "link only" : ev.unlisted ? "on my page" : "on my page and Discover", paid: !!(ev.price && ev.price !== "chip" && !/^(free|\$?0)$/i.test(String(ev.price).trim())), hasPayLink: !!ev.ticketUrl }; } catch {} }
  return ctx;
}
export function helpPrompt({ guide, ctx, message, history }) {
  const turns = (history || []).map((t) => `${t.role === "potto" ? "Potto" : "Host"}: ${t.text}`).join("\n");
  return `You are Potto, the help agent inside Pottery Lab, an app where hosts plan get-togethers, share invites and build a page. Answer the host's question using ONLY the guide below.

Rules:
- Speak in first person as Potto. Answer in 1 to 4 short, plain sentences.
- Say exactly where to click, using the button and screen names in the guide.
- Never invent a feature, price, number or fact that isn't in the guide. If the guide doesn't cover it, say "I'm not sure" and offer a person (suggestHuman true).
- If the host is stuck, upset, or asks for a person, set suggestHuman true.
- Plain words. No em dashes. No markdown.
- actions: up to 3 links from the guide that help right now, as {"label","href"} with hrefs starting with "/". Use [] if none fit.

<guide>
${guide}
</guide>

<host>
${JSON.stringify(ctx)}
</host>
${turns ? `\n<conversation>\n${turns}\n</conversation>\n` : ""}
Host's question: ${message}

Reply with only JSON: {"answer": "...", "actions": [{"label": "...", "href": "/..."}], "suggestHuman": false}`;
}
function shapeAnswer(j) {
  const answer = noDash(clean(j?.answer, 700));
  const actions = (Array.isArray(j?.actions) ? j.actions : []).map((a) => ({ label: clean(a?.label, 40), href: String(a?.href || "").trim() })).filter((a) => a.label && (a.href === "#person" || /^\/(?!\/)[^\s<>"']{0,200}$/.test(a.href))).slice(0, 3);
  return { answer, actions, suggestHuman: !!j?.suggestHuman || /\bI'?m not sure\b/i.test(answer) };
}

// ---------- the app's version, for tickets ----------
let APP = null;
export function appVersion() {
  if (APP) return APP; let version = "", commit = String(process.env.ENCORE_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12);
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || ""; } catch {}
  if (!commit) { try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().slice(0, 12); } catch {} }
  APP = { version, commit }; return APP;
}

export function mountHelp(app, { store, express, currentUser, C, X, sendStatic, publicOrigin }) {
  const body = express.json({ limit: "64kb" });
  const hits = new Map();
  const limited = (k, n) => { const now = Date.now(), h = (hits.get(k) || []).filter((t) => now - t < HOUR); if (h.length >= n) { hits.set(k, h); return true; } h.push(now); hits.set(k, h); return false; };
  const me = (req) => { try { return currentUser(req); } catch { return null; } };
  const isAdmin = (u) => !!u && adminEmails().includes(lc(u.email));
  const key = (id) => "system/support-" + id;
  const all = () => store.list("system").map((d) => d.data).filter((x) => x?.kind === "support");
  const get = (id) => { const s = String(id || "").replace(/[^a-f0-9]/g, ""); return s ? store.get(key(s))?.data || null : null; };
  const put = (t) => store.set(key(t.id), t);
  const origin = (req) => { try { return publicOrigin(req); } catch { return ""; } };
  const emailCfg = () => emailConfig(DEFAULT_WS, true);
  const hp = (b) => !!clean(b?.website, 200) || !!clean(b?.url_hp, 200);
  app.locals.help = { lastPrompt: "" };

  // ---- ask Potto ----
  app.post("/api/help/ask", body, async (req, res) => {
    const b = req.body || {}, u = me(req), page = cleanPath(b.page);
    if (hp(b)) return res.status(400).json({ code: "rejected", message: "Couldn't send that." });
    if (!u && !ONBOARDING_PAGE.test(page)) return res.status(401).json({ code: "account_required", message: "Sign in to ask Potto." });
    if (u ? limited("ask:u:" + lc(u.email), Number(process.env.ENCORE_HELP_PER_HOUR || 30)) : limited("ask:ip:" + (req.ip || "?"), Number(process.env.ENCORE_HELP_PER_HOUR_IP || 10)))
      return res.status(429).json({ code: "rate_limited", message: "That's a lot of questions for one hour. Talk to a person, or try again soon.", suggestHuman: true });
    const message = cleanText(b.message, 1000); if (message.length < 2) return res.status(400).json({ code: "invalid", message: "Ask me something first." });
    const history = (Array.isArray(b.history) ? b.history : []).slice(-8).map((t) => ({ role: t?.role === "potto" ? "potto" : "host", text: cleanText(t?.text, 600) })).filter((t) => t.text);
    const ctx = hostContext({ store, C, user: u, page, eventId: u ? b.eventId : "" });
    const G = loadGuide(), prompt = helpPrompt({ guide: G.md, ctx, message, history }); app.locals.help.lastPrompt = prompt;
    if (aiMode() === "live") {
      try { const r = await complete({ prompt, effort: "low" }); const out = shapeAnswer(parseJsonLoose(r.text)); if (out.answer) return res.json({ ...out, mode: "live" }); }
      catch (e) { console.warn("[help] model call failed, using the guide:", e?.code || e?.message || "error"); }
    }
    const o = offlineAnswer(message); res.json({ answer: o.answer, actions: o.actions, suggestHuman: o.suggestHuman, section: o.section, mode: "guide" });
  });

  // ---- talk to a person ----
  async function tellTeam(t, req, line) {
    const out = { email: false, sms: 0 }, to = list(process.env.ENCORE_SUPPORT_EMAIL).filter((x) => EMAIL_RE.test(x)), cfg = emailCfg(), link = `${origin(req)}/support#t-${t.id}`;
    if (to.length && cfg) { const ctxt = t.context || {};
      const text = `${line}\n\nFrom: ${t.name || "(no name)"} <${t.email}>${t.phone ? `, ${t.phone}` : ""}${t.handle ? `, @${t.handle}` : ""}${t.signedIn ? "" : " (not signed in)"}\n${t.topic ? `Topic: ${TOPICS[t.topic] || t.topic}\n` : ""}Page: ${ctxt.page || "?"}${ctxt.eventId ? `\nEvent: ${ctxt.eventTitle || ""} (${ctxt.eventId})` : ""}\nBrowser: ${ctxt.browser || "?"}\nApp: ${[ctxt.app?.version, ctxt.app?.commit].filter(Boolean).join(" ") || "?"}\n\n${t.thread[t.thread.length - 1]?.text || t.message}\n\nOpen the ticket: ${link}`;
      const r = await sendEmail(cfg, { to, subject: `Help: ${clean(t.message, 70)}`, text, replyTo: t.email }).catch(() => ({ ok: false })); out.email = !!r?.ok; }
    const nums = list(process.env.ENCORE_SUPPORT_SMS), sms = smsConfig();
    if (nums.length && sms) for (const n of nums) { const r = await sendSms(sms, { to: n, text: `Pottery Lab help: ${clean(t.name || t.email, 40)}: ${clean(t.thread[t.thread.length - 1]?.text || t.message, 120)} ${link}` }).catch(() => ({ ok: false })); if (r?.ok) out.sms++; }
    return out;
  }
  app.post("/api/help/ticket", body, async (req, res) => {
    const b = req.body || {}, u = me(req);
    if (hp(b)) return res.status(400).json({ code: "rejected", message: "Couldn't send that." });
    if (u ? limited("t:u:" + lc(u.email), Number(process.env.ENCORE_HELP_TICKETS_PER_HOUR || 10)) : limited("t:ip:" + (req.ip || "?"), Number(process.env.ENCORE_HELP_TICKETS_PER_HOUR_IP || 5)))
      return res.status(429).json({ code: "rate_limited", message: "We've got your messages. Give us a little time to reply." });
    const email = u ? lc(u.email) : lc(clean(b.email, 200));
    if (!EMAIL_RE.test(email)) return res.status(400).json({ code: "invalid", message: "Add your email so we can reply." });
    const message = cleanText(b.message, 4000); if (message.length < 3) return res.status(400).json({ code: "invalid", message: "Say what's wrong, even in a few words." });
    const phone = /^\+?[0-9 ()-]{7,20}$/.test(clean(b.phone, 30)) ? clean(b.phone, 30) : "";
    const page = cleanPath(b.page), eventId = clean(b.eventId, 80), ctx = hostContext({ store, C, user: u, page, eventId: u ? eventId : "" });
    const transcript = (Array.isArray(b.transcript) ? b.transcript : []).slice(-20).map((t) => ({ role: t?.role === "potto" ? "potto" : "host", text: cleanText(t?.text, 600) })).filter((t) => t.text);
    const now = Date.now(), t = { kind: "support", id: crypto.randomBytes(6).toString("hex"), status: "open", at: now, updatedAt: now, email, name: clean(u?.name || b.name, 120), phone, signedIn: !!u, ws: u?.ws || null, handle: ctx.handle || "",
      topic: TOPICS[b.topic] ? b.topic : "", message,
      context: { page, eventId: ctx.event ? eventId : "", eventTitle: ctx.event?.title || "", eventStatus: ctx.event?.status || "", pageMissing: ctx.pageMissing || [], browser: clean(b.browser || req.get("user-agent"), 300), app: appVersion() },
      screenshot: u && /^\/_blob\/[A-Za-z0-9]{20}$/.test(String(b.screenshot || "")) ? b.screenshot : "",
      transcript, thread: [{ by: "host", name: clean(u?.name || b.name, 80), text: message, at: now }] };
    put(t);
    const told = await tellTeam(t, req, `New help request${u ? "" : " (not signed in)"}.`);
    put({ ...t, notified: told });
    console.log(`[help] ticket ${t.id} from ${t.signedIn ? "a host" : "someone signed out"}: ${clean(message, 120)}`);
    res.json({ ok: true, id: t.id, status: t.status, expect: u ? EXPECT : `We'll reply to ${email}, usually within a day.` });
  });
  // the host's own conversations
  const view = (t) => ({ id: t.id, status: t.status, at: t.at, updatedAt: t.updatedAt, message: t.message, thread: (t.thread || []).map((m) => ({ by: m.by, name: m.by === "team" ? "Pottery Lab" : m.name || "", text: m.text, at: m.at })) });
  app.get("/api/help/tickets", (req, res) => { const u = me(req); if (!u) return res.status(401).json({ code: "account_required", message: "Sign in to see your conversations." });
    res.json({ tickets: all().filter((t) => lc(t.email) === lc(u.email)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30).map(view), admin: isAdmin(u) }); });
  app.post("/api/help/tickets/:id", body, async (req, res) => { const u = me(req); if (!u) return res.status(401).json({ code: "account_required", message: "Sign in first." });
    const t = get(req.params.id); if (!t || lc(t.email) !== lc(u.email)) return res.status(404).json({ code: "not_found", message: "We can't find that conversation." });
    if (limited("t:u:" + lc(u.email), Number(process.env.ENCORE_HELP_TICKETS_PER_HOUR || 10))) return res.status(429).json({ code: "rate_limited", message: "Give us a little time to reply." });
    const text = cleanText(req.body?.text, 4000); if (!text) return res.status(400).json({ code: "invalid", message: "Write a message." });
    const now = Date.now(); t.thread = [...(t.thread || []), { by: "host", name: clean(u.name, 80), text, at: now }].slice(-100); t.status = "open"; t.updatedAt = now; put(t);
    await tellTeam(t, req, `${clean(u.name || u.email, 80)} replied.`);
    res.json({ ok: true, ticket: view(t) }); });

  // ---- the team inbox ----
  const notFound = (res) => { res.status(404); return sendStatic ? sendStatic(res, "404.html", "<p>Page not found.</p>") : res.type("text").send("Not found"); };
  app.get("/support", (req, res) => { const u = me(req); if (!isAdmin(u)) return notFound(res); res.set("Cache-Control", "private, no-store").type("html").send(ADMIN_PAGE); });
  app.get("/api/support/tickets", (req, res) => { const u = me(req); if (!isAdmin(u)) return res.status(404).json({ code: "not_found", message: "Not found." });
    const want = STATUSES.includes(req.query.status) ? req.query.status : "", order = { open: 0, waiting: 1, solved: 2 };
    res.json({ tickets: all().filter((t) => !want || t.status === want).sort((a, b) => (order[a.status] - order[b.status]) || b.updatedAt - a.updatedAt).slice(0, 300), counts: Object.fromEntries(STATUSES.map((s) => [s, all().filter((t) => t.status === s).length])) }); });
  app.post("/api/support/tickets/:id", body, async (req, res) => { const u = me(req); if (!isAdmin(u)) return res.status(404).json({ code: "not_found", message: "Not found." });
    const t = get(req.params.id); if (!t) return res.status(404).json({ code: "not_found", message: "No such ticket." });
    const reply = cleanText(req.body?.reply, 4000), status = STATUSES.includes(req.body?.status) ? req.body.status : reply ? "waiting" : t.status, now = Date.now(), notified = { inbox: false, email: false };
    if (!reply && status === t.status) return res.status(400).json({ code: "invalid", message: "Write a reply or pick a status." });
    if (reply) { t.thread = [...(t.thread || []), { by: "team", name: clean(u.name, 80), email: lc(u.email), text: reply, at: now }].slice(-100);
      if (t.signedIn && X?.notify) { try { X.notify(t.email, { kind: "support", text: `💬 Pottery Lab: ${clean(reply, 120)}`, link: "/?app=1&help=1" }); notified.inbox = true; } catch {} }
      const cfg = emailCfg(); if (cfg) { const first = clean(t.name, 80).split(" ")[0];
        const r = await sendEmail(cfg, { to: t.email, subject: "Re: your Pottery Lab question", text: `Hi ${first || "there"},\n\n${reply}\n\n${t.signedIn ? `You can also reply in the help panel: ${origin(req)}/?app=1&help=1` : "Reply to this email to keep talking."}\n\nPottery Lab`, replyTo: list(process.env.ENCORE_SUPPORT_EMAIL).find((x) => EMAIL_RE.test(x)) || lc(u.email) }).catch(() => ({ ok: false }));
        notified.email = !!r?.ok; } }
    t.status = status; t.updatedAt = now; put(t);
    res.json({ ok: true, ticket: t, notified }); });
}

// The team inbox page. Served only to admins, so it isn't a file under public/.
const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Help inbox · Pottery Lab</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600&family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#1F1A17;--soft:#6B5F56;--line:#E9E1D6;--bg:#FAF7F2;--clay:#C94A30}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Instrument Sans",system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 60px}h1{font:600 28px Fredoka,system-ui;margin:0 0 4px}.sub{color:var(--soft);margin:0 0 16px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.tabs button{border:1.5px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;min-height:40px}.tabs button[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.t{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;margin:0 0 14px}.t:target{outline:3px solid #F2D48F}
.top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.top b{font-size:16px}.pill{font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;background:#FDE7DF;color:#8E3A25}.pill.waiting{background:#FFF1C9;color:#6B4E00}.pill.solved{background:#E3F2E6;color:#245C33}
.muted{color:var(--soft);font-size:13px}dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:2px 10px;margin:10px 0;font-size:13px}dt{color:var(--soft)}dd{margin:0;overflow-wrap:anywhere}
.msg{border-left:3px solid var(--line);padding:4px 10px;margin:8px 0;white-space:pre-wrap}.msg.team{border-color:var(--clay)}.msg small{display:block;color:var(--soft);font-size:12px}
details{margin:8px 0}summary{cursor:pointer;font-weight:600;font-size:13px}
form{display:grid;gap:8px;margin-top:10px}textarea{width:100%;min-height:80px;border:1px solid var(--line);border-radius:12px;padding:10px;font:inherit}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}select{border:1px solid var(--line);border-radius:10px;padding:8px;font:inherit;min-height:40px}
button.go{border:0;background:var(--clay);color:#fff;border-radius:999px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer;min-height:44px}
.ok{color:#245C33;font-size:13px}.err{color:#A93A3A;font-size:13px}
</style></head><body><main><h1>Help inbox</h1><p class="sub">What hosts asked for. Replies go to them in the app and by email.</p>
<div class="tabs" role="group" aria-label="Show"><button data-s="open" aria-pressed="true">Open</button><button data-s="waiting" aria-pressed="false">Waiting</button><button data-s="solved" aria-pressed="false">Solved</button><button data-s="" aria-pressed="false">All</button></div>
<div id="list" aria-live="polite">Loading…</div></main>
<script>
(function(){ let want="open"; const L=document.getElementById("list");
  const el=(t,c,x)=>{ const e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e };
  const when=(t)=>new Date(t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  const TOP=${JSON.stringify(TOPICS)};
  function card(t){ const c=el("article","t"); c.id="t-"+t.id; const top=el("div","top"); top.append(el("b",null,t.name||t.email), el("span","pill "+t.status,t.status), el("span","muted",when(t.at)+(t.signedIn?"":" · not signed in"))); c.append(top);
    const dl=el("dl"); const add=(k,v,href)=>{ if(!v) return; dl.append(el("dt",null,k)); const d=el("dd"); if(href){ const a=el("a",null,v); a.href=href; d.append(a) } else d.textContent=v; dl.append(d) };
    add("Email",t.email,"mailto:"+t.email); add("Phone",t.phone); add("Page",t.handle?"@"+t.handle:"",t.handle?"/@"+t.handle:""); add("Topic",TOP[t.topic]||""); const x=t.context||{};
    add("On",x.page); add("Event",x.eventId?((x.eventTitle||"")+" ("+x.eventId+")"+(x.eventStatus?", "+x.eventStatus:"")):""); add("Page needs",(x.pageMissing||[]).join(", ")); add("Browser",x.browser); add("App",[x.app&&x.app.version,x.app&&x.app.commit].filter(Boolean).join(" ")); add("Screenshot",t.screenshot?"Open":"",t.screenshot||"");
    add("Told team",t.notified?((t.notified.email?"email":"no email")+(t.notified.sms?", "+t.notified.sms+" text"+(t.notified.sms>1?"s":""):"")):""); c.append(dl);
    if((t.transcript||[]).length){ const d=el("details"); d.append(el("summary",null,"Chat with Potto before this")); for(const m of t.transcript){ const p=el("div","msg"+(m.role==="potto"?" team":"")); p.append(el("small",null,m.role==="potto"?"Potto":"Host")); p.append(document.createTextNode(m.text)); d.append(p) } c.append(d) }
    for(const m of t.thread||[]){ const p=el("div","msg"+(m.by==="team"?" team":"")); p.append(el("small",null,(m.by==="team"?"Team"+(m.name?" ("+m.name+")":""):(m.name||"Host"))+" · "+when(m.at))); p.append(document.createTextNode(m.text)); c.append(p) }
    const f=el("form"); const lab=el("label","muted","Reply"); const ta=el("textarea"); ta.name="reply"; ta.setAttribute("aria-label","Reply to "+(t.name||t.email)); lab.append(ta);
    const row=el("div","row"); const sel=el("select"); sel.setAttribute("aria-label","Status"); for(const s of ["open","waiting","solved"]){ const o=el("option",null,s[0].toUpperCase()+s.slice(1)); o.value=s; if(s===(t.status==="open"?"waiting":t.status)) o.selected=true; sel.append(o) }
    const go=el("button","go","Send"); go.type="submit"; const note=el("span","muted"); row.append(sel,go,note); f.append(lab,row);
    f.onsubmit=async(e)=>{ e.preventDefault(); go.disabled=true; note.className="muted"; note.textContent="Sending…"; try{ const r=await fetch("/api/support/tickets/"+t.id,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({reply:ta.value,status:sel.value})}); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.message||"Couldn't send that."); note.className="ok"; note.textContent=ta.value.trim()?("Sent"+(j.notified&&j.notified.email?", emailed":"")+(j.notified&&j.notified.inbox?", in their app":"")+"."):"Saved."; setTimeout(load,900) }catch(err){ note.className="err"; note.textContent=err.message } go.disabled=false };
    c.append(f); return c }
  async function load(){ try{ const r=await fetch("/api/support/tickets"+(want?"?status="+want:""),{credentials:"same-origin"}); const j=await r.json(); L.textContent=""; document.querySelectorAll(".tabs button").forEach(b=>{ const n=j.counts&&b.dataset.s?j.counts[b.dataset.s]:null; b.textContent=(b.dataset.s?b.dataset.s[0].toUpperCase()+b.dataset.s.slice(1):"All")+(n!=null?" ("+n+")":"") });
      if(!(j.tickets||[]).length){ L.append(el("p","muted","Nothing here.")); return } for(const t of j.tickets) L.append(card(t)); if(location.hash){ const x=document.querySelector(location.hash); if(x) x.scrollIntoView() } }catch{ L.textContent="Couldn't load the inbox." } }
  document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{ want=b.dataset.s; document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); load() });
  if(location.hash) { want=""; document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.s===""))) }
  load() })();
</script></body></html>`;
