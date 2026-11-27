// The event-page audit: every surface an event shows on, in every state a person can be in, at 390 (iPhone 13) and
// 1280. Each page is checked for the actions that person needs (reply or order, change a reply, the host's page and a
// Follow button, Add to calendar, Share, Save, the group chat, Help, Report) and for what must not be there (a reply
// form on a cancelled or past event, the address before you're in, Follow on your own event), plus: no console
// errors, no failed requests, no sideways scroll, no button text cut off, nothing under the floating help button, no
// layout shift over 0.1. Writes docs/event-audit.md (surface × state × check) and prints the failures.
// Not part of npm test (it needs Chromium). Run: node scripts/event-audit.mjs [--width 390] [--only light] [--shots dir]
// It starts its own server on a scratch data dir and seeds it with test/routes-seed.js seedAudit.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedAudit } from "../test/routes-seed.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WIDTHS = arg("--width", "") ? [+arg("--width")] : [390, 1280], ONLY = arg("--only", ""), SHOTS = arg("--shots", ""), OUT = arg("--out", "docs/event-audit.md");
const CLS_MAX = 0.1;
let pw; try { pw = await import("playwright"); } catch { pw = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); }

Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "audit-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1", ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "500", ENCORE_VERIFY_EMAIL: "0" });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-audit-")), store = openStore(path.join(dir, "audit.db"));
const app = createApp({ store, dataDir: dir }), server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const S = await seedAudit(base);
const HANDLE = S.handle, ST = S.states;

// ---- who is looking ----
const VIEWERS = { out: null, nia: S.nia.cookie, guest: S.guest.cookie, host: S.host.cookie, cohost: S.bo.cookie };
const proofLS = (k) => { const s = ST[k]; return { ["encore-rsvp-" + s.id]: JSON.stringify({ rid: s.rid, code: s.code, response: s.response, name: s.name, at: Date.now() }) }; };

// ---- the checks ----
// need: must be there and visible. not: must not be there. Each name maps to a probe below.
const CHECKS = ["reply", "order", "change", "hostLink", "follow", "calendar", "share", "save", "chat", "help", "report", "addrHidden", "replyForm", "closedNote", "stateLine", "pay", "followBtn", "where", "kudos"];
const U = (o) => ({ need: [], not: [], ...o });
// what a guest who hasn't replied needs on an upcoming event
const OPEN = ["reply", "hostLink", "follow", "share", "save", "help"];
const IN = ["change", "hostLink", "follow", "calendar", "share", "help"];
// the cases: [surface, state, path, viewer, localStorage, expectations]
function cases() {
  const L = [], add = (surface, state, p, viewer, ls, exp) => L.push({ surface, state, path: p, viewer, ls: ls || null, tap: /^plan /.test(surface) ? ".pc-more" : /^chat /.test(surface) ? "[data-det]" : "", ...U(exp) });
  const both = (state, id, viewer, ls, exp) => { add("light /e/", state, `/e/${id}`, viewer, ls, exp); add("full /g", state, `/g#rsvp-${id}`, viewer, ls, exp); };
  // the plain invite: a public place, with a cover
  both("signed out", "auPlace", "out", null, { need: [...OPEN, "where"], not: ["change", "chat"] });
  both("signed in, no reply", "auPlace", "nia", null, { need: [...OPEN, "where"], not: ["change", "chat"] });
  both("going", "auPlace", "out", proofLS("place-going"), { need: [...IN, "where"], not: [] });
  both("maybe", "auPlace", "out", proofLS("place-maybe"), { need: ["change", "hostLink", "follow", "share"], not: [] });
  both("can't go", "auPlace", "out", proofLS("place-no"), { need: ["change", "hostLink", "follow"], not: ["chat"] });
  both("signed in, replied on another device", S.open, "guest", null, { need: [...IN], not: [] });
  // home address: hidden until in
  both("home, not replied", "auHome", "out", null, { need: [...OPEN, "addrHidden"], not: [] });
  both("home, going", "auHome", "out", proofLS("home-going"), { need: [...IN], not: [] });
  // full, waitlist
  both("full, not replied", "auFull", "out", null, { need: ["reply", "hostLink", "follow", "stateLine"], not: [] });
  both("waitlisted", "auFull", "out", proofLS("full-wait"), { need: ["change", "hostLink", "follow", "stateLine"], not: ["chat"] });
  // ask to join
  both("ask, not replied", "auAsk", "out", null, { need: ["reply", "hostLink", "follow", "share"], not: ["change"] });
  both("ask, pending", "auAsk", "out", proofLS("ask-pending"), { need: ["hostLink", "follow", "stateLine"], not: ["chat"] });
  both("ask, approved", "auAsk", "out", proofLS("ask-approved"), { need: [...IN], not: [] });
  both("ask, declined", "auAsk", "out", proofLS("ask-declined"), { need: ["hostLink", "follow", "stateLine"], not: ["chat", "calendar"] });
  // paid
  both("paid, not replied", "auPaid", "out", null, { need: [...OPEN], not: [] });
  both("paid, going, unpaid", "auPaid", "out", proofLS("paid-unpaid"), { need: ["pay", "hostLink", "follow", "change"], not: [] });
  both("paid, going, paid", "auPaid", "out", proofLS("paid-paid"), { need: ["hostLink", "follow", "calendar", "stateLine"], not: ["pay"] });
  // members first
  both("members first, member", "auEarly", "guest", null, { need: ["reply", "hostLink", "follow"], not: [] });
  both("members first, not a member", "auEarly", "nia", null, { need: ["hostLink", "follow", "stateLine"], not: [] });
  // cancelled, moved, past
  both("cancelled, not replied", "auCancel", "out", null, { need: ["closedNote", "hostLink", "follow"], not: ["replyForm", "calendar"] });
  both("cancelled, was going", "auCancel", "out", proofLS("cancel-going"), { need: ["closedNote", "hostLink", "follow"], not: ["replyForm", "calendar"] });
  both("date changed, going", "auMoved", "out", proofLS("moved-going"), { need: [...IN, "stateLine"], not: [] });
  both("past, went", S.past, "guest", null, { need: ["hostLink", "follow", "kudos"], not: ["replyForm"] });
  both("past, signed out", S.past, "out", null, { need: ["hostLink", "follow"], not: ["replyForm"] });
  // the host, a co-host
  both("host's own event", "auPlace", "host", null, { need: ["share"], not: ["followBtn"] });
  both("co-host", "auCohost", "cohost", null, { need: ["hostLink", "share"], not: [] });
  // kinds and shapes
  both("link-only (private)", "auPrivate", "out", null, { need: [...OPEN], not: [] });
  both("long title, long text, no place", "auLong", "out", null, { need: ["reply", "hostLink", "follow"], not: [] });
  both("table booking", "rtTable", "out", null, { need: ["reply", "hostLink", "follow"], not: [] });
  both("trip, going", "rtTrip", "guest", null, { need: ["change", "hostLink", "follow", "calendar"], not: [] });
  both("summit", "rtSummit", "out", null, { need: ["reply", "hostLink", "follow"], not: [] });
  both("today, no cover", S.today, "out", null, { need: [...OPEN], not: [] });
  // a drop: an order page
  if (S.drop) { add("drop /e/", "signed out", `/e/${S.drop}`, "out", null, { need: ["order", "hostLink", "follow", "share"], not: ["reply"] });
    add("drop /e/", "signed in", `/e/${S.drop}`, "nia", null, { need: ["order", "hostLink", "follow", "share"], not: ["reply"] });
    add("drop /e/", "host's own", `/e/${S.drop}`, "host", null, { need: ["share"], not: ["followBtn"] }); }
  // plan pages and the Plans peek
  for (const [state, id, v, exp] of [["going", S.open, "guest", { need: ["hostLink", "follow", "calendar", "chat", "change", "share"] }], ["trip, going", "rtTrip", "guest", { need: ["hostLink", "follow", "calendar", "chat"] }], ["summit, going", "rtSummit", "guest", { need: ["hostLink", "follow", "calendar"] }], ["host's own", S.open, "host", { need: ["calendar", "share"], not: ["followBtn"] }], ["home, not replied", "auHome", "nia", { need: ["hostLink", "follow"] }]])
    add("plan /plans/", state, `/plans/${id}`, v, null, exp);
  add("Plans peek", "going", `/plans#peek=${S.open}`, "guest", null, { need: ["hostLink", "follow", "change", "calendar", "chat", "share"] });
  add("Plans peek", "trip, going", `/plans#peek=rtTrip`, "guest", null, { need: ["hostLink", "follow", "change", "calendar", "chat"] });
  // the event in chats
  add("chat header", "guest", `/chats/${S.open}`, "guest", null, { need: ["hostLink", "follow"], not: [] });
  add("chat header", "host", `/chats/${S.open}`, "host", null, { need: [], not: ["followBtn"] });
  // the feed's event card
  add("feed card", "signed out", `/feed`, "out", null, { need: ["hostLink", "follow"], not: [] });
  add("feed card", "signed in", `/feed`, "nia", null, { need: ["hostLink", "follow"], not: [] });
  // experiences (a team booking) and the brand-booked package page
  add("experience /x/", "signed out", `/x/${HANDLE}/${S.exp}`, "out", null, { need: ["hostLink", "follow", "share"], not: [] });
  if (S.pkg) add("brand experience /teams/x/", "signed out", `/teams/x/${HANDLE}/${S.pkg}`, "out", null, { need: ["hostLink", "follow", "report"], not: [] });
  // the host's own event page in the app
  add("host view (app)", "host", `/?open=auPlace`, "host", null, { need: ["share"], not: ["followBtn"] });
  return L.filter((c) => !ONLY || c.surface.includes(ONLY) || c.state.includes(ONLY));
}

// ---- in the page ----
const WATCH = () => { const W = (window.__audit = { cls: 0 }); try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) W.cls += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch {} };
// what is on the page, as booleans, plus layout problems
const PROBE = ({ handle, secret }) => {
  const vis = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); if (s.visibility === "hidden" || s.opacity === "0") return false; return !el.closest("[hidden],[aria-hidden=true],template,dialog:not([open])") || el.closest("dialog[open]"); };
  const ctl = [...document.querySelectorAll("button,a,label,[role=button],[role=radio],summary")].filter(vis);
  const txt = (el) => (el.innerText || el.getAttribute("aria-label") || el.value || "").replace(/\s+/g, " ").trim();
  const has = (re) => ctl.some((el) => re.test(txt(el)));
  const body = document.body.innerText.replace(/\s+/g, " ");
  const q = (sel) => [...document.querySelectorAll(sel)].some(vis);
  const replyRe = /^(I'm in|I’m in|Count me in|Ask to join|Request to join|Request a spot|Join (the )?waitlist|Send my reply|Ask to join →|Going|Yes, I'm in)\b/i;
  const r = {
    reply: q('input[name="r"]') && [...document.querySelectorAll('input[name="r"]')].some((i) => vis(i.closest("label") || i)) || has(replyRe),
    order: has(/^(Order|Place (my )?order|Pre-?order|Send my order|Order now|Add to order)\b/i) || q("[data-order],#orderBtn"),
    change: has(/\b(Change( my)?( reply| answer| it)?|Edit (my )?reply|Not going anymore|Leave (the )?waitlist|Can't make it|Plans changed|Cancel (my )?(request|order))\b/i) || q("[data-chg],[data-pk-reply],.pk-seg"),
    hostLink: [...document.querySelectorAll(`a[href^="/@${handle}"],a[href^="/@bo-audit"],a[href*="/@"]`)].some(vis),
    follow: q("[data-pl-follow],[data-fb-follow],[data-fv-follow]") || has(/^(Follow|Following)\b/),
    calendar: q("[data-addcal]") || has(/Add to (my )?calendar/i),
    share: has(/^(Share|Copy (the )?(link|invite)|More ways|Invite (a )?friends?|Send (it )?to a friend|Share (the )?invite)\b/i) || q('[aria-label^="Share" i],[aria-label^="Copy" i],[data-share],[data-lz="share"]'),
    save: q("[data-pl-savelist],[data-pls-kind]") || has(/^Save\b/),
    chat: q('a[href^="/chats/"]') || has(/(group chat|Open (the )?chat|Chat with)/i),
    help: q(".eh-btn,[data-help-open]") || has(/^(Help|Need a hand\??|Get help)$/i),
    report: [...document.querySelectorAll("button,a,[role=menuitem]")].some((el) => /^Report\b/i.test((el.textContent || el.getAttribute("aria-label") || "").trim())) || !!document.querySelector("[data-report],[data-fb-report],[data-report-target]"),
    addrHidden: !body.includes(secret) && /(address when you're in|exact (spot|address)|address (goes|comes) to guests|after you're in|once you're in)/i.test(body),
    addrLeak: body.includes(secret),
    replyForm: q('input[name="r"]') || has(/^(I'm in|Count me in|Ask to join|Send my reply|Join (the )?waitlist)$/i),
    closedNote: /cancell?ed/i.test(body),
    stateLine: /(waitlist|asked|request|lets? you in|not this time|full|members|paid|new date|example|sample|moved|changed|couldn't fit)/i.test(body),
    pay: has(/^(Pay \$|Pay with|Venmo|PayPal|Cash App|I paid)/i),
    followBtn: q("[data-pl-follow],[data-fb-follow],[data-fv-follow]") || has(/^(Follow)\b/),
    where: /(Sunset Park Library|Bed-Stuy|Brooklyn)/.test(body),
    kudos: /(kudos|photos|recap|how was it|thank|was there|you were there)/i.test(body),
    junk: (body.match(/\b(undefined|null|NaN|\[object Object\])\b/g) || []).slice(0, 3),
  };
  // layout: sideways scroll, clipped button text, things under the floating help button
  const de = document.documentElement; r.overflow = de.scrollWidth - innerWidth > 1 ? [...document.querySelectorAll("body *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width && b.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 2).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")) : [];
  r.clipped = ctl.filter((el) => (el.tagName === "BUTTON" || el.classList.contains("btn")) && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "visible" && el.clientWidth > 0).slice(0, 3).map((el) => txt(el).slice(0, 30));
  const hb = [...document.querySelectorAll(".eh-btn")].find(vis), under = [];
  if (hb) { const h = hb.getBoundingClientRect(); for (const el of ctl) { if (el === hb || hb.contains(el) || el.contains(hb) || getComputedStyle(el).position === "fixed") continue; const b = el.getBoundingClientRect(); const ox = Math.min(b.right, h.right) - Math.max(b.left, h.left), oy = Math.min(b.bottom, h.bottom) - Math.max(b.top, h.top); if (ox > 8 && oy > 8) under.push(txt(el).slice(0, 30) || el.tagName); } }
  r.underHelp = under.slice(0, 2); r.cls = window.__audit?.cls || 0;
  return r;
};

// ---- run ----
const browser = await pw.chromium.launch();
// build the big app page once before the clock starts (the first /g after a start can take a while on a busy machine)
await fetch(base + "/g").then((r) => r.text()).catch(() => {}); await fetch(base + "/e/" + S.open).then((r) => r.text()).catch(() => {});
{ const w = await browser.newPage(); await w.goto(base + "/g#rsvp-" + S.open, { waitUntil: "load", timeout: 90000 }).catch(() => {}); await w.waitForTimeout(3000); await w.close(); } // and its split scripts, once
const ALL = cases(), ORDER = new Map(ALL.map((c, i) => [c, i]));
const rows = [], JOBS = WIDTHS.flatMap((W) => ALL.map((c) => ({ W, c }))), POOL = +arg("--pool", "4");
await Promise.all(Array.from({ length: POOL }, async () => { for (let job; (job = JOBS.shift()); ) await one(job.W, job.c); }));
async function one(W, c) {
  {
    const ctx = await browser.newContext({ ...pw.devices["iPhone 13"], ...(W > 500 ? { isMobile: false, hasTouch: false, deviceScaleFactor: 1 } : {}), viewport: { width: W, height: W > 500 ? 900 : 844 }, serviceWorkers: "block" });
    const ck = VIEWERS[c.viewer]; if (ck) { const [k, ...v] = ck.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }]); }
    if (c.ls) await ctx.addInitScript((ls) => { try { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); } catch {} }, c.ls);
    await ctx.addInitScript(WATCH); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
    const page = await ctx.newPage(), errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message || e).split("\n")[0].slice(0, 140)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 140)); });
    page.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(base) && !/net::ERR_ABORTED/.test(r.failure()?.errorText || "")) errs.push(`request failed: ${u.slice(base.length, base.length + 90)}`); });
    // (an app tool call that needs the internet answers 502 here, so /api/mcp/call is left out)
    page.on("response", (r) => { const u = r.url(); if (u.startsWith(base) && r.status() >= 400 && !/\/api\/track|\/api\/me\/rsvp\/|\/api\/mcp\/call/.test(u)) errs.push(`${r.status()} ${r.request().method()} ${u.slice(base.length, base.length + 90)}`); });
    let cls0 = null;
    try {
      const peek = /#peek=(.+)$/.exec(c.path);
      await page.goto(base + c.path.replace(/#peek=.+$/, ""), { waitUntil: "load", timeout: 45000 }); await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700);
      // a busy machine can take seconds to draw the invite: wait for the page's main parts (they are what the checks read)
      await page.waitForFunction(() => document.querySelector("#view-guest .invite .in h3, #m h1, main h1, .pc-title, .ch-who, .fb-ev, h1"), null, { timeout: 15000 }).catch(() => {});
      if (c.need.includes("follow")) await page.waitForFunction(() => document.querySelector("[data-pl-follow],[data-fb-follow],[data-fv-follow]"), null, { timeout: 8000 }).catch(() => {});
      cls0 = await page.evaluate(() => window.__audit?.cls || 0).catch(() => 0); // layout shift before anything the audit opens (a sheet sliding in is not a shift)
      if (peek) { await page.evaluate((id) => window.PLPeek?.open(id), peek[1]); await page.waitForTimeout(1200); }
      if (c.tap) { await page.locator(c.tap).filter({ visible: true }).first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); } // the chat's details sheet, a plan's More menu
      if (c.surface === "feed card") await page.evaluate(() => { const card = document.querySelector(".fb-ev,.fv-card"); card?.scrollIntoView(); }).catch(() => {});
      const P = await page.evaluate(PROBE, { handle: HANDLE, secret: S.secret }); if (cls0 != null) P.cls = cls0;
      const res = {};
      for (const k of c.need) res[k] = P[k] ? "ok" : "MISSING";
      for (const k of c.not) res[k] = P[k] ? "SHOWN" : "ok";
      res.addrLeak = P.addrLeak && !/going|approved|host|co-host|trip/.test(c.state) ? "LEAK" : "ok";
      res.errors = errs.length ? errs.slice(0, 3).join("; ") : "ok";
      res.layout = [P.overflow.length && `sideways ${P.overflow.join(",")}`, P.clipped.length && `clipped: ${P.clipped.join(", ")}`, P.underHelp.length && `under help: ${P.underHelp.join(", ")}`, P.cls > CLS_MAX && `CLS ${P.cls.toFixed(2)}`, P.junk.length && `text: ${P.junk.join(",")}`].filter(Boolean).join("; ") || "ok";
      rows.push({ W, i: ORDER.get(c), ...c, res });
      if (SHOTS && W === 390) await page.screenshot({ path: path.join(SHOTS, `${c.surface}-${c.state}`.replace(/[^a-z0-9]+/gi, "_") + ".png"), fullPage: true }).catch(() => {});
    } catch (e) { rows.push({ W, i: ORDER.get(c), ...c, res: { load: "FAILED " + e.message.split("\n")[0].slice(0, 100) } }); }
    await ctx.close();
  }
}
rows.sort((a, b) => a.W - b.W || a.i - b.i);
await browser.close(); server.closeAllConnections?.(); server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true });

// ---- the report ----
const bad = (v) => v !== "ok";
const SEV = { reply: "high", order: "high", change: "high", closedNote: "high", replyForm: "high", addrLeak: "high", addrHidden: "high", hostLink: "high", follow: "high", followBtn: "medium", load: "high", errors: "medium", pay: "high", stateLine: "medium", calendar: "medium", chat: "medium", share: "medium", save: "low", help: "low", report: "low", where: "medium", kudos: "low", layout: "low" };
const fails = rows.flatMap((r) => Object.entries(r.res).filter(([, v]) => bad(v)).map(([k, v]) => ({ W: r.W, surface: r.surface, state: r.state, viewer: r.viewer, path: r.path, check: k, v, sev: SEV[k] || "low" })));
// what other agents own while they work (the audit still reports it, with the owner)
const OWNER = { pay: "payments", calendar: "calendar", order: "drops", kudos: "feed kudos/comments" };
for (const f of fails) f.owner = OWNER[f.check] || (f.surface.startsWith("drop") && f.check === "share" ? "drops" : "");
const count = (s) => fails.filter((f) => f.sev === s).length;
const md = [`# Event page audit`, ``, `Made by \`node scripts/event-audit.mjs\` (${WIDTHS.join(" and ")}px). One row per surface and state; each check is ok, or what went wrong.`,
  `Each row lists the checks that apply to that state: a plain name must be there and work, "no ..." must not be there (a reply form on a cancelled event, the address before you are in, Follow on your own event); errors and layout apply everywhere. Open items name the agent that owns them while they work. High: ${count("high")} · medium: ${count("medium")} · low: ${count("low")}.`, ``];
for (const W of WIDTHS) {
  md.push(`## ${W}px`, ``, `| Surface | State | Viewer | Checks |`, `|---|---|---|---|`);
  for (const r of rows.filter((x) => x.W === W)) md.push(`| ${r.surface} | ${r.state} | ${r.viewer} | ${Object.entries(r.res).map(([k, v]) => { const n = (r.not.includes(k) || k === "addrLeak" ? "no " : "") + ({ addrLeak: "address leak", replyForm: "reply form", followBtn: "Follow button", hostLink: "host link", addrHidden: "address hidden", closedNote: "cancelled note", stateLine: "state line" }[k] || k); return bad(v) ? `**${n}: ${String(v).replace(/\|/g, "/")}**` : n; }).join(" · ")} |`);
  md.push("");
}
md.push(`## Open items`, ``, ...(fails.length ? fails.map((f) => `- [${f.sev}] ${f.W}px ${f.surface} · ${f.state} (${f.viewer}, \`${f.path}\`): ${f.check} ${f.v}${f.owner ? ` (owner: ${f.owner})` : ""}`) : ["None."]), "");
fs.writeFileSync(OUT, md.join("\n"));
for (const f of fails) console.log(`[${f.sev}] ${f.W} ${f.surface} | ${f.state} | ${f.check}: ${f.v}${f.owner ? ` (owner: ${f.owner})` : ""}`);
console.log(`${fails.length} problem${fails.length === 1 ? "" : "s"} (high ${count("high")}, medium ${count("medium")}, low ${count("low")}) across ${rows.length} page loads`);
process.exit(fails.length ? 1 : 0);
