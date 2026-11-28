// Report, Share and the host line with Follow on the guest event pages (the light invite /e/<id>, the full invite /g#rsvp-<id>),
// loaded when tapped so the invite stays small (Help is main's own [data-help] link, public/report.js): <a data-lz="report">
// opens Report and Block for this event and its host (public/safety.js), [data-lz="share"] opens the share sheet
// (public/sharekit.js). On the light invite a Share button joins the Save row (public/friendsgoing.js draws that row
// and may redraw it; the button comes back each time). The host comes from the page's Follow button.
(function () {
  if (window.__eventExtras) return; window.__eventExtras = 1;
  const load = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  const eventId = () => (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || location.hash.match(/^#rsvp-([A-Za-z0-9_]+)/) || [])[1] || "";
  document.addEventListener("click", async (v) => { const a = v.target.closest?.("[data-lz]"); if (!a) return; v.preventDefault();
    try {
      const k = a.dataset.lz;
      if (k === "share") { if (!window.ShareKit) await load("/sharekit.js"); await window.ShareKit?.open({ eventId: eventId() }); return; }
      if (!window.EncoreSafety) await load("/safety.js");
      const f = document.querySelector("[data-pl-follow]"); // the host, so Block is offered too
      window.EncoreSafety?.open({ type: "event", target: "event:" + eventId(), handle: f?.dataset.plFollow || "", name: f?.dataset.name || f?.closest(".hrow")?.querySelector("b")?.textContent || "" });
    } catch {} });
  // ---- the light invite (/e/<id>): it stays under its size cap, so these parts are drawn here. They go in from a
  // MutationObserver callback, which runs before the browser paints the invite's redraw, so nothing moves under a thumb.
  const LIGHT = /^\/[ei]\//.test(location.pathname), PREVIEW = location.pathname === "/e/_preview";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // the host line: the host's face and name open their page; Follow follows in place (the host comes from the invite's
  // own read of /api/public/event-host, kept as self.__H). No Follow in the host's own canvas preview.
  const hostRow = () => { const h = self.__H, at = document.querySelector("#m > .facts"); if (!at || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(h?.handle || "") || document.querySelector("#m .hrow")) return;
    const name = h.name || (document.querySelector("#m > .kicker a")?.textContent || "").trim() || "The host", d = document.createElement("div"); d.className = "hrow";
    d.innerHTML = `<a href="/@${esc(h.handle)}"><span class="hav">${/^(\/_blob\/[A-Za-z0-9_-]{6,80}|https:\/\/[^\s"'<>()]+)$/.test(h.avatarUrl || "") ? `<img src="${esc(h.avatarUrl)}" alt="">` : esc(name[0])}</span><b>${esc(name)}</b></a>${PREVIEW ? "" : `<button type="button" class="plf-btn" data-pl-follow="${esc(h.handle)}" data-name="${esc(name)}" aria-pressed="false">Follow</button>`}`;
    at.after(d); };
  // Report at the foot of the page, beside the footer's Help
  const foot = () => { const f = document.querySelector("footer.legal"); if (!f || PREVIEW || f.querySelector("[data-lz]")) return; f.insertAdjacentHTML("beforeend", `<a href="#" data-lz="report">Report</a>`); };
  // Share beside Save and Save to list
  const SHARE = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12.5V3.5M6.5 7 10 3.5 13.5 7M4.5 10.5v6h11v-6"/></svg>`;
  const share = () => { if (PREVIEW) return; const row = document.querySelector("#m > .plf"); if (!row || row.querySelector('[data-lz="share"]')) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "pls-btn"; b.dataset.lz = "share"; b.innerHTML = `${SHARE}<span>Share</span>`; row.appendChild(b); };
  const place = () => { if (!LIGHT) return; try { hostRow(); foot(); share(); } catch {} };
  const watch = () => { place(); new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    if (!window.PLFollow && !document.querySelector('script[src="/follow.js"]')) load("/follow.js").catch(() => {}); }; // the shared Follow (window.PLFollow)
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", watch) : watch();
})();
// ---- story prompts (public/storyprompt.js): "Add a photo from the night" on a past event's invite, for someone who went ----
(function () { try { if (window.__plStoryLoad || window.StoryPrompt || location.pathname === "/e/_preview" || !/^\/[ei]\//.test(location.pathname)) return; window.__plStoryLoad = 1;
  const go = () => { const s = document.createElement("script"); s.src = "/storyprompt.js"; s.defer = true; document.head.appendChild(s); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); } catch {} })();
// ---- delight after (public/delightafter.js): the morning-of card, live photos and "How was it?" on the guest event pages ----
(function () { try { if (window.__plDelightLoad || location.pathname === "/e/_preview" || !/^\/([ei]\/|g$)/.test(location.pathname)) return; window.__plDelightLoad = 1;
  const go = () => { const s = document.createElement("script"); s.src = "/delightafter.js"; s.defer = true; document.head.appendChild(s); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go(); } catch {} })();
