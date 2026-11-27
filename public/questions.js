// Questions for guests. Hosts write their own reply questions in their own voice (any language, emoji welcome) and
// guests answer them one at a time: a progress bar, Enter to go on.
//   Questions.builder(container, event, onChange, opts) – the host's editor (the create canvas's "Questions for guests"
//     sheet, public/canvas.js, and the classic editor's panel in index.html). Returns { flush }.
//   Questions.flow(container, event, answers)            – the guest's one-at-a-time card (answers is filled in place)
//   Questions.askDiet(event)                             – whether the reply form asks "Anything you don't eat?"
//   Questions.wording(event, n)                          – the reply form's words: the host's own, else the defaults
// The editor never redraws a field someone is typing in: the event is updated on every keystroke, onChange is told on a
// short debounce (and at once on blur), and nothing ever writes back into an input after it is drawn. Adding, moving and
// removing a question moves only that card, so the scroll position, focus and the wording disclosure stay put.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const TYPES = { short: "Short answer", long: "Long answer", choice: "Pick one", multi: "Pick any", yesno: "Yes or no", emoji: "Emoji scale", number: "Number", time: "Pick a time", instagram: "Instagram handle", phone: "Phone" };

  // ---- "Anything you don't eat?": the reply form's own food question (one-tap answers, kept on the reply as `dietary`).
  // Asked when the host turned it on (ev.askDiet true), never when they took it off (false), and otherwise only when food
  // is what the event is: a dinner, a supper club, a potluck, a picnic, a tasting, a brunch, a cooking class. A run, a
  // hike, a game night, a hack night, a workshop or a drop never gets it by default, even with "then coffee" in the title.
  const FOOD = /\b(dinners?|supper|potluck|picnic|tasting|brunch|lunch|breakfast|feast|friendsgiving|thanksgiving|bbq|barbe?cue|cookout|cook(ing)?[ -]?(class|along|night|club|together)|baking class|bake[ -]?(along|night)|dumplings?|hot ?pot|dim sum|omakase|pizza night|taco night|fondue|crawfish|crab boil|wine (night|tasting)|dinner party|food (crawl|tour))\b/i;
  const NOTFOOD = /\b(run|runs|running|jog|hike|hiking|walk|ride|cycling|climb|yoga|pilates|swim|game night|board games?|hack ?night|hackathon|build night|workshop|drop|pickup|pop-?up shop|watch party|viewing party)\b/i;
  function askDiet(ev) { ev = ev || {}; if (ev.askDiet === true) return true; if (ev.askDiet === false) return false;
    const main = `${ev.activity || ""} ${ev.pubTitle || ""} ${ev.name || ""}`;
    if ((Array.isArray(ev.courses) ? ev.courses : ev.courses ? [ev.courses] : []).some((x) => String(x || "").trim())) return true; // the host listed the food
    if (FOOD.test(main)) return !NOTFOOD.test(main.replace(FOOD, " ")) || /cook(ing)?[ -]?class|baking class/i.test(main);
    return false; }

  // ---- the reply form's words ----
  const T = (s) => String(s ?? "").trim();
  /** The words guests see. n is how many questions there are. */
  function wording(ev, n = (ev?.questions || []).filter((q) => T(q.q)).length) { const P = ev?.qStyle || {};
    const defTitle = n > 1 ? `Question 1 of ${n}` : "One quick question";
    return { title: T(P.title) ? T(P.title) + (n > 1 ? ` · 1 of ${n}` : "") : defTitle, defTitle, button: T(P.button) || "Send my reply", defButton: "Send my reply", thanks: T(P.thanks) }; }

  // One-tap suggestions, written the way a host would ask. `diet` is the reply form's food question above.
  const STARTERS = [
    { q: "Anything you don't eat?", diet: true },
    { q: "A song for the playlist?", type: "short" },
    { q: "Bringing someone? Their name, please.", type: "short" },
    { q: "What would you like to learn?", type: "long" },
    { q: "Your Instagram?", type: "instagram" },
    { q: "Want in on the group chat?", type: "yesno" },
    { q: "Pick a pickup time", type: "time", options: ["5:45 pm", "6:00 pm", "6:15 pm", "6:30 pm"], biz: true },
    { q: "How many sets?", type: "number", min: 1, max: 6, biz: true },
    { q: "One fun fact about you", type: "long" },
  ];
  const friendsEv = (ev) => { try { return typeof isCasual === "function" ? !!isCasual(ev) : !!ev.casual; } catch { return !!ev.casual; } };
  const norm = (q) => ({ id: q.id || uid(), q: String(q.q || "").slice(0, 160), type: TYPES[q.type] ? q.type : "short", required: !!q.required, options: (q.options || []).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 10), placeholder: String(q.placeholder || "").slice(0, 80), min: +q.min || 1, max: +q.max || 6 });

  const ic = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const I = { up: ic("M6 15l6-6 6 6"), down: ic("M6 9l6 6 6-6"), del: ic("M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"), plus: ic("M12 5v14M5 12h14") };

  const CSS = `.qb{display:grid;gap:20px;color:var(--pl-ink,#1B1D1C);font:400 16px/1.5 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.qb .vh{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.qb-lab{margin:0 0 8px;font-size:14px;font-weight:600;color:var(--pl-soft,#444845)}
.qb-none{margin:0;color:var(--pl-soft,#444845);font-size:15px}
.qb-list{display:grid;gap:12px}
.qb .qb-q{border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px;background:var(--pl-surface,#FAF8F3);padding:8px 12px 12px;display:grid;gap:8px}
.qb .qb-hd{display:flex;align-items:center;gap:4px;min-height:44px}.qb .qb-hd>b{flex:1;font-size:14px;font-weight:600;color:var(--pl-soft,#444845)}
.qb .qb-ib{width:44px;height:44px;min-height:44px;display:grid;place-items:center;padding:0!important;margin:0!important;border:0!important;border-radius:6px!important;background:transparent!important;color:var(--pl-soft,#444845)!important;cursor:pointer;box-shadow:none!important}
.qb .qb-ib:hover{background:var(--pl-raised,#E6E1D5)!important;color:var(--pl-ink,#1B1D1C)!important}.qb .qb-ib[aria-disabled=true]{opacity:.35;cursor:default;background:transparent!important}
.qb .qb-ib:focus-visible,.qb .qb-sw:focus-visible,.qb .qb-add:focus-visible,.qb .qb-chip:focus-visible,.qb .qb-link:focus-visible,.qb summary:focus-visible{outline:2px solid var(--pl-accent,#29489A)!important;outline-offset:2px}
.qb :is(input[type=text],input[type=number],textarea,select){width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px!important;border:1.5px solid var(--pl-line-strong,#1B1D1C)!important;border-radius:6px!important;background:#fff!important;color:var(--pl-ink,#1B1D1C)!important;font:400 16px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)!important;box-shadow:none!important;margin:0}
.qb :is(input,textarea,select):focus{outline:2px solid var(--pl-accent,#29489A)!important;outline-offset:1px}
.qb .qb-qt{font-weight:500!important}
.qb select{appearance:none;-webkit-appearance:none;padding-right:36px!important;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%231B1D1C' stroke-width='1.6'/%3E%3C/svg%3E") no-repeat right 12px center!important;cursor:pointer}
.qb .qb-r2{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.qb .qb-r2 .qb-type{flex:1 1 160px;min-width:0}
.qb .qb-sw{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 4px!important;margin:0;border:0!important;background:none!important;color:var(--pl-ink,#1B1D1C)!important;font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;box-shadow:none!important}
.qb .qb-sw i{position:relative;width:40px;height:24px;border-radius:999px;background:var(--pl-line,#CFC8B9);flex:none;transition:background .15s}.qb .qb-sw i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.qb .qb-sw[aria-checked=true] i{background:var(--pl-accent,#29489A)}.qb .qb-sw[aria-checked=true] i::after{transform:translateX(16px)}
.qb .qb-extra{display:grid;gap:6px}.qb .qb-extra:empty{display:none}.qb .qb-extra small,.qb .qb-f small,.qb .qb-q>small{color:var(--pl-soft,#444845);font-size:14px;line-height:1.4}
.qb .qb-num{display:flex;gap:8px;align-items:center}.qb .qb-num input{width:84px}
.qb .qb-add{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin:0;border:1.5px solid var(--pl-ink,#1B1D1C)!important;border-radius:6px!important;background:var(--pl-surface,#FAF8F3)!important;color:var(--pl-ink,#1B1D1C)!important;font:600 16px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;box-shadow:none!important}
.qb .qb-sugg{display:flex;flex-wrap:wrap;gap:8px}.qb .qb-sugg [hidden]{display:none!important}
.qb .qb-chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px!important;margin:0;border:1px dashed var(--pl-line-strong,#1B1D1C)!important;border-radius:6px!important;background:transparent!important;color:var(--pl-ink,#1B1D1C)!important;font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;text-align:left;box-shadow:none!important}.qb .qb-chip svg{width:16px;height:16px;flex:none}
.qb .qb-words{border-top:1px dashed var(--pl-line,#CFC8B9);padding-top:8px}
.qb .qb-words>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:48px}.qb .qb-words>summary::-webkit-details-marker{display:none}
.qb .qb-words>summary b{display:block;font-size:16px;font-weight:600}.qb .qb-words>summary small{display:block;color:var(--pl-soft,#444845);font-size:14px;font-weight:400}
.qb .qb-words>summary::after{content:"";flex:none;width:10px;height:10px;border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;transform:rotate(45deg) translate(-2px,-2px);transition:transform .15s}.qb .qb-words[open]>summary::after{transform:rotate(-135deg) translate(-2px,-2px)}
.qb .qb-wf{display:grid;gap:16px;padding:8px 0 4px}
.qb .qb-f{display:grid;gap:6px}.qb .qb-f>span{font-size:15px;font-weight:600}
.qb .qb-pv{display:grid;gap:8px}
.qb .qb-mini{border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:#fff;padding:14px 14px 16px;display:grid;gap:8px}
.qb .qb-mini-t{margin:0;font-weight:600;font-size:13px;color:var(--pl-soft,#444845)}
.qb .qb-mini-q{margin:0;font-weight:600;font-size:17px;line-height:1.3;overflow-wrap:anywhere}.qb .qb-mini-q small{font-weight:400;color:var(--pl-soft,#444845);font-size:14px}
.qb .qb-mini-a{border-bottom:1.5px solid var(--pl-ink,#1B1D1C);color:var(--pl-soft,#444845);padding:6px 0;font-size:15px}
.qb .qb-mini-b{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:6px;background:var(--pl-accent,#29489A);color:#fff;font-weight:600;font-size:16px;margin-top:4px;overflow-wrap:anywhere;text-align:center;padding:0 12px}
.qb .qb-mini-ty{margin:4px 0 0;padding-top:8px;border-top:1px dashed var(--pl-line,#CFC8B9);font-size:15px;overflow-wrap:anywhere}.qb .qb-mini-ty small{display:block;color:var(--pl-soft,#444845);font-size:13px}
.qb .qb-link{justify-self:start;min-height:44px;padding:0!important;margin:0;border:0!important;background:none!important;color:var(--pl-accent-text,#29489A)!important;font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);text-decoration:underline;text-underline-offset:3px;cursor:pointer;box-shadow:none!important}
.qb [hidden]{display:none!important}
@media (max-width:640px){.cv-sh-bg.qb-sheet{align-items:flex-start!important;padding:0!important}.cv-sh-bg.qb-sheet .cv-sh{max-width:none;max-height:none;height:var(--qb-vh,100dvh);border-radius:0!important;transform:translateY(var(--qb-top,0px));animation:none}}
@media (min-width:641px){.cv-sh-bg.qb-sheet .cv-sh{border-radius:6px!important}}
.cv-sh-bg.qb-sheet .cv-sh>footer{position:sticky;bottom:0;background:var(--pl-surface,#FAF8F3)}
.tf{position:relative;border:1.5px solid var(--pl-ink);border-radius:6px;background:var(--pl-surface,#fff);padding:22px 20px 18px;overflow:hidden}
.tf-bar{position:absolute;left:0;top:0;height:4px;background:var(--pl-line);width:100%}.tf-bar i{display:block;height:100%;background:var(--tf,var(--pl-accent));transition:width .45s cubic-bezier(.3,1.4,.5,1)}
.tf-top{display:flex;justify-content:space-between;align-items:center;margin-top:4px}.tf-n{font-weight:600;font-size:13px;font-family:inherit;color:var(--pl-soft)}.tf-pt{width:64px;height:64px}
.tf-q{font:600 20px/1.3 var(--pl-font-text);margin:6px 0 4px;animation:tfIn .4s cubic-bezier(.3,1.4,.5,1)}.tf-q small{font:500 14px "IBM Plex Sans",system-ui;color:var(--pl-soft);margin-left:6px}
@keyframes tfIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.tf-q,.tf-a{animation:none}}
.tf-a{display:grid;gap:8px;margin:12px 0 4px;animation:tfIn .45s cubic-bezier(.3,1.4,.5,1)}.tf-a input,.tf-a textarea{font-weight:500;font-size:18px;line-height:1.3;font-family:inherit;padding:12px 4px;border:0;border-bottom:1.5px solid var(--pl-ink);background:transparent;outline:none;width:100%}.tf-a textarea{min-height:90px;resize:vertical}
.tf-opts{display:flex;flex-wrap:wrap;gap:8px}.tf-opts button{border:1.5px solid var(--pl-ink);background:#fff;border-radius:6px;padding:11px 16px;min-height:44px;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer}.tf-opts button[aria-pressed=true]{background:var(--tf,var(--pl-accent));color:#fff;border-color:var(--tf,var(--pl-accent))}
.tf-opts.emoji button{font-size:28px;padding:8px 14px}.tf-key{font-weight:700;font-size:13px;font-family:inherit;opacity:.55;margin-right:6px}
.tf-step{display:flex;align-items:center;gap:16px}.tf-step button{width:52px;height:52px;border-radius:50%;border:1.5px solid var(--pl-ink);background:#fff;font-weight:600;font-size:28px;font-family:inherit;cursor:pointer}.tf-step b{font:600 32px var(--pl-font-text);min-width:40px;text-align:center}
.tf-nav{display:flex;justify-content:space-between;align-items:center;margin-top:12px}.tf-nav .ok{background:var(--tf,var(--pl-accent));color:#fff;border:0;border-radius:6px;min-height:44px;padding:0 18px;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer}.tf-nav .bk{border:0;background:none;color:var(--pl-soft);font-weight:600;font-size:15px;min-height:44px;font-family:inherit;cursor:pointer}.tf-nav small{color:var(--pl-soft)}
.tf-done{text-align:center;display:grid;justify-items:center;gap:6px}.tf-done b{font:600 18px var(--pl-font-text)}.tf-err{color:#A2361A;font-weight:600;font-size:14px;min-height:1.2em}`;
  const css = () => { const old = document.getElementById("qbCss"); if (old?.dataset.v === "2") return; old?.remove(); const s = document.createElement("style"); s.id = "qbCss"; s.dataset.v = "2"; s.textContent = CSS; document.head.appendChild(s); };
  let wordsOpen = null; // the wording disclosure remembers being opened or closed for as long as the page is open

  /** The host's question editor. Writes into ev.questions, ev.qStyle and ev.askDiet; tells onChange(ev) on a debounce.
   *  opts.onFullView: the "See the full guest view" link (else it draws the guest card under the preview). */
  function builder(box, ev, onChange, opts = {}) { css(); ev.questions = (ev.questions || []).map(norm); ev.qStyle = { ...(ev.qStyle || {}) };
    let t = 0; const flush = () => { if (!t) return; clearTimeout(t); t = 0; onChange?.(ev); }, save = (now) => { clearTimeout(t); t = setTimeout(() => { t = 0; onChange?.(ev); }, 300); if (now) flush(); };
    const $ = (s) => box.querySelector(s), $$ = (s) => [...box.querySelectorAll(s)];
    const find = (id) => ev.questions.find((q) => q.id === id);
    const starters = () => STARTERS.map((s, i) => [s, i]).filter(([s]) => !(s.biz && friendsEv(ev)));
    const extraHTML = (q) => /choice|multi|emoji|time/.test(q.type)
      ? `<label class="qb-f"><span class="vh">Answers</span><textarea rows="${Math.min(6, Math.max(3, q.options.length + 1))}" data-k="options" placeholder="${q.type === "time" ? "5:45 pm&#10;6:00 pm&#10;6:15 pm" : q.type === "emoji" ? "One emoji per line" : "Yes, often&#10;Now and then"}">${esc(q.options.join("\n"))}</textarea><small>The answers guests pick from, one per line.</small></label>`
      : q.type === "number" ? `<div class="qb-num"><label class="qb-f"><span class="vh">From</span><input type="number" inputmode="numeric" min="0" max="99" value="${q.min}" data-k="min"></label><small>to</small><label class="qb-f"><span class="vh">To</span><input type="number" inputmode="numeric" min="0" max="99" value="${q.max}" data-k="max"></label></div>` : "";
    const cardHTML = (q) => `<div class="qb-q" data-id="${esc(q.id)}" role="group" aria-label="Question"><div class="qb-hd"><b class="qb-n">Question</b><button type="button" class="qb-ib" data-mv="-1" aria-label="Move up">${I.up}</button><button type="button" class="qb-ib" data-mv="1" aria-label="Move down">${I.down}</button><button type="button" class="qb-ib" data-del aria-label="Remove this question">${I.del}</button></div>
      <label class="qb-f"><span class="vh">Your question</span><input type="text" class="qb-qt" data-k="q" value="${esc(q.q)}" placeholder="Type your question" maxlength="160" autocomplete="off" enterkeyhint="done"></label>
      <div class="qb-r2"><label class="qb-type"><span class="vh">Answer type</span><select data-k="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}"${q.type === k ? " selected" : ""}>${l}</option>`).join("")}</select></label><button type="button" class="qb-sw" role="switch" data-k="required" aria-checked="${q.required}"><i></i><span>Required</span></button></div>
      <div class="qb-extra">${extraHTML(q)}</div></div>`;
    const dietHTML = () => `<div class="qb-q qb-diet" role="group" aria-label="Food question"><div class="qb-hd"><b>Food</b><button type="button" class="qb-ib" data-diet-off aria-label="Stop asking what guests don't eat">${I.del}</button></div><p class="qb-mini-q" style="margin:0">Anything you don't eat?</p><small>Asked in the reply form with one-tap answers, like Vegetarian or Nut allergy.</small></div>`;
    const W0 = wording(ev), P = ev.qStyle, open = wordsOpen ?? !!(T(P.title) || T(P.button) || T(P.thanks));
    box.innerHTML = `<div class="qb"><div class="qb-list" aria-label="Your questions">${askDiet(ev) ? dietHTML() : ""}${ev.questions.map(cardHTML).join("")}</div><p class="qb-none" data-none>No questions yet. Guests just say if they're coming.</p>
      <button type="button" class="qb-add" data-add="new">${I.plus}Add a question</button>
      <div><p class="qb-lab" id="qbSugH">Or add one of these</p><div class="qb-sugg" role="group" aria-labelledby="qbSugH">${starters().map(([s, i]) => `<button type="button" class="qb-chip" data-add="${i}">${I.plus}${esc(s.q)}</button>`).join("")}</div></div>
      <details class="qb-words"${open ? " open" : ""}><summary><span><b>Reply form wording</b><small>Change the words guests see when they reply.</small></span></summary><div class="qb-wf">
        <label class="qb-f"><span>Form title</span><input type="text" data-p="title" value="${esc(P.title || "")}" placeholder="${esc(W0.defTitle)}" maxlength="80" autocomplete="off"><small data-hint="title">The heading above the questions. Default: ${esc(W0.defTitle)}</small></label>
        <label class="qb-f"><span>Button</span><input type="text" data-p="button" value="${esc(P.button || "")}" placeholder="${esc(W0.defButton)}" maxlength="80" autocomplete="off"><small>The reply button. Default: ${esc(W0.defButton)}</small></label>
        <label class="qb-f"><span>Thank-you line</span><input type="text" data-p="thanks" value="${esc(P.thanks || "")}" placeholder="Optional" maxlength="80" autocomplete="off"><small>Shown after someone says they're in. Leave it empty for none.</small></label></div></details>
      <section class="qb-pv" aria-label="Preview of the reply form"><p class="qb-lab" style="margin:0">Preview</p><div class="qb-mini"><p class="qb-mini-t" data-pv="title"></p><p class="qb-mini-q" data-pv="q"></p><div class="qb-mini-a" data-pv="a">Type your answer</div><span class="qb-mini-b" data-pv="button"></span><p class="qb-mini-ty" data-pv="thanks"></p></div>
        <button type="button" class="qb-link" data-full>See the full guest view</button><div data-flow></div></section></div>`;
    // the parts that follow what's typed; only text in the preview and labels changes, never a field
    const sync = () => { const Q = ev.questions.filter((q) => T(q.q)), n = Q.length, w = wording(ev, n), cards = $$(".qb-q[data-id]");
      cards.forEach((c, i) => { c.querySelector(".qb-n").textContent = `Question ${i + 1}`; c.setAttribute("aria-label", `Question ${i + 1}`); const [u, d] = c.querySelectorAll("[data-mv]"); u.setAttribute("aria-disabled", String(i === 0)); d.setAttribute("aria-disabled", String(i === cards.length - 1)); });
      $("[data-none]").hidden = cards.length > 0 || askDiet(ev);
      $$("[data-add]").forEach((b) => { if (b.dataset.add === "new") return; const s = STARTERS[+b.dataset.add]; b.hidden = s.diet ? askDiet(ev) : ev.questions.some((q) => T(q.q).toLowerCase() === s.q.toLowerCase()); });
      const tIn = $('[data-p="title"]'), hint = $('[data-hint="title"]'); if (tIn.placeholder !== w.defTitle) tIn.placeholder = w.defTitle; hint.textContent = `The heading above the questions. Default: ${w.defTitle}`;
      const pt = $('[data-pv="title"]'), pq = $('[data-pv="q"]'), pa = $('[data-pv="a"]'); pt.hidden = pq.hidden = pa.hidden = !n; pt.textContent = w.title;
      if (n) { pq.textContent = Q[0].q; if (!Q[0].required) pq.insertAdjacentHTML("beforeend", " <small>(optional)</small>"); pa.textContent = /choice|multi|yesno|emoji|time/.test(Q[0].type) ? (Q[0].options.length ? Q[0].options.slice(0, 3).join(" · ") : Q[0].type === "yesno" ? "Yes · No" : "Add the answers to pick from") : Q[0].type === "number" ? `${Q[0].min} to ${Q[0].max}` : "Type your answer"; }
      $('[data-pv="button"]').textContent = w.button; const ty = $('[data-pv="thanks"]'); ty.hidden = !w.thanks; ty.innerHTML = `<small>After they say they're in</small>${esc(w.thanks)}`; };
    sync();
    const add = (s) => { const q = norm({ ...s, options: [...(s.options || [])] }); ev.questions.push(q); $(".qb-list").insertAdjacentHTML("beforeend", cardHTML(q)); sync(); save(); return box.querySelector(`.qb-q[data-id="${q.id}"]`); };
    box.addEventListener("click", (e) => { const a = e.target.closest("[data-add]");
      if (a) { if (a.dataset.add === "new") { add({ q: "", type: "short" })?.querySelector(".qb-qt")?.focus(); return; }
        const s = STARTERS[+a.dataset.add]; if (s.diet) { ev.askDiet = true; $(".qb-list").insertAdjacentHTML("afterbegin", dietHTML()); sync(); save(); $(".qb-diet [data-diet-off]")?.focus({ preventScroll: true }); return; }
        const c = add(s); const next = $$("[data-add]").find((b) => !b.hidden && b.dataset.add !== "new"); (next || $('[data-add="new"]')).focus({ preventScroll: true }); return; }
      if (e.target.closest("[data-diet-off]")) { ev.askDiet = false; $(".qb-diet")?.remove(); sync(); save(); $('[data-add="new"]').focus({ preventScroll: true }); return; }
      if (e.target.closest("[data-full]")) { flush(); if (opts.onFullView) return opts.onFullView(); const f = $("[data-flow]"); f.innerHTML = ""; flow(f, ev, {}, { preview: true }); return; }
      const c = e.target.closest(".qb-q[data-id]"), q = c && find(c.dataset.id); if (!q) return;
      if (e.target.closest("[data-del]")) { const nx = c.nextElementSibling || c.previousElementSibling; ev.questions = ev.questions.filter((x) => x !== q); c.remove(); sync(); save(true); ((nx && nx.querySelector(".qb-qt,[data-diet-off]")) || $('[data-add="new"]')).focus({ preventScroll: true }); return; }
      const sw = e.target.closest('[data-k="required"]'); if (sw) { q.required = sw.getAttribute("aria-checked") !== "true"; sw.setAttribute("aria-checked", String(q.required)); sync(); save(); return; }
      const mv = e.target.closest("[data-mv]"); if (mv) { if (mv.getAttribute("aria-disabled") === "true") return; const i = ev.questions.indexOf(q), j = i + +mv.dataset.mv; if (j < 0 || j >= ev.questions.length) return;
        [ev.questions[i], ev.questions[j]] = [ev.questions[j], ev.questions[i]]; const other = box.querySelector(`.qb-q[data-id="${ev.questions[i].id}"]`);
        if (+mv.dataset.mv < 0) other.before(c); else other.after(c); sync(); save(); const b = c.querySelector(`[data-mv="${mv.dataset.mv}"]`); (b.getAttribute("aria-disabled") === "true" ? c.querySelector(`[data-mv="${-mv.dataset.mv}"]`) : b).focus({ preventScroll: true }); c.scrollIntoView({ block: "nearest" }); } });
    const onField = (e) => { const t = e.target;
      if (t.dataset.p) { const v = t.value.slice(0, 80).trim(); if (v) ev.qStyle[t.dataset.p] = v; else delete ev.qStyle[t.dataset.p]; sync(); save(); return; }
      const c = t.closest(".qb-q[data-id]"), q = c && find(c.dataset.id), k = t.dataset.k; if (!q || !k || k === "required") return;
      if (k === "options") q.options = t.value.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
      else if (k === "min" || k === "max") { const n = Math.round(+t.value); if (t.value !== "" && Number.isFinite(n)) q[k] = Math.max(0, Math.min(99, n)); }
      else if (k === "type") { if (e.type !== "change" || q.type === t.value) return; q.type = TYPES[t.value] ? t.value : "short"; c.querySelector(".qb-extra").innerHTML = extraHTML(q); }
      else q.q = t.value.slice(0, 160);
      sync(); save(); };
    box.addEventListener("input", onField); box.addEventListener("change", onField);
    box.addEventListener("focusout", () => flush());
    $(".qb-words").addEventListener("toggle", (e) => { wordsOpen = e.target.open; });
    // the sheet it sits in: full height on a phone, sized to the part of the screen the keyboard leaves, so Done stays in
    // reach and the field being typed in stays in view
    const bg = box.closest(".cv-sh-bg"), vv = window.visualViewport;
    if (bg && vv) { const fit = () => { if (!bg.isConnected) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); return; } bg.style.setProperty("--qb-vh", vv.height + "px"); bg.style.setProperty("--qb-top", vv.offsetTop + "px"); };
      fit(); vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }
    box.addEventListener("focusin", (e) => { if (!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; setTimeout(() => { try { if (document.activeElement === e.target) e.target.scrollIntoView({ block: "nearest" }); } catch {} }, 320); });
    return { flush }; }

  /** The guest's one-question-at-a-time card. Fills `answers` (keyed by question id). Returns { missing() }. It only moves
   *  focus after the guest moves on themselves (Next, Back, an answer), never when it is first drawn or redrawn: a page or a
   *  live preview that draws it must never take the keyboard away from someone typing elsewhere. */
  function flow(box, ev, answers, { preview = false, onDone } = {}) { css(); const Q = (ev.questions || []).map(norm).filter((q) => q.q.trim()); if (!Q.length) return { missing: () => null };
    const Wd = wording(ev, Q.length); let i = 0, moved = false; const el = document.createElement("div"); el.className = "tf"; box.appendChild(el);
    const val = (q) => answers[q.id], has = (q) => { const v = val(q); return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== ""; };
    const draw = (done = false) => { const pct = Math.round(((done ? Q.length : i) / Q.length) * 100);
      if (done) { el.innerHTML = `<div class="tf-bar"><i style="width:100%"></i></div><div class="tf-done">${window.Potto ? window.Potto.svg("cheer", 96, "Potto cheering") : ""}<b>${preview ? esc(Wd.thanks || "Got it, thank you.") : "Got it. Now tap " + esc(T(document.querySelector("#send,#g-send")?.textContent) || Wd.button) + "."}</b><button type="button" class="bk" data-edit style="border:0;background:none;color:var(--pl-soft);cursor:pointer;min-height:44px">Change an answer</button></div>`; onDone?.(); return; }
      const q = Q[i], v = val(q), opts = q.options.length ? q.options : q.type === "yesno" ? ["Yes", "No"] : q.type === "emoji" ? ["😐", "🙂", "😍"] : [];
      let input = "";
      if (q.type === "short" || q.type === "instagram" || q.type === "phone") input = `<input type="${q.type === "phone" ? "tel" : "text"}" value="${esc(v ?? "")}" placeholder="${esc(q.placeholder || (q.type === "instagram" ? "@yourhandle" : q.type === "phone" ? "(917) 555 0142" : "Type your answer"))}" maxlength="200"${q.type === "phone" ? ' autocomplete="tel"' : ""}>`;
      else if (q.type === "long") input = `<textarea placeholder="${esc(q.placeholder || "Type your answer")}" maxlength="500">${esc(v ?? "")}</textarea>`;
      else if (q.type === "number") input = `<div class="tf-step"><button type="button" data-st="-1" aria-label="Fewer">−</button><b>${v ?? q.min}</b><button type="button" data-st="1" aria-label="More">+</button></div>`;
      else input = `<div class="tf-opts ${q.type === "emoji" ? "emoji" : ""}" role="group">${opts.map((o, k) => `<button type="button" data-o="${esc(o)}" aria-pressed="${Array.isArray(v) ? v.includes(o) : v === o}">${q.type === "emoji" ? "" : `<span class="tf-key">${String.fromCharCode(65 + k)}</span>`}${esc(o)}</button>`).join("")}</div>`;
      const top = T(ev.qStyle?.title) ? `${esc(T(ev.qStyle.title))}${Q.length > 1 ? ` · ${i + 1} of ${Q.length}` : ""}` : Q.length === 1 ? "One quick question" : `Question ${i + 1} of ${Q.length}`;
      el.innerHTML = `<div class="tf-bar"><i style="width:${pct}%"></i></div><div class="tf-top"><span class="tf-n">${top}</span><span class="tf-pt">${window.Potto ? window.Potto.svg(i % 3 === 2 ? "cheer" : "wave", 64, "Potto") : ""}</span></div>
        <div class="tf-q" id="tfq-${esc(q.id)}">${esc(q.q)}${q.required ? "" : " <small>(optional)</small>"}</div><div class="tf-a" role="group" aria-labelledby="tfq-${esc(q.id)}">${input.replace(/<(input|textarea)\b/g, `<$1 aria-labelledby="tfq-${esc(q.id)}"`)}</div><div class="tf-err" role="alert"></div>
        <div class="tf-nav">${i ? `<button type="button" class="bk" data-back>Back</button>` : "<span></span>"}<span>${i === Q.length - 1 && !preview ? "" : `<button type="button" class="ok" data-next>${i === Q.length - 1 ? esc(Wd.button) : "Next"}</button>`}</span></div>`;
      if (q.type === "number" && v == null) answers[q.id] = q.min;
      const f = el.querySelector("input,textarea"); if (f && moved && !preview && !document.documentElement.classList.contains("pv")) setTimeout(() => f.focus({ preventScroll: true }), 50); };
    let autoAt = 0;
    const next = (e) => { if (e && Date.now() - autoAt < 450) return; const q = Q[i], f = el.querySelector(".tf-a input,.tf-a textarea"); if (f) answers[q.id] = q.type === "instagram" && f.value.trim() ? "@" + f.value.trim().replace(/^@+/, "") : f.value.trim();
      if (q.required && !has(q)) { el.querySelector(".tf-err").textContent = "Answer this one first."; return; } moved = true; if (i < Q.length - 1) { i++; draw(); } else draw(true); };
    el.addEventListener("click", (e) => { const q = Q[i];
      if (e.target.closest("[data-edit]")) { i = 0; moved = true; draw(); return; } if (e.target.closest("[data-back]")) { const f = el.querySelector(".tf-a input,.tf-a textarea"); if (f) answers[q.id] = f.value.trim(); i = Math.max(0, i - 1); moved = true; draw(); return; } if (e.target.closest("[data-next]")) return next(e);
      const st = e.target.closest("[data-st]"); if (st) { answers[q.id] = Math.max(q.min, Math.min(q.max, (+answers[q.id] || q.min) + +st.dataset.st)); el.querySelector(".tf-step b").textContent = answers[q.id]; return; }
      const o = e.target.closest("[data-o]"); if (o) { if (q.type === "multi") { const L = new Set(answers[q.id] || []); L.has(o.dataset.o) ? L.delete(o.dataset.o) : L.add(o.dataset.o); answers[q.id] = [...L]; o.setAttribute("aria-pressed", String(L.has(o.dataset.o))); } else { answers[q.id] = o.dataset.o; el.querySelectorAll("[data-o]").forEach((b) => b.setAttribute("aria-pressed", String(b === o))); setTimeout(() => { next(); autoAt = Date.now(); }, 260); } } });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA") { e.preventDefault(); next(); } else if (/^[a-j]$/i.test(e.key) && !/INPUT|TEXTAREA/.test(e.target.tagName)) { const b = el.querySelectorAll("[data-o]")[e.key.toLowerCase().charCodeAt(0) - 97]; b?.click(); } });
    draw();
    return { missing: () => { const f = el.querySelector(".tf-a input,.tf-a textarea"); if (f && Q[i]) answers[Q[i].id] = f.value.trim(); const k = Q.findIndex((q) => q.required && !has(q)); if (k < 0) return null; i = k; moved = true; draw(); el.querySelector(".tf-err").textContent = "One more question."; el.scrollIntoView({ behavior: "smooth", block: "center" }); return Q[k]; } };
  }
  window.Questions = { builder, flow, TYPES, STARTERS, norm, askDiet, wording };
})();
