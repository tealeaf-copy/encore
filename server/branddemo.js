// The marketer demo (/teams/demo): anyone can open a brand account without signing up and walk three paths in under
// two minutes each, on the example hosts (server/brandexamples.js), with a small guide card that points at the next
// thing to tap (public/teams-demo.js).
//
//   /teams/demo                 a fresh sandbox, then the welcome card with three paths
//   /teams/demo?path=find       search by goal, city, size and budget -> 3 matches -> open one -> shortlist -> compare
//   /teams/demo?path=book       Quick book a customer dinner -> the brief -> price and money at risk -> a teammate's OK
//                               -> request sent -> what the host sees -> accepted -> guest list -> a past event's report
//   /teams/demo?path=gift       pick recipients -> pick a maker's gift -> a note -> delivery plan and cost -> sent ->
//                               what the recipient sees
//   /teams/demo?reset=1         throw the sandbox away and start a new one (any path can add it)
//
// The sandbox: every visitor gets their own brand workspace, "Fernlight" (a made-up company), owned by an address at
// @demo.encore with two made-up teammates. It is marked demo: true. Requests from it run inside demoCtx
// (server/democtx.js), so nothing it sets off sends an email, a text or a push; its team bookings carry demo: true and
// are invisible to every other workspace, sweep and metric (server/brandbook.js reqs()); deposits use the demo
// provider and nothing is ever charged. Only demo brands can walk a booking with an example host. Sandboxes older
// than a day are deleted the next time anyone opens the demo (and on the daily job), with everything in them.
//
// Gifts in the demo are the smallest version that works end to end: recipients from Fernlight's example accounts,
// gifts from example makers, a note, a delivery plan with the cost, "sent", and the recipient's page. What a real launch
// still needs is listed in docs/marketer-demo.md (payments, addresses and shipping, maker orders, tax).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createWorkspace, updateWorkspace, getWorkspace, putDbUser, getDbUser, allWorkspaceIds, deleteWorkspace, membersOf, scopeStore, DEFAULT_WS } from "./workspaces.js";
import { startSession } from "./auth.js";
import { demoCtx } from "./democtx.js";
import { exampleByHandle, examplesHidden } from "./brandexamples.js";
import { money, statusOf } from "./brandbook.js";

const DAY = 864e5;
const rid = (n = 6) => crypto.randomBytes(n).toString("hex");
const isoDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const day = (n) => isoDay(Date.now() + n * DAY);
const weekdayAfter = (n, ok = [2, 3, 4]) => { for (let i = n; i < n + 14; i++) { const d = day(i); if (ok.includes(new Date(d + "T12:00:00Z").getUTCDay())) return d; } return day(n); };
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const DEMO_TTL = DAY;
export const DEMO_PATHS = ["find", "book", "gift"];
export const DEMO_COMPANY = "Fernlight";

// the people in the demo: you, a finance lead who approves, and an account executive
const TEAM = [{ k: "you", name: "Sam Rivera", roles: ["Field marketing lead"], owner: true }, { k: "priya", name: "Priya Shah", roles: ["Finance lead"] }, { k: "marcus", name: "Marcus Lee", roles: ["Account executive"] }];
// Fernlight's target accounts and the guests from them (all made up)
const ACCOUNTS = ["Larkspur Labs", "Tidepool Analytics", "Quillon", "Brightwell Health", "Juniper Pay", "Orbitly", "Cobalt & Co", "Halden Freight", "Mossgrove Bank", "Kestrel Robotics", "Wren Insurance", "Northpine Data"];
const GUESTS = [["Ana Ortiz", "VP Marketing"], ["Ben Okafor", "Head of Demand Gen"], ["Chloe Park", "CMO"], ["Dev Mehta", "Director of Growth"], ["Ellie Brandt", "VP Customer Success"], ["Felix Grant", "Head of Revenue Ops"], ["Gia Romano", "Marketing Director"],
  ["Hugo Laine", "VP Sales"], ["Iris Chen", "Head of Partnerships"], ["Jonah Weiss", "Director of Product Marketing"], ["Kira Novak", "COO"], ["Liam Doyle", "Head of Brand"], ["Maya Singh", "VP Operations"], ["Noah Ferris", "Director of Field Marketing"],
  ["Olive Tran", "Head of Community"], ["Pablo Ruiz", "VP Engineering"], ["Quinn Avery", "Head of Events"], ["Rosa Lindgren", "Chief of Staff"], ["Sami Haddad", "VP Finance"], ["Tess Moreau", "Head of People"]];
const SAID = ["The bread, the long table and nobody pitched me anything. I'd go again.", "Met two people I'll actually call next week.", "Small enough to have a real conversation. That's rare.", "Shaping my own loaf after a day of screens was the best part.",
  "Warm room, good people, home by ten.", "I learned more about their roadmap here than at any booth."];
// example makers for gifts: the same made-up hosts, with something they make
export const DEMO_GIFTS = [
  { id: "mug", handle: "little-kiln", name: "Hand-thrown mug in your colour", cents: 4800, ships: "Ships anywhere in the US", leadDays: 21, method: "ship", art: "pottery", note: "Thrown and glazed by Noor in San Francisco. Each one is a little different." },
  { id: "bread", handle: "rise-and-crumb", name: "Sourdough and jam box", cents: 4200, ships: "Courier in New York only", leadDays: 3, method: "courier", art: "bake", note: "A loaf baked that morning, a jar of seasonal jam and a card from Hannah." },
  { id: "matcha", handle: "still-water-matcha", name: "Matcha starter kit", cents: 5600, ships: "Ships anywhere in the US", leadDays: 7, method: "ship", art: "tea", note: "A bowl, a bamboo whisk, ceremonial matcha and a two-minute card on how to whisk it." },
  { id: "flowers", handle: "petal-and-stem", name: "Seasonal bud vase bouquet", cents: 6500, ships: "Courier in New York only", leadDays: 5, method: "courier", art: "garden", note: "Three bud vases with the week's best stems from June's studio." },
  { id: "pad", handle: "byte-and-burl", name: "Walnut macro pad", cents: 8900, ships: "Ships anywhere in the US", leadDays: 14, method: "ship", art: "tech", note: "Three keys in a walnut case, built by Iris. A nice thing for a desk." },
];
const SHIP = { ship: { cents: 900, label: "Tracked shipping" }, courier: { cents: 1800, label: "Same-week courier" } };
const RECIPIENTS = GUESTS.slice(0, 10).map(([name, title], i) => ({ id: "r" + i, name, title, company: ACCOUNTS[i % ACCOUNTS.length], city: i % 3 === 2 ? "San Francisco" : "New York" }));

export function mountBrandDemo(app, { store, small, currentUser, C, X = {}, PUBLIC_DIR = "", publicOrigin = () => "" }) {
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const isDemoWs = (ws) => !!ws && ws !== DEFAULT_WS && getWorkspace(ws)?.demo === true;
  X.isDemoWs = isDemoWs;
  const me = (req) => { try { const u = currentUser(req); return u && u.ws && u.ws !== DEFAULT_WS ? u : null; } catch { return null; } };
  const demoMe = (req, res) => { const u = me(req); if (!u || !isDemoWs(u.ws)) { bad(res, "Open the demo first.", 401, "not_demo"); return null; } return u; };
  const BB = () => X.bb;
  const hits = new Map(), limited = (k, n, win = 3600e3) => { const now = Date.now(); let h = hits.get(k); if (!h || now - h.at > win) { h = { n: 0, at: now }; hits.set(k, h); } if (hits.size > 20000) hits.clear(); return ++h.n > n; };

  // ---- the sandbox scope: anything a demo request sets off sends nothing and stays in the demo ----
  app.use((req, res, next) => { const u = me(req); if (!u || !isDemoWs(u.ws)) return next();
    // the guide card on every brand page of the demo
    if (req.method === "GET" && /^\/teams(\/|$)/.test(req.path) && !/^\/teams\/demo\/(host|gifts|gift)\b/.test(req.path)) { const send = res.send.bind(res);
      res.send = (body) => { if (typeof body === "string" && /<\/body>/i.test(body) && /text\/html/.test(String(res.get("Content-Type") || "text/html"))) body = body.replace(/<\/body>(?![\s\S]*<\/body>)/i, '<script src="/teams-demo.js" defer></script></body>'); return send(body); }; }
    demoCtx.run({ ws: u.ws }, next); });

  // ---- making and throwing away a sandbox ----
  const cookieFor = (email, ws) => { const H = []; startSession({ secure: false }, { setHeader: (k, v) => H.push(v), append: (k, v) => H.push(v) }, email, ws); return H[0].split(";")[0]; };
  function sweep(now = Date.now()) { let n = 0; for (const ws of allWorkspaceIds()) { if (ws === DEFAULT_WS) continue; const W = getWorkspace(ws); if (W?.demo === true && now - (W.demoAt || W.createdAt || 0) > DEMO_TTL) { removeDemo(ws); n++; } } return n; }
  function removeDemo(ws) { if (!isDemoWs(ws)) return 0; let n = 0;
    for (const d of store.listPrefix("system", "bbreq-")) { const r = d.data; if (r?.brandWs !== ws) continue; const ev = store.get("system/bpev-" + r.id)?.data;
      for (const t of Object.keys(ev?.survey?.tokens || {})) { store.delete("system/bpsv-" + t); n++; } store.delete("system/bpev-" + r.id); store.delete("system/bbreq-" + r.id); n += 2; }
    for (const m of membersOf(ws)) if (/@demo\.encore$/i.test(m.email || "")) { /* user docs carry ws, deleteWorkspace takes them */ }
    return n + deleteWorkspace(ws); }
  X.demoSweep = sweep;

  async function makeSandbox(req) {
    const id = rid(5), mail = (k) => `${k}-${id}@demo.encore`, now = Date.now();
    const W = createWorkspace({ company: DEMO_COMPANY, ownerEmail: mail("you") }); updateWorkspace(W.id, { demo: true, demoAt: now, plan: "team", city: "New York", trialEndsAt: null });
    for (const t of TEAM) putDbUser({ kind: "user", ws: W.id, name: t.name, email: mail(t.k), roles: t.roles, owner: !!t.owner, signin: "demo", createdAt: now, emailVerified: true, verifiedAt: now, demo: true });
    const ws = W.id, you = mail("you"), priya = mail("priya"), marcus = mail("marcus");
    const ck = { you: cookieFor(you, ws), priya: cookieFor(priya, ws) }, base = `http://127.0.0.1:${req.socket.localPort}`;
    const call = async (who, method, p, body) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", cookie: ck[who] }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {}; };
    // the team's approval rule: over $1,500 needs Priya's OK
    await call("you", "POST", "/api/bb/brand/rules", { approval: "over", overCents: 150000, approvers: [priya] });
    // the campaign in progress: Q1 customer dinners in three cities
    const C = (await call("you", "POST", "/api/campaigns", { title: "Q1 customer dinners: New York, San Francisco, Chicago", goal: "Sit down with 60 people from our target accounts in three cities, and book 15 follow-up meetings before the spring launch.", audience: { tags: ["Marketing leaders", "Revenue leaders"], perPerson: 180 }, cities: ["New York", "San Francisco", "Chicago"], budget: 30000, start: day(-45), end: day(100), kpis: { attendees: 60, meetings: 15, againPct: 85 }, status: "active" })).id;
    await call("you", "POST", `/api/campaigns/${C}/team`, { email: marcus, role: "editor" }).catch(() => {});
    // a past event, done, with its report: a bakery night in New York
    const past = await book({ handle: "rise-and-crumb", pkg: "rcnight", headcount: 16, campaign: C, goal: "customer", brief: { goal: "customer", together: "roundtable", mix: { brand: 16, host: 0 }, plan: "Two tables of eight, one question for each course.", photos: "consent", followup: "consented" } });
    { const r = BB().reqGet(past); r.date = day(-24); r.reviews = { brand: { rating: 5, text: "Our guests still talk about the bread. Hannah made the room feel like a dinner party, not an event.", at: now - 20 * DAY, role: "Field marketing lead" }, host: { rating: 5, text: "A lovely, curious group.", at: now - 20 * DAY } }; BB().reqSet(r); }
    // the upcoming booking: a coffee pop-up at the conference booth in San Francisco
    const next = await book({ handle: "phin-and-night", pkg: "pncart", headcount: 150, date: weekdayAfter(38), campaign: C, goal: "conference", brief: { goal: "conference", together: "introductions", mix: { brand: 150, host: 0 }, plan: "Coffee at booth 214 for three hours on day one.", photos: "consent", followup: "consented" } });
    // the guest lists: who came to the bakery night (with feedback), who's coming to the booth
    const camp = store.get("system/camp-" + C).data, mk = (i, ev, extra = {}) => { const [name, title] = GUESTS[i % GUESTS.length], co = ACCOUNTS[i % ACCOUNTS.length];
      return { id: rid(5), token: rid(12), event: ev, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@guests-${id}.demo.encore`, company: co, title, source: "csv", consent: { share: i % 3 !== 2, at: now - 30 * DAY, via: "csv" }, status: "invited", invitedAt: now - 35 * DAY, repliedAt: 0, checkedIn: false, checkedAt: 0, again: null, said: "", quoteOk: false, followUp: "none", addedAt: now - 36 * DAY, ...extra }; };
    for (let i = 0; i < 20; i++) { const came = i < 16, g = mk(i, past, { status: i < 18 ? "yes" : "no", repliedAt: now - 30 * DAY, checkedIn: came, checkedAt: came ? now - 24 * DAY : 0, again: came ? i % 7 !== 3 : null, said: came && i % 3 === 0 ? SAID[(i / 3) % SAID.length] : "", quoteOk: came && i % 6 === 0, followUp: came && [0, 4, 9].includes(i) ? "meeting" : came && i % 2 ? "sent" : "none" }); camp.guests.push(g); }
    for (let i = 0; i < 12; i++) camp.guests.push(mk(i + 5, next, { status: i < 8 ? "yes" : "invited", repliedAt: i < 8 ? now - 3 * DAY : 0, invitedAt: now - 6 * DAY }));
    camp.costs = [{ id: rid(4), label: "Printed menus and place cards", cents: 18000, paid: true, at: now - 30 * DAY }]; store.set("system/camp-" + C, camp);
    // the survey after the bakery night: 14 of 16 answered
    { const key = "system/bpev-" + past, ev = store.get(key)?.data || { kind: "bpev", reqId: past, brief: null, owner: null, changes: [], confirm: null, hostSeats: [], survey: { tokens: {}, responses: {} }, connections: [], timeline: [] };
      ev.survey = ev.survey || { tokens: {}, responses: {} }; ev.survey.tokens = ev.survey.tokens || {}; ev.survey.responses = ev.survey.responses || {};
      camp.guests.filter((g) => g.event === past && g.checkedIn).forEach((g, i) => { const t = rid(12); ev.survey.tokens[t] = { side: "brand", gid: g.id, cid: C, first: g.name.split(" ")[0], email: g.email }; store.set("system/bpsv-" + t, { kind: "bpsv", reqId: past });
        if (i < 14) ev.survey.responses[t] = { useful: i % 4 !== 3, back: i % 7 !== 3, before: 3, after: 4, said: "", quoteOk: false, matchOk: true, company: g.company, contactOk: i % 3 === 0, followHost: i % 4 === 0, nextOk: i % 3 !== 1, listed: false, contact: "", at: now - 22 * DAY }; });
      ev.confirm = { capacity: 16, hostSeats: 0, note: "", at: now - 30 * DAY }; ev.setupSec = 420; ev.updatedAt = now; store.set(key, ev); }
    // target accounts, meetings and pipeline that came of it
    await call("you", "POST", `/api/campaigns/${C}/targets`, { targets: ACCOUNTS }).catch(() => {});
    for (const [kind, account, amount] of [["meeting", "Larkspur Labs"], ["meeting", "Brightwell Health"], ["meeting", "Orbitly"], ["opportunity", "Larkspur Labs", 48000], ["opportunity", "Orbitly", 36000]]) await call("you", "POST", `/api/campaigns/${C}/outcomes`, { kind, account, ...(amount ? { amount } : {}), event: past }).catch(() => {});
    await call("you", "POST", `/api/campaigns/${C}/tasks`, { title: "Send Larkspur the roadmap notes from the dinner", team: "sales", owner: marcus, due: day(4), event: past }).catch(() => {});
    // a shortlist the team is weighing up for New York, with one option and Priya's vote
    const sl = await call("you", "POST", "/api/bb/shortlists", { title: "New York customer dinner ideas", people: 12, handle: "koji-counter", pkg: "komakase" });
    await call("priya", "POST", `/api/bb/shortlists/${sl.id}/vote`, { handle: "koji-counter", pkg: "komakase", on: true }).catch(() => {});
    updateWorkspace(ws, { demoSeed: { campaign: C, past, next, shortlist: sl.id } });
    return { ws, email: you };
    // book through the real flow: request, Priya approves, the deposit (demo provider) and the host's yes
    async function book({ handle, pkg, headcount, date = weekdayAfter(16), campaign, goal, brief }) {
      const j = await call("you", "POST", "/api/bb/requests", { handle, pkg, headcount, date, company: DEMO_COMPANY, campaign, single: false, goal, brief });
      const r0 = BB().reqGet(j.id); if (r0.status === "approval") await call("priya", "POST", `/api/bb/requests/${j.id}/approve`, {});
      await call("you", "POST", `/api/bb/requests/${j.id}/pay`, {}).catch(() => {});
      hostAccept(BB().reqGet(j.id)); return j.id; }
  }

  /** The host's yes, in the demo only: the example host accepts, and the deposit is marked paid (nothing is charged). */
  function hostAccept(r) { if (!r || !["requested", "countered"].includes(r.status)) return r;
    r.status = "accepted"; r.respondedAt = Date.now(); BB().push(r, "host", "accepted"); try { X.onHostAccept?.(r, { h: BB().profOf(r.hostWs), ws: r.hostWs }); } catch {}
    if (!["held", "charged"].includes(r.deposit?.state)) { r.deposit = { ...r.deposit, state: "held", heldAt: Date.now(), ref: "demo_" + rid(4), provider: "demo" }; BB().push(r, "brand", `deposit of ${money(r.deposit.cents)} held (demo: nothing is charged)`); }
    BB().chargeDeposit(r); BB().reqSet(r); return r; }

  // ---- the way in ----
  const startOf = (p) => { const q = (o) => "?" + new URLSearchParams({ tour: p, ...o });
    return p === "find" ? "/teams/discover" + q({ date: weekdayAfter(30), people: 12, budget: 200, city: "New York", goal: "customer" })
      : p === "book" ? "/teams/home" + q({ date: weekdayAfter(30), people: 12, budget: 200, city: "New York", goal: "customer" })
      : p === "gift" ? "/teams/demo/gifts" + q({}) : "/teams/home?tour=menu"; };
  app.get(["/teams/demo", "/teams/demo/"], async (req, res) => {
    if (examplesHidden()) return res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo · Pottery Lab</title><body style="font-family:system-ui;padding:24px;max-width:560px;margin:auto;background:#f4f0e8;color:#1f1b16"><h1>The demo is off here</h1><p>Example hosts are hidden on this site. <a href="/teams">Back to Pottery Lab for teams</a></p></body>`);
    const p = DEMO_PATHS.includes(req.query.path) ? req.query.path : "", u = me(req), inDemoNow = !!u && isDemoWs(u.ws);
    if (u && !inDemoNow && req.query.switch !== "1") return res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Try the demo · Pottery Lab</title><link rel="stylesheet" href="/system.css"><link rel="stylesheet" href="/brandbook.css"></head><body class="bb"><main class="bb-wrap"><section class="bb-xhead"><p class="bb-kicker">Try the demo</p><h1>You're signed in as ${esc(u.email)}</h1><p class="bb-lede">The demo opens a made-up brand account. Opening it signs you out here; nothing in your account changes. Or open this link in a private window.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="bb-btn primary lg" href="/teams/demo?${esc(new URLSearchParams({ ...(p ? { path: p } : {}), switch: "1" }))}">Open the demo</a><a class="bb-btn lg" href="/teams/home">Stay signed in</a></div></section></main></body></html>`);
    if (limited("demo:" + req.ip, 60) && !(inDemoNow && req.query.reset !== "1")) return res.status(429).type("text").send("That's a lot of demos from here. Try again in an hour.");
    try { sweep(); } catch {}
    let ws = inDemoNow ? u.ws : "", email = inDemoNow ? u.email : "";
    if (inDemoNow && req.query.reset === "1") { removeDemo(u.ws); ws = ""; }
    if (!ws) { try { const S = await makeSandbox(req); ws = S.ws; email = S.email; } catch (e) { console.warn("[demo] couldn't make a sandbox", e.message); return res.status(500).type("text").send("The demo couldn't start. Try again in a minute."); } }
    startSession(req, res, email, ws); res.set("Cache-Control", "no-store").redirect(302, startOf(p)); });
  app.post("/api/teams/demo/reset", small, (req, res) => { const u = demoMe(req, res); if (!u) return; res.json({ url: "/teams/demo?reset=1" + (DEMO_PATHS.includes(req.body?.path) ? "&path=" + req.body.path : "") }); });

  // what the guide needs to point at the right things
  app.get("/api/teams/demo/state", (req, res) => { const u = demoMe(req, res); if (!u) return; const W = getWorkspace(u.ws), S = W.demoSeed || {}, mine = BB().reqs().filter((r) => r.brandWs === u.ws).sort((a, b) => b.createdAt - a.createdAt);
    const newest = mine.find((r) => ![S.past, S.next].includes(r.id)) || null;
    res.set("Cache-Control", "private, no-store").json({ company: W.company, you: { name: u.name, email: u.email }, team: membersOf(u.ws).map((m) => ({ name: m.name, roles: m.roles })), paths: DEMO_PATHS, ...S,
      latest: newest ? { id: newest.id, status: statusOf(newest), handle: newest.handle, pkgName: newest.pkgName, campaign: newest.campaignId || "", host: BB().profOf(newest.hostWs)?.name || "" } : null,
      ttlHours: Math.max(0, Math.round(((W.demoAt || 0) + DEMO_TTL - Date.now()) / 3600e3)) }); });

  // the two steps another person takes in real life, played for the visitor: Priya's OK and the host's yes
  app.post("/api/teams/demo/act", small, (req, res) => { const u = demoMe(req, res); if (!u) return; const b = req.body || {}, r = BB().reqGet(b.id); if (!r || r.brandWs !== u.ws) return bad(res, "Not found.", 404, "not_found");
    if (b.act === "approve") { if (r.status !== "approval") return res.json({ ok: true, status: statusOf(r) }); const priya = membersOf(u.ws).find((m) => /^priya-/.test(m.email));
      r.approval = { ...r.approval, state: "yes", by: priya?.email || "", at: Date.now() }; r.status = "requested"; r.sentAt = Date.now(); BB().push(r, "brand", `approved by ${priya?.name || "the team"}`); BB().reqSet(r); return res.json({ ok: true, status: r.status, url: `/teams/bookings/${r.id}` }); }
    if (b.act === "accept") { if (r.status === "approval") return bad(res, "Your team approves it first.", 409, "conflict"); hostAccept(r);
      // the guest list starts from a few of Fernlight's people, so the invites step has someone on it
      const c = r.campaignId && store.get("system/camp-" + r.campaignId)?.data; if (c && !(c.guests || []).some((g) => g.event === r.id)) { const now = Date.now();
        c.guests = [...(c.guests || []), ...GUESTS.slice(0, 10).map(([name, title], i) => ({ id: rid(5), token: rid(12), event: r.id, name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@guests.demo.encore`, company: ACCOUNTS[i], title, source: "csv", consent: { share: i % 3 !== 2, at: now, via: "csv" }, status: i < 4 ? "yes" : "invited", invitedAt: now, repliedAt: i < 4 ? now : 0, checkedIn: false, checkedAt: 0, again: null, said: "", quoteOk: false, followUp: "none", addedAt: now }))];
        store.set("system/camp-" + c.id, c); }
      return res.json({ ok: true, status: statusOf(r), url: `/teams/bookings/${r.id}`, campaign: r.campaignId ? `/teams/campaigns/${r.campaignId}/invite` : "" }); }
    bad(res, "Approve or accept."); });

  // what the host sees: the same request from the host's side, read only
  const page = (file) => (req, res) => { let html = ""; try { html = fs.readFileSync(path.join(PUBLIC_DIR, file), "utf8"); } catch { return res.status(404).type("text").send("Not found"); } res.set("Cache-Control", "private, no-cache").type("html").send(html); };
  app.get("/teams/demo/host/:id", page("teams-demo-host.html"));
  app.get("/api/teams/demo/host/:id", (req, res) => { const u = demoMe(req, res); if (!u) return; const r = BB().reqGet(req.params.id); if (!r || r.brandWs !== u.ws) return bad(res, "Not found.", 404, "not_found");
    const ev = store.get("system/bpev-" + r.id)?.data || {}, h = BB().profOf(r.hostWs) || {}, E = exampleByHandle(r.handle), F = BB().findPkg(r.handle, r.pkgId), fee = r.price?.feeCents || 0;
    res.set("Cache-Control", "private, no-store").json({ request: BB().view(r, "host"), host: { name: h.name, handle: h.handle, person: E?.person || "", avatarArt: h.theme?.avatarArt || "", accent: h.theme?.accent || "" }, pkg: F ? { name: F.p.name, length: F.p.length, venue: F.p.venue, kind: F.p.kind || "experience" } : null,
      brief: ev.brief || null, payout: { totalCents: r.price?.totalCents || 0, feeCents: fee, hostCents: (r.price?.totalCents || 0) - fee - (r.price?.taxCents || 0), depositCents: r.deposit?.cents || 0 },
      next: r.campaignId ? `/teams/campaigns/${r.campaignId}/invite` : "", hidden: "Fernlight's email and phone stay hidden until the deposit is paid. Messages go through Pottery Lab.", canAccept: ["requested", "countered"].includes(r.status) }); });

  // ---- gifts, the smallest version that works in the demo ----
  app.get(["/teams/demo/gifts", "/teams/demo/gift/:id"], (req, res, next) => (req.params.id ? page("teams-demo-gift.html") : page("teams-demo-gifts.html"))(req, res, next));
  const giftOf = (g) => { const E = exampleByHandle(g.handle); return { ...g, maker: E?.h.name || "", person: E?.person || "", city: E?.s.city || "", price: money(g.cents) }; };
  app.get("/api/teams/demo/gifts", (req, res) => { const u = demoMe(req, res); if (!u) return; const L = scopeStore(store, u.ws).list("demogifts").map((d) => d.data).sort((a, b) => b.at - a.at);
    res.set("Cache-Control", "private, no-store").json({ company: DEMO_COMPANY, from: u.name, gifts: DEMO_GIFTS.map(giftOf), recipients: RECIPIENTS, shipping: SHIP, sent: L.slice(0, 5) }); });
  /** The plan for a send: one row per person with the delivery date, method and cost, and the total. Pure. */
  function planFor(gift, people, today = isoDay()) { const ship = SHIP[gift.method] || SHIP.ship, arrive = isoDay(Date.parse(today + "T12:00:00Z") + (gift.leadDays + (gift.method === "ship" ? 4 : 1)) * DAY);
    const rows = people.map((p) => { const local = gift.method !== "courier" || p.city === "New York"; return { ...p, method: local ? ship.label : "Tracked shipping instead (courier is New York only)", arrive, cents: gift.cents + (local ? ship.cents : SHIP.ship.cents) }; });
    const totalCents = rows.reduce((a, r) => a + r.cents, 0); return { rows, giftCents: gift.cents * rows.length, shipCents: totalCents - gift.cents * rows.length, totalCents, arrive, feeCents: 0 }; }
  app.post("/api/teams/demo/gifts/plan", small, (req, res) => { const u = demoMe(req, res); if (!u) return; const g = DEMO_GIFTS.find((x) => x.id === req.body?.gift), ids = new Set((req.body?.to || []).map(String)), people = RECIPIENTS.filter((r) => ids.has(r.id));
    if (!g) return bad(res, "Pick a gift."); if (!people.length) return bad(res, "Pick at least one person."); res.json({ gift: giftOf(g), plan: planFor(g, people) }); });
  app.post("/api/teams/demo/gifts", small, (req, res) => { const u = demoMe(req, res); if (!u) return; const b = req.body || {}, g = DEMO_GIFTS.find((x) => x.id === b.gift), ids = new Set((b.to || []).map(String)), people = RECIPIENTS.filter((r) => ids.has(r.id)), note = clean(b.note, 300);
    if (!g) return bad(res, "Pick a gift."); if (!people.length) return bad(res, "Pick at least one person."); if (note.length < 3) return bad(res, "Add a short note.");
    const id = rid(6), key = rid(9), P = planFor(g, people), send = { kind: "demogift", id, key, ws: u.ws, at: Date.now(), from: { name: u.name, company: DEMO_COMPANY }, gift: giftOf(g), note, plan: P, demo: true };
    scopeStore(store, u.ws).set("demogifts/" + id, send);
    res.json({ ok: true, id, sent: send, view: `/teams/demo/gift/${id}?k=${key}&to=${people[0].id}`, message: "Sent, in the demo: nothing was ordered, charged or shipped." }); });
  // the recipient's page: anyone with the link (in the demo, the visitor) sees what the person would see
  app.get("/api/teams/demo/gift/:id", (req, res) => { const u = me(req); if (!u || !isDemoWs(u.ws)) return bad(res, "This gift link is from the demo, and it has ended.", 404, "not_found");
    const d = scopeStore(store, u.ws).get("demogifts/" + String(req.params.id).replace(/[^a-f0-9]/g, ""))?.data; if (!d || d.key !== String(req.query.k || "")) return bad(res, "Not found.", 404, "not_found");
    const to = d.plan.rows.find((r) => r.id === req.query.to) || d.plan.rows[0];
    res.set("Cache-Control", "private, no-store").json({ to: { first: to.name.split(" ")[0], company: to.company }, from: d.from, gift: d.gift, note: d.note, arrive: to.arrive, method: to.method, address: "You add your address on this page. Fernlight never sees it." }); });

  return { makeSandbox, removeDemo, sweep, isDemoWs, planFor };
}
