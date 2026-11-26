// Shared list pages (public/lists.css): the quiet More menus (<details class="ls-more">) close on an outside tap or
// Escape, and only one is open at a time.
(function () {
  if (window.__plLists) return; window.__plLists = 1;
  const all = () => document.querySelectorAll(".ls-more[open]");
  document.addEventListener("click", (e) => all().forEach((d) => !d.contains(e.target) && (d.open = false)));
  document.addEventListener("toggle", (e) => { const d = e.target; if (d?.classList?.contains("ls-more") && d.open) { all().forEach((o) => o !== d && (o.open = false)); fit(d.querySelector(".ls-menu")); } }, true);
  // a menu on a narrow card stays on screen: nudge it in from whichever edge it crosses
  function fit(m) { if (!m) return; m.style.transform = ""; const r = m.getBoundingClientRect(), W = document.documentElement.clientWidth; const dx = r.left < 8 ? 8 - r.left : r.right > W - 8 ? W - 8 - r.right : 0; if (dx) m.style.transform = `translateX(${Math.round(dx)}px)`; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") all().forEach((d) => { d.open = false; d.querySelector("summary")?.focus(); }); });
})();
