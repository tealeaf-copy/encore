// Report and block, everywhere people's things show (server/safety.js has the rules).
// - Anything with data-report='{"type":"post|moment|kudos|review|person|host|event","target":"...","key":"<person key>",
//   "handle":"<host>","name":"...","text":"..."}' gets a small "More" button with Report (and Block, when it has a person or host).
// - Host pages (/@handle) get "Report this page" and "Block this host" at the bottom.
// - Host-page kudos (.kq) and any uploaded photo (long press, or right click) can be reported too.
// - window.EncoreSafety.open({...}) opens the same sheet from anywhere.
(function () {
  if (window.EncoreSafety) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const REASONS = [["spam", "Spam or scam"], ["hate", "Hate or harassment"], ["sexual", "Sexual content"], ["violence", "Violence or threats"], ["unsafe", "Unsafe event or person"], ["private", "Shares private info"], ["fake", "Fake or misleading"], ["other", "Something else"]];
  let css = false;
  function style() { if (css) return; css = true; const s = document.createElement("style"); s.textContent = `
.sf-more{position:absolute;top:8px;right:8px;z-index:3;width:32px;height:32px;border-radius:999px;border:1.5px solid var(--pl-line);background:rgba(255,252,247,.92);color:var(--pl-frame);display:grid;place-items:center;cursor:pointer;padding:0}
.sf-more:focus-visible{outline:3px solid var(--pl-accent);outline-offset:2px}.sf-more svg{width:16px;height:16px}
.fv-by .sf-more{position:static;width:28px;height:28px;margin-left:auto;flex:none}
.sf-bg{position:fixed;inset:0;background:rgba(20,16,14,.45);display:flex;align-items:flex-end;justify-content:center;z-index:10000}
@media (min-width:640px){.sf-bg{align-items:center}}
.sf{background:var(--pl-surface);color:var(--pl-ink);width:min(440px,100%);border-radius:24px 24px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:0 18px 48px -18px rgba(31,26,23,.45);font:16px/1.45 "Instrument Sans",system-ui,sans-serif;max-height:90dvh;overflow:auto;border-top:1.5px solid var(--pl-frame)}
@media (min-width:640px){.sf{border-radius:24px;border:1.5px solid var(--pl-frame)}}
.sf h2{font:600 20px/1.2 var(--sys-display);margin:0 0 4px}.sf p{margin:0 0 12px;color:var(--pl-soft);font-size:14px}
.sf .sf-act{display:grid;gap:8px}.sf button{font:600 16px/1 var(--sys-title);min-height:44px;border-radius:999px;border:1.5px solid var(--pl-line-strong);background:#fff;color:var(--pl-ink);cursor:pointer;padding:0 16px;text-align:left}
.sf button.sf-go{background:var(--pl-accent);border-color:var(--pl-accent);color:#fff;text-align:center}.sf button.sf-x{text-align:center;border:0;background:transparent;color:var(--pl-soft)}
.sf label{display:flex;gap:10px;align-items:center;min-height:44px;font-size:16px;border-bottom:1.5px solid var(--pl-line)}.sf label:last-of-type{border-bottom:0}.sf input[type=radio]{width:20px;height:20px;accent-color:var(--pl-accent)}
.sf textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--pl-line-strong);border-radius:12px;padding:10px 12px;font:16px/1.4 inherit;min-height:72px;margin:8px 0 12px}
.sf-foot{max-width:720px;margin:24px auto 96px;padding:0 16px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;font:14px/1.4 "Instrument Sans",system-ui,sans-serif}
.sf-foot a{color:var(--pl-soft)}
`; document.head.appendChild(s); }
  const DOTS = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="13" cy="8" r="1.6" fill="currentColor"/></svg>';

  function sheet(html) { style(); const bg = document.createElement("div"); bg.className = "sf-bg"; bg.innerHTML = `<div class="sf" role="dialog" aria-modal="true">${html}</div>`;
    const prev = document.activeElement, close = () => { bg.remove(); document.removeEventListener("keydown", key); try { prev && prev.focus(); } catch {} }, key = (e) => { if (e.key === "Escape") close(); };
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); }); document.addEventListener("keydown", key); document.body.appendChild(bg); setTimeout(() => bg.querySelector("button,input")?.focus(), 30); return { el: bg.firstChild, close }; }
  async function post(url, body, method = "POST") { const r = await fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't work. Try again."); return j; }
  function toast(t) { const n = document.createElement("div"); n.setAttribute("role", "status"); n.style.cssText = "position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--pl-ink);color:#fff;padding:10px 16px;border-radius:999px;font:600 14px/1.3 'Instrument Sans',system-ui,sans-serif;z-index:10001;max-width:calc(100vw - 32px)"; n.textContent = t; document.body.appendChild(n); setTimeout(() => n.remove(), 3200); }
  const what = (t) => ({ post: "post", moment: "photo", kudos: "kudos", review: "review", person: "person", host: "page", event: "event" })[t] || "this";

  /** o: { type, target, text, key, handle, name } */
  function open(o) {
    const blockable = !!(o.key || o.handle), who = o.name ? esc(o.name) : o.handle ? "this host" : "this person";
    const S = sheet(`<h2>${o.type === "host" ? "This page" : "This " + what(o.type)}</h2><p>Tell us what's wrong, or stop seeing them.</p><div class="sf-act"><button type="button" data-a="report">Report ${o.type === "host" ? "this page" : "this " + what(o.type)}</button>${blockable ? `<button type="button" data-a="block">Block ${who}</button>` : ""}<button type="button" class="sf-x" data-a="x">Cancel</button></div>`);
    S.el.onclick = (e) => { const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; S.close(); if (a === "report") report(o); if (a === "block") block(o); };
  }
  function report(o) {
    const S = sheet(`<h2>Report this ${what(o.type)}</h2><p>We look at every report within 24 hours. The person isn't told who reported.</p><form>${REASONS.map(([k, l], i) => `<label><input type="radio" name="r" value="${k}"${i ? "" : " required"}> ${l}</label>`).join("")}<textarea name="note" maxlength="1000" placeholder="Anything else we should know? (optional)"></textarea><div class="sf-act"><button class="sf-go" type="submit">Send report</button><button type="button" class="sf-x" data-a="x">Cancel</button></div></form>`);
    S.el.querySelector("[data-a=x]").onclick = S.close;
    S.el.querySelector("form").onsubmit = async (e) => { e.preventDefault(); const f = e.target, reason = f.r.value; if (!reason) return;
      const type = o.type === "review" ? "review" : o.type, target = o.target || (o.type === "host" && o.handle ? "host:" + o.handle : o.type === "person" && o.key ? "person:" + o.key : "");
      try { const j = await post("/api/report", { type, target, text: o.text || "", reason, note: f.note.value, url: location.pathname + location.search, name: o.name || "" }); S.close(); toast(j.message || "Thanks. We'll take a look.");
        if (blockableFor(o) && signedIn()) setTimeout(() => { const B = sheet(`<h2>Block ${esc(o.name || (o.handle ? "this host" : "them"))} too?</h2><p>You won't see their posts, photos or events.</p><div class="sf-act"><button class="sf-go" type="button" data-a="y">Block</button><button type="button" class="sf-x" data-a="x">Not now</button></div>`); B.el.onclick = (ev) => { const a = ev.target.closest("[data-a]")?.dataset.a; if (!a) return; B.close(); if (a === "y") block(o, true); }; }, 300);
      } catch (err) { toast(err.message); } };
  }
  const blockableFor = (o) => !!(o.key || o.handle);
  async function block(o, sure) {
    if (!signedIn()) { toast("Sign in to block someone."); setTimeout(() => (location.href = "/login?next=" + encodeURIComponent(location.pathname)), 900); return; }
    if (!sure && !confirm(`Block ${o.name || (o.handle ? "this host" : "this person")}? You won't see their posts, photos or events. You can undo this in Settings.`)) return;
    try { const j = await post("/api/me/blocks", o.handle && o.type === "host" ? { kind: "host", handle: o.handle, name: o.name || o.handle } : { kind: o.key ? "person" : "host", key: o.key, handle: o.handle, name: o.name || "" }); toast(j.message || "Blocked.");
      document.querySelectorAll("[data-report]").forEach((el) => { try { const d = JSON.parse(el.dataset.report); if ((o.key && d.key === o.key) || (o.handle && d.handle === o.handle)) (el.closest("article,.fv-note,.kq") || el).remove(); } catch {} });
      if (o.type === "host" && /^\/@/.test(location.pathname)) setTimeout(() => (location.href = "/feed"), 900);
    } catch (err) { toast(err.message); }
  }

  // ---- decorate what's on the page ----
  function more(el, data) { if (el.querySelector(":scope > .sf-more")) return; const b = document.createElement("button"); b.type = "button"; b.className = "sf-more"; b.setAttribute("aria-label", "More: report or block"); b.innerHTML = DOTS;
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); open(data); };
    if (!el.classList.contains("fv-by") && getComputedStyle(el).position === "static") el.style.position = "relative"; el.appendChild(b); }
  function decorate(rootEl) {
    style();
    rootEl.querySelectorAll("[data-report]").forEach((el) => { if (el.dataset.sfOn) return; el.dataset.sfOn = 1; try { more(el, JSON.parse(el.dataset.report)); } catch {} });
    const h = /^\/@([a-z0-9][a-z0-9-]{1,29})$/.exec(location.pathname)?.[1];
    if (h) rootEl.querySelectorAll(".kq:not([data-sf-on])").forEach((el) => { el.dataset.sfOn = 1; const t = (el.querySelector("p")?.textContent || "").trim().replace(/^"|"$/g, ""); if (t) more(el, { type: "review", text: t, name: "" }); });
  }
  function hostFooter() {
    const h = /^\/@([a-z0-9][a-z0-9-]{1,29})$/.exec(location.pathname)?.[1]; if (!h || document.querySelector(".sf-foot")) return;
    const f = document.createElement("nav"); f.className = "sf-foot"; f.setAttribute("aria-label", "Report or block");
    f.innerHTML = `<a href="#" data-a="report">Report this page</a><a href="#" data-a="block">Block this host</a><a href="/community">Community rules</a>`;
    f.onclick = (e) => { const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; e.preventDefault(); const name = (document.querySelector("h1")?.textContent || "").trim().slice(0, 60); const o = { type: "host", handle: h, target: "host:" + h, name };
      a === "report" ? report(o) : block(o); };
    (document.querySelector("main") || document.body).appendChild(f);
  }
  // a long press (or right click) on any uploaded photo
  let pressT = 0;
  const photoOf = (t) => { const img = t && t.closest && t.closest("img,video"); const src = img && (img.getAttribute("src") || img.getAttribute("poster") || ""); return src && /^\/_blob\/[A-Za-z0-9]+$/.test(src) && !img.closest(".sf,[data-report]") ? src : ""; };
  document.addEventListener("contextmenu", (e) => { const src = photoOf(e.target); if (!src) return; e.preventDefault(); open({ type: "moment", target: "moment:" + src }); });
  document.addEventListener("touchstart", (e) => { const src = photoOf(e.target); if (!src) return; clearTimeout(pressT); pressT = setTimeout(() => open({ type: "moment", target: "moment:" + src }), 650); }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((k) => document.addEventListener(k, () => clearTimeout(pressT), { passive: true }));

  function start() { decorate(document); hostFooter(); let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; decorate(document); hostFooter(); }); }).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.EncoreSafety = { open, report, block };
})();
