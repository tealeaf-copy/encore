// "Start from your Instagram": the pure part. Reading a handle, building what Potto reads, a deterministic draft for
// offline mode (ENCORE_FAKE_AI=1, or no key), and the guard every draft passes through before a person sees it.
// No imports, so server/ai.js (offline mode) and server/igimport.js (the routes) can both use it.
//
// The guard's rules (docs/instagram-import.md):
// - every field says where it came from (from your bio, from your post on Oct 3, from photo 2);
// - a price is kept only when the person's own words state it (or a photo of theirs shows it, marked "check it");
//   otherwise the offering says "price not set". Potto never invents a price;
// - only this person's account: @mentions of other accounts and links to other Instagram accounts are taken out;
// - plain words: no em dashes, no markup, short.

export const IG_PROMPT_TAG = "POTTO-IG-DRAFT";
export const MAX_PHOTOS = 12, MIN_PHOTOS = 3, MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct", "about", "developer", "legal", "web", "s", "tags", "locations", "challenge", "oauth", "api"]);

const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").replace(/ ?, ,/g, ",").trim().slice(0, n);
const cleanBlock = (v, n = 2000) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, " ").replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);

/** "@le.phin", "le_phin", "instagram.com/le.phin", "https://www.instagram.com/le.phin/?hl=en" -> "le.phin". A post,
 *  reel or anything that is not a profile -> "". Instagram handles: letters, numbers, dots and underscores, up to 30. */
export function parseIgHandle(input) {
  let s = String(input ?? "").trim();
  if (!s || s.length > 200) return "";
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)(\/[^?#\s]*)?(?:[?#].*)?$/i);
  if (url) { const parts = String(url[1] || "").split("/").filter(Boolean); if (parts.length !== 1) return ""; s = parts[0]; }
  else if (/[/:]/.test(s)) return "";
  s = s.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s) || /\.\./.test(s) || s.startsWith(".") || s.endsWith(".") || RESERVED.has(s)) return "";
  return s;
}
/** The Instagram profile link for a handle. */
export const igUrl = (h) => (parseIgHandle(h) ? `https://www.instagram.com/${parseIgHandle(h)}/` : "");
/** A Pottery Lab handle from an Instagram one: "le.phin_nyc" -> "le-phin-nyc" (2 to 30 lowercase letters, numbers, dashes). */
export function plHandleFrom(h) {
  const s = String(h || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  return s.length >= 2 ? s : s ? s + "-page" : "";
}
const prettyName = (h) => String(h || "").replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// ---------- sources ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso) { const d = new Date(iso); return isNaN(d) ? "" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; }
/** A source as the person reads it. kind: bio | post | photo | pasted | profile | handle | colors | drawn. */
export function sourceLabel(s, input = {}) {
  if (!s || typeof s !== "object") return "";
  const n = Math.round(+s.ref || 0);
  if (s.kind === "bio") return "from your bio";
  if (s.kind === "pasted") return "from what you pasted";
  if (s.kind === "profile") return "from your Instagram profile";
  if (s.kind === "handle") return "from your handle";
  if (s.kind === "colors") return "from the colors in your photos";
  if (s.kind === "drawn") return "drawn for you, change it any time";
  if (s.kind === "post") { const p = (input.posts || [])[n - 1], d = shortDate(p?.timestamp) || clean(s.date, 12); return d ? `from your post on ${d}` : "from one of your posts"; }
  if (s.kind === "photo") { const d = clean(s.date, 12); return d ? `from your post on ${d}` : n ? `from photo ${n}` : "from your photos"; }
  return "";
}

// ---------- what Potto reads (the model's prompt) ----------
/** Content blocks for the Messages API: the instructions, the person's own words, then each photo with its number. */
export function buildPrompt(input) {
  const { handle = "", name = "", bio = "", extra = "", website = "", posts = [], photos = [], mode = "new" } = input;
  const words = [
    handle ? `Instagram handle: @${handle}` : "", name ? `Name on the profile: ${name}` : "", website ? `Website on the profile: ${website}` : "",
    bio ? `<bio>\n${bio}\n</bio>` : "", extra ? `<pasted>\n${extra}\n</pasted>` : "",
    ...posts.map((p, i) => `<post n="${i + 1}" date="${shortDate(p.timestamp)}">\n${clean(p.caption, 1500)}\n</post>`),
  ].filter(Boolean).join("\n\n");
  const text = `${IG_PROMPT_TAG}
You are Potto, the helper on Pottery Lab, a place where small hosts (coffee shops, bakers, studios, clubs) put up a page and host events.
A person is ${mode === "refresh" ? "refreshing" : "starting"} their own Pottery Lab page from their own Instagram. Draft their page from ONLY what is below: their bio, captions and the photos they chose (screenshots of their profile, highlights or posts, or photos of their shop, menu and drinks).

Rules:
- Use their words. Keep their phrasing for the tagline and about wherever you can. No hype, no superlatives they did not use, no em dashes, no emoji.
- Never invent a fact. Leave a field empty ("") when the material does not say it.
- Prices: give a price ONLY when the material states it for that item (a caption, the bio, a menu board in a photo). Copy it in "priceQuote" exactly as written. Otherwise price is "" (the page will say "price not set").
- Only this account. Do not include other people's or businesses' handles, names, links or details, even if a caption tags them.
- Hours only if stated. City and neighbourhood only if stated or clearly shown (a pin, a street sign they name).
- Every field has a source: {"kind":"bio"} | {"kind":"pasted"} | {"kind":"profile"} | {"kind":"post","ref":N} (N is the post number) | {"kind":"photo","ref":N,"date":"Oct 3"} (N is the photo number; date only if the screenshot shows the post date).
- events: kinds of events they could host for guests, from what they already do or show (tastings, workshops, classes, pop-ups, cuppings, supper clubs). brandEvents: what they could do for companies (catering, office coffee pop-up, a coffee bar at a launch), only when the material points to it.
- tags: up to 8 short lowercase words for what they make or serve.
- cover: the photo number that would make the best wide cover (a bright shot of the place or the signature thing, not a screenshot of text). gallery: up to 8 photo numbers that show the place and what they make, best first, no screenshots of text. avatar: the photo number of their profile picture or logo if one is clearly there, else null.
- findings: 3 to 6 very short lines of what you found, in their order, like "Your hours: Mon to Fri, 7 to 5" or "3 drinks from your posts". Plain and warm.

Reply with only JSON, in this shape:
{"name":{"value":"","source":{}},"tagline":{"value":"","source":{}},"about":{"value":"","source":{}},"city":{"value":"","source":{}},"hood":{"value":"","source":{}},"hours":{"value":"","source":{}},"website":{"value":"","source":{}},"tags":{"value":[],"source":{}},"events":{"value":[],"source":{}},"brandEvents":{"value":[],"source":{}},"offerings":[{"name":"","desc":"","price":"","priceQuote":"","source":{}}],"cover":{"photo":null},"gallery":[],"avatar":{"photo":null},"findings":[]}

Their material:
${words || "(no text, only photos)"}
${photos.length ? `\nThey chose ${photos.length} photo${photos.length === 1 ? "" : "s"}, numbered below in order.` : ""}`;
  const blocks = [{ type: "text", text }];
  photos.forEach((p, i) => { blocks.push({ type: "text", text: `Photo ${i + 1}` }); blocks.push({ type: "image", source: { type: "base64", media_type: p.type, data: p.data } }); });
  return blocks;
}
/** The material back out of a prompt (offline mode reads it the way the model would). */
export function materialOf(prompt) {
  const text = Array.isArray(prompt) ? prompt.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : String(prompt ?? "");
  const tag = (t) => (text.match(new RegExp(`<${t}>\\n?([\\s\\S]*?)\\n?</${t}>`)) || [])[1] || "";
  const posts = [...text.matchAll(/<post n="(\d+)" date="([^"]*)">\n?([\s\S]*?)\n?<\/post>/g)].map((m) => ({ n: +m[1], date: m[2], caption: m[3] }));
  return { handle: (text.match(/^Instagram handle: @(\S+)/m) || [])[1] || "", name: (text.match(/^Name on the profile: (.+)$/m) || [])[1] || "", website: (text.match(/^Website on the profile: (\S+)$/m) || [])[1] || "",
    bio: tag("bio"), extra: tag("pasted"), posts, photos: Array.isArray(prompt) ? prompt.filter((b) => b?.type === "image").length : 0 };
}

// ---------- the offline draft: plain rules over the person's own words ----------
const HOODS = ["East Village", "West Village", "Lower East Side", "Chinatown", "SoHo", "Tribeca", "Williamsburg", "Greenpoint", "Bushwick", "Park Slope", "Bed-Stuy", "Crown Heights", "Astoria", "Long Island City", "Harlem", "Upper West Side", "Upper East Side", "Mission", "Mission District", "Hayes Valley", "Inner Sunset", "Outer Sunset", "Oakland", "Silver Lake", "Echo Park", "Koreatown", "Little Saigon", "Capitol Hill", "Fishtown", "Logan Square", "Pilsen", "Wicker Park"];
const CITIES = [["New York", /\b(?:new york|nyc|manhattan|brooklyn|queens)\b/i], ["San Francisco", /\b(?:san francisco|\bsf\b)\b/i], ["Oakland", /\boakland\b/i], ["Los Angeles", /\b(?:los angeles|\bla\b)\b/], ["Seattle", /\bseattle\b/i], ["Chicago", /\bchicago\b/i], ["Philadelphia", /\b(?:philadelphia|philly)\b/i], ["Austin", /\baustin\b/i], ["Portland", /\bportland\b/i], ["Boston", /\bboston\b/i], ["Houston", /\bhouston\b/i], ["Ho Chi Minh City", /\b(?:saigon|ho chi minh)\b/i], ["Hanoi", /\bha ?noi\b/i], ["London", /\blondon\b/i], ["Toronto", /\btoronto\b/i]];
const TAGS = [["coffee", /\bcoffee|cà phê|ca phe|espresso\b/i], ["vietnamese coffee", /vietnamese coffee|cà phê|ca phe|phin\b/i], ["phin", /\bphin\b/i], ["matcha", /\bmatcha\b/i], ["tea", /\btea\b/i], ["pandan", /\bpandan\b/i], ["pastries", /\bpastr(?:y|ies)|croissants?|bánh|banh\b/i], ["bakery", /\bbaker(?:y|ies)|bread|sourdough\b/i], ["cake", /\bcakes?\b/i], ["cocktails", /\bcocktails?\b/i], ["wine", /\bwine\b/i], ["natural wine", /natural wine/i], ["ceramics", /\bceramics?|pottery\b/i], ["flowers", /\bflowers?|florist|bouquets?\b/i], ["brunch", /\bbrunch\b/i], ["vegan", /\bvegan\b/i], ["sandwiches", /\bsandwich(?:es)?|bánh mì|banh mi\b/i], ["ice cream", /\bice cream|gelato\b/i]];
const EVENTS = [["Tastings", /\btastings?|taste\b/i], ["Workshops", /\bworkshops?\b/i], ["Classes", /\bclass(?:es)?\b|\blearn to\b/i], ["Pop-ups", /\bpop[- ]?ups?\b/i], ["Cuppings", /\bcuppings?\b/i], ["Supper clubs", /\bsupper club|\bdinners?\b/i], ["Open mic nights", /\bopen mic\b/i], ["Run club", /\brun club\b/i]];
const BRAND = [["Catering", /\bcater(?:ing|s|ed)?\b/i], ["Office coffee pop-ups", /\boffices?\b|\bteams?\b|\bcorporate\b/i], ["A coffee bar at your launch", /\blaunch(?:es)?\b|\bcoffee bar\b|\bphin bar\b|\bbooth\b/i], ["Gifts for clients", /\bgift(?:s| sets?| boxes?)\b/i]];
const ITEMS = /(?<![A-Za-zÀ-ỹ])(?:iced |hot )?(?:cà phê sữa đá|ca phe sua da|egg coffee|salted (?:cream|coffee)|coconut coffee|pandan latte|black sesame latte|ube latte|matcha latte|hojicha latte|cold brew|espresso tonic|oat latte|cortado|croissants?|bánh mì|banh mi|bánh flan|banh flan|bánh bò|banh bo|cookies?|sourdough(?: loaf)?|phin filter)(?![A-Za-zÀ-ỹ])/gi;
const HOURS = /\b(?:(?:open\s+)?(?:daily|every ?day|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|weekdays|weekends)(?:\s*(?:-|–|to|&|and|,)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)*\s*:?\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi;
const HOURS1 = new RegExp(HOURS.source, "i");
const sentences = (t) => String(t || "").replace(/([.!?])?\s*\n+\s*/g, (m, p) => (p ? p + " " : ". ")).split(/(?<=[.!?])\s+/).map((s) => s.replace(/^[\s.•·|]+/, "").trim()).filter((s) => s.length > 2);

/** A draft from plain rules, in the same raw shape the model returns. Reads only the material it is given. */
export function fakeIgDraft(prompt) {
  const M = materialOf(prompt);
  const texts = [{ src: { kind: "bio" }, t: M.bio }, { src: { kind: "pasted" }, t: M.extra }, ...M.posts.map((p) => ({ src: { kind: "post", ref: p.n }, t: p.caption }))].filter((x) => String(x.t || "").trim());
  const first = (re) => { for (const x of texts) { const m = String(x.t).match(re); if (m) return { m, src: x.src }; } return null; };
  const field = (value, source) => ({ value: value || "", source: value ? source : {} });
  const bioS = sentences(M.bio).filter((s) => !/https?:\/\/|www\./i.test(s) && !HOURS1.test(s));
  const name = M.name || prettyName(M.handle);
  const tagline = bioS[0] ? bioS[0].replace(/[.!]+$/, "") : "";
  const about = bioS.slice(0, 4).join(" ") || (M.posts[0] ? sentences(M.posts[0].caption).slice(0, 2).join(" ") : "");
  let hood = null; for (const x of texts) { const h = HOODS.find((n) => new RegExp(`\\b${n.replace(/[-]/g, "[- ]")}\\b`, "i").test(x.t)); if (h) { hood = { v: h, src: x.src }; break; } }
  let city = null; for (const x of texts) { const c = CITIES.find(([, re]) => re.test(x.t)); if (c) { city = { v: c[0], src: x.src }; break; } }
  if (!city && hood && /village|side|williamsburg|greenpoint|bushwick|slope|stuy|harlem|astoria|chinatown|soho|tribeca|heights/i.test(hood.v)) city = { v: "New York", src: hood.src };
  const hr = first(HOURS1);
  const web = first(/\b(https?:\/\/[^\s<>"]+|(?:www\.)?[a-z0-9-]+\.(?:com|co|cafe|coffee|shop|nyc|net|org|us)\b(?:\/[^\s]*)?)/i);
  const all = texts.map((x) => x.t).join("\n");
  const tags = TAGS.filter(([, re]) => re.test(all)).map(([t]) => t).slice(0, 8);
  const tagSrc = texts.find((x) => TAGS.some(([, re]) => re.test(x.t)))?.src || {};
  const events = EVENTS.filter(([, re]) => re.test(all)).map(([t]) => t), evSrc = texts.find((x) => EVENTS.some(([, re]) => re.test(x.t)))?.src || {};
  const brandEvents = BRAND.filter(([, re]) => re.test(all)).map(([t]) => t), brSrc = texts.find((x) => BRAND.some(([, re]) => re.test(x.t)))?.src || {};
  // offerings: "Pandan latte $6" (a stated price), else a known item named in their words (price not set)
  const offerings = [], seen = new Set();
  for (const x of texts) {
    for (const m of String(x.t).matchAll(/([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ' ]{2,40}?)\s*(?:[-:–]\s*)?(\$\s?\d{1,4}(?:\.\d{2})?)/g)) { const nm = m[1].trim().replace(/^(?:and|our|new|the|a|an|try|with|plus)\s+/i, ""); const k = nm.toLowerCase(); if (nm.length < 3 || seen.has(k) || /\b(?:only|just|from|for|is|are|at)$/i.test(nm)) continue; seen.add(k); offerings.push({ name: nm.charAt(0).toUpperCase() + nm.slice(1), desc: "", price: m[2].replace(/\s/g, ""), priceQuote: m[0].trim(), source: x.src }); }
    for (const m of String(x.t).matchAll(ITEMS)) { const nm = m[0].trim(), k = nm.toLowerCase(); if ([...seen].some((s) => s.includes(k) || k.includes(s))) continue; seen.add(k); offerings.push({ name: nm.charAt(0).toUpperCase() + nm.slice(1), desc: "", price: "", priceQuote: "", source: x.src }); }
  }
  const findings = [name ? `Your name: ${name}` : "", hood || city ? `Where you are: ${[hood?.v, city?.v].filter(Boolean).join(", ")}` : "", hr ? `Your hours: ${hr.m[0].trim()}` : "", offerings.length ? `${offerings.length} thing${offerings.length === 1 ? "" : "s"} you make` : "", events.length ? `Events you could host: ${events.slice(0, 3).join(", ").toLowerCase()}` : "", M.photos ? `${M.photos} photo${M.photos === 1 ? "" : "s"} to choose from` : ""].filter(Boolean);
  return {
    name: field(name, M.name ? { kind: "profile" } : { kind: "handle" }), tagline: field(tagline, { kind: "bio" }), about: field(about, bioS.length ? { kind: "bio" } : { kind: "post", ref: 1 }),
    city: field(city?.v, city?.src), hood: field(hood?.v, hood?.src), hours: field(hr?.m[0].trim(), hr?.src), website: field(M.website || web?.m[1], M.website ? { kind: "profile" } : web?.src),
    tags: { value: tags, source: tags.length ? tagSrc : {} }, events: { value: events, source: events.length ? evSrc : {} }, brandEvents: { value: brandEvents, source: brandEvents.length ? brSrc : {} },
    offerings: offerings.slice(0, 12), cover: { photo: M.photos ? 1 : null }, gallery: Array.from({ length: Math.min(8, M.photos) }, (_, i) => i + 1), avatar: { photo: null }, findings,
  };
}

// ---------- the guard: every draft, from the model or the rules, before anyone sees it ----------
const PRICE_IN = /\$\s?(\d{1,5}(?:\.\d{2})?)/;
const normPrice = (p) => { const m = String(p || "").match(PRICE_IN); return m ? "$" + (+m[1] % 1 ? (+m[1]).toFixed(2) : String(+m[1])) : ""; };
/** The words this draft may quote: the bio, what they pasted and the captions. Prices are checked against these. */
const corpusOf = (input) => [input.bio, input.extra, ...(input.posts || []).map((p) => p.caption)].filter(Boolean).join("\n");
/** Take out other accounts: @mentions that are not this handle, and Instagram links to anyone else. */
export function onlyOwn(text, handle) {
  const own = String(handle || "").toLowerCase();
  return String(text ?? "")
    .replace(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?/gi, (m, h) => (h.toLowerCase() === own ? m : ""))
    .replace(/(^|[^A-Za-z0-9._])@([A-Za-z0-9._]{1,30})/g, (m, pre, h) => (h.toLowerCase() === own ? m : pre))
    .replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/^[\s,.;:]+|[\s,;:]+$/g, "").trim();
}
const okSource = (s, input) => { if (!s || typeof s !== "object") return null; const k = String(s.kind || ""); if (!["bio", "pasted", "profile", "handle", "post", "photo", "colors", "drawn"].includes(k)) return null;
  const ref = Math.round(+s.ref || 0); if (k === "post" && !(ref >= 1 && ref <= (input.posts || []).length)) return null; if (k === "photo" && !(ref >= 1 && ref <= (input.photoCount || 0))) return null;
  if (k === "bio" && !String(input.bio || "").trim()) return null; if (k === "pasted" && !String(input.extra || "").trim()) return null;
  const out = { kind: k }; if (ref) out.ref = ref; if (k === "photo" && /^[A-Z][a-z]{2} \d{1,2}$/.test(String(s.date || ""))) out.date = s.date; return out; };

/** Make a raw draft safe and complete: plain strings, real sources (with labels), stated prices only, this account only. */
export function guardDraft(raw, input = {}) {
  const r = raw && typeof raw === "object" ? raw : {}, handle = parseIgHandle(input.handle) || "", corpus = corpusOf(input);
  const txt = (v, n) => onlyOwn(clean(typeof v === "object" && v ? v.value : v, n), handle);
  const one = (key, n, fallbackSrc) => { const f = r[key] && typeof r[key] === "object" ? r[key] : { value: r[key] }; const value = key === "about" ? onlyOwn(cleanBlock(f.value, n), handle) : txt(f.value, n);
    const src = value ? okSource(f.source, input) || fallbackSrc || null : null; return { value, source: src, from: src ? sourceLabel(src, input) : "" }; };
  const list = (key, n, max) => { const f = r[key] && typeof r[key] === "object" && !Array.isArray(r[key]) ? r[key] : { value: r[key] }; const value = [...new Set((Array.isArray(f.value) ? f.value : []).map((x) => onlyOwn(clean(x, n), handle)).filter(Boolean))].slice(0, max);
    const src = value.length ? okSource(f.source, input) : null; return { value, source: src, from: src ? sourceLabel(src, input) : "" }; };
  const d = {
    handle, igUrl: igUrl(handle),
    name: one("name", 60, handle ? { kind: "handle" } : null), tagline: one("tagline", 120), about: one("about", 400), city: one("city", 60), hood: one("hood", 60), hours: one("hours", 120),
    website: (() => { const w = one("website", 300); let u = w.value.replace(/^(?!https?:\/\/)/i, "https://").replace(/^http:/i, "https:"); if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:[/?#][^\s<>"]*)?$/i.test(u) || /instagram\.com|instagr\.am|facebook\.com|linktr\.ee\/?$/i.test(u)) return { value: "", source: null, from: "" }; return { ...w, value: u }; })(),
    tags: (() => { const t = list("tags", 24, 8); t.value = t.value.map((x) => x.toLowerCase()); return t; })(), events: list("events", 40, 6), brandEvents: list("brandEvents", 50, 5),
  };
  if (d.tagline.value && d.tagline.value.length > 90) d.tagline.value = d.tagline.value.slice(0, 90).replace(/\s+\S*$/, "");
  // offerings: a price stays only when their own words say it (or a photo of theirs shows it, marked to check)
  const seen = new Set();
  d.offerings = (Array.isArray(r.offerings) ? r.offerings : []).map((o) => {
    const name = onlyOwn(clean(o?.name, 60), handle), k = name.toLowerCase(); if (!name || seen.has(k)) return null; seen.add(k);
    const src = okSource(o?.source, input), quoted = normPrice(o?.priceQuote) || normPrice(o?.price);
    const stated = quoted && (src?.kind === "photo" ? true : new RegExp(`\\$\\s?${quoted.slice(1).replace(".", "\\.")}(?![\\d])`).test(corpus));
    const price = stated ? quoted : "", check = !!(price && src?.kind === "photo");
    return { name, desc: onlyOwn(clean(o?.desc, 160), handle), price, priceLabel: price ? (check ? `${price}, read from your photo, check it` : price) : "price not set", priceCheck: check, source: src, from: src ? sourceLabel(src, input) : "" };
  }).filter(Boolean).slice(0, 12);
  // photos: numbers into what they gave; a cover, up to 8 for the gallery, an avatar if one is clearly there
  const n = input.photoCount || 0, pick = (v) => { const i = Math.round(+v); return i >= 1 && i <= n ? i : null; };
  d.cover = pick(r.cover?.photo ?? r.cover);
  d.gallery = [...new Set((Array.isArray(r.gallery) ? r.gallery : []).map(pick).filter(Boolean))].slice(0, 8);
  if (!d.gallery.length && n) d.gallery = Array.from({ length: Math.min(8, n) }, (_, i) => i + 1);
  if (!d.cover && d.gallery.length) d.cover = d.gallery[0];
  d.avatar = { photo: pick(r.avatar?.photo), art: artFor([d.tags.value.join(" "), d.name.value, d.about.value].join(" ")) };
  d.findings = (Array.isArray(r.findings) ? r.findings : []).map((x) => onlyOwn(clean(x, 90), handle)).filter(Boolean).slice(0, 6);
  if (!d.findings.length) d.findings = [d.name.value && `Your name: ${d.name.value}`, d.hours.value && `Your hours: ${d.hours.value}`, d.offerings.length && `${d.offerings.length} things you make`].filter(Boolean);
  return d;
}
/** A drawn avatar that fits what they do (public/avatars.js styles). */
export function artFor(text) {
  const t = String(text || "").toLowerCase();
  return /coffee|cafe|café|phin|matcha|tea|latte|espresso/.test(t) ? "barista" : /bak|bread|pastr|cake|cookie/.test(t) ? "baker" : /flower|florist|bouquet/.test(t) ? "florist" : /chef|supper|dinner|kitchen|food/.test(t) ? "chef" : /run|hike|trail/.test(t) ? "runner" : "bob";
}
