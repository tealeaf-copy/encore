// Copy lint: scans the words people read for the house rules in docs/brand-kit.md and the voice skill.
// It reads the visible text and attributes of public/*.html and index.html, the string literals in public/*.js and in
// inline scripts, and the string literals in server/*.js (emails, notifications, errors), then flags:
//   dash   an em dash (or &mdash; / —, or a spaced en dash standing in for one)
//   bang   an exclamation mark ending a word in UI copy
//   word   a word or phrase from the never-use list
// Run: node scripts/copy-lint.mjs            prints counts per rule and per file, exits 1 if anything is found
//      node scripts/copy-lint.mjs --list     also prints every hit with its line
//      node scripts/copy-lint.mjs --only public/invite.html
// Lines a guest or host wrote (seed data, examples quoted as "don't" in prompts) can be skipped with a
// "copy-lint: ok" comment on the same line.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIST = process.argv.includes("--list");
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? process.argv[i + 1] : ""; })();

// The never-use list (brand kit "Phrases we don't use" and "Words", plus the plain-English list).
const BANNED = [
  ["taped in", /\btap(?:ed|e it) in(?:to)?\b/i], ["marketplace", /\bmarketplaces?\b/i],
  ["seamless", /\bseamless(?:ly)?\b/i], ["effortless", /\beffortless(?:ly)?\b/i], ["unlock", /\bunlock(?:s|ed|ing)?\b/i],
  ["elevate", /\belevat(?:e|es|ed|ing)\b/i], ["curated", /\bcurat(?:ed|ion)\b/i], ["magical", /\bmagic(?:al|ally)?\b/i],
  ["attendees", /\battendees?\b/i], ["per person", /\bper person\b/i],
  // spots, not seats, when counting places at an event (seating people, and seats in a car, are fine)
  ["seats", /\b(?:\d+|X|of|the|your|brand|host|team|more|fewer|every|a|any|last)[- ]seats?\b(?! (?:in|for others|people|everyone|them|guests|you))|\bseats? (?:left|filled|confirmed|by source|your team|the host fills)\b/i],
  // a reply is "I'm in"; "said yes to sharing" (consent) is fine
  ["say yes", /\bsa(?:y|id|ys) yes\b(?! to (?:sharing|being|a public|the held|your collab|that|swap))/i],
  ["vibrant", /\bvibrant\b/i], ["whether you're", /\bwhether you(?:'|’)re\b/i], ["delve", /\bdelv(?:e|es|ing)\b/i],
  ["utilize", /\butili[sz](?:e|es|ed|ing)\b/i], ["leverage", /\bleverag(?:e|es|ed|ing)\b/i], ["stunning", /\bstunning\b/i],
  ["supercharge", /\bsupercharg/i], ["game-changer", /\bgame[- ]chang/i], ["hassle-free", /\bhassle[- ]free\b/i],
];

const files = [];
const add = (rel) => { if (!ONLY || rel === ONLY || rel.startsWith(ONLY)) files.push(rel); };
for (const f of fs.readdirSync(path.join(ROOT, "public")).sort()) if (/\.(html|js)$/.test(f)) add("public/" + f);
add("index.html");
for (const f of fs.readdirSync(path.join(ROOT, "server")).sort()) if (f.endsWith(".js")) add("server/" + f);

// ---- extraction ----
// JS string literals with their line numbers. A small tokenizer: skips comments and regex literals.
function jsStrings(src, line0 = 1) {
  const out = []; let i = 0, line = line0, prev = "";
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; for (let k = i; k < end; k++) if (src[k] === "\n") line++; i = end; continue; }
    if (c === "/" && (/[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || prev === "" || /\b(?:return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      // regex literal
      i++; let cls = false;
      while (i < n && src[i] !== "\n") { const d = src[i]; if (d === "\\") { i += 2; continue; } if (d === "[") cls = true; else if (d === "]") cls = false; else if (d === "/" && !cls) break; i++; }
      i++; while (/[a-z]/i.test(src[i] || "")) i++; prev = "x"; continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const q = c, startLine = line; let s = "", j = i + 1, depth = 0;
      while (j < n) {
        const d = src[j];
        if (d === "\\") { s += src[j + 1] === "u" && src.slice(j + 2, j + 6) === "2014" ? "—" : " "; if (src[j + 1] === "\n") line++; j += src[j + 1] === "u" ? 6 : 2; continue; }
        if (d === "\n") { line++; if (q !== "`") break; }
        // a template's ${...}: stands in as X here, and the strings inside it are scanned too
        if (q === "`" && d === "$" && src[j + 1] === "{") { depth = 1; j += 2; s += "X"; const from = j, l0 = line; while (j < n && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; else if (src[j] === "\n") line++; j++; } out.push(...jsStrings(src.slice(from, j - 1), l0)); continue; }
        if (d === q) break;
        s += d; j++;
      }
      out.push({ s, line: startLine }); i = j + 1; prev = "x"; continue;
    }
    if (!/\s/.test(c)) prev = /[A-Za-z0-9_$)\]]/.test(c) ? "x" : c;
    i++;
  }
  return out;
}
const lineOf = (src, idx) => { let l = 1; for (let k = 0; k < idx; k++) if (src.charCodeAt(k) === 10) l++; return l; };

// Visible text and readable attributes of an HTML file, plus the strings of its inline scripts.
function htmlStrings(src) {
  const out = [];
  const blank = (m) => m.replace(/[^\n]/g, " ");
  let rest = src.replace(/<!--[\s\S]*?-->/g, blank).replace(/<style[\s\S]*?<\/style>/gi, blank);
  rest = rest.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, body, z, idx) => {
    if (!/type=["']?(?:application\/(?:ld\+)?json|importmap)/i.test(a)) for (const t of jsStrings(body, lineOf(src, idx))) out.push({ ...t, js: true });
    return blank(m);
  });
  const attr = /\b(placeholder|aria-label|title|alt|content|value|data-tip|data-hint)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m; while ((m = attr.exec(rest))) { const v = m[3] ?? m[4]; if (m[1].toLowerCase() === "content" && !/\s/.test(v)) continue; out.push({ s: v, line: lineOf(rest, m.index) }); }
  const textRe = />([^<>]+)</g;
  while ((m = textRe.exec(rest))) if (/[A-Za-z]/.test(m[1])) out.push({ s: m[1], line: lineOf(rest, m.index) });
  return out;
}

// A JS string is copy when it reads like words: letters and a space, and not code, CSS, a selector or a URL.
function isProse(s) {
  const t = s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, (e) => (/mdash|8212|x2014/i.test(e) ? "—" : " ")).trim();
  if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) && !/—/.test(t)) return null;
  if (/^[\w.#:[\]=\-"'>~+*,()\s]+\{|;\s*$|=>|\bfunction\b|\breturn\b|document\.|\bvar\b|\bconst\b|\bSELECT\b|\bINSERT\b|\bUPDATE\b.*\bSET\b|\bCREATE TABLE\b/.test(t)) return null;
  if (/^(?:[a-z-]+:\s*[^;]+;\s*)+$/i.test(t)) return null; // inline css
  if (/\(\?:|\\[sdbw]/.test(s)) return null; // a regex source
  return t;
}

const hits = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const lines = src.split("\n");
  const strs = rel.endsWith(".html") ? htmlStrings(src) : jsStrings(src).map((t) => ({ ...t, js: true }));
  for (const { s, line, js } of strs) {
    if (/copy-lint: ok/.test(lines[line - 1] || "")) continue;
    const t = js ? isProse(s) : s.replace(/&mdash;|&#8212;|&#x2014;/gi, "—").replace(/&[a-z#0-9]+;/gi, " ");
    if (!t) continue;
    const at = (rule, what) => hits.push({ rel, line, rule, what, text: t.replace(/\s+/g, " ").trim().slice(0, process.argv.includes("--full") ? 99999 : 140) });
    if (/—|[A-Za-z,.]\s–\s(?![\dX$])/.test(t)) at("dash", "em dash");
    if (/[A-Za-z0-9)'"’]!+(?=\s|$|["'’)<])/.test(t) && !/!=/.test(t)) at("bang", "exclamation mark");
    // prompts sent to the writing model list the banned words on purpose; they aren't shown to anyone
    const prompt = /\bYou are (?:a|an|the|Potto)\b|WRITING STYLE|GUEST RULES|POTTO-[A-Z]+|Never use these/.test(t);
    if (!prompt) for (const [name, re] of BANNED) if (re.test(t) && !(name === "seats" && /\b(?:car|ride|driv)/i.test(t))) at("word", name);
  }
}

const by = (k) => hits.reduce((a, h) => ((a[h[k]] = (a[h[k]] || 0) + 1), a), {});
const rules = by("rule"), perFile = by("rel");
console.log(`copy-lint: ${hits.length} hits in ${Object.keys(perFile).length} of ${files.length} files  (dash ${rules.dash || 0}, bang ${rules.bang || 0}, word ${rules.word || 0})`);
const words = hits.filter((h) => h.rule === "word").reduce((a, h) => ((a[h.what] = (a[h.what] || 0) + 1), a), {});
if (Object.keys(words).length) console.log("  words: " + Object.entries(words).sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w} ${c}`).join(", "));
for (const [f, c] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${f}`);
if (LIST) for (const h of hits) console.log(`${h.rel}:${h.line}  ${h.rule}/${h.what}  ${h.text}`);
process.exit(hits.length ? 1 : 0);
