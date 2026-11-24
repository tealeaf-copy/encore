// Supporters and wishlist, edited where the rest of your profile is: the "Edit my page" panel on /@you.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const css = `.se-sup{margin-top:14px;border-top:1px solid rgba(0,0,0,.08);padding-top:12px}.se-sup summary{cursor:pointer;font-weight:700;list-style:none}.se-sup summary::-webkit-details-marker{display:none}.se-sup summary::after{content:"+";float:right;font-weight:400}.se-sup[open] summary::after{content:"–"}
.se-sup .hint{font-size:12.5px;color:#6B5F56;margin:4px 0 10px}.se-sup .r3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.se-sup label.f{display:grid;gap:3px;font-size:12px;font-weight:600;color:#6B5F56;margin-top:8px}
.se-sup input{padding:8px 10px;border:1px solid #DCCFBE;border-radius:10px;font:inherit;font-size:14px;min-width:0;width:100%;box-sizing:border-box;background:#fff}.se-sup .tg{display:flex;gap:8px;align-items:center;font-size:14px;margin:4px 0}
.se-sup .wl{display:grid;grid-template-columns:40px minmax(0,1fr) 64px 26px;gap:5px;margin-top:6px;align-items:center}.se-sup .wl .u{grid-column:2/4}.se-sup .x{border:0;background:none;font-size:17px;cursor:pointer;color:#8A7D73}
.se-sup .acts{display:flex;gap:10px;align-items:center;margin-top:10px}.se-sup input[type=checkbox]{width:auto;flex:none;margin:0}.se-sup{margin-bottom:84px}.se-sup .acts button{padding:8px 14px;border-radius:999px;border:0;background:#1F1A17;color:#fff;font:600 13.5px inherit;cursor:pointer}.se-sup .lk{border:0;background:none;color:#A3402B;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;padding:0;margin-top:6px}`;
  const row = (x = {}) => `<div class="wl"><input class="e" value="${esc(x.emoji || "🎁")}" maxlength="4" aria-label="Emoji"><input class="n" value="${esc(x.name || "")}" placeholder="A new board game" maxlength="60" aria-label="Item"><input class="p" value="${esc(x.price || "")}" placeholder="$25" maxlength="12" aria-label="Rough price"><button type="button" class="x" aria-label="Remove">×</button><input class="u" value="${esc(x.url || "")}" placeholder="https://link (optional)" aria-label="Link"></div>`;
  function mount(box, host) {
    if (!box || box.querySelector(".se-sup")) return;
    if (!document.getElementById("seSupCss")) { const s = document.createElement("style"); s.id = "seSupCss"; s.textContent = css; document.head.appendChild(s); }
    const S = host.support || {}, W = (host.wishlist || []).length ? host.wishlist : [{ emoji: "🎲" }];
    const d = document.createElement("details"); d.className = "se-sup"; if (location.hash === "#support") d.open = true;
    d.innerHTML = `<summary>Supporters and wishlist</summary><p class="hint">Let regulars back what you host. Nobody is charged until you turn on payments; wishlist gifts go to the link you add.</p>
      <label class="tg"><input type="checkbox" class="on" ${S.on ? "checked" : ""}> Show a pledge card on my page</label>
      <div class="r3"><label class="f">Monthly $<input class="m" type="number" min="0" max="999" value="${esc(S.monthly ?? 5)}"></label><label class="f">Yearly $<input class="y" type="number" min="0" max="999" value="${esc(S.yearly ?? 50)}"></label><label class="f">Founding $<input class="fo" type="number" min="0" max="999" value="${esc(S.founding || "")}" placeholder="optional"></label></div>
      <label class="f">A line for supporters<input class="note" maxlength="200" value="${esc(S.note || "")}" placeholder="Pledges cover ingredients so tickets stay free."></label>
      <label class="f" style="margin-top:12px">Wishlist: things that make the next one better</label><div class="rows">${W.map(row).join("")}</div><button type="button" class="lk add">+ Add an item</button>
      <div class="acts"><button type="button" class="sv">Save supporters</button><span class="msg" style="font-size:13px;color:#6B5F56"></span></div>`;
    box.appendChild(d);
    d.querySelector(".add").onclick = () => { const R = d.querySelector(".rows"); if (R.children.length < 8) R.insertAdjacentHTML("beforeend", row()); };
    d.addEventListener("click", (e) => { if (e.target.closest(".x")) e.target.closest(".wl").remove(); });
    d.querySelector(".sv").onclick = async () => { const b = d.querySelector(".sv"), msg = d.querySelector(".msg"), v = (c) => d.querySelector(c).value.trim();
      const wishlist = [...d.querySelectorAll(".wl")].map((r) => ({ emoji: r.querySelector(".e").value.trim(), name: r.querySelector(".n").value.trim(), price: r.querySelector(".p").value.trim(), url: r.querySelector(".u").value.trim() })).filter((x) => x.name);
      if (wishlist.some((x) => x.url && !/^https:\/\//i.test(x.url))) { msg.textContent = "Links must start with https://"; return; }
      b.disabled = true; msg.textContent = "Saving…";
      try { const r = await fetch("/api/host/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support: { on: d.querySelector(".on").checked, monthly: +v(".m"), yearly: +v(".y"), founding: +v(".fo"), note: v(".note") }, wishlist, city: host.city || "" }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't save.");
        Object.assign(host, j.host || {}); msg.textContent = "✓ Saved. Reload to see it on your page."; } catch (err) { msg.textContent = err.message; } b.disabled = false; };
  }
  window.EncoreSupport = { mount };
})();
