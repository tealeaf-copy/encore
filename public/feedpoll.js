// Availability polls in the feed (server/feedpoll.js): "When works for you?"
// - The card (FeedVisual.RENDER.poll): the same container, header and action row as every other feed card. The options
//   are full-width rows: the day and time, a quiet bar, small faces and a count. Tap every one that works; tap again
//   to undo. The tap shows at once and goes back if it didn't save. Signed out, a tap asks you to sign in.
// - The host's view of the same card: who picked what under each option, "Pick this date" (opens the new-event editor
//   filled in, public/canvas.js reads ?poll=...), and "Close poll". Once the event is saved the card reads
//   "It's on: <date>" and links to it.
// - The form (PLWhenPoll.compose, opened from the "+" sheet's "Ask when people are free" tile, public/composer.js, or from
//   /feed?ask=when): a question, what it's for, 2 to 5 times with quick picks for the next two weekends and the
//   coming weeknights, and an optional closing day.
// - /feed?poll=<id> (the card's Share link, and the Inbox notes) scrolls to that poll, or adds it on top when it
//   isn't in this person's feed.
// Loaded after public/feedvisual.js; it adds one renderer and leaves every other card alone.
(function () {
  if (window.PLWhenPoll) return;
  const FV = window.FeedVisual;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const signedIn = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const okColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const safeUrl = (u) => (/^\/[A-Za-z0-9@_\-./#?=&%]*$/.test(u || "") && !/^\/\//.test(u) ? u : "");
  const MIN = 2, MAX = 5, Q0 = "When works for you?";
  const CHECK = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10.5l3.2 3L15 7"/></svg>`;
  const XI = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
  const CAL = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m8.5 14.5 2.2 2.2 4.6-4.7"/></svg>`;

  // ---------- words ----------
  const dayOf = (d) => { const t = new Date(d + "T12:00:00"); return Number.isNaN(+t) ? "" : t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
  const timeOf = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return ""; const h = +m[1]; return `${h % 12 || 12}${m[2] === "00" ? "" : ":" + m[2]}${h < 12 ? "am" : "pm"}`; };
  const whenOf = (d, t) => [dayOf(d), timeOf(t)].filter(Boolean).join(" at ");
  const ago = (at) => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const STYLE = `
.fp-card .fp-q{margin:0 0 10px;color:var(--fb-ink)}.fp-card .fb-title.sm+.fp-q{margin-top:-2px;color:var(--fb-soft)}
.fp-on{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:10px 12px;border-radius:var(--pl-r-md,6px);background:var(--pl-page);font:600 16px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui);color:var(--fb-ink)}
.fp-on svg{flex:none;color:var(--fb-acc-text)}.fp-on a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.fp-opts{display:grid;gap:6px;margin:0;padding:0;list-style:none}
.fp-opt{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:10px;width:100%;min-height:52px;box-sizing:border-box;margin:0;padding:6px 12px;border:1px solid var(--fb-line);border-radius:var(--pl-r-md,6px);background:var(--fb-card);color:var(--fb-ink);font:400 15px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui);text-align:left;overflow:hidden;-webkit-tap-highlight-color:transparent}
button.fp-opt{cursor:pointer}button.fp-opt:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.fp-opt>*{position:relative}.fp-opt .fp-bar{position:absolute;inset:0 auto 0 0;width:var(--w,0%);background:var(--pl-page);transition:width .25s ease}
.fp-opt[aria-pressed=true],.fp-opt.fp-mine{border-color:var(--fb-acc)}.fp-opt[aria-pressed=true] .fp-bar,.fp-opt.fp-mine .fp-bar{background:color-mix(in srgb,var(--fb-acc) 12%,var(--fb-card))}
.fp-tick{display:grid;place-items:center;width:22px;height:22px;box-sizing:border-box;border:1.5px solid var(--pl-line-strong,#B9B2A3);border-radius:50%;color:transparent;background:var(--fb-card)}
.fp-opt[aria-pressed=true] .fp-tick,.fp-opt.fp-mine .fp-tick{border-color:var(--fb-acc);background:var(--fb-acc);color:var(--pl-on-accent,#fff)}
.fp-when{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;min-width:0}.fp-when b{font-weight:600;font-size:15px}.fp-when small{font-size:14px;color:var(--fb-soft)}
.fp-when em{font-style:normal;font-size:12px;font-weight:600;color:var(--fb-acc-text)}
.fp-who{display:inline-flex;align-items:center;gap:6px;justify-self:end;min-height:24px;font-size:13px;color:var(--fb-soft)}.fp-faces{display:inline-flex}.fp-faces .fb-f{width:22px;height:22px;font-size:10px;border-color:transparent}.fp-faces .fb-f+.fb-f{margin-left:-6px}
.fp-n{min-width:1ch;font-weight:600;font-variant-numeric:tabular-nums;color:var(--fb-ink)}
.fp-res{grid-template-columns:minmax(0,1fr) auto;row-gap:0;padding-bottom:0}.fp-res.fp-done{padding-bottom:6px}
.fp-names{align-self:center;min-width:0;font-size:13px;line-height:1.35;color:var(--fb-soft);overflow-wrap:anywhere}
.fp-pick{justify-self:end;display:inline-flex;align-items:center;min-height:44px;margin-right:-4px;padding:0 4px;border:0;background:none;color:var(--fb-acc-text);font:600 14px var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:underline;text-underline-offset:3px;cursor:pointer;white-space:nowrap}
.fp-card .fp-hint{margin:8px 0 0}.fp-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;margin:0 0 -4px}.fp-foot .fb-meta{margin:0}
.fp-quiet{flex:none;min-height:44px;margin-right:-4px;padding:0 4px;border:0;background:none;color:var(--fb-soft);font:500 13px var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.fp-card .fb-go{margin-top:10px}.fp-msg{min-height:0;margin:0;font-size:13px;color:var(--fb-acc-text)}.fp-msg:not(:empty){margin-top:6px}
.fp-flash{animation:fp-flash 1.6s ease-out 1}@keyframes fp-flash{from{box-shadow:0 0 0 3px var(--pl-focus,rgba(41,72,154,.3))}to{box-shadow:0 0 0 3px transparent}}
/* the form: a sheet in the house style, big type and pills */
.fp-scrim{position:fixed;inset:0;z-index:210;display:flex;align-items:flex-end;justify-content:center;background:rgba(31,26,23,.32);opacity:0;transition:opacity .2s}.fp-scrim.on{opacity:1}
.fp-sheet{width:100%;max-width:560px;max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border-radius:24px 24px 0 0;box-shadow:0 -8px 30px rgba(31,26,23,.14);transform:translateY(24px);transition:transform .24s cubic-bezier(.2,.7,.2,1);padding-bottom:env(safe-area-inset-bottom);font:16px/1.45 var(--pl-font-text,"IBM Plex Sans",system-ui)}
.fp-scrim.on .fp-sheet{transform:none}@media (min-width:700px){.fp-scrim{align-items:center}.fp-sheet{border-radius:24px}}
.fp-top{display:flex;justify-content:space-between;padding:8px 8px 0}.fp-top button{min-height:44px;padding:0 12px;border:0;border-radius:999px;background:none;color:var(--pl-soft,#444845);font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer}
.fp-form{overflow-y:auto;padding:0 20px 8px}.fp-h{margin:4px 0 14px;font:600 26px/1.15 var(--sys-title,var(--pl-font-text,"IBM Plex Sans",system-ui));letter-spacing:-.01em}
.fp-l{display:block;margin:0 0 6px;font:600 14px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui);color:var(--pl-ink,#1B1D1C)}.fp-l small{font-weight:400;color:var(--pl-soft,#444845)}
/* fields keep the kit's own edge, corners and focus ring (public/system.css); only the question is set larger */
html body .fp-sheet input.fp-in{display:block;width:100%;min-height:52px;box-sizing:border-box;margin:0 0 16px;padding:0 14px;color:var(--pl-ink,#1B1D1C);font:400 16px var(--pl-font-text,"IBM Plex Sans",system-ui)}
html body .fp-sheet input.fp-in.fp-big.fp-big.fp-big.fp-big{min-height:56px;font-size:20px!important;font-weight:600}
.fp-grp{margin:0 0 4px;font-size:13px;color:var(--pl-soft,#444845)}.fp-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.fp-chip{min-height:44px;padding:0 16px;border:1.5px solid var(--pl-line-strong,#B9B2A3);border-radius:999px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui);cursor:pointer;white-space:nowrap}
.fp-chip[aria-pressed=true]{background:var(--pl-ink,#1B1D1C);border-color:var(--pl-ink,#1B1D1C);color:var(--pl-page,#EFEBE2)}.fp-chip:disabled{opacity:.4;cursor:default}
.fp-chip:focus-visible,.fp-pill:focus-visible,.fp-x:focus-visible,.fp-add:focus-visible{outline:3px solid var(--pl-focus,rgba(41,72,154,.3));outline-offset:2px}
.fp-rows{display:grid;gap:8px;margin:4px 0 8px;padding:0;list-style:none}.fp-row{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) 44px;gap:8px;align-items:center}
html body .fp-sheet .fp-row input.fp-in{margin:0;padding:0 12px;min-height:48px;font-size:16px}
.fp-x{width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:50%;background:none;color:var(--pl-soft,#444845);cursor:pointer}
.fp-add{min-height:44px;margin:0 0 12px;padding:0;border:0;background:none;color:var(--pl-accent-text,var(--pl-accent,#29489A));font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:underline;text-underline-offset:3px;cursor:pointer}.fp-add[hidden]{display:none}
.fp-close{margin:0 0 4px}.fp-close summary{min-height:44px;display:flex;align-items:center;font:500 15px var(--pl-font-text,"IBM Plex Sans",system-ui);color:var(--pl-soft,#444845);cursor:pointer}.fp-close p{margin:-8px 0 12px;font-size:13px;color:var(--pl-soft,#444845)}
.fp-err{min-height:20px;margin:0;font-size:14px;color:var(--pl-accent-text,var(--pl-accent,#29489A))}
.fp-bot{display:flex;align-items:center;gap:12px;padding:10px 20px 14px;border-top:1px solid var(--pl-line,#DDD7CA)}.fp-bot small{flex:1;min-width:0;font-size:13px;line-height:1.35;color:var(--pl-soft,#444845)}
.fp-pill{flex:none;display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 28px;border:1.5px solid var(--pl-accent,#29489A);border-radius:999px;background:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff);font:600 17px/1.2 var(--pl-font-text,"IBM Plex Sans",system-ui);text-decoration:none;cursor:pointer;white-space:nowrap}
.fp-pill:disabled{opacity:.45;cursor:default}.fp-pill.quiet{background:transparent;color:var(--pl-ink,#1B1D1C);border-color:var(--pl-ink,#1B1D1C)}
.fp-say{padding:4px 20px 20px}.fp-say p{margin:0 0 16px;color:var(--pl-soft,#444845)}.fp-say .fp-pills{display:flex;flex-wrap:wrap;gap:10px}
@media (prefers-reduced-motion:reduce){.fp-scrim,.fp-sheet,.fp-opt .fp-bar{transition:none!important}.fp-flash{animation:none}}
`;
  const css = () => { if ($("#fpCss")) return; const s = document.createElement("style"); s.id = "fpCss"; s.textContent = STYLE; document.head.appendChild(s); };

  // ---------- the card ----------
  const POLLS = new Map(); // id -> the item as last drawn (kept up to date, so a redraw keeps a tap)
  const face = (f) => (FV?.social?.face ? FV.social.face(f) : "");
  const who = (o) => `<span class="fp-who">${o.count ? `<span class="fp-faces" aria-hidden="true">${(o.faces || []).slice(0, 3).map(face).join("")}</span>` : ""}<span class="fp-n">${o.count || ""}</span></span>`;
  const bar = (o, top) => `<i class="fp-bar" style="--w:${top ? Math.round((o.count / top) * 100) : 0}%" aria-hidden="true"></i>`;
  const pickUrl = (it, o) => `/?app=1&new=1&poll=${encodeURIComponent(it.id)}&popt=${encodeURIComponent(o.id)}${it.title ? "&ptitle=" + encodeURIComponent(it.title) : ""}&pdate=${encodeURIComponent(o.date)}${o.time ? "&ptime=" + encodeURIComponent(o.time) : ""}#studio`;
  const label = (o) => `${whenOf(o.date, o.time)}, ${o.count ? people(o.count) + " so far" : "no one yet"}`;
  function option(it, o, top) { const when = `<span class="fp-when"><b>${esc(dayOf(o.date))}</b>${o.time ? `<small>${esc(timeOf(o.time))}</small>` : ""}${it.event && it.picked === o.id ? `<em>Picked</em>` : it.mine && !it.event && o.count && o.count === top && it.options.filter((x) => x.count === top).length === 1 ? `<em>Most picked</em>` : ""}</span>`;
    // the host: who picked it, and the one tap that turns it into an event
    if (it.mine) { const names = (o.names || []).length ? o.names.slice(0, 6).join(", ") + (o.count > Math.min(6, o.names.length) ? ` and ${o.count - Math.min(6, o.names.length)} more` : "") : o.count ? people(o.count) : "No one yet";
      return `<li class="fp-opt fp-res${it.event ? " fp-done" : ""}${it.event && it.picked === o.id ? " fp-mine" : ""}">${bar(o, top)}${when}${who(o)}${it.event ? (o.count ? `<span class="fp-names">${esc(names)}</span>` : "") : `<span class="fp-names">${esc(names)}</span><a class="fp-pick" href="${esc(pickUrl(it, o))}" data-fp-pick="${esc(o.id)}" aria-label="Pick ${esc(whenOf(o.date, o.time))} and start the event">Pick this date</a>`}</li>`; }
    const tick = `<span class="fp-tick" aria-hidden="true">${CHECK}</span>`;
    if (!it.open) return `<li class="fp-opt${o.mine || (it.event && it.picked === o.id) ? " fp-mine" : ""}">${bar(o, top)}${tick}${when}${who(o)}</li>`;
    return `<li><button type="button" class="fp-opt" data-fp-vote="${esc(o.id)}" aria-pressed="${!!o.mine}" aria-label="${esc(label(o))}">${bar(o, top)}${tick}${when}${who(o)}</button></li>`; }
  function body(it) { const top = Math.max(0, ...it.options.map((o) => o.count)), ev = it.event, mineN = it.options.filter((o) => o.mine).length;
    const head = it.title ? `<h3 class="fb-title sm">${esc(it.title)}</h3><p class="fb-line fp-q">${esc(it.q)}</p>` : `<h3 class="fb-title sm">${esc(it.q)}</h3>`;
    const answered = it.voters ? `${people(it.voters)} answered` : "";
    const hint = ev ? answered : it.mine ? (it.open ? answered || "No answers yet. Share it to get things moving." : [answered, "Closed"].filter(Boolean).join(" · "))
      : it.open ? (mineN ? [`You picked ${mineN}`, "Tap again to undo"].join(" · ") : "Tap every time that works for you.") : [answered, "This poll is closed"].filter(Boolean).join(" · ");
    return `${head}${ev ? `<p class="fp-on">${CAL}<a href="${esc(safeUrl(ev.url) || "#")}">It's on: ${esc(whenOf(ev.date, ev.time))}</a></p>` : ""}
      <ul class="fp-opts" aria-label="Times to pick from">${it.options.map((o) => option(it, o, top)).join("")}</ul>
      ${it.mine && !ev ? `<div class="fp-foot"><p class="fb-meta">${esc(hint)}</p>${it.open ? `<button type="button" class="fp-quiet" data-fp-close>Close poll</button>` : `<button type="button" class="fp-quiet" data-fp-del>Take it down</button>`}</div>` : hint ? `<p class="fb-meta fp-hint">${esc(hint)}</p>` : ""}
      ${ev ? `<div class="fb-go"><a class="fb-cta" href="${esc(safeUrl(ev.url) || "#")}">${it.mine ? "Open the event" : "See the invite"}</a></div>` : ""}<p class="fp-msg" role="status" data-fp-msg></p>`; }
  function card(it) { css(); if (!it || !Array.isArray(it.options)) return ""; POLLS.set(it.id, it); const h = it.host || {}, page = safeUrl(h.page);
    const faceIn = `<span class="fb-ring" style="--ring:${esc(okColor(h.color) || "var(--pl-line)")}">${FV.avatar(h, 36)}</span><span><b>${esc(h.name || "A host")}</b><small>${it.mine ? "Your poll" : "Asked"} · ${esc(ago(it.at))}</small></span>`;
    return `<article class="fb-card fp-card" data-kind="poll" data-fp="${esc(it.id)}"><header class="fb-lead"${it.report ? ` data-report="${esc(JSON.stringify(it.report))}"` : ""}>${page ? `<a class="fb-host" href="${esc(page)}">${faceIn}</a>` : `<span class="fb-host">${faceIn}</span>`}</header>
      <div class="fb-body" data-fp-body>${body(it)}</div>${FV.actRow ? FV.actRow(it) : ""}</article>`; }
  const redraw = (it) => { POLLS.set(it.id, it); document.querySelectorAll(`[data-fp="${CSS.escape(it.id)}"] [data-fp-body]`).forEach((el) => { const f = document.activeElement?.closest?.("[data-fp-vote]")?.dataset.fpVote, inMe = el.contains(document.activeElement); el.innerHTML = body(it); if (inMe && f) el.querySelector(`[data-fp-vote="${CSS.escape(f)}"]`)?.focus({ preventScroll: true }); }); };
  const say = (id, t) => { const el = $(`[data-fp="${CSS.escape(id)}"] [data-fp-msg]`); if (el) el.textContent = t || ""; if (t) window.PLToast?.(t); };
  // a reason the server gave is shown as it is; anything else (no connection) gets our own plain words
  const fail = (j, d = "") => Object.assign(new Error(j?.message || d), { ours: !!(j?.message || d) }), why = (e, d) => (e?.ours && e.message) || d;
  const api = async (url, method = "GET", data) => { const r = await fetch(url, { method, credentials: "same-origin", headers: data ? { "Content-Type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined }), j = await r.json().catch(() => ({})); return { r, j }; };

  // one tap: shown at once, sent, and put back if it didn't save. Taps on one poll go out one after another.
  const queue = new Map();
  function tapVote(id, optId) { const it = POLLS.get(id); if (!it || !it.open) return;
    if (!signedIn()) return askSignIn(id);
    const was = JSON.parse(JSON.stringify(it)), o = it.options.find((x) => x.id === optId); if (!o) return; const on = !o.mine, had = it.options.some((x) => x.mine);
    o.mine = on; o.count = Math.max(0, o.count + (on ? 1 : -1)); const me = it.me || { i: "", c: "", me: 1 }; o.faces = on ? [me, ...(o.faces || []).filter((f) => !f.me)].slice(0, 4) : (o.faces || []).filter((f) => !f.me);
    const has = it.options.some((x) => x.mine); it.voters = Math.max(0, it.voters + (has && !had ? 1 : !has && had ? -1 : 0)); redraw(it);
    try { navigator.vibrate?.(8); } catch {}
    const run = async () => { try { const { r, j } = await api(`/api/feed/polls/${encodeURIComponent(id)}/vote`, "POST", { option: optId, on });
        if (r.status === 401) { redraw(was); return askSignIn(id); }
        if (r.status === 409 && j.poll) { redraw({ ...j.poll, me: it.me }); return say(id, j.message || "This poll is closed."); }
        if (!r.ok || !j.poll) throw fail(j);
        if (queue.get(id) === p) redraw({ ...j.poll, me: it.me }); }
      catch (e) { const cur = POLLS.get(id), c = cur?.options.find((x) => x.id === optId); // put this one tap back, keep any later ones
        if (c && c.mine === on) { c.mine = !on; c.count = Math.max(0, c.count + (on ? -1 : 1)); c.faces = on ? (c.faces || []).filter((f) => !f.me) : c.faces; const h2 = cur.options.some((x) => x.mine); cur.voters = was.voters + (h2 && !had ? 1 : !h2 && had ? -1 : 0); redraw(cur); }
        say(id, why(e, "That didn't save. Check your connection and tap again.")); } };
    const p = (queue.get(id) || Promise.resolve()).then(run); queue.set(id, p); }
  async function closePoll(id, b) { b.disabled = true; try { const { r, j } = await api(`/api/feed/polls/${encodeURIComponent(id)}/close`, "POST", {}); if (!r.ok || !j.poll) throw fail(j); redraw({ ...j.poll, me: POLLS.get(id)?.me }); window.PLToast?.("Poll closed. The answers stay."); } catch (e) { b.disabled = false; say(id, why(e, "That didn't save. Try again.")); } }
  async function delPoll(id, b) { b.disabled = true; try { const { r, j } = await api(`/api/feed/polls/${encodeURIComponent(id)}`, "DELETE"); if (!r.ok) throw fail(j); document.querySelectorAll(`[data-fp="${CSS.escape(id)}"]`).forEach((el) => el.remove()); POLLS.delete(id); window.PLToast?.("Poll taken down."); } catch (e) { b.disabled = false; say(id, why(e, "That didn't work. Try again.")); } }
  document.addEventListener("click", (e) => { const t = e.target.closest?.("[data-fp-vote],[data-fp-close],[data-fp-del]"); if (!t) return; const id = t.closest("[data-fp]")?.dataset.fp; if (!id) return;
    if (t.dataset.fpVote) return tapVote(id, t.dataset.fpVote); if (t.hasAttribute("data-fp-close")) return closePoll(id, t); delPoll(id, t); });

  // ---------- sheets ----------
  function sheet(inner, labelId) { css(); const sc = document.createElement("div"); sc.className = "fp-scrim"; const back = document.activeElement;
    sc.innerHTML = `<div class="fp-sheet" role="dialog" aria-modal="true" aria-labelledby="${labelId}">${inner}</div>`; document.body.appendChild(sc);
    const prev = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden"; requestAnimationFrame(() => sc.classList.add("on"));
    sc.close = () => { sc.classList.remove("on"); document.documentElement.style.overflow = prev; setTimeout(() => sc.remove(), RM() ? 0 : 200); try { back?.focus?.({ preventScroll: true }); } catch {} };
    sc.addEventListener("click", (e) => { if (e.target === sc || e.target.closest("[data-x]")) sc.close(); });
    sc.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); sc.close(); }
      if (e.key === "Tab") { const F = [...sc.querySelectorAll("button:not([disabled]),a[href],input,summary")].filter((x) => x.offsetParent); if (!F.length) return; const a = F[0], z = F[F.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } });
    return sc; }
  function askSignIn(id) { const next = "/feed" + (id ? "?poll=" + encodeURIComponent(id) : "");
    const sc = sheet(`<div class="fp-top"><button type="button" data-x>Not now</button></div><div class="fp-say"><h2 class="fp-h" id="fpSi">Sign in to say when you're free</h2><p>One tap per time that works. Your host sees who can make it.</p><div class="fp-pills"><a class="fp-pill" href="/login?next=${encodeURIComponent(next)}">Sign in</a><a class="fp-pill quiet" href="/signup?next=${encodeURIComponent(next)}">Make an account</a></div></div>`, "fpSi");
    sc.querySelector("a").focus(); return sc; }

  /** The quick picks: the next two weekends, and the coming five weeknights at 7pm. */
  function quickPicks(now = new Date()) { const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), ends = [], nights = [];
    for (let i = 1; i <= 21 && (ends.length < 4 || nights.length < 5); i++) { const d = new Date(t0); d.setDate(t0.getDate() + i); const wd = d.getDay(), date = isoLocal(d);
      if (wd === 0 || wd === 6) { if (ends.length < 4) ends.push({ date, time: "" }); } else if (nights.length < 5) nights.push({ date, time: "19:00" }); }
    return { ends, nights }; }

  function compose({ onPosted = null } = {}) {
    if (!signedIn()) return askSignIn("");
    const Q = quickPicks(), st = { opts: [] }, today = isoLocal(new Date()), maxDay = isoLocal(new Date(Date.now() + 365 * 864e5));
    const chip = (o) => `<button type="button" class="fp-chip" data-chip="${o.date}|${o.time}" aria-pressed="false">${esc(new Date(o.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}</button>`;
    const sc = sheet(`<div class="fp-top"><button type="button" data-x>Cancel</button></div>
      <div class="fp-form"><h2 class="fp-h" id="fpH">Ask when people are free</h2>
        <label class="fp-l" for="fpQ">Your question</label><input class="fp-in fp-big" id="fpQ" maxlength="80" value="${esc(Q0)}" autocomplete="off">
        <label class="fp-l" for="fpT">What's it for? <small>Optional</small></label><input class="fp-in" id="fpT" maxlength="60" placeholder="Dumpling night" autocomplete="off">
        <p class="fp-l" id="fpOl">Times to pick from <small>2 to 5. Tap a few, or add your own.</small></p>
        <p class="fp-grp">Weekends</p><div class="fp-chips" role="group" aria-label="Weekends">${Q.ends.map(chip).join("")}</div>
        <p class="fp-grp">Weeknights at 7pm</p><div class="fp-chips" role="group" aria-label="Weeknights at 7pm">${Q.nights.map(chip).join("")}</div>
        <ul class="fp-rows" aria-labelledby="fpOl" data-rows></ul>
        <button type="button" class="fp-add" data-add>Add a different day</button>
        <details class="fp-close"><summary>Set a closing day</summary><label class="fp-l" for="fpC">Stop taking answers after</label><input class="fp-in" type="date" id="fpC" min="${today}" max="${maxDay}"><p>Leave it empty and the poll closes once the last date has passed.</p></details>
        <p class="fp-err" role="status" data-err></p></div>
      <div class="fp-bot"><small data-aud>People who follow you see this in their feed.</small><button type="button" class="fp-pill" data-go disabled>Ask</button></div>`, "fpH");
    const q = (s) => sc.querySelector(s), err = (t) => (q("[data-err]").textContent = t || "");
    const full = () => st.opts.filter((o) => o.date).length, key = (o) => o.date + "|" + (o.time || "");
    const paint = () => { const rows = q("[data-rows]");
      rows.innerHTML = st.opts.map((o, i) => `<li class="fp-row"><input class="fp-in" type="date" data-d="${i}" value="${esc(o.date)}" min="${today}" max="${maxDay}" aria-label="Day, option ${i + 1}"><input class="fp-in" type="time" data-t="${i}" value="${esc(o.time)}" step="900" aria-label="Time, option ${i + 1} (optional)"><button type="button" class="fp-x" data-rm="${i}" aria-label="Remove ${esc(o.date ? whenOf(o.date, o.time) : "option " + (i + 1))}">${XI}</button></li>`).join("");
      const K = new Set(st.opts.map(key)); sc.querySelectorAll("[data-chip]").forEach((c) => { const on = K.has(c.dataset.chip); c.setAttribute("aria-pressed", String(on)); c.disabled = !on && st.opts.length >= MAX; });
      q("[data-add]").hidden = st.opts.length >= MAX; q("[data-go]").disabled = full() < MIN; };
    sc.addEventListener("click", (e) => { const c = e.target.closest("[data-chip]"), rm = e.target.closest("[data-rm]");
      if (c) { const [date, time] = c.dataset.chip.split("|"), i = st.opts.findIndex((o) => key(o) === c.dataset.chip); if (i >= 0) st.opts.splice(i, 1); else if (st.opts.length < MAX) st.opts.push({ date, time }); st.opts.sort((a, b) => (a.date || "9").localeCompare(b.date || "9") || (a.time || "99").localeCompare(b.time || "99")); err(""); paint(); }
      else if (rm) { st.opts.splice(+rm.dataset.rm, 1); err(""); paint(); q("[data-add]").focus(); }
      else if (e.target.closest("[data-add]")) { if (st.opts.length < MAX) { st.opts.push({ date: "", time: "" }); paint(); const L = sc.querySelectorAll("[data-d]"); L[L.length - 1]?.focus(); } } });
    sc.addEventListener("change", (e) => { const d = e.target.dataset?.d, t = e.target.dataset?.t; if (d != null) st.opts[+d].date = e.target.value; else if (t != null) st.opts[+t].time = e.target.value; else return; err("");
      const K = new Set(st.opts.map(key)); sc.querySelectorAll("[data-chip]").forEach((c) => { const on = K.has(c.dataset.chip); c.setAttribute("aria-pressed", String(on)); c.disabled = !on && st.opts.length >= MAX; }); q("[data-go]").disabled = full() < MIN; });
    q("[data-go]").onclick = async () => { const b = q("[data-go]"), options = st.opts.filter((o) => o.date).map((o) => ({ date: o.date, time: o.time || "" }));
      if (new Set(options.map(key)).size < MIN) return err("Add two or more different times.");
      b.disabled = true; err("");
      try { const { r, j } = await api("/api/feed/polls", "POST", { q: q("#fpQ").value.trim() || Q0, title: q("#fpT").value.trim(), options, closes: q("#fpC").value || "" });
        if (!r.ok || !j.poll) throw fail(j, "That didn't post. Try again.");
        sc.close(); window.PLToast?.("Asked. It's in your followers' feeds."); if (onPosted) onPosted(j.poll); else show(j.poll, true); }
      catch (e) { err(why(e, "That didn't post. Check your connection and try again.")); b.disabled = false; } };
    paint(); setTimeout(() => q("#fpT").focus({ preventScroll: true }), RM() ? 0 : 80);
    return sc; }

  // ---------- /feed?poll=<id> and /feed?ask=when ----------
  /** Put a poll on top of the stream (or scroll to it when it is already there). */
  function show(it, flash) { const st = $(".fb-stream"); if (!st || !it) return false; let el = st.querySelector(`[data-fp="${CSS.escape(it.id)}"]`);
    if (!el) { st.insertAdjacentHTML("afterbegin", card(it)); el = st.firstElementChild; try { FV.wire(el); } catch {} }
    if (flash) { el.scrollIntoView({ block: "center", behavior: RM() ? "auto" : "smooth" }); el.classList.add("fp-flash"); }
    return true; }
  let want = "", got = null, asked = false;
  try { const u = new URL(location.href), id = u.searchParams.get("poll") || ""; if (/^[a-f0-9]{24}$/.test(id)) want = id;
    if (u.searchParams.get("ask") === "when") { asked = true; u.searchParams.delete("ask"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } } catch {}
  async function land() { if (!want) return; const id = want;
    if (!got) { got = api(`/api/feed/polls/${encodeURIComponent(id)}`).then(({ r, j }) => (r.ok ? j.poll : null)).catch(() => null); }
    const it = await got; if (!it) { if (want) { want = ""; window.PLToast?.("That poll isn't here any more."); } return; }
    if (show(POLLS.get(id) || it, true)) want = ""; }
  function start() { if (asked) { asked = false; setTimeout(() => compose({}), 300); }
    if (!want) return; land(); const mo = new MutationObserver(() => { if (!want) return mo.disconnect(); if ($(".fb-stream")) land(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 20000); }
  if (FV?.RENDER && !FV.RENDER.poll) FV.RENDER.poll = card;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.PLWhenPoll = { compose, card, show, quickPicks, _polls: POLLS };
})();
