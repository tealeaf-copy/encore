// Small, calm feedback shared by every page (window.PLFx): a press state, a check that draws itself, a count that ticks
// up, the ink stamp when something lands, light haptics in the app (public/native.js; nothing on the web), optional soft
// sounds (off by default, on in Settings), paper confetti for real milestones, a meter that fills once, numbers that
// count up once, and a toast. The host loop (public/hostloop.js) uses the same one. Nothing moves for people who ask
// for less motion. Brand tokens only (public/system.css).
(function () {
  "use strict";
  if (window.PLFx) return;
  const reduce = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const tok = (n, fb) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb; } catch { return fb; } };
  const css = `
.hl-press,.hl-btn{transition:transform .08s ease}.hl-press:active,.hl-btn:active{transform:translateY(1px) scale(.985)}
.hl-check{display:inline-block;width:20px;height:20px;vertical-align:-4px}.hl-check path{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24;animation:hlDraw .38s ease-out forwards}
@keyframes hlDraw{to{stroke-dashoffset:0}}
.hl-stamp{position:fixed;left:50%;top:38%;z-index:9999;pointer-events:none;transform:translate(-50%,-50%) rotate(-6deg);border:2px solid var(--pl-ink);color:var(--pl-ink);border-radius:6px;padding:8px 16px;font:600 22px/1 var(--pl-font-mono);letter-spacing:.12em;text-transform:uppercase;background:var(--pl-surface);animation:hlStamp .9s ease-out forwards}
.hl-stamp.inline{position:relative;left:auto;top:auto;display:inline-block;transform:rotate(-6deg);animation-name:hlStampIn}
.hl-stamp.sm{padding:3px 7px;font-size:12px;letter-spacing:.08em;border-width:1.5px;border-radius:4px}
@keyframes hlStamp{0%{opacity:0;transform:translate(-50%,-50%) rotate(-6deg) scale(1.5)}18%{opacity:1;transform:translate(-50%,-50%) rotate(-6deg) scale(.96)}26%{transform:translate(-50%,-50%) rotate(-6deg) scale(1)}80%{opacity:1}100%{opacity:0}}
@keyframes hlStampIn{0%{opacity:0;transform:rotate(-6deg) scale(1.5)}35%{opacity:1;transform:rotate(-6deg) scale(.96)}50%,100%{opacity:1;transform:rotate(-6deg) scale(1)}}
.fx-inked{animation:fxInk .5s ease-out both}
@keyframes fxInk{0%{opacity:0;transform:rotate(var(--fx-rot,-2deg)) scale(1.35)}45%{opacity:1;transform:rotate(var(--fx-rot,-2deg)) scale(.97)}100%{opacity:1;transform:rotate(var(--fx-rot,-2deg)) scale(1)}}
.hl-confetti{position:fixed;inset:0;pointer-events:none;z-index:9998;overflow:hidden}.hl-confetti i{position:absolute;top:-12px;width:8px;height:8px;border-radius:1px;animation:hlFall linear forwards}
@keyframes hlFall{to{transform:translate3d(var(--dx),105vh,0) rotate(var(--r));opacity:.9}}
.hl-toast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--pl-ink);color:var(--pl-surface);border-radius:6px;padding:10px 14px;font-size:14px;z-index:9995;max-width:calc(100% - 32px)}
@media (prefers-reduced-motion:reduce){.hl-check path{animation:none;stroke-dashoffset:0}.hl-stamp,.hl-stamp.inline,.fx-inked{animation:none;opacity:1}.hl-press:active,.hl-btn:active{transform:none}}
`;
  const st = document.createElement("style"); st.id = "plfx-css"; st.textContent = css; (document.head || document.documentElement).appendChild(st);

  const fx = {
    reduce,
    haptic(kind = "light") { try { window.EncoreNative?.haptic?.(kind); } catch {} }, // the app only; a quiet no-op on the web
    sound(kind = "tap") { if (ls.get("pl.sounds") !== "1") return; try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const c = fx._ac || (fx._ac = new A()), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = "sine"; o.frequency.value = kind === "done" ? 740 : kind === "stamp" ? 392 : 560; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "stamp" ? 0.22 : 0.12));
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.25); } catch {} },
    check() { return `<svg class="hl-check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>`; },
    /** Count a number up from what it shows now. Keeps a prefix and suffix ("$", "%") and thousands commas. */
    tick(el, to, ms = 420) { if (!el) return; const txt = el.textContent || "", m = txt.match(/^(\D*?)([\d,]+)(\D*)$/), pre = m ? m[1] : "", suf = m ? m[3] : "", from = m ? +m[2].replace(/,/g, "") : 0, commas = /,/.test(txt) || to >= 1000;
      const put = (v) => { el.textContent = pre + (commas ? Math.round(v).toLocaleString("en-US") : Math.round(v)) + suf; };
      if (reduce() || from === to) { put(to); return; } const t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / ms); put(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); },
    stamp(word = "Sent", where, { small = false } = {}) { const s = document.createElement("div"); s.className = "hl-stamp" + (where ? " inline" : "") + (small ? " sm" : ""); s.textContent = word; s.setAttribute("aria-hidden", "true");
      if (where) where.appendChild(s); else { document.body.appendChild(s); setTimeout(() => s.remove(), 1000); } fx.haptic("medium"); fx.sound("stamp"); return s; },
    /** Press an existing element down like a rubber stamp (it keeps its own look). */
    ink(el) { if (!el) return; el.classList.remove("fx-inked"); void el.offsetWidth; el.classList.add("fx-inked"); },
    confetti() { if (reduce()) return; const box = document.createElement("div"), C = [tok("--pl-accent", "currentColor"), tok("--pl-sand", "currentColor"), tok("--pl-ink", "currentColor"), tok("--pl-sage", "currentColor"), tok("--pl-highlight", tok("--pl-sand", "currentColor"))];
      box.className = "hl-confetti"; box.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 42; i++) { const p = document.createElement("i"), dur = 1.6 + Math.random() * 1.4; p.style.left = Math.random() * 100 + "%"; p.style.background = C[i % C.length]; p.style.setProperty("--dx", (Math.random() * 80 - 40) + "px"); p.style.setProperty("--r", (Math.random() * 540 - 270) + "deg"); p.style.animationDuration = dur + "s"; p.style.animationDelay = Math.random() * 0.4 + "s"; if (i % 3 === 0) { p.style.width = "6px"; p.style.height = "10px"; } box.appendChild(p); }
      document.body.appendChild(box); setTimeout(() => box.remove(), 3400); fx.haptic("success"); },
    toast(msg) { document.querySelector(".hl-toast")?.remove(); const t = document.createElement("div"); t.className = "hl-toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); },
    press() { if (fx._pressed) return; fx._pressed = 1; document.addEventListener("pointerdown", (e) => { const b = e.target.closest?.(".hl-btn,.hl-press"); if (b) { fx.haptic("light"); fx.sound("tap"); } }, { passive: true }); },
    /** True the first time `key` is asked for in this tab, then false: for things that should move once a visit. */
    firstInSession(key) { if (ss.get("plfx." + key)) return false; ss.set("plfx." + key, "1"); return true; },
    /** Ids from `want` not seen before under `key` (saved as seen). For stamps that land once, when they change. */
    fresh(key, want) { let had = null; try { had = JSON.parse(ls.get("plfx." + key) || "null"); } catch {} ls.set("plfx." + key, JSON.stringify(want)); return had ? want.filter((x) => !had.includes(x)) : null; },
    /** Fill bars (inline width set) from empty, once per visit to `key`. Bars are elements; each keeps its own width. */
    fill(bars, key = "") { const L = [...(bars || [])].filter(Boolean); if (!L.length || reduce() || (key && !fx.firstInSession("fill." + key))) return;
      L.forEach((b) => { const w = b.style.width; b.style.transition = "none"; b.style.width = "0"; void b.offsetWidth; b.style.transition = "width .9s cubic-bezier(.2,.7,.2,1)"; requestAnimationFrame(() => { b.style.width = w; }); }); },
    /** Count every [data-fx-count] number in `root` up from 0, once per visit to `key`. */
    countUp(root, key = "", ms = 700) { const L = [...(root || document).querySelectorAll("[data-fx-count]")]; if (!L.length || reduce() || (key && !fx.firstInSession("count." + key))) return;
      L.forEach((el) => { const to = +el.dataset.fxCount; if (!Number.isFinite(to)) return; const m = (el.textContent || "").match(/^(\D*?)([\d,]+)(\D*)$/); if (!m) return; el.textContent = m[1] + "0" + m[3]; fx.tick(el, to, ms); }); },
  };
  window.PLFx = fx;
})();
