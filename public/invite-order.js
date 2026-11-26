// review round 7 (pre-orders), for the light invite (public/invite.html): loaded only for an event with `preorder`.
// A pre-order isn't "Are you in?" with a bring list: guests pick what they want (the host's items and prices, with
// steppers), a pickup window (the event's slots) and press Order. When the host's shop is open, the order goes to the
// shop (POST /api/public/order/:handle, server/shop.js) and shows up with their other orders; otherwise it's a reply
// with the order written on it (`order` on the reply), so the host still sees who wants what.
window.InviteOrder = function (e, ws, H, U) {
  const $ = (s, el = document) => el.querySelector(s), esc = U.esc, f0 = $("#f"); if (!f0 || $("#ord")) return;
  const first = String(e.hostName || "").trim().split(/\s+/)[0] || H.person || "your host", handle = H.host?.handle || "", eid = e.id || (location.pathname.match(/^\/e\/([A-Za-z0-9_-]{2,80})/) || [])[1] || "";
  const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0), slots = (e.slots || []).filter(Boolean).slice(0, 8);
  const css = document.createElement("style"); css.textContent = `.ord h2{margin:18px 0 8px}.ord .it{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line,#EADFCF)}.ord .it span{flex:1}.ord .it small{display:block;color:var(--muted,#6b5d52)}.ord .st{display:flex;align-items:center;gap:6px}.ord .st button{width:44px;height:44px;border-radius:999px;border:1.5px solid var(--ink,#1F1A17);background:#fff;font:700 20px system-ui;cursor:pointer;color:var(--ink,#1F1A17)}.ord .st b{min-width:22px;text-align:center}.ord .sl{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}.ord .sl label{border:1.5px solid var(--line,#DCCFBE);border-radius:999px;padding:9px 14px;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:6px}.ord .sl label:has(input:checked){border-color:var(--ink,#1F1A17);background:#FFE08A}.ord .tot{font-weight:700;margin:10px 0 4px}`; document.head.appendChild(css);
  const form = document.createElement("form"); form.id = "ord"; form.className = "ord"; form.noValidate = true;
  form.innerHTML = `<h2 class="ask">Order for pickup</h2><div id="ordItems"><p class="muted">Opening the menu…</p></div>
    ${slots.length ? `<fieldset style="border:0;padding:0;margin:12px 0 0"><legend style="font-weight:600">Pickup time</legend><div class="sl">${slots.map((x, i) => `<label><input type="radio" name="slot" value="${esc(x)}"${i ? "" : " checked"}> ${esc(x)}</label>`).join("")}</div></fieldset>` : ""}
    <p class="tot" id="ordTot"></p>
    <label class="f">Your name<input type="text" id="oNm" autocomplete="name" maxlength="80" required></label>
    <label class="f">Email or phone <small>So ${esc(first)} can tell you it's ready.</small><input type="text" id="oCt" autocomplete="email" inputmode="email" maxlength="120" required></label>
    <p class="err" id="oEr" role="alert"></p><button class="go" id="oGo">Order</button>`;
  f0.hidden = true; f0.after(form); document.querySelector(".stick")?.remove();
  let items = [], shop = null; const qty = {};
  const draw = () => { const box = $("#ordItems");
    if (!items.length) { box.innerHTML = `<label class="f">What would you like?<input type="text" id="oFree" maxlength="200" placeholder="2 loaves, 1 focaccia"></label>`; $("#ordTot").textContent = ""; return; }
    box.innerHTML = items.map((x) => `<div class="it" data-id="${esc(x.id)}"><span><b>${esc(x.name)}</b>${x.cents ? `<small>${money(x.cents)}${x.left === 0 ? " · sold out" : x.left ? ` · ${x.left} left` : ""}</small>` : ""}</span><span class="st"><button type="button" data-d="-1" aria-label="One less ${esc(x.name)}">−</button><b aria-live="polite">${qty[x.id] || 0}</b><button type="button" data-d="1" aria-label="One more ${esc(x.name)}"${x.left === 0 ? " disabled" : ""}>+</button></span></div>`).join("");
    const t = items.reduce((a, x) => a + (qty[x.id] || 0) * (x.cents || 0), 0), n = items.reduce((a, x) => a + (qty[x.id] || 0), 0);
    $("#ordTot").textContent = n ? `${n} item${n === 1 ? "" : "s"}${t ? ` · ${money(t)}` : ""}` : ""; };
  form.addEventListener("click", (ev) => { const b = ev.target.closest("[data-d]"); if (!b) return; const row = b.closest("[data-id]"), x = items.find((i) => i.id === row.dataset.id); if (!x) return;
    const cap = Math.min(x.max || 20, x.left == null ? 99 : x.left); qty[x.id] = Math.max(0, Math.min(cap, (qty[x.id] || 0) + +b.dataset.d)); draw(); });
  // the shop's items when the host's shop is open; else what the host typed ("country loaf $12, focaccia $9")
  (handle ? fetch("/api/public/shop/" + encodeURIComponent(handle)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null)).then((j) => {
    shop = j?.shop && (j.shop.items || []).length ? j.shop : null;
    items = shop ? shop.items.map((x) => ({ id: x.id, name: x.name, cents: x.cents, max: x.max, left: x.left })) : (Array.isArray(e.orderItems) ? e.orderItems : []).slice(0, 8).map((x, i) => ({ id: "i" + i, name: String(x.name || "").slice(0, 60), cents: Math.round((+x.price || 0) * 100), max: 20, left: null })).filter((x) => x.name);
    draw(); });
  form.onsubmit = async (ev) => { ev.preventDefault(); const er = $("#oEr"); er.textContent = "";
    const name = $("#oNm").value.trim().replace(/[<>]/g, "").slice(0, 80), c = $("#oCt").value.trim(), email = /@/.test(c) ? c : "", phone = !email && /\d{6,}/.test(c.replace(/[^\d]/g, "")) ? c.replace(/[^\d+]/g, "") : "";
    const slot = form.querySelector('input[name="slot"]:checked')?.value || "", lines = items.filter((x) => qty[x.id] > 0), free = $("#oFree")?.value.trim() || "";
    if (!lines.length && !free) { er.textContent = items.length ? "Pick something first." : "Say what you'd like first."; return; }
    if (!name) { er.textContent = `Add your name so ${first} knows whose order it is.`; $("#oNm").focus(); return; }
    if (!email && !phone) { er.textContent = `Add an email or phone so ${first} can tell you it's ready.`; $("#oCt").focus(); return; }
    const total = lines.reduce((a, x) => a + qty[x.id] * (x.cents || 0), 0), text = (lines.length ? lines.map((x) => `${qty[x.id]} × ${x.name}`).join(", ") : free) + (slot ? ` · pickup ${slot}` : "") + (total ? ` · ${money(total)}` : "");
    const go = $("#oGo"); go.disabled = true;
    try { let pay = "", code = "", where = "";
      if (shop) { const r = await fetch("/api/public/order/" + encodeURIComponent(handle), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, phone, slot, items: lines.map((x) => ({ id: x.id, qty: qty[x.id] })), note: e.pubTitle || e.name || "" }) }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Didn't go through. Try again."); pay = j.payUrl || ""; code = j.code || ""; where = j.where || "";
        U.ls.set(`encore.order.${handle}.${code}`, JSON.stringify({ code, total: j.total, slot, at: Date.now(), lines: lines.map((x) => ({ name: x.name, qty: qty[x.id] })) })); }
      else { const rc = (String(eid).slice(0, 2) + [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 46656, 7).toString(36)).toUpperCase().padEnd(5, "X").slice(0, 5);
        const data = { eventId: eid, response: "going", name, email, ...(phone ? { phone, contactVia: "sms" } : { contactVia: "email" }), order: text.slice(0, 300), code: rc, createdAt: Date.now(), via: "invite-order" };
        const r = await fetch("/api/db/collection?path=rsvps", { method: "POST", headers: { "Content-Type": "application/json", "x-encore-guest": "1", "x-encore-key": U.gkey(), "x-encore-workspace": ws }, body: JSON.stringify(data) }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Didn't go through. Try again."); const rid = String(j.id || j.doc?.id || "").split("/").pop(); code = rc;
        U.ls.set("encore-rsvp-" + eid, JSON.stringify({ rid, code: rc, name, ct: c, gi: -1, response: "going", order: text, wall: false, eventId: eid, data: {} }));
        if (total && /^https:\/\//.test(e.ticketUrl || "")) pay = U.payLinkOf(e.ticketUrl, money(total), [name, e.pubTitle || e.name].filter(Boolean).join(" · ")); }
      form.outerHTML = `<div class="ticket" id="tk"><h2>Ordered</h2><p class="muted" style="margin:0">${esc(text)}</p>${code && shop ? `<p class="muted" style="margin:0">Order #${esc(code)}. Show this at pickup.</p>` : ""}${where ? `<p class="muted" style="margin:0">📍 ${esc(where)}</p>` : ""}
        <p class="muted" style="margin:0">${esc(first)} has it${pay ? "" : e.ticketNote ? ". Pay at pickup" : ""}.</p><div class="btns">${pay ? `<a class="btn pay" href="${esc(pay)}" target="_blank" rel="noopener">Pay ${esc(money(total))}</a>` : ""}</div></div>`;
      document.getElementById("tk")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
    catch (err) { er.textContent = /fetch|load failed|network/i.test(err.message) ? "Didn't go through. Check your connection and try again." : err.message; go.disabled = false; } };
};
