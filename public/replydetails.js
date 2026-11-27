// Settings, "Your replies": the switch "Fill in my replies from what I've told you before" and "Saved reply details",
// what Potto remembers to fill in on reply forms (public/replyfill.js): your name, phone, what you don't eat, a plus-one
// and answers you chose to save. Each can be changed, or forgotten with "Forget this". Data: server/replyfill.js
// (GET/POST /api/me/reply-details) and server/community.js (POST /api/me/rsvp-profile, the same details the reply form saves).
(function () {
  const box = document.getElementById("replyDetails"); if (!box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const J = { "Content-Type": "application/json" }, post = (u, b) => fetch(u, { method: "POST", credentials: "same-origin", headers: J, body: JSON.stringify(b) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const css = document.createElement("style"); css.textContent = `#replyDetails .rd-f{display:grid;gap:6px;padding:12px 0;border-top:1.5px solid var(--line)}#replyDetails .rd-f:first-of-type{border-top:0}
#replyDetails .rd-f>span{font-weight:600;font-size:15px}#replyDetails .rd-f small{color:var(--smoke);font-size:13px}#replyDetails .rd-in{display:flex;gap:8px;align-items:center}
#replyDetails input[type=text],#replyDetails input[type=tel]{flex:1;min-width:0;min-height:44px;border:1.5px solid var(--line-strong);border-radius:6px;padding:0 12px;font:16px "IBM Plex Sans",system-ui,sans-serif;background:#fff;color:var(--ink)}
#replyDetails .rd-x{flex:none;min-height:44px;padding:0 4px;border:0;background:none;color:var(--pl-accent-text);font:500 14px "IBM Plex Sans",system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
#replyDetails .rd-x[hidden]{display:none}#replyDetails .rd-none{margin:8px 0 0;color:var(--smoke);font-size:14px}`; document.head.appendChild(css);
  let D = null, P = {};
  const FIELDS = [["name", "Name", "text", "name"], ["phone", "Phone", "tel", "tel"], ["dietary", "Anything you don't eat?", "text", "off"]];
  function draw() { const A = (D.answers || []).filter((a) => a.key !== "plusone"), plus = (D.answers || []).find((a) => a.key === "plusone");
    box.innerHTML = `<div class="row"><span>Fill in my replies from what I've told you before<small>Potto fills reply forms from your saved details and your past replies. Only you see them until you send.</small></span><input type="checkbox" class="sw" id="rdOn" aria-label="Fill in my replies from what I've told you before"${D.on ? " checked" : ""}></div>
      <h3 style="font:600 16px var(--pl-font-text);margin:16px 0 0">Saved reply details</h3>
      ${FIELDS.map(([k, l, t, ac]) => `<label class="rd-f"><span>${l}</span><span class="rd-in"><input type="${t}" data-rd="${k}" value="${esc(P[k] || "")}" autocomplete="${ac}" maxlength="${k === "phone" ? 30 : 200}"><button type="button" class="rd-x" data-forget="${k}"${P[k] ? "" : " hidden"}>Forget this</button></span></label>`).join("")}
      <label class="rd-f"><span>Plus-one</span><small>Who you usually bring, when a host asks.</small><span class="rd-in"><input type="text" data-rd="plusone" value="${esc(plus?.a || "")}" maxlength="120" autocomplete="off"><button type="button" class="rd-x" data-forget="answer:plusone"${plus ? "" : " hidden"}>Forget this</button></span></label>
      ${A.map((a) => `<div class="rd-f"><span>${esc(a.q || a.key)}</span><span class="rd-in"><span style="flex:1">${esc(a.a)}</span><button type="button" class="rd-x" data-forget="answer:${esc(a.key)}">Forget this</button></span></div>`).join("")}
      <p class="msg" id="rdMsg" role="status"></p>`;
    box.querySelector("#rdOn").onchange = async (e) => { const j = await post("/api/me/reply-details", { on: e.target.checked }); say(j ? (e.target.checked ? "Potto will fill in your replies." : "Off. Reply forms start empty.") : "Couldn't save that. Try again."); };
    box.querySelectorAll("[data-rd]").forEach((i) => (i.onchange = () => saveField(i.dataset.rd, i.value.trim()))); }
  const say = (t) => { const m = box.querySelector("#rdMsg"); if (m) m.textContent = t; };
  async function saveField(k, v) {
    if (k === "plusone") { const j = v ? await post("/api/me/reply-details", { save: [{ key: "plusone", q: "Bringing someone? Their name, please.", a: v }] }) : await post("/api/me/reply-details", { forget: "answer:plusone" }); if (j) { D = j; draw(); say("Saved."); } else say("Couldn't save that. Try again."); return; }
    const next = { ...P, [k]: v, ...(k === "phone" && v ? { contactVia: P.email ? P.contactVia || "email" : "sms" } : {}) }; if (k === "dietary" && !v) next.severe = false;
    const j = await post("/api/me/rsvp-profile", next); if (j) { P = j.profile || {}; try { const L = JSON.parse(localStorage.getItem("encore.rsvpProfile") || "null"); if (L) localStorage.setItem("encore.rsvpProfile", JSON.stringify({ ...L, [k]: v, updatedAt: Date.now() })); } catch {} draw(); say("Saved."); } else say("Couldn't save that. Try again."); }
  box.addEventListener("click", async (e) => { const b = e.target.closest("[data-forget]"); if (!b) return; const f = b.dataset.forget, j = await post("/api/me/reply-details", { forget: f });
    if (!j) return say("Couldn't forget that. Try again."); D = j; P = j.profile || {}; if (!f.startsWith("answer:")) try { const L = JSON.parse(localStorage.getItem("encore.rsvpProfile") || "null"); if (L) { L[f] = ""; localStorage.setItem("encore.rsvpProfile", JSON.stringify(L)); } } catch {}
    if (f.startsWith("answer:")) try { const S = JSON.parse(localStorage.getItem("encore.replyAnswers") || "null"); if (S) { delete S[f.slice(7)]; localStorage.setItem("encore.replyAnswers", JSON.stringify(S)); } } catch {}
    draw(); say("Forgotten."); });
  fetch("/api/me/reply-details", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j) return; D = j; P = j.profile || {}; draw(); }).catch(() => {});
})();
