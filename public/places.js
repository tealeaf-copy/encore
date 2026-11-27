// "Your places": the places someone has been through Pottery Lab, on a small hand-drawn map (server/places.js).
//   - the card on /me and on a page (/@handle): the map with photo pins, a true line ("23 nights in 6 neighbourhoods
//     this year"), "Your 2026 so far", and a banner in December; on someone else's page only if they show it
//   - the full map: pins clustered by neighbourhood, each a small photo (theirs, the event's cover, or the drawn cover)
//     with its month; tap one for a peek (title, host, date, kudos, photos, links); filter by year and kind
//   - "People you know": friends' places as a layer (friends who let friends see), on the full map and on /map
//   - the two switches in Settings
// Private events are only ever a neighbourhood area here, named "A dinner in Greenpoint": the server never sends more.
//   PLPlaces.card(el, data, { own })   PLPlaces.open(data, { own, friends })   PLPlaces.settings(el)
(function () {
  if (window.PLPlaces) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const getJ = async (u) => { const r = await fetch(u, { credentials: "same-origin" }); if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); };
  const send = async (u, body) => { const r = await fetch(u, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error("http " + r.status); return r.json(); };
  const REDUCE = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const SC = () => window.PLShareCards;
  const YEAR = new Date().getFullYear(), DEC = new Date().getMonth() === 11;
  const KIND_LABEL = { supper: "Supper clubs", games: "Game nights", run: "Run clubs", workshop: "Workshops", drop: "Drops", market: "Markets", other: "Other nights" };
  const niceDate = (d) => { const t = /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00") : null; return t ? t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""; };
  const roleLabel = (p) => (p.role === "hosted" ? "Hosted" : p.via === "drop" ? "Picked up" : p.via === "checkin" ? "Checked in" : p.via === "brand" ? "Team booking" : "Went");
  const thumb = (p) => (p.photo?.url ? `<img src="${esc(p.photo.url)}" alt="" loading="lazy" decoding="async">` : `<img class="is-art" src="/og/kit/art-${esc(/^[a-z]{2,20}$/.test(p.art || "") ? p.art : "party")}.png" alt="" loading="lazy" decoding="async">`);
  const ICON = { x: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    map: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 9 4.5l6 2 5-2v13l-5 2-6-2-5 2z"/><path d="M9 4.5v13M15 6.5v13"/></svg>',
    people: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7.5" cy="7" r="2.6"/><circle cx="13.6" cy="8" r="2.1"/><path d="M2.8 16c.6-2.8 2.4-4.2 4.7-4.2s4.1 1.4 4.7 4.2M12.4 12.2c2.2-.3 4 .9 4.6 3.6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>' };

  // photo pins over the drawn map: one stack per neighbourhood, up to three photos and a count
  function pins(data, { size = 34, pick = false, sel = "", h = 100 } = {}) { const byId = new Map((data.places || []).map((p) => [p.id, p]));
    return (data.map?.areas || []).map((a) => { const A = (data.areas || []).find((x) => x.key === a.key) || {}, L = (A.ids || []).map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
      const left = (5 + a.x * 90).toFixed(2), top = (((5 + a.y * (h - 10)) / h) * 100).toFixed(2), label = `${a.label || "An area"}: ${a.n} ${a.n === 1 ? "night" : "nights"}`;
      return `<${pick ? "button type=\"button\"" : "span"} class="plp-pin${sel === a.key ? " is-sel" : ""}" style="left:${left}%;top:${top}%;--s:${size}px" ${pick ? `data-area="${esc(a.key)}" aria-pressed="${sel === a.key}"` : 'aria-hidden="true"'} aria-label="${esc(label)}">${L.map((p, k) => `<i style="--k:${k}">${thumb(p)}</i>`).join("")}${a.n > 1 ? `<em>${a.n}</em>` : ""}</${pick ? "button" : "span"}>`; }).join(""); }

  /** The card on a profile. data: GET /api/me/places or /api/public/places/:handle. */
  function card(el, data, o = {}) { css(); const own = !!o.own, Y = data.year || YEAR, who = own ? "Your places" : `${data.first ? data.first + "'s" : "Their"} places`;
    const banner = own && DEC && Y === YEAR && data.counts?.nights ? `<a class="plp-dec" href="/year/${Y}"><img src="/og/kit/potto-cheer.png" alt="" width="44" height="44"><span><b>Your ${Y} in nights is ready</b><small>A minute of cards to look back on, and one to share.</small></span></a>` : "";
    const empty = !data.places?.length;
    el.innerHTML = `<section class="plp-card" aria-labelledby="plpH">${banner}
      <div class="plp-head"><div><p class="plp-kick">${esc(who)} · ${Y}</p><h2 id="plpH">${esc(data.line || "")}</h2></div></div>
      <button type="button" class="plp-mini" id="plpOpen" aria-label="Open the map of ${esc(who.toLowerCase())}"${empty ? " disabled" : ""}>${SC().mapSvg(data.map, { w: 100, h: 56, labels: false })}<span class="plp-pins">${pins(data, { size: 30, h: 56 })}</span></button>
      <div class="plp-foot">${empty ? `<p class="plp-note">${own ? "Say you're in to something small. It lands here once it happens." : "Nothing here yet."}</p>` : `<button type="button" class="plp-go" id="plpOpen2">${ICON.map}<span>Open the map</span></button>`}
        ${own ? `<a class="plp-year" href="/year/${Y}">${Y === YEAR && !DEC ? `Your ${Y} so far` : `Your ${Y} in nights`}</a>` : ""}</div>
      ${own ? `<p class="plp-priv">${ICON.lock}<span>${data.settings?.showOnProfile ? "On your page, private ones as a neighbourhood only." : "Only you see these."} <a href="/settings#places">Change</a></span></p>` : ""}</section>`;
    const go = () => open(data, { own, handle: o.handle }); el.querySelector("#plpOpen").onclick = go; const g2 = el.querySelector("#plpOpen2"); if (g2) g2.onclick = go; }

  /** The full map, as a dialog over the page. */
  async function open(data, o = {}) { css(); let D = data, sel = "", peekId = "", friends = null, showFriends = !!o.friends, last = document.activeElement;
    const box = document.createElement("div"); box.className = "plp-full"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "plpFullH"); document.body.appendChild(box); document.documentElement.classList.add("plp-lock");
    const close = () => { box.remove(); document.documentElement.classList.remove("plp-lock"); document.removeEventListener("keydown", key); try { last?.focus(); } catch {} };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); if (peekId) { peekId = ""; draw(); } else close(); } }; document.addEventListener("keydown", key);
    const reload = async (q) => { try { D = await getJ(o.own || !o.handle ? `/api/me/places?${q}` : `/api/public/places/${encodeURIComponent(o.handle)}?${q}`); } catch {} sel = ""; peekId = ""; draw(); };
    const loadFriends = async () => { if (friends) return; try { friends = await getJ("/api/me/places/friends"); } catch { friends = { places: [], friends: [], map: { areas: [] }, areas: [] }; } };
    function view() { if (showFriends && friends) { const ids = new Map(); return { ...friends, places: friends.places.map((p, k) => { const id = "f" + k; ids.set(id, p); return { ...p, id }; }), areas: (friends.map?.areas || []).map((a) => ({ ...a, ids: friends.places.map((p, k) => (p.area?.key === a.key ? "f" + k : "")).filter(Boolean) })) }; } return D; }
    function draw() { const V = view(), L = (V.places || []).filter((p) => !sel || p.area?.key === sel), P = peekId ? (V.places || []).find((p) => p.id === peekId) : null;
      const years = (D.years || []).length > 1 && !showFriends ? `<label class="plp-sel"><span>Year</span><select id="plpYear">${D.years.map((y) => `<option${y === D.year ? " selected" : ""}>${y}</option>`).join("")}</select></label>` : "";
      const types = showFriends ? "" : `<div class="plp-chips" role="radiogroup" aria-label="Which nights">${[{ id: "all", label: "All" }, ...(o.own && D.hosted ? [{ id: "hosted", label: "Hosted" }, { id: "went", label: "Went" }] : []), ...(D.types || []).map((t) => ({ id: t.id, label: KIND_LABEL[t.id] || t.label }))].map((t) => `<button type="button" role="radio" aria-checked="${(D.type || "all") === t.id}" data-type="${esc(t.id)}">${esc(t.label)}</button>`).join("")}</div>`;
      const layer = o.own ? `<button type="button" class="plp-layer" id="plpLayer" aria-pressed="${showFriends}">${ICON.people}<span>People you know</span></button>` : "";
      const head = showFriends ? (friends?.places?.length ? `Places from people you know` : `Places from people you know`) : D.line;
      const sub = showFriends ? (friends?.friends?.length ? `${friends.friends.map((f) => f.first).slice(0, 3).join(", ")}${friends.friends.length > 3 ? ` and ${friends.friends.length - 3} more` : ""}. Only what they chose to show.` : "Friends show up here once they let friends see where they've been.") : sel ? `${L.length} in ${esc((V.areas || []).find((a) => a.key === sel)?.label || "this area")}` : "Tap a neighbourhood to see its nights.";
      box.innerHTML = `<div class="plp-sheet"><div class="plp-top"><h2 id="plpFullH">${esc(head)}</h2><button type="button" class="plp-x" id="plpX" aria-label="Close the map">${ICON.x}</button></div>
        <div class="plp-filters">${years}${types}${layer}</div>
        <div class="plp-big${showFriends ? " is-friends" : ""}">${SC().mapSvg(V.map, { w: 100, h: 72, pick: false, labels: true, labelSize: 2.6, minR: 3 })}<span class="plp-pins">${pins(V, { size: 44, pick: true, sel, h: 72 })}</span></div>
        <p class="plp-sub" aria-live="polite">${sub}</p>
        <ol class="plp-strip" aria-label="Nights">${L.map((p) => `<li><button type="button" class="plp-ph${p.id === peekId ? " is-sel" : ""}" data-peek="${esc(p.id)}" aria-label="${esc(`${p.title}, ${niceDate(p.date)}`)}">${thumb(p)}<span>${esc(p.month || "")}</span>${p.hidden ? `<small>Hidden</small>` : ""}</button></li>`).join("") || `<li class="plp-none">${showFriends ? "Nothing from friends yet." : "No nights here yet."}</li>`}</ol>
        ${P ? peek(P, o) : ""}</div>`;
      box.querySelector("#plpX").onclick = close;
      box.querySelectorAll("[data-area]").forEach((b) => (b.onclick = () => { sel = sel === b.dataset.area ? "" : b.dataset.area; peekId = ""; draw(); box.querySelector(`[data-area="${window.CSS.escape(b.dataset.area)}"]`)?.focus(); }));
      box.querySelectorAll("[data-peek]").forEach((b) => (b.onclick = () => { peekId = b.dataset.peek; draw(); box.querySelector("#plpPeek")?.focus(); }));
      box.querySelectorAll("[data-type]").forEach((b) => (b.onclick = () => reload(`year=${D.year}&type=${encodeURIComponent(b.dataset.type)}`)));
      const ys = box.querySelector("#plpYear"); if (ys) ys.onchange = () => reload(`year=${ys.value}`);
      const lb = box.querySelector("#plpLayer"); if (lb) lb.onclick = async () => { showFriends = !showFriends; sel = ""; peekId = ""; if (showFriends) await loadFriends(); draw(); box.querySelector("#plpLayer")?.focus(); };
      const pc = box.querySelector("#plpPeekX"); if (pc) pc.onclick = () => { const id = peekId; peekId = ""; draw(); box.querySelector(`[data-peek="${window.CSS.escape(id)}"]`)?.focus(); };
      const hb = box.querySelector("#plpHide"); if (hb) hb.onclick = async () => { const p = (D.places || []).find((x) => x.id === peekId); if (!p) return; try { const j = await send("/api/me/places/hide", { eventId: p.id, hidden: !p.hidden }); p.hidden = j.hidden.includes(p.id); } catch {} draw(); box.querySelector("#plpHide")?.focus(); }; }
    if (showFriends) await loadFriends(); draw(); box.querySelector("#plpX").focus(); }

  function peek(p, o) { const k = p.kudos || {};
    return `<section class="plp-peek" id="plpPeek" tabindex="-1" aria-label="${esc(p.title)}"><button type="button" class="plp-x sm" id="plpPeekX" aria-label="Close">${ICON.x}</button>
      <div class="plp-pk">${thumb(p)}<div><p class="plp-kick">${esc(roleLabel(p))} · ${esc(niceDate(p.date))}</p><h3>${esc(p.title)}</h3>
        ${p.line ? `<p class="plp-m">${esc(p.line)}</p>` : ""}${p.host ? `<p class="plp-m">Hosted by <a href="${esc(p.host.url)}">${esc(p.host.name)}</a></p>` : ""}
        ${p.area ? `<p class="plp-m">${esc(p.area.hood || p.area.city)}${p.public ? "" : ", shown as a neighbourhood"}</p>` : ""}</div></div>
      ${k.gave ? `<blockquote class="plp-q"><p>“${esc(k.gave)}”</p><cite>Your kudos</cite></blockquote>` : ""}${(k.got || []).slice(0, 2).map((g) => `<blockquote class="plp-q"><p>“${esc(g.text)}”</p><cite>${esc(g.by)}</cite></blockquote>`).join("")}
      ${(p.photos || []).length ? `<div class="plp-photos">${p.photos.slice(0, 6).map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join("")}</div>` : ""}
      <div class="plp-acts">${p.url ? `<a class="plp-go" href="${esc(p.url)}">Open the event</a>` : ""}${p.who?.handle ? `<a class="plp-link" href="/@${esc(p.who.handle)}">See ${esc(p.who.first)}'s page</a>` : ""}${o.own && !p.who ? `<button type="button" class="plp-link" id="plpHide" aria-pressed="${!!p.hidden}">${p.hidden ? "Show on my places" : "Hide from my places"}</button>` : ""}</div></section>`; }

  /** The two switches in Settings. */
  async function settings(el) { let S; try { S = await getJ("/api/me/places/settings"); } catch { return; } css();
    el.hidden = false; el.innerHTML = `<h2 id="hPlaces">Your places</h2><p>Where you've been through Pottery Lab, on a small map. You always see yours. Private events only ever show as a neighbourhood, never a title or an address.</p>
      <div class="row"><span>Show my places on my page<small>Off unless you turn it on</small></span><input type="checkbox" class="sw" id="plpShow" aria-label="Show my places on my page"${S.showOnProfile ? " checked" : ""}></div>
      <div class="row"><span>Let friends see where I've been<small>Friends on each other's lists see the public events you went to, private ones as a neighbourhood. They can also name you on their year cards, first name only.</small></span><input type="checkbox" class="sw" id="plpFriends" aria-label="Let friends see where I've been"${S.friendsSee ? " checked" : ""}></div>
      <p class="msg" id="plpMsg" role="status">${S.hidden.length ? `${S.hidden.length} ${S.hidden.length === 1 ? "event is" : "events are"} hidden. ` : ""}To hide one event, open it on <a href="/me">your map</a>.</p>`;
    el.querySelectorAll("input").forEach((c) => (c.onchange = async () => { try { await send("/api/me/places/settings", { showOnProfile: el.querySelector("#plpShow").checked, friendsSee: el.querySelector("#plpFriends").checked }); el.querySelector("#plpMsg").textContent = "Saved."; } catch { c.checked = !c.checked; el.querySelector("#plpMsg").textContent = "Couldn't save that. Try again."; } }));
    if (location.hash === "#places") el.scrollIntoView({ block: "start" }); }

  const CSS = `
.plp-card{display:grid;gap:12px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);padding:16px;color:var(--pl-ink,#1B1D1C)}
.plp-kick{margin:0;font:500 13px/1.3 var(--pl-font-mono,ui-monospace,monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-accent-text,#29489A)}
.plp-card h2,.plp-top h2{margin:2px 0 0;font:600 22px/1.25 var(--pl-font-serif,Georgia,serif);letter-spacing:-.01em}
.plp-mini{position:relative;display:block;width:100%;padding:0;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-page,#EFEBE2);overflow:hidden;cursor:pointer;aspect-ratio:100/56}
.plp-mini:disabled{cursor:default}.plp-mini svg,.plp-big svg{position:absolute;inset:0;width:100%;height:100%}
.plp-mini:focus-visible,.plp-pin:focus-visible,.plp-ph:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.plp-pins{position:absolute;inset:0;pointer-events:none}
.plp-pin{position:absolute;width:var(--s);height:var(--s);transform:translate(-50%,-50%);padding:0;border:0;background:none;pointer-events:auto;cursor:default}
button.plp-pin{cursor:pointer;min-width:44px;min-height:44px;display:grid;place-items:center}
.plp-pin i{position:absolute;left:50%;top:50%;width:var(--s);height:var(--s);margin:calc(var(--s) / -2) 0 0 calc(var(--s) / -2);border-radius:50%;overflow:hidden;border:2px solid var(--pl-ink,#1B1D1C);background:var(--pl-surface,#FAF8F3);transform:translate(calc(var(--k) * 7px), calc(var(--k) * -5px)) rotate(calc(var(--k) * 6deg))}
.plp-pin i:nth-child(1){z-index:3}.plp-pin i:nth-child(2){z-index:2}.plp-pin i:nth-child(3){z-index:1}
.plp-pin img{width:100%;height:100%;object-fit:cover;display:block}.plp-pin img.is-art,.plp-ph img.is-art,.plp-pk img.is-art{object-fit:contain;background:#ECE3C2;padding:3px}
.plp-pin em{position:absolute;right:-6px;top:-8px;z-index:4;min-width:22px;height:22px;padding:0 5px;border-radius:999px;background:var(--pl-accent,#29489A);color:#fff;font:600 13px/22px var(--pl-font-text,system-ui,sans-serif);font-style:normal;text-align:center;border:1.5px solid var(--pl-ink,#1B1D1C)}
.plp-pin.is-sel i:first-child{outline:3px solid var(--pl-highlight,#F2DD6B);outline-offset:1px}
.plp-foot{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
.plp-go{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-accent,#29489A);background:var(--pl-accent,#29489A);color:#fff!important;font:600 15px var(--pl-font-text,system-ui,sans-serif);text-decoration:none;cursor:pointer}
.plp-year,.plp-link{display:inline-flex;align-items:center;min-height:44px;color:var(--pl-accent-text,#29489A);font:600 15px var(--pl-font-text,system-ui,sans-serif);background:none;border:0;padding:0;cursor:pointer;text-decoration:none}
.plp-year:hover,.plp-link:hover{text-decoration:underline;text-underline-offset:3px}
.plp-note,.plp-priv{margin:0;color:var(--pl-soft,#444845);font-size:15px}.plp-priv{display:flex;gap:6px;align-items:flex-start}.plp-priv svg{flex:none;margin-top:3px}.plp-priv a{color:var(--pl-accent-text,#29489A)}
.plp-dec{display:grid;grid-template-columns:44px minmax(0,1fr);gap:10px;align-items:center;padding:10px 12px;background:var(--pl-sand,#F3E7A8);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);color:var(--pl-ink,#1B1D1C);text-decoration:none}
.plp-dec b{display:block;font:600 17px/1.3 var(--pl-font-serif,Georgia,serif)}.plp-dec small{display:block;font-size:14px;color:var(--pl-ink,#1B1D1C)}
html.plp-lock{overflow:hidden}
.plp-full{position:fixed;inset:0;z-index:2147483000;background:var(--pl-page,#EFEBE2);overflow-y:auto;overscroll-behavior:contain;color:var(--pl-ink,#1B1D1C);font:17px/1.5 var(--pl-font-text,system-ui,sans-serif)}
.plp-sheet{max-width:760px;margin:0 auto;padding:max(12px,env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));display:grid;gap:12px}
.plp-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.plp-x{flex:none;display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);cursor:pointer}
.plp-x.sm{position:absolute;right:10px;top:10px}
.plp-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.plp-chips{display:flex;flex-wrap:wrap;gap:8px}
.plp-chips button,.plp-layer{min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid var(--pl-line-strong,#1B1D1C);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:600 15px var(--pl-font-text,system-ui,sans-serif);cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.plp-chips button[aria-checked=true],.plp-layer[aria-pressed=true]{background:var(--pl-ink,#1B1D1C);color:var(--pl-surface,#FAF8F3)}
.plp-sel{display:inline-flex;align-items:center;gap:6px;font-size:15px}.plp-sel select{min-height:44px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-btn,6px);background:var(--pl-surface,#FAF8F3);font:500 16px var(--pl-font-text,system-ui,sans-serif);padding:0 8px;color:var(--pl-ink,#1B1D1C)}
.plp-big{position:relative;aspect-ratio:100/72;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);overflow:hidden}
.plp-big.is-friends{--plsc-accent:#56683F}
.plp-sub{margin:0;color:var(--pl-soft,#444845);font-size:15px}
.plp-strip{list-style:none;margin:0;padding:2px 2px 6px;display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory}
.plp-strip li{scroll-snap-align:start;flex:none}.plp-none{color:var(--pl-soft,#444845);font-size:15px}
.plp-ph{display:grid;justify-items:center;gap:4px;width:72px;padding:0;border:0;background:none;color:var(--pl-ink,#1B1D1C);cursor:pointer}
.plp-ph img{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--pl-ink,#1B1D1C);background:var(--pl-surface,#FAF8F3)}
.plp-ph span{font:500 13px/1 var(--pl-font-mono,ui-monospace,monospace);letter-spacing:.04em;text-transform:uppercase}.plp-ph small{font-size:12px;color:var(--pl-soft,#444845)}
.plp-ph.is-sel img{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.plp-peek{position:relative;display:grid;gap:10px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);padding:14px 14px 12px;outline:none}
.plp-pk{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;padding-right:44px}.plp-pk img{width:72px;height:72px;border-radius:var(--pl-r-md,6px);object-fit:cover;border:1.5px solid var(--pl-ink,#1B1D1C)}
.plp-pk h3{margin:2px 0 2px;font:600 20px/1.25 var(--pl-font-serif,Georgia,serif);overflow-wrap:anywhere}.plp-m{margin:0;font-size:15px;color:var(--pl-soft,#444845)}.plp-m a{color:var(--pl-accent-text,#29489A)}
.plp-q{margin:0;border-left:3px solid var(--pl-accent,#29489A);padding:2px 0 2px 12px}.plp-q p{margin:0;font-size:16px}.plp-q cite{font-style:normal;font-size:14px;color:var(--pl-soft,#444845)}
.plp-photos{display:flex;gap:6px;overflow-x:auto}.plp-photos img{width:88px;height:88px;object-fit:cover;border-radius:4px;border:1px solid var(--pl-line,#CFC8B9);flex:none}
.plp-acts{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.plp-maplayer{display:inline-flex;align-items:center;gap:6px}
@media (prefers-reduced-motion: no-preference){.plp-full{animation:plpIn .2s ease-out}@keyframes plpIn{from{opacity:0}to{opacity:1}}}`;
  function css() { if (document.getElementById("plpCss")) return; const s = document.createElement("style"); s.id = "plpCss"; s.textContent = CSS; document.head.appendChild(s); }

  // ---- where it shows up: small, marked hooks in each page ----
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  async function boot() { const P = location.pathname;
    // /me: your card, in #plPlacesHook
    if (P === "/me") { const el = document.getElementById("plPlacesHook"); if (!el || !signedIn()) return; try { card(el, await getJ(`/api/me/places?year=${YEAR}`), { own: true }); } catch {} return; }
    // a page: yours (always), or theirs when they show it; under the side column's extras
    const m = P.match(/^\/@([a-z0-9][a-z0-9-]{1,29})\/?$/i); if (m) { let d; try { d = await getJ(`/api/public/places/${encodeURIComponent(m[1].toLowerCase())}?year=${YEAR}`); } catch { return; } if (!d.on || (!d.own && !d.places?.length)) return;
      let n = 0; const put = () => { const side = document.getElementById("sideExtras"); if (!side) { if (++n < 40) setTimeout(put, 250); return; } if (document.getElementById("plPlacesPub")) return; const w = document.createElement("div"); w.id = "plPlacesPub"; w.style.marginBottom = "12px"; side.appendChild(w); card(w, d, { own: !!d.own, handle: m[1].toLowerCase() }); }; put(); return; }
    // Settings: the two switches
    if (P === "/settings") { const el = document.getElementById("plPlacesSet"); if (el && signedIn()) settings(el); return; }
    // /map: "People you know", a layer of friends' places
    if (P === "/map" && signedIn()) { let n = 0; const put = () => { const pm = document.getElementById("pMine"); if (!pm) { if (++n < 40) setTimeout(put, 250); return; } if (document.getElementById("plpFriendsPill")) return; css();
      const b = document.createElement("button"); b.type = "button"; b.className = "pill plp-maplayer"; b.id = "plpFriendsPill"; b.innerHTML = `${ICON.people}<span>People you know</span>`; b.setAttribute("aria-haspopup", "dialog");
      b.onclick = async () => { let d = { places: [], map: { areas: [] }, areas: [], years: [] }; try { d = await getJ(`/api/me/places?year=${YEAR}`); } catch {} open(d, { own: true, friends: true }); }; pm.insertAdjacentElement("afterend", b); }; put(); }
  }
  window.PLPlaces = { card, open, settings, pins, css };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
