// A way back on pages that have no tab bar of their own (Settings, Community rules, Privacy, Terms): a back chevron at
// the top left. It goes back when you came from Pottery Lab, else to the feed (signed in) or the front page.
(function () {
  if (document.getElementById("plBack")) return;
  const signed = /(?:^|;\s*)encore_in=1/.test(document.cookie);
  let fromUs = false; try { fromUs = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch {}
  const home = signed ? "/feed" : "/";
  const a = document.createElement("a"); a.id = "plBack"; a.href = home; a.className = "pl-back";
  a.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg><span>${fromUs ? "Back" : signed ? "Feed" : "Pottery Lab"}</span>`;
  a.addEventListener("click", (e) => { if (fromUs) { e.preventDefault(); history.back(); } });
  const css = document.createElement("style"); css.textContent = `.pl-back{display:inline-flex;align-items:center;gap:4px;min-height:44px;padding:0 12px 0 4px;margin:max(4px,env(safe-area-inset-top)) 0 0 8px;color:var(--pl-ink,#1B1D1C);font:600 16px "IBM Plex Sans",system-ui,-apple-system,sans-serif;text-decoration:none;border-radius:999px}.pl-back:focus-visible{outline:3px solid #1F1A17;outline-offset:2px}@media (hover:hover){.pl-back:hover{background:#EFE6D8}}`;
  document.head.appendChild(css);
  const put = () => document.body.prepend(a);
  if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
})();
