// Review round 13 on the invite: slots (a lightning demo queue, a game-pick poll, a small bracket), quiet guests
// ("Coming solo", "3 others are coming solo", "Ask me about", the host's first-timer table note), Copy as Markdown, the
// .ics file and, on the Terminal look, the one-line reply. Runs on the full invite (/g) and the light invite (/e, where
// this one script tag also loads /slots.css, /plain.js and /series.js). Data: server/slots.js and server/series.js.
// Also the host's studio panel (Slots.hostPanel), used by index.html's round 13 block.
(function () {
  if (window.Slots) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const add = (src) => { if (document.querySelector(`script[src="${src}"],script[src^="${src}?"]`)) return; const t = document.createElement("script"); t.src = src; t.defer = true; document.head.appendChild(t); };
  const css = () => { if (!document.querySelector('link[href="/slots.css"],link[href^="/slots.css?"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/slots.css"; document.head.appendChild(l); } };
  const ls = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const gkey = () => { let k = ""; try { k = localStorage.getItem("encore.gkey") || ""; } catch {} return k; };
  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(gkey() ? { "x-encore-key": gkey() } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
  const getJ = (url) => fetch(url, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const mineOf = (id) => { const M = ls.get("encore-rsvp-" + id); return M && M.rid && M.code ? M : null; };
  const proofQ = (M) => (M ? `?rid=${encodeURIComponent(M.rid)}&code=${encodeURIComponent(M.code)}` : "");
  const two = (n) => String(n).padStart(2, "0");
  // drawn line glyphs (1.75px, the page's colour), never emoji on buttons
  const ICON = { copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>', up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>', term: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l5 5-5 5M12 17h7"/></svg>' };

  // ---------- the block ----------
  function lineupHTML(L, M, o = {}) {
    if (!L) return ""; if (L.locked) return "";
    const head = (eyebrow) => `<p class="sl-eyebrow">${esc(eyebrow)}</p><p class="sl-big">${esc(L.title)}</p>`;
    if (L.kind === "demos") {
      const rows = L.queue.map((q, i) => `<li class="${q.mine ? "mine" : ""}"><span class="sl-n sl-mono">${two(q.n)}</span><span class="sl-t">${esc(q.title)}${!i && !L.past ? `<span class="sl-first">First up</span>` : ""}</span><span class="sl-who">${esc(q.mine ? "You" : q.who)}</span></li>`)
        .concat(Array.from({ length: L.open }, (_, i) => `<li class="open"><span class="sl-n sl-mono">${two(L.queue.length + i + 1)}</span><span class="sl-t">Open</span><span></span></li>`)).join("");
      const form = L.past ? "" : L.canAct ? `<form class="sl-row" data-sl="claim"><label class="vh" for="slTitle" style="position:absolute;left:-9999px">What you'll show</label><input class="sl-in" id="slTitle" maxlength="80" required placeholder="What you'll show" value="${esc(L.mine || "")}"><button class="sl-btn" type="submit">${L.mine ? "Update" : "Claim a slot"}</button></form>${L.mine ? `<button type="button" class="sl-link" data-sl="drop">Give up my slot</button>` : ""}`
        : `<p class="sl-sub">${!M ? "Reply I'm in to claim a slot." : L.open ? "Slots are for guests who are in." : "All the slots are taken."}</p>`;
      return `<section class="sl-card" id="slLineup" aria-label="${esc(L.title)}">${head(`${L.queue.length} of ${L.slots} taken · ${L.minutes} min each`)}<ol class="sl-list">${rows}</ol>${form}<p class="sl-msg" role="status"></p></section>`;
    }
    if (L.kind === "poll") { const max = Math.max(1, ...L.options.map((o) => o.votes));
      return `<section class="sl-card" id="slLineup" aria-label="${esc(L.title)}">${head(`Poll · ${L.votes} vote${L.votes === 1 ? "" : "s"}`)}<div class="sl-opts">${L.options.map((o) => `<button type="button" class="sl-opt" data-sl="vote" data-i="${o.i}" aria-pressed="${L.myVote === o.i}"${L.canAct && !L.past ? "" : " disabled"}><span class="bar" style="width:${Math.round((100 * o.votes) / max)}%"></span><span>${esc(o.label)}</span><span class="sl-mono">${o.votes}</span></button>`).join("")}</div>
        ${L.canAct || L.past ? "" : `<p class="sl-sub">${o.ask ? `Vote once ${esc(o.host || "the host")} lets you in.` : "Reply to vote. One vote each."}</p>`}<p class="sl-msg" role="status"></p></section>`; }
    const R = L.rounds || [], names = (n) => (n === R.length - 1 ? "Final" : n === R.length - 2 ? "Semis" : `Round ${n + 1}`);
    const br = R.length ? `<div class="sl-br">${R.map((round, r) => `<div class="sl-rnd"><h5>${names(r)}</h5>${round.map((x) => `<div class="sl-m"><div class="${x.w === "a" ? "w" : x.w ? "l" : ""}"><span>${esc(x.a || (x.bye ? "Bye" : "TBD"))}</span></div><div class="${x.w === "b" ? "w" : x.w ? "l" : ""}"><span>${esc(x.b || (x.bye ? "Bye" : "TBD"))}</span></div></div>`).join("")}</div>`).join("")}</div>` : "";
    const act = L.past || L.seeded ? "" : L.canAct ? `<button type="button" class="sl-btn ${L.mine ? "ghost" : ""}" data-sl="optin" data-on="${L.mine ? "0" : "1"}">${L.mine ? "Leave the bracket" : "Put me in the bracket"}</button>` : `<p class="sl-sub">Reply I'm in to play.</p>`;
    return `<section class="sl-card" id="slLineup" aria-label="${esc(L.title)}">${head(`Bracket of ${L.size} · ${L.optedIn} in`)}${L.champion ? `<p class="sl-champ"><span class="sl-stamp">Champion</span><b>${esc(L.champion)}</b></p>` : ""}${br}${!R.length ? `<div class="sl-seats" role="img" aria-label="${Math.min(L.optedIn, L.size)} of ${L.size} seats taken">${Array.from({ length: L.size }, (_, i) => `<span class="sl-seat${i < L.optedIn ? " on" : ""}">${i < L.optedIn ? "" : two(i + 1)}</span>`).join("")}</div><p class="sl-sub">${L.mine ? "You're in. The host seeds it from everyone who opts in." : L.optedIn >= L.size ? "Every seat's taken. The host seeds it soon." : `${L.size - L.optedIn} ${L.size - L.optedIn === 1 ? "seat" : "seats"} left. The host seeds it from guests who opt in.`}</p>` : ""}${act}<p class="sl-msg" role="status"></p></section>`;
  }
  function wireLineup(box, id, M, redraw) {
    const msg = (t) => { const p = $(".sl-msg", box); if (p) p.textContent = t; };
    const go = async (path, body, btn) => { if (btn) { btn.disabled = true; btn.dataset.was = btn.textContent; btn.textContent = path === "claim" ? (body.title ? "Saving" : "Giving it up") : path === "optin" ? (body.on ? "Putting you in" : "Taking you out") : btn.textContent; }
      const r = await post(`/api/public/lineup/${encodeURIComponent(id)}/${path}`, { rid: M?.rid, code: M?.code, ...body }); if (!r.ok) { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.was; } return msg(r.j.message || "Couldn't save that."); } redraw(r.j.lineup); };
    $('[data-sl="claim"]', box)?.addEventListener("submit", (ev) => { ev.preventDefault(); go("claim", { title: $("#slTitle", box).value.trim() }, ev.currentTarget.querySelector("button")); });
    $('[data-sl="drop"]', box)?.addEventListener("click", () => go("claim", { title: "" }));
    box.querySelectorAll('[data-sl="vote"]').forEach((b) => b.addEventListener("click", () => go("vote", { option: b.getAttribute("aria-pressed") === "true" ? null : +b.dataset.i })));
    $('[data-sl="optin"]', box)?.addEventListener("click", (ev) => go("optin", { on: ev.currentTarget.dataset.on === "1" }, ev.currentTarget));
  }

  // ---------- quiet guests ----------
  const pendKey = (id) => "encore-quiet-" + id;
  /** "Ask me about" ideas that fit the night: food, games, hack nights. Pure. */
  const askHint = (e) => { const t = [e?.kind, e?.activity, e?.pubTitle, e?.name].filter(Boolean).join(" ").toLowerCase();
    return /hack|demo|build|maker|code|coding/.test(t) ? "What you're building" : /game|board|lan\b|smash|bracket|watch party|tournament|poker|chess|d&d|dnd|trivia/.test(t) ? "Favorite game, what you're learning"
      : /dinner|supper|potluck|brunch|lunch|food|cook|bake|bread|meal|tasting|wine|picnic|bbq|feast/.test(t) ? "Favorite dish, a recent trip" : "Something you're into, a recent trip"; };
  function quietFormHTML(id, e) { const P = ls.get(pendKey(id)) || {};
    // the one "Add a little more (optional)" disclosure under the reply form; on /g, tidyForm moves the form's other optional bits into it
    return `<details class="sl-quietform pl-more" id="slQuietForm"${P.solo || P.askMe ? " open" : ""}><summary>Add a little more (optional)</summary><div class="pl-more-in"><label class="sl-check"><input type="checkbox" id="slSolo"${P.solo ? " checked" : ""}><span>Coming solo<small>We'll say how many others are, never who.</small></span></label>
      <label class="sl-lab" style="margin:8px 0 0;font-weight:500">Ask me about <small>Only guests who are in see it.</small><input id="slAsk" maxlength="60" autocomplete="off" placeholder="${esc(askHint(e))}" value="${esc(P.askMe || "")}"></label></div></details>`; }
  // The reply form, kept short: name, how to reach you, the reply, and food only if there's food. Everything else waits in
  // the one disclosure; one name toggle, next to the name; the severe-allergy box only under a food answer; "Save my
  // details on this phone" a quiet line under Send. Runs on every redraw and moves nothing that is already in place.
  // After replying on /g: one calm "You're in" card. Invite friends, Add to calendar (the page's own link moves in, so there
  // is one) and the group chat; the name toggle as a quiet row; "Plans changed? Can't go" as a quiet link (the answer chips
  // stay in the page, hidden, and the link presses Can't go). Runs on every redraw and moves nothing already in place.
  function tidyTicket() { const rs = $("#view-guest.ev2 #gForm .ev2-rs"), tk = rs && rs.querySelector(":scope > .ticket"); if (!tk) return; rs.classList.add("pl-tk");
    const cal = $$("#view-guest .ev2-acts a.btn").find((a) => /calendar|remind me/i.test(a.textContent)); if (cal && !rs.querySelector(".pl-tk-cal")) { cal.classList.add("pl-tk-cal"); rs.appendChild(cal); }
    $("#g-unwall", rs)?.closest(".gchange")?.classList.add("pl-tk-row");
    const ch = $$(".gchange", rs).find((g) => g.querySelector("[data-chg]")), yes = /you're in/i.test(tk.textContent) && !/waitlist|asked/i.test(tk.textContent);
    if (ch && yes && ch.querySelector('[data-chg="no"]')) { ch.classList.add("pl-tk-chg"); if (!$(".pl-out", rs)) { const b = document.createElement("button"); b.type = "button"; b.className = "pl-out"; b.textContent = "Plans changed? Can't go"; b.onclick = () => $('.pl-tk-chg [data-chg="no"]', rs)?.click(); rs.appendChild(b); } } }
  // The full invite draws the host's words (why) and, under them, the event copy (tagline, description). When the copy only
  // repeats sentences the host already wrote, it stays hidden, so the page never says "Quiet tables." twice on our account.
  const sents = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  function tidyWords() { const inn = $("#view-guest.ev2 .invite .in"), why = inn && inn.querySelector(":scope > .pp-why"); if (!why) return; const W = new Set(sents(why.textContent));
    for (const p of inn.querySelectorAll(":scope > p:not(.pp-why)")) { const S = sents(p.textContent); const dup = S.length > 0 && S.every((x) => W.has(x)); if (p.hidden !== dup) p.hidden = dup; } }
  function tidyForm() { try { tidyTicket(); tidyWords(); } catch (err) { console.warn("[slots]", err); } const more = $("#slQuietForm .pl-more-in");
    const f = $("#f"); if (f && more) { const at = $("#qs", f) || $("#send", f); const box = more.parentElement; if (at && box.nextElementSibling !== at) at.before(box); }
    const g = $("#gForm"); if (!g) return; const send = $("#g-send", g), btns = send?.closest(".btns");
    if (more) { $$("details.g-more, details.g-fun", g).forEach((d) => { [...d.children].forEach((c) => { if (c.tagName !== "SUMMARY" && !c.contains($("#g-showme", g))) more.appendChild(c); }); if (!d.querySelector("input,textarea,select")) d.remove(); });
      if (btns && more.parentElement.nextElementSibling !== btns) btns.before(more.parentElement); }
    // one name toggle: "Show my name on Who's coming", next to the name; the older "other guests" box follows it
    const sm = $("#g-showme", g), wall = $("#g-wall", g), nameRow = $("#g-name", g)?.closest(".row") || $("#g-name", g)?.closest("label");
    if (sm && nameRow) { const l = sm.closest("label"); l.className = "sl-check pl-name"; if (!l.dataset.t) { l.dataset.t = 1; l.lastChild.nodeValue = ""; l.insertAdjacentHTML("beforeend", "<span>Show my name on Who's coming</span>"); }
      if (nameRow.nextElementSibling !== l) nameRow.after(l);
      if (wall) { wall.checked = sm.checked; if (!sm.dataset.w) { sm.dataset.w = 1; sm.addEventListener("change", () => (wall.checked = sm.checked)); } } }
    // the severe-allergy box sits right under the food answer, and only once something is typed there
    const dt = $("#g-diet", g), sv = $("#g-severe", g)?.closest("label"), dl = dt?.closest("label");
    if (dt && sv && dl && !dl.hidden) { if (dl.nextElementSibling !== sv) dl.after(sv); sv.className = "sl-check pl-sev"; sv.hidden = !dt.value.trim(); if (!dt.dataset.sv) { dt.dataset.sv = 1; const u = () => (sv.hidden = !dt.value.trim()); dt.addEventListener("input", u); dt.addEventListener("change", u); } }
    // "Save my details on this phone": a quiet line under Send
    const rem = $("#gRemember", g)?.closest("label"); if (rem && btns) { rem.hidden = false; rem.className = "sl-check pl-rem"; if (btns.nextElementSibling !== rem) btns.after(rem); } }
  async function syncQuiet(id) { const M = mineOf(id), P = ls.get(pendKey(id)); if (!M || !P || P.synced === M.rid + "|" + (P.solo ? 1 : 0) + "|" + (P.askMe || "")) return null;
    const r = await post(`/api/public/quiet/${encodeURIComponent(id)}`, { rid: M.rid, code: M.code, solo: !!P.solo, askMe: P.askMe || "" }); if (r.ok) ls.set(pendKey(id), { ...P, askMe: r.j.askMe, synced: M.rid + "|" + (r.j.solo ? 1 : 0) + "|" + (r.j.askMe || "") }); return r.ok ? r.j : null; }
  function wireQuiet(el, id, after) { const save = () => { ls.set(pendKey(id), { ...(ls.get(pendKey(id)) || {}), solo: !!$("#slSolo", el)?.checked, askMe: ($("#slAsk", el)?.value || "").trim().slice(0, 60), synced: "" }); };
    $("#slSolo", el)?.addEventListener("change", () => { save(); syncQuiet(id).then(after); }); $("#slAsk", el)?.addEventListener("change", () => { save(); syncQuiet(id).then(after); }); $("#slAsk", el)?.addEventListener("input", save); }
  function quietHTML(Q) { if (!Q) return ""; const out = [];
    if (Q.solo > 0) out.push(`<p class="sl-quiet" id="slSoloN"><b class="sl-mono">${Q.solo}</b> other${Q.solo === 1 ? " is" : "s are"} coming solo.</p>`);
    if (Q.me?.solo && Q.firstTimer) out.push(`<section class="sl-card" id="slFirst"><p class="sl-eyebrow">First-timer table</p><p class="sl-big" style="font-weight:500">${esc(Q.firstTimer)}</p></section>`);
    if ((Q.askMe || []).length) out.push(`<section class="sl-card" id="slAskMe"><p class="sl-eyebrow">Ask me about</p><ul class="sl-ask">${Q.askMe.map((x) => `<li><b>${esc(x.me ? "You" : x.name)}</b> · ${esc(x.askMe)}</li>`).join("")}</ul></section>`);
    return out.join(""); }

  // ---------- Copy as Markdown, .ics, and the one-line reply ----------
  const hm = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}${m[2] === "00" ? "" : ":" + m[2]}${ap}`; };
  function toolsHTML(id, e, M) { const terminal = !!document.querySelector(".lk-vibe-terminal") || e?.look?.vibe === "terminal", replied = !!(M && M.response && M.response !== "declined");
    const curl = terminal && replied && window.PlainText ? window.PlainText.curlLine(location.origin, id, M.rid, M.code, "in") : "";
    return `<div class="sl-tools" id="slTools"><a class="sl-btn ghost sm" href="/e/${encodeURIComponent(id)}.ics${M && M.response === "going" ? proofQ(M) : ""}" download>${ICON.cal}Add to calendar</a></div>
      ${curl ? `<section class="sl-card" id="slCurl"><p class="sl-eyebrow">Reply from a terminal</p><code class="sl-code" id="slCurlLine">${esc(curl)}</code><p class="sl-sub">Swap <span class="sl-mono">"in"</span> for <span class="sl-mono">"maybe"</span> or <span class="sl-mono">"no"</span>. This has your own reply code, so keep it to yourself.</p><button type="button" class="sl-btn ghost sm" data-sl="curl">${ICON.term}Copy</button></section>` : ""}`; }
  async function copy(text, btn) { let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch { try { const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch {} }
    if (btn) { const was = btn.innerHTML; btn.textContent = ok ? "Copied" : "Couldn't copy"; setTimeout(() => (btn.innerHTML = was), 1600); } }
  // the invite's public words, never the host's planning brief (`concept`)
  const pubCopy = (e) => String(e?.pubDesc || (typeof e?.copy === "string" ? e.copy : e?.copy?.description || e?.copy?.tagline) || "").trim().slice(0, 400);
  async function markdownOf(id, e) {
    const [H, EP] = await Promise.all([getJ(`/api/public/event-host/${encodeURIComponent(id)}`), getJ(`/api/public/episode/${encodeURIComponent(id)}`)]);
    const t = String(e?.pubTitle || e?.name || "").trim(), title = EP?.episode && !/#\d+\s*$/.test(t) ? `${t} #${EP.episode}` : t;
    return window.PlainText.toMarkdown({ title, date: e?.date, startTime: e?.startTime, endTime: e?.endTime, area: [e?.hood, String(e?.city || "").split(",")[0]].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", "), host: H?.host?.name || "", url: `${location.origin}/e/${encodeURIComponent(id)}`, concept: pubCopy(e) }); }
  function wireTools(el, id, e) { $('[data-sl="md"]', el)?.addEventListener("click", async (ev) => { const b = ev.currentTarget; copy(await markdownOf(id, e), b); });
    $('[data-sl="curl"]', el)?.addEventListener("click", (ev) => copy($("#slCurlLine", el)?.textContent || "", ev.currentTarget)); }

  // ---------- put it on the page ----------
  let busy = false, sig = "", T = 0; const hosts = {};
  async function run(ctx) {
    if (busy) return; const { id, e, anchor, form } = ctx; if (!id || !anchor) return; const M = mineOf(id), s = [id, M?.rid || "", M?.response || "", !!form, !!$("#tk"), !!$("#tbMe")].join("|");
    if (form && !$("#slQuietForm", form.closest("form,#gForm,.panel") || document)) { form.insertAdjacentHTML("afterend", quietFormHTML(id, e)); wireQuiet(form.parentElement, id, () => { sig = ""; schedule(); }); }
    { const a = $("#slAsk"); if (a && e) a.placeholder = askHint(e); } // the light invite reads its event after the form is up
    if (s === sig && $("#slBox")) return; busy = true; sig = s;
    try { await syncQuiet(id); const [Lj, Q] = await Promise.all([getJ(`/api/public/lineup/${encodeURIComponent(id)}${proofQ(M)}`), getJ(`/api/public/quiet/${encodeURIComponent(id)}${proofQ(M)}`)]);
      let box = $("#slBox"); if (!box) { box = document.createElement("div"); box.id = "slBox"; } const at = ctx.place(); if (at && box.previousElementSibling !== at) at.after(box);
      const askIn = !!e?.approvalRequired && Lj?.lineup?.kind === "poll" && !Lj.lineup.canAct, hostFirst = askIn ? (hosts[id] ||= getJ(`/api/public/event-host/${encodeURIComponent(id)}`).then((j) => j?.person || "")) : null;
      const opts = { ask: askIn, host: hostFirst ? await hostFirst : "" };
      const draw = (L) => { box.innerHTML = lineupHTML(L, M, opts) + quietHTML(Q) + toolsHTML(id, e, M); wireLineup(box, id, M, draw); wireTools(box, id, e); };
      draw(Lj?.lineup || null);
      // who's coming on /g: the Ask me about card sits under it
      const who = $("#whoGoing"), ask = $("#slAskMe", box); if (who && ask) who.after(ask);
    } finally { busy = false; } }
  function ctxOf() {
    if (/^\/[ei]\/[A-Za-z0-9_-]{2,80}$/.test(location.pathname)) { const id = location.pathname.split("/")[2], m = $("#m"); if (!m || !$(".cov", m)) return null; const f = $("#f");
      return { id, e: window.__slEv || null, form: f && !f.querySelector("#slQuietForm") ? f.querySelector("#ct")?.closest("label") || f.querySelector(".resp") || f.querySelector("button[type=submit], button:not([type])")?.previousElementSibling || null : null, anchor: $("#tk") || f, place: () => $("#tbMe") || $("#tk") || $("#f") }; }
    if (location.pathname === "/g") { const e = window.__gEv, host = $("#view-guest"); if (!e?.id || !host || host.hidden || e.example || e.sample) return null;
      const resp = $("#gResp", host), em = $("#g-email", host), after = em?.closest(".row") || em?.closest("label") || resp; return { id: e.id, e, form: after && !$("#slQuietForm", host) ? after : null, anchor: $("#gForm", host) || $(".invite", host), place: () => $("#tbMe", host) || $("#gForm", host) || $(".ticket", host)?.closest(".panel") || $(".invite", host) }; }
    return null; }
  function schedule() { if (T) return; T = setTimeout(() => { T = 0; try { tidyForm(); } catch (err) { console.warn("[slots]", err); } const c = ctxOf(); if (c) run(c).catch((err) => console.warn("[slots]", err)); }, 160); }

  // ---------- the host's panel in the studio ----------
  function hostPanel(d, { save }) {
    const el = document.createElement("details"); el.className = "sl-panel"; el.id = "slHost";
    const L = d.lineup && typeof d.lineup === "object" ? d.lineup : {}, N = d.changelog || {}, kind = L.kind || "";
    el.innerHTML = `<summary><span><b>Slots, series and channels</b><small>${esc([kind === "demos" ? "Demo queue" : kind === "poll" ? "Game poll" : kind === "bracket" ? "Bracket" : "", d.firstTimerNote ? "First-timer note" : "", "Discord or Slack", "Calendar feed"].filter(Boolean).join(" · "))}</small></span></summary><div class="sl-body">
      <div class="sl-lab">On the invite<select id="slKind"><option value="">Nothing extra</option><option value="demos"${kind === "demos" ? " selected" : ""}>Lightning demo queue</option><option value="poll"${kind === "poll" ? " selected" : ""}>Game-pick poll</option><option value="bracket"${kind === "bracket" ? " selected" : ""}>Small bracket</option></select></div>
      <div class="sl-two" data-k="demos"${kind === "demos" ? "" : " hidden"}><label class="sl-lab">Slots<input id="slN" type="number" min="1" max="30" inputmode="numeric" value="${+L.slots || 6}"></label><label class="sl-lab">Minutes each<input id="slM" type="number" min="1" max="60" inputmode="numeric" value="${+L.minutes || 5}"></label></div>
      <label class="sl-lab" data-k="poll"${kind === "poll" ? "" : " hidden"}>Options<small>One per line, up to 8.</small><textarea id="slOpts" rows="3" maxlength="400">${esc((Array.isArray(L.options) ? L.options : []).join("\n"))}</textarea></label>
      <label class="sl-lab" data-k="bracket"${kind === "bracket" ? "" : " hidden"}>Bracket size<select id="slSize">${[4, 8, 16].map((n) => `<option${+L.size === n || (!L.size && n === 8) ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <div id="slLive"></div>
      <label class="sl-lab">First-timer table<small>Shown only to guests who tick Coming solo.</small><input id="slFirstNote" maxlength="200" value="${esc(d.firstTimerNote || "")}" placeholder="Sit at the window table. Jo will say hi."></label>
      <div class="sl-lab" role="group" aria-labelledby="slSerQ"><span id="slSerQ">Is this a series?<small>Yes numbers it with the other dates of the same name. No keeps it a one-off. Leave both off and we go by the dates.</small></span><span class="sl-row">${[["yes", "Yes", true], ["no", "No", false]].map(([k, t, v]) => `<button type="button" class="sl-btn ghost sm" data-ser="${k}" aria-pressed="${d.series === v}">${t}</button>`).join("")}</span></div>
      <div><p class="sl-h">This episode</p><div class="sl-two" style="margin-top:8px"><label class="sl-lab">Demos shown<small>One per line. In the changelog on your page.</small><textarea id="slDemos" rows="2">${esc((N.demos || []).join("\n"))}</textarea></label><label class="sl-lab">Games played<textarea id="slGames" rows="2">${esc((N.games || []).join("\n"))}</textarea></label></div>
        <label class="sl-lab" style="margin-top:8px">Episodes before Pottery Lab<small>Counts on from here: 13 makes the next one #14.</small><input id="slBase" type="number" min="0" max="5000" inputmode="numeric" value="${+d.episodeBase || 0}"></label><p class="sl-sub" id="slEp" style="margin:6px 0 0"></p></div>
      <div><p class="sl-h">Discord or Slack</p><p class="sl-sub" style="margin:4px 0 8px">Paste an incoming webhook. It posts "Maya is in" (first names only), the last few spots and a reminder the day before, for open events only.</p>
        <div class="sl-row"><input class="sl-in" id="slHook" type="url" inputmode="url" autocomplete="off" placeholder="https://discord.com/api/webhooks/..."><button type="button" class="sl-btn ghost sm" id="slHookSave">Save</button><button type="button" class="sl-btn ghost sm" id="slHookTest" hidden>Send a test</button></div><p class="sl-msg" id="slHookMsg" role="status"></p></div>
      <div><p class="sl-h">Calendar feed</p><p class="sl-sub" style="margin:4px 0 8px" id="slFeed">Your open events as a calendar people subscribe to.</p><div class="sl-tools" style="margin:0"><button type="button" class="sl-btn ghost sm" id="slMd">${ICON.copy}Copy invite as Markdown</button></div></div>
    </div>`;
    const v = (s) => $(s, el)?.value ?? "";
    const readCfg = () => { const k = v("#slKind"); d.lineup = !k ? null : k === "demos" ? { kind: k, slots: Math.round(+v("#slN")) || 6, minutes: Math.round(+v("#slM")) || 5 } : k === "poll" ? { kind: k, options: v("#slOpts").split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 8) } : { kind: k, size: +v("#slSize") || 8 }; };
    el.addEventListener("input", (ev) => { const t = ev.target; if (["slN", "slM", "slOpts"].includes(t.id)) readCfg(); else if (t.id === "slFirstNote") d.firstTimerNote = t.value.trim().slice(0, 200);
      else if (t.id === "slDemos" || t.id === "slGames") d.changelog = { ...(d.changelog || {}), demos: v("#slDemos").split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 8), games: v("#slGames").split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 8) };
      else if (t.id === "slBase") d.episodeBase = Math.max(0, Math.min(5000, Math.floor(+t.value) || 0)); else return; save(); });
    el.addEventListener("change", (ev) => { if (ev.target.id === "slKind" || ev.target.id === "slSize") { el.querySelectorAll("[data-k]").forEach((x) => (x.hidden = x.dataset.k !== v("#slKind"))); readCfg(); save(); setTimeout(live, 900); } });
    // the live block: reorder and remove demos, seed the bracket, enter winners
    async function live() { const box = $("#slLive", el); if (!d.id || !box) return; const j = await getJ(`/api/host/lineup/${encodeURIComponent(d.id)}`); if (!j) return; const L2 = j.lineup;
      const act = async (body) => { const r = await fetch(`/api/host/lineup/${encodeURIComponent(d.id)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const k = await r.json().catch(() => ({})); if (!r.ok) { box.insertAdjacentHTML("beforeend", `<p class="sl-msg">${esc(k.message || "Couldn't save that.")}</p>`); return; } live(); };
      if (!L2) { box.innerHTML = j.solo ? `<p class="sl-sub"><span class="sl-mono">${j.solo}</span> coming solo so far.</p>` : ""; return; }
      let h = "";
      if (L2.kind === "demos") h = `<p class="sl-h">Demo queue · ${L2.queue.length} of ${L2.slots}</p><ol class="sl-list">${L2.queue.map((q, i) => `<li><span class="sl-n sl-mono">${two(q.n)}</span><span class="sl-t">${esc(q.title)} <span class="sl-who">${esc(q.who)}</span></span><span class="sl-row" style="gap:4px">${i ? `<button type="button" class="sl-btn ghost sm" data-up="${esc(q.rid)}" aria-label="Move up">${ICON.up}</button>` : ""}<button type="button" class="sl-btn ghost sm" data-rm="${esc(q.rid)}" aria-label="Remove">${ICON.x}</button></span></li>`).join("") || `<li class="open"><span class="sl-n sl-mono">00</span><span class="sl-t">No demos yet</span><span></span></li>`}</ol>`;
      else if (L2.kind === "poll") h = `<p class="sl-h">Poll · ${L2.votes} vote${L2.votes === 1 ? "" : "s"}</p><ul class="sl-list">${L2.options.map((o) => `<li><span class="sl-n sl-mono">${o.votes}</span><span class="sl-t">${esc(o.label)}</span><span></span></li>`).join("")}</ul>`;
      else { h = `<p class="sl-h">Bracket · ${L2.optedIn} opted in</p>`; if (L2.rounds) h += `<div class="sl-br">${L2.rounds.map((round) => `<div class="sl-rnd">${round.map((x) => `<div class="sl-m">${[["a", x.ra], ["b", x.rb]].map(([s, rid]) => `<div class="${x.w === s ? "w" : x.w ? "l" : ""}"><span>${esc(x[s] || (x.bye ? "Bye" : "TBD"))}</span>${rid && x.ra && x.rb ? `<button type="button" data-win="${x.r}-${x.m}-${esc(rid)}">${x.w === s ? "Undo" : "Won"}</button>` : ""}</div>`).join("")}</div>`).join("")}</div>`).join("")}</div>${L2.champion ? `<p class="sl-sub">Winner: <b>${esc(L2.champion)}</b></p>` : ""}`;
        h += `<div class="sl-seedrow">${[["optin", L2.rounds ? "Seed again" : "Seed in opt-in order"], ["shuffle", "Shuffle seeds"], ["here", "Seed who's here"]].map(([k, t]) => `<button type="button" class="sl-btn ghost sm" data-seed="${k}"${L2.optedIn >= 2 ? "" : " disabled"}>${t}</button>`).join("")}</div><p class="sl-sub" style="margin-top:6px">${L2.optedIn >= 2 ? "Top seeds get the byes. Seed who's here leaves out anyone not checked in yet." : "Two guests need to opt in first."}</p>`; }
      box.innerHTML = h;
      box.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => act({ action: "remove", rid: b.dataset.rm })));
      box.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { const ids = L2.queue.map((q) => q.rid), i = ids.indexOf(b.dataset.up); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; act({ action: "reorder", order: ids }); }));
      box.querySelectorAll("[data-win]").forEach((b) => (b.onclick = () => { const [r, m, ...rid] = b.dataset.win.split("-"); act({ action: "winner", round: +r, match: +m, rid: b.textContent === "Undo" ? "" : rid.join("-") }); }));
      box.querySelectorAll("[data-seed]").forEach((b) => (b.onclick = () => { b.disabled = true; b.textContent = "Seeding"; act({ action: "seed", order: b.dataset.seed }); })); }
    live();
    // "Is this a series?": Yes forces it, No overrides the guess, pressing the chosen one again leaves it to the dates
    el.querySelectorAll("[data-ser]").forEach((b) => (b.onclick = () => { const v = b.dataset.ser === "yes", on = b.getAttribute("aria-pressed") !== "true";
      d.series = on ? v : null; el.querySelectorAll("[data-ser]").forEach((x) => x.setAttribute("aria-pressed", String(on && x === b))); save(); setTimeout(epLine, 900); }));
    // the episode number, the webhook and the feed
    function epLine() { if (d.id) getJ(`/api/host/series/${encodeURIComponent(d.id)}`).then((j) => { const p = $("#slEp", el); if (p) p.innerHTML = j?.episode ? `This is <span class="sl-mono">${esc(j.episode.label)}</span> of ${j.episode.total}.` : ""; }); }
    epLine();
    getJ("/api/host/webhook").then((j) => { if (j?.on) { $("#slHook", el).placeholder = j.url; $("#slHookTest", el).hidden = false; $("#slHookMsg", el).textContent = `Posting to ${j.kind === "slack" ? "Slack" : "Discord"}.`; } });
    $("#slHookSave", el).onclick = async () => { const url = v("#slHook").trim(), m = $("#slHookMsg", el); const r = await fetch("/api/host/webhook", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { m.textContent = j.message || "Couldn't save that."; return; } $("#slHook", el).value = ""; $("#slHook", el).placeholder = j.url || "https://discord.com/api/webhooks/..."; $("#slHookTest", el).hidden = !j.on; m.textContent = j.on ? `Saved. Posting to ${j.kind === "slack" ? "Slack" : "Discord"}.` : "Turned off."; };
    $("#slHookTest", el).onclick = async () => { const r = await fetch("/api/host/webhook/test", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }); const j = await r.json().catch(() => ({})); $("#slHookMsg", el).textContent = r.ok && j.ok ? "Sent. Check the channel." : j.message || "It didn't go through. Check the URL."; };
    getJ("/api/workspace").then((w) => { if (!w?.handle) return; const url = `webcal://${location.host}/@${w.handle}.ics`; $("#slFeed", el).innerHTML = `Your open events as a calendar people subscribe to: <a href="${esc(url)}" class="sl-mono" style="color:inherit;overflow-wrap:anywhere">${esc(url.replace(/^webcal:\/\//, ""))}</a>`; });
    $("#slMd", el).onclick = async (ev) => { if (!d.id) return; copy(await markdownOf(d.id, d), ev.currentTarget); };
    return el;
  }

  window.Slots = { lineupHTML, quietHTML, hostPanel, askHint, quietFormHTML, run: schedule, markdownOf, ctx: ctxOf, draw: (c) => run(c) };
  if (typeof document === "undefined") return;
  if (/^\/[ei]\/[A-Za-z0-9_-]{2,80}$/.test(location.pathname) || location.pathname === "/g") {
    css(); add("/plain.js"); add("/series.js"); if (location.pathname !== "/g") add("/replybar.js");
    // the light invite keeps its event to itself: read the public copy once for Copy as Markdown
    if (location.pathname !== "/g") { const id = location.pathname.split("/")[2]; fetch("/api/db/doc?path=" + encodeURIComponent("events/" + id), { headers: { "x-encore-guest": "1" } }).then((r) => (r.ok ? r.json() : null)).then((j) => { window.__slEv = j?.data || null; sig = ""; schedule(); }).catch(() => {}); }
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true }); schedule();
  }
})();
