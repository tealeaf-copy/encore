// Getting ready for the first cohort: the launch checklist, the goal, invite code batches and the status line.
//
// - GET /admin/launch (admins only, ENCORE_ADMIN_EMAILS with a confirmed email; 404 for everyone else): every setting
//   the cohort needs as green, amber or red, read from this running server's config (never a value, only whether it
//   is there and looks right), the goal (hosts onboarded, events created and happened, registrants, brand accounts
//   against 10 / 10 / 100 / 10), invite code batches, the status line and the last client errors (server/errors.js).
//   GET /api/admin/launch is the same as JSON. docs/launch-checklist.md is the owner's version, with how to set each.
// - Invite code batches: POST /api/admin/codes { role: host | guest | brand, n: 1-200, label } makes n single-use codes
//   tagged with the batch (system/code-<code>, the same codes sign-up already checks, server/community.js) and a batch
//   doc (system/codebatch-<id>). GET /api/admin/codes lists batches with how many were used;
//   GET /api/admin/codes/:id.csv gives code, sign-up link, used, used by. A batch code connects nobody: it isn't a
//   friend's code, so nobody follows anyone when it's used.
// - The status line: POST /api/admin/incident { on, message } (admins) keeps one message server-side (system/incident).
//   GET /api/status (anyone) reads it; public/report.js shows a quiet banner and the help sheet shows it too.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { scopeStore, getWorkspace, allWorkspaceIds, DEFAULT_WS } from "./workspaces.js";
import { emailConfig, EMAIL_RE } from "./email.js";
import { smsConfig } from "./sms.js";
import { isExampleEmail } from "./recognition.js";
import { errorLog } from "./errors.js";
import { replyHours } from "./help.js";

const DAY = 864e5;
export const GOAL = { hosts: 10, events: 10, registrants: 100, brands: 10 };
export const ROLES = ["host", "guest", "brand"];
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const list = (v) => String(v || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const has = (env, k) => String(env[k] ?? "").trim() !== "";
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// ---------- the checklist, from the running server's config ----------
/** Every launch item as { id, group, label, status: green | amber | red, note, required }. Never includes a value. */
export function launchChecks(env = process.env, { dataDir = "", store = null, batches = [] } = {}) {
  const out = [], add = (group, id, label, status, note, required = false) => out.push({ group, id, label, status, note, required });
  const G = "green", A = "amber", R = "red";
  // the server
  const pub = String(env.ENCORE_PUBLIC_URL || "");
  add("Server", "public_url", "Public address (ENCORE_PUBLIC_URL)", !pub ? R : /^https:\/\/[^/\s]+\/?$/.test(pub) ? G : A, !pub ? "Not set: links in emails and texts point nowhere." : /^https:\/\//.test(pub) ? "Set." : "Set, but not https.", true);
  add("Server", "trust_proxy", "Behind Render's proxy (ENCORE_TRUST_PROXY=1)", env.ENCORE_TRUST_PROXY === "1" ? G : R, env.ENCORE_TRUST_PROXY === "1" ? "On: limits count each person, not the proxy." : "Off: every visitor looks like one address, so rate limits hit everyone at once.", true);
  const sec = String(env.SESSION_SECRET || "");
  add("Server", "session_secret", "Sign-in secret (SESSION_SECRET)", sec.length >= 32 ? G : sec ? A : R, sec.length >= 32 ? "Set." : sec ? "Set, but short. Use 32+ random characters." : "Not set: sign-ins end on every restart.", true);
  add("Server", "signup", "Sign-up on (ENCORE_SIGNUP=1)", env.ENCORE_SIGNUP === "1" ? G : R, env.ENCORE_SIGNUP === "1" ? "On." : "Off: nobody can make an account.", true);
  const tmp = os.tmpdir(), dd = path.resolve(dataDir || env.DATA_DIR || "data"), onDisk = !dd.startsWith(path.resolve(tmp)) && (/^\/(app\/data|var\/data)/.test(dd) || has(env, "DATA_DIR"));
  let dbOk = false; try { dbOk = fs.existsSync(dd) && fs.readdirSync(dd).some((f) => /\.db$/.test(f)); } catch {}
  add("Data", "disk", "Database on the persistent disk", onDisk && dbOk ? G : dbOk ? A : R, onDisk && dbOk ? "The database is on the mounted disk." : dbOk ? "The database isn't on a mounted disk path (/app/data on Render). Check the disk in Render." : "No database file found in the data folder.", true);
  let newest = 0; try { for (const f of fs.readdirSync(path.join(dd, "backups"))) if (/\.db$/.test(f)) newest = Math.max(newest, fs.statSync(path.join(dd, "backups", f)).mtimeMs); } catch {}
  add("Data", "backup", "A recent backup", newest && Date.now() - newest < 2 * DAY ? G : A, newest ? `Last copy in backups/ is ${Math.max(0, Math.round((Date.now() - newest) / DAY))} days old.` : "No copy in data/backups yet. Render snapshots the disk daily; make one copy before inviting anyone (see the checklist).");
  // who gets in
  add("Who gets in", "invite_only", "Invite-only (ENCORE_INVITE_ONLY=1)", env.ENCORE_INVITE_ONLY === "1" ? G : A, env.ENCORE_INVITE_ONLY === "1" ? "On: new hosts and brands need a code." : "Off: anyone with the link can sign up.");
  const open = batches.reduce((a, b) => a + (b.n - b.used), 0), roles = new Set(batches.map((b) => b.role));
  add("Who gets in", "codes", "Invite codes for the cohort", open >= 20 && roles.has("host") && roles.has("brand") ? G : open ? A : env.ENCORE_INVITE_ONLY === "1" ? R : A, batches.length ? `${batches.length} batch${batches.length === 1 ? "" : "es"}, ${open} unused (${[...roles].join(", ")}).` : "No batches yet. Make one for hosts and one for brands below.", env.ENCORE_INVITE_ONLY === "1");
  const admins = list(env.ENCORE_ADMIN_EMAILS);
  add("Who gets in", "admins", "Admins (ENCORE_ADMIN_EMAILS)", admins.length ? G : R, admins.length ? `${admins.length} admin${admins.length === 1 ? "" : "s"}.` : "Not set.", true);
  // support
  const sup = list(env.ENCORE_SUPPORT_EMAIL).filter((x) => EMAIL_RE.test(x));
  add("Support", "support_email", "Support inbox (ENCORE_SUPPORT_EMAIL)", sup.length ? G : R, sup.length ? "Set: new tickets are emailed there." : "Not set: tickets are stored on /support but nobody is emailed.", true);
  const sms = smsConfig(), supSms = list(env.ENCORE_SUPPORT_SMS);
  add("Support", "support_sms", "Support phone for urgent tickets (ENCORE_SUPPORT_SMS)", supSms.length && sms ? G : supSms.length ? R : A, supSms.length && sms ? "Set: event-day tickets text it right away." : supSms.length ? "Set, but texting isn't set up (Twilio below)." : "Not set: event-day tickets are emailed only.");
  add("Support", "reply_hours", "Promised reply time (ENCORE_SUPPORT_REPLY_HOURS)", has(env, "ENCORE_SUPPORT_REPLY_HOURS") ? G : A, `${replyHours()} hours${has(env, "ENCORE_SUPPORT_REPLY_HOURS") ? "" : " (the default)"}.`);
  // sending
  const em = (() => { try { return emailConfig(DEFAULT_WS, true); } catch { return null; } })();
  add("Sending", "email", "Email (ENCORE_EMAIL_KEY, ENCORE_EMAIL_FROM)", em && em.service !== "fake" ? G : em ? A : R, em && em.service !== "fake" ? `Sending through ${em.service}.` : em ? "Fake email (tests only): nothing leaves the server." : "Not set: no sign-in links, receipts or replies go out.", true);
  add("Sending", "sms", "Texts (ENCORE_TWILIO_SID, ENCORE_TWILIO_TOKEN, ENCORE_TWILIO_FROM)", sms && sms.service !== "fake" ? G : sms ? A : A, sms && sms.service !== "fake" ? "Twilio is set." : sms ? "Fake texts (tests only)." : "Not set: no text sign-in, reminders or urgent alerts.");
  // sign-in providers (a half-set provider is worse than none: the button shows and fails)
  const apple = ["ENCORE_APPLE_SERVICES_ID", "ENCORE_APPLE_TEAM_ID", "ENCORE_APPLE_KEY_ID", "ENCORE_APPLE_PRIVATE_KEY"].filter((k) => has(env, k)).length;
  add("Sign-in", "apple", "Sign in with Apple", apple === 4 ? G : apple ? R : A, apple === 4 ? "Set." : apple ? `${apple} of 4 keys set.` : "Not set (optional).");
  const goog = (has(env, "ENCORE_GOOGLE_CLIENT_ID") || has(env, "GOOGLE_CLIENT_ID")) + (has(env, "ENCORE_GOOGLE_CLIENT_SECRET") || has(env, "GOOGLE_CLIENT_SECRET"));
  add("Sign-in", "google", "Sign in with Google", goog === 2 ? G : goog ? R : A, goog === 2 ? "Set." : goog ? "1 of 2 keys set." : "Not set (optional).");
  // features
  add("Features", "ai", "Potto's writing (ANTHROPIC_API_KEY)", has(env, "ANTHROPIC_API_KEY") ? G : A, has(env, "ANTHROPIC_API_KEY") ? "Set." : "Not set: Potto answers from the help guide only and drafts are simpler.");
  const sk = String(env.STRIPE_SECRET_KEY || "");
  add("Features", "stripe", "Payments for memberships and bookings (STRIPE_SECRET_KEY)", /^sk_live_/.test(sk) && env.ENCORE_STRIPE_LIVE === "1" ? G : sk ? A : A, /^sk_live_/.test(sk) && env.ENCORE_STRIPE_LIVE === "1" ? "Live." : /^sk_test_/.test(sk) ? "Test mode: no real money moves." : sk ? "Set, but ENCORE_STRIPE_LIVE isn't 1." : "Not set: deposits run in test mode.");
  add("Features", "posthog", "Product analytics (ENCORE_POSTHOG_KEY)", has(env, "ENCORE_POSTHOG_KEY") ? G : A, has(env, "ENCORE_POSTHOG_KEY") ? "Set." : "Not set: you won't see how the cohort uses the app.");
  add("Features", "gifs", "GIFs in chats (GIPHY_API_KEY or TENOR_API_KEY)", has(env, "GIPHY_API_KEY") || has(env, "TENOR_API_KEY") ? G : A, has(env, "GIPHY_API_KEY") || has(env, "TENOR_API_KEY") ? "Set." : "Not set (optional): the GIF button stays hidden.");
  const ig = has(env, "INSTAGRAM_APP_ID") && has(env, "INSTAGRAM_APP_SECRET");
  add("Features", "instagram", "Instagram import (INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET)", ig ? G : A, ig ? "Set." : "Not set (optional): hosts add past events by hand.");
  add("Features", "geo", "Address lookup (ENCORE_GEO_PROVIDER, ENCORE_GEO_KEY)", has(env, "ENCORE_GEO_PROVIDER") || has(env, "ENCORE_GEO_KEY") || has(env, "ENCORE_GEO_URL") ? G : A, has(env, "ENCORE_GEO_PROVIDER") || has(env, "ENCORE_GEO_KEY") || has(env, "ENCORE_GEO_URL") ? "Set." : "Not set (optional): the free public geocoder is used, with a small daily limit.");
  // the cohort can see it's real
  const fake = ["ENCORE_FAKE_EMAIL", "ENCORE_FAKE_SMS", "ENCORE_FAKE_AI", "ENCORE_FAKE_PUSH", "ENCORE_FAKE_OAUTH", "ENCORE_FAKE_GEO", "ENCORE_FAKE_CRM", "ENCORE_FAKE_WEBHOOK"].filter((k) => env[k] === "1");
  add("Server", "no_fakes", "No test switches on", fake.length ? R : G, fake.length ? `Turn off: ${fake.join(", ")}.` : "None on.", true);
  return out;
}

// ---------- the goal ----------
const demoWs = (W) => !W || W.demo || W.sample || isExampleEmail(W.ownerEmail);
const realEvent = (e) => e && !e.sample && !e.example && !e.demo;
/** Hosts onboarded, events created and happened, registrants, brand accounts; since a day (ENCORE_COHORT_START) or all time. */
export function goalCounts(store, { since = "", today = isoDay() } = {}) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(since) ? Date.parse(since + "T00:00:00Z") : 0;
  let hosts = 0, brands = 0, created = 0, happened = 0; const people = new Set();
  for (const id of allWorkspaceIds()) { if (id === DEFAULT_WS) continue; const W = getWorkspace(id); if (demoWs(W)) continue;
    const S = scopeStore(store, id); let evs = []; try { evs = S.list("events").filter((d) => realEvent(d.data)); } catch {}
    const personal = W.plan === "friends" || W.personal === true;
    if ((W.createdAt || 0) >= from) { if (personal) { if (W.host?.handle || evs.length) hosts++; } else if (W.plan !== "self-hosted") brands++; }
    const mine = evs.filter((d) => (+d.data.createdAt || d.updated || 0) >= from || (d.data.date && d.data.date >= since)); created += mine.length;
    const done = new Set(mine.filter((d) => !d.data.cancelled && /^\d{4}-\d{2}-\d{2}$/.test(d.data.date || "") && d.data.date < today && (!since || d.data.date >= since)).map((d) => d.id)); happened += done.size;
    const ids = new Set(mine.map((d) => d.id));
    try { for (const r of S.list("rsvps")) { const x = r.data || {}; if (!ids.has(x.eventId) || /^(no|declined|cancelled)$/i.test(String(x.response || ""))) continue; const k = String(x.email || "").trim().toLowerCase() || String(x.phone || "").replace(/[^\d]/g, ""); if (k && !isExampleEmail(k)) people.add(k); } } catch {}
  }
  return { since: from ? since : "", goal: GOAL, hosts, events: { created, happened }, registrants: people.size, brands };
}

// ---------- invite code batches ----------
function newCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (const x of crypto.randomBytes(8)) s += A[x % A.length]; return s.slice(0, 4) + "-" + s.slice(4, 8); }
export const signupLink = (origin, role, code) => `${origin || ""}/signup?${role === "brand" ? "mode=work&" : "mode=friends&"}code=${encodeURIComponent(code)}`;
/** n single-use codes for one role, tagged with the batch. Returns the batch. */
export function createBatch(store, { role, n, label = "", by = "" }, now = Date.now()) {
  if (!ROLES.includes(role)) return { error: "Pick host, guest or brand." };
  n = Math.round(+n || 0); if (n < 1 || n > 200) return { error: "Make 1 to 200 codes at a time." };
  const id = crypto.randomBytes(5).toString("hex"), codes = [];
  for (let i = 0; i < n; i++) { let c = newCode(); while (store.get("system/code-" + c)) c = newCode();
    store.set("system/code-" + c, { kind: "code", code: c, batch: id, role, ownerWs: null, ownerEmail: "", ownerName: "Pottery Lab", createdAt: now }); codes.push(c); }
  const b = { kind: "codebatch", id, role, label: clean(label, 60) || `${role[0].toUpperCase() + role.slice(1)} codes`, n, codes, by: clean(by, 120), createdAt: now };
  store.set("system/codebatch-" + id, b); return batchView(store, b);
}
function batchView(store, b) { const used = b.codes.map((c) => store.get("system/code-" + c)?.data).filter((c) => c?.usedAt); return { id: b.id, role: b.role, label: b.label, n: b.n, used: used.length, createdAt: b.createdAt, lastUsedAt: Math.max(0, ...used.map((c) => c.usedAt)) || 0 }; }
export const listBatches = (store) => store.listPrefix("system", "codebatch-").map((d) => d.data).filter((b) => b?.kind === "codebatch").sort((a, b) => b.createdAt - a.createdAt).map((b) => batchView(store, b));
const csvCell = (v) => { const s = String(v ?? ""); return /^[=+\-@\t\r]/.test(s) ? "'" + s : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function batchCsv(store, id, origin = "") {
  const b = store.get("system/codebatch-" + String(id).replace(/[^a-f0-9]/g, ""))?.data; if (!b) return null;
  const rows = [["code", "role", "sign-up link", "used", "used by"]];
  for (const c of b.codes) { const d = store.get("system/code-" + c)?.data || {}; rows.push([c, b.role, signupLink(origin, b.role, c), d.usedAt ? isoDay(d.usedAt) : "", d.usedByName || ""]); }
  return { name: `pottery-lab-${b.role}-codes-${b.id}.csv`, text: rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n" };
}

// ---------- the status line ----------
export const getIncident = (store) => { const d = store.get("system/incident")?.data; return d?.on && d.message ? { message: d.message, at: d.at } : null; };
export function setIncident(store, { on, message, by = "" }) {
  const m = clean(message, 200).replace(/\s*[\u2014\u2013]\s*/g, ", ");
  if (on && m.length < 4) return { error: "Write a short line people will see." };
  store.set("system/incident", { kind: "incident", on: !!on, message: on ? m : "", at: Date.now(), by: clean(by, 120) }); return { incident: getIncident(store) };
}

export function mountLaunch(app, { store, express, currentUser, isAdmin, publicOrigin, dataDirOf = () => "" }) {
  const body = express.json({ limit: "8kb" }), me = (req) => { try { return currentUser(req); } catch { return null; } };
  const admin = (req, res) => { const u = me(req); if (u && isAdmin(u.email)) return u; res.status(404); if (/^\/api\//.test(req.path)) res.json({ code: "not_found", message: "Not found." }); else res.type("html").send("<!doctype html><title>Not found</title><p>Page not found.</p>"); return null; };
  const origin = (req) => { try { return publicOrigin(req); } catch { return ""; } };
  const state = () => { const batches = listBatches(store); return { checks: launchChecks(process.env, { dataDir: dataDirOf(), store, batches }), goal: goalCounts(store, { since: String(process.env.ENCORE_COHORT_START || "") }), batches, incident: getIncident(store), errors: errorLog(store).slice(0, 30) }; };
  app.get("/api/status", (req, res) => res.set("Cache-Control", "no-cache").json({ incident: getIncident(store) }));
  app.post("/api/admin/incident", body, (req, res) => { const u = admin(req, res); if (!u) return; const r = setIncident(store, { on: !!req.body?.on, message: req.body?.message, by: u.email }); if (r.error) return res.status(400).json({ code: "invalid", message: r.error }); res.json(r); });
  app.get("/api/admin/launch", (req, res) => { if (!admin(req, res)) return; res.set("Cache-Control", "private, no-store").json(state()); });
  app.get("/api/admin/codes", (req, res) => { if (!admin(req, res)) return; res.set("Cache-Control", "private, no-store").json({ batches: listBatches(store) }); });
  app.post("/api/admin/codes", body, (req, res) => { const u = admin(req, res); if (!u) return; const b = createBatch(store, { role: req.body?.role, n: req.body?.n, label: req.body?.label, by: u.email });
    if (b.error) return res.status(400).json({ code: "invalid", message: b.error }); res.json({ batch: b, csv: `/api/admin/codes/${b.id}.csv` }); });
  app.get("/api/admin/codes/:id.csv", (req, res) => { if (!admin(req, res)) return; const f = batchCsv(store, req.params.id, origin(req)); if (!f) return res.status(404).json({ code: "not_found", message: "No such batch." });
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "private, no-store" }).send(f.text); });
  app.get("/admin/launch", (req, res) => { if (!admin(req, res)) return; res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" }).type("html").send(LAUNCH_PAGE); });
}

// The page. Served only to admins; it reads /api/admin/launch and draws itself.
const LAUNCH_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Launch checklist · Pottery Lab</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--ink:#1B1D1C;--soft:#444845;--line:#CFC8B9;--bg:#EFEBE2;--card:#FAF8F3;--blue:#29489A;--g:#245C33;--gb:#E3F2E6;--a:#6B4E00;--ab:#F7EFCB;--r:#A93A3A;--rb:#F8E1DC}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}h1{font:600 32px/1.15 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 4px}
h2{font:600 18px/1.3 "IBM Plex Sans",system-ui,sans-serif;margin:28px 0 10px}.sub{color:var(--soft);margin:0 0 8px}.k{font:500 13px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--blue);margin:0 0 6px}
.card{background:var(--card);border:1.5px solid var(--ink);border-radius:8px;padding:14px 16px}
.goal{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.goal .card b{display:block;font:600 30px/1.1 "IBM Plex Sans",system-ui}.goal .card span{color:var(--soft);font-size:16px}
.bar{height:8px;border-radius:4px;background:#E6E1D5;margin-top:8px;overflow:hidden}.bar i{display:block;height:100%;background:var(--blue)}
.items{display:grid;gap:8px}.it{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;align-items:start;background:var(--card);border:1.5px solid var(--line);border-radius:8px;padding:10px 14px}
.it .dot{grid-row:span 2;margin-top:3px;font:500 13px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.04em;border-radius:999px;padding:2px 10px;text-transform:uppercase}
.it b{font-weight:600;overflow-wrap:anywhere}.it small{color:var(--soft);font-size:16px;overflow-wrap:anywhere}
.green{background:var(--gb);color:var(--g)}.amber{background:var(--ab);color:var(--a)}.red{background:var(--rb);color:var(--r)}
.sum{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}.sum span{border-radius:999px;padding:4px 12px;font-weight:600}
form{display:flex;gap:8px;flex-wrap:wrap;align-items:end}label{display:grid;gap:4px;font-weight:600}
input,select,textarea{font:inherit;border:1.5px solid var(--ink);border-radius:8px;padding:8px 10px;min-height:44px;background:#fff;color:var(--ink);max-width:100%}
button{font:600 16px "IBM Plex Sans",system-ui;border:0;background:var(--blue);color:#fff;border-radius:999px;padding:10px 18px;min-height:44px;cursor:pointer}button.q{background:#fff;color:var(--ink);border:1.5px solid var(--ink)}
table{width:100%;border-collapse:collapse;font-size:16px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{font:500 13px "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--soft)}
.tw{overflow-x:auto}.err{color:var(--r)}.ok{color:var(--g)}a{color:var(--blue)}code{font:500 14px "IBM Plex Mono",ui-monospace,monospace;overflow-wrap:anywhere}
.e{border-top:1px solid var(--line);padding:8px 0}.e pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.4 ui-monospace,monospace;margin:4px 0 0;color:var(--soft)}
</style></head><body><main>
<p class="k">Admin · Before the cohort</p><h1>Launch checklist</h1>
<p class="sub">What this server has set, read live. Values are never shown. How to set each one is in docs/launch-checklist.md. <a href="/support">Help inbox</a></p>
<div class="sum" id="sum"></div>
<h2>The goal</h2><div class="goal" id="goal"><p class="sub">Loading…</p></div><p class="sub" id="since"></p>
<h2>Settings</h2><div class="items" id="items"></div>
<h2>Invite codes</h2><div class="card"><p class="sub" style="margin-top:0">Each code works once. Send hosts and guests the friends link, brands the work link. Registrants who only reply to events need no code.</p>
<form id="mk"><label>For<select name="role"><option value="host">Hosts</option><option value="brand">Brands (field marketers)</option><option value="guest">Guests who want an account</option></select></label><label>How many<input name="n" type="number" min="1" max="200" value="10" style="width:100px"></label><label>Label<input name="label" maxlength="60" placeholder="December hosts"></label><button>Make codes</button></form><p id="mkNote" class="sub" role="status"></p>
<div class="tw"><table><thead><tr><th>Batch</th><th>For</th><th>Used</th><th>Made</th><th></th></tr></thead><tbody id="batches"></tbody></table></div></div>
<h2>Status line</h2><div class="card"><p class="sub" style="margin-top:0">Something broken for everyone? Say so here. People see it as a quiet line at the top and in the help sheet.</p>
<form id="inc"><label style="flex:1;min-width:220px">Message<input name="message" maxlength="200" placeholder="Texts are slow right now. Email works."></label><button>Show it</button><button type="button" class="q" id="incOff">Clear</button></form><p id="incNote" class="sub" role="status"></p></div>
<h2>Recent errors</h2><p class="sub">From people's browsers and the server, newest first. No names, emails or what anyone typed.</p><div class="card" id="errs"></div>
</main><script>
(function(){ const $=(s)=>document.querySelector(s), el=(t,c,x)=>{ const e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e };
  const day=(t)=>t?new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"}):"";
  const post=async(u,b)=>{ const r=await fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.message||"That didn't work."); return j };
  function draw(S){ const G=S.goal, g=$("#goal"); g.textContent="";
    const tile=(n,of,label)=>{ const c=el("div","card"); c.append(el("b",null,n+" / "+of), el("span",null,label)); const b=el("div","bar"), i=el("i"); i.style.width=Math.min(100,Math.round(n/of*100))+"%"; b.append(i); c.append(b); g.append(c) };
    tile(G.hosts,G.goal.hosts,"hosts onboarded"); tile(G.events.created,G.goal.events,"events created"); tile(G.events.happened,G.goal.events,"events that happened"); tile(G.registrants,G.goal.registrants,"registrants"); tile(G.brands,G.goal.brands,"field marketers (brand accounts)");
    $("#since").textContent=G.since?"Counting from "+G.since+" (ENCORE_COHORT_START).":"Counting all time. Set ENCORE_COHORT_START to count from the cohort's first day.";
    const it=$("#items"); it.textContent=""; let grp=""; const n={green:0,amber:0,red:0};
    for(const c of S.checks){ n[c.status]++; if(c.group!==grp){ grp=c.group; it.append(el("p","k",grp)) } const d=el("div","it"); d.dataset.id=c.id; d.append(el("span","dot "+c.status,c.status==="green"?"Ready":c.status==="amber"?"Check":"Fix"), el("b",null,c.label+(c.required?"":" (optional)")), el("small",null,c.note)); it.append(d) }
    const s=$("#sum"); s.textContent=""; s.append(el("span","red",n.red+" to fix"), el("span","amber",n.amber+" to check"), el("span","green",n.green+" ready"));
    const tb=$("#batches"); tb.textContent=""; if(!S.batches.length){ const r=el("tr"), td=el("td",null,"No batches yet."); td.colSpan=5; r.append(td); tb.append(r) }
    for(const b of S.batches){ const r=el("tr"); r.append(el("td",null,b.label), el("td",null,b.role), el("td",null,b.used+" of "+b.n), el("td",null,day(b.createdAt))); const td=el("td"), a=el("a",null,"Download CSV"); a.href="/api/admin/codes/"+b.id+".csv"; td.append(a); r.append(td); tb.append(r) }
    $("#incNote").textContent=S.incident?"Showing now: "+S.incident.message:"Nothing showing.";
    const E=$("#errs"); E.textContent=""; if(!S.errors.length) E.append(el("p","sub","None yet."));
    for(const e of S.errors){ const d=el("div","e"); d.append(el("b",null,(e.kind==="server"?"Server: ":"")+e.message), el("div","sub",[e.n+"x", e.page, e.device, e.app, "last "+day(e.last), "ids "+(e.ids||[]).join(" ")+(e.serverRef?" "+e.serverRef:"")].filter(Boolean).join(" · "))); if((e.stack||[]).length) d.append(el("pre",null,e.stack.join("\\n"))); E.append(d) } }
  async function load(){ try{ const r=await fetch("/api/admin/launch",{credentials:"same-origin"}); if(!r.ok) throw 0; draw(await r.json()) }catch{ $("#goal").textContent="Couldn't load. Refresh to try again." } }
  $("#mk").onsubmit=async(e)=>{ e.preventDefault(); const f=e.target, N=$("#mkNote"); N.className="sub"; N.textContent="Making…"; try{ const j=await post("/api/admin/codes",{role:f.role.value,n:+f.n.value,label:f.label.value}); N.className="ok"; N.textContent="Made "+j.batch.n+" codes. Download the CSV to send them."; f.label.value=""; load() }catch(x){ N.className="err"; N.textContent=x.message } };
  $("#inc").onsubmit=async(e)=>{ e.preventDefault(); try{ await post("/api/admin/incident",{on:true,message:e.target.message.value}); e.target.message.value=""; load() }catch(x){ $("#incNote").className="err"; $("#incNote").textContent=x.message } };
  $("#incOff").onclick=async()=>{ try{ await post("/api/admin/incident",{on:false}); load() }catch{} };
  load() })();
</script></body></html>`;
