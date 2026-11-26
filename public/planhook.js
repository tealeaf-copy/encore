// The plan on the invite (/e/<id>, public/invite.html): for a multi-day plan or one the host laid out, a short
// "The plan" section under the invite, once the guest is in (or when the host made it public). The whole plan is on
// /plans/<id> (public/plan.html). Needs public/timeline.js.
(function () {
  const id = (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || [])[1], T = window.PLTimeline; if (!id || !T) return;
  let proof = null; try { proof = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); } catch {}
  const q = proof?.rid && proof?.code ? `?rid=${encodeURIComponent(proof.rid)}&code=${encodeURIComponent(proof.code)}` : "";
  fetch(`/api/public/plan/${encodeURIComponent(id)}${q}`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { const P = j?.plan; if (!P || P.locked) return;
    const L = P.days.flatMap((d) => d.items.map((x) => ({ ...x, d }))); if (!L.length) return;
    if (!document.querySelector('link[href="/timeline.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/timeline.css"; document.head.appendChild(l); }
    const sec = document.createElement("section"); sec.className = "pl-planhook"; sec.setAttribute("aria-label", "The plan");
    sec.style.cssText = "max-width:560px;margin:8px auto 24px;padding:0 16px";
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })(), today = T.localDay(Date.now(), tz);
    const days = P.days.filter((d) => d.items.length).slice(0, 3).map((d) => ({ ...d, items: d.items.slice(0, 4) }));
    sec.innerHTML = `<h2 style="display:flex;justify-content:space-between;align-items:baseline;margin:0;padding-bottom:6px;border-bottom:var(--pl-rule,1.5px solid var(--pl-ink));font:600 18px/1.3 var(--pl-font-text)">The plan<small style="font:500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--pl-soft)">${T.esc(P.chip)}</small></h2>${T.itineraryHtml(days, { today })}<p style="margin:8px 0 0"><a href="/plans/${encodeURIComponent(id)}" style="display:inline-flex;align-items:center;min-height:44px;font:500 15px var(--pl-font-text);color:var(--pl-accent-text)">See the whole plan</a></p>`;
    const m = document.getElementById("m"); (m?.parentNode || document.body).insertBefore(sec, m ? m.nextSibling : null);
  }).catch(() => {});
})();
