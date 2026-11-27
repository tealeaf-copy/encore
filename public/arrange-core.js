// The host page's layout ("Make it yours"): which sections show, in what order, in which style, plus the host's own
// blocks (a text, a photo or two, a quote, links, a video, a divider). One file for the browser and the server: the
// server (server/pagelayout.js) runs it in a sandbox to check a saved layout and to write the page's layout CSS into
// the HTML it sends, so a visitor's first paint is already in the host's order. The page (public/arrange.js) uses it
// to draw the blocks, and the editor (public/arrange-editor.js) to redraw as the host drags.
//
// How the order works without moving anything: with a layout on, the page's columns are flattened (display:contents)
// so every section is one flex item of <main>, and each gets `order` from a CSS variable set by selector. Sections that
// arrive late (kudos, the offer list, the fan club) land in their place the moment they are added.
(function (root) {
  "use strict";
  // ---- the page's own sections. sel: where each one lives on public/host.html. Variants: a few good ones each ----
  const SECTIONS = [
    { id: "about", label: "About", sel: ["#plAbout"], variants: [["text", "Text"], ["photo", "Text with photo"]], hint: "Your bio, in its own spot." },
    { id: "nextUp", label: "Next up", sel: ["#nextUp"], variants: [["full", "Big card"], ["slim", "Slim"]], hint: "Your very next date, up top." },
    { id: "offer", label: "Coming up", sel: ["#offer", ".s-coming", "#book"], variants: [["list", "List"], ["cards", "Cards"], ["carousel", "Carousel"]], hint: "Events to join and things to order." },
    { id: "drops", label: "Order ahead", sel: ["#plDrops"], variants: [["list", "List"], ["cards", "Cards"]], hint: "Your drops, on their own." },
    { id: "book", label: "Book me", sel: ["#plBook"], variants: [["list", "List"], ["cards", "Cards"]], hint: "What teams and groups can book." },
    { id: "kudos", label: "Kudos", sel: ["#kudos"], variants: [["quotes", "Quotes"], ["carousel", "Carousel"]], hint: "What guests said." },
    { id: "photos", label: "Photos", sel: [".s-photos", ".s-work"], variants: [["grid", "Grid"], ["mosaic", "Mosaic"], ["hero", "One big photo"]], hint: "Moments and recent work." },
    { id: "past", label: "Past events", sel: ["#scrapbook", ".s-past", "#srChangelog"], variants: [], hint: "Your scrapbook." },
    { id: "club", label: "Fan club", sel: ["#club"], variants: [], hint: "Regulars hear first." },
    { id: "members", label: "Memberships", sel: ["#membership"], variants: [], hint: "Paid seats for regulars." },
    { id: "support", label: "Support", sel: [".card.sup"], variants: [], hint: "Tips, pledges and the wishlist." },
    { id: "follow", label: "Follow", sel: ["#follow", "#collabCard"], variants: [], hint: "Hear about the next one." },
    { id: "brand", label: "Work with me", sel: ["#hire", "#owHire", "#forTeams"], variants: [], hint: "For brands and teams." },
    { id: "proof", label: "Track record", sel: ["#proof", "#turnout", ".s-profile"], variants: [], hint: "Numbers that build trust." },
    { id: "places", label: "Places", sel: ["#plPlacesPub"], variants: [], hint: "Where you've hosted." },
    { id: "lists", label: "Lists", sel: ["#pllHost", "#pllShelf"], variants: [], hint: "Lists you're on and lists you made." },
    { id: "recs", label: "Recommended hosts", sel: [".recs", ".rec-by"], variants: [], hint: "Hosts you vouch for." },
  ];
  const BY = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
  // today's order, top to bottom on a phone: what a page with no saved layout already shows
  const DEFAULT = ["about", "nextUp", "offer", "drops", "book", "kudos", "past", "photos", "brand", "follow", "club", "members", "support", "proof", "places", "lists", "recs"];
  // Order ahead and Book me are rows of Coming up until the host gives them their own section: off by default
  const SPLIT = new Set(["drops", "book"]);
  // the header (cover and name) stays on top; it has styles of its own
  const COVER = [["tall", "Tall cover"], ["slim", "Slim cover"], ["none", "No cover"]];
  // ---- the host's own blocks ----
  const BLOCKS = {
    text: { label: "Text", variants: [["plain", "Plain"], ["big", "Big words"], ["card", "Card"]], hint: "A few lines in your words." },
    photo: { label: "Photo", variants: [["wide", "Wide"], ["framed", "Framed"]], hint: "One photo, or a pair." },
    quote: { label: "Quote", variants: [["big", "Big"], ["card", "Card"]], hint: "A line someone said." },
    links: { label: "Links", variants: [["list", "List"], ["buttons", "Buttons"]], hint: "Your shop, your playlist, anywhere." },
    video: { label: "Video", variants: [], hint: "A short clip you upload." },
    divider: { label: "Divider", variants: [["line", "Line"], ["dots", "Dots"], ["wave", "Wave"]], hint: "A breath between sections." },
  };
  const MAX_ITEMS = 40, MAX_BLOCKS = 16;
  const BLOB = /^\/_blob\/[A-Za-z0-9]{20}$/, HTTPS = /^https:\/\/[^\s<>"']{3,400}$/i;
  // plain text: no control characters (newlines kept), no bidi overrides or zero-width tricks, trimmed and capped
  const txt = (v, n, lines = false) => String(v ?? "").replace(/\r\n?/g, "\n").replace(lines ? /[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g : /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, lines ? "" : " ").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, n);
  const vOk = (list, v) => !v || list.some((x) => x[0] === v);

  /**
   * Check a layout from the editor. Anything off the allow-list is refused, not quietly dropped, so the editor learns.
   * opts.imgOk(url, "image" | "video") says whether a /_blob file is the host's own upload.
   * Returns { layout } or { error }.
   */
  function check(L, opts = {}) {
    const imgOk = opts.imgOk || (() => false);
    if (!L || typeof L !== "object" || Array.isArray(L)) return { error: "That layout isn't readable." };
    const items = L.items; if (!Array.isArray(items)) return { error: "That layout has no sections." };
    if (items.length > MAX_ITEMS) return { error: `A page holds up to ${MAX_ITEMS} sections.` };
    if (L.cover != null && !vOk(COVER, L.cover)) return { error: "That cover style isn't one we have." };
    const out = [], seen = new Set(); let blocks = 0;
    for (const it of items) {
      if (!it || typeof it !== "object") return { error: "A section in that layout isn't readable." };
      const id = String(it.id || "");
      if (seen.has(id)) return { error: "A section is in there twice." }; seen.add(id);
      if (BY[id]) { if (it.type != null) return { error: "That section can't change type." }; if (!vOk(BY[id].variants, it.v)) return { error: `${BY[id].label} doesn't have that style.` };
        out.push({ id, ...(it.v ? { v: it.v } : {}), ...(it.off ? { off: true } : {}) }); continue; }
      if (!/^b-[a-z0-9]{4,12}$/.test(id)) return { error: "That section isn't one we know." };
      const B = BLOCKS[it.type]; if (!B) return { error: "That kind of block isn't one we have." };
      if (!vOk(B.variants, it.v)) return { error: `${B.label} doesn't have that style.` };
      if (++blocks > MAX_BLOCKS) return { error: `Up to ${MAX_BLOCKS} of your own blocks.` };
      const d = it.data && typeof it.data === "object" ? it.data : {}, o = { id, type: it.type, ...(it.v ? { v: it.v } : {}), ...(it.off ? { off: true } : {}) };
      if (it.type === "text") o.data = { title: txt(d.title, 80), body: txt(d.body, 1200, true) };
      else if (it.type === "quote") o.data = { text: txt(d.text, 280, true), by: txt(d.by, 60) };
      else if (it.type === "photo") { const urls = Array.isArray(d.urls) ? d.urls.map(String) : [];
        if (urls.length > 2) return { error: "A photo block holds one photo or a pair." };
        for (const u of urls) if (!BLOB.test(u) || !imgOk(u, "image")) return { error: "Photos come from your own uploads." };
        o.data = { urls, caption: txt(d.caption, 140) }; }
      else if (it.type === "video") { const u = String(d.url || ""); if (u && (!BLOB.test(u) || !imgOk(u, "video"))) return { error: "Videos come from your own uploads." }; o.data = { url: u, caption: txt(d.caption, 140) }; }
      else if (it.type === "links") { const L2 = Array.isArray(d.items) ? d.items : []; if (L2.length > 8) return { error: "Up to 8 links in a block." };
        const li = []; for (const x of L2) { const url = String(x?.url || "").trim(); if (!url) continue; if (!HTTPS.test(url)) return { error: "Links start with https://" }; li.push({ label: txt(x?.label, 60), url }); }
        o.data = { title: txt(d.title, 60), items: li }; }
      else o.data = {};
      out.push(o);
    }
    return { layout: { v: 1, cover: L.cover && vOk(COVER, L.cover) ? L.cover : "tall", items: out } };
  }

  /** The layout a page has before the host arranges anything: today's order, every section on. */
  const defaults = () => ({ v: 1, cover: "tall", items: DEFAULT.map((id) => ({ id, ...(SPLIT.has(id) ? { off: true } : {}) })) });
  /** The built-in sections a layout leaves out (new ones, say) go after it, in today's order. */
  function full(L) { const items = (L?.items || []).slice(), have = new Set(items.map((x) => x.id)); for (const id of DEFAULT) if (!have.has(id)) items.push({ id, ...(SPLIT.has(id) ? { off: true } : {}) }); return { v: 1, cover: L?.cover || "tall", items }; }

  // ---- the CSS: flatten the columns, order by variable, hide what's off, and each style ----
  const PINNED = [".bk-sug", ".pv-note", ".sc-note", ".ex-note", ".photo-nudge", "#hNext", ".cover", ".head"];
  const ALL = () => [...SECTIONS.flatMap((s) => s.sel), ".plb"];
  const STATIC = `html.pl-lay #m{display:flex;flex-direction:column;max-width:860px;margin-inline:auto}
html.pl-lay #m :is(.cols,.cols>div,aside.side,#extras,#sideExtras){display:contents}
html.pl-lay #m>*,html.pl-lay #m .cols>div>*,html.pl-lay #m aside.side>*,html.pl-lay #m #extras>*,html.pl-lay #m #sideExtras>*{order:var(--pl-o,800)}
html.pl-lay #m :is(${ALL().join(",")}){margin-top:var(--pl-gap,24px);margin-bottom:0}
html.pl-lay body:not(.is-owner) #offer.pla-emptied{display:none}html.pl-lay #m .head{margin-bottom:-8px}html.pl-lay #m .head .bio{display:none}html.pl-lay #m .sf-foot{--pl-o:1000}
${PINNED.map((s, i) => `html.pl-lay #m ${s}{--pl-o:${i - 20}}`).join("")}
html.pl-lay.plc-slim #m .cover{height:120px}html.pl-lay.plc-none #m .cover{display:none}html.pl-lay.plc-none #m .head{margin-top:16px}html.pl-lay.plc-none #m .head>div:nth-child(2){padding-top:8px}
html.plv-nextUp-slim #nextUp .nu-cover,html.plv-nextUp-slim #nextUp .nu-menu,html.plv-nextUp-slim #nextUp .nu-for{display:none}html.plv-nextUp-slim #nextUp{padding:16px 18px}
html:is(.plv-offer-cards,.plv-drops-cards,.plv-book-cards) :is(#offer,#plDrops,#plBook) .of-list{grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))}
html.plv-offer-cards #offer .of-row,html.plv-drops-cards #plDrops .of-row,html.plv-book-cards #plBook .of-row{grid-template-columns:minmax(0,1fr);align-content:start}
html.plv-offer-cards #offer .of-art,html.plv-drops-cards #plDrops .of-art,html.plv-book-cards #plBook .of-art{width:100%;height:auto;aspect-ratio:4/3}
html.plv-offer-cards #offer .of-art img,html.plv-drops-cards #plDrops .of-art img,html.plv-book-cards #plBook .of-art img{width:100%;height:100%;object-fit:cover}
html.plv-offer-cards #offer .of-go,html.plv-drops-cards #plDrops .of-go,html.plv-book-cards #plBook .of-go{justify-self:start}
html.plv-offer-carousel #offer .of-list{grid-auto-flow:column;grid-auto-columns:min(82%,300px);grid-template-columns:none;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;overscroll-behavior-x:contain}
html.plv-offer-carousel #offer .of-row{scroll-snap-align:start;grid-template-columns:minmax(0,1fr);align-content:start}html.plv-offer-carousel #offer .of-art{width:100%;height:auto;aspect-ratio:4/3}html.plv-offer-carousel #offer .of-art img{width:100%;height:100%;object-fit:cover}html.plv-offer-carousel #offer .of-go{justify-self:start}
html.plv-kudos-carousel #kudos .kd-list{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:min(84%,320px);overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;padding-bottom:6px}html.plv-kudos-carousel #kudos .kd-list>*{scroll-snap-align:start}
html.plv-photos-mosaic :is(.s-photos,.s-work) .gal{grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-flow:dense}html.plv-photos-mosaic :is(.s-photos,.s-work) .gal>:nth-child(5n+1){grid-column:span 2;grid-row:span 2}
html.plv-photos-hero :is(.s-photos,.s-work) .gal{grid-template-columns:minmax(0,1fr)}html.plv-photos-hero :is(.s-photos,.s-work) .gal>:first-child{aspect-ratio:3/2}html.plv-photos-hero :is(.s-photos,.s-work) .gal>:not(:first-child){display:none}html.plv-photos-hero .s-work+.s-photos,html.plv-photos-hero .s-photos~.s-work{display:none}
.plb{color:var(--ink,var(--pl-ink,#1B1D1C))}.plb h2{font-size:24px;line-height:1.2;margin:0 0 8px}.plb p{margin:0 0 10px;font-size:17px;line-height:1.6;overflow-wrap:anywhere}.plb p:last-child{margin-bottom:0}
.plb-big p{font-size:24px;line-height:1.35;font-weight:500}.plb-card{padding:20px;border:1.5px solid var(--line,var(--pl-line,#CFC8B9));border-radius:6px;background:var(--card,#fff)}
.plb-ph{display:grid;gap:8px;grid-template-columns:repeat(var(--n,1),minmax(0,1fr))}.plb-ph img{width:100%;aspect-ratio:var(--ar,3/2);object-fit:cover;border-radius:6px;display:block}.plb-framed .plb-ph img{border:6px solid var(--card,#fff);box-shadow:0 0 0 1.5px var(--line,#CFC8B9)}.plb figcaption,.plb .plb-cap{margin-top:6px;font-size:14px;color:var(--soft,var(--pl-soft,#444845))}
.plb-quote blockquote{margin:0;font-size:24px;line-height:1.35;font-weight:500}.plb-quote.plb-card blockquote{font-size:20px}.plb-quote cite{display:block;margin-top:8px;font-style:normal;font-size:16px;color:var(--soft,var(--pl-soft,#444845))}
.plb-links ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}.plb-links a{display:flex;align-items:center;min-height:44px;padding:0 16px;border:1.5px solid var(--line,var(--pl-line,#CFC8B9));border-radius:var(--radius,6px);color:inherit;text-decoration:none;font-weight:600;background:var(--card,#fff)}
.plb-buttons ul{display:flex;flex-wrap:wrap}.plb-buttons a{background:var(--accent,var(--c,#29489A));color:var(--on-brand,#fff);border-color:transparent}
.plb-video video{width:100%;border-radius:6px;display:block;background:#000}
.plb-divider{height:24px;display:grid;place-items:center}.plb-divider::before{content:"";width:100%;border-top:1.5px solid var(--line,var(--pl-line,#CFC8B9))}.plb-dots::before{width:72px;height:6px;border:0;background:radial-gradient(circle,var(--soft,#444845) 2.5px,transparent 3px) 0 0/24px 6px repeat-x}
.plb-wave::before{border:0;height:10px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='10'%3E%3Cpath d='M0 5q10-8 20 0t20 0' fill='none' stroke='%23857F73' stroke-width='1.5'/%3E%3C/svg%3E") 0 0/40px 10px repeat-x}
#plAbout .pla-ab{display:grid;gap:18px;align-items:center}#plAbout p{font-size:17px;line-height:1.6;margin:0;max-width:62ch}html.plv-about-photo #plAbout .pla-ab{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)}#plAbout img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px;display:none}html.plv-about-photo #plAbout img{display:block}
@media (max-width:600px){html.plv-about-photo #plAbout .pla-ab{grid-template-columns:minmax(0,1fr)}html.plv-about-photo #plAbout img{aspect-ratio:3/2}}`;
  const sid = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "");
  /** The CSS for one layout: each section's place and whether it's off. The styles are classes on <html> (classes()). */
  function css(L) { const F = full(L), rules = []; let n = 0;
    for (const it of F.items) { const S = BY[it.id], sel = S ? S.sel : [`[data-pl="${sid(it.id)}"]`]; n++;
      rules.push(`html.pl-lay #m :is(${sel.join(",")}){--pl-o:${n}}`);
      if (it.off) rules.push(`html.pl-lay #m :is(${sel.join(",")}){display:none!important}`); }
    return STATIC + "\n" + rules.join("\n"); }
  /** The classes <html> wears for a layout: pl-lay, the cover style, and one per section style. */
  function classes(L) { const F = full(L), c = ["pl-lay", "plc-" + (F.cover || "tall")]; for (const it of F.items) if (BY[it.id] && it.v) c.push(`plv-${it.id}-${it.v}`); return c; }

  // ---- blocks, drawn ----
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const para = (t) => esc(t).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
  /** One of the host's blocks as HTML. `edit`: the editor's empty states ("Tap Edit to write something"). */
  function blockHtml(b, { edit = false } = {}) { const d = b.data || {}, v = b.v || (BLOCKS[b.type]?.variants[0] || [""])[0], cls = `plb plb-${b.type} plb-${v}`, a = `class="${cls}" data-pl="${sid(b.id)}"`;
    const empty = (t) => (edit ? `<p class="pla-empty">${esc(t)}</p>` : "");
    if (b.type === "text") { if (!d.title && !d.body && !edit) return ""; return `<section ${a}>${d.title ? `<h2>${esc(d.title)}</h2>` : ""}${d.body ? para(d.body) : empty("Tap Edit and say it in your words.")}</section>`; }
    if (b.type === "quote") { if (!d.text && !edit) return ""; return `<section ${a}>${d.text ? `<blockquote>${para(d.text)}</blockquote>${d.by ? `<cite>${esc(d.by)}</cite>` : ""}` : empty("Tap Edit to add a line someone said.")}</section>`; }
    if (b.type === "photo") { const U = (d.urls || []).filter((u) => BLOB.test(u)); if (!U.length && !edit) return "";
      return `<section ${a}>${U.length ? `<figure style="margin:0"><div class="plb-ph" style="--n:${U.length};--ar:${U.length > 1 ? "4/5" : "3/2"}">${U.map((u) => `<img src="${esc(u)}" alt="${esc(d.caption || "")}" loading="lazy">`).join("")}</div>${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ""}</figure>` : empty("Tap Edit to pick a photo. Try your best one.")}</section>`; }
    if (b.type === "video") { if (!BLOB.test(d.url || "") && !edit) return ""; return `<section ${a}>${BLOB.test(d.url || "") ? `<video src="${esc(d.url)}" controls playsinline preload="metadata"></video>${d.caption ? `<p class="plb-cap">${esc(d.caption)}</p>` : ""}` : empty("Tap Edit to add a short clip.")}</section>`; }
    if (b.type === "links") { const L = (d.items || []).filter((x) => HTTPS.test(x.url || "")); if (!L.length && !edit) return "";
      return `<section ${a}>${d.title ? `<h2>${esc(d.title)}</h2>` : ""}${L.length ? `<ul>${L.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener nofollow">${esc(x.label || x.url.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a></li>`).join("")}</ul>` : empty("Tap Edit to add a link.")}</section>`; }
    if (b.type === "divider") return `<div ${a} role="presentation"></div>`;
    return ""; }

  // ---- starter layouts: one tap, an order plus styles, matched to the kind of host ----
  const STARTERS = [
    { id: "supper", label: "Supper club", line: "Your table first, then the photos.", cover: "tall", order: [["about", "photo"], ["nextUp", "full"], ["offer", "cards"], ["photos", "mosaic"], ["kudos", "quotes"], ["club"], ["follow"], ["past"], ["support"]] },
    { id: "run", label: "Run club", line: "The next run, then the crew.", cover: "slim", order: [["nextUp", "slim"], ["offer", "list"], ["kudos", "carousel"], ["photos", "grid"], ["club"], ["members"], ["follow"], ["places"], ["about", "text"], ["past"]] },
    { id: "maker", label: "Maker / drops", line: "What's for sale, big and first.", cover: "tall", order: [["drops", "cards"], ["photos", "hero"], ["about", "photo"], ["offer", "cards"], ["kudos", "carousel"], ["follow"], ["club"], ["past"]] },
    { id: "workshop", label: "Workshop host", line: "What to book, who you are, what people said.", cover: "tall", order: [["book", "cards"], ["about", "photo"], ["offer", "list"], ["kudos", "quotes"], ["photos", "grid"], ["past"], ["follow"], ["proof"]] },
    { id: "brand", label: "Brand-ready", line: "Proof up top for brand partners.", cover: "slim", order: [["about", "photo"], ["proof"], ["brand"], ["photos", "mosaic"], ["kudos", "carousel"], ["offer", "list"], ["past"], ["follow"]] },
  ];
  /** A starter, as a layout. The host's own blocks keep their place after the starter's sections. */
  function starter(id, cur) { const S = STARTERS.find((x) => x.id === id) || STARTERS[0], items = S.order.map(([sec, v]) => ({ id: sec, ...(v ? { v } : {}) }));
    const have = new Set(items.map((x) => x.id)); for (const it of cur?.items || []) if (!BY[it.id] && !have.has(it.id)) items.push(it);
    for (const sid2 of DEFAULT) if (!have.has(sid2)) items.push({ id: sid2, ...(SPLIT.has(sid2) ? { off: true } : {}) }); return { v: 1, cover: S.cover, items }; }
  /** Which starter fits a host: what they make and how they host. facts: { kind, drops, experiences, forHire, ... } */
  function kindOf(f = {}) { if (f.kind && STARTERS.some((s) => s.id === f.kind)) return f.kind;
    const a = String(f.activity || "").toLowerCase();
    if (/run|walk|ride|bike|hike|swim|yoga|workout|fitness/.test(a)) return "run";
    if (f.drops > 0 && f.drops >= (f.upcoming || 0)) return "maker";
    if (/dinner|supper|cook|potluck|brunch|food|tasting/.test(a) && (f.upcoming || 0) >= (f.experiences || 0)) return "supper";
    if (f.experiences > 0) return "workshop";
    if (/dinner|supper|cook|potluck|brunch|food|tasting/.test(a)) return "supper";
    if (f.forHire || f.brandKit) return "brand";
    return "supper"; }

  /**
   * Potto's suggestion, plain rules: what the host has decides the order. facts: { photos, kudos, upcoming, drops,
   * experiences, forHire, brandKit, bio, activity }. Returns { layout, kind, tips }.
   */
  function suggest(f = {}, cur) { const kind = kindOf(f), L = starter(kind, cur), tips = [];
    const at = (id) => L.items.findIndex((x) => x.id === id), move = (id, to) => { const i = at(id); if (i < 0) return; const [x] = L.items.splice(i, 1); L.items.splice(Math.max(0, Math.min(to, L.items.length)), 0, x); };
    const set = (id, v) => { const x = L.items[at(id)]; if (x) x.v = v; };
    const has = { photos: (f.photos || 0) > 0, kudos: (f.kudos || 0) > 0, nextUp: (f.upcoming || 0) > 0, offer: (f.upcoming || 0) + (f.drops || 0) + (f.experiences || 0) > 0, drops: (f.drops || 0) > 0, book: (f.experiences || 0) > 0, about: !!f.bio, brand: !!f.forHire };
    if (has.nextUp && kind !== "maker" && kind !== "workshop") move("nextUp", 0);
    if ((f.photos || 0) >= 3) { move("photos", has.nextUp ? 1 : 0); set("photos", f.photos >= 5 ? "mosaic" : "grid"); tips.push("Try your best photo first. People decide in a second."); }
    else if (f.photos === 1 || f.photos === 2) { set("photos", "hero"); tips.push("One good photo goes a long way. Add a few more when you can."); }
    if ((f.kudos || 0) >= 3) { move("kudos", Math.min(at("offer") + 1, 3)); set("kudos", f.kudos >= 6 ? "carousel" : "quotes"); tips.push("Your kudos sit near the top. Guests trust guests."); }
    if (!has.nextUp && has.offer) tips.push("Nothing dated yet, so what you offer leads.");
    if (has.about) set("about", f.photos > 0 || f.cover ? "photo" : "text"); else tips.push("Add a short bio. Two lines is plenty.");
    // sections with nothing in them yet go to the end, in order, so the top of the page is all real
    const empty = Object.keys(has).filter((k) => !has[k]); for (const k of empty) { const i = at(k); if (i >= 0) { const [x] = L.items.splice(i, 1); L.items.push(x); } }
    if (!tips.length) tips.push("This order follows what you have. Drag anything to make it yours.");
    return { layout: L, kind, tips: tips.slice(0, 2) }; }

  root.PLLayout = { SECTIONS, BY, DEFAULT, SPLIT, COVER, BLOCKS, STARTERS, MAX_ITEMS, MAX_BLOCKS, check, defaults, full, css, classes, blockHtml, starter, kindOf, suggest, esc, STATIC };
})(typeof window !== "undefined" ? window : globalThis);
