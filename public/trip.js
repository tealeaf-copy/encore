// A group trip on its plan page (/plans/<id>, public/plan.html) and its feeler on the light invite (/e/<id>), from
// server/trips.js through GET /api/public/trip/:id. One script for both:
//   PLTrip.mount(root, P, { proof, refresh, setProof })   the plan page: the organiser's feeler and answers, or a friend's
//                                                          feeler; once it's the trip, where to stay, group deals,
//                                                          things to do and who lands when
//   PLTrip.feeler(root, { id, proof, onDone })            the light invite: the feeler form alone
// Honest by design: Potto finds and compares; nothing is booked here. Every price Potto shows says it's an estimate
// to check, and the search links carry only the place, the dates and the head count. Every tap answers at once and
// says plainly when a save fails.
(function () {
  if (window.PLTrip) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const gkey = () => { let k = null; try { k = localStorage.getItem("encore.gkey"); if (!k) { k = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("encore.gkey", k); } } catch {} return k || ""; };
  const clock = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
  const dshort = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const wk = (w) => { const t = new Date(w.to + "T12:00:00Z"), f = new Date(w.from + "T12:00:00Z"), opt = (o) => t.toLocaleDateString("en-US", { ...o, timeZone: "UTC" }); return `${dshort(w.from)} to ${opt({ weekday: "short" })} ${t.getUTCMonth() === f.getUTCMonth() ? t.getUTCDate() : opt({ month: "short", day: "numeric" })}`; }; // "Fri, Apr 9 to Sun 11"
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const G = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const I = { up: `<svg ${G}><path d="M10 16V4M5 9l5-5 5 5"/></svg>`, link: `<svg ${G}><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1"/></svg>`,
    plane: `<svg ${G}><path d="M2.5 11.5 17 6.5l-1 2.8-6.8 2.3L8 16l-1.6.5-.2-3.8-3.7-1.2z"/></svg>`, check: `<svg ${G}><path d="M4.5 10.5 8 14l7.5-8"/></svg>`, msg: `<svg ${G}><path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z"/></svg>`, copy: `<svg ${G}><rect x="7" y="7" width="9.5" height="9.5" rx="1.5"/><path d="M13 7V4.5A1 1 0 0 0 12 3.5H4.5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1H7"/></svg>` };
  const CSS = `
.tr{margin:18px 0 0;font:400 16px/1.45 var(--pl-font-text);color:var(--pl-ink)}
.tr-h2{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1.5px solid var(--pl-ink);font:600 18px/1.3 var(--pl-font-text)}
.tr-h2 small{font:500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--pl-soft);text-align:right}
.tr-card{margin:12px 0 0;padding:14px;border:1.5px solid var(--pl-line-strong);border-radius:6px;background:var(--pl-surface)}
.tr-card.on{border-color:var(--pl-accent);box-shadow:inset 0 0 0 1px var(--pl-accent)}
.tr-k{display:block;font:500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--pl-accent-text)}
.tr-name{margin:2px 0 4px;font:600 17px/1.3 var(--pl-font-text)}
.tr-line{margin:4px 0 0;font:400 15px/1.45 var(--pl-font-text)}.tr-soft{color:var(--pl-soft)}
.tr-note{margin:8px 0 0;font:400 14px/1.45 var(--pl-font-text);color:var(--pl-soft)}
.tr-est{display:inline-block;margin:0 0 0 6px;padding:1px 6px;border-radius:3px;background:var(--pl-sand);color:var(--pl-ink);font:500 11px/1.5 var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;vertical-align:1px}
.tr-honest{display:flex;gap:10px;align-items:flex-start;margin:10px 0 0;padding:10px 12px;border:1px dashed var(--pl-line-strong);border-radius:6px;font:400 14px/1.45 var(--pl-font-text);background:var(--pl-page)}
.tr-honest svg{width:18px;height:18px;flex:none;margin-top:2px}
.tr-row{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
.tr-b{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 14px;border-radius:6px;border:1.5px solid var(--pl-line-strong);background:var(--pl-surface);color:var(--pl-ink);font:500 15px var(--pl-font-text);text-decoration:none;cursor:pointer}
.tr-b.pri{background:var(--pl-accent);border-color:var(--pl-accent);color:var(--pl-on-accent,#fff)}.tr-b:disabled{opacity:.6;cursor:default}
.tr-b svg{width:17px;height:17px;flex:none}.tr-b.sm{min-height:44px;padding:0 12px;font-size:14px}
.tr-b:focus-visible,.tr-chip:focus-visible{outline:2px solid var(--pl-accent);outline-offset:2px}
.tr-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}
.tr-chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:6px;border:1.5px solid var(--pl-line-strong);background:var(--pl-surface);color:var(--pl-ink);font:500 15px var(--pl-font-text);cursor:pointer}
.tr-chip[aria-pressed="true"]{background:var(--pl-ink);border-color:var(--pl-ink);color:var(--pl-surface)}
.tr-chip small{font:500 12px var(--pl-font-mono);opacity:.8}
.tr-q{margin:18px 0 0;font:600 16px/1.35 var(--pl-font-text)}.tr-q small{display:block;font:400 14px var(--pl-font-text);color:var(--pl-soft)}
.tr-f{display:grid;gap:4px;margin:12px 0 0;font:500 14px var(--pl-font-text);color:var(--pl-soft)}
.tr-f input,.tr-f select,.tr-f textarea{min-height:44px;padding:8px 10px;border:1.5px solid var(--pl-line-strong);border-radius:6px;background:var(--pl-page);color:var(--pl-ink);font:400 16px var(--pl-font-text);width:100%;box-sizing:border-box}
.tr-f textarea{min-height:72px;resize:vertical}
.tr-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tr-msg{min-height:1.2em;margin:8px 0 0;font:400 14px var(--pl-font-text);color:var(--pl-success)}.tr-msg.bad{color:var(--pl-danger)}
.tr-bar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;min-height:44px;border-bottom:1px dashed var(--pl-line)}
.tr-bar b{font:600 15px var(--pl-font-text)}.tr-bar small{display:block;font:400 13px var(--pl-font-text);color:var(--pl-soft)}
.tr-meter{height:8px;border-radius:4px;background:var(--pl-raised,#E6E1D6);overflow:hidden}.tr-meter i{display:block;height:100%;background:var(--pl-accent)}
.tr-n{font:600 15px var(--pl-font-mono);min-width:2ch;text-align:right}
.tr-ppl{list-style:none;margin:8px 0 0;padding:0}.tr-ppl li{padding:10px 0;border-bottom:1px dashed var(--pl-line)}
.tr-ppl b{font:600 15px var(--pl-font-text)}.tr-ppl small{display:block;font:400 14px/1.4 var(--pl-font-text);color:var(--pl-soft)}
.tr-tag{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:3px;font:500 11px/1.5 var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;border:1px solid var(--pl-line-strong)}
.tr-tag.in{background:var(--pl-ink);color:var(--pl-surface)}
.tr-vote{display:inline-flex;align-items:center;gap:6px}.tr-vote[aria-pressed="true"]{background:var(--pl-ink);border-color:var(--pl-ink);color:var(--pl-surface)}
.tr-tips{list-style:none;margin:8px 0 0;padding:0;counter-reset:t}.tr-tips>li{padding:12px 0;border-bottom:1px dashed var(--pl-line)}
.tr-tips b{display:block;font:600 15px/1.35 var(--pl-font-text)}.tr-tips p{margin:4px 0 0;font:400 15px/1.45 var(--pl-font-text)}.tr-tips em{display:block;margin-top:4px;font:normal 500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--pl-accent-text)}
.tr-mail{white-space:pre-wrap;margin:8px 0 0;padding:10px;border:1px solid var(--pl-line);border-radius:6px;background:var(--pl-page);font:400 14px/1.5 var(--pl-font-text)}
.tr-arr{list-style:none;margin:8px 0 0;padding:0}.tr-arr li{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;align-items:start;padding:10px 0;border-bottom:1px dashed var(--pl-line)}
.tr-arr .ic{width:36px;height:36px;display:grid;place-items:center;border:1.5px solid var(--pl-line-strong);border-radius:6px}.tr-arr .ic svg{width:18px;height:18px}
.tr-arr b{font:600 15px var(--pl-font-text)}.tr-arr small{display:block;font:400 14px/1.4 var(--pl-font-text);color:var(--pl-soft)}
.tr-plan{display:grid;gap:8px;margin:10px 0 0;padding:10px;border:1px dashed var(--pl-line-strong);border-radius:6px}
details.tr-more{margin:12px 0 0;border:1.5px solid var(--pl-line-strong);border-radius:6px;background:var(--pl-surface)}
details.tr-more>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:48px;padding:0 14px;cursor:pointer;font:600 15px var(--pl-font-text)}
details.tr-more>summary::-webkit-details-marker{display:none}details.tr-more>summary small{font:500 12px var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--pl-soft)}
details.tr-more>div{padding:0 14px 14px}
.tr-done{padding:16px;border:1.5px solid var(--pl-line-strong);border-radius:6px;background:var(--pl-surface)}
@media (min-width:640px){.tr-opts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tr-opts .tr-card{margin:0}}
`;
  const css = () => { if (document.getElementById("trCss")) return; const s = document.createElement("style"); s.id = "trCss"; s.textContent = CSS; document.head.appendChild(s); };
  const J = { "Content-Type": "application/json" };
  async function post(url, body) { try { const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: J, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); return r.ok ? j : { error: j.message || "That didn't save. Try again." }; } catch { return { error: "That didn't save. Check your connection." }; } }
  async function getTrip(id, proof) { try { const q = proof?.rid && proof?.code ? `?rid=${encodeURIComponent(proof.rid)}&code=${encodeURIComponent(proof.code)}` : ""; const r = await fetch(`/api/public/trip/${encodeURIComponent(id)}${q}`, { credentials: "same-origin" }); return r.ok ? (await r.json()).trip : null; } catch { return null; } }
  const busy = (b, t) => { if (!b) return () => {}; const was = b.innerHTML; b.disabled = true; b.textContent = t; return () => { b.disabled = false; b.innerHTML = was; }; };
  const say = (root, k, t, bad) => { const m = root.querySelector(`[data-tmsg="${k}"]`); if (m) { m.className = "tr-msg" + (bad ? " bad" : ""); m.textContent = t; } };
  const estTag = `<span class="tr-est">Estimate</span>`;
  const copy = async (t, b) => { try { await navigator.clipboard.writeText(t); if (b) { const w = b.innerHTML; b.textContent = "Copied"; setTimeout(() => (b.innerHTML = w), 1600); } return true; } catch { return false; } };
  const smsHref = (t) => `sms:${/iPhone|iPad|Mac/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(t)}`;
  const pressed = (box, sel) => [...box.querySelectorAll(sel)].filter((x) => x.getAttribute("aria-pressed") === "true");
  const toggles = (box, sel, single) => box.querySelectorAll(sel).forEach((b) => (b.onclick = () => { const on = single || b.getAttribute("aria-pressed") !== "true"; if (single) box.querySelectorAll(sel).forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", String(on)); }));

  // ================= the feeler a friend answers =================
  function feelerHtml(T) { const M = T.mine || null, S = T.feelerSetup, keen = M && M.interest !== "no";
    const ch = (attr, v, label, on) => `<button type="button" class="tr-chip" ${attr}="${esc(v)}" aria-pressed="${!!on}">${esc(label)}</button>`;
    return `<section class="tr" aria-label="Would you be up for it?"><div class="tr-card">
      <span class="tr-k">${esc(T.host)} is asking${T.destination ? ` · ${esc(T.destination)}` : ""}</span><p class="tr-name">${esc(T.title)}</p>
      ${S.note ? `<p class="tr-line">${esc(S.note)}</p>` : ""}<p class="tr-note">Nothing's booked. Your answer helps ${esc(T.host)} pick the weekend and the budget. No account needed.</p>
      <p class="tr-q">Would you be up for it?</p><div class="tr-chips" role="group" aria-label="Would you be up for it?">${[["in", "I'm in"], ["maybe", "Maybe"], ["no", "Can't make it"]].map(([v, l]) => ch("data-fi", v, l, M ? M.interest === v : false)).join("")}</div>
      <div data-fkeen${M && !keen ? " hidden" : ""}>
        ${S.weekends.length ? `<p class="tr-q">Which weekends work?<small>Tap all that do.</small></p><div class="tr-chips">${S.weekends.map((w) => ch("data-fw", w.from, wk(w), M?.weekends?.includes(w.from))).join("")}</div>` : ""}
        <p class="tr-q">Rough budget for you<small>Where you stay and what you do. Not counting flights.</small></p><div class="tr-chips">${S.budgets.map((b, i) => ch("data-fb", i, b, M?.budget === i)).join("")}</div>
        ${S.interests.length ? `<p class="tr-q">What would you want to do?<small>Tap any.</small></p><div class="tr-chips">${S.interests.map((x) => ch("data-fx", x, x, M?.wants?.includes(x))).join("")}</div>` : ""}
      </div>
      <label class="tr-f">Anything else? <span class="tr-soft">Optional</span><textarea data-fn maxlength="300" placeholder="Can only do two nights. Would love a show.">${esc(M?.note || "")}</textarea></label>
      ${M ? "" : signed() ? `<p class="tr-note">You're signed in, so this goes with your account.</p>` : `<label class="tr-f">Your name<input data-fname autocomplete="name" maxlength="80" required></label>
      <label class="tr-f">Phone or email <span class="tr-soft">Optional. So ${esc(T.host)} can tell you when it's on.</span><input data-fct autocomplete="tel" inputmode="email" maxlength="120" placeholder="(555) 123-4567 or you@example.com"></label>`}
      <div class="tr-row"><button type="button" class="tr-b pri" data-fsend>${M ? "Update my answer" : "Send my answer"}</button></div><p class="tr-msg" data-tmsg="feel" role="status"></p>
      <p class="tr-note">Only ${esc(T.host)} sees your budget and your note.</p></div></section>`; }
  function wireFeeler(root, T, { proof, onDone }) {
    const box = root.querySelector(".tr"); toggles(box, "[data-fi]", true); toggles(box, "[data-fw]"); toggles(box, "[data-fb]", true); toggles(box, "[data-fx]");
    box.querySelectorAll("[data-fi]").forEach((b) => b.addEventListener("click", () => { const k = box.querySelector("[data-fkeen]"); if (k) k.hidden = pressed(box, "[data-fi]")[0]?.dataset.fi === "no"; }));
    box.querySelector("[data-fsend]").onclick = async (ev) => { const b = ev.currentTarget, interest = pressed(box, "[data-fi]")[0]?.dataset.fi || "", name = box.querySelector("[data-fname]")?.value.trim() || "";
      if (!interest) return say(box, "feel", "Tap I'm in, Maybe or Can't make it.", true);
      if (box.querySelector("[data-fname]") && !name) { say(box, "feel", "Add your name so they know it's you.", true); return box.querySelector("[data-fname]").focus(); }
      const body = { ...(proof || {}), key: gkey(), interest, name, contact: box.querySelector("[data-fct]")?.value.trim() || "", weekends: pressed(box, "[data-fw]").map((x) => x.dataset.fw), budget: pressed(box, "[data-fb]")[0]?.dataset.fb ?? "", wants: pressed(box, "[data-fx]").map((x) => x.dataset.fx), note: box.querySelector("[data-fn]").value.trim() };
      const undo = busy(b, "Sending"), j = await post(`/api/public/trip/${encodeURIComponent(T.id)}/answer`, body); undo();
      if (j.error) return say(box, "feel", j.error, true);
      const pr = { rid: j.rid, code: j.code }; ls.set("encore-rsvp-" + T.id, { ...(ls.get("encore-rsvp-" + T.id) || {}), rid: j.rid, code: j.code, name: name || ls.get("encore-rsvp-" + T.id)?.name || "", response: interest === "no" ? "no" : "maybe", eventId: T.id });
      window.PLFx?.haptic?.("light"); onDone?.(j.trip, pr); };
  }
  function thanksHtml(T) { const M = T.mine || {}, n = (M.weekends || []).length;
    return `<section class="tr"><div class="tr-done"><span class="tr-k">Sent to ${esc(T.host)}</span><p class="tr-name">${M.interest === "no" ? "Thanks for saying. Maybe next time." : M.interest === "maybe" ? "You're a maybe. Thanks." : "You're keen. Nice."}</p>
      <p class="tr-line">${M.interest === "no" ? `${esc(T.host)} knows you can't make it.` : `${n ? `${n} weekend${n === 1 ? "" : "s"} work for you. ` : ""}${esc(T.host)} picks the weekend once enough people answer, then tells you it's on.`}</p>
      <div class="tr-row"><button type="button" class="tr-b" data-fedit>Change my answer</button></div></div></section>`; }

  // ================= the organiser's feeler =================
  function hostFeelerHtml(T) { const S = T.feelerSetup, Su = T.summary, sent = T.published, all = [...S.weekends];
    for (const w of T.suggestWeekends || []) if (!all.some((x) => x.from === w.from)) all.push(w);
    const setup = `<details class="tr-more"${sent ? "" : " open"} data-tsetup><summary>${sent ? "The feeler" : "Send a feeler"}<small>${sent ? "Sent" : "Organiser"}</small></summary><div>
      <p class="tr-note">Friends answer from a link, no account: if they're up for it, which weekends work, a rough budget and what they'd want to do.</p>
      <label class="tr-f">Where<input data-sd value="${esc(T.destination)}" maxlength="60" placeholder="Las Vegas"></label>
      <p class="tr-q">Weekends to offer<small>Tap to offer or drop one. Friday to Sunday.</small></p><div class="tr-chips" data-swk>${all.map((w) => `<button type="button" class="tr-chip" data-sw="${esc(w.from)}" data-to="${esc(w.to)}" aria-pressed="${S.weekends.some((x) => x.from === w.from)}">${esc(wk(w))}</button>`).join("")}</div>
      <label class="tr-f">Add a weekend <span class="tr-soft">Pick its Friday</span><input type="date" data-sadd></label>
      <p class="tr-q">Things to do they can pick<small>Tap to drop one.</small></p><div class="tr-chips">${S.interests.map((x) => `<button type="button" class="tr-chip" data-si="${esc(x)}" aria-pressed="true">${esc(x)}</button>`).join("")}</div>
      <p class="tr-note">They also pick a budget: ${esc(S.budgets.join(", "))}, per person, not counting flights.</p>
      <label class="tr-f">A line from you <span class="tr-soft">Optional</span><textarea data-snote maxlength="300" placeholder="Priya turns 30! Thinking two nights, flights on your own.">${esc(S.note)}</textarea></label>
      <div class="tr-row"><button type="button" class="tr-b pri" data-ssave>${sent ? "Save changes" : "Save and get the link"}</button></div><p class="tr-msg" data-tmsg="setup" role="status"></p></div></details>`;
    const share = sent ? `<div class="tr-card"><span class="tr-k">Send it</span><p class="tr-line">Text it from your phone or drop it in the group chat. Friends tap the link and answer in a minute.</p>
      <div class="tr-row"><a class="tr-b pri" data-ssms href="#">${I.msg}Text it</a><button type="button" class="tr-b" data-scopy>${I.copy}Copy the message</button>${navigator.share ? `<button type="button" class="tr-b" data-sshare>Share</button>` : ""}</div></div>` : "";
    if (!sent) return `<section class="tr">${setup}</section>`;
    const max = Math.max(1, ...Su.weekends.map((w) => w.yes + w.maybe));
    const answers = !Su.answered ? `<p class="tr-note">No answers yet. They land here as friends reply.</p>` : `
      <p class="tr-line"><b>${Su.in} keen</b>, ${Su.maybe} maybe, ${Su.no} can't.</p>
      <p class="tr-q">Weekends<small>Keen first, then maybes.</small></p>${Su.weekends.map((w) => `<div class="tr-bar"><span><b>${esc(wk(w))}</b><small>${w.names.length ? esc(w.names.join(", ")) : "Nobody yet"}</small></span><span class="tr-meter" aria-hidden="true"><i style="width:${Math.round(((w.yes + w.maybe) / max) * 100)}%"></i></span><span class="tr-n" aria-label="${w.yes} keen, ${w.maybe} maybe">${w.yes}${w.maybe ? "+" + w.maybe : ""}</span></div>`).join("")}
      ${Su.budget.line ? `<p class="tr-q">Budget</p><p class="tr-line">${esc(Su.budget.line)}</p><p class="tr-note">${Su.budget.counts.filter((c) => c.count).map((c) => `${esc(c.label)}: ${c.count}`).join(" · ")}</p>` : ""}
      ${Su.wants.length ? `<p class="tr-q">What they want to do</p><div class="tr-chips">${Su.wants.map((w) => `<span class="tr-chip" style="cursor:default">${esc(w.label)} <small>${w.count}</small></span>`).join("")}</div>` : ""}
      <details class="tr-more"><summary>Everyone's answers<small>Only you see this</small></summary><div><ul class="tr-ppl">${Su.people.map((p) => `<li><b>${esc(p.name)}</b><span class="tr-tag${p.interest === "in" ? " in" : ""}">${p.interest === "in" ? "Keen" : p.interest === "maybe" ? "Maybe" : "Can't"}</span>${p.signedIn ? `<span class="tr-tag">Account</span>` : ""}<small>${[p.weekends.length ? `${p.weekends.length} weekend${p.weekends.length === 1 ? "" : "s"}` : p.interest === "no" ? "" : "No weekend picked", p.budget >= 0 ? T.feelerSetup.budgets[p.budget] : "", p.wants.join(", ")].filter(Boolean).map(esc).join(" · ")}</small>${p.note ? `<small>"${esc(p.note)}"</small>` : ""}</li>`).join("")}</ul></div></details>`;
    const best = Su.best, lock = `<div class="tr-card on"><span class="tr-k">When you're ready</span><p class="tr-name">Make it the trip</p>
      <p class="tr-line">Lock the weekend. Everyone keen for it is in right away, and everyone who answered hears it's on. Potto then lines up places to stay and things to do.</p>
      <label class="tr-f">The weekend<select data-lw>${T.feelerSetup.weekends.map((w) => { const s = Su.weekends.find((x) => x.from === w.from); return `<option value="${esc(w.from)}"${best?.from === w.from ? " selected" : ""}>${esc(wk(w))}${s && (s.yes || s.maybe) ? ` · ${s.yes} keen${s.maybe ? `, ${s.maybe} maybe` : ""}` : ""}</option>`; }).join("")}</select></label>
      <div class="tr-row"><button type="button" class="tr-b pri" data-lock>Lock it and invite the yeses</button></div><p class="tr-msg" data-tmsg="lock" role="status"></p></div>`;
    return `<section class="tr">${share}<h2 class="tr-h2">Answers<small>${Su.answered} so far</small></h2>${answers}${dealsHtml(T, true)}${lock}${setup}</section>`; }
  function wireHostFeeler(root, T, ctx) { const box = root.querySelector(".tr"); if (!box) return; toggles(box, "[data-sw]"); toggles(box, "[data-si]");
    const msgText = () => `${T.title}${T.destination && !new RegExp(T.destination.split(" ").pop(), "i").test(T.title) ? `, ${T.destination}` : ""}. Would you be up for it? Tap which weekends work and a rough budget, no account needed: ${location.origin}${T.link}`;
    box.querySelector("[data-sadd]")?.addEventListener("change", (e) => { const v = e.target.value; if (!v) return; const d = new Date(v + "T12:00:00Z"), fri = new Date(d.getTime() - (((d.getUTCDay() + 2) % 7)) * 864e5).toISOString().slice(0, 10), to = new Date(Date.parse(fri + "T12:00:00Z") + 2 * 864e5).toISOString().slice(0, 10);
      if (!box.querySelector(`[data-sw="${fri}"]`)) box.querySelector("[data-swk]").insertAdjacentHTML("beforeend", `<button type="button" class="tr-chip" data-sw="${fri}" data-to="${to}" aria-pressed="true">${esc(wk({ from: fri, to }))}</button>`); toggles(box, "[data-sw]"); e.target.value = ""; });
    box.querySelector("[data-ssave]")?.addEventListener("click", async (ev) => { const weekends = pressed(box, "[data-sw]").map((x) => ({ from: x.dataset.sw, to: x.dataset.to })); if (!weekends.length) return say(box, "setup", "Pick at least one weekend for friends to choose from.", true);
      const undo = busy(ev.currentTarget, "Saving"), j = await post(`/api/host/trips/${encodeURIComponent(T.id)}/feeler`, { destination: box.querySelector("[data-sd]").value.trim(), weekends, interests: pressed(box, "[data-si]").map((x) => x.dataset.si), note: box.querySelector("[data-snote]").value.trim(), publish: true }); undo();
      if (j.error) return say(box, "setup", j.error, true); ctx.set(j.trip); say(root, "setup", T.published ? "Saved." : "Saved. Now send it."); });
    const sms = box.querySelector("[data-ssms]"); if (sms) sms.href = smsHref(msgText());
    box.querySelector("[data-scopy]")?.addEventListener("click", (e) => copy(msgText(), e.currentTarget));
    box.querySelector("[data-sshare]")?.addEventListener("click", () => navigator.share?.({ title: T.title, text: msgText() }).catch(() => {}));
    wireDeals(box, T);
    box.querySelector("[data-lock]")?.addEventListener("click", async (ev) => { const from = box.querySelector("[data-lw]").value, undo = busy(ev.currentTarget, "Locking it");
      const j = await post(`/api/host/trips/${encodeURIComponent(T.id)}/lock`, { from }); if (j.error) { undo(); return say(box, "lock", j.error, true); }
      ctx.locked = j; window.PLFx?.stamp?.("It's on", ev.currentTarget, { small: true }); await ctx.refresh(); });
  }

  // ================= group deals =================
  function dealsHtml(T, feeler) { const D = T.deals; if (!D) return "";
    return `<details class="tr-more" data-tdeals><summary>Find group deals<small>For ${D.people}, ${D.nights} night${D.nights === 1 ? "" : "s"}</small></summary><div>
      <div class="tr-honest">${I.check}<span>${esc(D.note)}</span></div>
      <p class="tr-q">Cheapest per person for ${D.people}${feeler ? "<small>From who's keen so far. It re-ranks as people answer.</small>" : "<small>It re-ranks when people join or drop out.</small>"}</p>
      <ol class="tr-tips">${D.options.map((o) => `<li><b>${esc(o.name)}${estTag}</b><p>${esc(o.rooms)}. ${esc(o.line)}. ${esc(o.totalLine)}.</p>${o.over ? `<p class="tr-soft">Over the lowest budget people gave.</p>` : ""}<div class="tr-row">${o.links.map((l) => `<a class="tr-b sm" href="${esc(l.href)}" target="_blank" rel="noopener nofollow">${I.link}${esc(l.label)}</a>`).join("")}</div></li>`).join("")}</ol>
      <p class="tr-q">Ways to pay less</p><ul class="tr-tips">${D.tips.map((t) => `<li><b>${esc(t.title)}</b><p>${esc(t.how)}</p>${t.email ? `<details class="tr-more"><summary>The email to send<small>Copy it</small></summary><div><p class="tr-mail" data-mail>Subject: ${esc(t.email.subject)}\n\n${esc(t.email.body)}</p><div class="tr-row"><button type="button" class="tr-b sm" data-tcopymail>${I.copy}Copy the email</button></div></div></details>` : ""}<em>${esc(t.check)}</em></li>`).join("")}</ul>
      ${D.weekends.length > 1 ? `<p class="tr-q">Your weekends, likely cheapest first<small>A rough guess from the season and holidays.</small></p><ol class="tr-tips">${D.weekends.map((w) => `<li><b>${esc(w.label)}</b><p>${esc(w.why)}${w.free != null ? `. ${w.free} can make it.` : ""}</p></li>`).join("")}</ol>` : ""}
    </div></details>`; }
  function wireDeals(box, T) { box.querySelectorAll("[data-tcopymail]").forEach((b) => (b.onclick = () => copy(b.closest("div").parentElement.querySelector("[data-mail]").textContent, b))); }

  // ================= the trip =================
  function stayHtml(T) { const host = T.you.host, B = T.booking;
    let h = `<h2 class="tr-h2" id="stay">Where we're staying<small>${T.group.count} going</small></h2><div class="tr-honest">${I.check}<span>${esc(T.honest)}</span></div>`;
    if (B) h += `<div class="tr-card on"><span class="tr-k">Booked${B.paidBy ? ` by ${esc(B.paidBy)}` : ""}</span><p class="tr-name">${esc(B.name)}</p>${B.address ? `<p class="tr-line">${esc(B.address)}</p>` : ""}
      <p class="tr-line">${[B.checkIn && `Check in ${B.checkIn}`, B.checkOut && `check out ${B.checkOut}`].filter(Boolean).join(", ")}</p>${B.confirmation ? `<p class="tr-line">Confirmation <b>${esc(B.confirmation)}</b></p>` : ""}
      ${B.total ? `<p class="tr-line">${esc(B.total)} for the group, about ${esc(B.each)} each. It's in the shared costs below.</p>` : ""}${B.link ? `<div class="tr-row"><a class="tr-b" href="${esc(B.link)}" target="_blank" rel="noopener">${I.link}The booking</a></div>` : ""}</div>`;
    const list = T.stays.filter((s) => !B || s.picked);
    if (!B) h += list.length ? `<p class="tr-note">Vote for the ones you'd be happy with. ${host ? "You pick one, book it on the site, then paste the details here." : `${esc(T.host)} picks one and books it.`}</p><div class="tr-opts">${list.map((s) => `<div class="tr-card${s.picked ? " on" : ""}">
      <span class="tr-k">${s.picked ? "Picked" : s.potto ? "Potto's pick" : `Added${s.by ? ` by ${esc(s.by)}` : ""}`}${s.area ? ` · ${esc(s.area)}` : ""}</span><p class="tr-name">${esc(s.name)}</p>
      ${s.rooms ? `<p class="tr-line">${esc(s.rooms)}</p>` : ""}${s.line ? `<p class="tr-line">${esc(s.line)}${s.est ? estTag : ""}</p>` : ""}${s.totalLine ? `<p class="tr-note">${esc(s.totalLine)}. Check the price on your dates.</p>` : ""}
      ${s.why ? `<p class="tr-note">${esc(s.why)}</p>` : ""}${s.watch ? `<p class="tr-note">Watch for: ${esc(s.watch)}</p>` : ""}${s.over ? `<p class="tr-note">Over the lowest budget people gave.</p>` : ""}
      <div class="tr-row"><button type="button" class="tr-b tr-vote" data-tvote="stay" data-item="${esc(s.id)}" aria-pressed="${s.mine}">${I.up}${s.votes ? `${s.votes} ${s.votes === 1 ? "vote" : "votes"}` : "Vote"}</button>${host && !s.picked ? `<button type="button" class="tr-b" data-tpick="${esc(s.id)}">Pick this one</button>` : ""}</div>
      ${s.voters.length ? `<p class="tr-note">${esc(s.voters.join(", "))}</p>` : ""}
      <div class="tr-row">${s.link ? `<a class="tr-b sm" href="${esc(s.link)}" target="_blank" rel="noopener">${I.link}The listing</a>` : ""}${s.links.map((l) => `<a class="tr-b sm" href="${esc(l.href)}" target="_blank" rel="noopener nofollow">${I.link}${esc(l.label)}</a>`).join("")}</div>
      ${host ? `<div class="tr-row"><button type="button" class="tr-b sm" data-trmstay="${esc(s.id)}">Remove</button></div>` : ""}</div>`).join("")}</div>`
      : `<p class="tr-note">${host ? "Ask Potto for options, or add a place you found." : `${esc(T.host)} hasn't added options yet.`}</p>`;
    h += `<p class="tr-msg" data-tmsg="stay" role="status"></p>`;
    if (host) { const pick = T.stays.find((s) => s.picked);
      h += `<div class="tr-row">${B ? "" : `<button type="button" class="tr-b" data-tmore="stays">More options from Potto</button>`}</div>`
        + (B ? "" : `<details class="tr-more"><summary>Add a place you found<small>Organiser</small></summary><div><label class="tr-f">Name<input data-af="name" maxlength="80" placeholder="Two suites at the hotel we liked"></label><label class="tr-f">Area<input data-af="area" maxlength="60" placeholder="The Strip"></label>
          <label class="tr-f">Link<input data-af="link" inputmode="url" maxlength="400" placeholder="https://"></label><label class="tr-f">Total for the group, if you know it <span class="tr-soft">Optional</span><input data-af="total" inputmode="decimal" placeholder="1,840"></label>
          <label class="tr-f">Rooms or beds <span class="tr-soft">Optional</span><input data-af="rooms" maxlength="80" placeholder="2 suites, 6 beds"></label><div class="tr-row"><button type="button" class="tr-b pri" data-taddstay>Add it</button></div></div></details>`)
        + `<details class="tr-more"${pick && !B ? " open" : ""}><summary>${B ? "Change the booking" : "Booked it? Paste the details"}<small>Organiser</small></summary><div>
          <p class="tr-note">Book on the site, then paste what it gives you. The address and confirmation go only to people who are in. The total becomes a shared cost, split evenly.</p>
          <label class="tr-f">Place<input data-bf="name" maxlength="80" value="${esc(B?.name || pick?.name || "")}"></label><label class="tr-f">Confirmation number<input data-bf="confirmation" maxlength="60" value="${esc(B?.confirmation || "")}" autocapitalize="characters"></label>
          <label class="tr-f">Address<input data-bf="address" maxlength="200" value="${esc(B?.address || "")}"></label><div class="tr-two"><label class="tr-f">Check in<input data-bf="checkIn" value="${esc(B?.checkIn || "")}" placeholder="3pm"></label><label class="tr-f">Check out<input data-bf="checkOut" value="${esc(B?.checkOut || "")}" placeholder="11am"></label></div>
          <label class="tr-f">Total paid, all in<input data-bf="total" inputmode="decimal" value="${esc((B?.total || "").replace("$", ""))}" placeholder="1,840"></label><label class="tr-f">Who paid<select data-bf="paidBy">${(T.people || []).map((p) => `<option value="${esc(p.pid)}">${esc(p.pid === "host" ? `${p.name} (you)` : p.name)}</option>`).join("")}</select></label>
          <label class="tr-f">Booking link <span class="tr-soft">Optional</span><input data-bf="link" inputmode="url" maxlength="400" placeholder="https://"></label>
          <div class="tr-row"><button type="button" class="tr-b pri" data-tbook>Save the booking</button></div></div></details>`; }
    return h; }
  function ideasHtml(T) { const host = T.you.host, days = T.days || [];
    let h = `<h2 class="tr-h2" id="todo">Things to do<small>${T.ideas.filter((x) => x.when).length} on the plan</small></h2>`;
    if (T.wants?.length) h += `<p class="tr-note">What people said they'd like: ${T.wants.map((w) => `${esc(w.label)} (${w.count})`).join(", ")}.</p>`;
    h += T.ideas.length ? `<div class="tr-opts">${T.ideas.map((x) => `<div class="tr-card${x.when ? " on" : ""}"><span class="tr-k">${x.when ? esc(x.whenLine) : x.potto ? `Potto's idea${x.fits ? ` · fits ${x.fits}` : ""}` : `Added${x.by ? ` by ${esc(x.by)}` : ""}`}</span><p class="tr-name">${esc(x.title)}</p>
      ${x.line ? `<p class="tr-line">${esc(x.line)}${x.est ? estTag : ""}</p>` : ""}${x.group ? `<p class="tr-note">Group tip: ${esc(x.group)}</p>` : ""}${x.note ? `<p class="tr-note">${esc(x.note)}</p>` : ""}
      <div class="tr-row"><button type="button" class="tr-b tr-vote" data-tvote="idea" data-item="${esc(x.id)}" aria-pressed="${x.mine}">${I.up}${x.votes ? `${x.votes} ${x.votes === 1 ? "vote" : "votes"}` : "I'd do this"}</button>${x.link ? `<a class="tr-b sm" href="${esc(x.link)}" target="_blank" rel="noopener nofollow">${I.link}Look it up</a>` : ""}</div>
      ${x.voters.length ? `<p class="tr-note">${esc(x.voters.join(", "))}</p>` : ""}
      ${host ? (x.when ? `<div class="tr-row"><button type="button" class="tr-b sm" data-toff="${esc(x.id)}">Take it off the plan</button></div>` : `<details class="tr-more"><summary>Put it on the plan<small>Organiser</small></summary><div class="tr-plan" data-plan="${esc(x.id)}">
        <div class="tr-chips" role="group" aria-label="Which day">${days.map((d, i) => `<button type="button" class="tr-chip" data-pday="${esc(d.day)}" aria-pressed="${i === (x.part === "morning" && days.length > 1 ? 1 : Math.min(1, days.length - 1))}">${esc(d.label)}</button>`).join("")}</div>
        <div class="tr-two"><label class="tr-f">Time<input data-ptime value="${esc(clock(x.time))}" placeholder="8pm"></label><label class="tr-f">Total to split <span class="tr-soft">Optional</span><input data-pcost inputmode="decimal" placeholder="480"></label></div>
        <div class="tr-row"><button type="button" class="tr-b pri" data-tsched="${esc(x.id)}">Add to the plan</button></div></div></details>`) : ""}
      ${(x.mineToo || host) && !x.when ? `<div class="tr-row"><button type="button" class="tr-b sm" data-trmidea="${esc(x.id)}">Remove</button></div>` : ""}</div>`).join("")}</div>` : `<p class="tr-note">No ideas yet.</p>`;
    h += `<p class="tr-msg" data-tmsg="idea" role="status"></p>${host ? `<div class="tr-row"><button type="button" class="tr-b" data-tmore="ideas">More ideas from Potto</button></div>` : ""}
      <details class="tr-more"><summary>Add an idea<small>Anyone going</small></summary><div><label class="tr-f">What<input data-if="title" maxlength="80" placeholder="Sunset drinks somewhere high up"></label><label class="tr-f">A line about it <span class="tr-soft">Optional</span><input data-if="note" maxlength="200"></label><label class="tr-f">Link <span class="tr-soft">Optional</span><input data-if="link" inputmode="url" maxlength="400" placeholder="https://"></label><div class="tr-row"><button type="button" class="tr-b pri" data-taddidea>Add it</button></div></div></details>`;
    return h; }
  function arrivalsHtml(T) { const A = T.arrivals || [], mine = T.mineArrival || {}, days = T.days || [], opts = (sel) => { const all = days.length ? [{ day: new Date(Date.parse(days[0].day + "T12:00:00Z") - 864e5).toISOString().slice(0, 10) }, ...days] : []; return `<option value="">Pick a day</option>` + all.map((d) => `<option value="${esc(d.day)}"${d.day === sel ? " selected" : ""}>${esc(dshort(d.day))}</option>`).join(""); };
    const set = A.filter((a) => a.set), line = (a, k) => [a[k + "Day"] && dshort(a[k + "Day"]), a[k + "Time"] && clock(a[k + "Time"]), a[k + "Note"]].filter(Boolean).join(", ");
    return `<h2 class="tr-h2" id="arrivals">Who lands when<small>${set.length} of ${A.length}</small></h2><ul class="tr-arr">${A.map((a) => `<li><span class="ic">${I.plane}</span><span><b>${esc(a.name)}</b>${a.set ? `<small>Lands ${esc(line(a, "arrive") || "not sure yet")}</small><small>Leaves ${esc(line(a, "depart") || "not sure yet")}</small>` : `<small>Not added yet</small>`}</span></li>`).join("")}</ul>
      <details class="tr-more"${T.mineArrival ? "" : " open"}><summary>${T.mineArrival ? "Change your times" : "Add when you land and leave"}<small>Everyone going sees it</small></summary><div data-arr>
        <div class="tr-two"><label class="tr-f">Land<select data-a="arriveDay">${opts(mine.arriveDay)}</select></label><label class="tr-f">Time<input data-a="arriveTime" value="${esc(clock(mine.arriveTime))}" placeholder="3:20pm"></label></div>
        <label class="tr-f">Flight or how <span class="tr-soft">Optional</span><input data-a="arriveNote" maxlength="60" value="${esc(mine.arriveNote || "")}" placeholder="Flight 1234, or driving"></label>
        <div class="tr-two"><label class="tr-f">Leave<select data-a="departDay">${opts(mine.departDay)}</select></label><label class="tr-f">Time<input data-a="departTime" value="${esc(clock(mine.departTime))}" placeholder="6pm"></label></div>
        <label class="tr-f">Flight or how <span class="tr-soft">Optional</span><input data-a="departNote" maxlength="60" value="${esc(mine.departNote || "")}"></label>
        <div class="tr-row"><button type="button" class="tr-b pri" data-tarr>Save my times</button></div><p class="tr-msg" data-tmsg="arr" role="status"></p></div></details>`; }
  function tripHtml(T, ctx) { const L = ctx.locked;
    const told = L ? `<div class="tr-done"><span class="tr-k">It's on</span><p class="tr-name">${L.confirmed ? `${L.confirmed} ${L.confirmed === 1 ? "person is" : "people are"} in.` : "The weekend is locked."}</p><p class="tr-line">${L.told ? `${L.told} heard by email or text.` : "Nobody had left a phone or email."}${L.notYet?.length ? ` Still to say they're in: ${esc(L.notYet.join(", "))}.` : ""} Text the group so everyone sees it:</p>
      <div class="tr-row"><a class="tr-b pri" href="${esc(smsHref(L.message))}">${I.msg}Text the group</a><button type="button" class="tr-b" data-tcopyit>${I.copy}Copy the message</button></div></div>` : "";
    const jump = `<nav class="tr-row" aria-label="On this trip"><a class="tr-b sm" href="#stay">Stay</a><a class="tr-b sm" href="#todo">Things to do</a><a class="tr-b sm" href="#arrivals">Arrivals</a><a class="tr-b sm" href="/chats/${encodeURIComponent(T.id)}">${I.msg}Group chat</a></nav>`;
    return `<section class="tr">${told}<p class="tr-line"><b>${esc(T.group.names.join(", "))}</b></p>${jump}${stayHtml(T)}${T.you.host ? dealsHtml(T, false) : ""}${ideasHtml(T)}${arrivalsHtml(T)}</section>`; }
  function notInHtml(T) { return `<section class="tr"><div class="tr-card on"><span class="tr-k">It's on</span><p class="tr-name">${esc(T.title)}, ${esc(wk(T.dates))}</p><p class="tr-line">${esc(T.host)} locked the weekend. Are you in?</p>
    <div class="tr-row"><button type="button" class="tr-b pri" data-tin="in">I'm in</button><button type="button" class="tr-b" data-tin="no">Can't make it</button></div><p class="tr-msg" data-tmsg="in" role="status"></p></div></section>`; }

  function wireTrip(root, T, ctx) { const box = root.querySelector(".tr"); if (!box) return; const id = encodeURIComponent(T.id), pr = () => ctx.proof || {};
    const act = async (b, url, body, k, t, full) => { const undo = busy(b, "Saving"), j = await post(url, { ...pr(), ...body }); if (j.error) { undo(); return say(box, k, j.error, true); } window.PLFx?.haptic?.("light"); if (full) { await ctx.refresh(); say(root, k, t); return; } ctx.set(j.trip); say(root, k, t); };
    box.querySelector("[data-tcopyit]")?.addEventListener("click", (e) => copy(ctx.locked.message, e.currentTarget));
    box.querySelectorAll("[data-tvote]").forEach((b) => (b.onclick = () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); act(b, `/api/public/trip/${id}/vote`, { what: b.dataset.tvote, item: b.dataset.item, on }, b.dataset.tvote, on ? "Voted." : "Vote taken back."); }));
    box.querySelectorAll("[data-tpick]").forEach((b) => (b.onclick = () => act(b, `/api/host/trips/${id}/pick`, { stay: b.dataset.tpick }, "stay", "Picked. Book it on the site, then paste the details below.")));
    box.querySelectorAll("[data-trmstay]").forEach((b) => (b.onclick = () => act(b, `/api/host/trips/${id}/stays`, { action: "remove", stay: b.dataset.trmstay }, "stay", "Removed.")));
    box.querySelectorAll("[data-tmore]").forEach((b) => (b.onclick = () => b.dataset.tmore === "stays" ? act(b, `/api/host/trips/${id}/stays`, { action: "potto" }, "stay", "Potto added the shapes it had left.") : act(b, `/api/host/trips/${id}/ideas/potto`, {}, "idea", "Potto added a few more.")));
    const vals = (sel, attr) => { const o = {}; box.querySelectorAll(sel).forEach((x) => (o[x.getAttribute(attr)] = x.value.trim())); return o; };
    box.querySelector("[data-taddstay]")?.addEventListener("click", (e) => act(e.currentTarget, `/api/host/trips/${id}/stays`, vals("[data-af]", "data-af"), "stay", "Added. People can vote on it now."));
    box.querySelector("[data-tbook]")?.addEventListener("click", (e) => act(e.currentTarget, `/api/host/trips/${id}/booking`, vals("[data-bf]", "data-bf"), "stay", "Saved. The cost is split and check-in is on the plan.", true));
    box.querySelectorAll("[data-plan]").forEach((p) => toggles(p, "[data-pday]", true));
    box.querySelectorAll("[data-tsched]").forEach((b) => (b.onclick = () => { const p = b.closest("[data-plan]"); act(b, `/api/host/trips/${id}/schedule`, { idea: b.dataset.tsched, day: pressed(p, "[data-pday]")[0]?.dataset.pday || "", time: p.querySelector("[data-ptime]").value.trim(), cost: p.querySelector("[data-pcost]").value.trim() }, "idea", "On the plan.", true); }));
    box.querySelectorAll("[data-toff]").forEach((b) => (b.onclick = () => act(b, `/api/host/trips/${id}/schedule`, { idea: b.dataset.toff, off: true }, "idea", "Taken off the plan.", true)));
    box.querySelectorAll("[data-trmidea]").forEach((b) => (b.onclick = () => act(b, `/api/public/trip/${id}/idea`, { remove: b.dataset.trmidea }, "idea", "Removed.")));
    box.querySelector("[data-taddidea]")?.addEventListener("click", (e) => act(e.currentTarget, `/api/public/trip/${id}/idea`, vals("[data-if]", "data-if"), "idea", "Added, with your vote."));
    box.querySelector("[data-tarr]")?.addEventListener("click", (e) => act(e.currentTarget, `/api/public/trip/${id}/arrival`, vals("[data-a]", "data-a"), "arr", "Saved. Everyone going can see when you land."));
    box.querySelectorAll("[data-tin]").forEach((b) => (b.onclick = async () => { const undo = busy(b, "Saving"), j = await post(`/api/plans/peek/${id}/reply`, { ...pr(), response: b.dataset.tin }); if (j.error) { undo(); return say(box, "in", j.error, true); } await ctx.refresh(); }));
    wireDeals(box, T);
  }

  // ================= mounting =================
  async function mount(root, P, opts = {}) { if (!root) return; css(); const id = P.id;
    const ctx = mount.ctx && mount.ctx.id === id ? mount.ctx : (mount.ctx = { id, proof: opts.proof || null, T: null, locked: null, editing: false });
    ctx.refresh = opts.refresh || (async () => {}); ctx.root = root;
    ctx.set = (T) => { if (T) { ctx.T = T; draw(); } };
    const draw = () => { const T = ctx.T, r = ctx.root; if (!T) { r.innerHTML = ""; return; }
      if (T.feeler && T.you.host) { r.innerHTML = hostFeelerHtml(T); return wireHostFeeler(r, T, ctx); }
      if (T.feeler) { if (T.mine && !ctx.editing) { r.innerHTML = thanksHtml(T); r.querySelector("[data-fedit]").onclick = () => { ctx.editing = true; draw(); }; return; }
        r.innerHTML = feelerHtml(T); return wireFeeler(r, T, { proof: ctx.proof, onDone: (T2, pr) => { ctx.proof = pr; opts.setProof?.(pr); ctx.editing = false; ctx.set(T2); } }); }
      if (T.you.in) { r.innerHTML = tripHtml(T, ctx); return wireTrip(r, T, ctx); }
      if (T.mine) { r.innerHTML = notInHtml(T); return wireTrip(r, T, ctx); }
      r.innerHTML = ""; };
    if (ctx.T && !opts.fresh) draw();
    const T = await getTrip(id, ctx.proof); if (T) { ctx.T = T; if (ctx.root === root) draw(); }
  }
  /** The light invite: the feeler form alone, then thanks, with a link to the plan page. */
  async function feeler(root, { id, proof = null, onDone } = {}) { css(); const T = await getTrip(id, proof); if (!T || !T.feeler) return false;
    let editing = false, pr = proof;
    const draw = (T) => { if (T.mine && !editing) { root.innerHTML = thanksHtml(T); root.querySelector("[data-fedit]").onclick = () => { editing = true; draw(T); }; return; }
      root.innerHTML = feelerHtml(T); wireFeeler(root, T, { proof: pr, onDone: (T2, p2) => { pr = p2; editing = false; draw(T2); onDone?.(T2, p2); } }); };
    draw(T); return true; }
  /** The light invite's hook (public/invite.html): the page's top bar, then the feeler. */
  async function invite({ id, e = {}, mine = null } = {}) { const m = document.getElementById("m"); if (!m) return; const top = m.querySelector(".top")?.outerHTML || "";
    document.title = `${e.pubTitle || e.name || "A trip"} · Pottery Lab`; m.innerHTML = top + `<div id="tf" style="max-width:560px;margin:0 auto;padding:0 0 40px"></div>`;
    const proof = mine?.rid && mine?.code ? { rid: mine.rid, code: mine.code } : null, box = document.getElementById("tf");
    const after = () => { if (!box.querySelector("[data-tplan]")) box.insertAdjacentHTML("beforeend", `<p class="tr-note" data-tplan>Your answer is saved on this phone. <a href="/plans/${encodeURIComponent(id)}">The trip page</a> shows the plan once it's on.</p>`); };
    const ok = await feeler(box, { id, proof, onDone: after }); if (!ok) { box.innerHTML = `<p class="tr-note" style="padding:24px 0">This trip isn't asking anymore. <a href="/plans/${encodeURIComponent(id)}">See the trip</a></p>`; return; } if (proof) after(); }
  window.PLTrip = { mount: (root, P, o) => mount(root, P, { ...o, fresh: true }), feeler, invite, css };
})();
