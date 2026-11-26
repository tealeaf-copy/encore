// The "Change photo" sheet: one sheet for an event's cover, a page's cover and a profile picture (server/photos.js).
// Upload a photo, Your recent uploads, Templates, Remove photo. A photo opens in a frame the shape it will show in
// (16:9 for an event, 3:1 for a page cover, a circle on a square for a profile picture); drag it (or use the arrow keys)
// to choose what stays in view. Use photo uploads the original once, then a crop made here around that point, so every
// card, invite, story ring, chat header and share preview shows the same framing. The original and the point are kept,
// so the next drag starts where this one ended.
//
//   PhotoSheet.open({ for: "cover" | "page" | "avatar", current: { url, source, focus }, eventId, templates, onChange })
//     onChange({ url, source, focus } | { template } | { removed: true }) saves it the caller's way; without onChange the
//     sheet saves through POST /api/photos/use. Resolves with what was chosen, or null when closed.
//   templates: optional [{ id, label, html }] the caller draws (the event's own illustrated covers); otherwise the
//     sheet asks /api/public/photos/templates and draws them with EventArt, EncoreAvatars or a colour wash.
(function () {
  if (window.PhotoSheet) return;
  const KINDS = {
    cover: { title: "Event cover", aspect: 16 / 9, out: [1600, 900], max: 10, note: "Wide photos work best. Guests see it on the invite, the feed and when you share the link." },
    page: { title: "Page cover", aspect: 3, out: [1800, 600], max: 10, note: "Sits across the top of your page." },
    avatar: { title: "Profile picture", aspect: 1, out: [800, 800], max: 5, round: true, note: "Shows next to your name on your page, in chats and on the feed." },
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const OK_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const ICON = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const UP = ICON('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'), X = ICON('<path d="M6 6l12 12M18 6 6 18"/>'), MOVE = ICON('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>');

  function css() { if (document.getElementById("phsCss")) return; const s = document.createElement("style"); s.id = "phsCss"; s.textContent = `
.phs-bg{position:fixed;inset:0;z-index:9500;background:rgba(31,26,23,.4);display:flex;align-items:flex-end;justify-content:center}
.phs{width:min(560px,100%);max-height:92dvh;overflow:auto;overscroll-behavior:contain;background:#FFFCF7;color:#1F1A17;border:1.5px solid #5A3B2B;border-bottom:0;border-radius:24px 24px 0 0;box-shadow:0 18px 48px -18px rgba(31,26,23,.45);padding:8px 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;font:16px/1.45 "Instrument Sans",system-ui,-apple-system,sans-serif}
@media (min-width:700px){.phs-bg{align-items:center}.phs{border-radius:24px;border-bottom:1.5px solid #5A3B2B}}
.phs-g{width:40px;height:4px;border-radius:2px;background:#E0D5C6;margin:4px auto 8px}
.phs-hd{display:flex;align-items:center;gap:8px;margin:0 0 12px}.phs-hd h2{flex:1;margin:0;font:600 20px/1.2 Fredoka,"Instrument Sans",system-ui,sans-serif}
.phs-x{all:unset;display:grid;place-items:center;width:44px;height:44px;border-radius:999px;color:#5A3B2B;cursor:pointer}.phs-x:focus-visible,.phs button:focus-visible,.phs label:focus-within{outline:3px solid #1F1A17;outline-offset:2px}
.phs-now{position:relative;margin:0 0 16px;border-radius:16px;overflow:hidden;background:#EFE6D8;border:1.5px solid #E4D9C8}
.phs-now img{display:block;width:100%;height:100%;object-fit:cover}.phs-now.round{width:132px;margin-left:auto;margin-right:auto;border-radius:50%}
.phs-now .phs-empty{display:grid;place-items:center;height:100%;color:#665A51;font-size:14px;text-align:center;padding:8px}
.phs-up{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;border-radius:999px;background:#C94A30;color:#fff;font:600 16px Fredoka,"Instrument Sans",system-ui,sans-serif;cursor:pointer;margin:0 0 4px}
.phs-up input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.phs-note{margin:4px 0 16px;color:#665A51;font-size:13px;text-align:center}
.phs h3{font:600 14px/1.3 "Instrument Sans",system-ui,sans-serif;margin:16px 0 8px;color:#1F1A17}
.phs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}.phs-grid.sq{grid-template-columns:repeat(auto-fill,minmax(72px,1fr))}
.phs-t{all:unset;box-sizing:border-box;position:relative;display:block;border-radius:12px;overflow:hidden;background:#EFE6D8;border:1.5px solid #E4D9C8;cursor:pointer}
.phs-t img,.phs-t svg{display:block;width:100%;height:100%;object-fit:cover}.phs-t[aria-pressed=true]{border-color:#1F1A17;box-shadow:0 0 0 2px #1F1A17}
.phs-t .phs-l{position:absolute;left:0;right:0;bottom:0;padding:2px 6px;background:rgba(255,252,247,.88);font-size:13px;color:#1F1A17;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phs-quiet{color:#665A51;font-size:13px;margin:0}
.phs-rm{all:unset;display:block;width:100%;text-align:center;min-height:44px;line-height:44px;margin-top:16px;color:#B04A30;font-weight:600;cursor:pointer;border-radius:999px}
.phs-frame{position:relative;margin:0 auto 8px;border-radius:16px;overflow:hidden;background:#1F1A17;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.phs-frame:active{cursor:grabbing}.phs-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;-webkit-user-drag:none}
.phs-frame.round::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px rgba(31,26,23,.55);pointer-events:none}
.phs-frame:focus-visible{outline:3px solid #C94A30;outline-offset:3px}
.phs-hint{display:flex;align-items:center;justify-content:center;gap:6px;color:#665A51;font-size:13px;margin:0 0 16px}
.phs-row{display:flex;gap:8px}.phs-row button{flex:1;min-height:52px;border-radius:999px;font:600 16px Fredoka,"Instrument Sans",system-ui,sans-serif;cursor:pointer}
.phs-go{background:#C94A30;color:#fff;border:1px solid #C94A30}.phs-go:disabled{opacity:.6}.phs-back{background:#fff;color:#1F1A17;border:1.5px solid #D9CCBB}
.phs-msg{min-height:20px;margin:8px 0 0;font-size:13px;color:#B04A30;text-align:center}
.phs-busy{color:#665A51}
`; document.head.appendChild(s); }

  // read a picked file into an <img>, checking type and size here first (the server checks again)
  function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error("That photo didn't open. Try another one.")); i.src = src; }); }
  // a canvas of the image, cover-fitted into w×h around the focal point (the same maths as CSS object-position)
  function drawCrop(img, w, h, f) { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"), iw = img.naturalWidth, ih = img.naturalHeight, s = Math.max(w / iw, h / ih), dw = iw * s, dh = ih * s;
    g.imageSmoothingQuality = "high"; g.drawImage(img, -(dw - w) * (f.x / 100), -(dh - h) * (f.y / 100), dw, dh); return c; }
  const toBlob = (c, type = "image/jpeg", q = 0.88) => new Promise((r) => c.toBlob(r, type, q));
  async function post(url, body, type) { const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": type || "application/json" }, body: type ? body : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't save. Try again."); return j; }
  // a big phone photo is made smaller before it goes up (longest side 2400px), so it's quick and inside the limit
  async function shrink(file, img, maxMb) { const long = Math.max(img.naturalWidth, img.naturalHeight); if (long <= 2400 && file.size <= maxMb * 1048576 * 0.9) return file;
    const k = Math.min(1, 2400 / long), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return toBlob(c, "image/jpeg", 0.86); }

  function templateHtml(t, kind) {
    if (t.html) return t.html;
    if (t.kind === "portrait" && window.EncoreAvatars) return window.EncoreAvatars.svg(t.id, "#C94A30", 96);
    if (t.kind === "art" && window.EventArt) return window.EventArt.cover({ title: t.label }, { kind: t.id, title: t.label, label: "", exact: true });
    if (t.kind === "wash") return `<span style="display:block;width:100%;height:100%;background:${esc(t.color)}"></span>`;
    return `<span class="phs-l">${esc(t.label)}</span>`;
  }

  function open(opts = {}) {
    const kind = KINDS[opts.for] ? opts.for : "cover", K = KINDS[kind], cur = { url: "", source: "", focus: null, ...(opts.current || {}) };
    css(); document.getElementById("phsSheet")?.remove();
    return new Promise((resolve) => {
      const bg = document.createElement("div"); bg.className = "phs-bg"; bg.id = "phsSheet";
      const back = document.activeElement; let done = false;
      const close = (v = null) => { if (done) return; done = true; bg.remove(); document.removeEventListener("keydown", onKey); try { back?.focus?.({ preventScroll: true }); } catch {} resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") close(); };
      document.addEventListener("keydown", onKey); bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
      bg.innerHTML = `<div class="phs" role="dialog" aria-modal="true" aria-labelledby="phsH"><div class="phs-g" aria-hidden="true"></div><div class="phs-hd"><h2 id="phsH">${esc(opts.title || K.title)}</h2><button type="button" class="phs-x" aria-label="Close">${X}</button></div><div class="phs-body"></div></div>`;
      document.body.appendChild(bg); bg.querySelector(".phs-x").onclick = () => close();
      const body = bg.querySelector(".phs-body");
      const save = async (choice) => { if (opts.onChange) { await opts.onChange(choice); return choice; } const r = await post("/api/photos/use", { for: kind, eventId: opts.eventId || "", ...choice, ...(choice.removed ? { url: "" } : {}) }); return { ...choice, saved: r }; };

      // ---- the first screen: what's there now, Upload, recent uploads, templates, remove ----
      function home(msg = "") {
        const has = !!cur.url;
        body.innerHTML = `<div class="phs-now${K.round ? " round" : ""}" style="aspect-ratio:${K.aspect}">${has ? `<img src="${esc(cur.url)}" alt="Your ${esc(K.title.toLowerCase())} now">` : `<span class="phs-empty">${K.round ? "No photo yet" : "No photo yet. Pick one below."}</span>`}</div>
          <label class="phs-up">${UP}<span>Upload a photo</span><input type="file" accept="image/png,image/jpeg,image/webp"></label><p class="phs-note">${esc(K.note)} PNG, JPEG or WebP, up to ${K.max} MB.</p>
          ${has && cur.source ? `<button type="button" class="btn ghost sm phs-redo" style="display:flex;margin:0 auto 8px">Reposition</button>` : ""}
          <h3>Your recent uploads</h3><div class="phs-grid${K.round ? " sq" : ""}" data-recent><p class="phs-quiet">Looking…</p></div>
          <h3>Templates</h3><div class="phs-grid${K.round ? " sq" : ""}" data-tpl><p class="phs-quiet">Loading…</p></div>
          ${has ? `<button type="button" class="phs-rm">Remove photo</button>` : ""}<p class="phs-msg" role="status" aria-live="polite">${esc(msg)}</p>`;
        const say = (m) => { body.querySelector(".phs-msg").textContent = m; };
        body.querySelector("input[type=file]").onchange = async (e) => { const f = e.target.files?.[0]; if (!f) return;
          if (!OK_TYPES.includes(f.type)) return say("Pick a PNG, JPEG or WebP photo.");
          if (f.size > 25 * 1048576) return say(`That photo is very big. Pick one under ${K.max} MB.`);
          const u = URL.createObjectURL(f); try { const img = await loadImage(u); if (img.naturalWidth < 64 || img.naturalHeight < 64) { say("That photo is very small. Pick a bigger one."); return; } frame({ img, file: f, local: u, focus: { x: 50, y: 50 } }); } catch (err) { say(err.message); } };
        body.querySelector(".phs-redo")?.addEventListener("click", async () => { try { frame({ img: await loadImage(cur.source), source: cur.source, focus: cur.focus || { x: 50, y: 50 } }); } catch (err) { say(err.message); } });
        body.querySelector(".phs-rm")?.addEventListener("click", async (e) => { e.target.disabled = true; try { const r = await save({ removed: true }); close(r); } catch (err) { say(err.message); e.target.disabled = false; } });
        // recent uploads
        fetch("/api/photos/recent", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : { photos: [] })).then((j) => { const box = body.querySelector("[data-recent]"); if (!box) return; const L = (j.photos || []).slice(0, 12);
          box.innerHTML = L.length ? L.map((p, i) => `<button type="button" class="phs-t" style="aspect-ratio:${K.round ? 1 : 4 / 3}" data-i="${i}" aria-pressed="${p.url === cur.source}" aria-label="Use this upload"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join("") : `<p class="phs-quiet">Photos you upload show here, so you can use one again.</p>`;
          box.querySelectorAll("[data-i]").forEach((b) => (b.onclick = async () => { const p = L[+b.dataset.i]; try { frame({ img: await loadImage(p.url), source: p.url, focus: p.url === cur.source && cur.focus ? cur.focus : { x: 50, y: 50 } }); } catch (err) { say(err.message); } })); }).catch(() => {});
        // templates
        const showT = (T) => { const box = body.querySelector("[data-tpl]"); if (!box) return; if (!T.length) { box.previousElementSibling.remove(); box.remove(); return; }
          box.innerHTML = T.map((t, i) => `<button type="button" class="phs-t" style="aspect-ratio:${K.round ? 1 : 16 / 10}" data-t="${i}" aria-pressed="${!!t.on}" aria-label="${esc(t.label)}">${templateHtml(t, kind)}</button>`).join("");
          box.querySelectorAll("[data-t]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await save({ template: T[+b.dataset.t].id }); close(r); } catch (err) { say(err.message); b.disabled = false; } })); };
        if (Array.isArray(opts.templates)) showT(opts.templates);
        else fetch("/api/public/photos/templates?kind=" + kind).then((r) => r.json()).then((j) => showT((j.templates || []).filter((t) => (t.kind === "portrait" ? window.EncoreAvatars : t.kind === "art" ? window.EventArt : true)).map((t) => ({ ...t, on: t.id === opts.currentTemplate })))).catch(() => showT([]));
        setTimeout(() => body.querySelector(".phs-up input")?.closest("label")?.focus?.(), 30);
      }

      // ---- the frame: drag to choose what stays in view, then Use photo ----
      function frame(P) {
        let f = { ...P.focus };
        body.innerHTML = `<div class="phs-frame${K.round ? " round" : ""}" tabindex="0" role="slider" aria-label="Photo position. Drag, or use the arrow keys." aria-valuetext="" style="aspect-ratio:${K.aspect};max-width:${K.round ? "320px" : "100%"}"><img alt="" src="${esc(P.local || P.source)}"></div>
          <p class="phs-hint">${MOVE}<span>Drag to move it. What's inside the ${K.round ? "circle" : "frame"} is what people see.</span></p>
          <div class="phs-row"><button type="button" class="phs-back">Back</button><button type="button" class="phs-go">Use photo</button></div><p class="phs-msg" role="status" aria-live="polite"></p>`;
        const fr = body.querySelector(".phs-frame"), im = fr.querySelector("img"), say = (m, busy) => { const el = body.querySelector(".phs-msg"); el.textContent = m; el.classList.toggle("phs-busy", !!busy); };
        const paint = () => { im.style.objectPosition = `${f.x}% ${f.y}%`; fr.setAttribute("aria-valuetext", `${f.x}% across, ${f.y}% down`); }; paint();
        // how far the photo overflows the frame, in frame pixels; dragging by that much moves the point by 100%
        const over = () => { const r = fr.getBoundingClientRect(), iw = P.img.naturalWidth, ih = P.img.naturalHeight, s = Math.max(r.width / iw, r.height / ih); return { x: iw * s - r.width, y: ih * s - r.height }; };
        let drag = null;
        fr.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, f: { ...f }, o: over() }; fr.setPointerCapture(e.pointerId); e.preventDefault(); });
        fr.addEventListener("pointermove", (e) => { if (!drag) return; const o = drag.o; f = { x: o.x > 1 ? clamp(drag.f.x - ((e.clientX - drag.x) / o.x) * 100) : 50, y: o.y > 1 ? clamp(drag.f.y - ((e.clientY - drag.y) / o.y) * 100) : 50 }; paint(); });
        const end = () => { drag = null; }; fr.addEventListener("pointerup", end); fr.addEventListener("pointercancel", end);
        fr.addEventListener("keydown", (e) => { const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[e.key]; if (!d) return; e.preventDefault(); f = { x: clamp(f.x + d[0]), y: clamp(f.y + d[1]) }; paint(); });
        body.querySelector(".phs-back").onclick = () => { if (P.local) URL.revokeObjectURL(P.local); home(); };
        body.querySelector(".phs-go").onclick = async (e) => { const btn = e.target; btn.disabled = true; btn.textContent = "Saving…";
          try {
            let source = P.source;
            if (!source) { say("Uploading…", true); const blob = await shrink(P.file, P.img, K.max); source = (await post("/api/photos?for=" + kind, blob, blob.type || "image/jpeg")).url; }
            const crop = await toBlob(drawCrop(P.img, K.out[0], K.out[1], f)); say("Almost there…", true);
            const url = (await post(`/api/photos?for=${kind}&crop=1&source=${encodeURIComponent(source)}&fx=${f.x}&fy=${f.y}`, crop, "image/jpeg")).url;
            if (P.local) URL.revokeObjectURL(P.local);
            const r = await save({ url, source, focus: f }); Object.assign(cur, { url, source, focus: f }); close(r);
          } catch (err) { say(err.message); btn.disabled = false; btn.textContent = "Use photo"; } };
        setTimeout(() => fr.focus({ preventScroll: true }), 30);
      }
      home();
    });
  }
  window.PhotoSheet = { open, KINDS };
})();
