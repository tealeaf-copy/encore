// "Nudge the people who haven't replied" (server/pottonudge.js). One confirm card, used three ways:
//   - in Ask Potto's sheet, under Potto's answer (public/potto.js calls PLNudge.card)
//   - as its own sheet from the event overview: "Nudge 5 people" beside "5 haven't replied" (PLNudge.open)
//   - from Potto's line on the overview and on Home: "5 people haven't replied to Dumpling night. Want me to nudge them?"
// The card shows who gets it (names and "by email" or "by text", never an address), the exact message, and
// Send / Edit / Not now. Nothing is sent until Send. An event shared only as a link gets a message to copy or share,
// and can post it to the group chat. "Message the maybes" is the same card with who: "maybe".
// Loaded by public/shell.js for signed-in people on the app, and by public/potto.js when an answer carries a nudge.
(function () {
  if (window.PLNudge) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = async (url, body) => { const r = await fetch(url, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || "That didn't work. Try again."), { status: r.status, code: j.code }); return j; };
  const signed = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const G = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const IC = { x: `<svg ${G} width="20" height="20"><path d="M5 5l10 10M15 5 5 15"/></svg>`, mail: `<svg ${G} width="16" height="16"><rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m3 5.5 7 5 7-5"/></svg>`, sms: `<svg ${G} width="16" height="16"><path d="M10 3.2c3.9 0 7 2.7 7 6.1s-3.1 6.1-7 6.1c-.9 0-1.8-.1-2.6-.4L4 16.4l.9-3.1C3.7 12.2 3 10.8 3 9.3c0-3.4 3.1-6.1 7-6.1z"/></svg>` };
  // Potto as a line drawing (the same mark as public/potto.js)
  const FACE = (s = 28) => `<svg viewBox="0 0 28 28" width="${s}" height="${s}" aria-hidden="true" fill="currentColor"><path d="M10 4.2h8M11.1 4.2v1.7c0 1.2-.9 1.8-.9 2.9 0 1.3-5.5 3.2-5.5 8.9 0 4.5 4.1 7.3 9.3 7.3s9.3-2.8 9.3-7.3c0-5.7-5.5-7.6-5.5-8.9 0-1.1-.9-1.7-.9-2.9V4.2M12.7 19.2c.8.55 1.8.55 2.6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="11.3" cy="16.4" r=".9"/><circle cx="16.7" cy="16.4" r=".9"/></svg>`;
  const T = '"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif';
  const CSS = `
.pn{font:400 16px/1.5 var(--pl-font-text,${T});color:var(--pl-ink,#1B1D1C);letter-spacing:0;text-align:left;min-width:0}
.pn p{margin:0;font:inherit;color:inherit}
.pn .pn-lead{margin:0 0 12px}
.pn .pn-who{list-style:none;margin:0 0 12px;padding:0;border:1px solid var(--pl-line,#CFC8B9);border-radius:12px;background:#fff;max-height:228px;overflow:auto}
.pn .pn-who li{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:8px 14px;font-size:16px}
.pn .pn-who li+li{border-top:1px solid var(--pl-line,#CFC8B9)}
.pn .pn-n{min-width:0;overflow-wrap:anywhere;font-weight:500}
.pn .pn-n small{display:block;font:400 14px/1.35 var(--pl-font-text,${T});color:var(--pl-soft,#444845)}
.pn .pn-ch{flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--pl-soft,#444845);font-size:14px}
.pn .pn-skip,.pn .pn-fine,.pn .pn-quiet{font-size:14px;line-height:1.45;color:var(--pl-soft,#444845);margin:0 0 12px}
.pn .pn-quiet{padding:10px 12px;border-radius:10px;background:var(--pl-sand-soft,#F7EFCB);color:var(--pl-ink,#1B1D1C)}
.pn .pn-cap{font:500 14px/1.3 var(--pl-font-text,${T});color:var(--pl-soft,#444845);margin:0 0 6px}
.pn .pn-msg{margin:0 0 8px;padding:12px 14px;border:1px solid var(--pl-line,#CFC8B9);border-radius:12px;background:#fff}
.pn .pn-text{font-size:16px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
.pn .pn-text .pn-fix{color:var(--pl-soft,#444845)}
.pn label.pn-cap{display:block}
.pn textarea{display:block;width:100%;box-sizing:border-box;min-height:96px;margin:6px 0;padding:10px 12px;border:1.5px solid var(--pl-line-strong,#1B1D1C);border-radius:10px;background:#fff;color:var(--pl-ink,#1B1D1C);font:400 16px/1.5 var(--pl-font-text,${T});resize:vertical}
.pn textarea:focus-visible,.pn .pn-b:focus-visible,.pn-x:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.pn .pn-count{display:block;text-align:right;font-size:14px;color:var(--pl-soft,#444845)}
.pn .pn-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.pn .pn-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:999px;border:1.5px solid var(--pl-line-strong,#1B1D1C);background:#fff;color:var(--pl-ink,#1B1D1C);font:600 15px/1 var(--pl-font-text,${T});cursor:pointer;white-space:nowrap;text-decoration:none;-webkit-tap-highlight-color:transparent}
.pn .pn-b.pri{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:#fff}
.pn .pn-b.pri:hover{background:var(--pl-accent-press,#1F3878)}
.pn .pn-b.ghost{border-color:transparent;background:none;text-decoration:underline;padding:0 10px;font-weight:500}
.pn .pn-b:disabled{opacity:.6;cursor:default}
.pn .pn-err{color:var(--pl-danger,#A2361A);font-size:14px;font-weight:500;margin-top:8px}.pn .pn-err:empty{display:none}
.pn .pn-done{font-weight:500;color:var(--pl-ink,#1B1D1C)}
.pn .pn-wait{min-height:120px;color:var(--pl-soft,#444845)}
.pn-bg{position:fixed;inset:0;z-index:9200;background:rgba(29,27,24,.4);display:flex;align-items:flex-end;justify-content:center}
.pn-sheet{width:min(560px,100%);max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;background:var(--pl-surface,#FAF8F3);border-radius:16px 16px 0 0;box-shadow:0 12px 40px rgba(0,0,0,.22);overflow:hidden}
@media (min-width:861px){.pn-bg{align-items:center}.pn-sheet{border-radius:16px;max-height:min(84vh,760px)}}
.pn-hd{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 8px 12px 20px;border-bottom:1px solid var(--pl-line,#CFC8B9)}
.pn-hd h2{margin:0;font:600 20px/1.25 var(--pl-font-text,${T});letter-spacing:0;color:var(--pl-ink,#1B1D1C);text-transform:none}
.pn-hd p{margin:2px 0 0;font:400 14px/1.4 var(--pl-font-text,${T});color:var(--pl-soft,#444845)}
.pn-x{flex:none;width:44px;height:44px;border:0;background:none;border-radius:50%;display:grid;place-items:center;color:var(--pl-ink,#1B1D1C);cursor:pointer;padding:0}
.pn-x:hover{background:var(--pl-raised,#E6E1D5)}
.pn-bd{flex:1;overflow:auto;padding:16px 20px calc(20px + env(safe-area-inset-bottom));overscroll-behavior:contain}
.pn-line{display:flex;align-items:flex-start;gap:12px;margin:0 0 16px;padding:14px 16px;border:1.5px solid var(--pl-line,#CFC8B9);border-radius:12px;background:var(--pl-surface,#FAF8F3);color:var(--pl-ink,#1B1D1C);font:400 16px/1.45 var(--pl-font-text,${T});letter-spacing:0}
.pn-line .pn-face{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--pl-sand-soft,#F7EFCB)}
.pn-line>div{min-width:0;flex:1}.pn-line p{margin:0;font:inherit;color:inherit}
.pn-line .pn-btns{margin-top:10px}
#hv .pn-hvrow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px dashed var(--pl-line,#CFC8B9)}
#hv .pn-hvrow p{font:500 16px/1.4 var(--pl-font-text,${T})}
#hv .pn-hvrow small{display:block;font:400 14px/1.4 var(--pl-font-text,${T});color:var(--pl-soft,#444845)}
`;
  const css = () => { if (document.getElementById("pnCss")) return; const s = document.createElement("style"); s.id = "pnCss"; s.textContent = CSS; document.head.appendChild(s); };
  const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  // the host's line as it will go out: the same cleaning as server/pottonudge.js cleanBody (links are left out)
  const tidy = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s*\u2014\s*/g, ", ").replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ").replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|ly|me|link|xyz|info|dev|page|site|gg|to)\b(?:\/\S*)?/gi, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  const ppl = (n) => (n === 1 ? "1 person" : `${n} people`);
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch {} try { const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;opacity:0;left:-999px"; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; } catch { return false; } }

  // ---------- the card ----------
  /** Draw the confirm card into el. o: { eventId, who: "noreply" | "maybe", inline, keep, onSent(result), onClose() } */
  function card(el, o = {}) {
    css(); const who = o.who === "maybe" ? "maybe" : "noreply", K = o.keep || (o.keep = {}), base = `/api/host/nudge/${encodeURIComponent(o.eventId)}`;
    el.classList.add("pn");
    const closeBtn = (label = "Not now") => `<button type="button" class="pn-b ghost" data-no>${label}</button>`;
    const done = (text) => { K.done = text; el.innerHTML = `<p class="pn-done" role="status">${esc(text)}</p>${o.inline ? "" : `<div class="pn-btns"><button type="button" class="pn-b" data-no>Done</button></div>`}`; el.querySelector("[data-no]")?.addEventListener("click", () => o.onClose?.()); el.querySelector("[data-no]")?.focus(); };
    const no = () => { if (o.onClose) return o.onClose(); K.done = "Okay. Nothing was sent."; el.innerHTML = `<p class="pn-done" role="status">${esc(K.done)}</p>`; };
    if (K.done) { el.innerHTML = `<p class="pn-done" role="status">${esc(K.done)}</p>`; return; }
    function draw() { const P = K.P;
      if (P.gate) { el.innerHTML = `<p class="pn-lead">${esc(P.gate)}</p>${o.inline ? "" : `<div class="pn-btns"><button type="button" class="pn-b" data-no>Close</button></div>`}`; el.querySelector("[data-no]")?.addEventListener("click", no); return; }
      if (!P.count) return P.linkOnly ? drawPaste() : drawNone();
      const body = K.body ?? P.body, S = P.sample || {}, n = P.count, tail = /Reply STOP to opt out\.$/.test(S.text || "") ? " Reply STOP to opt out." : "";
      const ways = [P.channels?.email ? "Emails end with an unsubscribe link." : "", P.channels?.text ? "Texts end with Reply STOP to opt out." : ""].filter(Boolean).join(" ");
      el.innerHTML = `<p class="pn-cap" id="pnWhoCap">${who === "maybe" ? `${ppl(n)} said Maybe` : `${ppl(n)} ${n === 1 ? "gets" : "get"} it`}</p>
        <ul class="pn-who" aria-labelledby="pnWhoCap">${P.people.map((p) => `<li><span class="pn-n">${esc(p.name)}${p.last ? `<small>Nudged ${esc(p.last)}</small>` : ""}</span><span class="pn-ch">${p.channel === "email" ? IC.mail : IC.sms}${esc(p.by)}</span></li>`).join("")}</ul>
        ${P.skipped.length ? `<p class="pn-skip">Not getting it: ${P.skipped.map((s) => `${esc(s.name)} (${esc(s.why)})`).join(", ")}.</p>` : ""}
        ${K.editing ? `<label class="pn-cap" for="pnBody">Your line</label><textarea id="pnBody" maxlength="${P.bodyMax || 300}" aria-describedby="pnFine">${esc(body)}</textarea><span class="pn-count" aria-hidden="true"></span>` : ""}
        <p class="pn-cap">${K.editing ? `What ${esc(first(S.name) || "they")} will read` : "The message"}</p>
        <div class="pn-msg"><p class="pn-text"><span class="pn-fix">${esc(S.pre || "")}</span> <span data-body>${esc(tidy(body))}</span> <span class="pn-fix">${esc(S.post || "")}${esc(tail)}</span></p></div>
        <p class="pn-fine" id="pnFine">${n > 1 ? "Each person gets their own name and link. " : ""}${ways}${K.editing ? " Links in your line are left out." : ""}</p>
        ${P.quiet ? `<p class="pn-quiet">It's after 9pm where your guests are, so this goes out at ${esc(P.quiet.at)}.</p>` : ""}
        <div class="pn-btns"><button type="button" class="pn-b pri" data-send>${P.quiet ? `Send at ${esc(P.quiet.at)}` : n === 1 ? "Send" : `Send to ${n}`}</button>${K.editing ? "" : `<button type="button" class="pn-b" data-edit>Edit</button>`}${closeBtn()}</div><p class="pn-err" role="alert"></p>`;
      const ta = el.querySelector("textarea"), cnt = el.querySelector(".pn-count");
      if (ta) { const sync = () => { K.body = ta.value; el.querySelector("[data-body]").textContent = tidy(ta.value); cnt.textContent = `${ta.value.length} of ${ta.maxLength}`; }; ta.addEventListener("input", sync); sync(); }
      el.querySelector("[data-edit]")?.addEventListener("click", () => { K.editing = true; draw(); const t = el.querySelector("textarea"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); });
      el.querySelector("[data-no]").addEventListener("click", no);
      el.querySelector("[data-send]").addEventListener("click", async (e) => { const b = e.currentTarget, err = el.querySelector(".pn-err"); const line = (K.body ?? P.body).trim(); if (line.length < 3) { err.textContent = "Write a line first."; return; }
        b.disabled = true; err.textContent = "";
        try { const r = await api(base + "/send", { confirm: true, who, body: line }); if (r.state) setState(o.eventId, r.state); done(r.report || "Done."); o.onSent?.(r); }
        catch (x) { b.disabled = false; err.textContent = x.message; } }); }
    function drawNone() { const P = K.P;
      el.innerHTML = `<p class="pn-lead">${who === "maybe" ? (P.skipped.length ? "No one I can message right now." : "No one said Maybe.") : P.skipped.length ? "No one I can nudge right now." : "Everyone you invited has replied."}</p>
        ${P.skipped.length ? `<p class="pn-skip">${P.skipped.map((s) => `${esc(s.name)} (${esc(s.why)})`).join(", ")}.</p>` : ""}${o.inline ? "" : `<div class="pn-btns"><button type="button" class="pn-b" data-no>Close</button></div>`}`;
      el.querySelector("[data-no]")?.addEventListener("click", no); }
    function drawPaste() { const P = K.P, text = K.paste ?? P.paste.text, chat = P.paste.chat, canShare = typeof navigator.share === "function";
      el.innerHTML = `${o.inline ? "" /* Potto's answer above already says it */ : `<p class="pn-lead">You shared this one as a link, so I can't see who has it and I can't message them myself. Here's a nudge to paste where you shared it.</p>`}
        ${K.editing ? `<label class="pn-cap" for="pnBody">The message</label><textarea id="pnBody" maxlength="500">${esc(text)}</textarea>` : `<p class="pn-cap">The message</p><div class="pn-msg"><p class="pn-text">${esc(text)}</p></div>`}
        ${K.asking ? `<p class="pn-quiet">Post this to the ${chat.going === 1 ? "1 guest" : `${chat.going} guests`} in the group chat?</p><div class="pn-btns"><button type="button" class="pn-b pri" data-post>Post it</button><button type="button" class="pn-b ghost" data-back>Not now</button></div>`
          : `<div class="pn-btns"><button type="button" class="pn-b pri" data-copy>Copy</button>${canShare ? `<button type="button" class="pn-b" data-share>Share</button>` : ""}${chat ? `<button type="button" class="pn-b" data-chat>Post to the group chat</button>` : ""}${K.editing ? "" : `<button type="button" class="pn-b" data-edit>Edit</button>`}${o.inline ? "" : closeBtn("Close")}</div>`}
        <p class="pn-fine" role="status" data-said style="margin:8px 0 0"></p><p class="pn-err" role="alert"></p>`;
      const ta = el.querySelector("textarea"); if (ta) ta.addEventListener("input", () => { K.paste = ta.value; });
      const cur = () => (K.paste ?? P.paste.text).trim(), said = (t) => { el.querySelector("[data-said]").textContent = t; };
      el.querySelector("[data-copy]")?.addEventListener("click", async () => said((await copy(cur())) ? "Copied. Paste it where you shared the invite." : "I couldn't copy it. Select the message and copy it by hand."));
      el.querySelector("[data-share]")?.addEventListener("click", async () => { try { await navigator.share({ text: cur() }); } catch {} });
      el.querySelector("[data-edit]")?.addEventListener("click", () => { K.editing = true; drawPaste(); el.querySelector("textarea").focus(); });
      el.querySelector("[data-chat]")?.addEventListener("click", () => { K.asking = true; drawPaste(); el.querySelector("[data-post]").focus(); });
      el.querySelector("[data-back]")?.addEventListener("click", () => { K.asking = false; drawPaste(); });
      el.querySelector("[data-post]")?.addEventListener("click", async (e) => { e.currentTarget.disabled = true; try { await api(chat.url, { text: cur() }); done(`Posted to the group chat for the ${chat.going === 1 ? "1 guest" : `${chat.going} guests`} already in. I didn't message anyone else.`); o.onSent?.({ chat: true }); } catch (x) { e.currentTarget.disabled = false; el.querySelector(".pn-err").textContent = x.message; } });
      el.querySelector("[data-no]")?.addEventListener("click", no); }
    if (K.P) return draw();
    el.innerHTML = `<p class="pn-wait" role="status">${who === "maybe" ? "Checking who said Maybe…" : "Checking who hasn't replied…"}</p>`;
    api(`${base}?who=${who}`).then((P) => { K.P = P; if (!el.isConnected) return; draw(); o.onReady?.(P); }).catch((x) => { if (el.isConnected) el.innerHTML = `<p class="pn-err" role="alert">${esc(x.message)}</p>`; });
  }

  // ---------- the sheet ----------
  let SH = null;
  function close() { if (!SH) return; document.removeEventListener("keydown", SH.key, true); SH.el.remove(); document.documentElement.style.overflow = SH.over; const b = SH.back, sel = SH.backSel; SH = null; try { (b && b.isConnected ? b : (sel && document.querySelector(sel)) || document.querySelector("#hvGo"))?.focus?.({ preventScroll: true }); } catch {} }
  /** Open the confirm sheet. o: { eventId, who, title, when, back } */
  function open(o = {}) { if (!signed() || !o.eventId) return; close(); css();
    const el = document.createElement("div"); el.className = "pn-bg"; el.id = "pnSheet"; const maybe = o.who === "maybe";
    el.innerHTML = `<div class="pn-sheet" role="dialog" aria-modal="true" aria-labelledby="pnTitle"><div class="pn-hd"><div><h2 id="pnTitle">${maybe ? "Message the maybes" : "Nudge the people who haven't replied"}</h2><p id="pnSub">${esc(o.title || "")}</p></div><button type="button" class="pn-x" aria-label="Close">${IC.x}</button></div><div class="pn-bd"><div data-card></div></div></div>`;
    const key = (e) => { if (!SH || SH.el !== el) return; if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") { const f = [...el.querySelectorAll("button,textarea,a[href]")].filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } } };
    SH = { el, back: o.back || document.activeElement, backSel: o.backSel || "", key, over: document.documentElement.style.overflow }; // backSel: the same button after the overview drew again
    document.body.appendChild(el); document.documentElement.style.overflow = "hidden"; document.addEventListener("keydown", key, true);
    el.addEventListener("click", (e) => { if (e.target === el) close(); }); el.querySelector(".pn-x").onclick = close;
    card(el.querySelector("[data-card]"), { eventId: o.eventId, who: o.who, onClose: close, onReady: (P) => { const s = el.querySelector("#pnSub"); if (s) s.textContent = [P.event?.title, P.event?.when].filter(Boolean).join(" · "); }, onSent: () => { try { window.HostEvent?.render?.(); } catch {} document.getElementById("pnHome")?.remove(); HOME = null; } });
    el.querySelector(".pn-x").focus({ preventScroll: true }); }

  // ---------- the event overview (index.html calls these while it draws) ----------
  const ST = new Map(); // eventId -> { data, at, busy }
  const setState = (id, data) => { ST.set(id, { data, at: Date.now() }); };
  const stateOf = (id) => ST.get(id)?.data || null;
  const studioOn = () => { const v = document.getElementById("view-studio"); return !!v && !v.hidden && !!document.getElementById("hv"); };
  const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  function refresh(id) { const cur = ST.get(id) || {}; if (cur.busy || (cur.at && Date.now() - cur.at < 30000)) return; ST.set(id, { ...cur, busy: true });
    api(`/api/host/nudge/${encodeURIComponent(id)}/state`).then((d) => { const before = JSON.stringify(cur.data || null); setState(id, d);
      if (JSON.stringify(d) !== before && (d.waiting || d.nudged?.length || cur.data) && studioOn() && !typing() && !document.getElementById("hvSheet") && !SH && window.HostEvent?.draft?.()?.id === id) { try { window.HostEvent.render(); } catch {} } })
      .catch(() => ST.set(id, { data: cur.data || null, at: Date.now() })); }
  const shared = (d) => !!d && !!d.id && !d.example && !!(d.published || d.discoverable);
  /** Potto's line on the overview, when it's time to nudge. */
  function hvLine(d) { const s = shared(d) ? stateOf(d.id)?.suggest : null; if (!s) return ""; css();
    return `<div class="pn-line" role="group" aria-label="A suggestion from Potto"><span class="pn-face">${FACE(26)}</span><div class="pn"><p>${esc(s.line)}</p><div class="pn-btns"><button type="button" class="pn-b" data-pn-open>Nudge them</button><button type="button" class="pn-b ghost" data-pn-no>Not now</button></div></div></div>`; }
  /** "5 haven't replied" and "Nudge 5 people", inside Who's coming. */
  function hvRow(d) { const s = shared(d) ? stateOf(d.id) : null; if (!s || !s.waiting) return ""; css();
    const hint = s.gate ? s.gate : !s.can ? "No one to nudge right now. Each person gets two at most, three days apart." : "";
    return `<div class="pn-hvrow"><p>${s.waiting === 1 ? "1 hasn't replied" : `${s.waiting} haven't replied`}${hint ? `<small>${esc(hint)}</small>` : ""}</p>${s.can ? `<button type="button" class="hv-b sm" data-pn-open>${s.can === 1 ? "Nudge 1 person" : `Nudge ${s.can} people`}</button>` : ""}</div>`; }
  /** "Nudged Tue" beside a person on the guest list. */
  function hvTag(d, p) { const s = d?.id ? stateOf(d.id) : null; if (!s?.nudged?.length || !p) return ""; const em = String(p.email || "").trim().toLowerCase(), nm = String(p.name || "").trim().toLowerCase();
    const hit = s.nudged.find((x) => (em && (x.keys || []).includes(em)) || (nm && (x.keys || []).includes(nm))); return hit ? hit.label : ""; }
  function hvWire(h, d) { if (!shared(d)) return; refresh(d.id);
    h.querySelectorAll("[data-pn-open]").forEach((b) => (b.onclick = () => open({ eventId: d.id, who: "noreply", title: d.pubTitle || d.name || "", back: b, backSel: b.closest(".pn-line") ? "#hv .pn-line [data-pn-open]" : "#hv .pn-hvrow [data-pn-open]" })));
    h.querySelectorAll("[data-pn-no]").forEach((b) => (b.onclick = () => { const s = stateOf(d.id); if (s) s.suggest = null; api(`/api/host/nudge/${encodeURIComponent(d.id)}/dismiss`, {}).catch(() => {}); if (HOME?.eventId === d.id) { HOME = null; document.getElementById("pnHome")?.remove(); }
      // the overview draws again, so Potto's usual line takes the place and nothing is left half drawn
      try { window.HostEvent.render(); (document.querySelector("#hv .pn-hvrow [data-pn-open]") || document.querySelector("#hvGo"))?.focus({ preventScroll: true }); } catch { b.closest(".pn-line")?.remove(); } })); }

  // ---------- Home: one line from Potto, when an event needs it ----------
  let HOME = null;
  function paintHome() { const v = document.getElementById("view-programs"); if (!v || v.hidden || !HOME || document.getElementById("pnHome")) return; css();
    const at = v.querySelector(":scope > #qsPanel"), h = `<section class="pn-line" id="pnHome" aria-label="A suggestion from Potto"><span class="pn-face">${FACE(26)}</span><div class="pn"><p>${esc(HOME.line)}</p><div class="pn-btns"><button type="button" class="pn-b" data-pn-open>Nudge them</button><button type="button" class="pn-b ghost" data-pn-no>Not now</button></div></div></section>`;
    at ? at.insertAdjacentHTML("afterend", h) : v.insertAdjacentHTML("afterbegin", h); const el = document.getElementById("pnHome"), s = HOME;
    el.querySelector("[data-pn-open]").onclick = (e) => open({ eventId: s.eventId, who: "noreply", title: s.title, back: e.currentTarget });
    el.querySelector("[data-pn-no]").onclick = () => { HOME = null; el.remove(); const c = stateOf(s.eventId); if (c) c.suggest = null; api(`/api/host/nudge/${encodeURIComponent(s.eventId)}/dismiss`, {}).catch(() => {}); }; }
  function start() { if (location.pathname !== "/" || !signed()) return;
    // the event that's open drew before this file arrived: get its state and let the overview draw again
    try { const d = window.HostEvent?.draft?.(); if (shared(d) && studioOn()) refresh(d.id); } catch {}
    api("/api/host/nudge/suggest").then((j) => { if (!j?.suggest) return; HOME = j.suggest; paintHome();
      let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(paintHome, 150); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] }); }).catch(() => {}); }

  window.PLNudge = { card, open, close, hvLine, hvRow, hvTag, hvWire, stateOf, refresh };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
