// Group chats, in the browser (/chats and /chats/<event>; server/chat.js). The inbox on the left (or the whole screen on a
// phone), the thread on the right. Guests without an account are known by the replies this browser holds
// (localStorage "encore-rsvp-<event>": rid and code) or by an emailed link (#reply=<rid>.<token>).
// Polling, not sockets: every 3 seconds while the tab is visible, slowing to 15 when nothing changes, never when hidden.
(function () {
  if (window.__plChats) return; window.__plChats = 1;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const I = (d, cls = "") => `<svg class="ch-ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const G = { // drawn glyphs, Potto's brown, 1.75 stroke
    back: I('<path d="M15 5 8 12l7 7"/>'), info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'), send: I('<path d="M12 19V6M6 11.5 12 5.5l6 6"/>'),
    photo: I('<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17.5 5-5 3.5 3.5 2.5-2.5 4 4"/>'), pin: I('<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 12v8"/>'),
    reply: I('<path d="M10 7 5 12l5 5"/><path d="M5.5 12H14a5 5 0 0 1 5 5v1"/>'), more: I('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>'),
    smile: I('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2M9 9.5v.01M15 9.5v.01"/>'), mute: I('<path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8"/><path d="M10 20.5a2 2 0 0 0 4 0M4 4l16 16"/>'),
    bell: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'), lock: I('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    x: I('<path d="M6 6l12 12M18 6 6 18"/>'), flag: I('<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>'), block: I('<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>'), trash: I('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>'),
    copy: I('<rect x="8" y="8" width="11" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>'), cal: I('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    open: I('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'), down: I('<path d="M12 5v13M6 12.5l6 6 6-6"/>'), people: I('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c1.2-3.5 3.6-5.2 6.5-5.2s5.3 1.7 6.5 5.2"/><circle cx="17" cy="9.5" r="2.8"/><path d="M16 14.6c2.6 0 4.5 1.5 5.5 4.4"/>'),
  };
  const fine = matchMedia("(hover:hover) and (pointer:fine)").matches, wide = () => matchMedia("(min-width:861px)").matches;
  const toast = (t) => { $(".ch-toast")?.remove(); const d = document.createElement("div"); d.className = "ch-toast"; d.setAttribute("role", "status"); d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); };

  // ---- who this browser is: the replies it holds ----
  function proofs() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i), m = /^encore-rsvp-([A-Za-z0-9_-]+)$/.exec(k || ""); if (!m) continue; try { const v = JSON.parse(localStorage.getItem(k)); if (v?.rid && v.code) out.push({ eventId: m[1], rid: v.rid, code: v.code }); } catch {} } } catch {} return out.slice(0, 60); }
  const proofFor = (id) => { try { const v = JSON.parse(ls.get("encore-rsvp-" + id) || "null"); return v?.rid && v.code ? { rid: v.rid, code: v.code } : null; } catch { return null; } };
  let linkProof = null; // from an emailed link: #reply=<rid>.<token>
  { const m = /#reply=([A-Za-z0-9_-]+)\.([a-f0-9]{16,64})/.exec(location.hash); if (m) { linkProof = { rid: m[1], t: m[2] }; history.replaceState(null, "", location.pathname + location.search); } }
  const qOf = (id) => { const p = linkProof && id === route.id ? linkProof : proofFor(id); return p ? Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : ""; };
  const bodyOf = (id, extra = {}) => ({ ...(proofFor(id) || {}), ...extra });
  async function api(path, body, opts = {}) { const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body && !(body instanceof Blob) ? { "Content-Type": "application/json" } : opts.type ? { "Content-Type": opts.type } : {}, body: body ? (body instanceof Blob ? body : JSON.stringify(body)) : undefined });
    let j = {}; try { j = await r.json(); } catch {} if (!r.ok) { const e = new Error(j.message || "That didn't go through. Try again."); e.status = r.status; e.code = j.code; throw e; } return j; }

  // ---- little formatters ----
  const now = () => Date.now();
  function rel(at) { if (!at) return ""; const s = (now() - at) / 1000; if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; const d = new Date(at); if (s < 6 * 86400) return d.toLocaleDateString("en-US", { weekday: "short" }); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  const dayKey = (at) => new Date(at).toDateString();
  function dayLabel(at) { const d = new Date(at), t = new Date(); const y = new Date(t); y.setDate(t.getDate() - 1); if (d.toDateString() === t.toDateString()) return "Today"; if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) }); }
  const clockOf = (at) => { const d = new Date(at); let h = d.getHours(); const m = d.getMinutes(), ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")}${ap}`; };
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 1).map((w) => w[0]?.toUpperCase() || "?").join("");
  const linkify = (h) => h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener nofollow">${u}</a>`);
  const emojiOnly = (t) => t.length <= 12 && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u.test(t);
  function av(p, cls = "") { if (p?.avatar?.url) return `<span class="ch-av ${cls}" aria-hidden="true"><img src="${esc(p.avatar.url)}" alt="" loading="lazy"></span>`; if (p?.avatar?.art && window.EncoreAvatars?.svg) { try { return `<span class="ch-av ${cls}" style="--t:var(--pl-sand-soft)" aria-hidden="true">${window.EncoreAvatars.svg(p.avatar.art)}</span>`; } catch {} } return `<span class="ch-av ${cls}" style="--t:${esc(p?.tint || "#F6D7A7")}" aria-hidden="true">${esc(initials(p?.name))}</span>`; }
  function thumb(c) { if (c.cover) return `<span class="ch-thumb"><img src="${esc(c.cover)}" alt="" loading="lazy"></span>`;
    const E = window.EventArt; if (E) { try { const e = { name: c.art?.name || c.title, pubTitle: c.art?.name || c.title, activity: c.art?.activity || "", coverArt: c.art?.coverArt || null }; const pk = e.coverArt || {}; const kind = E.valid(pk.kind) ? pk.kind : E.kindOf(e), tone = E.PASTELS[pk.tone] ? pk.tone : E.toneOf(e, kind);
        return `<span class="ch-thumb" style="--ch-bg:${E.PASTELS[tone]}">${E.drawing(kind, E.SPOT[tone])}</span>`; } catch {} }
    return `<span class="ch-thumb">${esc(initials(c.title))}</span>`; }
  // own bubbles: the host's accent when white text reads on it (4.5:1), else ember
  function accentFor(hex) { const kit = getComputedStyle(document.documentElement).getPropertyValue("--kit-accent").trim(); const a = /^#[0-9a-f]{6}$/i.test(kit) ? kit : hex;
    if (!/^#[0-9a-f]{6}$/i.test(a || "")) return "#29489A"; const L = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    return 1.05 / (L(a) + 0.05) >= 4.5 ? a : "#29489A"; }

  // ---- routing: /chats and /chats/<event> ----
  const route = { id: (/^\/chats\/([A-Za-z0-9_-]{1,80})/.exec(location.pathname) || [])[1] || "" };
  function go(id, push = true) { route.id = id || ""; if (push) history.pushState({ chat: route.id }, "", route.id ? "/chats/" + encodeURIComponent(route.id) : "/chats"); document.body.classList.toggle("ch-open", !!route.id); paintRows(); openThread(); }
  addEventListener("popstate", () => { const id = (/^\/chats\/([A-Za-z0-9_-]{1,80})/.exec(location.pathname) || [])[1] || ""; if (id !== route.id) go(id, false); });
  window.openChat = (id) => go(String(id || "")); // other code can open a chat in place

  // ---- the inbox ----
  let B = null, q = "";
  async function loadInbox() { try { B = await api("/api/chats", { proofs: proofs() }); } catch { B = B || { chats: [] }; } paintRows(); badge(); }
  function badge() { const n = (B?.chats || []).filter((c) => c.unread > 0).length; window.__plChatsUnread = n; document.title = (n ? `(${n}) ` : "") + "Chats · Pottery Lab"; $$("[data-chats-badge]").forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n); }); try { window.PLChatNav?.set?.(n); } catch {} }
  function rowHTML(c) { const cur = c.id === route.id ? ' aria-current="page"' : "", un = c.unread > 0;
    const last = c.locked ? `${G.lock}<span>${esc(c.lockedLine || "")}</span>` : c.last ? `<span>${c.last.system ? esc(c.last.text) : `${esc(c.last.by)}: ${esc(c.last.text)}`}</span>` : `<span>${c.role === "host" ? "Say hi to your guests" : "Say hi to the group"}</span>`;
    const faces = c.faces?.length ? `<span class="ch-faces">${c.faces.slice(0, 2).map((f) => av(f)).join("")}</span>` : "";
    return `<a class="ch-row${un ? " unread" : ""}${c.locked ? " locked" : ""}" href="/chats/${encodeURIComponent(c.id)}" data-id="${esc(c.id)}"${cur} aria-label="${esc(c.title)}${un ? `, ${c.unread} new` : ""}">${thumb(c).replace("</span>", faces + "</span>")}
      <span class="ch-rmain"><span class="ch-rtop"><span class="ch-rname">${esc(c.title)}</span><span class="ch-rtime ch-mono">${esc(c.at ? rel(c.at) : "")}</span></span>
      <span class="ch-rlast">${last}${c.muted ? G.mute.replace('class="ch-ic ', 'class="ch-ic ch-muted ') : ""}${un ? `<b class="ch-n">${c.unread > 99 ? "99+" : c.unread}</b>` : ""}</span>
      ${c.upcoming && c.when ? `<span class="ch-when">${c.role === "host" || c.role === "cohost" ? '<span class="ch-tag">Hosting</span> ' : ""}${esc(c.when)}</span>` : ""}</span></a>`; }
  function paintRows() { const box = $("#chRows"); if (!box || !B) return; const t = q.trim().toLowerCase();
    const L = (B.chats || []).filter((c) => !t || [c.title, c.last?.text, c.last?.by, ...(c.faces || []).map((f) => f.name)].join(" ").toLowerCase().includes(t));
    if (!(B.chats || []).length) { box.innerHTML = `<div class="ch-empty">${window.Potto ? window.Potto.svg("wave", 96, "Potto waving") : ""}<b>No chats yet</b><span>When you're in for an event, its group chat shows up here.</span><a class="ch-btn primary" href="/discover">Find something to do</a>${B.signedIn ? "" : `<a href="/login?next=/chats" style="color:var(--pl-accent-text);font-weight:600;min-height:44px;display:inline-flex;align-items:center">Have an account? Sign in</a>`}</div>`; return; }
    if (!L.length) { box.innerHTML = `<p class="ch-sec" style="justify-content:center">Nothing matches "${esc(q)}"</p>`; return; }
    const up = L.filter((c) => c.upcoming), past = L.filter((c) => !c.upcoming);
    box.innerHTML = (up.length ? `<h2 class="ch-sec">Upcoming</h2>${up.map(rowHTML).join("")}` : "") + (past.length ? `<h2 class="ch-sec">Past</h2>${past.map(rowHTML).join("")}` : "") +
      (B.signedIn ? "" : `<p class="ch-sec" style="font-weight:400;margin-top:20px">On another phone? <a href="/signup?mode=friends&amp;next=/chats" style="color:var(--pl-accent-text);font-weight:600">Make a free account</a> to see your chats anywhere.</p>`); }
  $("#chQ")?.addEventListener("input", (e) => { q = e.target.value; paintRows(); });
  document.addEventListener("click", (e) => { const a = e.target.closest?.(".ch-row[data-id]"); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(a.dataset.id); });

  // ---- the thread ----
  let T = null, V = "", pending = [], replyTo = null, firstPaint = true, unreadFrom = 0, timer = 0, delay = 3000, idle = 0, loading = false, openFor = "";
  const scroller = () => $("#chScroll");
  const atBottom = () => { const s = scroller(); return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 80; };
  let pinned = true; const ro = "ResizeObserver" in window ? new ResizeObserver(() => { if (pinned) toBottom(false); const j = $("#chJump"); if (j && atBottom()) j.hidden = true; }) : null;
  const toBottom = (smooth) => { const s = scroller(); if (s) s.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" }); };
  function stateView(title, line, c, actions = "") { $("#chThread").innerHTML = `${header(c, true)}<div class="ch-state">${c ? thumb(c) : ""}<b>${esc(title)}</b><span>${esc(line)}</span>${actions}</div>`; wireHeader(); }
  function header(c, bare) { const ev = c?.event || c || {}; return `<header class="ch-thead"><a class="ch-icon ch-back" href="/chats" aria-label="Back to chats" data-back>${G.back}</a>
      ${ev.title ? `<button type="button" class="ch-who" ${bare ? "disabled" : "data-det"} aria-label="Chat details">${thumb({ ...ev, art: ev.art })}<span style="min-width:0"><b>${esc(ev.title)}</b><small>${esc([ev.when, ev.inCount ? `${ev.inCount} in` : "", ev.cancelled ? "Cancelled" : ""].filter(Boolean).join(" · "))}</small></span></button>` : `<span style="flex:1"></span>`}
      ${bare || !ev.title ? "" : `<button type="button" class="ch-icon" data-det aria-label="Chat details">${G.info}</button>`}</header>`; }
  function wireHeader() { $$("[data-back]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (history.state?.chat !== undefined && history.length > 1 && document.referrer.includes("/chats")) history.back(); else go(""); })); $$("[data-det]").forEach((b) => (b.onclick = details)); }

  async function openThread() { clearTimeout(timer); const box = $("#chThread"); if (!box) return;
    if (!route.id) { T = null; openFor = ""; box.innerHTML = `<div class="ch-blank">${window.Potto ? window.Potto.svg("wave", 120, "Potto waving") : ""}<b style="font:600 20px var(--ch-display);color:var(--ch-ink)">Pick a chat</b><span>Every event you're in has one.</span></div>`; return; }
    if (openFor !== route.id) { openFor = route.id; pinned = true; T = null; V = ""; pending = []; replyTo = null; firstPaint = true; unreadFrom = 0; const c = (B?.chats || []).find((x) => x.id === route.id);
      box.innerHTML = `${header(c, true)}<div class="ch-body"><div class="ch-scroll"><div class="ch-msgs"><div class="ch-skel" style="width:60%"></div><div class="ch-skel" style="width:45%;align-self:flex-end"></div></div></div></div>`; wireHeader(); }
    delay = 3000; idle = 0; await poll(true); }
  async function poll(force) { clearTimeout(timer); if (!route.id || loading) return; if (document.hidden && !force) return schedule();
    // signed out with no reply on this phone: there's nothing to ask the server, so say how to get in (no failed request)
    if (!T && !qOf(route.id) && !/(?:^|;\s*)encore_in=1/.test(document.cookie)) { const id = route.id, c = (B?.chats || []).find((x) => x.id === id);
      return stateView("Not in the chat yet", "Reply to the invite, or sign in, and the chat opens here.", c, `<a class="ch-btn primary" href="/g#rsvp-${encodeURIComponent(id)}">Open the invite</a><a href="/login?next=${encodeURIComponent("/chats/" + id)}" style="color:#B04A30;font-weight:600">Sign in</a>`); }
    loading = true; const id = route.id;
    try { const read = !document.hidden && atBottom() ? "&read=1" : ""; const j = await api(`/api/chats/${encodeURIComponent(id)}?${qOf(id)}${read}${V && !force ? `&v=${V}` : ""}`); if (id !== route.id) return;
      if (j.proof) { ls.set("encore-rsvp-" + id, JSON.stringify(j.proof)); linkProof = null; }
      if (j.same) { idle++; patchLive(j); } else { idle = 0; const fresh = !T; T = j; V = j.v; if (fresh) unreadFrom = j.unreadFrom || 0; paint(); if (read && B) { const c = B.chats.find((x) => x.id === id); if (c && c.unread) { c.unread = 0; paintRows(); badge(); } } }
      delay = idle < 6 ? 3000 : idle < 20 ? 5000 : idle < 60 ? 8000 : 15000; }
    catch (err) { if (id !== route.id) return; if (!T) { const c = (B?.chats || []).find((x) => x.id === id);
        if (err.status === 404) stateView("This chat isn't here", "The event may have been deleted, or the link is cut off.", c, `<a class="ch-btn" href="/chats">See your chats</a>`);
        else if (err.status === 403) stateView(err.code === "not_member" ? "This chat is for guests who are in" : "Not in the chat yet", err.message, c, `<a class="ch-btn primary" href="/g#rsvp-${encodeURIComponent(id)}">Open the invite</a>${B?.signedIn ? "" : `<a href="/login?next=${encodeURIComponent("/chats/" + id)}" style="color:var(--pl-accent-text);font-weight:600">Sign in</a>`}`);
        else stateView("Couldn't open the chat", "Check your connection and try again.", c, `<button class="ch-btn" type="button" onclick="location.reload()">Try again</button>`); loading = false; return; }
      delay = Math.min(30000, delay * 2); }
    finally { loading = false; } schedule(); }
  function schedule() { clearTimeout(timer); if (route.id) timer = setTimeout(() => poll(), delay); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { delay = 3000; idle = 0; poll(true); loadInbox(); } });
  addEventListener("focus", () => { if (route.id) { idle = 0; poll(); } });

  const isHost = () => T?.me?.role === "host" || T?.me?.role === "cohost";
  const member = (who) => (T?.members || []).find((m) => m.who === who) || null;
  function msgHTML(m, grpMine) { const tools = T.me.canWrite && !m.removed ? `<div class="ch-tools">${T.me.canWrite ? `<button type="button" data-tool="react" aria-label="React">${G.smile}</button><button type="button" data-tool="reply" aria-label="Reply">${G.reply}</button>` : ""}<button type="button" data-tool="more" aria-label="More">${G.more}</button></div>` : "";
    const R = Object.entries(m.reactions || {}); const q = m.replyTo ? `<span class="ch-q" data-goto="${esc(m.replyTo.id)}"><b>${esc(m.replyTo.by)}</b>${esc(m.replyTo.text)}</span>` : "";
    const ph = m.photo ? `<button type="button" class="ch-ph" data-ph="${esc(m.photo.url)}" aria-label="Photo from ${esc(m.by || "you")}, open it"><img src="${esc(m.photo.url)}" alt="" loading="lazy" ${m.photo.w && m.photo.h ? `width="260" height="${Math.round((260 * m.photo.h) / m.photo.w)}"` : ""}></button>` : "";
    const body = m.removed ? `<div class="ch-b ch-gone">Message removed</div>` : m.text ? `<div class="ch-b${m.role === "host" && !grpMine ? " ch-host" : ""}${!q && emojiOnly(m.text) ? " ch-only" : ""}">${q}${linkify(esc(m.text))}</div>` : q ? `<div class="ch-b">${q}</div>` : "";
    const when = `<div class="ch-at ch-mono" hidden>${esc(m._pending ? "Sending" : clockOf(m.at))}</div>`;
    return `<div class="ch-m${m._pending ? " pending" : ""}${m._failed ? " failed" : ""}" data-id="${esc(m.id)}" tabindex="-1">${ph}${body}${R.length ? `<div class="ch-rx">${R.map(([e, r]) => `<button type="button" class="${r.mine ? "mine" : ""}" data-rx="${esc(e)}" aria-label="${esc(e)} ${r.n}${r.mine ? ", yours" : ""}">${e}${r.n > 1 ? `<span class="ch-mono">${r.n}</span>` : ""}</button>`).join("")}</div>` : ""}${m.pinned ? `<div class="ch-pinned-tag">${G.pin}Pinned</div>` : ""}${m._failed ? `<button type="button" class="ch-retry" data-retry="${esc(m.id)}">Didn't send. Tap to try again</button>` : ""}${when}${tools}</div>`; }
  function msgsHTML() { const L = [...T.messages, ...pending], out = []; let day = "", grp = null, lastAt = 0, newShown = !unreadFrom, joinRun = null; const many = (T.members || []).length > 2;
    const flush = () => { if (!grp) return; const p = grp.mine ? null : member(grp.who) || { name: grp.by, tint: "#F6D7A7" };
      out.push(`<div class="ch-grp${grp.mine ? " me" : ""}">${grp.mine ? "" : av(p)}<div class="ch-col">${!grp.mine && many ? `<div class="ch-name">${esc(grp.by)}${grp.role === "host" ? '<span class="ch-tag">Host</span>' : grp.role === "cohost" ? '<span class="ch-tag">Co-host</span>' : ""}</div>` : ""}${grp.items.map((m) => msgHTML(m, grp.mine)).join("")}</div></div>`); grp = null; };
    for (const m of L) { const dk = dayKey(m.at || now()); if (dk !== day) { flush(); day = dk; out.push(`<div class="ch-day">${esc(dayLabel(m.at || now()))}</div>`); lastAt = 0; }
      if (!newShown && m.at > unreadFrom && !m.mine && m.kind !== "system") { flush(); out.push(`<div class="ch-new" role="separator">New</div>`); newShown = true; }
      if (m.kind === "system") { flush(); if (m.sys === "joined" && joinRun && out[out.length - 1] === joinRun.html) { joinRun.names.push(m.text.replace(/ is in\.$/, "")); out.pop(); } else joinRun = m.sys === "joined" ? { names: [m.text.replace(/ is in\.$/, "")] } : null;
        if (joinRun) { const N = joinRun.names, line = N.length === 1 ? `${N[0]} is in.` : N.length <= 4 ? `${N.slice(0, -1).join(", ")} and ${N[N.length - 1]} are in.` : `${N.slice(0, 3).join(", ")} and ${N.length - 3} more are in.`; joinRun.html = `<div class="ch-sys">${esc(line)}</div>`; out.push(joinRun.html); } else out.push(`<div class="ch-sys">${esc(m.text)}</div>`); lastAt = m.at; continue; }
      joinRun = null;
      if (lastAt && m.at - lastAt > 30 * 60e3) { flush(); out.push(`<div class="ch-gap ch-mono">${esc(clockOf(m.at))}</div>`); }
      const who = m.mine ? "me" : m.who; if (!grp || grp.who !== who || m.at - grp.last > 5 * 60e3) { flush(); grp = { who, by: m.by, role: m.role, mine: !!m.mine, items: [], last: m.at }; }
      grp.items.push(m); grp.last = m.at; lastAt = m.at; }
    flush();
    const s = T.seen, lastMine = [...L].reverse().find((m) => m.kind !== "system"); if (s && s.n && lastMine && lastMine.id === s.id) out.push(`<div class="ch-seen">Seen by ${s.n <= 2 ? esc(s.names.join(" and ")) : s.n === 3 && s.names.length === 3 ? esc(`${s.names[0]}, ${s.names[1]} and ${s.names[2]}`) : `<span class="ch-mono">${s.n}</span>`}</div>`);
    if (T.typing?.length) out.push(`<div class="ch-typing">${av(member((T.members || []).find((x) => x.name === T.typing[0])?.who) || { name: T.typing[0] })}<span class="ch-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(T.typing.length === 1 ? `${T.typing[0]} is typing` : `${T.typing.join(" and ")} are typing`)}</span></div>`);
    if (!T.messages.filter((m) => m.kind !== "system").length && !pending.length) out.push(`<div class="ch-sys" style="margin:24px auto">${isHost() ? "Your guests are here. Say hi, share the plan, or pin what to bring." : `Say hi. ${esc(T.event.host)} and everyone who's in can see this.`}</div>`);
    return out.join(""); }
  function pinsHTML() { const P = (T.pins || []).filter((p) => !p.removed); if (!P.length) return ""; const p = P[P.length - 1];
    return `<button type="button" class="ch-pin" data-goto="${esc(p.id)}" aria-label="Pinned message, go to it">${G.pin}<span>${esc(p.kind === "photo" ? "Photo" : p.text)}</span>${P.length > 1 ? `<small class="ch-mono">${P.length}</small>` : ""}</button>`; }
  function composerHTML() { if (!T.me.canWrite) return `<div class="ch-ro">${esc(T.event.cancelled ? "This event was cancelled, so the chat is closed." : T.me.readOnly || "You can read this chat.")}${T.me.role === "guest" && !T.event.cancelled ? ` <a href="${esc(T.event.url)}">Open the invite</a>` : ""}</div>`;
    return `<form class="ch-comp" id="chComp" autocomplete="off">${replyTo ? `<div class="ch-replying"><div><b>Replying to ${esc(replyTo.mine ? "yourself" : replyTo.by)}</b><span>${esc(replyTo.kind === "photo" ? "Photo" : replyTo.text)}</span></div><button type="button" class="ch-icon" data-unreply aria-label="Cancel reply">${G.x}</button></div>` : ""}
      <div class="ch-hint" id="chHint" hidden></div>${!replyTo && !T.messages.some((m) => m.mine) && !pending.length ? `<div class="ch-quick" role="group" aria-label="Quick hellos">${(isHost() ? ["Hi all! So glad you're coming", "Here's the plan:", "What should everyone bring?"] : ["Hi everyone!", "Can't wait", "What should I bring?"]).map((t) => `<button type="button" data-quick="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
      <div class="ch-crow"><label class="ch-icon" aria-label="Send a photo" style="cursor:pointer">${G.photo}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" id="chFile" hidden></label>
      <div class="ch-field"><label class="ch-sr" for="chIn">Message</label><textarea id="chIn" rows="1" maxlength="1000" placeholder="Message" enterkeyhint="send"></textarea></div>
      <button class="ch-send" type="submit" id="chSend" aria-label="Send" disabled>${G.send}</button></div></form>`; }
  function paint() { const box = $("#chThread"); if (!box || !T) return; const keepDraft = $("#chIn")?.value || ls.get("pl.chatDraft." + route.id) || "", hadFocus = document.activeElement?.id === "chIn";
    document.documentElement.style.setProperty("--ch-accent", accentFor(T.event.accent));
    const stick = firstPaint || pinned, prev = scroller()?.scrollTop || 0, lastSeen = paint.last || 0, newOthers = !firstPaint && T.messages.some((m) => m.at > lastSeen && !m.mine && m.kind !== "system"); paint.last = Math.max(0, ...T.messages.map((m) => m.at || 0)); if (paint.for !== route.id) { paint.for = route.id; paint.last = Math.max(0, ...T.messages.map((m) => m.at || 0)); }
    if (!$("#chScroll") || box.dataset.for !== route.id) { box.dataset.for = route.id;
      box.innerHTML = `${header(T)}<div id="chPins">${pinsHTML()}</div><div class="ch-body"><div class="ch-scroll" id="chScroll" role="log" aria-live="polite" aria-relevant="additions"><div class="ch-msgs" id="chMsgs">${msgsHTML()}</div></div><button type="button" class="ch-jump round" id="chJump" hidden aria-label="Go to the latest">${G.down}<span>New messages</span></button></div><div id="chCompWrap">${composerHTML()}</div>`;
      wireHeader(); wireComposer(keepDraft); scroller().addEventListener("scroll", onScroll, { passive: true }); ro?.observe($("#chMsgs")); }
    else { $(".ch-thead").outerHTML = header(T); wireHeader(); $("#chPins").innerHTML = pinsHTML(); $("#chMsgs").innerHTML = msgsHTML(); const ro = !T.me.canWrite; if (ro !== !$("#chComp")) { $("#chCompWrap").innerHTML = composerHTML(); wireComposer(keepDraft); } }
    if (stick) { toBottom(false); if (firstPaint && unreadFrom) { const n = $(".ch-new"); if (n && n.offsetTop < scroller().scrollHeight - scroller().clientHeight - 40) n.scrollIntoView({ block: "center" }); } } else { scroller().scrollTop = prev; if (newOthers) { const j = $("#chJump"); j.hidden = false; j.classList.remove("round"); } }
    if (hadFocus) $("#chIn")?.focus({ preventScroll: true }); firstPaint = false; requestAnimationFrame(() => { const j = $("#chJump"); if (j && atBottom()) { j.hidden = true; j.classList.add("round"); pinned = true; } }); }
  function patchLive(j) { if (!T) return; const ch = JSON.stringify([T.typing, T.seen]) !== JSON.stringify([j.typing, j.seen]); T.typing = j.typing; T.seen = j.seen; if (ch) { const st = atBottom(); $("#chMsgs").innerHTML = msgsHTML(); if (st) toBottom(false); } }
  function onScroll() { const j = $("#chJump"), s = scroller(); pinned = atBottom(); if (!atBottom() && s && s.scrollHeight - s.scrollTop - s.clientHeight > s.clientHeight * 1.2 && j.hidden) { j.hidden = false; j.classList.add("round"); } if (atBottom()) { j.hidden = true; j.classList.add("round"); if (T && B?.chats?.find((c) => c.id === route.id)?.unread) api(`/api/chats/${encodeURIComponent(route.id)}/read`, bodyOf(route.id)).catch(() => {}); } }

  // ---- composing ----
  let typedAt = 0;
  function wireComposer(draft) { const f = $("#chComp"); if (!f) return; const ta = $("#chIn"), send = $("#chSend"), hint = $("#chHint");
    const size = () => { ta.style.height = "auto"; ta.style.height = Math.min(132, ta.scrollHeight) + "px"; };
    const check = () => { const t = ta.value; send.disabled = !t.trim(); ls.set("pl.chatDraft." + route.id, t);
      const contact = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(t) || /(?:\+?\d[\s().-]*){7,}\d/.test(t);
      hint.hidden = !contact; if (contact) hint.textContent = isHost() ? "Everyone in this chat will see this number or email." : "Numbers and emails are hidden in group chats. To swap details, ask the host.";
      if (t.trim() && now() - typedAt > 3000) { typedAt = now(); api(`/api/chats/${encodeURIComponent(route.id)}/typing`, bodyOf(route.id)).catch(() => {}); } };
    if (draft) { ta.value = draft; } size(); check();
    ta.addEventListener("input", () => { size(); check(); });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && fine) { e.preventDefault(); f.requestSubmit(); } });
    ta.addEventListener("focus", () => setTimeout(() => toBottom(true), 250));
    f.onsubmit = (e) => { e.preventDefault(); const t = ta.value.trim(); if (!t) return; $(".ch-quick", f)?.remove(); ta.value = ""; ls.set("pl.chatDraft." + route.id, ""); size(); check(); sendText(t); ta.focus({ preventScroll: true }); };
    $("[data-unreply]", f)?.addEventListener("click", () => { replyTo = null; $("#chCompWrap").innerHTML = composerHTML(); wireComposer(ta.value); $("#chIn").focus(); });
    $$("[data-quick]", f).forEach((b) => (b.onclick = () => { const t = b.dataset.quick; if (/:$/.test(t)) { ta.value = t + " "; size(); check(); ta.focus(); return; } $(".ch-quick", f)?.remove(); sendText(t); }));
    $("#chFile").onchange = (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) sendPhoto(file); }; }
  async function sendText(text, again) { const id = route.id, rt = replyTo; replyTo = null; const tmp = again || { id: "tmp" + now(), text, kind: "text", mine: true, at: now(), by: T.me.name, role: T.me.role, reactions: {}, _pending: true, ...(rt ? { replyTo: { id: rt.id, by: rt.by, text: rt.kind === "photo" ? "Photo" : rt.text } } : {}) };
    tmp._pending = true; tmp._failed = false; pinned = true; if (!again) pending.push(tmp); if (rt) { $("#chCompWrap").innerHTML = composerHTML(); wireComposer(""); }
    $("#chMsgs").innerHTML = msgsHTML(); toBottom(false);
    try { const j = await api(`/api/chats/${encodeURIComponent(id)}/messages`, bodyOf(id, { text, ...(tmp.replyTo ? { replyTo: tmp.replyTo.id } : {}) })); pending = pending.filter((p) => p !== tmp); if (id !== route.id) return; T.messages.push(j.message); V = ""; $("#chMsgs").innerHTML = msgsHTML(); toBottom(true); idle = 0; delay = 3000; schedule(); }
    catch (err) { tmp._pending = false; tmp._failed = true; tmp._err = err.message; if (id === route.id) { $("#chMsgs").innerHTML = msgsHTML(); toast(err.message); } } }
  async function shrink(file) { if (file.type === "image/gif" && file.size < 8e6) return { blob: file, type: "image/gif" }; try { const bmp = await createImageBitmap(file); const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(bmp, 0, 0, w, h); const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86)); return { blob, type: "image/jpeg", w, h }; } catch { return { blob: file, type: file.type || "image/jpeg" }; } }
  async function sendPhoto(file) { const id = route.id; if (!/^image\//.test(file.type || "image/")) { toast("Photos only."); return; } const url = URL.createObjectURL(file);
    const tmp = { id: "tmp" + now(), kind: "photo", photo: { url }, text: "", mine: true, at: now(), by: T.me.name, reactions: {}, _pending: true }; pending.push(tmp); $("#chMsgs").innerHTML = msgsHTML(); toBottom(true);
    try { const s = await shrink(file); const j = await api(`/api/chats/${encodeURIComponent(id)}/photo?${qOf(id)}${s.w ? `&w=${s.w}&h=${s.h}` : ""}`, s.blob, { type: s.type }); pending = pending.filter((p) => p !== tmp); if (id !== route.id) return; T.messages.push(j.message); V = ""; $("#chMsgs").innerHTML = msgsHTML(); toBottom(true); }
    catch (err) { pending = pending.filter((p) => p !== tmp); if (id === route.id) $("#chMsgs").innerHTML = msgsHTML(); toast(err.message); } }

  // ---- reactions, replies and the message menu (long-press on a phone, hover tools or right-click with a mouse) ----
  const msgOf = (id) => T?.messages.find((m) => m.id === id) || pending.find((m) => m.id === id) || (T?.pins || []).find((m) => m.id === id);
  async function react(m, e) { const on = !m.reactions?.[e]?.mine; try { const j = await api(`/api/chats/${encodeURIComponent(route.id)}/react`, bodyOf(route.id, { id: m.id, emoji: e, on })); Object.assign(m, { reactions: j.message.reactions }); V = ""; $("#chMsgs").innerHTML = msgsHTML(); try { navigator.vibrate?.(8); } catch {} } catch (err) { toast(err.message); } }
  function startReply(m) { replyTo = m; $("#chCompWrap").innerHTML = composerHTML(); wireComposer($("#chIn")?.value || ls.get("pl.chatDraft." + route.id) || ""); $("#chIn")?.focus(); }
  function sheet(html, onWire) { closeSheet(); const s = document.createElement("div"); s.className = "ch-scrim"; s.innerHTML = `<div class="ch-sheet" role="dialog" aria-modal="true"><div class="ch-grab" aria-hidden="true"></div>${html}</div>`; document.body.appendChild(s);
    const prevFocus = document.activeElement; s.addEventListener("click", (e) => { if (e.target === s) closeSheet(); }); const key = (e) => { if (e.key === "Escape") closeSheet(); }; document.addEventListener("keydown", key); s._done = () => { document.removeEventListener("keydown", key); try { prevFocus?.focus?.({ preventScroll: true }); } catch {} };
    onWire?.(s); setTimeout(() => s.querySelector("button,a,input")?.focus({ preventScroll: true }), 30); return s; }
  function closeSheet() { const s = $(".ch-scrim"); if (s) { s._done?.(); s.remove(); } }
  function menu(m, onlyReact) { if (!T || !m || m._pending) return; const mine = !!m.mine, host = isHost(), who = member(m.who), canBlock = !mine && who?.role === "guest" && !host;
    const acts = onlyReact ? "" : [T.me.canWrite && !m.removed ? `<button class="ch-act" data-a="reply">${G.reply}Reply</button>` : "", m.text && !m.removed ? `<button class="ch-act" data-a="copy">${G.copy}Copy</button>` : "",
      host && !m.removed ? `<button class="ch-act" data-a="pin">${G.pin}${m.pinned ? "Unpin" : "Pin for everyone"}</button>` : "", (mine || host) && !m.removed ? `<button class="ch-act warn" data-a="unsend">${G.trash}${mine ? "Unsend" : "Remove message"}</button>` : "",
      !mine ? `<button class="ch-act warn" data-a="report">${G.flag}Report</button>` : "", canBlock ? `<button class="ch-act warn" data-a="block">${G.block}Block ${esc(m.by)}</button>` : ""].join("");
    sheet(`${T.me.canWrite && !m.removed ? `<div class="ch-react" role="group" aria-label="React">${T.reactions.map((e) => `<button type="button" data-e="${e}" class="${m.reactions?.[e]?.mine ? "on" : ""}" aria-label="React ${e}">${e}</button>`).join("")}</div>` : ""}
      ${onlyReact ? "" : `<div class="ch-quote">${m.kind === "photo" ? "Photo" : esc(String(m.text || "").slice(0, 200))}</div><div class="ch-acts">${acts}</div>`}`, (s) => {
      $$("[data-e]", s).forEach((b) => (b.onclick = () => { closeSheet(); react(m, b.dataset.e); }));
      $$("[data-a]", s).forEach((b) => (b.onclick = async () => { const a = b.dataset.a; closeSheet();
        if (a === "reply") startReply(m);
        if (a === "copy") { try { await navigator.clipboard.writeText(m.text); toast("Copied."); } catch { toast("Couldn't copy."); } }
        if (a === "pin") { try { await api(`/api/chats/${encodeURIComponent(route.id)}/pin`, bodyOf(route.id, { id: m.id, on: !m.pinned })); toast(m.pinned ? "Unpinned." : "Pinned for everyone."); V = ""; poll(true); } catch (err) { toast(err.message); } }
        if (a === "unsend") { try { await api(`/api/chats/${encodeURIComponent(route.id)}/unsend`, bodyOf(route.id, { id: m.id })); V = ""; poll(true); } catch (err) { toast(err.message); } }
        if (a === "report") report(m);
        if (a === "block") { try { await api(`/api/chats/${encodeURIComponent(route.id)}/block`, bodyOf(route.id, { who: m.who })); toast(`Blocked. You won't see ${m.by}'s messages here.`); V = ""; poll(true); } catch (err) { toast(err.message); } } })); }); }
  function report(m) { const who = member(m.who);
    sheet(`<div class="ch-det"><h2>Report this message?</h2><p>${esc(T.event.host)} and the Pottery Lab team will see it. ${esc(m.by)} won't know it was you.</p>
      <div class="ch-acts">${["Spam", "Rude or unkind", "Makes me feel unsafe", "Something else"].map((r) => `<button class="ch-act" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>
      ${who?.role === "guest" ? `<label class="ch-tog"><span>Also block ${esc(m.by)}<small>You won't see their messages in this chat.</small></span><input type="checkbox" id="chAlsoBlock"></label>` : ""}</div>`, (s) => {
      $$("[data-r]", s).forEach((b) => (b.onclick = async () => { const block = !!$("#chAlsoBlock", s)?.checked; closeSheet(); try { await api(`/api/chats/${encodeURIComponent(route.id)}/report`, bodyOf(route.id, { id: m.id, reason: b.dataset.r, block })); toast("Thanks. We'll take a look."); if (block) { V = ""; poll(true); } } catch (err) { toast(err.message); } })); }); }
  // the chat's details: the event, who's in, mute, and the host's controls
  function details() { if (!T) return; const host = isHost(), M = T.members || [];
    sheet(`<div class="ch-det"><h2>${esc(T.event.title)}</h2><p>${esc([T.event.when, `${T.event.inCount} in`].filter(Boolean).join(" · "))}</p>
      <div class="ch-acts"><a class="ch-act" href="${esc(T.event.url)}">${G.open}Open the event</a>${T.me.role === "guest" ? `<a class="ch-act" href="/e/${encodeURIComponent(T.event.id)}.ics?${qOf(T.event.id)}">${G.cal}Add to calendar</a>` : ""}</div>
      <label class="ch-tog"><span>Mute this chat<small>No alerts or emails. It stays in your chats.</small></span><input type="checkbox" id="chMute" ${T.me.muted ? "checked" : ""}></label>
      ${host ? `<label class="ch-tog"><span>Guests who said Maybe can read it<small>They can't send until they're in.</small></span><input type="checkbox" id="chMaybe" ${T.me.maybeRead ? "checked" : ""}></label>` : ""}
      <h3><span class="ch-mono">${M.length}</span> in the chat</h3><div class="ch-ppl">${M.map((p) => `<div class="ch-p">${av(p)}<span>${esc(p.name)}${p.who === T.me.who ? "<small>You</small>" : p.role === "host" ? "<small>Host</small>" : p.role === "cohost" ? "<small>Co-host</small>" : p.readOnly ? "<small>Reading</small>" : ""}</span>${host && p.canRemove && p.who !== T.me.who ? `<button type="button" class="ch-btn" data-rm="${esc(p.who)}" data-n="${esc(p.name)}">Remove</button>` : ""}</div>`).join("")}</div>
      ${T.me.role === "guest" ? `<p style="margin:14px 0 0;font-size:13px;color:var(--ch-smoke)">You're ${esc(T.me.name)} here. Guests see first names only, never emails or numbers.</p>` : ""}</div>`, (s) => {
      $("#chMute", s).onchange = async (e) => { try { const j = await api(`/api/chats/${encodeURIComponent(route.id)}/mute`, bodyOf(route.id, { on: e.target.checked })); T.me.muted = j.muted; toast(j.muted ? "Muted. No alerts from this chat." : "Alerts are back on."); loadInbox(); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } };
      $("#chMaybe", s) && ($("#chMaybe", s).onchange = async (e) => { try { await api(`/api/chats/${encodeURIComponent(route.id)}/settings`, bodyOf(route.id, { maybeRead: e.target.checked })); T.me.maybeRead = e.target.checked; } catch (err) { toast(err.message); } });
      $$("[data-rm]", s).forEach((b) => (b.onclick = async () => { if (!confirm(`Take ${b.dataset.n} out of the chat? Their messages stay. They keep their spot.`)) return; try { await api(`/api/chats/${encodeURIComponent(route.id)}/remove`, bodyOf(route.id, { who: b.dataset.rm })); b.closest(".ch-p").remove(); toast(`${b.dataset.n} is out of the chat.`); V = ""; poll(true); } catch (err) { toast(err.message); } })); }); }

  // pointer and touch on messages
  let press = 0, pressXY = null;
  document.addEventListener("touchstart", (e) => { const m = e.target.closest?.(".ch-m"); if (!m || e.target.closest("a,.ch-rx,.ch-retry,.ch-q")) return; pressXY = [e.touches[0].clientX, e.touches[0].clientY]; clearTimeout(press); press = setTimeout(() => { press = 0; try { navigator.vibrate?.(10); } catch {} menu(msgOf(m.dataset.id)); }, 420); }, { passive: true });
  document.addEventListener("touchmove", (e) => { if (press && pressXY && Math.hypot(e.touches[0].clientX - pressXY[0], e.touches[0].clientY - pressXY[1]) > 8) { clearTimeout(press); press = 0; } }, { passive: true });
  document.addEventListener("touchend", () => { clearTimeout(press); press = 0; }, { passive: true });
  document.addEventListener("contextmenu", (e) => { const m = e.target.closest?.(".ch-m"); if (!m || e.target.closest("a")) return; e.preventDefault(); if (fine) menu(msgOf(m.dataset.id)); });
  // a double tap likes it, the way people expect
  let lastTap = 0; document.addEventListener("click", (e) => { const b = e.target.closest?.(".ch-b"); if (!b || e.target.closest("a,.ch-q")) return; const at = b.closest(".ch-m")?.querySelector(".ch-at"); if (at) at.hidden = !at.hidden; if (!T?.me?.canWrite) return; const t = now(); if (t - lastTap < 300) { if (at) at.hidden = true; const m = msgOf(b.closest(".ch-m")?.dataset.id); if (m && !m.reactions?.["❤️"]?.mine) react(m, "❤️"); lastTap = 0; } else lastTap = t; });
  document.addEventListener("click", (e) => {
    const tool = e.target.closest?.("[data-tool]"); if (tool) { const m = msgOf(tool.closest(".ch-m")?.dataset.id); if (tool.dataset.tool === "reply") startReply(m); else menu(m, tool.dataset.tool === "react"); return; }
    const rx = e.target.closest?.("[data-rx]"); if (rx) { const m = msgOf(rx.closest(".ch-m")?.dataset.id); if (m && T?.me?.canWrite) react(m, rx.dataset.rx); return; }
    const g = e.target.closest?.("[data-goto]"); if (g) { const el = $(`.ch-m[data-id="${CSS.escape(g.dataset.goto)}"]`); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("hl"); void el.offsetWidth; el.classList.add("hl"); } else toast("That message is further back."); return; }
    const ph = e.target.closest?.("[data-ph]"); if (ph) { const v = document.createElement("div"); v.className = "ch-viewer"; v.innerHTML = `<button type="button" class="ch-icon" aria-label="Close">${G.x}</button><img src="${esc(ph.dataset.ph)}" alt="">`; v.onclick = () => v.remove(); document.body.appendChild(v); v.querySelector("button").focus(); return; }
    const rt = e.target.closest?.("[data-retry]"); if (rt) { const m = pending.find((p) => p.id === rt.dataset.retry); if (m) sendText(m.text, m); return; }
    if (e.target.closest?.("#chJump")) { toBottom(true); } });

  // ---- the keyboard on iPhone: the app is as tall as what's visible, so the composer rides on top of the keyboard ----
  const vv = window.visualViewport;
  function fit() { if (wide()) { document.documentElement.style.removeProperty("--ch-h"); return; } const h = vv ? vv.height : innerHeight, kb = vv ? innerHeight - vv.height > 120 : false;
    const stick = atBottom(); document.documentElement.style.setProperty("--ch-h", Math.round(h) + "px"); document.body.classList.toggle("ch-kb", kb); if (vv && vv.offsetTop) window.scrollTo(0, 0); if (stick) toBottom(false); }
  vv?.addEventListener("resize", fit); vv?.addEventListener("scroll", fit); addEventListener("resize", fit);
  { const s = document.createElement("style"); s.textContent = "@media (max-width:860px){.ch-app{position:fixed;left:0;right:0;top:0}}"; document.head.appendChild(s); }

  // ---- start ----
  document.body.classList.toggle("ch-open", !!route.id); fit();
  loadInbox().then(() => { if (!route.id && wide() && B?.chats?.length) { const first = B.chats.find((c) => !c.locked); if (first) { route.id = first.id; history.replaceState({ chat: first.id }, "", "/chats/" + encodeURIComponent(first.id)); paintRows(); } } openThread(); });
  setInterval(() => { if (!document.hidden) loadInbox(); }, 12000);
})();
