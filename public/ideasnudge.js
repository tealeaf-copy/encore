// "Ideas to try", where people feel stuck (owner request). Calm: plain text rows, at most 4, and a "More ideas" link.
// The ideas come from the ideas library (GET /api/public/ideas/try, server/ideasnudge.js), local and seasonal, matched
// to what the host has made before or the interests they picked.
//
//   PLIdeas.row(el, { input })       "Not sure? Try one:" and 3 or 4 one-tap ideas under a text box; a tap fills `input`
//                                     (a textarea or input) with the idea's sentence. Or pass onPick(idea) instead.
//   PLIdeas.list(el, { lead, n })    a short list for empty states ("Nothing near you yet. Be the first: try one of
//                                     these"), each with Host this, which starts a prefilled draft
//   PLIdeas.start(idea)              start a draft from an idea: the app's idea flow (/?app=1&idea=…), or sign up first
//   PLIdeas.fetch({ n })             the ideas themselves
(function () {
  if (window.PLIdeas) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const interests = () => { try { const p = JSON.parse(localStorage.getItem("pl.interests") || "null"); return (Array.isArray(p) ? p : p?.interests || []).join(","); } catch { return ""; } };
  async function fetchIdeas({ n = 4 } = {}) { try { const r = await fetch(`/api/public/ideas/try?n=${n}&interests=${encodeURIComponent(interests())}`, { credentials: "same-origin" }); return r.ok ? (await r.json()).ideas || [] : []; } catch { return []; } }
  function css() { if (document.getElementById("plIdeasCss")) return; const s = document.createElement("style"); s.id = "plIdeasCss"; s.textContent = `
.pli-row{margin:12px 0 0}.pli-row p{margin:0 0 6px;color:#665A51;font:500 13px/1.3 "IBM Plex Sans",system-ui,sans-serif}
.pli-opts{display:flex;flex-wrap:wrap;gap:8px}.pli-opts button{min-height:36px;padding:0 14px;border-radius:999px;border:1.5px solid #E4D9C8;background:#FFFCF7;color:#1F1A17;font:500 14px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pli-opts button:hover{border-color:#D9CCBB}.pli-opts button:focus-visible,.pli-list button:focus-visible,.pli-more:focus-visible{outline:3px solid #1F1A17;outline-offset:2px}
.pli-more{display:inline-flex;align-items:center;min-height:36px;color:#B04A30;font:600 14px "IBM Plex Sans",system-ui,sans-serif;text-decoration:none}
.pli-box{border:1.5px solid #E4D9C8;border-radius:16px;background:#FFFCF7;padding:16px;margin:16px 0}.pli-box h3{margin:0 0 4px;font:600 16px/1.3 Fredoka,"IBM Plex Sans",system-ui,sans-serif;color:#1F1A17}.pli-box>p{margin:0 0 8px;color:#665A51;font-size:14px}
.pli-list{list-style:none;margin:0;padding:0}.pli-list li{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1.5px solid #E4D9C8}.pli-list li:first-child{border-top:0}
.pli-list span{flex:1;min-width:0}.pli-list b{display:block;font:600 15px/1.3 "IBM Plex Sans",system-ui,sans-serif;color:#1F1A17}.pli-list small{display:block;color:#665A51;font-size:13px;line-height:1.35}
.pli-list button{flex:none;min-height:40px;padding:0 14px;border-radius:999px;border:1.5px solid #D9CCBB;background:#fff;color:#1F1A17;font:600 14px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}
`; document.head.appendChild(s); }
  function start(x) { try { localStorage.removeItem("pl.hostLike"); localStorage.setItem("pl.hostIdea", JSON.stringify({ id: x.id, title: x.title || "", at: Date.now() })); } catch {}
    location.href = /(?:^|;\s*)encore_in=1/.test(document.cookie) ? "/?app=1&idea=" + encodeURIComponent(x.id) : "/signup?mode=friends&from=idea&idea=" + encodeURIComponent(x.id); }
  async function row(el, { input = null, onPick = null, n = 4, label = "Not sure? Try one:" } = {}) {
    if (!el) return []; css(); const L = (await fetchIdeas({ n })).slice(0, 4); if (!L.length) { el.hidden = true; return []; }
    el.classList.add("pli-row"); el.hidden = false;
    el.innerHTML = `<p>${esc(label)}</p><div class="pli-opts">${L.map((x, i) => `<button type="button" data-pli="${i}" title="${esc(x.line)}">${esc(x.title)}</button>`).join("")}<a class="pli-more" href="/ideas">More ideas</a></div>`;
    el.querySelectorAll("[data-pli]").forEach((b) => (b.onclick = () => { const x = L[+b.dataset.pli]; if (onPick) return onPick(x);
      if (input) { input.value = x.say; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch {} } }));
    return L; }
  async function list(el, { lead = "Ideas to try", sub = "", n = 3, bare = false } = {}) {
    if (!el) return []; css(); const L = (await fetchIdeas({ n })).slice(0, Math.min(4, n)); if (!L.length) { el.hidden = true; return []; }
    el.hidden = false; el.innerHTML = `<div class="${bare ? "" : "pli-box"}">${bare ? "" : `<h3>${esc(lead)}</h3>`}${sub ? `<p>${esc(sub)}</p>` : ""}<ul class="pli-list">${L.map((x, i) => `<li><span><b>${esc(x.title)}</b><small>${esc(x.line)}</small></span><button type="button" data-plh="${i}">Host this</button></li>`).join("")}</ul><a class="pli-more" href="/ideas">More ideas</a></div>`;
    el.querySelectorAll("[data-plh]").forEach((b) => (b.onclick = () => start(L[+b.dataset.plh]))); return L; }
  window.PLIdeas = { row, list, start, fetch: fetchIdeas };
})();
