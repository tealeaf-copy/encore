// The app's Home, made a little more fun: plush Potto (public/pottoplush.js) sits above "What are we hosting next?"
// in a box index.html already reserves, and wears what you're typing about (a chef hat for dinner, a headband for a
// run). The styles (public/fun.css) and the drawing load after the page is up, and only change paint, never layout.
// Also the one place other scripts ask for a Potto: PLFun.potto(el, opts) loads what it needs and mounts him.
(function () {
  if (window.PLFun) return;
  let ready = null;
  const ensure = () => ready || (ready = new Promise((ok) => {
    if (!document.querySelector('link[href^="/fun.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/fun.css"; document.head.appendChild(l); }
    if (window.PottoPlush) return ok(window.PottoPlush);
    const s = document.createElement("script"); s.src = "/pottoplush.js"; s.onload = () => ok(window.PottoPlush); s.onerror = () => ok(null); document.head.appendChild(s); }));
  const potto = (el, o = {}) => ensure().then((P) => (P && el && el.isConnected ? P.mount(el, o) : null));
  window.PLFun = { ensure, potto };

  // ---- Home ----
  let type = "", m = null;
  const box = () => document.getElementById("qsText");
  function home() { const el = document.getElementById("homePotto"); if (!el || el.__potto) return;
    if (!window.PottoPlush) { ensure().then((P) => P && home()); return; }
    const t = window.PottoPlush.typeFor(box()?.value) || type; m = window.PottoPlush.mount(el, { size: 132, type: t || undefined });
    const p = el.closest(".pl-fun"); if (p && m) p.dataset.funTint = m.state.color; }
  let timer = 0;
  document.addEventListener("input", (e) => { if (e.target?.id !== "qsText" || !m) return; clearTimeout(timer); const v = e.target.value;
    timer = setTimeout(() => { type = window.PottoPlush.typeFor(v); m.set({ type }); m.look(e.target, 1400); }, 140); });
  document.addEventListener("focusin", (e) => { if (e.target?.id === "qsText" && m) m.look(e.target, 1200); });
  document.addEventListener("click", (e) => { if (m && e.target?.closest?.("#qsGo")) m.react("hop"); }, true);
  // Home is redrawn often (index.html renderPrograms): put Potto back each time, in the same clothes
  try { if (typeof renderPrograms === "function") { const _rp = renderPrograms; renderPrograms = function () { const r = _rp.apply(this, arguments); try { home(); } catch {} return r; }; } } catch {} // eslint-disable-line no-global-assign, no-undef
  const start = () => { try { home(); } catch {} };
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 1200 }); else setTimeout(start, 200);
})();
