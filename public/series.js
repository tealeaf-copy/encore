// Review round 13: series with episode numbers. On the invite (/g and /e) the title reads "Hack night #14"; on a host
// page (/@handle) each series is a changelog: every past episode as one compact entry (date, the number in mono, how many
// came, demos and games played, a strip of photos), with "Fork this" and how many hosts forked it (the "Host one like
// this" flow, server/hostlike.js). Data: server/series.js. Loaded by public/slots.js on invites and by host.html.
(function () {
  if (window.Series) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, el = document) => el.querySelector(s);
  const getJ = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const day = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
  const css = () => { if (!document.querySelector('link[href="/slots.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/slots.css"; document.head.appendChild(l); } };
  const ID = /^[A-Za-z0-9_-]{2,80}$/, signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  /** Fork: the same draft "Host one like this" makes (public/hostlike.js), from this episode. */
  function fork(id, title) { if (!ID.test(id || "")) return; try { localStorage.removeItem("pl.hostIdea"); localStorage.setItem("pl.hostLike", JSON.stringify({ id, title: String(title || "").slice(0, 80), at: Date.now() })); } catch {}
    location.href = signed() ? "/?app=1&like=" + encodeURIComponent(id) : "/signup?mode=friends&from=like&like=" + encodeURIComponent(id); }
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-sr-fork]"); if (!b) return; e.preventDefault(); fork(b.dataset.srFork, b.dataset.title || ""); });
  const forkLine = (n) => (n ? `<span class="sl-mono">${n}</span> fork${n === 1 ? "" : "s"}` : "No forks yet");
  const FORK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5"/></svg>';

  // ---------- the episode on the invite's title ----------
  const known = new Map();
  async function episode(id) { if (!known.has(id)) known.set(id, getJ(`/api/public/episode/${encodeURIComponent(id)}`)); return known.get(id); }
  async function onInvite() {
    const g = location.pathname === "/g", id = g ? window.__gEv?.id : location.pathname.split("/")[2]; if (!id || !ID.test(id)) return;
    const h1 = g ? $("#view-guest .invite h1") || $("#view-guest h1") : $("#m h1.lk-title"); if (!h1 || h1.querySelector(".sl-ep") || /#\d+\s*$/.test(h1.textContent)) return;
    const j = await episode(id); if (!j?.episode || h1.querySelector(".sl-ep")) return;
    h1.insertAdjacentHTML("beforeend", ` <span class="sl-ep" title="Episode ${j.episode} of ${esc(j.series)}">#${j.episode}</span>`);
    // a past episode's "Host one like this" is a fork here
    const b = $("#hlPast [data-pl-like]"); if (b && !b.dataset.srDone) { b.dataset.srDone = "1"; b.innerHTML = `${FORK}<span>Fork this</span>`; }
  }

  // ---------- the host page's changelog ----------
  let mounted = false;
  async function onHostPage() {
    if (mounted) return; const handle = decodeURIComponent(location.pathname.replace(/^\/@/, "").split("/")[0]); if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(handle)) return;
    const anchor = $("#scrapbook") || $(".s-past") || $(".cols"); if (!anchor) return; mounted = true; css();
    const j = await getJ(`/api/public/host/${encodeURIComponent(handle)}/series`), L = (j?.series || []).filter((s) => s.entries.length);
    const feed = `webcal://${location.host}/@${handle}.ics`;
    const sec = document.createElement("section"); sec.className = "sr-wrap"; sec.id = "srChangelog";
    if (!L.length) { sec.innerHTML = `<p class="sr-sub" style="margin:16px 0"><a href="${esc(feed)}" style="color:inherit">Subscribe to this calendar</a></p>`; anchor.before(sec); return; }
    sec.innerHTML = `<div class="sr-head"><h2 class="sec" style="margin:0">Series</h2><a class="sr-sub" href="${esc(feed)}" style="color:inherit">Subscribe (webcal)</a></div>` + L.map((s) => `<article class="sr-series" id="series-${esc(s.root)}">
      <div class="sr-top"><div><h3>${esc(s.title)}</h3><p><span class="sl-mono">${s.episodes}</span> episode${s.episodes === 1 ? "" : "s"} · ${forkLine(s.forks)}</p></div><button type="button" class="sl-btn ghost sm" data-sr-fork="${esc(s.forkFrom)}" data-title="${esc(s.title)}">${FORK}Fork this</button></div>
      <ol class="sr-log">${s.next ? `<li class="sr-e next"><span class="sr-n sl-mono">#${s.next.n}</span><div class="sr-meta"><a href="${esc(s.next.url)}">Next: ${esc(day(s.next.date))}</a></div></li>` : ""}${s.entries.map((e) => `<li class="sr-e"><span class="sr-n sl-mono">#${e.n}</span><div class="sr-meta"><span class="sr-d sl-mono">${esc(day(e.date))}</span>${e.came != null ? ` · <span class="sl-mono">${e.came}</span> came` : ""}${e.champion ? ` · won by ${esc(e.champion)}` : ""}${e.note ? `<div>${esc(e.note)}</div>` : ""}
        ${e.demos.length || e.games.length ? `<ul class="sr-tags">${e.demos.map((x) => `<li>Demo: ${esc(x)}</li>`).join("")}${e.games.map((x) => `<li>Played: ${esc(x)}</li>`).join("")}</ul>` : ""}
        ${e.photos.length ? `<div class="sr-strip">${e.photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>` : ""}</div></li>`).join("")}</ol></article>`).join("");
    anchor.before(sec);
    // "Host one like this" on an episode of a series reads "Fork this"
    const inSeries = new Set(L.flatMap((s) => s.entries.map((e) => e.id).concat(s.next ? [s.next.id] : [])));
    const relabel = () => document.querySelectorAll("[data-pl-like]").forEach((b) => { if (b.dataset.srDone || !inSeries.has(b.dataset.plLike)) return; b.dataset.srDone = "1"; b.innerHTML = `${FORK}<span>Fork this</span>`; });
    relabel(); new MutationObserver(relabel).observe(document.body, { childList: true, subtree: true });
    if (location.hash.startsWith("#series-")) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }

  window.Series = { fork, episode };
  let T = 0; const tick = () => { if (T) return; T = setTimeout(() => { T = 0; if (location.pathname.startsWith("/@")) onHostPage(); else onInvite(); }, 200); };
  if (/^\/(?:g$|[ei]\/|@)/.test(location.pathname)) { new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true }); tick(); }
})();
