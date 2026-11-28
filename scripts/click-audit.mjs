// Click everything: loads each key page as each kind of person (signed out, a new guest, guests who said yes, maybe and
// waitlist, a casual host with a fan club, a drop seller, a brand team, a summit host, a trip host, the admin) on a phone
// (390x844, touch) and a desktop (1280), lists every visible interactive element (links, buttons, [role=button],
// summary, tabs, inputs, anything with a pointer cursor) and activates each one on a fresh load of the page. After each
// tap it records what a person would hit: a script or console error, an unhandled rejection, a same-origin request
// that failed, a tap that lands on a 404 or a blank page, a sheet that won't close (Esc, its close button, the
// backdrop, Back), focus left behind on the page under a sheet, a layout shift over 0.1, sideways scroll, a control
// covered by a sticky bar or the dock, a tap target under 44px on a phone, a button that does nothing, a loader still
// up after 8 seconds, clipped text and the same control drawn twice. Then the key journeys, end to end, with assertions
// (double taps included). Not part of npm test (it needs Chromium), like scripts/crawl-pages.mjs.
//
//   node scripts/click-audit.mjs [--width 390|1280|both] [--only /teams] [--role host] [--journeys-only] [--no-journeys]
//                                [--workers 6] [--max 60] [--json out.json] [--shots dir] [--verbose] [--pages-only] [--shifts]
//
// --pages-only skips the taps (page checks and journeys only); --shifts prints each page's layout shift while loading.
// It starts its own server on a scratch data dir and seeds it with seedClickAudit() from test/routes-seed.js. One line per
// issue, then a count; exits 1 when there are any.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const WIDTHS = (arg("--width", "both") === "both" ? [390, 1280] : [+arg("--width")]), ONLY = arg("--only", ""), ROLE = arg("--role", ""), WORKERS = +arg("--workers", 6), MAX = +arg("--max", 60);
const JOURNEYS = !has("--no-journeys"), CLICKS = !has("--journeys-only"), VERBOSE = has("--verbose"), JSON_OUT = arg("--json", ""), SHOTS = arg("--shots", "");
const CLS_MAX = 0.1, LOADER_MS = 8000, TAP_MIN = 44;

Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "audit-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1",
  ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "5000", ENCORE_VERIFY_EMAIL: "0", ENCORE_TRUST_PROXY: "1", ENCORE_RSVP_PER_HOUR: "5000", ENCORE_RSVP_IP_PER_HOUR: "5000", ENCORE_EMAIL_PER_HOUR: "5000",
  ENCORE_POTTO_PER_HOUR: "5000", ENCORE_HELP_PER_HOUR: "5000", ENCORE_HELP_PER_HOUR_IP: "5000", ENCORE_NOTE_PER_HOUR: "5000", ENCORE_NOTE_IP_PER_HOUR: "5000", ENCORE_FEED_PER_IP_HOUR: "50000", ENCORE_REACTS_PER_IP: "5000" });
const { openStore } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { seedClickAudit } = await import("../test/routes-seed.js");
let pw; try { pw = await import("playwright"); } catch { pw = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-audit-")), store = openStore(path.join(dir, "audit.db"));
const app = createApp({ store, dataDir: dir }), server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const t0 = Date.now();
const S = await seedClickAudit(base, store);
const B = S.brand, LT = B.hosts.find((h) => h.handle === "long-table");
const cookies = { out: null, newguest: S.newGuest.cookie, guest: S.guest.cookie, maybe: S.maybe.cookie, wait: S.wait.cookie, host: S.host.cookie, seller: S.seller.cookie, brand: B.owner.c, bhost: LT.c, summit: S.summitHost.cookie, trip: S.tripHost.cookie, admin: S.admin.cookie };
if (VERBOSE) console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const browser = await pw.chromium.launch();
const issues = []; const seen = new Set();
const issue = (o) => { const k = [o.width, o.role, o.page, o.element, o.issue].join("|"); if (seen.has(k)) return; seen.add(k); issues.push(o); if (VERBOSE) console.log(fmt(o)); };
const fmt = (o) => `${String(o.width).padEnd(4)} ${o.role.padEnd(8)} ${o.page}  [${o.element}]  ${o.issue}  (${o.sev})`;

// ---- what to visit ----
const C1 = B.campaigns.C1, pkg = LT.pkgId;
const sheetOpeners = {
  potto: async (p) => { await p.waitForFunction(() => window.PLPotto, null, { timeout: 8000 }); await p.evaluate(() => window.PLPotto.open()); },
  plus: async (p) => { await p.locator('[aria-label="Create"]').filter({ visible: true }).first().click(); },
  share: (fmtName) => async (p) => { await p.waitForFunction(() => window.ShareKit, null, { timeout: 8000 }).catch(async () => { await p.addScriptTag({ url: "/sharekit.js" }); await p.waitForFunction(() => window.ShareKit, null, { timeout: 8000 }); });
    await p.evaluate((f) => window.ShareKit.open({ eventId: "rtOpen", start: f }), fmtName); },
  photo: async (p) => { await p.addScriptTag({ url: "/photosheet.js" }).catch(() => {}); await p.waitForFunction(() => window.PhotoSheet, null, { timeout: 8000 }); await p.evaluate(() => { window.PhotoSheet.open({ for: "cover", eventId: "rtOpen", onChange: () => {} }); }); },
  savelist: async (p) => { await p.locator("[data-pl-savelist]").filter({ visible: true }).first().click(); },
  peek: async (p) => { await p.locator(".pk-row, [data-peek], .plans-row, a[href^='/plans/']").filter({ visible: true }).first().click(); },
};
const PAGES = [
  ["/", ["out", "guest", "host"]], ["/feed", ["out", "newguest", "guest", "host"]], ["/discover", ["out", "guest"]], ["/map", ["out", "guest"]],
  ["/plans", ["guest", "maybe", "wait", "host", "seller"]], ["/library", ["guest", "host"]], ["/inbox", ["guest", "host"]], ["/people", ["guest"]], ["/contacts", ["host"]],
  ["/chats", ["guest", "host"]], [`/chats/${S.open}`, ["guest"]], ["/settings", ["out", "guest", "host"]], ["/me", ["guest", "host"]], ["/about", ["out"]], ["/start", ["out", "host"]], ["/path", ["host"]], ["/circles", ["host"]],
  [`/@${S.handle}`, ["out", "guest"]], [`/e/${S.open}`, ["out", "guest", "maybe", "host"]], [`/e/${S.small}`, ["wait"]], [`/e/${S.drop}`, ["out", "guest"]], [`/g#rsvp-${S.open}`, ["guest"]], [`/g#rsvp-${S.small}`, ["wait"]],
  [`/plans/${S.open}`, ["host"]], ["/plans/rtTable", ["host"]], [`/plans/${S.summit}`, ["summit"]], [`/plans/${S.trip}`, ["trip"]], [`/plans/${S.drop}`, ["seller"]],
  ["/?app=1&new=1#studio", ["host"]], ["/?app=1&new=1&kind=event#studio", ["host"]], // the chooser, then the canvas itself (kind chips, add-ons, New section, quick actions, the dock)
  ["/inbox", ["host"], { name: "Ask Potto sheet", setup: "potto" }], ["/feed", ["host"], { name: "+ composer", setup: "plus" }],
  [`/e/${S.open}`, ["host"], { name: "share sheet: link", setup: "share:link" }], [`/e/${S.open}`, ["host"], { name: "share sheet: flyer", setup: "share:flyer" }], [`/e/${S.open}`, ["host"], { name: "share sheet: qr", setup: "share:qr" }],
  ["/feed", ["host"], { name: "photo sheet", setup: "photo" }], [`/e/${S.open}`, ["guest"], { name: "save-to-list sheet", setup: "savelist" }], ["/plans", ["guest"], { name: "Plans peek", setup: "peek" }],
  ["/login", ["out"]], ["/signup", ["out"]], ["/leaderboard", ["out", "guest"]], [`/post/e/${S.open}`, ["out", "guest"]], // main's one-field sign-in; a feed card's comments open its post page
  [`/plans/${S.vegas}`, ["trip"]], [`/e/${S.vegas}`, ["out", "guest"]], ["/proposals", ["bhost"]], ["/ideas", ["out", "guest"]], // a group trip's feeler (server/trips.js), brand proposals, Ideas
  ["/teams/market", ["brand"]], ["/host/insights", ["host"]], ["/admin/paid-insights", ["admin"]], // Paid Insights on the trends engine (server/paidinsights.js)
  ["/teams/home", ["brand"]], ["/teams/discover", ["brand"]], [`/teams/x/long-table/${pkg}`, ["brand"]], [`/teams/book/long-table/${pkg}`, ["brand"]], ["/teams/campaigns", ["brand"]],
  ...["plan", "source", "book", "invite", "run", "measure"].map((t) => [`/teams/campaigns/${C1}/${t}`, ["brand"]]), [`/teams/campaigns/${C1}/report`, ["brand"]],
  ["/teams/insights", ["brand"]], ["/teams/formats", ["brand"]], ["/teams/company", ["brand"]], ["/teams/hosts", ["brand"]], ["/teams/bookings", ["brand"]], ["/host/teams", ["bhost"]],
  ["/admin/hosts", ["admin"]], ["/admin/brand-metrics", ["admin"]], ["/admin/founding-hosts", ["admin"]], ["/admin/experiments", ["admin"]], ["/admin/interest", ["admin"]], ["/moderation", ["admin"]],
].map(([p, roles, o = {}]) => ({ path: p, roles, name: o.name || p, setup: o.setup || "" }));

// ---- in the page ----
const WATCH = () => { const W = (window.__audit = { shifts: [], rejections: [], mut: 0, req: 0 });
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.hadRecentInput) return; if ((e.sources || []).length && e.sources.every((s) => s.node && s.node.nodeType === 1 && s.node.checkVisibility && !s.node.checkVisibility({ checkVisibilityCSS: true }))) return; /* hidden on purpose while the page settles */ /* a shift under a full-screen cover (a chooser, a sheet over the whole page) is one nobody sees */ let n = document.elementFromPoint(innerWidth / 2, innerHeight / 2), covered = false; while (n && n !== document.body && n !== document.documentElement) { const cs = getComputedStyle(n), r = n.getBoundingClientRect(); if (cs.position === "fixed" && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) { covered = !(e.sources || []).some((s) => s.node && n.contains(s.node)); break; } n = n.parentElement; } if (!covered) W.shifts.push([performance.now(), e.value, (e.sources || []).slice(0, 3).map((s) => { const n = s.node; return n && n.nodeType === 1 ? n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (typeof n.className === "string" && n.className ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + `(y ${Math.round(s.previousRect.y)} to ${Math.round(s.currentRect.y)})` : "?"; }).join(" ")]); })).observe({ type: "layout-shift", buffered: true }); } catch {}
  addEventListener("unhandledrejection", (e) => W.rejections.push(String(e.reason?.message || e.reason).slice(0, 160)));
  const go = () => new MutationObserver((l) => { for (const m of l) { if (m.type === "attributes" && /^data-audit/.test(m.attributeName || "")) continue; W.mut++; } }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  if (document.documentElement) go(); else addEventListener("DOMContentLoaded", go);
  try { const of = window.fetch; window.fetch = function () { W.req++; return of.apply(this, arguments); }; const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function () { W.req++; return oo.apply(this, arguments); }; } catch {}
  try { const ow = window.open; window.open = function () { W.opened = (W.opened || 0) + 1; return ow.apply(this, arguments); }; } catch {}
  try { if (navigator.share) navigator.share = async () => { W.shared = (W.shared || 0) + 1; }; else navigator.share = async () => { W.shared = (W.shared || 0) + 1; }; navigator.canShare = () => true; } catch {}
  try { const cw = navigator.clipboard?.writeText?.bind(navigator.clipboard); if (navigator.clipboard) navigator.clipboard.writeText = async (t) => { W.copied = (W.copied || 0) + 1; try { await cw?.(t); } catch {} }; } catch {}
  try { const ex = document.execCommand.bind(document); document.execCommand = (c, ...a) => { if (c === "copy") W.copied = (W.copied || 0) + 1; return ex(c, ...a); }; } catch {}
  try { HTMLCanvasElement.prototype.__tb = HTMLCanvasElement.prototype.toBlob; } catch {}
};
// the overlays (sheets, dialogs, drawers) on screen now
const OVERLAYS = `(() => [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open],[class*="sheet"],[class*="modal"],[class*="drawer"],[class*="Sheet"]')].filter((d) => { if (d.closest('[data-audit-ignore]')) return false; const r = d.getBoundingClientRect(), cs = getComputedStyle(d); if (r.height < 60 || r.width < 120 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; let n = d, fixed = false; while (n && n !== document.body) { const p = getComputedStyle(n).position; if (p === 'fixed') { fixed = true; break; } n = n.parentElement; } return fixed || d.matches('dialog[open]'); }).filter((d, i, A) => !A.some((o) => o !== d && o.contains(d))))()`;
// every visible control, with a key that finds it again on a fresh load
// With want ([sig, nth]) it marks that one (data-audit-t) instead, counting the same way, and says if it found it.
const ENUM = ([scopeSel, want]) => {
  const scope = scopeSel ? (() => { const L = window.__overlays?.() || []; return L[L.length - 1] || document.body; })() : document.body;
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) return false; if (el.closest("[hidden],[aria-hidden=true],[inert]")) return false; return el.checkVisibility ? el.checkVisibility({ contentVisibilityAuto: true }) : true; };
  const label = (el) => (el.getAttribute("aria-label") || (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" ? (el.labels?.[0]?.innerText || el.placeholder || el.name || el.type) : "") || el.innerText || el.title || el.getAttribute("alt") || el.value || el.querySelector("img[alt]")?.alt || el.querySelector("svg title")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const Q = 'a[href],button,[role=button],summary,input:not([type=hidden]),select,textarea,[role=tab],[role=switch],[role=menuitem],[role=checkbox],[role=radio],[role=option],[onclick],[data-act],[data-action],[data-go],[data-open],[data-href],[data-pl-savelist],[tabindex="0"]';
  const set = new Set([...scope.querySelectorAll(Q)]);
  // anything else with a pointer cursor whose parent doesn't have one (delegated click handlers)
  for (const el of scope.querySelectorAll("div,span,li,article,section,img,svg,label,p,h1,h2,h3,h4,figure")) { if (set.has(el) || el.closest(Q)) continue; const cs = getComputedStyle(el); if (cs.cursor !== "pointer") continue; if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue; if (el.tagName === "LABEL" && el.control) continue; set.add(el); }
  const out = [], counts = {}, shape = {};
  for (const el of set) { if (!vis(el) && !(el.tagName === "INPUT" && /radio|checkbox/.test(el.type) && el.labels?.[0] && vis(el.labels[0]))) continue;
    if (el.closest("[data-audit-skip]")) continue; if (/^(group|region|list|dialog|alertdialog|tabpanel|img|log|status|main|article|feed)$/.test(el.getAttribute("role") || "") || (el.tabIndex === 0 && /^(SECTION|ARTICLE|MAIN|UL|OL|DIV)$/.test(el.tagName) && !el.getAttribute("role") && !el.onclick && getComputedStyle(el).cursor !== "pointer")) continue; // scroll boxes and landmarks you can focus, not controls
    const tag = el.tagName.toLowerCase(), lab = label(el), href = el.getAttribute("href") || "", type = el.type || "";
    const sig = [tag, el.getAttribute("role") || "", type, lab, href].join("|"); counts[sig] = (counts[sig] || 0); const nth = counts[sig]++;
    if (want) { if (sig === want[0] && nth === want[1]) { document.querySelectorAll("[data-audit-t]").forEach((x) => x.removeAttribute("data-audit-t")); el.setAttribute("data-audit-t", "1"); return true; } continue; }
    // cards that repeat: test the first three of each shape
    const sh = tag + "." + (typeof el.className === "string" ? el.className.split(" ")[0] : "") + "|" + (href.replace(/[?#].*/, "").replace(/\/[^/]+$/, "/*")); shape[sh] = (shape[sh] || 0) + 1; if (shape[sh] > 3 && !/^(button|input|select|textarea)$/.test(tag)) continue;
    out.push({ sig, nth, tag, label: lab, href, type, role: el.getAttribute("role") || "", disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"), target: el.getAttribute("target") || "", download: el.hasAttribute("download") }); }
  return want ? false : out;
};

// checks of the whole page, once per page, role and width: duplicates, tap sizes, clipped text, covered controls, sideways scroll
const PAGECHECK = ({ phone, TAP, scoped }) => { const root = scoped ? (window.__overlays?.() || []).slice(-1)[0] || document : document;
  const R = [], vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) return false; return !el.closest("[hidden],[aria-hidden=true],[inert]") && (el.checkVisibility ? el.checkVisibility({ contentVisibilityAuto: true }) : true); };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.title || el.value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const desc = (el) => `${el.tagName.toLowerCase()} "${name(el)}"`;
  const ctl = [...root.querySelectorAll('a[href],button,[role=button],[role=tab],summary,select,input:not([type=hidden]):not([type=radio]):not([type=checkbox])')].filter(vis);
  // sideways scroll
  const sw = document.documentElement.scrollWidth - innerWidth; if (sw > 1) { const wide = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 2).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")); R.push(["page", `sideways scroll ${sw}px (${wide.join(", ")})`, "high"]); }
  // the same control twice in one block (the triple "Invite friends")
  const groups = {}; for (const el of ctl) { const n = name(el); if (!n || n.length < 3) continue; const box = el.closest("section,article,[role=dialog],form,li,.card,header,footer,nav,aside") || document.body; const k = n.toLowerCase() + "|" + (el.getAttribute("href") || ""); (groups[k] ||= []).push([el, box]); }
  for (const [k, L] of Object.entries(groups)) { if (L.length < 2) continue; const byBox = new Map(); for (const [el, box] of L) { if (el.closest("nav,.es-tabs,.es-rail,header.top,footer")) continue; byBox.set(box, [...(byBox.get(box) || []), el]); }
    for (const [box, E] of byBox) { if (E.length < 2 || box === document.body) continue; /* rows of a list each have their own; twins sit within two levels of each other */ const near = E.filter((a) => E.some((b) => b !== a && (a.parentElement === b.parentElement || a.parentElement?.parentElement === b.parentElement?.parentElement && a.parentElement?.parentElement?.children.length <= 3))); if (near.length > 1) R.push([desc(near[0]), `the same control is drawn ${near.length} times in one block`, "medium"]); }
    const all = L.filter(([el]) => !el.closest("nav,.es-tabs,.es-rail,header.top,footer,article,li,[class*=card],[class*=row],[class*=item],[class*=opt]")).map(([el]) => el); if (all.length > 2 && /invite|share|reply|i'm in|save|publish|book/i.test(k) && ![...byBox.values()].some((E) => E.length > 1)) { const ys = all.map((e) => Math.round(e.getBoundingClientRect().top + scrollY)); R.push([desc(all[0]), `drawn ${all.length} times on the page (at y ${ys.join(", ")})`, "low"]); } }
  // tap targets on a phone (inline links in running text are exempt, as in WCAG 2.5.8)
  // a target under 44px passes when a 44px square centred on it reaches no other target (the spacing rule of WCAG 2.5.8, at 44px)
  const boxes = phone ? ctl.map((el) => [el, el.getBoundingClientRect()]) : [], clear = (el, r) => { const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = TAP / 2; return r.width >= 24 && r.height >= 24 && !boxes.some(([o, q]) => o !== el && !o.contains(el) && !el.contains(o) && q.width && q.left < cx + h && q.right > cx - h && q.top < cy + h && q.bottom > cy - h); };
  if (phone) for (const el of ctl) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (cs.display === "inline" && el.parentElement && /^(P|LI|SPAN|SMALL|DIV|LABEL|EM|STRONG|TD)$/.test(el.parentElement.tagName) && (el.parentElement.innerText || "").trim().length > name(el).length + 3) continue;
    if (el.disabled) continue; if (el.closest("[data-audit-ignore]")) continue;
    if ((r.width < TAP - 0.5 || r.height < TAP - 0.5) && !clear(el, r)) { // a bigger hit area through padding on a ::before/::after counts
      const pe = ["::before", "::after"].map((p) => getComputedStyle(el, p)).find((s) => s.content !== "none" && s.position === "absolute" && (parseFloat(s.height) >= TAP || parseFloat(s.inset) < 0 || parseFloat(s.top) < 0)); if (pe) continue;
      R.push([desc(el) + (typeof el.className === "string" && el.className ? " ." + el.className.trim().split(/\s+/)[0] : " <" + el.parentElement?.tagName.toLowerCase() + (el.parentElement?.className ? "." + String(el.parentElement.className).split(" ")[0] : "") + ">"), `tap target ${Math.round(r.width)}x${Math.round(r.height)} (under ${TAP}px)`, "low"]); } }
  // clipped text: a control or heading whose text is cut off with no ellipsis
  for (const el of [...ctl, ...root.querySelectorAll("h1,h2,h3,label,.chip,.pill")].filter(vis)) { const cs = getComputedStyle(el); if (!(el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 3)) continue; if (cs.overflowX === "visible" && cs.overflowY === "visible") continue; if (cs.textOverflow === "ellipsis" || +cs.webkitLineClamp > 0 || cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll") continue; if (el.clientWidth <= 2 || el.clientHeight <= 2 || cs.clip !== "auto" && cs.clip !== "" && cs.position === "absolute") continue; if (!el.innerText?.trim() || el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") continue;
    if (el.scrollHeight > el.clientHeight + 3 && el.scrollWidth <= el.clientWidth + 2 && el.clientHeight > 80) continue; // a scroll box, on purpose
    R.push([desc(el), `text clipped (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`, "medium"]); }
  return R;
};
// at the very top and the very bottom of the page: is any control under a fixed or sticky bar?
const COVERED = () => { const R = [], vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0 || cs.pointerEvents === "none") return false; return !el.closest("[hidden],[aria-hidden=true],[inert]") && (el.checkVisibility ? el.checkVisibility({ contentVisibilityAuto: true }) : true); };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.title || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const fixedOf = (n) => { while (n && n !== document.body) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return n; n = n.parentElement; } return null; };
  for (const el of document.querySelectorAll('a[href],button,[role=button],[role=tab],summary,input:not([type=hidden]),select,textarea')) { if (!vis(el)) continue; if (fixedOf(el)) continue; const r = el.getBoundingClientRect(); if (r.bottom < 2 || r.top > innerHeight - 2) continue;
    const pts = [[r.left + r.width / 2, r.top + r.height / 2]]; let hit = 0, by = null;
    for (const [x, y] of pts) { if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue; const t = document.elementFromPoint(x, y); if (!t || el.contains(t) || t.contains(el)) { hit++; continue; } const f = fixedOf(t), fr = f?.getBoundingClientRect(), anchored = f && (getComputedStyle(f).position === "fixed" && (scrollY < 5 ? fr.top < 8 : fr.bottom > innerHeight - 8)); if (f && anchored && !f.contains(el) && !window.__overlays().includes(f)) by = f; else if (t.closest("label") && t.closest("label").control === el) hit++; else hit++; }
    if (!hit && by) R.push([`${el.tagName.toLowerCase()} "${name(el)}"`, `covered by ${by.tagName.toLowerCase()}${by.className && typeof by.className === "string" ? "." + by.className.split(" ")[0] : ""} at the ${scrollY < 5 ? "top" : "bottom"} of the page`, "high"]); }
  return R; };

// ---- the browser side ----
const ctxPool = new Map();
async function ctxFor(role, width) { const k = role + "@" + width; if (ctxPool.has(k)) return ctxPool.get(k);
  const phone = width < 600, opts = phone ? { ...pw.devices["iPhone 13"], viewport: { width, height: 844 } } : { viewport: { width, height: 900 } };
  const ctx = await browser.newContext({ ...opts, serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"], extraHTTPHeaders: { "x-forwarded-for": `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` } });
  const c = cookies[role]; if (c) { const [n, ...v] = c.split("="); await ctx.addCookies([{ name: n, value: v.join("="), url: base }, { name: "encore_in", value: "1", url: base }]); }
  await ctx.addInitScript(WATCH); await ctx.addInitScript(`window.__overlays = () => ${OVERLAYS};`);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
  ctxPool.set(k, ctx); return ctx; }
const quiet = async (page, ms = 3000) => { await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {}); await page.waitForTimeout(250); };
// a sheet the page opens by itself (the feed's deck for a new account) is closed first, the way a person would
async function dismissAuto(page) { await page.waitForFunction(() => window.__overlays?.().length, null, { timeout: 1400 }).catch(() => {}); for (let i = 0; i < 3; i++) { const n = await page.evaluate(() => window.__overlays().length).catch(() => 0); if (!n) return;
  const x = page.locator('[aria-label^="Close" i], [aria-label*="close" i], [aria-label="Not now" i]').filter({ visible: true }).last(); if (await x.count()) await x.click({ timeout: 1500 }).catch(() => {}); else await page.keyboard.press("Escape"); await page.waitForTimeout(300); } }
function watchPage(page, sink) {
  page.on("pageerror", (e) => sink.errors.push("pageerror: " + String(e.message || e).split("\n")[0].slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|'integrity' attribute for resource 'https:\/\/(?!127)/.test(m.text())) sink.errors.push("console: " + m.text().slice(0, 160)); });
  page.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(base) && !/ERR_ABORTED|NS_BINDING_ABORTED/.test(r.failure()?.errorText || "")) sink.errors.push(`request failed: ${u.slice(base.length, base.length + 100)} ${r.failure()?.errorText}`); });
  page.on("request", (r) => { if (r.url().startsWith(base) && r.resourceType() !== "image" && r.resourceType() !== "font") sink.reqs++; });
  page.on("response", (r) => { const u = r.url(); if (!u.startsWith(base)) return; const p = u.slice(base.length), st = r.status(); if (st < 400) return; if (r.request().isNavigationRequest()) return; if ([400, 409, 422].includes(st) || (st < 500 && r.request().method() !== "GET")) { r.json().then((j) => sink.soft.push({ st, p, msg: String(j?.message || "") })).catch(() => sink.soft.push({ st, p, msg: "" })); return; } if (sink.allow?.(st, p)) return; if ((st === 401 || st === 403) && sink.role === "out") return; if (/\/api\/track|\/api\/db\/events/.test(p)) return; if (st === 502 && p.startsWith("/api/mcp/call")) return; /* a connected web search with no internet here (the fake AI calls it with no query); the studio says the tool failed */ sink.errors.push(`${st} ${r.request().method()} ${p.slice(0, 110)}${st >= 500 && r.request().postData() ? " " + r.request().postData().slice(0, 90) : ""}`); });
  page.on("download", () => sink.downloads++);
  page.on("response", (r) => { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) { sink.navs++; sink.nav = { status: r.status(), url: r.url() }; } });
}
async function load(ctx, spec) { const page = await ctx.newPage(), sink = { errors: [], soft: [], reqs: 0, downloads: 0, navs: 0, role: spec.role }; watchPage(page, sink);
  let resp; try { resp = await page.goto(base + spec.path, { waitUntil: "load", timeout: 20000 }); } catch (e) { return { page, sink, err: "load: " + e.message.split("\n")[0] }; }
  await quiet(page); await dismissAuto(page);
  if (spec.setup) { const [k, a] = spec.setup.split(":"); try { await (a ? sheetOpeners[k](a) : sheetOpeners[k])(page); await page.waitForTimeout(700); } catch (e) { return { page, sink, resp, err: "could not open " + spec.name + ": " + e.message.split("\n")[0] }; } }
  return { page, sink, resp }; }
const SKIP = /\b(sign ?out|log ?out|delete|remove|unpublish|archive|block|report( this)?|cancel (this|the|event|booking|plan|dinner|drop|request)|leave( the)?( fan)? club|turn off club|end the club|stop following|unfollow|reset|discard)\b/i;
const EXTERNAL = (href) => /^(mailto:|tel:|sms:|https?:\/\/(?!127\.0\.0\.1)|webcal:|data:|blob:|javascript:)/i.test(href);

async function clickOne(spec, width, el) {
  const role = spec.role, phone = width < 600, ctx = await ctxFor(role, width), at = (msg, sev) => issue({ width, role, page: spec.name, element: `${el.tag} "${el.label}"${el.href ? " " + el.href.slice(0, 60) : ""}`, issue: msg, sev, status: "open" });
  const { page, sink, err } = await load(ctx, spec); if (err) { await page.close(); return; }
  try {
    const found = await page.evaluate(ENUM, [spec.setup ? "overlay" : "", [el.sig, el.nth]]).catch(() => false); if (!found) return;
    const L = page.locator("[data-audit-t]");
    // where it sits: centred on screen, is it the thing a tap there reaches?
    await L.evaluate((n) => n.scrollIntoView({ block: "center", inline: "center" })).catch(() => {}); await page.waitForTimeout(120);
    const cover = await L.evaluate((n) => { const r = n.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return ""; const x = r.left + r.width / 2, y = r.top + r.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return ""; const t = document.elementFromPoint(x, y); if (!t || n.contains(t) || t.contains(n) || (n.labels && [...n.labels].some((l) => l.contains(t)))) return ""; if (n.tagName === "INPUT" && /radio|checkbox/.test(n.type)) return "";
      let f = t; while (f && f !== document.body) { const p = getComputedStyle(f).position; if (p === "fixed" || p === "sticky") break; f = f.parentElement; } if (!f || f === document.body) return ""; return f.tagName.toLowerCase() + (typeof f.className === "string" && f.className ? "." + f.className.split(" ")[0] : ""); }).catch(() => "");
    if (cover) at(`covered by ${cover} even when scrolled to the middle of the screen`, "high");
    if (el.disabled) return;
    if (el.tag === "a" && EXTERNAL(el.href)) { if (/^javascript:/i.test(el.href) && !/void/.test(el.href)) at("javascript: link", "low"); return; }
    if (el.tag === "a" && (!el.href || el.href === "#") && !(await L.evaluate((n) => !!(n.onclick || n.dataset && Object.keys(n.dataset).length)).catch(() => false))) { /* falls through to the "does nothing" check */ }
    const before = await page.evaluate(() => { const W = window.__audit; W.mut = 0; W.req = 0; W.opened = 0; W.shared = 0; W.copied = 0; W.t = performance.now(); document.querySelectorAll("[data-audit-pre]").forEach((x) => x.removeAttribute("data-audit-pre")); window.__overlays().forEach((o) => o.setAttribute("data-audit-pre", "1")); return { url: location.href, y: scrollY, focus: document.activeElement?.outerHTML?.slice(0, 80) || "", overlays: window.__overlays().length }; });
    const soft0 = sink.soft.length, errs0 = sink.errors.length, reqs0 = sink.reqs, dl0 = sink.downloads; let popup = null; const pp = page.context().waitForEvent("page", { timeout: 1000 }).then((p) => (popup = p)).catch(() => {});
    const navs0 = sink.navs;
    let clickErr = "";
    if (el.tag === "input" || el.tag === "textarea" || el.tag === "select") {
      const t = el.type;
      try { if (t === "file") await L.setInputFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
        else if (t === "checkbox" || t === "radio") await L.click({ timeout: 2500, force: true });
        else if (el.tag === "select") { const v = await L.evaluate((s) => [...s.options].find((o) => !o.selected && !o.disabled)?.value); if (v != null) await L.selectOption(v); }
        else if (t === "date") await L.fill(new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10));
        else if (t === "time") await L.fill("19:30");
        else if (t === "range" || t === "color") await L.evaluate((n) => { n.value = n.type === "color" ? "#335577" : String(+n.max || 5); n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); });
        else if (t === "number") { await L.fill("4"); await L.press("Tab"); }
        else if (t === "email") { await L.fill("audit.person@example.com"); await L.press("Tab"); }
        else { await L.click({ timeout: 2500 }); await L.fill("Audit"); await L.press("Tab"); }
      } catch (e) { clickErr = e.message.split("\n")[0]; }
    } else {
      try { if (phone) await L.tap({ timeout: 2500 }); else await L.click({ timeout: 2500 }); } catch (e) { clickErr = e.message.split("\n")[0]; if (/intercepts pointer events/.test(e.message)) { const m = /<(\w+)[^>]*?(?:class="([^"]*)")?[^>]*> (?:from|subtree)/.exec(e.message); at(`a tap there reaches another element${m ? ` (${m[1]}${m[2] ? "." + m[2].split(" ")[0] : ""})` : ""}`, "high"); } await L.evaluate((n) => n.click()).catch(() => {}); }
    }
    await page.waitForTimeout(600); await pp; const navResp = sink.navs > navs0 ? sink.nav : null;
    if (navResp) await quiet(page, 4000); else await page.waitForTimeout(700);
    if (clickErr && !/intercepts pointer/.test(clickErr) && !/detached|not attached|Target closed|navigat/i.test(clickErr)) { if (VERBOSE) console.log("   click error", spec.name, el.label, clickErr.slice(0, 100)); }
    // errors
    // a link to raw data (the leaderboard's JSON) leaves the app: the browser drops the page fade there and reports it in the data's own document, which has no script of ours and nothing a person sees
    const rawDoc = /^\/api\//.test(page.url().slice(base.length)), vtDrop = (t) => rawDoc && /ViewTransition opt-in disabled/.test(t);
    for (const e of sink.errors.slice(errs0)) if (!vtDrop(e)) at(e, /pageerror|5\d\d /.test(e) ? "high" : "medium");
    // a refusal the server explains (400, 409, 422) is fine when the page shows its message; otherwise the tap looks dead
    for (const s of navResp ? [] : sink.soft.slice(soft0)) { if (/\/typing$/.test(s.p.split("?")[0])) continue; /* the "is typing" ping is a background signal: a refusal there (another tap changed this guest's reply a moment ago) is not something the page should say; sending says it */ const shown = s.msg && (await page.evaluate((m) => (document.body?.innerText || "").includes(m), s.msg).catch(() => false)); if (!shown) at(`${s.st} ${s.p.slice(0, 80)}: the server said "${s.msg.slice(0, 80)}" and the page doesn't show it`, "medium"); }
    const after = await page.evaluate(() => { const W = window.__audit; const shifts = W.shifts.filter(([t]) => t > W.t).reduce((a, [, v]) => a + v, 0); return { url: location.href, y: scrollY, mut: W.mut, req: W.req, opened: W.opened, shared: W.shared, copied: W.copied, shifts, rej: W.rejections.slice(), focus: document.activeElement?.outerHTML?.slice(0, 80) || "", sw: document.documentElement.scrollWidth - innerWidth, text: (document.body?.innerText || "").trim().length, title: document.title, newOverlays: window.__overlays().filter((o) => !o.hasAttribute("data-audit-pre")).length, overlays: window.__overlays().length }; }).catch(() => null);
    if (!after) return;
    for (const r of new Set(after.rej)) if (!vtDrop(r)) at("unhandled rejection: " + r, "high");
    if (navResp) { const st = navResp.status; if (st >= 400) at(`lands on a ${st} page (${after.url.slice(base.length, base.length + 80)})`, "high"); else if (after.text < 20 && !(await page.waitForFunction(() => (document.body?.innerText || "").trim().length >= 20, null, { timeout: LOADER_MS }).then(() => true, () => false))) /* blank means still blank 8 seconds on, like a stuck loader */ at(`lands on a blank page (${after.url.slice(base.length, base.length + 80)})`, "high"); }
    if (popup) { await popup.waitForLoadState("load", { timeout: 8000 }).catch(() => {}); await popup.waitForFunction(() => (document.body?.innerText || "").trim().length >= 20, null, { timeout: 8000 }).catch(() => {}); /* the app draws after load: blank means still blank 8 seconds on */ const u = popup.url(); if (u.startsWith(base)) { const t = await popup.evaluate(() => (document.body?.innerText || "").trim().length).catch(() => 99); if (t < 20 && !/\.(csv|ics|pdf|png|svg)/.test(u)) at(`opens a blank tab (${u.slice(base.length, base.length + 80)})`, "high"); } await popup.close().catch(() => {}); }
    if (after.shifts > CLS_MAX) at(`layout shift ${after.shifts.toFixed(2)} after the tap`, "medium");
    if (after.sw > 1) at(`sideways scroll ${after.sw}px after the tap`, "high");
    const changed = navResp || popup || after.url !== before.url || after.mut > 0 || after.req > 0 || sink.reqs > reqs0 || sink.downloads > dl0 || after.opened || after.shared || after.copied || after.newOverlays || after.overlays !== before.overlays || after.y !== before.y || after.focus !== before.focus;
    if (!changed && !/^(input|textarea|select|label)$/.test(el.tag) && !clickErr) at("does nothing (no navigation, no change on the page, no request)", "medium");
    // a sheet that opened: focus moves into it, and Esc, its close button, the backdrop or Back closes it
    if (after.newOverlays > 0 && !navResp && after.url.split("#")[0] === before.url.split("#")[0]) await sheetChecks(page, at, before);
    // loaders
    const loading = () => page.evaluate(() => [...document.querySelectorAll('.plc,[data-calm-loader],[aria-busy=true],.spinner,.loading')].some((n) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.width > 0 && getComputedStyle(n).visibility !== "hidden"; })).catch(() => false);
    if (await loading()) { await page.waitForTimeout(LOADER_MS - 700); if (await loading()) at(`a loader is still up ${LOADER_MS / 1000}s after the tap`, "high"); }
  } finally { await page.close().catch(() => {}); }
}
async function sheetChecks(page, at, before) {
  const inSheet = () => page.evaluate(() => { const L = window.__overlays().filter((o) => !o.hasAttribute("data-audit-pre")); const o = L[L.length - 1]; return !!o && o.contains(document.activeElement); }).catch(() => false);
  const open = () => page.evaluate(() => window.__overlays().filter((o) => !o.hasAttribute("data-audit-pre")).length).catch(() => 0);
  if (!(await inSheet())) { await page.waitForTimeout(400); if (!(await inSheet())) at("the sheet opens but focus stays on the page behind it", "low"); }
  // Tab stays inside
  if (await inSheet()) { for (let i = 0; i < 12; i++) await page.keyboard.press("Tab"); if (!(await inSheet()) && (await open())) at("Tab leaves the open sheet (focus isn't kept inside)", "low"); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(450);
  if (!(await open())) { const f = await page.evaluate(() => document.activeElement === document.body || !document.activeElement).catch(() => false); if (f) at("closing the sheet drops focus on the page body", "low"); return; }
  at("Esc doesn't close the sheet", "low");
  const x = page.locator('[data-audit-pre] ~ * [aria-label*="close" i]').or(page.locator('[aria-label*="close" i], button:has-text("Close"), button:has-text("Done"), button:has-text("Cancel"), button:has-text("Not now")')).filter({ visible: true }).last();
  if (await x.count()) { await x.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400); if (!(await open())) return; }
  await page.mouse.click(4, 4); await page.waitForTimeout(400); if (!(await open())) return;
  const u = page.url(); await page.goBack({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(500); if (!(await open()) || page.url() !== u) return;
  at("the sheet can't be closed (Esc, close button, backdrop, Back)", "high");
}
async function pageChecks(spec, width) {
  const role = spec.role, ctx = await ctxFor(role, width), at = (element, msg, sev) => issue({ width, role, page: spec.name, element, issue: msg, sev, status: "open" });
  const { page, sink, resp, err } = await load(ctx, spec); if (err) { at("page", err, "high"); await page.close(); return []; }
  try {
    if (resp && resp.status() >= 400) at("page", `loads with status ${resp.status()}`, "high");
    await page.waitForTimeout(600);
    for (const e of sink.errors) at("page load", e, /pageerror|5\d\d /.test(e) ? "high" : "medium");
    const a = await page.evaluate(() => ({ cls: window.__audit.shifts.reduce((s, [, v]) => s + v, 0), rej: window.__audit.rejections })).catch(() => ({ cls: 0, rej: [] }));
    if (has("--shifts")) { await page.waitForTimeout(2500); /* late restyles too */ const L = await page.evaluate(() => window.__audit.shifts.map(([t, v, src]) => `${Math.round(t)}ms ${v.toFixed(3)} ${src}`)).catch(() => []); const sum = L.reduce((x, l) => x + +l.split(" ")[1], 0); console.log(`load shift ${sum.toFixed(3)} on ${width} ${role} ${spec.name}${L.length ? "\n    " + L.join("\n    ") : ""}`);
      /* and a second visit, with what the first one left on the device */ await page.reload({ waitUntil: "load" }).catch(() => {}); await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(3000); const L2 = await page.evaluate(() => window.__audit.shifts.map(([t, v, src]) => `${Math.round(t)}ms ${v.toFixed(3)} ${src}`)).catch(() => []); console.log(`  second visit ${L2.reduce((x, l) => x + +l.split(" ")[1], 0).toFixed(3)}${L2.length ? "\n    " + L2.join("\n    ") : ""}`); }
    for (const r of new Set(a.rej)) at("page load", "unhandled rejection: " + r, "high");
    const nomap = await page.evaluate(() => !!document.querySelector(".nomap")).catch(() => false); /* the map library comes from a CDN this harness can't reach: /map falls back to its list, a layout change no visitor with a network sees */
    if (a.cls > 0.25 && !nomap) at("page load", `layout shift ${a.cls.toFixed(2)} while loading`, "medium");
    for (const [e, m, s] of await page.evaluate(PAGECHECK, { phone: width < 600, TAP: TAP_MIN, scoped: !!spec.setup }).catch((e) => [["page", "check failed: " + e.message, "low"]])) at(e, m, s);
    if (!spec.setup) { for (const y of ["top", "bottom"]) { await page.evaluate((y) => scrollTo(0, y === "top" ? 0 : document.documentElement.scrollHeight), y); await page.waitForTimeout(350); for (const [e, m, s] of await page.evaluate(COVERED).catch(() => [])) at(e, m, s); } await page.evaluate(() => scrollTo(0, 0)); }
    const els = await page.evaluate(ENUM, [spec.setup ? "overlay" : "", null]).catch(() => []);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${width}-${role}-${spec.name.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}.png`), fullPage: !spec.setup }).catch(() => {});
    return els.filter((e) => !SKIP.test(e.label) && !/logout|signout/.test(e.href));
  } finally { await page.close().catch(() => {}); }
}

let clicked = 0, skipped = 0;
async function runClicks() {
  const tasks = [];
  for (const width of WIDTHS) for (const P of PAGES) for (const role of P.roles) { if (ONLY && !P.path.startsWith(ONLY) && !P.name.includes(ONLY)) continue; if (ROLE && role !== ROLE) continue; tasks.push({ ...P, role, width }); }
  // page checks first (they list the elements), then every element on a fresh load
  const work = []; let i = 0;
  /* page checks measure load shifts, which a busy machine inflates: fewer at once */ await Promise.all(Array.from({ length: Math.min(3, WORKERS) }, async () => { while (i < tasks.length) { const T = tasks[i++]; const els = await pageChecks(T, T.width); const n = els.length; if (n > MAX) skipped += n - MAX; for (const el of els.slice(0, MAX)) work.push([T, el]); if (VERBOSE) console.log(`listed ${n} on ${T.width} ${T.role} ${T.name}`); } }));
  if (has("--pages-only")) return; let j = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => { while (j < work.length) { const [T, el] = work[j++]; try { await clickOne(T, T.width, el); clicked++; } catch (e) { if (VERBOSE) console.log("   harness", T.name, el.label, e.message.split("\n")[0]); } if (VERBOSE && clicked % 100 === 0) console.log(`  ${clicked}/${work.length} clicked, ${issues.length} issues`); } }));
}

// ---------------- journeys ----------------
const J = { "content-type": "application/json" };
const api = async (method, p, body, cookie) => { const r = await fetch(base + p, { method, headers: { ...J, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, j }; };
async function journeyCtx(role, width = 390, extraCookie) { const phone = width < 600, ctx = await browser.newContext({ ...(phone ? { ...pw.devices["iPhone 13"], viewport: { width, height: 844 } } : { viewport: { width, height: 900 } }), serviceWorkers: "block", permissions: ["clipboard-read", "clipboard-write"], extraHTTPHeaders: { "x-forwarded-for": `10.9.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` } });
  const c = extraCookie || cookies[role]; if (c) { const [n, ...v] = c.split("="); await ctx.addCookies([{ name: n, value: v.join("="), url: base }, { name: "encore_in", value: "1", url: base }]); }
  await ctx.addInitScript(WATCH); await ctx.addInitScript(`window.__overlays = () => ${OVERLAYS};`); await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" }));
  const page = await ctx.newPage(), sink = { errors: [], soft: [], reqs: 0, downloads: 0, navs: 0, role }; watchPage(page, sink); return { ctx, page, sink }; }
const journeys = [];
async function journey(name, fn) { const width = 390, out = { name, steps: [], ok: true }; journeys.push(out); const t = Date.now();
  const step = async (what, f) => { try { await f(); out.steps.push(["ok", what]); } catch (e) { out.ok = false; out.steps.push(["fail", what, e.message.split("\n")[0].slice(0, 200)]); issue({ width, role: "journey", page: name, element: what, issue: e.message.split("\n")[0].slice(0, 200), sev: "high", status: "open" }); throw e; } };
  try { await fn(step); } catch {} if (VERBOSE) console.log(`journey ${name}: ${out.ok ? "ok" : "FAILED"} in ${((Date.now() - t) / 1000).toFixed(1)}s`); }
const must = (c, m) => { if (!c) throw new Error(m); };
const vis = (page, sel) => page.locator(sel).filter({ visible: true }).first();
async function noErrors(sink, what) { const e = sink.errors.filter((x) => !/^40[13] /.test(x)); must(!e.length, `${what}: ${e.slice(0, 2).join("; ")}`); sink.errors.length = 0; }

async function runJourneys() {
  const { journeySteps } = await import("./click-audit-journeys.mjs");
  await journeySteps({ journey, must, vis, noErrors, journeyCtx, api, base, S, B, LT, store, cookies, pw, browser, dismissAuto });
}

// the journeys first, on the world as seeded: the taps after them may take bookings out of a campaign or check everyone in
if (JOURNEYS) await runJourneys();
if (CLICKS) await runClicks();
const order = { high: 0, medium: 1, low: 2 };
issues.sort((a, b) => order[a.sev] - order[b.sev] || a.page.localeCompare(b.page));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ issues, journeys, clicked, skipped }, null, 1));
console.log(issues.map(fmt).join("\n"));
for (const j of journeys) console.log(`journey ${j.ok ? "ok  " : "FAIL"} ${j.name}${j.ok ? "" : ": " + j.steps.filter((s) => s[0] === "fail").map((s) => s[1] + " (" + s[2] + ")").join("; ")}`);
const by = (s) => issues.filter((x) => x.sev === s).length;
console.log(`${issues.length} issue${issues.length === 1 ? "" : "s"} (${by("high")} high, ${by("medium")} medium, ${by("low")} low) at ${WIDTHS.join(" and ")}px; ${clicked} taps${skipped ? `, ${skipped} over the per-page cap` : ""}; journeys ${journeys.filter((j) => j.ok).length}/${journeys.length}`);
process.exit(issues.length ? 1 : 0);
