// The light invite's reply bar (/e/<id>, /i/<id>): on a phone, once the reply form has scrolled out of view, a calm bar
// floats at the bottom with the main action (the host's "I'm in", "Ask to join" or "Join waitlist") and, when the event
// offers it, "Maybe". Tapping either picks that answer and brings the form back into view. It never covers content: the
// page gets the bar's height as bottom padding while it shows, and it steps aside once you've replied. Loaded by slots.js.
(function () {
  if (window.__plReplyBar || !/^\/[ei]\/[A-Za-z0-9_-]{2,80}$/.test(location.pathname)) return; window.__plReplyBar = 1;
  const css = document.createElement("style"); css.textContent = `
.prb{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;gap:8px;align-items:center;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:color-mix(in srgb,var(--lk-bot,var(--card,#FFFCF7)) 94%,transparent);color:var(--lk-ink,var(--ink,#1F1A17));backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:var(--bw,1.5px) solid var(--lk-line,var(--line,#E4D9C8));transform:translateY(110%);transition:transform .22s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.prb.on{transform:none}.prb[hidden]{display:none}
.prb button{min-height:48px;border-radius:999px;font:600 16px var(--sys-sans,system-ui);cursor:pointer;padding:0 20px;white-space:nowrap}
.prb .prb-go{flex:1;border:0;background:var(--lk-btn,var(--sys-ember,#C94A30));color:var(--lk-on-btn,#fff)}
.prb .prb-2{flex:none;border:var(--bw,1.5px) solid var(--lk-line,var(--line-strong,#D9CCBB));background:transparent;color:inherit}
@media (min-width:700px){.prb{display:none!important}}
@media (prefers-reduced-motion:reduce){.prb{transition:none}}`;
  document.head.appendChild(css);
  let bar = null, io = null, form = null;
  const pick = (v) => { const r = form?.querySelector(`input[name=r][value="${v}"]`); if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
    form?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" }); setTimeout(() => form?.querySelector("#nm")?.focus({ preventScroll: true }), 450); };
  const show = (on) => { if (!bar) return; bar.classList.toggle("on", on); document.body.style.paddingBottom = on ? bar.offsetHeight + "px" : ""; };
  function mount() { const f = document.getElementById("f"); if (f === form) return; form = f; io?.disconnect(); bar?.remove(); bar = null; document.body.style.paddingBottom = ""; if (!f) return;
    const goL = f.querySelector('input[name=r][value="going"]')?.closest("label")?.textContent.trim() || f.querySelector("#send")?.textContent.trim() || "I'm in", maybe = !!f.querySelector('input[name=r][value="maybe"]');
    bar = document.createElement("div"); bar.className = "prb"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Reply");
    bar.innerHTML = `${maybe ? `<button type="button" class="prb-2">Maybe</button>` : ""}<button type="button" class="prb-go"></button>`; bar.querySelector(".prb-go").textContent = goL.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, "").trim() || "I'm in";
    bar.querySelector(".prb-go").onclick = () => pick("going"); bar.querySelector(".prb-2") && (bar.querySelector(".prb-2").onclick = () => pick("maybe"));
    document.body.appendChild(bar); io = new IntersectionObserver(([x]) => show(!x.isIntersecting), { threshold: 0 }); io.observe(f); }
  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true }); mount();
})();
