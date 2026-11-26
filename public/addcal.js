// Add to calendar, one tap (Plans, a plan's page, Settings). window.PLAddCal.
// - urls(item): Google Calendar (a prefilled render link), Outlook (outlook.live.com compose deeplink) and the .ics link
//   (/plans/ics/<id>.ics, server/plans.js: the place the viewer may see, the event link, a reminder 2 hours before).
//   Apple / iPhone opens the .ics, which Calendar takes; in the app, public/native.js hands .ics links to the phone.
// - open(button, item): a small menu with those four.
// - sync(el): "Sync all my plans": your private webcal feed (Apple webcal://, Google "Add by URL", Outlook "Add from web").
//   With { settings: true } it also offers "Reset link" (the old link stops working).
(function () {
  if (window.PLAddCal) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ymd = (d) => String(d || "").replace(/-/g, "");
  const nextDay = (d) => new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
  const proofQ = (id) => { try { const v = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); return v?.rid && v?.code ? `?rid=${encodeURIComponent(v.rid)}&code=${encodeURIComponent(v.code)}` : ""; } catch { return ""; } };
  const link = (it) => location.origin + "/e/" + encodeURIComponent(it.eventId);
  /** The Google Calendar render link for an item: UTC times (and its zone as ctz), or whole days. Pure apart from location.origin. */
  function google(it, origin = location.origin) {
    const all = it.allDay || it.startMs == null, last = it.endDate || it.date;
    const dates = all ? `${ymd(it.date)}/${ymd(nextDay(last))}` : `${utc(it.startMs)}/${utc(it.endMs || it.startMs + 3 * 3600e3)}`;
    const q = new URLSearchParams({ action: "TEMPLATE", text: it.title || "", dates, details: origin + "/e/" + encodeURIComponent(it.eventId), location: it.place || "" }); if (it.tz && !all) q.set("ctz", it.tz);
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }
  /** The Outlook (outlook.live.com) compose deeplink. Pure apart from location.origin. */
  function outlook(it, origin = location.origin) {
    const all = it.allDay || it.startMs == null, last = it.endDate || it.date;
    const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: it.title || "", body: origin + "/e/" + encodeURIComponent(it.eventId), location: it.place || "",
      startdt: all ? it.date : new Date(it.startMs).toISOString(), enddt: all ? nextDay(last) : new Date(it.endMs || it.startMs + 3 * 3600e3).toISOString(), ...(all ? { allday: "true" } : {}) });
    return "https://outlook.live.com/calendar/0/deeplink/compose?" + q.toString();
  }
  const ics = (it, { itinerary = false } = {}) => { const q = proofQ(it.eventId); return `/plans/ics/${encodeURIComponent(it.eventId)}.ics${q}${itinerary ? (q ? "&" : "?") + "itinerary=1" : ""}`; };
  const urls = (it) => ({ google: google(it), outlook: outlook(it), ics: ics(it), itinerary: it.endDate && it.endDate > it.date ? ics(it, { itinerary: true }) : "" });

  const CSS = `.ac-menu{position:fixed;z-index:9500;background:var(--pl-surface);border:1.5px solid var(--pl-ink);border-radius:var(--pl-r-md,6px);padding:6px;display:grid;min-width:230px;max-width:calc(100vw - 32px)}
.ac-menu b{display:block;padding:8px 12px 4px;font:500 12px/1.2 var(--pl-font-mono);text-transform:uppercase;letter-spacing:.05em;color:var(--pl-soft)}
.ac-menu a{display:flex;align-items:center;min-height:44px;padding:0 12px;border-radius:4px;font:500 15px var(--pl-font-text);color:var(--pl-ink);text-decoration:none}
.ac-menu a:hover,.ac-menu a:focus-visible{background:var(--pl-accent-soft);outline:none}
@media (max-width:640px){.ac-menu{left:16px!important;right:16px!important;top:auto!important;bottom:calc(16px + env(safe-area-inset-bottom))!important;min-width:0}}
.ac-sync{border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-md,6px);background:var(--pl-surface);padding:12px 14px}
.ac-sync summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;min-height:44px;font:600 15px var(--pl-font-text);color:var(--pl-ink)}
.ac-sync summary::-webkit-details-marker{display:none}.ac-sync summary small{font:400 14px var(--pl-font-text);color:var(--pl-soft);margin-left:auto}
.ac-sync summary svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
.ac-sync p{margin:6px 0 10px;font:400 14px/1.45 var(--pl-font-text);color:var(--pl-soft)}
.ac-btns{display:flex;flex-wrap:wrap;gap:8px}
.ac-btns a,.ac-btns button{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong);background:var(--pl-page);color:var(--pl-ink);font:500 15px var(--pl-font-text);text-decoration:none;cursor:pointer}
.ac-btns a.pri{background:var(--pl-accent);border-color:var(--pl-accent);color:var(--pl-on-accent)}
.ac-url{display:flex;gap:8px;margin-top:10px}.ac-url input{flex:1;min-width:0;min-height:44px;padding:0 10px;border:1.5px solid var(--pl-line-strong);border-radius:var(--pl-r-sm,6px);background:var(--pl-page);font:400 13px var(--pl-font-mono);color:var(--pl-ink)}
.ac-msg{font:400 14px var(--pl-font-text);color:var(--pl-success)}`;
  const css = () => { if (document.getElementById("ac-css")) return; const s = document.createElement("style"); s.id = "ac-css"; s.textContent = CSS; document.head.appendChild(s); };
  let openMenu = null; const close = () => { if (openMenu) { openMenu.el.remove(); openMenu.btn?.setAttribute("aria-expanded", "false"); openMenu.btn?.focus?.(); openMenu = null; } };
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  addEventListener("click", (e) => { if (openMenu && !openMenu.el.contains(e.target) && e.target.closest("[data-addcal]") !== openMenu.btn) close(); }, true);
  /** The menu next to a button: Apple / iPhone, Google, Outlook, Download .ics (and the plan's days, for a trip). */
  function open(btn, it) { css(); const same = openMenu?.btn === btn; close(); if (same) return;
    const U = urls(it), el = document.createElement("div"); el.className = "ac-menu"; el.setAttribute("role", "menu");
    el.innerHTML = `<b>Add to calendar</b><a role="menuitem" href="${esc(U.ics)}">Apple or iPhone</a><a role="menuitem" href="${esc(U.google)}" target="_blank" rel="noopener">Google Calendar</a><a role="menuitem" href="${esc(U.outlook)}" target="_blank" rel="noopener">Outlook</a><a role="menuitem" href="${esc(U.ics)}" download="${esc((it.title || "plan").replace(/[^\w -]+/g, "").slice(0, 40) || "plan")}.ics">Download .ics</a>${U.itinerary ? `<a role="menuitem" href="${esc(U.itinerary)}">Every part of the plan</a>` : ""}`;
    document.body.appendChild(el); const r = btn.getBoundingClientRect(); el.style.top = Math.min(innerHeight - el.offsetHeight - 8, r.bottom + 6) + "px"; el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.right - el.offsetWidth)) + "px";
    el.addEventListener("click", (e) => { if (e.target.closest("a")) setTimeout(close, 50); }); btn.setAttribute("aria-expanded", "true"); openMenu = { el, btn }; el.querySelector("a")?.focus(); }

  /** "Sync all my plans": one private link your calendar app follows. */
  function sync(el, { settings = false, signedIn = /(?:^|;\s*)encore_in=1/.test(document.cookie) } = {}) { if (!el) return; css();
    const cal = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12v10.5H4zM4 8.5h12M7 3.5v3M13 3.5v3"/></svg>`;
    if (!signedIn) { el.innerHTML = `<details class="ac-sync"><summary>${cal}Sync all my plans<small>Sign in first</small></summary><p>New plans appear in your calendar automatically. Sign in to get your own link. Each plan also has its own Add to calendar.</p><div class="ac-btns"><a class="pri" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a></div></details>`; return; }
    el.innerHTML = `<details class="ac-sync"${settings ? " open" : ""}><summary>${cal}Sync all my plans<small>Apple, Google, Outlook</small></summary><p>New plans appear in your calendar automatically, and changes follow. The link is private to you: don't share it.</p>
      <div class="ac-btns"><a class="pri" href="#" data-s="apple">Apple Calendar</a><a href="#" data-s="google">Google Calendar</a><a href="#" data-s="outlook">Outlook</a></div>
      <div class="ac-url"><input readonly aria-label="Your calendar link" placeholder="Your link appears here"><button type="button" class="ac-copy" data-s="copy" style="min-height:44px;padding:0 14px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong);background:var(--pl-page);font:500 15px var(--pl-font-text);cursor:pointer">Copy</button></div>
      <p class="ac-hint" hidden></p>${settings ? `<div class="ac-btns" style="margin-top:10px"><button type="button" data-s="reset">Reset link</button><span class="ac-msg" role="status"></span></div>` : ""}</details>`;
    let F = null; const input = el.querySelector("input"), hint = el.querySelector(".ac-hint");
    const load = async (reset) => { try { const r = await fetch("/api/me/plans/feed" + (reset ? "/reset" : ""), { method: reset ? "POST" : "GET", credentials: "same-origin" }); if (r.ok) F = await r.json(); } catch {} if (F) input.value = F.https; return F; };
    el.querySelector("details").addEventListener("toggle", (e) => { if (e.target.open && !F) load(); }); if (settings) load();
    el.querySelectorAll("[data-s]").forEach((b) => b.onclick = async (e) => { e.preventDefault(); const f = F || await load(); if (!f) return; const s = b.dataset.s;
      if (s === "apple") location.href = f.webcal;
      else if (s === "google") { try { await navigator.clipboard.writeText(f.https); } catch {} hint.hidden = false; hint.textContent = "Link copied. In Google Calendar, choose Other calendars, then From URL, and paste it."; window.open("https://calendar.google.com/calendar/u/0/r/settings/addbyurl", "_blank", "noopener"); }
      else if (s === "outlook") window.open("https://outlook.live.com/calendar/0/addfromweb?" + new URLSearchParams({ url: f.https, name: "Pottery Lab plans" }), "_blank", "noopener");
      else if (s === "copy") { try { await navigator.clipboard.writeText(f.https); b.textContent = "Copied"; } catch { input.select(); } }
      else if (s === "reset") { if (!confirm("Make a new link? Calendars using the old one stop updating.")) return; await load(true); const m = el.querySelector(".ac-msg"); if (m) m.textContent = "New link made. Add it to your calendar again."; } }); }

  window.PLAddCal = { google, outlook, ics, urls, open, close, sync };
})();
