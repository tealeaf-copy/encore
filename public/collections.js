// Collections on Discover: quiet themed shelves ("Quiet and nerdy", "Good for going solo", "This weekend near you"...)
// that scroll sideways, each with "See all" to its own page (/c/<id>, public/collections.html). The shelves come from
// GET /api/public/collections (server/collections.js): real public events and hosts only, ideas to host when a shelf is
// thin. Discover's hook is one empty <section id="plShelves" data-calm="discover"> and this script.
//
//   PLCollections.shelves(el, { city })   draw the shelves into el
//   PLCollections.page(el, id, { city })  draw one collection: a short intro and a calm two-column grid
//   PLCollections.card(e)                 one event card (also used by the page)
(function () {
  if (window.PLCollections) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // the city Discover shows (its location chip), else the one this browser saved
  const city = () => { const n = document.getElementById("locName")?.textContent?.trim(); if (n && n !== "Anywhere") return n; if (n === "Anywhere") return ""; try { return localStorage.getItem("encore.city") || ""; } catch { return ""; } };
  const day = (d) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) return ""; const x = new Date(d + "T12:00:00"); return x.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  const SAFE = (u) => /^\/[A-Za-z0-9_\-./?=&%#@]*$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "");
  const IMG = (u) => /^\/_blob\/[A-Za-z0-9]{20}$/.test(u || "") || /^\/presets\/[A-Za-z0-9_.-]+$/.test(u || "") || /^https:\/\/[^\s"'<>()]+$/.test(u || "");
  const cap = (t) => { t = String(t || "").trim(); return t && t !== "other" ? t.charAt(0).toUpperCase() + t.slice(1) : ""; };
  const media = (e) => IMG(e.cover) ? `<img src="${esc(e.cover)}" alt="" loading="lazy">` : window.EventArt ? window.EventArt.cover({ title: e.title, activity: e.format, date: e.date }, { title: "", label: "" }) : "";
  // Save to list on each card, and for the whole collection on its page: public/savelist.js opens the sheet for any
  // [data-pl-savelist] (collections.html loads it; Discover gets it through public/save.js)
  const LIST_IC = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M4 6.5h11M4 12h11M4 17.5h7M18.5 14v7M15 17.5h7"/></svg>`;
  const saveList = (it) => (/^[A-Za-z0-9_-]{2,80}$/.test(it.ref || "") ? `<button type="button" class="plk-sl" data-pl-savelist="${esc(JSON.stringify(it))}" aria-label="Save to list: ${esc(it.title || "")}">${LIST_IC}</button>` : "");
  function card(e) { const url = SAFE(e.url) ? e.url : "/e/" + encodeURIComponent(e.id);
    const meta = [cap(e.format), e.price && e.price !== "Free" ? e.price : e.price === "Free" ? "Free" : "", (e.comfort || [])[0] || ""].filter(Boolean).slice(0, 2).join(" · ");
    return `<article class="ls-card plk-card"><div class="ls-media">${media(e)}</div>${saveList({ kind: "event", ref: e.id, title: e.title, img: IMG(e.cover) && /^\//.test(e.cover) ? e.cover : "" })}<div class="ls-body">${window.EventTypes ? window.EventTypes.tag({ ...e, activity: e.format }, { cls: "pl-type--b" }) : ""}<p class="ls-when">${esc([day(e.date), e.time].filter(Boolean).join(" · "))}</p>
      <a class="ls-title" href="${esc(url)}">${esc(e.title)}</a><p class="ls-sub">${e.host?.name ? "by " + esc(e.host.name) : ""}${e.area || e.city ? `${e.host?.name ? "&nbsp;· " : ""}<span style="white-space:nowrap">${esc(e.area || e.city)}</span>` : ""}</p>${meta ? `<p class="ls-meta">${esc(meta)}</p>` : ""}</div></article>`; }
  function ideaCard(x) { return `<article class="ls-card plk-card plk-idea"><div class="ls-media">${window.EventArt ? window.EventArt.cover({ title: x.title }, { title: "", label: "", kind: x.art, tone: x.tone }) : ""}</div><div class="ls-body"><p class="ls-when plk-tag">An idea to host</p>
      <a class="ls-title" href="${esc(SAFE(x.url) ? x.url : "/ideas")}">${esc(x.title)}</a><p class="ls-sub">${esc(x.line || "")}</p></div></article>`; }
  const face = (h) => { if (/^\/_blob\/[A-Za-z0-9]{20}$/.test(h.avatarUrl || "")) return `<img src="${esc(h.avatarUrl)}" alt="">`; if (h.avatarArt && window.EncoreAvatars) return window.EncoreAvatars.svg(h.avatarArt, h.accent || "#9A4128", 48); return `<span>${esc((h.name || "?").trim().charAt(0).toUpperCase())}</span>`; };
  function hostCard(h) { return `<article class="plk-host"><span class="plk-av" aria-hidden="true">${face(h)}</span><div class="plk-hid"><a class="plk-hn" href="/@${encodeURIComponent(h.handle)}">${esc(h.name)}</a>
      <small>${esc([h.area || h.city, h.again].filter(Boolean).join(" · "))}</small>${h.next ? `<a class="plk-nx" href="${esc(SAFE(h.next.url) ? h.next.url : "/e/" + encodeURIComponent(h.next.id))}"><b>Next</b> <span>${esc([day(h.next.date), h.next.title].filter(Boolean).join(" · "))}</span></a>` : ""}</div></article>`; }
  const CSS = `
section.plk-shelves{display:grid;gap:28px;margin:4px 0 8px;padding:8px 0 0}section.plk-sh{padding:0}
.plk-shelves:empty{display:none}
.plk-slc{display:inline-flex;align-items:center;gap:8px;min-height:44px;margin:12px 0 0;padding:0 14px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}.plk-slc:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.plk-card .plk-sl{position:absolute;top:8px;right:8px;z-index:2;width:44px;height:44px;display:grid;place-items:center;border-radius:999px;border:1.5px solid var(--pl-ink,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);cursor:pointer;padding:0}.plk-card .plk-sl:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.plk-sh h2{font:600 var(--fs-20-28,20px)/1.2 var(--sys-title);margin:0;letter-spacing:-.015em}
.plk-hd{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.plk-hd a{flex:none;display:inline-flex;align-items:center;min-height:44px;color:var(--pl-accent-text);font:600 14px var(--sys-sans);text-decoration:none}
.plk-hd a:hover{text-decoration:underline;text-underline-offset:3px}
.plk-sh>p{margin:0 0 10px;color:var(--pl-soft);font-size:14px;max-width:60ch}
.plk-row{display:grid;grid-auto-flow:column;grid-auto-columns:min(62%,240px);gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;scrollbar-width:none;margin:0 -16px;padding:2px 16px 6px;scroll-padding:0 16px}
.plk-row::-webkit-scrollbar{display:none}.plk-row>*{scroll-snap-align:start}
@media (min-width:861px){.plk-row{grid-auto-columns:240px}}
.plk-card .ls-media{aspect-ratio:3/2}.plk-row .ls-body{padding:12px 12px 14px}.plk-row .ls-title{font-size:17px}.plk-others{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.plk-others b{flex:1 1 100%;font:400 20px/1.2 var(--sys-title);letter-spacing:-.015em;margin:0 0 4px}.plk-card .ea-txt{display:none}.plk-card .ls-title{font-size:18px}
.plk-tag{font-family:var(--sys-sans)!important;color:var(--pl-soft)!important}
.plk-idea{background:transparent;border-style:dashed;border-color:var(--pl-line-strong)}
.plk-host{position:relative;display:grid;grid-template-columns:48px minmax(0,1fr);gap:12px;align-items:start;padding:14px;background:var(--pl-surface);border:1px solid var(--pl-line);border-radius:var(--pl-r-md);min-width:0}
.plk-av{width:48px;height:48px;border-radius:50%;overflow:hidden;background:var(--pl-raised);display:grid;place-items:center;font:600 18px var(--sys-sans);color:var(--pl-soft)}.plk-av img,.plk-av svg{width:48px;height:48px;object-fit:cover;display:block}
.plk-hid{min-width:0;display:grid;gap:2px}.plk-hn{font:600 16px/1.3 var(--sys-title);color:var(--pl-ink);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plk-hn::after{content:"";position:absolute;inset:0;border-radius:inherit}.plk-hid small{color:var(--pl-soft);font-size:13px;line-height:1.35}
.plk-nx{position:relative;z-index:1;display:flex;gap:6px;min-height:40px;align-items:center;margin-top:6px;padding:6px 10px;border-radius:var(--pl-r-sm);background:var(--pl-page);color:var(--pl-ink);text-decoration:none;font-size:13px;min-width:0}
.plk-nx b{flex:none;color:var(--pl-accent-text);font-weight:600}.plk-nx span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plk-hosts{display:grid;gap:10px;grid-template-columns:1fr}@media (min-width:700px){.plk-hosts{grid-template-columns:repeat(2,minmax(0,1fr))}}
.plk-row .plk-host{width:auto}
/* one collection: a short intro and a calm two-column grid */
.plk-page .plk-intro{max-width:620px;margin:4px 0 20px}
.plk-page h1{font:600 var(--fs-28-40,28px)/1.08 var(--sys-display);letter-spacing:-.015em;margin:0}
.plk-page .plk-intro p{margin:8px 0 0;color:var(--pl-soft);font-size:16px;line-height:1.5}
.plk-page .plk-n{display:block;margin-top:10px;font:500 13px var(--sys-mono);color:var(--pl-muted)}
.plk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 12px}
@media (min-width:861px){.plk-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 16px}}
.plk-grid .ls-body{padding:12px 12px 14px}.plk-grid .ls-title{font-size:17px}
@media (max-width:420px){.plk-grid .ls-sub{font-size:13px}.plk-grid .ls-meta{display:none}}
.plk-sub{font:400 20px/1.2 var(--sys-title);margin:32px 0 6px}.plk-subp{margin:0 0 12px;color:var(--pl-soft);font-size:14px}
.plk-more{display:flex;flex-wrap:wrap;gap:8px;margin:32px 0 0}.plk-more a{text-decoration:none}
.plk-empty{display:grid;justify-items:center;text-align:center;gap:8px;padding:32px 16px;color:var(--pl-soft)}.plk-empty b{font:400 20px/1.25 var(--sys-title);color:var(--pl-ink)}.plk-empty p{margin:0;max-width:40ch}`;
  function css() { if (document.getElementById("plkCss")) return; const s = document.createElement("style"); s.id = "plkCss"; s.textContent = CSS; document.head.appendChild(s); }
  const get = async (u) => { const r = await fetch(u, { credentials: "same-origin" }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };

  // while the shelves load, quiet placeholders the size of the real ones hold their place, so "Coming up" below
  // doesn't jump down the page when they land (it was Discover's biggest layout shift)
  const skelCard = `<article class="ls-card plk-card" aria-hidden="true"><div class="ls-media ls-skel" style="aspect-ratio:3/2;border-radius:0"></div><div class="ls-body"><p class="ls-when">&nbsp;</p><span class="ls-title">&nbsp;</span><p class="ls-sub">&nbsp;</p></div></article>`;
  const skeleton = (n) => Array.from({ length: n }, () => `<section class="plk-sh" aria-hidden="true"><div class="plk-hd"><h2>&nbsp;</h2></div><p>&nbsp;</p><div class="plk-row">${skelCard.repeat(3)}</div></section>`).join("");
  async function shelves(el, { city: c = city(), max = 0 } = {}) { if (!el) return []; css();
    let seen = -1; try { const v = localStorage.getItem("plk.n"); seen = v == null ? -1 : +v; } catch {}
    // reserve room only for the shelves the last visit really had, so an empty answer doesn't pull the page up under the reader
    if (!el.children.length && seen > 0) { el.classList.add("plk-shelves"); el.setAttribute("aria-busy", "true"); el.innerHTML = skeleton(Math.min(max || 3, seen)); }
    let L = []; try { L = (await get("/api/public/collections" + (c ? "?city=" + encodeURIComponent(c) : ""))).collections || []; } catch { L = []; }
    el.classList.add("plk-shelves"); el.removeAttribute("aria-busy");
    // each shelf leads with a card no shelf above it led with, so the row of shelves never opens on the same event twice
    const led = new Set(); for (const x of L) { if (x.kind === "hosts" || !x.events.length) continue; const i = x.events.findIndex((e) => !led.has(e.id)); if (i > 0) x.events.unshift(...x.events.splice(i, 1)); led.add(x.events[0].id); }
    const shown = max ? L.slice(0, max) : L, rest = max ? L.slice(max) : []; try { localStorage.setItem("plk.n", String(shown.length)); } catch {}
    el.innerHTML = (shown.length ? shown.map((x) => `<section class="plk-sh" aria-labelledby="plk-${esc(x.id)}"><div class="plk-hd"><h2 id="plk-${esc(x.id)}">${esc(x.title)}</h2><a href="/c/${encodeURIComponent(x.id)}${c ? "?city=" + encodeURIComponent(c) : ""}" aria-label="See all: ${esc(x.title)}">See all</a></div><p>${esc(x.intro)}</p>
      <div class="plk-row">${x.kind === "hosts" ? x.hosts.map(hostCard).join("") : x.events.map(card).join("") + (x.ideas || []).map(ideaCard).join("")}</div></section>`).join("") : "") + (rest.length ? `<nav class="plk-others" aria-label="More collections"><b>More collections</b>${rest.map((x) => `<a class="ls-chip" href="/c/${encodeURIComponent(x.id)}${c ? "?city=" + encodeURIComponent(c) : ""}">${esc(x.title)}</a>`).join("")}</nav>` : "");
    return L; }

  async function page(el, id, { city: c = new URLSearchParams(location.search).get("city") || city() } = {}) { if (!el) return null; css();
    let j = null; try { j = await get(`/api/public/collections/${encodeURIComponent(id)}` + (c ? "?city=" + encodeURIComponent(c) : "")); } catch {}
    if (!j?.collection) { el.innerHTML = `<div class="plk-empty"><b>That collection isn't here</b><p>It may have been switched off. Discover has the rest.</p><a class="ls-btn" href="/discover">Back to Discover</a></div>`; return null; }
    const x = j.collection; document.title = `${x.title} · Pottery Lab`;
    const body = x.kind === "hosts"
      ? (x.hosts.length ? `<div class="plk-hosts">${x.hosts.map(hostCard).join("")}</div>` : "")
      : (x.events.length ? `<div class="plk-grid">${x.events.map(card).join("")}</div>` : "") + (x.ideas.length ? `<h2 class="plk-sub">Nothing quite like it yet</h2><p class="plk-subp">${x.events.length ? "A few more ideas in this spirit, for anyone who wants to host one." : "Be the first: here are ideas in this spirit to host."}</p><div class="plk-grid">${x.ideas.map(ideaCard).join("")}</div>` : "");
    const n = x.kind === "hosts" ? x.hosts.length : x.events.length;
    el.innerHTML = `<div class="plk-page"><div class="plk-intro"><h1>${esc(x.title)}</h1><p>${esc(x.intro)}</p><button type="button" class="plk-slc" data-pl-savelist="${esc(JSON.stringify({ kind: "collection", ref: x.id, title: x.title }))}" aria-label="Save to list: ${esc(x.title)}">${LIST_IC}<span class="pls-t">Save to list</span></button>${n ? `<span class="plk-n">${n} ${x.kind === "hosts" ? (n === 1 ? "host" : "hosts") : n === 1 ? "event" : "events"}${c && x.kind !== "hosts" ? " · " + esc(c) + " first" : ""}</span>` : ""}</div>
      ${body || `<div class="plk-empty">${window.Potto ? window.Potto.svg("think", 88, "Potto") : ""}<b>Nothing on this shelf yet</b><p>New events land here as hosts post them. Have a look around Discover in the meantime.</p><a class="ls-btn" href="/discover">Back to Discover</a></div>`}
      <nav class="plk-more" aria-label="Other collections">${(j.others || []).map((o) => `<a class="ls-chip" href="${esc(o.url)}">${esc(o.title)}</a>`).join("")}</nav></div>`;
    return x; }

  window.PLCollections = { shelves, page, card, ideaCard, hostCard, css };
  // Discover's hook: <section id="plShelves" data-calm="discover"></section>
  const auto = () => { const el = document.getElementById("plShelves"); if (!el || el.dataset.plkDone) return; el.dataset.plkDone = "1"; let last = city(); shelves(el, { max: 3 });
    // a new city on Discover's location chip: the shelves follow
    const ln = document.getElementById("locName"); if (ln) new MutationObserver(() => { const c = city(); if (c !== last) { last = c; shelves(el, { city: c, max: 3 }); } }).observe(ln, { childList: true, characterData: true, subtree: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto();
})();
