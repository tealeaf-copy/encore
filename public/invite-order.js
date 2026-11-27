// review round 7 (pre-orders), for the light invite (public/invite.html): loaded only for an event with `preorder`.
// A pre-order isn't "Are you in?" with a bring list: guests pick what they want (the host's items and prices, with
// steppers), a pickup window (the event's slots) and press Order. When the host's shop is open, the order goes to the
// shop (POST /api/public/order/:handle, server/shop.js) and shows up with their other orders; otherwise it's a reply
// with the order on it, so the host still sees who wants what. Review round 8: the reply sends which items and how many
// (orderQty), never its own text or prices: the server writes the order and the total from the event (server/preorder.js).
window.InviteOrder = function (e, ws, H, U) {
  const $ = (s, el = document) => el.querySelector(s), esc = U.esc, f0 = $("#f"); if (!f0 || $("#ord")) return;
  const first = (String(e.hostName || "").trim().split(/\s+/)[0] || H.person || "your host").replace(/['’]s$/i, ""), handle = H.host?.handle || "", eid = e.id || (location.pathname.match(/^\/e\/([A-Za-z0-9_-]{2,80})/) || [])[1] || "";
  const money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0), slotLabel = window.InviteOrder.slotLabel, slots = (e.slots || []).filter(Boolean).slice(0, 8);
  const css = document.createElement("style"); css.textContent = `.ord h2{margin:18px 0 8px}.ord .it{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line,#EADFCF)}.ord .it span{flex:1}.ord .it small{display:block;color:var(--muted,#6b5d52)}.ord .st{display:flex;align-items:center;gap:6px}.ord .st button{width:44px;height:44px;border-radius:999px;border:1.5px solid var(--ink,var(--pl-ink));background:#fff;font:700 20px system-ui;cursor:pointer;color:var(--ink,var(--pl-ink))}.ord .st b{min-width:22px;text-align:center}.ord .sl{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 4px}.ord .sl label{border:1.5px solid var(--line,var(--pl-line-strong));border-radius:999px;padding:9px 14px;cursor:pointer;min-height:44px;display:flex;align-items:center;gap:6px}.ord .sl label:has(input:checked){border-color:var(--ink,var(--pl-ink));background:var(--pl-sand)}.ord .tot{font-weight:700;margin:10px 0 4px}`; document.head.appendChild(css);
  const form = document.createElement("form"); form.id = "ord"; form.className = "ord"; form.noValidate = true;
  const orderBy = window.EncoreSpots ? window.EncoreSpots.orderByText(e) : ""; // review round 11: "Order by Thu"
  form.innerHTML = `<h2 class="ask">Order for pickup</h2>${orderBy ? `<p class="muted" id="ordBy" style="margin:0 0 8px">${esc(orderBy)}</p>` : ""}<div id="ordItems"><p class="muted">Opening the menu…</p></div>
    ${slots.length ? `<fieldset style="border:0;padding:0;margin:12px 0 0"><legend style="font-weight:600">Pickup time</legend><div class="sl">${slots.map((x, i) => `<label><input type="radio" name="slot" value="${esc(x)}"${i ? "" : " checked"}> ${esc(slotLabel(x))}</label>`).join("")}</div></fieldset>` : ""}
    <p class="tot" id="ordTot"></p>
    <label class="f">Your name<input type="text" id="oNm" autocomplete="name" maxlength="80" required></label>
    <label class="f">Email or phone <small>So ${esc(first)} can tell you it's ready.</small><input type="text" id="oCt" autocomplete="email" inputmode="email" maxlength="120" required></label>
    <p class="err" id="oEr" role="alert"></p><button class="go" id="oGo">Order</button>`;
  f0.hidden = true; f0.after(form); document.querySelector(".stick")?.remove();
  let items = [], shop = null; const qty = {};
  const draw = () => { const box = $("#ordItems");
    if (!items.length) { box.innerHTML = `<label class="f">What would you like?<input type="text" id="oFree" maxlength="200" placeholder="2 loaves, 1 focaccia"></label>`; $("#ordTot").textContent = ""; return; }
    box.innerHTML = items.map((x) => `<div class="it" data-id="${esc(x.id)}">${x.photo ? `<img src="${esc(x.photo)}" alt="" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex:none">` : ""}<span><b>${esc(x.name)}</b>${x.cents ? `<small>${money(x.cents)}${x.left === 0 ? " · sold out" : x.left ? ` · ${x.left} left` : ""}</small>` : ""}</span><span class="st"><button type="button" data-d="-1" aria-label="One less ${esc(x.name)}">−</button><b aria-live="polite">${qty[x.id] || 0}</b><button type="button" data-d="1" aria-label="One more ${esc(x.name)}"${x.left === 0 ? " disabled" : ""}>+</button></span></div>`).join("");
    const t = items.reduce((a, x) => a + (qty[x.id] || 0) * (x.cents || 0), 0), n = items.reduce((a, x) => a + (qty[x.id] || 0), 0);
    $("#ordTot").textContent = n ? `${n} item${n === 1 ? "" : "s"}${t ? ` · ${money(t)}` : ""}` : ""; };
  form.addEventListener("click", (ev) => { const b = ev.target.closest("[data-d]"); if (!b) return; const row = b.closest("[data-id]"), x = items.find((i) => i.id === row.dataset.id); if (!x) return;
    const cap = Math.min(x.max || 20, x.left == null ? 99 : x.left); qty[x.id] = Math.max(0, Math.min(cap, (qty[x.id] || 0) + +b.dataset.d)); draw(); });
  // the shop's items when the host's shop is open; else what the host typed ("country loaf $12, focaccia $9")
  // a drop (server/drops.js): its menu with photos, the per-order max and what's left this batch; when and where in plain words
  // a drop is ordered, not joined: no "I'm in if a friend is" or calendar file, and the address comes after ordering
  if (e.drop) { css.textContent += "#tbMe,#slBox{display:none!important}"; const fx = document.querySelector(".facts"); if (fx) fx.innerHTML = fx.innerHTML.replace(/address when you're in/, "exact address after you order"); }
  if (e.drop && eid) { fetch("/api/public/drop/" + encodeURIComponent(eid)).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { const d = j?.drop; if (!d) return;
    items = d.items.map((x) => ({ id: "i" + x.i, i: x.i, name: x.name, cents: Math.round(x.price * 100), max: x.max || 20, left: x.left, photo: x.photo, desc: x.desc })); draw();
    const h2 = form.querySelector("h2.ask"), info = document.createElement("p"); info.className = "muted"; info.id = "ordWhen"; info.style.margin = "0 0 8px";
    info.textContent = d.paused ? "Orders are paused right now. Follow the host to hear when they open." : [d.always ? "Order any time" : "", d.area ? `Pick up in ${d.area}` : "", d.hasAddress ? "The exact address shows once you order" : "", d.payAtPickup ? "Pay at pickup" : "Pay with the host's link after you order"].filter(Boolean).join(". ") + ".";
    h2?.after(info); if (d.paused) { const go = form.querySelector("#oGo"); if (go) { go.disabled = true; go.textContent = "Orders paused"; } } });
  }
  if (!e.drop) (handle ? fetch("/api/public/shop/" + encodeURIComponent(handle)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null)).then((j) => {
    // the event's own items win; the host's shop is used only when the event lists none
    shop = !(e.orderItems || []).length && j?.shop && (j.shop.items || []).length ? j.shop : null;
    items = shop ? shop.items.map((x) => ({ id: x.id, name: x.name, cents: x.cents, max: x.max, left: x.left })) : (Array.isArray(e.orderItems) ? e.orderItems : []).slice(0, 8).map((x, i) => ({ id: "i" + i, i, name: String(x.name || "").slice(0, 60), cents: Math.round((+x.price || 0) * 100), max: 20, left: null })).filter((x) => x.name);
    draw(); });
  form.onsubmit = async (ev) => { ev.preventDefault(); const er = $("#oEr"); er.textContent = "";
    const name = $("#oNm").value.trim().replace(/[<>]/g, "").slice(0, 80), c = $("#oCt").value.trim(), email = /@/.test(c) ? c : "", phone = !email && /\d{6,}/.test(c.replace(/[^\d]/g, "")) ? c.replace(/[^\d+]/g, "") : "";
    const slot = form.querySelector('input[name="slot"]:checked')?.value || "", lines = items.filter((x) => qty[x.id] > 0), free = $("#oFree")?.value.trim() || "";
    if (!lines.length && !free) { er.textContent = items.length ? "Pick something first." : "Say what you'd like first."; return; }
    if (!name) { er.textContent = `Add your name so ${first} knows whose order it is.`; $("#oNm").focus(); return; }
    if (!email && !phone) { er.textContent = `Add an email or phone so ${first} can tell you it's ready.`; $("#oCt").focus(); return; }
    const total = lines.reduce((a, x) => a + qty[x.id] * (x.cents || 0), 0), text = (lines.length ? lines.map((x) => `${qty[x.id]} × ${x.name}`).join(", ") : free) + (slot ? ` · pickup ${slotLabel(slot)}` : "") + (total ? ` · ${money(total)}` : "");
    const go = $("#oGo"); go.disabled = true;
    try { let pay = "", code = "", where = "", rid = "";
      // the same order sent twice from this page (a double tap, a retry after a dropped answer) is placed once (server/perf.js)
      if (shop) { const ob = JSON.stringify({ name, email, phone, slot, items: lines.map((x) => ({ id: x.id, qty: qty[x.id] })), note: e.pubTitle || e.name || "", eventId: eid }), ok = (window.__plOk ||= Math.random().toString(36).slice(2, 10));
        const r = await fetch("/api/public/order/" + encodeURIComponent(handle), { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "order-" + ok + "-" + [...ob].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7).toString(36) }, body: ob }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Didn't go through. Try again."); pay = j.payUrl || ""; code = j.code || ""; where = j.where || "";
        U.ls.set(`encore.order.${handle}.${code}`, JSON.stringify({ code, total: j.total, slot, at: Date.now(), lines: lines.map((x) => ({ name: x.name, qty: qty[x.id] })) })); }
      else { const rc = Array.from(crypto.getRandomValues(new Uint8Array(6)),(b)=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b%32]).join("");
        const data = { eventId: eid, response: "going", name, email, ...(phone ? { phone, contactVia: "sms" } : { contactVia: "email" }), slot, ...(lines.length ? { orderQty: lines.map((x) => ({ i: x.i, qty: qty[x.id] })) } : { order: free.slice(0, 200) }), code: rc, createdAt: Date.now(), via: "invite-order" };
        const r = await fetch("/api/db/collection?path=rsvps", { method: "POST", headers: { "Content-Type": "application/json", "x-encore-guest": "1", "x-encore-key": U.gkey(), "x-encore-workspace": ws }, body: JSON.stringify(data) }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Didn't go through. Try again."); rid = String(j.id || j.doc?.id || "").split("/").pop(); code = rc;
        U.ls.set("encore-rsvp-" + eid, JSON.stringify({ rid, code: rc, name, ct: c, gi: -1, response: "going", order: text, total, slot, wall: false, eventId: eid, data: {} }));
        if (total && /^https:\/\//.test(e.ticketUrl || "")) pay = U.payLinkOf(e.ticketUrl, money(total), [name, e.pubTitle || e.name].filter(Boolean).join(" · "));
        if (e.drop) { try { const a = await (await fetch(`/api/public/address/${encodeURIComponent(eid)}?rid=${encodeURIComponent(rid)}&code=${encodeURIComponent(rc)}`)).json(); where = a?.ok ? [a.venueAddr, e.hood].filter(Boolean).join(", ") : ""; } catch {} } }
      window.InviteOrder.ticket(e, ws, H, U, { rid, order: text, total, pay, name, code, shop: !!shop, where }, form);
      document.getElementById("tk")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
    catch (err) { er.textContent = /fetch|load failed|network/i.test(err.message) ? "Didn't go through. Check your connection and try again." : err.message; go.disabled = false; } };
};
// review round 11: the "Ordered" ticket: right after ordering, and when the guest comes back to the invite later (a reload
// shows their order, the total and Pay, never "You're in" with a door code). M: { rid, order, total (cents), pay, name, code,
// shop, where, paid, paidClaim }; el is replaced.
window.InviteOrder.ticket = function (e, ws, H, U, M, el) {
  const $ = (s) => document.querySelector(s), esc = U.esc, eid = e.id || (location.pathname.match(/^\/e\/([A-Za-z0-9_-]{2,80})/) || [])[1] || "";
  const first = (String(e.hostName || "").trim().split(/\s+/)[0] || H?.person || "your host").replace(/['’]s$/i, ""), money = (c) => "$" + (c / 100).toFixed(c % 100 ? 2 : 0);
  const total = +M.total > 0 ? +M.total : (() => { const m = String(M.order || "").match(/·\s*\$(\d+(?:\.\d{1,2})?)\s*$/); return m ? Math.round(+m[1] * 100) : 0; })();
  const pay = M.pay || (total && /^https:\/\//.test(e.ticketUrl || "") && U.payLinkOf ? U.payLinkOf(e.ticketUrl, money(total), [M.name, e.pubTitle || e.name].filter(Boolean).join(" · ")) : "");
  const tapped = (() => { try { return !!U.ls.get("encore-paytap-" + eid); } catch { return false; } })(), rid = M.rid || "";
  const status = M.paid ? "Paid. See you at pickup." : M.paidClaim ? `Got it. ${first} will check and confirm.` : `${first} has it${pay ? "" : e.ticketNote ? ". Pay at pickup" : ""}.`;
  if (!el) return;
  el.outerHTML = `<div class="ticket" id="tk"><h2>Ordered</h2><p class="muted" style="margin:0">${esc(M.order || "")}</p>${M.code && (M.shop || e.drop) ? `<p class="muted" style="margin:0">Order #${esc(String(M.code).slice(0, 6))}. Show this at pickup.</p>` : ""}${M.where ? `<p class="muted" style="margin:0">Pickup: ${esc(M.where)}</p>` : ""}
    <p class="muted" style="margin:0">${esc(status)}</p><div class="btns">${pay && !M.paid && !M.paidClaim ? `<a class="btn pay" id="oPay" href="${esc(pay)}" target="_blank" rel="noopener">Pay ${esc(money(total))}</a>` : ""}${pay && rid && !M.paid && !M.paidClaim ? `<button type="button" class="btn" id="oPaid"${tapped ? "" : " hidden"}>I paid</button>` : ""}</div></div>`;
  // review round 10: after Pay, "I paid" records a claim on their own reply, as on any paid invite. The host still confirms.
  const oPay = $("#oPay"), oPaid = $("#oPaid");
  if (oPay && oPaid) { oPay.addEventListener("click", () => { U.ls.set("encore-paytap-" + eid, "1"); oPaid.hidden = false; });
    oPaid.onclick = async () => { oPaid.disabled = true;
      try { const r = await fetch("/api/db/doc?path=" + encodeURIComponent("rsvps/" + rid), { method: "PATCH", headers: { "Content-Type": "application/json", "x-encore-guest": "1", "x-encore-key": U.gkey(), "x-encore-workspace": ws }, body: JSON.stringify({ paidClaim: true, changedAt: Date.now() }) }); if (!r.ok) throw 0;
        try { const m0 = JSON.parse(U.ls.get("encore-rsvp-" + eid) || "{}"); U.ls.set("encore-rsvp-" + eid, JSON.stringify({ ...m0, paidClaim: true })); } catch {}
        const ps = document.querySelectorAll("#tk p.muted"), p = ps[ps.length - 1]; if (p) p.textContent = `Got it. ${first} will check and confirm.`; oPay.remove(); oPaid.remove(); }
      catch { oPaid.disabled = false; oPaid.textContent = "Didn't go through. Tap to try again"; } }; }
};
// review round 8: pickup windows read "10am to 11am" (the same rule as server/preorder.js slotLabel)
window.InviteOrder.slotLabel = function (slot) {
  const t = String(slot || "").trim(); if (!t) return ""; const parts = t.split(/\s*(?:–|\u2014|-|\bto\b)\s*/i).filter(Boolean); if (!parts.length || parts.length > 2) return t;
  const P = parts.map((p) => p.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i)); if (P.some((m) => !m || +m[1] > 23 || (m[2] && +m[2] > 59))) return t.replace(/\s*[–\u2014-]\s*/g, " to ");
  const said = P.map((m) => (m[3] ? (/^p/i.test(m[3]) ? "pm" : "am") : "")), f = (h, mm, ap) => `${h % 12 || 12}${mm && mm !== "00" ? ":" + mm : ""}${ap}`;
  return P.map((m, i) => { const h = +m[1], mm = m[2] || ""; if (said[i]) return f(h, mm, said[i]); if (h > 12 || h === 0) return f(h, mm, h >= 12 ? "pm" : "am");
    const c = said[1 - i]; return f(h, mm, c ? (i === 0 && h % 12 > +P[1][1] % 12 ? (c === "pm" ? "am" : "pm") : c) : h === 12 || h < 7 ? "pm" : "am"); }).join(" to "); };
