// ---- visual feed: the feed as a scrapbook wall ----
// Stories rail and full-screen viewer, flyer cards tinted from each event's look, past events as a photo dump of
// taped polaroids, kudos as sticky notes, a "This weekend" strip, and prepared pages with their covers and
// illustrated art so a quiet feed still looks alive. Used by public/feed.html for signed-in and signed-out visitors.
// Everything is plain CSS and SVG: effects pause offscreen and stand still for reduced motion; media is lazy and sized.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TILT = [-3, 2, -1.5, 1.2, -2, 2.5, -1, 1.6];
  const NOTE = ["#FFE9A8", "#FBD3CB", "#CDEBD5", "#E2D6F7", "#FCCBA6"];
  const TAPE = ["#F2D48F", "#B9C7A6", "#E9A08F"];
  const FONTS = { clean: ['"Inter","Instrument Sans",system-ui,sans-serif', "Inter:wght@800", 800], bold: ['"Archivo Black","Arial Black",system-ui,sans-serif', "Archivo+Black", 400, true], serif: ['"DM Serif Display",Georgia,serif', "DM+Serif+Display", 400], script: ['"Dancing Script","Brush Script MT",cursive', "Dancing+Script:wght@700", 700], typewriter: ['"Courier Prime","Courier New",monospace', "Courier+Prime:wght@700", 700], rounded: ['"Baloo 2",Fredoka,system-ui,sans-serif', "Baloo+2:wght@800", 800] };
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
    return `<span class="fv-av" style="--c:${esc(h.color || "#E26D8E")};width:${size}px;height:${size}px" aria-hidden="true">${inner}</span>`; }
  const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return 1; const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  // the event's colours: its flyer's palette, else a pastel from its illustrated cover
  function tintOf(e) { const p = (e.look?.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)); const A = window.EventArt;
    const bg = p[0] || (A ? A.PASTELS[A.toneOf({ ...e, title: e.title }, A.kindOf({ ...e, name: e.title }))] : "#FDE6A6") || "#FDE6A6", dark = lum(bg) < 0.32;
    const acc = p.find((c, i) => i && Math.abs(lum(c) - lum(bg)) > 0.25) || (dark ? "#F2D48F" : "#C94A30");
    return { bg, ink: dark ? "#FFF8EE" : "#1F1A17", soft: dark ? "rgba(255,248,238,.82)" : "#5A4E45", acc, dark }; }
  const tintStyle = (T) => `--tint:${T.bg};--tink:${T.ink};--tsoft:${T.soft};--tacc:${T.acc}`;
  function btnText(e, fallback = "I'm in") { const L = e.look || {}, em = L.buttonEmoji ? L.buttonEmoji + " " : ""; if (e.approvalRequired) return em + "Ask to join"; return em + (L.buttonLabel && L.buttonLabel !== "Ask to join" ? L.buttonLabel : fallback); }
  function art(e, opts = {}) { const A = window.EventArt; if (!A) return `<div class="fv-artfb">${esc(e.emoji || "🎉")}</div>`; return A.cover({ ...e, name: e.title, pubTitle: e.title, coverArt: e.coverArt || undefined }, { ...(opts.title != null ? { title: opts.title } : {}) }); }
  const D = { // hand-drawn bits
    squig: `<svg class="fv-squig" viewBox="0 0 120 12" aria-hidden="true" preserveAspectRatio="none"><path d="M2 8c14-6 24 4 38-1s24-6 38 0 26 3 40-3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    star: `<svg class="fv-star" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3l4.6 10.6 11.4 1-8.6 7.6 2.6 11.3L20 27.6 10 33.5l2.6-11.3L4 14.6l11.4-1z" fill="#F2D48F" stroke="#1F1A17" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
    arrow: `<svg class="fv-arrow" viewBox="0 0 70 40" aria-hidden="true"><path d="M4 8c18 22 38 26 56 18" fill="none" stroke="#1F1A17" stroke-width="2.6" stroke-linecap="round"/><path d="M50 18l11 7-12 6" fill="none" stroke="#1F1A17" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    heart: `<svg class="fv-heart" viewBox="0 0 32 30" aria-hidden="true"><path d="M16 27S3 19 3 10.5C3 6 6.4 3 10 3c2.7 0 4.8 1.6 6 3.7C17.2 4.6 19.3 3 22 3c3.6 0 7 3 7 7.5C29 19 16 27 16 27z" fill="#E9A08F" stroke="#1F1A17" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
  };
  const potto = (pose, size) => (window.Potto ? window.Potto.svg(pose, size, "") : "");
  const tape = (i, cls = "") => `<span class="fv-tape ${cls}" style="--tp:${TAPE[i % TAPE.length]};--tr:${i % 2 ? 4 : -5}deg" aria-hidden="true"></span>`;
  const sticker = (txt, cls = "") => `<span class="fv-stk ${cls}">${esc(txt)}</span>`;
  const head = (title, { sub = "", pose = "", doodle = "squig" } = {}) => `<header class="fv-h"><h2><span class="fv-hw">${esc(title)}${doodle === "squig" ? D.squig : ""}</span>${doodle === "star" ? D.star : ""}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}${pose ? `<span class="fv-hp" aria-hidden="true">${potto(pose, 54)}</span>` : ""}</header>`;
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
    else el.innerHTML = `<div class="fv-rail" role="list" aria-label="Stories">${add}${order.map(([s, i]) => `<button type="button" role="listitem" class="fv-ring ${unseen(s) ? "new" : "seen"}" data-fv-story="rail:${i}" aria-label="${esc(s.host.name)}${s.showcase ? ", a page on Pottery Lab" : ""}. ${s.items.length} ${s.items.length === 1 ? "story" : "stories"}${unseen(s) ? ", new" : ""}"><span class="fv-ring-c">${ringThumb(s)}</span>${s.showcase && s.example ? `<i class="fv-ring-tag">Example</i>` : ""}<small>${esc(first(s.host.name).replace(/'s$/, ""))}</small></button>`).join("")}</div>`;
    el.hidden = false; $("#fvAdd", el) && ($("#fvAdd", el).onclick = () => onAdd?.());
    $$("[data-fv-story]", el).forEach((b) => (b.onclick = () => openStories(order.map(([, i]) => "rail:" + i), order.findIndex(([, i]) => "rail:" + i === b.dataset.fvStory), b))); }
  function refreshRings() { $$("[data-fv-story^='rail:']").forEach((b) => { const s = REG.get(b.dataset.fvStory); if (s && !unseen(s) && b.classList.contains("new")) { b.classList.remove("new"); b.classList.add("seen", "just-seen"); } }); }

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
        : `<div class="fv-sv-art" style="${tintStyle(T)}"><div class="fv-sv-artc">${art({ ...it.art, look: it.look }, { title: it.art?.title || "" })}</div></div>`;
      el.setAttribute("aria-label", `Stories from ${s.host.name}`);
      el.innerHTML = `<div class="fv-sv-in"><div class="fv-sv-bars" aria-hidden="true">${s.items.map((_, i) => `<i><b style="transform:scaleX(${i < k ? 1 : 0})"></b></i>`).join("")}</div>
        <div class="fv-sv-top">${avatar(s.host, 36)}<div><b>${esc(s.host.name)}</b><small>${esc(it.caption || "")}${it.by ? ` · from ${esc(it.by)}` : ""}</small></div>
          ${it.type === "video" ? `<button type="button" class="fv-sv-mute" aria-pressed="${!muted}" aria-label="${muted ? "Unmute" : "Mute"}">${muted ? "🔇" : "🔊"}</button>` : ""}<button type="button" class="fv-sv-pause" aria-pressed="false" aria-label="Pause">❚❚</button><button type="button" class="fv-sv-x" aria-label="Close stories">✕</button></div>
        <div class="fv-sv-stage">${media}</div>
        <button type="button" class="fv-sv-prev" aria-label="Previous story"><span aria-hidden="true">‹</span></button><button type="button" class="fv-sv-next" aria-label="Next story"><span aria-hidden="true">›</span></button>
        <div class="fv-sv-foot">${it.note ? `<p class="fv-sv-note">${esc(it.note)}</p>` : ""}<a class="fv-sv-cta" href="${esc(it.cta?.url || "#")}">${esc(it.cta?.label || "See page")} <span aria-hidden="true">→</span></a>${it.type === "video" && muted ? `<button type="button" class="fv-sv-unmute">🔇 Tap for sound</button>` : ""}</div>
        <p class="fv-sv-sr" aria-live="polite">${esc(`${k + 1} of ${s.items.length}. ${it.caption || ""}`)}</p></div>`;
      const bars = $$(".fv-sv-bars b", el), bar = bars[k];
      $(".fv-sv-x", el).onclick = close; $(".fv-sv-prev", el).onclick = prev; $(".fv-sv-next", el).onclick = next; $(".fv-sv-pause", el).onclick = () => setPaused(!paused);
      const mute = (m) => { muted = m; try { sessionStorage.setItem("fv.unmuted", m ? "0" : "1"); } catch {} if (vid) vid.muted = m; const b = $(".fv-sv-mute", el); if (b) { b.textContent = m ? "🔇" : "🔊"; b.setAttribute("aria-pressed", String(!m)); b.setAttribute("aria-label", m ? "Unmute" : "Mute"); } $(".fv-sv-unmute", el)?.remove(); };
      $(".fv-sv-mute", el) && ($(".fv-sv-mute", el).onclick = () => mute(!muted)); $(".fv-sv-unmute", el) && ($(".fv-sv-unmute", el).onclick = (e) => { e.stopPropagation(); mute(false); });
      vid = $(".fv-sv-stage video", el); dur = it.type === "video" ? 15000 : 5000;
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

  // ---------- cards ----------
  let nTilt = 0; const tilt = () => TILT[nTilt++ % TILT.length];
  const fx = (e) => { const f = e.look?.effect; return ["snow", "sparkles", "petals", "confetti", "stars", "twinkle"].includes(f) ? f : ""; };
  function fxLayer(kind) { if (!kind) return ""; const n = kind === "snow" ? 16 : 10; let s = ""; for (let i = 0; i < n; i++) { const x = (i * 37 + 11) % 100, d = 6 + ((i * 7) % 6), dl = -((i * 1.7) % d), sz = kind === "snow" ? 3 + (i % 3) * 2 : 8 + (i % 3) * 4; s += `<i style="--x:${x}%;--d:${d}s;--dl:${dl}s;--sz:${sz}px;--y:${(i * 23) % 90}%"></i>`; } return `<span class="fv-fx fv-fx-${kind === "stars" || kind === "twinkle" ? "sparkles" : kind}" aria-hidden="true">${s}</span>`; }
  const fontAttr = (e) => { const F = FONTS[e.look?.titleFont]; return F ? ` data-fv-font="${esc(e.look.titleFont)}" style="font-family:${esc(F[0])};font-weight:${F[2]}${F[3] ? ";text-transform:uppercase" : ""}"` : ""; };
  // ---- slots for the new-user work (Save, Friends going, Inspo, Hosts you might like): each fills in only when its renderer or endpoint exists ----
  const saveSpot = (item) => `<span class="fv-save" data-fv-save="${esc(JSON.stringify(item))}" hidden></span>`;
  const friendsSpot = (e) => `<span class="fv-friends" data-fv-friends="${esc(e.id || "")}"${(e.friendsGoing || []).length ? ` data-names="${esc(JSON.stringify(e.friendsGoing.slice(0, 4)))}"` : ""} hidden></span>`;
  const slot = (name) => `<section class="fv-sec fv-slot" data-fv-slot="${name}" hidden></section>`;
  const byline = (b) => (b ? `<p class="fv-by">${avatar(b.who, 28)}<span>${b.html}</span></p>` : "");
  // an event coming up: the flyer big (whole when it's a poster, else 4:5), the page tint from its palette
  function flyer(e, { by = null, eager = false } = {}) { const T = tintOf(e), L = e.look || {}, poster = L.coverFit === "poster" && L.coverW && L.coverH, ratio = poster ? `${L.coverW}/${L.coverH}` : e.cover ? "4/5" : "1/1", r = tilt();
    const media = e.cover ? `<img src="${esc(e.cover)}" alt="${esc("Flyer for " + e.title)}" width="${L.coverW || 800}" height="${L.coverH || 1000}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" style="object-fit:${poster ? "contain" : "cover"}">` : art(e);
    const stk = [e.fresh ? sticker("New", "new") : "", e.spotsLeft != null && e.spotsLeft <= 3 ? sticker(e.spotsLeft ? "Last spots!" : "Full", "hot") : "", e.approvalRequired ? sticker("Ask to join", "ask") : "", e.sample ? sticker("Example", "ex") : ""].filter(Boolean).slice(0, 2).join("");
    return `<article class="fv-card fv-flyer${T.dark ? " dark" : ""}" style="${tintStyle(T)};--r:${r}deg" data-fv-fx="${fx(e)}" ${L.lights ? 'data-fv-lights="1"' : ""}>${fxLayer(fx(e))}${byline(by)}
      <a class="fv-fl-media" href="${esc(e.url)}" style="aspect-ratio:${ratio}" aria-label="${esc(e.title)}: see invite">${media}${tape(r > 0 ? 1 : 0, "top")}<span class="fv-stks">${stk}</span>${saveSpot({ kind: "event", id: e.id, title: e.title, url: e.url, image: e.cover || "" })}</a>
      <div class="fv-fl-b"><div class="fv-host">${avatar(e.host, 34)}<span><b>${esc(e.host?.name || "A host")}</b> is hosting</span></div>
        <h3 class="fv-title"${fontAttr(e)}>${esc(e.title)}</h3><p class="fv-when">${esc([when(e), where(e)].filter(Boolean).join(" · "))}${e.going ? ` <span class="fv-going">${esc(e.going)} in</span>` : ""}</p>${friendsSpot(e)}
        <div class="fv-acts"><a class="fv-btn primary" data-fv-in href="${esc(e.url)}">${esc(btnText(e))}</a><a class="fv-btn" href="${esc(e.url)}">See invite</a></div></div></article>`; }
  // a mini flyer for the "This weekend" strip
  function mini(e, i) { const T = tintOf(e); return `<a class="fv-mini" href="${esc(e.url)}" style="${tintStyle(T)};--r:${TILT[(i + 2) % TILT.length] / 1.5}deg"><span class="fv-mini-m">${e.cover ? `<img src="${esc(e.cover)}" alt="" width="200" height="250" loading="lazy" decoding="async">` : art(e, { title: "" })}</span><b>${esc(e.title)}</b><small>${esc([short(e), where(e)].filter(Boolean).join(" · "))}</small>${e.spotsLeft != null && e.spotsLeft <= 3 ? sticker(e.spotsLeft ? "Last spots!" : "Full", "hot sm") : e.fresh ? sticker("New", "new sm") : ""}</a>`; }
  // a past event: a photo dump of taped polaroids, who came, one kudos quote, reactions
  function dump(e, { by = null, key = "", photos = null } = {}) { const P = (photos || e.photos || []).slice(0, 8), r = tilt(), A = [];
    if (e.cover && !P.some((p) => p.url === e.cover)) P.unshift({ id: "cover", url: e.cover, type: "image", caption: "" });
    const sk = key || "ev:" + e.id; REG.set(sk, { host: e.host || { name: e.title }, items: P.map((p, i) => ({ id: "m:" + (p.id || i) + ":" + e.id, type: p.type === "video" ? "video" : "image", url: p.url, poster: p.poster, caption: [e.title, dayOf(e.date, { weekday: "short" })].filter(Boolean).join(" · "), note: p.caption, by: p.by, past: true, cta: { label: "See page", url: e.page || e.url || "#" } })) });
    const pol = P.length ? P.map((p, i) => `<button type="button" class="fv-pol" style="--r:${TILT[(i + nTilt) % TILT.length]}deg;--i:${i}" data-fv-open="${esc(sk)}" data-k="${i}" aria-label="Open photo ${i + 1} of ${P.length}${p.caption ? ": " + esc(p.caption) : ""}">${tape(i, i % 2 ? "tl" : "tr")}${mediaBox(p, { ratio: "1/1" })}<span class="fv-cap">${esc(p.caption || (p.by ? "from " + p.by : i === 0 ? dayOf(e.date, { month: "short", day: "numeric" }) : ""))}</span></button>`).join("")
      : `<div class="fv-pol art" style="--r:-2deg">${tape(0, "tr")}<span class="fv-mb" style="aspect-ratio:1/1">${art(e)}</span><span class="fv-cap">${esc(dayOf(e.date, { month: "short", day: "numeric" }))}</span></div>`;
    const stats = [e.came ? `${e.came} came` : "", e.kudos ? `${e.kudos} kudos` : ""].filter(Boolean).join(" · ");
    const q = e.quote ? `<figure class="fv-quote" style="--n:${NOTE[(e.id || "").length % NOTE.length]}"><span class="fv-pin" aria-hidden="true"></span><blockquote>"${esc(e.quote.text)}"</blockquote><figcaption>${esc(e.quote.name)} <span class="fv-stamp">${esc(e.quote.verifiedLabel)}</span></figcaption></figure>` : "";
    return `<article class="fv-card fv-dump" style="--r:${r}deg">${saveSpot({ kind: "past", id: e.id, title: e.title, url: e.page || e.url || "", image: P[0]?.poster || (P[0]?.type === "video" ? "" : P[0]?.url) || "" })}${byline(by)}<div class="fv-dump-h"><div><h3>${esc(e.title)}</h3><p class="fv-when">${esc([e.host?.name, dayOf(e.date, { weekday: "short", month: "short", day: "numeric" }), where(e)].filter(Boolean).join(" · "))}</p></div>${stats ? `<span class="fv-tally">${esc(stats)}</span>` : ""}</div>
      <div class="fv-pols${P.length > 2 ? " many" : ""}" tabindex="0" aria-label="Photos from ${esc(e.title)}">${pol}</div>${q}
      <div class="fv-acts">${e.id && !/^s[cx]-/.test(e.id) || /^s[cx]-/.test(e.id || "") ? reacts(e) : ""}<a class="fv-btn" href="${esc(e.page || e.url || "#")}">See page</a></div></article>`; }
  function reacts(e) { const C = e.reacts || {}, M = new Set(e.myReacts || []); return `<div class="fv-reacts" role="group" aria-label="React to ${esc(e.title)}">${["🔥", "😍", "🥟", "🙌"].map((x) => `<button type="button" class="fv-react" data-fv-react="${esc(e.id)}" data-e="${x}" aria-pressed="${M.has(x)}" aria-label="${{ "🔥": "Fire", "😍": "Love it", "🥟": "Yum", "🙌": "Hands up" }[x]}${C[x] ? ", " + C[x] : ""}"><span aria-hidden="true">${x}</span><b>${C[x] || ""}</b></button>`).join("")}</div>`; }
  // fresh photos: one big tilted polaroid next to two small ones
  function bento(M, key) { const P = M.slice(0, 3); REG.set(key, { host: P[0]?.event?.host || { name: "Fresh photos" }, items: P.map((m) => ({ id: "m:" + m.id, type: m.type === "video" ? "video" : "image", url: m.url, poster: m.poster, caption: [m.event?.title, dayOf(m.event?.date, { weekday: "short" })].filter(Boolean).join(" · "), note: m.caption, by: m.by, past: true, cta: { label: "See page", url: m.event?.page || "#" } })) });
    return `<section class="fv-sec">${head("Fresh from the kiln", { sub: "New photos from events this month.", pose: "carry" })}<div class="fv-bento n${P.length}">${P.map((m, i) => `<button type="button" class="fv-pol${i ? "" : " big"}" style="--r:${[-2.5, 3, -1.5][i]}deg" data-fv-open="${esc(key)}" data-k="${i}" aria-label="${esc(m.caption || "Photo")}${m.event ? " from " + esc(m.event.title) : ""}">${tape(i, i ? "tr" : "top")}${mediaBox(m, { ratio: i ? "1/1" : "4/5" })}<span class="fv-cap">${esc(m.caption || m.event?.title || "")}</span><span class="fv-pby">${esc([m.by, m.event?.host?.name].filter(Boolean).join(" at "))}</span></button>`).join("")}</div></section>`; }
  // a single moment or post photo, full width
  function moment(m, { by = null, key }) { REG.set(key, { host: m.event?.host || m.who || { name: "Photo" }, items: [{ id: "m:" + (m.id || key), type: m.type === "video" ? "video" : "image", url: m.url, poster: m.poster, caption: m.event?.title || "", note: m.caption, by: m.by, past: true, cta: { label: "See page", url: m.event?.page || "#" } }] });
    return `<article class="fv-card fv-moment" style="--r:${tilt()}deg">${byline(by)}<button type="button" class="fv-pol wide" data-fv-open="${esc(key)}" data-k="0" aria-label="Open ${m.type === "video" ? "video" : "photo"}">${tape(1, "top")}${mediaBox(m, { ratio: m.w && m.h ? `${m.w}/${m.h}` : "4/5" })}<span class="fv-cap">${esc(m.caption || m.event?.title || "")}</span></button>${m.event?.title ? `<p class="fv-when">${esc(m.event.title)}${m.event.host?.name ? " · " + esc(m.event.host.name) : ""}</p>` : ""}</article>`; }
  // kudos as sticky notes
  function note(k, i) { const TAG = { food: "🍜 Amazing food", welcome: "🤗 Felt welcome", vibe: "✨ Great vibe", organized: "📋 Well organized", met: "👋 Met new people", fun: "😂 So much fun", spot: "📍 Great spot", again: "🔁 Would go again" };
    return `<figure class="fv-note" style="--n:${NOTE[i % NOTE.length]};--r:${TILT[(i + 1) % TILT.length]}deg">${i % 2 ? `<span class="fv-pin" aria-hidden="true"></span>` : tape(i, "top")}<blockquote>"${esc(k.text)}"</blockquote><figcaption><b>${esc(k.name)}</b>${k.event?.title ? ` at <a href="${esc(k.event.page || "#")}">${esc(k.event.title)}</a>` : ""}${k.verifiedLabel ? `<span class="fv-stamp">${esc(k.verifiedLabel)}</span>` : ""}</figcaption>${(k.tags || []).length ? `<p class="fv-chips">${k.tags.slice(0, 2).map((t) => `<span>${esc(TAG[t] || t)}</span>`).join("")}</p>` : ""}</figure>`; }
  const notes = (K) => `<section class="fv-sec">${head("Guests are saying", { doodle: "star" })}<div class="fv-notes">${K.slice(0, 4).map(note).join("")}</div></section>`;
  // a prepared page's experience, as its illustrated cover
  const TONES = ["butter", "blush", "sky", "mint", "lilac", "peach"]; let nArt = 0;
  function artCard(P, x, i) { const A = window.EventArt, base = { id: x.id, title: x.title, name: x.title, activity: `${x.title} ${x.category} ${x.desc || ""}` }, kinds = A ? A.suggest(base, 6) : [], n = nArt++;
    const e = { ...base, emoji: x.emoji, coverArt: A ? { kind: kinds[n % Math.max(1, kinds.length)] || A.kindOf(base), tone: TONES[n % TONES.length] } : null }; const T = { ...tintOf(e), bg: A ? A.PASTELS[e.coverArt.tone] : "#FDE6A6" };
    return `<a class="fv-art" href="${esc(P.page)}" style="${tintStyle(T)};--r:${TILT[(i + 3) % TILT.length]}deg"><span class="fv-art-m">${art(e)}</span><span class="fv-art-b"><span class="fv-host">${avatar(P.host, 28)}<b>${esc(P.host.name)}</b></span><small>${esc([x.price, P.city].filter(Boolean).join(" · "))}</small></span>${P.example ? sticker("Example", "ex sm") : ""}</a>`; }
  const artPair = (L) => `<div class="fv-artpair">${L.map(([P, x], i) => artCard(P, x, i)).join("")}</div>`;
  // a host's page in one strip: their name, line, and a few covers
  const strip = (title, L, sub = "") => L.length ? `<section class="fv-sec">${head(title, { sub, doodle: "star" })}<div class="fv-strip" tabindex="0" aria-label="${esc(title)}">${L.map(mini).join("")}</div></section>` : "";

  // ---------- putting it together ----------
  function interleave(Q, pattern) { const out = []; let guard = 0; while (guard++ < 200) { let any = false; for (const t of pattern) { const q = Q[t]; if (q && q.length) { out.push(q.shift()); any = true; } } if (!any) break; } return out; }
  const showcasePasts = (S) => S.flatMap((P) => P.past.filter((p) => p.cover || p.photos.length).map((p) => ({ id: p.id, title: p.title, date: p.date, place: p.place, cover: p.cover, photos: p.photos.map((u, i) => ({ id: p.id + i, url: u, type: "image" })), host: P.host, page: P.page, note: p.note, sample: P.example })));
  const showcaseArt = (S) => { const Q = S.map((P) => P.experiences.map((x) => [P, x])), L = []; for (let r = 0; Q.some((q) => q.length) && r < 20; r++) for (const q of Q) if (q.length) L.push(q.shift()); /* round robin: two hosts side by side */
    const pairs = []; for (let i = 0; i + 1 < L.length; i += 2) pairs.push([L[i], L[i + 1]]); return pairs; };
  function publicQueues(V, { skip = new Set() } = {}) { const t = new Date().toISOString().slice(0, 10), wk = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const up = (V.upcoming || []).filter((e) => !skip.has(e.id)), weekend = up.filter((e) => e.date <= wk), rest = up.filter((e) => !weekend.includes(e));
    const big = (rest.length ? rest : weekend).slice(0, 4).sort((a, b) => (!!b.cover - !!a.cover)), past = (V.past || []).filter((e) => !skip.has(e.id));
    const realPast = past.filter((e) => e.photos?.length || e.cover || e.quote).sort((a, b) => (b.photos?.length || 0) + (b.cover ? 1 : 0) - (a.photos?.length || 0) - (a.cover ? 1 : 0)), quiet = past.filter((e) => !realPast.includes(e));
    const scP = showcasePasts(V.showcase || []);
    return { weekend: weekend.length >= 2 ? weekend : weekend.length === 1 && !rest.length ? [] : weekend, flyer: big.map((e, i) => () => flyer(e, { eager: i === 0 && !skip.size })), dump: [...realPast.map((e) => () => dump(e)), ...scP.map((e) => () => dump(e, { key: "sc:" + e.id })), ...quiet.slice(0, 3).map((e) => () => dump(e))],
      bento: (V.moments || []).length >= 3 ? [() => bento(varied(V.moments), "bento")] : (V.moments || []).slice(0, 2).map((m, i) => () => moment(m, { key: "pm:" + i })), kudos: (() => { const shown = new Set(past.map((e) => e.quote?.text).filter(Boolean)), K = (V.kudos || []).filter((k) => !shown.has(k.text)); return K.length ? [() => notes(K)] : []; })(), art: showcaseArt(V.showcase || []).slice(0, 4).map((p, i) => () => `<section class="fv-sec">${i ? "" : head("From hosts' pages", { sub: "Things you can book or join." })}${artPair(p)}</section>`) }; }
  const varied = (M) => { const by = new Set(), a = [], b = []; for (const m of M) (by.has(m.event?.id) ? b : (by.add(m.event?.id), a)).push(m); return [...a.filter((m) => m.type !== "video" || m.poster), ...b, ...a.filter((m) => m.type === "video" && !m.poster)]; };
  const run = (L) => L.map((f) => (typeof f === "function" ? f() : f)).join("");
  /** The signed-out feed. V: /api/public/feed. lb: the leaderboard card's HTML, or "". */
  function composePublic(V, { lb = "" } = {}) { css(); nTilt = 0; const Q = publicQueues(V); Q.lb = lb ? [lb] : [];
    const firstArt = Q.art.length ? Q.art.shift() : null;
    const hero = `<section class="fv-hero"><div><h1>What people are <span class="fv-em">hosting${D.squig}</span></h1><p>Supper clubs, run clubs and pop-ups from hosts on Pottery Lab. <a href="/login?next=/feed">Sign in</a> to see your friends.</p></div><a class="fv-stk big start" href="/signup?mode=friends">Start your page</a><span class="fv-hero-p" aria-hidden="true">${potto("cheer", 92)}</span></section>`;
    // the most photo-rich first: photo dumps and fresh photos lead, flyers with a photo before illustrated ones
    Q.slotA = [slot("inspo")]; Q.slotB = [slot("hosts")]; Q.strip = Q.weekend.length ? [strip("This weekend", Q.weekend)] : [];
    const blocks = interleave(Q, ["dump", "bento", "strip", "flyer", "dump", "slotA", "kudos", "flyer", "dump", "lb", "art", "slotB", "dump", "flyer", "art", "dump"]);
    if (firstArt) blocks.splice(Math.min(3, blocks.length), 0, firstArt);
    // older things from prepared pages: below the real content, as ideas (never as what people are hosting now)
    const older = (V.ideas || []).length ? `<section class="fv-sec fv-older">${head("More ideas to steal", { sub: "From hosts' pages. Examples, not dates.", doodle: "star" })}<div class="fv-strip" tabindex="0" aria-label="More ideas to steal">${V.ideas.map((x, i) => `<a class="fv-mini" href="${esc(x.page || "/ideas")}" style="--r:${TILT[(i + 2) % TILT.length] / 1.5}deg"><span class="fv-mini-m">${x.cover ? `<img src="${esc(x.cover)}" alt="" width="200" height="250" loading="lazy" decoding="async">` : art({ id: x.id, title: x.title, activity: x.title }, { title: "" })}</span><b>${esc(x.title)}</b><small>${esc([x.host?.name, x.city].filter(Boolean).join(" · "))}</small>${sticker("Example", "ex sm")}</a>`).join("")}</div></section>` : "";
    return hero + `<div class="fv-wall">${run(blocks)}</div>` + older + `<p class="fv-end">${D.arrow}<a href="/discover">See everything on Discover</a></p>`; }
  /** The signed-in feed: your people's items first (media-first), then the public sections around them. */
  function composeSignedIn(F, { lbRender = {}, postRender = null, empty = "" } = {}) { css(); nTilt = 0; const E = F.events || {}, seenEv = new Set(), out = []; let lbN = 0;
    const by = (who, verb) => ({ who, html: `<b>${esc(who?.name || "Someone")}</b> ${esc(verb)}` });
    for (const it of F.items || []) { if (lbRender[it.kind]) { if (it.kind === "leaderboard" && lbN++) continue; out.push(lbRender[it.kind](it)); continue; }
      if (it.kind === "post") { out.push(postRender ? postRender(it) : ""); continue; }
      const id = it.event?.id, e = id && E[id]; if (!e) continue;
      if (it.kind === "kudos") { out.push(`<div class="fv-notes one">${note({ text: it.love, name: it.who?.name, tags: it.tags, verifiedLabel: "", event: { title: e.title, page: e.page } }, out.length)}</div>`); continue; }
      if (seenEv.has(id)) continue; seenEv.add(id);
      if (it.kind === "hosting" || !e.past) { out.push(flyer(e, { by: by(it.who, "is hosting"), eager: out.length === 0 })); continue; }
      const verb = it.kind === "moment" ? "added photos" : it.kind === "recap" ? "hosted" : "went";
      out.push(dump(e, { by: by(it.who, verb) })); }
    const Q = publicQueues(F.visual || {}, { skip: seenEv }), mineN = out.length; Q.yours = out; Q.slotA = [slot("inspo")]; Q.slotB = [slot("hosts")];
    const blocks = interleave(Q, ["yours", "yours", "flyer", "yours", "bento", "slotB", "yours", "dump", "yours", "kudos", "slotA", "yours", "art", "flyer", "dump", "art", "dump"]);
    return (mineN ? "" : empty) + (Q.weekend.length ? strip("This weekend", Q.weekend) : "") + `<div class="fv-wall">${run(blocks)}</div>`; }

  // ---------- behaviour: effects only while on screen, title fonts on demand, reactions, confetti, photo taps ----------
  const fontsLoaded = new Set(); const loadFont = (k) => { const F = FONTS[k]; if (!F || fontsLoaded.has(k)) return; fontsLoaded.add(k); const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `https://fonts.googleapis.com/css2?family=${F[1]}&display=swap`; document.head.appendChild(l); };
  let IO = null;
  function wire(root) { css();
    if (!IO && "IntersectionObserver" in window) IO = new IntersectionObserver((L) => L.forEach((x) => { x.target.classList.toggle("fv-live", x.isIntersecting); if (x.isIntersecting) { const f = x.target.querySelector("[data-fv-font]"); if (f) loadFont(f.dataset.fvFont); if (x.target.dataset.fvLights === "1" && !x.target.querySelector(".fv-lights")) x.target.insertAdjacentHTML("afterbegin", lightsSvg()); } }), { rootMargin: "120px" });
    $$(".fv-card,.fv-mini", root).forEach((c) => { if (IO) IO.observe(c); else { c.classList.add("fv-live"); const f = c.querySelector("[data-fv-font]"); if (f) loadFont(f.dataset.fvFont); } });
    $$("[data-fv-open]", root).forEach((b) => (b.onclick = () => openStories([b.dataset.fvOpen], 0, b, +b.dataset.k || 0)));
    const RL = { "🔥": "Fire", "😍": "Love it", "🥟": "Yum", "🙌": "Hands up" }, rLabel = (x, n) => `${RL[x] || "React"}${n ? ", " + n : ""}`;
    $$("[data-fv-react]", root).forEach((b) => (b.onclick = async () => { const on = b.getAttribute("aria-pressed") !== "true", n = $("b", b), was = { pressed: b.getAttribute("aria-pressed"), count: n.textContent, label: b.getAttribute("aria-label") };
      const undo = () => { b.setAttribute("aria-pressed", was.pressed); n.textContent = was.count; b.setAttribute("aria-label", was.label); b.classList.remove("pop"); };
      b.setAttribute("aria-pressed", String(on)); n.textContent = Math.max(0, (+n.textContent || 0) + (on ? 1 : -1)) || ""; b.setAttribute("aria-label", rLabel(b.dataset.e, +n.textContent || 0)); if (on && !RM()) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      try { const r = await fetch("/api/feed/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: b.dataset.fvReact, emoji: b.dataset.e, device: deviceId }) }); const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.counts) { undo(); return; } // the server said no (too many, signed out): put it back as it was
        $$(`[data-fv-react="${CSS.escape(b.dataset.fvReact)}"]`, root).forEach((x) => { const c = j.counts[x.dataset.e] || 0; x.querySelector("b").textContent = c || ""; x.setAttribute("aria-pressed", String((j.mine || []).includes(x.dataset.e))); x.setAttribute("aria-label", rLabel(x.dataset.e, c)); }); } catch { undo(); } }));
    slots(root);
    $$("[data-fv-in]", root).forEach((a) => (a.onclick = (ev) => { if (RM() || ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); confetti(a); setTimeout(() => (location.href = a.href), 520); })); }
  // fill the slots once their renderers exist (window.PLSave, window.PLInspo, the suggest endpoint); until then they stay hidden
  function slots(root) {
    if (window.PLSave?.button) $$("[data-fv-save]", root).forEach((s) => { if (s.dataset.on) return; s.dataset.on = 1; try { const b = window.PLSave.button(JSON.parse(s.dataset.fvSave)); if (b) { typeof b === "string" ? (s.innerHTML = b) : s.appendChild(b); s.hidden = false; } } catch {} });
    $$("[data-fv-friends][data-names]", root).forEach((s) => { try { const N = JSON.parse(s.dataset.names); if (!N.length) return; s.innerHTML = `${N.map((n, i) => `<i style="--c:${NOTE[i % NOTE.length]}" aria-hidden="true">${esc(String(n).slice(0, 1).toUpperCase())}</i>`).join("")}<span>${esc(N.slice(0, 2).join(", "))}${N.length > 2 ? ` +${N.length - 2}` : ""} going</span>`; s.hidden = false; } catch {} });
    const ins = $("[data-fv-slot=inspo]", root); if (ins && window.PLInspo?.card) fetch("/api/public/inspo?limit=6" + (window.FeedVisual?.publicQuery ? "&" + String(window.FeedVisual.publicQuery()).replace(/^[?&]/, "") : "")).then((r) => (r.ok ? r.json() : null)).then((j) => { const L = (j?.data || j?.items || j?.ideas || []).slice(0, 6); if (!L.length) return; ins.innerHTML = head("Ideas to steal", { doodle: "star" }) + `<div class="fv-strip fv-inspo">${L.map((x) => { try { const c = window.PLInspo.card(x); return typeof c === "string" ? c : c?.outerHTML || ""; } catch { return ""; } }).join("")}</div>`; ins.hidden = false; }).catch(() => {});
    const hs = $("[data-fv-slot=hosts]", root); if (hs) fetch("/api/public/suggest/hosts?limit=8").then((r) => (r.ok ? r.json() : null)).then((j) => { const L = (j?.hosts || []).filter((h) => h?.handle && h.name).slice(0, 8); if (!L.length) return; hs.innerHTML = head("Hosts you might like") + `<div class="fv-strip fv-hostrow">${L.map((h, i) => `<a class="fv-hostc" href="/@${esc(h.handle)}" style="--r:${TILT[i % TILT.length] / 2}deg">${avatar({ ...h, avatarArt: h.avatarArt || h.theme?.avatarArt, avatarUrl: h.avatarUrl || h.theme?.avatarUrl, color: h.color || h.theme?.accent }, 56)}<b>${esc(h.name)}</b><small>${esc(h.city || h.why || "")}</small></a>`).join("")}</div>`; hs.hidden = false; }).catch(() => {});
  }
  function lightsSvg() { let b = ""; const C = ["#FFD36E", "#FFF1C9", "#FF9F6E", "#FFE08A"]; for (let i = 0; i < 9; i++) { const x = 6 + i * 11, y = 6 + 10 * Math.sin((i / 8) * Math.PI); b += `<circle class="bulb" cx="${x}" cy="${y + 3}" r="2.6" fill="${C[i % 4]}" stroke="#3B2A20" stroke-width=".6"/>`; } return `<svg class="fv-lights" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4Q50 30 100 4" fill="none" stroke="#3B2A20" stroke-width=".8"/>${b}</svg>`; }
  function confetti(a) { const r = a.getBoundingClientRect(), box = document.createElement("div"); box.className = "fv-confetti"; box.setAttribute("aria-hidden", "true"); box.style.left = r.left + r.width / 2 + "px"; box.style.top = r.top + r.height / 2 + "px";
    const C = ["#C94A30", "#F2D48F", "#6F7F5E", "#E9A08F", "#A9D5F8", "#1F1A17"]; for (let i = 0; i < 26; i++) { const ang = (i / 26) * Math.PI * 2, d = 60 + (i * 13) % 70; box.insertAdjacentHTML("beforeend", `<i style="--dx:${Math.cos(ang) * d}px;--dy:${Math.sin(ang) * d - 40}px;--c:${C[i % C.length]};--rot:${(i * 47) % 360}deg"></i>`); }
    document.body.appendChild(box); setTimeout(() => box.remove(), 900); }

  // ---------- styles ----------
  function css() { if (document.getElementById("fvCss")) return; const s = document.createElement("style"); s.id = "fvCss"; s.textContent = CSS_TEXT; document.head.appendChild(s); }
  const CSS_TEXT = `
:root{--fv-ink:#1F1A17;--fv-paper:#F7F1E8;--fv-linen:#EFE6D8;--fv-ember:#C94A30;--fv-ember-d:#A63A22;--fv-butter:#F2D48F;--fv-sage:#6F7F5E;--fv-smoke:#665A51;--fv-line:#E4D9C8}
.fv-wall{display:flex;flex-direction:column;gap:26px;padding:4px 0 8px}
.fv-av{flex:none;display:grid;place-items:center;border-radius:50%;overflow:hidden;background:color-mix(in srgb,var(--c) 22%,#fff);border:2px solid var(--fv-ink);font-size:18px;line-height:1}.fv-av img,.fv-av svg{width:100%!important;height:100%!important;object-fit:cover;max-width:none!important;max-height:none!important}
/* stories rail */
.fv-rail{display:flex;gap:12px;overflow-x:auto;padding:8px 4px 14px;scrollbar-width:none;scroll-snap-type:x proximity}.fv-rail::-webkit-scrollbar{display:none}
.fv-ring{flex:none;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;width:76px;background:none;border:0;padding:0;cursor:pointer;color:var(--fv-ink);font:600 12.5px "Instrument Sans",system-ui;scroll-snap-align:start}
.fv-ring-c{width:70px;height:70px;border-radius:50%;padding:3px;display:grid;place-items:center;background:var(--fv-line);border:2px solid var(--fv-ink);box-shadow:2px 3px 0 var(--fv-ink);transition:background .5s,transform .2s}
.fv-ring.new .fv-ring-c{background:conic-gradient(var(--fv-ember) 0 25%,var(--fv-butter) 0 50%,var(--fv-ember) 0 75%,var(--fv-butter) 0)}
.fv-ring-c>img,.fv-ring-c>.fv-av,.fv-ring-art{width:100%!important;height:100%!important;border-radius:50%;object-fit:cover;border:3px solid #fff;display:grid;place-items:center;overflow:hidden;box-sizing:border-box}.fv-ring-art svg{width:86%;height:auto}
.fv-ring.add .fv-ring-c{background:#fff;border-style:dashed}.fv-ring.add b{font:600 30px Fredoka,system-ui;color:var(--fv-ember)}
.fv-ring small{max-width:76px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fv-ring:hover .fv-ring-c{transform:rotate(-4deg) scale(1.04)}.fv-ring:focus-visible{outline:none}.fv-ring:focus-visible .fv-ring-c{outline:3px solid var(--fv-ember);outline-offset:3px}
.fv-ring.just-seen .fv-ring-c{animation:fv-seen .7s ease-out}@keyframes fv-seen{0%{transform:rotate(0) scale(1.08)}60%{transform:rotate(200deg) scale(.96)}100%{transform:rotate(360deg) scale(1)}}
.fv-ring-tag{position:absolute;top:-4px;right:-2px;font:700 10px "Instrument Sans",system-ui;font-style:normal;background:#fff;border:1.5px solid var(--fv-ink);border-radius:999px;padding:1px 6px;transform:rotate(8deg)}
.fv-peek{position:relative;display:flex;align-items:center;gap:10px;padding:6px 14px 6px 4px;background:#fff;border:2px dashed var(--fv-line);border-radius:18px;min-height:70px;flex:1;overflow:hidden}.fv-peek p{margin:0;color:var(--fv-smoke);font-size:14px}.fv-peek-p{flex:none;width:64px;height:58px;overflow:hidden;align-self:flex-end;margin-bottom:-12px}.fv-peek-p svg{width:64px;height:auto;animation:fv-peek 3.6s ease-in-out infinite}@keyframes fv-peek{0%,100%{transform:translateY(16px)}40%,70%{transform:translateY(0)}}
/* headers with a squiggle under the words */
.fv-h{position:relative;margin:0 0 12px;padding-right:64px}.fv-h h2{display:flex;align-items:center;gap:8px;margin:0;font:600 24px/1.15 Fredoka,system-ui}.fv-hw{position:relative;display:inline-block}.fv-squig{position:absolute;left:0;right:0;bottom:-8px;width:100%;height:10px;color:var(--fv-ember)}.fv-star{width:26px;height:26px;flex:none;transform:rotate(12deg)}
.fv-h p{margin:10px 0 0;color:var(--fv-smoke);font-size:14.5px}.fv-hp{position:absolute;right:0;top:-14px;width:58px}.fv-hp svg{width:58px;height:auto}
/* hero (signed out) */
.fv-hero{position:relative;display:grid;gap:10px;background:#fff;border:2.5px solid var(--fv-ink);border-radius:22px;padding:16px 18px 18px;box-shadow:4px 5px 0 var(--fv-ink);margin:2px 0 18px;overflow:hidden}
.fv-hero::before{content:"";position:absolute;inset:0;background:radial-gradient(color-mix(in srgb,var(--fv-ink) 7%,transparent) 1px,transparent 1.2px) 0 0/14px 14px;pointer-events:none}
.fv-hero>div{position:relative;padding-right:84px}.fv-hero h1{font:600 clamp(26px,6.4vw,40px)/1.05 Fredoka,system-ui!important;margin:0 0 12px}.fv-hero h1 .fv-squig{bottom:-6px;height:12px}.fv-em{position:relative;display:inline-block;color:var(--fv-ember)}
.fv-hero p{margin:0;color:var(--fv-smoke);max-width:44ch;font-size:15px}.fv-hero p a{color:var(--fv-ember-d);font-weight:700}.fv-hero-p{position:absolute;right:6px;bottom:-6px;width:96px}.fv-hero-p svg{width:96px;height:auto}
.fv-stk.big.start{position:relative;justify-self:start;font-size:15px;padding:10px 16px;transform:rotate(-3deg);text-decoration:none;background:var(--fv-butter);min-height:44px;display:inline-flex;align-items:center}
.fv-stk.big.start:hover{transform:rotate(-1deg) scale(1.03)}
/* cards: thick ink outline, a sticker shadow, a slight tilt */
.fv-card{position:relative;background:#fff;border:2.5px solid var(--fv-ink);border-radius:22px;box-shadow:4px 5px 0 var(--fv-ink);transform:rotate(calc(var(--r,0deg) * .35));padding:14px;isolation:isolate}
.fv-by{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:14px;color:var(--fv-smoke)}.fv-by b{color:var(--fv-ink)}
.fv-host{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--tsoft,var(--fv-smoke))}.fv-host b{color:var(--tink,var(--fv-ink));font-weight:700}
.fv-title{margin:8px 0 4px;font:600 clamp(24px,6vw,32px)/1.08 Fredoka,system-ui;color:var(--tink,var(--fv-ink));text-wrap:balance;overflow-wrap:anywhere}
.fv-when{margin:2px 0 0;color:var(--tsoft,var(--fv-smoke));font-size:14.5px}.fv-going{display:inline-block;margin-left:4px;background:var(--fv-butter);color:var(--fv-ink);border:1.5px solid var(--fv-ink);border-radius:999px;padding:0 8px;font-weight:700;font-size:13px}
.fv-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.fv-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 18px;border-radius:999px;border:2px solid var(--fv-ink);background:#fff;color:var(--fv-ink);font:600 15px "Instrument Sans",system-ui;text-decoration:none;box-shadow:2px 3px 0 var(--fv-ink);transition:transform .12s,box-shadow .12s}
.fv-btn:hover{transform:translate(-1px,-1px);box-shadow:3px 4px 0 var(--fv-ink)}.fv-btn:active{transform:translate(2px,3px);box-shadow:0 0 0 var(--fv-ink)}.fv-btn.primary{background:var(--fv-ember);color:#fff}
.fv-btn:focus-visible,.fv-pol:focus-visible,.fv-react:focus-visible,.fv-mini:focus-visible,.fv-art:focus-visible,.fv-fl-media:focus-visible{outline:3px solid var(--fv-ember);outline-offset:3px}
/* flyer: the page tint, the flyer big */
.fv-flyer{background:var(--tint);color:var(--tink);padding:12px 12px 16px;overflow:hidden}
.fv-flyer .fv-by{color:var(--tsoft)}.fv-flyer .fv-by b{color:var(--tink)}
.fv-fl-media{position:relative;display:block;border:2.5px solid var(--fv-ink);border-radius:14px;background:#fff;box-shadow:3px 3px 0 var(--fv-ink);overflow:visible;max-height:78vh}.fv-fl-media>img{position:absolute;inset:0;width:100%;height:100%;border-radius:11px;background:#fff}
.fv-fl-media .ea-cover{border-radius:11px}.fv-fl-b{position:relative;z-index:3;padding:12px 4px 0}.fv-flyer>.fv-by{position:relative;z-index:3}
.fv-flyer.dark .fv-btn:not(.primary){background:transparent;color:var(--tink);border-color:var(--tink);box-shadow:2px 3px 0 rgba(0,0,0,.5)}
.fv-flyer .fv-lights{position:absolute;left:0;right:0;top:0;width:100%;height:30px;z-index:3;pointer-events:none}
.fv-stks{position:absolute;right:-8px;top:12px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:2}
.fv-stk{display:inline-block;font:700 13px/1 "Instrument Sans",system-ui;letter-spacing:.02em;padding:7px 11px;border-radius:999px;background:#fff;color:var(--fv-ink);border:2px solid var(--fv-ink);box-shadow:2px 2px 0 var(--fv-ink),0 0 0 4px #fff;transform:rotate(6deg)}
.fv-stk.new{background:var(--fv-butter)}.fv-stk.hot{background:var(--fv-ember);color:#fff}.fv-stk.ask{background:#E2D6F7}.fv-stk.ex{background:#fff;color:var(--fv-smoke)}.fv-stk.sm{font-size:11px;padding:4px 8px;box-shadow:1px 1px 0 var(--fv-ink),0 0 0 3px #fff}
/* washi tape */
.fv-tape{position:absolute;width:74px;height:22px;background:var(--tp);opacity:.88;z-index:3;border-left:2px dotted rgba(255,255,255,.55);border-right:2px dotted rgba(255,255,255,.55);box-shadow:0 1px 0 rgba(31,26,23,.12);pointer-events:none}
.fv-tape.top{top:-11px;left:50%;transform:translateX(-50%) rotate(var(--tr))}.fv-tape.tl{top:-8px;left:-16px;transform:rotate(-38deg);width:56px}.fv-tape.tr{top:-8px;right:-16px;transform:rotate(36deg);width:56px}
/* polaroids */
.fv-pol{position:relative;display:block;background:#fff;border:2px solid var(--fv-ink);border-radius:6px;padding:8px 8px 6px;box-shadow:3px 4px 0 rgba(31,26,23,.85);transform:rotate(var(--r,0deg));cursor:pointer;color:var(--fv-ink);text-align:center;font:inherit;transition:transform .25s cubic-bezier(.3,1.6,.5,1)}
.fv-pol:hover{transform:rotate(calc(var(--r,0deg) * -1)) scale(1.03);z-index:4}.fv-pol:active{transform:rotate(0) scale(.98)}
.fv-mb{position:relative;display:block;width:100%;background:var(--fv-linen);overflow:hidden;border-radius:2px}.fv-mb>img,.fv-mb>video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.fv-mb>.ea-cover{position:absolute}
.fv-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:48px;height:48px;border-radius:50%;background:rgba(31,26,23,.78);color:#fff;display:grid;place-items:center;font-size:18px;border:2px solid #fff;padding-left:3px}
.fv-cap{display:block;min-height:26px;padding-top:4px;font:600 19px/1.1 Caveat,"Bradley Hand","Segoe Print",cursive;color:#2B211C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fv-pby{display:block;font-size:12px;color:var(--fv-smoke);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* the photo dump */
.fv-dump{background:var(--fv-linen)}.fv-dump-h{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:6px}.fv-dump-h h3{margin:0;font:600 22px/1.15 Fredoka,system-ui;overflow-wrap:anywhere}
.fv-tally{flex:none;font:700 13px "Instrument Sans",system-ui;background:#fff;border:2px solid var(--fv-ink);border-radius:999px;padding:5px 10px;transform:rotate(3deg);white-space:nowrap}
.fv-pols{display:flex;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;padding:22px 14px 16px;margin:0 -14px;scrollbar-width:none}.fv-pols::-webkit-scrollbar{display:none}
.fv-pols>.fv-pol{flex:none;width:min(62%,250px);scroll-snap-align:center;margin-right:-22px}.fv-pols>.fv-pol:nth-child(even){margin-top:14px}.fv-pols>.fv-pol:last-child{margin-right:0}
.fv-pols:not(.many){justify-content:center}.fv-pols:not(.many)>.fv-pol{width:min(78%,320px)}.fv-pols:not(.many)>.fv-pol+.fv-pol{width:min(46%,220px);margin-left:-26px;margin-top:30px}
.fv-pol.art{cursor:default}
/* kudos: sticky notes */
.fv-quote,.fv-note{position:relative;margin:8px 4px 0;background:var(--n);border:2px solid var(--fv-ink);border-radius:4px 4px 18px 4px;padding:16px 16px 12px;box-shadow:3px 4px 0 rgba(31,26,23,.85);transform:rotate(var(--r,-1.2deg))}
.fv-quote blockquote,.fv-note blockquote{margin:0;font:600 23px/1.18 Caveat,"Bradley Hand",cursive;color:#1F1A17}
.fv-quote figcaption,.fv-note figcaption{margin-top:8px;font-size:13.5px;color:#3E352F;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.fv-note figcaption a{color:inherit;font-weight:600}
.fv-stamp{display:inline-block;font:700 10.5px/1.2 "Instrument Sans",system-ui;letter-spacing:.06em;text-transform:uppercase;color:#4E6140;border:1.5px solid #4E6140;border-radius:4px;padding:2px 6px;transform:rotate(-3deg);background:rgba(255,255,255,.55)}
.fv-pin{position:absolute;top:-9px;left:50%;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:var(--fv-ember);border:2px solid var(--fv-ink);box-shadow:1px 2px 0 rgba(31,26,23,.6);z-index:3}
.fv-notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:18px 16px;padding:8px 2px}.fv-notes.one{padding:6px 10px}
.fv-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.fv-chips span{font:600 12.5px "Instrument Sans",system-ui;background:#fff;border:1.5px solid var(--fv-ink);border-radius:999px;padding:3px 9px;transform:rotate(-2deg)}.fv-chips span:nth-child(2){transform:rotate(2deg)}
/* reactions */
.fv-reacts{display:flex;gap:6px;flex-wrap:wrap;margin-right:auto}.fv-react{min-width:52px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border-radius:999px;border:2px solid var(--fv-ink);background:#fff;cursor:pointer;font:700 13px "Instrument Sans",system-ui;color:var(--fv-ink);padding:0 10px}
.fv-react span{font-size:19px}.fv-react[aria-pressed=true]{background:var(--fv-butter)}.fv-react b:empty{display:none}.fv-react.pop span{animation:fv-pop .5s cubic-bezier(.3,1.8,.5,1)}@keyframes fv-pop{0%{transform:scale(1)}35%{transform:scale(1.7) rotate(-12deg)}100%{transform:scale(1)}}
/* bento of fresh photos */
.fv-bento{display:grid;grid-template-columns:1.35fr 1fr;grid-template-rows:auto auto;gap:14px 12px;padding:10px 6px}.fv-bento .big{grid-row:span 2;align-self:start}.fv-bento.n1{grid-template-columns:1fr}.fv-bento.n2 .big{grid-row:auto}
.fv-moment{padding:12px;background:#fff}.fv-pol.wide{width:100%;padding:10px 10px 8px}.fv-moment .fv-when{text-align:center;margin-top:8px}
/* the weekend strip */
.fv-strip{display:flex;gap:14px;overflow-x:auto;padding:12px 6px 18px;margin:0 -6px;scroll-snap-type:x proximity;scrollbar-width:none}.fv-strip::-webkit-scrollbar{display:none}
.fv-mini{position:relative;flex:none;width:156px;scroll-snap-align:start;background:var(--tint);color:var(--tink);border:2px solid var(--fv-ink);border-radius:16px;padding:8px 8px 10px;box-shadow:3px 3px 0 var(--fv-ink);text-decoration:none;transform:rotate(var(--r));transition:transform .2s}.fv-mini:hover{transform:rotate(0) translateY(-3px)}
.fv-mini-m{position:relative;display:block;aspect-ratio:4/5;border-radius:10px;overflow:hidden;border:2px solid var(--fv-ink);background:#fff}.fv-mini-m img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.fv-mini b{display:block;margin-top:7px;font:600 15px/1.2 Fredoka,system-ui;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.fv-mini small{display:block;margin-top:2px;color:var(--tsoft);font-size:12.5px}.fv-mini .fv-stk{position:absolute;top:-8px;right:-6px}
/* prepared pages' experiences: illustrated covers, two up */
.fv-artpair{display:grid;grid-template-columns:1fr 1fr;gap:16px 12px;padding:6px 4px}
.fv-art{position:relative;display:block;background:var(--tint);border:2.5px solid var(--fv-ink);border-radius:18px;box-shadow:3px 4px 0 var(--fv-ink);overflow:hidden;text-decoration:none;color:var(--fv-ink);transform:rotate(var(--r));transition:transform .25s cubic-bezier(.3,1.6,.5,1)}.fv-art:hover{transform:rotate(0) scale(1.02)}
.fv-art-m{position:relative;display:block;aspect-ratio:1/1}.fv-art-b{display:grid;gap:2px;padding:8px 10px 10px;background:#fff;border-top:2px solid var(--fv-ink)}.fv-art-b .fv-host{font-size:13px;color:var(--fv-ink)}.fv-art-b b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fv-art-b small{color:var(--fv-smoke);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fv-art .fv-stk{position:absolute;top:8px;right:8px}
.fv-save{position:absolute;left:10px;top:10px;z-index:4}.fv-dump>.fv-save{left:auto;right:14px;top:-12px}
.fv-friends{display:flex;align-items:center;margin-top:8px;font-size:13.5px;color:var(--tsoft,var(--fv-smoke))}.fv-friends i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--c);border:2px solid var(--fv-ink);font:700 12px Fredoka,system-ui;font-style:normal;color:#1F1A17;margin-right:-7px}.fv-friends span{margin-left:14px}
.fv-hostc{flex:none;width:132px;display:grid;justify-items:center;gap:4px;text-align:center;background:#fff;border:2px solid var(--fv-ink);border-radius:18px;padding:12px 8px;box-shadow:3px 3px 0 var(--fv-ink);text-decoration:none;color:var(--fv-ink);transform:rotate(var(--r))}.fv-hostc b{font:600 14.5px/1.2 Fredoka,system-ui}.fv-hostc small{color:var(--fv-smoke);font-size:12px}
.fv-slot[hidden]{display:none}
.fv-artfb{display:grid;place-items:center;height:100%;font-size:48px;background:#FDE6A6}
.fv-end{display:flex;align-items:center;justify-content:center;gap:6px;margin:18px 0 8px;font-weight:700}.fv-end a{color:var(--fv-ember-d)}.fv-arrow{width:56px;height:32px}
/* ambient effects: only while on screen, still for reduced motion */
.fv-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;border-radius:inherit}.fv-fx i{position:absolute;left:var(--x);top:-12px;width:var(--sz);height:var(--sz);animation:fv-fall var(--d) linear var(--dl) infinite;animation-play-state:paused}
.fv-live .fv-fx i{animation-play-state:running}
.fv-fx-snow i{border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(31,26,23,.08)}.fv-fx-petals i{border-radius:60% 0 60% 0;background:#F6B7C4;opacity:.85}.fv-fx-confetti i{width:calc(var(--sz) * .6);background:var(--fv-ember)}.fv-fx-confetti i:nth-child(3n){background:var(--fv-butter)}.fv-fx-confetti i:nth-child(3n+1){background:#A9D5F8}
.fv-fx-sparkles i{top:var(--y);background:none;animation-name:fv-tw}.fv-fx-sparkles i::before{content:"✦";font-size:var(--sz);color:var(--tacc,#F2D48F)}
@keyframes fv-fall{from{transform:translate(0,0) rotate(0)}to{transform:translate(18px,640px) rotate(240deg)}}@keyframes fv-tw{0%,100%{opacity:.15;transform:scale(.6)}50%{opacity:1;transform:scale(1.1)}}
.fv-lights .bulb{animation:fv-glow 3s ease-in-out infinite;animation-play-state:paused}.fv-live .fv-lights .bulb{animation-play-state:running}.fv-lights .bulb:nth-child(odd){animation-delay:-1.4s}@keyframes fv-glow{0%,100%{opacity:.5}50%{opacity:1}}
.fv-confetti{position:fixed;z-index:2147483001;pointer-events:none;width:0;height:0}.fv-confetti i{position:absolute;width:9px;height:13px;background:var(--c);border-radius:2px;animation:fv-boom .85s cubic-bezier(.2,.8,.4,1) forwards}@keyframes fv-boom{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--dx),calc(var(--dy) + 90px)) rotate(var(--rot));opacity:0}}
/* the story viewer */
.fv-sv{position:fixed;inset:0;z-index:2147483000;background:#15110E;color:#fff;display:flex;justify-content:center;outline:none}
.fv-sv-in{position:relative;width:min(100%,calc(100dvh * .5625 + 40px));height:100%;display:flex;flex-direction:column;transform:translateY(var(--drag,0));transition:transform .2s}.fv-sv.dragging .fv-sv-in{transition:none;opacity:calc(1 - var(--drag,0px) / 400px)}
.fv-sv-bars{display:flex;gap:4px;padding:calc(10px + env(safe-area-inset-top)) 10px 0;position:relative;z-index:3}.fv-sv-bars i{flex:1;height:3px;border-radius:3px;background:rgba(255,255,255,.35);overflow:hidden}.fv-sv-bars b{display:block;height:100%;background:#fff;transform-origin:left;transform:scaleX(0)}
.fv-sv-top{position:relative;z-index:3;display:flex;align-items:center;gap:10px;padding:10px 10px 8px 14px}.fv-sv-top>div{flex:1;min-width:0}.fv-sv-top b{display:block;font:600 16px Fredoka,system-ui}.fv-sv-top small{display:block;opacity:.85;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fv-sv-top button{flex:none;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:16px;cursor:pointer}.fv-sv-top button:focus-visible,.fv-sv-foot a:focus-visible,.fv-sv-foot button:focus-visible,.fv-sv-prev:focus-visible,.fv-sv-next:focus-visible{outline:3px solid var(--fv-butter);outline-offset:2px}
.fv-sv-stage{position:absolute;inset:0;display:grid;place-items:center;touch-action:none;user-select:none;-webkit-user-select:none}.fv-sv-stage img,.fv-sv-stage video{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;pointer-events:none}
.fv-sv-art{position:absolute;inset:0;display:grid;place-items:center;background:var(--tint)}.fv-sv-artc{position:relative;width:min(88%,420px);aspect-ratio:4/5;border:3px solid #1F1A17;border-radius:18px;overflow:hidden;box-shadow:5px 6px 0 #1F1A17;transform:rotate(-2deg)}
.fv-sv-prev,.fv-sv-next{position:absolute;top:50%;z-index:3;width:44px;height:44px;margin-top:-22px;border-radius:50%;border:0;background:rgba(0,0,0,.35);color:#fff;font-size:28px;line-height:1;cursor:pointer;opacity:0}.fv-sv-prev{left:6px}.fv-sv-next{right:6px}.fv-sv-prev:focus-visible,.fv-sv-next:focus-visible{opacity:1}
@media (hover:hover){.fv-sv-in:hover .fv-sv-prev,.fv-sv-in:hover .fv-sv-next{opacity:.8}}
.fv-sv-foot{position:relative;z-index:3;margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 16px calc(18px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.65))}
.fv-sv-note{margin:0;font:600 26px/1.15 Caveat,cursive;text-align:center;text-shadow:0 1px 6px rgba(0,0,0,.6)}
.fv-sv-cta{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 22px;border-radius:999px;background:#fff;color:#1F1A17;font:700 16px "Instrument Sans",system-ui;text-decoration:none;border:2px solid #1F1A17;box-shadow:3px 3px 0 var(--fv-ember)}
.fv-sv-unmute{min-height:40px;border-radius:999px;border:1.5px solid rgba(255,255,255,.6);background:rgba(0,0,0,.35);color:#fff;padding:0 14px;font:600 14px "Instrument Sans",system-ui;cursor:pointer}
.fv-sv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.fv-sv.paused .fv-sv-bars{opacity:.6}
@media (min-width:700px){.fv-flyer{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:20px;align-items:end}.fv-flyer>.fv-by{grid-column:1/-1;margin:0}.fv-flyer .fv-fl-b{padding:0 6px 6px}.fv-flyer .fv-title{font-size:34px}.fv-wall{gap:34px}.fv-card{padding:18px}.fv-flyer{padding:16px 16px 20px}.fv-mini{width:178px}.fv-pols>.fv-pol{width:min(46%,250px)}}
@media (max-width:420px){.fv-artpair{gap:14px 10px}.fv-art-b{padding:6px 8px 8px}.fv-hero>div{padding-right:0}.fv-hero-p{width:72px;right:2px;bottom:-10px;opacity:.95}.fv-hero-p svg{width:72px}.fv-hero h1{padding-right:56px}}
@media (prefers-reduced-motion:reduce){.fv-fx i,.fv-lights .bulb,.fv-peek-p svg,.fv-ring.just-seen .fv-ring-c,.fv-react.pop span{animation:none!important}.fv-fx i{top:var(--y)!important}.fv-pol,.fv-art,.fv-mini,.fv-ring-c,.fv-sv-in{transition:none!important}.fv-pol:hover,.fv-art:hover,.fv-mini:hover{transform:rotate(var(--r,0deg))}}
`;
  /** "?interests=…&city=…" from what this visitor picked (pl.interests), for /api/public/feed, or "". */
  function publicQuery() { let v = null; try { v = JSON.parse(localStorage.getItem("pl.interests") || "null"); } catch {} if (!v || typeof v !== "object") return "";
    const I = (Array.isArray(v.interests) ? v.interests : []).filter((x) => /^[a-z0-9-]{1,30}$/.test(x)).slice(0, 20), c = String(v.city || "").trim().slice(0, 60), q = new URLSearchParams();
    if (I.length) q.set("interests", I.join(",")); if (c) q.set("city", c); const s = q.toString(); return s ? "?" + s : ""; }
  window.FeedVisual = { rail, openStories, composePublic, composeSignedIn, wire, flyer, dump, note, mini, avatar, css, REG, deviceId, publicQuery };
})();
// ---- end visual feed ----
