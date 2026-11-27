// Potto fills in the reply form (the light invite /e, public/invite.html #f, and the full invite /g, index.html #gForm)
// from what this person told us before: their saved reply details and their own past replies (server/replyfill.js,
// POST /api/me/reply-defaults). Only empty fields, only the fields this form asks, never sent anywhere until the guest
// taps the reply button. One quiet line with the small Potto says so, with "Clear". After a reply it offers once, quietly,
// "Save these for next time?" for answers to questions that come up again (dietary, a plus-one, a t-shirt size...).
// Off with Settings' "Fill in my replies from what I've told you before" (on the account), or on this device for a
// signed-out guest (localStorage encore.replyFillOff). Never runs in the create canvas's guest preview.
(function () {
  if (window.ReplyFill) return;
  const ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const $ = (s, el = document) => el.querySelector(s), esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const onG = () => location.pathname === "/g";
  const eventId = () => (onG() ? window.__gEv?.id : (location.pathname.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || [])[1]) || "";
  const preview = () => document.documentElement.classList.contains("pv") || eventId() === "_preview";
  const formEl = () => (onG() ? $("#gForm") : $("#f"));
  const proofs = () => { const P = []; try { for (let i = 0; i < localStorage.length && P.length < 60; i++) { const k = localStorage.key(i); if (!/^encore-rsvp-/.test(k)) continue; const v = ls.get(k); if (v?.rid && v?.code) P.push({ id: k.slice(12), rid: v.rid, code: v.code }); } } catch {} return P; };
  const replied = (id) => !!ls.get("encore-rsvp-" + id)?.rid;
  const fieldOf = (f) => onG() ? { name: "#g-name", email: "#g-email", phone: "#g-phone", dietary: "#g-diet", severe: "#g-severe", access: "#g-access" }[f] : { name: "#nm", email: "#ct", phone: "#ct", dietary: "#dt" }[f];
  const CSS = `.rf-note{display:flex;align-items:center;gap:10px;margin:0 0 12px;font:400 15px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--pl-soft,#444845)}.rf-note .rf-pt{flex:none;width:32px;height:32px;display:grid;place-items:center}.rf-note .rf-pt svg{width:32px;height:32px}
.rf-note button,.rf-save button{min-height:44px;padding:0 4px;border:0;background:none;color:var(--pl-accent-text,#29489A);font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rf-save{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:12px 0 0;font:400 15px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);color:var(--pl-ink,#1B1D1C)}
:is(#f,#gForm) input:-webkit-autofill,:is(#f,#gForm) input:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 40px #fff inset!important;-webkit-text-fill-color:var(--pl-ink,#1B1D1C)!important}`;
  const css = () => { if ($("#rfCss")) return; const s = document.createElement("style"); s.id = "rfCss"; s.textContent = CSS; document.head.appendChild(s); };
  const potto = (cb) => { if (window.Potto) return cb(); if (!document.querySelector('script[src="/mascot.js"]')) { const t = document.createElement("script"); t.src = "/mascot.js"; t.onload = cb; document.head.appendChild(t); } };
  let busy = false, filled = null; // filled: { id, els: [[el, value]], qs: { qid: value } }

  async function run() { const f = formEl(), id = eventId(); if (busy || !f || !id || f.dataset.rf === id || preview() || replied(id)) return;
    if (ls.get("encore.replyFillOff") === true && !signed()) { f.dataset.rf = id; return; }
    const local = { profile: ls.get("encore.rsvpProfile"), answers: ls.get("encore.replyAnswers") }, P = proofs();
    if (!signed() && !P.length && !local.profile && !local.answers) { f.dataset.rf = id; return; }
    busy = true; let j = null;
    try { const r = await fetch("/api/me/reply-defaults?eventId=" + encodeURIComponent(id), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: id, proofs: P, local }) }); j = r.ok ? await r.json() : null; } catch {}
    busy = false; const f2 = formEl(); if (!f2 || eventId() !== id || replied(id)) return; f2.dataset.rf = id; if (!j?.on || !j.fields?.length) return;
    const els = [], qs = {}; let contactDone = false;
    for (const x of j.fields) {
      if (x.field.startsWith("q:")) { qs[x.field.slice(2)] = x.value; continue; }
      if (!onG() && (x.field === "email" || x.field === "phone")) { if (contactDone) continue; }
      const el = $(fieldOf(x.field) || "#none", f2); if (!el || el.closest("[hidden]") || el.disabled) continue;
      if (x.field === "severe") { if (!el.checked) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); els.push([el, true]); } continue; }
      if (String(el.value || "").trim() || document.activeElement === el) { if (x.field === "email" || x.field === "phone") contactDone = true; continue; }
      el.value = String(x.value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); els.push([el, String(x.value)]); if (x.field === "email" || x.field === "phone") contactDone = true;
      if (x.field === "access") { const d = el.closest("details"); if (d) d.open = true; } }
    const nq = Object.keys(qs).length ? window.Questions?.fill?.(id, qs) || 0 : 0;
    if (!els.length && !nq) return; filled = { id, els, qs }; css();
    const note = document.createElement("p"); note.className = "rf-note"; note.id = "rfNote"; note.setAttribute("role", "status");
    note.innerHTML = `<span class="rf-pt" aria-hidden="true"></span><span>Potto filled in what you told us last time. Change anything.</span><button type="button" data-rfclear>Clear</button>`;
    const first = els[0]?.[0], anchor = (onG() ? $("#g-name", f2)?.closest(".row,label") : $("#nm", f2)?.closest("label")) || first?.closest("label") || f2.firstElementChild; anchor ? anchor.before(note) : f2.prepend(note);
    potto(() => { const s = $(".rf-pt", note); if (s && window.Potto) s.innerHTML = window.Potto.svg("wave", 32, ""); });
    $("[data-rfclear]", note).onclick = () => { for (const [el, v] of filled?.els || []) { if (v === true) { el.checked = false; el.dispatchEvent(new Event("change", { bubbles: true })); } else if (el.value === v) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } }
      window.Questions?.clear?.(id, qs); filled = null; note.innerHTML = `<span>Cleared. Fill it in your way.</span>`; (onG() ? $("#g-name", f2) : $("#nm", f2))?.focus({ preventScroll: true }); }; }

  // ---- after a reply: "Save these for next time?" once, for answers to questions that come up again ----
  const RECUR = /^(dietary|plusone|tshirt|song|instagram|access)$/;
  // what was in the form when the reply button was tapped (the form is swapped for the ticket once it's sent)
  let sent = null;
  document.addEventListener("click", (e) => { if (!e.target.closest?.("#send, #g-send") || preview()) return; const id = eventId(); if (!id) return;
    sent = { id, A: window.Questions?.answered?.(id) || [], diet: ($(fieldOf("dietary") || "#none")?.closest("[hidden]") ? "" : $(fieldOf("dietary") || "#none")?.value || "").trim() }; }, true);
  async function offerSave() { const id = eventId(); if (!id || preview() || !replied(id) || document.getElementById("rfSave") || sent?.id !== id) return; const asked = ls.get("encore.replySaveAsked") || {}; if (asked[id]) return;
    const A = sent.A, diet = sent.diet;
    let items = A.map((x) => ({ q: x.q, type: x.type, a: Array.isArray(x.a) ? x.a.join(", ") : String(x.a ?? "").trim(), key: x.key })).filter((x) => x.a && RECUR.test(x.key || ""));
    if (diet) items.push({ q: "Anything you don't eat?", key: "dietary", a: diet });
    const declined = new Set(ls.get("encore.replyDeclined") || []), saved = ls.get("encore.replyAnswers") || {};
    items = items.filter((x) => !declined.has(x.key) && saved[x.key]?.a !== x.a && !(filled?.id === id && (filled.qs && Object.values(filled.qs).map(String).includes(x.a))));
    if (!items.length) return; asked[id] = 1; ls.set("encore.replySaveAsked", asked); css();
    const host = document.querySelector("#tk, #view-guest .ticket") || formEl(); if (!host) return;
    const box = document.createElement("p"); box.className = "rf-save"; box.id = "rfSave"; box.innerHTML = `<span>Save these for next time?</span><button type="button" data-rfs="yes">Yes, save</button><button type="button" data-rfs="no">No thanks</button>`; host.appendChild(box);
    box.onclick = async (e) => { const b = e.target.closest("[data-rfs]"); if (!b) return;
      if (b.dataset.rfs === "yes") { const S = { ...saved }; for (const x of items) S[x.key] = { q: x.q, a: x.a }; ls.set("encore.replyAnswers", S);
        if (signed()) await fetch("/api/me/reply-details", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ save: items }) }).catch(() => {});
        box.textContent = "Saved. You can change these in Settings."; }
      else { ls.set("encore.replyDeclined", [...declined, ...items.map((x) => x.key)].slice(-60)); if (signed()) fetch("/api/me/reply-details", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decline: items.map((x) => x.key) }) }).catch(() => {}); box.textContent = "OK. We won't ask about these again."; } }; }

  let t = 0; const tick = () => { clearTimeout(t); t = setTimeout(() => { run(); offerSave(); }, 250); };
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true }); tick();
  window.ReplyFill = { run, offerSave };
})();
