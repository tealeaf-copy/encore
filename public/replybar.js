// The light invite's reply bar (/e/<id>, /i/<id>): on a phone, once the reply form has scrolled out of view, a calm bar
// floats at the bottom with the date and spots (in the page's own words, "Today · 7pm" or "Thu, Nov 26 · 7pm") and the
// main action (the host's "I'm in", "Ask to join" or "Join waitlist"). Tapping it picks that answer and brings the form
// back into view; Maybe stays in the form. It never covers content: the
// page gets the bar's height as bottom padding while it shows, and it steps aside once you've replied. Loaded by slots.js.
(function () {
  if (window.__plReplyBar || !/^\/[ei]\/[A-Za-z0-9_-]{2,80}$/.test(location.pathname)) return; window.__plReplyBar = 1;
  const css = document.createElement("style"); css.textContent = `
.prb{position:fixed;left:0;right:0;bottom:0;z-index:50;display:flex;gap:12px;align-items:center;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border-top:1.5px solid var(--pl-ink,#1B1D1C);transform:translateY(110%);transition:transform .22s cubic-bezier(.2,.8,.2,1);box-sizing:border-box}
.prb.on{transform:none}.prb[hidden]{display:none}
.prb-t{flex:1;min-width:0;display:grid}.prb-t b{font:var(--inv-bar-date,600 16px/20px system-ui);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prb-t small{font:var(--inv-bar-sub,400 13px/18px system-ui);color:var(--pl-soft,#444845);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prb button{flex:none;min-height:48px;min-width:120px;border-radius:var(--pl-r-btn,6px);font:var(--inv-btn,600 16px/20px system-ui);cursor:pointer;padding:0 20px;white-space:nowrap;border:0;background:var(--lk-btn,var(--kit-btn,var(--pl-accent,#29489A)));color:var(--lk-on-btn,var(--kit-on-btn,#fff))}
@media (min-width:700px){.prb{display:none!important}}
@media (prefers-reduced-motion:reduce){.prb{transition:none}}`;
  document.head.appendChild(css);
  let bar = null, io = null, form = null;
  const pick = (v) => { if (document.getElementById("oGo")) { form?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" }); setTimeout(() => form?.querySelector("input:not([type=hidden])")?.focus({ preventScroll: true }), 450); return; }
    const r = form?.querySelector(`input[name=r][value="${v}"]`); if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
    form?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" }); setTimeout(() => form?.querySelector("#nm")?.focus({ preventScroll: true }), 450); };
  const show = (on) => { if (!bar) return; bar.classList.toggle("on", on); }; // its room is in slots.css (body:has(.prb)), so nothing jumps and nothing stays behind
  // a drop's order form (public/invite-order.js) stands in for the reply form: the bar says Order and goes there
  const formNow = () => { const og = document.getElementById("oGo"); if (og) return og.closest("form") || og.parentElement; const f = document.getElementById("f"); return f && !f.hidden && !document.getElementById("tk") ? f : null; }; // once a reply or an order is in, there is nothing left for the bar to ask
  function mount() { const f = formNow(); if (f === form) return; form = f; io?.disconnect(); bar?.remove(); bar = null; document.body.style.paddingBottom = ""; if (!f) return;
    const goL = document.getElementById("oGo")?.textContent.trim() || f.querySelector('input[name=r][value="going"]')?.closest("label")?.textContent.trim() || f.querySelector("#send")?.textContent.trim() || "I'm in";
    const txt = (q) => (document.querySelector(q)?.textContent || "").trim(), when = txt("#m .facts > div:first-child b").replace(/ to [^·]+$/, ""), sub = txt("#spots span") || txt("#price span");
    bar = document.createElement("div"); bar.className = "prb"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Reply");
    bar.innerHTML = `<div class="prb-t"><b></b><small></small></div><button type="button" class="prb-go"></button>`; bar.querySelector(".prb-t b").textContent = when; bar.querySelector(".prb-t small").textContent = sub; bar.querySelector(".prb-t small").hidden = !sub; bar.querySelector(".prb-go").textContent = goL.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, "").trim() || "I'm in";
    bar.querySelector(".prb-go").onclick = () => pick("going");
    document.body.appendChild(bar); io = new IntersectionObserver(([x]) => show(!x.isIntersecting), { threshold: 0 }); io.observe(f); }
  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true }); mount();
})();
