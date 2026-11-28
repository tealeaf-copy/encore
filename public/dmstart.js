// Starting a direct message from anywhere outside Chats (server/dm.js). Loaded the first time it's needed:
// public/chatnav.js fetches this file when someone taps an element with data-dm, or a share sheet calls for it.
//
//   <button data-dm data-dm-handle="maya">Message</button>          a host, by their page
//   <button data-dm data-dm-key="<friend key>">Message</button>     a friend or follower row
//   <button data-dm data-dm-event="ev1" data-dm-pkey="…">           a guest card on Who's coming
//   PLDMStart.share({ type: "event" | "drop" | "host" | "story", id, title })   "Send in a message" from a share sheet
//
// Message opens the conversation in Chats (/chats/dm/<id>). If the two of you have no tie yet, the first message goes
// as a request and the thread says so before anything is sent. Signed out: sign in first, then come back here.
(function () {
  if (window.PLDMStart) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  async function api(path, body) { const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch {} if (!r.ok) { const e = new Error(j.message || "That didn't go through. Try again."); e.status = r.status; e.code = j.code; e.link = j.link; throw e; } return j; }
  const css = document.createElement("style"); css.textContent = `.dms-bg{position:fixed;inset:0;z-index:2147483600;background:rgba(31,26,23,.36);display:flex;align-items:flex-end;justify-content:center}
.dms{width:min(480px,100%);max-height:min(86dvh,640px);display:flex;flex-direction:column;background:var(--pl-surface,#fff);color:var(--pl-ink,#1F1A17);border-radius:6px 6px 0 0;padding:14px 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;font:400 16px/1.4 "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 18px 48px -18px rgba(31,26,23,.45)}
@media (min-width:861px){.dms-bg{align-items:center}.dms{border-radius:6px;padding-bottom:16px}}
.dms-h{display:flex;align-items:center;gap:8px}.dms-h h2{flex:1;min-width:0;margin:0;font:600 20px/1.2 "IBM Plex Sans",system-ui,sans-serif}.dms-h h2:focus{outline:none}
.dms-x{flex:none;width:44px;height:44px;border:0;background:none;border-radius:6px;color:var(--pl-soft,#6B5E54);cursor:pointer;display:grid;place-items:center}
.dms p{margin:4px 0 10px;font-size:14px;color:var(--pl-soft,#6B5E54)}
.dms-q{display:block;width:100%;height:44px;box-sizing:border-box;padding:0 12px;border:1.5px solid var(--pl-line-strong,#CFC4B4);border-radius:6px;background:var(--pl-surface,#fff);font:400 16px "IBM Plex Sans",system-ui,sans-serif;color:inherit}
.dms-l{overflow-y:auto;overscroll-behavior:contain;margin-top:8px;min-height:120px}
.dms-p{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:4px 6px;border:0;background:none;border-radius:6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dms-p>span:not(.dms-a){min-width:0;flex:1;overflow-wrap:anywhere;font-weight:500}.dms-p small{display:block;font-weight:400;font-size:13px;color:var(--pl-soft,#6B5E54)}
.dms-a{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font:600 14px "IBM Plex Sans",system-ui,sans-serif;overflow:hidden}.dms-a img{width:100%;height:100%;object-fit:cover}
@media (hover:hover){.dms-p:hover{background:#F6EFE7}}.dms-p:focus-visible,.dms-x:focus-visible,.dms-q:focus-visible{outline:2px solid var(--pl-ink,#1F1A17);outline-offset:2px}
.dms-t{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));z-index:2147483640;max-width:min(90vw,420px);box-sizing:border-box;background:var(--pl-ink,#1F1A17);color:#fff;border-radius:6px;padding:10px 14px;font:400 14px/1.4 "IBM Plex Sans",system-ui,sans-serif;display:flex;gap:12px;align-items:center}
.dms-t a{color:#fff;font-weight:600;white-space:nowrap;min-height:32px;display:inline-flex;align-items:center}`; document.head.appendChild(css);
  function toast(text, link, label) { document.querySelector(".dms-t")?.remove(); const d = document.createElement("div"); d.className = "dms-t"; d.setAttribute("role", "status"); d.innerHTML = `<span>${esc(text)}</span>${link ? `<a href="${esc(link)}">${esc(label || "Open")}</a>` : ""}`; document.body.appendChild(d); setTimeout(() => d.remove(), link ? 6000 : 3200); }
  const loginFirst = () => { location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search + location.hash); };

  /** Open the conversation with whoever this element names. */
  async function go(el) { if (!signed()) return loginFirst(); const d = el.dataset || {}, body = d.dmHandle ? { handle: d.dmHandle } : d.dmKey ? { key: d.dmKey } : d.dmEvent && d.dmPkey ? { eventId: d.dmEvent, pkey: d.dmPkey } : d.dmStory ? { story: d.dmStory } : null; if (!body || el.dataset.dmBusy) return;
    el.dataset.dmBusy = "1"; el.setAttribute("aria-busy", "true");
    try { const j = await api("/api/dm/open", body); location.href = j.url; }
    catch (e) { if (e.status === 401) return loginFirst(); toast(e.message, e.link, e.code === "use_booking" ? "Bookings" : ""); }
    finally { delete el.dataset.dmBusy; el.removeAttribute("aria-busy"); } }

  /** "Send in a message": pick someone you already talk to or may write to, and the thing goes to them as a card. */
  function share(card, { onClose = null } = {}) { if (!signed()) return loginFirst(); if (!card?.type || !card.id) return; document.querySelector(".dms-bg")?.remove(); const back = document.activeElement;
    const bg = document.createElement("div"); bg.className = "dms-bg";
    bg.innerHTML = `<div class="dms" role="dialog" aria-modal="true" aria-labelledby="dmsH"><div class="dms-h"><h2 id="dmsH" tabindex="-1">Send in a message</h2><button type="button" class="dms-x" aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <p>${card.title ? `${esc(card.title)} goes as a card they can tap.` : "It goes as a card they can tap."}</p><label><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Search people</span><input class="dms-q" type="search" placeholder="Search by name" autocomplete="off" enterkeyhint="search"></label><div class="dms-l" aria-live="polite"></div></div>`;
    document.body.appendChild(bg); const close = () => { bg.remove(); document.removeEventListener("keydown", key, true); try { onClose?.(); } catch {} try { back?.focus?.({ preventScroll: true }); } catch {} }, key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", key, true); bg.onclick = (e) => { if (e.target === bg) close(); }; bg.querySelector(".dms-x").onclick = close; setTimeout(() => bg.querySelector("h2").focus({ preventScroll: true }), 30);
    const L = bg.querySelector(".dms-l"), Q = bg.querySelector(".dms-q"); let t = 0;
    const face = (p) => (p.avatar?.url ? `<span class="dms-a"><img src="${esc(p.avatar.url)}" alt=""></span>` : `<span class="dms-a" style="background:${esc(p.tint || "#F6D7A7")}" aria-hidden="true">${esc(String(p.name || "?").trim()[0]?.toUpperCase() || "?")}</span>`);
    const draw = async () => { const q = Q.value.trim(); let j; try { j = await api("/api/dm/people?q=" + encodeURIComponent(q)); } catch (e) { L.innerHTML = `<p>${esc(e.message)}</p>`; return; } if (!bg.isConnected || Q.value.trim() !== q) return;
      L.innerHTML = j.people.length ? j.people.map((p) => `<button type="button" class="dms-p" data-pid="${esc(p.pid)}">${face(p)}<span>${esc(p.name)}<small>${esc(p.why || "")}</small></span></button>`).join("") : `<p>${q ? "Nobody you can message by that name yet." : "Nobody to send to yet. Friends and people from your events show here."}</p>`;
      L.querySelectorAll("[data-pid]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await api("/api/dm/share", { to: { pid: b.dataset.pid }, card: { type: card.type, id: card.id } }); close(); toast(`Sent to ${r.name}.`, r.url, "Open chat"); } catch (e) { b.disabled = false; toast(e.message); } })); };
    Q.oninput = () => { clearTimeout(t); t = setTimeout(draw, 220); }; draw(); }

  window.PLDMStart = { go, share, toast };
})();
