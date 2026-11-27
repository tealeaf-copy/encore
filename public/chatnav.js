// Chats in the navigation (public/shell.js on public pages, index.html in the app): the unread badge, and the Me sheet
// that holds Home, Plans, My page and Saved on a phone, so the bottom bar keeps five tabs:
// Feed, Discover, New, Chats, Me.
// Unread, on every page with the nav: one task on the shared poller (public/poller.js) asks GET /api/me/unread (POST with
// the reply proofs this browser holds, for guests without an account) every 45 seconds while the tab shows, paused while
// it's hidden, at once when the tab comes back (focus, visibilitychange, pageshow), slower after a failure. It writes:
//   - the Chats badge in the tab bar and the rail ([data-chats-badge]: chats with something new, muted ones don't count),
//     and "Chats, 3 unread" on the link for screen readers
//   - the bell's count (public/potto.js setBadge), so the Inbox needs no timer of its own
//   - a pop-up when a new message comes in while you're elsewhere in the app: "Maya in Dumpling night: I can bring the
//     vinegar". Tap to open the chat; it goes after 6 seconds; at most one per chat a minute; never for the chat you have
//     open; off with "Message pop-ups" in Settings.
// The tab title's "(3)" stays on the Chats page only (public/chat.js).
(function () {
  if (window.PLChatNav) return;
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  function proofs() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), m = /^encore-rsvp-([A-Za-z0-9_-]+)$/.exec(k || ""); if (!m) continue; try { const v = JSON.parse(localStorage.getItem(k)); if (v?.rid && v.code) out.push({ eventId: m[1], rid: v.rid, code: v.code }); } catch {} } } catch {} return out.slice(0, 60); }
  const has = () => signed() || proofs().length > 0;
  const onChats = () => location.pathname.split("/")[1] === "chats", openId = () => (/^\/chats\/([A-Za-z0-9_-]{1,80})/.exec(location.pathname) || [])[1] || "";
  // last time's counts, so a new page draws its badges straight away (they sit on the icon, so nothing moves when they land)
  let last = null; try { last = JSON.parse(sessionStorage.getItem("pl.unread") || "null"); } catch {}
  let n = window.__plChatsUnread ?? last?.chats ?? 0, inbox = last?.inbox ?? null;
  const cap = (k) => (k > 99 ? "99+" : String(k));
  function set(k) { n = +k || 0; document.querySelectorAll("[data-chats-badge]").forEach((b) => { b.hidden = !n; b.textContent = cap(n); b.setAttribute("aria-hidden", "true"); b.removeAttribute("aria-label");
    const a = b.closest("a"); if (a) a.setAttribute("aria-label", n ? `Chats, ${cap(n)} unread` : "Chats"); }); }
  function setInbox(k) { if (k == null || !signed()) return; inbox = +k || 0; if (window.PLPotto?.setBadge) { window.PLPotto.setBadge(inbox); return; }
    document.querySelectorAll("[data-inbox-badge]").forEach((b) => { b.hidden = !inbox; b.textContent = cap(inbox); }); }
  let task = null, ranAt = 0;
  async function check() { ranAt = Date.now(); if (!has()) { set(0); return 3 * 60000; } // nobody to ask about yet: look again now and then (a reply on this page makes a guest)
    const pr = proofs(), r = await fetch("/api/me/unread", pr.length ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proofs: pr }) } : { credentials: "same-origin" });
    if (!r.ok) throw new Error("unread " + r.status); const j = await r.json();
    if (!onChats() || window.__plChatsUnread == null) set(j.chats); // on the Chats page, public/chat.js counts from the list it already has
    setInbox(j.inbox); try { sessionStorage.setItem("pl.unread", JSON.stringify({ chats: j.chats, inbox: j.inbox })); } catch {}
    heads(j); }
  // the nav was drawn (or drawn again): put the counts we have on it, and start the task once
  let ready = false, once = false;
  function poll() { set(window.__plChatsUnread ?? n); if (inbox != null) setInbox(inbox); if (task || !ready) return;
    if (window.PLPoll) task = window.PLPoll.every("unread", check, { ms: 45000, max: 5 * 60000, now: true }); else if (!once) { once = true; check().catch(() => {}); } }
  // back on the tab: ask at once (the poller only catches up on tasks that were due), at most every 5 seconds
  const soon = () => { if (task && !document.hidden && Date.now() - ranAt > 5000) task.kick(); };
  document.addEventListener("visibilitychange", soon); addEventListener("focus", soon); addEventListener("pageshow", (e) => { if (e.persisted) soon(); });

  // ---- the pop-up for a new message ----
  const popupsOn = () => LS.get("pl.msgPopups") !== "0";
  function heads(j) { if (signed() && typeof j.popups === "boolean") LS.set("pl.msgPopups", j.popups ? "1" : "0"); // the account's setting wins
    const L = j.latest; if (!L || !L.at || !L.chat) return; const base = +LS.get("pl.msgSeenAt") || 0; if (L.at <= base) return; LS.set("pl.msgSeenAt", String(L.at));
    if (!base || L.at < Date.now() - 10 * 60e3) return; // the first look on this device, or old news: just the badge
    if (j.popups === false || !popupsOn() || document.hidden) return;
    if (onChats() && (!openId() || openId() === L.chat)) return; // the list shows it already, or you're in that chat
    let seen = {}; try { seen = JSON.parse(LS.get("pl.msgPopped") || "{}") || {}; } catch {} const now = Date.now();
    if (now - (seen[L.chat] || 0) < 60e3) return; seen[L.chat] = now; for (const k of Object.keys(seen)) if (now - seen[k] > 60e3 && k !== L.chat) delete seen[k]; LS.set("pl.msgPopped", JSON.stringify(seen));
    toast(L); }
  function toast(L) { document.getElementById("plMsgToast")?.remove(); const d = document.createElement("div"); d.id = "plMsgToast"; d.className = "pl-mt"; d.setAttribute("role", "status"); d.setAttribute("aria-live", "polite");
    const who = `${L.by} in ${L.title}`, href = "/chats/" + encodeURIComponent(L.chat);
    d.innerHTML = `<a class="pl-mt-a" href="${href}"><span class="pl-mt-ic">${CHAT.replace('width="24" height="24"', 'width="18" height="18"')}</span><span class="pl-mt-t">${L.photo ? `<b>${esc(who)}</b> sent a photo` : `<b>${esc(who)}:</b> ${esc(L.text)}`}</span></a><button type="button" class="pl-mt-x" aria-label="Dismiss">${ICON('<path d="M6 6l12 12M18 6 6 18"/>').replace('width="24" height="24"', 'width="18" height="18"')}</button>`;
    document.body.appendChild(d); let t = 0; const go = () => { clearTimeout(t); d.classList.add("out"); setTimeout(() => d.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160); };
    const wait = () => { clearTimeout(t); t = setTimeout(go, 6000); }; wait();
    d.addEventListener("pointerenter", () => clearTimeout(t)); d.addEventListener("pointerleave", wait); d.addEventListener("focusin", () => clearTimeout(t)); d.addEventListener("focusout", wait);
    d.querySelector(".pl-mt-x").onclick = go;
    d.querySelector(".pl-mt-a").onclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; if (onChats() && typeof window.openChat === "function") { e.preventDefault(); window.openChat(L.chat); } go(); }; }
  const ICON = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const CHAT = ICON('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>');
  // the Me sheet: everything that left the bottom bar
  function me({ handle = "", host = false, name = "" } = {}) { document.getElementById("plMe")?.remove(); const P = location.pathname;
    const row = (href, label, sub) => `<a class="plme-r" href="${href}"${(href.split(/[?#]/)[0] === P && P !== "/") || (href.startsWith("/?app") && P === "/" && /app=1/.test(location.search)) ? ' aria-current="page"' : ""}><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></a>`;
    const s = document.createElement("div"); s.id = "plMe"; s.className = "plme-bg";
    s.innerHTML = `<div class="plme" role="dialog" aria-modal="true" aria-label="Me"><div class="plme-g" aria-hidden="true"></div><div class="plme-hd"><button type="button" class="plme-face" aria-label="Change your profile picture"><span class="plme-fi"></span><span class="plme-cam" aria-hidden="true">${ICON('<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>').replace('width="24" height="24"', 'width="14" height="14"')}</span></button><span class="plme-who">${name ? `<b class="plme-n">${esc(name)}</b>` : ""}<button type="button" class="plme-pic">Change photo</button></span></div>
      ${host ? row("/?app=1", "Home", "Your events and what's next") : ""}${row("/plans", "Plans", "What you're going to")}${row("/me", "Your stats", "Nights out, hosts, streaks. Private")}${host && handle ? row("/@" + encodeURIComponent(handle), "My page", "What guests see") : ""}${row("/library", "Library", "Saves, lists and plans")}${row("/ideas", "Ideas")}${host ? "" : row("/?app=1", "Host something", "Start your page, free")}
      ${signed() ? row("/settings#getpaid", "Get paid", "Venmo, PayPal or Cash App for your events") : ""}${row("/settings", "Settings", "Notifications, blocked people, delete account")}${row("/about", "About Pottery Lab")}${window.EncoreHelp?.open ? `<button type="button" class="plme-r plme-help"><span><b>Help</b><small>Ask Potto, or reach a person</small></span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>` : ""}<button type="button" class="plme-out">Sign out</button></div>`;
    document.body.appendChild(s); const close = () => { s.remove(); document.removeEventListener("keydown", k); }; const k = (e) => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", k);
    s.onclick = (e) => { if (e.target === s) close(); }; const hb = s.querySelector(".plme-help"); if (hb) hb.onclick = () => { close(); try { window.EncoreHelp.open(true); } catch {} }; s.querySelector(".plme-out").onclick = async () => { try { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }); } catch {} location.href = "/"; };
    // the profile picture: the shared "Change photo" sheet (public/photosheet.js), loaded the first time it's needed
    const fi = s.querySelector(".plme-fi"), draw = () => need("/avatars.js").then(() => need("/photosheet.js")).then(() => window.PhotoSheet.mine()).then((m) => { if (m && fi.isConnected) { fi.innerHTML = window.PhotoSheet.face(m.avatar, name, 48); s.querySelector(".plme-pic").textContent = m.avatar.url || m.avatar.art ? "Change photo" : "Add a photo"; } }).catch(() => {});
    if (signed()) draw(); else s.querySelector(".plme-hd").hidden = true;
    s.querySelectorAll(".plme-face,.plme-pic").forEach((b) => (b.onclick = async () => { await need("/avatars.js"); await need("/photosheet.js"); await window.PhotoSheet.profile(); draw(); }));
    setTimeout(() => s.querySelector("a,button")?.focus({ preventScroll: true }), 30); }
  const need = (src) => new Promise((ok, no) => { if (src === "/photosheet.js" && window.PhotoSheet) return ok(); if (src === "/avatars.js" && window.EncoreAvatars) return ok(); const t = document.createElement("script"); t.src = src; t.onload = ok; t.onerror = no; document.head.appendChild(t); });
  const css = document.createElement("style"); css.textContent = `.plme-bg{position:fixed;inset:0;z-index:9000;background:rgba(31,26,23,.36);display:flex;align-items:flex-end;justify-content:center}
.plme{width:min(480px,100%);background:var(--pl-surface);border-radius:24px 24px 0 0;padding:8px 12px calc(14px + env(safe-area-inset-bottom));box-shadow:0 18px 48px -18px rgba(31,26,23,.45);font-family:"IBM Plex Sans",system-ui,sans-serif;color:var(--pl-ink);box-sizing:border-box}
.plme-g{width:40px;height:4px;border-radius:2px;background:#E0D5C6;margin:4px auto 8px}.plme-n{display:block;font:600 20px/1.2 var(--pl-font-text);overflow-wrap:anywhere}
.plme-hd{display:flex;align-items:center;gap:12px;margin:4px 8px 8px}.plme-hd[hidden]{display:none}.plme-who{flex:1;min-width:0}
.plme-face{all:unset;position:relative;flex:none;width:48px;height:48px;border-radius:50%;cursor:pointer}.plme-fi{display:block;width:48px;height:48px;border-radius:50%;background:var(--pl-raised)}
.plme-cam{position:absolute;right:-2px;bottom:-2px;width:22px;height:22px;border-radius:50%;background:var(--pl-surface);border:1.5px solid var(--pl-line);display:grid;place-items:center;color:#5A3B2B}
.plme-pic{all:unset;display:inline-block;min-height:32px;line-height:32px;color:var(--pl-accent-text);font:600 14px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}.plme-face:focus-visible,.plme-pic:focus-visible{outline:3px solid var(--pl-ink);outline-offset:2px;border-radius:8px}
button.plme-r{width:100%;border:0;background:none;font:inherit;text-align:left;cursor:pointer}.plme-r{display:flex;align-items:center;gap:12px;min-height:56px;padding:6px 8px;border-radius:12px;color:inherit;text-decoration:none}.plme-r span{flex:1}.plme-r b{display:block;font-weight:600;font-size:16px}.plme-r small{display:block;color:var(--pl-soft);font-size:13px}.plme-r svg{color:#5A3B2B}.plme-r:hover,.plme-r[aria-current]{background:#F6EFE7}
.plme-out{display:block;width:100%;min-height:48px;margin-top:6px;border:0;background:none;color:var(--pl-soft);font:500 15px "IBM Plex Sans",system-ui;text-decoration:underline;cursor:pointer}
[data-chats-badge][hidden]{display:none!important}
.es-tabs a .es-tn,nav.tabs a .es-tn{position:absolute;top:0;left:calc(50% + 4px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--pl-accent);color:#fff;font:500 12px/18px "IBM Plex Mono",ui-monospace,monospace;text-align:center;box-sizing:border-box;border:2px solid var(--pl-surface)}
.es-tabs a{position:relative}
.pl-mt{position:fixed;z-index:8000;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));display:flex;align-items:stretch;gap:2px;max-width:420px;margin:0 auto;background:var(--pl-surface,#fff);color:var(--pl-ink,#1F1A17);border:1px solid var(--pl-line,#E4DACB);border-left:3px solid var(--pl-accent,#29489A);border-radius:6px;box-shadow:0 10px 28px -12px rgba(31,26,23,.35);font:400 15px/1.35 "IBM Plex Sans",system-ui,sans-serif;box-sizing:border-box;animation:plMtIn .16s ease-out}
body.es-has-tabs .pl-mt{bottom:calc(100px + env(safe-area-inset-bottom))}
@media (min-width:861px){.pl-mt,body.es-has-tabs .pl-mt{left:auto;right:20px;top:16px;bottom:auto;width:380px;margin:0}}
.pl-mt.out{opacity:0;transition:opacity .16s}
.pl-mt-a{flex:1;min-width:0;display:flex;align-items:flex-start;gap:10px;min-height:44px;padding:10px 4px 10px 12px;color:inherit;text-decoration:none;border-radius:6px}
.pl-mt-ic{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:6px;background:var(--pl-accent-soft,#E3E8F4);color:var(--pl-accent-text,#29489A)}
.pl-mt-t{min-width:0;align-self:center;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.pl-mt-t b{font-weight:600}
.pl-mt-x{flex:none;width:44px;min-height:44px;border:0;background:none;color:var(--pl-soft,#6B5E54);cursor:pointer;border-radius:6px;display:grid;place-items:center}
.pl-mt-a:focus-visible,.pl-mt-x:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:-3px}
@keyframes plMtIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pl-mt{animation:none}.pl-mt.out{transition:none}}`; document.head.appendChild(css);

  // the app (index.html) on a phone: Feed, Discover, New, Chats, Me; on a computer the sidebar keeps Home, Plans and My page and gains Chats
  function app() { if (location.pathname !== "/") return; let tries = 0; const go = () => { const nav = document.querySelector("nav.tabs"); if (!nav || !window.__wsPersonal) { if (++tries < 60) setTimeout(go, 500); return; }
      if (!document.getElementById("navChats")) { const ref = document.getElementById("navDisc") || nav.querySelector('a[href="/discover"]'); const a = document.createElement("a"); a.id = "navChats"; a.href = "/chats"; a.className = ref?.className || ""; a.style.position = "relative";
        a.innerHTML = `${CHAT.replace('width="24" height="24"', 'width="22" height="22" class="nav-ic"')}Chats<span class="es-tn" data-chats-badge hidden></span>`; (ref ? ref.after(a) : nav.appendChild(a)); }
      if (!document.getElementById("navMeTab")) { const a = document.createElement("a"); a.id = "navMeTab"; a.href = "#me"; a.setAttribute("aria-label", "Me: Home, Plans, My page"); a.innerHTML = `${ICON('<circle cx="12" cy="8.5" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>').replace('width="24" height="24"', 'width="22" height="22" class="nav-ic"')}Me`;
        a.onclick = async (e) => { e.preventDefault(); let h = ""; try { const j = await (await fetch("/api/host/profile", { credentials: "same-origin" })).json(); h = j?.host?.handle || j?.handle || ""; } catch {} me({ host: !window.__wsRegularOnly, handle: h }); }; nav.appendChild(a); }
      if (!document.getElementById("navChatsCss")) { const s = document.createElement("style"); s.id = "navChatsCss"; s.textContent = `#navMeTab{display:none!important}@media (max-width:760px){body.friends-ws nav.tabs>a{display:none!important}body.friends-ws nav.tabs>#navFeed,body.friends-ws nav.tabs>#navDisc,body.friends-ws nav.tabs>a[data-view=studio],body.friends-ws nav.tabs>#navChats,body.friends-ws nav.tabs>#navMeTab{display:flex!important}body.friends-ws nav.tabs>#navFeed{order:1!important}body.friends-ws nav.tabs>#navDisc{order:2!important}body.friends-ws nav.tabs>a[data-view=studio]{order:3!important}body.friends-ws nav.tabs>#navChats{order:4!important}body.friends-ws nav.tabs>#navMeTab{order:5!important}}`; document.head.appendChild(s); }
      poll(); }; go(); }
  window.PLChatNav = { set, poll, me, has, CHAT, proofs, kick: () => { if (task) task.kick(); else poll(); }, toast, get n() { return n; }, get inbox() { return inbox; } };
  // a new account that hasn't confirmed its email sees one line about it (public/verifybanner.js)
  const verify = () => { if (signed() && !window.__plVerify) { const t = document.createElement("script"); t.src = "/verifybanner.js"; t.defer = true; document.head.appendChild(t); } };
  const start = () => { app(); (window.PLPoll ? Promise.resolve() : need("/poller.js")).catch(() => {}).then(() => { ready = true; poll(); }); verify(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
