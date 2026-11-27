// Potto-led onboarding for vendors and small businesses (/onboard): a few questions, the host's own material
// (price sheets as PDF, past emails and quotes, a website or Instagram link, and Gmail when the server is set up
// for it) turned into draft packages the host reviews before anything goes on their page, then page suggestions
// and reminder settings. Drafts use Claude when the server has a key; otherwise (and in ENCORE_FAKE_AI=1) a
// deterministic parser reads prices, group sizes, lengths, lead times and lists straight from the host's words.
// Nothing here invents a fact: every price, size and line on a draft comes from what the host gave us.
import crypto from "node:crypto";
import zlib from "node:zlib";
import dns from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { complete, isFake, aiMode, parseJsonLoose } from "./ai.js";
import { scopeStore, getWorkspace, getDbUser, DEFAULT_WS } from "./workspaces.js";
import { cspWith } from "./posthog.js";
import { STORE } from "./community.js";
import { smsConfig, sendSms } from "./sms.js";
import { schedulePottoReminders, pottoSettings, cleanPottoSettings, runPottoReminders } from "./reminders.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "..", "public");
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, n);
const lines = (v, n, max) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => clean(x, n)).filter(Boolean).slice(0, max);
const int = (v, lo, hi, d) => { const x = Math.round(+v); return isFinite(x) && x > 0 ? Math.max(lo, Math.min(hi, x)) : d; };

// ---------------------------------------------------------------- reading the host's words ----------
const BULLET = /^\s*(?:[-*•·◦▪●–]|\d{1,2}[.)])\s+/;
const SHOW_LINE = /^\s*(?:[-+]?\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?|\+\d+\s*(?:days?|weeks?))\s+\S/i;
const PER_HEAD = /^\s*(?:\/|a|per|each)?\s*(?:person|head|guest|pp|attendee|participant|pax)\b|^\s*pp\b|^\s*per\s*person/i;
const EACH = /^\s*(?:\/|a|per|each)?\s*(?:each|ea\b|unit|box|bag|set|item|kit|tin|gift|piece|cup)\b/i;
const GIFT_WORDS = /\b(gifts?|gift sets?|boxe?s|box|bags?|blends?|tins?|kits?|hampers?|baskets?|ships?|shipping|shipped|units?|engrav\w*|merch|swag|per (?:unit|box|bag|set|item)|order(?:s)? of)\b/gi;
const EXP_WORDS = /\b(class(?:es)?|workshops?|bar|catering|cater\w*|tastings?|sessions?|tours?|dinners?|brunch|lunch(?:eon)?|guests?|people|team|attendees|a person|per person|per head|hours?|minutes?|mins?|pop-?up|stations?|demo|lesson|walk|run|hike|yoga)\b/gi;
const EMOJI = [[/coffee|phin|espresso|latte|cà phê|cafe|café/i, "☕"], [/matcha|tea\b/i, "🍵"], [/cocktail|wine|bar\b|drinks?/i, "🍸"], [/bánh|banh|sandwich|cart|pop-?up|food|catering|lunch/i, "🥖"], [/dinner|supper|tasting|omakase|chef/i, "🍽️"], [/cake|bake|pastr|cookie|bread/i, "🧁"], [/flower|bouquet|floral/i, "💐"], [/pottery|ceramic|clay/i, "🏺"], [/draw|paint|portrait|art/i, "🎨"], [/run|hike|walk|yoga|move/i, "🏃"], [/gift|box|set|kit/i, "🎁"], [/bean|blend|roast/i, "🫘"]];
const emojiFor = (s) => (EMOJI.find(([re]) => re.test(s)) || [null, "✨"])[1];
const CATS = [["workshop", /class|workshop|lesson|craft|make your|brew your|pottery|bouquet|candle/i], ["drinks", /coffee|phin|tea|matcha|latte|cocktail|wine|drinks?|espresso|bar\b/i], ["dining", /dinner|supper|tasting|omakase|chef's table|brunch/i], ["food", /catering|cater|lunch|food|cart|pop-?up|snack|bánh|banh/i], ["movement", /run|hike|yoga|walk|bike|climb|dance/i], ["culture", /art|draw|paint|music|dj|portrait|game|trivia|film/i]];
const categoryFor = (s) => (CATS.find(([, re]) => re.test(s)) || [""])[0];
const OCCASIONS = [["clients", /client|customer/i], ["holiday", /holiday|christmas|new year|tết|tet\b|season/i], ["newhire", /new hire|onboard|welcome/i], ["event", /event|launch|conference|booth/i], ["thanks", /thank/i]];
const money = (s) => { const m = String(s).match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/); return m ? { dollars: +m[1].replace(/,/g, ""), cents: Math.round(+m[1].replace(/,/g, "") * 100 + (m[2] ? +m[2].padEnd(2, "0") : 0)), index: m.index, len: m[0].length } : null; };
const fmt$ = (c) => "$" + (c % 100 ? (c / 100).toFixed(2) : (c / 100).toLocaleString("en-US"));

/** Group sizes said any common way: "8 to 25 people", "groups of 10-20", "min 40", "up to 300 guests". */
export function groupSize(t, { bare = false } = {}) {
  const s = String(t), o = {};
  const b = bare && s.match(/^\D{0,12}(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})\b/); if (b && +b[2] >= +b[1]) return { min: +b[1], max: +b[2] };
  const r = s.match(/(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})\s*(?:people|guests|persons|pax|attendees|ppl|folks|of you)/i) || s.match(/groups?\s+of\s+(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})/i) || s.match(/(?:between|from)\s+(\d{1,4})\s*(?:and|to|-)\s*(\d{1,4})/i);
  if (r && +r[2] >= +r[1]) { o.min = +r[1]; o.max = +r[2]; }
  const mn = s.match(/(?:min(?:imum)?\.?|at least)\s*(?:of\s*|is\s*)?(\d{1,4})/i); if (mn && o.min == null) o.min = +mn[1];
  const mx = s.match(/(?:up to|max(?:imum)?\.?|no more than|as many as|serves?)\s*(?:of\s*)?(\d{1,4})/i); if (mx && o.max == null) o.max = +mx[1];
  if (o.min == null && o.max == null) { const one = s.match(/\bfor\s+(\d{1,4})\s*(?:people|guests)/i); if (one) { o.max = +one[1]; o.single = true; } }
  return o;
}
export function lengthOf(t) { const m = String(t).match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h\b|minutes?|mins?)\b/i); if (!m) return ""; const u = /^m/i.test(m[3]) ? "minutes" : +m[1] === 1 && !m[2] ? "hour" : "hours"; return `${m[1]}${m[2] ? " to " + m[2] : ""} ${u}`; }
export function leadOf(t) { const s = String(t); const m = s.match(/(\d+)\s*(?:-|to)?\s*(\d+)?\s*(days?|weeks?|months?)\s*(?:of\s*)?(?:lead|notice|ahead|in advance|before|out|turnaround)/i) || s.match(/(?:lead(?:\s*time)?|notice|turnaround|order|book)\D{0,25}?(\d+)\s*(?:-|to)?\s*(\d+)?\s*(days?|weeks?|months?)/i); if (!m) return ""; const u = m[3].toLowerCase().replace(/s$/, ""); return `${m[1]}${m[2] ? " to " + m[2] : ""} ${u}${+(m[2] || m[1]) === 1 ? "" : "s"}`; }
/** Quantity price breaks: "50+ $40", "$35 each for 200+", "200 or more: $35". */
export function tiersOf(t) {
  const out = [], s = String(t);
  for (const m of s.matchAll(/(\d{1,5})\s*(?:\+|or more|and up|plus)\s*(?:units?|sets?|boxe?s|bags?|gifts?|pieces?|cups?)?\s*[:=@-]?\s*(?:at\s*)?\$\s?(\d+(?:\.\d{1,2})?)/gi)) out.push({ qty: +m[1], cents: Math.round(+m[2] * 100) });
  for (const m of s.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)\s*(?:each|ea|a set|a box|a bag|per \w+)?\s*(?:for|at|from)\s*(\d{1,5})\s*(?:\+|or more|and up|units|sets|boxes)/gi)) out.push({ qty: +m[2], cents: Math.round(+m[1] * 100) });
  return out.filter((x, i, A) => x.qty > 1 && x.cents > 0 && A.findIndex((y) => y.qty === x.qty) === i).sort((a, b) => a.qty - b.qty).slice(0, 4);
}
const travelsIn = (t) => /\b(we (?:travel|come to you|bring|deliver|cater)|come to your|on[- ]?site|at your (?:office|venue|event|space)|deliver(?:y|ed|s)?|travel(?:s|ing)? (?:to|anywhere|within|in)|anywhere in)\b/i.test(t);
const shipsLine = (t) => { const m = String(t).match(/\b((?:ships?|shipping|delivered|deliver(?:y|s)?)\b[^.\n]{0,70})/i); return m ? clean(m[1].replace(/^./, (c) => c.toUpperCase()), 80) : ""; };
const stripPrice = (s) => s.replace(/\s*[:–—-]?\s*\$\s?\d[\d,.]*.*$/, "").replace(/\s*\((?:[^)]*\$[^)]*)\)\s*$/, "");
const nameFrom = (line) => clean(stripPrice(line.replace(BULLET, "").replace(/^#+\s*/, "").replace(/\*\*/g, "")).replace(/[:.\s]+$/, ""), 70);

/** Plain text from an .eml or a pasted email: the subject plus the plain-text part, quoted replies and signatures cut. */
export function emlToText(raw) {
  let s = String(raw || "").replace(/\r\n/g, "\n");
  const hdrEnd = s.search(/\n\n/), head = /^[A-Za-z-]+:/.test(s) && hdrEnd > 0 ? s.slice(0, hdrEnd) : "", body = head ? s.slice(hdrEnd + 2) : s;
  const subject = (head.match(/^Subject:\s*(.*(?:\n[ \t].*)*)/im) || [])[1] || "";
  let text = body; const bnd = (head.match(/boundary="?([^";\n]+)"?/i) || [])[1];
  const decode = (part, h) => { if (/base64/i.test(h)) { try { return Buffer.from(part.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return part; } }
    if (/quoted-printable/i.test(h)) return Buffer.from(part.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))), "latin1").toString("utf8"); return part; };
  if (bnd) { const parts = body.split("--" + bnd).map((p) => p.replace(/^\n/, "")).filter((p) => p.trim() && !p.startsWith("--")); let best = "";
    for (const p of parts) { const e = p.search(/\n\n/), h = e > 0 ? p.slice(0, e) : "", b = e > 0 ? p.slice(e + 2) : p; if (/text\/plain/i.test(h)) { best = decode(b, h); break; } if (!best && /text\/html/i.test(h)) best = htmlToText(decode(b, h)); }
    text = best || body; } else text = decode(body, head);
  const out = []; for (const l of text.split("\n")) { if (/^--\s*$/.test(l) || /^On .{6,80} wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l)) break; if (/^\s*>/.test(l)) continue; out.push(l); }
  const subj = clean(subject.replace(/\n[ \t]+/g, " ").replace(/=\?utf-8\?[bq]\?([^?]*)\?=/gi, (_, x) => { try { return Buffer.from(x, "base64").toString("utf8"); } catch { return x; } }), 200);
  return ((subj ? "Subject: " + subj + "\n\n" : "") + out.join("\n")).trim().slice(0, 60000);
}
export function htmlToText(h) {
  return String(h || "").replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l, i, A) => l || (A[i - 1] || "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const looksLikeHeading = (l) => { if (BULLET.test(l) || SHOW_LINE.test(l) || /^\s/.test(l) || l.length > 90 || !/^[A-Z0-9"'“]/.test(l.trim())) return false; const m = money(l); if (!m || m.index < 3) return false; const nm = nameFrom(l); return !!nm && nm.split(" ").length <= 8 && !/[.!?]/.test(nm) && !/\b(min(?:imum)?|order|groups?|up to)\b/i.test(nm); };
function splitBlocks(text) {
  const L = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  const blocks = []; let cur = [];
  const push = () => { if (cur.some((x) => x.trim())) blocks.push(cur); cur = []; };
  for (const l of L) {
    if (!l.trim()) { push(); continue; }
    // a heading-like line that carries its own price starts a new block even without a blank line ("Phin class: $55 a person")
    if (cur.length && looksLikeHeading(l)) push();
    cur.push(l);
  }
  push(); return blocks;
}

function draftFromBlock(blk, label, { email = false, answers = null } = {}) {
  const text = blk.join("\n"), flat = blk.join(" "), m = money(flat), g = groupSize(flat), len = lengthOf(flat), lead = leadOf(flat), tiers = tiersOf(flat);
  if (!m && g.min == null && g.max == null && !len && !tiers.length && !/\b(?:to be quoted|on request|custom pricing)\b/i.test(flat)) return null;
  const giftScore = (flat.match(GIFT_WORDS) || []).length + (m && EACH.test(flat.slice(m.index + m.len, m.index + m.len + 20)) ? 2 : 0) + (tiers.length ? 2 : 0);
  const expScore = (flat.match(EXP_WORDS) || []).length + (m && PER_HEAD.test(flat.slice(m.index + m.len, m.index + m.len + 20)) ? 3 : 0) + (len ? 2 : 0);
  const gift = giftScore > expScore;
  // the name: the first line, unless it's a greeting or a whole sentence; then "the X is $N" in the prose
  let name = "", rest = blk.slice();
  const firstLine = (rest[0] || "").trim();
  if (/^subject:/i.test(firstLine)) rest.shift();
  const subj = /^subject:/i.test(firstLine) ? firstLine.replace(/^subject:\s*/i, "").replace(/^(?:(?:re|fwd?|fw)\s*:\s*)+/i, "").replace(/^(?:quote|pricing|prices|proposal|estimate|inquiry)\s*(?:for|:)\s*/i, "") : "";
  const head = (rest[0] || "").trim();
  if (head && head.length <= 90 && !/^(hi|hello|hey|dear|thanks|thank you)\b/i.test(head) && !/[.!?]$/.test(stripPrice(head).trim()) && nameFrom(head).split(" ").length <= 10 && nameFrom(head) && !/\b(?:is|are|costs?|runs?|would be|comes to|starts at|at|for|from|was|will be)$/i.test(nameFrom(head))) { name = nameFrom(head); rest = rest.slice(1); }
  if (!name) { const p = flat.match(/\b(?:the|our|a|an)\s+([A-Za-zÀ-ỹ][\wÀ-ỹ'’&-]*(?:\s+[A-Za-zÀ-ỹ][\wÀ-ỹ'’&-]*){0,5}?)\s+(?:is|are|runs|costs|would be|comes to|starts at|at|for)\s+\$/i); if (p) name = clean(p[1].replace(/^./, (c) => c.toUpperCase()), 70); }
  if (!name && subj) name = clean(subj.replace(/\s+(?:at|for)\s+[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*)*.*$/, ""), 70);
  const includes = [], show = [], prose = [], personalize = [];
  let inIncludes = false;
  for (const raw of rest) { const l = raw.trim(); if (!l) continue;
    if (SHOW_LINE.test(l)) { show.push(clean(l.replace(BULLET, ""), 90)); continue; }
    const inc = l.match(/^(?:includes?|what's included|you get|comes with|in the box)\s*:?\s*(.*)$/i);
    if (inc) { inIncludes = true; if (inc[1]) includes.push(...inc[1].split(/,|;|\band\b/).map((x) => clean(x, 80)).filter((x) => x.length > 1)); continue; }
    if (BULLET.test(l) || inIncludes && l.length < 90) { const item = clean(l.replace(BULLET, ""), 80); if (/your logo|engrav|their name|your label|your note|your colou?rs|your sleeve|custom|personali[sz]/i.test(item) && gift) personalize.push(clean(item, 50)); else if (!/^\$/.test(item)) includes.push(item); continue; }
    inIncludes = false; if (/^(hi|hello|hey|dear)\b.{0,40},?$/i.test(l) || /^(thanks|thank you|best|cheers|warmly|regards)[,!.]?$/i.test(l)) continue; prose.push(l); }
  const desc = email || answers ? "" : clean(prose.join(" ").replace(/\s+/g, " ").replace(/^(?:(?:thanks|thank you|great to hear|hope you|happy to|so excited|lovely to)[^.!?]*[.!?]\s*)+/i, ""), 280);
  const em = emojiFor(name || flat), emoji = em === "✨" && answers?.sell ? emojiFor(answers.sell) : em;
  const missing = [];
  if (!name) { name = "New package"; missing.push("name"); }
  const quoted = /\bquoted?\b|on request|varies|custom pricing/i.test(flat) && !m;
  if (gift) {
    const tierMin = tiers.length ? tiers[0] : null, cents = m ? (tierMin && m.cents === tierMin.cents && tiers.length > 1 ? Math.max(...tiers.map((t) => t.cents)) : m.cents) : 0;
    const mq = flat.match(/(?:min(?:imum)?\.?\s*(?:order|of|qty|quantity)?\s*(?:is\s*)?|at least\s*)(\d{1,5})/i), maxq = flat.match(/(?:up to|max(?:imum)?\.?\s*(?:order|of)?\s*)(\d{1,5})\s*(?:units|sets|boxes|bags|gifts|pieces)?/i);
    if (!cents) missing.push("price"); if (!lead) missing.push("lead");
    return { kind: "gift", d: { name, desc, emoji, cents, minQty: mq ? +mq[1] : 1, maxQty: maxq ? +maxq[1] : 200, tiers: tiers.filter((t) => t.cents !== cents), lead, ships: shipsLine(flat), personalize: personalize.slice(0, 6), occasions: OCCASIONS.filter(([, re]) => re.test(flat)).map(([k]) => k), allIn: "", _from: label || "", _missing: missing } };
  }
  const per = m && PER_HEAD.test(flat.slice(m.index + m.len, m.index + m.len + 24));
  const price = m ? (per ? `${fmt$(m.cents)} a person` : /\b(?:flat|total|package|for the (?:bar|day|event))\b/i.test(flat.slice(m.index + m.len, m.index + m.len + 30)) ? `${fmt$(m.cents)} flat` : /\bfrom\s*$/i.test(flat.slice(Math.max(0, m.index - 6), m.index)) ? `From ${fmt$(m.cents)}` : fmt$(m.cents)) : quoted ? "To be quoted" : "";
  if (!price) missing.push("price"); if ((g.min == null && g.max == null) || g.single) missing.push("size"); if (!len) missing.push("length");
  const minv = g.min ?? (g.max ? 1 : 1), maxv = g.max ?? (g.min ? Math.max(g.min, g.min * 4) : 20);
  return { kind: "exp", d: { name, desc: clean(desc + (lead && !/notice|ahead|advance/i.test(desc) ? ` Book ${lead} ahead.` : ""), 280), emoji, min: minv, max: Math.max(minv, maxv), price, length: len, category: categoryFor(name) || categoryFor(flat), travels: travelsIn(flat), includes: includes.slice(0, 8), runOfShow: show.slice(0, 8), allIn: "", _from: label || "", _missing: missing } };
}

const GREETING = /^(hi|hello|hey|dear|thanks|thank you|best|cheers|warmly|regards|talk soon|sent from my \w+)\b[^.!?]{0,40}[,!.]?$/i;
const key = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\b(the|a|an|our|your|for|with|and)\b/g, "").replace(/\s+/g, " ").trim();
const GENERIC = new Set(["for", "at", "the", "a", "an", "your", "our", "team", "client", "launche", "launch", "office", "people", "event", "with", "and", "of", "to", "in", "custom", "private", "corporate", "brand", "compan", "company", "day", "new"]);
const nouns = (s) => key(s).split(" ").map((w) => w.replace(/(?:es|s)$/, "")).filter((w) => w.length > 2 && !GENERIC.has(w));
const sharesNoun = (a, b) => { const B = new Set(nouns(b)); return nouns(a).some((w) => B.has(w)); };
function mergeInto(list, d) {
  const k = key(d.name), hit = list.find((x) => key(x.name) === k || (k.length > 6 && (key(x.name).includes(k) || k.includes(key(x.name)))));
  if (!hit) { list.push(d); return; }
  for (const [f, v] of Object.entries(d)) { if (f === "_missing" || f === "_from") continue; const cur = hit[f]; const empty = cur == null || cur === "" || (Array.isArray(cur) && !cur.length) || (f === "cents" && !cur);
    if (empty && v != null && v !== "" && !(Array.isArray(v) && !v.length)) hit[f] = v; }
  hit._from = [...new Set([hit._from, d._from].filter(Boolean))].join(", ");
  hit._missing = (hit._missing || []).filter((m) => (d._missing || []).includes(m) && !(m === "price" && (hit.price || hit.cents)) && !(m === "length" && hit.length) && !(m === "lead" && hit.lead));
}

/** Read one piece of material (a price sheet, an email, a page) into draft experiences and gift sets. */
export function parseMaterial(text, label = "", opts = {}) {
  const exps = [], gifts = [];
  const t = /^[A-Za-z-]+:.*\n(?:[A-Za-z-]+:.*\n)*\n/.test(String(text || "")) && /^(from|to|subject|date|received|mime-version|content-type):/im.test(text) ? emlToText(text) : String(text || "");
  const email = opts.email ?? t !== String(text || ""); let subject = "";
  const signals = (b) => { const f = b.join(" "); return !!(money(f) || lengthOf(f) || tiersOf(f).length || groupSize(f).min != null); };
  for (const b of splitBlocks(t)) { if (/^subject:/i.test(b[0] || "")) { subject = b[0]; if (b.length === 1) continue; b.shift(); }
    if (b.every((l) => GREETING.test(l.trim()) || /^[A-Z][a-z]+$/.test(l.trim()))) continue;
    const r = draftFromBlock(subject && signals(b) ? [subject, ...b] : b, label, { email }); if (r && subject) subject = ""; if (!r) continue; mergeInto(r.kind === "gift" ? gifts : exps, r.d); }
  return { experiences: exps, gifts };
}

/** The answers to Potto's questions, as drafts: one per thing brands ask for, with the prices matched by name. */
export function answersToDrafts(a = {}) {
  const exps = [], gifts = [];
  const asks = clean(a.asks, 2000) || clean(a.sell, 2000); if (!asks) return { experiences: exps, gifts };
  const items = asks.replace(/\b(?:they|brands|companies|people|clients)\s+(?:ask|want|book|order|request)\s+(?:us\s+)?(?:for\s+)?/gi, "").split(/[,;\n]|\band\b|\bor\b|\bplus\b/i).map((x) => x.replace(/^\s*(?:mostly|usually|a lot of|lots of|some|also|sometimes)\s+/i, "").replace(/[.!]+$/, "").trim()).filter((x) => x.length > 2 && x.split(" ").length <= 9).slice(0, 8);
  const clauses = String(a.prices || "").split(/[;\n]|,(?!\d{3})|\.\s/).map((s) => s.trim()).filter((s) => money(s));
  const g = groupSize(a.groups || "", { bare: true }), lead = leadOf(a.lead || "") || (/\d/.test(a.lead || "") ? clean(a.lead, 40) : ""), trav = clean(a.travel, 120), travels = !!trav && !/^(no|nope|we don'?t|don'?t|not really|only (?:at|in) (?:the )?shop)\b/i.test(trav);
  items.forEach((it, i) => {
    const words = key(it).split(" ").filter((w) => w.length > 2), best = clauses.map((c) => ({ c, n: words.filter((w) => key(c).includes(w)).length })).sort((x, y) => y.n - x.n)[0];
    const clause = best && best.n ? best.c : clauses.length === items.length ? clauses[i] : clauses.length === 1 && items.length === 1 ? clauses[0] : "";
    const r = draftFromBlock([it[0].toUpperCase() + it.slice(1), ...(clause ? [clause] : []), ...(g.min != null || g.max != null ? [a.groups] : []), ...(lead ? [`${lead} notice`] : []), ...(travels ? [`We travel to ${trav}`] : [])], "your answers", { answers: a });
    if (!r) { exps.push({ name: clean(it[0].toUpperCase() + it.slice(1), 70), desc: "", emoji: emojiFor(it), min: g.min || 1, max: g.max || Math.max(g.min || 1, 20), price: "", length: lengthOf(a.groups || ""), category: categoryFor(it), travels, includes: [], runOfShow: [], allIn: "", _from: "your answers", _missing: ["price", ...(g.min == null && g.max == null ? ["size"] : []), "length"] }); return; }
    if (r.kind === "gift" && travels && !r.d.ships) r.d.ships = clean(`Delivered in ${trav}`, 80);
    (r.kind === "gift" ? gifts : exps).push(r.d);
  });
  return { experiences: exps, gifts };
}

/** Fill gaps the material left with what the host said in the answers (group sizes, travel, lead time). */
function applyAnswers(D, a = {}) {
  const g = groupSize(a.groups || "", { bare: true }), lead = leadOf(a.lead || "") || (/^\s*\d+\s*(?:days?|weeks?|months?)\s*$/i.test(a.lead || "") ? clean(a.lead, 40) : ""), trav = clean(a.travel, 120), travels = !!trav && !/^(no|nope|we don'?t|don'?t|not really)\b/i.test(trav);
  for (const x of D.experiences) { if ((x._missing || []).includes("size") && (g.min != null || g.max != null)) { x.min = g.min || 1; x.max = Math.max(x.min, g.max || x.min * 4); x._missing = x._missing.filter((m) => m !== "size"); } if (travels && !x.travels) x.travels = true; }
  for (const x of D.gifts) { if (!x.lead && lead) { x.lead = lead; x._missing = (x._missing || []).filter((m) => m !== "lead"); } if (travels && !x.ships && /deliver|ship/i.test(trav)) x.ships = clean(trav, 80); }
  return D;
}

/** Make every draft fit what the page accepts (the same limits as setProfile), and keep the review hints. */
export function normalizeDrafts(D = {}) {
  const exps = (Array.isArray(D.experiences) ? D.experiences : []).slice(0, 6).map((x) => { const min = int(x.min, 1, 500, 1); return { ...(/^[a-z0-9]{6,12}$/.test(x.id || "") ? { id: x.id } : {}), name: clean(x.name, 70), desc: clean(x.desc, 280), emoji: clean(x.emoji, 16) || emojiFor(x.name || ""), min, max: Math.max(min, int(x.max, 1, 1000, 20)), price: clean(x.price, 50), length: clean(x.length, 40), category: ["food", "dining", "movement", "workshop", "drinks", "culture"].includes(x.category) ? x.category : categoryFor(`${x.name} ${x.desc}`), travels: !!x.travels, includes: lines(x.includes, 80, 8), runOfShow: lines(x.runOfShow, 90, 8), allIn: clean(x.allIn, 140), ...(x.photo ? { photo: x.photo } : {}), ...(x.instant ? { instant: true } : {}), _from: clean(x._from, 80), _missing: (Array.isArray(x._missing) ? x._missing : []).filter((m) => typeof m === "string").slice(0, 6) }; }).filter((x) => x.name);
  const gifts = (Array.isArray(D.gifts) ? D.gifts : []).slice(0, 8).map((x) => { const minQty = int(x.minQty, 1, 5000, 1); return { ...(/^[a-z0-9]{6,12}$/.test(x.id || "") ? { id: x.id } : {}), name: clean(x.name, 70), desc: clean(x.desc, 280), emoji: clean(x.emoji, 16) || emojiFor(x.name || ""), cents: Math.max(0, Math.min(100000, Math.round(+x.cents || 0))), minQty, maxQty: Math.max(minQty, int(x.maxQty, 1, 20000, 200)), tiers: (Array.isArray(x.tiers) ? x.tiers : []).map((t) => ({ qty: Math.round(+t?.qty || 0), cents: Math.round(+t?.cents || 0) })).filter((t) => t.qty > 1 && t.cents > 0).sort((a, b) => a.qty - b.qty).slice(0, 4), lead: clean(x.lead, 40), ships: clean(x.ships, 80), allIn: clean(x.allIn, 140), personalize: lines(x.personalize, 50, 6), occasions: (Array.isArray(x.occasions) ? x.occasions : []).filter((o) => ["clients", "newhire", "holiday", "event", "thanks"].includes(o)).slice(0, 5), ...(x.photo ? { photo: x.photo } : {}), _from: clean(x._from, 80), _missing: (Array.isArray(x._missing) ? x._missing : []).filter((m) => typeof m === "string").slice(0, 6) }; }).filter((x) => x.name);
  return { experiences: exps, gifts };
}
const stripHints = (L) => L.map(({ _from, _missing, ...x }) => x);

/** Drop any price the model gave that isn't written in the host's own material: Potto never invents a price. */
export function keepOnlyStatedPrices(D, corpus) {
  const nums = new Set([...String(corpus).replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => String(+m[0])));
  const has = (n) => nums.has(String(+n));
  for (const x of D.experiences) { const m = money(x.price); if (m && !has(m.cents / 100)) { x.price = ""; x._missing = [...new Set([...(x._missing || []), "price"])]; } }
  for (const x of D.gifts) { if (x.cents && !has(x.cents / 100)) { x.cents = 0; x._missing = [...new Set([...(x._missing || []), "price"])]; } x.tiers = (x.tiers || []).filter((t) => has(t.cents / 100) && has(t.qty)); }
  return D;
}

const DRAFT_PROMPT = (a, corpus) => `You help a small business (a coffee shop, caterer, baker, workshop teacher) list what brands can book from them on Pottery Lab.
From the owner's answers and their own material below, write draft packages.

Rules:
- Use only facts written below. Never invent a price, a group size, a length, a lead time, an ingredient or a client.
- If a fact is missing, leave that field empty ("" or 0) and add its name to "_missing" (one of: price, size, length, lead).
- Experiences are things brands book for a group (a coffee bar at an event, a class for a team). Gift sets are things brands order in quantity (gift boxes, co-branded bags).
- Prices on experiences read like "$12 a person", "$1,800 flat", "From $400" or "To be quoted". Gift prices are whole cents per unit, with quantity tiers if stated.
- Plain, warm words. No em dashes. At most 6 experiences and 8 gift sets.

Reply with only JSON:
{"experiences":[{"name":"","desc":"","emoji":"","min":0,"max":0,"price":"","length":"","category":"food|dining|movement|workshop|drinks|culture","travels":false,"includes":[""],"runOfShow":["0:00 ..."],"allIn":"","_missing":[]}],
 "gifts":[{"name":"","desc":"","emoji":"","cents":0,"minQty":0,"maxQty":0,"tiers":[{"qty":0,"cents":0}],"lead":"","ships":"","personalize":[""],"occasions":["clients|newhire|holiday|event|thanks"],"_missing":[]}]}

Owner's answers:
${Object.entries(a).filter(([, v]) => clean(v)).map(([k, v]) => `- ${k}: ${clean(v, 1500)}`).join("\n") || "(none)"}

Their material:
${corpus || "(none)"}`;

/** Everything the host gave us, as drafts. Claude when the server has a key; the parser otherwise or if Claude fails. */
export async function makeDrafts({ answers = {}, material = [] } = {}) {
  const mats = (Array.isArray(material) ? material : []).slice(0, 20).map((m) => ({ label: clean(m?.label, 80) || "your material", text: String(m?.text || "").slice(0, 60000) })).filter((m) => m.text.trim());
  const fallback = () => { const D = { experiences: [], gifts: [] };
    for (const m of mats) { const r = parseMaterial(m.text, m.label); r.experiences.forEach((x) => mergeInto(D.experiences, x)); r.gifts.forEach((x) => mergeInto(D.gifts, x)); }
    // what they said in the answers and what their material says are often the same package ("coffee bars at launches" and
    // "Phin coffee bar"): fold an answer into the material's draft when they share a word that names the thing
    const A = answersToDrafts(answers); for (const kind of ["experiences", "gifts"]) for (const x of A[kind]) { const hit = D[kind].find((y) => sharesNoun(x.name, y.name)); if (hit) { const save = hit.name; mergeInto([hit], { ...x, name: save }); } else mergeInto(D[kind], x); }
    return normalizeDrafts(applyAnswers(D, answers)); };
  if (isFake() || aiMode() !== "live") return { ...fallback(), source: "parser" };
  const corpus = mats.map((m) => `--- ${m.label} ---\n${m.text}`).join("\n\n").slice(0, 80000);
  try { const r = await complete({ prompt: DRAFT_PROMPT(answers, corpus), effort: "low" }); const j = parseJsonLoose(r.text);
    const D = keepOnlyStatedPrices(normalizeDrafts(j), corpus + "\n" + Object.values(answers).join("\n")); if (!D.experiences.length && !D.gifts.length) return { ...fallback(), source: "parser" };
    for (const x of [...D.experiences, ...D.gifts]) x._from = x._from || "Potto"; return { ...D, source: "ai" };
  } catch (e) { console.warn("[onboard] drafting with Claude failed, using the parser:", e?.message || e?.code || e); return { ...fallback(), source: "parser" }; }
}

// ---------------------------------------------------------------- page suggestions ----------
const LOOKS = [
  [/coffee|phin|espresso|roast|café|cafe|cà phê/i, { accent: "#C2553A", cover: "wash", font: "bold", bg: "cream", avatarArt: "barista" }],
  [/matcha|tea\b|plant|garden|herb|vegan|sage/i, { accent: "#3E9C6E", cover: "waves", font: "modern", bg: "sage", avatarArt: "" }],
  [/bake|cake|pastr|cookie|bread|dessert|sweet/i, { accent: "#E26D8E", cover: "dots", font: "playful", bg: "blush", avatarArt: "baker" }],
  [/flower|floral|bouquet|wedding/i, { accent: "#E26D8E", cover: "sunrise", font: "editorial", bg: "blush", avatarArt: "florist" }],
  [/cocktail|wine|bar\b|night|dj|music/i, { accent: "#8C62C9", cover: "dusk", font: "bold", bg: "night", avatarArt: "" }],
  [/dinner|supper|chef|tasting|omakase|kitchen/i, { accent: "#E0A030", cover: "wash", font: "editorial", bg: "cream", avatarArt: "chef" }],
  [/pottery|ceramic|clay|craft|art|draw|paint/i, { accent: "#2F7A8A", cover: "confetti", font: "handmade", bg: "white", avatarArt: "" }],
  [/run|hike|yoga|move|fitness|walk/i, { accent: "#5B7FD6", cover: "sunrise", font: "modern", bg: "white", avatarArt: "runner" }],
];
const sentence1 = (s) => clean((String(s || "").match(/^[^.!?\n]{8,140}[.!?]?/) || [""])[0], 140);
/** Suggestions for the page, from what the host told us. Each one is the host's own facts, never new ones. */
export function suggestPage({ host = {}, answers = {}, drafts = {} } = {}) {
  const exps = drafts.experiences || [], gifts = drafts.gifts || [], all = [...exps, ...gifts];
  const words = [answers.sell, answers.asks, host.bio, host.tagline, ...all.map((x) => `${x.name} ${x.desc}`)].join(" ");
  const look = (LOOKS.find(([re]) => re.test(words)) || [null, { accent: "#C2553A", cover: "wash", font: "classic", bg: "cream", avatarArt: "" }])[1];
  const place = clean(host.hood || host.city, 60), names = all.map((x) => x.name.replace(/^(?:a|an|the|our)\s+/i, "")).filter(Boolean);
  const list = (L) => (L.length <= 1 ? L.join("") : L.slice(0, -1).join(", ") + " and " + L[L.length - 1]);
  const said = sentence1(answers.sell);
  const tagline = clean(said ? said.replace(/^(?:we|i)\s+(?:sell|make|run|are|do|have)\s+/i, (m) => "").replace(/^./, (c) => c.toUpperCase()).replace(/[.!?]?$/, ".") + (place && !said.toLowerCase().includes(place.toLowerCase()) ? ` ${place}.` : "") : names.length ? `${list(names.slice(0, 3).map((n, i) => (i ? n.charAt(0).toLowerCase() + n.slice(1) : n)))}.${place ? ` ${place}.` : ""}` : "", 140);
  const bioBits = [clean(answers.sell, 240).replace(/([^.!?])$/, "$1."), names.length ? `Brands book us for ${list(names.slice(0, 4).map((n) => n.charAt(0).toLowerCase() + n.slice(1)))}.` : "", answers.travel && !/^(no|nope|we don'?t)/i.test(answers.travel) ? `We travel to ${clean(answers.travel, 100).replace(/[.!]$/, "")}.` : ""].filter((x) => x && x !== ".");
  const bio = clean(bioBits.join(" "), 400);
  return { tagline: tagline && tagline !== host.tagline ? tagline : "", bio: bio && bio !== host.bio ? bio : "", accent: look.accent, cover: look.cover, font: look.font, bg: look.bg, avatarArt: look.avatarArt, emoji: emojiFor(words), why: { look: "Picked from what you make." } };
}

// ---------------------------------------------------------------- PDFs without a library ----------
// Browsers read PDFs with pdf.js from cdnjs. This server reader is the fallback when that can't load (offline, a
// blocked CDN): it inflates the content streams and reads the text operators, using each font's ToUnicode map.
function pdfString(s) { let o = ""; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c !== "\\") { o += c; continue; } const n = s[++i];
    if (n === "n") o += "\n"; else if (n === "r") o += ""; else if (n === "t") o += " "; else if (n === "b" || n === "f") o += ""; else if (/[0-7]/.test(n)) { let d = n; while (d.length < 3 && /[0-7]/.test(s[i + 1])) d += s[++i]; o += String.fromCharCode(parseInt(d, 8)); } else if (n === "\n" || n === "\r") {} else o += n; } return o; }
function parseCmap(t) { const map = new Map(); const hex = (h) => parseInt(h, 16); const uni = (h) => { let s = ""; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4))); return s || String.fromCharCode(hex(h)); };
  for (const blk of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(hex(m[1]), uni(m[2]));
  for (const blk of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) { const a = hex(m[1]), b = hex(m[2]);
    if (m[4] != null) { const base = hex(m[4]); for (let c = a; c <= b && c - a < 5000; c++) map.set(c, String.fromCharCode(base + c - a)); } else { const L = [...m[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => uni(x[1])); L.forEach((u, i) => map.set(a + i, u)); } }
  const wide = /<[0-9A-Fa-f]{4}>\s*<[0-9A-Fa-f]{4}>\s*endcodespacerange|begincodespacerange\s*<0000>/.test(t); return { map, wide }; }
function a85(s) { s = s.replace(/^<~/, "").replace(/~>[\s\S]*$/, "").replace(/\s+/g, ""); const out = []; let g = [];
  const emit = (grp, n) => { let v = 0; for (let i = 0; i < 5; i++) v = v * 85 + ((grp[i] ?? 84)); for (let i = 3; i >= 4 - n; i--) out.push((v >>> (8 * i)) & 255); };
  for (const ch of s) { if (ch === "z" && !g.length) { out.push(0, 0, 0, 0); continue; } g.push(ch.charCodeAt(0) - 33); if (g.length === 5) { emit(g, 4); g = []; } }
  if (g.length) emit(g, g.length - 1); return Buffer.from(out); }
export function pdfText(buf) {
  const bin = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf || ""); if (!bin.startsWith("%PDF")) throw { code: "invalid", message: "That file isn't a PDF." };
  const objs = new Map(), streams = [];
  const re = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g; let m;
  while ((m = re.exec(bin))) { const id = +m[1], body = m[3]; const sm = body.match(/^([\s\S]*?)stream\r?\n/); let dict = body, data = null;
    if (sm) { dict = sm[1]; const start = sm[0].length, end = body.lastIndexOf("endstream"); let raw = body.slice(start, end >= 0 ? end : undefined).replace(/\r?\n$/, ""); const b = Buffer.from(raw, "latin1");
      const filters = [...(dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] || "").matchAll(/\/(\w+)/g)].map((x) => x[1]); let cur = b;
      try { for (const f of filters) { if (f === "ASCII85Decode" || f === "A85") cur = a85(cur.toString("latin1")); else if (f === "ASCIIHexDecode" || f === "AHx") cur = Buffer.from(cur.toString("latin1").replace(/[^0-9A-Fa-f]/g, ""), "hex"); else if (f === "FlateDecode" || f === "Fl") { try { cur = zlib.inflateSync(cur); } catch { cur = zlib.inflateSync(cur, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } } else throw 0; } data = cur.toString("latin1"); } catch { data = null; } }
    objs.set(id, { dict, data }); if (data != null && !/\/(Image|XRef|ObjStm|Metadata|FontFile)/.test(dict) && !/\/Length1/.test(dict)) streams.push({ id, data }); }
  // fonts: resource name (/F1) -> ToUnicode map
  const fonts = new Map();
  const fontDicts = []; for (const [, o] of objs) { for (const fm of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) fontDicts.push(fm[1]); for (const fr of o.dict.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g)) { const d = objs.get(+fr[1])?.dict; if (d) fontDicts.push(d); } }
  for (const fd of fontDicts) for (const f of fd.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) { const fo = objs.get(+f[2]); const tu = fo?.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/); const cm = tu && objs.get(+tu[1])?.data; if (cm) fonts.set(f[1], parseCmap(cm)); else if (!fonts.has(f[1])) fonts.set(f[1], null); }
  const pages = (bin.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  let out = "";
  for (const s of streams) { if (!/\bBT\b/.test(s.data)) continue; let font = null, line = "";
    const flush = () => { if (line.trim()) out += line.replace(/\s+$/, "") + "\n"; line = ""; };
    const dec = (raw, hexy) => { if (hexy) { const h = raw.replace(/\s+/g, ""); if (font?.map?.size) { const w = font.wide || h.length % 4 === 0 && /^00/.test(h) ? 4 : 2; let r = ""; for (let i = 0; i < h.length; i += w) { const c = parseInt(h.slice(i, i + w), 16); r += font.map.get(c) ?? (w === 2 ? String.fromCharCode(c) : ""); } return r; }
        let r = ""; for (let i = 0; i < h.length; i += 2) r += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)); return r; }
      const t = pdfString(raw); if (font?.map?.size) return [...t].map((ch) => font.map.get(ch.charCodeAt(0)) ?? ch).join(""); return t; };
    const tok = /\/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf|\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[|\]|-?\d*\.?\d+|T\*|Tj|TJ|'|"|Td|TD|Tm|ET|BT/g; let t, inArr = false, lastNums = [];
    while ((t = tok.exec(s.data))) { const v = t[0];
      if (t[1]) { font = fonts.get(t[1]) || null; continue; }
      if (v[0] === "(") { line += dec(v.slice(1, -1), false); continue; } if (v[0] === "<") { line += dec(v.slice(1, -1), true); continue; }
      if (v === "[") { inArr = true; continue; } if (v === "]") { inArr = false; continue; }
      if (/^-?\d*\.?\d+$/.test(v)) { if (inArr && +v < -180) line += " "; else lastNums.push(+v); if (lastNums.length > 6) lastNums.shift(); continue; }
      if (v === "Td" || v === "TD") { const dy = lastNums[lastNums.length - 1] || 0, dx = lastNums[lastNums.length - 2] || 0; if (Math.abs(dy) > 0.5) flush(); else if (dx > 1 && line && !/\s$/.test(line)) line += " "; }
      else if (v === "Tm") { flush(); } else if (v === "T*" || v === "'" || v === '"') flush(); else if (v === "ET") flush();
      lastNums = []; }
    flush(); out += "\n"; }
  const text = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text: text.slice(0, 60000), pages };
}

// ---------------------------------------------------------------- reading a public link ----------
const PRIVATE4 = [["10.0.0.0", 8], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["0.0.0.0", 8], ["100.64.0.0", 10], ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]];
const ip4n = (ip) => ip.split(".").reduce((a, b) => (a << 8) + +b, 0) >>> 0;
export function privateAddress(ip) { if (net.isIPv4(ip)) return PRIVATE4.some(([b, n]) => (ip4n(ip) >>> (32 - n)) === (ip4n(b) >>> (32 - n))); const v = ip.toLowerCase(); if (v.startsWith("::ffff:")) return privateAddress(v.slice(7)); return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v); }
async function safeUrl(u) { let x; try { x = new URL(String(u).trim()); } catch { return null; } if (x.protocol !== "https:" || x.username || x.password || (x.port && x.port !== "443")) return null; const h = x.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(h) || /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(h) || !h.includes(".")) return null;
  try { const A = await dns.lookup(h, { all: true }); if (!A.length || A.some((a) => privateAddress(a.address))) return null; } catch { return null; } return x; }
export async function readLink(u, { limit = 1_500_000 } = {}) {
  // Instagram pages are never fetched (its terms forbid it): "Start from your Instagram" (server/igimport.js) uses the person's own account or their photos
  const igHost = (x) => /(^|\.)(instagram\.com|instagr\.am)$/i.test(x?.hostname || "");
  try { if (igHost(new URL(String(u || "").trim()))) return { ok: false, message: "I don't read Instagram pages. Use Start from your Instagram at /import/instagram instead.", instagram: true }; } catch {}
  let url = await safeUrl(u); if (!url) return { ok: false, message: "I can only read public https links." };
  if (igHost(url)) return { ok: false, message: "I don't read Instagram pages. Use Start from your Instagram at /import/instagram instead.", instagram: true };
  for (let hop = 0; hop < 4; hop++) { const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(url.href, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "PotteryLabBot/1.0 (+onboarding; reads a page the host shared)", accept: "text/html,text/plain" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = await safeUrl(new URL(r.headers.get("location"), url).href); if (!url || igHost(url)) return { ok: false, message: "That link redirects somewhere I can't read." }; continue; }
      if (!r.ok) return { ok: false, message: `That page answered ${r.status}. Paste the text instead.` };
      const reader = r.body.getReader(), chunks = []; let n = 0; for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > limit) { ctl.abort(); break; } chunks.push(value); }
      const html = Buffer.concat(chunks).toString("utf8"), meta = (p) => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, "i")) || [])[1] || "";
      const title = htmlToText(meta("og:title") || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || ""), about = htmlToText(meta("og:description") || meta("description"));
      const body = htmlToText((html.match(/<body[\s\S]*<\/body>/i) || [html])[0]).slice(0, 40000);
      return { ok: true, url: url.href, title: clean(title, 140), text: [title, about, body].filter(Boolean).join("\n\n").slice(0, 60000) };
    } catch { return { ok: false, message: "I couldn't reach that page. Paste the text instead." }; } finally { clearTimeout(timer); } }
  return { ok: false, message: "Too many redirects." };
}

// ---------------------------------------------------------------- Gmail (read-only, set up by the server owner) ----------
export function gmailConfig() { const e = process.env; return e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET ? { id: e.GOOGLE_CLIENT_ID, secret: e.GOOGLE_CLIENT_SECRET, redirect: e.GOOGLE_REDIRECT_URI || "" } : null; }
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_QUERY = "quote OR pricing OR catering OR invoice OR inquiry OR proposal newer_than:2y";

// ---------------------------------------------------------------- routes ----------
export function mountOnboard(app, { store, currentUser, C, sendStatic, publicOrigin = () => process.env.ENCORE_PUBLIC_URL || "", jobs = !process.env.NODE_TEST_CONTEXT }) {
  const big = express.json({ limit: "2mb" }), mid = express.json({ limit: "400kb" }), tiny = express.json({ limit: "20kb" });
  const S = (ws) => scopeStore(store, ws);
  const bad = (res, message, status = 400, code = "invalid") => res.status(status).json({ code, message });
  const me = (req, res) => { const u = currentUser(req); if (!u || !u.ws || u.ws === DEFAULT_WS) { bad(res, "Sign in first.", 401, "unauthenticated"); return null; } if (getWorkspace(u.ws)?.regularOnly) { bad(res, "Add a host code to set up your page.", 403, "invite_required"); return null; } return u; };
  const hits = new Map(); const limited = (u, what, n) => { const k = u.ws + what, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > 3600e3) { h = { t: now, n: 0 }; hits.set(k, h); } return ++h.n > n; };
  // token encryption for Gmail: AES-256-GCM, key from SESSION_SECRET (or a random one kept in the system area)
  const gKey = () => { let base = process.env.SESSION_SECRET; if (!base) { base = S(DEFAULT_WS).get("system/onboard-key")?.data?.v; if (!base) { base = crypto.randomBytes(32).toString("hex"); S(DEFAULT_WS).set("system/onboard-key", { v: base }); } } return Buffer.from(crypto.hkdfSync("sha256", base, "encore-gmail", "aes-256-gcm", 32)); };
  const seal = (obj) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", gKey(), iv), d = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]); return [iv, c.getAuthTag(), d].map((b) => b.toString("base64")).join("."); };
  const unseal = (s) => { try { const [iv, tag, d] = String(s).split(".").map((x) => Buffer.from(x, "base64")); const c = crypto.createDecipheriv("aes-256-gcm", gKey(), iv); c.setAuthTag(tag); return JSON.parse(Buffer.concat([c.update(d), c.final()]).toString("utf8")); } catch { return null; } };
  const sign = (s) => crypto.createHmac("sha256", gKey()).update(s).digest("base64url");
  const redirectUri = (req) => gmailConfig()?.redirect || `${publicOrigin(req)}/api/onboard/gmail/callback`;

  app.get("/onboard", (req, res) => {
    // this page may load pdf.js (a pinned UMD build) from cdnjs to read PDFs in the browser; nothing else is widened
    res.set("Content-Security-Policy", cspWith(["default-src 'self'", "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com", "worker-src 'self' blob: https://cdnjs.cloudflare.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", "media-src 'self' blob:", "connect-src 'self' https://cdnjs.cloudflare.com", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self' https://accounts.google.com"].join("; ")));
    sendStatic(res, "onboard.html", "<p>Onboarding page missing.</p>"); });

  app.get("/api/onboard/state", (req, res) => { const u = me(req, res); if (!u) return; const W = getWorkspace(u.ws), g = gmailConfig(), tok = S(u.ws).get("onboard/gmail")?.data;
    res.json({ host: W?.host || null, name: getDbUser(W?.ownerEmail || "")?.name || u.name || "", company: W?.company || "", ai: aiMode(), draft: S(u.ws).get("onboard/draft")?.data || null,
      gmail: g ? { enabled: true, connected: !!tok, email: tok?.email || "" } : { enabled: false }, reminders: pottoSettings(S(u.ws)), sms: !!smsConfig(), store: { accents: STORE.accents, covers: STORE.covers, fonts: STORE.fonts, backgrounds: STORE.backgrounds } }); });

  // keep the work in progress so a busy owner can stop and come back
  app.post("/api/onboard/save", mid, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    const v = { step: clean(b.step, 20), answers: Object.fromEntries(Object.entries(b.answers || {}).slice(0, 12).map(([k, x]) => [clean(k, 20), clean(x, 3000)])), drafts: normalizeDrafts(b.drafts || {}), at: Date.now(), done: !!b.done };
    S(u.ws).set("onboard/draft", v); res.json({ ok: true }); });

  app.post("/api/onboard/draft", big, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "draft", 40)) return bad(res, "That's a lot of drafts this hour. Try again in a bit.", 429, "rate_limited");
    const b = req.body || {}, answers = Object.fromEntries(Object.entries(b.answers || {}).slice(0, 12).map(([k, x]) => [clean(k, 20), clean(x, 3000)]));
    const material = (Array.isArray(b.material) ? b.material : []).map((m) => ({ label: m?.label, text: m?.kind === "eml" ? emlToText(m.text) : m?.text }));
    const D = await makeDrafts({ answers, material }); res.json(D); });

  app.post("/api/onboard/suggest", mid, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {};
    res.json(suggestPage({ host: getWorkspace(u.ws)?.host || {}, answers: b.answers || {}, drafts: normalizeDrafts(b.drafts || {}) })); });

  app.post("/api/onboard/email", big, (req, res) => { const u = me(req, res); if (!u) return; res.json({ text: emlToText(req.body?.text || "") }); });
  app.post("/api/onboard/pdf", express.raw({ type: () => true, limit: "12mb" }), (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "pdf", 60)) return bad(res, "That's a lot of files this hour.", 429, "rate_limited");
    try { const r = pdfText(req.body); if (!r.text.trim()) return bad(res, "I couldn't find text in that PDF. If it's a scan, paste the prices instead.", 422, "no_text"); res.json(r); } catch (e) { bad(res, e?.message || "I couldn't read that PDF."); } });
  app.post("/api/onboard/link", tiny, async (req, res) => { const u = me(req, res); if (!u) return; if (limited(u, "link", 30)) return bad(res, "That's a lot of links this hour.", 429, "rate_limited");
    const r = await readLink(req.body?.url); if (!r.ok) return bad(res, r.message, 422, "unreadable"); res.json(r); });

  // the review step's "Looks good": the only place drafts reach the page. Packages, page details, or both.
  app.post("/api/onboard/publish", mid, (req, res) => { const u = me(req, res); if (!u) return; const b = req.body || {}, cur = getWorkspace(u.ws)?.host || {}, p = {};
    if (Array.isArray(b.experiences) || Array.isArray(b.gifts)) { const D = normalizeDrafts({ experiences: b.experiences || cur.experiences || [], gifts: b.gifts || cur.gifts || [] }); if (Array.isArray(b.experiences)) p.experiences = stripHints(D.experiences); if (Array.isArray(b.gifts)) p.gifts = stripHints(D.gifts); if ((p.experiences || cur.experiences || []).length) p.forHire = true; }
    const pg = b.page || {};
    for (const k of ["name", "tagline", "bio", "city", "hood", "emoji", "giftNote"]) if (pg[k] != null && clean(pg[k])) p[k] = pg[k];
    if (pg.theme && typeof pg.theme === "object") p.theme = { ...(cur.theme || {}), ...Object.fromEntries(Object.entries(pg.theme).filter(([k]) => ["accent", "font", "bg", "cover", "buttons", "avatarArt"].includes(k))) };
    if (pg.theme?.accent) p.color = pg.theme.accent;
    if (!Object.keys(p).length) return bad(res, "Nothing to save.");
    const W = getWorkspace(u.ws), base = (cur.handle || clean(pg.name || cur.name || W?.company || u.name || "", 60)).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "") || "host";
    let r = C.setProfile(u.ws, { ...p, handle: cur.handle || (base.length >= 2 ? base : base + "-page"), name: p.name || cur.name || W?.company || u.name || "" });
    if (r.error && !cur.handle) r = C.setProfile(u.ws, { ...p, handle: `${base.slice(0, 24)}-${crypto.randomBytes(2).toString("hex")}`, name: p.name || W?.company || u.name || "" });
    if (r.error) return bad(res, r.error);
    if (p.experiences || p.gifts) { const d = S(u.ws).get("onboard/draft")?.data || {}; S(u.ws).set("onboard/draft", { ...d, published: Date.now() }); }
    res.json({ ok: true, host: r.host, url: `${publicOrigin(req)}/@${r.host.handle}` }); });

  // reminders: phone, channels, opt-out. Turning texts on sends one confirmation text so the owner knows it works.
  app.get("/api/onboard/reminders", (req, res) => { const u = me(req, res); if (!u) return; res.json({ ...pottoSettings(S(u.ws)), sms: !!smsConfig() }); });
  app.post("/api/onboard/reminders", tiny, async (req, res) => { const u = me(req, res); if (!u) return; const prev = pottoSettings(S(u.ws)), v = cleanPottoSettings(req.body || {}, prev);
    if (req.body?.phone && !v.phone) return bad(res, "That phone number doesn't look right.");
    S(u.ws).set("settings/potto", v); let texted = false;
    if (!v.off && v.sms && v.phone && (v.phone !== prev.phone || !prev.sms || prev.off)) { const cfg = smsConfig(); if (cfg) texted = (await sendSms(cfg, { to: v.phone, text: "Potto here from Pottery Lab. I'll text you when a brand is waiting on you. No texts 9pm to 8am. Reply STOP to stop." })).ok; }
    res.json({ ok: true, ...v, texted }); });
  app.post("/api/onboard/reminders/preview", tiny, async (req, res) => { const u = me(req, res); if (!u) return; res.json(await runPottoReminders(store, { workspaces: [u.ws], dryRun: true, origin: publicOrigin(req) })); });

  // Gmail, read-only. Shown only when the server owner set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
  app.get("/api/onboard/gmail/start", (req, res) => { const u = me(req, res); if (!u) return; const g = gmailConfig(); if (!g) return bad(res, "Gmail isn't set up on this server.", 404, "not_configured");
    const st = Buffer.from(JSON.stringify({ ws: u.ws, n: crypto.randomBytes(8).toString("hex"), exp: Date.now() + 10 * 60e3 })).toString("base64url"), state = st + "." + sign(st);
    const q = new URLSearchParams({ client_id: g.id, redirect_uri: redirectUri(req), response_type: "code", scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, ...(u.email ? { login_hint: u.email } : {}) });
    res.redirect(302, "https://accounts.google.com/o/oauth2/v2/auth?" + q); });
  app.get("/api/onboard/gmail/callback", async (req, res) => { const u = me(req, res); if (!u) return; const g = gmailConfig(); if (!g) return bad(res, "Gmail isn't set up on this server.", 404, "not_configured");
    const [st, sig] = String(req.query.state || "").split("."); let s = null; try { if (sig && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(st)))) s = JSON.parse(Buffer.from(st, "base64url").toString("utf8")); } catch {}
    if (!s || s.ws !== u.ws || s.exp < Date.now()) return res.redirect(302, "/onboard?gmail=expired");
    if (req.query.error || !req.query.code) return res.redirect(302, "/onboard?gmail=declined");
    try { const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(req.query.code), client_id: g.id, client_secret: g.secret, redirect_uri: redirectUri(req), grant_type: "authorization_code" }), signal: AbortSignal.timeout(10000) });
      const j = await r.json(); if (!r.ok || !j.access_token) return res.redirect(302, "/onboard?gmail=failed");
      if (j.scope && !String(j.scope).split(" ").every((x) => x === GMAIL_SCOPE || /openid|userinfo|email|profile/.test(x))) return res.redirect(302, "/onboard?gmail=failed");
      let email = ""; try { const p = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + j.access_token }, signal: AbortSignal.timeout(8000) })).json(); email = clean(p.emailAddress, 200); } catch {}
      S(u.ws).set("onboard/gmail", { email, secret: seal({ access: j.access_token, refresh: j.refresh_token || "", exp: Date.now() + (+j.expires_in || 3000) * 1000 }), at: Date.now() });
      res.redirect(302, "/onboard?gmail=connected"); } catch { res.redirect(302, "/onboard?gmail=failed"); } });
  const gmailToken = async (ws) => { const d = S(ws).get("onboard/gmail")?.data; const t = d && unseal(d.secret); if (!t) return null; if (t.exp > Date.now() + 60e3) return t.access; const g = gmailConfig(); if (!g || !t.refresh) return null;
    try { const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: g.id, client_secret: g.secret, refresh_token: t.refresh, grant_type: "refresh_token" }), signal: AbortSignal.timeout(10000) }); const j = await r.json(); if (!j.access_token) return null;
      S(ws).set("onboard/gmail", { ...d, secret: seal({ ...t, access: j.access_token, exp: Date.now() + (+j.expires_in || 3000) * 1000 }) }); return j.access_token; } catch { return null; } };
  const gget = async (tok, p) => { const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + p, { headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw { status: r.status }; return r.json(); };
  const hdr = (m, n) => (m.payload?.headers || []).find((h) => h.name.toLowerCase() === n)?.value || "";
  app.post("/api/onboard/gmail/search", tiny, async (req, res) => { const u = me(req, res); if (!u) return; if (!gmailConfig()) return bad(res, "Gmail isn't set up on this server.", 404, "not_configured"); if (limited(u, "gsearch", 60)) return bad(res, "Slow down a little.", 429, "rate_limited");
    const tok = await gmailToken(u.ws); if (!tok) return bad(res, "Connect Gmail first.", 409, "not_connected"); const q = clean(req.body?.q, 200) || GMAIL_QUERY;
    try { const L = await gget(tok, "messages?maxResults=15&q=" + encodeURIComponent(q)), out = [];
      for (const m of (L.messages || []).slice(0, 15)) { const x = await gget(tok, `messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`); out.push({ id: x.id, subject: clean(hdr(x, "subject"), 200), from: clean(hdr(x, "from"), 120), date: clean(hdr(x, "date"), 60), snippet: clean(htmlToText(x.snippet || ""), 240) }); }
      res.json({ q, messages: out }); } catch (e) { bad(res, e?.status === 401 ? "Gmail needs you to connect again." : "Gmail didn't answer. Try again.", e?.status === 401 ? 409 : 502, e?.status === 401 ? "not_connected" : "upstream_error"); } });
  app.post("/api/onboard/gmail/read", tiny, async (req, res) => { const u = me(req, res); if (!u) return; if (!gmailConfig()) return bad(res, "Gmail isn't set up on this server.", 404, "not_configured");
    const tok = await gmailToken(u.ws); if (!tok) return bad(res, "Connect Gmail first.", 409, "not_connected"); const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((x) => String(x).replace(/[^A-Za-z0-9]/g, "")).filter(Boolean).slice(0, 10);
    const walk = (p) => { if (!p) return ""; if (/text\/plain/.test(p.mimeType || "") && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8"); for (const c of p.parts || []) { const t = walk(c); if (t) return t; } if (/text\/html/.test(p.mimeType || "") && p.body?.data) return htmlToText(Buffer.from(p.body.data, "base64url").toString("utf8")); return ""; };
    try { const out = []; for (const id of ids) { const m = await gget(tok, `messages/${id}?format=full`); out.push({ id, label: clean(hdr(m, "subject") || "An email", 80), text: emlToText(`Subject: ${hdr(m, "subject")}\n\n${walk(m.payload)}`) }); } res.json({ emails: out }); }
    catch { bad(res, "Gmail didn't answer. Try again.", 502, "upstream_error"); } });
  app.post("/api/onboard/gmail/disconnect", tiny, async (req, res) => { const u = me(req, res); if (!u) return; const d = S(u.ws).get("onboard/gmail")?.data, t = d && unseal(d.secret);
    if (t?.refresh || t?.access) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t.refresh || t.access), { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
    S(u.ws).delete("onboard/gmail"); res.json({ ok: true }); });

  if (jobs) app.locals.pottoReminders = schedulePottoReminders(store, { origin: process.env.ENCORE_PUBLIC_URL || "" });
}
