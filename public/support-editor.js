// Supporters and wishlist, edited where the rest of your profile is: the "Edit my page" panel on /@you.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const css = `.se-sup{margin-top:14px;border-top:1px solid rgba(0,0,0,.08);padding-top:12px}.se-sup summary{cursor:pointer;font-weight:700;list-style:none}.se-sup summary::-webkit-details-marker{display:none}.se-sup summary::after{content:"+";float:right;font-weight:400}.se-sup[open] summary::after{content:"–"}
.se-sup .hint{font-size:13px;color:#6B5F56;margin:4px 0 10px}.se-sup .r3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.se-sup label.f{display:grid;gap:3px;font-size:13px;font-weight:600;color:#6B5F56;margin-top:8px}
.se-sup input{padding:8px 10px;border:1px solid #DCCFBE;border-radius:10px;font:inherit;font-size:14px;min-width:0;width:100%;box-sizing:border-box;background:#fff}.se-sup .tg{display:flex;gap:8px;align-items:center;font-size:14px;margin:4px 0}
.se-sup .wl{display:grid;grid-template-columns:40px minmax(0,1fr) 64px 26px;gap:5px;margin-top:6px;align-items:center}.se-sup .wl .u{grid-column:2/4}.se-sup .x{border:0;background:none;font-size:16px;cursor:pointer;color:#8A7D73}
.se-sup .acts{display:flex;gap:10px;align-items:center;margin-top:10px}.se-sup input[type=checkbox]{width:auto;flex:none;margin:0}.se-sup .acts button{padding:8px 14px;border-radius:999px;border:0;background:#1F1A17;color:#fff;font-weight:600;font-size:14px;font-family:inherit;cursor:pointer}.se-sup .lk{border:0;background:none;color:#A3402B;text-decoration:underline;cursor:pointer;font:inherit;font-size:13px;padding:0;margin-top:6px}`;
  const row = (x = {}) => `<div class="wl"><input class="e" value="${esc(x.emoji || "🎁")}" maxlength="4" aria-label="Emoji"><input class="n" value="${esc(x.name || "")}" placeholder="A new board game" maxlength="60" aria-label="Item"><input class="p" value="${esc(x.price || "")}" placeholder="$25" maxlength="12" aria-label="Rough price"><button type="button" class="x" aria-label="Remove">×</button><input class="u" value="${esc(x.url || "")}" placeholder="https://link (optional)" aria-label="Link"></div>`;
  function mount(box, host) {
    if (!box || box.querySelector(".se-sup")) return;
    if (!document.getElementById("seSupCss")) { const s = document.createElement("style"); s.id = "seSupCss"; s.textContent = css; document.head.appendChild(s); }
    const S = host.support || {}, W = (host.wishlist || []).length ? host.wishlist : [{ emoji: "🎲" }];
    const d = document.createElement("details"); d.className = "se-sup"; if (location.hash === "#support") d.open = true;
    d.innerHTML = `<summary>Supporters and wishlist</summary><p class="hint">Let guests chip in. Nobody is charged until you turn on payments.</p>
      <label class="tg"><input type="checkbox" class="on" ${S.on ? "checked" : ""}> Show a pledge card on my page</label>
      <div class="r3"><label class="f">Monthly $<input class="m" type="number" min="0" max="999" value="${esc(S.monthly ?? 5)}"></label><label class="f">Yearly $<input class="y" type="number" min="0" max="999" value="${esc(S.yearly ?? 50)}"></label><label class="f">Founding $<input class="fo" type="number" min="0" max="999" value="${esc(S.founding || "")}" placeholder="optional"></label></div>
      <label class="f">A line for supporters<input class="note" maxlength="200" value="${esc(S.note || "")}" placeholder="Pledges cover ingredients so tickets stay free."></label>
      <label class="f" style="margin-top:12px">Wishlist: things that make the next one better</label><div class="rows">${W.map(row).join("")}</div><button type="button" class="lk add">+ Add an item</button>
      <p class="msg" role="alert" style="font-size:13px;color:#B3261E;margin:6px 0 0"></p>`;
    box.appendChild(d); let dirty = false; d.addEventListener("input", () => (dirty = true)); d.addEventListener("change", () => (dirty = true));
    d.querySelector(".add").onclick = () => { const R = d.querySelector(".rows"); if (R.children.length < 8) R.insertAdjacentHTML("beforeend", row()); };
    d.addEventListener("click", (e) => { if (e.target.closest(".x")) { e.target.closest(".wl").remove(); dirty = true; } if (e.target.closest(".add")) dirty = true; });
    // saved by the pane's one Save button
    d._save = async () => { if (!dirty) return ""; const msg = d.querySelector(".msg"), v = (c) => d.querySelector(c).value.trim(); msg.textContent = "";
      const wishlist = [...d.querySelectorAll(".wl")].map((r) => ({ emoji: r.querySelector(".e").value.trim(), name: r.querySelector(".n").value.trim(), price: r.querySelector(".p").value.trim(), url: r.querySelector(".u").value.trim() })).filter((x) => x.name);
      if (wishlist.some((x) => x.url && !/^https:\/\//i.test(x.url))) { msg.textContent = "Links must start with https://"; throw new Error("Wishlist links must start with https://"); }
      { const r = await fetch("/api/host/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ support: { on: d.querySelector(".on").checked, monthly: +v(".m"), yearly: +v(".y"), founding: +v(".fo"), note: v(".note") }, wishlist, city: host.city || "" }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't save.");
        Object.assign(host, j.host || {}); dirty = false; return "Reload to see it."; } };
  }
  // your own name, shown as the host on your events (top of the pane)
  async function mountName(box) { if (!box || box.querySelector(".se-name")) return; let cur = ""; try { cur = (await (await fetch("/api/me/name")).json()).name || ""; } catch { return; }
    const d = document.createElement("div"); d.className = "se-sup se-name"; d.style.marginBottom = "0";
    d.innerHTML = `<label class="f" style="margin-top:0">Your name <small style="font-weight:400">Guests see it on your invites.</small><input class="nm" maxlength="60" value="${esc(cur)}" autocomplete="name"></label>`;
    box.prepend(d); d._save = async () => { const nm = d.querySelector(".nm").value.trim(); if (!nm || nm === cur) return "";
      { const r = await fetch("/api/me/name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: d.querySelector(".nm").value }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't save.");
        cur = nm; return j.events ? `Your name is on ${j.events} event${j.events === 1 ? "" : "s"} now.` : ""; } }; }
  // run every block's save; returns the notes to show, or throws the first error
  async function saveAll(root) { const out = []; for (const d of root.querySelectorAll(".se-sup")) if (d._save) { const m = await d._save(); if (m) out.push(m); } return out.join(" "); }
  window.EncoreSupport = { mount, mountName, saveAll };
})();
