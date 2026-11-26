// "Host one like this" (server/hostlike.js). Any element with data-pl-like="<eventId>" opens it: signed out, signup
// first (the event waits in this browser, like an idea's "Host this" in public/inspo.js); signed in, the app, where
// Potto drafts a new event from the event's title, kind, rough price and size, in the visitor's own city. Never the
// address or anyone's name. The draft is remembered against the event it came from, so the event can say
// "3 people hosted this after seeing it" (data-pl-hosted="<eventId or idea id>" placeholders are filled here).
// Also: the button on a past invite (/g), and the draft itself on the app's home (?like=<id>).
(function () {
  if (window.PLHostLike) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const ID = /^[A-Za-z0-9_-]{2,80}$/, KEY = /^[A-Za-z0-9_-]{2,120}$/;
  const ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  const CSS = `.hl-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border:2px solid #1F1A17;border-radius:999px;background:#C94A30;color:#fff;font:600 16px var(--sys-title);cursor:pointer;box-shadow:2px 2px 0 #1F1A17;text-decoration:none;transition:transform .15s}
.hl-btn:hover{transform:translateY(-1px) rotate(-1deg)}.hl-btn.sm{min-height:40px;padding:0 14px;font-size:15px;box-shadow:none}
.hl-count{margin:6px 0 0;color:#665A51;font:600 13.5px/1.35 "Instrument Sans",system-ui,sans-serif}.hl-count:empty{display:none}
.hl-box{display:grid;gap:4px;justify-items:start;margin:14px 0;padding:14px;border:2px dashed #E4D9C8;border-radius:18px;background:#FFF8EE}
.hl-box b{font:600 17px var(--sys-title);color:#1F1A17}.hl-box p{margin:0;color:#665A51;font:500 14px/1.4 "Instrument Sans",system-ui,sans-serif}
@media (prefers-reduced-motion:reduce){.hl-btn{transition:none}}`;
  const css = () => { if ($("#hlCss")) return; const s = document.createElement("style"); s.id = "hlCss"; s.textContent = CSS; document.head.appendChild(s); };

  /** Open "Host one like this" for an event. */
  function go(id, title = "") { if (!ID.test(id || "")) return; ls.del("pl.hostIdea"); ls.set("pl.hostLike", { id, title: String(title || "").slice(0, 80), at: Date.now() });
    location.href = signed() ? "/?app=1&like=" + encodeURIComponent(id) : "/signup?mode=friends&from=like&like=" + encodeURIComponent(id); }
  document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-pl-like]"); if (!b) return; e.preventDefault(); e.stopPropagation(); go(b.dataset.plLike, b.dataset.title || ""); }, true);
  const button = (id, { title = "", sm = false } = {}) => { css(); return `<button type="button" class="hl-btn${sm ? " sm" : ""}" data-pl-like="${esc(id)}" data-title="${esc(title)}"><i class="gl" style="--g:var(--g-spark)" aria-hidden="true"></i> Host one like this</button>`; };

  // ---- "3 people hosted this after seeing it": fill the placeholders, a few at a time ----
  const known = new Map(); let fillT = 0;
  function fill() { clearTimeout(fillT); fillT = setTimeout(async () => { const els = [...document.querySelectorAll("[data-pl-hosted]")].filter((x) => !x.dataset.done && KEY.test(x.dataset.plHosted));
    const want = [...new Set(els.map((x) => x.dataset.plHosted))].filter((k) => !known.has(k)).slice(0, 40);
    if (want.length) { try { const j = await (await fetch("/api/public/like-counts?ids=" + encodeURIComponent(want.join(",")))).json(); for (const k of want) known.set(k, +j.counts?.[k] || 0); } catch { for (const k of want) known.set(k, 0); } }
    for (const x of els) { if (!known.has(x.dataset.plHosted)) continue; const n = known.get(x.dataset.plHosted); x.dataset.done = "1"; if (n >= 1) { x.textContent = `${n} ${n === 1 ? "person" : "people"} hosted this after seeing it`; x.hidden = false; } } }, 200); }
  new MutationObserver(() => { if (document.querySelector("[data-pl-hosted]:not([data-done])")) fill(); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- a past invite on /g: under "You missed this one" (or the wrap-up), the button and the count ----
  async function onPast() { if (location.pathname !== "/g") return; const e = window.__gEv, today = new Date().toISOString().slice(0, 10);
    if (!e?.id || !e.date || e.date >= today || e.example || $("#hlPast")) return; const at = $("#recap") || $("#view-guest .invite") || $("#view-guest h1"); if (!at) return;
    const box = document.createElement("div"); box.id = "hlPast"; box.className = "hl-box"; at.after(box); css();
    let j = null; try { j = await (await fetch("/api/public/like/" + encodeURIComponent(e.id))).json(); } catch {}
    if (!j?.ok) { box.remove(); return; }
    box.innerHTML = `<b>Want one where you live?</b><p>Potto starts a draft like this one. You pick the day and the place.</p>${button(e.id, { title: j.title })}${j.line ? `<p class="hl-count">${esc(j.line)}</p>` : ""}`; }
  if (location.pathname === "/g") new MutationObserver(() => { clearTimeout(window.__hlT); window.__hlT = setTimeout(onPast, 250); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- the app's home: the draft, once the app is ready (the way index.html's "Host this" opens an idea) ----
  function inApp() {
    if (location.pathname !== "/" || !signed()) return; const q = new URLSearchParams(location.search), welcome = !!(q.get("welcome") || window.__welcome);
    let id = q.get("like") || ""; if (!id && welcome) { const L = ls.get("pl.hostLike"); if (L?.id && Date.now() - (L.at || 0) < 3 * 864e5) id = L.id; }
    // an idea's "Host this" (index.html's hooks block opens it): count it against the idea once the draft exists
    const idea = q.get("idea") || (welcome ? ls.get("pl.hostIdea")?.id : "") || "";
    const ready = (fn) => { let n = 0; const t = setInterval(() => { n++; if (((typeof dbReady !== "undefined" && dbReady) && window.__wsDone) || n > 60) { clearInterval(t); fn(); } }, 150); };
    const D = () => (typeof draft !== "undefined" ? draft : null); // the app's open event (index.html)
    const recordWhenSaved = (key, before) => { let n = 0; const t = setInterval(() => { const d = D(); if (++n > 60) return clearInterval(t);
      if (!d?.id || d.example || d.id === before) return; clearInterval(t); fetch("/api/me/like/" + encodeURIComponent(key) + "/started", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: d.id }) }).catch(() => {}); }, 500); };
    if (!id && /^(?:idea-|ev-|fl-)[A-Za-z0-9_-]{2,120}$/.test(idea)) { const key = idea.startsWith("idea-") ? idea : idea.replace(/^(?:ev|fl)-/, ""); ready(() => recordWhenSaved(key, D()?.id || "")); return; }
    if (!ID.test(id)) return;
    ready(async () => { ls.del("pl.hostLike"); let j = null; try { j = await (await fetch("/api/public/like/" + encodeURIComponent(id))).json(); } catch {} if (!j?.ok) return;
      if (q.get("like")) { q.delete("like"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
      // the visitor's city: their account's, else what they picked before signing up, else where this browser is
      let city = ""; try { const r = await fetch("/api/me/interests", { credentials: "same-origin" }); if (r.ok) city = String((await r.json()).city || ""); } catch {}
      if (!city) city = String(ls.get("pl.interests")?.city || window.EncorePlace?.get?.()?.city || "");
      const line = [j.kind && !j.title.toLowerCase().includes(j.kind) ? `a ${j.kind}` : "", j.size ? `for ${j.size}` : "with friends", j.price || "", city ? `in ${city.trim().slice(0, 60)}` : ""].filter(Boolean).join(", ").replace(/^(a [^,]+), for/, "$1 for");
      const before = D()?.id || "";
      setTimeout(() => { try { const el = document.createElement("div"); el.dataset.casualidea = j.title; el.dataset.line = line; el.hidden = true; document.body.appendChild(el); el.click(); el.remove();
        setTimeout(() => { try { const d = D(); if (!d) return; if (j.look?.palette?.length) d.look = { palette: j.look.palette, effect: j.look.effect || "none", titleFont: j.look.titleFont || "", buttonEmoji: j.look.buttonEmoji || "", ...(j.look.vibe ? { vibe: j.look.vibe } : {}) };
          if (j.art?.kind && window.EventArt?.valid?.(j.art.kind)) d.coverArt = { kind: j.art.kind, ...(j.art.tone ? { tone: j.art.tone } : {}) };
          if (city && !d.city) d.city = city.trim().slice(0, 60); d.likeOf = id;
          if (typeof saveEvent === "function") saveEvent(true);
          if (typeof toast === "function") toast(`Started from "${j.title}". Change anything you like.`);
          recordWhenSaved(id, before); } catch (err) { console.warn(err); } }, 700); } catch (err) { console.warn(err); } }, welcome ? 1800 : 200); });
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", inApp) : inApp();
  window.PLHostLike = { go, button, fill, css };
})();
