// Questions with personality. Hosts write their own RSVP questions in their own voice (any language, emoji welcome)
// and guests answer them one at a time, Typeform-style: big type, a progress bar, Enter to go on, Potto cheering.
//   Questions.builder(container, event, onChange)  – the host's editor
//   Questions.flow(container, event, answers)      – the guest's one-at-a-time card (answers is filled in place)
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const TYPES = { short: "Short answer", long: "Long answer", choice: "Pick one", multi: "Pick any", yesno: "Yes / no", emoji: "Emoji scale", number: "Number (− 1 +)", time: "Pick a time", instagram: "Instagram handle", phone: "Phone" };
  // starters, in a host's voice, to edit freely
  // food events already ask "Anything you don't eat?" with one-tap answers, so the allergies starter isn't offered there
  const hasDietChips = (ev) => { try { return typeof FOODY === "function" ? !!FOODY(ev) : /dinner|supper|brunch|bake|cook|potluck|tasting|food|cake|bread|coffee|matcha|tea/i.test(`${ev.activity || ""} ${ev.name || ""} ${ev.pubTitle || ""}`); } catch { return false; } };
  const friendsEv = (ev) => { try { return typeof isCasual === "function" ? !!isCasual(ev) : !!ev.casual; } catch { return !!ev.casual; } };
  const STARTERS = [
    { q: "any allergies?", type: "short", placeholder: "nope, or tell us", diet: true },
    { q: "have you followed us? 😤", type: "yesno", biz: true },
    { q: "your Instagram?", type: "instagram" },
    { q: "want in on the group chat? 💬", type: "yesno" },
    { q: "how many sets?", type: "number", min: 1, max: 6, biz: true },
    { q: "pick a pickup time", type: "time", options: ["5:45 pm", "6:00 pm", "6:15 pm", "6:30 pm"] },
    { q: "how hungry are you, honestly?", type: "emoji", options: ["🙂", "😋", "🤤", "🐷"] },
    { q: "a song for the playlist 🎶", type: "short" },
    { q: "one fun fact about you", type: "long" },
  ];
  const CSS = `.qb{display:grid;gap:10px}.qb-starters{display:flex;flex-wrap:wrap;gap:6px}.qb-starters button{border:1.5px dashed #CDBFAE;background:#fff;border-radius:999px;padding:6px 11px;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer}
.qb-q{border:1.5px solid #E4D9C8;border-radius:16px;background:#fff;padding:12px;display:grid;gap:8px}.qb-q .r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.qb-q input[type=text],.qb-q select{padding:9px 11px;border:1px solid #DCCFBE;border-radius:12px;font:inherit}.qb-q .qt{flex:1;min-width:180px;font-weight:600}.qb-q .r .qt{width:auto}.qb-q .r select{width:auto;flex:0 0 auto;max-width:180px}.qb-q .r .tools{display:flex;gap:4px}.qb-q{gap:6px!important;padding:10px 12px!important}
.qb-q .tools{display:flex;gap:4px;margin-left:auto}.qb-q .tools button{border:1px solid #E4D9C8;background:#fff;border-radius:999px;width:30px;height:30px;cursor:pointer}.qb-q small{color:#6B5F56}
.qb-pers{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}.qb-pers label{display:grid;gap:4px;font-size:13px;font-weight:600}.qb-pers input{padding:9px 11px;border:1px solid #DCCFBE;border-radius:12px;font:inherit;font-weight:400}
.tf{position:relative;border:2.5px solid #1F1A17;border-radius:24px;background:#FFF8EE;box-shadow:0 0 0 5px #fff,0 16px 34px -22px rgba(31,26,23,.55);padding:22px 20px 18px;overflow:hidden}
.tf-bar{position:absolute;left:0;top:0;height:6px;background:#E4D9C8;width:100%}.tf-bar i{display:block;height:100%;background:var(--tf,#C4532F);transition:width .45s cubic-bezier(.3,1.4,.5,1)}
.tf-top{display:flex;justify-content:space-between;align-items:center;margin-top:4px}.tf-n{font-weight:700;font-size:13px;font-family:inherit;color:#6B5F56}.tf-pt{width:64px;height:64px}
.tf-q{font:700 var(--fs-20-28,20px)/1.2 var(--sys-display);margin:6px 0 4px;animation:tfIn .4s cubic-bezier(.3,1.4,.5,1)}.tf-q small{font:500 14px "Instrument Sans",system-ui;color:#6B5F56;margin-left:6px}
@keyframes tfIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.tf-a{display:grid;gap:8px;margin:12px 0 4px;animation:tfIn .45s cubic-bezier(.3,1.4,.5,1)}.tf-a input,.tf-a textarea{font-weight:500;font-size:20px;line-height:1.3;font-family:inherit;padding:12px 4px;border:0;border-bottom:2.5px solid #1F1A17;background:transparent;outline:none;width:100%}.tf-a textarea{min-height:90px;resize:vertical}
.tf-opts{display:flex;flex-wrap:wrap;gap:8px}.tf-opts button{border:2px solid #1F1A17;background:#fff;border-radius:14px;padding:11px 16px;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer;transition:transform .2s cubic-bezier(.3,1.7,.5,1)}.tf-opts button:hover{transform:translateY(-2px)}.tf-opts button[aria-pressed=true]{background:var(--tf,#C4532F);color:#fff;box-shadow:2px 2px 0 #1F1A17}
.tf-opts.emoji button{font-size:28px;padding:8px 14px}.tf-key{font-weight:700;font-size:13px;font-family:inherit;opacity:.55;margin-right:6px}
.tf-step{display:flex;align-items:center;gap:16px}.tf-step button{width:52px;height:52px;border-radius:50%;border:2px solid #1F1A17;background:#fff;font-weight:700;font-size:28px;font-family:inherit;cursor:pointer}.tf-step b{font:700 40px var(--sys-display);min-width:40px;text-align:center}
.tf-nav{display:flex;justify-content:space-between;align-items:center;margin-top:12px}.tf-nav .ok{background:var(--tf,#C4532F);color:#fff;border:2px solid #1F1A17;border-radius:999px;padding:10px 18px;font-weight:700;font-size:16px;font-family:inherit;box-shadow:2px 2px 0 #1F1A17;cursor:pointer}.tf-nav .bk{border:0;background:none;color:#6B5F56;font-weight:600;font-size:14px;font-family:inherit;cursor:pointer}.tf-nav small{color:#6B5F56}
.tf-done{text-align:center;display:grid;justify-items:center;gap:6px}.tf-done b{font:700 20px var(--sys-display)}.tf-err{color:#B3261E;font-weight:600;font-size:14px;min-height:1.2em}`;
  const css = () => { if (document.getElementById("qbCss")) return; const s = document.createElement("style"); s.id = "qbCss"; s.textContent = CSS; document.head.appendChild(s); };
  const norm = (q) => ({ id: q.id || uid(), q: String(q.q || "").slice(0, 160), type: TYPES[q.type] ? q.type : "short", required: !!q.required, options: (q.options || []).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 10), placeholder: String(q.placeholder || "").slice(0, 80), min: +q.min || 1, max: +q.max || 6 });

  /** The host's question editor. Saves into ev.questions and ev.qStyle via onChange(ev). */
  function builder(box, ev, onChange) { css(); ev.questions = (ev.questions || []).map(norm); ev.qStyle = ev.qStyle || {};
    const save = () => onChange?.(ev);
    const draw = () => { const Q = ev.questions, P = ev.qStyle;
      box.innerHTML = `<div class="qb"><div class="qb-starters" aria-label="Add a question">${STARTERS.map((s, i) => [s, i]).filter(([s]) => !Q.some((q) => q.q === s.q) && !(s.diet && hasDietChips(ev)) && !(s.biz && friendsEv(ev))).map(([s, i]) => `<button type="button" data-add="${i}">＋ ${esc(s.q)}</button>`).join("")}<button type="button" data-add="new">＋ Write your own</button></div>
        ${Q.map((q, i) => `<div class="qb-q" data-i="${i}"><div class="r"><input type="text" class="qt" value="${esc(q.q)}" placeholder="Your question (emoji welcome)" data-k="q"><select data-k="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${q.type === k ? "selected" : ""}>${l}</option>`).join("")}</select><span class="tools"><button type="button" data-mv="-1" title="Up">↑</button><button type="button" data-mv="1" title="Down">↓</button><button type="button" data-del title="Remove">✕</button></span></div>
          ${/choice|multi|emoji|time/.test(q.type) ? `<div class="r"><textarea rows="${Math.min(6, Math.max(2, q.options.length + 1))}" style="flex:1;min-width:0;font:inherit" placeholder="${q.type === "time" ? "5:45 pm\n6:00 pm\n6:15 pm" : q.type === "emoji" ? "🙂\n😋\n🤤" : "Yes, often\nNow and then"}" data-k="options">${esc(q.options.join("\n"))}</textarea><small>one per line</small></div>` : ""}
          ${q.type === "number" ? `<div class="r"><small>From</small><input type="text" style="width:60px" value="${q.min}" data-k="min"><small>to</small><input type="text" style="width:60px" value="${q.max}" data-k="max"></div>` : ""}
          <label class="r" style="font-size:13px"><input type="checkbox" data-k="required" ${q.required ? "checked" : ""}> Required</label></div>`).join("")}
        ${Q.length ? `<details ${P.title || P.button || P.thanks ? "open" : ""}><summary style="cursor:pointer;font-weight:600">✨ Give it personality</summary><div class="qb-pers" style="margin-top:8px"><label>Form title<input data-p="title" value="${esc(P.title || "")}" placeholder="Who's picking up?"></label><label>Button<input data-p="button" value="${esc(P.button || "")}" placeholder="Count me in 🍰"></label><label>Thank-you line<input data-p="thanks" value="${esc(P.thanks || "")}" placeholder="See you at 5:45! Bring an appetite."></label></div></details>
          <button type="button" class="btn ghost sm" data-preview style="justify-self:start">👀 Preview as a guest</button><div data-pv></div>` : ""}</div>`; };
    draw();
    box.onclick = (e) => { const a = e.target.closest("[data-add]"); if (a) { const s = a.dataset.add === "new" ? { q: "", type: "short" } : STARTERS[+a.dataset.add]; ev.questions.push(norm({ ...s, options: [...(s.options || [])] })); draw(); save(); if (a.dataset.add === "new") box.querySelector(".qb-q:last-of-type .qt")?.focus(); return; }
      const c = e.target.closest(".qb-q"), i = c ? +c.dataset.i : -1;
      if (e.target.closest("[data-del]")) { ev.questions.splice(i, 1); draw(); save(); return; }
      const mv = e.target.closest("[data-mv]"); if (mv) { const j = i + +mv.dataset.mv; if (j < 0 || j >= ev.questions.length) return; [ev.questions[i], ev.questions[j]] = [ev.questions[j], ev.questions[i]]; draw(); save(); return; }
      if (e.target.closest("[data-preview]")) { const pv = box.querySelector("[data-pv]"); pv.innerHTML = ""; flow(pv, ev, {}, { preview: true }); } };
    box.onchange = box.oninput = (e) => { const t = e.target, c = t.closest(".qb-q"); if (t.dataset.p) { ev.qStyle[t.dataset.p] = t.value.slice(0, 80); save(); return; } if (!c || !t.dataset.k) return; const q = ev.questions[+c.dataset.i], k = t.dataset.k;
      if (k === "options") q.options = t.value.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10); else if (k === "required") q.required = t.checked; else if (k === "min" || k === "max") q[k] = Math.max(0, Math.min(99, +t.value || 0)); else q[k] = t.value.slice(0, 160);
      if (e.type === "change" && k === "type") { draw(); } save(); }; }

  /** The guest's one-question-at-a-time card. Fills `answers` (keyed by question id). Returns { missing() }. */
  function flow(box, ev, answers, { preview = false, onDone } = {}) { css(); const Q = (ev.questions || []).map(norm).filter((q) => q.q.trim()); if (!Q.length) return { missing: () => null };
    const P = ev.qStyle || {}; let i = 0; const el = document.createElement("div"); el.className = "tf"; box.appendChild(el);
    const val = (q) => answers[q.id], has = (q) => { const v = val(q); return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== ""; };
    const draw = (done = false) => { const pct = Math.round(((done ? Q.length : i) / Q.length) * 100);
      if (done) { el.innerHTML = `<div class="tf-bar"><i style="width:100%"></i></div><div class="tf-done">${window.Potto ? window.Potto.svg("cheer", 96, "Potto cheering") : "🎉"}<b>${preview ? esc(P.thanks || "Got it, thank you!") : "Got it. Now tap Send."}</b><button type="button" class="bk" data-edit style="border:0;background:none;color:#6B5F56;cursor:pointer">Change an answer</button></div>`; onDone?.(); return; }
      const q = Q[i], v = val(q), opts = q.options.length ? q.options : q.type === "yesno" ? ["Yes", "No"] : q.type === "emoji" ? ["😐", "🙂", "😍"] : [];
      let input = "";
      if (q.type === "short" || q.type === "instagram" || q.type === "phone") input = `<input type="${q.type === "phone" ? "tel" : "text"}" value="${esc(v ?? "")}" placeholder="${esc(q.placeholder || (q.type === "instagram" ? "@yourhandle" : q.type === "phone" ? "(917) 555 0142" : "Type your answer"))}" maxlength="200">`;
      else if (q.type === "long") input = `<textarea placeholder="${esc(q.placeholder || "Type your answer")}" maxlength="500">${esc(v ?? "")}</textarea>`;
      else if (q.type === "number") input = `<div class="tf-step"><button type="button" data-st="-1" aria-label="Fewer">−</button><b>${v ?? q.min}</b><button type="button" data-st="1" aria-label="More">+</button></div>`;
      else input = `<div class="tf-opts ${q.type === "emoji" ? "emoji" : ""}" role="group">${opts.map((o, k) => `<button type="button" data-o="${esc(o)}" aria-pressed="${Array.isArray(v) ? v.includes(o) : v === o}">${q.type === "emoji" ? "" : `<span class="tf-key">${String.fromCharCode(65 + k)}</span>`}${esc(o)}</button>`).join("")}</div>`;
      el.innerHTML = `<div class="tf-bar"><i style="width:${pct}%"></i></div><div class="tf-top"><span class="tf-n">${P.title ? `${esc(P.title)}${Q.length > 1 ? ` · ${i + 1} of ${Q.length}` : ""}` : Q.length === 1 ? "One quick question" : `Question ${i + 1} of ${Q.length}`}</span><span class="tf-pt">${window.Potto ? window.Potto.svg(i % 3 === 2 ? "cheer" : "wave", 64, "Potto") : ""}</span></div>
        <div class="tf-q" id="tfq-${esc(q.id)}">${esc(q.q)}${q.required ? "" : " <small>(optional)</small>"}</div><div class="tf-a" role="group" aria-labelledby="tfq-${esc(q.id)}">${input.replace(/<(input|textarea)\b/g, `<$1 aria-labelledby="tfq-${esc(q.id)}"`)}</div><div class="tf-err" role="alert"></div>
        <div class="tf-nav">${i ? `<button type="button" class="bk" data-back>← Back</button>` : "<span></span>"}<span>${i === Q.length - 1 && !preview ? "" : `<button type="button" class="ok" data-next>${i === Q.length - 1 ? esc(P.button || "Done") : "Next"}</button>`}</span></div>`;
      if (q.type === "number" && v == null) answers[q.id] = q.min;
      const f = el.querySelector("input,textarea"); if (f && !preview) setTimeout(() => f.focus({ preventScroll: true }), 50); };
    let autoAt = 0;
    const next = (e) => { if (e && Date.now() - autoAt < 450) return; const q = Q[i], f = el.querySelector(".tf-a input,.tf-a textarea"); if (f) answers[q.id] = q.type === "instagram" && f.value.trim() ? "@" + f.value.trim().replace(/^@+/, "") : f.value.trim();
      if (q.required && !has(q)) { el.querySelector(".tf-err").textContent = "Answer this one first."; return; } if (i < Q.length - 1) { i++; draw(); } else draw(true); };
    el.addEventListener("click", (e) => { const q = Q[i];
      if (e.target.closest("[data-edit]")) { i = 0; draw(); return; } if (e.target.closest("[data-back]")) { const f = el.querySelector(".tf-a input,.tf-a textarea"); if (f) answers[q.id] = f.value.trim(); i = Math.max(0, i - 1); draw(); return; } if (e.target.closest("[data-next]")) return next(e);
      const st = e.target.closest("[data-st]"); if (st) { answers[q.id] = Math.max(q.min, Math.min(q.max, (+answers[q.id] || q.min) + +st.dataset.st)); el.querySelector(".tf-step b").textContent = answers[q.id]; return; }
      const o = e.target.closest("[data-o]"); if (o) { if (q.type === "multi") { const L = new Set(answers[q.id] || []); L.has(o.dataset.o) ? L.delete(o.dataset.o) : L.add(o.dataset.o); answers[q.id] = [...L]; o.setAttribute("aria-pressed", String(L.has(o.dataset.o))); } else { answers[q.id] = o.dataset.o; el.querySelectorAll("[data-o]").forEach((b) => b.setAttribute("aria-pressed", String(b === o))); setTimeout(() => { next(); autoAt = Date.now(); }, 260); } } });
    el.addEventListener("keydown", (e) => { const q = Q[i]; if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA") { e.preventDefault(); next(); } else if (/^[a-j]$/i.test(e.key) && !/INPUT|TEXTAREA/.test(e.target.tagName)) { const b = el.querySelectorAll("[data-o]")[e.key.toLowerCase().charCodeAt(0) - 97]; b?.click(); } });
    draw();
    return { missing: () => { const f = el.querySelector(".tf-a input,.tf-a textarea"); if (f && Q[i]) answers[Q[i].id] = f.value.trim(); const k = Q.findIndex((q) => q.required && !has(q)); if (k < 0) return null; i = k; draw(); el.querySelector(".tf-err").textContent = "One more question."; el.scrollIntoView({ behavior: "smooth", block: "center" }); return Q[k]; } };
  }
  window.Questions = { builder, flow, TYPES, STARTERS, norm };
})();
