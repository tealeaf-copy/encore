// Address search for any place field: type a few letters, pick a suggestion, and the address, city and map pin fill in.
// EncorePlaces.attach(input, { onPick(place) }) . place = { label, name, street, city, hood, postcode, country, lat, lng }
(function () {
  if (window.EncorePlaces) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let css = false; function style() { if (css) return; css = true; const s = document.createElement("style"); s.textContent = `
.ps-list{position:absolute;z-index:10000;min-width:240px;max-width:min(520px,92vw);background:#fff;color:#1F1A17;border:2px solid #1F1A17;border-radius:14px;box-shadow:0 2px 8px rgba(31,26,23,.08);padding:4px;margin:0;list-style:none;font:14px/1.35 "Instrument Sans",system-ui,sans-serif;max-height:300px;overflow:auto}
.ps-list li{display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border-radius:10px;cursor:pointer}.ps-list li[aria-selected=true],.ps-list li:hover{background:#FFF3C4}
.ps-list li b{display:block;font-weight:600}.ps-list li small{display:block;color:#6B5F56;font-size:13px}.ps-list .ps-pin{flex:none}.ps-list .ps-foot{font-size:13px;color:#8A7D73;padding:4px 10px;cursor:default}.ps-list .ps-foot:hover{background:none}`; document.head.appendChild(s); }
  function bias() { try { const c = window.EncorePlace?.find(window.EncorePlace?.get()?.city || ""); return c ? { lat: c[1], lng: c[2] } : null; } catch { return null; } }
  function attach(input, { onPick, citiesOnly = false } = {}) {
    if (!input || input.dataset.ps) return; input.dataset.ps = 1; style(); input.setAttribute("autocomplete", "off"); input.setAttribute("data-1p-ignore", ""); input.setAttribute("data-lpignore", "true"); input.setAttribute("aria-autocomplete", "list");
    const list = document.createElement("ul"); list.className = "ps-list"; list.setAttribute("role", "listbox"); list.hidden = true; document.body.appendChild(list);
    let items = [], sel = -1, t = 0, seq = 0;
    const place = () => { const r = input.getBoundingClientRect(); list.style.left = r.left + scrollX + "px"; list.style.top = r.bottom + scrollY + 6 + "px"; list.style.width = Math.max(240, r.width) + "px"; };
    const close = () => { list.hidden = true; sel = -1; };
    const draw = () => { if (!items.length) return close(); place(); list.innerHTML = items.map((p, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="ps-pin">📍</span><span><b>${esc(p.name || p.label)}</b><small>${esc(p.label === p.name ? p.country || "" : p.label)}</small></span></li>`).join("") + `<li class="ps-foot" aria-hidden="true">Addresses from OpenStreetMap</li>`; list.hidden = false;
      list.querySelectorAll("li[data-i]").forEach((li) => li.onmousedown = (e) => { e.preventDefault(); pick(+li.dataset.i); }); };
    const pick = (i) => { const p = items[i]; if (!p) return; input.value = citiesOnly ? (p.city || p.name) : (p.street ? [p.name !== p.street ? p.name : "", p.street].filter(Boolean).join(", ") : p.name || p.label); input.dispatchEvent(new Event("input", { bubbles: true })); close(); onPick && onPick(p); input.dispatchEvent(new Event("change", { bubbles: true })); };
    const local = (q) => (window.EncorePlace?.CITIES || []).filter((c) => c[0].toLowerCase().startsWith(q.toLowerCase())).slice(0, 6).map((c) => ({ label: c[0], name: c[0], city: c[0], lat: c[1], lng: c[2] }));
    input.addEventListener("input", (e) => { if (e.isTrusted === false && !e.inputType) return; const q = input.value.trim(); clearTimeout(t); if (q.length < 3) { items = q.length >= 2 ? local(q) : []; return draw(); }
      t = setTimeout(async () => { const my = ++seq, b = bias(); try { const r = await fetch(`/api/places?q=${encodeURIComponent(q)}${b ? `&lat=${b.lat}&lng=${b.lng}` : ""}`); const j = await r.json(); if (my !== seq) return; let P = j.places || []; if (citiesOnly) P = P.filter((p) => p.city || /city|town|village/.test(p.kind)); const seen = new Set(); P = P.filter((x) => { const k = x.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); items = P.length ? P : local(q); } catch { items = local(q); } sel = -1; draw(); }, 220); });
    input.addEventListener("keydown", (e) => { if (list.hidden) return; if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); e.stopPropagation(); pick(sel); } else if (e.key === "Escape") close(); }, true);
    input.addEventListener("blur", () => setTimeout(close, 150)); addEventListener("scroll", () => { if (!list.hidden) place(); }, true);
  }
  window.EncorePlaces = { attach };
})();
