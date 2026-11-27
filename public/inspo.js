// Inspo cards: one card for the /ideas grid, the feed or anywhere else. window.PLInspo.card(item) returns HTML for an
// item from GET /api/public/inspo (types: photo, flyer, art, idea). Every card is the same calm shape: 4:5 media (a photo,
// a mini flyer in the event's own look, or an idea's illustrated cover), a quiet status word and plain tags, a full title
// over two lines, and one action: "Host this" (opens a new event from the idea; signed out, signup first, and the idea
// waits). Save, "See the real one" and the host's page sit behind a quiet More.
(function () {
  if (window.PLInspo) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const okHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
  const safeImg = (u) => (/^\/_blob\/[A-Za-z0-9]{6,40}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]{1,80}$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "") ? u : "");
  const safeUrl = (u) => (/^\/[A-Za-z0-9@_\-./#?=&%]*$/.test(u || "") && !/^\/\//.test(u) ? u : "");
  let INT = []; const intLabel = (id) => INT.find((i) => i.id === id);
  const items = new Map();

  // calm cards (lists pass): a 1.5px line, no shadow, no tilt, one 4:5 media ratio, at most one quiet status word, tags as
  // plain small text, a full title over two lines, one primary action ("Host this") and the rest behind a quiet More
  const CSS = `.fv-inspo .pli{flex:0 0 min(78vw,260px)!important;width:min(78vw,260px)!important;margin:0 !important}.fv-inspo :is(.pli-meta,.pli-more){display:none!important}
.pli{position:relative;display:flex;min-width:0;color:var(--pl-ink);font:15px/1.4 "IBM Plex Sans",system-ui,sans-serif}
.pli-card{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--pl-surface);border:1.5px solid var(--pl-line);border-radius:6px;overflow:visible;box-shadow:none;transition:border-color .2s}
@media (hover:hover){.pli:hover .pli-card{border-color:var(--pl-line-strong)}}
.pli-media{position:relative;aspect-ratio:4/5;margin:0;border-radius:5px 5px 0 0;overflow:hidden;background:var(--pl-raised)}
.pli-media img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}
@media (hover:hover){.pli-media img,.pli-media .ea-art{transition:transform .5s cubic-bezier(.2,.8,.2,1)}.pli:hover .pli-media img,.pli:hover .pli-media .ea-art{transform:scale(1.03)}}
.pli-art .ea-cover{position:absolute!important;inset:0}
.pli-body{flex:1;display:flex;flex-direction:column;gap:4px;padding:12px 14px 14px;min-width:0}
.pli-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pli-meta{margin:0;font-size:13px;line-height:1.4;color:var(--pl-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pli-meta b{font-weight:600;color:var(--pl-ink)}
.pli-title{font:600 17px/1.25 var(--sys-title);margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;text-wrap:pretty}
.pli-line{color:var(--pl-soft);font-size:14px;line-height:1.4;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pli-by{display:flex;gap:4px;min-width:0;font-size:13px;color:var(--pl-soft);margin:0;white-space:nowrap}.pli-by a{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--pl-ink);font-weight:600;text-decoration:none;padding:13px 0;margin:-13px 0}.pli-by a:hover{text-decoration:underline}
.pli-acts{display:flex;gap:8px;align-items:center;margin-top:auto;padding-top:10px}
.pli-host{flex:1;display:inline-flex;align-items:center;justify-content:center;min-width:0;min-height:44px;padding:0 14px;border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-btn,6px);background:var(--pl-surface);color:var(--pl-ink);font:600 15px "IBM Plex Sans",system-ui;cursor:pointer;box-shadow:none;text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
/* a grid of ideas reads calm with an outlined "Host this" (the feed's ideas row does the same); it fills ember on hover and press */
.pli-host:hover,.pli-host:active{background:var(--pl-accent);border-color:var(--pl-accent);color:#fff}
.pli-more{position:relative;flex:none}.pli-more>summary{list-style:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;border:1.5px solid var(--pl-line);cursor:pointer;color:var(--pl-soft);background:var(--pl-surface)}.pli-more>summary::-webkit-details-marker{display:none}
.pli-more>summary>span,.pli-more>summary>span::before,.pli-more>summary>span::after{display:block;width:4px;height:4px;border-radius:50%;background:currentColor}.pli-more>summary>span{position:relative}.pli-more>summary>span::before,.pli-more>summary>span::after{content:"";position:absolute;top:0}.pli-more>summary>span::before{left:-7px}.pli-more>summary>span::after{left:7px}
.pli-more>summary:hover,.pli-more[open]>summary{border-color:var(--pl-line-strong);color:var(--pl-ink)}
.pli-menu{position:absolute;right:0;bottom:52px;z-index:30;min-width:210px;display:grid;gap:2px;padding:6px;background:var(--pl-surface);border:1.5px solid var(--pl-line);border-radius:6px;box-shadow:0 1px 2px rgba(31,26,23,.06),0 10px 28px -16px rgba(31,26,23,.28)}
.pli-mi,.pli-menu .pls-btn{display:flex!important;align-items:center;gap:8px;width:100%!important;height:auto!important;min-height:44px;padding:0 12px!important;border:0!important;border-radius:6px!important;background:none!important;box-shadow:none!important;color:var(--pl-ink)!important;font:500 15px "IBM Plex Sans",system-ui!important;text-align:left;text-decoration:none;cursor:pointer;white-space:nowrap}
.pli-mi:hover,.pli-menu .pls-btn:hover{background:var(--pl-raised)!important}.pli-menu .pls-btn svg{width:20px;height:20px}
.pli-mnote{display:block;padding:4px 12px 6px;color:var(--pl-soft);font-size:13px}.pli-mnote:empty,.pli-mnote[hidden]{display:none}
.pli-fly{position:absolute;inset:0;background:linear-gradient(180deg,var(--f0) 0,var(--f0b) 100%);color:var(--f1);display:flex;flex-direction:column;justify-content:space-between;padding:16px 14px 14px;overflow:hidden}
.pli-fly small{font:600 13px "IBM Plex Sans",system-ui;opacity:.85;position:relative;z-index:1}
.pli-fly .pli-fb{align-self:flex-start;position:relative;z-index:1;background:var(--f2);color:var(--f2i);border-radius:999px;padding:6px 12px;font:600 13px "IBM Plex Sans",system-ui}
.pli-fly .pli-fx{position:absolute;inset:0;pointer-events:none;opacity:.5}
.fx-sparkles{background-image:radial-gradient(circle,var(--f2) 1.6px,transparent 2.2px),radial-gradient(circle,#fff 1.2px,transparent 1.8px);background-size:46px 52px,31px 37px;background-position:0 0,14px 20px}
.fx-snow{background-image:radial-gradient(circle,#fff 2.4px,transparent 3px),radial-gradient(circle,#fff 1.5px,transparent 2px);background-size:40px 44px,23px 29px;background-position:0 0,11px 15px}
.fx-confetti{background-image:linear-gradient(45deg,transparent 46%,var(--f2) 47% 53%,transparent 54%),linear-gradient(-45deg,transparent 46%,var(--f1) 47% 53%,transparent 54%);background-size:34px 40px,27px 31px;opacity:.35}
.fx-petals{background-image:radial-gradient(ellipse 6px 3px,var(--f2) 90%,transparent 100%),radial-gradient(ellipse 4px 7px,#fff 90%,transparent 100%);background-size:52px 48px,37px 41px;background-position:0 0,18px 22px;opacity:.6}
.fx-stars,.fx-twinkle{background-image:radial-gradient(circle,#FFF6D8 1.4px,transparent 2px),radial-gradient(circle,var(--f2) 1px,transparent 1.6px);background-size:28px 33px,47px 41px;background-position:0 0,9px 17px}
.fx-velvet{background:radial-gradient(120% 80% at 30% 10%,rgba(255,255,255,.18),transparent 60%),repeating-linear-gradient(90deg,rgba(0,0,0,.08) 0 2px,transparent 2px 6px)}
.fx-paper{background-image:repeating-linear-gradient(0deg,rgba(0,0,0,.04) 0 1px,transparent 1px 4px);opacity:1}
.pli-fade{animation:pliIn .45s cubic-bezier(.2,.8,.2,1) both}@keyframes pliIn{from{opacity:0;transform:translateY(8px)}}
@media (max-width:399px){.pli-body{padding:10px 12px 12px}.pli-title{font-size:16px}}
@media (prefers-reduced-motion:reduce){.pli,.pli-fade,.pli-card{transition:none;animation:none}}`;
  const css = () => { if (document.getElementById("pliCss")) return; const s = document.createElement("style"); s.id = "pliCss"; s.textContent = CSS; document.head.appendChild(s); };

  // a look's colours: page, ink, accent, and the button's text
  const lum = (h) => { const n = parseInt(h.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const shade = (h, k) => { const n = parseInt(h.slice(1), 16), f = (v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k)))); return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join(""); };
  function lookVars(L) { const p = (L?.palette || []).filter(okHex); const bg = p[0] || "#F3E7A8", dark = lum(bg) < 0.25;
    let ink = p[1] && contrast(p[1], bg) >= 4.5 ? p[1] : dark ? "#FAF8F3" : "#1B1D1C"; let acc = p[2] || p[1] || "#29489A"; if (contrast(acc, bg) < 1.4) acc = dark ? "#F3E7A8" : "#29489A";
    // the stamp's text must reach 4.5:1: nudge the accent darker (white text) or lighter (ink text) until it does
    for (let i = 0; i < 8 && Math.max(contrast("#1B1D1C", acc), contrast("#FFFFFF", acc)) < 4.5; i++) acc = shade(acc, contrast("#FFFFFF", acc) >= contrast("#1B1D1C", acc) ? -0.08 : 0.08);
    const accInk = contrast("#1B1D1C", acc) >= contrast("#FFFFFF", acc) ? "#1B1D1C" : "#FFFFFF";
    return `--f0:${bg};--f0b:${shade(bg, dark ? 0.12 : -0.08)};--f1:${ink};--f2:${acc};--f2i:${accInk}`; }
  const btnText = (L) => `${L?.buttonEmoji ? L.buttonEmoji + " " : ""}${L?.buttonLabel || "I'm in"}`;

  // the media, always 4:5: a photo, a flyer (a mini invite in the event's own look) or an idea's illustrated cover
  function media(x) {
    if (x.type === "photo") return `<div class="pli-media"><img src="${esc(safeImg(x.img))}" alt="${esc(x.title)}" loading="lazy" decoding="async"></div>`;
    if (x.type === "flyer") { const L = x.look || {}, d = x.line.split(" · ").slice(-2).join(" · ");
      return `<div class="pli-media"><div class="pli-fly" style="${lookVars(L)}"><span class="pli-fx fx-${esc(L.effect || "none")}"></span><small>${esc(x.host?.name || "")}</small><div style="display:grid;gap:8px;position:relative;z-index:1"><small>${esc(d)}</small><span class="pli-fb" aria-hidden="true">${esc(btnText(L))}</span></div></div></div>`; }
    // art and idea: the illustrated cover
    const EA = window.EventArt, i0 = intLabel((x.tags || [])[0]);
    const e = { id: x.id, title: x.title, activity: x.art?.activity || "", coverArt: x.art?.kind ? { kind: x.art.kind, ...(x.art.tone ? { tone: x.art.tone } : {}) } : null };
    // the card's own heading carries the title, so the cover shows only its label (no title three times over)
    const cov = EA ? EA.cover(e, { title: "", label: x.type === "idea" ? (i0 ? i0.label : "Idea") : undefined }) : `<div style="display:grid;place-items:center;height:100%;font-size:44px">${esc(i0?.emoji || "")}</div>`;
    return `<div class="pli-media pli-art">${cov}</div>`; }
  // at most one quiet status word: Example (made-up content) first, then Coming up, then Past (review 8: never twice)
  const statusOf = (x) => (x.example ? "Example" : x.status === "upcoming" && x.type !== "idea" ? "Coming up" : x.type === "art" && x.status !== "upcoming" ? "Past" : "");
  // the line under the title, without the title again ("Saturday Run Club: a 5k" reads "A 5k")
  const lineOf = (x) => { const t = String(x.title || "").trim(), l = String(x.line || "").trim(); if (!t || !l) return l; if (l.toLowerCase() === t.toLowerCase()) return "";
    if (l.toLowerCase().startsWith(t.toLowerCase())) { const r = l.slice(t.length).replace(/^[\s:,.\-\u2013\u2014\u00b7\u2022|]+/, ""); /* "Title · $45 a person" reads "$45 a person", no stray dot */ return r ? r[0].toUpperCase() + r.slice(1) : ""; } return l.replace(/^[\s\u00b7\u2022|]+/, ""); };
  /** One card. opts: { fade: true } to animate in. (The scrapbook tilt is gone: cards sit straight; opts.tilt is ignored.) */
  function card(x, opts = {}) { if (!x?.id) return ""; css(); items.set(x.id, x);
    const st = statusOf(x), i0 = (x.tags || [])[0], tags = (x.tags || []).slice(0, 3).filter((t, i) => !(i === 0 && t === i0 && x.type === "idea")).map((t) => intLabel(t)?.label).filter(Boolean).slice(0, 2);
    const meta = [st ? `<b>${esc(st)}</b>` : "", ...tags.map(esc)].filter(Boolean).join(" · ");
    const save = window.PLSave ? window.PLSave.button({ kind: x.save.kind, ref: x.save.ref, title: x.title, img: x.type === "photo" ? x.img : "" }) : "";
    const real = x.real?.url && safeUrl(x.real.url) ? `<a class="pli-mi" href="${esc(safeUrl(x.real.url))}">See the real one</a>` : "";
    const host = x.host?.handle ? `<a class="pli-mi" href="${esc(safeUrl(x.host.url) || "/@" + x.host.handle)}">More from ${esc(x.host.name)}</a>` : "";
    const counts = `<span class="pli-mnote" data-pls-count="${esc(x.save.kind + ":" + x.save.ref)}">${esc(window.PLSave ? window.PLSave.countLine(x.saves || 0) : "")}</span>${hostedKey(x) ? `<span class="pli-mnote pli-hosted" data-pl-hosted="${esc(hostedKey(x))}" hidden></span>` : ""}`;
    return `<article class="pli pli-${esc(x.type)}${opts.fade ? " pli-fade" : ""}" data-pli="${esc(x.id)}"><div class="pli-card">${media(x)}
      <div class="pli-body">${meta ? `<p class="pli-meta">${meta}</p>` : ""}<h3 class="pli-title">${esc(x.title)}</h3>${lineOf(x) ? `<p class="pli-line">${esc(lineOf(x))}</p>` : ""}
        ${x.host?.name ? `<p class="pli-by">by <a href="${esc(safeUrl(x.host.url) || "/@" + x.host.handle)}">${esc(x.host.name)}</a></p>` : ""}
        <div class="pli-acts"><button type="button" class="pli-host" data-pli-host="${esc(x.id)}" aria-label="Host this: ${esc(x.title)}">Host this</button><details class="pli-more"><summary aria-label="More for ${esc(x.title)}"><span aria-hidden="true"></span></summary><div class="pli-menu">${save}${real}${host}${counts}</div></details></div></div></div></article>`; }
  // "3 people hosted this after seeing it" (public/hostlike.js fills it in): an idea, or the real event a card came from
  const hostedKey = (x) => (x.type === "idea" && /^idea-[A-Za-z0-9_-]{2,110}$/.test(x.id || "") ? x.id : x.save?.kind === "event" && /^[A-Za-z0-9_-]{2,80}$/.test(x.save.ref || "") ? x.save.ref : "");
  if (!document.querySelector('script[src="/hostlike.js"],script[src^="/hostlike.js?"]')) { const s = document.createElement("script"); s.src = "/hostlike.js"; s.defer = true; (document.head || document.documentElement).appendChild(s); }

  /** "Host this": signed in, a new event from this idea; signed out, signup first and the idea waits in this browser. */
  function hostThis(id) { const x = items.get(id); try { localStorage.removeItem("pl.hostLike"); localStorage.setItem("pl.hostIdea", JSON.stringify({ id, title: x?.title || "", at: Date.now() })); } catch {}
    if (/(?:^|;\s*)encore_in=1/.test(document.cookie)) location.href = "/?app=1&idea=" + encodeURIComponent(id);
    else location.href = "/signup?mode=friends&from=idea&idea=" + encodeURIComponent(id); }
  document.addEventListener("click", (e) => { const h = e.target.closest?.("[data-pli-host]"); if (h) { e.preventDefault(); hostThis(h.dataset.pliHost); }
    document.querySelectorAll(".pli-more[open]").forEach((d) => !d.contains(e.target) && (d.open = false)); });
  // one More menu open at a time; Escape closes it
  document.addEventListener("toggle", (e) => { const d = e.target; if (d?.classList?.contains("pli-more") && d.open) { document.querySelectorAll(".pli-more[open]").forEach((o) => o !== d && (o.open = false)); fit(d.querySelector(".pli-menu")); } }, true);
  // a menu on a narrow card stays on screen: nudge it in from whichever edge it crosses
  function fit(m) { if (!m) return; m.style.transform = ""; const r = m.getBoundingClientRect(), W = document.documentElement.clientWidth; const dx = r.left < 8 ? 8 - r.left : r.right > W - 8 ? W - 8 - r.right : 0; if (dx) m.style.transform = `translateX(${Math.round(dx)}px)`; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".pli-more[open]").forEach((d) => { d.open = false; d.querySelector("summary")?.focus(); }); });
  fetch("/interests.json").then((r) => r.json()).then((j) => { INT = j.interests || []; window.dispatchEvent(new CustomEvent("pl:interests", { detail: INT })); }).catch(() => {});
  window.PLInspo = { card, css, hostThis, lookVars, interests: () => INT, setInterests: (L) => { INT = L || []; }, item: (id) => items.get(id) };
})();
