// Help for hosts: Potto answers questions from docs/help.md, and a person answers the rest.
//
// - POST /api/help/ask {message, page, eventId?, history[]} → {answer, actions:[{label, href}], suggestHuman, section,
//   confidence, related[], lookup?}.
//   Signed in: 30 an hour per person (ENCORE_HELP_PER_HOUR). Signed out: only from the onboarding pages (sign up, sign in,
//   forgot password, join, onboard), 10 an hour per IP (ENCORE_HELP_PER_HOUR_IP), with no account context.
//   Retrieval first: the guide is split into sections, each with keywords and the questions it answers, and matched with
//   synonyms and light stemming (matchSections). A strong match is a grounded answer on its own. With ANTHROPIC_API_KEY the
//   model rewrites it for the host from the whole guide and the host's light context (handle, what their page is missing,
//   the page they're on, the event's title, status and counts). It never sees a guest's name, email, phone or reply. If the
//   model says "I'm not sure" while the guide has a strong match, the guide's answer wins: "I don't know" only when it's true.
//   Actions are one tap: guide links, deep links into the app (/?app=1&open=<event>&step=6#studio) and app actions
//   (#do:share, #do:copy, #do:preview, #do:guests, #do:new) that public/help.js runs through index.html's window.__helpDo.
//   An empty guide (docs/help.md missing from the deploy) never reaches the model: it would say the guide doesn't cover it.
// - POST /api/help/rate {value: "up"|"down", section, question, page}: Did this help? after an answer. Stored in
//   system/helprate-<id>. Questions Potto couldn't answer are kept too (system/helpgap-<id>), so the team can fill the guide.
// - POST /api/help/ticket: a message to a person. Stored in system/support-<id> (outside every workspace, like collabs),
//   status open, with the context the person never has to type: the chat with Potto (when they keep it attached), the page,
//   the event, the device and the app version. The message can be empty when the chat says it. The team hears by email
//   (ENCORE_SUPPORT_EMAIL, comma list) and text (ENCORE_SUPPORT_SMS, comma list). Signed out needs an email; a hidden
//   honeypot field and per-IP limits keep bots out. The reply time people are promised is ENCORE_SUPPORT_REPLY_HOURS
//   (default 24: "A person replies within a day.").
// - GET /api/help/info: the reply time, for the "Talk to a person" form.
// - GET /api/help/tickets, POST /api/help/tickets/:id, POST /api/help/tickets/:id/rate: the host's own conversations,
//   their replies, and How did we do? once a conversation is solved.
// - GET /support, GET /api/support/tickets, GET /api/support/metrics, POST /api/support/tickets/:id: the team inbox and its
//   numbers, for ENCORE_ADMIN_EMAILS only. Everyone else gets a 404. A reply reaches the host as an in-app notification,
//   an email, and in their help sheet.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { complete, aiMode, parseJsonLoose } from "./ai.js";
import { emailConfig, sendEmail, EMAIL_RE } from "./email.js";
import { smsConfig, sendSms } from "./sms.js";
import { scopeStore, getWorkspace, DEFAULT_WS } from "./workspaces.js";
import { IDEAS } from "./hooks.js";
import { pickIdeas } from "./ideasnudge.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE_FILE = path.join(ROOT, "docs", "help.md");
const HOUR = 3600e3, DAY = 24 * HOUR;
export const STATUSES = ["open", "waiting", "solved"];
// what someone who can't get in can pick, so the team knows at a glance
export const TOPICS = { code: "I need a host code", email_taken: "My email is already in use", reset: "My reset email didn't come", google: "Google sign-in", invite: "I can't find my invite", reply: "Changing my reply", other: "Something else" };
// pages where a signed-out person may ask Potto: every step before (or while) the account is made
export const ONBOARDING_PAGE = /^\/(signup|login|forgot|reset|join|onboard)(?:[/?#]|$)/;
// and Plans, where a guest who isn't signed in looks for an invite they lost
export const OPEN_HELP_PAGE = /^\/(signup|login|forgot|reset|join|onboard|plans)(?:[/?#]|$)/;
// someone upset, or asking for a person, gets a person offered right away, whatever the guide says
export const WANTS_PERSON = /\b(talk to (a |an )?(human|person|someone|agent)|real person|human|refund|charged twice|scam|fraud|hacked|harass\w*|unsafe|broken|not working|doesn'?t work|isn'?t working|still (stuck|broken|wrong)|bug|useless|ridiculous|frustrat\w*|angry|wtf|terrible)\b/i;
// app actions public/help.js can run in the app (index.html's window.__helpDo)
export const DO_ACTIONS = ["share", "copy", "preview", "guests", "open", "new"];

const clean = (v, n = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const cleanText = (v, n) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
const lc = (s) => String(s || "").trim().toLowerCase();
const list = (v) => String(v || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const cleanPath = (p) => { const s = clean(p, 200); return /^\/(?!\/)[^\s<>"']*$/.test(s) ? s : ""; };
const noDash = (s) => String(s || "").replace(/\s*[—–]\s*/g, ", ");
const rid = () => crypto.randomBytes(6).toString("hex");
export const adminEmails = () => list(process.env.ENCORE_ADMIN_EMAILS).map(lc);

// ---------- what we promise about a person's reply ----------
export function replyHours() { const n = Math.round(Number(process.env.ENCORE_SUPPORT_REPLY_HOURS)); return n > 0 && n <= 24 * 14 ? n : 24; }
/** "within an hour", "within 4 hours", "within a day", "within 2 days". */
export function replyWithin(h = replyHours()) { return h <= 1 ? "within an hour" : h < 24 || h % 24 ? `within ${h} hours` : h === 24 ? "within a day" : `within ${h / 24} days`; }
// signed out, there's no "here" to come back to: the reply goes by email
export const expectLine = (email) => (email ? `A person replies ${replyWithin()} by email, to ${email}.` : `A person replies ${replyWithin()}, here and by email.`);

// ---------- the guide ----------
let guideCache = null;
/** docs/help.md as sections: {title, keywords[], questions[], body, links[]}. Read again when the file changes. */
export function loadGuide() {
  try { const m = fs.statSync(GUIDE_FILE).mtimeMs; if (guideCache?.m === m) return guideCache; const md = fs.readFileSync(GUIDE_FILE, "utf8"); guideCache = { m, md, sections: parseGuide(md) }; }
  catch { if (!guideCache) { console.warn("[help] docs/help.md is missing: Potto can only offer a person"); guideCache = { m: 0, md: "", sections: [] }; } }
  return guideCache;
}
export function parseGuide(md) {
  return String(md || "").split(/^## /m).slice(1).map((chunk) => {
    const [title, ...rest] = chunk.split("\n"); let keywords = [], questions = []; const lines = [], links = [];
    for (const raw of rest) { const line = raw.trim(); if (!line) continue;
      if (/^keywords:/i.test(line)) { keywords = line.replace(/^keywords:/i, "").split(",").map((k) => lc(k)).filter(Boolean); continue; }
      if (/^questions:/i.test(line)) { questions = line.replace(/^questions:/i, "").split("|").map((k) => k.trim()).filter(Boolean); continue; }
      for (const m of line.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) links.push({ label: m[1], href: m[2] });
      const text = line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "").trim(); if (text) lines.push(line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")); }
    return { title: title.trim(), keywords, questions, body: lines.join(" "), links };
  });
}

// ---------- retrieval: synonyms, light stemming, sections ranked ----------
const STOP = new Set("host hosting pottery lab a an the i im i'm me my we our you your it its is are was be to of in on at for and or but how do does did can cant can't could what when where why who which this that with from there here get got have has not no yes so if just help please want need would should will one some any about up out them they their there's it's i've i'd don't doesn't didn't won't".split(" "));
// one word per idea, both in the question and in the guide (docs/brand-kit.md word list first)
const SYN = {
  rsvp: "reply", rsvps: "reply", rsvped: "reply", respond: "reply", response: "reply", responses: "reply", replies: "reply", replied: "reply", answer: "reply",
  attendee: "guest", attendees: "guest", participant: "guest", participants: "guest", guests: "guest", friends: "friend", people: "guest", invitee: "guest", invitees: "guest",
  invitation: "invite", invitations: "invite", invites: "invite", invited: "invite",
  send: "share", sending: "share", sent: "share", post: "share", spread: "share", sharing: "share", shared: "share", shares: "share", distribute: "share",
  party: "event", meetup: "event", gathering: "event", events: "event", night: "event", dinner: "event", hangout: "event",
  cancel: "cancel", cancelled: "cancel", canceled: "cancel", cancelling: "cancel", canceling: "cancel", cancellation: "cancel", postpone: "cancel", "call off": "cancel", calloff: "cancel",
  cost: "price", costs: "price", charge: "price", charging: "price", fee: "price", prices: "price", pricing: "price", tickets: "price", ticket: "price",
  payment: "pay", payments: "pay", paying: "pay", paid: "pay", venmo: "pay", paypal: "pay", cashapp: "pay",
  modify: "edit", update: "edit", editing: "edit", change: "edit", changing: "edit", fix: "edit", reschedule: "edit", move: "edit",
  ical: "calendar", ics: "calendar", webcal: "calendar", gcal: "calendar", calendars: "calendar", subscribe: "calendar",
  download: "export", csv: "export", spreadsheet: "export", json: "export", exporting: "export",
  picture: "photo", pictures: "photo", pic: "photo", pics: "photo", photos: "photo", images: "photo", image: "photo",
  delete: "delete", deleting: "delete", erase: "delete", wipe: "delete", remove: "remove", removing: "remove",
  profile: "page", storefront: "page", homepage: "page", pages: "page",
  login: "signin", "log in": "signin", "sign out": "signout", "log out": "signout", logout: "signout", "sign in": "signin", "signed in": "signin", signin: "signin", logged: "signin",
  signup: "signup", "sign up": "signup", register: "signup", registration: "signup",
  find: "find", finding: "find", lost: "find", locate: "find",
  link: "link", url: "link", links: "link", address: "address",
  hook: "webhook", webhooks: "webhook", integration: "webhook", channel: "webhook",
  discord: "discord", slack: "slack", markdown: "markdown", md: "markdown",
  copied: "copy", copying: "copy", copies: "copy", paste: "copy",
  tier: "tiers", tiers: "tiers", "early bird": "tiers", kids: "tiers", adults: "tiers", members: "tiers",
  couple: "pair", couples: "pair", pairs: "pair", partner: "pair", partners: "pair", duo: "pair",
  stickers: "sticker", looks: "look", theme: "look", themes: "look", style: "look", vibe: "look", vibes: "look",
  layouts: "layout",
  preorder: "preorder", "pre-order": "preorder", "pre order": "preorder", preorders: "preorder", "pre-orders": "preorder", order: "order", orders: "order", ordering: "order",
  episodes: "episode", series: "series", recurring: "repeat", weekly: "repeat", monthly: "repeat", repeats: "repeat", repeating: "repeat",
  slots: "slot", demos: "demo", poll: "poll", polls: "poll", vote: "poll", voting: "poll", bracket: "bracket", tournament: "bracket",
  solo: "solo", alone: "solo", shy: "quiet", introvert: "quiet", introverts: "quiet", quiet: "quiet",
  kudo: "kudos", review: "kudos", reviews: "kudos", testimonial: "kudos",
  roster: "roster", rosters: "roster", mailing: "roster",
  account: "account", accounts: "account", password: "password", passwords: "password",
  privacy: "privacy", private: "privacy", data: "data", gdpr: "data",
  giving: "give", gave: "give", gives: "give",
  cohost: "co-host", cohosts: "co-host", "co-hosts": "co-host",
  person: "person", human: "person", someone: "person", agent: "person", support: "person", team: "person",
};
// two-word phrases first (the map has a few), then single words
const PHRASES = Object.keys(SYN).filter((k) => k.includes(" ") || k.includes("-")).sort((a, b) => b.length - a.length);
const stem = (w) => (w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 4 && w.endsWith("ed") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") ? w.slice(0, -1) : w);
export function words(t) {
  let s = " " + lc(t).replace(/\/e\b\/?/g, " elink ").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'") + " ";
  s = s.replace(/[^a-z0-9@\s'-]/g, " ").replace(/\s+/g, " ");
  for (const p of PHRASES) s = s.split(" " + p + " ").join(" " + SYN[p] + " ");
  return s.split(/\s+/).map((w) => w.replace(/^['-]+|['-]+$/g, "").replace(/'s$/, "")).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => SYN[w] || SYN[stem(w)] || stem(w));
}
// Each section's words, and how rare each word is across the guide: "discord" says more than "invite".
const indexCache = new WeakMap();
function guideIndex(sections) {
  let G = indexCache.get(sections); if (G) return G;
  const per = sections.map((s) => ({ s, kws: s.keywords.map((k) => words(k)).filter((k) => k.length), title: new Set(words(s.title)), body: new Set(words(s.body)), qs: s.questions.map((q) => new Set(words(q))).filter((q) => q.size) }));
  const df = new Map(); for (const I of per) { const T = new Set([...I.title, ...I.kws.flat(), ...I.qs.flatMap((q) => [...q])]); for (const w of T) df.set(w, (df.get(w) || 0) + 1); }
  const N = Math.max(1, sections.length), idf = (w) => Math.log(1 + N / (1 + (df.get(w) || 0)));
  G = { per, idf, df }; indexCache.set(sections, G); return G;
}
/** Every section with a score for this question, best first. Pure. */
export function matchSections(message, sections = loadGuide().sections) {
  const W = words(message), q = " " + W.join(" ") + " ", qw = new Set(W); if (!qw.size || !sections.length) return [];
  const { per, idf, df } = guideIndex(sections), sum = (L) => L.reduce((a, w) => a + idf(w), 0);
  return per.map((I) => { let kw = 0;
    // a keyword phrase said in the question, weighted by how rare its words are
    for (const k of I.kws) if (q.includes(" " + k.join(" ") + " ")) kw += 1.5 * sum(k) * (k.length > 1 ? 1.3 : 1);
    let score = Math.min(kw, 14);
    for (const w of I.title) if (qw.has(w)) score += idf(w);
    let b = 0; for (const w of I.body) if (qw.has(w)) b += 0.3 * idf(w); score += Math.min(b, 2);
    // a question the section says it answers, said nearly the same way
    let best = 0; for (const Q of I.qs) { const hit = [...Q].filter((w) => qw.has(w)), all = new Set([...Q, ...qw]); const f = sum(hit) / Math.max(0.01, sum([...all])); if (f > best) best = f; }
    score += best >= 0.99 ? 30 : best * 16;
    // how much of what was asked this section knows about: "host on the moon" is mostly moon
    const all = new Set([...I.title, ...I.body, ...I.kws.flat(), ...I.qs.flatMap((x) => [...x])]), wt = (w) => (df.has(w) ? idf(w) : 2), tot = [...qw].reduce((a, w) => a + wt(w), 0);
    const mass = [...qw].filter((w) => all.has(w)).reduce((a, w) => a + wt(w), 0), coverage = mass / Math.max(0.01, tot);
    return { s: I.s, score, coverage, mass }; }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}
/** The best guide section for a question, or null. Pure. */
const answers = (x) => !!x && x.score >= 2.5 && x.coverage >= 0.35 && x.mass >= 1.5;
export function matchSection(message, sections = loadGuide().sections) { const R = matchSections(message, sections); return answers(R[0]) ? R[0].s : null; }
const PERSON = { label: "Talk to a person", href: "#person" };
const NOT_SURE = "I'm not sure about that one, and I'd rather not guess. A person can help, and they'll see this chat.";
/** The no-AI answer: the best section, its one-tap actions, related sections, and a person when it isn't a strong match. */
export function offlineAnswer(message, sections = loadGuide().sections) {
  // "what should I host?" is mostly stop words to the matcher; said any common way, it's the ideas answer
  const stuck = /\bwhat (?:should|could|can|do) (?:i|we) host\b|\bwhat to host\b|\bideas? (?:for|to) host\b|\b(?:i'?m|feeling) stuck\b|\bneed (?:an? )?ideas?\b/i.test(String(message || "")) && sections.find((x) => x.title === "What to host");
  const R = stuck ? [{ s: stuck, score: 20, coverage: 1, mass: 10 }, ...matchSections(message, sections).filter((x) => x.s !== stuck)] : matchSections(message, sections), top = R[0];
  if (!answers(top)) return { answer: NOT_SURE, actions: [PERSON], suggestHuman: true, section: null, confidence: "none", related: [] };
  const s = top.s, sentences = s.body.split(/(?<=[.!?])\s+/); let answer = "";
  for (const x of sentences) { if (answer && (answer + " " + x).length > 560) break; answer = answer ? answer + " " + x : x; }
  const confidence = top.score >= 5 && top.coverage >= 0.6 && (!R[1] || top.score - R[1].score >= 1) ? "high" : "medium";
  const related = R.slice(1, 4).filter((x) => x.score >= Math.max(3, top.score * 0.6)).slice(0, 2).map((x) => ({ title: x.s.title, q: x.s.questions[0] || x.s.title }));
  // a person is always one tap away in the sheet's footer; in the answer itself only when Potto isn't sure it fits
  const person = /person/i.test(s.title);
  // "what should I host?": three ideas from the ideas library, each one tap from a prefilled draft
  if (s.title === "What to host") { const L = pickIdeas(IDEAS, { n: 3 }); answer += " " + L.map((x) => `${x.title}: ${x.line}`).join(" ");
    return { answer: noDash(answer), actions: [...L.map((x) => ({ label: `Host ${x.title.toLowerCase()}`, href: `/?app=1&idea=${encodeURIComponent(x.id)}` })), ...s.links.slice(0, 1)].slice(0, 4), suggestHuman: false, section: s.title, confidence: "high", related, ideas: L }; }
  return { answer: noDash(answer), actions: [...s.links.slice(0, 3), ...(person || confidence === "high" ? [] : [PERSON])].slice(0, 4), suggestHuman: person || confidence !== "high", section: s.title, confidence, related };
}

// ---------- what Potto knows about the host (never anything about guests) ----------
const today = () => new Date().toISOString().slice(0, 10);
function eventStatus(ev) { if (ev.cancelled) return "cancelled"; if (ev.stage === "interest") return "picking a date"; if (ev.date && ev.date < today()) return "past"; return ev.published || ev.discoverable ? "shared" : "draft"; }
/** The light context: handle, what the page still needs, the page path, and one event's title, status and counts. */
export function hostContext({ store, C, user, page, eventId }) {
  const ctx = { signedIn: !!user, page: cleanPath(page) || "" };
  if (!user) return ctx;
  const h = (() => { try { return C?.profileOf?.(user.ws) || null; } catch { return null; } })();
  ctx.handle = h?.handle || ""; ctx.hasPage = !!h?.handle;
  try { ctx.pageMissing = C?.pageGaps ? C.pageGaps(h) : []; } catch { ctx.pageMissing = []; }
  const id = clean(eventId, 80);
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) { try { const S = scopeStore(store, user.ws), ev = S.get("events/" + id)?.data;
    if (ev && !ev.example) {
      // counts only: how many are in, asked or might come. Never who.
      let going = 0, asked = 0, maybe = 0; try { for (const d of S.list("rsvps")) { const r = d.data; if (r?.eventId !== id) continue; if (r.response === "going") going += Math.max(1, +r.party || (r.plusOne ? 2 : 1)); else if (r.response === "requested") asked++; else if (r.response === "maybe") maybe++; } } catch {}
      ctx.event = { id, title: clean(ev.pubTitle || ev.name, 120), status: eventStatus(ev), date: /^\d{4}-\d{2}-\d{2}$/.test(ev.date || "") ? ev.date : "", whoCanCome: ev.approvalRequired ? "they ask to join" : "anyone with the link", visibility: !ev.discoverable ? "link only" : ev.unlisted ? "on my page" : "on my page and Discover", paid: !!(ev.price && ev.price !== "chip" && !/^(free|\$?0)$/i.test(String(ev.price).trim())), hasPayLink: !!ev.ticketUrl, going, asked, maybe, spots: +ev.headcount || 0 }; } } catch {} }
  return ctx;
}
const fmtDay = (d) => { try { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return d; } };
const LOOKUP = /\b(how many|who'?s coming|who is coming|anyone (coming|replied|signed)|replies so far|status of|is my event|my event (shared|live|status)|how'?s my event|did (anyone|people) (reply|sign)|signed up so far|spots left)\b/i;
/** "Dumpling night (Sat, May 1) is shared. 3 are in, 1 asked to join." For the host's own event, counts only. */
export function lookupAnswer(ctx, message) {
  const e = ctx?.event; if (!e || !LOOKUP.test(String(message || ""))) return null;
  const parts = [`${e.going} ${e.going === 1 ? "is" : "are"} in`]; if (e.asked) parts.push(`${e.asked} asked to join`); if (e.maybe) parts.push(`${e.maybe} might come`);
  const left = e.spots ? Math.max(0, e.spots - e.going) : null;
  const status = { shared: "is shared", draft: "isn't shared yet", past: "has happened", cancelled: "is called off", "picking a date": "is picking a date" }[e.status] || "is set up";
  return { answer: `${e.title}${e.date ? ` (${fmtDay(e.date)})` : ""} ${status}. ${parts.join(", ")}${left != null && e.status !== "past" ? `, ${left} ${left === 1 ? "spot" : "spots"} left` : ""}.${e.status === "draft" ? " Share it so guests can reply." : ""}`,
    actions: [{ label: "See guests", href: `/?app=1&open=${encodeURIComponent(e.id)}&step=6#studio` }, ...(e.status === "draft" || e.status === "shared" ? [{ label: e.status === "draft" ? "Share invite" : "Open share sheet", href: "#do:share" }] : [])], section: "Your event", confidence: "high", suggestHuman: false, related: [] };
}
export function helpPrompt({ guide, ctx, message, history, best }) {
  const turns = (history || []).map((t) => `${t.role === "potto" ? "Potto" : "Host"}: ${t.text}`).join("\n");
  return `You are Potto, the help agent inside Pottery Lab, an app where hosts plan get-togethers, share invites and build a page. Answer the host's question using ONLY the guide below.

Rules:
- Speak in first person as Potto. Answer in 1 to 4 short, plain sentences.
- Say exactly where to tap, using the button and screen names in the guide.
- Never invent a feature, price, number or fact that isn't in the guide. If the guide doesn't cover it, say "I'm not sure" and offer a person (suggestHuman true).
- If the guide covers it, answer it. Don't say you're not sure when a section answers the question. The best-matching section is given below.
- If the host is stuck, upset, or asks for a person, set suggestHuman true.
- Plain words. No em dashes. No markdown.
- actions: up to 3 links from the guide that help right now, as {"label","href"}: hrefs that start with "/", or "#do:share", "#do:copy", "#do:preview", "#do:guests", "#do:open", "#do:new" (app actions the guide names). Use [] if none fit.

<guide>
${guide}
</guide>
${best ? `\n<best_match title="${best.title}">\n${best.body}\n</best_match>\n` : ""}
<host>
${JSON.stringify(ctx)}
</host>
${turns ? `\n<conversation>\n${turns}\n</conversation>\n` : ""}
Host's question: ${message}

Reply with only JSON: {"answer": "...", "actions": [{"label": "...", "href": "/..."}], "suggestHuman": false}`;
}
const okHref = (h) => h === "#person" || new RegExp(`^#do:(${DO_ACTIONS.join("|")})$`).test(h) || /^\/(?!\/)[^\s<>"']{0,200}$/.test(h);
function shapeAnswer(j) {
  const answer = noDash(clean(j?.answer, 700));
  const actions = (Array.isArray(j?.actions) ? j.actions : []).map((a) => ({ label: clean(a?.label, 40), href: String(a?.href || "").trim() })).filter((a) => a.label && okHref(a.href)).slice(0, 3);
  return { answer, actions, suggestHuman: !!j?.suggestHuman || /\bI'?m not sure\b/i.test(answer) };
}
// {handle} in a guide link becomes the host's handle; the link goes when there's none
const fillLinks = (actions, ctx) => actions.map((a) => (a.href.includes("{handle}") ? (ctx.handle ? { ...a, href: a.href.replace("{handle}", ctx.handle) } : null) : a)).filter(Boolean);
const mergeActions = (...L) => { const out = [], seen = new Set(); for (const a of L.flat()) { if (!a || seen.has(a.href)) continue; seen.add(a.href); out.push(a); } const p = out.findIndex((a) => a.href === "#person"); if (p >= 0) out.push(out.splice(p, 1)[0]); return out.slice(0, 4); };

// ---------- one line for the team, so they start where Potto left off ----------
export function ticketSummary(t) {
  const T = t.transcript || [], asks = T.filter((m) => m.role === "host"), last = [...T].reverse().find((m) => m.role === "potto");
  const parts = [];
  if (asks.length) parts.push(`Asked Potto ${asks.length === 1 ? `"${clean(asks[0].text, 90)}"` : `${asks.length} things, last "${clean(asks.at(-1).text, 90)}"`}.`);
  if (last) parts.push(last.section ? `Potto answered from "${last.section}"${last.rated === "down" ? ", rated not helpful" : last.rated === "up" ? ", rated helpful" : ""}.` : "Potto didn't have an answer.");
  if (t.context?.eventTitle) parts.push(`On ${t.context.eventTitle} (${t.context.eventStatus || "event"}).`);
  if (t.context?.device) parts.push(t.context.device + ".");
  return parts.join(" ") || clean(t.message, 140);
}

// ---------- the device, in words, for the team ----------
export function deviceOf(ua) {
  const s = String(ua || ""); const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  const br = /EdgA?\//.test(s) ? "Edge" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  const v = (s.match(/Version\/(\d+(?:\.\d+)?)/) || s.match(/(?:Chrome|CriOS|Firefox|FxiOS)\/(\d+)/) || [])[1] || "";
  return [os, br && br + (v ? " " + v : "")].filter(Boolean).join(" · ");
}

// ---------- the app's version, for tickets ----------
let APP = null;
export function appVersion() {
  if (APP) return APP; let version = "", commit = String(process.env.ENCORE_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12);
  try { version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || ""; } catch {}
  if (!commit) { try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().slice(0, 12); } catch {} }
  APP = { version, commit }; return APP;
}

// ---------- the numbers the team reads ----------
export function helpMetrics(store, now = Date.now()) {
  const since = now - 30 * DAY, docs = (p) => store.listPrefix("system", p).map((d) => d.data).filter((x) => x && (x.at || 0) >= since);
  const rates = docs("helprate-"), gaps = docs("helpgap-"), tickets = store.listPrefix("system", "support-").map((d) => d.data).filter((x) => x?.kind === "support");
  const up = rates.filter((r) => r.value === "up").length, down = rates.length - up;
  const bySection = {}; for (const r of rates) { const k = r.section || "(no answer)"; const b = (bySection[k] ||= { section: k, up: 0, down: 0 }); b[r.value === "up" ? "up" : "down"]++; }
  const firstReply = tickets.map((t) => { const f = (t.thread || []).find((m) => m.by === "team"); return f ? (f.at - t.at) / HOUR : null; }).filter((x) => x != null && x >= 0).sort((a, b) => a - b);
  const csat = tickets.filter((t) => t.csat?.value), happy = csat.filter((t) => t.csat.value === "up").length;
  const recent = tickets.filter((t) => (t.at || 0) >= since);
  const S = store.listPrefix("system", "helpstats-").map((d) => d.data).filter((d) => d && Date.parse(d.day) >= since - DAY), add = (f) => S.reduce((a, d) => a + (d[f] || 0), 0);
  const asks = add("asks"), answered = add("answered") + add("lookups");
  return {
    asks: { total: asks, answered, unsure: add("unsure"), handoffs: add("handoffs"), answeredRate: asks ? Math.round((answered / asks) * 100) : null, handoffRate: asks ? Math.round((add("handoffs") / asks) * 100) : null },
    days: 30,
    answers: { rated: rates.length, up, down, helpful: rates.length ? Math.round((up / rates.length) * 100) : null, worst: Object.values(bySection).filter((b) => b.down).sort((a, b) => b.down - a.down).slice(0, 5) },
    gaps: { count: gaps.length, recent: gaps.sort((a, b) => b.at - a.at).slice(0, 8).map((g) => ({ q: g.q, page: g.page, at: g.at })) },
    tickets: { open: tickets.filter((t) => t.status === "open").length, waiting: tickets.filter((t) => t.status === "waiting").length, solved: tickets.filter((t) => t.status === "solved").length, new30: recent.length, fromPotto: recent.filter((t) => (t.transcript || []).length).length,
      medianFirstReplyHours: firstReply.length ? Math.round(firstReply[Math.floor(firstReply.length / 2)] * 10) / 10 : null, promiseHours: replyHours(),
      csatRated: csat.length, csat: csat.length ? Math.round((happy / csat.length) * 100) : null },
  };
}

/** Counts for one day, so the team sees how much Potto answers and how much reaches a person. */
export function countHelp(store, field, now = Date.now()) {
  try { const k = "system/helpstats-" + new Date(now).toISOString().slice(0, 10), d = store.get(k)?.data || { kind: "helpstats", day: k.slice(-10) }; d[field] = (d[field] || 0) + 1; store.set(k, d); } catch {}
}
export const refOf = (id) => String(id || "").slice(0, 6).toUpperCase();

export function mountHelp(app, { store, express, currentUser, C, X, sendStatic, publicOrigin }) {
  const body = express.json({ limit: "64kb" });
  const hits = new Map();
  const limited = (k, n) => { const now = Date.now(), h = (hits.get(k) || []).filter((t) => now - t < HOUR); if (h.length >= n) { hits.set(k, h); return true; } h.push(now); hits.set(k, h); return false; };
  const me = (req) => { try { return currentUser(req); } catch { return null; } };
  const isAdmin = (u) => !!u && adminEmails().includes(lc(u.email));
  const key = (id) => "system/support-" + id;
  const all = () => store.listPrefix("system", "support-").map((d) => d.data).filter((x) => x?.kind === "support");
  const get = (id) => { const s = String(id || "").replace(/[^a-f0-9]/g, ""); return s ? store.get(key(s))?.data || null : null; };
  const put = (t) => store.set(key(t.id), t);
  const origin = (req) => { try { return publicOrigin(req); } catch { return ""; } };
  const emailCfg = () => emailConfig(DEFAULT_WS, true);
  const hp = (b) => !!clean(b?.website, 200) || !!clean(b?.url_hp, 200);
  const askLimited = (req, u) => (u ? limited("ask:u:" + lc(u.email), Number(process.env.ENCORE_HELP_PER_HOUR || 30)) : limited("ask:ip:" + (req.ip || "?"), Number(process.env.ENCORE_HELP_PER_HOUR_IP || 10)));
  app.locals.help = { lastPrompt: "" };

  app.get("/api/help/info", (req, res) => res.json({ replyHours: replyHours(), replyWithin: replyWithin(), expect: expectLine() }));

  // ---- ask Potto ----
  app.post("/api/help/ask", body, async (req, res) => {
    const b = req.body || {}, u = me(req), page = cleanPath(b.page);
    if (hp(b)) return res.status(400).json({ code: "rejected", message: "Couldn't send that." });
    if (!u && !OPEN_HELP_PAGE.test(page)) return res.status(401).json({ code: "account_required", message: "Sign in to ask Potto." });
    if (askLimited(req, u)) return res.status(429).json({ code: "rate_limited", message: "That's a lot of questions for one hour. Talk to a person, or try again soon.", suggestHuman: true });
    const message = cleanText(b.message, 1000); if (message.length < 2) return res.status(400).json({ code: "invalid", message: "Ask me something first." });
    const history = (Array.isArray(b.history) ? b.history : []).slice(-8).map((t) => ({ role: t?.role === "potto" ? "potto" : "host", text: cleanText(t?.text, 600) })).filter((t) => t.text);
    const ctx = hostContext({ store, C, user: u, page, eventId: u ? b.eventId : "" });
    const G = loadGuide(), o = offlineAnswer(message, G.sections), best = o.section ? G.sections.find((s) => s.title === o.section) : null;
    const gap = () => { countHelp(store, o.section ? "answered" : "unsure"); if (o.section) return; try { const id = rid(); store.set("system/helpgap-" + id, { kind: "helpgap", id, q: clean(message, 300), page, signedIn: !!u, at: Date.now() }); } catch {} };
    const upset = WANTS_PERSON.test(message); countHelp(store, "asks");
    const look = lookupAnswer(ctx, message); if (look) countHelp(store, "lookups"); if (look) return res.json({ ...look, actions: fillLinks(look.actions, ctx), mode: "lookup" });
    const prompt = helpPrompt({ guide: G.md, ctx, message, history, best }); app.locals.help.lastPrompt = prompt;
    if (aiMode() === "live" && G.sections.length) {
      try { const r = await complete({ prompt, effort: "low" }); const out = shapeAnswer(parseJsonLoose(r.text));
        // "I'm not sure" while the guide has a strong answer is not true: the guide's answer goes out instead
        if (out.answer && !(out.suggestHuman && /\bnot sure\b/i.test(out.answer) && o.confidence === "high")) {
          if (/\bnot sure\b/i.test(out.answer)) { if (o.section) countHelp(store, "unsure"); else gap(); } else countHelp(store, "answered");
          return res.json({ answer: out.answer, actions: fillLinks(mergeActions(out.actions, best?.links || [], out.suggestHuman || upset ? [PERSON] : []), ctx), suggestHuman: out.suggestHuman || upset, section: o.section, confidence: out.suggestHuman ? "low" : o.confidence === "none" ? "medium" : o.confidence, related: o.related, mode: "live" }); } }
      catch (e) { console.warn("[help] model call failed, using the guide:", e?.code || e?.message || "error"); }
    }
    gap();
    if (upset && o.section) return res.json({ answer: `Sorry it's been a pain. ${o.answer}`, actions: fillLinks(mergeActions(o.actions, [PERSON]), ctx), suggestHuman: true, section: o.section, confidence: o.confidence, related: o.related, mode: "guide" });
    res.json({ answer: o.answer, actions: fillLinks(mergeActions(o.actions), ctx), suggestHuman: o.suggestHuman, section: o.section, confidence: o.confidence, related: o.related, mode: "guide" });
  });

  // ---- Did this help? ----
  app.post("/api/help/rate", body, (req, res) => {
    const b = req.body || {}, u = me(req), page = cleanPath(b.page);
    if (!u && !OPEN_HELP_PAGE.test(page)) return res.status(401).json({ code: "account_required", message: "Sign in first." });
    if (!["up", "down"].includes(b.value)) return res.status(400).json({ code: "invalid", message: "Pick a thumb." });
    if (u ? limited("rate:u:" + lc(u.email), 60) : limited("rate:ip:" + (req.ip || "?"), 30)) return res.status(429).json({ code: "rate_limited", message: "Thanks, we've got it." });
    const id = rid(); store.set("system/helprate-" + id, { kind: "helprate", id, value: b.value, section: clean(b.section, 120), question: clean(b.question, 300), mode: clean(b.mode, 20), page, signedIn: !!u, at: Date.now() });
    res.json({ ok: true });
  });

  // ---- talk to a person ----
  async function tellTeam(t, req, line) {
    const out = { email: false, sms: 0 }, to = list(process.env.ENCORE_SUPPORT_EMAIL).filter((x) => EMAIL_RE.test(x)), cfg = emailCfg(), link = `${origin(req)}/support#t-${t.id}`;
    if (to.length && cfg) { const ctxt = t.context || {};
      const chat = (t.transcript || []).length ? `\n\nChat with Potto first:\n${t.transcript.map((m) => `${m.role === "potto" ? "Potto" : "Them"}: ${m.text}`).join("\n")}` : "";
      const text = `${line}\n\nFrom: ${t.name || "(no name)"} <${t.email}>${t.phone ? `, ${t.phone}` : ""}${t.handle ? `, @${t.handle}` : ""}${t.signedIn ? "" : " (not signed in)"}\n${t.topic ? `Topic: ${TOPICS[t.topic] || t.topic}\n` : ""}Page: ${ctxt.page || "?"}${ctxt.eventId ? `\nEvent: ${ctxt.eventTitle || ""} (${ctxt.eventId})` : ""}\nSummary: ${t.summary || ""}\nDevice: ${ctxt.device || "?"}\nBrowser: ${ctxt.browser || "?"}\nApp: ${[ctxt.app?.version, ctxt.app?.commit].filter(Boolean).join(" ") || "?"}\n\n${t.thread[t.thread.length - 1]?.text || t.message}${t.thread.length > 1 ? "" : chat}\n\nOpen the ticket: ${link}`;
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
    const transcript = (Array.isArray(b.transcript) ? b.transcript : []).slice(-20).map((t) => ({ role: t?.role === "potto" ? "potto" : "host", text: cleanText(t?.text, 600), ...(t?.section ? { section: clean(t.section, 120) } : {}), ...(t?.rated === "up" || t?.rated === "down" ? { rated: t.rated } : {}) })).filter((t) => t.text);
    // the person never repeats themselves: with a chat attached, the message can be empty and the last question stands in
    let message = cleanText(b.message, 4000); const lastQ = [...transcript].reverse().find((t) => t.role === "host")?.text || "";
    if (message.length < 3 && lastQ) message = lastQ;
    if (message.length < 3) return res.status(400).json({ code: "invalid", message: "Say what's wrong, even in a few words." });
    const phone = /^\+?[0-9 ()-]{7,20}$/.test(clean(b.phone, 30)) ? clean(b.phone, 30) : "";
    const page = cleanPath(b.page), eventId = clean(b.eventId, 80), ctx = hostContext({ store, C, user: u, page, eventId: u ? eventId : "" });
    const browser = clean(b.browser || req.get("user-agent"), 300);
    const now = Date.now(), t = { kind: "support", id: rid(), status: "open", at: now, updatedAt: now, email, name: clean(u?.name || b.name, 120), phone, signedIn: !!u, ws: u?.ws || null, handle: ctx.handle || "",
      topic: TOPICS[b.topic] ? b.topic : "", message,
      context: { page, eventId: ctx.event ? eventId : "", eventTitle: ctx.event?.title || "", eventStatus: ctx.event?.status || "", pageMissing: ctx.pageMissing || [], browser, device: deviceOf(browser), app: appVersion() },
      screenshot: u && /^\/_blob\/[A-Za-z0-9]{20}$/.test(String(b.screenshot || "")) ? b.screenshot : "",
      transcript, thread: [{ by: "host", name: clean(u?.name || b.name, 80), text: message, at: now }] };
    t.summary = ticketSummary(t); put(t); countHelp(store, "handoffs");
    const told = await tellTeam(t, req, `New help request${u ? "" : " (not signed in)"}.`);
    put({ ...t, notified: told });
    // a receipt, so they know it landed: only to a signed-in host's own, proven email (never to an address typed in a form)
    if (u) { const cfg = emailCfg(); if (cfg) sendEmail(cfg, { to: email, subject: `We got your message (ref ${refOf(t.id)})`, text: `Hi ${clean(t.name, 80).split(" ")[0] || "there"},\n\nThanks for writing. ${expectLine()}\n\nWhat you sent:\n${message}\n\nYou can follow along in the help panel: ${origin(req)}/?app=1&help=1\n\nRef ${refOf(t.id)}\nPottery Lab`, replyTo: list(process.env.ENCORE_SUPPORT_EMAIL).find((x) => EMAIL_RE.test(x)) || undefined }).catch(() => {}); }
    console.log(`[help] ticket ${t.id} from ${t.signedIn ? "a host" : "someone signed out"}: ${clean(message, 120)}`);
    res.json({ ok: true, id: t.id, ref: refOf(t.id), status: t.status, expect: expectLine(u ? "" : email), replyHours: replyHours(), ticket: u ? view(t) : null });
  });
  // the host's own conversations
  const view = (t) => ({ id: t.id, status: t.status, at: t.at, updatedAt: t.updatedAt, message: t.message, csat: t.csat?.value || "", thread: (t.thread || []).map((m) => ({ by: m.by, name: m.by === "team" ? "Pottery Lab" : m.name || "", text: m.text, at: m.at })) });
  app.get("/api/help/tickets", (req, res) => { const u = me(req); if (!u) return res.status(401).json({ code: "account_required", message: "Sign in to see your conversations." });
    res.json({ tickets: all().filter((t) => lc(t.email) === lc(u.email)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30).map(view), admin: isAdmin(u), replyWithin: replyWithin() }); });
  const ownTicket = (req, res) => { const u = me(req); if (!u) { res.status(401).json({ code: "account_required", message: "Sign in first." }); return null; }
    const t = get(req.params.id); if (!t || lc(t.email) !== lc(u.email)) { res.status(404).json({ code: "not_found", message: "We can't find that conversation." }); return null; } return { u, t }; };
  app.post("/api/help/tickets/:id", body, async (req, res) => { const o = ownTicket(req, res); if (!o) return; const { u, t } = o;
    if (limited("t:u:" + lc(u.email), Number(process.env.ENCORE_HELP_TICKETS_PER_HOUR || 10))) return res.status(429).json({ code: "rate_limited", message: "Give us a little time to reply." });
    const text = cleanText(req.body?.text, 4000); if (!text) return res.status(400).json({ code: "invalid", message: "Write a message." });
    const now = Date.now(); t.thread = [...(t.thread || []), { by: "host", name: clean(u.name, 80), text, at: now }].slice(-100); t.status = "open"; t.updatedAt = now; put(t);
    await tellTeam(t, req, `${clean(u.name || u.email, 80)} replied.`);
    res.json({ ok: true, ticket: view(t) }); });
  // How did we do? once the team marked it solved
  app.post("/api/help/tickets/:id/rate", body, (req, res) => { const o = ownTicket(req, res); if (!o) return; const { t } = o;
    if (!["up", "down"].includes(req.body?.value)) return res.status(400).json({ code: "invalid", message: "Pick a thumb." });
    if (t.status !== "solved") return res.status(400).json({ code: "not_solved", message: "You can rate it once it's sorted." });
    t.csat = { value: req.body.value, note: clean(req.body?.note, 300), at: Date.now() }; put(t); res.json({ ok: true, ticket: view(t) }); });

  // ---- the team inbox ----
  const notFound = (res) => { res.status(404); return sendStatic ? sendStatic(res, "404.html", "<p>Page not found.</p>") : res.type("text").send("Not found"); };
  app.get("/support", (req, res) => { const u = me(req); if (!isAdmin(u)) return notFound(res); res.set("Cache-Control", "private, no-store").type("html").send(ADMIN_PAGE); });
  app.get("/api/support/tickets", (req, res) => { const u = me(req); if (!isAdmin(u)) return res.status(404).json({ code: "not_found", message: "Not found." });
    const want = STATUSES.includes(req.query.status) ? req.query.status : "", order = { open: 0, waiting: 1, solved: 2 };
    res.json({ tickets: all().filter((t) => !want || t.status === want).sort((a, b) => (order[a.status] - order[b.status]) || b.updatedAt - a.updatedAt).slice(0, 300), counts: Object.fromEntries(STATUSES.map((s) => [s, all().filter((t) => t.status === s).length])) }); });
  app.get("/api/support/metrics", (req, res) => { const u = me(req); if (!isAdmin(u)) return res.status(404).json({ code: "not_found", message: "Not found." }); res.json(helpMetrics(store)); });
  app.post("/api/support/tickets/:id", body, async (req, res) => { const u = me(req); if (!isAdmin(u)) return res.status(404).json({ code: "not_found", message: "Not found." });
    const t = get(req.params.id); if (!t) return res.status(404).json({ code: "not_found", message: "No such ticket." });
    const reply = cleanText(req.body?.reply, 4000), status = STATUSES.includes(req.body?.status) ? req.body.status : reply ? "waiting" : t.status, now = Date.now(), notified = { inbox: false, email: false };
    if (!reply && status === t.status) return res.status(400).json({ code: "invalid", message: "Write a reply or pick a status." });
    if (reply) { t.thread = [...(t.thread || []), { by: "team", name: clean(u.name, 80), email: lc(u.email), text: reply, at: now }].slice(-100);
      if (t.signedIn && X?.notify) { try { X.notify(t.email, { kind: "support", text: `💬 Pottery Lab: ${clean(reply, 120)}`, link: "/?app=1&help=1" }); notified.inbox = true; } catch {} }
      const cfg = emailCfg(); if (cfg) { const first = clean(t.name, 80).split(" ")[0];
        const r = await sendEmail(cfg, { to: t.email, subject: "Re: your Pottery Lab question", text: `Hi ${first || "there"},\n\n${reply}\n\n${t.signedIn ? `You can also reply in the help panel: ${origin(req)}/?app=1&help=1` : "Reply to this email to keep talking."}\n\nPottery Lab`, replyTo: list(process.env.ENCORE_SUPPORT_EMAIL).find((x) => EMAIL_RE.test(x)) || lc(u.email) }).catch(() => ({ ok: false }));
        notified.email = !!r?.ok; } }
    if (status === "solved" && t.status !== "solved" && t.signedIn && X?.notify && !reply) { try { X.notify(t.email, { kind: "support", text: "💬 Pottery Lab marked your question sorted. How did we do?", link: "/?app=1&help=1" }); notified.inbox = true; } catch {} }
    t.status = status; t.updatedAt = now; put(t);
    res.json({ ok: true, ticket: t, notified }); });
}

// The team inbox page. Served only to admins, so it isn't a file under public/.
const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Help inbox · Pottery Lab</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#1B1D1C;--soft:#444845;--line:#CFC8B9;--bg:#EFEBE2;--clay:#29489A}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 60px}h1{font:600 28px 'IBM Plex Sans',Georgia,serif;margin:0 0 4px}.sub{color:var(--soft);margin:0 0 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 16px}.stat{background:#fff;border:1.5px solid var(--line);border-radius:16px;padding:12px 14px}.stat b{display:block;font:600 28px 'IBM Plex Sans',Georgia,serif}.stat span{color:var(--soft);font-size:13px}
.gaps{background:#fff;border:1.5px solid var(--line);border-radius:16px;padding:12px 14px;margin:0 0 16px}.gaps h2{font:600 16px 'IBM Plex Sans',system-ui,sans-serif;margin:0 0 6px}.gaps ul{margin:0;padding-left:18px;font-size:14px}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}.tabs button{border:1.5px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;min-height:44px}.tabs button[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.t{background:#fff;border:1.5px solid var(--line);border-radius:16px;padding:16px;margin:0 0 14px}.t:target{outline:3px solid #F3E7A8}
.top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.top b{font-size:16px}.pill{font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;background:#FDE7DF;color:#29489A}.pill.waiting{background:#F7EFCB;color:#6B4E00}.pill.solved{background:#E3F2E6;color:#245C33}
.muted{color:var(--soft);font-size:13px}dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:2px 10px;margin:10px 0;font-size:13px}dt{color:var(--soft)}dd{margin:0;overflow-wrap:anywhere}
.ctx{background:#FBF7F0;border-radius:12px;padding:8px 12px;margin:10px 0}.ctx h3{font:600 14px "IBM Plex Sans",system-ui;margin:0 0 4px}
.msg{border-left:3px solid var(--line);padding:4px 10px;margin:8px 0;white-space:pre-wrap}.msg.team{border-color:var(--clay)}.msg small{display:block;color:var(--soft);font-size:12px}
details{margin:8px 0}summary{cursor:pointer;font-weight:600;font-size:13px;min-height:28px}
form{display:grid;gap:8px;margin-top:10px}textarea{width:100%;min-height:80px;border:1.5px solid #1B1D1C;border-radius:12px;padding:10px;font:inherit}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}select{border:1.5px solid #1B1D1C;border-radius:12px;padding:8px;font:inherit;min-height:44px}
button.go{border:0;background:var(--clay);color:#fff;border-radius:999px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer;min-height:44px}
.ok{color:#245C33;font-size:13px}.err{color:#A93A3A;font-size:13px}
</style></head><body><main><h1>Help inbox</h1><p class="sub">What hosts asked for. Replies go to them in the app and by email.</p>
<section class="stats" id="stats" aria-label="The last 30 days"></section><section class="gaps" id="gaps" hidden><h2>Questions Potto couldn't answer</h2><ul></ul><p class="muted" style="margin:6px 0 0">Add an answer to docs/help.md and Potto picks it up.</p></section>
<div class="tabs" role="group" aria-label="Show"><button data-s="open" aria-pressed="true">Open</button><button data-s="waiting" aria-pressed="false">Waiting</button><button data-s="solved" aria-pressed="false">Solved</button><button data-s="" aria-pressed="false">All</button></div>
<div id="list" aria-live="polite">Loading…</div></main>
<script>
(function(){ let want="open"; const L=document.getElementById("list");
  const el=(t,c,x)=>{ const e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e };
  const when=(t)=>new Date(t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  const TOP=${JSON.stringify(TOPICS)};
  async function stats(){ try{ const r=await fetch("/api/support/metrics",{credentials:"same-origin"}); if(!r.ok) return; const m=await r.json(); const S=document.getElementById("stats"); S.textContent="";
    const tile=(big,small)=>{ const d=el("div","stat"); d.append(el("b",null,big),el("span",null,small)); S.append(d) };
    tile(m.asks.answeredRate==null?"None yet":m.asks.answeredRate+"%", "of "+m.asks.total+" questions Potto answered. "+m.asks.handoffs+" went to a person");
    tile(m.answers.helpful==null?"None yet":m.answers.helpful+"%", "of Potto's rated answers helped ("+m.answers.rated+" rated, 30 days)");
    tile(m.tickets.csat==null?"None yet":m.tickets.csat+"%", "happy after a person helped ("+m.tickets.csatRated+" rated)");
    tile(m.tickets.medianFirstReplyHours==null?"None yet":m.tickets.medianFirstReplyHours+"h", "median first reply. We promise "+m.tickets.promiseHours+"h");
    tile(String(m.tickets.open), "open, "+m.tickets.waiting+" waiting on the host");
    tile(String(m.gaps.count), "questions Potto couldn't answer (30 days)");
    const G=document.getElementById("gaps"); if(m.gaps.recent.length){ G.hidden=false; const ul=G.querySelector("ul"); ul.textContent=""; for(const g of m.gaps.recent){ ul.append(el("li",null,g.q+(g.page?" ("+g.page+")":""))) } }
    if(m.answers.worst.length){ const d=el("div","stat"); d.append(el("span",null,"Answers people said didn't help: "+m.answers.worst.map(w=>w.section+" ("+w.down+")").join(", "))); S.append(d) } }catch{} }
  function card(t){ const c=el("article","t"); c.id="t-"+t.id; const top=el("div","top"); top.append(el("b",null,t.name||t.email), el("span","pill "+t.status,t.status), el("span","muted","Ref "+t.id.slice(0,6).toUpperCase()+" · "+when(t.at)+(t.signedIn?"":" · not signed in"))); if(t.csat&&t.csat.value) top.append(el("span","muted",t.csat.value==="up"?"Rated: helped":"Rated: didn't help")); c.append(top);
    const dl=el("dl"); const add=(k,v,href)=>{ if(!v) return; dl.append(el("dt",null,k)); const d=el("dd"); if(href){ const a=el("a",null,v); a.href=href; d.append(a) } else d.textContent=v; dl.append(d) };
    if(t.summary){ const s=el("p","ctx",t.summary); s.style.margin="10px 0 0"; c.append(s) }
    add("Email",t.email,"mailto:"+t.email); add("Phone",t.phone); add("Page",t.handle?"@"+t.handle:"",t.handle?"/@"+t.handle:""); add("Topic",TOP[t.topic]||""); const x=t.context||{};
    add("On",x.page); add("Event",x.eventId?((x.eventTitle||"")+" ("+x.eventId+")"+(x.eventStatus?", "+x.eventStatus:"")):""); add("Page needs",(x.pageMissing||[]).join(", ")); add("Device",x.device); add("Browser",x.browser); add("App",[x.app&&x.app.version,x.app&&x.app.commit].filter(Boolean).join(" ")); add("Screenshot",t.screenshot?"Open":"",t.screenshot||"");
    add("Told team",t.notified?((t.notified.email?"email":"no email")+(t.notified.sms?", "+t.notified.sms+" text"+(t.notified.sms>1?"s":""):"")):""); c.append(dl);
    if((t.transcript||[]).length){ const d=el("details","ctx"); d.open=true; d.append(el("summary",null,"Chat with Potto before this ("+t.transcript.length+")")); for(const m of t.transcript){ const p=el("div","msg"+(m.role==="potto"?" team":"")); p.append(el("small",null,(m.role==="potto"?"Potto":(t.signedIn?"Host":"Visitor"))+(m.section?" · from "+m.section:"")+(m.rated?" · rated "+(m.rated==="up"?"helpful":"not helpful"):""))); p.append(document.createTextNode(m.text)); d.append(p) } c.append(d) }
    for(const m of t.thread||[]){ const p=el("div","msg"+(m.by==="team"?" team":"")); p.append(el("small",null,(m.by==="team"?"Team"+(m.name?" ("+m.name+")":""):(m.name||(t.signedIn?"Host":"Visitor")))+" · "+when(m.at))); p.append(document.createTextNode(m.text)); c.append(p) }
    const f=el("form"); const lab=el("label","muted","Reply"); const ta=el("textarea"); ta.name="reply"; ta.setAttribute("aria-label","Reply to "+(t.name||t.email)); lab.append(ta);
    const row=el("div","row"); const sel=el("select"); sel.setAttribute("aria-label","Status"); for(const s of ["open","waiting","solved"]){ const o=el("option",null,s[0].toUpperCase()+s.slice(1)); o.value=s; if(s===(t.status==="open"?"waiting":t.status)) o.selected=true; sel.append(o) }
    const go=el("button","go","Send"); go.type="submit"; const note=el("span","muted"); row.append(sel,go,note); f.append(lab,row);
    f.onsubmit=async(e)=>{ e.preventDefault(); go.disabled=true; note.className="muted"; note.textContent="Sending…"; try{ const r=await fetch("/api/support/tickets/"+t.id,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({reply:ta.value,status:sel.value})}); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.message||"Couldn't send that."); note.className="ok"; note.textContent=ta.value.trim()?("Sent"+(j.notified&&j.notified.email?", emailed":"")+(j.notified&&j.notified.inbox?", in their app":"")+"."):"Saved."; setTimeout(load,900) }catch(err){ note.className="err"; note.textContent=err.message } go.disabled=false };
    c.append(f); return c }
  async function load(){ try{ const r=await fetch("/api/support/tickets"+(want?"?status="+want:""),{credentials:"same-origin"}); const j=await r.json(); L.textContent=""; document.querySelectorAll(".tabs button").forEach(b=>{ const n=j.counts&&b.dataset.s?j.counts[b.dataset.s]:null; b.textContent=(b.dataset.s?b.dataset.s[0].toUpperCase()+b.dataset.s.slice(1):"All")+(n!=null?" ("+n+")":"") });
      if(!(j.tickets||[]).length){ L.append(el("p","muted","Nothing here.")); return } for(const t of j.tickets) L.append(card(t)); if(location.hash){ const x=document.querySelector(location.hash); if(x) x.scrollIntoView() } }catch{ L.textContent="Couldn't load the inbox." } stats() }
  document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{ want=b.dataset.s; document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); load() });
  if(location.hash) { want=""; document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.s===""))) }
  load() })();
</script></body></html>`;
