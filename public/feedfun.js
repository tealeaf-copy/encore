// ---- the fun parts of feed comments: emoji, GIFs and our stickers, quick reactions ----
// Loaded by the feed (public/feedvisual.js, on first draw) and the post page (public/post.html). No library, no CDN.
// - Emoji: the smile button next to a comment box opens a small picker (about 90 common emoji in a few groups, and a
//   Recent row kept on this device in localStorage "pl.emojiRecent"). Typed emoji keep working.
// - GIF: the GIF button searches GIPHY or Tenor through our server (server/gifs.js) when a key is set, with the
//   provider's attribution; with no key it opens our own 16 line-art stickers (drawn below, gently animated).
//   Picking one sends it at once, with whatever words are in the box (a "pl:attach" event on the form).
// - Reactions: "React" next to a comment (or a long press on a phone) opens six quick reactions; one per person per
//   comment, the same again takes it back. Chips under the comment show the counts. Server: POST
//   /api/feed/comments/:id/react. Renderers listen for "pl:rx" ({ target, id, reactions, pop }).
// Motion is small and stops for prefers-reduced-motion.
(function () {
  if (window.PLFun) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EMOJI = [
    ["Smiles", "😀 😄 😁 😆 😂 🤣 😊 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 😌 🤗 🤔 😮 😲 🥹 😅 😬 🙃 😴 😢 😭 😤 🫠"],
    ["Hands and hearts", "👍 👏 🙌 🙏 👋 🤝 💪 ✌️ 🤞 👌 ❤️ 🧡 💛 💚 💙 💜 🤍 💕 💖 ✨"],
    ["Food and drink", "🍕 🍜 🥟 🍣 🌮 🥐 🍞 🧁 🎂 🍪 🍩 🍓 🍷 🥂 🍻 ☕ 🍵 🧋"],
    ["Fun and outdoors", "🎉 🎊 🎈 🎲 ♟️ 🎮 🎨 🎶 🎤 📚 🏃 🚴 🥾 ⛰️ 🌊 ☀️ 🌙 ⭐ 🔥 🌸 🌿 🐶 🐱 🏆"],
  ].map(([name, s]) => [name, s.split(" ")]);
  // our own stickers, in the kit's line art: ink lines, the blue, paper and one warm yellow
  const INK = "#1B1D1C", BLUE = "#29489A", PALE = "#C9D3EE", PAPER = "#FAF8F3", SUN = "#F3E7A8";
  const L = `fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
  const word = (t, size = 11) => `<rect x="5" y="20" width="54" height="24" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="2.2"/><text x="32" y="${36 + (11 - size) / 3}" text-anchor="middle" font-family="IBM Plex Sans,system-ui,sans-serif" font-weight="600" font-size="${size}" fill="${BLUE}" textLength="46" lengthAdjust="spacingAndGlyphs">${t}</text>`;
  const ART = {
    cheers: ["Cheers", `<g class="fx-tl"><path d="M14 14h14l-2 16a5 5 0 0 1-10 0z" fill="${SUN}" ${L}/><path d="M21 35v13M15 48h12" ${L}/></g><g class="fx-tr"><path d="M36 14h14l-2 16a5 5 0 0 1-10 0z" fill="${PALE}" ${L}/><path d="M43 35v13M37 48h12" ${L}/></g><path class="fx-tw" d="M32 6v4M26 8l2 3M38 8l-2 3" ${L}/>`],
    bowl: ["Steaming bowl", `<path class="fx-up" d="M24 20c-3-4 3-6 0-10M32 20c-3-4 3-6 0-10M40 20c-3-4 3-6 0-10" ${L}/><path d="M10 30h44a22 18 0 0 1-44 0z" fill="${PALE}" ${L}/><path d="M24 48h16" ${L}/><path d="M44 24l10-12" ${L}/>`],
    potto: ["Potto dancing", `<g class="fx-bob"><path d="M22 14h20l-3 6c8 4 11 11 9 19-2 10-10 13-16 13s-14-3-16-13c-2-8 1-15 9-19z" fill="${PAPER}" ${L}/><circle cx="27" cy="34" r="1.8" fill="${INK}"/><circle cx="37" cy="34" r="1.8" fill="${INK}"/><path d="M28 40q4 3 8 0" ${L}/><path d="M16 32l-7-5M48 32l7-5" ${L}/></g><path d="M18 58h28" ${L}/>`],
    confetti: ["Confetti", `<path d="M12 54L26 22l16 16z" fill="${SUN}" ${L}/><g class="fx-tw"><rect x="40" y="10" width="5" height="5" fill="${BLUE}" transform="rotate(20 42 12)"/><rect x="50" y="24" width="5" height="5" fill="${PALE}" stroke="${INK}" stroke-width="1.4"/><circle cx="32" cy="12" r="2.6" fill="${BLUE}"/><path d="M46 38l6 2M38 4l1 5" ${L}/></g>`],
    shoe: ["Running shoe", `<g class="fx-hop"><path d="M10 40c0-8 4-14 8-16l6 6 8-2 6 8c6 0 14 2 16 6v4H10z" fill="${PALE}" ${L}/><path d="M10 46h44" ${L}/><path d="M26 34l3-2M30 37l3-2" ${L}/></g><path class="fx-tw" d="M4 30h6M2 36h6M6 24h5" ${L}/>`],
    heart: ["Heart", `<path class="fx-beat" d="M32 52S10 39 10 24a10 10 0 0 1 22-5 10 10 0 0 1 22 5c0 15-22 28-22 28z" fill="${BLUE}" ${L}/><path d="M20 22a5 5 0 0 1 5-4" stroke="${PAPER}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`],
    clap: ["Applause", `<g class="fx-tl"><path d="M20 50c-6-6-8-14-4-20l6-10a3 3 0 0 1 5 3l-3 7 10-14a3 3 0 0 1 5 3l-4 7" fill="${SUN}" ${L}/></g><g class="fx-tr"><path d="M44 50c6-6 8-14 4-20l-6-10a3 3 0 0 0-5 3l3 7-10-14a3 3 0 0 0-5 3l4 7" fill="${PAPER}" ${L}/></g><path class="fx-tw" d="M32 8v5M24 10l2 4M40 10l-2 4" ${L}/>`],
    "see-you": ["See you there", `<g class="fx-wob">${word("see you there", 10)}</g>`],
    "so-good": ["So good", `<g class="fx-wob">${word("so good!", 13)}</g>`],
    "count-me-in": ["Count me in", `<g class="fx-wob">${word("count me in", 10.5)}</g>`],
    dice: ["Dice", `<g class="fx-spin"><rect x="14" y="16" width="24" height="24" rx="5" fill="${PAPER}" ${L}/><circle cx="21" cy="23" r="2" fill="${INK}"/><circle cx="31" cy="33" r="2" fill="${INK}"/></g><rect x="32" y="30" width="20" height="20" rx="4" fill="${BLUE}" ${L} transform="rotate(12 42 40)"/><circle cx="42" cy="40" r="2" fill="${PAPER}"/>`],
    coffee: ["Coffee", `<path class="fx-up" d="M26 18c-3-4 3-6 0-10M34 18c-3-4 3-6 0-10" ${L}/><path d="M14 24h30v14a12 12 0 0 1-12 12h-6a12 12 0 0 1-12-12z" fill="${PALE}" ${L}/><path d="M44 28h4a6 6 0 0 1 0 12h-5" ${L}/><path d="M12 54h36" ${L}/>`],
    sun: ["Sunny", `<g class="fx-spin" style="transform-origin:32px 32px"><path d="M32 4v8M32 52v8M4 32h8M52 32h8M12 12l6 6M46 46l6 6M12 52l6-6M46 18l6-6" ${L}/></g><circle cx="32" cy="32" r="12" fill="${SUN}" ${L}/>`],
    star: ["Star", `<path class="fx-beat" d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z" fill="${SUN}" ${L}/>`],
    wave: ["Wave", `<g class="fx-wave"><path d="M22 54c-6-4-10-12-8-20l4-14a3 3 0 0 1 6 1l-2 9 4-18a3 3 0 0 1 6 1l-3 14 4-16a3 3 0 0 1 6 1l-4 16 5-12a3 3 0 0 1 5 2l-6 18c-2 8-8 14-17 18z" fill="${PAPER}" ${L}/></g><path class="fx-tw" d="M48 8l4-3M52 16l5-1" ${L}/>`],
    cake: ["Cake", `<path class="fx-flick" d="M32 6c3 4 3 7 0 9-3-2-3-5 0-9z" fill="${SUN}" ${L}/><path d="M32 15v7" ${L}/><path d="M12 34a20 6 0 0 1 40 0v16H12z" fill="${PALE}" ${L}/><path d="M12 40c5 4 9 4 13 0s9-4 14 0 9 4 13 0" ${L}/><path d="M8 54h48" ${L}/>`],
  };
  const stickerSvg = (id) => (ART[id] ? `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${ART[id][1]}</svg>` : "");
  const stickerName = (id) => ART[id]?.[0] || "Sticker";

  let cssOn = false;
  function css() { if (cssOn) return; cssOn = true; const s = document.createElement("style"); s.id = "fxCss"; s.textContent = `
.fx-pop{position:absolute;left:0;right:0;bottom:calc(100% + 6px);z-index:40;max-width:360px;box-sizing:border-box;padding:8px;border:1px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);box-shadow:0 14px 32px -18px rgba(27,29,28,.45);color:var(--pl-ink,#1B1D1C);font:14px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.fx-pop.below{bottom:auto;top:calc(100% + 6px)}
.fx-pop h3{margin:6px 4px 2px;font:600 12px/1.3 var(--sys-mono,ui-monospace,monospace);letter-spacing:.03em;text-transform:uppercase;color:var(--pl-soft,#444845)}
.fx-scroll{max-height:216px;overflow-y:auto;overscroll-behavior:contain}
.fx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr))}
.fx-e{display:grid;place-items:center;height:40px;border:0;border-radius:var(--pl-r-btn,6px);background:none;font-size:22px;cursor:pointer}.fx-e:hover,.fx-e:focus-visible{background:var(--pl-raised,#E6E1D5)}
.fx-q{display:flex;gap:6px;margin:0 0 8px}.fx-q input{flex:1;min-width:0;min-height:44px;box-sizing:border-box;padding:0 10px;border:1px solid var(--pl-line,#CFC8B9);border-radius:var(--pl-r-md,6px);background:#fff;font:16px var(--pl-font-text,"IBM Plex Sans",system-ui)}
.fx-gifs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.fx-g{position:relative;display:block;padding:0;border:0;border-radius:var(--pl-r-sm,6px);overflow:hidden;background:var(--pl-raised,#E6E1D5);aspect-ratio:1;cursor:pointer}.fx-g img{width:100%;height:100%;object-fit:cover;display:block}
.fx-stks{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.fx-s{display:grid;place-items:center;aspect-ratio:1;padding:4px;border:0;border-radius:var(--pl-r-sm,6px);background:none;cursor:pointer}.fx-s:hover,.fx-s:focus-visible{background:var(--pl-raised,#E6E1D5)}.fx-s svg{width:100%;height:100%}
.fx-via{margin:6px 2px 0;font:400 11px/1.3 var(--sys-mono,ui-monospace,monospace);color:var(--pl-soft,#444845)}.fx-msg{margin:12px 4px;color:var(--pl-soft,#444845)}
.fx-bar{position:absolute;z-index:45;display:flex;gap:2px;padding:4px;border:1px solid var(--pl-line-strong,#1B1D1C);border-radius:999px;background:var(--pl-surface,#FAF8F3);box-shadow:0 10px 24px -14px rgba(27,29,28,.5)}
.fx-bar button{display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:50%;background:none;font-size:24px;cursor:pointer;transition:transform .12s}.fx-bar button:hover,.fx-bar button:focus-visible{background:var(--pl-raised,#E6E1D5);transform:translateY(-2px)}.fx-bar button[aria-pressed=true]{background:color-mix(in srgb,var(--pl-accent,#29489A) 14%,transparent)}
.fx-bar.in{animation:fx-in .16s ease-out}@keyframes fx-in{from{opacity:0;transform:translateY(4px) scale(.96)}to{opacity:1;transform:none}}
.fx-pop :focus-visible,.fx-bar :focus-visible{outline:3px solid var(--pl-ink,#1B1D1C);outline-offset:1px}
.fx-sv svg{overflow:visible}
.fx-sv .fx-tl{transform-origin:22px 48px;animation:fx-tl 2.4s ease-in-out infinite}.fx-sv .fx-tr{transform-origin:42px 48px;animation:fx-tr 2.4s ease-in-out infinite}
@keyframes fx-tl{0%,60%,100%{transform:none}75%{transform:rotate(9deg)}}@keyframes fx-tr{0%,60%,100%{transform:none}75%{transform:rotate(-9deg)}}
.fx-sv .fx-up{animation:fx-up 2.6s ease-in-out infinite}@keyframes fx-up{0%{transform:translateY(3px);opacity:.25}50%{opacity:1}100%{transform:translateY(-3px);opacity:.25}}
.fx-sv .fx-bob{transform-origin:32px 56px;animation:fx-bob 1.8s ease-in-out infinite}@keyframes fx-bob{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg) translateY(-2px)}}
.fx-sv .fx-tw{animation:fx-tw 2s ease-in-out infinite}@keyframes fx-tw{0%,100%{opacity:1}50%{opacity:.25}}
.fx-sv .fx-hop{animation:fx-hop 1.4s ease-in-out infinite}@keyframes fx-hop{0%,100%{transform:none}40%{transform:translate(2px,-5px) rotate(-4deg)}}
.fx-sv .fx-beat{transform-origin:32px 32px;animation:fx-beat 1.6s ease-in-out infinite}@keyframes fx-beat{0%,40%,100%{transform:none}20%{transform:scale(1.1)}}
.fx-sv .fx-wob{transform-origin:32px 32px;animation:fx-wob 2.8s ease-in-out infinite}@keyframes fx-wob{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
.fx-sv .fx-spin{transform-origin:26px 28px;animation:fx-wob 3s ease-in-out infinite}
.fx-sv .fx-wave{transform-origin:28px 54px;animation:fx-wave 1.6s ease-in-out infinite}@keyframes fx-wave{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}
.fx-sv .fx-flick{transform-origin:32px 15px;animation:fx-flick .9s ease-in-out infinite alternate}@keyframes fx-flick{from{transform:scale(1,1)}to{transform:scale(.85,1.12)}}
@media (prefers-reduced-motion:reduce){.fx-sv *{animation:none!important}.fx-bar.in{animation:none}.fx-bar button{transition:none}}
`; document.head.appendChild(s); }

  // ---------- stickers in comments: a fixed box the page drew first, painted here ----------
  function paint(root = document) { css(); for (const el of root.querySelectorAll("[data-stk]:empty")) { el.innerHTML = stickerSvg(el.dataset.stk); el.classList.add("fx-sv"); } }

  // ---------- the pickers ----------
  let open = null; // { pop, btn, form }
  function close() { if (!open) return; const { pop, btn } = open; open = null; pop.remove(); btn?.setAttribute("aria-expanded", "false"); document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onOut, true); }
  function onKey(e) { if (e.key === "Escape" && open) { e.preventDefault(); const b = open.btn; close(); b?.focus(); } }
  function onOut(e) { if (open && !open.pop.contains(e.target) && !open.btn.contains(e.target)) close(); }
  function place(pop, form) { const r = form.getBoundingClientRect(); if (r.top < 300) pop.classList.add("below"); }
  function show(btn, form, html, label) { close(); css(); const pop = document.createElement("div"); pop.className = "fx-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", label); pop.innerHTML = html;
    if (getComputedStyle(form).position === "static") form.style.position = "relative"; form.appendChild(pop); place(pop, form); open = { pop, btn, form }; btn.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKey, true); document.addEventListener("pointerdown", onOut, true); return pop; }
  const recent = () => { try { const L = JSON.parse(localStorage.getItem("pl.emojiRecent") || "[]"); return Array.isArray(L) ? L.filter((x) => typeof x === "string" && x.length <= 16).slice(0, 16) : []; } catch { return []; } };
  const remember = (e) => { try { localStorage.setItem("pl.emojiRecent", JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 16))); } catch {} };
  function emojiPicker(btn, form) { const R = recent(), grid = (L) => `<div class="fx-grid">${L.map((e) => `<button type="button" class="fx-e" data-fx-e="${esc(e)}" aria-label="${esc(e)}">${esc(e)}</button>`).join("")}</div>`;
    const pop = show(btn, form, `<div class="fx-scroll">${R.length ? `<h3>Recent</h3>${grid(R)}` : ""}${EMOJI.map(([n, L]) => `<h3>${esc(n)}</h3>${grid(L)}`).join("")}</div>`, "Emoji");
    pop.addEventListener("click", (e) => { const b = e.target.closest("[data-fx-e]"); if (!b) return; const ta = form.querySelector("textarea"); if (!ta) return; const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
      ta.value = ta.value.slice(0, s) + b.dataset.fxE + ta.value.slice(en); const at = s + b.dataset.fxE.length; ta.focus({ preventScroll: true }); try { ta.setSelectionRange(at, at); } catch {} ta.dispatchEvent(new Event("input", { bubbles: true })); remember(b.dataset.fxE); });
    pop.querySelector("button")?.focus({ preventScroll: true }); }
  const attach = (form, detail) => { close(); form.dispatchEvent(new CustomEvent("pl:attach", { bubbles: true, detail })); };
  let gifT = 0;
  async function gifPicker(btn, form) {
    const pop = show(btn, form, `<p class="fx-msg">One moment.</p>`, "GIFs and stickers");
    let j = null; try { const r = await fetch("/api/feed/gifs", { credentials: "same-origin" }); j = await r.json(); } catch {}
    if (open?.pop !== pop) return;
    if (!j || j.provider === "stickers" || !j.provider) { const S = j?.stickers || Object.keys(ART);
      pop.setAttribute("aria-label", "Stickers"); pop.innerHTML = `<h3>Stickers</h3><div class="fx-scroll"><div class="fx-stks">${S.filter((id) => ART[id]).map((id) => `<button type="button" class="fx-s fx-sv" data-fx-s="${esc(id)}" aria-label="Send the ${esc(stickerName(id))} sticker">${stickerSvg(id)}</button>`).join("")}</div></div>`;
      pop.addEventListener("click", (e) => { const b = e.target.closest("[data-fx-s]"); if (b) attach(form, { sticker: b.dataset.fxS }); }); pop.querySelector("button")?.focus({ preventScroll: true }); return; }
    const name = j.provider === "giphy" ? "GIPHY" : "Tenor", draw = (L, msg) => { const g = pop.querySelector(".fx-gifs"); g.innerHTML = L.length ? L.map((x, i) => `<button type="button" class="fx-g" data-fx-g="${i}" aria-label="Send this GIF"><img src="${esc(x.url)}" alt="" loading="lazy" decoding="async" width="${+x.w || 100}" height="${+x.h || 100}"></button>`).join("") : `<p class="fx-msg">${esc(msg || "Nothing found. Try another word.")}</p>`; pop._L = L; };
    pop.innerHTML = `<div class="fx-q" role="search"><label class="fb-sr" for="fxQ">Search ${name}</label><input id="fxQ" type="search" placeholder="Search ${name}" autocomplete="off" enterkeyhint="search"></div><div class="fx-scroll"><div class="fx-gifs"></div></div><p class="fx-via">${j.provider === "giphy" ? "Powered by GIPHY" : "via Tenor"}</p>`;
    draw(j.results || [], j.message); const q = pop.querySelector("input");
    const go = async () => { try { const r = await fetch("/api/feed/gifs?q=" + encodeURIComponent(q.value.trim()), { credentials: "same-origin" }), k = await r.json(); if (open?.pop === pop) draw(k.results || [], k.message); } catch { draw([], "GIFs didn't load. Try again."); } };
    q.addEventListener("input", () => { clearTimeout(gifT); gifT = setTimeout(go, 350); }); q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(gifT); go(); } });
    pop.addEventListener("click", (e) => { const b = e.target.closest("[data-fx-g]"); if (b && pop._L?.[+b.dataset.fxG]) attach(form, { gif: pop._L[+b.dataset.fxG] }); }); q.focus({ preventScroll: true }); }
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-fx]"); if (!b) return; const form = b.closest("form"); if (!form) return; e.preventDefault();
    if (open && open.btn === b) { close(); return; } if (b.dataset.fx === "emoji") emojiPicker(b, form); else gifPicker(b, form); });

  // ---------- reactions on a comment ----------
  const RX = [["heart", "❤️", "Love"], ["laugh", "😂", "Funny"], ["wow", "😮", "Wow"], ["clap", "👏", "Applause"], ["fire", "🔥", "Fire"], ["sad", "😢", "Sad"]];
  let bar = null;
  const closeBar = () => { if (!bar) return; const b = bar; bar = null; b.el.remove(); document.removeEventListener("keydown", barKey, true); document.removeEventListener("pointerdown", barOut, true); try { b.opener?.focus({ preventScroll: true }); } catch {} };
  const barKey = (e) => { if (e.key === "Escape") { e.preventDefault(); closeBar(); } };
  const barOut = (e) => { if (bar && !bar.el.contains(e.target)) closeBar(); };
  const where = (row) => ({ id: row?.dataset.cid || "", target: row?.closest("[data-fx-target]")?.dataset.fxTarget || "", signedIn: row?.closest("[data-fx-target]")?.dataset.fxIn === "1" });
  function openBar(row, opener) { const W = where(row); if (!W.id || !W.target) return; if (!W.signedIn) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
    closeBar(); css(); const mine = new Set([...row.querySelectorAll(".fx-rx[aria-pressed=true]")].map((b) => b.dataset.rx)), el = document.createElement("div");
    el.className = "fx-bar" + (RM() ? "" : " in"); el.setAttribute("role", "group"); el.setAttribute("aria-label", "React to this comment");
    el.innerHTML = RX.map(([r, g, n]) => `<button type="button" data-rx-pick="${r}" aria-label="${n}" aria-pressed="${mine.has(r)}"><span aria-hidden="true">${g}</span></button>`).join("");
    const host = row.closest("li") || row; if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(el); const top = host.getBoundingClientRect().top; el.style.left = "0"; if (top < 80) el.style.top = "100%"; else el.style.bottom = "calc(100% - 6px)";
    bar = { el, row, opener }; document.addEventListener("keydown", barKey, true); document.addEventListener("pointerdown", barOut, true);
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-rx-pick]"); if (!b) return; const r = b.dataset.rxPick; closeBar(); react(row, r); });
    el.querySelector("button").focus({ preventScroll: true }); }
  const busy = new Set();
  async function react(row, r) { const W = where(row); if (!W.signedIn) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; } const k = W.target + "|" + W.id; if (busy.has(k)) return; busy.add(k);
    try { const res = await fetch(`/api/feed/comments/${encodeURIComponent(W.id)}/react`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: W.target, r }) }), j = await res.json().catch(() => ({}));
      if (res.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
      if (!res.ok) throw new Error(j.message || "That didn't go through. Try again.");
      const on = (j.reactions || []).some((x) => x.r === r && x.mine);
      document.dispatchEvent(new CustomEvent("pl:rx", { detail: { target: W.target, id: W.id, reactions: j.reactions || [], pop: on ? r : "" } }));
      window.FeedVisual?.social?.live(on ? `You reacted ${RX.find((x) => x[0] === r)[2]}.` : "Reaction taken back."); }
    catch (er) { window.PLToast ? window.PLToast(er.message) : null; }
    finally { busy.delete(k); } }
  document.addEventListener("click", (e) => { const o = e.target.closest?.("[data-rx-open]"); if (o) { e.preventDefault(); openBar(o.closest("[data-cid]"), o); return; }
    const c = e.target.closest?.(".fx-rx[data-rx]"); if (c) { e.preventDefault(); react(c.closest("[data-cid]"), c.dataset.rx); } });
  // a long press on a comment, on a touch screen
  let lp = null;
  document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") return; const row = e.target.closest?.("[data-cid]"); if (!row || e.target.closest("a,button,textarea,input")) return;
    const x0 = e.clientX, y0 = e.clientY; lp = { row, x0, y0, t: setTimeout(() => { lp = null; try { navigator.vibrate?.(8); } catch {} openBar(row, row.querySelector("[data-rx-open]")); }, 480) }; }, { passive: true });
  const cancel = (e) => { if (!lp) return; if (e.type === "pointermove" && Math.hypot(e.clientX - lp.x0, e.clientY - lp.y0) < 10) return; clearTimeout(lp.t); lp = null; };
  for (const t of ["pointerup", "pointercancel", "pointermove", "scroll"]) document.addEventListener(t, cancel, { passive: true, capture: t === "scroll" });
  document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".fb-c[data-cid],.pp-c[data-cid]") && matchMedia("(pointer:coarse)").matches) e.preventDefault(); });

  window.PLFun = { paint, stickerSvg, stickerName, close, RX };
  paint(document);
})();
