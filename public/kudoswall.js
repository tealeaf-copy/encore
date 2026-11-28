// Kudos on a host's page (/@handle): one section that answers "are people like me glad they went?" in a glance.
// - A short head: "Kudos" with the count, where they came from and how recent ("From guests at 3 events · latest Oct 2026"),
//   then the words guests tapped most, with real counts ("Amazing food 6 of 12"), once there are 5 or more.
// - The notes as cards: the quote first (clamped, with "More" for long ones), a guest's photo from that night on top when
//   they added one, then their first name (or "A guest") with an initial, and the event and month in small mono text.
// - 3 or more: a sideways row with CSS scroll snap (no library) and a peek of the next card. Previous and next buttons
//   show only with a mouse; on touch you swipe. "See all" lays every card out in a grid, in place. No auto-play.
// - 1 or 2: just the cards, no count line, no row. None: nothing for visitors (a new host isn't shown "no kudos");
//   the host on their own page gets a quiet line and, once they have a past event, a way to ask past guests.
// Colours, faces and corners come from the tokens (--pl-*, --sys-*), so a host's brand kit flows through.
// Written reviews (public/reviews.js, server/reviews.js) join the section when there are some: it reads "Kudos and reviews",
// the review cards come first (pinned, then newest) and the count line leads with "4.8 · 12 reviews" once 3 are rated.
// Server data: hostStrengths in server/social.js (first names only, the event and month only for events on the page).
// The cards keep the .kq class and the quote in the card's first <p>, so the report menu (public/safety.js) finds them.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || "")); return m ? `${MON[+m[2] - 1]} ${m[1]}` : ""; };
  const monthOfMs = (ms) => { const d = new Date(+ms || 0); return +ms ? `${MON[d.getMonth()]} ${d.getFullYear()}` : ""; };
  const lower = (s) => String(s || "").charAt(0).toLowerCase() + String(s || "").slice(1);
  const TAGS = { again: "Would go again", food: "Amazing food", welcome: "Felt welcome", vibe: "Great vibe", organized: "So well organized", met: "Met new people", fun: "So much fun", spot: "Great spot" };
  const CSS = `
.kd{margin:28px 0 8px;--kd-gap:12px}
.kd-head{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}
.kd-head h2.sec{margin:0;display:flex;align-items:baseline;gap:10px}
.kd-n{font:600 15px/1 var(--sys-sans);color:var(--pl-soft);font-variant-numeric:tabular-nums}
.kd-ctl{display:flex;align-items:center;gap:8px}
.kd-all{min-height:44px;padding:0 4px;border:0;background:none;color:var(--pl-accent-text);font:600 16px/1 var(--sys-sans);cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.kd-all:hover{text-decoration-thickness:2px}
.kd-nav{display:none;width:44px;height:44px;border-radius:var(--pl-r-btn,6px);border:var(--pl-bw,1.5px) solid var(--pl-line-strong);background:var(--pl-surface);color:var(--pl-ink);cursor:pointer;place-items:center;padding:0}
.kd-nav svg{width:18px;height:18px}.kd-nav:hover:not(:disabled){background:var(--pl-raised)}.kd-nav:disabled{opacity:.4;cursor:default}
@media (hover:hover) and (pointer:fine) and (min-width:761px){.kd.is-row:not(.is-all):not(.fits) .kd-nav{display:grid}}
.kd :is(.kd-all,.kd-nav,.kd-more,.kd-track,.kd-ask):focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}
.kd-sum{margin:6px 0 0;color:var(--pl-soft);font:500 15px/1.45 var(--sys-sans)}
.kd-tags{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.kd-tags li{display:inline-flex;align-items:baseline;gap:6px;padding:5px 11px;border:1px solid var(--pl-line);border-radius:999px;background:var(--pl-surface);color:var(--pl-ink);font:500 14px/1.3 var(--sys-sans)}
.kd-tags b{font-weight:600;color:var(--pl-soft);font-variant-numeric:tabular-nums}
.kd-list{margin-top:14px;display:grid;gap:var(--kd-gap);grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));align-items:stretch}
.kd.is-all .kd-list{align-items:start}
.kd-few .kd-list{grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))}
.kd.is-row:not(.is-all) .kd-list{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:min(84%,320px);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scroll-padding-inline:0;scrollbar-width:none;padding:2px 2px 6px;margin-inline:-2px}
.kd.is-row:not(.is-all) .kd-list::-webkit-scrollbar{display:none}
.kd .kq.kd-card{position:relative;display:flex;flex-direction:column;min-width:0;margin:0;padding:0;overflow:hidden;background:var(--pl-surface);border:var(--pl-bw,1.5px) solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);transform:none;box-shadow:none;scroll-snap-align:start;color:var(--pl-ink)}
.kd-ph{display:block;width:100%;aspect-ratio:16/9;max-height:150px;height:auto;object-fit:cover;background:var(--pl-raised);border-bottom:var(--pl-bw,1.5px) solid var(--pl-line-strong)}
.kd-body{display:flex;flex-direction:column;flex:1;padding:16px 16px 12px}
.kd-qw{margin:0;padding:0;border:0;position:relative}
.kd-qw::before{content:"\\201C";display:block;height:22px;margin:-4px 0 2px;font:600 40px/1 var(--sys-serif);color:var(--pl-accent-text)}
.kd .kd-q{margin:0;font:400 17px/1.5 var(--sys-sans);color:var(--pl-ink);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:var(--kd-lines,6);overflow:hidden}
.kd-card.has-photo{--kd-lines:3}
.kd-card{--kd-lines:5}
.kd .kd-card.is-short .kd-q{font:500 20px/1.4 var(--sys-sans);letter-spacing:-.005em}
.kd-card.is-open .kd-q{display:block;-webkit-line-clamp:unset;overflow:visible}
.kd-tagsonly{margin:0;color:var(--pl-soft);font:500 16px/1.5 var(--sys-sans)}
.kd-by{display:flex;align-items:center;gap:10px;margin:0;padding-top:12px;border-top:1px dashed var(--pl-line);min-height:44px}
.kd-spacer{flex:1;min-height:14px}
.kd-av{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--pl-accent-text) 12%,var(--pl-surface));color:var(--pl-accent-text);font:600 15px/1 var(--sys-sans)}
.kd-who{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.kd-who b{font:600 15px/1.2 var(--sys-sans);color:var(--pl-ink)}
.kd-who small{font:500 12px/1.3 var(--sys-mono);letter-spacing:var(--pl-kicker-track,.04em);text-transform:uppercase;color:var(--pl-soft);overflow-wrap:anywhere;text-wrap:balance}
.kd-more{flex:none;min-height:44px;min-width:44px;padding:0 2px;border:0;background:none;color:var(--pl-accent-text);font:600 15px/1 var(--sys-sans);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.kd-more[data-off]{visibility:hidden}
.kd .kq.kd-card>.sf-more{top:8px;right:8px}
.kd-empty p{margin:6px 0 0;color:var(--pl-soft);font:400 16px/1.5 var(--sys-sans)}
.kd-ask{display:inline-flex;align-items:center;min-height:44px;margin-top:10px;padding:0 18px;border-radius:var(--pl-r-btn,6px);border:var(--pl-bw,1.5px) solid var(--pl-line-strong);background:var(--pl-surface);color:var(--pl-ink);font:600 16px/1 var(--sys-sans);text-decoration:none}
.kd-ask:hover{background:var(--pl-raised)}
.kd-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:no-preference){.kd-list{scroll-behavior:smooth}}`;
  if (!document.getElementById("kd-css")) { const st = document.createElement("style"); st.id = "kd-css"; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }

  const ARROW = (d) => `<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  function card(k, i, n, row) {
    const words = String(k.love || "").trim(), tags = (k.tags || []).map((t) => TAGS[t] || "").filter(Boolean), name = String(k.name || "").trim() || "A guest";
    const meta = [month(k.month), k.event].filter(Boolean).join(" · "), id = `kdq${i}`, ph = k.photo?.url;
    const quote = words ? `<blockquote class="kd-qw"><p class="kd-q" id="${id}">${esc(words)}</p></blockquote>` : `<div class="kd-tagsonly">${esc(tags.map((t, j) => (j ? lower(t) : t)).join(", "))}</div>`;
    const av = name === "A guest" ? "" : esc(name.charAt(0).toUpperCase());
    return `<figure class="kq kd-card${ph ? " has-photo" : ""}${words ? (words.length <= 90 ? " is-short" : "") : " no-words"}"${row ? ` role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}"` : ""}>`
      + (ph ? `<img class="kd-ph" src="${esc(ph)}" alt="${esc(meta ? `Photo from ${k.event || "the event"}, by ${name}` : `Photo by ${name}`)}" loading="lazy" decoding="async"${k.photo.w && k.photo.h ? ` width="${+k.photo.w}" height="${+k.photo.h}"` : ""}>` : "")
      + `<div class="kd-body">${quote}<span class="kd-spacer"></span><figcaption class="kd-by"><span class="kd-av" aria-hidden="true">${av || `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5.5" r="2.75"/><path d="M2.75 14c.6-2.9 2.7-4.5 5.25-4.5s4.65 1.6 5.25 4.5" stroke-linecap="round"/></svg>`}</span>`
      + `<span class="kd-who"><b>${esc(name)}</b>${meta ? `<small title="${esc(meta)}">${esc(meta)}</small>` : ""}</span>`
      + (words ? `<button type="button" class="kd-more" aria-expanded="false" aria-controls="${id}" data-off>More</button>` : "") + `</figcaption></div></figure>`;
  }

  // S: the strengths from /api/public/profile/:handle. o: { owner, pastId } (pastId: the host's latest past event, for the ask link)
  function html(S, o = {}) {
    const K = (S && S.kudos) || [], n = Math.max(K.length, +S?.kudosShown || 0);
    // words first, the tag-only ones after. Newest first, as the server sends them, except that the first three come from
    // different nights where there are some: one big night shouldn't speak for every night. The host can't reorder them.
    const W = K.filter((k) => String(k.love || "").trim()), lead = [], seen = new Set();
    for (const k of W) { const ev = k.event || k.month || ""; if (lead.length < 3 && ev && !seen.has(ev)) { seen.add(ev); lead.push(k); } }
    const L = [...lead, ...W.filter((k) => !lead.includes(k)), ...K.filter((k) => !String(k.love || "").trim())];
    // reviews hook (public/reviews.js): written reviews come first, pinned ones on top, as the server sends them
    const RV = window.EncoreReviews, R = RV ? (S && S.reviews) || [] : [], all = L.length + R.length, word = R.length ? "Kudos and reviews" : "Kudos";
    if (!all) {
      if (!o.owner) return "";
      return `<section class="kd kd-empty s-kudos" id="kudos" aria-labelledby="kdH"><div class="kd-head"><h2 class="sec" id="kdH">Kudos</h2></div>`
        + `<p>${o.pastId ? "No kudos yet. Guests who were in can send them after an event, and they show here." : "Kudos from guests show here after your first event."}</p>`
        + (o.pastId ? `<a class="kd-ask" href="/?app=1&amp;open=${encodeURIComponent(o.pastId)}#studio">Ask past guests</a>` : "") + `</section>`;
    }
    const row = all >= 3, evN = +S?.kudosEvents || new Set(L.map((k) => k.event).filter(Boolean)).size, latest = monthOfMs(Math.max(...L.map((k) => +k.at || 0), ...R.map((k) => +k.at || 0)));
    const rsum = R.length || S?.rating ? RV.sumHTML(Math.max(+S?.reviewCount || 0, R.length), S?.rating) : "";
    const back = +S?.returning || 0; // guests who came back: the one number a host can't curate. Shown from 3, a smaller number reads as weak
    const total = n + R.length, sum = row && L.length ? [evN > 1 ? `From guests at ${evN} events` : "From guests", back >= 3 ? `${back} came back` : "", latest ? `latest ${latest}` : ""].filter(Boolean).join(" · ") : row && latest ? `latest ${latest}` : "";
    const top = n >= 5 ? (S.tags || []).filter((t) => t && t.n > 1).slice(0, 3) : [];
    return `<section class="kd s-kudos ${row ? "is-row" : "kd-few"}" id="kudos" aria-labelledby="kdH" data-n="${all}">`
      + `<div class="kd-head"><h2 class="sec" id="kdH">${word}${row ? ` <span class="kd-n">${total}</span>` : ""}</h2>`
      + (row ? `<div class="kd-ctl"><button type="button" class="kd-nav" data-dir="-1" aria-controls="kdList" aria-label="Previous kudos">${ARROW("M11 4 6 9l5 5")}</button><button type="button" class="kd-nav" data-dir="1" aria-controls="kdList" aria-label="Next kudos">${ARROW("m7 4 5 5-5 5")}</button><button type="button" class="kd-all" aria-expanded="false" aria-controls="kdList">See all</button></div>` : "")
      + `</div>${sum || rsum ? `<p class="kd-sum">${rsum}${rsum && sum ? " · " : ""}${esc(sum)}</p>` : ""}`
      + (top.length ? `<ul class="kd-tags" aria-label="What guests mention most">${top.map((t) => `<li>${esc(t.label || TAGS[t.tag] || t.tag)} <b>${+t.n} of ${n}</b></li>`).join("")}</ul>` : "")
      + `<div class="kd-list" id="kdList"${row ? ` role="region" aria-roledescription="carousel" aria-label="${word} from guests" tabindex="0"` : ""}>${R.map((r, i) => RV.card(r, i, all, row, !!o.owner)).join("")}${L.map((k, i) => card(k, i + R.length, all, row)).join("")}</div>`
      + (row ? `<p class="kd-sr" aria-live="polite"></p>` : "") + `</section>`;
  }

  // the buttons, "More" on the long ones, and the row's state. Safe to call more than once.
  function wire(sec) {
    if (!sec || sec.dataset.kdOn) return; sec.dataset.kdOn = "1";
    const list = sec.querySelector(".kd-list"), all = sec.querySelector(".kd-all"), live = sec.querySelector(".kd-sr"), navs = [...sec.querySelectorAll(".kd-nav")];
    const clampCheck = () => sec.querySelectorAll(".kd-card").forEach((c) => { const q = c.querySelector(".kd-q"), b = c.querySelector(".kd-more"); if (!q || !b || c.classList.contains("is-open")) return;
      if (q.scrollHeight > q.clientHeight + 2) b.removeAttribute("data-off"); else b.setAttribute("data-off", ""); });
    sec.addEventListener("click", (e) => { const b = e.target.closest(".kd-more"); if (!b) return; const c = b.closest(".kd-card"), open = !c.classList.contains("is-open");
      c.classList.toggle("is-open", open); b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Less" : "More"; });
    const step = () => { const c = list.querySelector(".kd-card"); return c ? c.getBoundingClientRect().width + parseFloat(getComputedStyle(list).columnGap || "12") : list.clientWidth; };
    const state = () => { if (!sec.classList.contains("is-row")) return; const max = list.scrollWidth - list.clientWidth;
      sec.classList.toggle("fits", max <= 2); if (navs[0]) navs[0].disabled = list.scrollLeft <= 2; if (navs[1]) navs[1].disabled = list.scrollLeft >= max - 2; };
    const say = () => { if (!live) return; const w = step(), n = +sec.dataset.n || 0, a = Math.min(n, Math.round(list.scrollLeft / w) + 1), b = Math.min(n, a + Math.max(1, Math.floor((list.clientWidth + 4) / w)) - 1);
      live.textContent = a === b ? `Showing ${a} of ${n}` : `Showing ${a} to ${b} of ${n}`; };
    const go = (left, by) => { list[by ? "scrollBy" : "scrollTo"]({ left, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); clearTimeout(say.t); say.t = setTimeout(say, 450); };
    navs.forEach((b) => b.addEventListener("click", () => go(+b.dataset.dir * step(), true)));
    // the row itself takes the arrow keys, Home and End, one card at a time
    list.addEventListener("keydown", (e) => { if (e.target !== list || sec.classList.contains("is-all") || !sec.classList.contains("is-row")) return;
      const k = { ArrowRight: [step(), true], ArrowLeft: [-step(), true], Home: [0, false], End: [list.scrollWidth, false] }[e.key]; if (!k) return; e.preventDefault(); go(k[0], k[1]); });
    let t = 0; list.addEventListener("scroll", () => { cancelAnimationFrame(t); t = requestAnimationFrame(state); }, { passive: true });
    if (all) all.addEventListener("click", () => { const open = !sec.classList.contains("is-all"); sec.classList.toggle("is-all", open); all.setAttribute("aria-expanded", String(open)); all.textContent = open ? "Show fewer" : "See all";
      // a grid is not a carousel: the roles follow the layout
      if (open) { list.removeAttribute("aria-roledescription"); list.removeAttribute("role"); list.removeAttribute("tabindex"); list.setAttribute("aria-label", "All kudos"); sec.querySelectorAll(".kd-card").forEach((c) => c.removeAttribute("aria-roledescription")); }
      else { list.setAttribute("role", "region"); list.setAttribute("aria-roledescription", "carousel"); list.setAttribute("tabindex", "0"); list.setAttribute("aria-label", sec.querySelector(".rv-card") ? "Kudos and reviews from guests" : "Kudos from guests"); sec.querySelectorAll(".kd-card").forEach((c) => c.setAttribute("aria-roledescription", "slide")); list.scrollLeft = 0;
        const r = sec.getBoundingClientRect(); if (r.top < 0) sec.scrollIntoView({ block: "start" }); }
      clampCheck(); state(); });
    clampCheck(); state();
    let r = 0; addEventListener("resize", () => { clearTimeout(r); r = setTimeout(() => { clampCheck(); state(); }, 150); });
    document.fonts?.ready?.then(() => { clampCheck(); state(); }).catch(() => {});
    sec.querySelectorAll(".kd-ph").forEach((img) => img.addEventListener("error", () => { img.closest(".kd-card")?.classList.remove("has-photo"); img.remove(); clampCheck(); }, { once: true }));
  }

  // put the section on the page: before the past events when there are some (proof comes before the archive), else at the top of `at`
  function mount(S, o = {}) { const h = html(S, o); if (!h) return null; const old = document.getElementById("kudos"); if (old) old.remove();
    const tpl = document.createElement("template"); tpl.innerHTML = h; const sec = tpl.content.firstElementChild, past = document.querySelector("main .s-past");
    if (past && past.parentElement) past.before(sec); else if (o.at) o.at.prepend(sec); else return null;
    wire(sec); return sec; }

  window.EncoreKudos = { html, wire, mount, card, month };
})();
