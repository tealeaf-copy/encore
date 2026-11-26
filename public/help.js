// "Need a hand?": Potto's help panel, on every page a host uses and on every onboarding step (sign up, sign in,
// forgot password, join, onboard). Potto answers from docs/help.md (POST /api/help/ask); "Talk to a person" sends the
// team a message with the page, the event and the browser attached (POST /api/help/ticket); replies come back here
// under "Your conversations". If someone sits on a setup step for a minute without moving on, or sees the same error
// twice, Potto offers help once per session.
// Loaded by shell.js (the app and public pages) and by a script tag on the sign-up, sign-in, reset, join and onboard pages.
(function () {
  if (window.__encoreHelp) return; window.__encoreHelp = 1;
  const P = location.pathname, signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const ONB = /^\/(signup|login|forgot|reset|join|onboard)\/?$/.test(P);
  const GUEST = P === "/g" || /^\/(e|k)\//.test(P) || P === "/demo" || P === "/support" || P === "/sso/start";
  if (GUEST || !(ONB || signedIn())) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const NUDGED = "encore.help.nudged", SEEN = "encore.help.seen", LOG = "encore.help.log";
  const LINE = "Stuck? I can help, or get you a person.";
  const VASE = '<svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true"><path d="M10.2 3.2h7.6v1.9c0 1.3-1.1 1.9-1.1 3.3 0 1.5 5.6 3.4 5.6 9.4 0 4.6-3.7 7.4-8.3 7.4s-8.3-2.8-8.3-7.4c0-6 5.6-7.9 5.6-9.4 0-1.4-1.1-2-1.1-3.3z" fill="#C4532F" stroke="#1F1A17" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.4 16.7c2 1.3 4.3-.9 6.8.2 2.4 1 4.5-.8 6.6.1" fill="none" stroke="#F2D48F" stroke-width="2.2" stroke-linecap="round"/><path d="M9.6 3.2h8.8" stroke="#1F1A17" stroke-width="1.8" stroke-linecap="round"/></svg>';

  // ---------- quick questions, by where you are ----------
  const Q = {
    code: ["I need a host code", "I don't have a host code. How do I get one?"], wait: ["I'm on the waitlist", "I'm on the waitlist. What now?"],
    taken: ["Email already in use", "It says my email is already in use."], pw: ["Password rules", "What are the password rules?"],
    reset: ["Reset email didn't come", "My reset email didn't come."], google: ["Sign in with Google?", "Can I sign in with Google?"],
    page: ["What is a page?", "What is a page?"], handle: ["Choose my handle", "How do I choose or change my handle?"],
    first: ["Make my first event", "How do I make my first event with one sentence?"], ask: ["Ask to join or open?", "Should guests ask to join, or is it open to anyone with the link?"],
    paid: ["Free or paid?", "Can my event be free or paid?"], share: ["How do I share my invite?", "How do I share my invite?"], see: ["What do guests see?", "What do guests see?"],
    pay: ["How do guests pay?", "How do guests pay?"], past: ["Add past events", "How do I add past events?"], look: ["Change my page look", "How do I change my page look?"],
    setup: ["Name, photo and line", "How do I add my page name, photo and a line about me?"],
  };
  const ctx = () => { try { return (window.__helpCtx && window.__helpCtx()) || {}; } catch { return {}; } };
  function where() {
    if (/^\/(signup|join)$/.test(P)) return "signup"; if (/^\/(login|forgot|reset)$/.test(P)) return "signin"; if (P === "/onboard") return "onboard";
    const w = document.querySelector("#wizBg .wiz"); if (w) return w.getAttribute("aria-label") === "Share your invite" ? "share" : "wizard";
    if (document.querySelector(".store-pane:not([hidden])") || document.getElementById("fc-save")) return "page";
    const c = ctx(); if (c.firstRun || window.__welcome) return "welcome";
    return "";
  }
  function chips() {
    const w = where();
    if (w === "signup") return [Q.code, Q.wait, Q.taken, Q.pw, Q.page];
    if (w === "signin") return [Q.reset, Q.taken, Q.google, Q.pw];
    if (w === "onboard") return [Q.page, Q.setup, Q.past, Q.look];
    if (w === "page") return [Q.setup, Q.look, Q.handle, Q.page, Q.past];
    if (w === "wizard" || w === "welcome") return [Q.first, Q.ask, Q.paid, Q.share, Q.see];
    if (w === "share") return [Q.share, Q.see, Q.pay, Q.ask];
    return [Q.share, Q.pay, Q.past, Q.look];
  }

  // ---------- styles ----------
  const css = document.createElement("style"); css.id = "ehCss";
  css.textContent = `
.eh-away{display:none!important}
.eh-btn{position:fixed;right:var(--eh-right,16px);bottom:var(--eh-bottom,16px);z-index:9500;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px 8px 10px;border-radius:999px;border:2px solid #1F1A17;background:#FFFCF7;color:#1F1A17;font:700 15px "Instrument Sans",system-ui,sans-serif;cursor:pointer;box-shadow:3px 3px 0 #1F1A17;transition:transform .15s}
:host{all:initial}*{box-sizing:border-box}button,input,select,textarea{font:inherit;color:inherit;margin:0;width:auto}a{color:inherit}svg{display:block;flex:none}
.eh-btn:hover{transform:translateY(-1px)}:focus-visible{outline:3px solid #C94A30;outline-offset:2px}
.eh-btn .eh-dot{position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;background:#E2463A;border:2px solid #FFFCF7}
.eh-btn.eh-dock{top:calc(10px + env(safe-area-inset-top,0px));left:10px;right:auto;bottom:auto;padding:6px 12px 6px 8px;font-size:13px;min-height:40px}
.eh-panel{position:fixed;right:var(--eh-right,16px);bottom:var(--eh-bottom,16px);z-index:9600;width:min(400px,calc(100vw - 32px));max-height:min(640px,calc(100vh - var(--eh-bottom,16px) - 24px));display:flex;flex-direction:column;background:#FFFCF7;color:#1F1A17;border:2px solid #1F1A17;border-radius:22px;box-shadow:5px 5px 0 #1F1A17;font:15px/1.45 "Instrument Sans",system-ui,sans-serif;overflow:hidden}
[hidden]{display:none!important}
.eh-head{display:flex;align-items:center;gap:10px;padding:12px 12px 10px 14px;border-bottom:1.5px solid #EFE6DA}.eh-head h2{margin:0;font:600 19px Fredoka,"Instrument Sans",system-ui}.eh-head small{display:block;color:#6B5F56;font-size:13px}
.eh-head .eh-face{flex:none;width:40px;height:40px;display:grid;place-items:center}.eh-head .eh-face svg{width:40px;height:40px}
.eh-x{margin-left:auto;border:0;background:none;font-size:26px;line-height:1;width:44px;height:44px;border-radius:12px;cursor:pointer;color:#6B5F56}.eh-x:hover{background:#F6EFE8;color:#1F1A17}
.eh-body{flex:1;overflow:auto;padding:12px 14px;display:grid;gap:10px;align-content:start}
.eh-m{max-width:92%;padding:9px 12px;border-radius:16px;white-space:pre-wrap;overflow-wrap:anywhere}.eh-m.me{justify-self:end;background:#1F1A17;color:#fff;border-bottom-right-radius:6px}.eh-m.potto{background:#fff;border:1.5px solid #E9DFD2;border-bottom-left-radius:6px}
.eh-m.team{background:#FFF1C9;border:1.5px solid #EAD9A0}.eh-m small{display:block;font-size:12px;color:#6B5F56;margin-bottom:2px;font-weight:600}
.eh-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.eh-acts a,.eh-acts button{display:inline-flex;align-items:center;min-height:36px;padding:4px 12px;border-radius:999px;border:1.5px solid #1F1A17;background:#fff;color:#1F1A17;font:600 14px "Instrument Sans",system-ui;text-decoration:none;cursor:pointer}
.eh-chips{display:flex;flex-wrap:wrap;gap:6px}.eh-chips button{min-height:36px;padding:6px 12px;border-radius:999px;border:1.5px solid #E4D9C8;background:#fff;color:#1F1A17;font:600 14px "Instrument Sans",system-ui;cursor:pointer;text-align:left}.eh-chips button:hover{border-color:#1F1A17}
.eh-ask{display:flex;gap:8px;padding:10px 14px;border-top:1.5px solid #EFE6DA;align-items:flex-end}.eh-ask textarea{flex:1;min-height:44px;max-height:120px;resize:none;border:1.5px solid #E4D9C8;border-radius:14px;padding:10px 12px;font:16px "Instrument Sans",system-ui;background:#fff;color:#1F1A17}
.eh-go{min-height:44px;padding:0 16px;border:0;border-radius:999px;background:#C94A30;color:#fff;font:700 15px "Instrument Sans",system-ui;cursor:pointer}.eh-go:disabled{opacity:.6;cursor:default}
.eh-foot{padding:0 14px 12px;display:flex;gap:8px;align-items:center}.eh-human{flex:1;min-height:44px;border-radius:999px;border:2px solid #1F1A17;background:#fff;color:#1F1A17;font:700 15px "Instrument Sans",system-ui;cursor:pointer}
.eh-human:hover{background:#FFF1C9}
.eh-convos h3,.eh-form h3{margin:4px 0 0;font:600 16px Fredoka,"Instrument Sans",system-ui}.eh-convo{border:1.5px solid #E9DFD2;border-radius:14px;background:#fff;padding:10px}.eh-convo summary{cursor:pointer;font-weight:600;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;min-height:28px}
.eh-pill{font-size:12px;font-weight:700;border-radius:999px;padding:1px 8px;background:#FDE7DF;color:#8E3A25}.eh-pill.waiting{background:#FFF1C9;color:#6B4E00}.eh-pill.solved{background:#E3F2E6;color:#245C33}.eh-new{font-size:12px;font-weight:700;color:#C94A30}
.eh-convo .eh-m{margin-top:8px;max-width:100%}.eh-convo form{display:flex;gap:6px;margin-top:8px}.eh-convo input{flex:1;min-height:40px;border:1.5px solid #E4D9C8;border-radius:12px;padding:6px 10px;font:16px "Instrument Sans",system-ui}
.eh-form{display:grid;gap:10px}.eh-form label{display:block;font-weight:600;font-size:14px}.eh-form label>input,.eh-form label>textarea,.eh-form label>select{display:block;margin-top:4px}.eh-form textarea,.eh-form input:not([type=file]),.eh-form select{width:100%;box-sizing:border-box;border:1.5px solid #E4D9C8;border-radius:12px;padding:10px 12px;font:16px "Instrument Sans",system-ui;background:#fff;color:#1F1A17}
.eh-form textarea{min-height:110px;resize:vertical}.eh-note{color:#6B5F56;font-size:13px;font-weight:400;margin:0}.eh-err{color:#A93A3A;font-size:14px;margin:0}.eh-err:empty{display:none}.eh-ok{background:#E3F2E6;border-radius:14px;padding:12px;color:#1F3D27}
.eh-hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}
.eh-back{border:0;background:none;color:#A9462E;font:600 14px "Instrument Sans",system-ui;cursor:pointer;min-height:44px;padding:0 6px;text-decoration:underline}
.eh-nudge{position:fixed;right:var(--eh-right,16px);bottom:calc(var(--eh-bottom,16px) + 56px);z-index:9550;width:min(300px,calc(100vw - 32px));background:#FFFCF7;border:2px solid #1F1A17;border-radius:18px;box-shadow:4px 4px 0 #1F1A17;padding:12px 12px 12px 14px;font:15px/1.4 "Instrument Sans",system-ui;color:#1F1A17}
.eh-nudge p{margin:0 28px 10px 0;font-weight:600;display:flex;gap:8px;align-items:center}.eh-nudge .eh-x{position:absolute;top:2px;right:2px;width:36px;height:36px;font-size:22px}.eh-nudge .eh-acts{margin:0}
.eh-nudge.eh-dock{top:calc(60px + env(safe-area-inset-top,0px));left:10px;right:auto;bottom:auto}
@media (max-width:600px){.eh-panel{left:8px;right:8px;width:auto;bottom:max(8px,var(--eh-bottom,8px));max-height:calc(100dvh - var(--eh-bottom,8px) - 16px);border-radius:20px}.eh-btn{font-size:14px;padding:6px;width:48px;height:48px;justify-content:center;border-radius:50%}.eh-btn > span:not(.eh-dot){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@media (prefers-reduced-motion:reduce){.eh-btn{transition:none}}`;

  // ---------- the button, the nudge and the panel ----------
  // everything lives in a shadow root, so no page style (full-width buttons, label rules) can reach it
  const host = document.createElement("div"); host.id = "encoreHelp"; const root = host.attachShadow({ mode: "open" }); root.appendChild(css);
  const tpl = document.createElement("div"); tpl.className = "eh-root"; root.appendChild(tpl);
  tpl.innerHTML = `<button type="button" class="eh-btn" aria-label="Need a hand?" title="Need a hand?" aria-haspopup="dialog" aria-expanded="false" aria-controls="ehPanel">${VASE}<span>Need a hand?</span><span class="eh-dot" hidden></span></button>
<div class="eh-nudge" role="status" hidden><button type="button" class="eh-x" aria-label="Not now">×</button><p>${VASE}<span>${LINE}</span></p><div class="eh-acts"><button type="button" data-nudge="ask">Ask Potto</button><button type="button" data-nudge="person">Get a person</button></div></div>
<section class="eh-panel" id="ehPanel" role="dialog" aria-modal="false" aria-labelledby="ehTitle" hidden>
  <div class="eh-head"><span class="eh-face">${VASE}</span><div><h2 id="ehTitle">Need a hand?</h2><small>Potto answers from the help guide. A person can too.</small></div><button type="button" class="eh-x" aria-label="Close help">×</button></div>
  <div class="eh-body" id="ehBody"><div class="eh-chat"><div class="eh-log" aria-live="polite" style="display:grid;gap:10px"></div></div><div class="eh-chips" role="group" aria-label="Common questions"></div><div class="eh-convos" hidden></div><div class="eh-form-wrap" hidden></div></div>
  <form class="eh-ask"><textarea rows="1" aria-label="Ask Potto a question" placeholder="Ask me anything" maxlength="1000"></textarea><button type="submit" class="eh-go">Ask</button></form>
  <div class="eh-foot"><button type="button" class="eh-human">Talk to a person</button></div>
</section>`;
  // onboarding forms end at the bottom of the screen: leave room to scroll their last button clear of ours
  if (ONB) { const pad = document.createElement("style"); pad.textContent = "body{padding-bottom:calc(var(--eh-bottom,16px) + 64px)!important}"; document.head.appendChild(pad); }
  const mount = () => { document.body.appendChild(host); place(); setInterval(place, 1500); window.addEventListener("resize", place); start();
    // dialogs open and close between ticks: look again soon after the page changes
    let t = 0; new MutationObserver(() => { if (t) return; t = setTimeout(() => { t = 0; place(); }, 120); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] }); };
  const $ = (s) => root.querySelector(s);
  const btn = () => $(".eh-btn"), panel = () => $(".eh-panel"), nudge = () => $(".eh-nudge");

  // Sit above whatever is fixed at the bottom right (tab bars, Edit page and Shop buttons, sticky bars), never on it.
  // When a full-height dialog leaves no room there (the event wizard on a phone), dock in the top left instead.
  const fixedCache = new WeakMap();
  const fixedish = (el) => { for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) { if (fixedCache.has(e)) return fixedCache.get(e); const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") { fixedCache.set(e, e); return e; } } return null; };
  function obstacleHeight() {
    const H = innerHeight, W = innerWidth, xs = [W - 20, W - 90, W - 160].filter((x) => x > 0); let top = H;
    for (const x of xs) { let gap = 0;
      for (let y = H - 4; y > H * 0.5; y -= 6) { const els = document.elementsFromPoint(x, y).filter((e) => e !== host && !host.contains(e)); let hit = false;
        for (const e of els) { const f = fixedish(e); if (!f) continue; const r = f.getBoundingClientRect(); if (r.width >= W * 0.9 && r.height >= H * 0.9 && e === f) continue; hit = true; break; }
        if (hit) { top = Math.min(top, y); gap = 0; } else if (++gap > 3 && top < H) break; } }
    // also the known bottom-right pieces by name (tab bars, Edit page / Shop buttons, sticky reply bars), even with gaps between them
    try { for (const e of document.querySelectorAll('.es-tabs,nav.tabs,.store-fab,.shop-fab,.own-fab,#gBar,#gStick,[class*="-fab"]')) { if (host.contains(e)) continue; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none") continue; if (r.right > W - 150 && r.bottom > H * 0.5 && r.top < H) top = Math.min(top, r.top); } } catch {}
    return H - top;
  }
  // a dialog, sheet or wizard of the page's own is open: the button steps aside (it would sit on step chips and titles)
  const shown = (e) => { if (!e || host.contains(e) || e.hidden) return false; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false; const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40; };
  const modalOpen = () => { try { if (document.querySelector("#wizBg .wiz, #wizBg[data-wizard]") && shown(document.querySelector("#wizBg"))) return true;
    for (const e of document.querySelectorAll('[role=dialog], [aria-modal=true], dialog[open], .store-pane, .sheet, .pin-bg, .fv-sv')) if (shown(e)) return true; } catch {} return false; };
  function place() {
    try { const b = btn(); if (!b) return; const away = panel().hidden && modalOpen(); b.classList.toggle("eh-away", away); nudge().classList.toggle("eh-away", away); if (away) return;
      const h = obstacleHeight(), dock = h > innerHeight * 0.45 - 8;
      b.classList.toggle("eh-dock", dock); nudge().classList.toggle("eh-dock", dock);
      const bottom = dock ? 16 : Math.round(h ? h + 12 : 16); document.documentElement.style.setProperty("--eh-bottom", bottom + "px");
    } catch {}
  }

  // ---------- chat ----------
  let log = []; try { log = JSON.parse(ss.get(LOG) || "[]").slice(-20); } catch {}
  const saveLog = () => ss.set(LOG, JSON.stringify(log.slice(-20)));
  function msgHTML(m) {
    const acts = (m.actions || []).map((a) => a.href === "#person" ? `<button type="button" data-person>${esc(a.label)}</button>` : `<a href="${esc(a.href)}">${esc(a.label)}</a>`).join("");
    return `<div class="eh-m ${m.role === "potto" ? "potto" : "me"}">${m.role === "potto" ? "<small>Potto</small>" : ""}${esc(m.text)}${acts ? `<div class="eh-acts">${acts}</div>` : ""}</div>`;
  }
  function drawLog() { const L = $(".eh-log"), first = { role: "potto", text: ONB && !signedIn() ? "Hi, I'm Potto. Ask me anything about getting started, or pick one below." : "Hi, I'm Potto. Ask me anything, or pick one below." };
    L.innerHTML = [first, ...log].map(msgHTML).join(""); const B = $("#ehBody"); B.scrollTop = B.scrollHeight; }
  function drawChips() { $(".eh-chips").innerHTML = chips().map(([label, q]) => `<button type="button" data-q="${esc(q)}">${esc(label)}</button>`).join(""); }
  let busy = false;
  async function ask(text) {
    text = String(text || "").trim(); if (!text || busy) return; busy = true; const go = $(".eh-go"); go.disabled = true;
    log.push({ role: "host", text }); drawLog(); const L = $(".eh-log"); L.insertAdjacentHTML("beforeend", `<div class="eh-m potto eh-wait"><small>Potto</small>Thinking…</div>`);
    let m;
    try { const r = await fetch("/api/help/ask", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, page: P + location.search + location.hash, eventId: ctx().eventId || "", history: log.slice(-9, -1).map((x) => ({ role: x.role, text: x.text })) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) m = { role: "potto", text: j.message || "I couldn't answer that just now. A person can help.", actions: [{ label: "Talk to a person", href: "#person" }] };
      else { const acts = (j.actions || []).filter((a) => a && a.label && a.href); if (j.suggestHuman && !acts.some((a) => a.href === "#person")) acts.push({ label: "Talk to a person", href: "#person" }); m = { role: "potto", text: j.answer || "I'm not sure. A person can help.", actions: acts }; }
    } catch { m = { role: "potto", text: "I can't reach Pottery Lab right now. Check your connection, or talk to a person.", actions: [{ label: "Talk to a person", href: "#person" }] }; }
    log.push(m); saveLog(); drawLog(); busy = false; go.disabled = false; $(".eh-ask textarea").focus();
  }

  // ---------- your conversations ----------
  let tickets = [], me = null;
  const lastTeam = (t) => Math.max(0, ...(t.thread || []).filter((x) => x.by === "team").map((x) => x.at || 0));
  const seenAt = () => +(ls.get(SEEN) || 0);
  async function loadTickets(force) {
    if (!signedIn()) return; const cached = ss.get("encore.help.t"); if (!force && cached) { try { const c = JSON.parse(cached); if (Date.now() - c.at < 5 * 60e3) { tickets = c.tickets; return; } } catch {} }
    try { const r = await fetch("/api/help/tickets", { credentials: "same-origin" }); if (!r.ok) return; const j = await r.json(); tickets = j.tickets || []; window.__ehAdmin = !!j.admin; ss.set("encore.help.t", JSON.stringify({ at: Date.now(), tickets })); } catch {}
  }
  function badge() { const unread = tickets.some((t) => lastTeam(t) > seenAt()); const d = $(".eh-dot"); if (d) d.hidden = !unread; btn().setAttribute("aria-label", unread ? "Need a hand? You have a new reply" : "Need a hand?"); }
  function drawConvos() {
    const box = $(".eh-convos"); if (!tickets.length && !window.__ehAdmin) { box.hidden = true; return; } box.hidden = false; const seen = openSeen ?? seenAt();
    box.innerHTML = `<h3>Your conversations</h3>${window.__ehAdmin ? `<p class="eh-note"><a href="/support">Open the team inbox</a></p>` : ""}` + tickets.map((t) => `<details class="eh-convo" data-t="${esc(t.id)}"${lastTeam(t) > seen ? " open" : ""}><summary><span class="eh-pill ${esc(t.status)}">${esc({ open: "Open", waiting: "Replied", solved: "Solved" }[t.status] || t.status)}</span><span>${esc(String(t.message || "").slice(0, 60))}${String(t.message || "").length > 60 ? "…" : ""}</span>${lastTeam(t) > seen ? `<span class="eh-new">New reply</span>` : ""}</summary>${(t.thread || []).map((x) => `<div class="eh-m ${x.by === "team" ? "team" : "me"}">${x.by === "team" ? "<small>Pottery Lab</small>" : ""}${esc(x.text)}</div>`).join("")}<form data-reply="${esc(t.id)}"><input aria-label="Reply" placeholder="Reply" maxlength="4000"><button type="submit" class="eh-go">Send</button></form></details>`).join("");
    box.querySelectorAll("form[data-reply]").forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); const i = f.querySelector("input"), text = i.value.trim(); if (!text) return; f.querySelector("button").disabled = true;
      try { const r = await fetch("/api/help/tickets/" + f.dataset.reply, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "Couldn't send that.");
        tickets = tickets.map((t) => (t.id === j.ticket.id ? j.ticket : t)); ss.set("encore.help.t", JSON.stringify({ at: Date.now(), tickets })); drawConvos(); } catch (err) { i.value = text; i.setAttribute("aria-invalid", "true"); i.placeholder = err.message; f.querySelector("button").disabled = false; } });
    badge();
  }

  // ---------- talk to a person ----------
  async function account() { if (me !== null || !signedIn()) return me; try { const j = await (await fetch("/api/me", { credentials: "same-origin" })).json(); me = j?.verified ? j : false; } catch { me = false; } return me; }
  async function personForm(topic) {
    open(); const wrap = $(".eh-form-wrap"), acct = await account(), out = !acct;
    const transcript = log.map((m) => `${m.role === "potto" ? "Potto" : "Me"}: ${m.text}`).join("\n");
    $(".eh-chat").hidden = true; $(".eh-chips").hidden = true; $(".eh-convos").hidden = true; $(".eh-ask").hidden = true; $(".eh-human").hidden = true; wrap.hidden = false;
    const c = ctx(), evLine = c.eventId ? ", the event you're on" : "";
    wrap.innerHTML = `<form class="eh-form" novalidate><h3 id="ehPersonH" tabindex="-1">Talk to a person</h3>
      ${out ? `<label>What's happening?<select name="topic"><option value="">Pick one</option><option value="code">I need a host code</option><option value="email_taken">My email is already in use</option><option value="reset">My reset email didn't come</option><option value="google">Google sign-in</option><option value="other">Something else</option></select></label>` : ""}
      <label>What's wrong?<textarea name="message" required>${esc(transcript ? "Here's what I asked Potto:\n" + transcript + "\n\n" : "")}</textarea></label>
      ${out ? `<label>Your email<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>Your name <span class="eh-note">(optional)</span><input name="name" autocomplete="name"></label>`
        : `<p class="eh-note">We'll reply to <b>${esc(acct.email)}</b> and here.</p><label>Phone <span class="eh-note">(optional, if a call or text is easier)</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel"></label><label>Screenshot <span class="eh-note">(optional)</span><input name="shot" type="file" accept="image/*"></label>`}
      <div class="eh-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="eh-note">We'll send this page${evLine} and your browser with it, so you don't have to explain.</p>
      <p class="eh-err" role="alert"></p>
      <div style="display:flex;gap:8px;align-items:center"><button type="submit" class="eh-go">Send</button><button type="button" class="eh-back">Back to Potto</button></div></form>`;
    const f = wrap.querySelector("form"), er = f.querySelector(".eh-err");
    if (topic && f.topic) f.topic.value = topic;
    f.querySelector(".eh-back").onclick = backToChat;
    setTimeout(() => { const t = f.message; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 30);
    f.onsubmit = async (e) => { e.preventDefault(); er.textContent = ""; const go = f.querySelector(".eh-go");
      const message = f.message.value.trim(); if (message.length < 3) { er.textContent = "Say what's wrong, even in a few words."; f.message.focus(); return; }
      if (out && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) { er.textContent = "Add your email so we can reply."; f.email.focus(); return; }
      go.disabled = true; go.textContent = "Sending…"; let screenshot = "";
      try {
        const file = f.shot?.files?.[0]; if (file && /^image\//.test(file.type) && file.size < 10e6) { try { const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type }, body: file }); if (r.ok) screenshot = (await r.json()).url || ""; } catch {} }
        const body = { message, page: P + location.search + location.hash, eventId: c.eventId || "", browser: `${navigator.userAgent} · ${innerWidth}x${innerHeight}`, transcript: log.map((m) => ({ role: m.role, text: m.text })), screenshot, website: f.website.value,
          ...(out ? { email: f.email.value.trim(), name: f.elements.name.value.trim(), topic: f.topic.value } : { phone: f.phone.value.trim() }) };
        const r = await fetch("/api/help/ticket", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message || "Couldn't send that. Try again.");
        wrap.innerHTML = `<div class="eh-ok" role="status" tabindex="-1"><b>Sent.</b> ${esc(j.expect || "We'll reply by email, usually within a day.")}</div><button type="button" class="eh-back">Back to Potto</button>`;
        wrap.querySelector(".eh-back").onclick = backToChat; wrap.querySelector(".eh-ok").focus();
        log = []; saveLog(); if (!out) { await loadTickets(true); }
      } catch (err) { er.textContent = err.message; go.disabled = false; go.textContent = "Send"; }
    };
  }
  function backToChat() { const wrap = $(".eh-form-wrap"); wrap.hidden = true; wrap.innerHTML = ""; $(".eh-chat").hidden = false; $(".eh-chips").hidden = false; $(".eh-ask").hidden = false; $(".eh-human").hidden = false; drawLog(); drawChips(); drawConvos(); $(".eh-ask textarea").focus(); }

  // ---------- open and close ----------
  let opener = null, openSeen = null;
  function open(focusAsk) {
    hideNudge(); const p = panel(); if (!p.hidden) return; opener = document.activeElement; openSeen = seenAt(); p.hidden = false; btn().hidden = true; btn().setAttribute("aria-expanded", "true");
    if (!window.Potto && !document.getElementById("ehMascot")) { const s = document.createElement("script"); s.id = "ehMascot"; s.src = "/mascot.js"; s.onload = face; document.head.appendChild(s); } else face();
    backToChat(); if (signedIn()) loadTickets().then(drawConvos); if (!focusAsk) setTimeout(() => $(".eh-x").focus(), 0);
  }
  function face() { try { if (window.Potto?.svg) $(".eh-face").innerHTML = window.Potto.svg("wave", 40, ""); } catch {} }
  function close() { const p = panel(); if (p.hidden) return; p.hidden = true; if (openSeen != null && tickets.length) ls.set(SEEN, String(Date.now())); openSeen = null; badge(); btn().hidden = false; btn().setAttribute("aria-expanded", "false"); (opener && document.contains(opener) && opener !== document.body && opener !== host ? opener : btn()).focus(); }

  // ---------- Potto offers help, once a session ----------
  function offer() { if (ss.get(NUDGED) || !panel().hidden) return; ss.set(NUDGED, "1"); place(); nudge().hidden = false; }
  function hideNudge() { const n = nudge(); if (n && !n.hidden) n.hidden = true; }
  let lastSig = "", since = Date.now(), lastInput = 0;
  const sig = () => { const w = document.querySelector("#wizBg .wiz"); return [where(), location.pathname, location.search, location.hash, w ? (w.getAttribute("aria-label") || "") + (w.querySelector(".wiz-dots .on")?.textContent || w.querySelector("h2")?.textContent || "") : "", document.querySelector("main h1, form:not([hidden]) h1, h1")?.textContent?.slice(0, 60) || ""].join("|"); };
  function watchStuck() {
    setInterval(() => { if (document.hidden) { since = Date.now(); return; } const s = sig(); if (s !== lastSig) { lastSig = s; since = Date.now(); return; }
      const w = where(); if (w && w !== "" && Date.now() - since >= 60e3 && Date.now() - lastInput > 15e3) offer(); }, 3000);
    document.addEventListener("input", (e) => { if (e.target !== host) lastInput = Date.now(); }, true);
    // tapping a button on the step (Copy invite, Next, Save) is progress
    document.addEventListener("click", (e) => { if (e.target !== host && e.target.closest?.("button, a, [role=button]")) since = Date.now(); }, true);
    // the same error twice, on any form or step
    const ERR = "#err, #wzErr, #wlErr, .err, .error, [role=alert], #pipToast, .toast", seen = new Map();
    const bad = (t) => /couldn'?t|can'?t|went wrong|try again|doesn'?t|isn'?t|needs|add your|already|invalid|error|failed|too many|expired/i.test(t);
    const check = (el, fromToast) => { if (!el || el === host || (el.isConnected && !el.getClientRects().length)) return; const t = (el.textContent || "").trim().slice(0, 200); if (!t || (fromToast && !bad(t))) return;
      const now = Date.now(), k = t.toLowerCase(), prev = seen.get(k); if (prev && now - prev.at < 250) return; const n = (prev?.n || 0) + 1; seen.set(k, { n, at: now });
      if (P === "/signup" && /already have an account|invite-only|host code/i.test(t)) return offer();
      if (n >= 2) offer(); };
    new MutationObserver((ms) => { const els = new Set(); for (const m of ms) { const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(ERR); if (el) els.add(el); } for (const el of els) check(el, el.matches("#pipToast, .toast")); }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // the sign-in page reloads with ?error=…: two misses in a row count as the same error twice
    if (P === "/login" && /[?&]error=/.test(location.search)) { const n = +(ss.get("encore.help.loginErr") || 0) + 1; ss.set("encore.help.loginErr", String(n)); if (n >= 2) setTimeout(offer, 800); }
    window.addEventListener("encore:help-error", (e) => { const d = document.createElement("span"); d.textContent = String(e.detail?.message || e.detail || "error"); check(d, false); });
  }

  function start() {
    btn().onclick = () => open();
    $(".eh-x").onclick = close;
    $(".eh-human").onclick = () => personForm();
    nudge().querySelector(".eh-x").onclick = hideNudge;
    nudge().querySelector('[data-nudge="ask"]').onclick = () => { open(true); setTimeout(() => $(".eh-ask textarea").focus(), 30); };
    nudge().querySelector('[data-nudge="person"]').onclick = () => { const t = P === "/signup" ? (/(already have an account)/i.test(document.getElementById("err")?.textContent || "") ? "email_taken" : /invite|code/i.test(document.getElementById("err")?.textContent || "") ? "code" : "") : /^\/(forgot|reset)$/.test(P) ? "reset" : ""; personForm(t); };
    $(".eh-ask").onsubmit = (e) => { e.preventDefault(); const t = $(".eh-ask textarea"); const v = t.value; t.value = ""; ask(v); };
    $(".eh-ask textarea").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $(".eh-ask").requestSubmit(); } });
    root.addEventListener("click", (e) => { const q = e.target.closest("[data-q]"); if (q) return ask(q.dataset.q); if (e.target.closest("[data-person]")) personForm(); });
    root.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (!panel().hidden) { e.stopPropagation(); close(); } else if (!nudge().hidden) { e.stopPropagation(); hideNudge(); btn().focus(); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel().hidden && !document.querySelector("#wizBg") ) close(); });
    watchStuck();
    if (signedIn()) loadTickets().then(badge);
    if (new URLSearchParams(location.search).get("help") === "1") { setTimeout(async () => { await loadTickets(true); open(); }, 400); }
    window.EncoreHelp = { open, person: personForm, offer, ask };
  }
  document.body ? mount() : document.addEventListener("DOMContentLoaded", mount);
})();
