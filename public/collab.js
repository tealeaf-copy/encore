// Host-to-host collabs on a storefront: "Got a collab idea?" for other hosts, and "Collabs with …" once one is accepted.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KINDS = [["cohost", "Co-host an event"], ["popup", "Pop up together"], ["swap", "Swap shout-outs"], ["other", "Something else"]];
  let css = false; function style() { if (css) return; css = true; const s = document.createElement("style"); s.textContent = `
.cl-card h3{margin:0 0 4px}.cl-card p{margin:0 0 10px;font-size:14px}.cl-with{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0 0;font-size:14px}.cl-with a{display:inline-flex;gap:6px;align-items:center;border:1px solid currentColor;border-radius:999px;padding:4px 10px 4px 4px;background:transparent;color:inherit;text-decoration:none;opacity:.92}.cl-with a:hover{opacity:1}.cl-with a svg{width:22px;height:22px;border-radius:50%}
.cl-bg{position:fixed;inset:0;background:rgba(20,16,14,.45);display:flex;align-items:flex-end;justify-content:center;z-index:9999}@media (min-width:640px){.cl-bg{align-items:center}}
.cl{background:var(--pl-surface);color:var(--pl-ink);width:min(500px,100%);border-radius:22px 22px 0 0;padding:22px 20px 24px;max-height:92vh;overflow:auto;font:16px/1.45 "Instrument Sans",system-ui,sans-serif}@media (min-width:640px){.cl{border-radius:22px}}
.cl h2{font:600 28px/1.15 var(--sys-display);margin:0 0 6px}.cl p{margin:0 0 12px;color:var(--pl-soft)}.cl form{display:grid;gap:10px}.cl label{display:grid;gap:4px;font-size:13px;font-weight:600}
.cl input,.cl textarea{border:1px solid var(--pl-line);border-radius:12px;padding:10px 12px;font-weight:400;font-size:16px;font-family:inherit;background:#fff}.cl .kinds{display:flex;flex-wrap:wrap;gap:6px}.cl .kinds button{border:1px solid var(--pl-line);background:#fff;border-radius:999px;padding:7px 12px;font-weight:400;font-size:14px;font-family:inherit;cursor:pointer}.cl .kinds button[aria-pressed="true"]{background:var(--accent,var(--pl-accent));color:#fff;border-color:transparent}
.cl button[type=submit]{border:0;border-radius:999px;padding:13px;background:var(--accent,var(--pl-accent));color:#fff;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer}.cl .x{float:right;background:none;border:0;font-size:20px;cursor:pointer;color:var(--pl-soft)}.cl .err{color:#B3261E;font-size:14px;min-height:1em;margin:0}`; document.head.appendChild(s); }
  async function J(u) { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch { return null; } }
  function sheet(h, mine) { style(); const first = window.__encoreShort || window.__encorePerson || String(h.name || "").split(" ")[0].replace(/['’]s$/i, ""); let kind = "cohost";
    const bg = document.createElement("div"); bg.className = "cl-bg"; document.body.appendChild(bg); const close = () => bg.remove(); bg.onclick = (e) => { if (e.target === bg) close(); };
    bg.innerHTML = `<div class="cl" role="dialog" aria-modal="true" aria-label="Suggest a collab"><button class="x" type="button" aria-label="Close">×</button><h2>Suggest a collab</h2>
      <p>If ${esc(first)} says yes, you'll swap emails.</p>
      <form novalidate><div class="kinds" role="group" aria-label="What kind of collab">${KINDS.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${esc(l)}</button>`).join("")}</div>
        <label>The idea<textarea name="idea" rows="4" required placeholder="e.g. One night, both our crowds."></textarea></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label>Roughly when<input name="when" placeholder="e.g. March"></label><label>Where<input name="city" value="${esc(h.city || "")}"></label></div>
        <p class="err" role="alert" aria-live="assertive"></p><button type="submit">Send idea</button></form></div>`;
    bg.querySelector(".x").onclick = close; bg.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { kind = b.dataset.k; bg.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
    const f = bg.querySelector("form"); setTimeout(() => f.idea.focus(), 30);
    f.onsubmit = async (ev) => { ev.preventDefault(); const err = bg.querySelector(".err"), btn = f.querySelector("button[type=submit]"); err.textContent = "";
      if (!f.idea.value.trim()) { err.textContent = "Add your idea first."; f.idea.setAttribute("aria-invalid", "true"); f.idea.focus(); return; } f.idea.removeAttribute("aria-invalid"); btn.disabled = true;
      try { const r = await fetch(`/api/collab/${encodeURIComponent(h.handle)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, idea: f.idea.value, when: f.when.value, city: f.city.value }) }); const j = await r.json(); if (!r.ok) { const e2 = new Error(j.message); e2.code = j.code; throw e2; }
        bg.querySelector(".cl").innerHTML = `<button class="x" type="button" aria-label="Close">×</button><h2>Idea sent</h2><p>We'll tell you when they reply.</p><button type="submit" style="width:100%">Done</button>`; bg.querySelectorAll(".x,button[type=submit]").forEach((b) => (b.onclick = close)); sentCard(first); window.EncoreCommunity?.oink?.();
      } catch (e) {
        if (e.code === "host_page_required") { // one step: make a host page right here, then send
          let me = {}; try { me = await (await fetch("/api/me")).json(); } catch {}
          const nm = String(me.name || ""), slug = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
          err.innerHTML = `<span style="display:block;color:var(--pl-ink);font-weight:600;margin-bottom:6px">${esc(first)} will want to see your page. Start one and we'll send your idea.</span>
            <span style="display:grid;gap:8px;grid-template-columns:1fr 1fr"><input class="hp-name" placeholder="Page name, e.g. Kevin's Kitchen" value="${esc(nm ? nm.split(" ")[0] + "'s events" : "")}"><input class="hp-handle" placeholder="your-handle" value="${esc(slug(nm))}"></span>
            <button type="button" class="hp-go" style="margin-top:8px;width:100%">Make page and send</button>`;
          err.querySelector(".hp-go").onclick = async () => { const b2 = err.querySelector(".hp-go"); b2.disabled = true; b2.textContent = "Making your page…";
            try { const pr = await fetch("/api/host/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: err.querySelector(".hp-name").value.trim() || nm, handle: slug(err.querySelector(".hp-handle").value) || slug(nm), city: f.city.value }) }); const pj = await pr.json().catch(() => ({}));
              if (!pr.ok) throw new Error(pr.status === 403 ? "You need a host code to make a page. Ask a host for one." : pj.message || "Your page didn't save. Try again.");
              btn.disabled = false; f.requestSubmit ? f.requestSubmit() : btn.click(); } catch (x) { b2.disabled = false; b2.textContent = "Make page and send"; const m = document.createElement("span"); m.style.cssText = "display:block;color:#B3261E;margin-top:6px"; m.textContent = x.message; err.appendChild(m); } };
          btn.disabled = true; return; }
        if (e.code === "account_required" || /sign in/i.test(e.message)) { err.innerHTML = `${esc(e.message)} <a href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a>`; btn.disabled = false; return; }
        err.textContent = e.message; btn.disabled = false; } }; }
  function sentCard(first) { const c = document.getElementById("collabCard"); if (c) c.innerHTML = `<h3>Idea sent</h3><p class="muted">No reply yet.</p>`; }
  async function mount(h, pageFirst) { if (!h?.handle) return; style();
    // "Collabs with …" for everyone
    const C = await J(`/api/public/collabs/${encodeURIComponent(h.handle)}`); const A = window.EncoreAvatars;
    if (C?.collabs?.length) { const w = document.createElement("div"); w.className = "cl-with"; w.innerHTML = `<span>Collabs with</span>${C.collabs.map((c) => `<a href="/@${esc(c.handle)}">${c.avatarArt && A ? A.svg(c.avatarArt, c.accent, 22) : ""}${esc(c.name)}</a>`).join("")}`; // after the bio and tags, so the header reads name, handle, bio
      const at = document.querySelector(".head .tags") || document.querySelector(".head .bio") || document.querySelector(".head .stats"); if (at) at.after(w); else (document.querySelector(".head > div:nth-child(2)") || document.querySelector("main"))?.appendChild(w); }
    // the request card, for everyone but the owner
    const meP = await J("/api/host/profile"), mine = meP?.host?.handle ? meP.host : null; if (!mine) return;
    if (mine.handle === h.handle) { // friends hosts have no shop pane, so collab alerts (?collabs=1) open the Collabs list here
      if (/[?&]collabs=1/.test(location.search)) { const W = await J("/api/workspace"); if (W?.personal) ownerSheet(); } return; }
    const first = pageFirst || window.__encorePerson || String(h.name || "").split(" ")[0].replace(/['’]s$/i, ""), side = document.querySelector("aside.side") || document.querySelector("main"); if (!side || document.getElementById("collabCard")) return;
    const card = document.createElement("div"); card.className = "card cl-card"; card.id = "collabCard";
    card.innerHTML = `<h3>Got a collab idea?</h3><button class="btn" type="button" id="clGo">Suggest a collab</button>`;
    const fol = document.getElementById("follow"); fol ? fol.after(card) : side.appendChild(card); document.getElementById("hostOwn")?.remove(); // one "host your own" prompt is enough
    const mineC = /(?:^|;\s*)encore_in=1/.test(document.cookie) ? await J("/api/collabs") : null; /* review round 8: signed out, no call */ if ((mineC?.sent || []).some((c) => c.other?.handle === h.handle && c.status === "new")) { sentCard(first); return; }
    card.querySelector("#clGo").onclick = async () => { const me = await J("/api/me");
      if (!me?.verified) { location.href = `/login?why=collab&next=${encodeURIComponent(location.pathname + "?collab=1")}`; return; }
      const p = (await J("/api/host/profile"))?.host; if (!p?.handle) { card.innerHTML = `<h3>Start your page first</h3><p class="muted">Collabs are host to host.</p><a class="btn" href="/">Start your page</a>`; return; }
      sheet(h, p); };
    if (/[?&]collab=1/.test(location.search) && mine) sheet(h, mine); }
  window.EncoreCollab = { mount };

  // the owner's Collabs tab: requests from other hosts (reply, say yes, pass) and the ones you sent
  async function ownerPane(B) { if (!B) return; B.innerHTML = `<p class="muted">Loading…</p>`; let j = {}; try { j = await (await fetch("/api/collabs")).json(); } catch {}
    const A = window.EncoreAvatars, row = (c) => `<div class="breq ${c.status}"><div style="display:flex;gap:8px;align-items:center">${c.other?.avatarArt && A ? A.svg(c.other.avatarArt, c.other.accent, 28) : ""}<b><a href="/@${esc(c.other?.handle)}" target="_blank" rel="noopener">${esc(c.other?.name || "A host")}</a></b> <small>${esc(c.kindLabel)} · ${c.status === "new" ? (c.incoming ? "New" : "Sent") : c.status === "accepted" ? "Said yes" : "Passed"}</small></div>
      <p>${esc(c.idea)}</p>${c.when || c.city ? `<small>${esc([c.when, c.city].filter(Boolean).join(" · "))}</small>` : ""}${c.otherEmail ? `<p><b>Plan it together:</b> <a href="mailto:${esc(c.otherEmail)}">${esc(c.otherEmail)}</a></p>` : ""}
      ${(c.thread || []).map((m) => `<small><b>${esc(m.name)}:</b> ${esc(m.text)}</small>`).join("")}
      <div class="btns2">${c.incoming && c.status === "new" ? `<button type="button" class="sp-save" data-cla="accept" data-id="${c.id}">Say yes</button><button type="button" class="sp-btn" data-cla="decline" data-id="${c.id}">Pass</button>` : ""}<input data-clm="${c.id}" placeholder="Message ${esc(c.other?.name || "them")}"><button type="button" class="sp-btn" data-cls="${c.id}">Send</button></div></div>`;
    const In = j.incoming || [], Out = j.sent || [];
    B.innerHTML = `<p class="muted" style="margin-top:0">Say yes to swap emails. The collab shows on both pages.</p>
      ${In.length ? `<h4>For you</h4>${In.map(row).join("")}` : `<p class="muted">No collab ideas yet.</p>`}${Out.length ? `<h4>Sent</h4>${Out.map(row).join("")}` : ""}`;
    B.querySelectorAll("[data-cla]").forEach((b) => (b.onclick = async () => { b.disabled = true; await fetch(`/api/collabs/${b.dataset.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: b.dataset.cla }) }); ownerPane(B); }));
    B.querySelectorAll("[data-cls]").forEach((b) => (b.onclick = async () => { const i = B.querySelector(`[data-clm="${b.dataset.cls}"]`), text = i.value.trim(); if (!text) return; b.disabled = true; await fetch(`/api/collabs/${b.dataset.cls}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", text }) }); ownerPane(B); })); }
  window.EncoreCollab.ownerPane = ownerPane;
  function ownerSheet() { style(); const bg = document.createElement("div"); bg.className = "cl-bg"; document.body.appendChild(bg); const close = () => bg.remove(); bg.onclick = (e) => { if (e.target === bg) close(); };
    bg.innerHTML = `<div class="cl cl-own" role="dialog" aria-modal="true" aria-label="Collabs"><button class="x" type="button" aria-label="Close">×</button><h2>Collabs</h2><div></div></div>`; bg.querySelector(".x").onclick = close;
    const s = document.createElement("style"); s.textContent = `.cl-own .breq{border:1px solid var(--pl-line);border-radius:14px;padding:12px;margin:0 0 10px;background:#fff}.cl-own .breq p{margin:6px 0;color:var(--pl-ink)}.cl-own .btns2{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.cl-own .btns2 input{flex:1;min-width:140px;border:1px solid var(--pl-line);border-radius:999px;padding:8px 12px;font:inherit;font-size:15px}.cl-own .btns2 button{border:1px solid var(--pl-line);background:#fff;border-radius:999px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer}.cl-own .btns2 .sp-save{background:var(--accent,var(--pl-accent));color:#fff;border-color:transparent}.cl-own h4{margin:14px 0 8px}`; bg.appendChild(s);
    ownerPane(bg.querySelector(".cl-own > div")); }
})();
