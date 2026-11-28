// ---- highlights on a host's page (server/storyapprove.js): the rings a host kept, under the page's header ----
// Visitors see only what they may see (the server filters every photo and recap for whoever is looking); there is no
// editor here: the owner changes highlights in Your stories. A tap opens the feed's story viewer (public/feedvisual.js),
// fetched on the first tap.
(function () {
  const m = /^\/@([a-z0-9][a-z0-9-]{1,29})$/.exec(location.pathname); if (!m || window.__plHighlights) return; window.__plHighlights = 1;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CSS_TEXT = `.hl-row{display:flex;gap:14px;overflow-x:auto;margin:16px 0 4px;padding:4px 2px 8px;scrollbar-width:none}.hl-row::-webkit-scrollbar{display:none}
.hl-ring{flex:none;display:flex;flex-direction:column;align-items:center;gap:6px;width:80px;min-height:44px;margin:0;padding:0;border:0;background:none;color:var(--pl-ink,#1B1D1C);font:500 13px/1.25 "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
.hl-ring span{display:block;width:64px;height:64px;padding:3px;border:2px solid var(--pl-accent,#29489A);border-radius:50%;box-sizing:border-box}.hl-ring img,.hl-ring i{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;background:var(--pl-sand-soft,#EFEBE2)}
.hl-ring small{max-width:80px;font-size:13px;text-align:center;overflow-wrap:anywhere}.hl-ring:focus-visible{outline:none}.hl-ring:focus-visible span{outline:3px solid var(--pl-ink,#1B1D1C);outline-offset:2px}
html body .fv-sv .fv-sv-top b,html body .fv-sv .fv-sv-top small{color:#fff}`; /* the viewer's own words stay white over the page's heading colours */
  const need = (src) => new Promise((res) => { if (document.querySelector(`script[src^="${src}"]`)) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  const viewer = async () => { if (!window.EventArt) await need("/eventart.js"); if (!window.FeedVisual) await need("/feedvisual.js"); return window.FeedVisual; };
  fetch("/api/public/highlights/" + m[1], { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { const H = (j?.highlights || []).filter((h) => h.items?.length); if (!H.length) return;
    let n = 0; const place = () => { const head = document.querySelector(".head"); if (!head) { if (++n < 40) setTimeout(place, 150); return; } if (document.querySelector(".hl-row")) return;
      const st = document.createElement("style"); st.textContent = CSS_TEXT; document.head.appendChild(st);
      const row = document.createElement("nav"); row.className = "hl-row"; row.setAttribute("aria-label", "Highlights");
      row.innerHTML = H.map((h, i) => `<button type="button" class="hl-ring" data-hl="${i}" aria-label="${esc(h.name)}, a highlight. ${h.items.length} ${h.items.length === 1 ? "story" : "stories"}"><span>${h.thumb ? `<img src="${esc(h.thumb)}" alt="" width="54" height="54">` : "<i></i>"}</span><small>${esc(h.name)}</small></button>`).join("");
      head.after(row);
      row.addEventListener("click", async (e) => { const b = e.target.closest("[data-hl]"); if (!b) return; const V = await viewer(); if (!V) return; const keys = H.map((h, i) => { V.REG.set("hl:" + i, h); return "hl:" + i; }); V.openStories(keys, +b.dataset.hl, b); }); };
    place(); }).catch(() => {});
})();
