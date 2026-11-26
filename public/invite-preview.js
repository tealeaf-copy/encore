// The create canvas's live guest preview: the real light invite (public/invite.html at /e/_preview), drawn from the
// host's draft. The canvas (public/canvas.js) posts { plPreview: { e, H, flash } } on every edit; this draws it with the
// invite's own render(), so the preview is the page guests get, not a copy of it. Nothing here sends anything: replies,
// links and the share button are inert. A feeler (stage "interest") gets the vote the full invite shows for it.
(function () {
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (iso) => { const d = new Date(iso + "T12:00:00"); return isNaN(d) ? iso : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  // the words the full invite uses for a feeler (index.html, "interest stage: a would you come? vote")
  function feeler(e) { const f = $("#f"); if (!f) return; const h = $("h2.ask", f); if (h) h.textContent = "Would you come?";
    const opts = (e.dateOptions || []).slice(0, 3), r = $(".resp", f);
    const html = `<div class="resp" role="radiogroup" aria-label="Would you come?"><label><input type="radio" name="r" value="in" checked> I'm in</label><label><input type="radio" name="r" value="maybe"> Maybe</label><label><input type="radio" name="r" value="no"> Can't go</label></div>${opts.length ? `<p class="muted" style="margin:10px 0 6px">Which dates work? Tap all that do.</p><div class="resp">${opts.map((o) => `<label><input type="checkbox"> ${esc(day(o))}</label>`).join("")}</div>` : ""}<p class="muted">Nothing's booked yet. If enough people are in, your host makes it real and lets you know.</p>`;
    if (r) r.outerHTML = html; const s = $("#send"); if (s) s.textContent = "Send";
    const w = $("#m .facts > div:first-child > b"); if (w) w.textContent = opts.length ? opts.map(day).join(", ") : "Date to be picked"; }
  const CSS = "@keyframes pvFlash{0%{box-shadow:0 0 0 0 rgba(154,65,40,0)}25%{box-shadow:0 0 0 4px rgba(154,65,40,.35)}100%{box-shadow:0 0 0 0 rgba(154,65,40,0)}}.pv-flash{animation:pvFlash 1.1s ease-out;border-radius:12px}@media (prefers-reduced-motion:reduce){.pv-flash{animation:none;outline:2px solid rgba(154,65,40,.5)}}";
  window.InvitePreview = function (render) {
    // the page's helpers ask the server about this event (spots, tables, a lineup); a draft has none yet
    const F0 = window.fetch; window.fetch = (u, o) => (/\/_preview\b/.test(String(u && u.url || u)) ? Promise.resolve(new Response("null", { status: 404 })) : F0(u, o));
    document.documentElement.classList.add("pv"); const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    // inert: a preview never replies, follows or leaves the page
    for (const t of ["submit", "click"]) document.addEventListener(t, (x) => { const a = x.target.closest?.("a[href]:not([href^='#']),button.go,#send,form button[type=submit]"); if (t === "submit" || a) { x.preventDefault(); x.stopPropagation(); } }, true);
    let last = "";
    addEventListener("message", (m) => { const P = m.origin === location.origin && m.data && m.data.plPreview; if (!P || !P.e) return;
      const sig = JSON.stringify([P.e, P.H]); if (sig !== last) { last = sig; const y = scrollY; window.__pvEv = P.e;
        $$("body > .stick, #menuCard").forEach((n) => n.remove());
        try { render({ ...P.e, id: "_preview", casual: true }, "_preview", P.H || {}, { count: 0, attendees: [] }, null); } catch (err) { console.warn(err); }
        if (P.e.stage === "interest") feeler(P.e);
        scrollTo(0, y); }
      const f = P.flash && $(P.flash); if (f) { f.classList.remove("pv-flash"); void f.offsetWidth; f.classList.add("pv-flash"); if (P.scroll) f.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } });
    parent.postMessage({ plPreviewReady: 1 }, location.origin); };
})();
