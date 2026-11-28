// ---- story prompts (server/storyprompt.js): asking for photos right when people have them ----
// One file for every surface: the card at the top of /feed and on Home ("How was <event>? Add a photo to your story"),
// the event sheet that replaced the typed prompt(), the new-user sheet, the one line "Add a photo from the night" on a
// past event's invite and after kudos on the feed, and the host's "Ask guests for photos" in the Ask for photos sheet.
// Nothing here opens by itself: the card and the lines are inline, and a sheet only opens from a tap.
(function () {
  if (window.StoryPrompt) return;
  const PATH = location.pathname, q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ID = /^[A-Za-z0-9_-]{1,80}$/, EMPTY = { signedIn: false, card: null, dot: false, events: [] };
  const inHint = () => /(?:^|;\s*)encore_in=1/.test(document.cookie);
  const linked = (() => { try { const s = new URLSearchParams(location.search).get("story") || ""; return PATH === "/feed" && ID.test(s) ? s : ""; } catch { return ""; } })();
  const STYLE = `.sp-card,.sp-sheet,.sp-line,.sp-host{box-sizing:border-box;color:var(--pl-ink,#1B1D1C);font:16px/1.45 "IBM Plex Sans",system-ui,sans-serif;text-align:left;letter-spacing:0}
.sp-card *,.sp-sheet *,.sp-line *,.sp-host *{box-sizing:border-box}
.sp-card{display:grid;grid-template-columns:56px minmax(0,1fr);gap:4px 14px;align-items:start;margin:0 0 16px;padding:16px;background:var(--pl-surface,#FAF8F3);border:1.5px solid var(--pl-line,#CFC8B9);border-radius:6px}
.sp-cov{position:relative;display:block;flex:none;width:56px;height:56px;border-radius:6px;overflow:hidden;background:var(--pl-sand-soft,#EFEBE2)}
.sp-cov img{display:block;width:100%;height:100%;object-fit:cover}
.sp-h{margin:0;font:600 18px/1.3 "IBM Plex Sans",system-ui,sans-serif;overflow-wrap:anywhere}
.sp-s{margin:2px 0 0;font-size:16px}.sp-who{margin:4px 0 0;font-size:15px;color:var(--pl-soft,#444845)}
.sp-row{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
html body .sp-b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:0 18px;border:1.5px solid var(--pl-ink,#1B1D1C);border-radius:6px;background:var(--pl-raised,#fff);color:var(--pl-ink,#1B1D1C);font:600 15px/1.2 "IBM Plex Sans",system-ui,sans-serif;text-decoration:none;text-align:center;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
html body .sp-b.go{background:var(--pl-accent,#29489A);border-color:var(--pl-accent,#29489A);color:#fff}.sp-b:disabled{opacity:.6;cursor:default}
@media (hover:hover){html body .sp-b:not(:disabled):hover{background:var(--pl-sand-soft,#EFEBE2)}html body .sp-b.go:not(:disabled):hover{background:var(--pl-accent,#29489A);filter:brightness(1.1)}.sp-list button:hover{background:var(--pl-sand-soft,#EFEBE2)}}
.sp-b:focus-visible,.sp-list button:focus-visible,.sp-x:focus-visible{outline:3px solid var(--pl-accent,#29489A);outline-offset:2px}
.sp-msg{grid-column:1/-1;margin:8px 0 0;font-size:15px;color:var(--pl-soft,#444845)}.sp-msg:empty{display:none}
.sp-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:12px 0}.sp-line .sp-msg{margin:0}
.sp-scrim{position:fixed;inset:0;z-index:400;display:flex;align-items:flex-end;justify-content:center;background:rgba(27,29,28,.4)}
.sp-sheet{width:100%;max-width:520px;max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:var(--pl-surface,#FAF8F3);border-radius:6px 6px 0 0;padding:0 0 env(safe-area-inset-bottom);box-shadow:0 -8px 30px rgba(27,29,28,.16)}
@media (min-width:700px){.sp-scrim{align-items:center}.sp-sheet{border-radius:6px}}
.sp-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 12px 0 20px}
.sp-top h2{margin:8px 0 0;font:600 20px/1.25 "IBM Plex Sans",system-ui,sans-serif;overflow-wrap:anywhere}
.sp-x{flex:none;min-height:44px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--pl-ink,#1B1D1C);font:600 15px "IBM Plex Sans",system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.sp-body{overflow-y:auto;padding:4px 20px 20px}.sp-p{margin:4px 0 12px;color:var(--pl-soft,#444845);font-size:16px}
.sp-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--pl-line,#CFC8B9)}.sp-list li{border-bottom:1px solid var(--pl-line,#CFC8B9)}
.sp-list button{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;margin:0;padding:8px 4px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sp-list .sp-cov{width:48px;height:48px}.sp-rt{min-width:0}.sp-rt b{display:block;font-weight:600;line-height:1.3;overflow-wrap:anywhere}.sp-rt small{display:block;font-size:15px;color:var(--pl-soft,#444845)}
.sp-sheet .sp-row{margin-top:16px}
.sp-host{min-height:92px;margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid var(--pl-line,#CFC8B9)}.sp-host p{margin:0 0 10px}.sp-host .sp-s2{color:var(--pl-soft,#444845);font-size:15px}
.fv-ring.add .sp-dot{position:absolute;top:2px;right:6px;width:14px;height:14px;border-radius:50%;background:var(--pl-accent,#29489A);border:2px solid var(--pl-page,#F4F1EA)}`;
  const css = () => { if (document.getElementById("spCss")) return; const s = document.createElement("style"); s.id = "spCss"; s.textContent = STYLE; document.head.appendChild(s); };
  // the uploader (public/momentupload.js) is fetched as soon as a button that needs it is on the page, so a tap opens the file picker at once
  const uploader = () => { if (!window.MomentUpload && !q('script[src^="/momentupload.js"]')) { const s = document.createElement("script"); s.src = "/momentupload.js"; document.head.appendChild(s); } };
  const thumb = (e) => { try { return window.EventArt?.thumb ? window.EventArt.thumb(e.cover || {}, { alt: "" }) : ""; } catch { return ""; } };
  const when = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return ""; } };
  const say = (t) => { try { if (window.PLToast) return window.PLToast(t); if (typeof window.toast === "function") return window.toast(t); } catch {} return false; };
  /** What happens to the photo, said plainly: open events reach friends' feeds; the rest stay with the people who were there. */
  const doneText = (n, open) => (n === 1 ? "Added. " : `${n} added. `) + (open ? `Friends see ${n === 1 ? "it" : "them"} in their feed.` : `Only people who were there see ${n === 1 ? "it" : "them"}.`);

  // ---------- what's open for me ----------
  let D = null, loading = null, hush = false; const subs = []; // hush: after Add photos or Not now, no second card in the same visit
  function load(force) { if (!inHint()) { D = EMPTY; return Promise.resolve(D); } if (loading && !force) return loading;
    loading = fetch("/api/me/story-prompt" + (linked ? "?for=" + encodeURIComponent(linked) : ""), { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => (D = j || D || EMPTY)).catch(() => (D = D || EMPTY)); return loading; }
  const changed = (n, ev) => { for (const f of subs) { try { f(n, ev); } catch {} } };

  // ---------- the picker: the file chooser, already set to one event ----------
  /** ev: { id, title, open }. o: { proof: { rid, code }, msg: element for words, onDone } */
  function pick(ev, o = {}) { if (!window.MomentUpload) { uploader(); if (o.msg) o.msg.textContent = "One second, then tap again."; return; }
    const tell = (t) => { if (o.msg) o.msg.textContent = t; else say(t); };
    window.MomentUpload.pick({ q: { eventId: ev.id, ...(o.proof || {}) },
      onStart: (fs, extra) => { window.__spPick = 1; tell(`Adding ${fs.length === 1 ? "your photo" : fs.length + " photos"}${extra ? ` (the first ${fs.length})` : ""}…`); },
      onEach: (f, r, err) => err && tell(err.message),
      onDone: (n) => { setTimeout(() => { window.__spPick = 0; }, 400); if (!n) return; tell(doneText(n, ev.open !== false)); /* said once: in the line, or as the page's toast */ o.onDone?.(n); hush = true; loading = null; load(true).then(() => changed(n, ev)); } }); }

  // ---------- sheets ----------
  function sheet({ title, body, from }) { css(); q("#spSheet")?.remove(); const prev = from || document.activeElement, bg = document.createElement("div"); bg.className = "sp-scrim"; bg.id = "spSheet";
    bg.innerHTML = `<div class="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="spSheetH"><div class="sp-top"><h2 id="spSheetH">${esc(title)}</h2><button type="button" class="sp-x" data-sp-close>Close</button></div><div class="sp-body">${body}</div></div>`;
    const close = (refocus = true) => { if (!bg.isConnected) return; bg.remove(); document.removeEventListener("keydown", key, true); if (refocus) { try { prev?.focus?.(); } catch {} } };
    const key = (e) => { if (!bg.isConnected) return; if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === "Tab") { const F = qa("button,a[href]", bg).filter((x) => !x.disabled); if (!F.length) return; const a = F[0], z = F[F.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } else if (!bg.contains(document.activeElement)) { e.preventDefault(); a.focus(); } } };
    document.addEventListener("keydown", key, true); bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-sp-close]")) close(); });
    document.body.appendChild(bg); (q(".sp-list button", bg) || q(".sp-b", bg) || q(".sp-x", bg)).focus(); return { bg, close }; }
  /** The event sheet: your recent events, newest first. A tap closes it and opens the file chooser for that event. */
  function eventSheet(from, o = {}) { const L = (D || EMPTY).events;
    const S = sheet({ title: "Add photos to your story", from, body: `<p class="sp-p">Pick the event they're from.</p><ul class="sp-list">${L.map((e, i) => `<li><button type="button" data-sp-ev="${i}"><span class="sp-cov" aria-hidden="true">${thumb(e)}</span><span class="sp-rt"><b>${esc(e.title)}</b><small>${esc([when(e.date), e.host ? "You hosted" : ""].filter(Boolean).join(" · "))}</small></span></button></li>`).join("")}</ul>` });
    qa("[data-sp-ev]", S.bg).forEach((b) => (b.onclick = () => { const e = L[+b.dataset.spEv]; S.close(); pick(e, o); })); return S; }
  /** Nobody to add photos for yet: one line of why, and one next step. */
  function newSheet(from) { const host = !!(D || EMPTY).host;
    return sheet({ title: "Your story starts with an event", from, body: `<p class="sp-p">Photos go with an event you went to or hosted.</p><div class="sp-row">${host ? `<a class="sp-b go" href="/?app=1&new=1#studio">Plan something</a>` : `<a class="sp-b go" href="/discover">Find something to go to</a>`}</div>` }); }
  /** "Your story" and every "add photos" with no event named: the right sheet for this person. */
  function open(from, o = {}) { uploader(); const go = () => ((D || EMPTY).events.length ? eventSheet(from, o) : newSheet(from)); if (D) return go(); return load().then(go); }

  // ---------- the card: "How was <event>? Add a photo to your story" ----------
  function cardHtml(c) { return `<span class="sp-cov" aria-hidden="true">${thumb(c)}</span><div><p class="sp-h" id="spCardH" role="heading" aria-level="2">How was ${esc(c.title)}?</p><p class="sp-s">Add a photo to your story.</p>${c.added ? `<p class="sp-who">${esc(c.added)}.</p>` : ""}</div>
<div class="sp-row"><button type="button" class="sp-b go" data-sp-add>Add photos</button><button type="button" class="sp-b" data-sp-not>Not now</button></div><p class="sp-msg" role="status" aria-live="polite"></p>`; }
  /** Put the one card at the top of `host` (or take it away). Returns the card or null. Never more than one on a page. */
  function card(host, { before = null } = {}) { const c = hush ? null : (D || EMPTY).card, old = q("#spCard"); if (old && (!c || old.dataset.ev !== c.id || !host.contains(old))) old.remove(); if (!c || !host) return null; if (q("#spCard")) return q("#spCard");
    css(); uploader(); const el = document.createElement("section"); el.className = "sp-card"; el.id = "spCard"; el.dataset.ev = c.id; el.setAttribute("aria-labelledby", "spCardH"); el.innerHTML = cardHtml(c);
    before && before.parentElement === host ? host.insertBefore(el, before) : host.prepend(el);
    q("[data-sp-add]", el).onclick = () => pick(c, {});
    q("[data-sp-not]", el).onclick = async (e) => { e.currentTarget.disabled = true; try { const r = await fetch("/api/me/story-prompt/dismiss", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: c.id }) }); if (!r.ok) throw 0; } catch { e.currentTarget.disabled = false; q(".sp-msg", el).textContent = "That didn't save. Try again."; return; }
      hush = true; el.remove(); dropCookie(); loading = null; load(true).then(() => changed(0, c)); };
    return el; }

  // ---------- one line: "Add a photo from the night" ----------
  function line(at, ev, o = {}) { if (!at || q(`.sp-line[data-ev="${CSS.escape(ev.id)}"]`)) return null; css(); uploader(); const p = document.createElement("p"); p.className = "sp-line"; p.dataset.ev = ev.id;
    p.innerHTML = `<button type="button" class="sp-b">Add a photo from the night</button><span class="sp-msg" role="status" aria-live="polite"></span>`; at.after(p);
    q("button", p).onclick = () => pick(ev, { ...o, msg: q(".sp-msg", p) }); return p; }
  // a past event's invite (/e/<id>, /i/<id>, /g#rsvp-<id>), for someone who went: their reply's proof on this phone, or their account
  const proofOf = (id) => { try { const M = JSON.parse(localStorage.getItem("encore-rsvp-" + id) || "null"); return M?.rid && M.code ? { rid: M.rid, code: M.code } : null; } catch { return null; } };
  const pageId = () => (PATH.match(/^\/[ei]\/([A-Za-z0-9_-]{2,80})/) || location.hash.match(/^#rsvp-([A-Za-z0-9_-]+)/) || [])[1] || "";
  let invFor = "";
  async function invitePage() { const id = pageId(); if (!ID.test(id) || id === "_preview" || invFor === id) return; invFor = id; qa(".sp-line").forEach((x) => x.remove()); const P = proofOf(id); if (!P && !inHint()) return;
    let j = null; try { j = await fetch(`/api/public/story-line/${encodeURIComponent(id)}${P ? `?rid=${encodeURIComponent(P.rid)}&code=${encodeURIComponent(P.code)}` : ""}`, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)); } catch {}
    if (!j?.can || invFor !== id) return; const ev = { id, title: j.title, open: j.open }, o = j.proof && P ? { proof: P } : {};
    // it sits under the "How was it?" card or the kudos ask when there is one, else under the facts; those arrive a moment later, so it waits for them
    const place = () => { if (q(".sp-line")) return true; const full = PATH === "/g" || !!q("#view-guest"), at = full ? q("#view-guest #kudosAsk") || q("#view-guest .invite.gx") : q("#m > section.dl") || q("#m > .facts"); /* the full invite (also what a past /e/ link opens) or the light one */ if (!at || at.offsetParent === null) return false; line(at, ev, o); return true; };
    let n = 0; const t = setInterval(() => { if (invFor !== id || place() || ++n > 40) clearInterval(t); }, 250); }
  // right after kudos on a past event in the feed, for someone who went to it
  function feedKudos() { document.addEventListener("click", (e) => { const b = e.target.closest?.("[data-fb-kudos]"); if (!b) return; const m = /^(?:e|r):(.+)$/.exec(b.dataset.fbKudos || ""); if (!m) return;
    setTimeout(() => { const ev = (D || EMPTY).events.find((x) => x.id === m[1]); if (!ev || ev.mine || b.getAttribute("aria-pressed") !== "true") return; const at = b.closest(".fb-bar,.fb-acts,.fv-acts") || b.parentElement; line(at, ev); }, 0); }); }

  // ---------- Home in the app: the same card, above the first thing on Home ----------
  // The card comes from the pl_sp cookie the server sets with the page (server/storyprompt.js hint), so it is in place
  // before Home's first paint and nothing under it moves. Nothing is added later in the visit.
  const cookieCard = () => { try { const m = /(?:^|;\s*)pl_sp=([^;]+)/.exec(document.cookie); const c = m ? JSON.parse(decodeURIComponent(m[1])) : null; return c && ID.test(c.id) && c.title ? c : null; } catch { return null; } };
  const dropCookie = () => { try { document.cookie = "pl_sp=; Path=/; SameSite=Lax; Max-Age=0"; } catch {} };
  function home() { const c = cookieCard(); if (!c || window.__spHome) return; window.__spHome = 1; D = { signedIn: true, card: c, dot: true, events: [], partial: true }; loading = Promise.resolve(D);
    let mo = null, placed = false;
    const put = () => { if (hush) return; const v = document.getElementById("view-programs"); if (!v || v.hidden || document.body?.classList.contains("guestmode") || !D?.card) return; const f = v.firstElementChild; if (!f) return; /* with Home's own first content, in the same frame */
      if (f.id !== "spCard") card(v); if (!placed && q("#spCard")) { placed = true; mo.disconnect(); mo.observe(v, { attributes: true, attributeFilter: ["hidden"], childList: true }); } };
    // this file is loaded before the app draws (index.html), so the watcher is in place when Home's first content lands
    mo = new MutationObserver(put); mo.observe(document.documentElement, { childList: true, subtree: true }); subs.push(() => { dropCookie(); q("#spCard")?.remove(); }); put(); }

  // ---------- the host: "Ask guests for photos" (in the Ask for photos sheet) and how many are in ----------
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const inLine = (s) => (s.photos ? `${plural(s.photos, "photo")} in so far${s.people > 1 ? `, from ${s.people} people` : ""}.` : "No photos in yet.");
  async function hostAsk(el, id, { onPrimary } = {}) { if (!el || !ID.test(String(id || ""))) return; css(); el.classList.add("sp-host"); let s = null;
    try { s = await fetch("/api/host/story-ask/" + encodeURIComponent(id), { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)); } catch {} if (!s || !el.isConnected) return;
    const draw = (note = "") => { const asked = s.asked, can = s.can && !asked; onPrimary?.(can);
      el.innerHTML = `<p><b>${esc(inLine(s))}</b></p>${can ? `<button type="button" class="sp-b go" data-sp-ask>Ask guests for photos</button><p class="sp-s2" style="margin:8px 0 0">One note to the bell and phone of ${s.went === 1 ? "the guest who went" : `the ${s.went} guests who went`}. You can send it once.</p>`
        : `<p class="sp-s2" role="status">${esc(note || (asked ? (s.sent ? `You asked ${plural(s.sent, "guest")} for photos.` : "You asked for photos. Everyone with an account had already been asked or had added theirs.") : s.went ? "You can ask guests once it's over." : "Nobody was marked as in, so there's nobody to ask."))}</p>`}`;
      const b = q("[data-sp-ask]", el); if (b) b.onclick = async () => { b.disabled = true; try { const r = await fetch("/api/host/story-ask/" + encodeURIComponent(id), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || "That didn't send. Try again."); s = j;
          draw(j.sent ? `Sent to ${plural(j.sent, "guest")}.${j.went > j.sent ? " The rest aren't on Pottery Lab yet or have already been asked. The message below reaches them." : ""}` : "Nobody new to ask: guests without an account get the message below."); }
        catch (e) { b.disabled = false; let m = q(".sp-msg", el); if (!m) { m = document.createElement("p"); m.className = "sp-msg"; m.setAttribute("role", "status"); el.appendChild(m); } m.textContent = e.message; } }; };
    draw(); }

  window.StoryPrompt = { load, card, open, pick, line, hostAsk, onChange: (f) => subs.push(f), get data() { return D; }, linked, css };
  const start = () => { if (/^\/([ei]\/|g$)/.test(PATH)) { invitePage(); if (PATH === "/g") addEventListener("hashchange", () => { invFor = ""; invitePage(); }); }
    else if (PATH === "/feed") { load(); feedKudos(); }
    };
  if (PATH === "/" && inHint()) home();
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
// ---- end story prompts ----
