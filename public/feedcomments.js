// ---- comments under a feed card: one light sheet, no page change ----
// Opened from the feed (public/feedvisual.js) by a card's Comment button or "View all N comments". A bottom sheet on
// phones, a small dialog on wider screens: the thread, one text box, and a link to the group chat when you're in it.
// Anyone who can see the card can read; writing needs a sign-in. Your own comments (and, for a host, any comment on
// their post) can be deleted; everyone else's carry Report and Block (public/safety.js, data-report).
// Rules live in server/feedcomments.js. window.PLComments.open({ target, signedIn, focus, opener, onChange, onClose }).
(function () {
  if (window.PLComments) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const RM = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const okColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const ago = (t) => { const s = Math.max(0, (Date.now() - (t || 0)) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : s < 7 * 86400 ? `${Math.round(s / 86400)}d` : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const X_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>`;
  let cssOn = false;
  function css() { if (cssOn) return; cssOn = true; const s = document.createElement("style"); s.id = "fcmCss"; s.textContent = `
.fcm-bg{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-end;justify-content:center;background:rgba(27,29,28,.42);color-scheme:light}
.fcm{display:flex;flex-direction:column;width:100%;max-width:560px;max-height:min(82dvh,720px);box-sizing:border-box;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);border-top:1.5px solid var(--pl-frame,var(--pl-ink,#1B1D1C));border-radius:var(--pl-r-lg,6px) var(--pl-r-lg,6px) 0 0;box-shadow:0 -18px 48px -24px rgba(27,29,28,.45);font:16px/1.45 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);outline:0}
.fcm.fcm-rise{animation:fcm-up .22s cubic-bezier(.2,.8,.2,1)}@keyframes fcm-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
.fcm-grab{flex:none;width:36px;height:4px;margin:8px auto 0;border-radius:999px;background:var(--pl-line,#CFC8B9)}
.fcm-h{flex:none;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 16px;border-bottom:1px solid var(--pl-line,#CFC8B9)}
.fcm-h div{flex:1;min-width:0}.fcm-h h2{margin:0;font:600 17px/1.3 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);letter-spacing:0}
.fcm-h p{margin:0;font-size:13px;line-height:1.35;color:var(--pl-soft,#444845);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fcm-x{flex:none;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:999px;background:none;color:var(--pl-soft,#444845);cursor:pointer}.fcm-x svg{width:20px;height:20px}.fcm-x:hover{background:var(--pl-raised,#E6E1D5);color:var(--pl-ink,#1B1D1C)}
.fcm-chat{flex:none;display:flex;align-items:center;min-height:44px;padding:0 16px;border-bottom:1px solid var(--pl-line,#CFC8B9);color:var(--pl-accent-text,#29489A);font-size:14px;font-weight:600;text-decoration:none}.fcm-chat:hover{text-decoration:underline;text-underline-offset:3px}
.fcm-chat[hidden],.fcm-f[hidden]{display:none}
.fcm-list{flex:1 1 auto;min-height:96px;margin:0;padding:4px 16px;list-style:none;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.fcm-c{position:relative;display:flex;gap:10px;padding:12px 0}.fcm-c+.fcm-c{border-top:1px solid var(--pl-line,#CFC8B9)}
.fcm-av{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:color-mix(in srgb,var(--c,#D9CCBB) 32%,var(--pl-surface,#FAF8F3));color:var(--pl-ink,#1B1D1C);font:600 14px/1 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.fcm-b{flex:1;min-width:0}.fcm-who{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 8px;margin:0;padding-right:40px;font-size:14px;line-height:1.35}.fcm-who b{font-weight:600}
.fcm-tag{font-size:12px;font-weight:600;color:var(--pl-accent-text,#29489A)}.fcm-at{font:400 12px/1.35 var(--sys-mono,ui-monospace,monospace);color:var(--pl-soft,#444845);font-variant-numeric:tabular-nums}
.fcm-t{margin:2px 0 0;font-size:15px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.fcm-del{display:inline-flex;align-items:center;min-height:44px;margin:-6px 0 -12px -8px;padding:0 8px;border:0;background:none;color:var(--pl-soft,#444845);font:500 13px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer;border-radius:6px}.fcm-del:hover{color:var(--pl-ink,#1B1D1C);text-decoration:underline;text-underline-offset:3px}.fcm-del.sure{color:var(--pl-accent-text,#29489A);font-weight:600}
.fcm-c .sf-more{top:6px;right:-6px;width:36px;height:36px;background:transparent;border-color:transparent;color:var(--pl-soft,#444845)}.fcm-c .sf-more:hover{border-color:var(--pl-line-strong,#1B1D1C)}
.fcm-empty,.fcm-wait{margin:0;padding:28px 0;text-align:center;font-size:15px;color:var(--pl-soft,#444845)}
.fcm-f{flex:none;display:flex;align-items:flex-end;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px)) 16px;border-top:1px solid var(--pl-line,#CFC8B9);background:var(--pl-surface,#FAF8F3)}
.fcm-f textarea{flex:1;min-width:0;min-height:44px;max-height:120px;box-sizing:border-box;resize:none;padding:10px 14px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:var(--pl-r-md,6px);background:#fff;color:var(--pl-ink,#1B1D1C);font:16px/1.4 var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif)}
.fcm-f textarea:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:1px;border-color:var(--pl-accent,#29489A)}
.fcm-send{flex:none;min-height:44px;padding:0 18px;border:0;border-radius:var(--pl-r-btn,6px);background:var(--pl-accent,#29489A);color:var(--pl-on-accent,#fff);font:600 15px var(--pl-font-text,"IBM Plex Sans",system-ui,sans-serif);cursor:pointer}.fcm-send:hover{background:var(--pl-accent-press,#1F3878)}.fcm-send[disabled]{opacity:.55;cursor:default}
.fcm-meta{flex:none;display:flex;justify-content:space-between;gap:12px;margin:0;padding:0 16px;font-size:13px;line-height:1.4;color:var(--pl-soft,#444845)}.fcm-meta:empty{display:none}.fcm-meta span:empty{display:none}.fcm-err{color:var(--pl-accent-text,#29489A);font-weight:600;padding:8px 0 0}.fcm-n{margin-left:auto;padding:8px 0 0;font-family:var(--sys-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums}
.fcm-in{flex:1;display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:var(--pl-r-btn,6px);border:1.5px solid var(--pl-line-strong,#1B1D1C);color:var(--pl-ink,#1B1D1C);font-weight:600;font-size:15px;text-decoration:none}.fcm-in:hover{border-color:var(--pl-ink,#1B1D1C)}
.fcm-x:focus-visible,.fcm-del:focus-visible,.fcm-send:focus-visible,.fcm-in:focus-visible,.fcm-chat:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
@media (min-width:640px){.fcm-bg{align-items:center;padding:24px}.fcm{max-width:480px;max-height:min(72vh,640px);border:1.5px solid var(--pl-frame,var(--pl-ink,#1B1D1C));border-radius:var(--pl-r-lg,6px)}.fcm-grab{display:none}.fcm-h{padding-top:8px}.fcm-f{padding-bottom:12px;border-radius:0 0 var(--pl-r-lg,6px) var(--pl-r-lg,6px)}}
@media (prefers-reduced-motion:reduce){.fcm.fcm-rise{animation:none}}
`; document.head.appendChild(s); }

  let current = null;
  /** Open the thread for one card. */
  function open({ target, signedIn = false, focus = false, opener = null, onChange = null, onClose = null } = {}) {
    if (!target) return; if (current) current.close(); css();
    const bg = document.createElement("div"); bg.className = "fcm-bg";
    bg.innerHTML = `<div class="fcm${RM() ? "" : " fcm-rise"}" role="dialog" aria-modal="true" aria-labelledby="fcmH" tabindex="-1"><span class="fcm-grab" aria-hidden="true"></span>
      <header class="fcm-h"><div><h2 id="fcmH">Comments</h2><p id="fcmSub"></p></div><button type="button" class="fcm-x" aria-label="Close comments">${X_ICON}</button></header>
      <a class="fcm-chat" hidden>Open the group chat</a>
      <ul class="fcm-list" aria-live="polite" tabindex="0" aria-label="Comments"><li class="fcm-wait">One moment.</li></ul>
      <p class="fcm-meta"><span class="fcm-err" role="alert"></span><span class="fcm-n" aria-hidden="true"></span></p>
      ${signedIn ? `<form class="fcm-f"><textarea rows="1" maxlength="500" placeholder="Add a comment" aria-label="Add a comment" enterkeyhint="send"></textarea><button class="fcm-send" type="submit" disabled>Send</button></form>` : `<div class="fcm-f"><a class="fcm-in" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in to comment</a></div>`}</div>`;
    const box = bg.firstChild, list = box.querySelector(".fcm-list"), err = box.querySelector(".fcm-err"), form = box.querySelector("form"), ta = box.querySelector("textarea"), send = box.querySelector(".fcm-send"), nEl = box.querySelector(".fcm-n");
    const prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    let L = [], total = 0, closed = false, max = 500;
    const say = (t) => { err.textContent = t || ""; };
    const summary = () => ({ count: Math.max(total, L.length), last: L.slice(-2).map((c) => ({ name: c.name, text: String(c.text).replace(/\s+/g, " ").slice(0, 140), ...(c.mine ? { mine: true } : {}) })) });
    const row = (c) => `<li class="fcm-c" data-id="${esc(c.id)}"${c.mine ? "" : ` data-report="${esc(JSON.stringify({ type: "comment", target: "comment:" + c.id, key: c.key || "", name: c.name || "", text: c.text || "" }))}"`}><span class="fcm-av" style="--c:${esc(okColor(c.face?.color) || "#D9CCBB")}" aria-hidden="true">${esc(String(c.name || "?").slice(0, 1).toUpperCase())}</span>
      <div class="fcm-b"><p class="fcm-who"><b>${esc(c.name || "Someone")}</b>${c.host ? `<span class="fcm-tag">Host</span>` : ""}<span class="fcm-at">${esc(ago(c.at))}</span></p><p class="fcm-t">${esc(c.text)}</p>${c.canDelete ? `<button type="button" class="fcm-del" data-del="${esc(c.id)}">Delete</button>` : ""}</div></li>`;
    function draw(toEnd) { list.innerHTML = L.length ? L.map(row).join("") : `<li class="fcm-empty">${signedIn ? "No comments yet. Start it off." : "No comments yet."}</li>`; if (toEnd) list.scrollTop = list.scrollHeight; }
    function close() { if (closed) return; closed = true; current = null; document.removeEventListener("keydown", key); window.visualViewport?.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("scroll", fit);
      document.documentElement.style.overflow = prevOverflow; bg.remove(); try { opener?.focus?.({ preventScroll: true }); } catch {} try { onClose?.(); } catch {} }
    function key(e) { if (e.key === "Escape" && !document.querySelector(".sf-bg")) { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return; const F = [...box.querySelectorAll("a[href]:not([hidden]),button:not([disabled]),textarea,[tabindex='0']")].filter((el) => el.offsetParent !== null); if (!F.length) return;
      const a = F[0], z = F[F.length - 1]; if (e.shiftKey && (document.activeElement === a || document.activeElement === box)) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    // the keyboard on a phone: keep the sheet above it
    function fit() { const vv = window.visualViewport; if (!vv) return; bg.style.top = vv.offsetTop + "px"; bg.style.height = vv.height + "px"; bg.style.bottom = "auto"; }
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    box.querySelector(".fcm-x").onclick = close; document.addEventListener("keydown", key);
    window.visualViewport?.addEventListener("resize", fit); window.visualViewport?.addEventListener("scroll", fit);
    list.addEventListener("click", async (e) => { const b = e.target.closest("[data-del]"); if (!b) return;
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Delete for good?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Delete"; } }, 4000); return; }
      b.disabled = true; say("");
      try { const r = await fetch(`/api/feed/comments/${encodeURIComponent(b.dataset.del)}?target=${encodeURIComponent(target)}`, { method: "DELETE", credentials: "same-origin" }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't delete. Try again.");
        L = L.filter((c) => c.id !== b.dataset.del); total = j.count ?? L.length; draw(false); onChange?.(j.summary || summary()); } catch (er) { b.disabled = false; say(er.message); } });
    if (form) {
      const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight + 3) + "px"; const n = [...ta.value].length; send.disabled = !ta.value.trim(); nEl.textContent = n > max - 100 ? `${n}/${max}` : ""; };
      ta.addEventListener("input", () => { say(""); grow(); });
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches) { e.preventDefault(); form.requestSubmit(); } });
      form.onsubmit = async (e) => { e.preventDefault(); const text = ta.value.trim(); if (!text || send.dataset.busy) return; send.dataset.busy = 1; send.disabled = true; say("");
        try { const r = await fetch("/api/feed/comments", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, text }) }), j = await r.json().catch(() => ({}));
          if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); return; }
          if (!r.ok || !j.comment) throw new Error(j.message || "That didn't send. Try again.");
          L.push(j.comment); total = j.count ?? L.length; ta.value = ""; draw(true); onChange?.(j.summary || summary()); }
        catch (er) { say(er.message); }
        delete send.dataset.busy; grow(); };
    }
    document.body.appendChild(bg); fit(); current = { close };
    setTimeout(() => { try { (focus && ta ? ta : box).focus({ preventScroll: true }); } catch {} }, 30);
    (async () => { try { const r = await fetch("/api/feed/comments?target=" + encodeURIComponent(target), { credentials: "same-origin" }), j = await r.json().catch(() => ({})); if (closed) return;
        if (!r.ok) { list.innerHTML = `<li class="fcm-empty">${esc(r.status === 404 ? "This post isn't around any more." : j.message || "Comments didn't load. Try again in a moment.")}</li>`; if (form) form.hidden = true; return; }
        L = j.comments || []; total = j.count || L.length; max = j.max || 500; if (ta) ta.maxLength = max; box.querySelector("#fcmSub").textContent = j.title || "";
        const chat = box.querySelector(".fcm-chat"); if (j.chat && /^\/g#/.test(j.chat)) { chat.href = j.chat; chat.hidden = false; }
        draw(true); onChange?.(summary()); }
      catch { if (!closed) list.innerHTML = `<li class="fcm-empty">Comments didn't load. Check your connection and try again.</li>`; } })();
    return current;
  }
  window.PLComments = { open, close: () => current?.close() };
})();
