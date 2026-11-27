// The host loop on the page (server/hostloop.js): host Home's card (the streak, today's small move, warmth, Circles),
// the Hosting section in /settings, the once-only milestone celebration, and the small responses every tap gets.
//
// Feedback, kept calm: a press state, a check that draws itself, a count that ticks up, an ink stamp when something
// goes out, light haptics in the app (public/native.js; nothing on the web), optional soft sounds (off by default, on in
// Settings), and paper-square confetti for real milestones only. Nothing moves for people who ask for less motion.
// Brand tokens only (public/system.css). Copy follows docs/potto-voice.md.
(function () {
  "use strict";
  if (window.HostLoop) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  // ---------- styles (tokens only) ----------
  const css = `
/* host Home card */
.hl-card{background:var(--pl-surface);border:1px solid var(--pl-line-strong);border-radius:6px;padding:16px;margin:16px 0;color:var(--pl-ink);font-family:var(--pl-font-text)}
.hl-card .hl-k{font:500 12px/1.3 var(--pl-font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--pl-soft);margin:0 0 10px}
.hl-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:center}
.hl-num{font:400 44px/1 var(--pl-font-display);min-width:52px;text-align:center}
.hl-num small{display:block;font:500 11px/1.2 var(--pl-font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--pl-soft);margin-top:4px}
.hl-line{margin:0;font-size:15px;line-height:1.45}
.hl-passes{display:flex;gap:6px;margin-top:8px;align-items:center;font:500 12px var(--pl-font-mono);color:var(--pl-soft)}
.hl-pass{width:18px;height:18px;border:1.5px solid var(--pl-ink);border-radius:4px;display:inline-grid;place-items:center;font-size:10px}.hl-pass.off{border-style:dashed;border-color:var(--pl-line-strong)}
.hl-rule{border:0;border-top:1px dashed var(--pl-line-strong);margin:14px 0}
.hl-move{display:grid;gap:10px}
.hl-move b{display:block;font-weight:600}.hl-move span{display:block;font-size:14px;color:var(--pl-soft)}
.hl-move .min{font:500 12px var(--pl-font-mono);color:var(--pl-soft)}
.hl-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 14px;border-radius:6px;border:1px solid var(--pl-ink);background:var(--pl-surface);color:var(--pl-ink);font:600 15px var(--pl-font-text);text-decoration:none;cursor:pointer}
.hl-btn.pri{background:var(--pl-accent);border-color:var(--pl-accent);color:var(--pl-on-accent)}.hl-btn.done{border-color:var(--pl-success);color:var(--pl-success)}
.hl-btn:focus-visible{outline:2px solid var(--pl-accent);outline-offset:2px}
.hl-heads{margin:12px 0 0;padding:10px 12px;border:1px dashed var(--pl-line-strong);border-radius:6px;font-size:14px;display:flex;gap:10px;align-items:flex-start}
.hl-heads .potto{flex:none}
.hl-foot{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px}
.hl-ring{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--pl-soft)}.hl-ring svg{flex:none}
.hl-links{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}.hl-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--pl-accent-text);font-weight:600;text-decoration:none}
.hl-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:9990;display:flex;align-items:flex-end;justify-content:center}
.hl-sheet{background:var(--pl-page);border:1px solid var(--pl-ink);border-radius:6px 6px 0 0;width:100%;max-width:480px;padding:20px 16px calc(20px + env(safe-area-inset-bottom));text-align:center;color:var(--pl-ink)}
@media (min-width:600px){.hl-sheet-bg{align-items:center}.hl-sheet{border-radius:6px}}
.hl-sheet h2{font:400 28px/1.15 var(--pl-font-display);margin:8px 0 6px}.hl-sheet p{margin:0 0 16px;color:var(--pl-soft)}
`;
  const st = document.createElement("style"); st.id = "hostloop-css"; st.textContent = css; (document.head || document.documentElement).appendChild(st);

  // ---------- feedback ----------
  // the feedback itself lives in public/fx.js (window.PLFx), shared with every page; this loads it if the page didn't
  if (!window.PLFx && !document.querySelector('script[src^="/fx.js"]')) { const t = document.createElement("script"); t.src = "/fx.js"; (document.head || document.documentElement).appendChild(t); }
  const fx = window.PLFx || new Proxy({}, { get: (_, k) => (...a) => { const f = window.PLFx?.[k]; return typeof f === "function" ? f(...a) : k === "check" ? "" : undefined; } });
  const potto = (pose, size) => { try { return window.Potto ? window.Potto.svg(pose, size, "Potto") : ""; } catch { return ""; } };
  const api = { get: async (u) => { const r = await fetch(u, { credentials: "same-origin" }); if (!r.ok) throw Object.assign(new Error("http " + r.status), { status: r.status }); return r.json(); },
    post: async (u, b) => { const r = await fetch(u, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "That didn't work."), { status: r.status }); return j; } };

  /** The once-only celebration for a real milestone: a sheet, Potto cheering, paper confetti. */
  function celebrate(c, { link = "" } = {}) {
    if (!c) return; const bg = document.createElement("div"); bg.className = "hl-sheet-bg";
    bg.innerHTML = `<div class="hl-sheet" role="dialog" aria-modal="true" aria-labelledby="hlCelTitle">${potto("cheer", 96)}<h2 id="hlCelTitle">${esc(c.title)}</h2><p>${esc(c.line)}</p><div class="hl-foot" style="justify-content:center">${link ? `<a class="hl-btn pri" href="${esc(link)}">Open it</a>` : ""}<button type="button" class="hl-btn" id="hlCelOk">Thanks, Potto</button></div></div>`;
    document.body.appendChild(bg); fx.confetti(); const close = () => bg.remove(); bg.querySelector("#hlCelOk").onclick = close; bg.onclick = (e) => { if (e.target === bg) close(); }; bg.querySelector("#hlCelOk").focus();
  }

  // ---------- host Home's card ----------
  const ringSvg = (pct, size = 40) => { const r = size / 2 - 4, c = 2 * Math.PI * r; return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--pl-line-strong)" stroke-width="3" stroke-dasharray="2 3"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--pl-accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`; };
  const passes = (s) => `<div class="hl-passes" aria-label="${s.passes} of ${s.maxPasses} rest passes">${Array.from({ length: s.maxPasses }, (_, i) => `<span class="hl-pass${i < s.passes ? "" : " off"}" aria-hidden="true">${i < s.passes ? "R" : ""}</span>`).join("")}<span>${s.passes === 1 ? "1 rest pass" : s.passes ? `${s.passes} rest passes` : s.restUsed && s.restUsed.length ? "No rest passes left" : "No rest passes yet"}${s.passes < s.maxPasses && s.nextPassIn ? ` · another after ${s.nextPassIn} more ${s.cadence === "week" ? (s.nextPassIn === 1 ? "week" : "weeks") : s.nextPassIn === 1 ? "month" : "months"} hosted` : ""}</span></div>`;
  function cardHTML(S) {
    const s = S.streak, m = S.moves.today, w = S.warmth, unit = s.cadence === "off" ? (s.count === 1 ? "event" : "events") : s.cadence === "week" ? (s.count === 1 ? "week" : "weeks") : s.count === 1 ? "month" : "months";
    const big = s.status === "none" ? `<div class="hl-num" aria-hidden="true">${potto("wave", 52)}</div>` : `<div class="hl-num"><span data-hl-count>${s.status === "lapsed" ? 0 : s.count}</span><small>${unit}</small></div>`;
    const hu = S.headsUp && S.headsUp.kind !== "repair" ? `<div class="hl-heads">${potto("think", 36)}<div>${esc(S.headsUp.text)} <a href="/start?t=${esc(S.headsUp.t)}" style="color:var(--pl-accent-text);font-weight:600">Plan a coffee</a></div></div>` : "";
    const restart = s.status === "lapsed" ? `<div class="hl-foot" style="margin-top:10px"><a class="hl-btn" href="/start?t=coffee">Start again with a coffee</a></div>` : s.status === "repairable" ? `<div class="hl-foot" style="margin-top:10px"><a class="hl-btn pri" href="/start?t=coffee">Repair it with a coffee</a></div>` : "";
    const move = m ? `<div class="hl-move" data-move="${esc(m.id)}" data-ev="${esc(m.eventId || "")}"><div><b>${esc(m.label)}</b><span>${esc(m.why)}</span>${m.about ? `<span>For ${esc(m.about)}</span>` : ""}<span class="min">About ${m.minutes} min · it counts</span></div><div class="hl-foot">${m.href ? `<a class="hl-btn${s.status === "repairable" || s.status === "lapsed" ? "" : " pri"}" href="${esc(m.href)}">Do it</a>` : ""}<button type="button" class="hl-btn" data-hl-done>Mark done</button></div></div>`
      : `<p class="hl-line">${esc("That's today's move done. The rest can wait.")} ${fx.check()}</p>`;
    return `<section class="hl-card" id="hlCard" aria-labelledby="hlH"><p class="hl-k" id="hlH">Your hosting${s.cadence === "week" ? " · weekly" : s.cadence === "off" ? "" : " · monthly"}</p>
      <div class="hl-row">${big}<div><p class="hl-line">${esc(s.line)}</p>${s.status !== "none" && s.status !== "off" ? passes(s) : ""}</div></div>${hu}${restart}
      <hr class="hl-rule"><p class="hl-k">Today's small move</p>${move}
      <hr class="hl-rule"><div class="hl-foot" style="justify-content:space-between"><div class="hl-ring">${ringSvg(w.pct)}<span><b style="color:var(--pl-ink)" data-hl-warm>${w.points}</b> of ${w.goal} warmth in ${esc(w.month)}</span></div>
      <div class="hl-links"><a href="/path">Host path</a><a href="/circles">${S.circle.on ? "Your circle" : "Circles"}</a></div></div></section>`;
  }
  let last = null, lastAt = 0;
  async function loadState(force) { if (!force && last && Date.now() - lastAt < 60e3) return last; last = await api.get("/api/me/hostloop"); lastAt = Date.now(); try { ls.set("pl.sounds", last.prefs.sounds ? "1" : "0"); } catch {} return last; }
  function wire(root, S) {
    const b = root.querySelector("[data-hl-done]"); if (!b) return;
    b.onclick = async () => { const row = b.closest("[data-move]"); b.disabled = true; b.classList.add("done"); b.innerHTML = fx.check() + " Done"; fx.haptic("light"); fx.sound("done");
      try { const j = await api.post("/api/me/hostloop/moves/" + encodeURIComponent(row.dataset.move), { eventId: row.dataset.ev || "" }); fx.toast(j.line); fx.tick(root.querySelector("[data-hl-warm]"), j.state.warmth.points);
        last = { ...S, ...j.state, celebrate: null }; lastAt = Date.now(); setTimeout(() => { const el = document.getElementById("hlCard"); if (el) { el.outerHTML = cardHTML(last); wire(document.getElementById("hlCard").parentElement, last); } }, 1400);
      } catch (e) { b.disabled = false; b.classList.remove("done"); b.textContent = "Mark done"; fx.toast(e.message); } };
  }
  function place(view, html) {
    view.querySelector("#hlCard")?.remove(); const anchor = view.querySelector("#qsPanel")?.closest("section") || view.querySelector(".pb-wrap,.pb-head")?.parentElement || null;
    if (anchor && anchor.parentElement) anchor.insertAdjacentHTML("afterend", html); else view.insertAdjacentHTML("afterbegin", html);
  }
  async function home(force) {
    const view = document.getElementById("view-programs"); if (!view || view.hidden) return;
    let S; try { S = await loadState(force); } catch { return; } if (S.off) return;
    place(view, cardHTML(S)); wire(view, S);
    if (S.celebrate) { const c = S.celebrate; last = { ...S, celebrate: null }; celebrate(c, { link: c.eventId ? `/?app=1&open=${encodeURIComponent(c.eventId)}#studio` : "" }); }
  }
  function mountHome() {
    if (typeof window.renderPrograms === "function" && !window.renderPrograms.__hl) { const orig = window.renderPrograms, wrapped = function () { const r = orig.apply(this, arguments); setTimeout(() => home(false), 0); return r; }; wrapped.__hl = 1; window.renderPrograms = wrapped; }
    window.addEventListener("hashchange", () => setTimeout(() => home(false), 50)); setTimeout(() => home(true), 400);
  }

  // ---------- /settings: Hosting ----------
  async function mountSettings() {
    const before = document.querySelector('section[aria-labelledby="hBlock"]'); if (!before) return;
    let S; try { S = await loadState(true); } catch { return; } if (S.off) return;
    let types = {}, sample = null; try { const j = await api.get("/api/me/hostloop/sample"); types = j.types || {}; sample = j.nudge; } catch {}
    const P = S.prefs, sw = (id, label, on, sub = "") => `<div class="row"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</span><input type="checkbox" class="sw" data-hl="${id}" aria-label="${esc(label)}"${on ? " checked" : ""}></div>`;
    const sel = (id, label, opts, cur) => `<div class="row"><span>${esc(label)}</span><select data-hl="${id}" style="min-height:44px;border:1px solid var(--pl-line-strong);border-radius:6px;background:var(--pl-surface);color:var(--pl-ink);font:15px var(--pl-font-text);padding:0 8px">${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
    const sec = document.createElement("section"); sec.setAttribute("aria-labelledby", "hHost"); sec.id = "hosting";
    sec.innerHTML = `<h2 id="hHost">Hosting</h2><p>Your streak, your goal, and when Potto taps you. At most 2 notes a week, never between ${P.quiet[0] > 12 ? P.quiet[0] - 12 + "pm" : P.quiet[0] + "am"} and ${P.quiet[1]}am.</p>
      ${sel("cadence", "Count my streak", [["month", "Monthly"], ["week", "Weekly"], ["off", "No streak, count events"]], P.cadence)}
      ${sw("showStreak", "Show my streak on my page", P.showStreak, "Off: only you see it")}
      ${sel("goal", "Monthly warmth goal", [[15, "Light: 15"], [30, "Steady: 30"], [60, "Busy: 60"]], P.goal)}
      ${sw("notif.on", "Notes from Potto", P.notif.on !== false, "Reminders timed to when you usually plan")}
      ${Object.entries(types).map(([k, label]) => sw("notif." + k, label, P.notif[k] !== false)).join("")}
      ${sel("quiet", "Quiet hours", [["21,9", "9pm to 9am"], ["22,8", "10pm to 8am"], ["20,10", "8pm to 10am"]], P.quiet.join(","))}
      ${sw("sounds", "Soft sounds", P.sounds, "A quiet tap when you finish something")}
      ${sample ? `<div class="row" style="display:block;padding:12px 0"><small style="display:block;color:var(--pl-soft);font-size:13px;margin-bottom:6px">What a note from Potto looks like</small><div style="border:1px solid var(--pl-line-strong);border-radius:6px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start;background:var(--pl-page)">${potto("wave", 32)}<div><b style="font-size:14px">Potto</b><div style="font-size:14px">${esc(sample.body)}</div></div></div></div>` : ""}`;
    before.parentElement.insertBefore(sec, before);
    sec.onchange = async (e) => { const k = e.target.dataset.hl; if (!k) return; const v = e.target.type === "checkbox" ? e.target.checked : e.target.value; let body = {};
      if (k.startsWith("notif.")) body = { notif: { [k.slice(6)]: v } }; else if (k === "quiet") body = { quiet: String(v).split(",").map(Number) }; else body = { [k]: k === "goal" ? +v : v };
      try { await api.post("/api/me/hostloop/prefs", body); if (k === "sounds") { ls.set("pl.sounds", v ? "1" : "0"); if (v) fx.sound("done"); } fx.haptic("light"); } catch (err) { if (e.target.type === "checkbox") e.target.checked = !v; alert(err.message); } };
    if (location.hash === "#hosting") setTimeout(() => sec.scrollIntoView({ block: "start" }), 60);
  }

  window.HostLoop = { fx, api, celebrate, cardHTML, loadState, home };
  const boot = () => { fx.press(); const p = location.pathname;
    if (p === "/settings") mountSettings(); else if (document.getElementById("view-programs")) mountHome(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
