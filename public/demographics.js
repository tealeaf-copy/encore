// Settings: "Help hosts and brands understand who comes" (server/paidinsights.js, phase two of Paid Insights).
// Opt in only, off by default. Each field says why it's asked and has its own Remove; "Remove all" deletes the record.
// Answers only ever count in totals of ENCORE_INSIGHTS_K (25) or more people. Fills #plDemoSet when signed in.
(function () {
  const el = document.getElementById("plDemoSet"); if (!el || el.dataset.on) return; el.dataset.on = "1";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = (method, body) => fetch("/api/me/demographics", { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't save. Try again."); return j; });
  if (!document.getElementById("plDemoCss")) { const s = document.createElement("style"); s.id = "plDemoCss"; s.textContent = `
#plDemoSet .dm-f{border-top:1.5px solid var(--pl-line,#CFC8B9);padding:12px 0}#plDemoSet .dm-f:first-of-type{border-top:0}
#plDemoSet .dm-f b{display:block;font-size:15px}#plDemoSet .dm-f .why{display:block;color:var(--pl-soft,#444845);font-size:13px;margin:2px 0 8px}
#plDemoSet .dm-c{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#plDemoSet select,#plDemoSet input[type=text]{flex:1 1 200px;min-width:0;min-height:44px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:6px;padding:0 10px;font:16px var(--pl-font-text,"IBM Plex Sans",sans-serif);background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C)}
#plDemoSet .chips{display:flex;flex-wrap:wrap;gap:8px}#plDemoSet .chips label{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;font-size:14px;cursor:pointer}
#plDemoSet .chips input{width:18px;height:18px;accent-color:var(--pl-accent,#29489A)}#plDemoSet .chips label:has(input:checked){border-color:var(--pl-accent,#29489A);background:var(--pl-accent-soft,#E3E8F4)}
#plDemoSet .dm-rm{min-height:44px;padding:0 12px;border-radius:6px;border:1.5px solid var(--pl-line-strong,#1B1D1C);background:transparent;color:var(--pl-ink,#1B1D1C);font:600 14px var(--pl-font-text,"IBM Plex Sans",sans-serif);cursor:pointer}
#plDemoSet .dm-msg{min-height:20px;font-size:13px;color:var(--pl-soft,#444845);margin:8px 0 0}`; document.head.appendChild(s); }
  let V = null;
  function draw() { if (!V?.signedIn || !V.enabled) { el.hidden = true; return; } el.hidden = false; const A = V.answers || {};
    el.innerHTML = `<h2 id="hDemo">Help hosts and brands understand who comes</h2><p>Optional, and off unless you turn it on. If you do, a few answers about you count in totals that hosts and brands see, like "35% of people at supper clubs in Austin are 25 to 34". A total shows only when ${V.k} or more people are in it, never with your name, and nobody sees your answers. Remove one, or all of them, any time. <a href="/privacy#insights">What we collect and why</a></p>
      <div class="row"><span>Count my answers in totals<small>Off by default. Turning it off deletes your answers.</small></span><input type="checkbox" class="sw" id="dmOn" aria-label="Count my answers in totals"${V.on ? " checked" : ""}></div>
      ${V.on ? `<div>${V.fields.map((f) => { const v = A[f.key], has = v != null && !(Array.isArray(v) && !v.length);
        const ctl = f.text ? `<input type="text" maxlength="${f.text}" data-dm="${f.key}" value="${esc(v || "")}" placeholder="Your neighbourhood" autocomplete="off" aria-label="${esc(f.label)}">`
          : f.multi ? `<div class="chips" role="group" aria-label="${esc(f.label)}">${f.options.map(([k, l]) => `<label><input type="checkbox" data-dmc="${f.key}" value="${esc(k)}"${(v || []).includes(k) ? " checked" : ""}>${esc(l)}</label>`).join("")}</div>`
          : `<select data-dm="${f.key}" aria-label="${esc(f.label)}"><option value="">Not answered</option>${f.options.map(([k, l]) => `<option value="${esc(k)}"${v === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
        return `<div class="dm-f"><b>${esc(f.label)}</b><span class="why">Why we ask: ${esc(f.why)}</span><div class="dm-c">${ctl}${has ? `<button type="button" class="dm-rm" data-rm="${f.key}" aria-label="Remove ${esc(f.label)}">Remove</button>` : ""}</div></div>`; }).join("")}
        <div class="dm-c" style="margin-top:8px"><button type="button" class="btn danger sm" id="dmAll" style="min-height:44px">Remove all my answers</button></div></div>` : ""}<p class="dm-msg" id="dmMsg" role="status"></p>`;
    const msg = (t) => { const m = document.getElementById("dmMsg"); if (m) m.textContent = t; };
    const save = async (answers, done = "Saved.") => { try { V = { signedIn: true, ...(await api("POST", { answers })) }; draw(); msg(done); } catch (e) { msg(e.message); } };
    document.getElementById("dmOn").onchange = async (e) => { try { V = { signedIn: true, ...(await api("POST", e.target.checked ? { answers: {} } : { on: false })) }; draw(); msg(e.target.checked ? "On. Add any answers you like." : "Off. Your answers are deleted."); } catch (er) { msg(er.message); e.target.checked = !e.target.checked; } };
    el.querySelectorAll("select[data-dm]").forEach((s) => (s.onchange = () => save({ [s.dataset.dm]: s.value || null })));
    el.querySelectorAll("input[data-dm]").forEach((s) => (s.onchange = () => save({ [s.dataset.dm]: s.value.trim() || null })));
    el.querySelectorAll("[data-dmc]").forEach((c) => (c.onchange = () => { const k = c.dataset.dmc, L = [...el.querySelectorAll(`[data-dmc="${k}"]:checked`)].map((x) => x.value); if (L.length > 5) { c.checked = false; msg("Up to 5."); return; } save({ [k]: L.length ? L : null }); }));
    el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => save({ [b.dataset.rm]: null }, "Removed.")));
    const all = document.getElementById("dmAll"); if (all) all.onclick = async () => { try { V = { signedIn: true, ...(await api("DELETE")) }; draw(); msg("All your answers are deleted."); } catch (e) { msg(e.message); } }; }
  api("GET").then((j) => { V = j; draw(); }).catch(() => { el.hidden = true; });
})();
