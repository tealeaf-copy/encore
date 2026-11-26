// Home to-dos the server works out (GET /api/host/nudges), shown as a card at the top of the host's Home.
// Today there's one: a shared event that's link only (or on the page but off Discover) gets "Show it on Discover", one tap, once per event.
// Loaded by /shell.js for signed-in hosts on the app. Nothing shows when the server has nothing to say.
(function () {
  if (window.__plNudges) return; window.__plNudges = 1;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CSS = `.pln{position:relative;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:center;margin:0 0 16px;padding:14px 16px;background:#FFFDF8;border:2px solid #1F1A17;border-radius:18px;box-shadow:3px 3px 0 #1F1A17;color:#1F1A17;font:15px/1.4 "Instrument Sans",system-ui,sans-serif}
.pln .pln-e{grid-row:span 2;font-size:28px;line-height:1}.pln b{font:600 17px/1.2 Fredoka,"Instrument Sans",system-ui,sans-serif}.pln p{margin:0;color:#5E534B}
.pln .pln-acts{grid-column:1/-1;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px}
.pln .pln-go{min-height:44px;padding:0 18px;border:2px solid #1F1A17;border-radius:999px;background:#C94A30;color:#fff;font:600 15px "Instrument Sans",system-ui;cursor:pointer;box-shadow:2px 2px 0 #1F1A17}.pln .pln-go:disabled{background:#EFE6D8;color:#4A3F37;box-shadow:none}
.pln .pln-no{min-height:44px;background:none;border:0;color:#5E534B;text-decoration:underline;font:500 15px "Instrument Sans",system-ui;cursor:pointer}
.pln .pln-go:focus-visible,.pln .pln-no:focus-visible{outline:3px solid #C94A30;outline-offset:2px}`;
  const css = () => { if (document.getElementById("plnCss")) return; const s = document.createElement("style"); s.id = "plnCss"; s.textContent = CSS; document.head.appendChild(s); };
  let N = null;
  async function load() { try { const r = await fetch("/api/host/nudges", { credentials: "same-origin" }); if (!r.ok) return null; return await r.json(); } catch { return null; } }
  const p1And = (L) => L.length < 2 ? L.join("") : L.slice(0, -1).join(", ") + " and " + L[L.length - 1];
  const finishUrl = (d) => "/@" + encodeURIComponent(d.handle || "") + "?customize=1";
  // d.unlisted: link only (only people with the link). Otherwise it's on the host's page already, just not on Discover.
  function card(d) { const head = d.unlisted ? `${esc(d.title)} is link only` : `${esc(d.title)} is on your page`,
      line = d.unlisted ? "Only people with the link can find it. Put it on Discover and your page so people nearby can find it too." : "Followers see it. Put it on Discover so people nearby find it too.";
    return `<section class="pln" id="plnDiscover" aria-label="Show it on Discover"><span class="pln-e" aria-hidden="true">📍</span><b>${head}</b><p>${line}</p>
    <div class="pln-acts"><button type="button" class="pln-go" data-pln-show>Show it on Discover</button><button type="button" class="pln-no" data-pln-no>Not now</button></div></section>`; }
  // after Show it on Discover: on Discover now, or (the page isn't ready) what the page still needs, as the share step says it
  function doneCard(d) { const gaps = (d.gaps || []).length ? d.gaps : ["a line about you", "a face or photo"];
    return d.pageReady !== false ? `<section class="pln" id="plnDiscover" role="status"><span class="pln-e" aria-hidden="true">🎉</span><b>It's on Discover</b><p>${esc(d.title)} is on Discover and your page now.</p></section>`
      : `<section class="pln" id="plnDiscover" role="status"><span class="pln-e" aria-hidden="true">📍</span><b>Almost on Discover</b><p>Add ${esc(p1And(gaps))} so it shows on Discover.</p><div class="pln-acts"><a class="pln-go" href="${finishUrl(d)}" style="display:inline-flex;align-items:center;text-decoration:none">Finish your page</a></div></section>`; }
  let DONE = null;
  async function act(show) { const el = document.getElementById("plnDiscover"), d = N?.discover; if (!el || !d) return; const go = el.querySelector("[data-pln-show]"); go.disabled = true;
    try { const r = await fetch("/api/host/nudges/discover", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: d.eventId, show }) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { go.disabled = false; el.querySelector("p").textContent = j.message || "That didn't work. Try again."; return; }
      N.discover = null; if (show) { DONE = doneCard(d); el.outerHTML = DONE; if (d.pageReady !== false) setTimeout(() => { DONE = null; document.getElementById("plnDiscover")?.remove(); }, 5000); } else el.remove();
    } catch { go.disabled = false; } }
  // the Home view is drawn by the app; put the card on top of it whenever it's showing (the done state too, until it times out)
  function paint() { const v = document.getElementById("view-programs"); if (!v || v.hidden || !(N?.discover || DONE)) return; if (document.getElementById("plnDiscover")) return; css();
    if (!N?.discover) { v.insertAdjacentHTML("afterbegin", DONE); return; }
    v.insertAdjacentHTML("afterbegin", card(N.discover)); const el = document.getElementById("plnDiscover");
    el.querySelector("[data-pln-show]").onclick = () => act(true); el.querySelector("[data-pln-no]").onclick = () => act(false); }
  async function start() { N = await load(); if (!N?.discover) return; paint();
    const mo = new MutationObserver(() => { clearTimeout(window.__plnT); window.__plnT = setTimeout(paint, 120); }); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] }); }
  window.PLNudges = { load, card, doneCard, paint };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
