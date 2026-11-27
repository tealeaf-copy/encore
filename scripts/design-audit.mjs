// The design audit's mechanical pass: opens every page as each person who would see it, at 390px (iPhone 13) and
// 1280px, and lists what a designer would mark up on a printout. Not part of npm test (it needs Chromium, like
// scripts/crawl-pages.mjs). It starts its own server on a scratch data dir, seeds the routes world (test/routes-seed.js)
// and the Fernwood Labs brand world (test/brand-intel-seed.js), and checks each page for:
//   overflow   an element that hides overflow and whose content is wider (or taller) than its box: text cut off
//   ellipsis   a line cut short with "…" (a meta line that doesn't fit)
//   wrap       a button, chip or tab whose label wraps onto a second line ("Example / only")
//   nested     an interactive element inside another (a link in a button), or a filled pill inside a button
//   font       text whose computed font is not one of the kit's (IBM Plex Sans, Serif, Mono) on platform chrome
//   radius     a drawn box (fill or border) with corners that are not the kit's (0, 4px, 6px or round)
//   emoji      an emoji in a button, tab, heading or the nav on platform chrome
//   image      an image with no width and height that takes its size from the file (it moves the page as it loads)
//   help       text under the floating help button at rest (at the top of the page, and at the very bottom)
//   orphan     a short block of copy whose last line is a single word
//   jammed     a heading with under 4px between it and the paragraph under it
//   cards      cards in one row whose heights don't match, or a card with a big empty band under its content
// Host-owned pages (/@handle, /e, /g, /i, /x, /k, /p, /again) wear the host's kit, so font and radius are only checked
// on the platform's chrome there (the nav, the tab bar, the help button).
// Run: node scripts/design-audit.mjs [--width 390|1280|both] [--only /feed] [--role host] [--shots <dir>] [--json <file>]
//      [--quiet] (counts only). Prints one line per finding, grouped by page, then the totals per check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { openStore } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedRoutes } from "../test/routes-seed.js";
import { seedBrandIntel } from "../test/brand-intel-seed.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const W_ARG = arg("--width", "both"), ONLY = arg("--only", ""), ROLE = arg("--role", ""), SHOTS = arg("--shots", ""), JSON_OUT = arg("--json", ""), QUIET = process.argv.includes("--quiet");
const WIDTHS = W_ARG === "both" ? [390, 1280] : [+W_ARG];
let pw; try { pw = await import("playwright"); } catch { pw = createRequire(import.meta.url)(path.join(process.execPath, "../../lib/node_modules/playwright")); }

Object.assign(process.env, { ENCORE_SIGNUP: "1", SESSION_SECRET: process.env.SESSION_SECRET || "audit-secret-0123456789abcdef", ENCORE_FAKE_EMAIL: "1", ENCORE_FAKE_SMS: "1", ENCORE_FAKE_PUSH: "1", ENCORE_FAKE_AI: "1", ENCORE_FAKE_GEO: "1", ENCORE_ADMIN_EMAILS: "admin@example.com", ENCORE_SIGNUP_PER_HOUR: "5000", ENCORE_VERIFY_EMAIL: "0", ENCORE_INSIGHTS_CACHE_MS: "0" });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "encore-design-")), store = openStore(path.join(dir, "d.db"));
const app = createApp({ store, dataDir: dir }), server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const S = await seedRoutes(base), B = await seedBrandIntel(base, store, { guests: 90 });
const q = (r) => `rid=${encodeURIComponent(r.rid)}&code=${encodeURIComponent(r.code)}`;
const LT = B.hosts[0];
const roles = { out: null, guest: S.guest.cookie, host: S.host.cookie, brand: B.owner.c, bhost: LT.c, admin: S.admin.cookie };

// every page, with who sees it. One row per page and person; "settle" waits longer for pages that fade in late.
export const PAGES = [
  // signed out
  ...["/", "/feed", "/discover", "/hosts", "/events", "/ideas", "/about", "/start", "/start?t=table", "/login", "/signup", "/plans", "/inbox", "/saved", "/chats", "/settings",
    `/@${S.handle}`, `/@${LT.handle}`, `/e/${S.open}`, `/e/${S.past}`, `/e/rtTable`, `/i/${S.open}`, `/g#rsvp-${S.open}`, `/x/${S.handle}/${S.exp}`, `/k/${S.past}?${q(S.pastRid)}`, `/p/${S.past}?${q(S.pastRid)}`, `/again/${S.past}?${q(S.pastRid)}`,
    `/recap/${S.handle}`, `/plans/rtSummit`, `/speakers/rtSummit/sp1`, "/guides", "/guides/weekend-away", "/map", "/leaderboard", "/community", "/privacy", "/terms", "/security", "/teams", "/teams/discover",
    "/founding-hosts", "/collections", "/people", "/join", "/forgot", "/this-page-is-not-here"].map((p) => ({ path: p, as: "out" })),
  // a guest who has replied to things
  ...["/feed", "/?app=1", "/discover", "/hosts", "/plans", `/plans/rtTrip`, "/inbox", "/saved", "/chats", `/chats/${S.open}`, "/settings", `/@${S.handle}`, `/e/${S.open}`, `/g#rsvp-${S.open}`, "/people", "/me", "/ideas"].map((p) => ({ path: p, as: "guest" })),
  // a host with a page, events, a drop and a chat
  ...["/?app=1", "/?app=1&new=1#studio", `/?app=1&open=${S.open}#studio`, "/feed", "/plans", "/plans/rtSummit", "/plans/rtTable", "/inbox", "/saved", "/chats", `/chats/${S.open}`, "/settings", `/@${S.handle}`, `/g#rsvp-${S.open}`,
    "/contacts", `/contacts/event/${S.open}`, "/path", "/circles", "/playbook", "/start", "/me", "/discover", "/hosts"].map((p) => ({ path: p, as: "host" })),
  // a brand team (Fernwood Labs)
  ...["/?app=1", "/teams/home", "/teams/discover", "/teams/campaigns", `/teams/campaigns/${B.campaigns.C1}`, `/teams/campaigns/${B.campaigns.C1}/run`, `/teams/campaigns/${B.campaigns.C1}/report`, "/teams/bookings", `/teams/bookings/${B.bookings.b1}`,
    "/teams/insights", "/teams/insights/how", "/teams/company", "/teams/trusted", "/teams/hosts", "/teams/formats", "/teams/list", `/teams/x/${LT.handle}/${LT.pkgId}`, `/teams/book/${LT.handle}/${LT.pkgId}`, `/teams/invoice/${B.bookings.b1}`, "/settings"].map((p) => ({ path: p, as: "brand" })),
  // a host brands book (team bookings set up)
  ...["/host/teams", "/?app=1", `/@${LT.handle}`, `/booking/${B.bookings.b3}`].map((p) => ({ path: p, as: "bhost" })),
  // the admin
  ...["/moderation", "/admin/hosts", "/admin/brand-metrics", "/admin/founding-hosts", "/admin/experiments", "/support"].map((p) => ({ path: p, as: "admin" })),
];
const HOST_SURFACE = /^\/(@|e\/|g(#|$|\?)|i\/|x\/|k\/|p\/|again\/|recap\/)/;
export const slug = (P, w) => `${P.as}__${(P.path.replace(/^\//, "") || "root").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "root"}__${w}`;

// ---- the checks, run inside the page ----
function audit(opts) {
  const out = [], W = innerWidth, H = innerHeight, docH = document.documentElement.scrollHeight;
  const KIT_FONTS = /^("?IBM Plex (Sans|Serif|Mono)"?|"?PL Display Fallback"?)$/i;
  const chromeSel = ".es-rail,.es-tabs,.es-top,.es-out,header.top,nav.tabs,.pl-nav,#encoreHelp";
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const hidden = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return true; if (e.hidden || e.getAttribute("aria-hidden") === "true" && e.getBoundingClientRect().width < 2) return true; } return false; };
  const srOnly = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return (r.width <= 2 && r.height <= 2) || cs.clip === "rect(0px, 0px, 0px, 0px)" || /inset\(50%\)/.test(cs.clipPath); };
  const name = (el) => { const t = el.tagName.toLowerCase(), id = el.id ? "#" + el.id : "", c = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const tx = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 48); return `${t}${id}${c}${tx ? ` "${tx}"` : ""}`; };
  const inChrome = (el) => !!el.closest(chromeSel);
  const platform = (el) => !opts.hostSurface || inChrome(el);
  const add = (check, el, issue, sev, extra = {}) => { const r = el.getBoundingClientRect(); out.push({ check, el: name(el), issue, sev, y: Math.round(r.top + scrollY), ...extra }); };
  const lineTops = (node) => { const rg = document.createRange(); rg.selectNodeContents(node); const tops = []; for (const r of rg.getClientRects()) { if (r.width < 1) continue; if (!tops.some((t) => Math.abs(t - r.top) < 4)) tops.push(r.top); } return tops; };
  const textNodes = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) }), L = []; let n; while ((n = w.nextNode())) L.push(n); return L; };
  const all = [...document.body.querySelectorAll("*")].filter((el) => !el.closest("#encoreHelp,script,style,svg,template,noscript"));
  const shown = all.filter((el) => vis(el) && !hidden(el));
  const seen = new Set(), once = (k) => (seen.has(k) ? false : (seen.add(k), true)), used = new Map();
  const isCtl = (el) => el.matches('button,[role=button],[role=tab],a.btn,a[class*="btn"],a[class*="-cta"],a[class*="button"],input[type=submit],input[type=button],summary,.pl-chip,[class*="chip"],[class*="pill"]');
  // some words of el fall outside its box (a box that only hides a hit area or a shadow is fine)
  const clipped = (el) => { const b = el.getBoundingClientRect(); for (const n of textNodes(el).slice(0, 200)) { const pe = n.parentElement; if (!pe || hidden(pe) || srOnly(pe)) continue; const rg = document.createRange(); rg.selectNodeContents(n);
    for (const q of rg.getClientRects()) if (q.width > 1 && (q.right > b.right + 1 || q.left < b.left - 1 || q.bottom > b.bottom + 2 || q.top < b.top - 2)) return true; } return false; };
  for (const el of shown) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    // overflow: content wider or taller than a box that hides it
    const ox = cs.overflowX, oy = cs.overflowY;
    if (!srOnly(el) && r.width > 20 && (el.innerText || "").trim()) {
      if ((ox === "hidden" || ox === "clip") && el.scrollWidth > el.clientWidth + 2) {
        if (cs.textOverflow === "ellipsis") { if (once("e" + name(el))) add("ellipsis", el, `cut short with … (${el.scrollWidth}px of text in ${el.clientWidth}px)`, "medium"); }
        else if (clipped(el) && once("o" + name(el))) add("overflow", el, `content ${el.scrollWidth}px wide in a ${el.clientWidth}px box that hides it`, "high");
      }
      if ((oy === "hidden" || oy === "clip") && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 10 && !el.matches("details,dialog")) {
        const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
        if ((clamp || clipped(el)) && once("v" + name(el))) add(clamp ? "ellipsis" : "overflow", el, clamp ? `clamped to ${cs.webkitLineClamp} lines, ${el.scrollHeight - el.clientHeight}px of text hidden` : `content ${el.scrollHeight}px tall in a ${el.clientHeight}px box that hides it`, clamp ? "low" : "high");
      }
    }
    // a control whose label wraps (one text run on two lines); a full-width row that holds a title may wrap
    if (isCtl(el) && r.height < 120 && r.width < 280 && (el.innerText || "").trim().length <= 48) {
      for (const n of textNodes(el)) { const lc = getComputedStyle(n.parentElement).webkitLineClamp; if (lc && lc !== "none") continue; /* a name set to wrap onto two lines on purpose */ const tops = lineTops(n); if (tops.length > 1 && once("w" + name(el))) { add("wrap", el, `label wraps onto ${tops.length} lines ("${n.nodeValue.trim().slice(0, 30)}")`, "medium"); break; } }
    }
    // interactive inside interactive; a filled pill inside a button
    if (el.matches("a[href],button,[role=button],input:not([type=hidden]),select,textarea,summary,[role=link]")) {
      const outer = el.parentElement?.closest("a[href],button,[role=button],summary");
      if (outer && !(el.matches("input,select,textarea") && outer.matches("summary")) && once("n" + name(el))) add("nested", el, `inside ${name(outer)}`, "high");
    }
    if (el.matches("button,a.btn,[role=button]") || (el.matches("a") && isCtl(el))) {
      for (const c of el.querySelectorAll("span,b,em,small,i,strong")) { if (!vis(c)) continue; const ccs = getComputedStyle(c), cr = c.getBoundingClientRect(); const bg = ccs.backgroundColor;
        // a count ("3") or an avatar's initial is a badge, not a pill with words in it
        if ((c.innerText || "").trim().length > 2 && cr.height > 8 && bg && bg !== "rgba(0, 0, 0, 0)" && bg !== cs.backgroundColor && parseFloat(ccs.borderTopLeftRadius) >= cr.height / 2 - 1 && (c.innerText || "").trim() && once("p" + name(el))) add("nested", el, `a filled pill ("${c.innerText.trim().slice(0, 20)}") inside the control`, "medium"); }
    }
    // the kit's fonts on platform chrome
    if (platform(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
      const first = cs.fontFamily.split(",")[0].trim();
      if (!KIT_FONTS.test(first) && !/emoji/i.test(first) && once("f" + first + el.tagName + (el.className || ""))) add("font", el, `font is ${first}, not the kit's`, "medium");
      if (KIT_FONTS.test(first) && !used.has(first + "|" + cs.fontWeight)) used.set(first + "|" + cs.fontWeight, el);
      // headlines are Plex Sans 600 (docs/brand-kit.md); a 400 headline reads as another face
      if (/^H[1-3]$/.test(el.tagName) && /Plex Sans/.test(first) && parseFloat(cs.fontSize) >= 24 && +cs.fontWeight < 600 && once("hw" + el.tagName + (el.className || ""))) add("font", el, `a ${cs.fontSize} headline at weight ${cs.fontWeight} (the kit's headlines are 600)`, "medium");
      // the display face only at 24px and up: Plex Sans is both, so the check is the serif under 18px
      if (/IBM Plex Serif/i.test(first) && parseFloat(cs.fontSize) < 18 && once("s" + name(el))) add("font", el, `the serif at ${cs.fontSize} (event titles are 22px; under 18px use the text face)`, "low");
    }
    // corners
    if (platform(el) && r.width > 14 && r.height > 14) {
      const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || cs.backgroundImage !== "none";
      if (filled) { for (const k of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) { const v = cs[k]; if (!v || v === "0px") continue;
        const px = /%/.test(v) ? (parseFloat(v) >= 50 ? Infinity : -1) : parseFloat(v); const round = px >= Math.min(r.width, r.height) / 2 - 1;
        if (!round && ![4, 6].includes(Math.round(px)) && once("r" + Math.round(px) + el.tagName + (typeof el.className === "string" ? el.className.split(" ")[0] : ""))) { add("radius", el, `corner ${v} (the kit is 6px, 4px inside a frame, or round)`, px > 8 ? "medium" : "low"); break; } } }
    }
    // emoji in chrome
    if (!opts.hostSurface && el.matches("button,[role=button],[role=tab],h1,h2,h3,nav a,.es-tabs a,.es-rail a") && /\p{Extended_Pictographic}/u.test(el.innerText || "") && once("j" + name(el))) add("emoji", el, "an emoji in platform chrome", "low");
    // a heading jammed against the copy under it: the space between the letters of the heading's last line and the
    // letters of the copy's first line (text boxes, not line boxes, so a tall line height doesn't hide it)
    if (/^H[1-4]$/.test(el.tagName)) { const sib = el.nextElementSibling; if (sib && vis(sib) && /^(P|DIV|SPAN|SMALL|UL)$/.test(sib.tagName) && (sib.innerText || "").trim().length > 12) {
      const hn = textNodes(el).pop(), sn = textNodes(sib)[0]; if (hn && sn) { const rh = document.createRange(), rs = document.createRange(); rh.selectNodeContents(hn); rs.selectNodeContents(sn); const a = [...rh.getClientRects()].pop(), b = rs.getClientRects()[0];
        if (a && b) { const gap = b.top - a.bottom, sr = sib.getBoundingClientRect(); if (gap < 2 && gap > -4 && Math.abs(sr.left - r.left) < 24 && once("h" + name(el))) add("jammed", el, `${Math.round(gap)}px between the heading's letters and "${sib.innerText.trim().slice(0, 30)}"`, "low"); } } } }
    // cards: rows of mismatched heights, and empty bands under a card's content
    if ((cs.display === "grid" || (cs.display === "flex" && !cs.flexDirection.startsWith("column"))) && el.children.length > 1) {
      const kids = [...el.children].filter(vis), byTop = {};
      for (const k of kids) { const kr = k.getBoundingClientRect(); if (kr.height < 60 || kr.width < 80) continue; const key = Math.round(kr.top / 6); (byTop[key] ||= []).push([k, kr]); }
      for (const row of Object.values(byTop)) { if (row.length < 2) continue; const hs = row.map(([, kr]) => kr.height), lo = Math.min(...hs), hi = Math.max(...hs);
        const ws = row.map(([, kr]) => kr.width); if (Math.max(...ws) / Math.min(...ws) < 1.25 && hi - lo > 24 && hi / lo > 1.12 && row.every(([k]) => k.className === row[0][0].className) && once("c" + name(el))) add("cards", el, `cards in one row are ${Math.round(lo)}px to ${Math.round(hi)}px tall`, "low"); }
    }
    if (typeof el.className === "string" && /card/i.test(el.className) && r.height > 100 && (parseFloat(cs.borderTopWidth) > 0 || cs.backgroundColor !== "rgba(0, 0, 0, 0)")) {
      const kids = [...el.children].filter(vis); if (kids.length) { const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)), gap = r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth) - bottom;
        const pd = el.parentElement ? getComputedStyle(el.parentElement).display : ""; if (gap > 40 && !/grid|flex/.test(pd) && cs.display !== "grid" && once("g" + name(el))) add("cards", el, `${Math.round(gap)}px of empty card under its content`, "low"); }
    }
  }
  // a kit face the page names but never loads draws in the system font instead (the name alone passes the check above);
  // a weight the kit doesn't load (Sans 400/500/600, Serif 600, Mono 500) is drawn from the nearest one or faked
  const faces = [...document.fonts].map((f) => ({ fam: f.family.replace(/["']/g, ""), w: f.weight, ok: f.status === "loaded" }));
  for (const [k, el] of used) { const [first, w] = k.split("|"), fam = first.replace(/["']/g, ""); if (/Fallback/.test(fam)) continue;
    const mine = faces.filter((f) => f.fam === fam);
    const google = [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].some((l) => l.href.includes(fam.replace(/ /g, "+")));
    if (!mine.some((f) => f.ok)) add("font", el, google ? `${fam} only comes from Google Fonts here (not the local copy), so offline or blocked it draws in the system face` : `${fam} is named but never loaded here, so it draws in the system face`, google ? "low" : "high");
    else if (getComputedStyle(el).fontSynthesisWeight !== "none" && !mine.some((f) => f.ok && (f.w === w || (/ /.test(f.w) && +w >= +f.w.split(" ")[0] && +w <= +f.w.split(" ")[1])))) add("font", el, `${fam} at weight ${w} isn't loaded (the nearest weight or a faked bold draws instead)`, "low"); }
  // single-word last lines in short copy
  for (const el of shown) {
    if (!el.matches("p,h1,h2,h3,h4,li,figcaption,small,dd,blockquote,[class*=meta],[class*=sub],[class*=desc],[class*=blurb],[class*=title],[class*=lede],[class*=note],[class*=line]")) continue;
    if ([...el.children].some((c) => { const d = getComputedStyle(c).display; return d === "block" || d === "flex" || d === "grid" || d === "list-item"; })) continue;
    const t = (el.innerText || "").replace(/\s+/g, " ").trim(); if (t.length < 18 || t.length > 260) continue;
    const nodes = textNodes(el); if (!nodes.length) continue;
    const words = []; for (let i = nodes.length - 1; i >= 0 && words.length < 2; i--) { const v = nodes[i].nodeValue, re = /\S+/g; let m; const found = []; while ((m = re.exec(v))) found.push([nodes[i], m.index, m.index + m[0].length, m[0]]); words.unshift(...found.slice(-(2 - words.length))); }
    if (words.length < 2 || t.split(" ").length <= 3) continue; /* a three-word title balanced onto two lines is fine */ const top = ([n, s, e]) => { const rg = document.createRange(); rg.setStart(n, s); rg.setEnd(n, e); const rr = rg.getClientRects()[0]; return rr ? rr.top : null; };
    const a = top(words[0]), b = top(words[1]); if (a == null || b == null) continue;
    if (b - a > 4 && words[1][3].replace(/[^\p{L}\p{N}]/gu, "").length > 0 && once("w1" + name(el))) add("orphan", el, `last line is one word ("${words[1][3]}")`, "low");
  }
  // images that take their size from the file
  for (const img of document.querySelectorAll("img")) { if (!vis(img) || img.closest("#encoreHelp")) continue; if (img.hasAttribute("width") && img.hasAttribute("height")) continue; const cs = getComputedStyle(img); if (cs.aspectRatio !== "auto" && !/auto/.test(cs.aspectRatio.split(" ")[0])) continue;
    if (!/(^|\s)(?!auto)\d/.test(img.style.height || "") && opts.imgProbe?.includes(img.currentSrc || img.src)) add("image", img, "no width and height: it takes its size from the file and moves the page as it loads", "medium"); }
  return out;
}

// images whose box changes when the file is swapped for a 1x1: their size comes from the file
async function imageProbe(page) {
  return page.evaluate(async () => { const px = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", out = [];
    for (const img of document.querySelectorAll("img")) { if (img.hasAttribute("width") && img.hasAttribute("height")) continue; const r0 = img.getBoundingClientRect(); if (r0.width < 2 || r0.height < 2) continue;
      const src = img.currentSrc || img.src, ss = img.srcset; img.srcset = ""; img.src = px; try { await img.decode(); } catch {} const r1 = img.getBoundingClientRect(); if (Math.abs(r1.height - r0.height) > 2 || Math.abs(r1.width - r0.width) > 2) out.push(src); img.srcset = ss; img.src = src; }
    return out; }).catch(() => []);
}
// text under the floating help button, at the top and at the very bottom
async function helpCover(page) {
  const at = async (where) => page.evaluate((where) => { const host = document.getElementById("encoreHelp"), b = host?.shadowRoot?.querySelector(".eh-btn"); if (!b) return null; const cs = getComputedStyle(b);
    if (cs.display === "none" || cs.visibility === "hidden" || b.classList.contains("eh-away")) return null; const br = b.getBoundingClientRect(); if (br.width < 2) return null; const hits = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.nodeValue.trim() || host.contains(n) || n.parentElement?.closest("script,style,[aria-hidden=true]")) continue; const pe = n.parentElement, pcs = getComputedStyle(pe); if (pcs.visibility === "hidden" || +pcs.opacity === 0) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) { if (r.right > br.left + 2 && r.left < br.right - 2 && r.bottom > br.top + 2 && r.top < br.bottom - 2) { hits.push(`${pe.tagName.toLowerCase()}${pe.className && typeof pe.className === "string" ? "." + pe.className.split(" ")[0] : ""} "${n.nodeValue.trim().slice(0, 40)}" (${where})`); break; } } if (hits.length > 2) break; }
    return hits; }, where).catch(() => null);
  const top = await at("at the top"); await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)).catch(() => {}); await page.waitForTimeout(350); const bottom = await at("at the bottom"); await page.evaluate(() => scrollTo(0, 0)).catch(() => {});
  return [...(top || []), ...(bottom || [])];
}

const browser = await pw.chromium.launch();
const results = [];
const dismiss = async (page) => { for (let i = 0; i < 3; i++) { const open = await page.evaluate(() => [...document.querySelectorAll("[role=dialog][aria-modal=true],dialog[open]")].some((d) => d.getBoundingClientRect().height > 40)).catch(() => false); if (!open) return;
  const x = page.locator('[role=dialog] [aria-label^="Close"], [role=dialog] button[aria-label*="close" i]').filter({ visible: true }).first(); if (await x.count()) await x.click({ timeout: 2000 }).catch(() => {}); else await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
for (const width of WIDTHS) {
  const ctxs = {};
  const ctxOf = async (role) => { if (ctxs[role]) return ctxs[role]; const dev = width <= 500 ? pw.devices["iPhone 13"] : { viewport: { width, height: 900 }, deviceScaleFactor: 1 };
    const ctx = await browser.newContext({ ...dev, viewport: { width, height: width <= 500 ? 844 : 900 }, serviceWorkers: "block" }); const c = roles[role]; if (c) { const [k, ...v] = c.split("="); await ctx.addCookies([{ name: k, value: v.join("="), url: base }]); }
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: "" })); return (ctxs[role] = ctx); };
  const todo = PAGES.filter((P) => (!ONLY || P.path.startsWith(ONLY)) && (!ROLE || P.as === ROLE));
  const one = async (P) => {
    const ctx = await ctxOf(P.as), page = await ctx.newPage(), rec = { page: P.path, as: P.as, width, findings: [] };
    try { await page.goto(base + P.path, { waitUntil: "load", timeout: 25000 }); await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {}); await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(/app=1/.test(P.path) ? 3200 : 1200); await dismiss(page); rec.url = page.url().slice(base.length);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, slug(P, width) + ".png"), fullPage: true, timeout: 20000 }).catch(() => page.screenshot({ path: path.join(SHOTS, slug(P, width) + ".png") }).catch(() => {})); }
      const imgProbe = await imageProbe(page);
      rec.findings = await page.evaluate(audit, { hostSurface: HOST_SURFACE.test(P.path), imgProbe }).catch((e) => [{ check: "error", el: "", issue: e.message.split("\n")[0], sev: "high" }]);
      for (const h of await helpCover(page)) rec.findings.push({ check: "help", el: h, issue: "text under the floating help button", sev: "medium" });
    } catch (e) { rec.findings.push({ check: "error", el: "", issue: "load: " + e.message.split("\n")[0], sev: "high" }); }
    await page.close(); results.push(rec);
    if (!QUIET) { const head = `${P.as.padEnd(5)} ${width} ${P.path}${rec.url && rec.url !== P.path ? `  (→ ${rec.url})` : ""}`; console.log(rec.findings.length ? head + "\n" + rec.findings.map((f) => `    ${f.sev.padEnd(6)} ${f.check.padEnd(8)} ${f.el}  ${f.issue}`).join("\n") : head + "  ok"); }
  };
  // three pages at a time, one role's context reused
  for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(one));
  for (const c of Object.values(ctxs)) await c.close();
}
await browser.close(); server.closeAllConnections?.(); server.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true });
const tally = {}; let n = 0; for (const r of results) for (const f of r.findings) { tally[f.check] = (tally[f.check] || 0) + 1; n++; }
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
console.log(`\n${n} finding${n === 1 ? "" : "s"} on ${results.length} page views: ` + (Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"));
process.exit(0);
