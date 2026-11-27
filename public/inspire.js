// Inspiration cards in the feed (server/inspiration.js makes them; this draws them and wires their two buttons).
// A light dashed "idea" frame so nobody mistakes one for a post or an event: the source label ("On the calendar",
// "New on Pottery Lab", "Spotted by the Pottery Lab team", or a configured provider's own label), a head, the idea,
// one line, the cover drawing (public/eventart.js, the drawing only: no label or title inside it), one primary
// "Plan this" and a quiet "Not for me". Signed out with no city, the same frame asks for a city instead.
//
// Plan this opens the create canvas already filled in (public/canvas.js reads ?insp=): one tap, one screen. Signed out
// it goes through sign in first. Not for me hides the card for good on this device, and for the person or device on
// the server. Shown (half on screen, once a page), tapped and dismissed are counted (POST /api/inspiration/track).
// Field Notes kit: --pl-* tokens, IBM Plex, 6px corners, 44px targets, ink-blue primary, light only.
(function () {
  if (window.PLInspire) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KEY = "pl.inspire", PER_DAY = 2;
  const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v === "object" ? { dismissed: v.dismissed || [], days: v.days || {} } : { dismissed: [], days: {} }; } catch { return { dismissed: [], days: {} }; } };
  const keep = (v) => { try { const k = Object.keys(v.days).sort().slice(-3); localStorage.setItem(KEY, JSON.stringify({ dismissed: v.dismissed.slice(0, 200), days: Object.fromEntries(k.map((x) => [x, v.days[x]])) })); } catch {} };
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const cityNow = () => { try { return (window.EncorePlace?.get?.() || {}).city || ""; } catch { return ""; } };
  const device = () => { try { return window.FeedVisual?.deviceId || localStorage.getItem("fv.device") || ""; } catch { return ""; } };
  function track(id, action) { try { fetch("/api/inspiration/track", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, device: device(), city: cityNow() }) }).catch(() => {}); } catch {} }

  /** The app link that opens the create canvas filled in from a card. */
  function planUrl(c) { const p = c.plan || {}, q = new URLSearchParams({ app: "1", new: "1" }); if (p.kind) q.set("kind", p.kind); q.set("insp", c.id);
    if (p.title) q.set("ititle", p.title); if (p.date) q.set("idate", p.date); if (p.place) q.set("iplace", p.place); if (p.hood) q.set("ihood", p.hood); if (p.city) q.set("icity", p.city); if (c.cover) q.set("icover", c.cover);
    return "/?" + q.toString() + "#studio"; }
  function art(kind) { const A = window.EventArt; if (!A?.drawing) return ""; try { const tone = A.toneOf({ id: kind }, kind), bg = A.PASTELS[tone], spot = A.SPOT[tone]; return `<span class="ins-art" style="--ins-bg:${esc(bg)}" aria-hidden="true">${A.drawing(kind, spot)}</span>`; } catch { return ""; } }
  const X = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>`;

  /** One card, as HTML ("" when this device hid it or already saw two others today). */
  function card(c) { if (!c || !c.id) return ""; css(); const v = load();
    if (v.dismissed.includes(c.id)) return "";
    if (c.type !== "city") { const T = v.days[day()] || []; if (!T.includes(c.id) && T.length >= PER_DAY) return ""; }
    const hid = "ins-" + String(c.id).replace(/[^a-z0-9]/gi, "-");
    const go = c.type === "city" ? `<button type="button" class="ins-go" data-ins-city>Choose a city</button>` : `<a class="ins-go" href="${esc(planUrl(c))}" data-ins-plan>Plan this<span class="fb-sr">: ${esc(c.idea || c.head)}</span></a>`;
    return `<section class="fb-card fb-insp" data-kind="inspire" data-ins="${esc(c.id)}" data-src="${esc(c.source || "")}" aria-labelledby="${hid}"><div class="ins-frame">
      <div class="ins-top"><div class="ins-txt"><p class="ins-k">${esc(c.label || "An idea")}</p><h3 class="ins-h" id="${hid}">${esc(c.head)}</h3>${c.idea ? `<p class="ins-i">${esc(c.idea)}</p>` : ""}</div>${c.type === "city" ? art("pin") || art("park") : art(c.cover)}</div>
      ${c.line ? `<p class="ins-l">${esc(c.line)}</p>` : ""}${c.link?.href ? `<p class="ins-src"><a href="${esc(c.link.href)}" target="_blank" rel="noopener nofollow">${esc(c.link.text || "Source")}</a></p>` : ""}
      <div class="ins-acts">${go}<button type="button" class="ins-no" data-ins-no>Not for me<span class="fb-sr">: ${esc(c.head)}</span></button></div></div></section>`; }

  // ---------- taps ----------
  const live = (t) => { let el = document.getElementById("fbLive"); if (!el) { el = document.createElement("div"); el.id = "fbLive"; el.className = "fb-sr"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); } el.textContent = ""; setTimeout(() => (el.textContent = t), 60); };
  document.addEventListener("click", (e) => {
    const sec = e.target.closest?.("[data-ins]"); if (!sec) return; const id = sec.dataset.ins;
    if (e.target.closest("[data-ins-no]")) { e.preventDefault(); const v = load(); if (!v.dismissed.includes(id)) v.dismissed.unshift(id); keep(v); track(id, "dismissed");
      const next = sec.nextElementSibling?.querySelector("a,button"); sec.remove(); live("Hidden. You won't see that one again."); try { next?.focus({ preventScroll: true }); } catch {} return; }
    const plan = e.target.closest("[data-ins-plan]"); if (plan) { e.preventDefault(); track(id, "tapped"); const url = plan.getAttribute("href");
      location.href = signedIn() ? url : "/login?next=" + encodeURIComponent(url); return; }
    if (e.target.closest("[data-ins-city]")) { e.preventDefault(); track(id, "tapped"); const P = window.EncorePlace; if (!P?.sheet) return;
      P.sheet({ title: "Where are you hosting?", current: cityNow(), onPick: (c) => { try { P.setManual(c); } catch {} if (window.PLFeedReload) window.PLFeedReload(); else location.reload(); } }); }
  });
  // shown: half the card on screen, once a page, and remembered for today's cap
  const told = new Set(); let io = null;
  function watch(root = document) { if (!("IntersectionObserver" in window)) return; io = io || new IntersectionObserver((L) => { for (const x of L) { if (!x.isIntersecting) continue; const id = x.target.dataset.ins; io.unobserve(x.target); if (told.has(id)) continue; told.add(id);
      if (id !== "city") { const v = load(), k = day(), T = v.days[k] || []; if (!T.includes(id)) { v.days[k] = [...T, id]; keep(v); } } track(id, "shown"); } }, { threshold: 0.5 });
    root.querySelectorAll?.("[data-ins]:not([data-ins-w])").forEach((el) => { el.dataset.insW = 1; io.observe(el); }); }
  new MutationObserver(() => { if (document.querySelector("[data-ins]:not([data-ins-w])")) watch(); }).observe(document.documentElement, { childList: true, subtree: true });

  function css() { if (document.getElementById("insCss")) return; const s = document.createElement("style"); s.id = "insCss"; s.textContent = `
.fb-insp{padding:20px 0}
.ins-frame{border:1.5px dashed var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:var(--pl-surface,#FAF8F3);padding:16px;color:var(--pl-ink,#1B1D1C);font-family:var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.ins-top{display:flex;align-items:flex-start;gap:14px}.ins-txt{flex:1;min-width:0}
.ins-k{margin:0 0 4px;font:600 13px/1.35 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:.02em;color:var(--pl-accent-text,#29489A)}
.ins-h{margin:0;font:600 20px/1.25 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:-.01em;color:var(--pl-ink,#1B1D1C);overflow-wrap:anywhere;text-wrap:balance}
.ins-i{margin:6px 0 0;font:500 16px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--pl-ink,#1B1D1C);overflow-wrap:anywhere}
.ins-l{margin:10px 0 0;font-size:15px;line-height:1.45;color:var(--pl-soft,#444845);overflow-wrap:anywhere}
.ins-art{flex:none;display:grid;place-items:center;width:84px;height:84px;border-radius:var(--pl-r-md,6px);background:var(--ins-bg,#ECE3C2);overflow:hidden}.ins-art svg{display:block;width:72px;height:auto;max-height:72px}
.ins-src{margin:4px 0 0}.ins-src a{display:inline-flex;align-items:center;min-height:44px;font-size:14px;color:var(--pl-accent-text,#29489A);text-decoration:underline;text-underline-offset:3px}
.ins-acts{display:flex;gap:10px;margin-top:14px}
.ins-go,.ins-no{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 16px;border-radius:var(--pl-r-btn,6px);font:600 15px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-align:center;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.ins-go{border:1.5px solid var(--pl-accent,#29489A);background:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff)}
.ins-no{border:1.5px solid var(--pl-line-strong,#1B1D1C);background:transparent;color:var(--pl-ink,#1B1D1C)}
@media (hover:hover){.ins-go:hover{background:var(--pl-accent-press,#1F3878);border-color:var(--pl-accent-press,#1F3878)}.ins-no:hover{background:var(--pl-raised,#E6E1D5)}}
.ins-go:focus-visible,.ins-no:focus-visible,.ins-src a:focus-visible{outline:2px solid var(--pl-focus,#29489A);outline-offset:2px}
@media (max-width:360px){.ins-art{width:64px;height:64px}.ins-art svg{width:56px;max-height:56px}}
`; document.head.appendChild(s); }

  window.PLInspire = { card, planUrl, css };
  // the blended feed draws cards by kind (public/feedvisual.js RENDER): this is the "inspire" kind
  const reg = () => { const R = window.FeedVisual?.RENDER; if (R && !R.inspire) R.inspire = card; return !!R; };
  if (!reg()) document.addEventListener("DOMContentLoaded", reg, { once: true });
})();
