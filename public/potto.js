// Ask Potto and the Inbox hooks, loaded by public/shell.js for signed-in people (and by public/inbox.html).
//
// 1. The bell opens the Inbox: a click on the feed's bell (#bell), Home's bell (#homeBell) or [data-inbox-open] goes to
//    /inbox. The side rail gains an Inbox item after Feed, and the Me sheet an Inbox row.
// 2. The badge: GET /api/inbox/badge every 45 seconds while the tab is visible (and right away on "pl:inbox"), written
//    to every [data-inbox-badge], the feed's #bellN, Home's bell dot and the app icon (navigator.setAppBadge).
// 3. Ask Potto: a dock at the bottom of the Inbox and the host's Home (search, the "Ask Potto" pill with a mic, compose)
//    and the sheet it opens: Potto's line face at the top with history on the left and a new chat on the right, the
//    input at the bottom with + (attach an event or a photo) and the mic (Web Speech API, hidden where there is none).
//    Answers come from POST /api/potto/ask (server/potto.js). Support questions go to the help guide
//    (POST /api/help/ask, public/help.js keeps "Talk to a person"), so the Help links in the rail and the Me sheet open
//    this sheet too. An action (send a reminder, tell people) runs only after the person taps Send on its confirm line.
(function () {
  if (window.PLPotto) return;
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const P = location.pathname;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const I = (d, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
    compose: '<path d="M12 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12"/><path d="M17.6 3.9a1.9 1.9 0 0 1 2.7 2.7L12.5 14.4l-3.6.9.9-3.6z"/>',
    mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V20.5"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8.5V12l2.5 1.8"/>',
    send: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7"/>',
    cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    photo: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8"/>',
    arrow: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',
    person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  };
  // Potto as a line drawing: the wordmark's mark, rim and body in one stroke, two dots and a small smile
  const FACE = (s = 40) => `<svg viewBox="0 0 28 28" width="${s}" height="${s}" aria-hidden="true" fill="currentColor"><path d="M10 4.2h8M11.1 4.2v1.7c0 1.2-.9 1.8-.9 2.9 0 1.3-5.5 3.2-5.5 8.9 0 4.5 4.1 7.3 9.3 7.3s9.3-2.8 9.3-7.3c0-5.7-5.5-7.6-5.5-8.9 0-1.1-.9-1.7-.9-2.9V4.2M12.7 19.2c.8.55 1.8.55 2.6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="11.3" cy="16.4" r=".9"/><circle cx="16.7" cy="16.4" r=".9"/></svg>`;
  const api = async (url, body, method) => { const r = await fetch(url, { method: method || (body ? "POST" : "GET"), credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "Something went wrong. Try again."), { status: r.status, code: j.code }); return j; };
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };

  // ---------- styles ----------
  const css = document.createElement("style"); css.id = "pottoUiCss"; css.textContent = `
.pt-dock{position:fixed;left:0;right:0;bottom:calc(76px + env(safe-area-inset-bottom));z-index:55;display:flex;justify-content:center;pointer-events:none;padding:0 16px}
.pt-dock::before{content:"";position:absolute;left:0;right:0;top:-28px;bottom:-90px;background:linear-gradient(rgba(244,240,232,0),var(--pl-page) 42%);pointer-events:none}
.pt-dock-in{position:relative;pointer-events:auto;display:flex;align-items:center;gap:8px;width:min(560px,100%)}
@media (min-width:861px){.pt-dock{bottom:24px}body.es-has-rail .pt-dock{left:224px}}
.pt-round,.pt-pill{height:48px;border:1px solid var(--pl-line);background:var(--pl-surface);color:var(--pl-ink);box-shadow:var(--pl-shadow-float);cursor:pointer;font:500 16px var(--pl-font-text);-webkit-tap-highlight-color:transparent}
.pt-round{flex:none;width:48px;border-radius:50%;display:grid;place-items:center;padding:0;text-decoration:none}
.pt-pill{flex:1;min-width:0;border-radius:999px;display:flex;align-items:center;gap:10px;padding:0 6px 0 16px;text-align:left}
.pt-pill .pt-pl{flex:1;color:var(--pl-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-pill .pt-pf{color:var(--pl-frame);display:grid}
.pt-pill .pt-pm{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:var(--pl-ink)}
.pt-round:hover,.pt-pill:hover{border-color:var(--pl-line-strong)}
.pt-round:focus-visible,.pt-pill:focus-visible{outline:3px solid var(--pl-ink);outline-offset:2px}
body.pt-has-dock{padding-bottom:calc(150px + env(safe-area-inset-bottom))!important}
@media (min-width:861px){body.pt-has-dock{padding-bottom:96px!important}}
.pt-bg{position:fixed;inset:0;z-index:9100;background:rgba(29,27,24,.32);display:flex;align-items:flex-end;justify-content:center;animation:pt-fade .18s ease-out}
.pt-sheet{width:min(560px,100%);height:min(88dvh,760px);background:var(--pl-surface);border-radius:16px 16px 0 0;box-shadow:var(--pl-shadow-float);display:flex;flex-direction:column;font-family:var(--pl-font-text);color:var(--pl-ink);animation:pt-up .24s cubic-bezier(.2,.8,.2,1);overflow:hidden}
@media (min-width:861px){.pt-bg{align-items:center}.pt-sheet{border-radius:16px;height:min(80dvh,720px)}}
@keyframes pt-fade{from{opacity:0}}@keyframes pt-up{from{transform:translateY(24px);opacity:.6}}
@media (prefers-reduced-motion:reduce){.pt-bg,.pt-sheet{animation:none}}
.pt-grab{width:36px;height:4px;border-radius:2px;background:var(--pl-line-strong);margin:8px auto 0;flex:none}
@media (min-width:861px){.pt-grab{display:none}}
.pt-hd{flex:none;display:grid;grid-template-columns:44px 1fr 44px;align-items:center;padding:6px 8px 10px;border-bottom:1px solid var(--pl-line)}
.pt-ib{width:44px;height:44px;border:0;background:none;border-radius:12px;display:grid;place-items:center;color:var(--pl-ink);cursor:pointer;padding:0}
.pt-ib:hover{background:var(--pl-raised)}.pt-ib[aria-pressed=true]{background:var(--pl-raised)}
.pt-id{display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--pl-frame)}
.pt-id b{font:600 14px var(--pl-font-text);color:var(--pl-ink);letter-spacing:0}
.pt-body{flex:1;overflow:auto;padding:16px 16px 8px;overscroll-behavior:contain}
.pt-hi{margin:8px 4px 16px;font:400 28px/1.15 var(--pl-font-display);letter-spacing:-.015em}
.pt-sub{margin:-8px 4px 16px;color:var(--pl-soft);font-size:15px}
.pt-sug{display:flex;flex-direction:column;border:1px solid var(--pl-line);border-radius:12px;overflow:hidden;background:#fff}
.pt-sug button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;min-height:52px;padding:10px 14px;cursor:pointer;font-size:15px;line-height:1.35;color:var(--pl-ink)}
.pt-sug button+button{border-top:1px solid var(--pl-line)}
.pt-sug button:hover{background:var(--pl-page)}.pt-sug button:focus-visible{outline:3px solid var(--pl-ink);outline-offset:-3px}
.pt-sug .pt-si{color:var(--pl-muted);display:grid;flex:none}
.pt-cap{margin:20px 4px 8px;font:500 12px var(--pl-font-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--pl-muted)}
.pt-person{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;margin:16px 4px 4px;color:var(--pl-accent-text);font:600 14px var(--pl-font-text);min-height:44px}
.pt-person:focus-visible{outline:3px solid var(--pl-ink);outline-offset:2px;border-radius:8px}
.pt-turn{margin:0 0 14px;display:flex;flex-direction:column}
.pt-me{align-self:flex-end;max-width:85%;background:var(--pl-raised);border-radius:16px 16px 4px 16px;padding:10px 14px;font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.pt-me small{display:block;color:var(--pl-soft);font-size:13px;margin-top:2px}
.pt-po{max-width:100%;font-size:15px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;padding:2px 2px}
.pt-links{display:flex;flex-direction:column;margin-top:10px;border:1px solid var(--pl-line);border-radius:12px;overflow:hidden;background:#fff}
.pt-links a{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:8px 14px;color:var(--pl-ink);text-decoration:none;font-weight:600;font-size:15px}
.pt-links a+a{border-top:1px solid var(--pl-line)}.pt-links a:hover{background:var(--pl-page)}.pt-links a svg{color:var(--pl-muted);flex:none}
.pt-act{margin-top:10px;border:1px solid var(--pl-line-strong);border-radius:12px;padding:12px 14px;background:#fff}
.pt-act q{display:block;quotes:none;color:var(--pl-soft);font-size:14px;line-height:1.5;margin:0 0 10px;white-space:pre-wrap}
.pt-act p{margin:0 0 10px;font-size:14px;font-weight:600}
.pt-btns{display:flex;gap:8px;flex-wrap:wrap}
.pt-b{min-height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--pl-line-strong);background:#fff;color:var(--pl-ink);font:600 14px var(--pl-font-text);cursor:pointer}
.pt-b.pri{background:var(--pl-accent);border-color:var(--pl-accent);color:#fff}.pt-b.pri:hover{background:var(--pl-accent-press)}
.pt-b:disabled{opacity:.6;cursor:default}
.pt-done{color:var(--pl-success);font-size:14px;font-weight:600}
.pt-note{flex:none;margin:0 16px 8px;padding:8px 12px;border-radius:8px;background:var(--pl-sand-soft);color:var(--pl-soft);font-size:13px;line-height:1.4}
.pt-dots{display:inline-flex;gap:4px;padding:8px 2px}.pt-dots i{width:6px;height:6px;border-radius:50%;background:var(--pl-muted);animation:pt-dot 1s infinite ease-in-out}.pt-dots i:nth-child(2){animation-delay:.15s}.pt-dots i:nth-child(3){animation-delay:.3s}
@keyframes pt-dot{0%,100%{opacity:.25}50%{opacity:1}}
.pt-hist{list-style:none;margin:0;padding:0;border:1px solid var(--pl-line);border-radius:12px;overflow:hidden;background:#fff}
.pt-hist li{display:flex;align-items:center;gap:4px}.pt-hist li+li{border-top:1px solid var(--pl-line)}
.pt-hist button.pt-ho{all:unset;box-sizing:border-box;flex:1;min-width:0;min-height:52px;padding:8px 14px;cursor:pointer}
.pt-hist b{display:block;font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pt-hist small{color:var(--pl-muted);font-size:13px}
.pt-hist .pt-ib{color:var(--pl-muted);margin-right:4px}
.pt-clear{all:unset;cursor:pointer;display:block;margin:14px auto 0;color:var(--pl-soft);font-size:14px;text-decoration:underline;min-height:44px;line-height:44px}
.pt-in{flex:none;border-top:1px solid var(--pl-line);padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--pl-surface)}
.pt-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 8px}.pt-chips:empty{display:none}
.pt-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:32px;padding:0 4px 0 10px;border-radius:999px;background:var(--pl-raised);font-size:13px;font-weight:600}
.pt-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pt-chip img{width:22px;height:22px;border-radius:6px;object-fit:cover}
.pt-chip button{width:26px;height:26px;border:0;background:none;border-radius:50%;display:grid;place-items:center;cursor:pointer;color:var(--pl-soft);padding:0}
.pt-row{display:flex;align-items:flex-end;gap:6px;border:1px solid var(--pl-line-strong);border-radius:24px;background:#fff;padding:4px}
.pt-row:focus-within{border-color:var(--pl-ink);box-shadow:0 0 0 3px var(--pl-focus)}
.pt-row .pt-ib{width:40px;height:40px;border-radius:50%;flex:none}
.pt-row textarea{flex:1;min-width:0;border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;resize:none;font:400 16px/1.4 var(--pl-font-text);color:var(--pl-ink);padding:9px 2px!important;max-height:140px;min-height:40px;box-sizing:border-box}
.pt-row textarea::placeholder{color:var(--pl-muted)}
#ptSheet .pt-row textarea:focus{border:0!important;box-shadow:none!important;outline:0!important}
.pt-send{width:40px;height:40px;border-radius:50%;border:0;background:var(--pl-ink);color:#fff;display:grid;place-items:center;cursor:pointer;flex:none;padding:0}
.pt-send[hidden],.pt-ib[hidden]{display:none}
.pt-mic.on{background:var(--pl-accent-soft);color:var(--pl-accent-text)}
.pt-menu{position:absolute;bottom:calc(100% + 6px);left:12px;min-width:220px;background:var(--pl-surface);border:1px solid var(--pl-line);border-radius:12px;box-shadow:var(--pl-shadow-float);padding:6px;z-index:2}
.pt-menu button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:15px}
.pt-menu button:hover{background:var(--pl-page)}.pt-menu button[aria-disabled=true]{color:var(--pl-muted);cursor:default}
.pt-menu small{display:block;color:var(--pl-muted);font-size:12px}
.pt-in{position:relative}
[data-inbox-badge][hidden]{display:none!important}
.plme-inbox .es-n,.es-rail a .pt-n{margin-left:auto}
`;
  document.head.appendChild(css);

  // ---------- badge ----------
  let unread = null, bt = 0;
  function setBadge(n) { unread = +n || 0; const txt = unread > 99 ? "99+" : String(unread);
    document.querySelectorAll("[data-inbox-badge]").forEach((b) => { b.hidden = !unread; b.textContent = txt; });
    const fb = document.getElementById("bellN"); if (fb) { fb.hidden = !unread; fb.textContent = txt; }
    const hb = document.querySelector("#homeBell i"); if (hb) { hb.hidden = !unread; hb.textContent = unread > 9 ? "9+" : txt; }
    document.querySelectorAll("#bell,#homeBell,[data-inbox-open]").forEach((b) => b.setAttribute("aria-label", unread ? `Inbox, ${unread} new` : "Inbox"));
    try { if (navigator.setAppBadge) unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge?.(); } catch {}
    try { window.dispatchEvent(new CustomEvent("pl:inbox-count", { detail: unread })); } catch {} }
  async function poll() { clearTimeout(bt); if (!signed()) return; if (!document.hidden) { try { const j = await api("/api/inbox/badge"); setBadge(j.unread); } catch {} } bt = setTimeout(poll, 45000); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  window.addEventListener("pl:inbox", (e) => { if (e.detail != null) setBadge(e.detail); else poll(); });

  // ---------- the bell opens the Inbox; Help opens Potto ----------
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("#bell,#homeBell,[data-inbox-open]");
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); if (P !== "/inbox") location.href = "/inbox"; return; }
    const h = e.target.closest?.("[data-help-open],.plme-help");
    if (h && signed()) { e.preventDefault(); e.stopImmediatePropagation(); document.getElementById("plMe")?.remove(); open(); }
  }, true);
  // the rail: Inbox after Feed; the Me sheet: an Inbox row first
  function railItem() { const rail = document.querySelector(".es-rail"); if (!rail || rail.querySelector('a[href="/inbox"]')) return; const feed = rail.querySelector('a[href="/feed"]'); if (!feed) return;
    const a = document.createElement("a"); a.href = "/inbox"; a.setAttribute("aria-label", "Inbox"); if (P === "/inbox") a.setAttribute("aria-current", "page");
    a.innerHTML = `${I(IC.bell, 24)}<span>Inbox</span><span class="es-n" data-inbox-badge hidden></span>`; feed.after(a); if (unread != null) setBadge(unread); }
  function meRow() { const s = document.querySelector("#plMe .plme"); if (!s || s.querySelector(".plme-inbox")) return; const ref = s.querySelector("a.plme-r,button.plme-r"); if (!ref) return;
    const a = document.createElement("a"); a.className = "plme-r plme-inbox"; a.href = "/inbox"; if (P === "/inbox") a.setAttribute("aria-current", "page");
    a.innerHTML = `<span><b>Inbox</b><small>Replies, approvals and what's new</small></span><span class="es-n" data-inbox-badge hidden style="position:static;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--pl-accent);color:#fff;font:600 12px/20px var(--pl-font-text);text-align:center"></span>${I('<path d="m9 6 6 6-6 6"/>', 20)}`;
    ref.before(a); if (unread != null) setBadge(unread);
    const hb = s.querySelector(".plme-help small"); if (hb) hb.textContent = "Ask Potto, or reach a person"; }
  new MutationObserver(() => { railItem(); meRow(); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- the dock ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  /** The dock: search, the Ask Potto pill, compose. opts: { onSearch, compose: { href, label } } */
  function dock(opts = {}) { if (document.getElementById("ptDock")) return document.getElementById("ptDock");
    const d = document.createElement("div"); d.id = "ptDock"; d.className = "pt-dock";
    const comp = opts.compose || { href: "/?app=1&new=1#studio", label: "New event" };
    d.innerHTML = `<div class="pt-dock-in"><button type="button" class="pt-round" data-pt="search" aria-label="${esc(opts.searchLabel || "Search")}">${I(IC.search)}</button>
      <button type="button" class="pt-pill" data-pt="ask" aria-label="Ask Potto"><span class="pt-pf">${FACE(22)}</span><span class="pt-pl">Ask Potto</span>${SR ? `<span class="pt-pm" data-pt="mic" role="img" aria-label="Speak">${I(IC.mic, 20)}</span>` : ""}</button>
      <a class="pt-round" href="${esc(comp.href)}" aria-label="${esc(comp.label)}">${I(IC.compose)}</a></div>`;
    document.body.appendChild(d); document.body.classList.add("pt-has-dock");
    d.querySelector('[data-pt="search"]').onclick = () => (opts.onSearch ? opts.onSearch() : (location.href = "/discover"));
    d.querySelector('[data-pt="ask"]').onclick = (e) => open({ listen: !!e.target.closest('[data-pt="mic"]') });
    return d; }

  // ---------- the sheet ----------
  let S = null; // { el, threadId, turns, status, attach: { eventId, title } | null, photo: { type, data, url } | null, view }
  let statusP = null; const status = () => (statusP ||= api("/api/potto/status").catch(() => ({ ai: "missing_key", can: {}, unavailable: "" })));
  function suggestions(st) {
    const host = st.hosting;
    return host ? ["Draft a reminder for Saturday", "Who hasn't replied?", "Fill my open spots", "Ideas for a winter supper club"]
      : ["What's on this weekend that's cozy and small?", "Who's going to Friday's game night?", "Find a supper club near me", "Ideas for a first dinner I could host"]; }
  async function open(o = {}) {
    if (!signed()) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
    if (S) { S.el.querySelector("textarea")?.focus(); return; }
    const back = document.activeElement;
    const el = document.createElement("div"); el.className = "pt-bg"; el.id = "ptSheet";
    el.innerHTML = `<div class="pt-sheet" role="dialog" aria-modal="true" aria-label="Ask Potto">
      <div class="pt-grab" aria-hidden="true"></div>
      <div class="pt-hd"><button type="button" class="pt-ib" data-a="hist" aria-label="Your chats with Potto" aria-pressed="false">${I(IC.history)}</button>
        <div class="pt-id">${FACE(34)}<b>Potto</b></div>
        <button type="button" class="pt-ib" data-a="new" aria-label="New chat">${I(IC.compose)}</button></div>
      <div class="pt-body" aria-live="polite"></div>
      <p class="pt-note" hidden></p>
      <form class="pt-in" autocomplete="off"><div class="pt-chips"></div>
        <div class="pt-row"><button type="button" class="pt-ib" data-a="plus" aria-label="Add an event or a photo" aria-haspopup="menu">${I(IC.plus)}</button>
          <textarea rows="1" placeholder="Ask Potto" aria-label="Ask Potto" enterkeyhint="send"></textarea>
          <button type="button" class="pt-ib pt-mic" data-a="mic" aria-label="Speak" ${SR ? "" : "hidden"}>${I(IC.mic, 20)}</button>
          <button type="submit" class="pt-send" aria-label="Send" hidden>${I(IC.send, 20)}</button></div>
        <input type="file" accept="image/*" hidden></form></div>`;
    document.body.appendChild(el); document.documentElement.style.overflow = "hidden";
    S = { el, threadId: "", turns: [], status: null, attach: null, photo: null, view: "chat", back };
    const ta = el.querySelector("textarea"), send = el.querySelector(".pt-send"), mic = el.querySelector('[data-a="mic"]');
    const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; const has = !!ta.value.trim() || !!S.photo; send.hidden = !has; if (SR) mic.hidden = has; };
    ta.addEventListener("input", fit);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.querySelector("form").requestSubmit(); } });
    el.querySelector("form").onsubmit = (e) => { e.preventDefault(); const q = ta.value.trim(); if (!q && !S.photo) return; ta.value = ""; fit(); ask(q); };
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    // on the document, so Esc works even before focus has moved into the sheet
    const onKey = (e) => { if (!S || S.el !== el) return; if (e.key === "Escape") { e.preventDefault(); if (el.querySelector(".pt-menu")) el.querySelector(".pt-menu").remove(); else close(); } if (e.key === "Tab") trap(e); };
    document.addEventListener("keydown", onKey, true); el._off = () => document.removeEventListener("keydown", onKey, true);
    el.querySelector('[data-a="new"]').onclick = () => { S.threadId = ""; S.turns = []; S.attach = null; S.photo = null; chips(); view("chat"); ta.focus(); };
    el.querySelector('[data-a="hist"]').onclick = () => view(S.view === "hist" ? "chat" : "hist");
    el.querySelector('[data-a="plus"]').onclick = (e) => plusMenu(e.currentTarget);
    if (SR) mic.onclick = () => listen(ta, mic, fit);
    // swipe down on the handle or header closes it
    let y0 = null; const hd = el.querySelector(".pt-hd"), grab = el.querySelector(".pt-grab"), sheet = el.querySelector(".pt-sheet");
    for (const h of [hd, grab]) { h.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true }); h.addEventListener("touchmove", (e) => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true }); h.addEventListener("touchend", (e) => { const dy = (e.changedTouches[0].clientY - (y0 ?? 0)); y0 = null; if (dy > 90) close(); else sheet.style.transform = ""; }); }
    view("chat"); setTimeout(() => ta.focus({ preventScroll: true }), 60);
    S.status = await status(); if (!S) return; note(S.status.unavailable); if (!S.turns.length && S.view === "chat") view("chat");
    if (o.q) { ta.value = o.q; fit(); }
    if (o.listen && SR) listen(ta, mic, fit);
  }
  function trap(e) { const f = [...S.el.querySelectorAll("button:not([hidden]),a[href],textarea,[tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  function close() { if (!S) return; try { S.rec?.stop(); } catch {} try { S.el._off?.(); } catch {} S.el.remove(); document.documentElement.style.overflow = ""; const b = S.back; S = null; try { b?.focus?.({ preventScroll: true }); } catch {} }
  function note(t) { const n = S?.el.querySelector(".pt-note"); if (!n) return; n.hidden = !t; n.textContent = t || ""; }
  const body = () => S.el.querySelector(".pt-body");
  function view(v) { S.view = v; S.el.querySelector('[data-a="hist"]').setAttribute("aria-pressed", v === "hist" ? "true" : "false"); if (v === "hist") return drawHistory(); drawChat(); }
  function drawChat() { const b = body();
    if (!S.turns.length) { const st = S.status || {}, name = st.first ? `, ${esc(st.first)}` : "";
      b.innerHTML = `<h2 class="pt-hi">What can I help with${name}?</h2><p class="pt-sub">${st.hosting ? "Your events, your guests, what's next." : "What's on, who's going, where things are."}</p>
        <div class="pt-sug">${suggestions(st).map((q) => `<button type="button" data-q="${esc(q)}"><span class="pt-si">${I(IC.arrow, 18)}</span><span>${esc(q)}</span></button>`).join("")}</div>
        <button type="button" class="pt-person" data-a="person">${I(IC.person, 18)}Reach a person</button>`;
      b.querySelectorAll("[data-q]").forEach((x) => (x.onclick = () => ask(x.dataset.q)));
      b.querySelector('[data-a="person"]').onclick = person; return; }
    b.innerHTML = S.turns.map(turnHtml).join(""); wireTurns(b); b.scrollTop = b.scrollHeight; }
  function turnHtml(t, i) {
    if (t.role === "me") return `<div class="pt-turn"><div class="pt-me">${esc(t.text)}${t.attachTitle ? `<small>About ${esc(t.attachTitle)}</small>` : ""}${t.photoUrl ? `<small>Photo attached</small>` : ""}</div></div>`;
    if (t.role === "wait") return `<div class="pt-turn"><span class="pt-dots" aria-label="Potto is thinking"><i></i><i></i><i></i></span></div>`;
    const links = (t.links || []).filter((l) => /^\/(?!\/)/.test(l.href || ""));
    return `<div class="pt-turn" data-i="${i}"><div class="pt-po">${esc(t.text)}</div>${links.length ? `<div class="pt-links">${links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}${I(IC.arrow, 18)}</a>`).join("")}</div>` : ""}
      ${(t.actions || []).filter((a) => a.url).map((a, k) => `<div class="pt-act" data-k="${k}">${a.preview ? `<q>${esc(a.preview)}</q>` : ""}<div class="pt-btns"><button type="button" class="pt-b pri" data-do>${esc(a.label)}</button></div></div>`).join("")}
      ${t.person ? `<button type="button" class="pt-person" data-a="person">${I(IC.person, 18)}Talk to a person</button>` : ""}</div>`; }
  function wireTurns(b) {
    b.querySelectorAll(".pt-turn[data-i]").forEach((row) => { const t = S.turns[+row.dataset.i];
      row.querySelectorAll(".pt-act").forEach((box) => { const a = t.actions[+box.dataset.k]; const go = box.querySelector("[data-do]");
        if (a.sent) { box.querySelector(".pt-btns").innerHTML = `<span class="pt-done">${esc(a.done || "Done.")}</span>`; return; }
        go.onclick = () => { // confirm first: nothing is sent until the person says so
          const btns = box.querySelector(".pt-btns"); btns.insertAdjacentHTML("beforebegin", `<p>${esc(a.confirm || "Go ahead?")}</p>`);
          btns.innerHTML = `<button type="button" class="pt-b pri" data-yes>Send</button><button type="button" class="pt-b" data-no>Not now</button>`;
          btns.querySelector("[data-no]").onclick = () => drawChat();
          btns.querySelector("[data-yes]").onclick = async (e) => { e.target.disabled = true;
            if (!/^\/api\/(chats\/[A-Za-z0-9_-]{1,80}\/messages|host\/broadcast|host\/announce)$/.test(a.url)) return;
            try { await api(a.url, a.body || {}, a.method || "POST"); a.sent = true; box.querySelector("p")?.remove(); btns.innerHTML = `<span class="pt-done">${esc(a.done || "Done.")}</span>`; }
            catch (err) { e.target.disabled = false; btns.insertAdjacentHTML("afterend", `<p style="color:var(--pl-danger);margin:8px 0 0;font-weight:500">${esc(err.message)}</p>`); } }; }; });
      row.querySelector('[data-a="person"]')?.addEventListener("click", person); }); }
  function person() { close(); const go = () => { try { window.EncoreHelp?.person ? window.EncoreHelp.person() : (location.href = "/settings#hHelp"); } catch {} };
    if (window.EncoreHelp) return go(); const s = document.createElement("script"); s.src = "/help.js"; s.onload = () => setTimeout(go, 50); document.head.appendChild(s); }
  async function drawHistory() { const b = body(); b.innerHTML = `<p class="pt-cap">Your chats with Potto</p><span class="pt-dots"><i></i><i></i><i></i></span>`;
    let L = []; try { L = (await api("/api/potto/threads")).threads; } catch {}
    if (!S || S.view !== "hist") return;
    if (!L.length) { b.innerHTML = `<p class="pt-cap">Your chats with Potto</p><p class="pt-sub" style="margin:8px 4px">Nothing saved yet. Chats stay here until you delete them.</p>`; return; }
    const when = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    b.innerHTML = `<p class="pt-cap">Your chats with Potto</p><ul class="pt-hist">${L.map((t) => `<li><button type="button" class="pt-ho" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><small>${when(t.at)}</small></button><button type="button" class="pt-ib" data-del="${esc(t.id)}" aria-label="Delete this chat">${I(IC.trash, 20)}</button></li>`).join("")}</ul>
      <button type="button" class="pt-clear" data-a="clear">Delete all</button>`;
    b.querySelectorAll("[data-id]").forEach((x) => (x.onclick = async () => { try { const t = (await api("/api/potto/threads/" + encodeURIComponent(x.dataset.id))).thread; S.threadId = t.id; S.turns = t.turns.map((u) => ({ role: u.role === "me" ? "me" : "potto", text: u.text, links: u.links || [], actions: [] })); view("chat"); } catch {} }));
    b.querySelectorAll("[data-del]").forEach((x) => (x.onclick = async () => { try { await api("/api/potto/threads/" + encodeURIComponent(x.dataset.del), null, "DELETE"); if (S.threadId === x.dataset.del) { S.threadId = ""; S.turns = []; } drawHistory(); } catch {} }));
    b.querySelector('[data-a="clear"]').onclick = async (e) => { if (e.target.dataset.sure !== "1") { e.target.dataset.sure = "1"; e.target.textContent = "Tap again to delete every chat"; return; } try { await api("/api/potto/threads", null, "DELETE"); S.threadId = ""; S.turns = []; drawHistory(); } catch {} }; }
  function chips() { const c = S.el.querySelector(".pt-chips"); c.innerHTML = (S.attach ? `<span class="pt-chip">${I(IC.cal, 16)}<span>${esc(S.attach.title)}</span><button type="button" data-x="ev" aria-label="Remove">${I(IC.x, 14)}</button></span>` : "") + (S.photo ? `<span class="pt-chip"><img src="${S.photo.url}" alt=""><span>Photo</span><button type="button" data-x="ph" aria-label="Remove photo">${I(IC.x, 14)}</button></span>` : "");
    c.querySelectorAll("[data-x]").forEach((b) => (b.onclick = () => { if (b.dataset.x === "ev") S.attach = null; else S.photo = null; chips(); S.el.querySelector("textarea").dispatchEvent(new Event("input")); })); }
  async function plusMenu(btn) { const f = S.el.querySelector("form"); f.querySelector(".pt-menu")?.remove(); const st = S.status || {}, photos = st.ai && st.ai !== "missing_key";
    const m = document.createElement("div"); m.className = "pt-menu"; m.setAttribute("role", "menu");
    m.innerHTML = `<button type="button" role="menuitem" data-m="ev">${I(IC.cal, 20)}<span>An event</span></button><button type="button" role="menuitem" data-m="ph" ${photos ? "" : 'aria-disabled="true"'}>${I(IC.photo, 20)}<span>A photo${photos ? "" : "<small>Needs AI, which isn't set up here</small>"}</span></button>`;
    f.appendChild(m); m.querySelector("button").focus();
    const off = (e) => { if (!m.contains(e.target) && e.target !== btn) { m.remove(); document.removeEventListener("pointerdown", off, true); } }; document.addEventListener("pointerdown", off, true);
    m.querySelector('[data-m="ph"]').onclick = () => { if (!photos) return; m.remove(); const inp = f.querySelector('input[type="file"]'); inp.value = ""; inp.onchange = () => inp.files[0] && shrink(inp.files[0]); inp.click(); };
    m.querySelector('[data-m="ev"]').onclick = async () => { m.innerHTML = `<span class="pt-dots"><i></i><i></i><i></i></span>`; let L = []; try { L = (await api("/api/potto/events?tz=" + encodeURIComponent(tz()))).events; } catch {}
      m.innerHTML = L.length ? L.map((e) => `<button type="button" role="menuitem" data-id="${esc(e.id)}" data-t="${esc(e.title)}">${I(IC.cal, 20)}<span>${esc(e.title)}<small>${esc(e.when)}${e.mine ? " · yours" : ""}</small></span></button>`).join("") : `<p style="margin:8px 10px;color:var(--pl-soft);font-size:14px">No upcoming events yet.</p>`;
      m.querySelectorAll("[data-id]").forEach((x) => (x.onclick = () => { S.attach = { eventId: x.dataset.id, title: x.dataset.t }; chips(); m.remove(); S.el.querySelector("textarea").focus(); })); }; }
  function shrink(file) { const img = new Image(), url = URL.createObjectURL(file); img.onload = () => { const k = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const d = c.toDataURL("image/jpeg", 0.82); S.photo = { type: "image/jpeg", data: d.split(",")[1], url: d }; URL.revokeObjectURL(url); chips(); S.el.querySelector("textarea").dispatchEvent(new Event("input")); }; img.src = url; }
  function listen(ta, mic, fit) { if (!SR || !S) return; if (S.rec) { try { S.rec.stop(); } catch {} return; }
    const r = new SR(); r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = false; const base = ta.value ? ta.value + " " : "";
    r.onresult = (e) => { let t = ""; for (const x of e.results) t += x[0].transcript; ta.value = base + t; fit(); };
    r.onend = () => { mic.classList.remove("on"); mic.setAttribute("aria-label", "Speak"); if (S) S.rec = null; if (ta.value.trim()) S?.el.querySelector(".pt-send")?.focus(); };
    r.onerror = () => r.onend();
    S.rec = r; mic.classList.add("on"); mic.setAttribute("aria-label", "Stop listening"); try { r.start(); } catch { r.onend(); } }

  async function ask(q) { if (!S) return; if (S.view !== "chat") view("chat");
    const att = S.attach, photo = S.photo; S.attach = null; S.photo = null; chips();
    S.turns.push({ role: "me", text: q || "What's in this photo?", attachTitle: att?.title, photoUrl: photo?.url }, { role: "wait" }); drawChat();
    const done = (t) => { if (!S) return; S.turns = S.turns.filter((x) => x.role !== "wait"); S.turns.push(t); drawChat(); };
    try { const j = await api("/api/potto/ask", { message: q, threadId: S.threadId, eventId: att?.eventId || "", tz: tz(), ...(photo ? { photo: { type: photo.type, data: photo.data } } : {}) });
      if (!S) return; S.threadId = j.threadId || S.threadId;
      if (j.route === "help") { let h; try { h = await api("/api/help/ask", { message: q, page: location.pathname, history: S.turns.filter((t) => t.role === "me" || t.role === "potto").slice(-6).map((t) => ({ role: t.role === "me" ? "host" : "potto", text: t.text })) }); } catch (err) { h = { answer: err.message, suggestHuman: true, actions: [] }; }
        const links = (h.actions || []).filter((a) => /^\/(?!\/)/.test(a.href || "")).map((a) => ({ label: a.label, href: a.href })).slice(0, 3);
        done({ role: "potto", text: h.answer || "I'm not sure. A person can help.", links, person: true });
        api("/api/potto/note", { threadId: S.threadId, answer: h.answer || "", links }).catch(() => {}); return; }
      if (j.note) note(j.note);
      done({ role: "potto", text: j.answer, links: j.links || [], actions: j.actions || [] }); }
    catch (err) { done({ role: "potto", text: err.status === 429 ? err.message : `${err.message || "That one stumped me. Try asking another way, or reach a person from Help."}`, links: [] }); } }

  // ---------- where the dock goes ----------
  // the host's Home in the app (index.html "#view-programs"); the Inbox page mounts its own (public/inbox.html)
  function homeDock() { if (P !== "/" || !signed()) return; const v = document.getElementById("view-programs"); const on = !!v && !v.hidden && getComputedStyle(v).display !== "none" && !document.getElementById("view-guest")?.offsetParent;
    const d = document.getElementById("ptDock"); if (on && !d) { const n = dock({ searchLabel: "Search Discover", compose: { href: "/?app=1&new=1#studio", label: "New event" } });
      // sit just above the app's own tab bar when it shows, else near the bottom edge
      const t = [...document.querySelectorAll("nav.tabs,.es-tabs")].find((x) => x.offsetParent && x.getBoundingClientRect().bottom >= innerHeight - 2), h = t ? Math.round(t.getBoundingClientRect().height) : 0;
      n.style.bottom = h ? `${h + 8}px` : "calc(16px + env(safe-area-inset-bottom))"; } else if (!on && d && d.dataset.home !== "0") { d.remove(); document.body.classList.remove("pt-has-dock"); } }
  if (P === "/") { let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(homeDock, 120); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] }); }

  window.PLPotto = { open, close, dock, setBadge, poll, get unread() { return unread; }, FACE };
  const start = () => { railItem(); poll(); homeDock(); if (/[?&]potto=1\b/.test(location.search)) open(); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
