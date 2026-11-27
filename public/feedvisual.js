// ---- visual feed: a quiet weekly edition ----
// Stories rail and full-screen viewer on top, then an opening (the date, one headline made from what is really on, one
// line) and four sections: Happening near you, Your people, Recently with photos, Ideas to try. Three card kinds only:
// an event (photo first, one button, the rest behind More), a scrapbook page (instant photos, one kudos quote) and a
// tile for rows. Used by public/feed.html signed in and out. Each event shows once; things arrive softly, once, and
// stand still for reduced motion; media is lazy and sized.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TILT = [-3, 2, -1.5, 1.2, -2, 2.5, -1, 1.6];
  const NOTE = ["#FFE9A8", "#FBD3CB", "#CDEBD5", "#E2D6F7", "#FCCBA6"];
  const TAPE = ["#F3E7A8", "#B9C7A6", "#E9A08F"];
  const REG = new Map(); // story sets the viewer can open: rail stories and a card's photos
  let deviceId = ""; try { deviceId = localStorage.getItem("fv.device") || ""; if (!deviceId) { deviceId = "d" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36); localStorage.setItem("fv.device", deviceId); } } catch { deviceId = "d" + Math.random().toString(36).slice(2, 14); }
  const seen = (() => { let S = new Set(); try { S = new Set(JSON.parse(localStorage.getItem("fv.seen") || "[]")); } catch {} return { has: (k) => S.has(k), add: (k) => { S.add(k); try { localStorage.setItem("fv.seen", JSON.stringify([...S].slice(-600))); } catch {} } }; })();

  // ---------- small pieces ----------
  const t12 = (t) => /^\d{1,2}:\d\d$/.test(t || "") ? (([h, m]) => { h = +h; return (h % 12 || 12) + (+m ? ":" + m : "") + (h < 12 ? "am" : "pm"); })(t.split(":")) : "";
  const dayOf = (d, o) => { const x = /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T12:00:00") : null; return x && !isNaN(x) ? x.toLocaleDateString("en-US", o) : ""; };
  const when = (e) => [dayOf(e.date, { weekday: "short", month: "short", day: "numeric" }), t12(e.startTime)].filter(Boolean).join(" · ");
  const short = (e) => [dayOf(e.date, { weekday: "short" }), t12(e.startTime)].filter(Boolean).join(" · ");
  const where = (e) => e.hood || e.city || e.place || "";
  const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  function avatar(h, size = 40) { h = h || {}; const inner = h.avatarUrl ? `<img src="${esc(h.avatarUrl)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">` : h.avatarArt && window.EncoreAvatars ? window.EncoreAvatars.svg(h.avatarArt, h.color || "#E26D8E", size) : `<span>${esc(h.emoji || "🙂")}</span>`;
    return `<span class="fv-av" style="--c:${esc(h.color || "#E26D8E")};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px" aria-hidden="true">${inner}</span>`; }
  const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return 1; const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  // the event's colours: its flyer's palette, else a pastel from its illustrated cover
  function tintOf(e) { const p = (e.look?.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)); const A = window.EventArt;
    const bg = p[0] || (A ? A.PASTELS[A.toneOf({ ...e, title: e.title }, A.kindOf({ ...e, name: e.title }))] : "#F3E7A8") || "#F3E7A8", dark = lum(bg) < 0.179; /* white wins below this luminance; above it ink does */
    const acc = p.find((c, i) => i && Math.abs(lum(c) - lum(bg)) > 0.25) || (dark ? "#F3E7A8" : "#29489A");
    return { bg, ink: dark ? "#EFEBE2" : "#1B1D1C", soft: dark ? "#EFEBE2" : lum(bg) < 0.45 ? "#1B1D1C" : "#444845", acc, dark }; } /* a mid-tone tint keeps soft text at full ink so it stays at 4.5:1 */
  const tintStyle = (T) => `--tint:${T.bg};--tink:${T.ink};--tsoft:${T.soft};--tacc:${T.acc}`;
  function btnText(e, fallback = "I'm in") { const L = e.look || {}, em = L.buttonEmoji ? L.buttonEmoji + " " : ""; if (e.approvalRequired) return em + "Ask to join"; return em + (L.buttonLabel && L.buttonLabel !== "Ask to join" ? L.buttonLabel : fallback); }
  function art(e, opts = {}) { const A = window.EventArt; if (!A) return `<div class="fv-artfb">${esc(e.emoji || "🎉")}</div>`; return A.cover({ ...e, name: e.title, pubTitle: e.title, coverArt: e.coverArt || undefined }, { ...(opts.title != null ? { title: opts.title } : {}) }); }
  // The platform frame (docs/brand-kit.md): on shared surfaces a host brings a cover, a title, a face and one accent.
  // A cover shows only when it can carry the card: there, wider than 600px, and not near-black, blown out or flat.
  // Anything else gets our drawn cover. The 4:5 crop is fixed; a saved focal point (look.coverPos, "x% y%") steers it.
  const EVS = new Map();
  const coverOK = (e) => !!e.cover && !(e.look?.coverW && e.look.coverW < 600);
  const coverPos = (L) => (/^\d{1,3}% \d{1,3}%$/.test(L?.coverPos || "") ? L.coverPos : "50% 50%");
  function coverFails(img) { if (img.naturalWidth && img.naturalWidth < 600) return true;
    try { const c = document.createElement("canvas"); c.width = 24; c.height = 30; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 30); const d = x.getImageData(0, 0, 24, 30).data;
      let n = 0, sum = 0, sq = 0; for (let k = 0; k < d.length; k += 4) { const l = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255; sum += l; sq += l * l; n++; }
      const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean)); return mean < 0.05 || mean > 0.97 || sd < 0.03; } catch { return false; } } // a cross-origin photo can't be read: keep it
  function checkCover(img) { if (!img.matches?.("img[data-fv-q]") || img.dataset.fvQd) return; img.dataset.fvQd = "1"; if (!coverFails(img)) return;
    const box = img.parentElement, e = EVS.get(box?.closest("[data-fv-id]")?.dataset.fvId || ""); if (box && e) { box.innerHTML = art(e, { title: "" }); box.closest(".fv-card")?.classList.remove("poster"); } }
  document.addEventListener("load", (ev) => checkCover(ev.target), true);
  document.addEventListener("error", (ev) => { const t = ev.target; if (t?.matches?.("img[data-fv-q]")) { t.dataset.fvQd = ""; t.removeAttribute("src"); const box = t.parentElement, e = EVS.get(box?.closest("[data-fv-id]")?.dataset.fvId || ""); if (box && e) box.innerHTML = art(e, { title: "" }); } }, true);
  window.__fvFrame = { coverOK, coverFails }; // for tests
  const potto = (pose, size) => (window.Potto ? window.Potto.svg(pose, size, "") : "");
  const tape = (i, cls = "") => `<span class="fv-tape ${cls}" style="--tp:${TAPE[i % TAPE.length]};--tr:${i % 2 ? 4 : -5}deg" aria-hidden="true"></span>`;
  const sticker = (txt, cls = "") => `<span class="fv-stk ${cls}">${esc(txt)}</span>`;
  // one photo or video as an image box with its size reserved (no layout shift)
  function mediaBox(m, { ratio = "4/5", eager = false, cls = "" } = {}) { const src = m.type === "video" ? m.poster || "" : m.url, alt = m.caption || (m.by ? `Photo from ${m.by}` : "Photo from the event");
    return `<span class="fv-mb ${cls}" style="aspect-ratio:${ratio}">${src ? `<img src="${esc(src)}" alt="${esc(alt)}" width="400" height="500" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : m.type === "video" ? `<video src="${esc(m.url)}#t=0.3" muted playsinline preload="metadata" aria-label="${esc(alt)}"></video>` : ""}${m.type === "video" ? `<span class="fv-play" aria-hidden="true">▶</span>` : ""}</span>`; }

  // ---------- stories rail ----------
  function ringThumb(s) { if (s.thumb) return `<img src="${esc(s.thumb)}" alt="" width="64" height="64" loading="lazy" decoding="async">`;
    const it = s.items.find((i) => i.type === "art"), A = window.EventArt; if (it && A) { const k = A.kindOf({ name: it.art?.title, activity: it.art?.activity }), tone = A.toneOf({ id: it.art?.id || "", title: it.art?.title }, k); return `<span class="fv-ring-art" style="background:${A.PASTELS[tone]}">${A.drawing(k, A.SPOT[tone])}</span>`; }
    return avatar(s.host, 64); }
  const unseen = (s) => s.items.some((i) => !seen.has(i.id));
  function rail(el, stories, { signedIn = false, mine = null, onAdd = null } = {}) { css(); stories = (stories || []).filter((s) => s.items?.length);
    stories.forEach((s, i) => REG.set("rail:" + i, s)); const order = stories.map((s, i) => [s, i]).sort((a, b) => (unseen(b[0]) - unseen(a[0])) || a[1] - b[1]);
    const add = signedIn ? `<button type="button" class="fv-ring add" id="fvAdd"><span class="fv-ring-c">${mine?.thumb ? `<img src="${esc(mine.thumb)}" alt="" width="64" height="64">` : `<b aria-hidden="true">+</b>`}</span><small>Your story</small></button>` : "";
    if (!stories.length) { el.innerHTML = `<div class="fv-rail">${add}<div class="fv-peek"><span class="fv-peek-p" aria-hidden="true">${potto("wave", 70)}</span><p>No stories yet. Photos from events land here.</p></div></div>`; }
    else el.innerHTML = `<div class="fv-rail" role="list" aria-label="Stories">${add}${order.map(([s, i]) => `<button type="button" role="listitem" class="fv-ring ${unseen(s) ? "new" : "seen"}" data-fv-story="rail:${i}" aria-label="${esc(s.host.name)}${s.showcase ? ", a page on Pottery Lab" : ""}${s.recap ? ", recap of " + esc(s.recap.title) : ""}. ${s.items.length} ${s.items.length === 1 ? "story" : "stories"}${unseen(s) ? ", new" : ""}"><span class="fv-ring-c">${ringThumb(s)}</span>${s.recap ? `<i class="fv-ring-dot" title="Recap"></i>` : s.showcase && s.example ? `<i class="fv-ring-tag">Example</i>` : ""}<small>${esc(String(s.host.name || "").replace(/'s\b/, ""))}</small></button>`).join("")}</div>`;
    el.hidden = false; $("#fvAdd", el) && ($("#fvAdd", el).onclick = () => onAdd?.());
    $$("[data-fv-story]", el).forEach((b) => (b.onclick = () => openStories(order.map(([, i]) => "rail:" + i), order.findIndex(([, i]) => "rail:" + i === b.dataset.fvStory), b))); }
  function refreshRings() { $$("[data-fv-story^='rail:']").forEach((b) => { const s = REG.get(b.dataset.fvStory); if (s && !unseen(s) && b.classList.contains("new")) { b.classList.remove("new"); b.classList.add("seen", "just-seen"); } }); }

  // ---------- recap stories (server/feedvisual.js recapOf): a title card, the photos, a kudos quote, what's next ----------
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  function recapCard(it) { const R = it.recap || {}, T = tintOf({ ...(R.art || {}), look: it.look });
    const pic = R.cover ? `<span class="fv-rc-pol">${tape(0, "top")}<img src="${esc(R.cover)}" alt="" decoding="async"></span>` : `<span class="fv-rc-pol art">${tape(0, "top")}<span class="fv-rc-art">${art({ ...(R.art || {}), look: it.look }, { title: "" })}</span></span>`;
    return `<div class="fv-sv-rc" style="${tintStyle(T)}"><div class="fv-rc-in">${sticker("Recap", "new")}${pic}<h2 class="fv-rc-t">${esc(R.title || "")}</h2>
      ${R.came ? `<p class="fv-rc-came"><b>${esc(R.came)}</b> came</p>` : ""}<p class="fv-rc-sub">${esc([dayOf(R.date, { weekday: "long", month: "short", day: "numeric" }), R.where, R.photos ? plural(R.photos, "photo") : "", R.kudos ? plural(R.kudos, "kudos").replace(/kudoss$/, "kudos") : ""].filter(Boolean).join(" · "))}</p></div></div>`; }
  function quoteCard(it) { const Q = it.quote || {}; return `<div class="fv-sv-q"><figure class="fv-quote big" style="--n:${NOTE[0]};--r:-2deg"><span class="fv-pin" aria-hidden="true"></span><blockquote>"${esc(Q.text)}"</blockquote><figcaption>${esc(Q.name || "A guest")}${it.caption ? ` · ${esc(String(it.caption).split(" · ")[0])}` : ""}</figcaption></figure></div>`; }
  function endCard(it, s) { const N = it.end?.next, h = s.host || {};
    return `<div class="fv-sv-end"><div class="fv-end-in">${N?.cover ? `<span class="fv-rc-pol sm">${tape(1, "top")}<img src="${esc(N.cover)}" alt="" decoding="async"></span>` : avatar(h, 84)}${N ? `<p class="fv-end-k">Next up</p><h2>${esc(N.title)}</h2><p>${esc(when(N))}</p>` : `<p class="fv-end-k">That's the recap</p><h2>Catch the next one</h2><p>Follow ${esc(first(h.name) || "this host")} to hear first when they post a date.</p>`}</div></div>`; }
  async function followFrom(b) { if (b.disabled) return; b.disabled = true; try { const r = await fetch("/api/public/follow", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: b.dataset.fvFollow, via: "recap" }) });
      if (r.ok) { b.textContent = "Following"; return; } location.href = b.dataset.url || "#"; } catch { location.href = b.dataset.url || "#"; } }

  // ---------- the viewer ----------
  function openStories(keys, si = 0, opener = null, k0 = 0) { css(); const sets = keys.map((k) => REG.get(k)).filter(Boolean); if (!sets.length) return; si = Math.max(0, Math.min(si, sets.length - 1));
    let s = sets[si], k = Math.max(0, Math.min(k0, s.items.length - 1)), raf = 0, t0 = 0, elapsed = 0, dur = 5000, paused = false, hold = null, muted = true, vid = null, down = null;
    try { muted = sessionStorage.getItem("fv.unmuted") !== "1"; } catch {}
    const el = document.createElement("div"); el.className = "fv-sv"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.tabIndex = -1;
    document.body.appendChild(el); const prevOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const close = () => { cancelAnimationFrame(raf); vid?.pause(); el.remove(); document.body.style.overflow = prevOverflow; document.removeEventListener("keydown", onKey, true); refreshRings(); (opener && document.contains(opener) ? opener : null)?.focus(); };
    const next = () => { if (k < s.items.length - 1) { k++; show(); } else if (si < sets.length - 1) { si++; s = sets[si]; k = 0; show(); } else close(); };
    const prev = () => { if (k > 0) { k--; show(); } else if (si > 0) { si--; s = sets[si]; k = s.items.length - 1; show(); } else { elapsed = 0; show(); } };
    const setPaused = (p) => { paused = p; el.classList.toggle("paused", p); const b = $(".fv-sv-pause", el); if (b) { b.setAttribute("aria-pressed", String(p)); b.setAttribute("aria-label", p ? "Play" : "Pause"); b.innerHTML = p ? "▶" : "❚❚"; } if (vid) p ? vid.pause() : vid.play().catch(() => {}); if (!p) t0 = performance.now() - elapsed; };
    function prefetch() { const n = s.items[k + 1] || sets[si + 1]?.items[0]; if (!n) return; if (n.type === "image" && n.url) { const i = new Image(); i.decoding = "async"; i.src = n.url; } else if (n.type === "video") { if (n.poster) new Image().src = n.poster; const v = document.createElement("video"); v.preload = "auto"; v.muted = true; v.src = n.url; } }
    function show() { cancelAnimationFrame(raf); vid?.pause(); vid = null; const it = s.items[k]; seen.add(it.id); elapsed = 0; t0 = performance.now();
      const T = it.type === "art" ? tintOf({ ...it.art, look: it.look }) : null;
      const media = it.type === "video" ? `<video src="${esc(it.url)}" ${it.poster ? `poster="${esc(it.poster)}"` : ""} playsinline ${muted ? "muted" : ""} autoplay preload="auto" aria-label="${esc(it.caption)}"></video>`
        : it.type === "image" ? `<img src="${esc(it.url)}" alt="${esc(it.note || it.caption || "Story photo")}" decoding="async">`
        : it.type === "recap" ? recapCard(it) : it.type === "quote" ? quoteCard(it) : it.type === "end" ? endCard(it, s)
        : `<div class="fv-sv-art" style="${tintStyle(T)}"><div class="fv-sv-artc">${art({ ...it.art, look: it.look }, { title: it.art?.title || "" })}</div></div>`;
      el.setAttribute("aria-label", `Stories from ${s.host.name}`); el.classList.toggle("light", ["recap", "end"].includes(it.type)); // dark words on the pale recap cards
      el.innerHTML = `<div class="fv-sv-in"><div class="fv-sv-bars" aria-hidden="true">${s.items.map((_, i) => `<i><b style="transform:scaleX(${i < k ? 1 : 0})"></b></i>`).join("")}</div>
        <div class="fv-sv-top">${avatar(s.host, 36)}<div><b>${esc(s.host.name)}</b><small>${esc(it.caption || "")}${it.by ? ` · from ${esc(it.by)}` : ""}</small></div>
          ${it.type === "video" ? `<button type="button" class="fv-sv-mute" aria-pressed="${!muted}" aria-label="${muted ? "Unmute" : "Mute"}">${muted ? "🔇" : "🔊"}</button>` : ""}<button type="button" class="fv-sv-pause" aria-pressed="false" aria-label="Pause">❚❚</button><button type="button" class="fv-sv-x" aria-label="Close stories">✕</button></div>
        <div class="fv-sv-stage">${media}</div>
        <button type="button" class="fv-sv-prev" aria-label="Previous story"><span aria-hidden="true">‹</span></button><button type="button" class="fv-sv-next" aria-label="Next story"><span aria-hidden="true">›</span></button>
        <div class="fv-sv-foot">${it.cta?.follow ? `<button type="button" class="fv-sv-cta" data-fv-follow="${esc(it.cta.follow)}" data-url="${esc(it.cta.url || "#")}">${esc(it.cta.label || "Follow")}</button>` : `<a class="fv-sv-cta${it.type === "end" ? " big" : ""}" href="${esc(it.cta?.url || "#")}">${esc(it.cta?.label || "See page")} <span aria-hidden="true">→</span></a>`}${it.type === "end" && it.ev && !/^s[cx]-/.test(it.ev) ? `<button type="button" class="fv-sv-cta" data-pl-like="${esc(it.ev)}" data-title="${esc(it.end?.title || "")}"><i class="gl" style="--g:var(--g-spark)" aria-hidden="true"></i> Host one like this</button>` : ""}${it.type === "video" && muted ? `<button type="button" class="fv-sv-unmute">🔇 Tap for sound</button>` : ""}</div>
        <p class="fv-sv-sr" aria-live="polite">${esc(`${k + 1} of ${s.items.length}. ${it.caption || ""}`)}</p></div>`;
      const bars = $$(".fv-sv-bars b", el), bar = bars[k];
      $(".fv-sv-x", el).onclick = close; $(".fv-sv-prev", el).onclick = prev; $(".fv-sv-next", el).onclick = next; $(".fv-sv-pause", el).onclick = () => setPaused(!paused);
      const mute = (m) => { muted = m; try { sessionStorage.setItem("fv.unmuted", m ? "0" : "1"); } catch {} if (vid) vid.muted = m; const b = $(".fv-sv-mute", el); if (b) { b.textContent = m ? "🔇" : "🔊"; b.setAttribute("aria-pressed", String(!m)); b.setAttribute("aria-label", m ? "Unmute" : "Mute"); } $(".fv-sv-unmute", el)?.remove(); };
      $(".fv-sv-mute", el) && ($(".fv-sv-mute", el).onclick = () => mute(!muted)); $(".fv-sv-unmute", el) && ($(".fv-sv-unmute", el).onclick = (e) => { e.stopPropagation(); mute(false); });
      $(".fv-sv-cta[data-fv-follow]", el) && ($(".fv-sv-cta[data-fv-follow]", el).onclick = (ev) => { ev.stopPropagation(); followFrom(ev.currentTarget); });
      vid = $(".fv-sv-stage video", el); dur = it.type === "video" ? 15000 : it.type === "end" ? 8000 : it.type === "recap" || it.type === "quote" ? 6000 : 5000;
      if (vid) { vid.onloadedmetadata = () => { if (isFinite(vid.duration) && vid.duration > 0) dur = Math.min(15, vid.duration) * 1000; }; vid.onended = () => next(); vid.onerror = () => { dur = 5000; }; vid.play?.().catch(() => { if (!muted) { mute(true); vid.play().catch(() => {}); } }); }
      const tick = (t) => { if (!paused) { elapsed = vid && vid.currentTime > 0 && isFinite(vid.duration) ? vid.currentTime * 1000 : t - t0; const p = Math.min(1, elapsed / dur); bar.style.transform = `scaleX(${p})`; if (p >= 1) return next(); } raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick); if (paused) setPaused(true); prefetch();
      // tap left or right, hold to pause, swipe down to close
      const stage = $(".fv-sv-stage", el);
      stage.onpointerdown = (e) => { if (e.button) return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; hold = setTimeout(() => { hold = "held"; setPaused(true); }, 220); };
      stage.onpointermove = (e) => { if (!down) return; const dy = e.clientY - down.y; if (dy > 12) { clearTimeout(hold); el.style.setProperty("--drag", Math.min(dy, 240) + "px"); el.classList.add("dragging"); } };
      const up = (e) => { if (!down) return; const dy = e.clientY - down.y, dx = e.clientX - down.x, held = hold === "held"; clearTimeout(hold); hold = null; el.classList.remove("dragging"); el.style.removeProperty("--drag"); const d0 = down; down = null;
        if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return close(); if (held) return setPaused(false); if (Math.abs(dx) > 50) return dx < 0 ? next() : prev();
        if (performance.now() - d0.t < 400) { const r = stage.getBoundingClientRect(); (e.clientX - r.left < r.width / 3 ? prev : next)(); } };
      stage.onpointerup = up; stage.onpointercancel = () => { clearTimeout(hold); down = null; el.classList.remove("dragging"); if (hold === "held") setPaused(false); }; }
    const onKey = (e) => { if (!document.contains(el)) return; if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "ArrowRight") { e.preventDefault(); next(); } else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); } else if ((e.key === " " || e.key === "k") && !/^(BUTTON|A)$/.test(document.activeElement?.tagName || "")) { e.preventDefault(); setPaused(!paused); } else if (e.key === "m" && vid) { $(".fv-sv-mute", el)?.click(); }
      else if (e.key === "Tab") { const F = $$("button,a[href]", el).filter((x) => x.offsetParent !== null); if (!F.length) return; const i = F.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); F.at(-1).focus(); } else if (!e.shiftKey && i === F.length - 1) { e.preventDefault(); F[0].focus(); } } };
    document.addEventListener("keydown", onKey, true); show(); $(".fv-sv-x", el)?.focus({ preventScroll: true });
    return { close }; }

  // ---------- cards: three kinds. An event (photo first, one button), a scrapbook page (photos from the day), a tile ----------
  // Calm by default: cards sit on the page with a line, not a sticker shadow; only instant photos tilt, and gently.
  let nTilt = 0; const tilt = () => TILT[nTilt++ % TILT.length] / 2;
  // ---- slots for the new-user work (Save, Friends going, Inspo, Hosts you might like): each fills in only when its renderer or endpoint exists ----
  const saveSpot = (item) => `<span class="fv-save" data-fv-save="${esc(JSON.stringify(item))}" hidden></span>`;
  const friendsSpot = (e) => `<span class="fv-friends" data-fv-friends="${esc(e.id || "")}"${(e.friendsGoing || []).length ? ` data-names="${esc(JSON.stringify(e.friendsGoing.slice(0, 4)))}"` : ""} hidden></span>`;
  // a card's one button (server/feedvisual.js eventCta/afterCta): the next date, the thing to book or ask about, or Follow
  const ctaOf = (e) => e.cta || { label: "I'm in", url: e.url || "#" };
  const ctaBtn = (c, cls = "fv-btn primary") => (c.follow ? `<button type="button" class="${cls}" data-fv-follow="${esc(c.follow)}" data-url="${esc(c.url || "#")}">${esc(c.label || "Follow")}</button>` : `<a class="${cls}" href="${esc(c.url || "#")}">${esc(c.label)}</a>`);
  const slot = (name, inner = "", hidden = true) => `<div class="fv-slot" data-fv-slot="${name}"${hidden ? " hidden" : ""}>${inner}</div>`;
  // app store: report and block (public/safety.js adds a "More" button to anything with data-report)
  const rep = (o) => ` data-report="${esc(JSON.stringify(o))}"`;
  const byline = (b) => (b ? `<p class="fv-by"${b.who?.key ? rep({ type: "person", target: "person:" + b.who.key, key: b.who.key, name: b.who.name || "" }) : ""}>${avatar(b.who, 24)}<span>${b.html}</span></p>` : "");
  // secondary actions live behind one quiet "More" button
  const more = (L, label = "") => { L = L.filter(Boolean); return L.length ? `<details class="fv-more"><summary aria-label="More${label ? " for " + esc(label) : ""}"><span aria-hidden="true"></span></summary><div class="fv-menu">${L.join("")}</div></details>` : ""; };
  // one quiet word under an event at most: Example, spots left, or how many are in (friends going wins when it loads)
  const statusOf = (e) => (e.sample ? "Example" : e.spotsLeft != null && e.spotsLeft <= 3 ? (e.spotsLeft ? `${e.spotsLeft} spot${e.spotsLeft === 1 ? "" : "s"} left` : "Full") : e.going >= 3 ? `${e.going} are in` : "");
  // an event coming up: the flyer or cover big at 4:5 (a poster sits whole on linen), then who, what, when, one button
  function flyer(e, { by = null, eager = false } = {}) { const L = e.look || {}, poster = false, st = statusOf(e); if (e.id) EVS.set(String(e.id), e); /* the frame: always the 4:5 crop, never a letterboxed poster */
    const media = coverOK(e) ? `<img class="fv-img" data-fv-q src="${esc(e.cover)}" alt="" width="800" height="1000" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" style="object-fit:cover;object-position:${coverPos(L)}">` : art(e, { title: "" }); /* the heading below has the title: never twice */
    return `<article class="fv-card fv-ev kit-story${poster ? " poster" : ""}" data-fv-id="${esc(e.id || "")}" style="${window.EncoreBrandKit?.storyStyle(e.host) || ""}">
      <a class="fv-media" href="${esc(e.cta?.url || e.url)}" tabindex="-1" aria-hidden="true">${media}</a>
      <div class="fv-body"><p class="fv-host">${avatar(e.host, 24)}<span><b>${esc(e.host?.name || "A host")}</b>${by?.note ? ` · ${esc(by.note)}` : ""}</span></p>
        <h3 class="fv-title"><a href="${esc(e.cta?.url || e.url)}">${esc(e.title)}</a></h3><p class="fv-data">${[when(e), where(e)].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</p>
        ${friendsSpot(e)}${togetherSpot(e)}${st ? `<p class="fv-cap2">${esc(st)}</p>` : ""}
        <div class="fv-acts"><a class="fv-btn primary" data-fv-in href="${esc(e.cta?.url || e.url)}">${esc(btnText(e, e.cta?.label || "I'm in"))}</a>${more([withBtn(e), saveSpot({ kind: "event", id: e.id, ref: e.id, title: e.title, url: e.url, image: e.cover || "", img: e.cover || "" })], e.title)}</div></div></article>`; }
  // "Come with me?" (public/comewith.js): signed in, a link for one friend from your own reply; "Mia and Jo are in" once both are
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const withBtn = (e) => (signedIn() && e.id && !e.sample && !e.past ? `<button type="button" class="fv-mi fv-cwm" data-fv-with="${esc(e.id)}" data-title="${esc(e.title)}" data-url="${esc(e.url)}">Invite friends</button>` : "");
  const togetherSpot = (e) => ((e.together || []).length ? `<span class="fv-together" data-fv-together="${esc(JSON.stringify(e.together.slice(0, 2)))}" hidden></span>` : "");
  // "Host one like this" (public/hostlike.js) on a real past event, and how many hosted one after seeing it
  const likeBtn = (e) => (e.id && !e.sample && !/^s[cx]-/.test(e.id) ? `<button type="button" class="fv-mi fv-like" data-pl-like="${esc(e.id)}" data-title="${esc(e.title)}">Host one like this</button>${e.hostedLine ? `<small class="fv-mnote">${esc(e.hostedLine)}</small>` : ""}` : "");
  // a tile for a row: a small 4:5 picture, a title, one line
  function mini(e, { cityToo = false } = {}) { if (e.id) EVS.set(String(e.id), e); const cap = [short(e), cityToo ? e.city || where(e) : where(e), e.sample ? "Example" : ""].filter(Boolean).join(" · ");
    return `<a class="fv-tile" href="${esc(e.cta?.url || e.url)}" data-fv-id="${esc(e.id || "")}"><span class="fv-tile-m">${coverOK(e) ? `<img class="fv-img" data-fv-q src="${esc(e.cover)}" alt="" width="200" height="250" loading="lazy" decoding="async" style="object-position:${coverPos(e.look)}">` : art(e, { title: "" })}</span><b>${esc(e.title)}</b><small>${esc(cap)}</small></a>`; }
  // a past event as a scrapbook page: one big instant photo with tape, two smaller ones, who came, one kudos quote
  function dump(e, { by = null, key = "", photos = null, quote = null } = {}) { const P = (photos || e.photos || []).slice(0, 8);
    if (e.cover && !P.some((p) => p.url === e.cover)) P.unshift({ id: "cover", url: e.cover, type: "image", caption: "" });
    const sk = key || "ev:" + e.id; REG.set(sk, { host: e.host || { name: e.title }, items: P.map((p, i) => ({ id: "m:" + (p.id || i) + ":" + e.id, type: p.type === "video" ? "video" : "image", url: p.url, poster: p.poster, caption: [e.title, dayOf(e.date, { weekday: "short" })].filter(Boolean).join(" · "), note: p.caption, by: p.by, past: true, cta: { label: "See page", url: e.page || e.url || "#" } })) });
    const show = P.slice(0, 3), extra = P.length - show.length, r = tilt();
    const ph = (p, i) => `<button type="button" class="fv-ph${i ? "" : " lead"}"${i ? "" : ` style="--r:${r}deg"`} data-fv-open="${esc(sk)}" data-k="${i}" aria-label="Open photo ${i + 1} of ${P.length}${p.caption ? ": " + esc(p.caption) : ""}">${i ? "" : tape(0, "top")}${mediaBox(p, { ratio: i ? "1/1" : "4/5" })}${i ? "" : `<span class="fv-cap">${esc(p.caption || (p.by ? "from " + p.by : dayOf(e.date, { month: "short", day: "numeric" })))}</span>`}${i && i === show.length - 1 && extra > 0 ? `<span class="fv-plus" aria-hidden="true">+${extra}</span>` : ""}</button>`;
    const album = show.length ? `<div class="fv-album n${show.length}">${show.map(ph).join("")}</div>` : `<div class="fv-album n1"><span class="fv-ph lead art" style="--r:${r}deg">${tape(0, "top")}<span class="fv-mb" style="aspect-ratio:4/5">${art(e)}</span><span class="fv-cap">${esc(dayOf(e.date, { month: "short", day: "numeric" }))}</span></span></div>`;
    const data = [dayOf(e.date, { weekday: "short", month: "short", day: "numeric" }), where(e), e.came ? `${e.came} came` : "", e.kudos ? `${e.kudos} kudos` : "", e.sample ? "Example" : ""].filter(Boolean).join(" · ");
    const Q = quote || e.quote, q = Q?.text ? `<blockquote class="fv-q"${rep({ type: "kudos", text: Q.text, name: Q.name || "" })}><p>"${esc(Q.text)}"</p><cite>${esc(Q.name || "A guest")}</cite></blockquote>` : "";
    const drop = !by && e.newPhotos ? { who: e.host, html: `<b>${esc(e.host?.name || "A host")}</b> · ${esc(plural(e.newPhotos, "new photo"))} from guests` } : null; by = by || drop || (e.host ? { who: e.host, html: `<b>${esc(e.host.name)}</b>` } : null);
    return `<article class="fv-card fv-scrap${drop ? " drop" : ""}" data-fv-id="${esc(e.id || "")}">${byline(by)}${album}<h3 class="fv-title sm"><a href="${esc((ctaOf(e).follow ? "" : ctaOf(e).url) || e.page || e.url || "#")}">${esc(e.title)}</a></h3><p class="fv-data">${esc(data)}</p>${q}
      <div class="fv-acts">${ctaBtn(ctaOf(e))}${e.id ? reacts(e) : ""}${more([likeBtn(e), (e.sample || /^s[cx]-/.test(e.id || "") ? "" : saveSpot({ kind: "event", id: e.id, ref: e.id, title: e.title, url: e.page || e.url || "", img: P[0]?.poster || (P[0]?.type === "video" ? "" : P[0]?.url) || "" }))], e.title)}</div></article>`; }
  // one reaction, quiet: 🔥 and its count
  function reacts(e) { const C = e.reacts || {}, M = new Set(e.myReacts || []), x = "🔥"; return `<button type="button" class="fv-react" data-fv-react="${esc(e.id)}" data-e="${x}" aria-pressed="${M.has(x)}" aria-label="Fire${C[x] ? ", " + C[x] : ""}"><span aria-hidden="true">${x}</span><b>${C[x] || ""}</b></button>`; }
  const hostTile = (h) => `<a class="fv-tile host" href="/@${esc(h.handle)}">${avatar({ ...h, avatarArt: h.avatarArt || h.theme?.avatarArt, avatarUrl: h.avatarUrl || h.theme?.avatarUrl, color: h.color || h.theme?.accent }, 72)}<b>${esc(h.name)}</b><small>${esc(h.city || h.why || "")}</small></a>`;
  const row = (inner, label) => `<div class="fv-row" tabindex="0" role="group" aria-label="${esc(label)}">${inner}</div>`;
  const head = (title, sub = "") => `<header class="fv-h"><h2>${title}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</header>`;
  const section = (cls, inner) => `<section class="fv-sec ${cls}">${inner}</section>`;

  // ---------- the blended stream (server/feedblend.js): events, recaps, milestones, who to follow, ideas, posts ----------
  // Every card leads with its host. One accent (the brand's ember) for the one primary button; the host's own colour
  // only as the ring around their face. Thin lines between cards, words doing the work.
  const ICON = {
    kudos: `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2v2.2M4.6 5.4l1.5 1.5M15.4 5.4l-1.5 1.5"/><path d="M6.8 17h6.4a1.6 1.6 0 0 0 1.6-1.6v-3.9a1.6 1.6 0 0 0-1.6-1.6h-2.4l.5-2.1a1.3 1.3 0 0 0-2.5-.6L7.2 10H6.8z"/><path d="M4 10h2.8v7H4z"/></svg>`,
    comment: `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h12a1 1 0 0 1 1 1v7.2a1 1 0 0 1-1 1H9l-3.6 2.8v-2.8H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/></svg>`,
    share: `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12.5V3.5M6.6 6.8 10 3.4l3.4 3.4"/><path d="M5 10.5v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5"/></svg>`,
    x: `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>`,
  };
  const okColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  // a face with a thin ring in the host's own colour (their brand shows here, small)
  const ringed = (h, size = 36) => `<span class="fb-ring" style="--ring:${esc(okColor(h?.color) || "var(--line-strong)")}">${avatar(h, size)}</span>`;
  const followBtn = (h) => (!h || h.following || h.mine ? "" : `<button type="button" class="fb-follow-in" data-fb-follow="${esc(h.handle)}" data-url="/@${esc(h.handle)}#follow">Follow<span class="fb-sr"> ${esc(h.name)}</span></button>`);
  const lead = (h, sub, report) => `<header class="fb-lead"${report ? rep(report) : ""}><a class="fb-host" href="/@${esc(h.handle)}">${ringed(h)}<span><b>${esc(h.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></a>${followBtn(h)}</header>`;
  // a small row of faces: named people first, then unnamed sketch faces (never a name we may not show)
  const sketch = (f) => `<span class="fv-av" style="--c:${esc(okColor(f.color) || "#E26D8E")};width:24px;height:24px" aria-hidden="true">${window.EncoreAvatars && f.art ? window.EncoreAvatars.svg(f.art, f.color || "#E26D8E", 24) : ""}</span>`;
  const stack = (faces = [], sketches = []) => (faces.length || sketches.length ? `<span class="fb-stack" aria-hidden="true">${faces.slice(0, 3).map((f) => initial(f, 24)).join("")}${sketches.slice(0, 3 - Math.min(3, faces.length)).map(sketch).join("")}</span>` : "");
  const initial = (f, size) => `<span class="fv-av fb-ini" style="--c:${esc(okColor(f.color) || "#D9CCBB")};width:${size}px;height:${size}px" aria-hidden="true">${esc(String(f.name || "?").slice(0, 1).toUpperCase())}</span>`;
  // kudos and comments: what each card shows now. The item itself is kept up to date, so a redraw keeps a tap, and
  // the count sits on the button ("Kudos · 3") with the line of names above the row.
  const SOC = new Map(); let SI = false;
  const nNum = (n) => (n > 0 ? (n > 999 ? "999+" : String(n)) : "");
  // the same words the server writes (server/feedblend.js kudosLine), for the moment between a tap and its answer
  const kLine = (count, mine, names = []) => { if (!count) return ""; const others = count - (mine ? 1 : 0);
    if (mine) return !others ? "You gave kudos" : others === 1 && names.length === 1 ? `You and ${names[0]} gave kudos` : `You and ${others} more gave kudos`;
    return !names.length ? `${count} ${count === 1 ? "person" : "people"} gave kudos` : count === 1 ? `${names[0]} gave kudos` : count === 2 && names.length >= 2 ? `${names[0]} and ${names[1]} gave kudos` : `${names[0]} and ${count - 1} more gave kudos`; };
  const kudosIn = (k) => `${stack((k?.names || []).map((n) => ({ name: n })))}<span>${esc(k?.line ?? kLine(k?.count || 0, !!k?.mine, k?.names || []))}</span>`;
  const kudosLine = (k) => `<p class="fb-count" data-fb-count="${esc(k?.target || "")}"${k?.count ? "" : " hidden"}>${kudosIn(k)}</p>`;
  const kudosBtn = (k, cls = "fb-act", label = "Kudos") => `<button type="button" class="${cls}" data-fb-kudos="${esc(k.target)}" aria-pressed="${!!k.mine}">${ICON.kudos}<span>${esc(label)}</span><i class="fb-n" data-fb-kn>${nNum(k.count)}</i></button>`;
  // Comment opens the thread in a sheet (public/feedcomments.js); signed out it goes to sign in
  const commentBtn = (it) => { const t = it.kudos?.target; if (!t) return ""; const inner = `${ICON.comment}<span>Comment</span><i class="fb-n" data-fb-cn="${esc(t)}">${nNum(it.comments?.count)}</i>`;
    return SI ? `<button type="button" class="fb-act" data-fb-comment="${esc(t)}" data-focus="1">${inner}</button>` : `<a class="fb-act" href="/login?next=${encodeURIComponent(location.pathname)}">${inner}</a>`; };
  // the latest one or two comments, quiet, under the card: "Maya  See you there", then "View all 5 comments"
  const cmIn = (t, c = {}) => { const L = c.last || [], n = c.count || 0;
    return L.map((x) => `<p class="fb-cm-l"><b>${esc(x.mine ? "You" : x.name || "Someone")}</b> ${esc(x.text)}</p>`).join("") + (n > L.length ? `<button type="button" class="fb-cm-all" data-fb-comment="${esc(t)}">View all ${n} comments</button>` : ""); };
  const cmPreview = (it) => { const t = it.kudos?.target; return t ? `<div class="fb-cm" data-fb-cm="${esc(t)}"${it.comments?.count ? "" : " hidden"}>${cmIn(t, it.comments)}</div>` : ""; };
  // the quiet row under a post: kudos, comment, share, then the comment preview
  function actRow(it, { kudosLabel = "Kudos" } = {}) { const k = it.kudos || {};
    return `${kudosLine(k)}<div class="fb-acts" role="group" aria-label="Actions">
      ${k.target ? kudosBtn(k, "fb-act", kudosLabel) : ""}
      ${commentBtn(it)}
      ${it.share ? `<button type="button" class="fb-act" data-fb-share="${esc(it.share.url)}" data-title="${esc(it.share.title || "")}">${ICON.share}<span>Share</span></button>` : ""}</div>${cmPreview(it)}`; }
  const meta = (L) => `<p class="fb-meta">${esc(L.filter(Boolean).join(" · "))}</p>`;
  function evCard(e, i) { const st = e.spotsLeft != null && e.spotsLeft <= 5 ? (e.spotsLeft ? `${e.spotsLeft} spot${e.spotsLeft === 1 ? "" : "s"} left` : "Full") : "";
    const media = e.cover ? `<img class="fv-img" src="${esc(e.cover)}" alt="" width="800" height="500" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : art({ ...e, hood: e.where }, { title: "" });
    const P = e.proof || {};
    return `<article class="fb-card fb-ev" data-fv-id="${esc(e.id)}" data-kind="event">${lead(e.host, [e.members ? "For members" : e.drop ? "Drop" : e.followed ? "A host you follow" : "", e.where].filter(Boolean).join(" · "), { type: "event", target: "event:" + e.id, name: e.title })}
      ${P.line ? `<p class="fb-proof">${stack(P.faces, P.sketches)}<span>${esc(P.line)}</span></p>` : ""}
      <a class="fb-media" href="${esc(e.cta.url)}" tabindex="-1" aria-hidden="true">${media}</a>
      <h3 class="fb-title"><a href="${esc(e.cta.url)}">${esc(e.title)}</a></h3>${e.line ? `<p class="fb-line">${esc(e.line)}</p>` : ""}
      ${meta([when(e), e.free ? "Free" : e.price, st])}
      <a class="fb-cta" data-fv-in href="${esc(e.cta.url)}">${esc(e.cta.label)}</a>${actRow(e)}</article>`; }
  function recapCard(r) { const key = "fb:" + r.id;
    REG.set(key, { host: r.host, items: (r.photos || []).map((p, i) => ({ id: "m:" + (p.id || i) + ":" + r.id, type: p.type === "video" ? "video" : "image", url: p.url, poster: p.poster, caption: [r.title, dayOf(r.date, { weekday: "short" })].filter(Boolean).join(" · "), note: p.caption, by: p.by, past: true, cta: r.next ? { label: "I'm in", url: r.next.url } : { label: "Share", url: r.share.url } })) });
    const sub = ["Recap", dayOf(r.date, { weekday: "short", month: "short", day: "numeric" }), r.where].filter(Boolean).join(" · ");
    return `<article class="fb-card fb-recap" data-fv-id="${esc(r.id)}" data-kind="recap">${lead(r.host, sub, { type: "event", target: "event:" + r.id, name: r.title })}
      ${r.by ? `<p class="fb-by">${initial(r.by, 20)}<span><b>${esc(r.by.name)}</b> shared ${esc(plural(r.by.photos, "photo"))}</span></p>` : ""}
      <h3 class="fb-title sm">${esc(r.title)}</h3>
      ${r.note ? `<blockquote class="fb-note"${rep({ type: "kudos", text: r.note.text, name: r.note.name || "" })}><p>${esc(r.note.text)}</p>${r.note.name ? `<cite>${esc(r.note.name)}</cite>` : ""}</blockquote>` : ""}
      ${r.stats?.length ? `<p class="fb-stats">${r.stats.map((s) => `<span>${esc(s)}</span>`).join("")}</p>` : ""}
      <div class="fb-photos" role="group" aria-label="Photos from ${esc(r.title)}" tabindex="0">${(r.photos || []).map((p, i) => `<button type="button" class="fb-ph" data-fv-open="${esc(key)}" data-k="${i}" aria-label="Open photo ${i + 1} of ${r.photos.length}">${mediaBox(p, { ratio: "4/5" })}</button>`).join("")}</div>
      ${r.next ? `<a class="fb-next" href="${esc(r.next.url)}"><span>Next one</span><b>${esc(dayOf(r.next.date, { weekday: "short", month: "short", day: "numeric" }))}</b><i aria-hidden="true">›</i></a>` : ""}
      ${actRow(r)}</article>`; }
  function milestoneCard(m) { const k = m.kudos || {};
    return `<article class="fb-card fb-ms" data-kind="milestone">${lead(m.host, m.type === "streak" ? "Streak" : "Milestone", m.person ? { type: "person", target: "person:" + m.person.key, key: m.person.key, name: m.person.name } : { type: "host", target: "host:" + m.host.handle, handle: m.host.handle, name: m.host.name })}
      <div class="fb-ms-b"><span class="fb-ms-n" aria-hidden="true">${esc(m.type === "streak" ? m.n + "w" : ord(m.n))}</span><div><h3 class="fb-ms-t">${esc(m.text)}</h3>${m.sub ? `<p class="fb-line">${esc(m.sub)}</p>` : ""}</div></div>
      ${kudosLine(k)}<div class="fb-acts">${k.target ? kudosBtn(k, "fb-send", k.mine ? "Kudos sent" : "Send kudos") : ""}${commentBtn(m)}${m.share ? `<button type="button" class="fb-act" data-fb-share="${esc(m.share.url)}" data-title="${esc(m.share.title || "")}">${ICON.share}<span>Share</span></button>` : ""}</div>${cmPreview(m)}</article>`; }
  const ord = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  function followRow(f, signedIn) { let gone = []; try { gone = signedIn ? [] : JSON.parse(localStorage.getItem("pl.fbGone") || "[]"); } catch {}
    f = { ...f, cards: (f.cards || []).filter((c) => !gone.includes(c.type === "host" ? "host:" + c.handle : "person:" + c.key)) }; if (f.cards.length < 2) return "";
    const card = (c) => { const t = c.type === "host" ? "host:" + c.handle : "person:" + c.key;
      return `<li class="fb-fc" data-fb-card="${esc(t)}"${c.type === "person" ? rep({ type: "person", target: "person:" + c.key, key: c.key, name: c.name }) : ""}><button type="button" class="fb-x" data-fb-dismiss="${esc(t)}" aria-label="Not for me: ${esc(c.name)}">${ICON.x}</button>
        <a class="fb-fc-a" href="${esc(c.url || "#")}">${ringed(c, 64)}<b>${esc(c.name)}</b></a><small>${esc(c.reason)}</small>
        ${c.type === "host" ? `<button type="button" class="fb-fbtn" data-fb-follow="${esc(c.handle)}" data-url="/@${esc(c.handle)}#follow">Follow<span class="fb-sr"> ${esc(c.name)}</span></button>` : `<button type="button" class="fb-fbtn" data-fb-friend="${esc(c.key)}">Follow<span class="fb-sr"> ${esc(c.name)}</span></button>`}</li>`; };
    return `<section class="fb-card fb-follow" data-kind="follow" aria-labelledby="fbFollowH"><header class="fb-sec"><h2 id="fbFollowH">${esc(f.title)}</h2><a href="${signedIn ? "/people" : "/login?next=/people"}">See all</a></header>
      <ul class="fb-fcs" tabindex="0" aria-label="${esc(f.title)}">${f.cards.map(card).join("")}</ul></section>`; }
  const ideasCard = (x) => `<section class="fb-card fb-ideas" data-kind="ideas"><div><p class="fb-kick">Ideas to try</p><h3 class="fb-title sm">Small formats people loved</h3><p class="fb-line">${esc((x.titles || []).join(", "))}${x.count > 3 ? ` and ${x.count - 3} more` : ""}. Swipe through and keep the ones you'd go to, or host.</p></div>
      <div class="fb-ideas-go"><button type="button" class="fb-ghost" data-fb-deck>Swipe ideas</button><a class="fb-link" href="/ideas">See them all</a></div></section>`;
  /** A host's post to their fan club ({kind:"club"}, server/fanclub.js), shown to members only; kudos is the club heart. */
  const clubCard = (u) => (u?.host?.handle ? `<article class="fb-card fb-upd" data-kind="club">${lead(u.host, ["For " + (u.club?.name || "members"), u.at ? new Date(u.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""].filter(Boolean).join(" · "), u.report ? { type: "post", target: u.report, name: u.host.name } : null)}
      <p class="fb-text">${esc(u.text || "")}</p>${u.photo && /^\/_blob\/[A-Za-z0-9]{20}$/.test(u.photo) ? `<span class="fb-media"><img class="fv-img" src="${esc(u.photo)}" alt="" loading="lazy" decoding="async"></span>` : ""}${actRow(u)}</article>` : "");
  const rowCard = (r) => `<section class="fb-card fb-rowc" data-kind="row"><header class="fb-sec"><h2>${esc(r.title || "More coming up")}</h2><a href="/discover">Discover</a></header>${row(r.items.map((e) => mini({ ...e, hood: e.where })).join(""), r.title || "More coming up")}</section>`;
  const RENDER = { event: evCard, recap: recapCard, milestone: milestoneCard, ideas: ideasCard, club: clubCard, row: rowCard };
  /** The stream, in the server's order. postRender draws a friend's post (public/feed.html). */
  function blendHtml(B, { postRender = null, signedIn: si = false } = {}) { let n = 0; SI = !!si; SOC.clear(); for (const it of B.items || []) if (it?.kudos?.target) SOC.set(it.kudos.target, it);
    const parts = (B.items || []).map((it) => { try { if (it.kind === "post") return postRender ? postRender(it) : ""; if (it.kind === "follow") return followRow(it, si); const f = RENDER[it.kind] || RENDER[it.type]; return f ? f(it, it.kind === "event" ? n++ : 0) : ""; } catch { return ""; } }).filter(Boolean);
    return `<div class="fb-stream">${parts.join("")}</div>`; }
  // what the stream's buttons do: kudos (toggled), share, follow, add a friend, dismiss, open the ideas deck
  const say = (b, t) => { const s = b.querySelector("span"); if (s) s.textContent = t; else b.textContent = t; };
  const note = (t) => { if (window.PLToast) return window.PLToast(t); const n = document.createElement("div"); n.setAttribute("role", "status"); n.className = "fb-toast"; n.textContent = t; document.body.appendChild(n); setTimeout(() => n.remove(), 3200); };
  /** Put a card's kudos on screen (and on its item): the pressed state, the number on the button, the line of names. */
  function setKudos(t, k) { const it = SOC.get(t); if (it) it.kudos = { ...it.kudos, ...k };
    $$(`[data-fb-kudos="${CSS.escape(t)}"]`).forEach((b) => { b.setAttribute("aria-pressed", String(!!k.mine)); const n = b.querySelector("[data-fb-kn]"); if (n) n.textContent = nNum(k.count); if (b.classList.contains("fb-send")) say(b, k.mine ? "Kudos sent" : "Send kudos"); });
    $$(`[data-fb-count="${CSS.escape(t)}"]`).forEach((line) => { line.hidden = !k.count; line.innerHTML = kudosIn(k); }); }
  /** Put a card's comments on screen (and on its item): the number on the button and the preview under the card. */
  function setComments(t, c) { const it = SOC.get(t); if (it) it.comments = c;
    $$(`[data-fb-cn="${CSS.escape(t)}"]`).forEach((n) => (n.textContent = nNum(c.count))); $$(`[data-fb-cm="${CSS.escape(t)}"]`).forEach((el) => { el.hidden = !c.count; el.innerHTML = cmIn(t, c); }); }
  // fresh counts for the cards on screen: the feed answer can be a minute old signed out, or a saved copy on a slow connection
  let socT = 0; const tapped = new Map();
  function socialSoon(ms = 500) { clearTimeout(socT); socT = setTimeout(async () => { const T = [...new Set($$("[data-fb-kudos]").map((b) => b.dataset.fbKudos))].slice(0, 40), t0 = Date.now(); if (!T.length) return;
    try { const r = await fetch("/api/feed/social?targets=" + encodeURIComponent(T.join(",")), { credentials: "same-origin" }); if (!r.ok) return; const j = await r.json();
      for (const [t, x] of Object.entries(j.items || {})) { if ($(`[data-fb-kudos="${CSS.escape(t)}"][data-busy]`) || (tapped.get(t) || 0) >= t0) continue; /* a tap since we asked wins */ if (x.kudos) setKudos(t, x.kudos); if (x.comments) setComments(t, x.comments); } } catch {} }, ms); }
  function openComments(t, { focus = false, opener = null } = {}) { need("/feedcomments.js", () => window.PLComments?.open({ target: t, signedIn: SI, focus, opener, onChange: (c) => setComments(t, c), onClose: () => socialSoon(0) })); }
  // Comment and "View all N comments" open the sheet (one listener: the preview is redrawn as comments change)
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-fb-comment]"); if (!b) return; e.preventDefault(); openComments(b.dataset.fbComment, { focus: !!b.dataset.focus, opener: b }); });
  let linked = false; // a link from the inbox ("Maya commented on Sunday Supper") opens that thread: /feed?comments=<target>
  function wireBlend(root) {
    if (!linked) { linked = true; try { const q = new URLSearchParams(location.search), t = q.get("comments"); if (t) { q.delete("comments"); history.replaceState(history.state, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); openComments(t); } } catch {} }
    // kudos: the count moves at once, then takes the server's answer (count, names, line); a failed tap goes back and says why
    $$("[data-fb-kudos]", root).forEach((b) => (b.onclick = async () => { const t = b.dataset.fbKudos; if (b.dataset.busy) return;
      if (!SI) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
      tapped.set(t, Date.now());
      const was = { names: [], ...(SOC.get(t)?.kudos || { target: t, count: +(b.querySelector("[data-fb-kn]")?.textContent || 0) || 0, mine: b.getAttribute("aria-pressed") === "true" }) }, on = !was.mine, count = Math.max(0, (was.count || 0) + (on ? 1 : -1));
      setKudos(t, { ...was, mine: on, count, line: kLine(count, on, was.names) }); if (on && !RM()) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      $$(`[data-fb-kudos="${CSS.escape(t)}"]`).forEach((x) => (x.dataset.busy = 1));
      try { const r = await fetch("/api/feed/kudos", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: t }) }), j = await r.json().catch(() => ({}));
        if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
        if (!r.ok || typeof j.count !== "number") throw new Error(j.message || "");
        setKudos(t, { target: t, count: j.count, mine: !!j.mine, names: j.names || [], line: j.line }); }
      catch (e) { setKudos(t, was); note(e?.message || "Kudos didn't go through. Try again."); }
      finally { $$(`[data-fb-kudos="${CSS.escape(t)}"]`).forEach((x) => delete x.dataset.busy); } }));
    socialSoon();
    $$("[data-fb-share]", root).forEach((b) => (b.onclick = async () => { const url = location.origin + b.dataset.fbShare, title = b.dataset.title || "Pottery Lab";
      if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      try { await navigator.clipboard.writeText(url); say(b, "Link copied"); setTimeout(() => say(b, "Share"), 2200); } catch { prompt("Copy this link", url); } }));
    $$("[data-fb-follow]", root).forEach((b) => (b.onclick = async () => { if (b.disabled) return; b.disabled = true;
      try { const r = await fetch(`/api/me/following/${encodeURIComponent(b.dataset.fbFollow)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: true }) }); // server/fanclub.js: follow, bell on
        if (r.ok) { $$(`[data-fb-follow="${CSS.escape(b.dataset.fbFollow)}"]`, root).forEach((x) => { x.disabled = true; x.classList.add("on"); say(x, "Following"); }); return; } location.href = b.dataset.url; } catch { b.disabled = false; } }));
    $$("[data-fb-friend]", root).forEach((b) => (b.onclick = async () => { if (b.disabled) return; b.disabled = true;
      try { const r = await fetch("/api/me/friends", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: b.dataset.fbFriend }) }); if (!r.ok) throw 0; b.classList.add("on"); say(b, "Following"); } catch { b.disabled = false; } }));
    $$("[data-fb-dismiss]", root).forEach((b) => (b.onclick = () => { const li = b.closest("li"), ul = li?.parentElement; fetch("/api/feed/dismiss", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: b.dataset.fbDismiss }) }).catch(() => {}); try { const L = JSON.parse(localStorage.getItem("pl.fbGone") || "[]"); localStorage.setItem("pl.fbGone", JSON.stringify([b.dataset.fbDismiss, ...L].slice(0, 100))); } catch {}
      const next = li?.nextElementSibling || li?.previousElementSibling; li?.classList.add("gone"); setTimeout(() => { li?.remove(); if (ul && !ul.children.length) ul.closest(".fb-follow")?.remove(); else next?.querySelector("button,a")?.focus({ preventScroll: true }); }, RM() ? 0 : 220); }));
    $$("[data-fb-deck]", root).forEach((b) => (b.onclick = () => need("/swipedeck.js", () => window.PLDeck?.open({}))));
  }

  // ---------- putting it together: a short weekly edition ----------
  const showcasePasts = (S) => S.flatMap((P) => P.past.filter((p) => p.cover || p.photos.length).map((p) => ({ id: p.id, title: p.title, date: p.date, place: p.place, cover: p.cover, photos: p.photos.map((u, i) => ({ id: p.id + i, url: u, type: "image" })), host: P.host, page: P.page, cta: P.cta, note: p.note, sample: P.example })));
  const localTown = (V) => { let c = V?.picked?.city || ""; if (!c) try { c = (window.EncorePlace?.get() || {}).city || ""; } catch {} if (!c) try { c = (JSON.parse(localStorage.getItem("pl.interests") || "null") || {}).city || ""; } catch {} return String(c || "").split(",")[0].trim(); };
  const dayWord = (d) => { const x = /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(d + "T00:00:00") : null; /* midnight to midnight: noon made today read "tomorrow" */ if (!x) return ""; const n = Math.round((x - new Date(new Date().toDateString())) / 864e5); return n <= 0 ? "tonight" : n === 1 ? "tomorrow" : n < 7 ? "on " + x.toLocaleDateString("en-US", { weekday: "long" }) : "on " + x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  /** The feed for anyone. V: the public sections (/api/public/feed, or F.visual signed in). F: /api/me/feed when signed in. */
  function compose(V, { F = null, postRender = null, empty = "", lb = false } = {}) { css(); nTilt = 0; V = V || {};
    const town = localTown(V), tl = town.toLowerCase(), here = (e) => !tl || [e.city, e.hood, e.place].some((x) => x && (String(x).toLowerCase().includes(tl) || tl.includes(String(x).toLowerCase())));
    const t = new Date().toISOString().slice(0, 10), wk = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), seen = new Set(), E = F?.events || {}, follows = new Set(F?.following || []);
    // your people: what friends and hosts you follow did (each event once); what they're hosting joins "near you"
    const mineUp = new Map(), people = []; let lbAny = !!lb;
    for (const it of F?.items || []) { if (["leaderboard", "standing", "you-rank"].includes(it.kind)) { lbAny = true; continue; }
      if (it.kind === "post") { if (postRender) people.push(postRender(it)); continue; }
      const id = it.event?.id, e = id && E[id]; if (!e) continue;
      if (!e.past) { if (!mineUp.has(id)) mineUp.set(id, { ...e, _note: it.kind === "hosting" || follows.has(e.host?.handle) ? "a host you follow" : `${first(it.who?.name) || "A friend"} is in` }); continue; }
      if (seen.has(id) || (!(e.photos || []).length && !e.cover && !e.quote && !(it.kind === "kudos" && it.love))) continue; seen.add(id); // nothing to look at: not a scrapbook page
      const verb = it.kind === "moment" ? "added photos" : it.kind === "recap" ? "hosted" : it.kind === "kudos" ? "sent kudos" : "went";
      people.push(dump(e, { by: { who: it.who, html: `<b>${esc(it.who?.name || "Someone")}</b> ${esc(verb)}` }, quote: it.kind === "kudos" && it.love ? { text: it.love, name: first(it.who?.name) } : null })); }
    // happening near you: real events in the visitor's city, people you follow first, then the soonest; examples only to fill
    const upAll = [...mineUp.values(), ...(V.upcoming || []).filter((e) => !mineUp.has(e.id))].filter((e) => e.id && !e.past && !seen.has(e.id));
    const up = upAll.filter((e) => !e.sample), weekend = up.filter((e) => e.date <= wk && here(e)), local = up.filter(here), away = tl ? up.filter((e) => !here(e)) : [];
    const rank = (e) => (e._note || (e.friendsGoing || []).length ? 0 : 2) + (e.cover ? 0 : 1); // your people first, photos before drawings
    local.sort((a, b) => rank(a) - rank(b) || String(a.date).localeCompare(String(b.date)) || !!b.cover - !!a.cover);
    const samples = upAll.filter((e) => e.sample), big = local.slice(0, 4); while (big.length < 2 && samples.length) big.push(samples.shift());
    const further = [...local.slice(4), ...away, ...(big.length + local.length < 4 ? samples : [])].slice(0, 8); for (const e of [...big, ...further]) seen.add(e.id);
    // recently, with photos: photo drops first, then the most photos; a quiet week borrows a host page's recent day (marked Example)
    const realPast = (V.past || []).filter((e) => !seen.has(e.id) && (e.photos?.length || e.cover)).sort((a, b) => (b.newPhotos || 0) - (a.newPhotos || 0) || (b.photos?.length || 0) - (a.photos?.length || 0));
    const recent = realPast.slice(0, people.length ? 2 : 4); recent.forEach((e) => seen.add(e.id)); // even, so the desktop grid has no gap
    const scP = recent.length + people.length < 2 ? showcasePasts(V.showcase || []).slice(0, 2 - recent.length) : [];
    // the opening: today's date and city in mono, one headline made from what's really on, one line naming real things
    const now = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), lead = big.find((e) => !e.sample), drop = [...realPast, ...recent][0];
    const h1 = tl && weekend.length ? `${weekend.length} plan${weekend.length === 1 ? "" : "s"} <em>near you</em> this week` : tl && local.length ? `Good plans <em>near you</em>` : `What people are <em>hosting</em>`;
    const again = drop && lead && drop.title.toLowerCase() === lead.title.toLowerCase(), bits = [drop ? `New photos from ${drop.title}` : "", lead ? (again ? `the next one is ${dayWord(lead.date)}` : [lead.title, dayWord(lead.date)].filter(Boolean).join(" ")) : ""].filter(Boolean); /* a drop has no day: "Pandan honeycomb cake.", not "Pandan honeycomb cake ." */
    const lede = bits.length ? bits.join(bits.length > 1 ? ", and " : "").replace(/^(.)/, (c) => c.toUpperCase()) + "." : "Small dinners, wheel nights and slow runs from hosts on Pottery Lab.";
    const intro = `<section class="fv-intro" aria-labelledby="fvH1"><p class="fv-kicker"><span>${esc(now)}</span><span id="feedPlace">${esc(town)}</span></p>
      <h1 id="fvH1">${h1}</h1><p class="fv-lede">${esc(lede)}</p>${F ? "" : `<p class="fv-sub"><a href="/login?next=/feed">Sign in</a> to see your friends.</p>`}<span class="fv-potto" aria-hidden="true">${potto("wave", 64)}</span></section>`;
    // when the headline already says "near you", the section's own heading is there for screen readers and wide screens
    const nearHead = tl ? head(`Happening <em>near you</em>`, local.length ? "" : `Nothing in ${town} yet. Here's what people are hosting elsewhere.`).replace('class="fv-h"', `class="fv-h${local.length ? " fv-h-quiet" : ""}"`) : head("Coming up");
    // nothing near: "Be the first", with 3 ideas to try and Host this (public/ideasnudge.js fills it after render)
    const stuck = tl && !local.length ? `<div data-pli-empty></div>` : "";
    if (stuck) setTimeout(() => { const el = document.querySelector("[data-pli-empty]:not([data-done])"); if (!el) return; el.dataset.done = "1"; const go = () => window.PLIdeas?.list(el, { lead: "Nothing near you yet", sub: "Be the first: try one of these.", n: 3 });
      if (window.PLIdeas) go(); else { const s = document.createElement("script"); s.src = "/ideasnudge.js"; s.onload = go; document.head.appendChild(s); } }, 0);
    const nearS = big.length || further.length || stuck ? section("fv-near", nearHead + stuck + (big.length ? `<div class="fv-grid">${big.map((e, i) => flyer(e, { by: e._note ? { note: e._note } : null, eager: i === 0 })).join("")}</div>` : "") + (further.length ? `<h3 class="fv-sub-h">More coming up</h3>` + row(further.map((e) => mini(e, { cityToo: !here(e) })).join(""), "More coming up") : "")) : "";
    const peopleS = section("fv-people", F ? head("Your <em>people</em>", people.length ? "" : "Follow a host or add a friend. What they share lands here.") + `<div id="fvComposer"></div>` + (people.length ? `<div class="fv-grid">${people.slice(0, 4).join("")}</div>` : empty) + slot("hosts", `<h3 class="fv-sub-h">Hosts you might like</h3>`) : head("Find your <em>people</em>", "Follow a host to hear first when they post a date.") + slot("hosts")).replace('class="fv-sec fv-people"', F ? 'class="fv-sec fv-people"' : 'class="fv-sec fv-people" hidden'); // signed out, it shows once there are hosts to show
    const recentS = recent.length || scP.length ? section("fv-recent", head("Recently, <em>with photos</em>") + `<div class="fv-grid">${[...recent.map((e) => dump(e)), ...scP.map((e) => dump(e, { key: "sc:" + e.id }))].join("")}</div>`) : "";
    // ideas to try: the ideas library when it loads, with older things from hosts' pages after (More ideas to try)
    const older = (V.ideas || []).map((x) => `<a class="fv-tile" href="${esc(x.page || "/ideas")}"><span class="fv-tile-m">${x.cover ? `<img class="fv-img" src="${esc(x.cover)}" alt="" width="200" height="250" loading="lazy" decoding="async">` : art({ id: x.id, title: x.title, activity: x.title }, { title: "" })}</span><b>${esc(x.title)}</b><small>${esc([x.host?.name, "Example"].filter(Boolean).join(" · "))}</small></a>`).join("");
    const ideasS = section("fv-ideas", head("Ideas <em>to try</em>", "Small formats people loved. Host one your way.") + slot("inspo", row(older, "More ideas to try"), !older));
    const end = `<footer class="fv-end"><span class="fv-end-p" aria-hidden="true">${potto("sleep", 72)}</span><p>That's the week.</p><p><a href="/discover">See everything on Discover</a>${lbAny ? ` · <a href="/leaderboard">This week's leaderboard</a>` : ""}</p><p><a href="/about">About Pottery Lab</a></p></footer>`;
    // the blended stream when the server sent one (server/feedblend.js); the sections stay as the fallback
    const B = F?.blend || V.blend; if (B?.items?.length) return intro + blendHtml(B, { postRender, signedIn: !!F }) + end;
    return intro + `<div class="fv-wall">${nearS}${peopleS}${recentS}${ideasS}</div>` + end; }
  /** The signed-out feed. V: /api/public/feed. lb: true when there's a leaderboard to link to. */
  const composePublic = (V, { lb = "" } = {}) => compose(V, { lb: !!lb });
  /** The signed-in feed: your people's items in their own section, the public sections around them, each event once. */
  const composeSignedIn = (F, { postRender = null, empty = "" } = {}) => compose(F.visual || {}, { F, postRender, empty });
  /** A skeleton while the feed loads: the opening and one card, the size they'll be. */
  const skeleton = () => { css(); return `<div class="fv-skel" aria-busy="true" aria-label="Loading the feed"><i class="k"></i><i class="h"></i><i class="l"></i><i class="m"></i><i class="t"></i><i class="l"></i></div>`; };

  // ---------- behaviour: calm entrances, photos that fade in, reactions, confetti on I'm in, photo taps ----------
  let IO = null;
  function wire(root) { css();
    if (!IO && "IntersectionObserver" in window && !RM()) IO = new IntersectionObserver((L) => L.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("fv-in"); IO.unobserve(x.target); } }), { rootMargin: "0px 0px -6% 0px" });
    $$(".fv-card,.fv-sec>.fv-h,.fv-intro", root).forEach((c) => { if (IO) { c.classList.add("fv-rise"); IO.observe(c); } });
    $$("img.fv-img,.fv-mb>img", root).forEach((i) => { const ok = () => i.classList.add("ok"); if (i.complete && i.naturalWidth) ok(); else { i.addEventListener("load", ok, { once: true }); i.addEventListener("error", ok, { once: true }); } });
    $$("[data-fv-open]", root).forEach((b) => (b.onclick = () => openStories([b.dataset.fvOpen], 0, b, +b.dataset.k || 0)));
    const RL = { "🔥": "Fire", "😍": "Love it", "🥟": "Yum", "🙌": "Hands up" }, rLabel = (x, n) => `${RL[x] || "React"}${n ? ", " + n : ""}`;
    $$("[data-fv-react]", root).forEach((b) => (b.onclick = async () => { const on = b.getAttribute("aria-pressed") !== "true", n = $("b", b), was = { pressed: b.getAttribute("aria-pressed"), count: n.textContent, label: b.getAttribute("aria-label") };
      const undo = () => { b.setAttribute("aria-pressed", was.pressed); n.textContent = was.count; b.setAttribute("aria-label", was.label); b.classList.remove("pop"); };
      b.setAttribute("aria-pressed", String(on)); n.textContent = Math.max(0, (+n.textContent || 0) + (on ? 1 : -1)) || ""; b.setAttribute("aria-label", rLabel(b.dataset.e, +n.textContent || 0)); if (on && !RM()) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      try { const r = await fetch("/api/feed/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: b.dataset.fvReact, emoji: b.dataset.e, device: deviceId }) }); const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.counts) { undo(); return; } // the server said no (too many, signed out): put it back as it was
        $$(`[data-fv-react="${CSS.escape(b.dataset.fvReact)}"]`, root).forEach((x) => { const c = j.counts[x.dataset.e] || 0; x.querySelector("b").textContent = c || ""; x.setAttribute("aria-pressed", String((j.mine || []).includes(x.dataset.e))); x.setAttribute("aria-label", rLabel(x.dataset.e, c)); }); } catch { undo(); } }));
    slots(root); wireBlend(root);
    $$(".fv-btn[data-fv-follow]", root).forEach((b) => (b.onclick = () => followFrom(b)));
    $$("[data-fv-with]", root).forEach((b) => (b.onclick = () => need("/comewith.js", () => window.PLComeWith?.fromFeed(b.dataset.fvWith, b.dataset.title, b.dataset.url, b))));
    $$("[data-fv-in]", root).forEach((a) => (a.onclick = (ev) => { if (RM() || ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); confetti(a); setTimeout(() => (location.href = a.href), 520); }));
    // one "More" menu open at a time; a tap outside or Escape closes it
    $$(".fv-more", root).forEach((d) => d.addEventListener("toggle", () => { if (d.open) $$(".fv-more[open]").forEach((o) => o !== d && (o.open = false)); }));
    if (!document.body.dataset.fvMore) { document.body.dataset.fvMore = 1; document.addEventListener("click", (e) => $$(".fv-more[open]").forEach((d) => !d.contains(e.target) && (d.open = false))); document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".fv-more[open]").forEach((d) => { d.open = false; $("summary", d)?.focus(); }); }); } }
  // fill the slots once their renderers exist (window.PLSave, window.PLInspo, the suggest endpoint); until then they stay hidden
  function slots(root) {
    if (window.PLSave?.button) $$("[data-fv-save]", root).forEach((s) => { if (s.dataset.on) return; s.dataset.on = 1; try { const b = window.PLSave.button(JSON.parse(s.dataset.fvSave)); if (b) { typeof b === "string" ? (s.innerHTML = b) : s.appendChild(b); s.hidden = false; } } catch {} });
    $$("[data-fv-together]", root).forEach((s) => { if (s.dataset.on) return; if (!window.PLFriends) return need("/friendsgoing.js", () => slots(root)); s.dataset.on = 1; try { s.innerHTML = JSON.parse(s.dataset.fvTogether).map((t) => window.PLFriends.html({ count: t.count, line: t.line, people: t.people })).join(" "); s.hidden = false; } catch {} });
    $$("[data-fv-friends][data-names]", root).forEach((s) => { try { const N = JSON.parse(s.dataset.names); if (!N.length) return; s.innerHTML = `${N.slice(0, 3).map((n, i) => `<i style="--c:${NOTE[i % NOTE.length]}" aria-hidden="true">${esc(String(n).slice(0, 1).toUpperCase())}</i>`).join("")}<span>${esc(N.slice(0, 2).join(" and "))}${N.length > 2 ? ` +${N.length - 2}` : ""} going</span>`; s.hidden = false; } catch {} });
    const ins = $("[data-fv-slot=inspo]", root); if (ins && window.PLInspo?.card) fetch("/api/public/inspo?limit=12" + (window.FeedVisual?.publicQuery ? "&" + String(window.FeedVisual.publicQuery()).replace(/^[?&]/, "") : "")).then((r) => (r.ok ? r.json() : null)).then((j) => { const shown = new Set($$("[data-fv-id]", root).map((x) => x.dataset.fvId).filter(Boolean)), kind = (x) => (x.type === "idea" ? 0 : x.type === "art" ? 1 : 2);
      // formats to host first, and never an event that's already on the page
      const L = (j?.data || j?.items || j?.ideas || []).filter((x) => !shown.has(x.save?.ref) && !shown.has(x.id)).sort((a, b) => kind(a) - kind(b)).slice(0, 6); if (!L.length) return;
      const cards = L.map((x) => { try { const c = window.PLInspo.card(x); return typeof c === "string" ? c : c?.outerHTML || ""; } catch { return ""; } }).join(""), r0 = $(".fv-row", ins);
      ins.innerHTML = `<div class="fv-row fv-strip fv-inspo" tabindex="0" role="group" aria-label="Ideas to try">${cards}${r0 ? r0.innerHTML : ""}</div>`; ins.hidden = false; wire(ins); }).catch(() => {});
    const hs = $("[data-fv-slot=hosts]", root); if (hs && !hs.dataset.on) { hs.dataset.on = 1; fetch("/api/public/suggest/hosts?limit=8" + (window.FeedVisual?.publicQuery ? "&" + String(window.FeedVisual.publicQuery()).replace(/^[?&]/, "") : "")).then((r) => (r.ok ? r.json() : null)).then((j) => { const L = (j?.hosts || []).filter((h) => h?.handle && h.name).slice(0, 8); if (!L.length) return; hs.insertAdjacentHTML("beforeend", row(L.map(hostTile).join(""), "Hosts you might like")); hs.hidden = false; const sec = hs.closest(".fv-sec"); if (sec) sec.hidden = false; }).catch(() => {}); }
  }
  function confetti(a) { const r = a.getBoundingClientRect(), box = document.createElement("div"); box.className = "fv-confetti"; box.setAttribute("aria-hidden", "true"); box.style.left = r.left + r.width / 2 + "px"; box.style.top = r.top + r.height / 2 + "px";
    const C = ["#29489A", "#F3E7A8", "#5F6B57", "#E9A08F"]; for (let i = 0; i < 16; i++) { const ang = (i / 16) * Math.PI * 2, d = 40 + (i * 13) % 40; box.insertAdjacentHTML("beforeend", `<i style="--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d - 30}px;--c:${C[i % C.length]};--rot:${(i * 47) % 360}deg"></i>`); }
    document.body.appendChild(box); setTimeout(() => box.remove(), 900); }

  // ---------- styles ----------
  // load a helper script once; run cb when it's there
  function need(src, cb) { const s0 = document.querySelector(`script[src="${src}"],script[src^="${src}?"]`); if (s0) { if (s0.dataset.ok) cb?.(); else s0.addEventListener("load", () => cb?.()); return; } const s = document.createElement("script"); s.src = src; s.onload = () => { s.dataset.ok = 1; cb?.(); }; document.head.appendChild(s); }
  need("/hostlike.js");
  function css() { if (document.getElementById("fvCss")) return; const s = document.createElement("style"); s.id = "fvCss"; s.textContent = CSS_TEXT; document.head.appendChild(s); }
  const CSS_TEXT = `
:root{--fv-ink:var(--pl-ink);--fv-paper:var(--pl-page);--fv-linen:var(--pl-raised);--fv-card:var(--pl-surface);--fv-ember:var(--pl-accent);--fv-ember-d:var(--pl-accent-text);--fv-butter:var(--pl-sand);--fv-sage:var(--pl-sage);--fv-smoke:var(--pl-soft);--fv-line:var(--pl-line);--fv-line2:var(--pl-line-strong);--fv-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;--fv-ease:cubic-bezier(.2,.7,.2,1)}
.fv-wall{display:flex;flex-direction:column;gap:56px;padding:8px 0 8px}
.fv-av{flex:none;display:grid;place-items:center;border-radius:50%;overflow:hidden;background:color-mix(in srgb,var(--c) 22%,#fff);border:1.5px solid var(--fv-line2);font-size:14px;line-height:1}.fv-av img,.fv-av svg{width:100%!important;height:100%!important;object-fit:cover;max-width:none!important;max-height:none!important}
/* stories rail: thin rings, ember when there's something new */
.fv-rail{display:flex;gap:14px;overflow-x:auto;padding:6px 2px 10px;scrollbar-width:none;scroll-snap-type:x proximity}.fv-rail::-webkit-scrollbar{display:none}
.fv-ring{flex:none;position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;width:68px;min-height:44px;background:none;border:0;padding:0;cursor:pointer;color:var(--fv-ink);font:500 13px "IBM Plex Sans",system-ui;scroll-snap-align:start}
.fv-ring-c{width:64px;height:64px;border-radius:50%;padding:3px;display:grid;place-items:center;background:transparent;border:2px solid var(--fv-line2);box-sizing:border-box;transition:border-color .6s var(--fv-ease),transform .3s var(--fv-ease)}
.fv-ring.new .fv-ring-c{border-color:var(--fv-ember)}
.fv-ring-c>img,.fv-ring-c>.fv-av,.fv-ring-art{width:100%!important;height:100%!important;border-radius:50%;object-fit:cover;border:0;display:grid;place-items:center;overflow:hidden;box-sizing:border-box}.fv-ring-art svg{width:86%;height:auto}
.fv-ring.add .fv-ring-c{border-style:dashed}.fv-ring.add b{font:500 26px var(--sys-display);color:var(--fv-smoke)}
.fv-ring small{max-width:68px;font-size:13px;color:var(--fv-smoke);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fv-ring.new small{color:var(--fv-ink)}
@media (hover:hover){.fv-ring:hover .fv-ring-c{transform:scale(1.04)}}.fv-ring:focus-visible{outline:none}.fv-ring:focus-visible .fv-ring-c{outline:3px solid var(--fv-ink);outline-offset:2px}
.fv-ring.just-seen .fv-ring-c{animation:fv-seen .8s var(--fv-ease)}@keyframes fv-seen{0%{border-color:var(--fv-ember)}100%{border-color:var(--fv-line2)}}
.fv-ring-dot{position:absolute;top:2px;right:4px;width:12px;height:12px;border-radius:50%;background:var(--fv-butter);border:2px solid var(--fv-paper)}
.fv-ring-tag{position:absolute;top:48px;left:50%;transform:translateX(-50%);font:500 13px/1 "IBM Plex Sans",system-ui;font-style:normal;background:var(--fv-card);color:var(--fv-smoke);border:1px solid var(--fv-line);border-radius:999px;padding:2px 6px}
.fv-peek{display:flex;align-items:center;gap:10px;padding:6px 14px 6px 4px;border:1.5px dashed var(--fv-line);border-radius:16px;min-height:64px;flex:1;overflow:hidden}.fv-peek p{margin:0;color:var(--fv-smoke);font-size:14px}.fv-peek-p{flex:none;width:56px;height:52px;overflow:hidden;align-self:flex-end;margin-bottom:-10px}.fv-peek-p svg{width:56px;height:auto}
/* the opening: date and city in mono, one headline, one line */
.fv-intro{position:relative;padding:8px 72px 0 0;margin:0 0 28px}
.fv-kicker{display:flex;flex-wrap:wrap;align-items:center;gap:0 10px;min-height:32px;margin:0 0 6px;font:500 13px/1.4 var(--fv-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--fv-smoke)}.fv-kicker>span+span::before{content:"·";margin-right:10px}.fv-kicker>span:empty{display:none}
.fv-intro h1{margin:0 0 8px;font:600 28px/1.1 var(--sys-display)!important;letter-spacing:-.01em;text-wrap:balance;color:var(--fv-ink)}
:is(.fv-intro h1,.fv-h h2) em{font-style:normal;color:var(--sys-ember-text,var(--fv-ember))}
.fv-lede{margin:0;max-width:46ch;font-size:16px;line-height:1.5;color:var(--fv-ink)}.fv-sub{margin:8px 0 0;font-size:14px;color:var(--fv-smoke)}.fv-sub a{display:inline-block;padding:13px 0;margin:-13px 0;color:var(--fv-ember-d);font-weight:600}
.fv-potto{position:absolute;right:0;top:4px;width:64px}.fv-potto svg{width:64px;height:auto}
/* section heads: a heading and at most one line */
.fv-sec{display:flex;flex-direction:column;gap:20px}.fv-sec[hidden]{display:none}.fv-h{margin:0}.fv-h h2{margin:0;font:600 20px/1.2 var(--pl-font-text)}.fv-h p{margin:6px 0 0;color:var(--fv-smoke);font-size:14px;line-height:1.45;max-width:52ch}
.fv-sub-h{margin:12px 0 -8px;font:600 14px "IBM Plex Sans",system-ui;color:var(--fv-smoke)}
.fv-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:40px 24px}
/* shared card bits */
.fv-card{position:relative;min-width:0}
.fv-by,.fv-host{display:flex;align-items:center;gap:8px;margin:0;font-size:14px;line-height:1.3;color:var(--fv-smoke);min-width:0}.fv-by b,.fv-host b{color:var(--fv-ink);font-weight:600}.fv-by>span,.fv-host>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fv-title{margin:10px 0 4px;font:600 22px/28px var(--pl-font-serif);color:var(--fv-ink);text-wrap:balance;overflow-wrap:anywhere}.fv-title a{display:inline-block;padding:10px 0;margin:-10px 0;color:inherit;text-decoration:none}.fv-title a:hover{text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:3px}
.fv-data span{display:block}.fv-data{margin:0;font:500 15px/1.45 var(--pl-font-text);color:var(--fv-ink);font-variant-numeric:tabular-nums}
.fv-cap2{margin:6px 0 0;font-size:13px;color:var(--fv-smoke)}
.fv-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}
.fv-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 20px;border-radius:999px;border:1.5px solid var(--fv-line2);background:var(--fv-card);color:var(--fv-ink);font:600 15px "IBM Plex Sans",system-ui;text-decoration:none;cursor:pointer;transition:background .2s,border-color .2s,transform .15s var(--fv-ease)}
.fv-btn:hover{border-color:var(--fv-ink)}.fv-btn:active{transform:scale(.97)}.fv-btn.primary{background:var(--fv-ember);border-color:var(--fv-ember);color:#fff;font-size:16px}.fv-btn.primary:hover{background:var(--pl-accent-text);border-color:var(--pl-accent-text)}
.fv-card :focus-visible,.fv-tile:focus-visible,.fv-row:focus-visible,.fv-sv :focus-visible{outline:3px solid var(--fv-ink);outline-offset:2px}
/* More: a quiet round button and a small menu */
.fv-more{position:relative;margin-left:auto}.fv-more>summary{list-style:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;border:1.5px solid transparent;cursor:pointer;color:var(--fv-smoke)}.fv-more>summary::-webkit-details-marker{display:none}
.fv-more>summary>span,.fv-more>summary>span::before,.fv-more>summary>span::after{display:block;width:4px;height:4px;border-radius:50%;background:currentColor}.fv-more>summary>span{position:relative}.fv-more>summary>span::before,.fv-more>summary>span::after{content:"";position:absolute;top:0}.fv-more>summary>span::before{left:-8px}.fv-more>summary>span::after{left:8px}
.fv-more>summary:hover,.fv-more[open]>summary{border-color:var(--fv-line2);background:var(--fv-card)}
.fv-menu{position:absolute;right:0;bottom:52px;z-index:20;min-width:220px;display:grid;gap:2px;padding:6px;background:var(--fv-card);border:1.5px solid var(--fv-line);border-radius:16px;box-shadow:0 1px 2px rgba(31,26,23,.06),0 10px 28px -16px rgba(31,26,23,.28);animation:fv-menu .18s var(--fv-ease)}
@keyframes fv-menu{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.fv-mi,.fv-menu .pls-btn{display:flex!important;align-items:center;gap:8px;width:100%;min-height:44px;padding:0 12px!important;border:0!important;border-radius:12px!important;background:none!important;box-shadow:none!important;color:var(--fv-ink)!important;font:500 15px "IBM Plex Sans",system-ui!important;text-align:left;text-decoration:none;cursor:pointer;white-space:nowrap;transform:none!important}
.fv-mi:hover,.fv-menu .pls-btn:hover{background:var(--fv-linen)!important}.fv-menu .fv-save{display:block}.fv-menu .fv-save[hidden]{display:none}.fv-mnote{display:block;padding:0 12px 6px;color:var(--fv-smoke);font-size:13px}
/* 1. the event card: the photo leads, words below on the page, one button */
.fv-media{position:relative;display:block;aspect-ratio:4/5;border-radius:16px;overflow:hidden;background:var(--fv-linen);max-height:72vh}
.fv-media>img{position:absolute;inset:0;width:100%;height:100%;display:block}.fv-media>.ea-cover,.fv-media .ea-cover{position:absolute!important;inset:0;border-radius:0}
.fv-ev.poster .fv-media>img{padding:12px;box-sizing:border-box}
.fv-ev .fv-body{padding:14px 2px 0}
@media (hover:hover){.fv-ev .fv-media>img{transition:transform .6s var(--fv-ease),opacity .5s}.fv-ev:hover .fv-media>img{transform:scale(1.015)}}
.fv-friends{display:flex;align-items:center;margin-top:8px;font-size:13px;color:var(--fv-smoke)}.fv-friends i{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--c);border:1.5px solid var(--fv-paper);font:600 13px var(--sys-title);font-style:normal;color:var(--pl-ink);margin-right:-6px}.fv-friends span{margin-left:12px;color:var(--fv-ink)}
.fv-friends:not([hidden])~.fv-cap2,.fv-together:not([hidden])~.fv-cap2{display:none}
.fv-together{display:block;margin:8px 0 0}.fv-together .plf-pill{font-size:13px;border:0;background:none;padding:0}
/* 2. the scrapbook page: instant photos on a quiet card */
.fv-scrap{background:var(--fv-card);border:1.5px solid var(--fv-line);border-radius:24px;padding:16px 16px 12px}
.fv-album{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);grid-template-rows:1fr 1fr;gap:10px;margin:16px 0 4px;align-items:stretch}.fv-album.n1{grid-template-columns:minmax(0,1fr);grid-template-rows:auto;padding:0 8%}.fv-album.n2{grid-template-rows:1fr}
.fv-ph{position:relative;display:block;margin:0;padding:0;border:0;background:none;cursor:pointer;font:inherit;color:inherit;min-width:0;border-radius:8px}
.fv-ph:not(.lead) .fv-mb{height:100%;aspect-ratio:auto!important;border-radius:8px}
.fv-ph.lead{grid-row:1 / -1;background:#fff;padding:8px 8px 4px;border-radius:4px;box-shadow:0 1px 2px rgba(31,26,23,.08),0 8px 20px -14px rgba(31,26,23,.35);transform:rotate(var(--r,0deg));transition:transform .4s var(--fv-ease)}
@media (hover:hover){.fv-ph.lead:hover{transform:rotate(0deg) translateY(-2px)}}
.fv-mb{position:relative;display:block;width:100%;background:var(--fv-linen);overflow:hidden;border-radius:2px}.fv-mb>img,.fv-mb>video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.fv-mb>.ea-cover{position:absolute}
.fv-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;background:rgba(31,26,23,.72);color:#fff;display:grid;place-items:center;font-size:16px;padding-left:3px}
.fv-cap{display:block;min-height:24px;padding:6px 2px 2px;font:600 20px/1.1 Caveat,"Bradley Hand","Segoe Print",cursive;color:var(--pl-ink);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fv-plus{position:absolute;inset:0;display:grid;place-items:center;border-radius:8px;background:rgba(31,26,23,.42);color:#fff;font:500 16px var(--fv-mono)}
.fv-tape{position:absolute;width:64px;height:20px;background:var(--tp);opacity:.9;z-index:3;pointer-events:none}.fv-tape.top{top:-10px;left:50%;transform:translateX(-50%) rotate(var(--tr))}
.fv-scrap .fv-title.sm{margin-top:14px}
.fv-q{margin:12px 0 0;padding:0 0 0 14px;border-left:2px solid var(--fv-butter)}.fv-q p{margin:0;font-size:16px;line-height:1.5;color:var(--fv-ink)}.fv-q cite{display:block;margin-top:4px;font-style:normal;font-size:13px;color:var(--fv-smoke)}
.fv-react{min-width:56px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;border:1.5px solid transparent;background:none;cursor:pointer;font:500 13px var(--fv-mono);color:var(--fv-smoke);padding:0 12px}
.fv-react:hover{border-color:var(--fv-line2)}.fv-react span{font-size:18px;filter:grayscale(.35);transition:filter .3s}.fv-react[aria-pressed=true]{background:#FBEBC4}.fv-react[aria-pressed=true] span{filter:none}.fv-react b{font-weight:500}.fv-react b:empty{display:none}
.fv-react.pop span{animation:fv-pop .5s var(--fv-ease)}@keyframes fv-pop{0%{transform:scale(1)}40%{transform:scale(1.35)}100%{transform:scale(1)}}
/* posts from friends: the same scrapbook page */
.fv-post .ptext{margin:12px 0 0;font-size:16px;line-height:1.5}.fv-post .plink{margin-top:10px}
/* 3. tiles, in rows that scroll inside themselves */
.fv-row{display:flex;gap:14px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scrollbar-width:none;margin:0 -16px;padding:2px 16px 6px;scroll-padding:0 16px}.fv-row::-webkit-scrollbar{display:none}
.fv-tile{flex:none;width:148px;scroll-snap-align:start;color:var(--fv-ink);text-decoration:none;border-radius:12px}
.fv-tile-m{position:relative;display:block;aspect-ratio:4/5;border-radius:12px;overflow:hidden;background:var(--fv-linen)}.fv-tile-m img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.fv-tile-m .ea-cover{position:absolute!important;inset:0}
.fv-tile b{display:block;margin-top:8px;font:600 15px/1.25 var(--sys-title);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.fv-tile small{display:block;margin-top:2px;font:400 13px/1.4 var(--fv-mono);letter-spacing:-.01em;color:var(--fv-smoke);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fv-tile.host{width:112px;text-align:center;display:grid;justify-items:center;gap:2px;padding:4px 0}.fv-tile.host .fv-av{border-width:1.5px}.fv-tile.host b{font-size:14px;margin-top:6px}.fv-tile.host small{font-family:"IBM Plex Sans",system-ui;max-width:100%}
@media (hover:hover){.fv-tile .fv-tile-m img{transition:transform .5s var(--fv-ease)}.fv-tile:hover .fv-tile-m img{transform:scale(1.03)}}
.fv-slot[hidden]{display:none}.fv-slot{display:flex;flex-direction:column;gap:20px}
/* the ideas carousel: every card the same 4:5 media and top-aligned, quiet like the rest (inspo.js makes the cards) */
.fv-strip.fv-inspo{align-items:flex-start}.fv-inspo .pli{flex:0 0 200px!important;width:200px!important;transform:none!important;margin:0!important}.fv-inspo .pli-card{border:0!important;box-shadow:none!important;background:none!important;border-radius:0!important}
.fv-inspo .pli-media{--ar:4/5!important;aspect-ratio:4/5!important;max-height:none;margin:0!important;border:0!important;border-radius:12px!important;padding:0!important;box-shadow:none!important}.fv-inspo .pli-media img{position:absolute;inset:0;width:100%!important;height:100%!important;object-fit:cover;border:0!important;border-radius:12px!important;min-height:0!important;max-height:none!important}.fv-inspo .pli-media{position:relative;overflow:hidden}
.fv-inspo :is(.pli-tape,.pli-tags,.pli-kind,.pli-count,.pli-vibe,.pli-line,.pli-sticker,.pli-real,.pls-btn){display:none!important}.fv-inspo .pli-cap{transform:none!important;padding:8px 0 0!important;font-size:20px!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fv-inspo .pli-body{padding:8px 0 0!important;gap:4px!important}.fv-inspo .pli-title{font-size:15px!important}.fv-inspo .pli-by{font-size:13px!important;color:var(--fv-smoke)}.fv-inspo .pli-by a{border:0!important;font-weight:500!important}
.fv-inspo .pli-ex{transform:none!important;top:8px!important;right:8px!important;border:0!important;font:500 13px "IBM Plex Sans",system-ui!important;color:var(--fv-smoke)}.fv-inspo .pli-host{background:none!important;color:var(--fv-ink)!important;border:1.5px solid var(--fv-line2)!important;box-shadow:none!important;min-height:44px}.fv-inspo .pli-real{min-height:44px}
.fv-inspo .pli-fly{border-radius:12px}
.fv-artfb{display:grid;place-items:center;height:100%;font-size:48px;background:var(--pl-sand)}
/* the end */
.fv-end{margin:64px 0 24px;padding-top:24px;border-top:1.5px solid var(--fv-line);text-align:center}.fv-end p{margin:0 0 6px;color:var(--fv-smoke);font-size:14px}.fv-end p:first-of-type{font:600 20px var(--pl-font-text);color:var(--fv-ink)}.fv-end a{color:var(--fv-ember-d);font-weight:600;display:inline-flex;align-items:center;min-height:44px}
/* loading: the opening and a card, the size they'll be */
.fv-skel{display:grid;gap:12px;padding:20px 0}.fv-skel i{display:block;border-radius:10px;background:linear-gradient(90deg,var(--fv-linen) 0,#F5EDE1 40%,var(--fv-linen) 80%) 0 0/300% 100%;animation:fv-shim 1.6s linear infinite}
.fv-skel .k{width:40%;height:14px}.fv-skel .h{width:80%;height:32px}.fv-skel .l{width:65%;height:16px}.fv-skel .m{aspect-ratio:4/5;max-height:60vh;border-radius:16px;margin-top:24px}.fv-skel .t{width:55%;height:22px}
@keyframes fv-shim{from{background-position:100% 0}to{background-position:0 0}}
/* motion: things arrive once, softly; photos fade in over linen */
.fv-rise{opacity:0;transform:translateY(10px)}.fv-rise.fv-in{opacity:1;transform:none;transition:opacity .6s var(--fv-ease),transform .6s var(--fv-ease)}
.fv-intro.fv-rise h1,.fv-intro.fv-rise .fv-lede{opacity:0;transform:translateY(6px)}.fv-intro.fv-in h1,.fv-intro.fv-in .fv-lede{opacity:1;transform:none;transition:opacity .7s var(--fv-ease),transform .7s var(--fv-ease)}.fv-intro.fv-in .fv-lede{transition-delay:.12s}
.fv-intro.fv-in .fv-potto svg{animation:fv-hi 1.1s var(--fv-ease) .3s both}@keyframes fv-hi{0%{transform:translateY(14px);opacity:0}60%{transform:translateY(-3px);opacity:1}100%{transform:none}}
img.fv-img,.fv-mb>img{opacity:0;transition:opacity .5s var(--fv-ease)}img.fv-img.ok,.fv-mb>img.ok{opacity:1}
.fv-confetti{position:fixed;z-index:2147483001;pointer-events:none;width:0;height:0}.fv-confetti i{position:absolute;width:7px;height:10px;background:var(--c);border-radius:2px;animation:fv-boom .8s var(--fv-ease) forwards}@keyframes fv-boom{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),calc(var(--dy) + 70px)) rotate(var(--rot));opacity:0}}
/* the story viewer */
.fv-sv{position:fixed;inset:0;z-index:2147483000;background:#15110E;color:#fff;display:flex;justify-content:center;outline:none}
.fv-sv-in{position:relative;width:min(100%,calc(100dvh * .5625 + 40px));height:100%;display:flex;flex-direction:column;transform:translateY(var(--drag,0));transition:transform .2s}.fv-sv.dragging .fv-sv-in{transition:none;opacity:calc(1 - var(--drag,0px) / 400px)}
.fv-sv-bars{display:flex;gap:4px;padding:calc(10px + env(safe-area-inset-top)) 10px 0;position:relative;z-index:3}.fv-sv-bars i{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.35);overflow:hidden}.fv-sv-bars b{display:block;height:100%;background:#fff;transform-origin:left;transform:scaleX(0)}
.fv-sv-top{position:relative;z-index:3;display:flex;align-items:center;gap:10px;padding:10px 10px 8px 14px}.fv-sv-top>div{flex:1;min-width:0}.fv-sv-top b{display:block;font:600 16px var(--sys-title)}.fv-sv-top small{display:block;opacity:.85;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fv-sv-top button{flex:none;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:16px;cursor:pointer}.fv-sv-top button:focus-visible,.fv-sv-foot a:focus-visible,.fv-sv-foot button:focus-visible,.fv-sv-prev:focus-visible,.fv-sv-next:focus-visible{outline:3px solid var(--fv-butter);outline-offset:2px}
.fv-sv-stage{position:absolute;inset:0;display:grid;place-items:center;touch-action:none;user-select:none;-webkit-user-select:none}.fv-sv-stage img,.fv-sv-stage video{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;pointer-events:none}
.fv-sv-art{position:absolute;inset:0;display:grid;place-items:center;background:var(--tint)}.fv-sv-artc{position:relative;width:min(88%,420px);aspect-ratio:4/5;border-radius:18px;overflow:hidden;box-shadow:0 18px 48px -18px rgba(31,26,23,.45)}
.fv-sv-prev,.fv-sv-next{position:absolute;top:50%;z-index:3;width:44px;height:44px;margin-top:-22px;border-radius:50%;border:0;background:rgba(0,0,0,.35);color:#fff;font-size:28px;line-height:1;cursor:pointer;opacity:0}.fv-sv-prev{left:6px}.fv-sv-next{right:6px}.fv-sv-prev:focus-visible,.fv-sv-next:focus-visible{opacity:1}
@media (hover:hover){.fv-sv-in:hover .fv-sv-prev,.fv-sv-in:hover .fv-sv-next{opacity:.8}}
.fv-sv-foot{position:relative;z-index:3;margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 16px calc(18px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.65))}
.fv-sv-note{margin:0;font:600 26px/1.15 Caveat,cursive;text-align:center;text-shadow:0 1px 6px rgba(0,0,0,.6)}
.fv-sv-cta{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 22px;border-radius:999px;background:#fff;color:var(--pl-ink);font:600 16px "IBM Plex Sans",system-ui;text-decoration:none;border:0}
.fv-sv-unmute{min-height:44px;border-radius:999px;border:1.5px solid rgba(255,255,255,.6);background:rgba(0,0,0,.35);color:#fff;padding:0 14px;font:600 14px "IBM Plex Sans",system-ui;cursor:pointer}
.fv-sv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.fv-sv.paused .fv-sv-bars{opacity:.6}
/* recap stories: a title card, a quote, an ending card */
.fv-sv.light .fv-sv-top{color:var(--pl-ink)}.fv-sv.light .fv-sv-top button{background:rgba(31,26,23,.1);color:var(--pl-ink)}.fv-sv.light .fv-sv-bars i{background:rgba(31,26,23,.2)}.fv-sv.light .fv-sv-bars b{background:var(--pl-ink)}.fv-rc-pol.sm{width:min(56%,190px);padding-bottom:22px;transform:rotate(2deg);margin-bottom:6px}
.fv-sv-rc,.fv-sv-q,.fv-sv-end{position:absolute;inset:0;display:grid;place-items:center;padding:96px 22px 150px;background:var(--tint,var(--pl-page));color:var(--tink,var(--pl-ink));overflow:hidden}
.fv-rc-in{position:relative;display:grid;justify-items:center;gap:10px;text-align:center;width:min(100%,380px)}.fv-rc-in>.fv-stk{position:absolute;top:-6px;right:6px;z-index:4}
.fv-stk{display:inline-block;font:600 13px/1 "IBM Plex Sans",system-ui;padding:6px 10px;border-radius:999px;background:var(--fv-card);color:var(--fv-ink);border:1px solid var(--fv-line)}.fv-stk.new{background:var(--fv-butter);border-color:var(--fv-butter)}
.fv-rc-pol{position:relative;display:block;width:min(74%,260px);background:#fff;border-radius:4px;padding:9px 9px 34px;box-shadow:0 18px 48px -18px rgba(31,26,23,.45);transform:rotate(-2deg)}
.fv-sv-stage .fv-rc-pol img{display:block;width:100%;height:auto;max-height:none;aspect-ratio:1/1;object-fit:cover;background:var(--fv-linen)}.fv-rc-art{position:relative;display:block;aspect-ratio:1/1;overflow:hidden}
.fv-rc-t{margin:10px 0 0;font:600 clamp(26px,7vw,36px)/1.05 var(--sys-display);text-wrap:balance}
.fv-rc-came{margin:0;font:600 30px/1 Caveat,cursive}.fv-rc-came b{font:600 52px/1 var(--sys-display);color:var(--fv-ember);margin-right:4px}
.fv-rc-sub{margin:0;font:400 13px/1.5 var(--fv-mono);color:var(--tsoft,var(--pl-soft))}
.fv-sv-q{background:var(--pl-ink)}.fv-quote{position:relative;margin:0;background:var(--n);border-radius:4px 4px 18px 4px;padding:16px 16px 12px;transform:rotate(var(--r,-1.2deg))}.fv-quote.big{width:min(100%,380px);padding:26px 22px 18px}.fv-quote blockquote{margin:0;font:600 23px/1.18 Caveat,"Bradley Hand",cursive;color:var(--pl-ink)}.fv-quote.big blockquote{font-size:34px;line-height:1.12}.fv-quote figcaption{margin-top:8px;font-size:13px;color:#3E352F;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.fv-stamp{display:inline-block;font:500 13px/1.2 "IBM Plex Sans",system-ui;color:#4E6140}.fv-pin{display:none}
.fv-sv-end{background:var(--fv-butter)}.fv-end-in{position:relative;display:grid;justify-items:center;gap:6px;text-align:center;width:min(100%,360px)}.fv-end-in h2{margin:0;font:600 clamp(26px,7vw,34px)/1.08 var(--sys-display);text-wrap:balance}.fv-end-in p{margin:0;color:#3E352F}.fv-end-k{font:500 13px var(--fv-mono)!important;letter-spacing:.06em;text-transform:uppercase;margin-top:10px!important}
.fv-sv-cta.big{min-height:56px;padding:0 30px;font-size:18px;background:var(--fv-ember);color:#fff}button.fv-sv-cta{cursor:pointer}

/* delight, quietly: an instant photo settles into its tilt and its tape lands as the page arrives */
.fv-rise .fv-ph.lead{transform:rotate(0deg) translateY(6px)}.fv-rise.fv-in .fv-ph.lead{transform:rotate(var(--r,0deg));transition:transform 1s var(--fv-ease) .15s}
.fv-rise .fv-ph.lead .fv-tape{transform:translateX(-50%) rotate(var(--tr)) scaleX(.4);opacity:0}.fv-rise.fv-in .fv-ph.lead .fv-tape{transform:translateX(-50%) rotate(var(--tr));opacity:.9;transition:transform .5s var(--fv-ease) .45s,opacity .3s .45s}
.fv-end-p{display:block;width:72px;margin:0 auto 4px}.fv-end-p svg{width:72px;height:auto}
.fv-ring small{font-size:13px}
/* phones: the opening stays short so the first photo shows on the first screen */
@media (max-width:699px){.fv-h-quiet{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.fv-near{gap:16px}.fv-lede{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.fv-intro{padding-right:0;margin-bottom:20px}.fv-intro h1,.fv-kicker{padding-right:60px}.fv-kicker>span{white-space:nowrap}@media (max-width:380px){.fv-kicker{letter-spacing:0;gap:0 6px;padding-right:52px}.fv-kicker>span+span::before{margin-right:6px}}.fv-potto{top:0;width:56px}.fv-potto svg{width:56px}}
.fv-row.fv-inspo .pli{flex:0 0 148px!important;width:148px!important}
@media (min-width:700px){.fv-row.fv-inspo .pli{flex-basis:176px!important;width:176px!important}.fv-media{max-height:560px}}
@media (min-width:700px){.fv-intro{padding-top:32px;margin-bottom:40px}.fv-intro h1{font-size:40px!important}.fv-h h2{font-size:28px}.fv-wall{gap:72px}.fv-tile{width:176px}.fv-row{margin:0;padding-left:0;padding-right:0}.fv-potto{top:28px}}
@media (min-width:1000px){.fv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.fv-near .fv-grid>.fv-ev:only-child{max-width:460px}}
@media (max-width:360px){.fv-intro{padding-right:60px}.fv-potto{width:52px}.fv-potto svg{width:52px}.fv-intro h1{font-size:26px!important}.fv-tile{width:132px}.fv-scrap{padding:14px 12px 10px}}
@media (prefers-reduced-motion:reduce){.fv-rise,.fv-rise *,.fv-intro *{opacity:1!important;transform:none!important;transition:none!important;animation:none!important}img.fv-img,.fv-mb>img{opacity:1!important;transition:none!important}.fv-skel i,.fv-ring.just-seen .fv-ring-c,.fv-react.pop span,.fv-menu{animation:none!important}.fv-ph.lead,.fv-ring-c,.fv-sv-in,.fv-btn,.fv-tile img,.fv-ev .fv-media>img{transition:none!important}.fv-ph.lead:hover,.fv-ev:hover .fv-media>img,.fv-tile:hover img{transform:rotate(var(--r,0deg))!important}}
/* ---- the blended stream: one calm column, thin lines between posts, the host first on every card ---- */
.fb-stream{--fb-ink:var(--pl-ink);--fb-soft:var(--pl-soft);--fb-line:var(--pl-line);--fb-line2:var(--pl-line-strong);--fb-card:var(--pl-surface);--fb-linen:var(--pl-raised);--fb-acc:var(--pl-accent);--fb-acc-press:var(--pl-accent-press);--fb-acc-text:var(--pl-accent-text);--fb-on-acc:var(--pl-on-accent,#fff);max-width:600px;margin:0 auto;display:flex;flex-direction:column}
.fb-card{position:relative;min-width:0;padding:28px 0}.fb-card+.fb-card{border-top:1px solid var(--fb-line)}.fb-card:first-child{padding-top:8px}
.fb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fb-lead{position:relative;display:flex;align-items:center;gap:10px;min-height:44px;margin:0 0 12px}
.fb-lead .sf-more{position:relative;flex:none;width:36px;height:36px;margin-left:2px;background:transparent;border-color:transparent;color:var(--fb-soft)}.fb-lead .sf-more:hover{border-color:var(--fb-line2)}
.fb-host{flex:1;min-width:0;display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;min-height:44px}.fb-host>span{min-width:0;display:flex;flex-direction:column}
.fb-host b{font:600 15px/1.25 var(--pl-font-text,"IBM Plex Sans",system-ui);color:var(--fb-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fb-host small{font-size:13px;line-height:1.35;color:var(--fb-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fb-host:hover b{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.fb-ring{flex:none;display:grid;place-items:center;padding:2px;border-radius:50%;box-shadow:0 0 0 1.5px var(--ring)}.fb-ring .fv-av{border:0}
.fb-follow-in{flex:none;min-height:36px;padding:0 14px;border-radius:999px;border:1.5px solid var(--fb-line2);background:transparent;color:var(--fb-ink);font:600 13px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer}.fb-follow-in:hover{border-color:var(--fb-ink)}.fb-follow-in.on,.fb-follow-in[disabled]{color:var(--fb-soft);border-color:var(--fb-line);cursor:default}
.fb-proof,.fb-by,.fb-count{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:14px;line-height:1.35;color:var(--fb-ink)}.fb-by{color:var(--fb-soft);margin:-4px 0 10px}.fb-by b{color:var(--fb-ink);font-weight:600}
.fb-count{margin:14px 0 0;font-size:13px;color:var(--fb-soft)}.fb-count[hidden]{display:none}
.fb-note>.sf-more{top:-6px;right:0;background:transparent;border-color:transparent}.fb-ini{font:600 11px/1 var(--pl-font-text,"IBM Plex Sans",system-ui)!important;color:var(--fb-ink)}
.fb-stack{display:inline-flex;flex:none}.fb-stack .fv-av{width:24px!important;height:24px!important;font-size:12px!important;border:2px solid var(--fb-card,#fff);background:color-mix(in srgb,var(--c) 30%,var(--fb-card))}.fb-stack .fv-av+.fv-av{margin-left:-8px}.fb-count .fb-stack .fv-av{width:20px!important;height:20px!important}
.fb-media{position:relative;display:block;aspect-ratio:16/10;border-radius:var(--r-md,16px);overflow:hidden;background:var(--fb-linen)}.fb-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.fb-media .ea-cover{position:absolute!important;inset:0;border-radius:0}
.fb-title{margin:16px 0 6px;font:600 24px/1.15 var(--sys-display);letter-spacing:-.01em;color:var(--fb-ink);text-wrap:balance;overflow-wrap:anywhere}.fb-title.sm{font-size:20px;margin:4px 0 8px}
.fb-title a{color:inherit;text-decoration:none}.fb-title a:hover{text-decoration:underline;text-underline-offset:4px;text-decoration-thickness:1.5px}
.fb-line{margin:0;font-size:15px;line-height:1.45;color:var(--fb-soft);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}.fb-ideas .fb-line{-webkit-line-clamp:3}
.fb-meta{margin:8px 0 0;font:400 13px/1.5 var(--sys-mono,ui-monospace,monospace);letter-spacing:-.01em;color:var(--fb-soft);font-variant-numeric:tabular-nums}
.fb-cta{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;margin-top:18px;border-radius:999px;background:var(--fb-acc);color:var(--fb-on-acc);font:600 16px var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:none;box-sizing:border-box;transition:background .2s,transform .15s var(--fv-ease)}.fb-cta:hover{background:var(--fb-acc-press)}.fb-cta:active{transform:scale(.985)}
.fb-acts{display:flex;align-items:center;gap:4px;margin:6px -10px 0;flex-wrap:wrap}
.fb-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 12px;border-radius:999px;border:0;background:none;color:var(--fb-soft);font:500 14px var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:none;cursor:pointer}.fb-act svg{width:20px;height:20px;flex:none}
.fb-act:hover{color:var(--fb-ink);background:var(--fb-linen)}.fb-act[aria-pressed=true]{color:var(--fb-acc-text)}.fb-act[aria-pressed=true] svg{fill:color-mix(in srgb,var(--fb-acc) 18%,transparent)}
.fb-act.pop svg,.fb-send.pop svg{animation:fv-pop .5s var(--fv-ease)}
.fb-n{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;color:inherit}.fb-n:empty{display:none}.fb-n::before{content:"·";margin-right:6px;font-weight:400;opacity:.7}
.fb-cm{margin:6px 0 0;padding:10px 0 0;border-top:1px solid var(--fb-line)}.fb-cm[hidden]{display:none}
.fb-cm-l{margin:0 0 4px;font-size:14px;line-height:1.45;color:var(--fb-ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.fb-cm-l b{font-weight:600;margin-right:4px}
.fb-cm-all{display:inline-flex;align-items:center;min-height:44px;margin:-6px 0 -12px;padding:0;border:0;background:none;color:var(--fb-soft);font:500 14px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer}.fb-cm-all:hover{color:var(--fb-ink);text-decoration:underline;text-underline-offset:3px}
.fb-toast{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9500;max-width:calc(100vw - 32px);padding:10px 16px;border-radius:999px;background:var(--pl-ink);color:#fff;font:600 14px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui)}
.fb-note{position:relative;margin:0 0 12px;padding:0 40px 0 14px;border-left:2px solid var(--fb-line2)}.fb-note p{margin:0;font-size:16px;line-height:1.5;color:var(--fb-ink)}.fb-note cite{display:block;margin-top:4px;font-style:normal;font-size:13px;color:var(--fb-soft)}
.fb-stats{display:flex;flex-wrap:wrap;gap:4px 0;margin:0 0 14px;font:500 13px/1.4 var(--sys-mono,ui-monospace,monospace);color:var(--fb-ink);font-variant-numeric:tabular-nums}.fb-stats span+span::before{content:"·";margin:0 8px;color:var(--fb-soft)}
.fb-photos{display:flex;gap:8px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scrollbar-width:none;margin:0 -16px;padding:0 16px;scroll-padding:0 16px}.fb-photos::-webkit-scrollbar{display:none}
.fb-ph{flex:0 0 72%;max-width:300px;scroll-snap-align:start;padding:0;border:0;background:none;cursor:pointer;border-radius:12px;overflow:hidden}.fb-ph:only-child{flex-basis:100%;max-width:none}.fb-ph .fv-mb{border-radius:12px}
.fb-next{display:flex;align-items:center;gap:8px;min-height:44px;margin-top:12px;padding:0 14px;border:1px solid var(--fb-line);border-radius:var(--r-sm,12px);color:var(--fb-ink);text-decoration:none;font-size:14px}.fb-next span{color:var(--fb-soft)}.fb-next b{font-weight:600}.fb-next i{margin-left:auto;font-style:normal;font-size:20px;color:var(--fb-soft)}.fb-next:hover{border-color:var(--fb-line2)}
.fb-ms-b{display:flex;gap:16px;align-items:center}.fb-ms-n{flex:none;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;border:1.5px solid var(--fb-line2);font:600 20px/1 var(--sys-title);color:var(--fb-acc-text);font-variant-numeric:tabular-nums}
.fb-ms .fb-line{-webkit-line-clamp:2}.fb-ms-t{margin:0 0 4px;font:600 20px/1.25 var(--sys-title);color:var(--fb-ink);text-wrap:balance}
.fb-send{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;margin-left:10px;border-radius:999px;border:1.5px solid var(--fb-acc);background:transparent;color:var(--fb-acc-text);font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer}.fb-send svg{width:18px;height:18px}
.fb-send[aria-pressed=true]{background:var(--fb-acc);color:var(--fb-on-acc)}.fb-ms .fb-acts{margin-top:16px}
.fb-sec{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 14px}.fb-sec h2{margin:0;font:600 20px/1.2 var(--sys-title);color:var(--fb-ink)}.fb-sec a{display:inline-flex;align-items:center;min-height:44px;margin:-12px 0;color:var(--fb-acc-text);font:600 14px var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:none}
.fb-fcs{list-style:none;display:flex;gap:12px;margin:0 -16px;padding:2px 16px 4px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scrollbar-width:none}.fb-fcs::-webkit-scrollbar{display:none}
.fb-fc{position:relative;flex:0 0 156px;scroll-snap-align:start;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:20px 12px 14px;border:1px solid var(--fb-line);border-radius:var(--r-md,16px);background:var(--fb-card);box-sizing:border-box;transition:opacity .2s,transform .2s}
.fb-fc.gone{opacity:0;transform:scale(.96)}.fb-fc>.sf-more{display:none}
.fb-fc-a{display:flex;flex-direction:column;align-items:center;gap:10px;color:inherit;text-decoration:none;min-width:0;max-width:100%}.fb-fc-a b{font:600 15px/1.25 var(--pl-font-text,"IBM Plex Sans",system-ui);color:var(--fb-ink);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fb-fc small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px;font-size:13px;line-height:1.4;color:var(--fb-soft)}
.fb-fbtn{margin-top:auto;width:100%;min-height:44px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--fb-ink);background:transparent;color:var(--fb-ink);font:600 14px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer}.fb-fbtn:hover{background:var(--fb-ink);color:var(--fb-card)}.fb-fbtn.on,.fb-fbtn[disabled]{border-color:var(--fb-line2);color:var(--fb-soft);background:transparent;cursor:default}
.fb-x{position:absolute;top:0;right:0;width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:50%;background:none;color:var(--fb-soft);cursor:pointer}.fb-x svg{width:16px;height:16px}.fb-x:hover{background:var(--fb-linen);color:var(--fb-ink)}
.fb-kick{margin:0 0 2px;font:500 13px var(--sys-mono,ui-monospace,monospace);letter-spacing:.04em;text-transform:uppercase;color:var(--fb-soft)}
.fb-ideas-go{display:flex;align-items:center;gap:16px;margin-top:16px}.fb-ghost{min-height:44px;padding:0 20px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--fb-ink);background:transparent;color:var(--fb-ink);font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer}.fb-ghost:hover{background:var(--fb-ink);color:var(--fb-card)}
.fb-link{display:inline-flex;align-items:center;min-height:44px;color:var(--fb-acc-text);font-weight:600;font-size:14px;text-decoration:none}
.fb-text{margin:0 0 12px;font-size:16px;line-height:1.5;color:var(--fb-ink);white-space:pre-line}
.fb-rowc .fv-row{margin:0 -16px;padding:2px 16px 6px}
.fb-stream .fv-post{border:0;border-radius:0;background:none;padding:28px 0}.fb-stream .fv-post+.fb-card,.fb-stream .fb-card+.fv-post{border-top:1px solid var(--fb-line)}
.fb-stream :focus-visible{outline:3px solid var(--fb-ink);outline-offset:2px}
@media (min-width:700px){.fb-title{font-size:28px}.fb-photos,.fb-fcs,.fb-rowc .fv-row{margin:0;padding-left:0;padding-right:0}.fb-ph{flex-basis:46%}.fb-card{padding:36px 0}}
@media (prefers-reduced-motion:reduce){.fb-cta,.fb-fc,.fb-act.pop svg,.fb-send.pop svg{transition:none!important;animation:none!important}.fb-fc.gone{transform:none}}
`;
  /** "?interests=…&city=…" from what this visitor picked (pl.interests), for /api/public/feed, or "". */
  function publicQuery() { let v = null; try { v = JSON.parse(localStorage.getItem("pl.interests") || "null"); } catch {} if (!v || typeof v !== "object") return "";
    const I = (Array.isArray(v.interests) ? v.interests : []).filter((x) => /^[a-z0-9-]{1,30}$/.test(x)).slice(0, 20), c = String(v.city || "").trim().slice(0, 60), q = new URLSearchParams();
    if (I.length) q.set("interests", I.join(",")); if (c) q.set("city", c); const s = q.toString(); return s ? "?" + s : ""; }
  window.FeedVisual = { rail, openStories, compose, composePublic, composeSignedIn, skeleton, wire, flyer, dump, mini, avatar, css, REG, deviceId, publicQuery, blendHtml, RENDER };
  // the swipe deck (public/swipedeck.js) on a first visit to /feed, signed in or out; it decides whether to show itself
  if (location.pathname === "/feed" || location.pathname === "/") { let done = false; try { done = !!localStorage.getItem("pl.deckDone"); } catch {}
    const go = () => { if (window.PLDeck) return window.PLDeck.maybeAuto(); if (document.querySelector('script[src="/swipedeck.js"],script[src^="/swipedeck.js?"]')) return; const sc = document.createElement("script"); sc.src = "/swipedeck.js"; sc.defer = true; sc.onload = () => window.PLDeck?.maybeAuto(); document.head.appendChild(sc); };
    if (!done) document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); }
})();
// ---- end visual feed ----
